/**
 * The PC side of remote licensing. When there is internet, this PC sends its key to the licensing server and gets back a
 * status signed by the server's private key. Nothing is applied unless that signature checks out with the public key
 * built into the app, and the reply answers the one-time code sent with this request, so an old reply cannot be replayed.
 * A PC that never connects keeps its last valid key, until that key's own expiry or offline period ends.
 */
import { randomUUID } from "node:crypto";
import { verify } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { env } from "../env";
import { db, schema } from "../db/client";
import { licenseStatusTokenSchema, type LicenseStatusToken } from "@drycare/shared";
import { getLicenseStatus, readInstalledKey, recordTrustedSync, replaceInstalledKey, verifySignedLicense } from "./license";

export function verifyStatusToken(token: string, publicKey: string): LicenseStatusToken | null {
  const [prefix, payloadEncoded, signatureEncoded, ...extra] = token.trim().split(".");
  if (prefix !== "DRYCARESTATUS1" || !payloadEncoded || !signatureEncoded || extra.length || !publicKey) return null;
  try {
    const bytes = Buffer.from(payloadEncoded, "base64url");
    if (!verify(null, bytes, publicKey, Buffer.from(signatureEncoded, "base64url"))) return null;
    return licenseStatusTokenSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

export type SyncResult = { synced: boolean; reason?: string; status?: string; keyChanged?: boolean };

/** Sends usage counts collected on this PC, and clears them only once the server has them. */
async function pendingUsage() {
  const rows = await db.select({ feature: schema.featureUsageDaily.feature, day: schema.featureUsageDaily.day, count: schema.featureUsageDaily.count }).from(schema.featureUsageDaily).limit(2000);
  return rows;
}

export async function syncLicenseNow(cloudUrl: string | null | undefined, appVersion = env.APP_VERSION ?? "unknown"): Promise<SyncResult> {
  if (env.DRYCARE_MODE !== "desktop" || !env.LICENSE_ENFORCED) return { synced: false, reason: "not_a_licensed_pc" };
  if (!cloudUrl) return { synced: false, reason: "no_server_address" };
  const base = cloudUrl.replace(/\/+$/, "");
  // Only an encrypted connection, except a server on this same computer for testing.
  if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(base)) return { synced: false, reason: "insecure_server_address" };
  const key = readInstalledKey();
  const installationId = env.LICENSE_INSTALLATION_ID;
  if (!key || !installationId) return { synced: false, reason: "no_key" };
  const nonce = randomUUID();
  const usage = await pendingUsage().catch(() => []);
  let token: string;
  try {
    const res = await fetch(`${base}/api/v1/license/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-drycare-csrf": "1" },
      body: JSON.stringify({ key, installationId, nonce, appVersion, usage }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { synced: false, reason: `server_${res.status}` };
    token = ((await res.json()) as { token: string }).token;
  } catch {
    return { synced: false, reason: "offline" };
  }
  const publicKey = env.LICENSE_PUBLIC_KEY ?? "";
  const reply = verifyStatusToken(token, publicKey);
  if (!reply || reply.nonce !== nonce || reply.installationId !== installationId) return { synced: false, reason: "reply_not_trusted" };
  let keyChanged = false;
  if (reply.key && reply.key !== key) {
    const fresh = verifySignedLicense(reply.key, publicKey);
    if (!fresh || !fresh.installationIds.includes(installationId)) return { synced: false, reason: "key_not_trusted" };
    replaceInstalledKey(reply.key);
    keyChanged = true;
  }
  const current = verifySignedLicense(reply.key ?? key, publicKey);
  recordTrustedSync({ status: reply.status, reason: reply.reason ?? null, licenseId: current?.licenseId ?? reply.licenseId, serverTime: Date.parse(reply.serverTime) });
  if (usage.length) await db.execute(sql`delete from feature_usage_daily`).catch(() => {});
  return { synced: true, status: reply.status, keyChanged };
}

export const licenseSummary = () => getLicenseStatus();
export { eq };
