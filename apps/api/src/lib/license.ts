import { createHmac, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signedLicenseSchema } from "@drycare/shared";
import { env } from "../env";
import { AppError } from "./errors";

export interface LicenseStatus {
  required: boolean;
  active: boolean;
  installationId: string | null;
  requestCode: string | null;
  plan: string | null;
  expiresAt: string | null;
  licenseId: string | null;
  error: "not_activated" | "invalid" | "expired" | "demo_ended" | null;
  /** Unlicensed desktop installs run as a 7-day demo; null once licensed or outside the desktop edition. */
  demo: { startedAt: string; endsAt: string; daysLeft: number; ended: boolean } | null;
}

export const DEMO_DAYS = 7;
const DAY = 86_400_000;
/** Not a secret against a determined attacker; it stops casual editing of demo.json from extending the demo. */
const DEMO_SEAL = "drycare-desktop-demo-v1";
let firstUseFromDatabase: number | null = null;

/** Called at desktop start-up with the oldest store record, so deleting demo.json cannot restart the demo. */
export function setDemoFirstUseFromDatabase(ms: number | null) {
  firstUseFromDatabase = ms;
}

type DemoFile = { startedAt: number; lastSeenAt: number; mac: string };
const demoPath = () => (env.LICENSE_FILE ? path.join(path.dirname(path.resolve(env.LICENSE_FILE)), "demo.json") : null);
const macOf = (startedAt: number, lastSeenAt: number) =>
  createHmac("sha256", `${DEMO_SEAL}:${env.LICENSE_INSTALLATION_ID ?? ""}`).update(`${startedAt}|${lastSeenAt}`).digest("hex");

function writeDemo(startedAt: number, lastSeenAt: number) {
  const file = demoPath();
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ startedAt, lastSeenAt, mac: macOf(startedAt, lastSeenAt) } satisfies DemoFile), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

/** Demo window for an unlicensed desktop install: starts at first use, survives reinstalls, ends early if tampered with. */
export function demoState(now = Date.now()) {
  const file = demoPath();
  let saved: DemoFile | null = null;
  let tampered = false;
  if (file && existsSync(file)) {
    try {
      const d = JSON.parse(readFileSync(file, "utf8")) as DemoFile;
      const expected = Buffer.from(macOf(d.startedAt, d.lastSeenAt), "hex");
      const given = Buffer.from(String(d.mac ?? ""), "hex");
      if (expected.length === given.length && timingSafeEqual(expected, given)) saved = d;
      else tampered = true;
    } catch {
      tampered = true;
    }
  }
  const candidates = [saved?.startedAt, firstUseFromDatabase].filter((v): v is number => typeof v === "number" && v > 0);
  const startedAt = candidates.length ? Math.min(...candidates) : now;
  // A clock moved back more than a day behind the last time DryCare ran is treated as tampering.
  if (saved && now < saved.lastSeenAt - DAY) tampered = true;
  const lastSeenAt = Math.max(saved?.lastSeenAt ?? 0, now);
  if (!saved || now - saved.lastSeenAt > 10 * 60_000 || startedAt !== saved.startedAt) {
    try { writeDemo(startedAt, lastSeenAt); } catch { /* read-only profile: keep the in-memory state */ }
  }
  const endsAt = startedAt + DEMO_DAYS * DAY;
  const ended = tampered || now >= endsAt;
  return { startedAt: new Date(startedAt).toISOString(), endsAt: new Date(endsAt).toISOString(), daysLeft: ended ? 0 : Math.max(1, Math.ceil((endsAt - now) / DAY)), ended };
}

function readLicenseKey() {
  if (!env.LICENSE_FILE || !existsSync(env.LICENSE_FILE)) return null;
  return readFileSync(env.LICENSE_FILE, "utf8").trim() || null;
}

export function verifySignedLicense(key: string, publicKey: string, now = Date.now()) {
  if (!publicKey) return null;
  const [prefix, payloadEncoded, signatureEncoded, ...extra] = key.trim().split(".");
  if (prefix !== "DRYCARE1" || !payloadEncoded || !signatureEncoded || extra.length) return null;

  try {
    const payloadBytes = Buffer.from(payloadEncoded, "base64url");
    const signature = Buffer.from(signatureEncoded, "base64url");
    if (!verify(null, payloadBytes, publicKey, signature)) return null;
    const payload = signedLicenseSchema.parse(JSON.parse(payloadBytes.toString("utf8")));
    if (Date.parse(payload.issuedAt) > now + 5 * 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getInstallationLicenseState(
  license: ReturnType<typeof signedLicenseSchema.parse> | null,
  installationId: string | null,
  now = Date.now(),
) {
  if (!license || !installationId || !license.installationIds.includes(installationId)) return "invalid" as const;
  if (license.expiresAt && Date.parse(license.expiresAt) <= now) return "expired" as const;
  return "active" as const;
}

function parseAndVerifyLicense(key: string) {
  return verifySignedLicense(key, env.LICENSE_PUBLIC_KEY ?? "");
}

export function getLicenseStatus(): LicenseStatus {
  const required = env.DRYCARE_MODE === "desktop" && env.LICENSE_ENFORCED;
  const installationId = env.LICENSE_INSTALLATION_ID ?? null;
  const requestCode = required ? installationId : null;
  if (!required) {
    return { required: false, active: true, installationId, requestCode, plan: null, expiresAt: null, licenseId: null, error: null, demo: null };
  }
  const key = readLicenseKey();
  if (!key) {
    // No key yet: the 7-day demo, then the upgrade (activation) screen.
    const demo = demoState();
    return demo.ended
      ? { required, active: false, installationId, requestCode, plan: null, expiresAt: null, licenseId: null, error: "demo_ended", demo }
      : { required, active: true, installationId, requestCode, plan: "Demo", expiresAt: demo.endsAt, licenseId: null, error: null, demo };
  }
  const license = parseAndVerifyLicense(key);
  const licenseState = getInstallationLicenseState(license, installationId);
  if (licenseState === "invalid" || !license) {
    return { required, active: false, installationId, requestCode, plan: null, expiresAt: null, licenseId: null, error: "invalid", demo: null };
  }
  if (licenseState === "expired") {
    return { required, active: false, installationId, requestCode, plan: license.plan, expiresAt: license.expiresAt, licenseId: license.licenseId, error: "expired", demo: null };
  }
  return {
    required,
    active: true,
    installationId,
    requestCode,
    plan: license.plan,
    expiresAt: license.expiresAt,
    licenseId: license.licenseId,
    error: null,
    demo: null,
  };
}

export function activateDesktopLicense(key: string) {
  if (env.DRYCARE_MODE !== "desktop" || !env.LICENSE_ENFORCED || !env.LICENSE_FILE) {
    throw new AppError(404, "NOT_FOUND", "License activation is not available in this edition");
  }
  const installationId = env.LICENSE_INSTALLATION_ID;
  const license = parseAndVerifyLicense(key);
  const licenseState = getInstallationLicenseState(license, installationId ?? null);
  if (licenseState === "invalid" || !license || !installationId) {
    throw new AppError(422, "LICENSE_INVALID", "This activation key is invalid or was issued for a different PC.");
  }
  if (licenseState === "expired") {
    throw new AppError(422, "LICENSE_EXPIRED", "This activation key has expired. Request a renewed key.");
  }

  const licensePath = path.resolve(env.LICENSE_FILE);
  mkdirSync(path.dirname(licensePath), { recursive: true });
  const temporaryPath = `${licensePath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, key.trim(), { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporaryPath, licensePath);
  return getLicenseStatus();
}

export function assertDesktopLicense() {
  const status = getLicenseStatus();
  if (status.required && !status.active) {
    const message = status.error === "expired"
      ? "This DryCare license has expired. Enter a renewed activation key to continue."
      : status.error === "demo_ended"
      ? `Your ${DEMO_DAYS}-day DryCare demo has ended. Upgrade with a license key to continue; your data is safe.`
      : "Activate DryCare with a valid license key to continue.";
    throw new AppError(402, "LICENSE_REQUIRED", message, [{ reason: status.error }]);
  }
}

export function isLicenseActivationRequest(method: string, url: string) {
  const pathname = url.split("?")[0];
  return (
    (method === "GET" && (pathname === "/health" || pathname === "/api/v1/system/info" || pathname === "/api/v1/system/license/status"))
    || (method === "POST" && pathname === "/api/v1/system/license/activate")
  );
}
