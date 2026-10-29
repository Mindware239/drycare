/** Customer wallet (prepaid balance): an append-only ledger with a running balance, written under a customer row lock. */
import { and, desc, eq } from "drizzle-orm";
import { schema, type DbOrTx } from "../db/client";
import { notFound, unprocessable } from "./errors";

export async function walletBalance(tx: DbOrTx, customerId: string) {
  const last = await tx.query.customerWalletEntries.findFirst({
    where: eq(schema.customerWalletEntries.customerId, customerId),
    orderBy: [desc(schema.customerWalletEntries.createdAt), desc(schema.customerWalletEntries.id)],
  });
  return last?.balanceAfter ?? 0;
}

/**
 * Adds a ledger row. Positive amount = money into the wallet, negative = spent/removed.
 * Locks the customer row so two counters can never spend the same balance.
 */
export async function walletEntry(tx: DbOrTx, input: {
  orgId: string; customerId: string; branchId?: string | null; kind: "topup" | "spend" | "refund" | "adjust" | "claim";
  amount: number; paymentId?: string | null; note?: string | null; userId: string;
}) {
  const [customer] = await tx.select({ id: schema.customers.id }).from(schema.customers)
    .where(and(eq(schema.customers.id, input.customerId), eq(schema.customers.organizationId, input.orgId))).for("update");
  if (!customer) throw notFound("Customer");
  const balance = await walletBalance(tx, input.customerId);
  const after = balance + input.amount;
  if (after < 0) throw unprocessable(`Wallet balance is only ₹${(balance / 100).toFixed(2)}`, "WALLET_INSUFFICIENT");
  const [row] = await tx.insert(schema.customerWalletEntries).values({
    organizationId: input.orgId, customerId: input.customerId, branchId: input.branchId ?? null, kind: input.kind,
    amount: input.amount, balanceAfter: after, paymentId: input.paymentId ?? null, note: input.note ?? null, createdBy: input.userId,
  }).returning();
  return row;
}
