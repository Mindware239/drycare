/** PC-side sync: status for the top-bar indicator, linking to DryCare Cloud, Sync now, retries and conflict review. */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { isDesktop } from "../env";
import { can, requireAuth, requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { AppError, conflict, notFound } from "../lib/errors";
import { retryFailed, syncStatus } from "../sync/queue";
import { cloudBaseUrl, credentialStore } from "../sync/cloud";
import { cancelLink, startLink, syncNow, syncRuntime, unlinkLocally } from "../sync/worker";

const pcOnly = () => {
  if (!isDesktop) throw new AppError(404, "NOT_FOUND", "Only available in DryCare for Windows");
};

export async function syncRoutes(app: FastifyInstance) {
  app.get("/sync/status", async (req) => {
    const auth = requireAuth(req);
    const s = await syncStatus(db, auth.orgId);
    const rt = syncRuntime();
    const cred = isDesktop ? await credentialStore()?.load() : null;
    const manage = can(auth, "org.manage");
    // Staff see the summary; error details and link codes are for people who can act on them.
    return {
      ...s,
      edition: isDesktop ? "desktop" : "cloud",
      cloudConfigured: isDesktop && !!cloudBaseUrl(),
      credentialExpiresAt: manage ? cred?.credentialExpiresAt ?? null : null,
      linkedBy: manage ? cred?.linkedBy ?? null : null,
      syncing: rt.syncing,
      linking: manage ? rt.link : null,
      lastRun: rt.lastRun,
      deviceId: manage ? s.deviceId : undefined,
      lastError: manage ? s.lastError : null,
    };
  });

  app.post("/sync/cloud-link/start", async (req, reply) => {
    pcOnly();
    requirePermission(req, "org.manage");
    const body = z.object({ deviceName: z.string().trim().max(80).optional() }).parse(req.body ?? {});
    try {
      const l = await startLink(body);
      await audit(db, req, { action: "sync.link_started", resourceType: "sync", after: { userCode: l.userCode } });
      reply.code(201);
      return l;
    } catch (err) {
      throw new AppError(422, "LINK_UNAVAILABLE", (err as Error).message);
    }
  });

  app.post("/sync/cloud-link/cancel", async (req) => {
    pcOnly();
    requirePermission(req, "org.manage");
    cancelLink();
    return { cancelled: true };
  });

  /** Forget the cloud link on this PC (e.g. before re-linking). Business data and queued changes are kept. */
  app.post("/sync/cloud-link/unlink", async (req) => {
    pcOnly();
    requirePermission(req, "org.manage");
    await unlinkLocally();
    await audit(db, req, { action: "sync.unlinked_locally", resourceType: "sync" });
    return { unlinked: true };
  });

  app.post("/sync/now", async (req) => {
    pcOnly();
    requirePermission(req, "org.manage");
    const r = await syncNow({ manual: true });
    if (!r.started && r.reason === "not_linked") throw new AppError(422, "NOT_LINKED", "This PC is not linked to DryCare Cloud yet.");
    if (!r.started && r.reason === "restored") throw new AppError(409, "RESTORED_PAUSED", "Uploads are paused because this PC was restored from a backup. Check the cloud copy with DryCare support, then link again.");
    return r;
  });

  app.get("/sync/conflicts", async (req) => {
    const auth = requirePermission(req, "org.manage");
    return db.execute(sql`
      select c.id, c.entity_table as "entityTable", c.entity_id as "entityId", c.entity_class as "entityClass", c.reason, c.status,
             c.local_data as "localData", c.remote_data as "remoteData", c.created_at as "createdAt",
             (select count(*)::int from sync_outbox o where o.entity_table = c.entity_table and o.entity_id = c.entity_id and o.status in ('pending', 'failed')) as "heldChanges"
      from sync_conflicts c where (c.organization_id = ${auth.orgId} or c.organization_id is null) and c.status = 'open'
      order by c.created_at desc limit 200`);
  });

  /**
   * Owner decision on one conflict. Nothing is overwritten automatically:
   *  - "retry": send this change again (after the cloud copy was corrected by support);
   *  - "skip": do not upload this change; the cloud keeps its version and later changes to the record flow again.
   */
  app.post("/sync/conflicts/:id/resolve", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ action: z.enum(["retry", "skip"]), note: z.string().trim().min(3, "Say why").max(300) }).parse(req.body);
    await db.transaction(async (tx) => {
      const [c] = await tx.execute<{ outbox_id: string; status: string }>(sql`select outbox_id, status from sync_conflicts where id = ${id} and (organization_id = ${auth.orgId} or organization_id is null) for update`);
      if (!c) throw notFound("Conflict");
      if (c.status !== "open") throw conflict("This conflict is already resolved");
      // One PC change is uploaded as a unit, so the decision covers every conflicting record of that same change.
      const scope = sql`(o.id = ${c.outbox_id} or (o.op <> 'snapshot' and o.status = 'conflict' and o.txid = (select txid from sync_outbox where id = ${c.outbox_id})))`;
      await tx.execute(sql`update sync_conflicts k set status = 'resolved', resolution = ${`${body.action}: ${body.note}`}, resolved_by = ${auth.userId}, resolved_at = now()
        from sync_outbox o where k.outbox_id = o.id and k.status = 'open' and ${scope}`);
      await tx.execute(body.action === "retry"
        ? sql`update sync_outbox o set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null where ${scope}`
        : sql`update sync_outbox o set status = 'skipped', last_error = ${`Skipped by owner: ${body.note}`} where ${scope}`);
      await audit(tx, req, { action: `sync.conflict_${body.action}`, resourceType: "sync_conflict", resourceId: id, after: { note: body.note } });
    });
    return { resolved: true };
  });

  app.post("/sync/retry", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const retried = await retryFailed(db, auth.orgId);
    await audit(db, req, { action: "sync.retry_failed", resourceType: "sync", after: { retried } });
    return { retried };
  });
}
