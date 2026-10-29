import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { deliveryCompleteSchema, deliveryCreateSchema, deliveryRescheduleSchema } from "@drycare/shared";
import { db, schema, type Tx } from "../db/client";
import { assertBranchAccess, can, requireAuth, type AuthContext } from "../lib/context";
import { audit, emit } from "../lib/audit";
import { badRequest, forbidden, notFound, unprocessable } from "../lib/errors";
import { invoiceTotals } from "../lib/balances";
import { recordGarmentTransition, refreshOrderStatus } from "../lib/orderStatus";
import { recordPayments } from "./payments";

const otpHash = (deliveryId: string, otp: string) => createHash("sha256").update(`${deliveryId}:${otp}`).digest("hex");
const ACTIVE = ["scheduled", "assigned", "out"];

/** Schedulers (deliveries.manage) see everything; drivers (deliveries.drive) only their own stops (FR-DEL-006). */
function deliveryAccess(req: FastifyRequest) {
  const auth = requireAuth(req);
  const manage = can(auth, "deliveries.manage");
  if (!manage && !can(auth, "deliveries.drive")) throw forbidden();
  return { auth, manage };
}

async function loadForUpdate(tx: Tx, auth: AuthContext, manage: boolean, id: string) {
  const [d] = await tx.select().from(schema.deliveries).where(and(eq(schema.deliveries.id, id), eq(schema.deliveries.organizationId, auth.orgId))).for("update");
  if (!d || (!manage && d.driverUserId !== auth.userId)) throw notFound("Pickup / delivery");
  assertBranchAccess(auth, d.branchId);
  return d;
}

async function event(tx: Tx, auth: AuthContext, deliveryId: string, name: string, notes?: string) {
  await tx.insert(schema.deliveryEvents).values({ organizationId: auth.orgId, deliveryId, event: name, notes, actorUserId: auth.userId });
}

/** What a driver sees: only what is needed to complete the stop — no history, balances of other orders, or reports. */
async function deliveryView(tx: Tx | typeof db, auth: AuthContext, id: string): Promise<Record<string, any>> {
  const [row] = await tx.execute<Record<string, any>>(sql`
    select d.*, c.name as customer_name, c.phone as customer_phone, o.order_number, u.name as driver_name, b.name as branch_name
    from pickup_deliveries d join customers c on c.id = d.customer_id join branches b on b.id = d.branch_id
    left join orders o on o.id = d.order_id left join users u on u.id = d.driver_user_id
    where d.id = ${id} and d.organization_id = ${auth.orgId}`);
  if (!row) throw notFound("Pickup / delivery");
  const items = await tx.execute(sql`
    select g.id, g.tag_code, g.current_status, oi.garment_type_name, oi.service_name, oi.colour, di.verified_at
    from delivery_items di join garments g on g.id = di.garment_id join order_items oi on oi.id = g.order_item_id
    where di.delivery_id = ${id} order by g.tag_code`);
  const events = await tx.execute(sql`
    select e.event, e.notes, e.occurred_at, u.name as actor from delivery_events e left join users u on u.id = e.actor_user_id
    where e.delivery_id = ${id} order by e.occurred_at`);
  const { otp_hash: _hidden, ...rest } = row;
  return { ...(rest as Record<string, any>), hasOtp: !!row.otp_hash, items, events };
}

export async function deliveryRoutes(app: FastifyInstance) {
  app.get("/deliveries", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    const q = z
      .object({ date: z.iso.date().optional(), status: z.string().optional(), kind: z.enum(["pickup", "delivery"]).optional(), branchId: z.uuid().optional() })
      .parse(req.query);
    return db.execute(sql`
      select d.id, d.kind, d.status, d.customer_id, d.scheduled_date, d.time_slot, d.address_json, d.instructions, d.collect_amount, d.attempts,
             d.driver_user_id, u.name as driver_name, c.name as customer_name, coalesce(d.contact_phone, c.phone) as phone,
             o.order_number, d.order_id, (select count(*)::int from delivery_items di where di.delivery_id = d.id) as garment_count
      from pickup_deliveries d join customers c on c.id = d.customer_id
      left join orders o on o.id = d.order_id left join users u on u.id = d.driver_user_id
      where d.organization_id = ${auth.orgId}
        ${manage ? sql`` : sql`and d.driver_user_id = ${auth.userId}`}
        ${q.date ? sql`and d.scheduled_date = ${q.date}` : sql``}
        ${q.status === "active" ? sql`and d.status in ('scheduled','assigned','out')` : q.status ? sql`and d.status = ${q.status}` : sql``}
        ${q.kind ? sql`and d.kind = ${q.kind}` : sql``}
        ${q.branchId ? sql`and d.branch_id = ${q.branchId}` : sql``}
      order by d.scheduled_date, d.time_slot, d.created_at
      limit 300`);
  });

  app.get("/deliveries/:id", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const v = await deliveryView(db, auth, id);
    if (!manage && v.driver_user_id !== auth.userId) throw notFound("Pickup / delivery");
    return v;
  });

  app.get("/drivers", async (req) => {
    const { auth } = deliveryAccess(req);
    return db.execute(sql`
      select u.id, u.name from organization_memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
      where m.organization_id = ${auth.orgId} and m.status = 'active' and 'deliveries.drive' = any(r.permissions) order by u.name`);
  });

  // FR-DEL-001/002 — schedule a pickup or a delivery.
  app.post("/deliveries", async (req, reply) => {
    const { auth, manage } = deliveryAccess(req);
    if (!manage) throw forbidden();
    const body = deliveryCreateSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const result = await db.transaction(async (tx) => {
      const customer = await tx.query.customers.findFirst({ where: and(eq(schema.customers.id, body.customerId), eq(schema.customers.organizationId, auth.orgId)) });
      if (!customer || customer.status !== "active") throw badRequest("Customer not found");
      let address = body.address as Record<string, string> | undefined;
      if (body.addressId) {
        const a = await tx.query.customerAddresses.findFirst({ where: and(eq(schema.customerAddresses.id, body.addressId), eq(schema.customerAddresses.customerId, customer.id)) });
        if (!a) throw badRequest("Address not found");
        address = a.address;
      }

      let garmentIds: string[] = [];
      let collectAmount = 0;
      if (body.kind === "delivery") {
        const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, body.orderId!), eq(schema.orders.organizationId, auth.orgId))).for("update");
        if (!order || order.customerId !== customer.id) throw badRequest("Order not found for this customer");
        const ready = await tx.select().from(schema.garments).where(and(eq(schema.garments.orderId, order.id), eq(schema.garments.currentStatus, "ready")));
        garmentIds = body.garmentIds?.length ? body.garmentIds : ready.map((g) => g.id);
        if (!garmentIds.length) throw unprocessable("No garments of this order are ready", "NOT_READY");
        const notReady = garmentIds.filter((id) => !ready.some((g) => g.id === id));
        if (notReady.length) throw unprocessable("Only garments that are ready (QC passed and racked) can go out for delivery", "NOT_READY");
        const busy = await tx.execute(sql`
          select 1 from delivery_items di join pickup_deliveries d on d.id = di.delivery_id
          where di.garment_id = any(${`{${garmentIds.join(",")}}`}::uuid[]) and d.status in ('scheduled','assigned','out') limit 1`);
        if (busy.length) throw unprocessable("Some garments are already on another scheduled delivery", "ALREADY_SCHEDULED");
        const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, order.id) });
        const balance = invoice ? ((await invoiceTotals(tx, auth.orgId, invoice.id))?.balance ?? 0) : 0;
        if (balance > 0) {
          if (body.collectOnDelivery) collectAmount = balance;
          else if (body.onCredit) {
            if (!can(auth, "orders.release_with_due")) throw forbidden("You cannot send garments out on credit");
          } else throw unprocessable("This order has a balance due. Collect it first, collect on delivery, or send on credit.", "BALANCE_DUE");
        }
      }

      const [d] = await tx
        .insert(schema.deliveries)
        .values({
          organizationId: auth.orgId,
          branchId: body.branchId,
          customerId: customer.id,
          orderId: body.orderId,
          kind: body.kind,
          address: address!,
          contactPhone: body.contactPhone || customer.phone,
          scheduledDate: body.scheduledDate,
          timeSlot: body.timeSlot,
          instructions: body.instructions,
          collectAmount,
          createdBy: auth.userId,
        })
        .returning();
      let otp: string | undefined;
      if (body.kind === "delivery") {
        otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await tx.update(schema.deliveries).set({ otpHash: otpHash(d.id, otp) }).where(eq(schema.deliveries.id, d.id));
        await tx.insert(schema.deliveryItems).values(garmentIds.map((garmentId) => ({ organizationId: auth.orgId, deliveryId: d.id, garmentId })));
      }
      await event(tx, auth, d.id, "scheduled", `${body.scheduledDate} ${body.timeSlot}${body.onCredit ? " · on credit" : ""}`);
      // The OTP only ever travels to the customer's phone, never back to staff screens.
      await emit(tx, auth.orgId, `${body.kind}.scheduled`, { deliveryId: d.id, customerId: customer.id, orderId: body.orderId, date: body.scheduledDate, slot: body.timeSlot, otp });
      await audit(tx, req, { action: `${body.kind}.scheduled`, resourceType: "delivery", resourceId: d.id, after: { date: body.scheduledDate, slot: body.timeSlot, garments: garmentIds.length, collectAmount, onCredit: body.onCredit } });
      return deliveryView(tx, auth, d.id);
    });
    reply.code(201);
    return result;
  });

  app.post("/deliveries/:id/assign", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    if (!manage) throw forbidden();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { driverUserId } = z.object({ driverUserId: z.uuid() }).parse(req.body);
    return db.transaction(async (tx) => {
      const d = await loadForUpdate(tx, auth, manage, id);
      if (!["scheduled", "assigned"].includes(d.status)) throw unprocessable("Only scheduled stops can be (re)assigned");
      const [driver] = await tx.execute<{ name: string }>(sql`
        select u.name from organization_memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
        where m.organization_id = ${auth.orgId} and m.user_id = ${driverUserId} and m.status = 'active' and 'deliveries.drive' = any(r.permissions)`);
      if (!driver) throw badRequest("That staff member is not a delivery agent");
      await tx.update(schema.deliveries).set({ driverUserId, status: "assigned", updatedAt: new Date(), version: d.version + 1 }).where(eq(schema.deliveries.id, id));
      await event(tx, auth, id, "assigned", driver.name);
      return deliveryView(tx, auth, id);
    });
  });

  /** FR-DEL-003 — dispatch manifest: every garment tag must be scanned before the bag leaves. */
  app.post("/deliveries/:id/dispatch", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ scannedTags: z.array(z.string().trim().toUpperCase()).default([]) }).parse(req.body ?? {});
    return db.transaction(async (tx) => {
      const d = await loadForUpdate(tx, auth, manage, id);
      if (d.status !== "assigned") throw unprocessable(d.status === "scheduled" ? "Assign a delivery agent first" : `Cannot dispatch a stop that is ${d.status}`);
      if (d.kind === "delivery") {
        const items = await tx
          .select({ garment: schema.garments })
          .from(schema.deliveryItems)
          .innerJoin(schema.garments, eq(schema.garments.id, schema.deliveryItems.garmentId))
          .where(eq(schema.deliveryItems.deliveryId, id));
        const expected = new Set(items.map((i) => i.garment.tagCode));
        const scanned = new Set(body.scannedTags);
        const missing = [...expected].filter((t) => !scanned.has(t));
        const extra = [...scanned].filter((t) => !expected.has(t));
        if (missing.length || extra.length) {
          throw unprocessable(
            [missing.length ? `Not scanned: ${missing.join(", ")}` : "", extra.length ? `Not on this delivery: ${extra.join(", ")}` : ""].filter(Boolean).join(" · "),
            "MANIFEST_MISMATCH",
          );
        }
        for (const { garment } of items) {
          if (garment.currentStatus !== "ready") throw unprocessable(`${garment.tagCode} is no longer ready (${garment.currentStatus})`);
          await recordGarmentTransition(tx, garment, "dispatched", "dispatch", auth.userId, { notes: "Out for delivery", correlationId: req.id, set: { storageLocationId: null } });
        }
        await tx.update(schema.deliveryItems).set({ verifiedAt: new Date() }).where(eq(schema.deliveryItems.deliveryId, id));
        await refreshOrderStatus(tx, auth.orgId, d.orderId!);
      }
      await tx.update(schema.deliveries).set({ status: "out", attempts: d.attempts + 1, updatedAt: new Date(), version: d.version + 1 }).where(eq(schema.deliveries.id, id));
      await event(tx, auth, id, "out", d.kind === "delivery" ? "All tags verified" : undefined);
      await emit(tx, auth.orgId, `${d.kind}.out`, { deliveryId: id, customerId: d.customerId, orderId: d.orderId });
      return deliveryView(tx, auth, id);
    });
  });

  // FR-DEL-004/005 — record the outcome at the door.
  app.post("/deliveries/:id/complete", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = deliveryCompleteSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const d = await loadForUpdate(tx, auth, manage, id);
      if (d.status !== "out") throw unprocessable("Only stops that are out can be completed");
      const items = await tx
        .select({ garment: schema.garments })
        .from(schema.deliveryItems)
        .innerJoin(schema.garments, eq(schema.garments.id, schema.deliveryItems.garmentId))
        .where(eq(schema.deliveryItems.deliveryId, id));

      if (body.outcome === "failed") {
        if (!body.failureReason) throw badRequest("Choose why the attempt failed");
        // Garments come back to the store and are ready to be rescheduled or collected.
        for (const { garment } of items) {
          await recordGarmentTransition(tx, garment, "ready", "return_to_store", auth.userId, { notes: `Delivery failed: ${body.failureReason}`, correlationId: req.id });
        }
        if (d.orderId) await refreshOrderStatus(tx, auth.orgId, d.orderId);
        await tx.update(schema.deliveries).set({ status: "failed", failureReason: body.failureReason, updatedAt: new Date(), version: d.version + 1 }).where(eq(schema.deliveries.id, id));
        await event(tx, auth, id, "failed", [body.failureReason.replace(/_/g, " "), body.notes].filter(Boolean).join(" — "));
        await emit(tx, auth.orgId, `${d.kind}.failed`, { deliveryId: id, customerId: d.customerId, orderId: d.orderId, reason: body.failureReason });
        await audit(tx, req, { action: `${d.kind}.failed`, resourceType: "delivery", resourceId: id, after: { reason: body.failureReason } });
        return deliveryView(tx, auth, id);
      }

      if (d.kind === "pickup") {
        await tx.update(schema.deliveries).set({ status: "completed", completedAt: new Date(), bagCount: body.bagCount ?? null, confirmationMethod: body.method ?? "in_person", updatedAt: new Date(), version: d.version + 1 }).where(eq(schema.deliveries.id, id));
        await event(tx, auth, id, "completed", [`${body.bagCount ?? "?"} bag(s) collected`, body.notes].filter(Boolean).join(" — "));
        await emit(tx, auth.orgId, "pickup.completed", { deliveryId: id, customerId: d.customerId });
        return deliveryView(tx, auth, id);
      }

      // Proof of delivery (Blueprint §6): OTP, or signature / named recipient.
      const method = body.method ?? (d.otpHash ? "otp" : "in_person");
      if (method === "otp") {
        if (!body.otp || !d.otpHash || otpHash(id, body.otp) !== d.otpHash) throw unprocessable("The OTP does not match. Ask the customer for the 6-digit code sent to them.", "OTP_MISMATCH");
      } else if (!body.receivedBy?.trim()) {
        throw badRequest("Enter the name of the person who received the garments");
      }

      if (body.payments.length) {
        if (!can(auth, "payments.collect")) throw forbidden("You cannot collect payments");
        const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, d.orderId!) });
        const totals = invoice && (await invoiceTotals(tx, auth.orgId, invoice.id));
        if (!invoice || !totals || totals.balance <= 0) throw unprocessable("Nothing is due on this order");
        await recordPayments(tx, req, auth, { invoiceId: invoice.id, branchId: d.branchId, customerId: d.customerId, balance: totals.balance, payments: body.payments });
      }
      if (d.collectAmount > 0) {
        const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, d.orderId!) });
        const totals = invoice && (await invoiceTotals(tx, auth.orgId, invoice.id));
        if (totals && totals.balance > 0) throw unprocessable(`Collect the remaining ₹${(totals.balance / 100).toFixed(2)} before handing over, or mark the attempt as failed`, "BALANCE_DUE");
      }

      for (const { garment } of items) {
        const ok = await recordGarmentTransition(tx, garment, "delivered", "deliver", auth.userId, {
          notes: method === "otp" ? "Delivered · OTP verified" : `Delivered · received by ${body.receivedBy}`,
          correlationId: req.id,
          set: { deliveredAt: new Date(), location: "collected" },
        });
        if (!ok) throw unprocessable(`Garment ${garment.tagCode} was updated by someone else`, "STALE_VERSION");
      }
      await refreshOrderStatus(tx, auth.orgId, d.orderId!);
      await tx
        .update(schema.deliveries)
        .set({ status: "completed", completedAt: new Date(), confirmationMethod: method, otpHash: null, updatedAt: new Date(), version: d.version + 1 })
        .where(eq(schema.deliveries.id, id));
      await event(tx, auth, id, "completed", [method === "otp" ? "OTP verified" : `Received by ${body.receivedBy} (${method})`, body.notes].filter(Boolean).join(" — "));
      await audit(tx, req, { action: "delivery.completed", resourceType: "delivery", resourceId: id, after: { method, garments: items.length } });
      return deliveryView(tx, auth, id);
    });
  });

  app.post("/deliveries/:id/reschedule", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    if (!manage) throw forbidden();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = deliveryRescheduleSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const d = await loadForUpdate(tx, auth, manage, id);
      if (!["scheduled", "assigned", "failed"].includes(d.status)) throw unprocessable(`Cannot reschedule a stop that is ${d.status}`);
      if (d.kind === "delivery") {
        const notReady = await tx.execute(sql`select g.tag_code from delivery_items di join garments g on g.id = di.garment_id where di.delivery_id = ${id} and g.current_status <> 'ready'`);
        if (notReady.length) throw unprocessable("Some garments on this delivery are no longer ready");
      }
      await tx
        .update(schema.deliveries)
        .set({ scheduledDate: body.scheduledDate, timeSlot: body.timeSlot, status: d.driverUserId ? "assigned" : "scheduled", failureReason: null, updatedAt: new Date(), version: d.version + 1 })
        .where(eq(schema.deliveries.id, id));
      await event(tx, auth, id, "rescheduled", [`${body.scheduledDate} ${body.timeSlot}`, body.notes].filter(Boolean).join(" — "));
      await emit(tx, auth.orgId, `${d.kind}.scheduled`, { deliveryId: id, customerId: d.customerId, orderId: d.orderId, date: body.scheduledDate, slot: body.timeSlot });
      return deliveryView(tx, auth, id);
    });
  });

  app.post("/deliveries/:id/cancel", async (req) => {
    const { auth, manage } = deliveryAccess(req);
    if (!manage) throw forbidden();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    return db.transaction(async (tx) => {
      const d = await loadForUpdate(tx, auth, manage, id);
      if (!ACTIVE.includes(d.status) && d.status !== "failed") throw unprocessable(`Cannot cancel a stop that is ${d.status}`);
      if (d.status === "out") throw unprocessable("The agent is already out — record the outcome instead", "ALREADY_OUT");
      await tx.update(schema.deliveries).set({ status: "cancelled", updatedAt: new Date(), version: d.version + 1 }).where(eq(schema.deliveries.id, id));
      await event(tx, auth, id, "cancelled", reason);
      await audit(tx, req, { action: `${d.kind}.cancelled`, resourceType: "delivery", resourceId: id, after: { reason } });
      return deliveryView(tx, auth, id);
    });
  });
}

/** Called from order creation: link a completed pickup to the order booked from its bags. */
export async function linkPickupToOrder(tx: Tx, auth: AuthContext, pickupId: string, orderId: string, customerId: string) {
  const [p] = await tx.select().from(schema.deliveries).where(and(eq(schema.deliveries.id, pickupId), eq(schema.deliveries.organizationId, auth.orgId))).for("update");
  if (!p || p.kind !== "pickup") throw badRequest("Pickup not found");
  if (p.status !== "completed") throw unprocessable("This pickup has not been completed yet");
  if (p.orderId) throw unprocessable("This pickup is already linked to an order");
  if (p.customerId !== customerId) throw badRequest("The pickup belongs to a different customer");
  await tx.update(schema.deliveries).set({ orderId, updatedAt: new Date() }).where(eq(schema.deliveries.id, pickupId));
  await tx.insert(schema.deliveryEvents).values({ organizationId: auth.orgId, deliveryId: pickupId, event: "order_booked", actorUserId: auth.userId });
}
