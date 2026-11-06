import { zone } from "../lib/region";
/**
 * Memberships a shop sells to its own customers: plans, selling and renewing at the counter, and cancelling.
 * The fee is real money received now, so it is recorded like a wallet top-up and counts in collections and the drawer.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { splitInclusiveTax } from "@drycare/shared";
import { db, schema } from "../db/client";
import { nextNumber, pad } from "../lib/sequences";
import { audit, emit } from "../lib/audit";
import { assertBranchAccess, can, requirePermission } from "../lib/context";
import { badRequest, conflict, notFound } from "../lib/errors";
import { currentMembership } from "../lib/memberships";
import { openShiftFor, paymentRef } from "./payments";

const planBody = z.object({
  name: z.string().trim().min(2, "Enter a plan name").max(60),
  description: z.string().trim().max(300).nullable().optional(),
  price: z.number().int().min(0).max(100_000_000),
  /** GST included in the price. */
  taxBps: z.number().int().min(0).max(2800).optional(),
  durationDays: z.number().int().min(1, "A membership must last at least 1 day").max(3650),
  discountBps: z.number().int().min(1, "Enter a discount above 0%").max(10000, "The discount cannot be above 100%"),
  freeExpress: z.boolean().optional(),
  perks: z.array(z.string().trim().min(1).max(80, "Keep each benefit under 80 characters")).max(8, "A plan can list up to 8 benefits").optional(),
  active: z.boolean().optional(),
});

const DAY = 86_400_000;
/** The Indian financial year in the invoice number, e.g. 2627 for April 2026 to March 2027. */
function financialYear(now: Date) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

export async function membershipRoutes(app: FastifyInstance) {
  app.get("/membership-plans", async (req) => {
    const auth = requirePermission(req, "customers.read");
    return db.query.customerMembershipPlans.findMany({ where: eq(schema.customerMembershipPlans.organizationId, auth.orgId), orderBy: [desc(schema.customerMembershipPlans.active), schema.customerMembershipPlans.price] });
  });

  app.post("/membership-plans", async (req, reply) => {
    const auth = requirePermission(req, "catalogue.manage");
    const body = planBody.parse(req.body);
    const [plan] = await db.insert(schema.customerMembershipPlans).values({ ...body, organizationId: auth.orgId }).returning();
    await audit(db, req, { action: "membership.plan_created", resourceType: "customer_membership_plan", resourceId: plan.id, after: plan });
    reply.code(201);
    return plan;
  });

  app.patch("/membership-plans/:id", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = planBody.partial().parse(req.body);
    const where = and(eq(schema.customerMembershipPlans.id, id), eq(schema.customerMembershipPlans.organizationId, auth.orgId));
    const before = await db.query.customerMembershipPlans.findFirst({ where });
    if (!before) throw notFound("Membership plan");
    const [plan] = await db.update(schema.customerMembershipPlans).set({ ...body, updatedAt: new Date() }).where(where).returning();
    await audit(db, req, { action: "membership.plan_updated", resourceType: "customer_membership_plan", resourceId: id, before, after: plan });
    return plan;
  });

  /** The numbers at the top of the Memberships screen. Money only for those allowed to see it. */
  app.get("/customer-memberships/summary", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const monthStart = sql`date_trunc('month', now() at time zone ${zone(auth.timezone)}) at time zone ${zone(auth.timezone)}`;
    const [members] = await db.execute<{ current: number; expiring: number }>(sql`
      select count(*) filter (where status = 'active' and ends_at > now() and starts_at <= now())::int as current,
             count(*) filter (where status = 'active' and ends_at > now() and ends_at <= now() + interval '15 days')::int as expiring
      from customer_memberships where organization_id = ${auth.orgId}`);
    if (!can(auth, "reports.financial")) return { ...members, sales: null, salesCount: null, discountGiven: null };
    const [[sold], [discounts]] = await Promise.all([
      db.execute<{ sales: string; count: number }>(sql`select coalesce(sum(price_paid), 0) as sales, count(*)::int as count from customer_memberships where organization_id = ${auth.orgId} and created_at >= ${monthStart}`),
      db.execute<{ discount: string }>(sql`select coalesce(sum(discount_total), 0) as discount from orders where organization_id = ${auth.orgId} and customer_membership_id is not null and operational_status <> 'cancelled' and received_at >= ${monthStart}`),
    ]);
    return { ...members, sales: Number(sold.sales), salesCount: sold.count, discountGiven: Number(discounts.discount) };
  });

  /** Everyone who has bought a membership, newest first. */
  app.get("/customer-memberships", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const query = z.object({ state: z.enum(["all", "current", "expiring", "expired", "cancelled"]).default("current"), search: z.string().trim().max(80).default("") }).parse(req.query);
    const m = schema.customerMemberships;
    const now = new Date();
    const soon = new Date(now.getTime() + 15 * DAY);
    const state = {
      all: undefined,
      current: and(eq(m.status, "active"), gt(m.endsAt, now)),
      expiring: and(eq(m.status, "active"), gt(m.endsAt, now), sql`${m.endsAt} <= ${soon.toISOString()}::timestamptz`),
      expired: and(eq(m.status, "active"), sql`${m.endsAt} <= ${now.toISOString()}::timestamptz`),
      cancelled: eq(m.status, "cancelled"),
    }[query.state];
    const term = `%${query.search}%`;
    return db.select({
      id: m.id, customerId: m.customerId, planName: m.planName, discountBps: m.discountBps, pricePaid: m.pricePaid, startsAt: m.startsAt, endsAt: m.endsAt, status: m.status,
      customerName: schema.customers.name, customerPhone: schema.customers.phone,
    }).from(m).innerJoin(schema.customers, eq(schema.customers.id, m.customerId))
      .where(and(eq(m.organizationId, auth.orgId), state, query.search ? or(ilike(schema.customers.name, term), ilike(schema.customers.phone, term)) : undefined))
      .orderBy(desc(m.createdAt)).limit(200);
  });

  app.get("/customers/:id/memberships", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const m = schema.customerMemberships;
    const history = await db.select({
      id: m.id, planId: m.planId, planName: m.planName, discountBps: m.discountBps, freeExpress: m.freeExpress, perks: m.perks, pricePaid: m.pricePaid, invoiceNumber: m.invoiceNumber, startsAt: m.startsAt, endsAt: m.endsAt, status: m.status, cancelReason: m.cancelReason,
      method: schema.payments.paymentMethod, reference: schema.payments.providerReference,
    }).from(m).leftJoin(schema.payments, eq(schema.payments.id, m.paymentId))
      .where(and(eq(m.customerId, id), eq(m.organizationId, auth.orgId))).orderBy(desc(m.endsAt)).limit(100);
    return { current: await currentMembership(db, auth.orgId, id) ?? null, history };
  });

  /** Everything the printed invoice or receipt needs. */
  app.get("/customer-memberships/:id/invoice", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const membership = await db.query.customerMemberships.findFirst({ where: and(eq(schema.customerMemberships.id, id), eq(schema.customerMemberships.organizationId, auth.orgId)) });
    if (!membership) throw notFound("Membership");
    const [customer, branch, payment] = await Promise.all([
      db.query.customers.findFirst({ where: eq(schema.customers.id, membership.customerId), columns: { name: true, phone: true, email: true, gstin: true } }),
      membership.branchId ? db.query.branches.findFirst({ where: eq(schema.branches.id, membership.branchId), columns: { name: true, phone: true, address: true } }) : undefined,
      membership.paymentId ? db.query.payments.findFirst({ where: eq(schema.payments.id, membership.paymentId), columns: { paymentMethod: true, providerReference: true } }) : undefined,
    ]);
    return { ...membership, customer, branch: branch ?? null, payment: payment ?? null };
  });

  app.post("/customers/:id/memberships", async (req, reply) => {
    const auth = requirePermission(req, "payments.collect");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      planId: z.uuid(),
      branchId: z.uuid(),
      method: z.enum(["cash", "upi", "card", "bank_transfer"]).optional(),
      reference: z.string().trim().max(80).optional(),
    }).parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const result = await db.transaction(async (tx) => {
      // Locked so two counters cannot sell this customer two memberships at once.
      const [customer] = await tx.select().from(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.organizationId, auth.orgId))).for("update");
      if (!customer) throw notFound("Customer");
      if (customer.status !== "active") throw badRequest("This customer is not active");
      const plan = await tx.query.customerMembershipPlans.findFirst({ where: and(eq(schema.customerMembershipPlans.id, body.planId), eq(schema.customerMembershipPlans.organizationId, auth.orgId)) });
      if (!plan) throw notFound("Membership plan");
      if (!plan.active) throw conflict("This membership plan is no longer on sale.", "MEMBERSHIP_PLAN_INACTIVE");
      const branch = await tx.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!branch) throw notFound("Branch");
      if (plan.price > 0) {
        if (!body.method) throw badRequest("Choose how the customer paid");
        if (body.method !== "cash" && !body.reference) throw badRequest(`A transaction reference is required for ${body.method.toUpperCase()} payments`);
      }

      const now = new Date();
      const latest = await tx.query.customerMemberships.findFirst({
        where: and(eq(schema.customerMemberships.customerId, id), eq(schema.customerMemberships.status, "active"), gt(schema.customerMemberships.endsAt, now)),
        orderBy: [desc(schema.customerMemberships.endsAt)],
      });
      if (latest && latest.planId !== plan.id) throw conflict(`This customer already has ${latest.planName} until ${latest.endsAt.toISOString().slice(0, 10)}. Cancel it before selling a different plan.`, "MEMBERSHIP_ACTIVE");
      // Renewing early adds on to the end date, so the customer never loses days they paid for.
      const startsAt = latest ? latest.endsAt : now;
      const endsAt = new Date(startsAt.getTime() + plan.durationDays * DAY);

      // A shop with no GSTIN cannot collect GST, whatever rate the plan was set up with.
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { gstin: true } });
      const taxBps = org?.gstin ? plan.taxBps : 0;
      let paymentId: string | null = null;
      let invoiceNumber: string | null = null;
      if (plan.price > 0) {
        // A GST invoice number can have at most 16 characters, and runs in one unbroken series per financial year.
        // Branch codes can be 8 characters, so one short series covers the whole shop.
        const year = financialYear(now);
        const seq = await nextNumber(tx, auth.orgId, `membership:${year}`);
        invoiceNumber = `M${year}-${pad(seq, 6)}`;
        const shift = await openShiftFor(tx, auth, body.branchId);
        const [payment] = await tx.insert(schema.payments).values({
          organizationId: auth.orgId, branchId: body.branchId, customerId: id, paymentReference: paymentRef(), paymentMethod: body.method!,
          amount: plan.price, providerReference: body.reference || null, status: "succeeded", shiftId: shift?.id, createdBy: auth.userId,
        }).returning();
        paymentId = payment.id;
        await emit(tx, auth.orgId, "payment.received", { paymentId: payment.id, customerId: id, amount: plan.price, method: body.method });
      }
      const [membership] = await tx.insert(schema.customerMemberships).values({
        organizationId: auth.orgId, customerId: id, planId: plan.id, branchId: body.branchId, planName: plan.name, discountBps: plan.discountBps, freeExpress: plan.freeExpress, perks: plan.perks,
        pricePaid: plan.price, taxBps, taxAmount: splitInclusiveTax(plan.price, taxBps).tax, invoiceNumber, paymentId, startsAt, endsAt, createdBy: auth.userId,
      }).returning();
      await emit(tx, auth.orgId, "membership.sold", { customerId: id, planName: plan.name, discountBps: plan.discountBps, freeExpress: plan.freeExpress, perks: plan.perks, endsAt: endsAt.toISOString() });
      await audit(tx, req, { action: latest ? "membership.renewed" : "membership.sold", resourceType: "customer", resourceId: id, after: { plan: plan.name, price: plan.price, method: body.method, startsAt, endsAt } });
      return membership;
    });
    reply.code(201);
    return result;
  });

  /** Ends a membership. Any refund is a separate decision for the shop, so no money moves here. */
  app.post("/customer-memberships/:id/cancel", async (req) => {
    const auth = requirePermission(req, "payments.refund");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(8, "Give a reason (at least 8 characters)").max(300) }).parse(req.body);
    const where = and(eq(schema.customerMemberships.id, id), eq(schema.customerMemberships.organizationId, auth.orgId), eq(schema.customerMemberships.status, "active"));
    return db.transaction(async (tx) => {
      const now = new Date();
      const [membership] = await tx.update(schema.customerMemberships).set({ status: "cancelled", cancelledAt: now, cancelReason: reason, updatedAt: now }).where(where).returning();
      if (!membership) throw conflict("This membership is not active.", "MEMBERSHIP_NOT_ACTIVE");
      await audit(tx, req, { action: "membership.cancelled", resourceType: "customer", resourceId: membership.customerId, after: { plan: membership.planName, reason } });
      return membership;
    });
  });
}
