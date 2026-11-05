/**
 * RFID module, sold separately from the plans. A reusable RFID tag is linked to a garment when it is received, so
 * garments can be found, tracked and billed by reading their tags. A tag goes back into the pool when the garment
 * leaves. Readers are handheld terminals or USB readers set to type each tag's number, so no device talks to this server directly.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeEpc } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { audit } from "../lib/audit";
import { invoiceTotals } from "../lib/balances";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { badRequest, conflict, notFound } from "../lib/errors";
import { resolveScanCode } from "../lib/scanLookup";

const epcField = z.string().trim().min(4).max(80).transform((raw, ctx) => {
  const epc = normalizeEpc(raw);
  if (!epc) { ctx.addIssue({ code: "custom", message: `"${raw}" is not an RFID tag number` }); return z.NEVER; }
  return epc;
});
const epcList = z.array(epcField).min(1).max(500);

async function logEvent(tx: DbOrTx, auth: AuthContext, entry: { epc: string; action: string; garmentId?: string | null; notes?: string }) {
  await tx.insert(schema.rfidEvents).values({ organizationId: auth.orgId, epc: entry.epc, action: entry.action, garmentId: entry.garmentId ?? null, notes: entry.notes, actorUserId: auth.userId });
}

/** What a set of tag numbers stands for right now, in the order they were read. */
async function describe(auth: AuthContext, epcs: string[]) {
  const unique = [...new Set(epcs)];
  const rows = await db.execute<{ epc: string; status: string; garmentId: string | null; tagCode: string | null; scanCode: string | null; stage: string | null; garment: string | null; service: string | null; orderId: string | null; orderNumber: string | null; customerId: string | null; customerName: string | null; branchId: string | null }>(sql`
    select t.epc, t.status, g.id as "garmentId", g.tag_code as "tagCode", g.scan_code as "scanCode", g.current_status as stage,
           oi.garment_type_name as garment, oi.service_name as service, o.id as "orderId", o.order_number as "orderNumber", c.id as "customerId", c.name as "customerName", o.branch_id as "branchId"
    from rfid_tags t
    left join garments g on g.id = t.garment_id left join order_items oi on oi.id = g.order_item_id left join orders o on o.id = g.order_id left join customers c on c.id = o.customer_id
    where t.organization_id = ${auth.orgId} and t.epc = any(${`{${unique.join(",")}}`}::text[])`);
  const byEpc = new Map(rows.map((r) => [r.epc, r]));
  return unique.map((epc) => {
    const r = byEpc.get(epc);
    // Staff limited to some branches see only that a tag is in use, not whose it is.
    const elsewhere = r?.branchId && auth.branchIds.length && !auth.branchIds.includes(r.branchId);
    if (!r) return { epc, state: "unknown" as const };
    if (r.status === "retired") return { epc, state: "retired" as const };
    if (!r.garmentId) return { epc, state: "free" as const };
    if (elsewhere) return { epc, state: "elsewhere" as const };
    return { epc, state: "linked" as const, garmentId: r.garmentId, tagCode: r.tagCode, scanCode: r.scanCode, stage: r.stage, garment: r.garment, service: r.service, orderId: r.orderId, orderNumber: r.orderNumber, customerId: r.customerId, customerName: r.customerName };
  });
}

export async function rfidRoutes(app: FastifyInstance) {
  app.get("/rfid/summary", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const [counts] = await db.execute<{ free: number; linked: number; retired: number; total: number }>(sql`
      select count(*)::int as total, count(*) filter (where status = 'free')::int as free, count(*) filter (where status = 'linked')::int as linked, count(*) filter (where status = 'retired')::int as retired
      from rfid_tags where organization_id = ${auth.orgId}`);
    const recent = await db.execute(sql`
      select e.id, e.epc, e.action, e.notes, e.occurred_at as at, u.name as actor, g.tag_code as "tagCode", g.scan_code as "scanCode"
      from rfid_events e left join users u on u.id = e.actor_user_id left join garments g on g.id = e.garment_id
      where e.organization_id = ${auth.orgId} order by e.occurred_at desc limit 30`);
    return { counts, recent };
  });

  app.get("/rfid/tags", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({ status: z.enum(["all", "free", "linked", "retired"]).default("all"), search: z.string().trim().max(80).default("") }).parse(req.query);
    const term = `%${q.search}%`;
    return db.execute(sql`
      select t.epc, t.status, t.linked_at as "linkedAt", t.created_at as "createdAt", t.retire_reason as "retireReason", g.tag_code as "tagCode", g.scan_code as "scanCode", oi.garment_type_name as garment, c.name as "customerName", o.id as "orderId", o.order_number as "orderNumber"
      from rfid_tags t left join garments g on g.id = t.garment_id left join order_items oi on oi.id = g.order_item_id left join orders o on o.id = g.order_id left join customers c on c.id = o.customer_id
      where t.organization_id = ${auth.orgId}
        ${q.status === "all" ? sql`` : sql`and t.status = ${q.status}`}
        ${q.search ? sql`and (t.epc ilike ${term} or g.tag_code ilike ${term} or g.scan_code ilike ${term} or o.order_number ilike ${term} or c.name ilike ${term})` : sql``}
      order by t.updated_at desc limit 300`);
  });

  /** Adds new tags to the shop's pool, ready to link. Tags it already has are left as they are. */
  app.post("/rfid/tags", async (req, reply) => {
    const auth = requirePermission(req, "garments.process");
    const { epcs } = z.object({ epcs: epcList }).parse(req.body);
    const added = await db.transaction(async (tx) => {
      const rows = await tx.insert(schema.rfidTags).values([...new Set(epcs)].map((epc) => ({ organizationId: auth.orgId, epc }))).onConflictDoNothing().returning({ epc: schema.rfidTags.epc });
      for (const row of rows) await logEvent(tx, auth, { epc: row.epc, action: "registered" });
      return rows.length;
    });
    reply.code(201);
    return { added, alreadyKnown: new Set(epcs).size - added };
  });

  /** A lost or damaged tag: it can no longer be linked, and any garment it was on is left without a tag. */
  app.post("/rfid/tags/:epc/retire", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const epc = epcField.parse((req.params as { epc: string }).epc);
    const { reason } = z.object({ reason: z.string().trim().min(3, "Say why").max(200) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.rfidTags).where(and(eq(schema.rfidTags.organizationId, auth.orgId), eq(schema.rfidTags.epc, epc))).for("update");
      if (!before) throw notFound("RFID tag");
      const [after] = await tx.update(schema.rfidTags).set({ status: "retired", garmentId: null, linkedAt: null, retireReason: reason, updatedAt: new Date() }).where(eq(schema.rfidTags.id, before.id)).returning();
      await logEvent(tx, auth, { epc, action: "retired", garmentId: before.garmentId, notes: reason });
      await audit(tx, req, { action: "rfid.tag_retired", resourceType: "rfid_tag", resourceId: before.id, before, after });
      return after;
    });
  });

  /** One order's garments and their tags, found from its order number or any of its barcodes. */
  app.get("/rfid/order", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { code } = z.object({ code: z.string().trim().min(2).max(80) }).parse(req.query);
    const value = code.toUpperCase();
    const resolved = await resolveScanCode(db, auth.orgId, code);
    const [hit] = await db.execute<{ id: string }>(sql`
      select o.id from orders o left join garments g on g.order_id = o.id left join bags b on b.order_id = o.id
      where o.organization_id = ${auth.orgId} and (o.order_number = ${value} or g.tag_code = ${resolved} or b.bag_code = ${resolved}) limit 1`);
    if (!hit) throw notFound(`Order or tag "${code}"`);
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, hit.id) });
    assertBranchAccess(auth, order!.branchId);
    const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, order!.customerId), columns: { name: true } });
    const garments = await db.execute(sql`
      select g.id, g.tag_code as "tagCode", g.scan_code as "scanCode", g.current_status as stage, oi.garment_type_name as garment, oi.service_name as service, oi.colour, t.epc
      from garments g join order_items oi on oi.id = g.order_item_id left join rfid_tags t on t.garment_id = g.id
      where g.order_id = ${hit.id} and g.current_status not in ('cancelled', 'delivered') order by g.tag_code`);
    return { id: order!.id, orderNumber: order!.orderNumber, customerName: customer?.name ?? null, garments };
  });

  /** Puts a tag on a garment. A tag read for the first time joins the pool here, so nobody has to register it first. */
  app.post("/rfid/link", async (req, reply) => {
    const auth = requirePermission(req, "garments.process");
    const body = z.object({ garmentId: z.uuid(), epc: epcField }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [garment] = await tx.select().from(schema.garments).where(and(eq(schema.garments.id, body.garmentId), eq(schema.garments.organizationId, auth.orgId))).for("update");
      if (!garment) throw notFound("Garment");
      assertBranchAccess(auth, garment.currentBranchId);
      if (["delivered", "cancelled"].includes(garment.currentStatus)) throw conflict(`${garment.tagCode} has already left the shop.`, "GARMENT_CLOSED");
      await tx.insert(schema.rfidTags).values({ organizationId: auth.orgId, epc: body.epc }).onConflictDoNothing();
      const [tag] = await tx.select().from(schema.rfidTags).where(and(eq(schema.rfidTags.organizationId, auth.orgId), eq(schema.rfidTags.epc, body.epc))).for("update");
      if (tag.status === "retired") throw conflict("This RFID tag was retired and cannot be used again.", "RFID_RETIRED");
      if (tag.garmentId === garment.id) return tag;
      if (tag.garmentId) {
        const other = await tx.query.garments.findFirst({ where: eq(schema.garments.id, tag.garmentId), columns: { tagCode: true } });
        throw conflict(`This RFID tag is already on ${other?.tagCode ?? "another garment"}. Use a different tag, or remove it from that garment first.`, "RFID_IN_USE");
      }
      const already = await tx.query.rfidTags.findFirst({ where: and(eq(schema.rfidTags.organizationId, auth.orgId), eq(schema.rfidTags.garmentId, garment.id)), columns: { epc: true } });
      if (already) throw conflict(`${garment.tagCode} already has an RFID tag. Remove it first to change it.`, "GARMENT_HAS_RFID");
      const [linked] = await tx.update(schema.rfidTags).set({ status: "linked", garmentId: garment.id, linkedAt: new Date(), updatedAt: new Date() }).where(eq(schema.rfidTags.id, tag.id)).returning();
      await logEvent(tx, auth, { epc: body.epc, action: "linked", garmentId: garment.id });
      return linked;
    });
    reply.code(201);
    return result;
  });

  app.post("/rfid/unlink", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { epc } = z.object({ epc: epcField }).parse(req.body);
    return db.transaction(async (tx) => {
      const [tag] = await tx.select().from(schema.rfidTags).where(and(eq(schema.rfidTags.organizationId, auth.orgId), eq(schema.rfidTags.epc, epc))).for("update");
      if (!tag?.garmentId) throw notFound("A linked RFID tag");
      const garment = await tx.query.garments.findFirst({ where: eq(schema.garments.id, tag.garmentId), columns: { currentBranchId: true } });
      if (garment) assertBranchAccess(auth, garment.currentBranchId);
      const [after] = await tx.update(schema.rfidTags).set({ status: "free", garmentId: null, linkedAt: null, updatedAt: new Date() }).where(eq(schema.rfidTags.id, tag.id)).returning();
      await logEvent(tx, auth, { epc, action: "unlinked", garmentId: tag.garmentId });
      return after;
    });
  });

  /** Tracking: what each tag read is on. Each read is recorded, so a garment's history shows where it was seen. */
  app.post("/rfid/read", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { epcs, place } = z.object({ epcs: epcList, place: z.string().trim().max(60).optional() }).parse(req.body);
    const items = await describe(auth, epcs);
    const seen = items.filter((i) => i.state === "linked");
    if (seen.length) await db.insert(schema.rfidEvents).values(seen.map((i) => ({ organizationId: auth.orgId, epc: i.epc, action: "read", garmentId: i.garmentId, notes: place || null, actorUserId: auth.userId })));
    return { items };
  });

  /**
   * RFID billing: the tags in the basket, grouped by customer and order, with what is due on each. Collecting the money
   * and handing over use the same counter routes as a barcode order, so all their rules still apply.
   */
  app.post("/rfid/basket", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { epcs } = z.object({ epcs: epcList }).parse(req.body);
    const items = await describe(auth, epcs);
    const linked = items.filter((i) => i.state === "linked");
    const orderIds = [...new Set(linked.map((i) => i.orderId as string))];
    const money = can(auth, "payments.collect") || can(auth, "reports.financial");
    const orders = orderIds.length ? await Promise.all(orderIds.map(async (id) => {
      const order = (await db.query.orders.findFirst({ where: eq(schema.orders.id, id) }))!;
      const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.orderId, id), columns: { id: true, invoiceNumber: true } });
      const totals = invoice && money ? await invoiceTotals(db, auth.orgId, invoice.id) : undefined;
      const all = await db.query.garments.findMany({ where: and(eq(schema.garments.orderId, id)), columns: { id: true, currentStatus: true } });
      const open = all.filter((g) => !["delivered", "cancelled"].includes(g.currentStatus));
      const read = linked.filter((i) => i.orderId === id);
      return {
        id, orderNumber: order.orderNumber, customerId: order.customerId, customerName: read[0].customerName, invoiceNumber: invoice?.invoiceNumber ?? null,
        ...(money ? { total: totals?.grandTotal ?? order.grandTotal, paid: totals?.paid ?? 0, balance: totals?.balance ?? 0 } : {}),
        tags: read,
        openGarments: open.length,
        missing: open.length - read.length,
        notReady: read.filter((i) => i.stage !== "ready").length,
      };
    })) : [];
    return { orders, others: items.filter((i) => i.state !== "linked") };
  });

  /** Garments of an order still without a tag, so the link screen can move on to the next one by itself. */
  app.get("/rfid/unlinked-count", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.query);
    const garments = await db.select({ id: schema.garments.id }).from(schema.garments).leftJoin(schema.rfidTags, eq(schema.rfidTags.garmentId, schema.garments.id))
      .where(and(eq(schema.garments.organizationId, auth.orgId), eq(schema.garments.orderId, orderId), isNull(schema.rfidTags.id), sql`${schema.garments.currentStatus} not in ('delivered', 'cancelled')`));
    return { count: garments.length };
  });
}
