import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { collectPaymentSchema, refundSchema, shiftCloseSchema, shiftOpenSchema, type PaymentMethod } from "@drycare/shared";
import { db, schema, type DbOrTx, type Tx } from "../db/client";
import { assertBranchAccess, requirePermission, type AuthContext } from "../lib/context";
import { audit, emit } from "../lib/audit";
import { badRequest, notFound, unprocessable, conflict } from "../lib/errors";
import { withIdempotency } from "../lib/idempotency";
import { invoiceTotals } from "../lib/balances";
import { getOrderDetail } from "./orders";
import { walletEntry } from "../lib/wallet";

export const paymentRef = () => `PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

export async function openShiftFor(tx: Tx, auth: AuthContext, branchId: string) {
  return tx.query.cashierShifts.findFirst({
    where: and(eq(schema.cashierShifts.organizationId, auth.orgId), eq(schema.cashierShifts.userId, auth.userId), eq(schema.cashierShifts.branchId, branchId), eq(schema.cashierShifts.status, "open")),
  });
}

/**
 * Counter payments (cash, UPI QR, card terminal, bank transfer) are recorded as succeeded with the
 * staff-entered reference. Gateway payments will be created as pending and confirmed only by an
 * authenticated webhook (SRS §8.4) — see docs/PROGRESS.md.
 */
export async function recordPayments(
  tx: Tx,
  req: FastifyRequest,
  auth: AuthContext,
  input: { invoiceId: string; branchId: string; customerId: string; balance: number; payments: { amount: number; method: PaymentMethod; reference?: string; awaitingVerification?: boolean }[] },
) {
  const [pendingApproval] = await tx.execute<{ id: string }>(sql`
    select a.id
    from customer_approvals a
    join invoice_items ii on ii.order_item_id = a.order_item_id
    where ii.invoice_id = ${input.invoiceId}
      and a.organization_id = ${auth.orgId}
      and a.status = 'pending'
    limit 1
  `);
  if (pendingApproval) throw unprocessable("Customer approval is required before collecting payment", "CUSTOMER_APPROVAL_REQUIRED");
  const total = input.payments.reduce((s, p) => s + p.amount, 0);
  // Transfers still awaiting verification are not paid yet, but they do reserve the balance they would settle.
  const [{ pending }] = await tx.execute<{ pending: string }>(sql`
    select coalesce(sum(pa.allocated_amount), 0) as pending from payment_allocations pa join payments p on p.id = pa.payment_id
    where pa.invoice_id = ${input.invoiceId} and p.status = 'pending'`);
  if (total > input.balance - Number(pending)) {
    throw unprocessable(Number(pending) > 0 ? `Payment exceeds the outstanding balance after ₹${(Number(pending) / 100).toFixed(2)} awaiting bank verification` : `Payment exceeds the outstanding balance`, "OVERPAYMENT");
  }
  if (input.payments.some((p) => p.awaitingVerification && p.method !== "bank_transfer")) {
    throw badRequest("Only bank transfers can be recorded as awaiting verification");
  }
  const shift = await openShiftFor(tx, auth, input.branchId);
  const created = [];
  for (const p of input.payments) {
    if (p.method === "store_credit" && p.awaitingVerification) throw badRequest("Wallet payments are settled immediately");
    if (p.method !== "cash" && !p.reference?.trim() && p.method !== "wallet" && p.method !== "store_credit") {
      throw badRequest(`A transaction reference is required for ${p.method.toUpperCase()} payments`);
    }
    const [row] = await tx
      .insert(schema.payments)
      .values({
        organizationId: auth.orgId,
        branchId: input.branchId,
        customerId: input.customerId,
        paymentReference: paymentRef(),
        paymentMethod: p.method,
        amount: p.amount,
        providerReference: p.reference?.trim() || null,
        status: p.awaitingVerification ? "pending" : "succeeded",
        shiftId: shift?.id,
        createdBy: auth.userId,
      })
      .returning();
    await tx.insert(schema.paymentAllocations).values({ organizationId: auth.orgId, paymentId: row.id, invoiceId: input.invoiceId, allocatedAmount: p.amount });
    // Paid from the customer's prepaid wallet: take it off the balance in the same transaction (fails if too low).
    if (p.method === "store_credit") await walletEntry(tx, { orgId: auth.orgId, customerId: input.customerId, branchId: input.branchId, kind: "spend", amount: -p.amount, paymentId: row.id, note: "Paid an order", userId: auth.userId });
    if (row.status === "succeeded") await emit(tx, auth.orgId, "payment.received", { paymentId: row.id, customerId: input.customerId, amount: p.amount, method: p.method });
    await audit(tx, req, { action: row.status === "pending" ? "payment.recorded_pending" : "payment.recorded", resourceType: "payment", resourceId: row.id, after: { amount: p.amount, method: p.method, invoiceId: input.invoiceId, status: row.status } });
    created.push(row);
  }
  return created;
}

export async function paymentRoutes(app: FastifyInstance) {
  app.post("/orders/:orderId/payments", async (req, reply) => {
    const auth = requirePermission(req, "payments.collect");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const body = collectPaymentSchema.parse(req.body);
    return withIdempotency(req, reply, auth.orgId, `POST /orders/${orderId}/payments`, async (tx) => {
      const [order] = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId))).for("update");
      if (!order) throw notFound("Order");
      assertBranchAccess(auth, order.branchId);
      const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.orderId, orderId) });
      if (!invoice || invoice.status === "cancelled") throw unprocessable("This order has no open invoice");
      const totals = (await invoiceTotals(tx, auth.orgId, invoice.id))!;
      if (totals.balance <= 0) throw unprocessable("Nothing is due on this order", "NOTHING_DUE");
      await recordPayments(tx, req, auth, { invoiceId: invoice.id, branchId: order.branchId, customerId: order.customerId, balance: totals.balance, payments: body.payments });
      return { status: 201, body: await getOrderDetail(tx, auth.orgId, orderId) };
    });
  });

  app.get("/payments/:paymentId", async (req) => {
    const auth = requirePermission(req, "payments.collect");
    const { paymentId } = z.object({ paymentId: z.uuid() }).parse(req.params);
    const p = await db.query.payments.findFirst({ where: and(eq(schema.payments.id, paymentId), eq(schema.payments.organizationId, auth.orgId)) });
    if (!p) throw notFound("Payment");
    const refunds = await db.query.refunds.findMany({ where: eq(schema.refunds.paymentId, p.id) });
    return { ...p, refunds };
  });

  // FR-PAY-006: refunds reference the original payment, require permission and cannot exceed what remains.
  /** Confirms or rejects a bank transfer that was recorded as awaiting verification. */
  app.post("/payments/:paymentId/verify", async (req) => {
    const auth = requirePermission(req, "payments.collect");
    const { paymentId } = z.object({ paymentId: z.uuid() }).parse(req.params);
    const body = z.object({ outcome: z.enum(["confirmed", "rejected"]), note: z.string().trim().min(3).max(300) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [payment] = await tx.select().from(schema.payments).where(and(eq(schema.payments.id, paymentId), eq(schema.payments.organizationId, auth.orgId))).for("update");
      if (!payment) throw notFound("Payment");
      assertBranchAccess(auth, payment.branchId);
      if (payment.status !== "pending") throw unprocessable(`This payment is already ${payment.status}`, "PAYMENT_NOT_PENDING");
      const status = body.outcome === "confirmed" ? "succeeded" : "failed";
      await tx.update(schema.payments).set({ status }).where(eq(schema.payments.id, paymentId));
      if (status === "succeeded") await emit(tx, auth.orgId, "payment.received", { paymentId, customerId: payment.customerId, amount: payment.amount, method: payment.paymentMethod });
      await audit(tx, req, { action: `payment.${body.outcome}`, resourceType: "payment", resourceId: paymentId, before: { status: "pending" }, after: { status, note: body.note } });
      const [alloc] = await tx.execute<{ order_id: string }>(sql`select i.order_id from payment_allocations pa join invoices i on i.id = pa.invoice_id where pa.payment_id = ${paymentId} limit 1`);
      return alloc ? getOrderDetail(tx, auth.orgId, alloc.order_id) : { ok: true };
    });
  });

  app.post("/payments/:paymentId/refunds", async (req, reply) => {
    const auth = requirePermission(req, "payments.refund");
    const { paymentId } = z.object({ paymentId: z.uuid() }).parse(req.params);
    const body = refundSchema.parse(req.body);
    return withIdempotency(req, reply, auth.orgId, `POST /payments/${paymentId}/refunds`, async (tx) => {
      const [p] = await tx.select().from(schema.payments).where(and(eq(schema.payments.id, paymentId), eq(schema.payments.organizationId, auth.orgId))).for("update");
      if (!p) throw notFound("Payment");
      assertBranchAccess(auth, p.branchId);
      if (p.status !== "succeeded") throw unprocessable("Only succeeded payments can be refunded");
      const [{ refunded }] = await tx.execute<{ refunded: string }>(sql`select coalesce(sum(amount),0) as refunded from refunds where payment_id = ${p.id} and status = 'succeeded'`);
      const remaining = p.amount - Number(refunded);
      if (body.amount > remaining) throw unprocessable(`Refund exceeds the refundable amount on this payment`, "REFUND_TOO_LARGE");
      const alloc = await tx.query.paymentAllocations.findFirst({ where: eq(schema.paymentAllocations.paymentId, p.id) });
      if (!alloc) throw unprocessable("Payment is not allocated to an invoice");
      if (!alloc.invoiceId) throw unprocessable("This payment belongs to a self-service laundry order. Refund it from that laundry order.", "LAUNDRY_PAYMENT");
      const invoiceId = alloc.invoiceId;
      const shift = await openShiftFor(tx, auth, p.branchId);
      const [r] = await tx
        .insert(schema.refunds)
        .values({ organizationId: auth.orgId, paymentId: p.id, invoiceId, amount: body.amount, reason: body.reason, method: p.paymentMethod, approvedBy: auth.userId, shiftId: shift?.id })
        .returning();
      // A refund of a wallet payment goes back into the wallet, not out of the drawer.
      if (p.paymentMethod === "store_credit" && p.customerId) await walletEntry(tx, { orgId: auth.orgId, customerId: p.customerId, branchId: p.branchId, kind: "refund", amount: body.amount, paymentId: p.id, note: `Refund: ${body.reason}`, userId: auth.userId });
      await audit(tx, req, { action: "refund.issued", resourceType: "refund", resourceId: r.id, after: { paymentId: p.id, amount: body.amount, reason: body.reason } });
      const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) });
      return { status: 201, body: await getOrderDetail(tx, auth.orgId, invoice!.orderId) };
    });
  });

  app.get("/invoices/:invoiceId", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { invoiceId } = z.object({ invoiceId: z.uuid() }).parse(req.params);
    const inv = await db.query.invoices.findFirst({ where: and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.organizationId, auth.orgId)) });
    if (!inv) throw notFound("Invoice");
    const items = await db.query.invoiceItems.findMany({ where: eq(schema.invoiceItems.invoiceId, inv.id) });
    const totals = await invoiceTotals(db, auth.orgId, inv.id);
    return { ...inv, items, ...totals };
  });

  // ---------------- cashier shifts (FR-PAY-012)
  app.get("/cashier-shifts/current", async (req) => {
    const auth = requirePermission(req, "payments.collect");
    const shift = await db.query.cashierShifts.findFirst({
      where: and(eq(schema.cashierShifts.organizationId, auth.orgId), eq(schema.cashierShifts.userId, auth.userId), eq(schema.cashierShifts.status, "open")),
    });
    if (!shift) return { shift: null };
    return { shift: { ...shift, ...(await shiftSummary(shift.id, shift.openingCash)) } };
  });

  app.get("/cashier-shifts", async (req) => {
    const auth = requirePermission(req, "shifts.manage");
    return db
      .select({ shift: schema.cashierShifts, userName: schema.users.name, branchCode: schema.branches.branchCode })
      .from(schema.cashierShifts)
      .innerJoin(schema.users, eq(schema.users.id, schema.cashierShifts.userId))
      .innerJoin(schema.branches, eq(schema.branches.id, schema.cashierShifts.branchId))
      .where(eq(schema.cashierShifts.organizationId, auth.orgId))
      .orderBy(desc(schema.cashierShifts.openedAt))
      .limit(50);
  });

  app.post("/cashier-shifts", async (req, reply) => {
    const auth = requirePermission(req, "payments.collect");
    const body = shiftOpenSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const existing = await db.query.cashierShifts.findFirst({ where: and(eq(schema.cashierShifts.organizationId, auth.orgId), eq(schema.cashierShifts.userId, auth.userId), eq(schema.cashierShifts.status, "open")) });
    if (existing) throw conflict("You already have an open shift");
    const [row] = await db.insert(schema.cashierShifts).values({ organizationId: auth.orgId, branchId: body.branchId, userId: auth.userId, openingCash: body.openingCash }).returning();
    await audit(db, req, { action: "shift.opened", resourceType: "cashier_shift", resourceId: row.id, after: { openingCash: body.openingCash } });
    reply.code(201);
    return row;
  });

  app.post("/cashier-shifts/:id/close", async (req) => {
    const auth = requirePermission(req, "payments.collect");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = shiftCloseSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const [shift] = await tx
        .select()
        .from(schema.cashierShifts)
        .where(and(eq(schema.cashierShifts.id, id), eq(schema.cashierShifts.organizationId, auth.orgId), isNull(schema.cashierShifts.closedAt)))
        .for("update");
      if (!shift) throw notFound("Open shift");
      if (shift.userId !== auth.userId && !auth.permissions.has("shifts.manage")) throw badRequest("You can only close your own shift");
      const summary = await shiftSummary(shift.id, shift.openingCash);
      const [closed] = await tx
        .update(schema.cashierShifts)
        .set({ status: "closed", closedAt: new Date(), expectedCash: summary.expectedCash, countedCash: body.countedCash, difference: body.countedCash - summary.expectedCash, notes: body.notes })
        .where(eq(schema.cashierShifts.id, id))
        .returning();
      await audit(tx, req, { action: "shift.closed", resourceType: "cashier_shift", resourceId: id, after: { expected: summary.expectedCash, counted: body.countedCash, difference: closed.difference } });
      return { ...closed, ...summary };
    });
  });

  app.get("/payments/reconciliation", async (req) => {
    const auth = requirePermission(req, "reports.financial");
    const q = z.object({ from: z.iso.date(), to: z.iso.date(), branchId: z.uuid().optional() }).parse(req.query);
    const branch = q.branchId ? sql`and branch_id = ${q.branchId}` : sql``;
    const rows = await db.execute(sql`
      select m.method,
        coalesce((select sum(amount) from payments where organization_id = ${auth.orgId} and status = 'succeeded' and payment_method = m.method
                  and (received_at at time zone 'Asia/Kolkata')::date between ${q.from}::date and ${q.to}::date ${branch}), 0) as collected,
        coalesce((select sum(r.amount) from refunds r join payments p on p.id = r.payment_id where r.organization_id = ${auth.orgId} and r.method = m.method
                  and (r.created_at at time zone 'Asia/Kolkata')::date between ${q.from}::date and ${q.to}::date ${q.branchId ? sql`and p.branch_id = ${q.branchId}` : sql``}), 0) as refunded
      from (values ('cash'),('upi'),('card'),('bank_transfer'),('wallet'),('other')) as m(method)
    `);
    return rows.map((r) => ({ method: r.method, collected: Number(r.collected), refunded: Number(r.refunded), net: Number(r.collected) - Number(r.refunded) }));
  });
}

async function shiftSummary(shiftId: string, openingCash: number, exec: DbOrTx = db) {
  const [r] = await exec.execute<{ cash_in: string; cash_out: string; non_cash: string; count: number; expenses_paid: string }>(sql`
    select coalesce((select sum(amount) from payments where shift_id = ${shiftId} and payment_method = 'cash' and status = 'succeeded'), 0) as cash_in,
           coalesce((select sum(amount) from refunds where shift_id = ${shiftId} and method = 'cash'), 0) as cash_out,
           coalesce((select sum(amount) from payments where shift_id = ${shiftId} and payment_method not in ('cash','store_credit') and status = 'succeeded'), 0) as non_cash,
           (select count(*)::int from payments where shift_id = ${shiftId}) as count,
           coalesce((select sum(amount) from expenses where shift_id = ${shiftId} and voided_at is null), 0) as expenses_paid
  `);
  const cashIn = Number(r.cash_in);
  const cashOut = Number(r.cash_out);
  const cashExpenses = Number(r.expenses_paid);
  return { cashIn, cashOut, cashExpenses, nonCash: Number(r.non_cash), paymentCount: r.count, expectedCash: openingCash + cashIn - cashOut - cashExpenses };
}

/**
 * Cash paid out of the drawer (expenses, supplier bills, claim compensation) can never exceed what is in it.
 * Locks the shift row so two payouts at once cannot both spend the same cash.
 */
export async function assertDrawerCash(tx: Tx, shift: { id: string; openingCash: number }, amount: number) {
  await tx.execute(sql`select id from cashier_shifts where id = ${shift.id} for update`);
  const { expectedCash } = await shiftSummary(shift.id, shift.openingCash, tx);
  if (amount > expectedCash) {
    throw unprocessable(
      `Only ₹${(Math.max(0, expectedCash) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} is in the cash drawer. Untick “paid from the cash drawer” if this was paid from other money.`,
      "DRAWER_SHORT",
    );
  }
}
