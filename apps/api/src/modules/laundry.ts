import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import bwipjs from "bwip-js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_LAUNDRY_SERVICES, LAUNDRY_MACHINE_TYPES, LAUNDRY_PRICING_METHODS, LaundryPricingError, PAYMENT_METHODS, paymentInput, quoteLaundry,
  type LaundryPricingMethod, type LaundryRule,
} from "@drycare/shared";
import { db, schema, type Tx } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors";
import { nextNumber, pad } from "../lib/sequences";
import { withIdempotency } from "../lib/idempotency";
import { adapterFor, MACHINE_CONTROL_MODES } from "../lib/machineControl";
import { openShiftFor, paymentRef } from "./payments";
import { walletEntry } from "../lib/wallet";

const uuid = z.uuid();
const money = z.number().int().min(0).max(100_000_000);

// ------------------------------------------------------------------ helpers

/** Paid = succeeded payments allocated to the order − succeeded refunds. Pending bank transfers never count. */
async function orderPaid(tx: Tx | typeof db, orderId: string) {
  const [r] = await tx.execute<{ paid: string; pending: string; refunded: string }>(sql`
    select
      coalesce((select sum(pa.allocated_amount) from payment_allocations pa join payments p on p.id = pa.payment_id where pa.laundry_order_id = ${orderId} and p.status = 'succeeded'), 0) as paid,
      coalesce((select sum(pa.allocated_amount) from payment_allocations pa join payments p on p.id = pa.payment_id where pa.laundry_order_id = ${orderId} and p.status = 'pending'), 0) as pending,
      coalesce((select sum(r.amount) from refunds r where r.laundry_order_id = ${orderId} and r.status = 'succeeded'), 0) as refunded`);
  const paid = Number(r.paid) - Number(r.refunded);
  return { paid, pending: Number(r.pending), refunded: Number(r.refunded) };
}

/** Rule for a service + method at a branch: a branch-specific override wins over the store-wide rule. */
async function ruleFor(tx: Tx | typeof db, orgId: string, serviceId: string, method: LaundryPricingMethod, branchId: string) {
  const rows = await tx.select().from(schema.laundryPricingRules).where(and(
    eq(schema.laundryPricingRules.organizationId, orgId), eq(schema.laundryPricingRules.serviceId, serviceId), eq(schema.laundryPricingRules.method, method),
    sql`(${schema.laundryPricingRules.branchId} = ${branchId} or ${schema.laundryPricingRules.branchId} is null)`,
  ));
  return rows.sort((a, b) => Number(Boolean(b.branchId)) - Number(Boolean(a.branchId)))[0];
}

const quoteBody = z.object({
  branchId: uuid,
  serviceId: uuid,
  method: z.enum(LAUNDRY_PRICING_METHODS),
  weightGrams: z.number().int().min(1).max(200_000).optional(),
  units: z.number().int().min(1).max(600).optional(),
  items: z.array(z.object({ itemRateId: uuid, quantity: z.number().int().min(0).max(500) })).max(100).optional(),
  discount: z.union([z.object({ type: z.literal("percent"), bps: z.number().int().min(1).max(10_000) }), z.object({ type: z.literal("fixed"), amount: z.number().int().min(1) })]).optional(),
  discountReason: z.string().trim().max(200).optional(),
});
type QuoteBody = z.infer<typeof quoteBody>;

/** Authoritative server-side price. Never trusts a client total. */
async function buildQuote(tx: Tx | typeof db, auth: AuthContext, body: QuoteBody) {
  assertBranchAccess(auth, body.branchId);
  const service = await tx.query.laundryServices.findFirst({ where: and(eq(schema.laundryServices.id, body.serviceId), eq(schema.laundryServices.organizationId, auth.orgId)) });
  if (!service || !service.active) throw badRequest("This service is not available");
  const rule = await ruleFor(tx, auth.orgId, service.id, body.method, body.branchId);
  if (!rule || !rule.enabled) throw badRequest(`${service.name} is not offered ${body.method === "weight" ? "by weight" : body.method === "item" ? "by item" : `by ${body.method}`}`);
  let items: { name: string; unitPrice: number; quantity: number }[] | undefined;
  if (body.method === "item") {
    const ids = (body.items ?? []).filter((i) => i.quantity > 0).map((i) => i.itemRateId);
    const rates = ids.length ? await tx.select().from(schema.laundryItemRates).where(and(eq(schema.laundryItemRates.serviceId, service.id), inArray(schema.laundryItemRates.id, ids), eq(schema.laundryItemRates.active, true))) : [];
    if (rates.length !== new Set(ids).size) throw badRequest("Some items are not available for this service");
    items = (body.items ?? []).filter((i) => i.quantity > 0).map((i) => { const r = rates.find((x) => x.id === i.itemRateId)!; return { name: r.name, unitPrice: r.unitPrice, quantity: i.quantity }; });
  }
  if (body.discount) {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { settings: true } });
    const limit = org?.settings.maxDiscountBpsWithoutApproval ?? 1000;
    if (body.discount.type === "percent" && body.discount.bps > limit && !can(auth, "discounts.approve")) throw forbidden(`Discounts above ${limit / 100}% need a manager`);
    if (!body.discountReason) throw badRequest("Give a reason for the discount");
  }
  const laundryRule: LaundryRule = { method: rule.method as LaundryPricingMethod, unitPrice: rule.unitPrice, minWeightGrams: rule.minWeightGrams, weightIncrementGrams: rule.weightIncrementGrams, minMinutes: rule.minMinutes, minimumCharge: rule.minimumCharge, packageLabel: rule.packageLabel };
  try {
    const q = quoteLaundry(laundryRule, { weightGrams: body.weightGrams, units: body.units, items, discount: body.discount, taxBps: service.taxBps });
    if (body.discount?.type === "fixed" && !can(auth, "discounts.approve")) {
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { settings: true } });
      const limit = org?.settings.maxDiscountBpsWithoutApproval ?? 1000;
      if (q.discount * 10_000 > q.subtotal * limit) throw forbidden(`Discounts above ${limit / 100}% need a manager`);
    }
    return { service, rule, quote: q };
  } catch (e) {
    if (e instanceof LaundryPricingError) throw badRequest(e.message);
    throw e;
  }
}

/** One shared "walk-in" customer record per store for guests, so the payment ledger stays linked to a customer. */
async function walkInCustomer(tx: Tx, orgId: string) {
  const existing = await tx.query.customers.findFirst({ where: and(eq(schema.customers.organizationId, orgId), eq(schema.customers.customerType, "self_service_guest")) });
  if (existing) return existing;
  const n = await nextNumber(tx, orgId, "customer");
  const [c] = await tx.insert(schema.customers).values({ organizationId: orgId, customerCode: `C-${pad(n)}`, name: "Self-service walk-in", customerType: "self_service_guest", notificationChannel: "none" }).returning();
  return c;
}

/** Reserves a machine for an order. The partial unique index on active sessions makes double booking impossible. */
async function reserveMachine(tx: Tx, auth: AuthContext, order: { id: string; branchId: string; weightGrams: number | null; units: number | null; pricingMethod: string }, serviceTypes: string[], machineId: string, programId?: string) {
  const [machine] = await tx.select().from(schema.laundryMachines).where(and(eq(schema.laundryMachines.id, machineId), eq(schema.laundryMachines.organizationId, auth.orgId))).for("update");
  if (!machine || !machine.active) throw notFound("Machine");
  if (machine.branchId !== order.branchId) throw badRequest("This machine is at another store");
  if (!serviceTypes.includes(machine.machineType)) throw unprocessable(`${machine.name} cannot be used for this service`, "MACHINE_INCOMPATIBLE");
  if (machine.status !== "available") throw conflict(`${machine.name} is ${machine.status.replaceAll("_", " ")}`, "MACHINE_UNAVAILABLE");
  if (machine.capacityGrams && order.weightGrams && order.weightGrams > machine.capacityGrams) {
    throw unprocessable(`The load (${order.weightGrams / 1000} kg) is more than ${machine.name}'s ${machine.capacityGrams / 1000} kg capacity. Split it across two machines.`, "OVER_CAPACITY");
  }
  let program: typeof schema.laundryPrograms.$inferSelect | undefined;
  if (programId) {
    program = await tx.query.laundryPrograms.findFirst({ where: and(eq(schema.laundryPrograms.id, programId), eq(schema.laundryPrograms.machineId, machine.id), eq(schema.laundryPrograms.active, true)) });
    if (!program) throw badRequest("Choose a program this machine supports");
  }
  const duration = order.pricingMethod === "time" && order.units ? order.units : program?.durationMinutes ?? 45;
  try {
    const [session] = await tx.insert(schema.laundrySessions).values({
      organizationId: auth.orgId, orderId: order.id, machineId: machine.id, programId: program?.id, programName: program?.name ?? null, durationMinutes: duration, statusSource: "staff",
    }).returning();
    await tx.update(schema.laundryMachines).set({ status: "reserved", version: sql`${schema.laundryMachines.version} + 1`, updatedAt: new Date() }).where(eq(schema.laundryMachines.id, machine.id));
    return session;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw conflict(`${machine.name} was just booked by someone else`, "MACHINE_UNAVAILABLE");
    throw e;
  }
}

async function recordLaundryPayments(tx: Tx, req: Parameters<typeof audit>[1], auth: AuthContext, order: { id: string; branchId: string; customerId: string; total: number }, payments: z.infer<typeof paymentInput>[]) {
  if (!payments.length) return;
  const { paid, pending } = await orderPaid(tx, order.id);
  const due = order.total - paid - pending;
  const total = payments.reduce((s, p) => s + p.amount, 0);
  if (total > due) throw unprocessable(due <= 0 ? "Nothing is due on this order" : "Payment exceeds the amount due", "OVERPAYMENT");
  const shift = await openShiftFor(tx, auth, order.branchId);
  for (const p of payments) {
    if (p.method !== "cash" && p.method !== "wallet" && p.method !== "store_credit" && !p.reference?.trim()) throw badRequest(`A transaction reference is required for ${p.method.toUpperCase()} payments`);
    if (p.method === "store_credit" && p.awaitingVerification) throw badRequest("Wallet payments are settled immediately");
    if (p.awaitingVerification && p.method !== "bank_transfer") throw badRequest("Only bank transfers can be recorded as awaiting verification");
    const [row] = await tx.insert(schema.payments).values({
      organizationId: auth.orgId, branchId: order.branchId, customerId: order.customerId, paymentReference: paymentRef(), paymentMethod: p.method, amount: p.amount,
      providerReference: p.reference?.trim() || null, status: p.awaitingVerification ? "pending" : "succeeded", shiftId: shift?.id ?? null, createdBy: auth.userId,
    }).returning();
    await tx.insert(schema.paymentAllocations).values({ organizationId: auth.orgId, paymentId: row.id, laundryOrderId: order.id, allocatedAmount: p.amount });
    if (p.method === "store_credit") await walletEntry(tx, { orgId: auth.orgId, customerId: order.customerId, branchId: order.branchId, kind: "spend", amount: -p.amount, paymentId: row.id, note: "Paid a self-service order", userId: auth.userId });
    await audit(tx, req, { action: "laundry.payment_recorded", resourceType: "payment", resourceId: row.id, after: { orderId: order.id, amount: p.amount, method: p.method, status: row.status } });
  }
  await syncPaidStatus(tx, order.id);
}

/** pending_payment ⇄ paid follows the ledger; later stages are not moved backwards. */
async function syncPaidStatus(tx: Tx, orderId: string) {
  const order = await tx.query.laundryOrders.findFirst({ where: eq(schema.laundryOrders.id, orderId) });
  if (!order) return;
  const { paid } = await orderPaid(tx, orderId);
  if (order.status === "pending_payment" && paid >= order.total) {
    await tx.update(schema.laundryOrders).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(eq(schema.laundryOrders.id, orderId));
  }
}

async function orderDetail(tx: Tx | typeof db, orgId: string, orderId: string) {
  const order = await tx.query.laundryOrders.findFirst({ where: and(eq(schema.laundryOrders.id, orderId), eq(schema.laundryOrders.organizationId, orgId)) });
  if (!order) throw notFound("Self-service order");
  const [items, sessions, payments, refunds, totals, customer, branch] = await Promise.all([
    tx.select().from(schema.laundryOrderItems).where(eq(schema.laundryOrderItems.orderId, orderId)),
    tx.execute(sql`
      select s.*, m.name as machine_name, m.code as machine_code, m.machine_type, m.control_mode
      from laundry_sessions s join laundry_machines m on m.id = s.machine_id where s.order_id = ${orderId} order by s.created_at`),
    tx.execute(sql`
      select p.id, p.payment_method, p.amount, pa.allocated_amount, p.status, p.provider_reference, p.received_at, u.name as collected_by
      from payment_allocations pa join payments p on p.id = pa.payment_id left join users u on u.id = p.created_by
      where pa.laundry_order_id = ${orderId} order by p.received_at`),
    tx.execute(sql`select r.id, r.amount, r.reason, r.method, r.created_at from refunds r where r.laundry_order_id = ${orderId} order by r.created_at`),
    orderPaid(tx, orderId),
    tx.query.customers.findFirst({ where: eq(schema.customers.id, order.customerId), columns: { id: true, name: true, phone: true, customerCode: true, customerType: true } }),
    tx.query.branches.findFirst({ where: eq(schema.branches.id, order.branchId), columns: { id: true, name: true, branchCode: true, phone: true, address: true } }),
  ]);
  return { ...order, items, sessions, payments, refunds, ...totals, balance: order.status === "cancelled" ? 0 : Math.max(0, order.total - totals.paid), customer, branch };
}

const machineBody = z.object({
  branchId: uuid,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, "Use up to 12 letters, digits or hyphens"),
  name: z.string().trim().min(2).max(60),
  machineType: z.enum(LAUNDRY_MACHINE_TYPES),
  capacityKg: z.number().min(0).max(200).optional(),
  controlMode: z.enum(MACHINE_CONTROL_MODES as [string, ...string[]]).default("manual"),
  adapterConfig: z.object({ baseUrl: z.url().max(300).optional(), deviceId: z.string().trim().max(80).optional() }).default({}),
  notes: z.string().trim().max(500).optional(),
  programs: z.array(z.object({ name: z.string().trim().min(2).max(40), durationMinutes: z.number().int().min(1).max(600) })).max(12).optional(),
});

/** Installs the starter services and prices a store does not have yet (by code). Machines are added by the store. */
export async function installLaundryDefaults(tx: Tx, orgId: string) {
  const existing = await tx.select({ code: schema.laundryServices.code }).from(schema.laundryServices).where(eq(schema.laundryServices.organizationId, orgId));
  let added = 0;
  for (const [i, def] of DEFAULT_LAUNDRY_SERVICES.entries()) {
    if (existing.some((e) => e.code === def.code)) continue;
    const [svc] = await tx.insert(schema.laundryServices).values({ organizationId: orgId, code: def.code, name: def.name, machineTypes: def.machineTypes, sortOrder: i }).returning();
    for (const [method, r] of Object.entries(def.rules)) {
      await tx.insert(schema.laundryPricingRules).values({
        organizationId: orgId, serviceId: svc.id, method, unitPrice: r.unitPrice, minWeightGrams: r.minWeightGrams ?? 0,
        weightIncrementGrams: r.weightIncrementGrams ?? 100, minMinutes: r.minMinutes ?? 0, minimumCharge: r.minimumCharge ?? 0, packageLabel: r.packageLabel ?? null,
      });
    }
    if (def.items?.length) await tx.insert(schema.laundryItemRates).values(def.items.map(([name, price], n) => ({ organizationId: orgId, serviceId: svc.id, name, unitPrice: price, sortOrder: n })));
    added++;
  }
  return { added };
}

// ------------------------------------------------------------------ routes

export async function laundryRoutes(app: FastifyInstance) {
  // ---------- configuration
  app.get("/laundry/config", async (req) => {
    const auth = requirePermission(req, "laundry.view");
    const { branchId } = z.object({ branchId: uuid }).parse(req.query);
    assertBranchAccess(auth, branchId);
    const [services, rules, items, machines, programs, sessions] = await Promise.all([
      db.select().from(schema.laundryServices).where(eq(schema.laundryServices.organizationId, auth.orgId)).orderBy(asc(schema.laundryServices.sortOrder), asc(schema.laundryServices.name)),
      db.select().from(schema.laundryPricingRules).where(and(eq(schema.laundryPricingRules.organizationId, auth.orgId), sql`(${schema.laundryPricingRules.branchId} = ${branchId} or ${schema.laundryPricingRules.branchId} is null)`)),
      db.select().from(schema.laundryItemRates).where(eq(schema.laundryItemRates.organizationId, auth.orgId)).orderBy(asc(schema.laundryItemRates.sortOrder), asc(schema.laundryItemRates.name)),
      db.select().from(schema.laundryMachines).where(and(eq(schema.laundryMachines.organizationId, auth.orgId), eq(schema.laundryMachines.branchId, branchId))).orderBy(asc(schema.laundryMachines.machineType), asc(schema.laundryMachines.code)),
      db.select().from(schema.laundryPrograms).where(eq(schema.laundryPrograms.organizationId, auth.orgId)),
      db.execute(sql`
        select s.id, s.machine_id as "machineId", s.status, s.status_source as "statusSource", s.started_at as "startedAt", s.expected_end_at as "expectedEndAt",
               s.program_name as "programName", s.error, o.id as "orderId", o.order_number as "orderNumber",
               coalesce(o.guest_name, c.name) as "customerName"
        from laundry_sessions s join laundry_orders o on o.id = s.order_id join customers c on c.id = o.customer_id
        where s.organization_id = ${auth.orgId} and s.status in ('reserved', 'running')`),
    ]);
    return {
      services: services.map((s) => ({
        ...s,
        // A branch-specific rule overrides the store-wide one for the same method.
        rules: LAUNDRY_PRICING_METHODS.map((m) => rules.filter((r) => r.serviceId === s.id && r.method === m).sort((a, b) => Number(Boolean(b.branchId)) - Number(Boolean(a.branchId)))[0]).filter(Boolean),
        items: items.filter((i) => i.serviceId === s.id),
      })),
      machines: machines.map(({ adapterConfig, ...m }) => ({
        ...m, adapterConfig: can(auth, "laundry.manage") ? adapterConfig : {},
        programs: programs.filter((p) => p.machineId === m.id),
        session: (sessions as unknown as { machineId: string }[]).find((s) => s.machineId === m.id) ?? null,
      })),
      controlModes: MACHINE_CONTROL_MODES,
    };
  });

  /** One-click starter configuration (services + pricing) for stores that have none yet. Machines are added by the store. */
  app.post("/laundry/setup-defaults", async (req) => {
    const auth = requirePermission(req, "laundry.manage");
    return db.transaction(async (tx) => {
      const result = await installLaundryDefaults(tx, auth.orgId);
      await audit(tx, req, { action: "laundry.defaults_installed", resourceType: "laundry_service", after: result });
      return result;
    });
  });

  /** Who changed which self-service price, when, from what to what (from the audit log). */
  app.get("/laundry/price-history", async (req) => {
    const auth = requirePermission(req, "laundry.view");
    return db.execute(sql`
      select a.id, a.action, a.created_at as "createdAt", a.before_json as before, a.after_json as after, u.name as "changedBy",
             s.name as "serviceName"
      from audit_logs a
      left join users u on u.id = a.actor_user_id
      left join laundry_pricing_rules r on a.action = 'laundry.pricing_updated' and r.id::text = a.resource_id
      left join laundry_services s on s.id = coalesce(r.service_id, case when a.action in ('laundry.items_updated', 'laundry.service_updated') then a.resource_id::uuid end)
      where a.organization_id = ${auth.orgId}
        and a.action in ('laundry.pricing_updated', 'laundry.items_updated', 'laundry.service_updated', 'laundry.defaults_installed')
      order by a.created_at desc limit 100`);
  });

  app.post("/laundry/services", async (req, reply) => {
    const auth = requirePermission(req, "laundry.manage");
    const body = z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,10}$/),
      name: z.string().trim().min(2).max(60),
      machineTypes: z.array(z.enum(LAUNDRY_MACHINE_TYPES)).min(1).max(3),
      taxBps: z.number().int().min(0).max(2800).default(1800),
    }).parse(req.body);
    const [row] = await db.insert(schema.laundryServices).values({ organizationId: auth.orgId, ...body }).returning();
    await audit(db, req, { action: "laundry.service_created", resourceType: "laundry_service", resourceId: row.id, after: row });
    reply.code(201);
    return row;
  });

  app.patch("/laundry/services/:id", async (req) => {
    const auth = requirePermission(req, "laundry.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({
      name: z.string().trim().min(2).max(60).optional(),
      machineTypes: z.array(z.enum(LAUNDRY_MACHINE_TYPES)).min(1).max(3).optional(),
      taxBps: z.number().int().min(0).max(2800).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const before = await db.query.laundryServices.findFirst({ where: and(eq(schema.laundryServices.id, id), eq(schema.laundryServices.organizationId, auth.orgId)) });
    if (!before) throw notFound("Service");
    const [after] = await db.update(schema.laundryServices).set({ ...body, updatedAt: new Date() }).where(eq(schema.laundryServices.id, id)).returning();
    await audit(db, req, { action: "laundry.service_updated", resourceType: "laundry_service", resourceId: id, before, after });
    return after;
  });

  app.put("/laundry/services/:id/rules/:method", async (req) => {
    const auth = requirePermission(req, "laundry.manage");
    const { id, method } = z.object({ id: uuid, method: z.enum(LAUNDRY_PRICING_METHODS) }).parse(req.params);
    const body = z.object({
      branchId: uuid.nullable().default(null),
      enabled: z.boolean(),
      unitPrice: money,
      minWeightGrams: z.number().int().min(0).max(100_000).default(0),
      weightIncrementGrams: z.number().int().min(1).max(10_000).default(100),
      minMinutes: z.number().int().min(0).max(600).default(0),
      minimumCharge: money.default(0),
      packageLabel: z.string().trim().max(80).nullable().optional(),
    }).parse(req.body);
    if (body.branchId) assertBranchAccess(auth, body.branchId);
    if (body.enabled && method !== "item" && body.unitPrice <= 0) throw badRequest("Set a price above ₹0 before enabling this pricing method");
    const service = await db.query.laundryServices.findFirst({ where: and(eq(schema.laundryServices.id, id), eq(schema.laundryServices.organizationId, auth.orgId)) });
    if (!service) throw notFound("Service");
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.laundryPricingRules).where(and(
        eq(schema.laundryPricingRules.serviceId, id), eq(schema.laundryPricingRules.method, method),
        body.branchId ? eq(schema.laundryPricingRules.branchId, body.branchId) : sql`${schema.laundryPricingRules.branchId} is null`,
      )).for("update");
      const values = { enabled: body.enabled, unitPrice: body.unitPrice, minWeightGrams: body.minWeightGrams, weightIncrementGrams: body.weightIncrementGrams, minMinutes: body.minMinutes, minimumCharge: body.minimumCharge, packageLabel: body.packageLabel ?? null, updatedAt: new Date() };
      const [row] = existing
        ? await tx.update(schema.laundryPricingRules).set(values).where(eq(schema.laundryPricingRules.id, existing.id)).returning()
        : await tx.insert(schema.laundryPricingRules).values({ organizationId: auth.orgId, serviceId: id, branchId: body.branchId, method, ...values }).returning();
      await audit(tx, req, { action: "laundry.pricing_updated", resourceType: "laundry_pricing_rule", resourceId: row.id, before: existing ?? null, after: row });
      return row;
    });
  });

  app.put("/laundry/services/:id/items", async (req) => {
    const auth = requirePermission(req, "laundry.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ items: z.array(z.object({ name: z.string().trim().min(1).max(60), unitPrice: money, active: z.boolean().default(true) })).max(100) }).parse(req.body);
    const service = await db.query.laundryServices.findFirst({ where: and(eq(schema.laundryServices.id, id), eq(schema.laundryServices.organizationId, auth.orgId)) });
    if (!service) throw notFound("Service");
    return db.transaction(async (tx) => {
      const current = await tx.select().from(schema.laundryItemRates).where(eq(schema.laundryItemRates.serviceId, id));
      for (const [n, item] of body.items.entries()) {
        const match = current.find((c) => c.name.toLowerCase() === item.name.toLowerCase());
        if (match) await tx.update(schema.laundryItemRates).set({ unitPrice: item.unitPrice, active: item.active, sortOrder: n }).where(eq(schema.laundryItemRates.id, match.id));
        else await tx.insert(schema.laundryItemRates).values({ organizationId: auth.orgId, serviceId: id, name: item.name, unitPrice: item.unitPrice, active: item.active, sortOrder: n });
      }
      // Items removed from the list are deactivated (kept for order history).
      const keep = new Set(body.items.map((i) => i.name.toLowerCase()));
      for (const c of current) if (!keep.has(c.name.toLowerCase())) await tx.update(schema.laundryItemRates).set({ active: false }).where(eq(schema.laundryItemRates.id, c.id));
      await audit(tx, req, { action: "laundry.items_updated", resourceType: "laundry_service", resourceId: id, after: body.items });
      return tx.select().from(schema.laundryItemRates).where(eq(schema.laundryItemRates.serviceId, id)).orderBy(asc(schema.laundryItemRates.sortOrder));
    });
  });

  // ---------- machines & maintenance
  app.post("/laundry/machines", async (req, reply) => {
    const auth = requirePermission(req, "laundry.manage");
    const body = machineBody.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const row = await db.transaction(async (tx) => {
      const dup = await tx.query.laundryMachines.findFirst({ where: and(eq(schema.laundryMachines.branchId, body.branchId), eq(schema.laundryMachines.code, body.code)) });
      if (dup) throw conflict(`Machine code ${body.code} is already used at this store`);
      const [m] = await tx.insert(schema.laundryMachines).values({
        organizationId: auth.orgId, branchId: body.branchId, code: body.code, name: body.name, machineType: body.machineType,
        capacityGrams: body.capacityKg ? Math.round(body.capacityKg * 1000) : null, controlMode: body.controlMode, adapterConfig: body.adapterConfig, notes: body.notes,
      }).returning();
      if (body.programs?.length) await tx.insert(schema.laundryPrograms).values(body.programs.map((p) => ({ organizationId: auth.orgId, machineId: m.id, ...p })));
      await audit(tx, req, { action: "laundry.machine_created", resourceType: "laundry_machine", resourceId: m.id, after: { ...m, programs: body.programs } });
      return m;
    });
    reply.code(201);
    return row;
  });

  app.patch("/laundry/machines/:id", async (req) => {
    const auth = requirePermission(req, "laundry.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = machineBody.omit({ branchId: true, code: true, machineType: true }).partial().extend({ active: z.boolean().optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const [m] = await tx.select().from(schema.laundryMachines).where(and(eq(schema.laundryMachines.id, id), eq(schema.laundryMachines.organizationId, auth.orgId))).for("update");
      if (!m) throw notFound("Machine");
      assertBranchAccess(auth, m.branchId);
      if (body.active === false && ["reserved", "running"].includes(m.status)) throw conflict("Finish or cancel the current cycle before switching this machine off");
      const [after] = await tx.update(schema.laundryMachines).set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.capacityKg !== undefined ? { capacityGrams: body.capacityKg ? Math.round(body.capacityKg * 1000) : null } : {}),
        ...(body.controlMode ? { controlMode: body.controlMode } : {}),
        ...(body.adapterConfig ? { adapterConfig: body.adapterConfig } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        version: sql`${schema.laundryMachines.version} + 1`, updatedAt: new Date(),
      }).where(eq(schema.laundryMachines.id, id)).returning();
      if (body.programs) {
        await tx.update(schema.laundryPrograms).set({ active: false }).where(eq(schema.laundryPrograms.machineId, id));
        if (body.programs.length) await tx.insert(schema.laundryPrograms).values(body.programs.map((p) => ({ organizationId: auth.orgId, machineId: id, ...p })));
      }
      await audit(tx, req, { action: "laundry.machine_updated", resourceType: "laundry_machine", resourceId: id, before: m, after });
      return after;
    });
  });

  /** Take a machine out of use (breakdown, service). Not allowed while a cycle is booked or running. */
  app.post("/laundry/machines/:id/maintenance", async (req, reply) => {
    const auth = requirePermission(req, "laundry.maintain");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ kind: z.enum(["breakdown", "service", "cleaning", "inspection"]), notes: z.string().trim().min(3).max(500), status: z.enum(["maintenance", "out_of_service"]).default("maintenance") }).parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [m] = await tx.select().from(schema.laundryMachines).where(and(eq(schema.laundryMachines.id, id), eq(schema.laundryMachines.organizationId, auth.orgId))).for("update");
      if (!m) throw notFound("Machine");
      assertBranchAccess(auth, m.branchId);
      if (["reserved", "running"].includes(m.status)) throw conflict("This machine has a booked or running cycle. Finish or cancel it first.", "MACHINE_BUSY");
      const [rec] = await tx.insert(schema.laundryMaintenance).values({ organizationId: auth.orgId, machineId: id, kind: body.kind, notes: body.notes, createdBy: auth.userId }).returning();
      await tx.update(schema.laundryMachines).set({ status: body.status, version: sql`${schema.laundryMachines.version} + 1`, updatedAt: new Date() }).where(eq(schema.laundryMachines.id, id));
      await audit(tx, req, { action: "laundry.machine_maintenance_started", resourceType: "laundry_machine", resourceId: id, before: { status: m.status }, after: { status: body.status, kind: body.kind, notes: body.notes } });
      return rec;
    });
    reply.code(201);
    return row;
  });

  app.post("/laundry/maintenance/:id/resolve", async (req) => {
    const auth = requirePermission(req, "laundry.maintain");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { notes } = z.object({ notes: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    return db.transaction(async (tx) => {
      const [rec] = await tx.select().from(schema.laundryMaintenance).where(and(eq(schema.laundryMaintenance.id, id), eq(schema.laundryMaintenance.organizationId, auth.orgId))).for("update");
      if (!rec) throw notFound("Maintenance record");
      if (rec.endedAt) throw conflict("Already resolved");
      const m = await tx.query.laundryMachines.findFirst({ where: eq(schema.laundryMachines.id, rec.machineId) });
      assertBranchAccess(auth, m!.branchId);
      await tx.update(schema.laundryMaintenance).set({ endedAt: new Date(), resolvedBy: auth.userId, notes: notes ? `${rec.notes}\n— Resolved: ${notes}` : rec.notes }).where(eq(schema.laundryMaintenance.id, id));
      await tx.update(schema.laundryMachines).set({ status: "available", version: sql`${schema.laundryMachines.version} + 1`, updatedAt: new Date() }).where(eq(schema.laundryMachines.id, rec.machineId));
      await audit(tx, req, { action: "laundry.machine_maintenance_resolved", resourceType: "laundry_machine", resourceId: rec.machineId, after: { notes } });
      return { ok: true };
    });
  });

  app.get("/laundry/machines/:id/history", async (req) => {
    const auth = requirePermission(req, "laundry.view");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const m = await db.query.laundryMachines.findFirst({ where: and(eq(schema.laundryMachines.id, id), eq(schema.laundryMachines.organizationId, auth.orgId)) });
    if (!m) throw notFound("Machine");
    assertBranchAccess(auth, m.branchId);
    const [maintenance, cycles] = await Promise.all([
      db.execute(sql`select mt.*, u.name as created_by_name from laundry_maintenance mt left join users u on u.id = mt.created_by where mt.machine_id = ${id} order by mt.started_at desc limit 50`),
      db.execute(sql`select s.id, s.status, s.status_source, s.program_name, s.started_at, s.ended_at, s.duration_minutes, s.error, o.order_number from laundry_sessions s join laundry_orders o on o.id = s.order_id where s.machine_id = ${id} order by s.created_at desc limit 50`),
    ]);
    return { maintenance, cycles };
  });

  /** After a cycle, staff unload the machine and make it available again. */
  app.post("/laundry/machines/:id/release", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.transaction(async (tx) => {
      const [m] = await tx.select().from(schema.laundryMachines).where(and(eq(schema.laundryMachines.id, id), eq(schema.laundryMachines.organizationId, auth.orgId))).for("update");
      if (!m) throw notFound("Machine");
      assertBranchAccess(auth, m.branchId);
      if (m.status !== "completed") throw conflict(`Only a machine whose cycle has finished can be released (it is ${m.status.replaceAll("_", " ")})`);
      await tx.update(schema.laundryMachines).set({ status: "available", version: sql`${schema.laundryMachines.version} + 1`, updatedAt: new Date() }).where(eq(schema.laundryMachines.id, id));
      await audit(tx, req, { action: "laundry.machine_released", resourceType: "laundry_machine", resourceId: id });
      return { ok: true };
    });
  });

  // ---------- orders
  app.post("/laundry/quote", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const body = quoteBody.parse(req.body);
    const { quote, service, rule } = await buildQuote(db, auth, body);
    return { ...quote, serviceName: service.name, taxBps: service.taxBps, minimumCharge: rule.minimumCharge };
  });

  app.post("/laundry/orders", async (req, reply) => {
    const auth = requirePermission(req, "laundry.operate");
    const body = quoteBody.extend({
      customerId: uuid.optional(),
      guestName: z.string().trim().max(80).optional(),
      guestPhone: z.string().trim().max(20).optional(),
      machineId: uuid.optional(),
      programId: uuid.optional(),
      payments: z.array(paymentInput).max(3).default([]),
    }).parse(req.body);
    return withIdempotency(req, reply, auth.orgId, "POST /laundry/orders", async (tx) => {
      const { service, quote } = await buildQuote(tx, auth, body);
      const branch = await tx.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!branch || branch.status !== "active") throw badRequest("Store not found");
      let customerId = body.customerId;
      if (customerId) {
        const c = await tx.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.organizationId, auth.orgId)) });
        if (!c) throw badRequest("Customer not found");
      } else customerId = (await walkInCustomer(tx, auth.orgId)).id;
      const year = new Date().getFullYear();
      const seq = await nextNumber(tx, auth.orgId, `laundry:${branch.branchCode}:${year}`);
      const estimatedMinutes = body.method === "time" ? quote.units : undefined;
      const [order] = await tx.insert(schema.laundryOrders).values({
        organizationId: auth.orgId, branchId: branch.id, orderNumber: `SS-${branch.branchCode}-${year}-${pad(seq)}`, statusToken: randomBytes(12).toString("base64url"),
        customerId, guestName: body.customerId ? null : body.guestName || null, guestPhone: body.customerId ? null : body.guestPhone || null,
        serviceId: service.id, serviceName: service.name, pricingMethod: body.method, weightGrams: body.weightGrams ?? null, billableGrams: quote.billableGrams, units: quote.units,
        subtotal: quote.subtotal, discountTotal: quote.discount, discountReason: body.discount ? body.discountReason : null, taxBps: service.taxBps, taxTotal: quote.tax, total: quote.total,
        estimatedMinutes, createdBy: auth.userId,
      }).returning();
      await tx.insert(schema.laundryOrderItems).values(quote.lines.map((l) => ({ organizationId: auth.orgId, orderId: order.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })));
      if (body.machineId) await reserveMachine(tx, auth, order, service.machineTypes, body.machineId, body.programId);
      await recordLaundryPayments(tx, req, auth, order, body.payments);
      await audit(tx, req, { action: "laundry.order_created", resourceType: "laundry_order", resourceId: order.id, after: { orderNumber: order.orderNumber, total: order.total, method: body.method, machineId: body.machineId } });
      return { status: 201, body: await orderDetail(tx, auth.orgId, order.id) };
    });
  });

  app.get("/laundry/orders", async (req) => {
    const auth = requirePermission(req, "laundry.view");
    const q = z.object({
      branchId: uuid.optional(), status: z.string().max(30).optional(), search: z.string().trim().max(60).optional(),
      from: z.iso.date().optional(), to: z.iso.date().optional(),
    }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchFilter = q.branchId ? sql`and o.branch_id = ${q.branchId}` : auth.branchIds.length ? sql`and o.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const term = q.search ? `%${q.search}%` : null;
    return db.execute(sql`
      select o.id, o.order_number as "orderNumber", o.status, o.service_name as "serviceName", o.pricing_method as "pricingMethod", o.total,
             o.weight_grams as "weightGrams", o.created_at as "createdAt", coalesce(o.guest_name, c.name) as "customerName", coalesce(o.guest_phone, c.phone) as phone,
             b.branch_code as "branchCode",
             coalesce((select sum(pa.allocated_amount) from payment_allocations pa join payments p on p.id = pa.payment_id where pa.laundry_order_id = o.id and p.status = 'succeeded'), 0)
             - coalesce((select sum(r.amount) from refunds r where r.laundry_order_id = o.id and r.status = 'succeeded'), 0) as paid,
             (select string_agg(m.name || ':' || s.status, ', ') from laundry_sessions s join laundry_machines m on m.id = s.machine_id where s.order_id = o.id) as machines
      from laundry_orders o join customers c on c.id = o.customer_id join branches b on b.id = o.branch_id
      where o.organization_id = ${auth.orgId} ${branchFilter}
        ${q.status ? sql`and o.status = ${q.status}` : sql``}
        ${q.from ? sql`and (o.created_at at time zone 'Asia/Kolkata')::date >= ${q.from}::date` : sql``}
        ${q.to ? sql`and (o.created_at at time zone 'Asia/Kolkata')::date <= ${q.to}::date` : sql``}
        ${term ? sql`and (o.order_number ilike ${term} or o.guest_name ilike ${term} or o.guest_phone ilike ${term} or c.name ilike ${term} or c.phone ilike ${term})` : sql``}
      order by o.created_at desc limit 300`);
  });

  app.get("/laundry/orders/:id", async (req) => {
    const auth = requirePermission(req, "laundry.view");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const detail = await orderDetail(db, auth.orgId, id);
    assertBranchAccess(auth, detail.branchId);
    return detail;
  });

  app.post("/laundry/orders/:id/payments", async (req, reply) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ payments: z.array(paymentInput).min(1).max(3) }).parse(req.body);
    return withIdempotency(req, reply, auth.orgId, `POST /laundry/orders/${id}/payments`, async (tx) => {
      const [order] = await tx.select().from(schema.laundryOrders).where(and(eq(schema.laundryOrders.id, id), eq(schema.laundryOrders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Self-service order");
      assertBranchAccess(auth, order.branchId);
      if (order.status === "cancelled") throw unprocessable("This order is cancelled");
      await recordLaundryPayments(tx, req, auth, order, body.payments);
      return { status: 201, body: await orderDetail(tx, auth.orgId, id) };
    });
  });

  /** Confirm or reject a bank transfer recorded as awaiting verification. */
  app.post("/laundry/orders/:id/verify-payment/:paymentId", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id, paymentId } = z.object({ id: uuid, paymentId: uuid }).parse(req.params);
    const { outcome, note } = z.object({ outcome: z.enum(["confirmed", "rejected"]), note: z.string().trim().min(3).max(300) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [alloc] = await tx.select().from(schema.paymentAllocations).where(and(eq(schema.paymentAllocations.paymentId, paymentId), eq(schema.paymentAllocations.laundryOrderId, id)));
      if (!alloc) throw notFound("Payment");
      const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update");
      assertBranchAccess(auth, p.branchId);
      if (p.status !== "pending") throw unprocessable(`This payment is already ${p.status}`);
      await tx.update(schema.payments).set({ status: outcome === "confirmed" ? "succeeded" : "failed" }).where(eq(schema.payments.id, paymentId));
      await audit(tx, req, { action: `laundry.payment_${outcome}`, resourceType: "payment", resourceId: paymentId, after: { note } });
      await syncPaidStatus(tx, id);
      return orderDetail(tx, auth.orgId, id);
    });
  });

  app.post("/laundry/orders/:id/sessions", async (req, reply) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ machineId: uuid, programId: uuid.optional() }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.laundryOrders).where(and(eq(schema.laundryOrders.id, id), eq(schema.laundryOrders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Self-service order");
      assertBranchAccess(auth, order.branchId);
      if (["cancelled", "collected"].includes(order.status)) throw unprocessable(`This order is ${order.status}`);
      const service = await tx.query.laundryServices.findFirst({ where: eq(schema.laundryServices.id, order.serviceId) });
      const session = await reserveMachine(tx, auth, order, service!.machineTypes, body.machineId, body.programId);
      await audit(tx, req, { action: "laundry.machine_reserved", resourceType: "laundry_session", resourceId: session.id, after: { orderId: id, machineId: body.machineId } });
      return orderDetail(tx, auth.orgId, id);
    });
    reply.code(201);
    return result;
  });

  /**
   * Starts a reserved machine. Requires the order to be fully paid with verified payments. Row
   * locks make concurrent or repeated start requests safe: a second request sees the session
   * already running and returns it without sending another start command.
   */
  app.post("/laundry/sessions/:id/start", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const outcome = await db.transaction(async (tx) => {
      const [session] = await tx.select().from(schema.laundrySessions).where(and(eq(schema.laundrySessions.id, id), eq(schema.laundrySessions.organizationId, auth.orgId))).for("update");
      if (!session) throw notFound("Machine cycle");
      const [order] = await tx.select().from(schema.laundryOrders).where(eq(schema.laundryOrders.id, session.orderId)).for("update");
      assertBranchAccess(auth, order.branchId);
      if (session.status === "running") return { alreadyRunning: true as const, order: await orderDetail(tx, auth.orgId, order.id) };
      if (session.status !== "reserved") throw unprocessable(`This cycle is ${session.status}`, "SESSION_NOT_RESERVED");
      const { paid } = await orderPaid(tx, order.id);
      if (paid < order.total) throw unprocessable(`Collect the full payment before starting the machine (₹${((order.total - paid) / 100).toFixed(2)} due)`, "PAYMENT_REQUIRED");
      const [machine] = await tx.select().from(schema.laundryMachines).where(eq(schema.laundryMachines.id, session.machineId)).for("update");
      if (!machine || machine.status !== "reserved") throw conflict(machine ? `${machine.name} is ${machine.status.replaceAll("_", " ")}` : "This machine no longer exists", "MACHINE_UNAVAILABLE");
      const result = await adapterFor(machine).start(machine, { sessionId: session.id, programName: session.programName ?? "Standard", durationMinutes: session.durationMinutes });
      // The machine did not confirm: keep the booking so staff can retry or cancel; never show it as running.
      if (!result.ok) return { failed: true as const, machineCode: machine.code, machineName: machine.name, message: result.message };
      const now = new Date();
      await tx.update(schema.laundrySessions).set({
        status: "running", startedAt: now, expectedEndAt: new Date(now.getTime() + session.durationMinutes * 60_000), startedBy: auth.userId,
        statusSource: result.verified ? "device" : "staff", error: null,
      }).where(eq(schema.laundrySessions.id, id));
      await tx.update(schema.laundryMachines).set({ status: "running", version: sql`${schema.laundryMachines.version} + 1`, updatedAt: now }).where(eq(schema.laundryMachines.id, machine.id));
      if (["paid", "pending_payment"].includes(order.status)) await tx.update(schema.laundryOrders).set({ status: "in_progress", updatedAt: now }).where(eq(schema.laundryOrders.id, order.id));
      await audit(tx, req, { action: "laundry.machine_started", resourceType: "laundry_session", resourceId: id, after: { machine: machine.code, verified: result.verified, message: result.message } });
      return { alreadyRunning: false, order: await orderDetail(tx, auth.orgId, order.id) };
    });
    if ("failed" in outcome) {
      // Saved in its own transaction so the reason survives for staff and the audit log.
      await db.transaction(async (tx) => {
        await tx.update(schema.laundrySessions).set({ error: outcome.message }).where(eq(schema.laundrySessions.id, id));
        await audit(tx, req, { action: "laundry.machine_start_failed", resourceType: "laundry_session", resourceId: id, after: { machine: outcome.machineCode, error: outcome.message } });
      });
      throw unprocessable(`${outcome.machineName} did not start: ${outcome.message}`, "MACHINE_START_FAILED");
    }
    return outcome;
  });

  async function finishSession(tx: Tx, req: Parameters<typeof audit>[1], auth: AuthContext, sessionId: string, outcome: "completed" | "failed" | "cancelled", source: "staff" | "device", error?: string) {
    const [session] = await tx.select().from(schema.laundrySessions).where(and(eq(schema.laundrySessions.id, sessionId), eq(schema.laundrySessions.organizationId, auth.orgId))).for("update");
    if (!session) throw notFound("Machine cycle");
    const order = await tx.query.laundryOrders.findFirst({ where: eq(schema.laundryOrders.id, session.orderId) });
    assertBranchAccess(auth, order!.branchId);
    const allowed = outcome === "cancelled" ? ["reserved"] : ["running"];
    if (!allowed.includes(session.status)) throw unprocessable(outcome === "cancelled" ? "Only a booked cycle that has not started can be cancelled" : `This cycle is ${session.status}`, "SESSION_STATE");
    const now = new Date();
    await tx.update(schema.laundrySessions).set({ status: outcome, endedAt: now, statusSource: source, error: error ?? null }).where(eq(schema.laundrySessions.id, sessionId));
    // A finished cycle leaves the laundry inside until staff unload it; a failed or cancelled one frees the machine.
    await tx.update(schema.laundryMachines).set({ status: outcome === "completed" ? "completed" : "available", version: sql`${schema.laundryMachines.version} + 1`, updatedAt: now }).where(eq(schema.laundryMachines.id, session.machineId));
    const open = await tx.select({ id: schema.laundrySessions.id }).from(schema.laundrySessions).where(and(eq(schema.laundrySessions.orderId, session.orderId), inArray(schema.laundrySessions.status, ["reserved", "running"])));
    if (outcome === "completed" && !open.length && order!.status === "in_progress") {
      await tx.update(schema.laundryOrders).set({ status: "ready", completedAt: now, updatedAt: now }).where(eq(schema.laundryOrders.id, session.orderId));
    }
    await audit(tx, req, { action: `laundry.cycle_${outcome}`, resourceType: "laundry_session", resourceId: sessionId, after: { source, error } });
    return orderDetail(tx, auth.orgId, session.orderId);
  }

  app.post("/laundry/sessions/:id/complete", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.transaction((tx) => finishSession(tx, req, auth, id, "completed", "staff"));
  });

  app.post("/laundry/sessions/:id/fail", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    return db.transaction((tx) => finishSession(tx, req, auth, id, "failed", "staff", reason));
  });

  app.post("/laundry/sessions/:id/cancel", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.transaction((tx) => finishSession(tx, req, auth, id, "cancelled", "staff"));
  });

  /** For connected machines: ask the controller. Only a device-reported state changes anything. */
  app.post("/laundry/sessions/:id/refresh", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const session = await db.query.laundrySessions.findFirst({ where: and(eq(schema.laundrySessions.id, id), eq(schema.laundrySessions.organizationId, auth.orgId)) });
    if (!session) throw notFound("Machine cycle");
    const machine = await db.query.laundryMachines.findFirst({ where: eq(schema.laundryMachines.id, session.machineId) });
    assertBranchAccess(auth, machine!.branchId);
    const status = await adapterFor(machine!).status(machine!);
    if (session.status === "running" && status.state === "done") return { device: status, order: await db.transaction((tx) => finishSession(tx, req, auth, id, "completed", "device")) };
    if (session.status === "running" && status.state === "error") return { device: status, order: await db.transaction((tx) => finishSession(tx, req, auth, id, "failed", "device", status.message ?? "Machine reported an error")) };
    return { device: status, order: await orderDetail(db, auth.orgId, session.orderId) };
  });

  app.post("/laundry/orders/:id/collect", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.laundryOrders).where(and(eq(schema.laundryOrders.id, id), eq(schema.laundryOrders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Self-service order");
      assertBranchAccess(auth, order.branchId);
      if (!["ready", "paid", "in_progress"].includes(order.status)) throw unprocessable(`This order is ${order.status.replaceAll("_", " ")}`);
      const active = await tx.select({ id: schema.laundrySessions.id }).from(schema.laundrySessions).where(and(eq(schema.laundrySessions.orderId, id), inArray(schema.laundrySessions.status, ["reserved", "running"])));
      if (active.length) throw unprocessable("A machine cycle for this order is still booked or running", "CYCLE_ACTIVE");
      const { paid } = await orderPaid(tx, id);
      if (paid < order.total) throw unprocessable("Collect the balance before handing over", "BALANCE_DUE");
      await tx.update(schema.laundryOrders).set({ status: "collected", collectedAt: new Date(), updatedAt: new Date() }).where(eq(schema.laundryOrders.id, id));
      await audit(tx, req, { action: "laundry.order_collected", resourceType: "laundry_order", resourceId: id });
      return orderDetail(tx, auth.orgId, id);
    });
  });

  /**
   * Cancels an order that has not used a machine yet; booked machines are released. Money taken is
   * refunded only with payments.refund (against the original payments, never deleted).
   */
  app.post("/laundry/orders/:id/cancel", async (req) => {
    const auth = requirePermission(req, "laundry.operate");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(300), refundMethod: z.enum(PAYMENT_METHODS).optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.laundryOrders).where(and(eq(schema.laundryOrders.id, id), eq(schema.laundryOrders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Self-service order");
      assertBranchAccess(auth, order.branchId);
      if (["cancelled", "collected"].includes(order.status)) throw unprocessable(`This order is already ${order.status}`);
      const sessions = await tx.select().from(schema.laundrySessions).where(eq(schema.laundrySessions.orderId, id)).for("update");
      if (sessions.some((s) => ["running", "completed"].includes(s.status))) throw unprocessable("A machine has already been used for this order. Finish it and refund separately if needed.", "CYCLE_USED");
      const { paid } = await orderPaid(tx, id);
      if (paid > 0) {
        if (!body.refundMethod) throw unprocessable(`₹${(paid / 100).toFixed(2)} was paid. Choose how to refund it.`, "REFUND_REQUIRED");
        if (!can(auth, "payments.refund")) throw forbidden("A manager must approve the refund");
        const shift = await openShiftFor(tx, auth, order.branchId);
        let remaining = paid;
        const paymentsRows = await tx.execute<{ id: string; allocated: string; refunded: string; method: string }>(sql`
          select p.id, p.payment_method as method, pa.allocated_amount as allocated, coalesce((select sum(r.amount) from refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0) as refunded
          from payment_allocations pa join payments p on p.id = pa.payment_id where pa.laundry_order_id = ${id} and p.status = 'succeeded' order by p.received_at desc`);
        for (const p of paymentsRows) {
          const refundable = Math.min(remaining, Number(p.allocated) - Number(p.refunded));
          if (refundable <= 0) continue;
          const toWallet = p.method === "store_credit";
          await tx.insert(schema.refunds).values({ organizationId: auth.orgId, paymentId: p.id, laundryOrderId: id, amount: refundable, reason: body.reason, method: toWallet ? "store_credit" : body.refundMethod, approvedBy: auth.userId, shiftId: shift?.id ?? null });
          if (toWallet) await walletEntry(tx, { orgId: auth.orgId, customerId: order.customerId, branchId: order.branchId, kind: "refund", amount: refundable, paymentId: p.id, note: `Refund: ${body.reason}`, userId: auth.userId });
          remaining -= refundable;
        }
      }
      const now = new Date();
      for (const s of sessions.filter((x) => x.status === "reserved")) {
        await tx.update(schema.laundrySessions).set({ status: "cancelled", endedAt: now }).where(eq(schema.laundrySessions.id, s.id));
        await tx.update(schema.laundryMachines).set({ status: "available", version: sql`${schema.laundryMachines.version} + 1`, updatedAt: now }).where(eq(schema.laundryMachines.id, s.machineId));
      }
      await tx.update(schema.laundryOrders).set({ status: "cancelled", cancelReason: body.reason, cancelledAt: now, updatedAt: now }).where(eq(schema.laundryOrders.id, id));
      await audit(tx, req, { action: "laundry.order_cancelled", resourceType: "laundry_order", resourceId: id, after: { reason: body.reason, refunded: paid } });
      return orderDetail(tx, auth.orgId, id);
    });
  });

  // ---------- dashboard & reports
  app.get("/laundry/reports", async (req) => {
    const auth = requirePermission(req, "laundry.view");
    const q = z.object({ branchId: uuid.optional(), from: z.iso.date(), to: z.iso.date() }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchFilter = q.branchId ? sql`and o.branch_id = ${q.branchId}` : auth.branchIds.length ? sql`and o.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const range = sql`(o.created_at at time zone 'Asia/Kolkata')::date between ${q.from}::date and ${q.to}::date`;
    const where = sql`o.organization_id = ${auth.orgId} ${branchFilter} and ${range}`;
    const paidExpr = sql`(coalesce((select sum(pa.allocated_amount) from payment_allocations pa join payments p on p.id = pa.payment_id where pa.laundry_order_id = o.id and p.status = 'succeeded'), 0))`;
    const refundExpr = sql`(coalesce((select sum(r.amount) from refunds r where r.laundry_order_id = o.id and r.status = 'succeeded'), 0))`;
    const days = Math.max(1, Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000) + 1);
    const [[totals], byService, byMethod, byMachine, byBranch, daily] = await Promise.all([
      db.execute<Record<string, string>>(sql`
        select count(*)::int as orders,
               count(*) filter (where o.status = 'cancelled')::int as cancelled,
               count(*) filter (where o.status in ('ready', 'collected'))::int as completed,
               coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as billed,
               coalesce(sum(${paidExpr}), 0) as collected,
               coalesce(sum(${refundExpr}), 0) as refunded,
               coalesce(sum(greatest(o.total - ${paidExpr} + ${refundExpr}, 0)) filter (where o.status <> 'cancelled'), 0) as outstanding,
               coalesce(sum(o.tax_total) filter (where o.status <> 'cancelled'), 0) as tax,
               coalesce(sum(o.weight_grams) filter (where o.status <> 'cancelled'), 0) as grams
        from laundry_orders o where ${where}`),
      db.execute(sql`select o.service_name as label, count(*)::int as orders, coalesce(sum(o.total), 0) as revenue from laundry_orders o where ${where} and o.status <> 'cancelled' group by 1 order by 3 desc`),
      db.execute(sql`select o.pricing_method as label, count(*)::int as orders, coalesce(sum(o.total), 0) as revenue from laundry_orders o where ${where} and o.status <> 'cancelled' group by 1 order by 3 desc`),
      db.execute(sql`
        select m.id, m.name, m.code, m.machine_type as "machineType", b.branch_code as "branchCode",
               count(s.id) filter (where s.status = 'completed')::int as cycles,
               coalesce(round(avg(extract(epoch from (s.ended_at - s.started_at)) / 60) filter (where s.status = 'completed')), 0)::int as "avgMinutes",
               coalesce(sum(extract(epoch from (s.ended_at - s.started_at)) / 60) filter (where s.status = 'completed'), 0)::int as "runMinutes",
               count(s.id) filter (where s.status = 'failed')::int as failures,
               coalesce(sum(distinct_orders.revenue), 0) as revenue
        from laundry_machines m join branches b on b.id = m.branch_id
        left join laundry_sessions s on s.machine_id = m.id and (s.created_at at time zone 'Asia/Kolkata')::date between ${q.from}::date and ${q.to}::date
        left join lateral (select o.total as revenue from laundry_orders o where o.id = s.order_id and s.status = 'completed'
                           and s.id = (select s2.id from laundry_sessions s2 where s2.order_id = o.id and s2.status = 'completed' order by s2.created_at limit 1)) distinct_orders on true
        where m.organization_id = ${auth.orgId} ${q.branchId ? sql`and m.branch_id = ${q.branchId}` : auth.branchIds.length ? sql`and m.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``}
        group by m.id, b.branch_code order by m.machine_type, m.code`),
      db.execute(sql`select b.name as label, count(*)::int as orders, coalesce(sum(o.total), 0) as revenue from laundry_orders o join branches b on b.id = o.branch_id where ${where} and o.status <> 'cancelled' group by 1 order by 3 desc`),
      db.execute(sql`select to_char((o.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(*)::int as orders, coalesce(sum(o.total), 0) as revenue from laundry_orders o where ${where} and o.status <> 'cancelled' group by 1 order by 1`),
    ]);
    const openMaintenance = await db.execute(sql`
      select mt.id, mt.kind, mt.notes, mt.started_at as "startedAt", m.name as machine, m.code
      from laundry_maintenance mt join laundry_machines m on m.id = mt.machine_id
      where mt.organization_id = ${auth.orgId} and mt.ended_at is null ${q.branchId ? sql`and m.branch_id = ${q.branchId}` : sql``} order by mt.started_at`);
    // Utilization = minutes machines actually ran ÷ opening minutes (12 h/day assumed) in the period.
    const openMinutes = days * 12 * 60;
    return {
      from: q.from, to: q.to, days,
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v)])),
      byService, byMethod, byBranch, daily, openMaintenance,
      byMachine: (byMachine as unknown as { runMinutes: number }[]).map((m) => ({ ...m, utilizationPct: Math.min(100, Math.round((Number(m.runMinutes) / openMinutes) * 100)) })),
      utilizationBasis: "Run time ÷ 12 opening hours per day",
    };
  });

  /** QR linking to the public status page; printed on the receipt so customers can follow their machine. */
  app.get("/laundry/orders/:id/status-qr", async (req, reply) => {
    const auth = requirePermission(req, "laundry.view");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const order = await db.query.laundryOrders.findFirst({ where: and(eq(schema.laundryOrders.id, id), eq(schema.laundryOrders.organizationId, auth.orgId)), columns: { statusToken: true, branchId: true } });
    if (!order) throw notFound("Self-service order");
    assertBranchAccess(auth, order.branchId);
    const origin = `${req.protocol}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: `${origin}/laundry-status?t=${order.statusToken}`, scale: 3, eclevel: "M" } as Parameters<typeof bwipjs.toSVG>[0]);
    return reply.header("content-type", "image/svg+xml").header("cache-control", "private, max-age=3600").send(svg);
  });

  /** UPI "scan to pay" for the amount still due, from the store's saved UPI ID. */
  app.get("/laundry/orders/:id/upi-qr", async (req, reply) => {
    const auth = requirePermission(req, "laundry.view");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const order = await db.query.laundryOrders.findFirst({ where: and(eq(schema.laundryOrders.id, id), eq(schema.laundryOrders.organizationId, auth.orgId)) });
    if (!order) throw notFound("Self-service order");
    assertBranchAccess(auth, order.branchId);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { name: true, settings: true } });
    const upi = org?.settings.billing?.upi;
    if (!upi?.vpa) throw notFound("UPI ID is not set up in Business settings");
    const { paid } = await orderPaid(db, id);
    const due = Math.max(0, order.total - paid);
    const params = new URLSearchParams({ pa: upi.vpa, pn: (upi.payeeName || org!.name).slice(0, 60), cu: "INR", tn: `Laundry ${order.orderNumber}` });
    if (due > 0) params.set("am", (due / 100).toFixed(2));
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: `upi://pay?${params.toString()}`, scale: 3, eclevel: "M" } as Parameters<typeof bwipjs.toSVG>[0]);
    return reply.header("content-type", "image/svg+xml").header("cache-control", "no-store").send(svg);
  });

  // ---------- public status (no login): QR on the receipt
  app.get("/public/laundry-status/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/) }).parse(req.params);
    const [row] = await db.execute<Record<string, unknown>>(sql`
      select o.id, o.order_number as "orderNumber", o.status, o.service_name as "serviceName", o.created_at as "createdAt", o.completed_at as "completedAt",
             org.name as "storeName", b.name as "branchName", b.phone as "branchPhone"
      from laundry_orders o join organizations org on org.id = o.organization_id join branches b on b.id = o.branch_id
      where o.status_token = ${token}`);
    if (!row) throw notFound("Order");
    // Only machine names and timings: no customer details, prices or payment data on the public page.
    const sessions = await db.execute(sql`
      select m.name as machine, m.machine_type as "machineType", s.status, s.status_source as "statusSource", s.program_name as program, s.started_at as "startedAt", s.expected_end_at as "expectedEndAt", s.ended_at as "endedAt"
      from laundry_sessions s join laundry_machines m on m.id = s.machine_id where s.order_id = ${row.id as string} and s.status <> 'cancelled' order by s.created_at`);
    const { id: _id, ...publicRow } = row;
    return { ...publicRow, sessions };
  });
}
