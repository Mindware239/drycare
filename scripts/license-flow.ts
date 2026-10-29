/**
 * Desktop licensing from the super admin console: signing key, issuing keys, verification as the desktop app does it,
 * encrypted backup. Run: pnpm license-test
 * The real signing key must be created by the owner, so this test refuses to run if one exists and removes its own key,
 * test licenses and the desktop public-key file afterwards.
 */
import { createHash, createPrivateKey, randomBytes, randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { buildServer } from "../apps/api/src/app";
import { db, schema, sqlClient } from "../apps/api/src/db/client";
import { verifySignedLicense } from "../apps/api/src/lib/license";

const pemFile = path.resolve(import.meta.dirname, "..", "apps", "desktop", "build", "license-public.pem");
const [existing] = await sqlClient`select 1 from platform_settings where key = 'license_signing'`;
if (existing) {
  console.log("A real license signing key exists, so the license test is skipped to keep it untouched.");
  await sqlClient.end();
  process.exit(0);
}
const pemExisted = existsSync(pemFile);

const app = await buildServer();
let failures = 0;
const results: string[] = [];
const check = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
};
const req = async (cookie: string, method: string, url: string, body?: unknown) => {
  const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie, "x-drycare-csrf": "1" } });
  let json: any;
  try { json = res.json(); } catch {}
  return { status: res.statusCode, json, text: res.body };
};

const runId = randomUUID().slice(0, 6);
const platformOrg = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const role = platformOrg && await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, platformOrg.id), eq(r.key, "platform_admin")) });
if (!platformOrg || !role) throw new Error("Run pnpm admin:create once before this test.");
const [sa] = await db.insert(schema.users).values({ email: `sa-lic-${runId}@test.local`, name: "License Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platformOrg.id, userId: sa.id, roleId: role.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: sa.id, organizationId: platformOrg.id, expiresAt: new Date(Date.now() + 3600_000) });
const admin = `dc_session=${token}`;

try {
  let r = await req(admin, "POST", "/platform-admin/licenses", { customerName: "No Key Yet", plan: "Standard", expiresOn: null, installationIds: [randomUUID()] });
  check("issuing is refused before a signing key exists", r.status === 409 && r.json.error.code === "SIGNING_KEY_MISSING", r.json);
  r = await req(admin, "POST", "/platform-admin/licenses/signing-key", { confirm: "yes" });
  check("creating the key needs the typed confirmation", r.status === 400);
  r = await req(admin, "POST", "/platform-admin/licenses/signing-key", { confirm: "CREATE" });
  check("signing key created with a fingerprint", r.status === 200 && /^[0-9A-F]{4}-/.test(r.json.fingerprint), r.json);
  const publicKeyPem = r.json.publicKeyPem as string;
  check("public key written for desktop builds", existsSync(pemFile));
  const stored = await sqlClient`select value_json from platform_settings where key = 'license_signing'`;
  check("private key is encrypted at rest", !JSON.stringify(stored[0].value_json).includes("PRIVATE KEY") && JSON.stringify(stored[0].value_json).includes("v1."));
  r = await req(admin, "POST", "/platform-admin/licenses/signing-key", { confirm: "CREATE" });
  check("a second key cannot replace the first", r.status === 409 && r.json.error.code === "SIGNING_KEY_EXISTS", r.json);

  const pc1 = randomUUID(), pc2 = randomUUID();
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  r = await req(admin, "POST", "/platform-admin/licenses", { customerName: `Test Laundry ${runId}`, plan: "Standard", expiresOn: expires, installationIds: [pc1, pc2], note: "test" });
  check("key issued for two PCs", r.status === 201 && r.json.key.startsWith("DRYCARE1."), r.json);
  const verified = verifySignedLicense(r.json.key, publicKeyPem);
  check("the desktop app's verifier accepts it, bound to both PCs", verified?.installationIds.includes(pc1) === true && verified.installationIds.includes(pc2) && verified.plan === "Standard", verified);
  check("a tampered key is rejected", verifySignedLicense(r.json.key.replace(/\.(.)/, ".X"), publicKeyPem) === null);
  r = await req(admin, "POST", "/platform-admin/licenses", { customerName: "Perpetual Shop", plan: "Lifetime", expiresOn: null, installationIds: [randomUUID()] });
  check("perpetual key has no expiry", r.status === 201 && verifySignedLicense(r.json.key, publicKeyPem)?.expiresAt === null, r.json);
  r = await req(admin, "POST", "/platform-admin/licenses", { customerName: "Bad", plan: "Standard", expiresOn: "2020-01-01", installationIds: [randomUUID()] });
  check("expiry in the past is refused", r.status === 409, r.json);
  r = await req(admin, "POST", "/platform-admin/licenses", { customerName: "Bad", plan: "Standard", expiresOn: null, installationIds: ["not-a-code"] });
  check("invalid PC request code is refused", r.status === 400);
  r = await req(admin, "POST", "/platform-admin/licenses", { customerName: "Bad", plan: "Standard", expiresOn: null, installationIds: [pc1, pc1.toUpperCase()] });
  check("duplicate PC codes are refused", r.status === 409, r.json);
  r = await req(admin, "GET", "/platform-admin/licenses");
  check("register lists issued keys", r.status === 200 && r.json.some((l: any) => l.customerName === `Test Laundry ${runId}`));

  r = await req(admin, "POST", "/platform-admin/licenses/signing-key/backup", { passphrase: "short" });
  check("backup needs a 16+ character passphrase", r.status === 400);
  const pass = `Backup-${runId}-Passphrase!`;
  r = await req(admin, "POST", "/platform-admin/licenses/signing-key/backup", { passphrase: pass });
  check("backup is an encrypted PEM", r.status === 200 && r.text.includes("ENCRYPTED PRIVATE KEY"), r.text.slice(0, 60));
  let opened = false;
  try { opened = createPrivateKey({ key: r.text, passphrase: pass }).asymmetricKeyType === "ed25519"; } catch {}
  check("backup opens with the passphrase (usable by the offline issuer)", opened);
  let wrongOpened = true;
  try { createPrivateKey({ key: r.text, passphrase: "wrong-passphrase-123" }); } catch { wrongOpened = false; }
  check("backup cannot be opened with a wrong passphrase", !wrongOpened);

  const shop = await app.inject({ method: "POST", url: "/api/v1/organizations", payload: { businessName: `Lic Shop ${runId}`, ownerName: "Lic Owner", email: `owner-lic-${runId}@test.local`, password: `Shop-${runId}-Password1`, acceptedTerms: true }, headers: { "x-drycare-csrf": "1" } });
  const shopCookie = String(shop.headers["set-cookie"]).split(";")[0];
  r = await req(shopCookie, "GET", "/platform-admin/licenses/signing-key");
  check("shop accounts cannot reach license management", r.status === 401 || r.status === 403, r.status);
  const audits = await sqlClient`select after_json from audit_logs where action like 'platform.license%' or action = 'platform.desktop_license_issued' order by created_at desc limit 10`;
  check("audit log records actions without the private key", audits.length >= 3 && !JSON.stringify(audits).includes("PRIVATE KEY"));
} finally {
  await sqlClient`delete from desktop_licenses where issued_by = ${sa.id}`;
  await sqlClient`delete from platform_settings where key = 'license_signing'`;
  if (!pemExisted && existsSync(pemFile)) rmSync(pemFile);
  await sqlClient`update sessions set revoked_at = now() where user_id = ${sa.id}`;
  await sqlClient`update users set status = 'disabled', is_platform_admin = false where id = ${sa.id}`;
}
check("test signing key and public-key file removed", !(await sqlClient`select 1 from platform_settings where key = 'license_signing'`).length && existsSync(pemFile) === pemExisted);

console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
