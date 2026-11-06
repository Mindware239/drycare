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
  error: "not_activated" | "invalid" | "expired" | "demo_ended" | "suspended" | "revoked" | "deactivated" | "sync_required" | "clock" | "tampered" | null;
  /** The shop can still open and read its records, but not change them. */
  readOnly: boolean;
  lastTrustedSyncAt: string | null;
  /** When this PC must have reached the licensing server by. Null: it may stay offline until the key expires. */
  mustSyncBy: string | null;
  licenseType: string | null;
  entitlementVersion: number | null;
  /** Unlicensed desktop installs run as a 7-day demo; null once licensed or outside the desktop edition. */
  demo: { startedAt: string; endsAt: string; daysLeft: number; ended: boolean } | null;
}

const NO_TERMS = { readOnly: false, lastTrustedSyncAt: null, mustSyncBy: null, licenseType: null, entitlementVersion: null };
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

/**
 * What this PC last heard from the licensing server, and the latest time it has seen, sealed so editing the file is
 * noticed. Deleting it clears a suspension only until the next check-in, and a key with an offline period then counts
 * from when the key was issued. A determined person with full control of a PC can always interfere with local checks:
 * this stops casual tampering, and the signed key is what cannot be forged.
 */
type TrustedState = { licenseId: string | null; status: "active" | "suspended" | "revoked" | "deactivated"; reason: string | null; lastTrustedSyncAt: number | null; lastSeenAt: number };
const STATE_SEAL = "drycare-license-state-v1";
const statePath = () => (env.LICENSE_FILE ? path.join(path.dirname(path.resolve(env.LICENSE_FILE)), "license-state.json") : null);
const stateMac = (s: TrustedState) => createHmac("sha256", `${STATE_SEAL}:${env.LICENSE_INSTALLATION_ID ?? ""}`).update(JSON.stringify([s.licenseId, s.status, s.reason, s.lastTrustedSyncAt, s.lastSeenAt])).digest("hex");
function readState(): { state: TrustedState | null; tampered: boolean } {
  const file = statePath();
  if (!file || !existsSync(file)) return { state: null, tampered: false };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as TrustedState & { mac: string };
    const expected = Buffer.from(stateMac(raw), "hex");
    const given = Buffer.from(String(raw.mac ?? ""), "hex");
    return expected.length === given.length && timingSafeEqual(expected, given) ? { state: raw, tampered: false } : { state: null, tampered: true };
  } catch {
    return { state: null, tampered: true };
  }
}
function writeState(state: TrustedState) {
  const file = statePath();
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, mac: stateMac(state) }), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

/** Saves a reply whose signature has already been checked (lib/licenseSync.ts). */
export function recordTrustedSync(reply: { status: TrustedState["status"]; reason: string | null; licenseId: string; serverTime: number }) {
  // The server's clock is trusted over this PC's: a PC set back is corrected here.
  writeState({ licenseId: reply.licenseId, status: reply.status, reason: reply.reason, lastTrustedSyncAt: reply.serverTime, lastSeenAt: reply.serverTime });
}

export function readInstalledKey() {
  return readLicenseKey();
}

/** Puts a new, already verified key in place all at once. */
export function replaceInstalledKey(key: string) {
  const licensePath = path.resolve(env.LICENSE_FILE!);
  mkdirSync(path.dirname(licensePath), { recursive: true });
  const temporaryPath = `${licensePath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, key.trim(), { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporaryPath, licensePath);
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
    return { ...NO_TERMS, required: false, active: true, installationId, requestCode, plan: null, expiresAt: null, licenseId: null, error: null, demo: null };
  }
  const key = readLicenseKey();
  if (!key) {
    // No key yet: the 7-day demo, then the upgrade (activation) screen.
    const demo = demoState();
    return demo.ended
      ? { ...NO_TERMS, required, active: false, installationId, requestCode, plan: null, expiresAt: null, licenseId: null, error: "demo_ended", demo }
      : { ...NO_TERMS, required, active: true, installationId, requestCode, plan: "Demo", expiresAt: demo.endsAt, licenseId: null, error: null, demo };
  }
  const license = parseAndVerifyLicense(key);
  const now = Date.now();
  const { state, tampered } = readState();
  // A clock set back cannot revive an expired key: the latest time this PC has seen counts instead.
  const effectiveNow = Math.max(now, state?.lastSeenAt ?? 0);
  const licenseState = getInstallationLicenseState(license, installationId, effectiveNow);
  if (licenseState === "invalid" || !license) {
    return { ...NO_TERMS, required, active: false, installationId, requestCode, plan: null, expiresAt: null, licenseId: null, error: "invalid", demo: null };
  }
  const lastTrusted = state?.lastTrustedSyncAt ?? null;
  const mustSyncBy = license.offlineGraceDays ? (lastTrusted ?? Date.parse(license.issuedAt)) + license.offlineGraceDays * DAY : null;
  const terms = { lastTrustedSyncAt: lastTrusted ? new Date(lastTrusted).toISOString() : null, mustSyncBy: mustSyncBy ? new Date(mustSyncBy).toISOString() : null, licenseType: license.licenseType ?? null, entitlementVersion: license.entitlementVersion ?? null };
  if (!tampered && now - (state?.lastSeenAt ?? 0) > 10 * 60_000 && now >= (state?.lastSeenAt ?? 0)) {
    try {
      writeState({ licenseId: state?.licenseId ?? license.licenseId, status: state?.status ?? "active", reason: state?.reason ?? null, lastTrustedSyncAt: lastTrusted, lastSeenAt: now });
    } catch { /* read-only profile: keep the in-memory state */ }
  }
  const stopped = (error: LicenseStatus["error"], readOnly: boolean): LicenseStatus => ({ ...terms, required, active: false, readOnly, installationId, requestCode, plan: license.plan, expiresAt: license.expiresAt, licenseId: license.licenseId, error, demo: null });
  if (tampered) return stopped("tampered", true);
  if (state && now < state.lastSeenAt - DAY) return stopped("clock", true);
  // Applies to this key and those after it; a key issued afterwards by the owner starts clean.
  if (state && state.status !== "active" && state.licenseId === license.licenseId) return stopped(state.status, true);
  if (licenseState === "expired") return stopped("expired", license.expiryPolicy !== "locked");
  if (mustSyncBy && now >= mustSyncBy) return stopped("sync_required", true);
  return {
    ...terms,
    readOnly: false,
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

/** What this PC's valid license key allows, or null during the demo and when no key limits it. */
export function licenseGrants() {
  if (env.DRYCARE_MODE !== "desktop" || !env.LICENSE_ENFORCED) return null;
  const key = readLicenseKey();
  const license = key ? parseAndVerifyLicense(key) : null;
  // Past expiry the key still says what this shop may see, in read-only use.
  if (!license || getInstallationLicenseState(license, env.LICENSE_INSTALLATION_ID ?? null) === "invalid") return null;
  return { features: license.features ?? null, hardware: license.hardware ?? null, limits: license.limits ?? null };
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

  replaceInstalledKey(key);
  return getLicenseStatus();
}

/** With read-only use a shop can sign in and read its records. Anything that changes data is refused. */
const READ_ONLY_POSTS = new Set(["/api/v1/auth/login", "/api/v1/auth/logout"]);

export function assertDesktopLicense(method = "GET", url = "") {
  const status = getLicenseStatus();
  if (status.required && !status.active) {
    if (status.readOnly && (method === "GET" || method === "HEAD" || READ_ONLY_POSTS.has(url.split("?")[0]))) return;
    const message = status.error === "expired"
      ? "This DryCare license has expired. Your data is safe and can be viewed. Enter a renewed activation key to continue working."
      : status.error === "suspended"
      ? "This DryCare license has been suspended. Your data is safe and can be viewed. Contact Drycare support."
      : status.error === "revoked"
      ? "This DryCare license has been cancelled. Your data is safe and can be viewed. Contact Drycare support."
      : status.error === "deactivated"
      ? "This PC has been removed from the license. Your data is safe and can be viewed. Contact Drycare support."
      : status.error === "sync_required"
      ? "This PC has been offline too long. Connect it to the internet to continue working. Your data is safe and can be viewed."
      : status.error === "clock"
      ? "This PC's date is earlier than when Drycare last ran. Correct the date to continue working."
      : status.error === "tampered"
      ? "This PC's license record has been changed. Connect to the internet or contact Drycare support to continue working."
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
    || (method === "POST" && (pathname === "/api/v1/system/license/activate" || pathname === "/api/v1/system/license/sync"))
  );
}
