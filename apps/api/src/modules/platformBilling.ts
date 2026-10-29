/**
 * Software-owner billing: seller profile, payment methods / Razorpay settings, subscription invoices (super admin),
 * and the shop-side "Plan & billing" screen: plans, how to pay, "I have paid" reports, Razorpay checkout, invoices.
 */
import type { FastifyInstance } from "fastify";
import bwipjs from "bwip-js";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { requirePermission, requirePlatformAdmin } from "../lib/context";
import { audit } from "../lib/audit";
import { AppError, conflict, notFound } from "../lib/errors";
import { sealSecret } from "../lib/secretBox";
import {
  billingGaps, getSellerBilling, getStoredPayments, paymentMethodsSchema, paymentsView, razorpayCredentials, sellerBillingSchema, write,
} from "../lib/platformSettings";
import { issueCommercialInvoice, planGross } from "../lib/commercialInvoice";
import { createRazorpayOrder, fetchRazorpayOrder, fetchRazorpayPayment, testRazorpay, verifyCheckoutSignature, verifyWebhookSignature } from "../lib/razorpay";
import { applySubscriptionPayment } from "../lib/subscriptionPayments";
import { CUSTOMER_ORG } from "./platformConsole";

const invoiceColumns = sql`i.id, i.number, i.status, i.issued_at as "issuedAt", i.organization_id as "organizationId", o.name as "organizationName",
  i.total_paise as "totalPaise", i.subtotal_paise as "subtotalPaise", i.cgst_paise + i.sgst_paise + i.igst_paise as "taxPaise",
  i.period_start as "periodStart", i.period_end as "periodEnd", p.provider, p.provider_reference as "reference", pl.name as "planName"`;

export async function platformBillingRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ super admin: settings
  app.get("/platform-admin/settings/billing", async (req) => {
    requirePlatformAdmin(req);
    const seller = await getSellerBilling(db);
    const [last] = await db.execute<{ number: string }>(sql`select number from commercial_invoices order by created_at desc limit 1`);
    return { seller, gaps: billingGaps(seller), lastInvoiceNumber: last?.number ?? null };
  });

  app.put("/platform-admin/settings/billing", async (req) => {
    const auth = requirePlatformAdmin(req);
    const seller = sellerBillingSchema.parse(req.body);
    const next = `${seller.invoice.prefix}${String(seller.invoice.nextNumber).padStart(5, "0")}`;
    const [clash] = await db.execute<{ id: string }>(sql`select id from commercial_invoices where number = ${next} limit 1`);
    if (clash) throw conflict(`Invoice ${next} already exists. Choose a higher next number or a new prefix.`, "INVOICE_NUMBER_USED");
    const before = await getSellerBilling(db);
    await db.transaction(async (tx) => {
      await write(tx, "seller_billing", seller as unknown as Record<string, unknown>, auth.userId);
      await audit(tx, req, { action: "platform.billing_profile_updated", resourceType: "platform_settings", actorUserId: auth.userId, before, after: seller });
    });
    return { seller, gaps: billingGaps(seller), lastInvoiceNumber: null };
  });

  app.get("/platform-admin/settings/payments", async (req) => {
    requirePlatformAdmin(req);
    return paymentsView(await getStoredPayments(db));
  });

  app.put("/platform-admin/settings/payments", async (req) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      methods: paymentMethodsSchema,
      razorpay: z.object({
        enabled: z.boolean(),
        mode: z.enum(["test", "live"]),
        keyId: z.string().trim().max(60).refine((v) => v === "" || /^rzp_(test|live)_[A-Za-z0-9]+$/.test(v), "Razorpay Key ID starts with rzp_test_ or rzp_live_"),
        /** undefined = keep the saved secret, "" = remove it, any other value = replace it. */
        keySecret: z.string().trim().max(200).optional(),
        webhookSecret: z.string().trim().max(200).optional(),
      }),
    }).parse(req.body);
    const stored = await getStoredPayments(db);
    const r = body.razorpay;
    if (r.keyId && !r.keyId.startsWith(`rzp_${r.mode}_`)) throw conflict(`This is a ${r.keyId.startsWith("rzp_live_") ? "live" : "test"} key; set the mode to match it.`, "RAZORPAY_MODE_MISMATCH");
    const next = {
      methods: body.methods,
      razorpay: {
        enabled: r.enabled,
        mode: r.mode,
        keyId: r.keyId,
        keySecret: r.keySecret === undefined ? stored.razorpay.keySecret : r.keySecret === "" ? undefined : sealSecret(r.keySecret),
        webhookSecret: r.webhookSecret === undefined ? stored.razorpay.webhookSecret : r.webhookSecret === "" ? undefined : sealSecret(r.webhookSecret),
        // A changed key invalidates the last connection test.
        lastTest: r.keyId === stored.razorpay.keyId && r.keySecret === undefined ? stored.razorpay.lastTest : undefined,
      },
    };
    if (next.razorpay.enabled && (!next.razorpay.keyId || !next.razorpay.keySecret)) {
      throw conflict("Enter the Razorpay Key ID and Key Secret before turning online payments on.", "RAZORPAY_KEYS_REQUIRED");
    }
    if (!body.methods.upi && !body.methods.bankTransfer && !body.methods.cash && !next.razorpay.enabled) {
      throw conflict("Keep at least one way for shops to pay.", "NO_PAYMENT_METHOD");
    }
    await db.transaction(async (tx) => {
      await write(tx, "payments", next as unknown as Record<string, unknown>, auth.userId);
      // Secrets never go into the audit log, only whether they changed.
      await audit(tx, req, {
        action: "platform.payment_settings_updated", resourceType: "platform_settings", actorUserId: auth.userId,
        after: { methods: body.methods, razorpay: { enabled: r.enabled, mode: r.mode, keyId: r.keyId, keySecretChanged: r.keySecret !== undefined, webhookSecretChanged: r.webhookSecret !== undefined } },
      });
    });
    return paymentsView(next as Parameters<typeof paymentsView>[0]);
  });

  app.post("/platform-admin/settings/payments/razorpay/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requirePlatformAdmin(req);
    const stored = await getStoredPayments(db);
    if (!stored.razorpay.keyId || !stored.razorpay.keySecret) throw conflict("Save the Razorpay Key ID and Key Secret first.", "RAZORPAY_KEYS_REQUIRED");
    const { openSecret } = await import("../lib/secretBox");
    const result = await testRazorpay({ keyId: stored.razorpay.keyId, keySecret: openSecret(stored.razorpay.keySecret) });
    const lastTest = { at: new Date().toISOString(), ok: result.ok, message: result.message };
    await write(db, "payments", { ...stored, razorpay: { ...stored.razorpay, lastTest } } as unknown as Record<string, unknown>, auth.userId);
    return lastTest;
  });

  // ------------------------------------------------------------------ super admin: invoices
  app.get("/platform-admin/invoices", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ search: z.string().trim().max(100).optional(), status: z.enum(["issued", "void", "all"]).default("all") }).parse(req.query);
    const like = q.search ? `%${q.search}%` : null;
    const rows = await db.execute(sql`select ${invoiceColumns}
      from commercial_invoices i join organizations o on o.id = i.organization_id
      join commercial_payments p on p.id = i.payment_id left join commercial_plans pl on pl.id = i.plan_id
      where ${CUSTOMER_ORG} and (${q.status} = 'all' or i.status = ${q.status}) and (${like}::text is null or i.number ilike ${like} or o.name ilike ${like})
      order by i.issued_at desc limit 500`);
    const [totals] = await db.execute<{ count: number; total: string; tax: string }>(sql`
      select count(*)::int as count, coalesce(sum(i.total_paise),0) as total, coalesce(sum(i.cgst_paise + i.sgst_paise + i.igst_paise),0) as tax
      from commercial_invoices i join organizations o on o.id = i.organization_id where i.status = 'issued' and ${CUSTOMER_ORG}`);
    const [missing] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from commercial_payments p join organizations o on o.id = p.organization_id
      where p.status = 'paid' and ${CUSTOMER_ORG}
        and not exists (select 1 from commercial_invoices i where i.payment_id = p.id)`);
    return { invoices: rows, totals: { count: totals.count, totalPaise: Number(totals.total), taxPaise: Number(totals.tax) }, paymentsWithoutInvoice: missing.n };
  });

  app.get("/platform-admin/invoices/:id", async (req) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const invoice = await db.query.commercialInvoices.findFirst({ where: eq(schema.commercialInvoices.id, id) });
    if (!invoice) throw notFound("Invoice");
    return invoiceDetail(invoice);
  });

  app.post("/platform-admin/invoices/:id/void", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(8).max(500) }).parse(req.body);
    const [invoice] = await db.update(schema.commercialInvoices).set({ status: "void", voidReason: reason })
      .where(and(eq(schema.commercialInvoices.id, id), eq(schema.commercialInvoices.status, "issued"))).returning();
    if (!invoice) throw conflict("This invoice is already void or does not exist.", "INVOICE_NOT_ISSUED");
    await audit(db, req, { action: "platform.invoice_voided", resourceType: "commercial_invoice", resourceId: id, orgId: invoice.organizationId, actorUserId: auth.userId, after: { number: invoice.number, reason } });
    return invoiceDetail(invoice);
  });

  /** Issues invoices for paid payments recorded before invoicing existed. */
  app.post("/platform-admin/invoices/issue-missing", async (req) => {
    const auth = requirePlatformAdmin(req);
    const rows = await db.execute<{ id: string }>(sql`
      select p.id from commercial_payments p join organizations o on o.id = p.organization_id
      where p.status = 'paid' and ${CUSTOMER_ORG}
        and not exists (select 1 from commercial_invoices i where i.payment_id = p.id)
      order by p.created_at`);
    const issued: string[] = [];
    for (const row of rows) {
      const inv = await db.transaction((tx) => issueCommercialInvoice(tx, row.id));
      if (inv) issued.push(inv.number);
    }
    await audit(db, req, { action: "platform.invoices_backfilled", resourceType: "commercial_invoice", actorUserId: auth.userId, after: { issued } });
    return { issued };
  });

  /** Payment reports from shops ("I have paid") awaiting verification. */
  app.get("/platform-admin/payment-claims", async (req) => {
    requirePlatformAdmin(req);
    return db.execute(sql`
      select p.id, p.organization_id as "organizationId", o.name as "organizationName", p.provider, p.provider_reference as "reference",
        p.amount_paise as "amountPaise", p.provider_payload_json as "details", p.created_at as "createdAt"
      from commercial_payments p join organizations o on o.id = p.organization_id
      where p.provider like 'claim_%' and p.status = 'pending' and ${CUSTOMER_ORG}
      order by p.created_at`);
  });

  app.post("/platform-admin/payment-claims/:id/reject", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(8).max(500) }).parse(req.body);
    const [claim] = await db.update(schema.commercialPayments)
      .set({ status: "rejected", providerPayload: sql`${schema.commercialPayments.providerPayload} || ${JSON.stringify({ rejectedReason: reason, rejectedBy: auth.userId })}::jsonb` })
      .where(and(eq(schema.commercialPayments.id, id), eq(schema.commercialPayments.status, "pending"))).returning();
    if (!claim) throw conflict("This payment report was already handled.", "CLAIM_HANDLED");
    await audit(db, req, { action: "platform.payment_claim_rejected", resourceType: "commercial_payment", resourceId: id, orgId: claim.organizationId, actorUserId: auth.userId, after: { reason } });
    return { ok: true };
  });

  // ------------------------------------------------------------------ shop: plan & billing
  app.get("/commercial/billing", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const [org, seller, payments, plans, subscription] = await Promise.all([
      db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) }),
      getSellerBilling(db),
      getStoredPayments(db),
      db.query.commercialPlans.findMany({ where: eq(schema.commercialPlans.published, true), orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise] }),
      db.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, auth.orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)] }),
    ]);
    const rate = seller.invoice.gstRateBps;
    const invoices = await db.execute(sql`select i.id, i.number, i.status, i.issued_at as "issuedAt", i.total_paise as "totalPaise", pl.name as "planName", i.period_start as "periodStart", i.period_end as "periodEnd"
      from commercial_invoices i left join commercial_plans pl on pl.id = i.plan_id where i.organization_id = ${auth.orgId} order by i.issued_at desc limit 50`);
    const claims = await db.execute(sql`select id, provider, provider_reference as "reference", amount_paise as "amountPaise", status, created_at as "createdAt", provider_payload_json->>'rejectedReason' as "rejectedReason"
      from commercial_payments where organization_id = ${auth.orgId} and provider like 'claim_%' order by created_at desc limit 10`);
    return {
      organization: { name: org?.name, status: org?.status, trialEndsAt: org?.trialEndsAt },
      subscription: subscription ? { ...subscription, plan: plans.find((p) => p.id === subscription.planId) ?? null } : null,
      plans: plans.map((p) => ({ ...p, gstRateBps: rate, payablePaise: planGross(p, rate) })),
      pay: {
        methods: payments.methods,
        upi: payments.methods.upi && seller.upiId ? { vpa: seller.upiId, payeeName: seller.upiPayeeName || seller.tradeName || seller.legalName } : null,
        bank: payments.methods.bankTransfer && seller.bank.accountNumber ? seller.bank : null,
        online: Boolean(payments.razorpay.enabled && payments.razorpay.keyId && payments.razorpay.keySecret),
        payee: seller.tradeName || seller.legalName || "DryCare",
      },
      invoices,
      claims,
    };
  });

  /** UPI QR with the payee and exact amount for a plan, so the shop cannot mistype either. */
  app.get("/commercial/billing/upi-qr", async (req, reply) => {
    requirePermission(req, "org.manage");
    const { planId } = z.object({ planId: z.uuid() }).parse(req.query);
    const [seller, payments, plan] = await Promise.all([
      getSellerBilling(db), getStoredPayments(db),
      db.query.commercialPlans.findFirst({ where: and(eq(schema.commercialPlans.id, planId), eq(schema.commercialPlans.published, true)) }),
    ]);
    if (!plan || !payments.methods.upi || !seller.upiId) throw notFound("UPI payment option");
    const amount = (planGross(plan, seller.invoice.gstRateBps) / 100).toFixed(2);
    const params = new URLSearchParams({ pa: seller.upiId, pn: seller.upiPayeeName || seller.tradeName || seller.legalName || "DryCare", am: amount, cu: "INR", tn: `DryCare ${plan.name}` });
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: `upi://pay?${params.toString()}`, scale: 3, eclevel: "M" } as Parameters<typeof bwipjs.toSVG>[0]);
    reply.header("content-type", "image/svg+xml").header("cache-control", "private, max-age=300");
    return svg;
  });

  app.post("/commercial/payment-claims", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const auth = requirePermission(req, "org.manage");
    const body = z.object({
      planId: z.uuid(),
      method: z.enum(["upi", "bank_transfer"]),
      reference: z.string().trim().min(6, "Enter the UTR / UPI transaction ID from your bank app").max(60),
      amountPaise: z.number().int().positive().max(2_000_000_000),
      paidOn: z.string().trim().max(20).optional(),
      note: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const plan = await db.query.commercialPlans.findFirst({ where: and(eq(schema.commercialPlans.id, body.planId), eq(schema.commercialPlans.published, true)) });
    if (!plan) throw notFound("Plan");
    const reference = body.reference.replace(/\s+/g, "").toUpperCase();
    const [dup] = await db.execute(sql`select 1 from commercial_payments where upper(regexp_replace(provider_reference, '\\s+', '', 'g')) = ${reference} and status in ('pending','paid','verified') limit 1`);
    if (dup) throw conflict("This transaction ID has already been reported or used.", "PAYMENT_REFERENCE_USED");
    const [claim] = await db.insert(schema.commercialPayments).values({
      organizationId: auth.orgId,
      provider: `claim_${body.method}`,
      providerReference: reference,
      amountPaise: body.amountPaise,
      status: "pending",
      providerPayload: { planId: plan.id, planName: plan.name, paidOn: body.paidOn, note: body.note, reportedBy: auth.userId },
    }).returning();
    await audit(db, req, { action: "subscription.payment_reported", resourceType: "commercial_payment", resourceId: claim.id, orgId: auth.orgId, after: { plan: plan.code, method: body.method, amountPaise: body.amountPaise } });
    reply.code(201);
    return { ok: true, id: claim.id };
  });

  app.post("/commercial/checkout/razorpay", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const auth = requirePermission(req, "org.manage");
    const { planId } = z.object({ planId: z.uuid() }).parse(req.body);
    const creds = await razorpayCredentials(db);
    if (!creds) throw new AppError(503, "ONLINE_PAYMENT_OFF", "Online payment is not available right now. Pay by UPI or bank transfer instead.");
    const plan = await db.query.commercialPlans.findFirst({ where: and(eq(schema.commercialPlans.id, planId), eq(schema.commercialPlans.published, true)) });
    if (!plan) throw notFound("Plan");
    const seller = await getSellerBilling(db);
    const amountPaise = planGross(plan, seller.invoice.gstRateBps);
    if (amountPaise <= 0) throw conflict("This plan has no price to pay.", "PLAN_FREE");
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    const order = await createRazorpayOrder(creds, {
      amountPaise, currency: plan.currency, receipt: `dc_${auth.orgId.slice(0, 8)}_${Date.now()}`,
      notes: { organizationId: auth.orgId, planId: plan.id, planCode: plan.code },
    }).catch((e: Error) => { throw new AppError(502, "RAZORPAY_ORDER_FAILED", `Could not start the payment: ${e.message}`); });
    return { keyId: creds.keyId, orderId: order.id, amountPaise, currency: plan.currency, planName: plan.name, businessName: seller.tradeName || seller.legalName || "DryCare", customerName: org?.name ?? "" };
  });

  app.post("/commercial/checkout/razorpay/verify", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const body = z.object({ orderId: z.string().min(5).max(60), paymentId: z.string().min(5).max(60), signature: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.body);
    const creds = await razorpayCredentials(db);
    if (!creds) throw new AppError(503, "ONLINE_PAYMENT_OFF", "Online payment is not configured.");
    if (!verifyCheckoutSignature(body.orderId, body.paymentId, body.signature, creds.keySecret)) {
      await audit(db, req, { action: "subscription.payment_signature_invalid", resourceType: "commercial_payment", orgId: auth.orgId, after: { orderId: body.orderId } });
      throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "The payment could not be verified. If money was taken, contact support with your payment ID.");
    }
    const result = await recordRazorpayPayment(req, creds, body.orderId, body.paymentId, auth.orgId);
    return { ok: true, alreadyRecorded: result.alreadyRecorded, invoiceId: result.invoiceId, endsAt: result.endsAt };
  });

  /** Razorpay webhook: records payments even if the shop closed the browser before the checkout callback. */
  await app.register(async (scope) => {
    // The signature covers the exact raw body, so keep it as a string here.
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post("/webhooks/razorpay", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
      const creds = await razorpayCredentials(db);
      const signature = String(req.headers["x-razorpay-signature"] ?? "");
      const raw = typeof req.body === "string" ? req.body : "";
      if (!creds?.webhookSecret || !signature || !verifyWebhookSignature(raw, signature, creds.webhookSecret)) {
        reply.code(401);
        return { ok: false };
      }
      const event = JSON.parse(raw) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string } }; order?: { entity?: { id: string } } } };
      const payment = event.payload?.payment?.entity;
      if (!["payment.captured", "order.paid"].includes(event.event) || !payment?.order_id) return { ok: true, ignored: event.event };
      try {
        const r = await recordRazorpayPayment(req, creds, payment.order_id, payment.id, null);
        return { ok: true, recorded: !r.alreadyRecorded };
      } catch (cause) {
        req.log.error({ err: cause, event: event.event, paymentId: payment.id }, "razorpay webhook could not be recorded");
        // 200 for permanent problems (wrong account etc.) so Razorpay stops retrying; they are in the log.
        return { ok: false, error: (cause as Error).message };
      }
    });
  });

  app.get("/commercial/invoices/:id", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const invoice = await db.query.commercialInvoices.findFirst({ where: and(eq(schema.commercialInvoices.id, id), eq(schema.commercialInvoices.organizationId, auth.orgId)) });
    if (!invoice) throw notFound("Invoice");
    return invoiceDetail(invoice);
  });
}

/**
 * Records a Razorpay payment once: checks with Razorpay that it was captured for this order, that the order belongs
 * to the shop and plan in its notes, then activates the plan and issues the invoice. Safe to call from both the
 * checkout callback and the webhook. expectedOrgId (checkout) must match the order's shop.
 */
async function recordRazorpayPayment(
  req: Parameters<typeof audit>[1],
  creds: NonNullable<Awaited<ReturnType<typeof razorpayCredentials>>>,
  orderId: string,
  paymentId: string,
  expectedOrgId: string | null,
) {
  const already = await db.query.commercialPayments.findFirst({ where: and(eq(schema.commercialPayments.provider, "razorpay"), eq(schema.commercialPayments.providerReference, paymentId)) });
  if (already) {
    const inv = await db.query.commercialInvoices.findFirst({ where: eq(schema.commercialInvoices.paymentId, already.id) });
    return { alreadyRecorded: true, invoiceId: inv?.id, endsAt: null };
  }
  const [payment, order] = await Promise.all([
    fetchRazorpayPayment(creds, paymentId).catch((e: Error) => { throw new AppError(502, "RAZORPAY_LOOKUP_FAILED", e.message); }),
    fetchRazorpayOrder(creds, orderId).catch((e: Error) => { throw new AppError(502, "RAZORPAY_LOOKUP_FAILED", e.message); }),
  ]);
  if (payment.order_id !== orderId || !["captured", "authorized"].includes(payment.status)) {
    throw new AppError(400, "PAYMENT_NOT_CAPTURED", `Payment status is ${payment.status}. The plan is not active yet.`);
  }
  const orgId = order.notes?.organizationId;
  if (!orgId || !order.notes?.planId || (expectedOrgId && orgId !== expectedOrgId)) throw new AppError(400, "PAYMENT_ORDER_MISMATCH", "This payment belongs to a different account.");
  if (payment.amount < order.amount) throw new AppError(400, "PAYMENT_AMOUNT_MISMATCH", "The amount paid does not match the order.");
  const plan = await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, order.notes.planId) });
  if (!plan) throw notFound("Plan");
  try {
    const applied = await db.transaction(async (tx) => {
      const r = await applySubscriptionPayment(tx, {
        organizationId: orgId, plan, provider: "razorpay", reference: paymentId, amountPaise: payment.amount,
        payload: { verificationMode: expectedOrgId ? "razorpay_checkout" : "razorpay_webhook", orderId, method: payment.method, mode: creds.mode },
      });
      await audit(tx, req, { action: "subscription.paid_online", resourceType: "commercial_payment", resourceId: r.payment.id, orgId, after: { plan: plan.code, amountPaise: payment.amount, invoice: r.invoice?.number } });
      return r;
    });
    return { alreadyRecorded: false, invoiceId: applied.invoice?.id, endsAt: applied.subscription.endsAt };
  } catch (cause) {
    // The callback and webhook can race; the unique (provider, reference) index lets exactly one win.
    if ((cause as { code?: string }).code === "23505") return { alreadyRecorded: true, invoiceId: undefined, endsAt: null };
    throw cause;
  }
}

async function invoiceDetail(invoice: typeof schema.commercialInvoices.$inferSelect) {
  const payment = await db.query.commercialPayments.findFirst({ where: eq(schema.commercialPayments.id, invoice.paymentId) });
  return { ...invoice, payment: payment ? { provider: payment.provider, reference: payment.providerReference, paidAt: payment.createdAt } : null };
}
