/** Customer wallet screens: balance and statement, counter top-ups (real money in), and manager adjustments. */
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { assertBranchAccess, requirePermission } from "../lib/context";
import { audit, emit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { walletBalance, walletEntry } from "../lib/wallet";
import { openShiftFor, paymentRef } from "./payments";

async function customerOf(orgId: string, id: string) {
  const c = await db.query.customers.findFirst({ where: and(eq(schema.customers.id, id), eq(schema.customers.organizationId, orgId)) });
  if (!c) throw notFound("Customer");
  return c;
}

export async function walletRoutes(app: FastifyInstance) {
  app.get("/customers/:id/wallet", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await customerOf(auth.orgId, id);
    const entries = await db.select({
      id: schema.customerWalletEntries.id, kind: schema.customerWalletEntries.kind, amount: schema.customerWalletEntries.amount,
      balanceAfter: schema.customerWalletEntries.balanceAfter, note: schema.customerWalletEntries.note, createdAt: schema.customerWalletEntries.createdAt,
      by: schema.users.name, method: schema.payments.paymentMethod, reference: schema.payments.providerReference,
    }).from(schema.customerWalletEntries)
      .leftJoin(schema.users, eq(schema.users.id, schema.customerWalletEntries.createdBy))
      .leftJoin(schema.payments, eq(schema.payments.id, schema.customerWalletEntries.paymentId))
      .where(eq(schema.customerWalletEntries.customerId, id))
      .orderBy(desc(schema.customerWalletEntries.createdAt), desc(schema.customerWalletEntries.id)).limit(200);
    return { balance: await walletBalance(db, id), entries };
  });

  app.post("/customers/:id/wallet/topups", async (req, reply) => {
    const auth = requirePermission(req, "payments.collect");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      branchId: z.uuid(),
      amount: z.number().int().min(100, "Minimum top-up is ₹1").max(10_000_000),
      method: z.enum(["cash", "upi", "card", "bank_transfer", "wallet", "other"]),
      reference: z.string().trim().max(80).optional(),
      note: z.string().trim().max(200).optional(),
    }).parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const customer = await customerOf(auth.orgId, id);
    if (customer.status !== "active") throw badRequest("This customer is not active");
    if (body.method !== "cash" && body.method !== "wallet" && !body.reference) throw badRequest(`A transaction reference is required for ${body.method.toUpperCase()} payments`);
    const result = await db.transaction(async (tx) => {
      const shift = await openShiftFor(tx, auth, body.branchId);
      // Real money received now, so it is a payment (counted in collections and the drawer) with no invoice yet.
      const [payment] = await tx.insert(schema.payments).values({
        organizationId: auth.orgId, branchId: body.branchId, customerId: id, paymentReference: paymentRef(), paymentMethod: body.method,
        amount: body.amount, providerReference: body.reference || null, status: "succeeded", shiftId: shift?.id, createdBy: auth.userId,
      }).returning();
      const entry = await walletEntry(tx, { orgId: auth.orgId, customerId: id, branchId: body.branchId, kind: "topup", amount: body.amount, paymentId: payment.id, note: body.note ?? null, userId: auth.userId });
      await emit(tx, auth.orgId, "payment.received", { paymentId: payment.id, customerId: id, amount: body.amount, method: body.method });
      await audit(tx, req, { action: "wallet.topup", resourceType: "customer", resourceId: id, after: { amount: body.amount, method: body.method, balance: entry.balanceAfter } });
      return entry;
    });
    reply.code(201);
    return { balance: result.balanceAfter };
  });

  app.post("/customers/:id/wallet/adjustments", async (req, reply) => {
    const auth = requirePermission(req, "payments.refund");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ amount: z.number().int().refine((v) => v !== 0, "Enter an amount").refine((v) => Math.abs(v) <= 10_000_000), reason: z.string().trim().min(8, "Give a reason (at least 8 characters)").max(300) }).parse(req.body);
    await customerOf(auth.orgId, id);
    const entry = await db.transaction(async (tx) => {
      const e = await walletEntry(tx, { orgId: auth.orgId, customerId: id, kind: "adjust", amount: body.amount, note: body.reason, userId: auth.userId });
      await audit(tx, req, { action: "wallet.adjusted", resourceType: "customer", resourceId: id, after: { amount: body.amount, reason: body.reason, balance: e.balanceAfter } });
      return e;
    });
    reply.code(201);
    return { balance: entry.balanceAfter };
  });
}
