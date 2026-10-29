import type { FastifyRequest } from "fastify";
import type { DbOrTx } from "../db/client";
import { schema } from "../db/client";

export async function audit(
  tx: DbOrTx,
  req: FastifyRequest,
  entry: { action: string; resourceType: string; resourceId?: string; before?: unknown; after?: unknown; orgId?: string; actorUserId?: string },
) {
  await tx.insert(schema.auditLogs).values({
    organizationId: entry.orgId ?? req.auth?.orgId ?? null,
    actorUserId: entry.actorUserId ?? req.auth?.userId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: req.ip,
    requestId: req.id,
  });
}

export async function emit(tx: DbOrTx, orgId: string, eventType: string, payload: Record<string, unknown>) {
  await tx.insert(schema.outboxEvents).values({ organizationId: orgId, eventType, payload });
}
