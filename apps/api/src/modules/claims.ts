/**
 * Customer claims: damaged, lost or badly finished garments and other complaints.
 * Reported at the counter, investigated, decided by a manager, then settled by wallet credit,
 * a compensation payment (recorded as an expense) or a free re-clean. Every step is on an append-only timeline.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CLAIM_KINDS, CLAIM_RESOLUTIONS, claimDecisionSchema, claimSettleSchema, createClaimSchema } from "@drycare/shared";
import { db, schema, type DbOrTx, type Tx } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit, emit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors";
import { nextNumber, pad } from "../lib/sequences";
import { walletEntry } from "../lib/wallet";
import { assertDrawerCash, openShiftFor } from "./payments";

const uuid = z.uuid();
const ACTIVE = ["open", "investigating", "approved"];
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function lockClaim(tx: Tx, auth: AuthContext, id: string) {
  const [c] = await tx.select().from(schema.claims).where(and(eq(schema.claims.id, id), eq(schema.claims.organizationId, auth.orgId))).for("update");
  if (!c) throw notFound("Claim");
  assertBranchAccess(auth, c.branchId);
  return c;
}

async function event(tx: Tx, auth: AuthContext, claimId: string, e: { kind: string; fromStatus?: string; toStatus?: string; amount?: number; note?: string | null }) {
  await tx.insert(schema.claimEvents).values({ organizationId: auth.orgId, claimId, kind: e.kind, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, amount: e.amount ?? null, note: e.note ?? null, createdBy: auth.userId });
}

async function claimDetail(tx: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await tx.execute<Record<string, any>>(sql`
    select cl.*, cl.claim_number as "claimNumber", cl.branch_id as "branchId", cl.customer_id as "customerId", cl.order_id as "orderId", cl.garment_id as "garmentId",
           cl.exception_id as "exceptionId", cl.customer_ask as "customerAsk", cl.approved_amount as "approvedAmount", cl.decision_note as "decisionNote",
           cl.decided_at as "decidedAt", cl.settled_at as "settledAt", cl.created_at as "createdAt", cl.expense_id as "expenseId", cl.wallet_entry_id as "walletEntryId",
           c.name as "customerName", c.phone as "customerPhone", o.order_number as "orderNumber", o.created_at as "orderDate",
           g.tag_code as "tagCode", oi.garment_type_name as "garmentType", round(oi.line_total::numeric / greatest(oi.quantity, 1)) as "garmentLineTotal", b.name as "branchName", b.branch_code as "branchCode",
           cu.name as "createdByName", du.name as "decidedByName", su.name as "settledByName"
    from claims cl join customers c on c.id = cl.customer_id join branches b on b.id = cl.branch_id
    left join orders o on o.id = cl.order_id left join garments g on g.id = cl.garment_id left join order_items oi on oi.id = g.order_item_id
    left join users cu on cu.id = cl.created_by left join users du on du.id = cl.decided_by left join users su on su.id = cl.settled_by
    where cl.id = ${id} and cl.organization_id = ${auth.orgId}`);
  if (!c) throw notFound("Claim");
  assertBranchAccess(auth, c.branchId);
  const events = await tx.select({
    id: schema.claimEvents.id, kind: schema.claimEvents.kind, fromStatus: schema.claimEvents.fromStatus, toStatus: schema.claimEvents.toStatus,
    amount: schema.claimEvents.amount, note: schema.claimEvents.note, createdAt: schema.claimEvents.createdAt, by: schema.users.name,
  }).from(schema.claimEvents).leftJoin(schema.users, eq(schema.users.id, schema.claimEvents.createdBy))
    .where(eq(schema.claimEvents.claimId, id)).orderBy(asc(schema.claimEvents.createdAt), asc(schema.claimEvents.id));
  const garments = c.orderId
    ? await tx.execute(sql`select g.id, g.tag_code as "tagCode", oi.garment_type_name as "garmentType" from garments g join order_items oi on oi.id = g.order_item_id where g.order_id = ${c.orderId} order by g.tag_code`)
    : [];
  const pick = Object.fromEntries(Object.entries(c).filter(([k]) => !k.includes("_")));
  return { ...pick, customerAsk: c.customerAsk === null ? null : Number(c.customerAsk), approvedAmount: Number(c.approvedAmount), garmentLineTotal: c.garmentLineTotal === null ? null : Number(c.garmentLineTotal), events, garments };
}

export async function claimRoutes(app: FastifyInstance) {
  app.get("/claims", async (req) => {
    const auth = requirePermission(req, "complaints.manage");
    const q = z.object({
      status: z.enum(["active", "open", "investigating", "approved", "rejected", "settled", "all"]).default("active"),
      customerId: uuid.optional(), orderId: uuid.optional(), search: z.string().trim().max(80).optional(),
    }).parse(req.query);
    const branchFilter = auth.branchIds.length ? sql`and cl.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const statusFilter = q.status === "all" ? sql`` : q.status === "active" ? sql`and cl.status in ('open', 'investigating', 'approved')` : sql`and cl.status = ${q.status}`;
    const like = q.search ? `%${q.search}%` : null;
    return db.execute(sql`
      select cl.id, cl.claim_number as "claimNumber", cl.kind, cl.status, cl.resolution, cl.description, cl.customer_ask as "customerAsk",
             cl.approved_amount as "approvedAmount", cl.created_at as "createdAt", cl.settled_at as "settledAt",
             c.id as "customerId", c.name as "customerName", c.phone as "customerPhone", o.id as "orderId", o.order_number as "orderNumber",
             g.tag_code as "tagCode", oi.garment_type_name as "garmentType", b.branch_code as "branchCode",
             extract(day from now() - cl.created_at)::int as "ageDays"
      from claims cl join customers c on c.id = cl.customer_id join branches b on b.id = cl.branch_id
      left join orders o on o.id = cl.order_id left join garments g on g.id = cl.garment_id left join order_items oi on oi.id = g.order_item_id
      where cl.organization_id = ${auth.orgId} ${branchFilter} ${statusFilter}
        ${q.customerId ? sql`and cl.customer_id = ${q.customerId}` : sql``} ${q.orderId ? sql`and cl.order_id = ${q.orderId}` : sql``}
        ${like ? sql`and (cl.claim_number ilike ${like} or c.name ilike ${like} or c.phone ilike ${like} or o.order_number ilike ${like} or g.tag_code ilike ${like})` : sql``}
      order by case cl.status when 'open' then 0 when 'investigating' then 1 when 'approved' then 2 else 3 end, cl.created_at desc limit 500`);
  });

  app.get("/claims/summary", async (req) => {
    const auth = requirePermission(req, "complaints.manage");
    const branchFilter = auth.branchIds.length ? sql`and branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``;
    const [r] = await db.execute<Record<string, string>>(sql`
      select count(*) filter (where status in ('open', 'investigating')) as pending,
             count(*) filter (where status = 'approved') as "toSettle",
             count(*) filter (where status in ('open', 'investigating') and created_at < now() - interval '3 days') as "olderThan3Days",
             coalesce(sum(approved_amount) filter (where status = 'settled' and settled_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0) as "paidThisMonth",
             count(*) filter (where created_at >= now() - interval '90 days') as "last90Days"
      from claims where organization_id = ${auth.orgId} ${branchFilter}`);
    const byKind = await db.execute<{ kind: string; count: number }>(sql`
      select kind, count(*)::int as count from claims where organization_id = ${auth.orgId} ${branchFilter} and created_at >= now() - interval '90 days' group by kind order by count desc`);
    return { pending: Number(r.pending), toSettle: Number(r.toSettle), olderThan3Days: Number(r.olderThan3Days), paidThisMonth: Number(r.paidThisMonth), last90Days: Number(r.last90Days), byKind };
  });

  app.get("/claims/:id", async (req) => {
    const auth = requirePermission(req, "complaints.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    return claimDetail(db, auth, id);
  });

  app.post("/claims", async (req, reply) => {
    const auth = requirePermission(req, "complaints.manage");
    const body = createClaimSchema.parse(req.body);
    const id = await db.transaction(async (tx) => {
      let { customerId, orderId, garmentId, branchId } = body;
      if (body.exceptionId) {
        const ex = await tx.query.garmentExceptions.findFirst({ where: and(eq(schema.garmentExceptions.id, body.exceptionId), eq(schema.garmentExceptions.organizationId, auth.orgId)) });
        if (!ex) throw notFound("Garment exception");
        if (garmentId && garmentId !== ex.garmentId) throw badRequest("The garment does not match the exception");
        garmentId = ex.garmentId;
      }
      if (garmentId) {
        const g = await tx.query.garments.findFirst({ where: and(eq(schema.garments.id, garmentId), eq(schema.garments.organizationId, auth.orgId)) });
        if (!g) throw notFound("Garment");
        if (orderId && orderId !== g.orderId) throw badRequest("The garment is not part of this order");
        orderId = g.orderId;
      }
      if (orderId) {
        const o = await tx.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId)) });
        if (!o) throw notFound("Order");
        if (customerId && customerId !== o.customerId) throw badRequest("The order belongs to a different customer");
        customerId = o.customerId;
        branchId = o.branchId;
      }
      const customer = await tx.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId!), eq(schema.customers.organizationId, auth.orgId)) });
      if (!customer) throw notFound("Customer");
      branchId ??= auth.branchIds[0];
      if (!branchId) throw badRequest("Choose the branch handling this claim");
      const branch = await tx.query.branches.findFirst({ where: and(eq(schema.branches.id, branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!branch) throw notFound("Branch");
      assertBranchAccess(auth, branchId);
      if (garmentId) {
        const [dup] = await tx.execute<{ claim_number: string }>(sql`select claim_number from claims where garment_id = ${garmentId} and status in ('open', 'investigating', 'approved') limit 1`);
        if (dup) throw conflict(`This garment already has an open claim (${dup.claim_number})`, "CLAIM_EXISTS");
      }
      const seq = await nextNumber(tx, auth.orgId, "claim");
      const [claim] = await tx.insert(schema.claims).values({
        organizationId: auth.orgId, branchId, claimNumber: `CLM-${pad(seq, 5)}`, customerId: customer.id, orderId: orderId ?? null, garmentId: garmentId ?? null,
        exceptionId: body.exceptionId ?? null, kind: body.kind, description: body.description, customerAsk: body.customerAsk ?? null, createdBy: auth.userId,
      }).returning();
      await event(tx, auth, claim.id, { kind: "created", toStatus: "open", amount: body.customerAsk, note: body.description });
      await emit(tx, auth.orgId, "claim.created", { claimId: claim.id, customerId: customer.id, kind: body.kind });
      await audit(tx, req, { action: "claim.created", resourceType: "claim", resourceId: claim.id, after: claim });
      return claim.id;
    });
    reply.code(201);
    return claimDetail(db, auth, id);
  });

  /** Investigation notes. The first note can move a new claim to "investigating". */
  app.post("/claims/:id/notes", async (req, reply) => {
    const auth = requirePermission(req, "complaints.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ note: z.string().trim().min(3, "Write a note").max(1000), startInvestigation: z.boolean().optional() }).parse(req.body);
    await db.transaction(async (tx) => {
      const c = await lockClaim(tx, auth, id);
      if (!ACTIVE.includes(c.status)) throw conflict("This claim is closed");
      if (body.startInvestigation && c.status === "open") {
        await tx.update(schema.claims).set({ status: "investigating", updatedAt: new Date() }).where(eq(schema.claims.id, id));
        await event(tx, auth, id, { kind: "status", fromStatus: "open", toStatus: "investigating", note: body.note });
      } else {
        await event(tx, auth, id, { kind: "note", note: body.note });
      }
      await audit(tx, req, { action: "claim.note", resourceType: "claim", resourceId: id, after: { note: body.note } });
    });
    reply.code(201);
    return claimDetail(db, auth, id);
  });

  /** A manager approves (choosing the compensation) or rejects the claim. */
  app.post("/claims/:id/decision", async (req) => {
    const auth = requirePermission(req, "complaints.manage");
    if (!can(auth, "payments.refund")) throw forbidden("Only a manager can approve or reject a claim");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = claimDecisionSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const c = await lockClaim(tx, auth, id);
      if (c.status !== "open" && c.status !== "investigating") throw conflict("This claim has already been decided");
      const status = body.outcome === "approve" ? "approved" : "rejected";
      const resolution = body.outcome === "approve" ? body.resolution : "none";
      const amount = body.outcome === "approve" && (resolution === "wallet_credit" || resolution === "cash") ? body.amount : 0;
      await tx.update(schema.claims).set({ status, resolution, approvedAmount: amount, decisionNote: body.note, decidedBy: auth.userId, decidedAt: new Date(), updatedAt: new Date() }).where(eq(schema.claims.id, id));
      await event(tx, auth, id, { kind: "decision", fromStatus: c.status, toStatus: status, amount, note: `${status === "approved" ? `Approved — ${CLAIM_RESOLUTIONS[resolution]}${amount ? ` ${rupees(amount)}` : ""}` : "Rejected"}. ${body.note}` });
      await audit(tx, req, { action: `claim.${status}`, resourceType: "claim", resourceId: id, before: { status: c.status }, after: { status, resolution, amount, note: body.note } });
    });
    return claimDetail(db, auth, id);
  });

  /** Carries out an approved decision: credits the wallet, records the compensation paid, or confirms the free re-clean. */
  app.post("/claims/:id/settle", async (req) => {
    const auth = requirePermission(req, "complaints.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = claimSettleSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const c = await lockClaim(tx, auth, id);
      if (c.status !== "approved") throw conflict(c.status === "settled" ? "This claim is already settled" : "Approve the claim before settling it");
      const money = c.resolution === "wallet_credit" || c.resolution === "cash";
      if (money && !can(auth, "payments.refund")) throw forbidden("Only a manager can pay out claim compensation");
      const customer = await tx.query.customers.findFirst({ where: eq(schema.customers.id, c.customerId) });
      let walletEntryId: string | null = null;
      let expenseId: string | null = null;
      let detail: string;
      if (c.resolution === "wallet_credit") {
        const entry = await walletEntry(tx, { orgId: auth.orgId, customerId: c.customerId, branchId: c.branchId, kind: "claim", amount: c.approvedAmount, note: `Claim ${c.claimNumber}`, userId: auth.userId });
        walletEntryId = entry.id;
        detail = `${rupees(c.approvedAmount)} credited to the customer's wallet (balance ${rupees(entry.balanceAfter)})`;
      } else if (c.resolution === "cash") {
        const method = body.method ?? "cash";
        if (method !== "cash" && !body.reference) throw badRequest(`Enter the ${method === "upi" ? "UPI" : "bank"} transaction reference`);
        let shiftId: string | null = null;
        if (method === "cash" && body.paidFromDrawer !== false) {
          const shift = await openShiftFor(tx, auth, c.branchId);
          if (!shift) throw unprocessable("Open a cashier shift at this branch to pay from the cash drawer, or untick “paid from the drawer”", "NO_OPEN_SHIFT");
          await assertDrawerCash(tx, shift, c.approvedAmount);
          shiftId = shift.id;
        }
        const [exp] = await tx.insert(schema.expenses).values({
          organizationId: auth.orgId, branchId: c.branchId, category: "Claims & compensation", amount: c.approvedAmount, method, spentOn: istToday(),
          vendor: customer?.name ?? null, reference: body.reference || c.claimNumber, description: `Compensation for claim ${c.claimNumber} (${CLAIM_KINDS[c.kind as keyof typeof CLAIM_KINDS] ?? c.kind})`,
          shiftId, createdBy: auth.userId,
        }).returning();
        expenseId = exp.id;
        detail = `${rupees(c.approvedAmount)} paid by ${method === "cash" ? "cash" : method === "upi" ? "UPI" : "bank transfer"}${shiftId ? " from the cash drawer" : ""}`;
      } else {
        detail = c.resolution === "reclean" ? "Re-clean / repair done free of charge" : "Closed without compensation";
      }
      await tx.update(schema.claims).set({ status: "settled", settledBy: auth.userId, settledAt: new Date(), walletEntryId, expenseId, updatedAt: new Date() }).where(eq(schema.claims.id, id));
      await event(tx, auth, id, { kind: "settled", fromStatus: "approved", toStatus: "settled", amount: money ? c.approvedAmount : undefined, note: body.note ? `${detail}. ${body.note}` : detail });
      await emit(tx, auth.orgId, "claim.settled", { claimId: id, customerId: c.customerId, resolution: c.resolution, amount: c.approvedAmount });
      await audit(tx, req, { action: "claim.settled", resourceType: "claim", resourceId: id, after: { resolution: c.resolution, amount: c.approvedAmount, walletEntryId, expenseId } });
    });
    return claimDetail(db, auth, id);
  });
}
