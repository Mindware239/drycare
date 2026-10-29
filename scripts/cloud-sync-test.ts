/**
 * Phase 3 cloud push sync — INTEGRATION TEST AGAINST A LOCAL TEST CLOUD (not production).
 * Run: pnpm cloud-sync-test
 *
 *  - Test cloud: a separate DryCare API process in cloud mode (DRYCARE_MODE=saas) on its own throwaway database.
 *  - Test PC:    the DryCare API in desktop mode, in this process, on another throwaway database.
 *  - Between them a small proxy that can drop the connection before the request reaches the cloud, or after the
 *    cloud has committed (response lost), to test retries.
 * Real customer or production data is never used.
 */
import postgres from "postgres";
import http from "node:http";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const apiDir = path.join(repo, "apps/api");
const base = new URL(process.env.DATABASE_URL!);
const admin = postgres({ host: base.hostname, port: Number(base.port), user: base.username, password: decodeURIComponent(base.password), database: "postgres", onnotice: () => {} });
const CLOUD_DB = "drycare_cloudtest_cloud";
const PC_DB = "drycare_cloudtest_pc";
for (const d of [CLOUD_DB, PC_DB]) {
  await admin.unsafe(`drop database if exists ${d} with (force)`);
  await admin.unsafe(`create database ${d} encoding 'UTF8' template template0`);
}
const urlFor = (d: string) => { const u = new URL(base.toString()); u.pathname = `/${d}`; return u.toString(); };
const freePort = () => new Promise<number>((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

// ------------------------------------------------------------------ test cloud (child process)
const cloudPort = await freePort();
const tsx = path.join(apiDir, "node_modules/tsx/dist/cli.mjs");
const cloudEnv = { ...process.env, DATABASE_URL: urlFor(CLOUD_DB), DRYCARE_MODE: "saas", API_PORT: String(cloudPort), WEB_ORIGIN: "http://cloud.test", NODE_ENV: "test", SYNC_CAPTURE: "off", DRYCARE_CLOUD_URL: "" };
delete (cloudEnv as Record<string, unknown>).DRYCARE_CLOUD_URL;
await new Promise<void>((res, rej) => spawn(process.execPath, [tsx, "src/db/migrate.ts"], { cwd: apiDir, env: cloudEnv, stdio: "ignore" }).on("exit", (c) => (c === 0 ? res() : rej(new Error(`cloud migrate exit ${c}`)))));
const cloudProc: ChildProcess = spawn(process.execPath, [tsx, "src/server.ts"], { cwd: apiDir, env: cloudEnv, stdio: ["ignore", "ignore", "pipe"] });
let cloudStderr = "";
cloudProc.stderr?.on("data", (d) => { cloudStderr += String(d); });
const CLOUD = `http://127.0.0.1:${cloudPort}`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${CLOUD}/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 300));
}
const cloudDb = postgres(urlFor(CLOUD_DB), { onnotice: () => {} });

// ------------------------------------------------------------------ fault-injecting proxy
type ProxyMode = "pass" | "drop-before" | "drop-after";
let proxyMode: ProxyMode = "pass";
let proxyHits = 0;
const proxyPort = await freePort();
const proxy = http.createServer((req, res) => {
  proxyHits++;
  const mode = proxyMode;
  if (mode === "drop-before") { req.socket.destroy(); return; }
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const up = http.request({ host: "127.0.0.1", port: cloudPort, path: req.url, method: req.method, headers: req.headers }, (ur) => {
      const body: Buffer[] = [];
      ur.on("data", (c) => body.push(c));
      ur.on("end", () => {
        if (mode === "drop-after") { res.socket?.destroy(); return; } // the cloud committed; the PC never hears back
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        res.end(Buffer.concat(body));
      });
    });
    up.on("error", () => res.socket?.destroy());
    up.end(Buffer.concat(chunks));
  });
});
await new Promise<void>((r) => proxy.listen(proxyPort, "127.0.0.1", () => r()));

// ------------------------------------------------------------------ test PC (this process, desktop mode)
Object.assign(process.env, { DATABASE_URL: urlFor(PC_DB), DRYCARE_MODE: "desktop", DRYCARE_CLOUD_URL: `http://127.0.0.1:${proxyPort}`, DRYCARE_CLOUD_ALLOW_INSECURE: "true", APP_VERSION: "0.1.8-test", LICENSE_ENFORCED: "false" });
const { buildServer } = await import("../apps/api/src/app");
const { db, sqlClient: pc } = await import("../apps/api/src/db/client");
const { runMigrations } = await import("../apps/api/src/db/migrate-lib");
const { setCredentialStore, memoryCredentialStore, credentialStore } = await import("../apps/api/src/sync/cloud");
const { pollOnce, syncNow: syncNowRaw, stopSyncWorker, syncRuntime } = await import("../apps/api/src/sync/worker");
/** Linking starts an upload in the background; tests wait for it, then run their own. */
const waitIdle = async () => { for (let i = 0; i < 1200 && syncRuntime().syncing; i++) await new Promise((r) => setTimeout(r, 100)); };
const syncNow = async (o?: { maxBatches?: number; batchSize?: number }) => {
  await waitIdle();
  const r = (await syncNowRaw(o)) as { started: boolean; sent?: number; synced?: number; hold?: string; reason?: string };
  return { started: r.started, sent: r.sent ?? 0, synced: r.synced ?? 0, hold: r.hold, reason: r.reason };
};
const { claimBatch } = await import("../apps/api/src/sync/queue");
const { createBackup, readBackupManifest } = await import("../apps/api/src/lib/backup");
await runMigrations(db, path.join(apiDir, "drizzle"));
setCredentialStore(memoryCredentialStore());
const app = await buildServer();

let failures = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || extra === undefined ? "" : `  → ${JSON.stringify(extra).slice(0, 400)}`}`);
  if (!ok) failures++;
};
const section = (t: string) => console.log(`\n${t}`);

class PcClient {
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
class CloudClient {
  cookie = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(`${CLOUD}/api/v1${url}`, { method, headers: { "x-drycare-csrf": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    let json: any;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }
}
const pushRaw = async (credential: string, events: unknown[], batchId = randomUUID(), schemaVersion?: string) => {
  const r = await fetch(`${CLOUD}/api/v1/sync/push`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1", authorization: `Device ${credential}` }, body: JSON.stringify({ batchId, schemaVersion: schemaVersion ?? (events[0] as any)?.schemaVersion ?? "0028_cloud_sync", appVersion: "test", events }) });
  let json: any;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
};
const outboxEvents = async (where = "true") => (await pc.unsafe(`select id, seq, organization_id as "organizationId", branch_id as "branchId", entity_table as "entityTable", entity_id as "entityId", entity_class as "entityClass", op, row_data as "rowData", schema_version as "schemaVersion", device_id as "deviceId", txid, idempotency_key as "idempotencyKey", created_at::text as "createdAt" from sync_outbox where ${where} order by seq`)).map((e: any) => ({ ...e, seq: Number(e.seq), txid: Number(e.txid) }));
const pcCount = async (table: string) => (await pc.unsafe(`select count(*)::int as n from "${table}"`))[0].n as number;
const cloudCount = async (table: string, org: string) => (await cloudDb.unsafe(`select count(*)::int as n from "${table}" where organization_id = $1`, [org]))[0].n as number;
const status = async (c: PcClient) => (await c.req("GET", "/sync/status")).json;

const run = randomUUID().slice(0, 6);
try {
  // ------------------------------------------------------------------ PC shop with existing data
  const owner = new PcClient();
  const su = await owner.req("POST", "/organizations", { businessName: `Linked Shop ${run}`, ownerName: "PC Owner", email: `pc-owner-${run}@test.local`, password: `Owner-${run}-Password1`, acceptedTerms: true });
  const session = (await owner.req("GET", "/auth/session")).json;
  const ORG = session?.organization?.id;
  const BRANCH = session?.branches?.[0]?.id;
  check("test PC store set up", su.status === 201 && !!ORG && !!BRANCH, su.json);
  await owner.req("POST", "/cashier-shifts", { branchId: BRANCH, openingCash: 1_000_000 });
  const [gts, svcs] = await Promise.all([owner.req("GET", "/garment-types"), owner.req("GET", "/services")]);
  const suit = gts.json.find((g: any) => g.name === "Suit (2 pc)"), DC = svcs.json.find((x: any) => x.serviceCode === "DC");
  let phoneN = 0;
  const newCustomer = async (name: string) => (await owner.req("POST", "/customers", { name, phone: `+91 98${String(Date.now() + ++phoneN).slice(-8)}` })).json;
  const newOrder = async (customerId: string, payments: unknown[] = []) => (await owner.req("POST", "/orders", { customerId, branchId: BRANCH, promisedAt: new Date(Date.now() + 2 * 86400_000).toISOString(), items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 1 }], payments })).json;
  const c1 = await newCustomer("Before Link Customer");
  const o1 = await newOrder(c1.id, [{ amount: 20000, method: "cash" }]);
  await owner.req("POST", `/customers/${c1.id}/wallet/topups`, { branchId: BRANCH, amount: 50000, method: "cash" });
  check("before linking nothing is recorded for upload", (await pcCount("sync_outbox")) === 0 && (await status(owner)).cloudLinked === false);

  // ------------------------------------------------------------------ cloud owner accounts
  const cloudOwner = new CloudClient();
  await cloudOwner.req("POST", "/organizations", { businessName: `Owner Cloud ${run}`, ownerName: "Cloud Owner", email: `cloud-owner-${run}@test.local`, password: `Cloud-${run}-Password1`, acceptedTerms: true });
  const intruder = new CloudClient();
  await intruder.req("POST", "/organizations", { businessName: `Other Cloud ${run}`, ownerName: "Other Owner", email: `cloud-other-${run}@test.local`, password: `Other-${run}-Password1`, acceptedTerms: true });
  const intruderOrg = (await intruder.req("GET", "/auth/session")).json.organization.id;
  const intruderBranch = (await intruder.req("GET", "/auth/session")).json.branches[0].id;

  // ------------------------------------------------------------------ 1. registration
  section("1. Device registration and authorisation");
  const ls = await owner.req("POST", "/sync/cloud-link/start", { deviceName: "Counter PC" });
  check("PC asks the cloud for a link code", ls.status === 201 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ls.json?.userCode) && ls.json.verificationUrl.includes(ls.json.userCode), ls.json);
  const code = ls.json.userCode;
  const anon = new CloudClient();
  check("approving needs a signed-in cloud owner", (await anon.req("POST", "/sync/link/approve", { code })).status === 401);
  const view = await cloudOwner.req("GET", `/sync/link/requests/${code}`);
  check("the owner sees which shop and PC are asking", view.status === 200 && view.json.shop.name === `Linked Shop ${run}` && view.json.deviceName === "Counter PC" && view.json.existing === null, view.json);
  check("PC keeps waiting until approval", (await pollOnce(60_000)) === "waiting");
  const appr = await cloudOwner.req("POST", "/sync/link/approve", { code });
  check("owner approves; the cloud copy of the shop is created with the PC's own ids", appr.status === 200 && appr.json.organizationId === ORG && appr.json.created === true, appr.json);
  check("PC receives its credential and takes a snapshot", (await pollOnce(60_000)) === "approved");
  const cred = await credentialStore()!.load();
  const [dev] = await cloudDb`select id, credential_hash, organization_id, branch_id, status from sync_devices where id = ${cred!.deviceId}`;
  check("the cloud stores only a hash of the credential", !!dev && dev.credential_hash.length === 64 && !cred!.credential.includes(dev.credential_hash) && dev.organization_id === ORG && dev.branch_id === BRANCH, dev);
  const snapshot = await pcCount("sync_outbox");
  check("snapshot queued all existing records (customers, orders, payments, wallet…)", snapshot > 100 && (await outboxEvents("op = 'snapshot' and entity_table = 'payments'")).length === 2, snapshot);
  check("the link code works once", (await cloudOwner.req("POST", "/sync/link/approve", { code })).status === 409);
  check("the PC shows which cloud account approved the link", (await status(owner)).linkedBy === `cloud-owner-${run}@test.local`, (await status(owner)).linkedBy);

  // ------------------------------------------------------------------ plan required (paid add-on)
  section("Paid add-on: uploads need a cloud plan");
  const r402 = await syncNow();
  const st402 = await status(owner);
  check("without a plan the cloud refuses and the PC shows “plan required”", r402.started && r402.hold === "plan_required" && st402.cloudState === "plan_required", { r402, state: st402.cloudState });
  check("no change was lost or counted as a failed attempt", (await pc`select count(*)::int as n from sync_outbox where status = 'pending' and attempts = 0`)[0].n === snapshot);
  const [plan] = await cloudDb`insert into commercial_plans (code, name, price_paise, entitlements_json, published) values (${`cloud-${run}`}, 'Cloud test plan', 49900, '{"cloudSync": true}'::jsonb, true) returning id`;
  await cloudDb`insert into commercial_subscriptions (organization_id, plan_id, status, starts_at, ends_at) values (${ORG}, ${plan.id}, 'active', now(), now() + interval '30 days')`;

  // ------------------------------------------------------------------ 4. push + durable ack
  section("4. Push and durable acknowledgement");
  await pc`update sync_outbox set next_attempt_at = now() where status = 'pending'`;
  const first = await syncNow();
  const st = await status(owner);
  check("all snapshot changes upload and are acknowledged", first.started && first.synced === snapshot && st.pending === 0 && st.cloudState === "ok" && !!st.lastSuccessAt, { first, st });
  check("cloud now holds the shop's customers, orders and payments", (await cloudCount("customers", ORG)) === (await pcCount("customers")) && (await cloudCount("orders", ORG)) === 1 && (await cloudCount("payments", ORG)) === 2);
  const [applied] = await cloudDb`select count(*)::int as n from sync_applied_events where organization_id = ${ORG}`;
  check("every acknowledged event is recorded as committed in the cloud", applied.n === snapshot, applied.n);
  const shadows = await cloudDb`select u.status, u.email from users u join sync_shadow_users s on s.user_id = u.id where s.organization_id = ${ORG}`;
  check("PC staff exist in the cloud only as non-login records", shadows.length >= 1 && shadows.every((u) => u.status === "pc_staff" && u.email.endsWith("@pc-staff.drycare.invalid")), shadows);
  check("PC staff cannot sign in to the cloud", (await new CloudClient().req("POST", "/auth/login", { email: `pc-owner-${run}@test.local`, password: `Owner-${run}-Password1` })).status === 401);
  const orgs = await cloudOwner.req("GET", "/auth/organizations");
  check("the cloud owner can open the shop's cloud copy", orgs.json.some((o: any) => o.id === ORG && o.managedByPc), orgs.json);
  await cloudOwner.req("POST", "/auth/switch-organization", { organizationId: ORG });
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const pcDash = (await owner.req("GET", `/dashboard?from=${today}&to=${today}`)).json;
  const cloudDash = (await cloudOwner.req("GET", `/dashboard?from=${today}&to=${today}`)).json;
  check("cloud reports match the PC (billed and collected)", cloudDash?.grossBilled === pcDash?.grossBilled && cloudDash?.collections?.net === pcDash?.collections?.net, { cloud: [cloudDash?.grossBilled, cloudDash?.collections?.net], pc: [pcDash?.grossBilled, pcDash?.collections?.net] });
  const ro = await cloudOwner.req("POST", "/customers", { name: "Typed in the cloud" });
  check("the cloud copy is view-only (changes are made on the PC)", ro.status === 409 && ro.json?.error?.code === "MANAGED_BY_SHOP_PC", ro.json);

  // ------------------------------------------------------------------ 2. unauthorised / revoked
  section("2. Unauthorised devices");
  const sampleEvent = (await outboxEvents("entity_table = 'customers'"))[0];
  check("no credential → 401", (await fetch(`${CLOUD}/api/v1/sync/push`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: "{}" })).status === 401);
  check("wrong secret → 401", (await pushRaw(`${cred!.deviceId}.${"x".repeat(43)}`, [sampleEvent])).status === 401);
  check("unknown device → 401", (await pushRaw(`${randomUUID()}.${"y".repeat(43)}`, [sampleEvent])).status === 401);

  // ------------------------------------------------------------------ 3. cross-tenant / cross-branch
  section("3. Cross-tenant and cross-branch rejection");
  const c3 = await newCustomer("Cross Check");
  const tmpl = (await outboxEvents(`entity_table = 'customers' and entity_id = '${c3.id}'`))[0];
  const crossOrg = { ...tmpl, id: randomUUID(), seq: tmpl.seq + 10_000, entityId: randomUUID(), rowData: { ...tmpl.rowData, id: undefined, organization_id: intruderOrg } };
  crossOrg.rowData.id = crossOrg.entityId;
  let r = await pushRaw(cred!.credential, [crossOrg]);
  check("a row naming another business is rejected", r.status === 200 && r.json.results[0].outcome === "error" && /CROSS_TENANT/.test(r.json.results[0].message), r.json);
  const exp = await outboxEvents("entity_table = 'expenses'");
  const expenseRes = await owner.req("POST", "/expenses", { branchId: BRANCH, category: "Rent", amount: 1000, method: "upi", spentOn: today });
  const expEv = (await outboxEvents(`entity_table = 'expenses' and entity_id = '${expenseRes.json.id}'`))[0];
  const crossBranch = { ...expEv, id: randomUUID(), seq: expEv.seq + 10_000, entityId: randomUUID(), rowData: { ...expEv.rowData, branch_id: intruderBranch } };
  crossBranch.rowData.id = crossBranch.entityId;
  r = await pushRaw(cred!.credential, [crossBranch]);
  check("a row pointing at another business's branch is rejected", r.json?.results?.[0]?.outcome === "error" && /CROSS_BRANCH/.test(r.json.results[0].message), r.json);
  r = await pushRaw(cred!.credential, [{ ...tmpl, deviceId: randomUUID() }]);
  check("events claiming another device are refused", r.status === 400 && r.json.error.code === "DEVICE_MISMATCH", r.json);
  const ls2 = await owner.req("POST", "/sync/cloud-link/start", { deviceName: "Hijack attempt" });
  check("another cloud account cannot approve linking to this shop", (await intruder.req("POST", "/sync/link/approve", { code: ls2.json.userCode })).status === 403);
  void exp;
  await owner.req("POST", "/sync/cloud-link/cancel", {});

  // ------------------------------------------------------------------ 5/6. replay and reused ids
  section("5–6. Replays and reused event ids");
  await syncNow();
  const paymentsCloud = await cloudCount("payments", ORG);
  const ordEvents = await outboxEvents(`entity_table in ('payments', 'payment_allocations')`);
  r = await pushRaw(cred!.credential, ordEvents);
  check("replaying already-committed payment events → all duplicates", r.status === 200 && r.json.results.every((x: any) => x.outcome === "duplicate"), r.json?.counts);
  r = await pushRaw(cred!.credential, ordEvents);
  check("replaying again (same batch content, new batch id) → still duplicates", r.json.results.every((x: any) => x.outcome === "duplicate") && (await cloudCount("payments", ORG)) === paymentsCloud);
  const reused = { ...ordEvents[0], rowData: { ...ordEvents[0].rowData, amount: 99999 } };
  r = await pushRaw(cred!.credential, [reused]);
  check("an event id reused with different content is refused", r.json.results[0].outcome === "error" && /EVENT_ID_REUSED/.test(r.json.results[0].message) && r.json.results[0].retryable === false, r.json.results[0]);
  check("and the cloud payment is unchanged", Number((await cloudDb`select amount from payments where id = ${ordEvents[0].entityId}`)[0].amount) === Number(ordEvents[0].rowData.amount));

  // ------------------------------------------------------------------ 7. network loss
  section("7. Network loss before, during and after the cloud commits");
  const c7 = await newCustomer("Network Customer");
  await newOrder(c7.id, [{ amount: 41300, method: "cash" }]);
  const pend7 = (await status(owner)).pending;
  proxyMode = "drop-before";
  const nb = await syncNow();
  const st7a = await status(owner);
  check("connection lost before reaching the cloud: nothing committed, changes kept for retry", nb.synced === 0 && st7a.failed === pend7 && (await cloudCount("orders", ORG)) === 1, { nb, failed: st7a.failed, pend7 });
  proxyMode = "drop-after";
  await pc`update sync_outbox set next_attempt_at = now() where status = 'failed'`;
  const na = await syncNow();
  const ordersAfterLostAck = await cloudCount("orders", ORG);
  check("connection lost after the cloud committed: PC does not mark them uploaded", na.synced === 0 && ordersAfterLostAck === 2 && (await status(owner)).failed === pend7, { na, ordersAfterLostAck });
  proxyMode = "pass";
  await pc`update sync_outbox set next_attempt_at = now() where status = 'failed'`;
  const nr = await syncNow();
  const st7b = await status(owner);
  check("the retry is recognised as already committed: acknowledged, no duplicate order or payment", nr.synced === pend7 && st7b.pending === 0 && st7b.failed === 0 && (await cloudCount("orders", ORG)) === 2 && (await cloudCount("payments", ORG)) === paymentsCloud + 1, { nr, st7b });

  // ------------------------------------------------------------------ 8. restart with in-progress
  section("8. Restart with pending and in-progress uploads");
  const c8 = await newCustomer("Crash Customer");
  await newOrder(c8.id, [{ amount: 41300, method: "upi", reference: `UTR${run}` }]);
  const claimed = await claimBatch(db, 500);
  check("an upload was in progress when the app stopped", claimed.length > 3 && (await pc`select count(*)::int as n from sync_outbox where status = 'sending'`)[0].n === claimed.length);
  check("a new run does not touch in-progress events before their lease expires", (await syncNow()).synced === 0);
  await pc`update sync_outbox set lease_until = now() - interval '1 second' where status = 'sending'`;
  const after = await syncNow();
  check("after the lease expires (crash recovery) the same events upload once", after.synced === claimed.length && (await cloudCount("orders", ORG)) === 3, after);

  // ------------------------------------------------------------------ 9. out-of-order / stale
  section("9. Out-of-order and stale updates");
  const orderRow = (await outboxEvents(`entity_table = 'orders' and entity_id = '${o1.id}'`)).at(-1)!;
  const curVersion = Number((await cloudDb`select version from orders where id = ${o1.id}`)[0].version);
  const older = { ...orderRow, id: randomUUID(), seq: 1, op: "update", rowData: { ...orderRow.rowData, version: curVersion, notes: "older copy" } };
  r = await pushRaw(cred!.credential, [older]);
  check("an update older than what the cloud applied is acknowledged as stale, not applied", r.json.results[0].outcome === "stale" && (await cloudDb`select notes from orders where id = ${o1.id}`)[0].notes !== "older copy", r.json.results[0]);
  const sameVersion = { ...orderRow, id: randomUUID(), seq: 9_000_000, op: "update", rowData: { ...orderRow.rowData, version: curVersion, notes: "different at same version" } };
  r = await pushRaw(cred!.credential, [sameVersion]);
  check("same version with different content is a conflict", r.json.results[0].outcome === "conflict" && /VERSION_CONFLICT/.test(r.json.results[0].reason), r.json.results[0]);
  const lowerVersion = { ...orderRow, id: randomUUID(), seq: 9_000_001, op: "update", rowData: { ...orderRow.rowData, version: curVersion - 1, notes: "lower version" } };
  r = await pushRaw(cred!.credential, [lowerVersion]);
  check("a lower version is stale", r.json.results[0].outcome === "stale");

  // ------------------------------------------------------------------ 10. duplicate payments / stock
  section("10. Duplicate payments and stock movements");
  const pay = (await outboxEvents("entity_table = 'payments'"))[0];
  r = await pushRaw(cred!.credential, [{ ...pay, id: randomUUID(), seq: 9_000_010, op: "insert", idempotencyKey: `dup-${run}` }]);
  check("the same payment sent again under a new event id creates nothing new", ["applied", "stale"].includes(r.json.results[0].outcome) && (await cloudCount("payments", ORG)) === paymentsCloud + 2);
  r = await pushRaw(cred!.credential, [{ ...pay, id: randomUUID(), seq: 9_000_011, op: "insert", rowData: { ...pay.rowData, amount: Number(pay.rowData.amount) + 5000 } }]);
  check("a payment id reused with a different amount is a conflict, cloud amount unchanged", r.json.results[0].outcome === "conflict" && Number((await cloudDb`select amount from payments where id = ${pay.entityId}`)[0].amount) === Number(pay.rowData.amount), r.json.results[0]);
  await owner.req("POST", "/inventory/items/starter", {});
  const item = (await owner.req("GET", `/inventory/items?branchId=${BRANCH}`)).json[0];
  await owner.req("POST", "/inventory/movements", { branchId: BRANCH, itemId: item.id, kind: "opening", quantity: 10 });
  await syncNow();
  const mv = (await outboxEvents("entity_table = 'inventory_movements'"))[0];
  r = await pushRaw(cred!.credential, [{ ...mv, id: randomUUID(), seq: 9_000_020 }]);
  check("a stock movement replayed under a new event id is not counted twice", (await cloudCount("inventory_movements", ORG)) === 1, r.json.results[0]);

  // ------------------------------------------------------------------ 11. invalid allocations
  section("11. Payment and balance validation by the cloud");
  const inv = (await cloudDb`select id, grand_total, customer_id, branch_id from invoices where organization_id = ${ORG} order by issued_at limit 1`)[0];
  const payTmpl = (await outboxEvents("entity_table = 'payments'"))[0];
  const allocTmpl = (await outboxEvents("entity_table = 'payment_allocations'"))[0];
  const txid = 900_000 + Math.floor(Math.random() * 1000);
  const badPayId = randomUUID();
  const badPay = { ...payTmpl, id: randomUUID(), seq: 9_100_000, txid, entityId: badPayId, op: "insert", rowData: { ...payTmpl.rowData, id: badPayId, amount: 100, payment_reference: `BAD-${run}`, customer_id: inv.customer_id } };
  const badAllocId = randomUUID();
  const badAlloc = { ...allocTmpl, id: randomUUID(), seq: 9_100_001, txid, entityId: badAllocId, op: "insert", rowData: { ...allocTmpl.rowData, id: badAllocId, payment_id: badPayId, invoice_id: inv.id, allocated_amount: 500 } };
  r = await pushRaw(cred!.credential, [badPay, badAlloc]);
  check("an allocation larger than its payment is rejected (the whole PC change)", r.json.results.every((x: any) => x.outcome === "error" && /PAYMENT_TOTALS/.test(x.message)) && (await cloudDb`select count(*)::int as n from payments where id = ${badPayId}`)[0].n === 0, r.json.results);
  const bigPayId = randomUUID();
  const bigAllocId = randomUUID();
  const txid2 = txid + 1;
  r = await pushRaw(cred!.credential, [
    { ...badPay, id: randomUUID(), seq: 9_100_010, txid: txid2, entityId: bigPayId, rowData: { ...badPay.rowData, id: bigPayId, amount: Number(inv.grand_total) * 3, payment_reference: `BIG-${run}` } },
    { ...badAlloc, id: randomUUID(), seq: 9_100_011, txid: txid2, entityId: bigAllocId, rowData: { ...badAlloc.rowData, id: bigAllocId, payment_id: bigPayId, allocated_amount: Number(inv.grand_total) * 3 } },
  ]);
  check("payments exceeding the invoice total are rejected", r.json.results.every((x: any) => x.outcome === "error" && /INVOICE_OVERPAID/.test(x.message)), r.json.results);

  // ------------------------------------------------------------------ 12. conflicts
  section("12. Conflicts never overwrite financial data");
  await cloudDb`update invoices set due_at = '2030-01-01' where id = ${inv.id}`; // e.g. a support correction in the cloud
  await pc`update invoices set due_at = now() + interval '9 days' where id = ${inv.id}`;
  await syncNow();
  const confl = await pc`select reason, remote_data, status from sync_conflicts where entity_table = 'invoices' and entity_id = ${inv.id}`;
  check("the PC records the conflict with the cloud's version", confl.length === 1 && /CHANGED_IN_CLOUD/.test(confl[0].reason) && String(confl[0].remote_data.due_at).startsWith("2030-01-01"), confl);
  check("the cloud invoice keeps its value", String((await cloudDb`select due_at::date::text as d from invoices where id = ${inv.id}`)[0].d) === "2030-01-01");
  const sst = await status(owner);
  check("the status shows a conflict for the owner", sst.conflicts === 1, sst.conflicts);
  const conflicts = (await owner.req("GET", "/sync/conflicts")).json;
  const rec = new PcClient();
  await owner.req("POST", "/staff", { name: "Counter", email: `rec-${run}@test.local`, password: `Staff-${run}-Password1`, roleKey: "reception", branchIds: [BRANCH] });
  await rec.req("POST", "/auth/login", { email: `rec-${run}@test.local`, password: `Staff-${run}-Password1` });
  check("counter staff cannot resolve conflicts", (await rec.req("POST", `/sync/conflicts/${conflicts[0].id}/resolve`, { action: "skip", note: "not mine" })).status === 403);
  const res12 = await owner.req("POST", `/sync/conflicts/${conflicts[0].id}/resolve`, { action: "skip", note: "Cloud correction is right" });
  check("the owner decides (skip this change); nothing was overwritten automatically", res12.status === 200 && (await status(owner)).conflicts === 0, res12.json);
  const remote = await cloudDb`select code from sync_remote_conflicts where organization_id = ${ORG}`;
  check("the cloud keeps an investigation log (codes and hashes, no row data)", remote.some((x) => x.code === "CHANGED_IN_CLOUD") && remote.some((x) => x.code === "EVENT_ID_REUSED"), remote.map((x) => x.code));

  // ------------------------------------------------------------------ 13. schema mismatch
  section("13. Schema-version mismatch");
  await syncNow();
  await pc`update sync_config set schema_version = '9999_future_version'`;
  const c13 = await newCustomer("Future Schema");
  const r13 = await syncNow();
  check("a PC newer than the cloud is held back with a clear state", r13.hold === "schema_too_new" && (await status(owner)).cloudState === "schema_too_new", r13);
  check("its changes stay safely on the PC", (await pc`select status, attempts from sync_outbox where entity_id = ${c13.id}`).every((x) => x.status === "pending" && x.attempts === 0));
  await pc`update sync_config set schema_version = (select schema_version from sync_outbox where schema_version <> '9999_future_version' order by seq desc limit 1)`;
  await pc`update sync_outbox set schema_version = (select schema_version from sync_config), next_attempt_at = now() where schema_version = '9999_future_version'`;
  check("after the versions match again it uploads", (await syncNow()).synced >= 1 && (await status(owner)).cloudState === "ok");

  // ------------------------------------------------------------------ 14. large / resumable
  section("14. Large changes: staged commit, never partly visible");
  const bulkCount = async () => (await cloudDb`select count(*)::int as n from customers where customer_code like ${`BULK-${run}-%`}`)[0].n as number;
  await pc.unsafe(`insert into customers (organization_id, customer_code, name) select '${ORG}', 'BULK-${run}-' || g, 'Bulk customer ' || g from generate_series(1, 1200) g`);
  const part = await syncNow({ maxBatches: 1, batchSize: 400 });
  const stagedOnPc = (await pc`select count(*)::int as n from sync_outbox where status = 'staged'`)[0].n;
  check("a 1,200-record change: the first 400 are held by the cloud, not applied", part.synced === 0 && stagedOnPc === 400 && (await bulkCount()) === 0, { part, stagedOnPc, cloud: await bulkCount() });
  check("held parts still count as waiting on the PC (never shown as uploaded)", (await status(owner)).pending === 1200);
  const part2 = await syncNow({ maxBatches: 1, batchSize: 400 });
  check("the second part is held too (after a pause or restart)", part2.synced === 0 && (await bulkCount()) === 0, part2);
  const restRun = await syncNow({ batchSize: 400 });
  check("when the last part arrives the whole change is applied at once", restRun.synced === 1200 && (await bulkCount()) === 1200 && (await status(owner)).pending === 0, { restRun, cloud: await bulkCount() });
  check("held parts are cleared from the cloud afterwards", (await cloudDb`select count(*)::int as n from sync_staged_events`)[0].n === 0);

  const cBig = await newCustomer("Wedding Order Customer");
  const big = (await owner.req("POST", "/orders", { customerId: cBig.id, branchId: BRANCH, promisedAt: new Date(Date.now() + 5 * 86400_000).toISOString(), items: [{ garmentTypeId: suit.id, serviceId: DC.id, quantity: 200 }, { garmentTypeId: suit.id, serviceId: DC.id, quantity: 200 }], payments: [{ amount: 100000, method: "cash" }] })).json;
  const bigEvents = (await pc`select count(*)::int as n from sync_outbox where txid = (select txid from sync_outbox where entity_table = 'orders' and entity_id = ${big.id} limit 1)`)[0].n;
  check("a real 400-garment order is one PC change larger than a batch", big.garments?.length === 400 && bigEvents > 400, { garments: big.garments?.length, bigEvents });
  await syncNow({ maxBatches: 1, batchSize: 400 });
  const cloudBig = async () => (await cloudDb`select (select count(*)::int from orders where id = ${big.id}) as o, (select count(*)::int from garments where order_id = ${big.id}) as g, (select count(*)::int from payments where customer_id = ${cBig.id}) as p`)[0];
  check("after the first part the cloud shows neither the order, its garments nor its payment", JSON.stringify(await cloudBig()) === JSON.stringify({ o: 0, g: 0, p: 0 }), await cloudBig());
  await cloudDb`delete from sync_staged_events`; // e.g. the cloud lost its held parts
  await syncNow({ batchSize: 400 });
  await syncNow({ batchSize: 400 });
  check("missing parts are detected and the whole order is re-sent, then applied completely", JSON.stringify(await cloudBig()) === JSON.stringify({ o: 1, g: 400, p: 1 }) && (await status(owner)).pending === 0, await cloudBig());

  r = await pushRaw(cred!.credential, Array.from({ length: 501 }, () => sampleEvent));
  check("batches over the size limit are refused", r.status === 400, r.status);

  // ------------------------------------------------------------------ 15. rotation and revocation
  section("15. Credential rotation and revocation");
  const before15 = await credentialStore()!.load();
  await credentialStore()!.save({ ...before15!, credentialExpiresAt: new Date(Date.now() + 86400_000).toISOString() });
  await newCustomer("Rotation Customer");
  await syncNow();
  const after15 = await credentialStore()!.load();
  check("a credential near expiry is rotated automatically", after15!.credential !== before15!.credential && new Date(after15!.credentialExpiresAt).getTime() > Date.now() + 80 * 86400_000);
  check("the old credential keeps working briefly (in case the PC missed the reply)", (await fetch(`${CLOUD}/api/v1/sync/device`, { headers: { authorization: `Device ${before15!.credential}` } })).status === 200);
  const devs = await cloudOwner.req("GET", "/sync/devices");
  const rv = await cloudOwner.req("POST", `/sync/devices/${cred!.deviceId}/revoke`, { reason: "PC stolen" });
  check("the owner revokes the PC from the cloud", devs.status === 200 && devs.json.length === 1 && rv.status === 200, rv.json);
  const c15 = await newCustomer("After Revoke");
  const r15 = await syncNow();
  check("a revoked PC stops with “link again”, keeping its changes", r15.hold === "relink_required" && (await status(owner)).cloudState === "relink_required" && (await pc`select count(*)::int as n from sync_outbox where entity_id = ${c15.id} and status = 'pending'`)[0].n >= 1, r15);
  check("the revoked credential is refused", (await pushRaw(after15!.credential, [sampleEvent])).json?.error?.code === "DEVICE_REVOKED");
  const relink = await owner.req("POST", "/sync/cloud-link/start", { deviceName: "Counter PC" });
  check("re-linking the same shop by its owner works", (await cloudOwner.req("POST", "/sync/link/approve", { code: relink.json.userCode })).status === 200 && (await pollOnce(60_000)) === "approved");
  await new Promise((res) => setTimeout(res, 200));
  const r15b = await syncNow();
  check("after re-linking the queued changes upload (snapshot repeats are recognised)", (r15b.started && (await status(owner)).pending === 0) && (await cloudDb`select count(*)::int as n from customers where id = ${c15.id}`)[0].n === 1, r15b);
  const other = await owner.req("POST", "/sync/cloud-link/start", { deviceName: "Second PC" });
  await waitIdle();
  await pc`update sync_config set device_id = gen_random_uuid()`; // pretend this is a different PC
  const second = await owner.req("POST", "/sync/cloud-link/start", { deviceName: "Second PC" });
  const one = await cloudOwner.req("POST", "/sync/link/approve", { code: second.json.userCode });
  check("only one PC per shop: a second PC needs explicit replacement", one.status === 409 && one.json.error.code === "DEVICE_ALREADY_LINKED", one.json);
  void other;
  await owner.req("POST", "/sync/cloud-link/cancel", {});

  // ------------------------------------------------------------------ readiness hardening
  section("Readiness: restore pause, spoofed IPs, production configuration");
  await waitIdle();
  await pc`update sync_config set cloud_state = 'restored'`;
  const paused = await owner.req("POST", "/sync/now", {});
  check("after a backup restore, uploads pause until the owner re-checks", paused.status === 409 && paused.json.error.code === "RESTORED_PAUSED" && (await status(owner)).cloudState === "restored", paused.json);
  await pc`update sync_config set cloud_state = 'ok'`;
  let limited = false;
  for (let i = 0; i < 14 && !limited; i++) {
    const rr = await fetch(`${CLOUD}/api/v1/sync/link/start`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1", "x-forwarded-for": `203.0.113.${i}` }, body: JSON.stringify({ deviceId: randomUUID(), deviceName: "spoof", shop: { organizationId: randomUUID(), organizationName: "x", branchId: randomUUID(), branchName: "x", branchCode: "X" } }) });
    limited = rr.status === 429;
  }
  check("a faked X-Forwarded-For header does not get around rate limits", limited);
  const bad = spawn(process.execPath, [tsx, "src/server.ts"], { cwd: apiDir, env: { ...cloudEnv, NODE_ENV: "production", COOKIE_SECURE: "false", API_PORT: String(await freePort()) }, stdio: ["ignore", "ignore", "pipe"] });
  let badErr = "";
  bad.stderr?.on("data", (d) => { badErr += String(d); });
  const badCode = await new Promise<number | null>((res) => { bad.on("exit", (c) => res(c)); setTimeout(() => { bad.kill(); res(-1); }, 20_000); });
  check("the cloud refuses to start in production with unsafe settings", badCode === 1 && /COOKIE_SECURE/.test(badErr) && /WEB_ORIGIN/.test(badErr), { badCode, badErr: badErr.slice(0, 300) });

  // ------------------------------------------------------------------ 16. existing workflows
  section("16. Existing workflows with sync on");
  await pc`update sync_config set device_id = ${cred!.deviceId}`;
  const c16 = await newCustomer("Workflow Customer");
  const o16 = await newOrder(c16.id, [{ amount: 10000, method: "cash" }]);
  check("billing: collect balance", (await owner.req("POST", `/orders/${o16.id}/payments`, { payments: [{ amount: 31300, method: "cash" }] })).status === 201);
  check("wallet top-up", (await owner.req("POST", `/customers/${c16.id}/wallet/topups`, { branchId: BRANCH, amount: 20000, method: "cash" })).status === 201);
  check("stock movement", (await owner.req("POST", "/inventory/movements", { branchId: BRANCH, itemId: item.id, kind: "use", quantity: 2 })).status === 201);
  check("reports", (await owner.req("GET", "/reports/run/daybook")).status === 200);
  const bdir = mkdtempSync(path.join(tmpdir(), "drycare-cs-"));
  const bk = await createBackup(pc as never, bdir, { appVersion: "test", kind: "manual" });
  check("backup works with sync tables", (await readBackupManifest(bk.file)).tables.includes("sync_outbox"));
  const final = await syncNow();
  check("final sync: PC and cloud agree on payments and customers", final.started && (await cloudCount("payments", ORG)) === (await pcCount("payments")) - 0 && (await cloudCount("customers", ORG)) === (await pcCount("customers")), { final, cloudPay: await cloudCount("payments", ORG), pcPay: await pcCount("payments"), cloudCust: await cloudCount("customers", ORG), pcCust: await pcCount("customers") });
} catch (err) {
  failures++;
  console.log("  ✗ test crashed:", (err as Error).stack);
  if (cloudStderr) console.log("  cloud stderr:", cloudStderr.slice(-1500));
} finally {
  stopSyncWorker();
  await waitIdle();
  console.log(`\nLOCAL TEST CLOUD (simulated) — ${failures ? `${failures} CHECK(S) FAILED` : "ALL CHECKS PASSED"} · proxy requests: ${proxyHits}`);
  await app.close();
  await pc.end();
  await cloudDb.end();
  cloudProc.kill();
  proxy.close();
  await new Promise((res) => setTimeout(res, 500));
  for (const d of [CLOUD_DB, PC_DB]) await admin.unsafe(`drop database if exists ${d} with (force)`).catch(() => {});
  await admin.end();
  process.exit(failures ? 1 : 0);
}
