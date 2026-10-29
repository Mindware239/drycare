/** Desktop demo lock, end to end through the real API server: day 8 blocks every feature; only the upgrade screen works. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "drycare-lock-"));
Object.assign(process.env, { DRYCARE_MODE: "desktop", LICENSE_ENFORCED: "true", LICENSE_FILE: path.join(dir, "license.json"), LICENSE_INSTALLATION_ID: randomUUID(), LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=\n-----END PUBLIC KEY-----\n" });
const lic = await import("../apps/api/src/lib/license");
const { buildServer } = await import("../apps/api/src/app");
const { sqlClient } = await import("../apps/api/src/db/client");
const app = await buildServer();
let failures = 0;
const check = (label: string, cond: boolean, extra?: unknown) => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${!cond && extra !== undefined ? `  → ${JSON.stringify(extra)}` : ""}`); if (!cond) failures++; };
const call = async (method: string, url: string, body?: unknown) => {
  const r = await app.inject({ method: method as "GET", url, payload: body as object, headers: { "x-drycare-csrf": "1" } });
  let json: any; try { json = r.json(); } catch {}
  return { status: r.statusCode, code: json?.error?.code };
};
const FEATURES: [string, string, unknown?][] = [
  ["POST", "/api/v1/auth/login", { email: "owner@shop.test", password: "anything-123" }],
  ["POST", "/api/v1/organizations", { businessName: "New Shop", ownerName: "Owner", email: "o@shop.test", password: "Password-12345", acceptedTerms: true }],
  ["GET", "/api/v1/auth/session"],
  ["GET", "/api/v1/dashboard"],
  ["GET", "/api/v1/orders"],
  ["POST", "/api/v1/orders", {}],
  ["GET", "/api/v1/customers"],
  ["POST", "/api/v1/customers", { name: "X" }],
  ["GET", "/api/v1/production/board"],
  ["POST", "/api/v1/garments/scan", {}],
  ["GET", "/api/v1/reports/catalogue"],
  ["GET", "/api/v1/laundry/config"],
  ["POST", "/api/v1/laundry/orders", {}],
  ["GET", "/api/v1/deliveries"],
  ["GET", "/api/v1/cashier-shifts/current"],
  ["POST", "/api/v1/expenses", {}],
  ["GET", "/api/v1/staff"],
  ["GET", "/api/v1/catalogue/garment-types"],
  ["GET", "/api/v1/system/backups"],
];
try {
  lic.setDemoFirstUseFromDatabase(Date.now() - 3 * 86_400_000);
  let r = await call("GET", "/api/v1/auth/session");
  check("day 3: features work normally (no licence error)", r.code !== "LICENSE_REQUIRED", r);

  lic.setDemoFirstUseFromDatabase(Date.now() - 8 * 86_400_000);
  for (const [m, url, body] of FEATURES) {
    r = await call(m, url, body);
    check(`day 8: ${m} ${url.replace("/api/v1", "")} is locked`, r.status === 402 && r.code === "LICENSE_REQUIRED", r);
  }
  r = await call("GET", "/api/v1/system/license/status");
  check("upgrade screen can still read the licence status", r.status === 200);
  r = await call("POST", "/api/v1/system/license/activate", { key: "DRYCARE1.bad.key" });
  check("upgrade screen can still submit a key (bad key → clear error, not a lock)", r.status !== 402, r);
  r = await call("GET", "/api/v1/system/info");
  check("app can still start and show the upgrade screen", r.status === 200);
} finally {
  await app.close();
  await sqlClient.end();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
