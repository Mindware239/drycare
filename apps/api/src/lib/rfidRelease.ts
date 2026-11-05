import { and, eq } from "drizzle-orm";
import { schema, type DbOrTx } from "../db/client";

/** Called when a garment leaves or is cancelled: its tag goes back to the pool, ready for the next garment. */
export async function releaseRfidTag(tx: DbOrTx, garmentId: string, orgId: string, actorUserId: string) {
  const [tag] = await tx.update(schema.rfidTags).set({ status: "free", garmentId: null, linkedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.rfidTags.organizationId, orgId), eq(schema.rfidTags.garmentId, garmentId))).returning({ epc: schema.rfidTags.epc });
  if (tag) await tx.insert(schema.rfidEvents).values({ organizationId: orgId, epc: tag.epc, action: "released", garmentId, actorUserId });
}
