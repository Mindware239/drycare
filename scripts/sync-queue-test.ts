/**
 * Phase 2 local sync queue, end to end, in a throwaway database (never touches real data).
 * Run: pnpm sync-test
 *
 * Covers: migration onto a database that already has business data; event capture inside the business
 * transaction; rollback leaves no event; a failing event write fails the business change; restart and crash
 * recovery with pending events; repeated processing without duplicates; failures and safe retries;
 * conflicts recorded without overwriting financial data; existing workflows and reports with capture on.
 */
import postgres from "postgres";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.DATABASE_URL!);
const admin = postgres({ host: base.hostname, port: Number(base.port), user: base.username, password: decodeURIComponent(base.password), database: "postgres", onnotice: () => {} });
const DB = "drycare_sync_test";
await admin.unsafe(`drop database if exists ${DB} with (force)`);
await admin.unsafe(`create database ${DB} encoding 'UTF8' template template0`);
base.pathname = `/${DB}`;
process.env.DATABASE_URL = base.toString();


const { buildServer } = await import("../apps/api/src/app");
const { db, sqlClient } = await import("../apps/api/src/db/client");
const { runMigrations, applyMigrationFiles } = await import("../apps/api/src/db/migrate-lib");
const { setCapture, claimBatch, processQueue, syncStatus, LOCAL_ONLY_TABLES } = await import("../apps/api/src/sync/queue");
type SyncTransport = import("../apps/api/src/sync/transport").SyncTransport;
type SyncEvent = import("../apps/api/src/sync/transport").SyncEvent;
type SyncResult = import("../apps/api/src/sync/transport").SyncResult;

let failures = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || extra === undefined ? "" : `  → ${JSON.stringify(extra).slice(0, 300)}`}`);
  if (!ok) failures++;
};
const section = (t: string) => console.log(`\n${t}`);

// ------------------------------------------------------------------ 7. migration onto existing business data
section("7. Migration onto a database that already holds business data");
const migrations = fileURLToPath(new URL("../apps/api/drizzle", import.meta.url));
const before0027 = mkdtempSync(path.join(tmpdir(), "drycare-mig-"));
cpSync(migrations, before0027, { recursive: true });
const journalFile = path.join(before0027, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalFile, "utf8"));
const LATEST = (journal.entries.at(-1) as { tag: string }).tag;
const syncIdx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith("0027_"));
journal.entries = journal.entries.slice(0, syncIdx);
writeFileSync(journalFile, JSON.stringify(journal));
await applyMigrationFiles(db, before0027);
rmSync(before0027, { recursive: true, force: true });

const app = await buildServer();
class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const r = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: this.cookie, "x-drycare-csrf": "1" } });
    const sc = r.headers["set-cookie"];
    if (sc) this.cookie = (Array.isArray(sc) ? sc[0] : sc).split(";")[0];
    let json: any;
    try { json = r.json(); } catch {}
    return { status: r.statusCode, json };
  }
}
const run = randomUUID().slice(0, 6);
const owner = new Client();
await owner.req("POST", "/organizations", { businessName: `Sync Shop ${run}`, ownerName: "Sync Owner", email: `owner-sync-${run}@test.local`, password: `Owner-${run}-Password1`, acceptedTerms: true });
const session = (await owner.req("GET", "/auth/session")).json;
const branchId = session.branches[0].id;
await owner.req("POST", "/cashier-shifts", { branchId, openingCash: 500_000 });
const [gts, svcs] = await Promise.all([owner.req("GET", "/garment-types"), owner.req("GET", "/services")]);
const suit = gts.json.find((g: any) => g.name === "Suit (2 pc)"), DC = svcs.json.find((x: any) => x.serviceCode === "DC");
let phoneN = 0;
const newCustomer = async (name: string) => (await owner.req("POST", "/customers", { name, phone: `+91 98${String(Date.now() + ++phoneN).slice(-8)}` })).json;
const newOrder = (customerId: string, payments: unknown[] = []) => owner.req("POST", "/orders", { customerId, branchId, promisedAt: new Date(Date.now() + 2 * 86400_000).toISOString(), items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 1 }], payments });
const oldCust = await newCustomer("Existing Customer");
const oldOrder = (await newOrder(oldCust.id, [{ amount: 20000, method: "cash" }])).json;
await owner.req("POST", "/expenses", { branchId, category: "Rent", amount: 100000, method: "upi", spentOn: new Date().toISOString().slice(0, 10) });
const fingerprint = async () => {
  const out: Record<string, string> = {};
  for (const t of ["organizations", "customers", "orders", "order_items", "garments", "invoices", "payments", "payment_allocations", "expenses", "roles", "users"]) {
    const [r] = await sqlClient.unsafe(`select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as h from "${t}" t`);
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
};
const beforeFp = await fingerprint();
check("business data exists before the sync migration", Number(beforeFp.orders.split(":")[0]) === 1 && Number(beforeFp.payments.split(":")[0]) === 1, beforeFp);

await runMigrations(db, migrations);
const afterFp = await fingerprint();
check("migration 0027 leaves every business record unchanged", JSON.stringify(afterFp) === JSON.stringify(beforeFp), { beforeFp, afterFp });
const [{ n: outboxAfterMigration }] = await sqlClient`select count(*)::int as n from sync_outbox`;
check("existing records are not queued by the migration", outboxAfterMigration === 0, outboxAfterMigration);
const [cfg] = await sqlClient`select capture_enabled, schema_version from sync_config where id = 1`;
check("capture is off by default and the schema version is recorded", cfg.capture_enabled === false && cfg.schema_version === LATEST, cfg);
const [{ triggers, entities }] = await sqlClient`select (select count(*)::int from pg_trigger where tgname = 'sync_capture') as triggers, (select count(*)::int from sync_entities) as entities`;
check("every classified table has the capture trigger", triggers === entities && entities > 50, { triggers, entities });
const allTables = (await sqlClient`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`).map((r) => r.table_name as string);
const classified = new Set((await sqlClient`select table_name from sync_entities`).map((r) => r.table_name as string));
const unclassified = allTables.filter((t) => !classified.has(t) && !(LOCAL_ONLY_TABLES as readonly string[]).includes(t));
check("every table is either synchronised or explicitly local-only (new tables must be classified)", unclassified.length === 0, unclassified);
await runMigrations(db, migrations);
check("running migrations again is harmless", JSON.stringify(await fingerprint()) === JSON.stringify(beforeFp));

await setCapture(db, true);
const outboxCount = async () => (await sqlClient`select count(*)::int as n from sync_outbox`)[0].n as number;

// ------------------------------------------------------------------ 1. capture in the business transaction
section("1. Business change and its queue events are written together");
const cust = await newCustomer("Queue Customer");
const orderRes = await newOrder(cust.id, [{ amount: 41300, method: "cash" }]);
check("order with full payment created", orderRes.status === 201, orderRes.json);
const order = orderRes.json;
const orderEvents = await sqlClient`select entity_table, op, txid, organization_id, branch_id, schema_version, entity_class from sync_outbox where txid = (select txid from sync_outbox where entity_table = 'orders' and entity_id = ${order.id} limit 1)`;
const tablesInTx = new Set(orderEvents.map((e) => e.entity_table as string));
check("order, items, garments, invoice, payment and allocation are queued as one transaction", ["orders", "order_items", "garments", "invoices", "payments", "payment_allocations"].every((t) => tablesInTx.has(t)), [...tablesInTx]);
check("events carry business, branch and schema identifiers", orderEvents.every((e) => e.organization_id === session.organization.id && e.schema_version === LATEST) && orderEvents.some((e) => e.entity_table === "orders" && e.branch_id === branchId), orderEvents[0]);
check("payment events are classified as ledger records", orderEvents.filter((e) => e.entity_table === "payments").every((e) => e.entity_class === "ledger"));
await owner.req("POST", "/staff", { name: "Counter", email: `rec-sync-${run}@test.local`, password: `Staff-${run}-Password1`, roleKey: "reception", branchIds: [branchId] });
const leaked = await sqlClient`select entity_table, k from sync_outbox, jsonb_object_keys(coalesce(row_data, '{}'::jsonb)) k where k ~ '(password|token_hash|otp_hash|status_token|photo_data|logo_data)'`;
const [{ n: userEvents }] = await sqlClient`select count(*)::int as n from sync_outbox where entity_table = 'users'`;
check("no passwords, token hashes, OTP hashes or images in queued data", leaked.length === 0 && userEvents >= 1, leaked);
const [{ n: secretTables }] = await sqlClient`select count(*)::int as n from sync_outbox where entity_table in ('sessions', 'auth_tokens', 'audit_logs', 'idempotency_records')`;
check("sessions, login tokens and the audit log are never queued", secretTables === 0, secretTables);
const n0 = await outboxCount();
await sqlClient`update customers set name = name where id = ${cust.id}`;
check("an update that changes nothing creates no event", (await outboxCount()) === n0);

// ------------------------------------------------------------------ 2. rollback
section("2. Business rollback leaves no queued event");
const nBefore = await outboxCount();
try {
  await db.transaction(async (tx) => {
    await tx.execute(`insert into customers (organization_id, customer_code, name) values ('${session.organization.id}', 'ROLLBACK-${run}', 'Rolled back')` as never);
    throw new Error("simulated failure after the insert");
  });
} catch {}
check("rolled-back customer is not stored", (await sqlClient`select count(*)::int as n from customers where customer_code = ${`ROLLBACK-${run}`}`)[0].n === 0);
check("and no event was queued for it", (await outboxCount()) === nBefore);
const overspend = await owner.req("POST", `/customers/${cust.id}/wallet/adjustments`, { amount: -999999, reason: "Should fail the rule" });
check("a business rule failure (wallet below zero) queues nothing", overspend.status === 422 && (await outboxCount()) === nBefore, overspend.status);
await sqlClient.unsafe(`alter table sync_outbox add constraint sync_test_block check (entity_table <> 'expenses') not valid`);
const blocked = await owner.req("POST", "/expenses", { branchId, category: "Rent", amount: 5000, method: "upi", spentOn: new Date().toISOString().slice(0, 10), description: `blocked-${run}` });
await sqlClient.unsafe(`alter table sync_outbox drop constraint sync_test_block`);
check("if the event cannot be written, the business change is refused", blocked.status >= 500, blocked.status);
check("and the expense was not silently saved", (await sqlClient`select count(*)::int as n from expenses where description = ${`blocked-${run}`}`)[0].n === 0);

// ------------------------------------------------------------------ fake cloud
class FakeCloud implements SyncTransport {
  name = "fake-cloud";
  applied = new Set<string>();
  rows = new Map<string, Record<string, unknown> | null>();
  created = new Map<string, number>();
  mode: "ok" | "throw" | "reject" = "ok";
  calls = 0;
  async push(events: SyncEvent[]): Promise<SyncResult[]> {
    this.calls++;
    if (this.mode === "throw") throw new Error("Network unreachable");
    return events.map((e): SyncResult => {
      if (this.applied.has(e.id)) return { id: e.id, outcome: "duplicate" };
      if (this.mode === "reject") return { id: e.id, outcome: "error", message: "Cloud refused: schema is newer than the cloud", retryable: false };
      const key = `${e.entityTable}:${e.entityId}`;
      const existing = this.rows.get(key);
      const money = e.entityClass === "ledger" || e.entityClass === "financial";
      if (money && existing !== undefined && e.op === "insert" && JSON.stringify(existing) !== JSON.stringify(e.rowData)) {
        return { id: e.id, outcome: "conflict", reason: "The cloud already has a different version of this financial record", remoteData: existing };
      }
      if (!this.rows.has(key)) this.created.set(e.entityTable, (this.created.get(e.entityTable) ?? 0) + 1);
      this.rows.set(key, e.op === "delete" ? null : e.rowData);
      this.applied.add(e.id);
      return { id: e.id, outcome: "applied" };
    });
  }
}
const drain = async (t: SyncTransport) => {
  for (let i = 0; i < 50; i++) {
    const r = await processQueue(db, t, { batchSize: 100 });
    if (!r.sent) return;
  }
};

// ------------------------------------------------------------------ 3. restart with pending events
section("3. Pending events survive a restart and an interrupted upload");
const pendingBefore = (await sqlClient`select count(*)::int as n from sync_outbox where status = 'pending'`)[0].n;
const second = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const [{ n: seenAfterReconnect }] = await second`select count(*)::int as n from sync_outbox where status = 'pending'`;
await second.end();
check("a new connection (app restart) sees every pending event", pendingBefore > 10 && seenAfterReconnect === pendingBefore, { pendingBefore, seenAfterReconnect });
check("with no cloud connected, processing sends nothing and keeps events", (await processQueue(db, null)).skipped === true && (await sqlClient`select count(*)::int as n from sync_outbox where status = 'pending'`)[0].n === pendingBefore);
const claimed = await claimBatch(db, 5);
check("events are claimed in local order", claimed.length > 0 && claimed.length <= 5 && claimed.every((e, i) => i === 0 || e.seq > claimed[i - 1].seq));
const lastTx = claimed.at(-1)!.txid;
const [{ n: leftOfLastTx }] = await sqlClient`select count(*)::int as n from sync_outbox where txid = ${lastTx} and status = 'pending'`;
check("a batch does not end part-way through a change (or tags the change as split)", leftOfLastTx === 0 || claimed.filter((e) => e.txid === lastTx).every((e) => typeof e.groupSize === "number" && e.groupFinal === false), { leftOfLastTx, last: claimed.at(-1) });
check("a claimed event is not handed out twice while its upload is in flight", (await claimBatch(db, 500)).every((e) => !claimed.some((c) => c.id === e.id)));
await sqlClient`update sync_outbox set status = 'pending', lease_until = null, attempts = 0 where status = 'sending' and id <> all(${claimed.map((c) => c.id)})`;
await sqlClient`update sync_outbox set lease_until = now() - interval '1 second' where id = any(${claimed.map((c) => c.id)})`;
const reclaimed = await claimBatch(db, 5);
check("after a crash mid-upload the expired lease releases the same events again", claimed.every((c) => reclaimed.some((r) => r.id === c.id)), reclaimed.map((r) => r.seq));
await sqlClient`update sync_outbox set status = 'pending', lease_until = null, attempts = 0 where status = 'sending'`;

// ------------------------------------------------------------------ 6. conflicts (set up before the first upload)
section("6. Conflicts are recorded and never overwrite financial data");
const cloud = new FakeCloud();
const [invoiceRow] = await sqlClient`select id from invoices where order_id = ${order.id}`;
const remoteInvoice = { id: invoiceRow.id, grand_total: 99999, note: "edited in the cloud" };
cloud.rows.set(`invoices:${invoiceRow.id}`, remoteInvoice);

// ------------------------------------------------------------------ 4. repeated processing
section("4. Repeated processing creates nothing twice");
await drain(cloud);
const st1 = await syncStatus(db, session.organization.id);
check("queue drained: everything synced except the conflicting invoice", st1.pending === 0 && st1.conflicts === 1, st1);
const createdPayments = cloud.created.get("payments") ?? 0;
const createdOrders = cloud.created.get("orders") ?? 0;
await sqlClient`update sync_outbox set status = 'pending', synced_at = null, attempts = 0 where status = 'synced'`;
await drain(cloud);
check("re-sending every event (lost acknowledgement) creates no duplicate orders or payments", (cloud.created.get("payments") ?? 0) === createdPayments && (cloud.created.get("orders") ?? 0) === createdOrders && createdPayments === 1, { createdPayments, createdOrders });
check("re-sent events are marked synced again", (await syncStatus(db, session.organization.id)).pending === 0);
check("the conflicting invoice was not overwritten in the cloud", JSON.stringify(cloud.rows.get(`invoices:${invoiceRow.id}`)) === JSON.stringify(remoteInvoice));
const conflicts = await sqlClient`select entity_table, entity_id, reason, local_data, remote_data, status from sync_conflicts`;
check("the conflict is stored with local and cloud versions for review", conflicts.length === 1 && conflicts[0].entity_table === "invoices" && conflicts[0].remote_data.grand_total === 99999 && conflicts[0].local_data.id === invoiceRow.id, conflicts);
await sqlClient`update invoices set due_at = now() + interval '7 days' where id = ${invoiceRow.id}`;
await drain(cloud);
const held = await sqlClient`select status from sync_outbox where entity_table = 'invoices' and entity_id = ${invoiceRow.id} and op = 'update'`;
check("a later change to the conflicting invoice is held back, not uploaded", held.length === 1 && held[0].status === "pending", held);
check("so the cloud invoice is still the cloud's version", JSON.stringify(cloud.rows.get(`invoices:${invoiceRow.id}`)) === JSON.stringify(remoteInvoice));

// ------------------------------------------------------------------ 5. failures and retries
section("5. Failed uploads are retried safely");
const c2 = await newCustomer("Retry Customer");
await newOrder(c2.id, [{ amount: 41300, method: "upi", reference: `UTR${run}` }]);
cloud.mode = "throw";
await processQueue(db, cloud, { batchSize: 100 });
const failedRows = await sqlClient`select status, attempts, last_error, next_attempt_at > now() as later from sync_outbox where status = 'failed'`;
check("a network failure marks events failed with the error and a later retry time", failedRows.length > 0 && failedRows.every((r) => r.attempts === 1 && r.later && /Network unreachable/.test(r.last_error)), failedRows[0]);
const st2 = await syncStatus(db, session.organization.id);
check("status shows the failures and does not claim success", st2.failed > 0 && st2.lastError?.includes("Network unreachable") === true, st2);
check("failed events are not retried before their back-off time", (await claimBatch(db, 500)).length === 0);
cloud.mode = "ok";
await sqlClient`update sync_outbox set next_attempt_at = now() where status = 'failed'`;
const paymentsBeforeRetry = cloud.created.get("payments") ?? 0;
await drain(cloud);
check("after the back-off the retry succeeds", (await syncStatus(db, session.organization.id)).failed === 0);
check("the retried order's payment exists exactly once in the cloud", (cloud.created.get("payments") ?? 0) === paymentsBeforeRetry + 1);
const c3 = await newCustomer("Rejected Customer");
cloud.mode = "reject";
await processQueue(db, cloud, { batchSize: 100 });
const [rej] = await sqlClient`select count(*)::int as n, bool_and(next_attempt_at = 'infinity') as stopped from sync_outbox where status = 'failed'`;
check("a permanent refusal stops automatic retries", rej.n > 0 && rej.stopped === true, rej);
cloud.mode = "ok";
const rec = new Client();
await rec.req("POST", "/auth/login", { email: `rec-sync-${run}@test.local`, password: `Staff-${run}-Password1` });
check("counter staff cannot force a retry", (await rec.req("POST", "/sync/retry", {})).status === 403);
const retryRes = await owner.req("POST", "/sync/retry", {});
check("the owner can retry failed uploads", retryRes.status === 200 && retryRes.json.retried === rej.n, retryRes.json);
await drain(cloud);
check("retried events upload once the cloud accepts them", cloud.rows.has(`customers:${c3.id}`) && (await syncStatus(db, session.organization.id)).failed === 0);

// ------------------------------------------------------------------ 8. existing workflows with capture on
section("8. Existing workflows and reports work with capture on");
const c4 = await newCustomer("Workflow Customer");
const o4 = (await newOrder(c4.id, [{ amount: 10000, method: "cash" }])).json;
const pay = await owner.req("POST", `/orders/${o4.id}/payments`, { payments: [{ amount: 31300, method: "cash" }] });
check("collect the balance", pay.status === 201, pay.json);
const p = (await sqlClient`select id from payments where customer_id = ${c4.id} order by created_at desc limit 1`)[0];
check("refund", (await owner.req("POST", `/payments/${p.id}/refunds`, { amount: 5000, reason: "Button missing" })).status === 201);
check("wallet top-up", (await owner.req("POST", `/customers/${c4.id}/wallet/topups`, { branchId, amount: 50000, method: "cash" })).status === 201);
const starter = await owner.req("POST", "/inventory/items/starter", {});
const items = (await owner.req("GET", `/inventory/items?branchId=${branchId}`)).json;
check("stock items and movements", starter.status === 201 && (await owner.req("POST", "/inventory/movements", { branchId, itemId: items[0].id, kind: "opening", quantity: 10 })).status === 201);
const claimR = await owner.req("POST", "/claims", { orderId: o4.id, kind: "late", description: "Delivered a day late" });
check("claims", claimR.status === 201, claimR.json);
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const dash = await owner.req("GET", `/dashboard?from=${today}&to=${today}`);
const daybook = await owner.req("GET", "/reports/run/daybook");
check("dashboard and day book reports", dash.status === 200 && daybook.status === 200 && dash.json.collections.net > 0, [dash.status, daybook.status]);
const queuedKinds = new Set((await sqlClient`select distinct entity_table from sync_outbox where status = 'pending'`).map((r) => r.entity_table as string));
check("each of those changes was queued", ["refunds", "customer_wallet_entries", "inventory_movements", "claims", "claim_events"].every((t) => queuedKinds.has(t)), [...queuedKinds]);
const ownerStatus = await owner.req("GET", "/sync/status");
const staffStatus = await rec.req("GET", "/sync/status");
check("status endpoint reports the local queue (cloud not linked)", ownerStatus.status === 200 && ownerStatus.json.captureEnabled && ownerStatus.json.cloudLinked === false && ownerStatus.json.pending > 0, ownerStatus.json);
check("staff see counts but not device id or error details", staffStatus.status === 200 && staffStatus.json.deviceId === undefined && staffStatus.json.lastError === null);
await setCapture(db, false);
const nOff = await outboxCount();
await newCustomer("Capture Off Customer");
check("with capture off (cloud server) nothing is queued", (await outboxCount()) === nOff);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
await app.close();
await sqlClient.end();
await admin.unsafe(`drop database if exists ${DB} with (force)`);
await admin.end();
process.exit(failures ? 1 : 0);
