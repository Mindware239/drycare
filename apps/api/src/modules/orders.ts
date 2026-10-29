import type { FastifyInstance } from "fastify";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  cancelOrderSchema,
  customerApprovalConfirmationSchema,
  customerApprovalOtpRequestSchema,
  customerApprovalOtpVerifySchema,
  handoverSchema,
  orderCreateSchema,
  orderQuoteSchema,
  priceLine,
  sumLines,
  formatMoney,
  allowedTransitions,
  type GarmentStage,
} from "@drycare/shared";
import { db, schema, type DbOrTx, type Tx } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit, emit } from "../lib/audit";
import { AppError, badRequest, forbidden, notFound, unprocessable } from "../lib/errors";
import { nextNumber, pad } from "../lib/sequences";
import { withIdempotency } from "../lib/idempotency";
import { resolvePrice } from "./catalogue";
import { invoiceCreditSql, invoicePaidSql, invoiceTotals } from "../lib/balances";
import { recordGarmentTransition, refreshOrderStatus } from "../lib/orderStatus";
import { recordPayments } from "./payments";
import { linkPickupToOrder } from "./deliveries";
import { env } from "../env";
import { emailConfigured } from "../lib/mailer";

type QuoteInput = z.infer<typeof orderQuoteSchema>;

function customerApprovalOtpDigest(approvalId: string, otp: string) {
  if (!env.CUSTOMER_APPROVAL_SECRET) {
    throw new AppError(503, "APPROVAL_OTP_NOT_CONFIGURED", "Customer approval OTP requires CUSTOMER_APPROVAL_SECRET");
  }
  return createHmac("sha256", env.CUSTOMER_APPROVAL_SECRET).update(`${approvalId}:${otp}`).digest();
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "email address";
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`;
}

/** Server-side pricing (FR-CAT-007, SRS E01): the client never supplies authoritative prices. */
export async function buildQuote(tx: DbOrTx, auth: AuthContext, body: QuoteInput) {
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
  const settings = org!.settings ?? {};
  const maxDiscount = settings.maxDiscountBpsWithoutApproval ?? 1000;
  let discountBps = body.discountBps;
  let coupon: typeof schema.marketingCoupons.$inferSelect | undefined;
  if (body.couponCode) {
    if (body.discountBps > 0) throw badRequest("Remove the manual discount before applying a coupon");
    const [foundCoupon] = await tx.select().from(schema.marketingCoupons)
      .where(and(
        eq(schema.marketingCoupons.organizationId, auth.orgId),
        eq(schema.marketingCoupons.code, body.couponCode.toUpperCase()),
        eq(schema.marketingCoupons.status, "active"),
      ))
      .for("update");
    if (!foundCoupon) throw badRequest("Coupon code is invalid or inactive");
    const now = new Date();
    if (foundCoupon.startsAt > now || foundCoupon.expiresAt <= now) throw badRequest("Coupon is not currently valid");
    if (foundCoupon.firstOrderOnly) {
      const previousOrder = await tx.query.orders.findFirst({
        where: and(eq(schema.orders.organizationId, auth.orgId), eq(schema.orders.customerId, body.customerId), sql`${schema.orders.operationalStatus} <> 'cancelled'`),
      });
      if (previousOrder) throw badRequest("This coupon is only valid on a customer's first order");
    }
    const [redemptions] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(schema.marketingCouponRedemptions)
      .where(eq(schema.marketingCouponRedemptions.couponId, foundCoupon.id));
    if (foundCoupon.maxRedemptions !== null && redemptions.count >= foundCoupon.maxRedemptions) throw badRequest("This coupon has reached its redemption limit");
    const priorRedemption = await tx.query.marketingCouponRedemptions.findFirst({
      where: and(
        eq(schema.marketingCouponRedemptions.couponId, foundCoupon.id),
        eq(schema.marketingCouponRedemptions.customerId, body.customerId),
      ),
    });
    if (priorRedemption) throw badRequest("This coupon has already been used by this customer");
    coupon = foundCoupon;
    discountBps = foundCoupon.discountBps;
  }
  if (discountBps > maxDiscount && !can(auth, "discounts.approve")) {
    throw forbidden(`Discounts above ${maxDiscount / 100}% need manager approval`);
  }
  const surchargeBps = body.express ? (settings.expressSurchargeBps ?? 5000) : 0;

  const gtIds = [...new Set(body.items.map((i) => i.garmentTypeId))];
  const svcIds = [...new Set(body.items.map((i) => i.serviceId))];
  const [gts, svcs] = await Promise.all([
    tx.query.garmentTypes.findMany({ where: and(eq(schema.garmentTypes.organizationId, auth.orgId), inArray(schema.garmentTypes.id, gtIds)) }),
    tx.query.services.findMany({ where: and(eq(schema.services.organizationId, auth.orgId), inArray(schema.services.id, svcIds)) }),
  ]);

  const lines = [];
  for (const [idx, item] of body.items.entries()) {
    const gt = gts.find((g) => g.id === item.garmentTypeId);
    const svc = svcs.find((s) => s.id === item.serviceId);
    if (!gt || !svc || !gt.active || !svc.active) throw badRequest(`Item ${idx + 1}: unknown or inactive garment type / service`);
    const price = await resolvePrice(tx, auth.orgId, body.branchId, gt.id, svc.id);
    let unitPrice = price?.unitPrice;
    if (item.overrideUnitPrice !== undefined) {
      if (!can(auth, "prices.override")) throw forbidden("You cannot override prices");
      if (!item.overrideReason?.trim()) throw badRequest(`Item ${idx + 1}: a reason is required for a price override`);
      unitPrice = item.overrideUnitPrice;
    }
    if (unitPrice === undefined) throw unprocessable(`No price configured for ${gt.name} — ${svc.name}`, "PRICE_NOT_CONFIGURED");
    const calc = priceLine({
      unitPrice,
      quantity: item.quantity,
      surchargeBps,
      discountBps,
      discountFlat: item.discountFlat,
      taxBps: price?.taxBps ?? 0,
      minimumCharge: price?.minimumCharge,
    });
    lines.push({ item, gt, svc, price, unitPrice, calc });
  }
  const totals = sumLines(lines.map((l) => l.calc));
  if (coupon && totals.subtotal < coupon.minimumOrderValue) {
    throw badRequest(`This coupon requires a minimum order of ${formatMoney(coupon.minimumOrderValue)}`);
  }
  return { lines, totals, currency: org!.defaultCurrency, surchargeBps, coupon, discountBps };
}

export async function getOrderDetail(tx: DbOrTx, orgId: string, orderId: string) {
  const order = await tx.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, orgId)) });
  if (!order) throw notFound("Order");
  const [customer, branch, items, garments, invoice, coupon] = await Promise.all([
    tx.query.customers.findFirst({ where: eq(schema.customers.id, order.customerId) }),
    tx.query.branches.findFirst({ where: eq(schema.branches.id, order.branchId) }),
    tx.query.orderItems.findMany({ where: eq(schema.orderItems.orderId, order.id), orderBy: asc(schema.orderItems.createdAt) }),
    tx
      .select({
        id: schema.garments.id,
        tagCode: schema.garments.tagCode,
        tagVersion: schema.garments.tagVersion,
        orderItemId: schema.garments.orderItemId,
        currentStatus: schema.garments.currentStatus,
        workflowStages: schema.garments.workflowStages,
        storageLocation: schema.storageLocations.code,
        bagId: schema.garments.bagId,
        location: schema.garments.location,
        qcPassedAt: schema.garments.qcPassedAt,
        deliveredAt: schema.garments.deliveredAt,
        version: schema.garments.version,
      })
      .from(schema.garments)
      .leftJoin(schema.storageLocations, eq(schema.storageLocations.id, schema.garments.storageLocationId))
      .where(eq(schema.garments.orderId, order.id))
      .orderBy(asc(schema.garments.tagCode)),
    tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, order.id) }),
    order.couponId ? tx.query.marketingCoupons.findFirst({ where: and(eq(schema.marketingCoupons.id, order.couponId), eq(schema.marketingCoupons.organizationId, orgId)) }) : undefined,
  ]);
  const totals = invoice ? await invoiceTotals(tx, orgId, invoice.id) : undefined;
  const payments = invoice
    ? await tx.execute(sql`
        select p.id, p.payment_reference, p.payment_method, p.amount as payment_amount, pa.allocated_amount, p.status, p.received_at, p.provider_reference,
               u.name as collected_by,
               coalesce((select sum(r.amount) from refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0) as refunded
        from payment_allocations pa join payments p on p.id = pa.payment_id left join users u on u.id = p.created_by
        where pa.invoice_id = ${invoice.id} order by p.received_at`)
    : [];
  const refunds = invoice
    ? await tx.execute(sql`select r.id, r.amount, r.reason, r.method, r.created_at, u.name as approved_by from refunds r left join users u on u.id = r.approved_by where r.invoice_id = ${invoice.id} order by r.created_at`)
    : [];
  const history = await tx.execute(sql`
    select h.id, g.tag_code, h.previous_status, h.new_status, h.transition_kind, h.previous_location, h.new_location, h.notes, h.occurred_at, u.name as actor
    from garment_status_history h join garments g on g.id = h.garment_id left join users u on u.id = h.actor_user_id
    where g.order_id = ${order.id} order by h.occurred_at desc limit 300`);
  const approvals = await tx.execute(sql`
    select a.id, a.order_item_id as "orderItemId", a.approval_trigger as trigger, a.reason,
           a.additional_charge as "additionalCharge", a.status, a.method, a.customer_name as "customerName",
           a.notes, a.approved_at as "approvedAt", a.created_at as "createdAt",
           i.garment_type_name as "garmentTypeName", i.service_name as "serviceName",
           witness.name as "witnessName"
    from customer_approvals a
    join order_items i on i.id = a.order_item_id
    left join users witness on witness.id = a.witnessed_by
    where a.organization_id = ${orgId} and a.order_id = ${order.id}
    order by a.created_at, a.id`);
  const [bags, creditNotes, printJobs, exceptions] = await Promise.all([
    tx.execute(sql`
      select b.id, b.bag_code as "bagCode", b.expected_count as "expectedCount", b.location, b.label_print_count as "labelPrintCount", b.created_at as "createdAt",
             (select count(*)::int from garments g where g.bag_id = b.id and g.current_status <> 'cancelled') as "garmentCount"
      from bags b where b.order_id = ${order.id} order by b.bag_code`),
    invoice
      ? tx.execute(sql`
          select cn.id, cn.credit_note_number as "creditNoteNumber", cn.discount_type as "discountType", cn.discount_value as "discountValue",
                 cn.taxable_amount as "taxableAmount", cn.tax_amount as "taxAmount", cn.total_amount as "totalAmount", cn.reason, cn.status,
                 cn.created_at as "createdAt", u.name as "createdByName", a.name as "approvedByName"
          from credit_notes cn left join users u on u.id = cn.created_by left join users a on a.id = cn.approved_by
          where cn.invoice_id = ${invoice.id} order by cn.created_at`)
      : [],
    tx.execute(sql`
      select j.id, j.scope, j.label_count as "labelCount", j.status, j.error, j.created_at as "createdAt", j.confirmed_at as "confirmedAt", u.name as "requestedByName"
      from label_print_jobs j left join users u on u.id = j.requested_by where j.order_id = ${order.id} order by j.created_at desc limit 20`),
    tx.execute(sql`
      select e.id, e.kind, e.notes, e.status, e.resolution, e.created_at as "createdAt", e.resolved_at as "resolvedAt", g.tag_code as "tagCode", e.garment_id as "garmentId",
             tb.batch_number as "batchNumber"
      from garment_exceptions e join garments g on g.id = e.garment_id left join transfer_batches tb on tb.id = e.batch_id
      where e.order_id = ${order.id} order by e.created_at desc`),
  ]);
  return {
    ...order,
    customer: customer && { id: customer.id, name: customer.name, phone: customer.phone, customerCode: customer.customerCode, email: customer.email },
    branch: branch && { id: branch.id, name: branch.name, code: branch.branchCode, phone: branch.phone, address: branch.address },
    coupon: coupon && { code: coupon.code, discountBps: coupon.discountBps },
    items,
    garments,
    invoice: invoice && { ...invoice, paid: totals?.paid ?? 0, credits: totals?.credits ?? 0, payable: totals?.payable ?? invoice.grandTotal, balance: totals?.balance ?? 0 },
    bags,
    creditNotes,
    printJobs,
    exceptions,
    payments,
    refunds,
    history,
    approvals,
  };
}

async function loadOrderForUpdate(tx: Tx, auth: AuthContext, orderId: string) {
  const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId))).for("update");
  if (!order) throw notFound("Order");
  assertBranchAccess(auth, order.branchId);
  return order;
}

export async function orderRoutes(app: FastifyInstance) {
  app.post("/orders/quote", async (req) => {
    const auth = requirePermission(req, "orders.create");
    const body = orderQuoteSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const q = await buildQuote(db, auth, body);
    return {
      currency: q.currency,
      surchargeBps: q.surchargeBps,
      couponCode: q.coupon?.code ?? null,
      discountBps: q.discountBps,
      approvalsRequired: q.lines.reduce((count, line) => count + Number(line.item.specialCareApprovalRequired) + Number(
        line.item.overrideUnitPrice !== undefined && line.price && line.item.overrideUnitPrice > line.price.unitPrice,
      ), 0),
      totals: q.totals,
      lines: q.lines.map((l) => ({ garmentType: l.gt.name, service: l.svc.name, quantity: l.item.quantity, unitPrice: l.unitPrice, listUnitPrice: l.price?.unitPrice ?? null, taxBps: l.price?.taxBps ?? 0, ...l.calc })),
    };
  });

  // FR-ORD-001..006, SRS §8.1 — one transaction creates order, items, garments, tags, invoice and advance payment.
  app.post("/orders", async (req, reply) => {
    const auth = requirePermission(req, "orders.create");
    const body = orderCreateSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    if (new Date(body.promisedAt).getTime() < Date.now() - 60_000) throw badRequest("Promised date must be in the future");

    return withIdempotency(req, reply, auth.orgId, "POST /orders", async (tx) => {
      const [customer, branch] = await Promise.all([
        tx.query.customers.findFirst({ where: and(eq(schema.customers.id, body.customerId), eq(schema.customers.organizationId, auth.orgId)) }),
        tx.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) }),
      ]);
      if (!customer || customer.status !== "active") throw badRequest("Customer not found or inactive");
      if (!branch || branch.status !== "active") throw badRequest("Branch not found or inactive");

      const quote = await buildQuote(tx, auth, body);
      const approvalCount = quote.lines.reduce((count, line) => count + Number(line.item.specialCareApprovalRequired) + Number(
        line.item.overrideUnitPrice !== undefined && line.price && line.item.overrideUnitPrice > line.price.unitPrice,
      ), 0);
      if (approvalCount > 0 && body.payments.length > 0) {
        throw unprocessable("Collect payment after all customer approval holds are resolved", "CUSTOMER_APPROVAL_REQUIRED");
      }
      const year = new Date().getFullYear();
      const seq = await nextNumber(tx, auth.orgId, `order:${branch.branchCode}:${year}`);
      const orderNumber = `${branch.branchCode}-${year}-${pad(seq)}`;

      const [order] = await tx
        .insert(schema.orders)
        .values({
          organizationId: auth.orgId,
          branchId: branch.id,
          customerId: customer.id,
          orderNumber,
          orderSource: body.pickupId ? "pickup" : body.orderSource,
          deliveryMethod: body.deliveryMethod,
          express: body.express,
          promisedAt: new Date(body.promisedAt),
          discountBps: quote.discountBps,
          couponId: quote.coupon?.id ?? null,
          ...quote.totals,
          currency: quote.currency,
          notes: body.notes,
          createdBy: auth.userId,
        })
        .returning();

      // One bag per order at intake; it is labelled with the order number so staff can match it by eye.
      const [bag] = await tx
        .insert(schema.bags)
        .values({ organizationId: auth.orgId, branchId: branch.id, orderId: order.id, bagCode: `${orderNumber}-B1`, expectedCount: 0, createdBy: auth.userId })
        .returning();

      let tagIndex = 0;
      const invoiceLines: (typeof schema.invoiceItems.$inferInsert)[] = [];
      for (const l of quote.lines) {
        const [oi] = await tx
          .insert(schema.orderItems)
          .values({
            organizationId: auth.orgId,
            orderId: order.id,
            garmentTypeId: l.gt.id,
            serviceId: l.svc.id,
            servicePriceId: l.price?.servicePriceId,
            garmentTypeName: l.gt.name,
            serviceName: l.svc.name,
            quantity: l.item.quantity,
            unitPrice: l.unitPrice,
            listUnitPrice: l.price?.unitPrice ?? 0,
            overrideReason: l.item.overrideUnitPrice !== undefined ? l.item.overrideReason : null,
            surchargeAmount: l.calc.surcharge,
            discountAmount: l.calc.discount,
            taxBps: l.price?.taxBps ?? 0,
            taxAmount: l.calc.tax,
            lineTotal: l.calc.total,
            colour: l.item.colour,
            brand: l.item.brand,
            fabric: l.item.fabric,
            conditionNotes: l.item.conditionNotes,
            conditionFlags: l.item.conditionFlags,
            careInstructions: l.item.careInstructions,
          })
          .returning();

        // FR-GAR-001: one tag per physical article. Weight/package services are tracked as one bag.
        const pieces = l.svc.unitType === "per_kg" || l.svc.unitType === "per_package" ? 1 : l.item.quantity;
        const garmentRows = Array.from({ length: pieces }, () => {
          tagIndex += 1;
          return {
            organizationId: auth.orgId,
            orderId: order.id,
            orderItemId: oi.id,
            tagCode: `${orderNumber}-${String(tagIndex).padStart(2, "0")}`,
            garmentTypeId: l.gt.id,
            serviceId: l.svc.id,
            workflowStages: l.svc.workflowStages,
            currentStatus: "received",
            currentBranchId: branch.id,
            bagId: bag.id,
            location: "shop_counter",
          };
        });
        const inserted = await tx.insert(schema.garments).values(garmentRows).returning({ id: schema.garments.id });
        await tx.insert(schema.garmentStatusHistory).values(
          inserted.map((g) => ({ organizationId: auth.orgId, garmentId: g.id, previousStatus: null, newStatus: "received", transitionKind: "intake", newLocation: "shop_counter", actorUserId: auth.userId, branchId: branch.id, correlationId: req.id })),
        );

        const approvalRows: (typeof schema.customerApprovals.$inferInsert)[] = [];
        if (l.item.overrideUnitPrice !== undefined && l.price && l.item.overrideUnitPrice > l.price.unitPrice) {
          approvalRows.push({
            organizationId: auth.orgId,
            orderId: order.id,
            orderItemId: oi.id,
            trigger: "additional_charge",
            reason: l.item.overrideReason?.trim() || "Manual price above published catalogue price",
            additionalCharge: (l.item.overrideUnitPrice - l.price.unitPrice) * l.item.quantity,
            createdBy: auth.userId,
          });
        }
        if (l.item.specialCareApprovalRequired) {
          approvalRows.push({
            organizationId: auth.orgId,
            orderId: order.id,
            orderItemId: oi.id,
            trigger: "special_care",
            reason: l.item.specialCareReason!,
            createdBy: auth.userId,
          });
        }
        if (approvalRows.length) {
          const createdApprovals = await tx.insert(schema.customerApprovals).values(approvalRows).returning();
          for (const approval of createdApprovals) {
            await audit(tx, req, {
              action: "customer_approval.requested",
              resourceType: "customer_approval",
              resourceId: approval.id,
              after: { orderId: order.id, orderItemId: oi.id, trigger: approval.trigger, reason: approval.reason, additionalCharge: approval.additionalCharge },
            });
          }
        }

        invoiceLines.push({
          organizationId: auth.orgId,
          invoiceId: "",
          orderItemId: oi.id,
          descriptionSnapshot: `${l.gt.name} — ${l.svc.name}`,
          quantity: l.item.quantity,
          unitPrice: l.unitPrice,
          surchargeAmount: l.calc.surcharge,
          discountAmount: l.calc.discount,
          taxRateBpsSnapshot: l.price?.taxBps ?? 0,
          taxAmount: l.calc.tax,
          lineTotal: l.calc.total,
        });
      }

      await tx.update(schema.bags).set({ expectedCount: tagIndex }).where(eq(schema.bags.id, bag.id));

      const invSeq = await nextNumber(tx, auth.orgId, `invoice:${year}`);
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
      const [invoice] = await tx
        .insert(schema.invoices)
        .values({
          organizationId: auth.orgId,
          branchId: branch.id,
          customerId: customer.id,
          orderId: order.id,
          invoiceNumber: `INV/${year}/${pad(invSeq, 6)}`,
          currency: quote.currency,
          ...quote.totals,
          sellerGstin: org?.gstin,
          dueAt: new Date(body.promisedAt),
        })
        .returning();
      await tx.insert(schema.invoiceItems).values(invoiceLines.map((l) => ({ ...l, invoiceId: invoice.id })));
      if (quote.coupon) {
        await tx.insert(schema.marketingCouponRedemptions).values({
          organizationId: auth.orgId,
          couponId: quote.coupon.id,
          customerId: customer.id,
          orderId: order.id,
        });
      }

      if (body.payments.length) {
        await recordPayments(tx, req, auth, { invoiceId: invoice.id, branchId: branch.id, customerId: customer.id, payments: body.payments, balance: invoice.grandTotal });
      }

      if (body.pickupId) await linkPickupToOrder(tx, auth, body.pickupId, order.id, customer.id);
      await emit(tx, auth.orgId, "order.booked", { orderId: order.id, customerId: customer.id });
      await audit(tx, req, { action: "order.created", resourceType: "order", resourceId: order.id, after: { orderNumber, grandTotal: order.grandTotal, garments: tagIndex } });
      return { status: 201, body: await getOrderDetail(tx, auth.orgId, order.id) };
    });
  });

  app.get("/orders", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z
      .object({
        q: z.string().trim().max(80).optional(),
        status: z.string().optional(),
        branchId: z.uuid().optional(),
        view: z.enum(["all", "open", "ready", "overdue", "unpaid"]).default("all"),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchScope = auth.branchIds.length ? sql`and o.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const term = q.q ? `%${q.q}%` : null;
    const digits = q.q?.replace(/\D/g, "") ?? "";
    const rows = await db.execute(sql`
      select * from (
        select o.id, o.order_number, o.operational_status, o.received_at, o.promised_at, o.grand_total, o.express, o.currency,
               c.name as customer_name, c.phone as customer_phone, b.branch_code,
               (select count(*)::int from garments g where g.order_id = o.id) as garment_count,
               coalesce((select ${invoicePaidSql} from invoices i where i.order_id = o.id and i.status <> 'cancelled'), 0) as paid,
               coalesce((select i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql} from invoices i where i.order_id = o.id and i.status <> 'cancelled'), 0) as balance
        from orders o join customers c on c.id = o.customer_id join branches b on b.id = o.branch_id
        where o.organization_id = ${auth.orgId} ${branchScope}
          ${q.branchId ? sql`and o.branch_id = ${q.branchId}` : sql``}
          ${q.status ? sql`and o.operational_status = ${q.status}` : sql``}
          ${term ? sql`and (o.order_number ilike ${term} or c.name ilike ${term} ${digits.length >= 3 ? sql`or c.phone_normalized like ${"%" + digits + "%"}` : sql``})` : sql``}
          ${q.view === "open" ? sql`and o.operational_status not in ('delivered','cancelled')` : sql``}
          ${q.view === "ready" ? sql`and o.operational_status in ('ready','partially_ready')` : sql``}
          ${q.view === "overdue" ? sql`and o.promised_at < now() and o.operational_status in ('received','in_processing','partially_ready')` : sql``}
      ) x
      ${q.view === "unpaid" ? sql`where x.balance > 0` : sql``}
      order by x.received_at desc
      limit ${q.limit} offset ${q.offset}
    `);
    return { items: rows, limit: q.limit, offset: q.offset };
  });

  app.get("/orders/:orderId", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const detail = await getOrderDetail(db, auth.orgId, orderId);
    assertBranchAccess(auth, detail.branchId);
    return {
      ...detail,
      garments: detail.garments.map((g) => ({
        ...g,
        allowed: allowedTransitions(g.workflowStages as GarmentStage[], g.currentStatus as GarmentStage).filter((t) => !t.permission || can(auth, t.permission)),
      })),
    };
  });

  app.post("/orders/:orderId/approvals/:approvalId/confirm", async (req) => {
    const auth = requirePermission(req, "orders.edit");
    const { orderId, approvalId } = z.object({ orderId: z.uuid(), approvalId: z.uuid() }).parse(req.params);
    const body = customerApprovalConfirmationSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const order = await loadOrderForUpdate(tx, auth, orderId);
      const [approval] = await tx.select().from(schema.customerApprovals)
        .where(and(
          eq(schema.customerApprovals.id, approvalId),
          eq(schema.customerApprovals.organizationId, auth.orgId),
          eq(schema.customerApprovals.orderId, order.id),
        ))
        .for("update");
      if (!approval) throw notFound("Customer approval");
      if (approval.status !== "pending") throw unprocessable("This customer approval has already been resolved", "APPROVAL_ALREADY_RESOLVED");

      await tx.update(schema.customerApprovals)
        .set({
          status: "approved",
          method: body.method,
          customerName: body.customerName,
          witnessedBy: auth.userId,
          notes: body.notes,
          otpHash: null,
          otpExpiresAt: null,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.customerApprovals.id, approval.id));
      await audit(tx, req, {
        action: "customer_approval.approved",
        resourceType: "customer_approval",
        resourceId: approval.id,
        before: { status: approval.status },
        after: { status: "approved", method: body.method, customerName: body.customerName, witnessedBy: auth.userId, notes: body.notes },
      });
      return getOrderDetail(tx, auth.orgId, order.id);
    });
  });

  app.post(
    "/orders/:orderId/approvals/:approvalId/request-otp",
    { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } },
    async (req) => {
      const auth = requirePermission(req, "orders.edit");
      const { orderId, approvalId } = z.object({ orderId: z.uuid(), approvalId: z.uuid() }).parse(req.params);
      const body = customerApprovalOtpRequestSchema.parse(req.body);
      if (body.channel === "sms") {
        throw new AppError(503, "SMS_PROVIDER_NOT_CONFIGURED", "SMS approval OTP is unavailable until an SMS provider is configured");
      }
      if (!emailConfigured()) {
        throw new AppError(503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Email approval OTP requires email (SMTP or Resend) to be set up");
      }

      return db.transaction(async (tx) => {
        const order = await loadOrderForUpdate(tx, auth, orderId);
        const [customer] = await tx.select().from(schema.customers)
          .where(and(eq(schema.customers.id, order.customerId), eq(schema.customers.organizationId, auth.orgId)));
        if (!customer?.email) throw unprocessable("Add an email address to the customer profile before using email OTP", "CUSTOMER_EMAIL_REQUIRED");
        const [approval] = await tx.select().from(schema.customerApprovals)
          .where(and(
            eq(schema.customerApprovals.id, approvalId),
            eq(schema.customerApprovals.organizationId, auth.orgId),
            eq(schema.customerApprovals.orderId, order.id),
          ))
          .for("update");
        if (!approval) throw notFound("Customer approval");
        if (approval.status !== "pending") throw unprocessable("This customer approval has already been resolved", "APPROVAL_ALREADY_RESOLVED");
        if (!env.CUSTOMER_APPROVAL_SECRET) {
          throw new AppError(503, "APPROVAL_OTP_NOT_CONFIGURED", "Email approval OTP requires CUSTOMER_APPROVAL_SECRET");
        }

        const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const expiresAt = new Date(Date.now() + 10 * 60_000);
        const digest = customerApprovalOtpDigest(approval.id, otp).toString("hex");
        await tx.update(schema.customerApprovals)
          .set({ otpHash: digest, otpExpiresAt: expiresAt, otpAttempts: 0, updatedAt: new Date() })
          .where(eq(schema.customerApprovals.id, approval.id));
        await emit(tx, auth.orgId, "customer.approval_otp", {
          orderId: order.id,
          customerId: customer.id,
          approvalId: approval.id,
          otp,
          reason: approval.reason,
        });
        await audit(tx, req, {
          action: "customer_approval.otp_requested",
          resourceType: "customer_approval",
          resourceId: approval.id,
          after: { channel: body.channel, expiresAt },
        });
        return { status: "queued", destination: maskEmail(customer.email), expiresAt };
      });
    },
  );

  app.post(
    "/orders/:orderId/approvals/:approvalId/verify-otp",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const auth = requirePermission(req, "orders.edit");
      const { orderId, approvalId } = z.object({ orderId: z.uuid(), approvalId: z.uuid() }).parse(req.params);
      const body = customerApprovalOtpVerifySchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        const order = await loadOrderForUpdate(tx, auth, orderId);
        const [approval] = await tx.select().from(schema.customerApprovals)
          .where(and(
            eq(schema.customerApprovals.id, approvalId),
            eq(schema.customerApprovals.organizationId, auth.orgId),
            eq(schema.customerApprovals.orderId, order.id),
          ))
          .for("update");
        if (!approval) throw notFound("Customer approval");
        if (approval.status !== "pending") throw unprocessable("This customer approval has already been resolved", "APPROVAL_ALREADY_RESOLVED");
        if (!approval.otpHash || !approval.otpExpiresAt || approval.otpExpiresAt <= new Date()) {
          await tx.update(schema.customerApprovals)
            .set({ otpHash: null, otpExpiresAt: null, updatedAt: new Date() })
            .where(eq(schema.customerApprovals.id, approval.id));
          return { error: "OTP_EXPIRED" as const };
        }
        if (approval.otpAttempts >= 5) return { error: "OTP_ATTEMPTS_EXCEEDED" as const };

        const expected = customerApprovalOtpDigest(approval.id, body.otp);
        const saved = Buffer.from(approval.otpHash, "hex");
        if (saved.length !== expected.length || !timingSafeEqual(saved, expected)) {
          await tx.update(schema.customerApprovals)
            .set({ otpAttempts: approval.otpAttempts + 1, updatedAt: new Date() })
            .where(eq(schema.customerApprovals.id, approval.id));
          await audit(tx, req, {
            action: "customer_approval.otp_rejected",
            resourceType: "customer_approval",
            resourceId: approval.id,
            after: { attempts: approval.otpAttempts + 1 },
          });
          return { error: "OTP_MISMATCH" as const };
        }

        await tx.update(schema.customerApprovals)
          .set({
            status: "approved",
            method: "email_otp",
            customerName: body.customerName,
            witnessedBy: auth.userId,
            notes: "Customer OTP verified by staff",
            otpHash: null,
            otpExpiresAt: null,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.customerApprovals.id, approval.id));
        await audit(tx, req, {
          action: "customer_approval.approved",
          resourceType: "customer_approval",
          resourceId: approval.id,
          before: { status: approval.status },
          after: { status: "approved", method: "email_otp", customerName: body.customerName, witnessedBy: auth.userId },
        });
        return { orderId: order.id };
      });
      if ("error" in result) {
        if (result.error === "OTP_EXPIRED") throw unprocessable("The OTP expired. Request a new code.", result.error);
        if (result.error === "OTP_ATTEMPTS_EXCEEDED") throw unprocessable("Too many incorrect OTP attempts. Request a new code.", result.error);
        throw unprocessable("The OTP did not match.", result.error);
      }
      return getOrderDetail(db, auth.orgId, result.orderId);
    },
  );

  app.patch("/orders/:orderId", async (req) => {
    const auth = requirePermission(req, "orders.edit");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const body = z.object({ promisedAt: z.iso.datetime().optional(), notes: z.string().max(2000).optional(), version: z.number().int() }).parse(req.body);
    return db.transaction(async (tx) => {
      const order = await loadOrderForUpdate(tx, auth, orderId);
      if (order.version !== body.version) throw unprocessable("This order was changed by someone else. Reload and try again.", "STALE_VERSION");
      const [after] = await tx
        .update(schema.orders)
        .set({ promisedAt: body.promisedAt ? new Date(body.promisedAt) : undefined, notes: body.notes, version: order.version + 1, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning();
      if (body.promisedAt && order.promisedAt.toISOString() !== after.promisedAt.toISOString()) {
        await emit(tx, auth.orgId, "order.delayed", { orderId, customerId: order.customerId, promisedAt: after.promisedAt });
      }
      await audit(tx, req, { action: "order.updated", resourceType: "order", resourceId: orderId, before: { promisedAt: order.promisedAt, notes: order.notes }, after: { promisedAt: after.promisedAt, notes: after.notes } });
      return after;
    });
  });

  // FR-ORD-008: cancellation follows permission + financial rules; paid amounts must be refunded explicitly.
  app.post("/orders/:orderId/cancel", async (req) => {
    const auth = requirePermission(req, "orders.cancel");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const body = cancelOrderSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const order = await loadOrderForUpdate(tx, auth, orderId);
      if (order.operationalStatus === "cancelled") throw unprocessable("Order is already cancelled");
      const gs = await tx.select().from(schema.garments).where(eq(schema.garments.orderId, orderId));
      if (gs.some((g) => g.currentStatus === "delivered" || g.currentStatus === "dispatched")) {
        throw unprocessable("Garments from this order have already been dispatched or delivered", "CANNOT_CANCEL");
      }
      for (const g of gs) await recordGarmentTransition(tx, g, "cancelled", "cancel", auth.userId, { notes: body.reason, correlationId: req.id });
      await tx.update(schema.orders).set({ operationalStatus: "cancelled", cancelledAt: new Date(), cancelReason: body.reason, updatedAt: new Date(), version: order.version + 1 }).where(eq(schema.orders.id, orderId));
      await tx.update(schema.invoices).set({ status: "cancelled" }).where(eq(schema.invoices.orderId, orderId));
      await audit(tx, req, { action: "order.cancelled", resourceType: "order", resourceId: orderId, before: { status: order.operationalStatus }, after: { status: "cancelled", reason: body.reason } });
      return getOrderDetail(tx, auth.orgId, orderId);
    });
  });

  /**
   * Counter handover (SRS §8.5, FR-WF-009): only garments that reached "ready" (which, for QC
   * workflows, required a passed inspection) can be delivered. Balance rules are enforced here.
   */
  app.post("/orders/:orderId/handover", async (req) => {
    const auth = requirePermission(req, "orders.read", "garments.process");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const body = handoverSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const order = await loadOrderForUpdate(tx, auth, orderId);
      const gs = await tx.select().from(schema.garments).where(and(eq(schema.garments.orderId, orderId), inArray(schema.garments.id, body.garmentIds)));
      if (gs.length !== body.garmentIds.length) throw badRequest("Some garments do not belong to this order");
      const [pendingApproval] = await tx.select({ id: schema.customerApprovals.id })
        .from(schema.customerApprovals)
        .where(and(eq(schema.customerApprovals.organizationId, auth.orgId), eq(schema.customerApprovals.orderId, orderId), eq(schema.customerApprovals.status, "pending")))
        .limit(1);
      if (pendingApproval) throw unprocessable("Customer approval is required before handover", "CUSTOMER_APPROVAL_REQUIRED");
      // Garments out with a delivery agent are completed through the delivery, not at the counter.
      const notReady = gs.filter((g) => g.currentStatus !== "ready");
      if (notReady.length) throw unprocessable(`Not ready for handover: ${notReady.map((g) => g.tagCode).join(", ")}`, "NOT_READY");
      const qcMissing = gs.filter((g) => g.workflowStages.includes("quality_control") && !g.qcPassedAt);
      if (qcMissing.length) throw unprocessable(`Quality approval missing: ${qcMissing.map((g) => g.tagCode).join(", ")}`, "QC_REQUIRED");

      const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, orderId) });
      const totals = invoice ? await invoiceTotals(tx, auth.orgId, invoice.id) : undefined;
      if (totals && totals.balance > 0) {
        if (!body.allowWithBalance) throw unprocessable(`Outstanding balance must be collected before handover`, "BALANCE_DUE");
        if (!can(auth, "orders.release_with_due")) throw forbidden("You cannot release garments with an outstanding balance");
      }
      for (const g of gs) {
        const ok = await recordGarmentTransition(tx, g, "delivered", "deliver", auth.userId, {
          notes: [body.method !== "counter" ? `Confirmed by ${body.method}` : null, body.notes].filter(Boolean).join(" · ") || undefined,
          correlationId: req.id,
          set: { deliveredAt: new Date(), storageLocationId: null, location: "collected" },
        });
        if (!ok) throw unprocessable(`Garment ${g.tagCode} was updated by someone else`, "STALE_VERSION");
      }
      const status = await refreshOrderStatus(tx, auth.orgId, orderId);
      await audit(tx, req, {
        action: "order.handover",
        resourceType: "order",
        resourceId: orderId,
        after: { garments: gs.map((g) => g.tagCode), status, balanceAtHandover: totals?.balance ?? 0, releasedWithBalance: (totals?.balance ?? 0) > 0 },
      });
      return getOrderDetail(tx, auth.orgId, order.id);
    });
  });

  // FR-ORD-010 / FR-GAR-006: reprinting changes nothing financial; replacement bumps tag version, identity unchanged.
  app.post("/orders/:orderId/labels/reprint", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const body = z.object({ garmentIds: z.array(z.uuid()).optional(), replace: z.boolean().default(false) }).parse(req.body ?? {});
    await db.transaction(async (tx) => {
      await loadOrderForUpdate(tx, auth, orderId);
      if (body.replace && body.garmentIds?.length) {
        await tx
          .update(schema.garments)
          .set({ tagVersion: sql`${schema.garments.tagVersion} + 1` })
          .where(and(eq(schema.garments.orderId, orderId), inArray(schema.garments.id, body.garmentIds)));
      }
      await audit(tx, req, { action: body.replace ? "label.replaced" : "label.reprinted", resourceType: "order", resourceId: orderId, after: { garmentIds: body.garmentIds ?? "all" } });
    });
    return { ok: true };
  });
}
