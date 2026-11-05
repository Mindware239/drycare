/**
 * Tag tracking: every tag and bag label a shop has issued, and the complete record behind any one of them:
 * which customer and order it belongs to, what was charged, and everything that has happened to it.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { invoiceTotals } from "../lib/balances";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { hasFeature } from "../lib/entitlements";
import { notFound } from "../lib/errors";
import { currentMembership } from "../lib/memberships";
import { resolveScanCode } from "../lib/scanLookup";

const seesMoney = (auth: AuthContext) => can(auth, "reports.financial") || can(auth, "payments.collect");
const uuidList = (ids: string[]) => `{${ids.join(",")}}`;
type Event = { id: string; at: Date } & Record<string, unknown>;

/** The garment or bag a scanned or typed code belongs to, with the order it is on. */
async function findLabel(auth: AuthContext, raw: string) {
  const code = await resolveScanCode(db, auth.orgId, raw);
  const garment = await db.query.garments.findFirst({ where: and(eq(schema.garments.organizationId, auth.orgId), eq(schema.garments.tagCode, code)) });
  const bag = garment ? undefined : await db.query.bags.findFirst({ where: and(eq(schema.bags.organizationId, auth.orgId), eq(schema.bags.bagCode, code)) });
  if (!garment && !bag) throw notFound(`Nothing found for "${raw}". This number`);
  const orderId = garment?.orderId ?? bag!.orderId;
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId)) });
  if (!order) throw notFound("Order");
  assertBranchAccess(auth, order.branchId);
  return { garment, bag, order };
}

export async function trackingRoutes(app: FastifyInstance) {
  /** Every tag issued, newest first, with counts for the same search. */
  app.get("/tags", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({
      search: z.string().trim().max(80).default(""),
      status: z.enum(["all", "in_process", "ready", "delivered", "exception", "cancelled"]).default("all"),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const term = `%${q.search}%`;
    const digits = q.search.replace(/\D/g, "");
    const conditions = sql`g.organization_id = ${auth.orgId}
      ${auth.branchIds.length ? sql`and o.branch_id = any(${uuidList(auth.branchIds)}::uuid[])` : sql``}
      ${q.search ? sql`and (g.scan_code ilike ${term} or g.tag_code ilike ${term} or o.order_number ilike ${term} or c.name ilike ${term} or oi.garment_type_name ilike ${term}
        ${digits.length >= 3 ? sql`or c.phone_normalized like ${`%${digits}%`}` : sql``})` : sql``}
      ${q.from ? sql`and g.created_at >= (${q.from}::date)::timestamp at time zone 'Asia/Kolkata'` : sql``}
      ${q.to ? sql`and g.created_at < ((${q.to}::date) + 1)::timestamp at time zone 'Asia/Kolkata'` : sql``}`;
    const statusFilter = q.status === "all" ? sql``
      : q.status === "in_process" ? sql`and g.current_status not in ('ready', 'delivered', 'cancelled', 'exception')`
      : sql`and g.current_status = ${q.status}`;
    const from = sql`from garments g
      join orders o on o.id = g.order_id
      join customers c on c.id = o.customer_id
      join order_items oi on oi.id = g.order_item_id`;
    // What one piece was charged: the line's total shared across the pieces still on it.
    const charge = sql`case when g.current_status = 'cancelled' then 0 else round(oi.line_total::numeric / greatest((select count(*) from garments x where x.order_item_id = g.order_item_id and x.current_status <> 'cancelled'), 1)) end`;
    const [rows, [summary]] = await Promise.all([
      db.execute(sql`
        select g.id, g.scan_code as "scanCode", g.tag_code as "tagCode", g.current_status as status, g.location, g.created_at as "createdAt", g.delivered_at as "deliveredAt",
               o.id as "orderId", o.order_number as "orderNumber", c.id as "customerId", c.name as "customerName", ${can(auth, "customers.read") ? sql`c.phone` : sql`null`} as "customerPhone",
               oi.garment_type_name as garment, oi.service_name as service, oi.colour, sl.code as rack,
               ${seesMoney(auth) ? charge : sql`null`} as charge,
               (select count(*)::int from label_print_jobs j where j.order_id = g.order_id and j.status = 'printed'
                  and (j.scope = 'all' or (j.scope = 'garments' and (j.garment_ids is null or j.garment_ids ? g.id::text)))) as "printCount"
        ${from} left join storage_locations sl on sl.id = g.storage_location_id
        where ${conditions} ${statusFilter}
        order by g.created_at desc, g.scan_code desc
        limit ${q.limit} offset ${q.offset}`),
      db.execute<Record<string, string | number | null>>(sql`
        select count(*)::int as total,
               count(*) filter (where g.current_status not in ('ready', 'delivered', 'cancelled', 'exception'))::int as "inProcess",
               count(*) filter (where g.current_status = 'ready')::int as ready,
               count(*) filter (where g.current_status = 'delivered')::int as delivered,
               count(*) filter (where g.current_status = 'exception')::int as exception,
               ${seesMoney(auth) ? sql`coalesce(sum(${charge}), 0)` : sql`null`} as sales
        ${from} where ${conditions}`),
    ]);
    return { rows, summary: { ...summary, sales: summary.sales === null ? null : Number(summary.sales) } };
  });

  /** The complete record behind one barcode. */
  app.get("/tags/trace", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { code } = z.object({ code: z.string().trim().min(2).max(80) }).parse(req.query);
    const { garment, bag, order } = await findLabel(auth, code);
    const orgId = auth.orgId;
    const money = seesMoney(auth);

    const [customer, branch, invoice, createdBy, tags, bags] = await Promise.all([
      db.query.customers.findFirst({ where: eq(schema.customers.id, order.customerId), columns: { id: true, name: true, phone: true, customerCode: true } }),
      db.query.branches.findFirst({ where: eq(schema.branches.id, order.branchId), columns: { name: true, branchCode: true } }),
      db.query.invoices.findFirst({ where: eq(schema.invoices.orderId, order.id), columns: { id: true, invoiceNumber: true, grandTotal: true } }),
      db.query.users.findFirst({ where: eq(schema.users.id, order.createdBy), columns: { name: true } }),
      db.execute<{ id: string; bagId: string | null }>(sql`
        select g.id, g.scan_code as "scanCode", g.tag_code as "tagCode", g.current_status as status, g.location, g.bag_id as "bagId", g.created_at as "createdAt",
               oi.garment_type_name as garment, oi.service_name as service, oi.colour, oi.brand, sl.code as rack, rt.epc as rfid
        from garments g join order_items oi on oi.id = g.order_item_id left join storage_locations sl on sl.id = g.storage_location_id left join rfid_tags rt on rt.garment_id = g.id
        where g.order_id = ${order.id} order by g.tag_code`),
      db.execute(sql`
        select b.id, b.scan_code as "scanCode", b.bag_code as "bagCode", b.location, b.created_at as "createdAt",
               (select count(*)::int from garments g where g.bag_id = b.id and g.current_status <> 'cancelled') as pieces
        from bags b where b.order_id = ${order.id} order by b.bag_code`),
    ]);
    const totals = invoice && money ? await invoiceTotals(db, orgId, invoice.id) : undefined;
    const member = (await hasFeature(orgId, "customerMemberships")) ? await currentMembership(db, orgId, order.customerId) : undefined;

    // A bag's history is the history of what is inside it.
    const garmentIds = garment ? [garment.id] : tags.filter((t) => t.bagId === bag!.id).map((t) => t.id);
    const list = uuidList(garmentIds);
    const labelList = uuidList(garment ? [garment.id] : [bag!.id, ...garmentIds]);
    const [statuses, scans, deliveries, prints, rfid] = await Promise.all([
      db.execute<Event>(sql`
        select h.id, h.occurred_at as at, h.previous_status as "from", h.new_status as "to", h.transition_kind as kind, h.notes, h.new_location as location, u.name as actor, g.tag_code as "tagCode"
        from garment_status_history h join garments g on g.id = h.garment_id left join users u on u.id = h.actor_user_id
        where h.garment_id = any(${list}::uuid[])`),
      db.execute<Event>(sql`
        select e.id, e.scanned_at as at, e.step, e.result, e.scanned_code as code, u.name as actor, t.batch_number as batch
        from scan_events e left join users u on u.id = e.scanned_by left join transfer_batches t on t.id = e.batch_id
        where e.organization_id = ${orgId} and (e.garment_id = any(${labelList}::uuid[]) or e.bag_id = any(${labelList}::uuid[]))`),
      db.execute<Event>(sql`
        select distinct ev.id, ev.occurred_at as at, ev.event, ev.notes, u.name as actor
        from delivery_items di join delivery_events ev on ev.delivery_id = di.delivery_id left join users u on u.id = ev.actor_user_id
        where di.garment_id = any(${list}::uuid[])`),
      db.execute<{ id: string; at: Date; scope: string; label_count: number; status: string; error: string | null; garment_ids: string[] | null; actor: string | null }>(sql`
        select j.id, j.created_at as at, j.scope, j.label_count, j.status, j.error, j.garment_ids, u.name as actor
        from label_print_jobs j left join users u on u.id = j.requested_by where j.order_id = ${order.id}`),
      db.execute<Event>(sql`
        select e.id, e.occurred_at as at, e.action, e.epc, e.notes, u.name as actor
        from rfid_events e left join users u on u.id = e.actor_user_id
        where e.garment_id = any(${list}::uuid[]) order by e.occurred_at desc limit 100`),
    ]);
    const printedHere = prints.filter((p) => {
      if (p.scope === "all") return true;
      if (p.scope === "bag") return !garment;
      if (!garment) return false;
      return !p.garment_ids || p.garment_ids.includes(garment.id);
    });
    const timeline = [
      ...statuses.map((s) => ({ type: "status" as const, ...s })),
      ...scans.map((s) => ({ type: "scan" as const, ...s })),
      ...deliveries.map((d) => ({ type: "delivery" as const, ...d })),
      ...rfid.map((e) => ({ type: "rfid" as const, ...e })),
      ...printedHere.map((p) => ({ type: "print" as const, id: p.id, at: p.at, scope: p.scope, labels: p.label_count, status: p.status, error: p.error, actor: p.actor })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return {
      kind: garment ? "garment" : "bag",
      label: garment ? { id: garment.id, scanCode: garment.scanCode, code: garment.tagCode } : { id: bag!.id, scanCode: bag!.scanCode, code: bag!.bagCode },
      customer: customer && { id: customer.id, name: customer.name, code: customer.customerCode, phone: can(auth, "customers.read") ? customer.phone : null },
      membership: member ? { planName: member.planName, discountBps: member.discountBps, freeExpress: member.freeExpress, perks: member.perks, endsAt: member.endsAt } : null,
      order: {
        id: order.id, orderNumber: order.orderNumber, status: order.operationalStatus, receivedAt: order.receivedAt, promisedAt: order.promisedAt, express: order.express,
        branchName: branch?.name ?? null, branchCode: branch?.branchCode ?? null, createdBy: createdBy?.name ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        ...(money ? { total: totals?.grandTotal ?? order.grandTotal, paid: totals?.paid ?? 0, credits: totals?.credits ?? 0, balance: totals?.balance ?? 0, discount: order.discountTotal } : {}),
      },
      tags,
      bags,
      timeline: timeline.slice(0, 300),
    };
  });

  /** Records that staff scanned a label at the scan station, even when nothing about it changed. */
  app.post("/tags/scans", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { code } = z.object({ code: z.string().trim().min(2).max(80) }).parse(req.body);
    const { garment, bag } = await findLabel(auth, code);
    await db.insert(schema.scanEvents).values({ organizationId: auth.orgId, step: "lookup", scannedCode: code, garmentId: garment?.id ?? null, bagId: bag?.id ?? null, result: "found", scannedBy: auth.userId });
    return { recorded: true };
  });
}
