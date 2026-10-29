/** Desktop 7-day demo rules, run against a simulated installation in a temp folder. Run: pnpm demo-test */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "drycare-demo-"));
const installationId = randomUUID();
const { publicKey, privateKey } = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
Object.assign(process.env, { DRYCARE_MODE: "desktop", LICENSE_ENFORCED: "true", LICENSE_FILE: path.join(dir, "license.json"), LICENSE_INSTALLATION_ID: installationId, LICENSE_PUBLIC_KEY: publicKey });
const lic = await import("../apps/api/src/lib/license");

let failures = 0;
const check = (label: string, cond: boolean, extra?: unknown) => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${!cond && extra !== undefined ? `  → ${JSON.stringify(extra)}` : ""}`); if (!cond) failures++; };
const DAY = 86_400_000;
const demoFile = path.join(dir, "demo.json");

try {
  let s = lic.getLicenseStatus();
  check("fresh install: demo active with 7 days", s.active && s.plan === "Demo" && s.demo?.daysLeft === 7 && !s.demo.ended, s);
  let threw = false;
  try { lic.assertDesktopLicense(); } catch { threw = true; }
  check("app is usable during the demo", !threw);

  lic.setDemoFirstUseFromDatabase(Date.now() - 6.5 * DAY);
  s = lic.getLicenseStatus();
  check("store set up 6½ days ago: 1 day left", s.active && s.demo?.daysLeft === 1, s.demo);
  lic.setDemoFirstUseFromDatabase(Date.now() - 8 * DAY);
  s = lic.getLicenseStatus();
  check("day 8: demo ended, upgrade required", !s.active && s.error === "demo_ended", s);
  try { lic.assertDesktopLicense(); threw = false; } catch (e) { threw = (e as { code?: string }).code === "LICENSE_REQUIRED" && String((e as Error).message).includes("demo has ended"); }
  check("API answers 402 'demo has ended, upgrade'", threw);

  rmSync(demoFile, { force: true });
  s = lic.getLicenseStatus();
  check("deleting demo.json does not restart the demo (store date still counts)", !s.active && s.error === "demo_ended", s.demo);

  lic.setDemoFirstUseFromDatabase(null);
  rmSync(demoFile, { force: true });
  lic.getLicenseStatus();
  const d = JSON.parse(readFileSync(demoFile, "utf8"));
  writeFileSync(demoFile, JSON.stringify({ ...d, startedAt: Date.now() + 5 * DAY }));
  s = lic.getLicenseStatus();
  check("editing demo.json ends the demo", !s.active && s.error === "demo_ended", s.demo);

  rmSync(demoFile, { force: true });
  lic.getLicenseStatus();
  const realNow = Date.now;
  Date.now = () => realNow() - 3 * DAY;
  s = lic.getLicenseStatus();
  Date.now = realNow;
  check("moving the PC clock back ends the demo", s.demo?.ended === true, s.demo);

  // A key from the panel unlocks it.
  lic.setDemoFirstUseFromDatabase(Date.now() - 30 * DAY);
  const payload = { version: 1, licenseId: randomUUID(), plan: "Standard", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * DAY).toISOString(), installationIds: [installationId] };
  const bytes = Buffer.from(JSON.stringify(payload));
  const key = `DRYCARE1.${bytes.toString("base64url")}.${sign(null, bytes, privateKey).toString("base64url")}`;
  s = lic.activateDesktopLicense(key);
  check("activation key after the demo: full version, no demo banner", s.active && s.plan === "Standard" && s.demo === null, s);
  const other = { ...payload, licenseId: randomUUID(), installationIds: [randomUUID()] };
  const ob = Buffer.from(JSON.stringify(other));
  let rejected = false;
  try { lic.activateDesktopLicense(`DRYCARE1.${ob.toString("base64url")}.${sign(null, ob, privateKey).toString("base64url")}`); } catch { rejected = true; }
  check("a key for a different PC is rejected", rejected);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
