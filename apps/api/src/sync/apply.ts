/**
 * Cloud side of sync: applies a pushed batch from one linked shop PC inside one database transaction.
 *
 * Rules (docs/DESKTOP_CLOUD_PLAN.md §7.3):
 *  - The organisation comes from the authenticated device, never from the event. Every row, and every row it
 *    references, must belong to that organisation.
 *  - Events of one PC transaction (`txid`) are applied together in a savepoint: all or nothing.
 *  - Replayed events (same id, same payload) are acknowledged as duplicates; an event id reused with a
 *    different payload is refused.
 *  - Out-of-order and stale updates are acknowledged without being applied. A record that differs from what
 *    sync last wrote (or a money record that already exists with different content) is a conflict: it is
 *    reported back and never overwritten. Timestamps never decide money conflicts.
 *  - After each group the server re-checks payment, invoice, refund and wallet totals itself.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client";
import { invoiceCreditSql, invoicePaidSql, uuidArray } from "../lib/balances";
import type { SyncResult } from "./transport";

export const MAX_EVENTS_PER_BATCH = 500;

export const syncEventSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  organizationId: z.uuid().nullable(),
  branchId: z.uuid().nullable(),
  entityTable: z.string().regex(/^[a-z_]{1,63}$/),
  entityId: z.string().min(1).max(64),
  entityClass: z.enum(["ledger", "financial", "operational", "master"]),
  op: z.enum(["insert", "update", "delete", "snapshot"]),
  rowData: z.record(z.string(), z.unknown()).nullable(),
  schemaVersion: z.string().max(80),
  deviceId: z.uuid(),
  txid: z.number().int(),
  idempotencyKey: z.string().max(80),
  createdAt: z.string().max(40),
  /** Present when one PC change is split across uploads (see stageLargeChanges). */
  groupSize: z.number().int().positive().max(200_000).optional(),
  groupFinal: z.boolean().optional(),
});
export const pushRequestSchema = z.object({
  batchId: z.uuid(),
  schemaVersion: z.string().max(80),
  appVersion: z.string().max(40).optional(),
  events: z.array(syncEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type PushEvent = z.infer<typeof syncEventSchema>;

/** Stable JSON (sorted keys) so the same row always hashes the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const eventPayloadHash = (e: Pick<PushEvent, "entityTable" | "entityId" | "op" | "rowData">) =>
  sha256(stableStringify({ t: e.entityTable, id: e.entityId, op: e.op, row: e.rowData }));

/** Schema tags look like "0027_sync_queue"; the number orders them. */
export const schemaNumber = (tag: string) => Number(/^(\d{4})_/.exec(tag)?.[1] ?? NaN);

type Meta = { columns: Map<string, Set<string>>; refs: Map<string, { column: string; refTable: string }[]>; classes: Map<string, string> };
let metaCache: Meta | undefined;
async function meta(tx: Tx): Promise<Meta> {
  if (metaCache) return metaCache;
  const cols = await tx.execute<{ t: string; c: string }>(sql`select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'`);
  const columns = new Map<string, Set<string>>();
  for (const r of cols) (columns.get(r.t) ?? columns.set(r.t, new Set()).get(r.t)!).add(r.c);
  const fks = await tx.execute<{ t: string; c: string; r: string }>(sql`
    select c.conrelid::regclass::text as t, a.attname as c, c.confrelid::regclass::text as r
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace`);
  const refs = new Map<string, { column: string; refTable: string }[]>();
  for (const f of fks) (refs.get(f.t) ?? refs.set(f.t, []).get(f.t)!).push({ column: f.c, refTable: f.r });
  const classes = new Map((await tx.execute<{ table_name: string; entity_class: string }>(sql`select table_name, entity_class from sync_entities`)).map((r) => [r.table_name, r.entity_class]));
  metaCache = { columns, refs, classes };
  return metaCache;
}
/** For tests that alter the schema between runs. */
export const resetApplyMetaCache = () => { metaCache = undefined; };

/** Columns the cloud manages itself on the organisation row. */
const ORG_CLOUD_FIELDS = new Set(["status", "slug", "trial_started_at", "trial_ends_at", "trial_source", "logo_data", "logo_mime_type"]);

class GroupAbort extends Error {
  constructor(public eventId: string, public kind: "conflict" | "rejected" | "retryable", public code: string, message: string, public remote?: Record<string, unknown> | null) {
    super(message);
  }
}

export interface DeviceContext { deviceId: string; organizationId: string }
export interface ApplySummary { results: SyncResult[]; counts: { applied: number; duplicates: number; stale: number; conflicts: number; rejected: number; retryable: number } }

export async function applyBatch(tx: Tx, device: DeviceContext, batchId: string, events: PushEvent[]): Promise<ApplySummary> {
  const m = await meta(tx);
  const results = new Map<string, SyncResult>();
  const counts = { applied: 0, duplicates: 0, stale: 0, conflicts: 0, rejected: 0, retryable: 0 };
  const remoteLog: { e: PushEvent; code: string; reason: string; existingHash: string | null }[] = [];

  // Replays and reused ids are settled before anything is applied.
  const known = new Map(
    (await tx.execute<{ event_id: string; device_id: string; payload_hash: string }>(sql`select event_id, device_id, payload_hash from sync_applied_events where event_id = any(${uuidArray(events.map((e) => e.id))}::uuid[])`))
      .map((r) => [r.event_id, r]),
  );
  const fresh: PushEvent[] = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const k = known.get(e.id);
    if (!k) { fresh.push(e); continue; }
    if (k.device_id === device.deviceId && k.payload_hash === eventPayloadHash(e)) {
      results.set(e.id, { id: e.id, outcome: "duplicate" });
      counts.duplicates++;
    } else {
      results.set(e.id, { id: e.id, outcome: "error", retryable: false, message: "EVENT_ID_REUSED: this event id was already used with different content" });
      counts.rejected++;
      remoteLog.push({ e, code: "EVENT_ID_REUSED", reason: "Event id reused with a different payload", existingHash: k.payload_hash });
    }
  }

  // Group by the PC's database transaction, in the order the PC committed them. Snapshot rows (taken at linking)
  // are independent records, so each is applied on its own.
  const groups: PushEvent[][] = [];
  const byTx = new Map<string, PushEvent[]>();
  for (const e of fresh) {
    const key = e.op === "snapshot" ? `e:${e.id}` : `t:${e.txid}`;
    if (!byTx.has(key)) groups.push(byTx.set(key, []).get(key)!);
    byTx.get(key)!.push(e);
  }

  for (const group of groups) {
    const outcomes = new Map<string, "applied" | "stale">();
    try {
      await tx.transaction(async (sp) => {
        const touched = { payments: new Set<string>(), invoices: new Set<string>(), customers: new Set<string>() };
        for (const e of group) outcomes.set(e.id, await applyEvent(sp, m, device, e, touched));
        await checkInvariants(sp, device.organizationId, touched, group);
        for (const e of group) {
          await sp.execute(sql`insert into sync_applied_events (event_id, device_id, organization_id, payload_hash, outcome, entity_table, entity_id, seq, batch_id)
            values (${e.id}, ${device.deviceId}, ${device.organizationId}, ${eventPayloadHash(e)}, ${outcomes.get(e.id)!}, ${e.entityTable}, ${e.entityId}, ${e.seq}, ${batchId})`);
        }
      });
      for (const e of group) {
        if (outcomes.get(e.id) === "stale") { results.set(e.id, { id: e.id, outcome: "stale" }); counts.stale++; }
        else { results.set(e.id, { id: e.id, outcome: "applied" }); counts.applied++; }
      }
    } catch (err) {
      const abort = err instanceof GroupAbort ? err : classifyDbError(err, group);
      for (const e of group) {
        const self = e.id === abort.eventId;
        const why = self ? abort.message : `Part of one PC change that could not be applied: ${abort.message}`;
        if (abort.kind === "retryable") { results.set(e.id, { id: e.id, outcome: "error", retryable: true, message: `${abort.code}: ${why}` }); counts.retryable++; }
        else if (abort.kind === "rejected") { results.set(e.id, { id: e.id, outcome: "error", retryable: false, message: `${abort.code}: ${why}` }); counts.rejected++; }
        else { results.set(e.id, { id: e.id, outcome: "conflict", reason: `${abort.code}: ${why}`, remoteData: self ? abort.remote ?? null : null }); counts.conflicts++; }
        if (self && abort.kind !== "retryable") remoteLog.push({ e, code: abort.code, reason: abort.message, existingHash: abort.remote ? sha256(stableStringify(abort.remote)) : null });
      }
    }
  }

  for (const r of remoteLog) {
    await tx.execute(sql`insert into sync_remote_conflicts (organization_id, device_id, event_id, entity_table, entity_id, code, reason, incoming_hash, existing_hash)
      values (${device.organizationId}, ${device.deviceId}, ${r.e.id}, ${r.e.entityTable}, ${r.e.entityId}, ${r.code}, ${r.reason}, ${eventPayloadHash(r.e)}, ${r.existingHash})`);
  }
  return { results: events.map((e) => results.get(e.id)!), counts };
}

type Touched = { payments: Set<string>; invoices: Set<string>; customers: Set<string> };

async function applyEvent(tx: Tx, m: Meta, device: DeviceContext, e: PushEvent, touched: Touched): Promise<"applied" | "stale"> {
  const table = e.entityTable;
  const cls = m.classes.get(table);
  const cols = m.columns.get(table);
  if (!cls || !cols) throw new GroupAbort(e.id, "rejected", "UNKNOWN_TABLE", `“${table}” is not synchronised by this cloud`);
  if (cls !== e.entityClass) throw new GroupAbort(e.id, "rejected", "CLASS_MISMATCH", `“${table}” is ${cls} data on the cloud`);
  const org = device.organizationId;
  const hasOrg = cols.has("organization_id");

  const [existingRow] = await tx.execute<{ r: Record<string, unknown> }>(sql.raw(`select to_jsonb(t) as r from "${table}" t where t.id::text = '${e.entityId.replace(/'/g, "''")}' for update`));
  const existing = existingRow?.r;
  if (existing) {
    const owner = table === "organizations" ? existing.id : table === "users" ? undefined : existing.organization_id;
    if (table === "users") {
      const [shadow] = await tx.execute(sql`select 1 from sync_shadow_users where user_id = ${e.entityId} and organization_id = ${org}`);
      if (!shadow) throw new GroupAbort(e.id, "rejected", "CROSS_TENANT", "This user record belongs to another account");
    } else if (hasOrg || table === "organizations") {
      if (owner !== org) throw new GroupAbort(e.id, "rejected", "CROSS_TENANT", "This record belongs to another business");
    }
  }

  if (e.op === "delete") {
    if (cls === "ledger") throw new GroupAbort(e.id, "rejected", "LEDGER_DELETE", "Money and history records cannot be deleted");
    if (existing) await tx.execute(sql.raw(`delete from "${table}" where id::text = '${e.entityId.replace(/'/g, "''")}'`));
    await rememberState(tx, org, table, e.entityId, e.seq, "deleted");
    return "applied";
  }

  const incoming = e.rowData;
  if (!incoming || String(incoming.id) !== e.entityId) throw new GroupAbort(e.id, "rejected", "BAD_EVENT", "The change has no data or its id does not match");
  if (table === "organizations" && e.entityId !== org) throw new GroupAbort(e.id, "rejected", "CROSS_TENANT", "A device can only change its own business");
  if (hasOrg && incoming.organization_id !== org) throw new GroupAbort(e.id, "rejected", "CROSS_TENANT", "The change names a different business");

  // Every referenced row that belongs to a business must belong to this one.
  for (const ref of m.refs.get(table) ?? []) {
    const v = incoming[ref.column];
    if (v === null || v === undefined || ref.refTable === table && v === e.entityId) continue;
    if (ref.refTable === "organizations") {
      if (v !== org) throw new GroupAbort(e.id, "rejected", "CROSS_TENANT", `${ref.column} points to a different business`);
    } else if (ref.refTable === "users") {
      const [ok] = await tx.execute(sql`select 1 from sync_shadow_users where user_id = ${String(v)} and organization_id = ${org}
        union all select 1 from organization_memberships where user_id = ${String(v)} and organization_id = ${org} limit 1`);
      if (!ok) {
        const [exists] = await tx.execute(sql`select 1 from users where id = ${String(v)}`);
        if (exists) throw new GroupAbort(e.id, "rejected", "CROSS_TENANT", `${ref.column} points to a user of another account`);
      }
    } else if (m.columns.get(ref.refTable)?.has("organization_id")) {
      const [r] = await tx.execute<{ o: string }>(sql.raw(`select organization_id::text as o from "${ref.refTable}" where id::text = '${String(v).replace(/'/g, "''")}'`));
      if (r && r.o !== org) {
        throw new GroupAbort(e.id, "rejected", ref.refTable === "branches" ? "CROSS_BRANCH" : "CROSS_TENANT", `${ref.column} points to ${ref.refTable === "branches" ? "a branch" : "a record"} of another business`);
      }
    }
  }

  // Shape the row for the cloud.
  let row: Record<string, unknown> = Object.fromEntries(Object.entries(incoming).filter(([k]) => cols.has(k)));
  if (table === "users") {
    row = { id: incoming.id, name: incoming.name, email: `${incoming.id}@pc-staff.drycare.invalid`, phone: null, password_hash: "!pc-staff-no-login", status: "pc_staff", created_at: incoming.created_at, updated_at: incoming.updated_at };
    row = Object.fromEntries(Object.entries(row).filter(([k, v]) => cols.has(k) && v !== undefined));
  }
  if (table === "organizations") {
    row = Object.fromEntries(Object.entries(row).filter(([k]) => !ORG_CLOUD_FIELDS.has(k)));
    row.settings_json = { ...(incoming.settings_json as object ?? {}), syncSource: "device", platformInternal: false };
  }
  if (table === "laundry_orders" && !existing && !row.status_token) row.status_token = randomBytes(18).toString("base64url");

  const compareKeys = Object.keys(row).filter((k) => !(table === "laundry_orders" && k === "status_token"));
  const pick = (r: Record<string, unknown>) => Object.fromEntries(compareKeys.map((k) => [k, r[k] ?? null]));
  const incomingHash = sha256(stableStringify(pick(row)));

  if (!existing) {
    await writeRow(tx, table, row, "insert");
  } else {
    const existingHash = sha256(stableStringify(pick(existing)));
    if (existingHash === incomingHash) {
      await rememberState(tx, org, table, e.entityId, e.seq, incomingHash);
      noteTouched(table, row, touched);
      return "applied";
    }
    const [st] = await tx.execute<{ last_seq: string; row_hash: string }>(sql`select last_seq, row_hash from sync_entity_state where organization_id = ${org} and entity_table = ${table} and entity_id = ${e.entityId}`);
    if (st && e.seq <= Number(st.last_seq)) return "stale";
    if (cols.has("version") && typeof existing.version === "number" && typeof row.version === "number") {
      if (row.version < existing.version) return "stale";
      if (row.version === existing.version) throw new GroupAbort(e.id, "conflict", "VERSION_CONFLICT", "The cloud has a different copy of this record at the same version", existing);
    }
    const money = cls === "ledger" || cls === "financial";
    if (st && st.row_hash !== existingHash) {
      throw new GroupAbort(e.id, "conflict", "CHANGED_IN_CLOUD", "This record was changed in the cloud outside sync; it was not overwritten", existing);
    }
    if (!st && money) throw new GroupAbort(e.id, "conflict", "EXISTS_DIFFERENT", "The cloud already holds a different money record with this id", existing);
    if (cls === "ledger" && e.op === "insert") throw new GroupAbort(e.id, "conflict", "LEDGER_MISMATCH", "This payment or history record already exists with different content", existing);
    await writeRow(tx, table, row, "update");
  }
  if (table === "users" && !existing) await tx.execute(sql`insert into sync_shadow_users (user_id, organization_id) values (${e.entityId}, ${org}) on conflict do nothing`);
  await rememberState(tx, org, table, e.entityId, e.seq, incomingHash);
  noteTouched(table, row, touched);
  return "applied";
}

async function writeRow(tx: Tx, table: string, row: Record<string, unknown>, mode: "insert" | "update") {
  const cols = Object.keys(row);
  const list = cols.map((c) => `"${c}"`).join(",");
  if (mode === "insert") {
    await tx.execute(sql`${sql.raw(`insert into "${table}" (${list}) select ${list} from json_populate_record(null::"${table}", `)}${JSON.stringify(row)}::json)`);
  } else {
    const set = cols.filter((c) => c !== "id");
    if (!set.length) return;
    await tx.execute(sql`${sql.raw(`update "${table}" t set (${set.map((c) => `"${c}"`).join(",")}) = (select ${set.map((c) => `r."${c}"`).join(",")} from json_populate_record(null::"${table}", `)}${JSON.stringify(row)}::json) r) where t.id::text = ${String(row.id)}`);
  }
}

async function rememberState(tx: Tx, org: string, table: string, id: string, seq: number, hash: string) {
  await tx.execute(sql`insert into sync_entity_state (organization_id, entity_table, entity_id, last_seq, row_hash) values (${org}, ${table}, ${id}, ${seq}, ${hash})
    on conflict (organization_id, entity_table, entity_id) do update set last_seq = greatest(sync_entity_state.last_seq, excluded.last_seq), row_hash = excluded.row_hash, updated_at = now()`);
}

function noteTouched(table: string, row: Record<string, unknown>, t: Touched) {
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  if (table === "payments") { t.payments.add(String(row.id)); if (s(row.customer_id)) t.customers.add(String(row.customer_id)); }
  if (table === "payment_allocations") { if (s(row.payment_id)) t.payments.add(String(row.payment_id)); if (s(row.invoice_id)) t.invoices.add(String(row.invoice_id)); }
  if (table === "refunds") { if (s(row.payment_id)) t.payments.add(String(row.payment_id)); if (s(row.invoice_id)) t.invoices.add(String(row.invoice_id)); }
  if (table === "invoices" || table === "credit_notes") t.invoices.add(String(table === "invoices" ? row.id : row.invoice_id));
  if (table === "customer_wallet_entries" && s(row.customer_id)) t.customers.add(String(row.customer_id));
}

/** Money rules the cloud checks itself instead of trusting the PC's arithmetic. */
async function checkInvariants(tx: Tx, org: string, t: Touched, group: PushEvent[]) {
  const first = group[0].id;
  if (t.payments.size) {
    const bad = await tx.execute<{ id: string; why: string }>(sql`
      select p.id, case when coalesce((select sum(a.allocated_amount) from payment_allocations a where a.payment_id = p.id), 0) > p.amount then 'allocated'
                        else 'refunded' end as why
      from payments p where p.organization_id = ${org} and p.id = any(${uuidArray([...t.payments])}::uuid[])
        and (coalesce((select sum(a.allocated_amount) from payment_allocations a where a.payment_id = p.id), 0) > p.amount
          or coalesce((select sum(r.amount) from refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0) > p.amount)`);
    if (bad.length) throw new GroupAbort(first, "rejected", "PAYMENT_TOTALS", `Payment ${bad[0].why === "allocated" ? "allocations" : "refunds"} exceed the payment amount`);
  }
  if (t.invoices.size) {
    const bad = await tx.execute<{ id: string }>(sql`
      select i.id from invoices i where i.organization_id = ${org} and i.id = any(${uuidArray([...t.invoices])}::uuid[]) and i.status <> 'cancelled'
        and ${invoicePaidSql} > i.grand_total - ${invoiceCreditSql}`);
    if (bad.length) throw new GroupAbort(first, "rejected", "INVOICE_OVERPAID", "Payments recorded against an invoice exceed its total");
  }
  if (t.customers.size) {
    const bad = await tx.execute<{ customer_id: string }>(sql`
      select w.customer_id from customer_wallet_entries w
      where w.organization_id = ${org} and w.customer_id = any(${uuidArray([...t.customers])}::uuid[])
      group by w.customer_id
      having sum(w.amount) <> (select w2.balance_after from customer_wallet_entries w2 where w2.customer_id = w.customer_id order by w2.created_at desc, w2.id desc limit 1)
          or sum(w.amount) < 0`);
    if (bad.length) throw new GroupAbort(first, "rejected", "WALLET_BALANCE", "The customer wallet statement does not add up");
  }
}

/** Database errors become structured outcomes; internal details are never sent to the PC. */
function classifyDbError(err: unknown, group: PushEvent[]): GroupAbort {
  const e = err as { code?: string; cause?: { code?: string; table_name?: string } };
  const code = e.cause?.code ?? e.code;
  const table = e.cause?.table_name;
  const target = group.find((g) => g.entityTable === table) ?? group[0];
  if (code === "23503") return new GroupAbort(target.id, "retryable", "DEPENDENCY_MISSING", "A record this change depends on has not reached the cloud yet");
  if (code === "23505") return new GroupAbort(target.id, "conflict", "UNIQUE_CONFLICT", "The cloud already has a different record with the same number or code");
  if (code === "P0001") return new GroupAbort(target.id, "conflict", "IMMUTABLE_RECORD", "This record is append-only in the cloud and differs from the PC's copy");
  if (code && /^(22|23)/.test(code)) return new GroupAbort(target.id, "rejected", "INVALID_DATA", "The cloud could not accept this data");
  return new GroupAbort(target.id, "retryable", "CLOUD_ERROR", "The cloud could not apply this change right now");
}

/**
 * Staged commit for PC changes larger than one upload. Parts are held in `sync_staged_events` (not applied, not
 * visible) and acknowledged as "staged". When the stored parts reach the change's `groupSize`, the whole change is
 * returned for normal application in one savepoint, so a sale is either fully in the cloud or not at all.
 * If the final part arrives but parts are missing, the PC is told to resend the whole change (GROUP_INCOMPLETE).
 */
export async function stageLargeChanges(tx: Tx, device: DeviceContext, events: PushEvent[]) {
  const pass: PushEvent[] = [];
  const results: SyncResult[] = [];
  const completed: number[] = [];
  const groups = new Map<number, PushEvent[]>();
  for (const e of events) {
    if (e.op !== "snapshot" && e.groupSize) (groups.get(e.txid) ?? groups.set(e.txid, []).get(e.txid)!).push(e);
    else pass.push(e);
  }
  for (const [txid, evs] of groups) {
    const size = Math.max(...evs.map((e) => e.groupSize!));
    const [{ n }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from sync_applied_events where event_id = any(${uuidArray(evs.map((e) => e.id))}::uuid[])`);
    if (n > 0) { pass.push(...evs); continue; } // the change was already committed: normal path answers "duplicate"
    for (const e of evs) {
      await tx.execute(sql`insert into sync_staged_events (event_id, device_id, organization_id, txid, group_size, event_json)
        values (${e.id}, ${device.deviceId}, ${device.organizationId}, ${txid}, ${size}, ${JSON.stringify(e)}::jsonb) on conflict (event_id) do nothing`);
    }
    const staged = await tx.execute<{ event_json: PushEvent }>(sql`select event_json from sync_staged_events where device_id = ${device.deviceId} and txid = ${txid}`);
    if (staged.length >= size) {
      pass.push(...staged.map((r) => r.event_json));
      completed.push(txid);
    } else if (evs.some((e) => e.groupFinal)) {
      for (const e of evs) results.push({ id: e.id, outcome: "error", retryable: true, message: `GROUP_INCOMPLETE: the cloud has ${staged.length} of ${size} parts of this change; send the whole change again` });
    } else {
      for (const e of evs) results.push({ id: e.id, outcome: "staged" });
    }
  }
  return { pass: pass.sort((a, b) => a.seq - b.seq), results, completed };
}

/** Removes held parts once a change is settled (applied, or refused for good). Kept while a retry is expected. */
export async function clearStaged(tx: Tx, deviceId: string, completed: number[], results: SyncResult[], events: PushEvent[]) {
  for (const txid of completed) {
    const ids = new Set(events.filter((e) => e.txid === txid).map((e) => e.id));
    const retry = results.some((r) => ids.has(r.id) && r.outcome === "error" && r.retryable);
    if (!retry) await tx.execute(sql`delete from sync_staged_events where device_id = ${deviceId} and txid = ${txid}`);
  }
  await tx.execute(sql`delete from sync_staged_events where device_id = ${deviceId} and received_at < now() - interval '14 days'`);
}
