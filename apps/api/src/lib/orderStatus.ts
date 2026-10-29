import { eq, sql } from "drizzle-orm";
import { deriveOrderStatus, type GarmentStage, type OrderStatus } from "@drycare/shared";
import { schema, type Tx } from "../db/client";
import { emit } from "./audit";

/** Recomputes the order's derived operational status after any garment change, inside the same transaction. */
export async function refreshOrderStatus(tx: Tx, orgId: string, orderId: string): Promise<OrderStatus> {
  const rows = await tx.select({ s: schema.garments.currentStatus }).from(schema.garments).where(eq(schema.garments.orderId, orderId));
  const status = deriveOrderStatus(rows.map((r) => r.s as GarmentStage));
  const [before] = await tx.select({ s: schema.orders.operationalStatus, customerId: schema.orders.customerId }).from(schema.orders).where(eq(schema.orders.id, orderId)).for("update");
  if (before.s === status) return status;
  await tx
    .update(schema.orders)
    .set({
      operationalStatus: status,
      readyAt: status === "ready" ? sql`coalesce(${schema.orders.readyAt}, now())` : undefined,
      closedAt: status === "delivered" ? new Date() : undefined,
      updatedAt: new Date(),
      version: sql`${schema.orders.version} + 1`,
    })
    .where(eq(schema.orders.id, orderId));
  if (status === "ready" || status === "partially_ready" || status === "delivered") {
    await emit(tx, orgId, `order.${status}`, { orderId, customerId: before.customerId });
  }
  return status;
}

export async function recordGarmentTransition(
  tx: Tx,
  g: { id: string; organizationId: string; currentStatus: string; currentBranchId: string; location?: string },
  to: GarmentStage,
  kind: string,
  actorUserId: string,
  extra: { notes?: string; correlationId?: string; set?: Partial<typeof schema.garments.$inferInsert> } = {},
) {
  // Optimistic concurrency: the update only applies if nobody moved the garment in the meantime.
  const updated = await tx
    .update(schema.garments)
    .set({ currentStatus: to, updatedAt: new Date(), version: sql`${schema.garments.version} + 1`, ...extra.set })
    .where(sql`${schema.garments.id} = ${g.id} and ${schema.garments.currentStatus} = ${g.currentStatus}`)
    .returning({ id: schema.garments.id });
  if (updated.length === 0) return false;
  await tx.insert(schema.garmentStatusHistory).values({
    organizationId: g.organizationId,
    garmentId: g.id,
    previousStatus: g.currentStatus,
    newStatus: to,
    transitionKind: kind,
    previousLocation: extra.set?.location ? g.location ?? null : null,
    newLocation: extra.set?.location ?? null,
    actorUserId,
    branchId: g.currentBranchId,
    notes: extra.notes,
    correlationId: extra.correlationId,
  });
  return true;
}
