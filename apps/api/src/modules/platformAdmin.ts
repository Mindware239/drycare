import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { requirePlatformAdmin } from "../lib/context";
import { audit } from "../lib/audit";
import { conflict, notFound } from "../lib/errors";
import { env } from "../env";
import { getSellerBilling } from "../lib/platformSettings";
import { planGross } from "../lib/commercialInvoice";
import { applySubscriptionPayment } from "../lib/subscriptionPayments";
import { orgView } from "../lib/orgView";
import { emailConfigured } from "../lib/mailer";

const planUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  pricePaise: z.number().int().min(0).max(2_000_000_000).optional(),
  interval: z.enum(["month", "year"]).optional(),
  gstInclusive: z.boolean().optional(),
  trialEligible: z.boolean().optional(),
  deviceLimit: z.number().int().min(1).max(1000).optional(),
  branchLimit: z.number().int().min(1).max(1000).optional(),
  entitlements: z.record(z.string().max(80), z.boolean()).optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

export async function platformAdminRoutes(app: FastifyInstance) {
  app.get("/platform-admin/overview", async (req) => {
    requirePlatformAdmin(req);
    const [counts] = await db.execute<{
      organizations: number;
      trials: number;
      active: number;
      suspended: number;
      paidPaymentsPaise: number | string;
      paymentCount: number;
    }>(sql`
      select
        count(*)::int as organizations,
        count(*) filter (where status = 'trial')::int as trials,
        count(*) filter (where status = 'active')::int as active,
        count(*) filter (where status = 'suspended')::int as suspended,
        (select coalesce(sum(amount_paise), 0) from commercial_payments where status = 'paid') as "paidPaymentsPaise",
        (select count(*)::int from commercial_payments where status = 'paid') as "paymentCount"
      from organizations
      where settings_json->>'platformInternal' is distinct from 'true'
    `);
    return {
      organizations: counts.organizations,
      trials: counts.trials,
      active: counts.active,
      suspended: counts.suspended,
      verifiedManualPaymentsPaise: Number(counts.paidPaymentsPaise),
      verifiedManualPaymentCount: counts.paymentCount,
      paymentGateway: { configured: false, note: "No payment gateway has been configured. Only independently verified manual transfers may be recorded." },
      notifications: { emailConfigured: emailConfigured(), note: "Email delivery settings are managed through the API server environment." },
    };
  });

  app.get("/platform-admin/organizations", async (req) => {
    requirePlatformAdmin(req);
    const query = z.object({
      search: z.string().trim().max(120).default(""),
      status: z.enum(["all", "trial", "active", "suspended", "terminated"]).default("all"),
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(req.query);
    const statusFilter = query.status === "all" ? sql`` : sql`and o.status = ${query.status}`;
    const searchTerm = `%${query.search}%`;
    const searchFilter = query.search ? sql`and (
      o.name ilike ${searchTerm}
      or exists (
        select 1
        from organization_memberships sm
        join roles sr on sr.id = sm.role_id and sr.key = 'owner'
        join users su on su.id = sm.user_id
        where sm.organization_id = o.id and sm.status = 'active'
          and (su.name ilike ${searchTerm} or su.email ilike ${searchTerm})
      )
    )` : sql``;
    const filters = sql`o.settings_json->>'platformInternal' is distinct from 'true' ${statusFilter} ${searchFilter}`;
    const [count] = await db.execute<{ total: number }>(sql`
      select count(*)::int as total
      from organizations o
      where ${filters}
    `);
    const items = await db.execute(sql`
      select
        o.id,
        o.name,
        o.status,
        o.trial_started_at as "trialStartedAt",
        o.trial_ends_at as "trialEndsAt",
        o.created_at as "createdAt",
        owners.name as "ownerName",
        owners.email as "ownerEmail",
        latest.status as "subscriptionStatus",
        latest."planName" as "planName",
        latest."endsAt" as "subscriptionEndsAt"
      from organizations o
      left join lateral (
        select u.name, u.email
        from organization_memberships m
        join roles r on r.id = m.role_id and r.key = 'owner'
        join users u on u.id = m.user_id
        where m.organization_id = o.id and m.status = 'active'
        order by m.created_at asc
        limit 1
      ) owners on true
      left join lateral (
        select s.status, p.name as "planName", s.ends_at as "endsAt"
        from commercial_subscriptions s
        join commercial_plans p on p.id = s.plan_id
        where s.organization_id = o.id
        order by s.created_at desc
        limit 1
      ) latest on true
      where ${filters}
      order by o.created_at desc
      limit ${query.pageSize}
      offset ${(query.page - 1) * query.pageSize}
    `);
    return { items, total: count.total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/platform-admin/plans", async (req) => {
    requirePlatformAdmin(req);
    const plans = await db.query.commercialPlans.findMany({ orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise] });
    // Retired plans created by the automated acceptance suite are not business plans.
    const { invoice } = await getSellerBilling(db);
    return plans
      .filter((p) => !(/^(smoke|billtest)-/.test(p.code) && !p.published))
      .map((p) => ({ ...p, gstRateBps: invoice.gstRateBps, payablePaise: planGross(p, invoice.gstRateBps) }));
  });

  app.patch("/platform-admin/plans/:id", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = planUpdateSchema.parse(req.body);
    const before = await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, id) });
    if (!before) throw notFound("Plan");
    if (body.published && (body.pricePaise ?? before.pricePaise) === 0) {
      throw conflict("Set and approve the plan price before publishing it.", "PLAN_PRICE_REQUIRED");
    }
    const { entitlements, ...values } = body;
    const [after] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(schema.commercialPlans)
        .set({ ...values, ...(entitlements ? { entitlements } : {}), updatedAt: new Date() })
        .where(eq(schema.commercialPlans.id, id))
        .returning();
      await audit(tx, req, {
        action: "platform.plan_updated",
        resourceType: "commercial_plan",
        resourceId: id,
        actorUserId: auth.userId,
        before,
        after: updated,
      });
      return [updated];
    });
    return after;
  });

  app.post("/platform-admin/organizations/:id/extend-trial", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ days: z.number().int().min(1).max(90), reason: z.string().trim().min(8).max(500) }).parse(req.body);
    const before = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
    if (!before) throw notFound("Organization");
    if (before.status !== "trial") throw conflict("Only organizations currently in trial can have their trial extended.", "NOT_IN_TRIAL");
    const base = before.trialEndsAt && before.trialEndsAt > new Date() ? before.trialEndsAt : new Date();
    const [after] = await db.update(schema.organizations)
      .set({ trialEndsAt: new Date(base.getTime() + body.days * 86_400_000), updatedAt: new Date() })
      .where(eq(schema.organizations.id, id))
      .returning();
    await audit(db, req, {
      action: "platform.trial_extended",
      resourceType: "organization",
      resourceId: id,
      orgId: id,
      actorUserId: auth.userId,
      before: { trialEndsAt: before.trialEndsAt },
      after: { trialEndsAt: after.trialEndsAt, days: body.days, reason: body.reason },
    });
    return orgView(after);
  });

  app.post("/platform-admin/organizations/:id/status", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(8).max(500) }).parse(req.body);
    const before = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
    if (!before || before.settings.platformInternal) throw notFound("Customer organization");
    const [after] = await db.update(schema.organizations)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(schema.organizations.id, id))
      .returning();
    await audit(db, req, {
      action: body.status === "suspended" ? "platform.organization_suspended" : "platform.organization_reactivated",
      resourceType: "organization",
      resourceId: id,
      orgId: id,
      actorUserId: auth.userId,
      before: { status: before.status },
      after: { status: after.status, reason: body.reason },
    });
    return orgView(after);
  });

  app.post("/platform-admin/organizations/:id/verify-manual-payment", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { id: organizationId } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      planId: z.uuid(),
      method: z.enum(["upi", "bank_transfer", "cash"]),
      reference: z.string().trim().min(4).max(120),
      amountPaise: z.number().int().positive().max(2_000_000_000),
      reason: z.string().trim().min(8).max(500),
      /** The shop's own "I have paid" report being confirmed, if any. */
      claimId: z.uuid().optional(),
    }).parse(req.body);
    const organization = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, organizationId) });
    if (!organization || organization.settings.platformInternal) throw notFound("Customer organization");
    const plan = await db.query.commercialPlans.findFirst({
      where: and(eq(schema.commercialPlans.id, body.planId), eq(schema.commercialPlans.published, true)),
    });
    if (!plan) throw notFound("Published plan");
    const seller = await getSellerBilling(db);
    const due = planGross(plan, seller.invoice.gstRateBps);
    if (body.amountPaise < due) throw conflict(`The verified amount cannot be lower than the plan price including GST (₹${(due / 100).toFixed(2)}).`, "PAYMENT_AMOUNT_TOO_LOW");
    // A bank UTR / UPI reference identifies one incoming transfer; it can never pay for two things.
    const reference = body.reference.replace(/\s+/g, "").toUpperCase();
    const [duplicate] = await db.execute<{ organizationName: string; createdAt: string }>(sql`
      select o.name as "organizationName", p.created_at as "createdAt" from commercial_payments p
      join organizations o on o.id = p.organization_id
      where p.provider like 'manual_%' and upper(regexp_replace(p.provider_reference, '\\s+', '', 'g')) = ${reference}
      limit 1`);
    if (duplicate) throw conflict(`This transaction reference was already recorded for ${duplicate.organizationName}. Each UTR or UPI reference can be used only once.`, "PAYMENT_REFERENCE_USED");

    const result = await db.transaction(async (tx) => {
      if (body.claimId) {
        const [claim] = await tx.update(schema.commercialPayments).set({ status: "verified" })
          .where(and(eq(schema.commercialPayments.id, body.claimId), eq(schema.commercialPayments.organizationId, organizationId), eq(schema.commercialPayments.status, "pending")))
          .returning();
        if (!claim) throw conflict("This payment report was already handled.", "CLAIM_HANDLED");
      }
      const applied = await applySubscriptionPayment(tx, {
        organizationId,
        plan,
        provider: `manual_${body.method}`,
        reference: body.reference,
        amountPaise: body.amountPaise,
        payload: { verificationMode: "manual", verifiedBy: auth.userId, reason: body.reason, claimId: body.claimId },
      });
      await audit(tx, req, {
        action: "platform.manual_payment_verified",
        resourceType: "commercial_payment",
        resourceId: applied.payment.id,
        orgId: organizationId,
        actorUserId: auth.userId,
        after: { payment: applied.payment, subscription: applied.subscription, plan: plan.code, reason: body.reason, invoice: applied.invoice?.number },
      });
      return { payment: applied.payment, subscription: applied.subscription, organization: orgView(applied.organization), invoice: applied.invoice };
    });
    reply.code(201);
    return result;
  });

  app.get("/platform-admin/payments", async (req) => {
    requirePlatformAdmin(req);
    return db.execute(sql`
      select p.id, p.organization_id as "organizationId", o.name as "organizationName",
        p.subscription_id as "subscriptionId", p.provider, p.provider_reference as "reference",
        p.amount_paise as "amountPaise", p.currency, p.status, p.created_at as "createdAt",
        i.id as "invoiceId", i.number as "invoiceNumber"
      from commercial_payments p
      join organizations o on o.id = p.organization_id
      left join commercial_invoices i on i.payment_id = p.id
      where o.settings_json->>'platformInternal' is distinct from 'true' and p.provider not like 'claim_%'
      order by p.created_at desc
      limit 200
    `);
  });
}
