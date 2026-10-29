/**
 * Runs inside the Electron main process. Imported only after main.ts has set process.env,
 * because the API reads its configuration at import time.
 */
import { sql } from "drizzle-orm";
import { buildServer } from "../../api/src/app";
import { db, sqlClient } from "../../api/src/db/client";
import { runMigrations } from "../../api/src/db/migrate-lib";
import { createBackup, listBackups, pruneAutoBackups, readBackupManifest, restoreBackup } from "../../api/src/lib/backup";
import { lanUrls } from "../../api/src/modules/system";
import { setDemoFirstUseFromDatabase } from "../../api/src/lib/license";
import { setCapture } from "../../api/src/sync/queue";
import { setCloudUrl, setCredentialStore, type CredentialStore } from "../../api/src/sync/cloud";
import { startSyncWorker, stopSyncWorker } from "../../api/src/sync/worker";

export { setCloudUrl, setCredentialStore, type CredentialStore };

type Server = Awaited<ReturnType<typeof buildServer>>;
let server: Server | undefined;

export async function startServer(opts: { migrationsDir: string; host: string; port: number }) {
  await runMigrations(db, opts.migrationsDir);
  // Changes are recorded for upload only while this PC is linked to DryCare Cloud (linking takes a full snapshot).
  const [cfg] = await db.execute<{ cloud_linked: boolean }>(sql`select cloud_linked from sync_config where id = 1`);
  await setCapture(db, Boolean(cfg?.cloud_linked));
  // The demo period also counts from when this PC's store was first set up, so removing demo.json cannot restart it.
  const [first] = await db.execute<{ first: string | null }>(sql`select min(created_at) as first from organizations`);
  setDemoFirstUseFromDatabase(first?.first ? Date.parse(first.first) : null);
  server = await buildServer();
  await server.listen({ host: opts.host, port: opts.port });
  startSyncWorker();
  return { localUrl: `http://127.0.0.1:${opts.port}`, lanUrls: opts.host === "0.0.0.0" ? lanUrls(opts.port) : [] };
}

export async function stopServer() {
  stopSyncWorker();
  await server?.close().catch(() => {});
  server = undefined;
  await sqlClient.end({ timeout: 5 }).catch(() => {});
}

export async function autoBackupIfDue(dir: string, appVersion: string, maxAgeHours: number) {
  const last = (await listBackups(dir)).find((b) => b.kind === "auto");
  if (last && Date.now() - new Date(last.createdAt).getTime() < maxAgeHours * 3600_000) return undefined;
  const info = await createBackup(sqlClient, dir, { appVersion, kind: "auto" });
  await pruneAutoBackups(dir, 30);
  return info;
}

export const backupNow = (dir: string, appVersion: string) => createBackup(sqlClient, dir, { appVersion, kind: "manual" });
export const backupManifest = readBackupManifest;

export async function restoreFrom(file: string, safetyDir: string, appVersion: string) {
  // Always keep a copy of the current data before overwriting it.
  const safety = await createBackup(sqlClient, safetyDir, { appVersion, kind: "manual" });
  const manifest = await restoreBackup(sqlClient, file);
  // A linked PC that goes back to an older backup must not upload that older copy over newer cloud data:
  // uploads pause until the owner has checked the cloud copy (DESKTOP_CLOUD_PLAN.md §9).
  await db.execute(sql`update sync_config set cloud_state = 'restored', last_error = ${`Restored from a backup of ${manifest.createdAt}`} where id = 1 and cloud_linked`);
  await db.execute(sql`insert into audit_logs (action, resource_type, resource_id, after_json) values ('system.backup_restored', 'backup', ${file}, ${JSON.stringify({ backupDate: manifest.createdAt, safetyCopy: safety.name })}::jsonb)`);
  return { manifest, safety };
}
