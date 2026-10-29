import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { db, schema, type Tx } from "../db/client";
import { conflict } from "./errors";

/**
 * Idempotency for retry-prone writes (orders, payments, refunds). The client sends an
 * Idempotency-Key header; a replay with the same key and body returns the stored response,
 * a replay with a different body is rejected.
 */
export async function withIdempotency<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  orgId: string,
  route: string,
  work: (tx: Tx) => Promise<{ status: number; body: T }>,
): Promise<T> {
  const key = req.headers["idempotency-key"];
  const keyStr = typeof key === "string" && key.length > 0 ? key.slice(0, 120) : undefined;
  const requestHash = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex");

  if (keyStr) {
    const existing = await db.query.idempotencyRecords.findFirst({
      where: and(eq(schema.idempotencyRecords.organizationId, orgId), eq(schema.idempotencyRecords.key, keyStr), eq(schema.idempotencyRecords.route, route)),
    });
    if (existing) {
      if (existing.requestHash !== requestHash) throw conflict("Idempotency key reused with a different request", "IDEMPOTENCY_MISMATCH");
      if (existing.statusCode == null) throw conflict("The original request is still being processed", "IDEMPOTENCY_IN_PROGRESS");
      reply.header("idempotent-replay", "true");
      reply.code(existing.statusCode);
      return existing.response as T;
    }
  }

  const result = await db.transaction(async (tx) => {
    if (keyStr) {
      // Unique index makes a concurrent duplicate fail here and roll back its work.
      await tx.insert(schema.idempotencyRecords).values({ organizationId: orgId, key: keyStr, route, requestHash });
    }
    const out = await work(tx);
    if (keyStr) {
      await tx
        .update(schema.idempotencyRecords)
        .set({ statusCode: out.status, response: out.body as object })
        .where(and(eq(schema.idempotencyRecords.organizationId, orgId), eq(schema.idempotencyRecords.key, keyStr), eq(schema.idempotencyRecords.route, route)));
    }
    return out;
  });
  reply.code(result.status);
  return result.body;
}
