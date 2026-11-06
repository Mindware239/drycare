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
// The owner: the shop also has counter staff, who may not change these settings.
const ownerRole = (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, org.id), eq(r.key, "owner")) }))!;
const member = (await db.query.memberships.findFirst({ where: (m, { and, eq }) => and(eq(m.organizationId, org.id), eq(m.roleId, ownerRole.id)) }))!;
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

  // Shops cannot remove a device, so numbers from an earlier run of this test are cleared here.
  await sqlClient`delete from shop_printers where serial_number in ('SN100', 'SN101', 'SC100')`;
  // Printers sold by Mindware: the key lists them, so connecting works with no internet.
  writeFileSync(licenseFile, makeKey({ hardware: { printers: [], scanners: [], soldPrinters: [{ serial: "SN100", bill: "B200", model: "Sold Model" }] } }));
  r = await req("POST", "/labels/shop-printers", { serial: "SN100", bill: "NOPE", printerName: "Any" });
  check("the wrong numbers are refused, with no internet", r.status === 403 && r.json.error.code === "PRINTER_NOT_SOLD_BY_MINDWARE", r.json);
  r = await req("POST", "/labels/shop-printers", { serial: "SN100", bill: "B200" });
  check("on a PC, the Windows printer must be chosen", r.status === 400, r.json);
  r = await req("POST", "/labels/shop-printers", { serial: "SN100", bill: "B200", printerName: "Counter Printer" });
  check("the right numbers connect it, with no internet", r.status === 201 && r.json.model === "Sold Model", r.json);
  r = await req("DELETE", `/labels/shop-printers/${r.json.id}`);
  check("on a PC, a shop cannot remove a printer either", r.status === 404, r.json);
  writeFileSync(licenseFile, makeKey({ hardware: { printers: [], scanners: [], soldPrinters: [{ serial: "SN101", bill: "B201", model: "New Model" }, { serial: "SC100", bill: "B300", model: "Sold Scanner", kind: "scanner" }] } }));
  r = await req("GET", "/labels/shop-printers");
  check("a renewed key that leaves a printer out disables it", r.json.printers.find((p: { serialNumber: string }) => p.serialNumber === "SN100")?.disabled === true && r.json.missing.printer === true, r.json);
  r = await req("POST", "/labels/shop-printers", { serial: "SN101", bill: "B201", printerName: "Counter Printer" });
  check("its replacement connects under the same Windows name", r.status === 201, r.json);
  r = await req("POST", "/labels/shop-printers", { serial: "SC100", bill: "B300", printerName: "Counter Printer" });
  check("a scanner's numbers do not connect a printer on a PC", r.status === 403, r.json);
  r = await req("POST", "/labels/shop-printers", { deviceType: "scanner", serial: "SC100", bill: "B300" });
  check("a scanner connects with no internet, and needs no Windows printer", r.status === 201 && r.json.deviceType === "scanner", r.json);
  r = await req("GET", "/labels/shop-printers");
  check("nothing is missing after that", r.json.missing.printer === false && r.json.missing.scanner === false, r.json.missing);
  // A real TSC printer, if one is plugged in: it reports its own serial number. Nothing is printed here.
  const { readPrinterSerial } = await import("../apps/api/src/lib/printerSerial");
  const realName = process.env.TEST_TSC_PRINTER ?? "TSC P210";
  const realSerial = await readPrinterSerial(realName);
  if (!realSerial) results.push(`  - no ${realName} answering: real printer checks skipped`);
  else {
    const useKey = (serial: string) => writeFileSync(licenseFile, makeKey({ hardware: { printers: [], scanners: [], soldPrinters: [{ serial, bill: "BR1", model: "Real TSC" }] } }));
    const leftover = await db.query.shopPrinters.findFirst({ where: (p, { eq }) => eq(p.serialNumber, realSerial) });
    if (leftover) throw new Error(`${realSerial} is connected in this database; this test would disturb it.`);
    useKey("NOTTHISUNIT");
    r = await req("POST", "/labels/shop-printers", { serial: "NOTTHISUNIT", bill: "BR1", printerName: realName });
    check("the real printer refuses a serial number that is not its own", r.status === 403 && r.json.error.code === "PRINTER_SERIAL_MISMATCH" && r.json.error.message.includes(realSerial), r.json);
    useKey(realSerial);
    r = await req("POST", "/labels/shop-printers", { serial: realSerial, bill: "BR1", printerName: realName });
    check("the real printer confirms its own serial number", r.status === 201 && r.json.serialConfirmed === true, r.json);
    const realRow = r.json.id;
    // Registered as a different unit, as if the physical printer had been swapped under the same Windows name.
    await sqlClient`update shop_printers set serial_number = 'SWAPPEDUNIT' where id = ${realRow}`;
    useKey("SWAPPEDUNIT");
    r = await req("POST", "/labels/print", { printer: realName, widthMm: 38, heightMm: 30, gapMm: 2, density: 8, speed: 4, copies: 1, labels: [{ widthDots: 8, heightDots: 8, data: "AAAAAAAAAAA=" }] });
    check("a swapped printer is refused before anything prints", r.status === 403 && r.json.error.code === "PRINTER_SERIAL_MISMATCH", r.json);
    await sqlClient`delete from shop_printers where id = ${realRow}`;
  }
  writeFileSync(licenseFile, makeKey({ features: { rfid: true } }));
  r = await req("GET", "/rfid/summary");
  check("the RFID module follows the key", r.status === 200, r.json);
  writeFileSync(licenseFile, makeKey({ features: {} }));
  r = await req("GET", "/rfid/summary");
  check("a key without it refuses it", r.status === 403, r.json);

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
