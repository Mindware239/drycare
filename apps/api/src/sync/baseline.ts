/**
 * Linking a PC: turn change capture on and queue a one-time snapshot of every existing record, in one transaction.
 * Writers are paused (SHARE locks) for the few seconds this takes, so nothing can slip between the snapshot and
 * live capture. Parent tables are queued before the tables that reference them.
 */
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";

const STRIP = ["password_hash", "token_hash", "otp_hash", "status_token", "photo_data", "logo_data"];

/** Synced tables ordered so referenced tables come first (cycles, if any, keep their catalogue order). */
export async function baselineOrder(db: DB) {
  const tables = (await db.execute<{ table_name: string }>(sql`select table_name from sync_entities order by table_name`)).map((r) => r.table_name);
  const edges = await db.execute<{ child: string; parent: string }>(sql`
    select distinct c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.conrelid <> c.confrelid`);
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const e of edges) if (set.has(e.child) && set.has(e.parent)) deps.get(e.child)!.add(e.parent);
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...deps.get(t)!].every((p) => done.has(p)));
    const next = ready.length ? ready : tables.filter((t) => !done.has(t)).slice(0, 1);
    for (const t of next) { done.add(t); order.push(t); }
  }
  return order;
}

export async function enableCaptureWithBaseline(db: DB, opts: { cloudUrl: string }) {
  const order = await baselineOrder(db);
  const withCreatedAt = new Set((await db.execute<{ t: string }>(sql`select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'created_at'`)).map((r) => r.t));
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`lock table ${order.map((t) => `"${t}"`).join(", ")} in share mode`));
    await tx.execute(sql`update sync_config set capture_enabled = true, cloud_linked = true, cloud_state = 'ok', cloud_url = ${opts.cloudUrl}, linked_at = now(), last_error = null where id = 1`);
    // Changes paused while the PC was not linked (or was revoked) become due straight away.
    await tx.execute(sql`update sync_outbox set next_attempt_at = now() where status in ('pending', 'failed') and next_attempt_at > now() and next_attempt_at <> 'infinity'`);
    let queued = 0;
    for (const table of order) {
      const [{ n }] = await tx.execute<{ n: number }>(sql`${sql.raw(`
        with src as (select to_jsonb(t) - '{${STRIP.join(",")}}'::text[] as r, row_number() over (order by ${withCreatedAt.has(table) ? "t.created_at nulls first, t.id" : "t.id"}) as ord from "${table}" t)`)},
        ins as (
          insert into sync_outbox (organization_id, branch_id, entity_table, entity_id, entity_class, op, row_data, schema_version, device_id, txid, idempotency_key)
          select case when ${table} = 'organizations' then (r->>'id')::uuid else (r->>'organization_id')::uuid end, (r->>'branch_id')::uuid, ${table}, r->>'id',
                 (select entity_class from sync_entities where table_name = ${table}), 'snapshot', r, c.schema_version, c.device_id, txid_current(),
                 md5('baseline:' || ${table} || ':' || (r->>'id') || ':' || txid_current()::text)
          from src, sync_config c where c.id = 1 order by src.ord
          on conflict (idempotency_key) do nothing returning 1)
        select count(*)::int as n from ins`);
      queued += n;
    }
    return { queued, tables: order.length };
  });
}

/** Unlink this PC locally: forget the cloud link and stop capture. Queued events are kept (a re-link re-snapshots). */
export async function disableCapture(db: DB) {
  await db.execute(sql`update sync_config set capture_enabled = false, cloud_linked = false, cloud_state = 'not_linked' where id = 1`);
}
