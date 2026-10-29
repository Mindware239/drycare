/**
 * Local sync queue (phase 2). Events are written by the `drycare_sync_capture` trigger in the same
 * transaction as each business change (migration 0027). This module only reads and updates queue state.
 *
 * Crash safety: an event is claimed with a short lease ("sending") before it is pushed. If the app stops
 * mid-push the lease expires and the event is pushed again; the cloud de-duplicates by event id, so a
 * retry never creates a second order, payment or stock movement.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { SyncEvent, SyncResult, SyncTransport } from "./transport";
import { SyncHold } from "./httpTransport";

/** Tables that are never synchronised (security, device-local state, platform billing). */
export const LOCAL_ONLY_TABLES = [
  "audit_logs", "auth_tokens", "sessions", "idempotency_records", "number_sequences", "outbox_events", "notification_jobs",
  "label_print_jobs", "desktop_licenses", "platform_settings", "public_leads", "commercial_invoices", "commercial_payments",
  "commercial_plans", "commercial_subscriptions", "sync_config", "sync_entities", "sync_outbox", "sync_conflicts",
  // cloud side of sync
  "sync_devices", "sync_link_requests", "sync_applied_events", "sync_entity_state", "sync_batches", "sync_remote_conflicts", "sync_shadow_users", "sync_staged_events",
] as const;

const LEASE_SECONDS = 120;
const MAX_AUTO_ATTEMPTS = 8;
/** 30 s, 1 min, 2 min … capped at 1 h, with ±20 % jitter so many PCs coming back online do not retry in step. */
export const backoffSeconds = (attempts: number) => Math.round(Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1)) * (0.8 + Math.random() * 0.4));
/** Acknowledged events are kept this long on the PC for support, then removed. */
export const KEEP_SYNCED_DAYS = 30;

export async function setCapture(db: DbOrTx, enabled: boolean) {
  await db.execute(sql`update sync_config set capture_enabled = ${enabled}, updated_at = now() where id = 1 and capture_enabled is distinct from ${enabled}`);
}

export async function setSchemaVersion(db: DbOrTx, version: string) {
  await db.execute(sql`update sync_config set schema_version = ${version} where id = 1 and schema_version is distinct from ${version}`);
}

export async function syncStatus(db: DbOrTx, orgId: string) {
  const [cfg] = await db.execute<Record<string, unknown>>(sql`select capture_enabled, device_id, cloud_linked, cloud_state, cloud_url, linked_at, last_attempt_at, last_success_at, last_error from sync_config where id = 1`);
  const [c] = await db.execute<Record<string, string | null>>(sql`
    select count(*) filter (where status in ('pending', 'sending', 'staged')) as pending,
           count(*) filter (where status = 'failed') as failed,
           count(*) filter (where status = 'conflict') as conflict,
           count(*) filter (where status = 'synced') as synced,
           min(created_at) filter (where status in ('pending', 'sending', 'failed')) as oldest_pending,
           max(last_error) filter (where status = 'failed') as last_error
    from sync_outbox where organization_id = ${orgId} or organization_id is null`);
  const [k] = await db.execute<{ open: string }>(sql`select count(*) as open from sync_conflicts where status = 'open' and (organization_id = ${orgId} or organization_id is null)`);
  return {
    captureEnabled: Boolean(cfg?.capture_enabled),
    cloudLinked: Boolean(cfg?.cloud_linked),
    cloudState: (cfg?.cloud_state as string) ?? "not_linked",
    linkedAt: (cfg?.linked_at as string | null) ?? null,
    deviceId: cfg?.device_id as string,
    pending: Number(c.pending),
    failed: Number(c.failed),
    conflicts: Number(k.open),
    synced: Number(c.synced),
    oldestPendingAt: c.oldest_pending,
    lastAttemptAt: (cfg?.last_attempt_at as string | null) ?? null,
    lastSuccessAt: (cfg?.last_success_at as string | null) ?? null,
    lastError: c.last_error ?? ((cfg?.last_error as string | null) ?? null),
  };
}

/**
 * Claims the next due events in local order. Holds back a record's later changes while an earlier change to it is in
 * conflict or waiting out a retry delay, so changes to one record are never applied out of order. (An earlier change
 * that is due now is claimed in the same, ordered batch.)
 *
 * Events of one PC transaction (txid) are kept together: a batch never ends part-way through a change unless that
 * single change is larger than a batch. Such a change is sent in parts tagged with `groupSize`/`groupFinal`; the
 * cloud holds the parts and applies them together when the last one arrives. Snapshot events are independent.
 */
export async function claimBatch(db: DbOrTx, limit = 200): Promise<SyncEvent[]> {
  const claimed = await db.transaction(async (tx) => {
    const cand = await tx.execute<{ id: string; seq: string; txid: string; op: string }>(sql`
      select o.id, o.seq, o.txid, o.op from sync_outbox o
      where (o.status in ('pending', 'failed') and o.next_attempt_at <= now() and o.attempts < ${MAX_AUTO_ATTEMPTS}
             or o.status = 'sending' and o.lease_until < now())
        and not exists (select 1 from sync_outbox b where b.entity_table = o.entity_table and b.entity_id = o.entity_id and b.seq < o.seq
                        and (b.status = 'conflict' or b.status = 'failed' and (b.next_attempt_at > now() or b.attempts >= ${MAX_AUTO_ATTEMPTS})))
      order by o.seq
      limit ${limit}
      for update skip locked`);
    if (!cand.length) return [];
    let ids = cand.map((c) => c.id);
    const last = cand[cand.length - 1];
    if (last.op !== "snapshot") {
      const [{ n }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from sync_outbox where txid = ${last.txid} and op <> 'snapshot'
        and status in ('pending', 'failed', 'sending') and id <> all(${uuidList(ids)}::uuid[])`);
      const others = cand.filter((c) => c.txid !== last.txid || c.op === "snapshot");
      // The last change continues beyond this batch: leave it whole for the next batch, unless it is the only one.
      if (n > 0 && others.length) ids = others.map((c) => c.id);
    }
    return tx.execute<Record<string, unknown>>(sql`
      update sync_outbox o set status = 'sending', lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), attempts = o.attempts + 1
      where o.id = any(${uuidList(ids)}::uuid[])
      returning o.id, o.seq, o.organization_id, o.branch_id, o.entity_table, o.entity_id, o.entity_class, o.op, o.row_data,
                o.schema_version, o.device_id, o.txid, o.idempotency_key, o.created_at`);
  });
  const events: SyncEvent[] = claimed
    .map((r) => ({
      id: r.id as string, seq: Number(r.seq), organizationId: r.organization_id as string | null, branchId: r.branch_id as string | null,
      entityTable: r.entity_table as string, entityId: r.entity_id as string, entityClass: r.entity_class as SyncEvent["entityClass"],
      op: r.op as SyncEvent["op"], rowData: r.row_data as SyncEvent["rowData"], schemaVersion: r.schema_version as string,
      deviceId: r.device_id as string, txid: Number(r.txid), idempotencyKey: r.idempotency_key as string, createdAt: String(r.created_at),
    }))
    .sort((a, b) => a.seq - b.seq);
  // Tag changes that are split across uploads.
  const txids = [...new Set(events.filter((e) => e.op !== "snapshot").map((e) => e.txid))];
  for (const t of txids) {
    const inBatch = events.filter((e) => e.txid === t && e.op !== "snapshot");
    const [g] = await db.execute<{ size: number; unsent: number }>(sql`select count(*)::int as size,
      count(*) filter (where status in ('pending', 'failed') or status = 'sending' and id <> all(${uuidList(inBatch.map((e) => e.id))}::uuid[]))::int as unsent
      from sync_outbox where txid = ${t} and op <> 'snapshot'`);
    if (g.size > inBatch.length) for (const e of inBatch) { e.groupSize = g.size; e.groupFinal = g.unsent === 0; }
  }
  return events;
}

const uuidList = (ids: string[]) => `{${ids.join(",")}}`;

/**
 * Stores the cloud's answer for each event, including events of earlier uploads (parts of a large change held by
 * the cloud) that the cloud reports when the change completes. Conflicts are recorded for review, never overwritten.
 */
export async function recordResults(db: DbOrTx, events: SyncEvent[], results: SyncResult[]) {
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const e of events) {
    if (!byId.has(e.id)) {
      // No answer for this event: release it for a later retry.
      await db.execute(sql`update sync_outbox set status = 'failed', last_error = 'No response for this change', lease_until = null,
        next_attempt_at = now() + make_interval(secs => ${backoffSeconds(1)}) where id = ${e.id} and status = 'sending'`);
    }
  }
  const known = new Map(events.map((e) => [e.id, e]));
  for (const r of results) {
    let e = known.get(r.id);
    if (!e) {
      // An earlier part of a large change, settled now that the whole change was applied in the cloud.
      const [row] = await db.execute<Record<string, unknown>>(sql`select id, organization_id, entity_table, entity_id, entity_class, row_data, txid from sync_outbox where id = ${r.id} and status = 'staged'`);
      if (!row) continue;
      e = { id: r.id, organizationId: row.organization_id as string | null, entityTable: row.entity_table as string, entityId: row.entity_id as string, entityClass: row.entity_class as SyncEvent["entityClass"], rowData: row.row_data as SyncEvent["rowData"], txid: Number(row.txid) } as SyncEvent;
    }
    if (r.outcome === "applied" || r.outcome === "duplicate" || r.outcome === "stale") {
      await db.execute(sql`update sync_outbox set status = 'synced', synced_at = now(), lease_until = null, last_error = null where id = ${e.id}`);
    } else if (r.outcome === "staged") {
      await db.execute(sql`update sync_outbox set status = 'staged', lease_until = null, last_error = null where id = ${e.id}`);
    } else if (r.outcome === "conflict") {
      await db.execute(sql`update sync_outbox set status = 'conflict', lease_until = null, last_error = ${r.reason} where id = ${e.id}`);
      await db.execute(sql`insert into sync_conflicts (organization_id, outbox_id, entity_table, entity_id, entity_class, reason, local_data, remote_data)
        select ${e.organizationId}, ${e.id}, ${e.entityTable}, ${e.entityId}, ${e.entityClass}, ${r.reason}, ${JSON.stringify(e.rowData)}::jsonb, ${JSON.stringify(r.remoteData ?? null)}::jsonb
        where not exists (select 1 from sync_conflicts where outbox_id = ${e.id} and status = 'open')`);
    } else {
      if (r.retryable && r.message.startsWith("GROUP_INCOMPLETE")) {
        // The cloud is missing parts of this change: send the whole change again (parts it holds are recognised).
        await db.execute(sql`update sync_outbox set status = 'pending', attempts = 0, lease_until = null, next_attempt_at = now() where txid = ${e.txid} and status in ('staged', 'sending')`);
        continue;
      }
      const [{ attempts }] = await db.execute<{ attempts: number }>(sql`select attempts from sync_outbox where id = ${e.id}`);
      await db.execute(sql`update sync_outbox set status = 'failed', lease_until = null, last_error = ${r.message.slice(0, 500)},
        next_attempt_at = case when ${r.retryable} then now() + make_interval(secs => ${backoffSeconds(Number(attempts))}) else 'infinity'::timestamptz end
        where id = ${e.id}`);
    }
  }
}

/**
 * One processing round. Returns counts. With no transport configured (phase 2) nothing is sent and
 * events stay pending — they are kept safely until the cloud connection exists.
 */
export async function processQueue(db: DbOrTx, transport: SyncTransport | null, opts: { batchSize?: number } = {}) {
  if (!transport) return { sent: 0, synced: 0, conflicts: 0, failed: 0, skipped: true as const };
  const events = await claimBatch(db, opts.batchSize ?? 200);
  if (!events.length) return { sent: 0, synced: 0, conflicts: 0, failed: 0, skipped: false as const };
  await db.execute(sql`update sync_config set last_attempt_at = now() where id = 1`);
  let results: SyncResult[];
  try {
    results = await transport.push(events);
  } catch (err) {
    if (err instanceof SyncHold) {
      // Not these events' fault: put them back untouched (attempt not counted) and pause the queue.
      await db.execute(sql`update sync_outbox set status = case when attempts > 1 then 'failed' else 'pending' end, attempts = greatest(attempts - 1, 0), lease_until = null,
        next_attempt_at = now() + make_interval(secs => ${err.retryAfterSeconds}) where id = any(${`{${events.map((e) => e.id).join(",")}}`}::uuid[]) and status = 'sending'`);
      if (err.state !== "rate_limited") await db.execute(sql`update sync_config set cloud_state = ${err.state}, last_error = ${err.message.slice(0, 500)} where id = 1`);
      return { sent: events.length, synced: 0, conflicts: 0, failed: 0, skipped: false as const, hold: err.state };
    }
    const message = err instanceof Error ? err.message : String(err);
    await db.execute(sql`update sync_config set cloud_state = 'offline' where id = 1 and cloud_state = 'ok'`);
    results = events.map((e) => ({ id: e.id, outcome: "error" as const, message, retryable: true }));
    await db.execute(sql`update sync_config set last_error = ${message.slice(0, 500)} where id = 1`);
  }
  await recordResults(db, events, results);
  const synced = results.filter((r) => r.outcome === "applied" || r.outcome === "duplicate" || r.outcome === "stale").length;
  const staged = results.filter((r) => r.outcome === "staged").length;
  if (synced > 0) await db.execute(sql`update sync_config set cloud_state = 'ok' where id = 1 and cloud_state in ('offline', 'plan_required', 'schema_too_new')`);
  if (synced > 0 && synced + staged >= events.length) await db.execute(sql`update sync_config set last_success_at = now(), last_error = null where id = 1`);
  return { sent: events.length, synced, staged, conflicts: results.filter((r) => r.outcome === "conflict").length, failed: results.filter((r) => r.outcome === "error").length, skipped: false as const };
}

/** Owner action: try failed events again now (including ones that hit the automatic retry limit). */
export async function retryFailed(db: DbOrTx, orgId: string) {
  const rows = await db.execute(sql`update sync_outbox set status = 'pending', attempts = 0, next_attempt_at = now(), lease_until = null
    where status = 'failed' and (organization_id = ${orgId} or organization_id is null) returning id`);
  return rows.length;
}

/** Removes acknowledged events older than the keep period (never ones a conflict record points to). */
export async function pruneSynced(db: DbOrTx, days = KEEP_SYNCED_DAYS) {
  const rows = await db.execute(sql`delete from sync_outbox o where o.status in ('synced', 'skipped') and coalesce(o.synced_at, o.created_at) < now() - make_interval(days => ${days})
    and not exists (select 1 from sync_conflicts c where c.outbox_id = o.id) returning o.id`);
  return rows.length;
}
