/**
 * Software releases, against the running cloud server (API_URL, default http://127.0.0.1:4000). Each PC here is a real
 * license key checking in over HTTP. Run: pnpm release-test. Uses test versions and PCs, which it removes. The rollback
 * part runs the real watchdog script on throwaway folders, so it touches nothing installed.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, verify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { rollbackScript } from "../apps/desktop/src/rollback";
import { rolloutBucket } from "../apps/api/src/modules/releases";

const CLOUD = process.env.API_URL ?? "http://127.0.0.1:4000";
let failures = 0;
const results: string[] = [];
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else {
    failures++;
    results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`);
  }
}
const section = (t: string) => results.push(`\n${t}`);

const runId = randomUUID().slice(0, 6);
const platformOrg = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const platformRole = platformOrg && (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, platformOrg.id), eq(r.key, "platform_admin")) }));
if (!platformOrg || !platformRole) throw new Error("Run pnpm admin:create once before this test.");
const [saUser] = await db.insert(schema.users).values({ email: `sa-release-${runId}@test.local`, name: "Release Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platformOrg.id, userId: saUser.id, roleId: platformRole.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: saUser.id, organizationId: platformOrg.id, expiresAt: new Date(Date.now() + 3_600_000) });
const headers = { cookie: `dc_session=${token}`, "x-drycare-csrf": "1" };
const sa = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${CLOUD}/api/v1${url}`, { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const reason = "Automated release test";
const base = Number.parseInt(runId.slice(0, 3), 16);
const v = (n: number) => `90.${base}.${n}`;
/** A small, properly formed Windows program with no signature, different each time. */
function installer() {
  const file = Buffer.alloc(0x400 + 0x1000);
  file.write("MZ", 0, "latin1");
  file.writeUInt32LE(0x40, 0x3c);
  file.write("PE\0\0", 0x40, "latin1");
  const coff = 0x44;
  file.writeUInt16LE(0x8664, coff); // x64
  file.writeUInt16LE(1, coff + 2); // one section
  file.writeUInt16LE(240, coff + 16); // optional header size
  file.writeUInt16LE(0x22, coff + 18); // executable, large addresses
  const opt = coff + 20;
  file.writeUInt16LE(0x20b, opt); // PE32+
  file.writeUInt32LE(0x1000, opt + 4); // code size
  file.writeUInt32LE(0x1000, opt + 16); // entry point
  file.writeUInt32LE(0x1000, opt + 20); // code base
  file.writeBigUInt64LE(0x140000000n, opt + 24); // image base
  file.writeUInt32LE(0x1000, opt + 32); // section alignment
  file.writeUInt32LE(0x200, opt + 36); // file alignment
  file.writeUInt16LE(6, opt + 48); // subsystem version
  file.writeUInt32LE(0x2000, opt + 56); // image size
  file.writeUInt32LE(0x400, opt + 60); // headers size
  file.writeUInt16LE(3, opt + 68); // console
  file.writeUInt32LE(16, opt + 108); // data directories
  const section = opt + 240;
  file.write(".text", section, "latin1");
  file.writeUInt32LE(0x1000, section + 8);
  file.writeUInt32LE(0x1000, section + 12);
  file.writeUInt32LE(0x1000, section + 16);
  file.writeUInt32LE(0x400, section + 20);
  file.writeUInt32LE(0x60000020, section + 36);
  randomBytes(0x1000).copy(file, 0x400);
  file[0x400] = 0xc3; // return
  return file;
}
const { publicKeyPem } = (await sa("GET", "/platform-admin/licenses/signing-key")).json;
const made: string[] = [];

// Real PCs: a key issued for them, checking in with it.
const pcs = Array.from({ length: 12 }, () => randomUUID());
const customer = `Release Customer ${runId}`;
const issued = await sa("POST", "/platform-admin/licenses", { customerName: customer, plan: "Starter", expiresOn: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), installationIds: pcs, allowExtraPcs: true });
if (issued.status >= 300) throw new Error(`Could not issue a test key: ${JSON.stringify(issued.json)}`);
const key: string = issued.json.key;
const licenseId: string = issued.json.id;

async function ask(pc: string, version: string, overrideKey = key): Promise<any> {
  const nonce = randomUUID();
  const res = await fetch(`${CLOUD}/api/v1/updates/check`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ key: overrideKey, installationId: pc, nonce, version, pcName: `PC-${pc.slice(0, 4)}`, os: "Windows 11", arch: "x64" }) });
  // Waits out the server's limit rather than reading a refusal as "nothing offered".
  if (res.status === 429) {
    await new Promise((done) => setTimeout(done, 20_000));
    return ask(pc, version, overrideKey);
  }
  if (!res.ok) return { status: res.status, manifest: null as any };
  const { token: t } = (await res.json()) as { token: string };
  const [prefix, payload, signature] = t.split(".");
  const bytes = Buffer.from(payload, "base64url");
  const good = prefix === "DRYCARERELEASE2" && verify(null, bytes, publicKeyPem, Buffer.from(signature, "base64url"));
  return { status: res.status, manifest: JSON.parse(bytes.toString()), good, nonce, bytes, signature };
}
const offeredVersion = async (pc: string, version: string) => (await ask(pc, version)).manifest?.release?.version ?? null;
const put = (id: string, body: Buffer, extra: Record<string, string> = {}) => fetch(`${CLOUD}/api/v1/platform-admin/releases/${id}/file`, { method: "PUT", headers: { ...headers, "content-type": "application/octet-stream", ...extra }, body: new Uint8Array(body) });
async function newRelease(version: string, fields: object = {}) {
  const r = await sa("POST", "/platform-admin/releases", { version, ...fields });
  if (r.status === 201) made.push(version);
  return r;
}
const act = (id: string, action: string, extra: object = {}) => sa("POST", `/platform-admin/releases/${id}/action`, { action, reason, ...extra });

try {
  section("Tests 1, 2: uploading and drafts");
  let r = await newRelease(v(1), { notes: "Test notes", channel: "stable", buildNumber: "101", title: "Test title" });
  check("the owner adds a draft", r.status === 201 && r.json.status === "draft" && r.json.channel === "stable", r.json);
  const id: string = r.json.id;
  r = await newRelease(v(1));
  check("the same version cannot be added twice", r.status === 409, r.json);
  r = await act(id, "stage");
  check("it cannot be released with no installer", r.status === 409, r.json);
  let up = await put(id, Buffer.from("this is not a program".repeat(100)));
  check("a file that is not an installer is refused", up.status === 422, up.status);
  const file = installer();
  up = await put(id, file, { "x-expected-sha256": "a".repeat(64) });
  check("a checksum that does not match is refused", up.status === 422 && ((await up.json()) as any).error.code === "CHECKSUM_MISMATCH");
  up = await put(id, file, { "x-expected-sha256": createHash("sha256").update(file).digest("hex") });
  const uploaded = (await up.json()) as { sha256: string; sha512: string; sizeBytes: number; signatureStatus: string };
  check("the installer uploads, with SHA-256 and signature status", up.status === 200 && uploaded.sha256 === createHash("sha256").update(file).digest("hex") && uploaded.signatureStatus === "not_signed", uploaded);
  check("a draft is offered to nobody", (await offeredVersion(pcs[0], "1.0.0")) === null);

  section("Test 3: signatures, on a really signed program");
  r = await newRelease(v(80));
  const signedId: string = r.json.id;
  const signedProgram = readFileSync(process.execPath);
  up = await put(signedId, signedProgram);
  const signedResult = (await up.json()) as any;
  check("a validly signed installer is recognised, with its publisher", up.status === 200 && signedResult.signatureStatus === "valid" && /OpenJS|Node/i.test(signedResult.signaturePublisher ?? ""), signedResult);
  r = await act(signedId, "test");
  check("and needs no unsigned approval", r.status === 200 && r.json.unsignedApproved === false, r.json);
  await act(signedId, "withdraw");
  r = await newRelease(v(81));
  const tamperedId: string = r.json.id;
  const tampered = Buffer.from(signedProgram);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  up = await put(tamperedId, tampered);
  check("one changed byte in a signed installer is refused, and nothing is saved", up.status === 422 && ((await up.json()) as any).error.code === "SIGNATURE_INVALID", up.status);
  r = await act(tamperedId, "stage", { allowUnsigned: true });
  check("so a tampered package can never be released", r.status === 409 && r.json.error.code === "RELEASE_FILE_MISSING", r.json);

  section("Settings that cannot go together");
  r = await newRelease(v(90), { automatic: true });
  check("automatic with no maintenance window is refused", r.status === 422, r.json);
  r = await newRelease(v(90), { mandatory: false, updateDeadline: new Date(Date.now() + 864e5).toISOString() });
  check("a deadline on an optional update is refused", r.status === 422, r.json);
  r = await newRelease(v(90), { minSupportedVersion: "99.0.0" });
  check("a minimum newer than the version is refused", r.status === 422, r.json);

  section("Unsigned packages");
  r = await act(id, "stage");
  check("an unsigned installer cannot be released by accident", r.status === 409 && r.json.error.code === "RELEASE_NOT_SIGNED", r.json);

  section("Test 5: staged rollout");
  r = await act(id, "stage", { allowUnsigned: true });
  check("with the owner's explicit choice, it starts at 10%", r.status === 200 && r.json.status === "staged" && r.json.rolloutPercent === 10 && r.json.unsignedApproved === true, r.json);
  const in10 = pcs.filter((p) => rolloutBucket(p, v(1)) < 10);
  const offered10 = (await Promise.all(pcs.map((p) => offeredVersion(p, "1.0.0")))).filter(Boolean).length;
  check(`the server offers it to exactly the PCs in that stage (${in10.length} of ${pcs.length})`, offered10 === in10.length, offered10);
  const many = Array.from({ length: 5000 }, () => randomUUID());
  const share = (p: number) => many.filter((x) => rolloutBucket(x, v(1)) < p);
  check(`about 10% of a large group is in it (${share(10).length} of 5000)`, share(10).length > 400 && share(10).length < 600);
  check("widening never drops a PC", share(10).every((x) => rolloutBucket(x, v(1)) < 25));
  r = await act(id, "next_stage");
  check("the next stage widens it", r.json.rolloutPercent === 25 && r.json.currentStage === 1, r.json);

  const all = (await sa("GET", "/platform-admin/releases")).json;
  const row = all.releases.find((x: any) => x.id === id);
  check("the owner sees eligible and selected PCs per stage", row.eligible >= 0 && row.stageCounts.length === 4 && row.stageCounts[3].percent === 100, row.stageCounts);

  r = await sa("PATCH", `/platform-admin/releases/${id}`, { rolloutPercent: 100, reason });
  check("the share can be set by hand", r.status === 200 && r.json.rolloutPercent === 100, r.json);
  section("Tests 7, 8: a PC gets it");
  const someone = pcs[0];
  const asked = await ask(someone, "1.0.0");
  check("the manifest is signed by the licensing key", asked.good === true);
  check("it answers this PC's one-time code", asked.manifest.nonce === asked.nonce && asked.manifest.installationId === someone, asked.manifest);
  check("it carries both checksums", asked.manifest.release?.sha256 === uploaded.sha256 && asked.manifest.release?.sha512 === uploaded.sha512, asked.manifest.release);
  check("a changed manifest fails the check", !verify(null, Buffer.from(asked.bytes!.toString().replace(uploaded.sha256, "0".repeat(64))), publicKeyPem, Buffer.from(asked.signature!, "base64url")));
  const feed = asked.manifest.release.feedToken as string;
  const yml = await (await fetch(`${CLOUD}/api/v1/updates/feed/${feed}/latest.yml`)).text();
  check("the feed needs the signed link, and names the version", yml.includes(`version: ${v(1)}`), yml);
  const name = /url: (\S+)/.exec(yml)![1];
  const dl = await fetch(`${CLOUD}/api/v1/updates/feed/${feed}/${name}`);
  check("the file downloads intact", dl.status === 200 && createHash("sha256").update(Buffer.from(await dl.arrayBuffer())).digest("hex") === uploaded.sha256);
  const part = await fetch(`${CLOUD}/api/v1/updates/feed/${feed}/${name}`, { headers: { range: "bytes=0-1" } });
  check("a download can resume", part.status === 206 && Buffer.from(await part.arrayBuffer()).toString("latin1") === "MZ", part.status);

  section("Test 13: unauthorized downloads");
  const forged = `${feed.split(".")[0]}.${Buffer.from("x".repeat(64)).toString("base64url")}`;
  check("a forged link is refused", (await fetch(`${CLOUD}/api/v1/updates/feed/${forged}/latest.yml`)).status === 403);
  check("the old open address is gone", (await fetch(`${CLOUD}/api/v1/updates/${someone}/download/${v(1)}/x.exe`)).status === 404);
  const stranger = await ask(randomUUID(), "1.0.0");
  check("a PC not on any key is refused", stranger.status === 401 || stranger.manifest?.release === null, stranger.status);
  const wrong = key.split(".");
  const tamperedKey = await ask(someone, "1.0.0", `${wrong[0]}.${wrong[1]}.${Buffer.from("x".repeat(64)).toString("base64url")}`);
  check("a changed license key is refused", tamperedKey.status === 401, tamperedKey.status);
  await sa("POST", `/platform-admin/license-devices/${pcs[1]}/status`, { status: "deactivated", licenseId, reason });
  check("a removed PC is offered nothing", (await offeredVersion(pcs[1], "1.0.0")) === null);
  await sa("POST", `/platform-admin/license-devices/${pcs[1]}/status`, { status: "active", licenseId, reason });
  await sa("POST", `/platform-admin/licenses/${licenseId}/status`, { status: "suspended", reason });
  check("a suspended license is offered nothing", (await offeredVersion(someone, "1.0.0")) === null);
  await sa("POST", `/platform-admin/licenses/${licenseId}/status`, { status: "active", reason });

  section("Downgrade protection");
  check("a PC is never offered an older version", (await offeredVersion(someone, "95.0.0")) === null);
  check("nor the one it already has", (await offeredVersion(someone, v(1))) === null);

  section("Test 6: pause and resume");
  r = await act(id, "pause");
  check("pausing stops it", r.json.status === "paused" && (await offeredVersion(someone, "1.0.0")) === null, r.json);
  check("a link already handed out stops working", (await fetch(`${CLOUD}/api/v1/updates/feed/${feed}/latest.yml`)).status === 404);
  r = await act(id, "resume");
  check("resuming carries on where it was", ["staged", "published"].includes(r.json.status) && r.json.rolloutPercent === 100 && (await offeredVersion(someone, "1.0.0")) === v(1), r.json);
  up = await put(id, installer());
  check("a released version's file can never be replaced", up.status === 409, up.status);

  section("Test 12: an offline PC");
  const late = pcs[2];
  check("it has not been marked as updated", (await sqlClient`select 1 from license_installations where installation_id = ${late} and last_success_at is not null`).length === 0);
  check("when it reconnects it gets the update", (await offeredVersion(late, "1.0.0")) === v(1));

  section("Test 4: beta channel, and testing");
  r = await newRelease(v(2), { channel: "beta" });
  const betaId: string = r.json.id;
  await put(betaId, installer());
  await act(betaId, "publish", { allowUnsigned: true });
  check("a stable PC does not get a beta", (await offeredVersion(someone, v(1))) === null);
  await sa("PATCH", `/platform-admin/release-pcs/${pcs[3]}`, { channel: "beta", reason });
  check("a PC moved to beta does", (await offeredVersion(pcs[3], v(1))) === v(2));
  r = await newRelease(v(3));
  const testId: string = r.json.id;
  await put(testId, installer());
  await act(testId, "test");
  check("a version in testing skips everyone", (await offeredVersion(someone, v(1))) === null);
  await sa("PATCH", `/platform-admin/release-pcs/${pcs[4]}`, { betaGroup: true, reason });
  check("except the beta testing group", (await offeredVersion(pcs[4], v(1))) === v(3));
  await act(testId, "pause");
  r = await act(testId, "resume");
  check("resuming a paused test into a rollout still needs the unsigned approval", r.status === 409 && r.json.error.code === "RELEASE_NOT_SIGNED", r.json);
  await act(testId, "withdraw");
  r = await act(testId, "publish", { allowUnsigned: true });
  check("a withdrawn release can never come back", r.status === 409 && r.json.error.code === "RELEASE_WITHDRAWN", r.json);
  r = await act(id, "resume");
  check("only a paused release can be resumed", r.status === 409, r.json);
  await act(betaId, "withdraw");

  section("Targeting");
  r = await newRelease(v(4));
  const targetId: string = r.json.id;
  await put(targetId, installer());
  await act(targetId, "publish", { allowUnsigned: true });
  await sa("PATCH", `/platform-admin/releases/${targetId}`, { target: { type: "installations", ids: [pcs[5]] }, reason });
  check("selected PCs get it", (await offeredVersion(pcs[5], v(1))) === v(4));
  check("others do not", (await offeredVersion(pcs[6], v(1))) === null);
  await sa("PATCH", `/platform-admin/releases/${targetId}`, { target: { type: "customers", ids: [customer] }, reason });
  check("so do selected customers", (await offeredVersion(pcs[6], v(1))) === v(4));
  await sa("PATCH", `/platform-admin/releases/${targetId}`, { target: { type: "customers", ids: ["Somebody Else"] }, reason });
  check("and only those", (await offeredVersion(pcs[6], v(1))) === null);
  await sa("PATCH", `/platform-admin/releases/${targetId}`, { target: { type: "all" }, reason });

  section("Tests 9, 10: reports, and auto-pause");
  const report = (pc: string, status: string, to = v(4), detail?: string) => fetch(`${CLOUD}/api/v1/updates/report`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ key, installationId: pc, fromVersion: v(1), toVersion: to, status, detail }) });
  const fakeReport = (body: object) => fetch(`${CLOUD}/api/v1/updates/report`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ installationId: randomUUID(), toVersion: v(4), status: "failed", detail: "Forged", ...body }) });
  check("a stranger cannot report failures to pause a rollout", (await fakeReport({ key })).status === 401 && (await fakeReport({ key: "DRYCARE1.bad.bad" })).status === 401 && (await fakeReport({})).status >= 400);
  await report(pcs[7], "succeeded");
  const pcRowGood = (await sa("GET", `/platform-admin/release-pcs?search=${pcs[7]}`)).json.items[0];
  check("a success is recorded on the PC", pcRowGood?.lastSuccessVersion === v(4), pcRowGood);
  await report(pcs[8], "failed", v(4), "Test failure");
  const pcRow = (await sa("GET", `/platform-admin/release-pcs?search=${pcs[8]}`)).json.items[0];
  check("a failure shows as Update failed", pcRow?.updateState === "failed" && pcRow?.lastError === "Test failure", pcRow);
  await report(pcs[9], "failed", v(4), "Test failure");
  await report(pcs[10], "rolled_back", v(4), "Did not start");
  const paused = (await sa("GET", "/platform-admin/releases")).json.releases.find((x: any) => x.id === targetId);
  check("too many failures pause it automatically", paused.status === "paused" && /automatically/i.test(paused.pauseReason ?? ""), { status: paused.status, why: paused.pauseReason, reports: paused.reports });
  const hist = (await sa("GET", `/platform-admin/release-pcs/${pcs[8]}/history`)).json;
  check("a PC's whole history can be viewed", hist.reports?.some((x: any) => x.status === "failed"), hist);
  const filtered = (await sa("GET", `/platform-admin/release-pcs?search=${encodeURIComponent(customer)}&status=failed`)).json;
  check("filters work", filtered.total >= 1 && filtered.items.every((x: any) => x.updateState === "failed"), filtered.total);

  section("Emergency stop");
  r = await newRelease(v(5));
  const stopId: string = r.json.id;
  await put(stopId, installer());
  await act(stopId, "publish", { allowUnsigned: true });
  check("a version is out", (await offeredVersion(someone, v(1))) === v(5));
  r = await sa("POST", "/platform-admin/releases/emergency-stop", { reason });
  check("the emergency stop halts everything at once", r.status === 200 && r.json.paused?.includes(v(5)) && (await offeredVersion(someone, v(1))) === null, r.json);

  section("Test 11: rollback");
  r = await sa("POST", "/platform-admin/releases/rollbacks", { fromVersion: v(1), toVersion: v(5), scope: { type: "all" }, reason });
  check("a rollback must go to an earlier version", [409, 422].includes(r.status), r.json);
  r = await sa("POST", "/platform-admin/releases/rollbacks", { fromVersion: v(5), toVersion: v(1), scope: { type: "installations", ids: [someone] }, reason });
  const rollbackId = r.json.id;
  check("the owner starts a rollback", r.status === 201, r.json);
  const back = await ask(someone, v(5));
  check("the chosen PC is sent back, marked as a rollback, signed", back.good === true && back.manifest.release?.version === v(1) && back.manifest.release?.rollback === true, back.manifest?.release);
  check("another PC is not", (await ask(pcs[11], v(5))).manifest?.release === null);
  if (back.manifest?.release?.feedToken) check("the earlier version can be downloaded for it", (await fetch(`${CLOUD}/api/v1/updates/feed/${back.manifest.release.feedToken}/latest.yml`)).status === 200);
  r = await act(id, "recommend");
  check("a previous version can be marked recommended", r.json.recommended === true, r.json);
  const rb = (await sa("GET", "/platform-admin/releases")).json.rollbacks.find((b: any) => b.id === rollbackId);
  check("rollback progress can be viewed", rb && rb.status === "active" && typeof rb.onOldVersion === "number", rb);
  r = await sa("POST", `/platform-admin/releases/rollbacks/${rollbackId}/stop`, { reason });
  check("it can be stopped", r.json.status === "stopped" && (await ask(someone, v(5))).manifest?.release === null, r.json);
  r = await act(stopId, "withdraw");
  check("a release can be withdrawn", r.json.status === "withdrawn", r.json);
  r = await act(stopId, "recommend");
  check("a withdrawn release cannot be recommended", r.status === 409, r.json);

  section("Dashboard");
  const sum = (await sa("GET", "/platform-admin/releases")).json.summary;
  check("the cards come from real records", sum.totalReleases >= made.length && sum.registeredPcs >= 12 && sum.failures >= 1, sum);
  section("Security");
  check("only the owner can manage releases", [401, 403].includes((await fetch(`${CLOUD}/api/v1/platform-admin/releases`)).status));
  const logged = await sqlClient`select count(*)::int as n from audit_logs where action like 'platform.release%' and actor_user_id = ${saUser.id}`;
  check("every action is in the audit log", logged[0].n > 15, logged[0]);
} catch (cause) {
  console.log(results.join(String.fromCharCode(10)));
  throw cause;
} finally {
  const dir = process.env.RELEASE_DIR ?? path.join(process.cwd(), ".local", "releases");
  for (const version of made) {
    await sqlClient`delete from desktop_update_reports where to_version = ${version}`;
    await sqlClient`delete from desktop_rollbacks where to_version = ${version} or from_version = ${version}`;
    const rows = await sqlClient`delete from desktop_releases where version = ${version} returning file_name`;
    if (rows[0]?.file_name) rmSync(path.join(dir, rows[0].file_name as string), { force: true });
  }
  for (const pc of pcs) await sqlClient`delete from license_installations where installation_id = ${pc}`;
}

section("Rollback of a bad install (the real watchdog)");
const work = mkdtempSync(path.join(tmpdir(), "drycare-rollback-"));
function runWatchdog(name: string, healthy: boolean) {
  const appDir = path.join(work, name, "app");
  const copyDir = path.join(work, name, "copy");
  mkdirSync(appDir, { recursive: true });
  mkdirSync(copyDir, { recursive: true });
  const marker = path.join(work, name, "started.txt");
  writeFileSync(path.join(copyDir, "app.cmd"), `@echo off\r\necho started> "${marker}"\r\n`);
  writeFileSync(path.join(copyDir, "version.txt"), "old");
  writeFileSync(path.join(appDir, "app.cmd"), "@echo off\r\n");
  writeFileSync(path.join(appDir, "version.txt"), "new");
  writeFileSync(path.join(appDir, "only-in-new.txt"), "new");
  const healthFile = path.join(work, name, "health.txt");
  const resultFile = path.join(work, name, "result.json");
  if (healthy) writeFileSync(healthFile, "90.0.1");
  const script = path.join(work, name, "watchdog.ps1");
  writeFileSync(script, rollbackScript({ appDir, copyDir, exeName: "app.cmd", healthFile, resultFile, toVersion: "90.0.1", fromVersion: "90.0.0", waitSeconds: 2 }));
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { timeout: 60_000, windowsHide: true });
  return { appDir, copyDir, marker, resultFile };
}
const goodRun = runWatchdog("healthy", true);
check("a healthy update is left alone", readFileSync(path.join(goodRun.appDir, "version.txt"), "utf8") === "new");
check("and the old copy is cleared away", !existsSync(goodRun.copyDir));
const badRun = runWatchdog("unhealthy", false);
check("an unhealthy update is put back", readFileSync(path.join(badRun.appDir, "version.txt"), "utf8") === "old");
check("removing what the new version added", !existsSync(path.join(badRun.appDir, "only-in-new.txt")));
await new Promise((done) => setTimeout(done, 1500));
check("the old version is started again", existsSync(badRun.marker));
const outcome = JSON.parse(readFileSync(badRun.resultFile, "utf8").replace(/^﻿/, ""));
check("and it leaves a note to report", outcome.restored === true && outcome.to === "90.0.1" && outcome.from === "90.0.0", outcome);
rmSync(work, { recursive: true, force: true });

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
await sqlClient.end();
process.exit(failures ? 1 : 0);
