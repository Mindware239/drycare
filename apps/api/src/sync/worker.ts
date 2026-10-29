/**
 * PC sync worker (runs inside the Windows app's API process, never in the web screens).
 *  - Linking: ask the cloud for a code, wait for the owner's approval, store the device credential, snapshot.
 *  - Uploading: one worker per installation (database advisory lock), every minute or on "Sync now".
 *  - Keeps the credential fresh (rotates 14 days before expiry) and prunes old acknowledged events.
 * Business screens never wait for any of this; the shop works the same with or without internet.
 */
import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../db/client";
import { env } from "../env";
import { cloudBaseUrl, credentialStore } from "./cloud";
import { HttpSyncTransport, cloudCall } from "./httpTransport";
import { enableCaptureWithBaseline, disableCapture } from "./baseline";
import { processQueue, pruneSynced } from "./queue";

const WORKER_LOCK_KEY = 726_100_031; // advisory lock id for "DryCare sync worker"
const INTERVAL_MS = 60_000;
const ROTATE_BEFORE_DAYS = 14;

type LinkState = { requestId: string; pollToken: string; userCode: string; verificationUrl: string; expiresAt: string; status: "waiting" | "approved" | "denied" | "expired" | "failed"; message?: string };
let link: LinkState | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let syncing = false;
let lastRun: { at: string; sent: number; synced: number; message?: string } | null = null;
let timer: NodeJS.Timeout | null = null;

export const syncRuntime = () => ({ syncing, link: link && { userCode: link.userCode, verificationUrl: link.verificationUrl, expiresAt: link.expiresAt, status: link.status, message: link.message }, lastRun });

async function shopIdentity() {
  const [org] = await db.execute<{ id: string; name: string; gstin: string | null }>(sql`select id, name, gstin from organizations order by created_at limit 1`);
  const [branch] = await db.execute<{ id: string; name: string; branch_code: string }>(sql`select id, name, branch_code from branches where organization_id = ${org?.id} order by created_at limit 1`);
  const [cfg] = await db.execute<{ device_id: string; schema_version: string }>(sql`select device_id, schema_version from sync_config where id = 1`);
  return { org, branch, cfg };
}

export async function startLink(opts: { deviceName?: string } = {}) {
  const base = cloudBaseUrl();
  if (!base) throw new Error("DryCare Cloud is not configured on this PC.");
  if (!credentialStore()) throw new Error("Secure credential storage is not available on this PC.");
  const { org, branch, cfg } = await shopIdentity();
  if (!org || !branch) throw new Error("Set up the store before linking it to the cloud.");
  const r = await cloudCall<{ requestId: string; userCode: string; pollToken: string; verificationUrl: string; expiresAt: string; pollIntervalSeconds: number }>(base, "/sync/link/start", {
    body: {
      deviceId: cfg.device_id, deviceName: (opts.deviceName || `Shop PC (${hostname()})`).slice(0, 80), appVersion: env.APP_VERSION, schemaVersion: cfg.schema_version,
      shop: { organizationId: org.id, organizationName: org.name, branchId: branch.id, branchName: branch.name, branchCode: branch.branch_code, gstin: org.gstin },
    },
  });
  if (r.status !== 201) throw new Error(r.body.error?.message ?? `DryCare Cloud refused the request (${r.status})`);
  link = { ...r.body, status: "waiting" };
  schedulePoll(Math.max(2, r.body.pollIntervalSeconds) * 1000);
  return syncRuntime().link!;
}

export function cancelLink() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  link = null;
}

function schedulePoll(ms: number) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void pollOnce(ms), ms);
}

/** Exported for tests; normally driven by the timer. */
export async function pollOnce(nextMs = 5000) {
  const base = cloudBaseUrl();
  if (!link || link.status !== "waiting" || !base) return link?.status;
  if (new Date(link.expiresAt) < new Date()) { link.status = "expired"; return link.status; }
  try {
    const r = await cloudCall<{ status: string; deviceId?: string; credential?: string; credentialExpiresAt?: string; organizationId?: string; branchId?: string; approvedBy?: string | null }>(base, "/sync/link/poll", { body: { requestId: link.requestId, pollToken: link.pollToken } });
    if (r.body.status === "approved" && r.body.credential) {
      await credentialStore()!.save({ cloudUrl: base, deviceId: r.body.deviceId!, credential: r.body.credential, credentialExpiresAt: r.body.credentialExpiresAt!, organizationId: r.body.organizationId!, branchId: r.body.branchId!, linkedAt: new Date().toISOString(), linkedBy: r.body.approvedBy ?? null });
      await enableCaptureWithBaseline(db, { cloudUrl: base });
      link.status = "approved";
      link.pollToken = "";
      void syncNow();
      return link.status;
    }
    if (r.body.status === "denied" || r.body.status === "expired" || r.body.status === "consumed") { link.status = r.body.status === "denied" ? "denied" : "expired"; return link.status; }
    if (r.status >= 400) { link.status = "failed"; link.message = r.body.error?.message ?? `Cloud error ${r.status}`; return link.status; }
  } catch (err) {
    link.message = (err as Error).message; // offline for a moment: keep waiting
  }
  schedulePoll(nextMs);
  return link.status;
}

export async function unlinkLocally() {
  cancelLink();
  await credentialStore()?.clear();
  await disableCapture(db);
}

async function currentCredential() {
  const c = await credentialStore()?.load();
  if (!c) throw new Error("This PC is not linked to DryCare Cloud.");
  return c;
}

async function rotateIfDue(base: string) {
  const c = await currentCredential();
  if (new Date(c.credentialExpiresAt).getTime() - Date.now() > ROTATE_BEFORE_DAYS * 86_400_000) return false;
  const r = await cloudCall<{ credential: string; credentialExpiresAt: string }>(base, "/sync/device/rotate", { body: {}, credential: c.credential });
  if (r.status !== 200) return false;
  await credentialStore()!.save({ ...c, credential: r.body.credential, credentialExpiresAt: r.body.credentialExpiresAt });
  return true;
}

/**
 * One full upload run. Only one runs at a time per installation: in-process flag plus a PostgreSQL advisory lock
 * held on a reserved connection (a second app instance on the same database cannot upload concurrently).
 */
export async function syncNow(opts: { maxBatches?: number; batchSize?: number; manual?: boolean } = {}) {
  if (syncing) return { started: false as const, reason: "already_running" };
  const [cfg] = await db.execute<{ cloud_linked: boolean; cloud_state: string }>(sql`select cloud_linked, cloud_state from sync_config where id = 1`);
  const base = cloudBaseUrl();
  const cred = await credentialStore()?.load();
  if (!cfg?.cloud_linked || !base || !cred) return { started: false as const, reason: "not_linked" };
  if (cfg.cloud_state === "restored") return { started: false as const, reason: "restored" };
  const reserved = await sqlClient.reserve();
  try {
    const [{ locked }] = await reserved`select pg_try_advisory_lock(${WORKER_LOCK_KEY}) as locked`;
    if (!locked) return { started: false as const, reason: "locked_by_other_worker" };
    syncing = true;
    // "Sync now": changes paused by a hold (plan, cloud update, rate limit) are tried now; failed ones keep their back-off.
    if (opts.manual) await db.execute(sql`update sync_outbox set next_attempt_at = now() where status = 'pending' and next_attempt_at > now()`);
    let sent = 0;
    let synced = 0;
    let message: string | undefined;
    try {
      await rotateIfDue(base).catch(() => false);
      const transport = new HttpSyncTransport(base, async () => (await currentCredential()).credential, env.APP_VERSION);
      for (let i = 0; i < (opts.maxBatches ?? 200); i++) {
        const r = await processQueue(db, transport, { batchSize: opts.batchSize ?? 400 });
        sent += r.sent;
        synced += r.synced;
        if ("hold" in r && r.hold) { message = r.hold; break; }
        if (!r.sent || r.failed === r.sent) break;
      }
      await pruneSynced(db).catch(() => 0);
    } finally {
      syncing = false;
      lastRun = { at: new Date().toISOString(), sent, synced, message };
      await reserved`select pg_advisory_unlock(${WORKER_LOCK_KEY})`;
    }
    return { started: true as const, sent, synced, hold: message };
  } finally {
    reserved.release();
  }
}

export function startSyncWorker(intervalMs = INTERVAL_MS) {
  if (timer) return;
  const tick = () => void syncNow().catch(() => {}).finally(() => { timer = setTimeout(tick, intervalMs); });
  timer = setTimeout(tick, 5_000);
}

export function stopSyncWorker() {
  if (timer) clearTimeout(timer);
  timer = null;
  cancelLink();
}
