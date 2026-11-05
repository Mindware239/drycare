/**
 * The PC edition: features and approved printers come from the signed license key, with no internet.
 * Run after plan-features-flow: pnpm --filter @drycare/api features-test
 * Nothing reaches a printer: both prints here are refused before anything is sent. It uses its own temporary
 * signing key and license file, and does not touch the real ones.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "drycare-feature-test-"));
const licenseFile = path.join(dir, "license.json");
const installationId = randomUUID();
const { publicKey, privateKey } = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
Object.assign(process.env, { DRYCARE_MODE: "desktop", LICENSE_ENFORCED: "true", LICENSE_FILE: licenseFile, LICENSE_INSTALLATION_ID: installationId, LICENSE_PUBLIC_KEY: publicKey });

const { buildServer } = await import("../apps/api/src/app");
const { db, schema, sqlClient } = await import("../apps/api/src/db/client");

let failures = 0;
const results: string[] = [];
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
}

function makeKey(extra: object) {
  const payload = { version: 1, licenseId: randomUUID(), plan: "Test", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), installationIds: [installationId], ...extra };
  const bytes = Buffer.from(JSON.stringify(payload));
  return `DRYCARE1.${bytes.toString("base64url")}.${sign(null, bytes, privateKey).toString("base64url")}`;
}

const org = await db.query.organizations.findFirst({ where: (o, { like }) => like(o.name, "Feature Flow a %"), orderBy: (o, { desc }) => [desc(o.createdAt)] });
if (!org) throw new Error("Run plan-features-flow first: it creates the test shop.");
const member = (await db.query.memberships.findFirst({ where: (m, { eq }) => eq(m.organizationId, org.id) }))!;
const token = randomBytes(32).toString("base64url");
const sessionId = createHash("sha256").update(token).digest("hex");
await db.insert(schema.sessions).values({ id: sessionId, userId: member.userId, organizationId: org.id, expiresAt: new Date(Date.now() + 3600_000) });

const app = await buildServer();
const req = async (method: string, url: string, body?: unknown) => {
  const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: `dc_session=${token}`, "x-drycare-csrf": "1" } });
  let json: any;
  try { json = res.json(); } catch {}
  return { status: res.statusCode, json };
};
const features = async () => (await req("GET", "/auth/session")).json.features;
const printBody = (printer: string, widthMm: number, heightMm: number) => ({ printer, widthMm, heightMm, gapMm: 2, density: 10, speed: 3, copies: 1, labels: [{ widthDots: 8, heightDots: 8, data: Buffer.alloc(8).toString("base64") }] });

try {
  let f = await features();
  check("during the demo, with no key, every feature is on", f.labelDesigner && f.customerMemberships && f.laundry, f);

  writeFileSync(licenseFile, makeKey({}));
  f = await features();
  check("a key issued before this change keeps full access", f.labelDesigner && f.customerMemberships && f.laundry, f);

  writeFileSync(licenseFile, makeKey({ features: { labelDesigner: false, customerMemberships: false, laundry: false, inventory: true, deliveries: true }, hardware: { printers: ["NoSuchPrinterModel"], scanners: ["Honeywell HH400"] } }));
  f = await features();
  check("a basic key switches those features off, with no internet", !f.labelDesigner && !f.customerMemberships && !f.laundry && f.inventory, f);
  let r = await req("GET", "/membership-plans");
  check("the server refuses what the key does not include", r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", r.json);
  r = await req("GET", "/labels/hardware");
  check("the approved list comes from the key", r.json.printers[0] === "NoSuchPrinterModel" && r.json.scanners[0] === "Honeywell HH400", r.json);

  // Tampering: the same content, re-signed by someone else's key, must not count.
  const otherKey = generateKeyPairSync("ed25519").privateKey;
  const forged = Buffer.from(JSON.stringify({ version: 1, licenseId: randomUUID(), plan: "Forged", issuedAt: new Date().toISOString(), expiresAt: null, installationIds: [installationId], features: { labelDesigner: true } }));
  writeFileSync(licenseFile, `DRYCARE1.${forged.toString("base64url")}.${sign(null, forged, otherKey).toString("base64url")}`);
  r = await req("GET", "/auth/session");
  check("a forged key is refused outright", r.status === 402 && r.json.error.code === "LICENSE_REQUIRED", r.json);

  writeFileSync(licenseFile, makeKey({ limits: { branches: 1 } }));
  r = await req("POST", "/branches", { name: "Second Branch", branchCode: "PCSECOND" });
  check("the branch limit in the key is enforced, with no internet", r.status === 403 && r.json.error.code === "BRANCH_LIMIT_REACHED", r.json);

  writeFileSync(licenseFile, makeKey({ features: { labelDesigner: false }, hardware: { printers: ["NoSuchPrinterModel"], scanners: [] } }));
  if (process.platform === "win32") {
    r = await req("GET", "/labels/printers");
    const first = r.json.printers?.[0];
    check("printers are listed as not approved", r.json.restricted === true && (!first || first.approved === false), r.json);
    r = await req("POST", "/labels/print", printBody(first?.name ?? "None", 70, 40));
    check("printing another tag size is refused", r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", r.json);
    if (first) {
      r = await req("POST", "/labels/print", printBody(first.name, 38, 30));
      check("printing to a printer that is not approved is refused", r.status === 403 && r.json.error.code === "PRINTER_NOT_APPROVED", r.json);
    } else results.push("  - skipped: this PC has no printers installed");
  } else results.push("  - skipped: direct printing needs Windows");
} finally {
  await sqlClient`delete from sessions where id = ${sessionId}`;
  await app.close();
  await sqlClient.end();
  rmSync(dir, { recursive: true, force: true });
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll PC edition checks passed");
process.exit(failures ? 1 : 0);
