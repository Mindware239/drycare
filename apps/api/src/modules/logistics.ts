import { formatMoney } from "@drycare/shared";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TRANSFER_FLOW, collectionDiscount, type GarmentLocation, type TransferDirection } from "@drycare/shared";
import { resolveScanCode } from "../lib/scanLookup";
import { requireScanner } from "./printerRegistry";
import { db, schema, type Tx } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors";
import { nextNumber, nextTagScanCodes, pad } from "../lib/sequences";
import { invoiceTotals } from "../lib/balances";
import { getOrderDetail } from "./orders";

const uuid = z.uuid();

/** Moves garments (and writes their location timeline) without touching their processing stage. */
async function moveGarments(tx: Tx, auth: AuthContext, garmentIds: string[], to: GarmentLocation, kind: string, correlationId: string, notes?: string) {
  if (!garmentIds.length) return;
  const current = await tx.query.garments.findMany({
    where: and(eq(schema.garments.organizationId, auth.orgId), inArray(schema.garments.id, garmentIds)),
    columns: { id: true, location: true },
  });
  const prev = new Map(current.map((g) => [g.id, g.location]));
  const moved = await tx
    .update(schema.garments)
    .set({ location: to, updatedAt: new Date() })
    .where(and(eq(schema.garments.organizationId, auth.orgId), inArray(schema.garments.id, garmentIds)))
    .returning({ id: schema.garments.id, status: schema.garments.currentStatus, branchId: schema.garments.currentBranchId });
  await tx.insert(schema.garmentStatusHistory).values(moved.map((g) => ({
    organizationId: auth.orgId,
    garmentId: g.id,
    previousStatus: g.status,
    newStatus: g.status,
    transitionKind: kind,
    previousLocation: prev.get(g.id) ?? null,
    newLocation: to,
    actorUserId: auth.userId,
    branchId: g.branchId,
    notes,
    correlationId,
  })));
}

/** A code read at a scanning screen, which needs a connected scanner. */
async function scannedCode(tx: Tx | typeof db, orgId: string, raw: string) {
  await requireScanner(orgId, tx);
  return resolveCode(tx, orgId, raw);
}

/** Resolves a scanned code to a bag or a garment of this organization. */
async function resolveCode(tx: Tx | typeof db, orgId: string, raw: string) {
  const code = await resolveScanCode(tx, orgId, raw);
  const bag = await tx.query.bags.findFirst({ where: and(eq(schema.bags.organizationId, orgId), eq(schema.bags.bagCode, code)) });
  if (bag) return { kind: "bag" as const, code, bag };
  const garment = await tx.query.garments.findFirst({ where: and(eq(schema.garments.organizationId, orgId), eq(schema.garments.tagCode, code)) });
  if (garment) return { kind: "garment" as const, code, garment };
  return { kind: "not_found" as const, code };
}

/** Why a bag cannot join this draft batch, or null when it can. Also gives how many garments it holds. */
async function bagProblem(tx: Tx, batch: { id: string; direction: string }, bag: { id: string; bagCode: string }) {
  const flow = TRANSFER_FLOW[batch.direction as TransferDirection];
  const gs = await tx.query.garments.findMany({ where: eq(schema.garments.bagId, bag.id) });
  const active = gs.filter((g) => !["cancelled", "delivered"].includes(g.currentStatus));
  const wrong = active.filter((g) => !flow.from.includes(g.location as GarmentLocation));
  if (!active.length) return { problem: `${bag.bagCode} has no garments to send.`, count: 0 };
  if (wrong.length) return { problem: `${bag.bagCode} cannot be added: ${wrong.length} garment(s) are not at the ${batch.direction === "to_facility" ? "shop" : "facility"}.`, count: 0 };
  const open = await tx.execute(sql`
    select tb.batch_number from transfer_batch_bags x join transfer_batches tb on tb.id = x.batch_id
    where x.bag_id = ${bag.id} and tb.status in ('draft', 'dispatched') and tb.id <> ${batch.id} limit 1`);
  if (open.length) return { problem: `${bag.bagCode} is already in batch ${open[0].batch_number}.`, count: 0 };
  return { problem: null, count: active.length };
}

async function loadBatch(tx: Tx, auth: AuthContext, batchId: string, lock = false) {
  const q = tx.select().from(schema.transferBatches).where(and(eq(schema.transferBatches.id, batchId), eq(schema.transferBatches.organizationId, auth.orgId)));
  const [batch] = lock ? await q.for("update") : await q;
  if (!batch) throw notFound("Transfer batch");
  assertBranchAccess(auth, batch.branchId);
  return batch;
}

/** Batch detail: bags, every expected garment with its verification state for the current step, and scans. */
async function batchDetail(tx: Tx, auth: AuthContext, batchId: string) {
  const batch = await loadBatch(tx, auth, batchId);
  const step = batch.status === "draft" ? "dispatch" : "receipt";
  const bags = await tx.execute(sql`
    select b.id, b.bag_code as "bagCode", b.location, tbb.expected_count as "expectedCount", o.id as "orderId", o.order_number as "orderNumber",
           c.name as "customerName", o.promised_at as "promisedAt"
    from transfer_batch_bags tbb join bags b on b.id = tbb.bag_id join orders o on o.id = b.order_id join customers c on c.id = o.customer_id
    where tbb.batch_id = ${batch.id} order by tbb.created_at`);
  const garments = await tx.execute(sql`
    select g.id, g.tag_code as "tagCode", g.bag_id as "bagId", g.location, g.current_status as "currentStatus", oi.garment_type_name as "garmentType",
           oi.service_name as "service", oi.colour,
           exists (select 1 from scan_events s where s.batch_id = ${batch.id} and s.step = 'dispatch' and s.garment_id = g.id and s.result = 'verified') as "dispatchVerified",
           exists (select 1 from scan_events s where s.batch_id = ${batch.id} and s.step = 'receipt' and s.garment_id = g.id and s.result = 'verified') as "receiptVerified"
    from garments g join order_items oi on oi.id = g.order_item_id
    where g.bag_id in (select bag_id from transfer_batch_bags where batch_id = ${batch.id}) and g.current_status not in ('cancelled', 'delivered')
    order by g.tag_code`);
  const scans = await tx.execute(sql`
    select s.id, s.step, s.scanned_code as "code", s.result, s.scanned_at as "scannedAt", u.name as "scannedBy"
    from scan_events s left join users u on u.id = s.scanned_by where s.batch_id = ${batch.id} order by s.scanned_at desc limit 200`);
  const people = await tx.execute<{ id: string; name: string }>(sql`select id, name from users where id = any(${`{${[batch.createdBy, batch.dispatchedBy, batch.receivedBy].filter(Boolean).join(",")}}`}::uuid[])`);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const [linked] = await tx.select({ id: schema.transferBatches.id }).from(schema.transferBatches).where(eq(schema.transferBatches.returnOfBatchId, batch.id)).limit(1);
  return {
    ...batch,
    step,
    returnBatchId: linked?.id ?? null,
    createdByName: nameOf(batch.createdBy),
    dispatchedByName: nameOf(batch.dispatchedBy),
    receivedByName: nameOf(batch.receivedBy),
    bags,
    garments,
    scans,
  };
}

export async function logisticsRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ lookup

  /** Scanner / search lookup: a bag code or garment tag resolves to its order. Never exposes more than the order view does. */
  app.get("/scan/resolve", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { code } = z.object({ code: z.string().trim().min(2).max(80) }).parse(req.query);
    const r = await resolveCode(db, auth.orgId, code);
    if (r.kind === "not_found") throw notFound(`Nothing found for “${r.code}”`);
    const orderId = r.kind === "bag" ? r.bag.orderId : r.garment.orderId;
    const [order] = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, branchId: schema.orders.branchId }).from(schema.orders).where(eq(schema.orders.id, orderId));
    assertBranchAccess(auth, order.branchId);
    return { kind: r.kind, code: r.code, orderId: order.id, orderNumber: order.orderNumber, bagId: r.kind === "bag" ? r.bag.id : r.garment.bagId, garmentId: r.kind === "garment" ? r.garment.id : null };
  });

  // ------------------------------------------------------------------ bags

  /** Split an order across another bag (bulky items, separate services). Garments keep their IDs. */
  app.post("/orders/:orderId/bags", async (req, reply) => {
    const auth = requirePermission(req, "garments.process");
    const { orderId } = z.object({ orderId: uuid }).parse(req.params);
    const body = z.object({ garmentIds: z.array(uuid).min(1).max(500) }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Order");
      assertBranchAccess(auth, order.branchId);
      const gs = await tx.query.garments.findMany({ where: and(eq(schema.garments.orderId, orderId), inArray(schema.garments.id, body.garmentIds)) });
      if (gs.length !== body.garmentIds.length) throw badRequest("Some garments do not belong to this order");
      if (gs.some((g) => !["shop_counter", "shop_storage"].includes(g.location))) throw unprocessable("Garments can only be re-bagged while they are at the shop", "NOT_AT_SHOP");
      const [{ n }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from bags where order_id = ${orderId}`);
      const [scanCode] = await nextTagScanCodes(tx, auth.orgId, 1);
      const [bag] = await tx.insert(schema.bags).values({
        organizationId: auth.orgId, branchId: order.branchId, orderId, bagCode: `${order.orderNumber}-B${n + 1}`, scanCode, expectedCount: gs.length, createdBy: auth.userId,
      }).returning();
      await tx.update(schema.garments).set({ bagId: bag.id }).where(inArray(schema.garments.id, body.garmentIds));
      await tx.execute(sql`update bags b set expected_count = (select count(*) from garments g where g.bag_id = b.id and g.current_status <> 'cancelled'), updated_at = now() where b.order_id = ${orderId}`);
      await audit(tx, req, { action: "bag.created", resourceType: "bag", resourceId: bag.id, after: { bagCode: bag.bagCode, garments: gs.map((g) => g.tagCode) } });
      return getOrderDetail(tx, auth.orgId, orderId);
    });
    reply.code(201);
    return result;
  });

  // ------------------------------------------------------------------ label print jobs

  app.post("/orders/:orderId/print-jobs", async (req, reply) => {
    const auth = requirePermission(req, "orders.read");
    const { orderId } = z.object({ orderId: uuid }).parse(req.params);
    const body = z.object({ scope: z.enum(["all", "bag", "garments"]).default("all"), garmentIds: z.array(uuid).optional(), labelCount: z.number().int().min(1).max(5000).optional() }).parse(req.body ?? {});
    const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId)) });
    if (!order) throw notFound("Order");
    assertBranchAccess(auth, order.branchId);
    const [{ bags, garments }] = await db.execute<{ bags: number; garments: number }>(sql`
      select (select count(*)::int from bags where order_id = ${orderId}) as bags,
             (select count(*)::int from garments where order_id = ${orderId} and current_status <> 'cancelled') as garments`);
    const labelCount = body.labelCount ?? (body.scope === "bag" ? bags : body.scope === "garments" ? body.garmentIds?.length ?? garments : bags + garments);
    const [job] = await db.insert(schema.labelPrintJobs).values({ organizationId: auth.orgId, orderId, scope: body.scope, garmentIds: body.garmentIds ?? null, labelCount, requestedBy: auth.userId }).returning();
    reply.code(201);
    return job;
  });

  /** Staff confirm whether labels came out of the printer; the browser cannot know. */
  app.post("/print-jobs/:jobId/result", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { jobId } = z.object({ jobId: uuid }).parse(req.params);
    const body = z.object({ status: z.enum(["printed", "failed"]), error: z.string().trim().max(300).optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const [job] = await tx.select().from(schema.labelPrintJobs).where(and(eq(schema.labelPrintJobs.id, jobId), eq(schema.labelPrintJobs.organizationId, auth.orgId))).for("update");
      if (!job) throw notFound("Print job");
      if (job.status !== "pending") throw conflict("This print job has already been confirmed. Start a reprint instead.", "PRINT_JOB_CLOSED");
      const [updated] = await tx.update(schema.labelPrintJobs)
        .set({ status: body.status, error: body.status === "failed" ? body.error ?? "Printer did not print" : null, confirmedBy: auth.userId, confirmedAt: new Date() })
        .where(eq(schema.labelPrintJobs.id, jobId)).returning();
      if (body.status === "printed" && job.scope !== "garments") await tx.execute(sql`update bags set label_print_count = label_print_count + 1 where order_id = ${job.orderId}`);
      await audit(tx, req, { action: `labels.${body.status}`, resourceType: "label_print_job", resourceId: jobId, after: { orderId: job.orderId, scope: job.scope, labels: job.labelCount, error: updated.error } });
      return updated;
    });
  });

  // ------------------------------------------------------------------ transfer batches

  app.get("/transfers", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({ branchId: uuid.optional(), status: z.enum(["open", "closed", "all"]).default("open") }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchFilter = q.branchId ? sql`and tb.branch_id = ${q.branchId}` : auth.branchIds.length ? sql`and tb.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const statusFilter = q.status === "open" ? sql`and tb.status in ('draft', 'dispatched')` : q.status === "closed" ? sql`and tb.status in ('received', 'received_with_exceptions')` : sql``;
    return db.execute(sql`
      select tb.id, tb.batch_number as "batchNumber", tb.direction, tb.facility_name as "facilityName", tb.transport_reference as "transportReference",
             tb.status, tb.created_at as "createdAt", tb.dispatched_at as "dispatchedAt", tb.received_at as "receivedAt",
             (select count(*)::int from transfer_batch_bags x where x.batch_id = tb.id) as bags,
             (select coalesce(sum(x.expected_count), 0)::int from transfer_batch_bags x where x.batch_id = tb.id) as garments,
             (select count(*)::int from garment_exceptions e where e.batch_id = tb.id and e.status = 'open') as "openExceptions"
      from transfer_batches tb where tb.organization_id = ${auth.orgId} ${branchFilter} ${statusFilter}
      order by tb.created_at desc limit 200`);
  });

  app.post("/transfers", async (req, reply) => {
    const auth = requirePermission(req, "garments.process");
    const body = z.object({
      branchId: uuid,
      direction: z.enum(["to_facility", "to_shop"]),
      facilityName: z.string().trim().min(2).max(80),
      transportReference: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(500).optional(),
    }).parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const batch = await db.transaction(async (tx) => {
      const year = new Date().getFullYear();
      const seq = await nextNumber(tx, auth.orgId, `transfer:${year}`);
      const [row] = await tx.insert(schema.transferBatches).values({
        organizationId: auth.orgId, branchId: body.branchId, batchNumber: `${body.direction === "to_facility" ? "OUT" : "RET"}-${year}-${pad(seq)}`,
        direction: body.direction, facilityName: body.facilityName, transportReference: body.transportReference || null, notes: body.notes || null, createdBy: auth.userId,
      }).returning();
      await audit(tx, req, { action: "transfer.created", resourceType: "transfer_batch", resourceId: row.id, after: row });
      return row;
    });
    reply.code(201);
    return batch;
  });

  /**
   * One row per journey: a batch going out and the return batch that brings it back count as one.
   * A return batch started by hand, with no batch going out, gets its own row.
   */
  app.get("/transfers/journeys", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({ branchId: uuid.optional() }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchFilter = q.branchId ? sql`and tb.branch_id = ${q.branchId}` : auth.branchIds.length ? sql`and tb.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const rows = await db.execute<{
      id: string; batchNumber: string; direction: string; facilityName: string; transportReference: string | null; status: string; createdAt: string; dispatchedAt: string | null; receivedAt: string | null; expectedBackAt: string | null;
      bags: number; garments: number; scanned: number; arrived: number; atFacility: number; returnId: string | null; returnStatus: string | null; returnReceivedAt: string | null; back: number; missing: number;
    }>(sql`
      select tb.id, tb.batch_number as "batchNumber", tb.direction, tb.facility_name as "facilityName", tb.transport_reference as "transportReference", tb.status,
             tb.created_at as "createdAt", tb.dispatched_at as "dispatchedAt", tb.received_at as "receivedAt", tb.expected_back_at as "expectedBackAt",
             (select count(*)::int from transfer_batch_bags x where x.batch_id = tb.id) as bags,
             (select count(*)::int from garments g join transfer_batch_bags x on x.bag_id = g.bag_id where x.batch_id = tb.id and g.current_status not in ('cancelled', 'delivered')) as garments,
             (select count(*)::int from scan_events s where s.batch_id = tb.id and s.step = 'dispatch' and s.result = 'verified' and s.garment_id is not null) as scanned,
             (select count(*)::int from scan_events s where s.batch_id = tb.id and s.step = 'receipt' and s.result = 'verified' and s.garment_id is not null) as arrived,
             (select count(*)::int from garments g join transfer_batch_bags x on x.bag_id = g.bag_id where x.batch_id = tb.id and g.location = 'at_facility' and g.current_status not in ('cancelled', 'delivered')) as "atFacility",
             r.id as "returnId", r.status as "returnStatus", r.received_at as "returnReceivedAt",
             (select count(*)::int from scan_events s where s.batch_id = r.id and s.step = 'receipt' and s.result = 'verified' and s.garment_id is not null) as back,
             (select count(*)::int from garment_exceptions e where e.status = 'open' and e.kind = 'missing' and (e.batch_id = tb.id or e.batch_id = r.id)) as missing
      from transfer_batches tb
      left join lateral (select * from transfer_batches x where x.return_of_batch_id = tb.id order by x.created_at desc limit 1) r on true
      where tb.organization_id = ${auth.orgId} and tb.return_of_batch_id is null ${branchFilter}
      order by tb.created_at desc limit 1000`);
    return rows.map((b) => {
      const closed = b.status === "received" || b.status === "received_with_exceptions";
      if (b.direction === "to_shop") {
        return { ...b, standalone: true, returnId: b.id, returnStatus: b.status, stage: closed ? "done" : "at_facility", doneAt: b.receivedAt, back: b.arrived, backExpected: b.garments };
      }
      const returned = b.returnStatus === "received" || b.returnStatus === "received_with_exceptions";
      const stage = b.status === "draft" ? "packing" : b.status === "dispatched" ? "transit" : returned || (!b.returnId && b.atFacility === 0) ? "done" : "at_facility";
      return { ...b, standalone: false, stage, doneAt: stage === "done" ? b.returnReceivedAt ?? b.receivedAt : null, backExpected: b.arrived };
    });
  });

  /** Bags at the shop that are still to be cleaned and are not in any open batch. */
  app.get("/transfers/waiting", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({ branchId: uuid.optional() }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchFilter = q.branchId ? sql`and b.branch_id = ${q.branchId}` : auth.branchIds.length ? sql`and b.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    return db.execute(sql`
      select b.id, b.bag_code as "bagCode", o.order_number as "orderNumber", c.name as "customerName",
             json_agg(json_build_object('tagCode', g.tag_code, 'garmentType', oi.garment_type_name) order by g.tag_code) as garments
      from bags b join orders o on o.id = b.order_id join customers c on c.id = o.customer_id
      join garments g on g.bag_id = b.id and g.current_status not in ('cancelled', 'delivered') join order_items oi on oi.id = g.order_item_id
      where b.organization_id = ${auth.orgId} ${branchFilter}
        and not exists (select 1 from transfer_batch_bags x join transfer_batches tb on tb.id = x.batch_id where x.bag_id = b.id and tb.status in ('draft', 'dispatched'))
      group by b.id, b.bag_code, o.order_number, c.name, o.created_at
      having bool_and(g.location = 'shop_counter') and bool_and(g.current_status not in ('ready', 'dispatched', 'exception'))
      order by o.created_at limit 200`);
  });

  /** Adds a bag with no scan, for a shop without a scanner at hand. Its garments stay unverified, so dispatching them is an audited choice. */
  app.post("/transfers/:batchId/bags", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    const { bagId } = z.object({ bagId: uuid }).parse(req.body);
    return db.transaction(async (tx) => {
      const batch = await loadBatch(tx, auth, batchId, true);
      if (batch.status !== "draft") throw unprocessable("Bags can only be added before dispatch", "BATCH_DISPATCHED");
      const bag = await tx.query.bags.findFirst({ where: and(eq(schema.bags.id, bagId), eq(schema.bags.organizationId, auth.orgId)) });
      if (!bag) throw notFound("Bag");
      assertBranchAccess(auth, bag.branchId);
      if (await tx.query.transferBatchBags.findFirst({ where: and(eq(schema.transferBatchBags.batchId, batchId), eq(schema.transferBatchBags.bagId, bagId)) })) throw conflict(`${bag.bagCode} is already in this batch.`, "BAG_ALREADY_IN_BATCH");
      const check = await bagProblem(tx, batch, bag);
      if (check.problem) throw unprocessable(check.problem, "BAG_NOT_ALLOWED");
      await tx.insert(schema.transferBatchBags).values({ organizationId: auth.orgId, batchId, bagId, expectedCount: check.count, addedBy: auth.userId });
      await audit(tx, req, { action: "transfer.bag_added_by_hand", resourceType: "transfer_batch", resourceId: batchId, after: { batchNumber: batch.batchNumber, bagCode: bag.bagCode, garments: check.count } });
      return batchDetail(tx, auth, batchId);
    });
  });

  /** Throws away a batch that has not left. Nothing has moved yet, so its bags are simply free again. */
  app.delete("/transfers/:batchId", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    return db.transaction(async (tx) => {
      const batch = await loadBatch(tx, auth, batchId, true);
      if (batch.status !== "draft") throw unprocessable("Only a batch that has not been dispatched can be discarded", "BATCH_DISPATCHED");
      await tx.delete(schema.scanEvents).where(eq(schema.scanEvents.batchId, batchId));
      await tx.delete(schema.transferBatchBags).where(eq(schema.transferBatchBags.batchId, batchId));
      await tx.delete(schema.transferBatches).where(eq(schema.transferBatches.id, batchId));
      await audit(tx, req, { action: "transfer.discarded", resourceType: "transfer_batch", resourceId: batchId, after: { batchNumber: batch.batchNumber } });
      return { ok: true };
    });
  });

  /**
   * Starts bringing a batch back: a return batch with everything still at the facility, on its way to the shop.
   * Bags holding a garment flagged missing come too, so it can be scanned back if it turns up. Asking twice gives the same batch.
   */
  app.post("/transfers/:batchId/start-return", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    return db.transaction(async (tx) => {
      const out = await loadBatch(tx, auth, batchId, true);
      if (out.direction !== "to_facility") throw unprocessable("Only a batch sent to the facility can come back", "NOT_OUTBOUND");
      if (out.status !== "received" && out.status !== "received_with_exceptions") throw unprocessable("Receive this batch at the facility first", "NOT_AT_FACILITY");
      const [existing] = await tx.select().from(schema.transferBatches).where(eq(schema.transferBatches.returnOfBatchId, out.id)).limit(1);
      if (existing) return batchDetail(tx, auth, existing.id);
      const rows = await tx.execute<{ bagId: string; garmentId: string; location: string }>(sql`
        select g.bag_id as "bagId", g.id as "garmentId", g.location from garments g join transfer_batch_bags x on x.bag_id = g.bag_id
        where x.batch_id = ${out.id} and g.current_status not in ('cancelled', 'delivered') and g.location in ('at_facility', 'missing')
          and not exists (select 1 from transfer_batch_bags y join transfer_batches t on t.id = y.batch_id where y.bag_id = g.bag_id and t.status in ('draft', 'dispatched'))`);
      const coming = rows.filter((g) => g.location === "at_facility");
      if (!coming.length) throw unprocessable("Nothing from this batch is at the facility", "NOTHING_AT_FACILITY");
      const flow = TRANSFER_FLOW.to_shop;
      const year = new Date().getFullYear();
      const seq = await nextNumber(tx, auth.orgId, `transfer:${year}`);
      const now = new Date();
      const [ret] = await tx.insert(schema.transferBatches).values({
        organizationId: auth.orgId, branchId: out.branchId, batchNumber: `RET-${year}-${pad(seq)}`, direction: "to_shop", facilityName: out.facilityName, transportReference: out.transportReference,
        status: "dispatched", createdBy: auth.userId, dispatchedBy: auth.userId, dispatchedAt: now, returnOfBatchId: out.id,
      }).returning();
      const bagIds = [...new Set(rows.map((g) => g.bagId))];
      await tx.insert(schema.transferBatchBags).values(bagIds.map((bagId) => ({ organizationId: auth.orgId, batchId: ret.id, bagId, expectedCount: coming.filter((g) => g.bagId === bagId).length, addedBy: auth.userId })));
      await moveGarments(tx, auth, coming.map((g) => g.garmentId), flow.transit, "dispatch", ret.batchNumber, `Coming back from ${out.facilityName} in ${ret.batchNumber}`);
      await tx.execute(sql`update bags set location = ${flow.transit}, updated_at = now() where id in (select bag_id from transfer_batch_bags where batch_id = ${ret.id})`);
      await audit(tx, req, { action: "transfer.return_started", resourceType: "transfer_batch", resourceId: ret.id, after: { batchNumber: ret.batchNumber, returnOf: out.batchNumber, garments: coming.length } });
      return batchDetail(tx, auth, ret.id);
    });
  });

  app.get("/transfers/:batchId", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    return db.transaction((tx) => batchDetail(tx, auth, batchId));
  });

  /**
   * One scanner input for every step. In a draft batch a bag code adds the bag and a garment tag
   * verifies the garment is physically in it; after dispatch, tags verify receipt at the destination.
   * Repeat scans are recorded as duplicates and never double count.
   */
  app.post("/transfers/:batchId/scan", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    const { code } = z.object({ code: z.string().trim().min(2).max(80) }).parse(req.body);
    return db.transaction(async (tx) => {
      const batch = await loadBatch(tx, auth, batchId, true);
      if (batch.status !== "draft" && batch.status !== "dispatched") throw unprocessable("This batch is closed", "BATCH_CLOSED");
      const step = batch.status === "draft" ? "dispatch" : "receipt";
      const r = await scannedCode(tx, auth.orgId, code);
      const log = async (result: string, extra: { bagId?: string; garmentId?: string } = {}) => {
        await tx.insert(schema.scanEvents).values({ organizationId: auth.orgId, batchId, step, scannedCode: r.code, result, scannedBy: auth.userId, ...extra });
      };
      const inBatch = async (bagId: string | null) => Boolean(bagId) && (await tx.query.transferBatchBags.findFirst({ where: and(eq(schema.transferBatchBags.batchId, batchId), eq(schema.transferBatchBags.bagId, bagId!)) }));

      if (r.kind === "not_found") {
        await log("not_found");
        return { result: "not_found", message: `No bag or garment tag “${r.code}” exists.` };
      }

      let bagId = r.kind === "bag" ? r.bag.id : r.garment.bagId;
      if (step === "dispatch" && bagId && !(await inBatch(bagId))) {
        // Adding a bag: all of its active garments must be where this direction starts.
        const bag = r.kind === "bag" ? r.bag : await tx.query.bags.findFirst({ where: eq(schema.bags.id, bagId) });
        if (!bag) throw notFound("Bag");
        assertBranchAccess(auth, bag.branchId);
        const check = await bagProblem(tx, batch, bag);
        if (check.problem) {
          await log("unexpected", { bagId: bag.id });
          return { result: "unexpected", message: check.problem };
        }
        await tx.insert(schema.transferBatchBags).values({ organizationId: auth.orgId, batchId, bagId: bag.id, expectedCount: check.count, addedBy: auth.userId });
        if (r.kind === "bag") {
          await log("verified", { bagId: bag.id });
          return { result: "bag_added", message: `${bag.bagCode} added · ${check.count} garment${check.count === 1 ? "" : "s"} expected. Scan each garment tag to verify the contents.` };
        }
      }

      if (r.kind === "bag") {
        if (!(await inBatch(r.bag.id))) {
          await log("unexpected", { bagId: r.bag.id });
          return { result: "unexpected", message: `${r.bag.bagCode} is not part of this batch.` };
        }
        await log("verified", { bagId: r.bag.id });
        return { result: "bag_seen", message: `${r.bag.bagCode} is in this batch. Scan its garment tags to verify each item.` };
      }

      const g = r.garment;
      if (!(await inBatch(g.bagId)) || ["cancelled", "delivered"].includes(g.currentStatus)) {
        await log("unexpected", { garmentId: g.id, bagId: g.bagId ?? undefined });
        return { result: "unexpected", message: `${g.tagCode} does not belong to any bag in this batch. Keep it aside and check its order.` };
      }
      bagId = g.bagId;
      const inserted = await tx.execute(sql`
        insert into scan_events (organization_id, batch_id, step, scanned_code, bag_id, garment_id, result, scanned_by)
        values (${auth.orgId}, ${batchId}, ${step}, ${r.code}, ${bagId}, ${g.id}, 'verified', ${auth.userId})
        on conflict (batch_id, step, garment_id) where result = 'verified' do nothing returning id`);
      if (!inserted.length) {
        await log("duplicate", { garmentId: g.id, bagId: bagId ?? undefined });
        return { result: "duplicate", message: `${g.tagCode} was already scanned.` };
      }
      // A garment found during receipt closes its "missing" exception from an earlier partial receipt.
      if (step === "receipt") {
        await tx.execute(sql`update garment_exceptions set status = 'resolved', resolution = ${`Found in batch ${batch.batchNumber}`}, resolved_by = ${auth.userId}, resolved_at = now()
          where garment_id = ${g.id} and kind = 'missing' and status = 'open'`);
      }
      return { result: "verified", message: `${g.tagCode} verified.` };
    });
  });

  app.delete("/transfers/:batchId/bags/:bagId", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId, bagId } = z.object({ batchId: uuid, bagId: uuid }).parse(req.params);
    return db.transaction(async (tx) => {
      const batch = await loadBatch(tx, auth, batchId, true);
      if (batch.status !== "draft") throw unprocessable("Bags can only be removed before dispatch", "BATCH_DISPATCHED");
      await tx.execute(sql`delete from scan_events where batch_id = ${batchId} and step = 'dispatch' and (bag_id = ${bagId} or garment_id in (select id from garments where bag_id = ${bagId}))`);
      await tx.delete(schema.transferBatchBags).where(and(eq(schema.transferBatchBags.batchId, batchId), eq(schema.transferBatchBags.bagId, bagId)));
      return batchDetail(tx, auth, batchId);
    });
  });

  app.post("/transfers/:batchId/dispatch", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    const body = z.object({ transportReference: z.string().trim().max(80).optional(), acceptUnverified: z.boolean().default(false), expectedBackAt: z.iso.datetime({ offset: true }).optional() }).parse(req.body ?? {});
    if (body.expectedBackAt && Date.parse(body.expectedBackAt) <= Date.now()) throw unprocessable("Expected return must be in the future.", "EXPECTED_BACK_IN_PAST");
    return db.transaction(async (tx) => {
      const batch = await loadBatch(tx, auth, batchId, true);
      if (batch.status !== "draft") throw unprocessable("This batch has already been dispatched", "BATCH_DISPATCHED");
      const detail = await batchDetail(tx, auth, batchId);
      if (!detail.bags.length) throw unprocessable("Scan at least one bag before dispatching", "BATCH_EMPTY");
      const garments = detail.garments as unknown as { id: string; tagCode: string; dispatchVerified: boolean }[];
      const unverified = garments.filter((g) => !g.dispatchVerified);
      // A bag scan is not proof of its contents; sending unchecked garments is an explicit, audited choice.
      if (unverified.length && !body.acceptUnverified) {
        throw unprocessable(`${unverified.length} garment(s) were not scanned into their bags: ${unverified.slice(0, 8).map((g) => g.tagCode).join(", ")}${unverified.length > 8 ? "…" : ""}`, "UNVERIFIED_GARMENTS");
      }
      const flow = TRANSFER_FLOW[batch.direction as TransferDirection];
      const now = new Date();
      await moveGarments(tx, auth, garments.map((g) => g.id), flow.transit, "dispatch", batch.batchNumber, `Dispatched in ${batch.batchNumber} to ${batch.direction === "to_facility" ? batch.facilityName : "shop"}`);
      await tx.execute(sql`update bags set location = ${flow.transit}, updated_at = now() where id in (select bag_id from transfer_batch_bags where batch_id = ${batchId})`);
      await tx.update(schema.transferBatches)
        .set({ status: "dispatched", dispatchedBy: auth.userId, dispatchedAt: now, transportReference: body.transportReference || batch.transportReference, expectedBackAt: body.expectedBackAt ? new Date(body.expectedBackAt) : null, updatedAt: now })
        .where(eq(schema.transferBatches.id, batchId));
      await audit(tx, req, { action: "transfer.dispatched", resourceType: "transfer_batch", resourceId: batchId, after: { batchNumber: batch.batchNumber, bags: detail.bags.length, garments: garments.length, unverified: unverified.map((g) => g.tagCode) } });
      return batchDetail(tx, auth, batchId);
    });
  });

  /**
   * Confirms arrival. Only scanned garments are treated as present. If anything is unscanned the
   * batch can be closed only as a partial receipt (garments.override), which opens a "missing"
   * exception per absent garment and keeps them visible on their orders.
   */
  app.post("/transfers/:batchId/receive", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { batchId } = z.object({ batchId: uuid }).parse(req.params);
    const body = z.object({ partial: z.boolean().default(false), notes: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    return db.transaction(async (tx) => {
      const batch = await loadBatch(tx, auth, batchId, true);
      if (batch.status !== "dispatched") throw unprocessable(batch.status === "draft" ? "Dispatch the batch before receiving it" : "This batch has already been received", "BATCH_NOT_IN_TRANSIT");
      const detail = await batchDetail(tx, auth, batchId);
      const garments = detail.garments as unknown as { id: string; tagCode: string; bagId: string; location: string; receiptVerified: boolean }[];
      const flowTo = TRANSFER_FLOW[batch.direction as TransferDirection];
      const present = garments.filter((g) => g.receiptVerified);
      // Only what is on its way can be newly missing. A garment already flagged missing stays flagged, with its first exception.
      const missing = garments.filter((g) => !g.receiptVerified && g.location === flowTo.transit);
      const stillMissing = garments.filter((g) => !g.receiptVerified && g.location === "missing");
      if (missing.length && !body.partial) {
        throw unprocessable(`${missing.length} of ${garments.length - stillMissing.length} garment(s) have not been scanned: ${missing.slice(0, 8).map((g) => g.tagCode).join(", ")}${missing.length > 8 ? "…" : ""}`, "GARMENTS_MISSING");
      }
      if (missing.length && !can(auth, "garments.override")) throw forbidden("A manager must confirm a partial receipt with missing garments");
      if (missing.length && !body.notes) throw badRequest("Add a note explaining the missing garments");
      const flow = TRANSFER_FLOW[batch.direction as TransferDirection];
      const now = new Date();
      await moveGarments(tx, auth, present.map((g) => g.id), flow.arrive, "receipt", batch.batchNumber, `Received from ${batch.batchNumber}`);
      if (missing.length) {
        await moveGarments(tx, auth, missing.map((g) => g.id), "missing", "receipt_missing", batch.batchNumber, body.notes);
        const orders = await tx.query.garments.findMany({ where: inArray(schema.garments.id, missing.map((g) => g.id)), columns: { id: true, orderId: true } });
        await tx.insert(schema.garmentExceptions).values(orders.map((g) => ({
          organizationId: auth.orgId, garmentId: g.id, orderId: g.orderId, batchId, kind: "missing", notes: body.notes, createdBy: auth.userId,
        })));
      }
      // A bag is at the destination when everything in it arrived; otherwise it stays flagged in transit.
      await tx.execute(sql`
        update bags b set location = case when exists (select 1 from garments g where g.bag_id = b.id and g.location = 'missing') then 'missing' else ${flow.arrive} end, updated_at = now()
        where b.id in (select bag_id from transfer_batch_bags where batch_id = ${batchId})`);
      await tx.update(schema.transferBatches)
        .set({ status: missing.length || stillMissing.length ? "received_with_exceptions" : "received", receivedBy: auth.userId, receivedAt: now, updatedAt: now })
        .where(eq(schema.transferBatches.id, batchId));
      await audit(tx, req, { action: missing.length ? "transfer.received_partial" : "transfer.received", resourceType: "transfer_batch", resourceId: batchId, after: { batchNumber: batch.batchNumber, received: present.length, missing: missing.map((g) => g.tagCode), stillMissing: stillMissing.map((g) => g.tagCode), notes: body.notes } });
      return batchDetail(tx, auth, batchId);
    });
  });

  // ------------------------------------------------------------------ exceptions

  app.get("/garment-exceptions", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({ status: z.enum(["open", "resolved", "all"]).default("open") }).parse(req.query);
    const branchFilter = auth.branchIds.length ? sql`and o.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    return db.execute(sql`
      select e.id, e.kind, e.notes, e.status, e.resolution, e.created_at as "createdAt", e.resolved_at as "resolvedAt",
             g.tag_code as "tagCode", g.location, oi.garment_type_name as "garmentType", o.id as "orderId", o.order_number as "orderNumber",
             c.name as "customerName", tb.batch_number as "batchNumber", u.name as "createdByName"
      from garment_exceptions e join garments g on g.id = e.garment_id join order_items oi on oi.id = g.order_item_id
      join orders o on o.id = e.order_id join customers c on c.id = o.customer_id
      left join transfer_batches tb on tb.id = e.batch_id left join users u on u.id = e.created_by
      where e.organization_id = ${auth.orgId} ${branchFilter} ${q.status === "all" ? sql`` : sql`and e.status = ${q.status}`}
      order by e.created_at desc limit 500`);
  });

  app.post("/garments/:garmentId/exceptions", async (req, reply) => {
    const auth = requirePermission(req, "garments.process");
    const { garmentId } = z.object({ garmentId: uuid }).parse(req.params);
    const body = z.object({ kind: z.enum(["damaged", "wrong_tag", "delayed", "missing"]), notes: z.string().trim().min(3).max(500) }).parse(req.body);
    const garment = await db.query.garments.findFirst({ where: and(eq(schema.garments.id, garmentId), eq(schema.garments.organizationId, auth.orgId)) });
    if (!garment) throw notFound("Garment");
    assertBranchAccess(auth, garment.currentBranchId);
    const [row] = await db.insert(schema.garmentExceptions).values({ organizationId: auth.orgId, garmentId, orderId: garment.orderId, kind: body.kind, notes: body.notes, createdBy: auth.userId }).returning();
    await audit(db, req, { action: "garment.exception_opened", resourceType: "garment_exception", resourceId: row.id, after: { tagCode: garment.tagCode, kind: body.kind, notes: body.notes } });
    reply.code(201);
    return row;
  });

  app.post("/garment-exceptions/:id/resolve", async (req) => {
    const auth = requirePermission(req, "garments.override");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ resolution: z.string().trim().min(3).max(500), location: z.enum(["shop_storage", "at_facility"]).optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const [ex] = await tx.select().from(schema.garmentExceptions).where(and(eq(schema.garmentExceptions.id, id), eq(schema.garmentExceptions.organizationId, auth.orgId))).for("update");
      if (!ex) throw notFound("Exception");
      if (ex.status !== "open") throw conflict("This exception is already resolved");
      if (body.location) await moveGarments(tx, auth, [ex.garmentId], body.location, "exception_resolved", req.id, body.resolution);
      const [row] = await tx.update(schema.garmentExceptions).set({ status: "resolved", resolution: body.resolution, resolvedBy: auth.userId, resolvedAt: new Date() }).where(eq(schema.garmentExceptions.id, id)).returning();
      await audit(tx, req, { action: "garment.exception_resolved", resourceType: "garment_exception", resourceId: id, after: { resolution: body.resolution, location: body.location } });
      return row;
    });
  });

  // ------------------------------------------------------------------ final billing discount

  /**
   * Discount agreed when the customer collects. Issued as a credit note against the order's invoice
   * (the original invoice is never edited). Above the counter limit it needs discounts.approve.
   */
  app.post("/orders/:orderId/collection-discount", async (req, reply) => {
    const auth = requirePermission(req, "payments.collect");
    const { orderId } = z.object({ orderId: uuid }).parse(req.params);
    const body = z.object({
      type: z.enum(["percent", "fixed"]),
      value: z.number().int().positive(), // bps for percent, paise for fixed
      reason: z.string().trim().min(3).max(300),
      preview: z.boolean().default(false),
    }).parse(req.body);
    if (body.type === "percent" && body.value > 10_000) throw badRequest("A percentage discount cannot exceed 100%");
    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Order");
      assertBranchAccess(auth, order.branchId);
      if (order.operationalStatus === "cancelled") throw unprocessable("This order is cancelled");
      const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, orderId) });
      if (!invoice || invoice.status === "cancelled") throw unprocessable("This order has no open invoice");
      const existing = await tx.query.creditNotes.findFirst({ where: and(eq(schema.creditNotes.invoiceId, invoice.id), eq(schema.creditNotes.kind, "collection_discount"), eq(schema.creditNotes.status, "issued")) });
      if (existing) throw conflict(`A collection discount (${existing.creditNoteNumber}) has already been applied to this order.`, "DISCOUNT_ALREADY_APPLIED");
      const totals = (await invoiceTotals(tx, auth.orgId, invoice.id))!;
      const taxableBase = invoice.subtotal + invoice.surchargeTotal - invoice.discountTotal;
      const calc = collectionDiscount({ taxableBase, taxTotal: invoice.taxTotal, alreadyCredited: 0, type: body.type, value: body.value });
      if ("error" in calc) throw unprocessable(calc.error!.replace(/(\d+) paise/, (_, p) => formatMoney(Number(p), auth.currency)), "DISCOUNT_INVALID");
      if (calc.total > totals.balance) {
        // Discounts never create money owed back to the customer; that is a refund, approved separately.
        throw unprocessable(totals.balance <= 0
          ? "This order is already paid in full. Issue a refund instead of a discount."
          : `The discount (${formatMoney(calc.total, auth.currency)} incl. tax) is more than the ${formatMoney(totals.balance, auth.currency)} still due. Reduce it, or issue a refund for the rest.`, "DISCOUNT_EXCEEDS_BALANCE");
      }
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
      const limitBps = org?.settings.maxDiscountBpsWithoutApproval ?? 1000;
      const totalDiscountBps = invoice.subtotal > 0 ? Math.round(((invoice.discountTotal + calc.taxable) * 10_000) / invoice.subtotal) : 10_000;
      const needsApproval = totalDiscountBps > limitBps;
      if (needsApproval && !can(auth, "discounts.approve")) {
        throw forbidden(`Discounts above ${limitBps / 100}% of the order need a manager. Ask a manager to apply this discount.`);
      }
      const summary = { taxable: calc.taxable, tax: calc.tax, total: calc.total, newGrandTotal: totals.payable - calc.total, paid: totals.paid, balanceAfter: totals.balance - calc.total, needsApproval, limitBps };
      if (body.preview) return { preview: true, ...summary };
      const year = new Date().getFullYear();
      const seq = await nextNumber(tx, auth.orgId, `credit_note:${year}`);
      const [note] = await tx.insert(schema.creditNotes).values({
        organizationId: auth.orgId, invoiceId: invoice.id, orderId, creditNoteNumber: `CN/${year}/${pad(seq, 6)}`,
        discountType: body.type, discountValue: body.value, taxableAmount: calc.taxable, taxAmount: calc.tax, totalAmount: calc.total,
        reason: body.reason, createdBy: auth.userId, approvedBy: needsApproval ? auth.userId : null,
      }).returning();
      await audit(tx, req, { action: "order.collection_discount", resourceType: "credit_note", resourceId: note.id, after: { orderNumber: order.orderNumber, ...summary, type: body.type, value: body.value, reason: body.reason, approvedBy: needsApproval ? auth.userId : null } });
      return { preview: false, creditNote: note, order: await getOrderDetail(tx, auth.orgId, orderId) };
    });
    if (!result.preview) reply.code(201);
    return result;
  });
}
