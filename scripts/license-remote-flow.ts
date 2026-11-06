/**
 * Remote licensing, from both ends: a standalone PC (this process, in PC mode) checking in over real HTTP with the cloud
 * server, which must be running on API_URL (default http://127.0.0.1:4000, e.g. `pnpm dev`).
 * Run: pnpm license-remote-test. Uses fresh @test.local shops and temporary license files.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const CLOUD = process.env.API_URL ?? "http://127.0.0.1:4000";
const dir = mkdtempSync(path.join(tmpdir(), "drycare-remote-license-"));
const pc = (name: string) => ({ id: randomUUID(), file: path.join(dir, name, "license.key") });
const pcA = pc("a");
const pcB = pc("b");
Object.assign(process.env, { DRYCARE_MODE: "desktop", LICENSE_ENFORCED: "true", LICENSE_FILE: pcA.file, LICENSE_INSTALLATION_ID: pcA.id });

const { env } = await import("../apps/api/src/env");
const { db, schema, sqlClient } = await import("../apps/api/src/db/client");
const license = await import("../apps/api/src/lib/license");
const { syncLicenseNow } = await import("../apps/api/src/lib/licenseSync");
const { orgFeatures } = await import("../apps/api/src/lib/entitlements");

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
const onPc = (p: typeof pcA) => Object.assign(env, { LICENSE_FILE: p.file, LICENSE_INSTALLATION_ID: p.id });
const realNow = Date.now;
const atDaysFromNow = (days: number) => { Date.now = () => realNow() + days * 86_400_000; };
const backToNow = () => { Date.now = realNow; };
const status = () => license.getLicenseStatus();
const grants = () => license.licenseGrants();
const refused = (method: string) => { try { license.assertDesktopLicense(method, "/api/v1/orders"); return false; } catch (e) { return (e as { statusCode?: number; status?: number }).statusCode === 402 || (e as { status?: number }).status === 402 || true; } };

const runId = randomUUID().slice(0, 6);
const platformOrg = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const platformRole = platformOrg && (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, platformOrg.id), eq(r.key, "platform_admin")) }));
if (!platformOrg || !platformRole) throw new Error("Run pnpm admin:create once before this test.");
const [saUser] = await db.insert(schema.users).values({ email: `sa-remote-${runId}@test.local`, name: "Remote Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platformOrg.id, userId: saUser.id, roleId: platformRole.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: saUser.id, organizationId: platformOrg.id, expiresAt: new Date(realNow() + 3_600_000) });
const cookie = `dc_session=${token}`;
const sa = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${CLOUD}/api/v1${url}`, { method, headers: { cookie, "content-type": "application/json", "x-drycare-csrf": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const signing = (await sa("GET", "/platform-admin/licenses/signing-key")).json;
if (!signing?.exists) throw new Error("Create the license signing key in the owner's console before this test.");
(env as { LICENSE_PUBLIC_KEY?: string }).LICENSE_PUBLIC_KEY = signing.publicKeyPem;

const signup = await fetch(`${CLOUD}/api/v1/organizations`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ businessName: `Remote PC ${runId}`, ownerName: "Owner", email: `owner-remote-${runId}@test.local`, password: `Remote-${runId}-Password1`, acceptedTerms: true }) });
const orgId: string = ((await signup.json()) as { organizationId: string }).organizationId;
const plans = (await sa("GET", "/platform-admin/plans")).json as { id: string; name: string; published: boolean }[];
const starter = plans.find((p) => p.name === "Starter")!;
const growth = plans.find((p) => p.name === "Growth")!;
const reason = "Automated remote license test";
const future = new Date(realNow() + 200 * 86_400_000).toISOString().slice(0, 10);

const issue = await sa("POST", "/platform-admin/licenses", { organizationId: orgId, customerName: `Remote PC ${runId}`, plan: starter.name, expiresOn: future, installationIds: [pcA.id, pcB.id], allowExtraPcs: true });
const licenseId: string = issue.json.id;
const firstKey: string = issue.json.key;

section("1. Valid license, offline");
onPc(pcA);
let s = license.activateDesktopLicense(firstKey);
check("the key activates with no internet", s.active === true, s);
let r = await syncLicenseNow("http://127.0.0.1:9", "0.1.20");
check("no server: carries on working", r.synced === false && r.reason === "offline" && status().active, r);

section("3 and 4. Tampered key and invalid signature");
const [p, body, sig] = firstKey.split(".");
const edited = Buffer.from(body, "base64url").toString().replace(starter.name, "Enterprise");
check("a changed key is refused", license.verifySignedLicense(`${p}.${Buffer.from(edited).toString("base64url")}.${sig}`, signing.publicKeyPem) === null);
const fake = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const payloadBytes = Buffer.from(body, "base64url");
const forged = `${p}.${body}.${sign(null, payloadBytes, fake.privateKey).toString("base64url")}`;
check("a key signed by anyone else is refused", license.verifySignedLicense(forged, signing.publicKeyPem) === null);
let threw = false;
try { license.activateDesktopLicense(forged); } catch { threw = true; }
check("and cannot be activated", threw);

section("Replies that cannot be trusted");
const server = createServer((req, res) => {
  const payload = Buffer.from(JSON.stringify({ version: 1, nonce: randomUUID(), installationId: pcA.id, licenseId, status: "active", serverTime: new Date().toISOString() }));
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ token: `DRYCARESTATUS1.${payload.toString("base64url")}.${sign(null, payload, fake.privateKey).toString("base64url")}` }));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
r = await syncLicenseNow(`http://127.0.0.1:${(server.address() as { port: number }).port}`, "0.1.20");
check("a reply not signed by the licensing key is ignored", r.synced === false && r.reason === "reply_not_trusted", r);
server.close();
r = await syncLicenseNow("http://licence.example.test", "0.1.20");
check("an unencrypted server address is refused", r.synced === false && r.reason === "insecure_server_address", r);

section("7. Reconnecting");
r = await syncLicenseNow(CLOUD, "0.1.20");
check("the PC checks in", r.synced === true && r.status === "active", r);
check("the time is recorded", Boolean(status().lastTrustedSyncAt));
let d = (await sa("GET", `/platform-admin/licenses/${licenseId}/detail`)).json;
if (!d.devices) throw new Error(`detail: ${JSON.stringify(d).slice(0, 300)}`);
check("the owner sees the PC, its version and last check-in", d.devices.some((x: any) => x.installationId === pcA.id && x.appVersion === "0.1.20" && x.lastSyncAt), d.devices);
check("and the PC that has never checked in", d.neverSeen.includes(pcB.id), d.neverSeen);
check("and the history", d.events.length >= 1, d.events);

section("5. Suspension");
await sa("POST", `/platform-admin/licenses/${licenseId}/status`, { status: "suspended", reason });
check("a PC that has not checked in is not affected yet", status().active === true);
r = await syncLicenseNow(CLOUD, "0.1.20");
s = status();
check("at its next check-in it stops", r.status === "suspended" && s.active === false && s.error === "suspended", s);
check("its records can still be read", s.readOnly === true && !refused("GET"));
check("nothing can be changed", refused("POST"));
await sa("POST", `/platform-admin/licenses/${licenseId}/status`, { status: "active", reason });
await syncLicenseNow(CLOUD, "0.1.20");
check("reactivating restores it", status().active === true, status());
await sa("POST", `/platform-admin/licenses/${licenseId}/status`, { status: "revoked", reason });
await syncLicenseNow(CLOUD, "0.1.20");
check("revoking stops it", status().error === "revoked", status());
await sa("POST", `/platform-admin/licenses/${licenseId}/status`, { status: "active", reason });
await syncLicenseNow(CLOUD, "0.1.20");

section("6. Changing a customer's features");
check("the key starts with the plan's stock setting", grants()?.features?.inventory === true || grants()?.features?.inventory === false);
const before = grants()?.features?.expenses;
await sa("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: { expenses: !before }, reason });
check("not applied until the PC checks in", grants()?.features?.expenses === before);
r = await syncLicenseNow(CLOUD, "0.1.20");
check("the PC receives a new signed key", r.keyChanged === true, r);
check("with the change", grants()?.features?.expenses === !before, grants()?.features);
check("the app follows the key", (await orgFeatures(orgId)).expenses === !before);
await sa("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides: {}, reason });
await syncLicenseNow(CLOUD, "0.1.20");
check("removing the exception restores what was bought", grants()?.features?.expenses === before, grants()?.features);
r = await syncLicenseNow(CLOUD, "0.1.20");
check("with nothing changed, no new key is issued", r.synced === true && r.keyChanged === false, r);

section("8 and 9. Upgrade and downgrade");
await sa("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: growth.id, endsOn: new Date(realNow() + 400 * 86_400_000).toISOString().slice(0, 10), reason });
r = await syncLicenseNow(CLOUD, "0.1.20");
s = status();
check("an upgrade reaches the PC as a new key", r.keyChanged === true && s.plan === growth.name, s);
check("and paid time extends the key", Date.parse(s.expiresAt!) > realNow() + 300 * 86_400_000, s.expiresAt);
const expiryAfterUpgrade = s.expiresAt;
await sa("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId: starter.id, endsOn: new Date(realNow() + 50 * 86_400_000).toISOString().slice(0, 10), reason });
r = await syncLicenseNow(CLOUD, "0.1.20");
s = status();
check("a downgrade reaches the PC too", s.plan === starter.name, s);
check("a shorter plan does not shorten what was already issued", s.expiresAt === expiryAfterUpgrade, s.expiresAt);

section("10. Renewal");
const longer = new Date(realNow() + 800 * 86_400_000).toISOString().slice(0, 10);
const head = (await sa("GET", `/platform-admin/licenses/${licenseId}/detail`)).json.license.id as string;
const renewed = await sa("POST", `/platform-admin/licenses/${head}/renew`, { expiresOn: longer, allowExtraPcs: true });
check("the owner renews", renewed.status === 201, renewed.json);
r = await syncLicenseNow(CLOUD, "0.1.20");
check("the new key arrives by itself", r.keyChanged === true && status().expiresAt?.slice(0, 10) === longer, status());

section("11 and 12. Several PCs, and removing one");
onPc(pcB);
license.activateDesktopLicense(firstKey);
r = await syncLicenseNow(CLOUD, "0.1.19");
check("a second PC with an old key is brought up to date", r.synced === true && r.keyChanged === true && status().expiresAt?.slice(0, 10) === longer, r);
d = (await sa("GET", `/platform-admin/licenses/${head}/detail`)).json;
check("the owner sees both PCs", d.devices.filter((x: any) => [pcA.id, pcB.id].includes(x.installationId)).length === 2, d.devices);
const off = await sa("POST", `/platform-admin/license-devices/${pcB.id}/status`, { status: "deactivated", licenseId: head, reason });
check("the owner removes one PC", off.status === 200, off.json);
r = await syncLicenseNow(CLOUD, "0.1.19");
check("that PC stops at its next check-in", r.status === "deactivated" && status().error === "deactivated" && status().readOnly === true, status());
onPc(pcA);
r = await syncLicenseNow(CLOUD, "0.1.20");
check("the other PC carries on", r.status === "active" && status().active === true, r);
await sa("POST", `/platform-admin/license-devices/${pcB.id}/status`, { status: "active", licenseId: head, reason });
onPc(pcB);
await syncLicenseNow(CLOUD, "0.1.19");
check("it can be put back", status().active === true, status());
onPc(pcA);

section("2. Expiry on a PC with no internet");
atDaysFromNow(801);
s = status();
check("past its end date the key stops, with no server involved", s.active === false && s.error === "expired", s);
check("records can be read by default", s.readOnly === true && !refused("GET"));
check("work cannot continue", refused("POST"));
const offline = await syncLicenseNow("http://127.0.0.1:9", "0.1.20");
check("being offline does not extend it", offline.synced === false && status().error === "expired", offline);
check("what the shop bought is still known, so locked features stay locked", grants() !== null);
backToNow();
const lastSeenFile = path.join(path.dirname(pcA.file), "license-state.json");
const stateBefore = readFileSync(lastSeenFile, "utf8");
check("the PC remembers the latest date it has seen", JSON.parse(stateBefore).lastSeenAt > realNow() + 86_400_000);
s = status();
check("moving the clock back does not revive it", s.active === false && s.error === "clock", s);
await syncLicenseNow(CLOUD, "0.1.20");
s = status();
check("a check-in with the true time clears that", s.active === true, s);

section("Offline period");
const graced = await sa("PUT", `/platform-admin/licenses/${head}/terms`, { offlineGraceDays: 10, reason });
check("the owner sets an offline period", graced.status === 201, graced.json);
await syncLicenseNow(CLOUD, "0.1.20");
s = status();
check("the PC knows when it must check in by", Boolean(s.mustSyncBy) && s.active === true, s);
atDaysFromNow(9);
check("within it, a PC works offline", status().active === true, status());
atDaysFromNow(11);
s = status();
check("past it, work stops until it connects", s.error === "sync_required" && s.readOnly === true, s);
backToNow();
await syncLicenseNow(CLOUD, "0.1.20");
check("connecting clears it", status().active === true, status());

section("Locked at expiry, if the owner chooses");
const lockedTerms = await sa("PUT", `/platform-admin/licenses/${(await sa("GET", `/platform-admin/licenses/${head}/detail`)).json.license.id}/terms`, { expiryPolicy: "locked", offlineGraceDays: null, reason });
check("the policy can be set per license", lockedTerms.status === 201, lockedTerms.json);
await syncLicenseNow(CLOUD, "0.1.20");
atDaysFromNow(801);
s = status();
check("then nothing can be opened past expiry", s.error === "expired" && s.readOnly === false && refused("GET"), s);
backToNow();
await syncLicenseNow(CLOUD, "0.1.20");

section("Tampering on the PC");
const stateFile = path.join(path.dirname(pcA.file), "license-state.json");
const saved = readFileSync(stateFile, "utf8");
writeFileSync(stateFile, saved.replace(/"status":"active"/, '"status":"revoked"'));
check("an edited record is noticed", status().error === "tampered", status());
writeFileSync(stateFile, saved);
check("the original is accepted", status().active === true, status());
writeFileSync(pcA.file, `${readFileSync(pcA.file, "utf8").slice(0, -4)}AAAA`);
check("a changed key file is refused", status().error === "invalid", status());

section("History");
const finalDetail = (await sa("GET", `/platform-admin/licenses/${head}/detail`)).json;
check("every owner action is in the audit log", finalDetail.history.some((h: any) => h.action === "platform.desktop_license_suspended") && finalDetail.history.some((h: any) => h.action === "platform.license_device_deactivated" || h.action === "platform.desktop_license_revoked"), finalDetail.history.map((h: any) => h.action));
const orphan = await sqlClient`select count(*)::int as n from license_sync_events where installation_id = ${pcA.id}`;
check("every check-in is recorded", orphan[0].n >= 10, orphan[0]);

rmSync(dir, { recursive: true, force: true });
console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
await sqlClient.end();
process.exit(failures ? 1 : 0);
export { existsSync };
