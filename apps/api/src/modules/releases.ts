/**
 * Distributing the PC edition. The owner uploads a version, tests it, rolls it out in stages and can stop it at once.
 *
 * A PC asks with its signed license key (POST /updates/check). The answer is signed with the licensing key and repeats the
 * PC's one-time code, so it cannot be forged or replayed. It carries a short-lived signed link: nothing can be downloaded
 * without one, and only a PC the release applies to gets one. Files live in RELEASE_DIR, never in the database.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { execFile } from "node:child_process";
import { createHash, createPrivateKey, sign, verify } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { compareVersions, releaseConfigProblems, type ReleaseManifest, type ReleaseTarget } from "@drycare/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { audit } from "../lib/audit";
import { requirePlatformAdmin } from "../lib/context";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";
import { verifySignedLicense } from "../lib/license";
import { openSecret } from "../lib/secretBox";
import { signingKey } from "./platformLicenses";
import { CUSTOMER_ORG } from "./platformConsole";

type Release = typeof schema.desktopReleases.$inferSelect;
type Device = typeof schema.licenseInstallations.$inferSelect;
type Rollback = typeof schema.desktopRollbacks.$inferSelect;

const versionField = z.string().trim().regex(/^\d+\.\d+\.\d+$/, "Use a version like 0.1.21");
const reason = z.string().trim().min(8, "Give a reason (at least 8 characters)").max(500);
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const OFFLINE_AFTER_DAYS = 7;
const DOWNLOAD_LINK_HOURS = 6;
const releaseDir = () => path.resolve(env.RELEASE_DIR ?? path.join(process.cwd(), ".local", "releases"));
const extensionOf = (r: { packageType: string }) => (r.packageType === "msi" ? "msi" : "exe");
const fileOf = (r: { version: string; packageType: string; architecture: string }) => path.join(releaseDir(), `DryCare-Setup-${r.version}-${r.architecture}.${extensionOf(r)}`);
const LIVE = ["testing", "staged", "published"];
const CHANNEL_RANK: Record<string, number> = { stable: 0, beta: 1, preview: 2 };

/** The same PC always lands in the same place for a version, so widening a rollout only ever adds PCs. */
export const rolloutBucket = (installationId: string, version: string) => createHash("sha256").update(`${installationId}:${version}`).digest().readUInt16BE(0) % 100;

const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("beta") }),
  z.object({ type: z.literal("customers"), ids: z.array(z.string().trim().min(1).max(160)).min(1).max(2000) }),
  z.object({ type: z.literal("businesses"), ids: z.array(z.uuid()).min(1).max(2000) }),
  z.object({ type: z.literal("installations"), ids: z.array(z.uuid()).min(1).max(5000) }),
  z.object({ type: z.literal("license_types"), ids: z.array(z.string().max(40)).min(1).max(20) }),
]);

function inTarget(r: Release, d: Pick<Device, "installationId" | "customerName" | "organizationId" | "licenseType" | "betaGroup">) {
  const t = r.target as ReleaseTarget;
  switch (t.type) {
    case "all": return true;
    case "beta": return d.betaGroup;
    case "customers": return t.ids.some((x) => x.toLowerCase() === (d.customerName ?? "").toLowerCase());
    case "businesses": return Boolean(d.organizationId && t.ids.includes(d.organizationId));
    case "installations": return t.ids.includes(d.installationId);
    case "license_types": return Boolean(d.licenseType && t.ids.includes(d.licenseType));
    default: return false;
  }
}

/** Whether a release is for this PC at all, whatever share is currently rolled out. */
function isForPc(r: Release, d: Device) {
  if (r.packageType !== "exe" || !r.sha256) return false; // An .msi is installed by hand; the updater cannot apply one.
  if (r.architecture !== (d.arch ?? "x64")) return false;
  if ((CHANNEL_RANK[r.channel] ?? 0) > (CHANNEL_RANK[d.channel] ?? 0)) return false;
  if (r.status === "testing") return d.betaGroup && inTarget(r, d);
  return inTarget(r, d);
}
const isOfferedTo = (r: Release, d: Device) => LIVE.includes(r.status) && isForPc(r, d) && (r.status === "testing" || rolloutBucket(d.installationId, r.version) < r.rolloutPercent);

/** What this PC should run next: a rollback the owner started, or the newest release that applies. Never an older one otherwise. */
function decide(d: Device, version: string, releases: Release[], rollbacks: Rollback[]): { release: Release; rollback: boolean } | null {
  const undo = rollbacks.find((b) => b.status === "active" && b.fromVersion === version && inScope(b, d));
  if (undo) {
    const to = releases.find((r) => r.version === undo.toVersion && r.status !== "withdrawn" && r.sha256 && r.architecture === (d.arch ?? "x64"));
    if (to) return { release: to, rollback: true };
  }
  const next = releases.filter((r) => compareVersions(r.version, version) > 0 && isOfferedTo(r, d)).sort((a, b) => compareVersions(b.version, a.version))[0];
  return next ? { release: next, rollback: false } : null;
}
function inScope(b: Rollback, d: Device) {
  const s = b.scope as { type: "all" } | { type: "installations"; ids: string[] };
  return s.type === "all" || s.ids.includes(d.installationId);
}

async function signText(text: string) {
  const k = await signingKey();
  if (!k) throw new AppError(503, "LICENSING_NOT_READY", "Licensing is not set up on this server.");
  const bytes = Buffer.from(text);
  return { encoded: `${bytes.toString("base64url")}.${sign(null, bytes, createPrivateKey(openSecret(k.privateKeySealed))).toString("base64url")}`, k };
}

/** A download link for one PC and one version, which expires. Forging one would need the licensing key. */
async function downloadToken(installationId: string, version: string) {
  return (await signText(JSON.stringify({ i: installationId, v: version, e: Date.now() + DOWNLOAD_LINK_HOURS * 3_600_000 }))).encoded;
}
async function readDownloadToken(token: string) {
  const [payload, signature] = token.split(".");
  const k = await signingKey();
  if (!k || !payload || !signature) throw forbidden("This download link is not valid.");
  const bytes = Buffer.from(payload, "base64url");
  if (!verify(null, bytes, k.publicKeyPem, Buffer.from(signature, "base64url"))) throw forbidden("This download link is not valid.");
  const t = JSON.parse(bytes.toString()) as { i: string; v: string; e: number };
  if (t.e < Date.now()) throw forbidden("This download link has expired.");
  return t;
}

/** Whether a Windows program is code-signed. A Windows server checks it fully; elsewhere only that a signature is there. */
function signatureOf(file: string): Promise<{ status: string; publisher: string | null }> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const script = "$s = Get-AuthenticodeSignature -LiteralPath $env:DRYCARE_FILE; [pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress";
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, DRYCARE_FILE: file }, windowsHide: true, timeout: 120_000 }, (err, out) => {
        if (err) return resolve({ status: "unknown", publisher: null });
        try {
          const r = JSON.parse(out) as { status: string; subject: string };
          resolve({ status: r.status === "Valid" ? "valid" : r.status === "NotSigned" ? "not_signed" : "invalid", publisher: r.subject || null });
        } catch { resolve({ status: "unknown", publisher: null }); }
      });
    });
  }
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(4096);
    readSync(fd, head, 0, 4096, 0);
    const pe = head.readUInt32LE(0x3c);
    const is64 = head.readUInt16LE(pe + 24) === 0x20b;
    const size = head.readUInt32LE(pe + 24 + (is64 ? 112 : 96) + 8 * 4 + 4);
    return Promise.resolve({ status: size > 0 ? "present_unverified" : "not_signed", publisher: null });
  } catch {
    return Promise.resolve({ status: "unknown", publisher: null });
  } finally {
    closeSync(fd);
  }
}

/** Stops a rollout when too many PCs report failure. */
async function maybeAutoPause(req: FastifyRequest, version: string) {
  const r = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.version, version) });
  if (!r || !["staged", "published"].includes(r.status)) return;
  const [c] = await db.execute<{ bad: number; good: number }>(sql`select count(distinct installation_id) filter (where status in ('failed', 'rolled_back'))::int as bad, count(distinct installation_id) filter (where status = 'succeeded')::int as good from desktop_update_reports where to_version = ${version}`);
  if (c.bad < r.failureMinCount || (c.bad / (c.bad + c.good)) * 100 < r.failureThresholdPct) return;
  const pauseReason = `Paused automatically: ${c.bad} of ${c.bad + c.good} PCs failed, above the ${r.failureThresholdPct}% limit.`;
  await db.update(schema.desktopReleases).set({ status: "paused", pauseReason }).where(eq(schema.desktopReleases.id, r.id));
  await audit(db, req, { action: "platform.release_auto_paused", resourceType: "desktop_release", resourceId: r.id, after: { version, bad: c.bad, good: c.good } });
}

function pcStatus(d: Device, releases: Release[], rollbacks: Rollback[], now = Date.now()) {
  const version = d.appVersion ?? "0.0.0";
  const seen = d.lastSyncAt?.getTime();
  const decision = decide(d, version, releases, rollbacks);
  const latest = decision?.release ?? null;
  const fresh = d.updateStatusAt && now - d.updateStatusAt.getTime() < 2 * 3_600_000;
  const newestMin = releases.filter((r) => LIVE.includes(r.status) && r.minSupportedVersion).map((r) => r.minSupportedVersion!).sort(compareVersions).pop();
  const below = Boolean(newestMin && compareVersions(version, newestMin) < 0);
  let status: string;
  if (!seen || now - seen > OFFLINE_AFTER_DAYS * 86_400_000) status = "offline";
  else if (fresh && d.updateStatus === "downloading") status = "downloading";
  else if (fresh && d.updateStatus === "installing") status = "installing";
  else if (d.updateStatus === "failed" || d.updateStatus === "rolled_back") status = "failed";
  else if (below) status = latest ? "required" : "unsupported";
  else if (latest) status = latest.mandatory ? "required" : "available";
  else status = "up_to_date";
  return { status, latestEligible: latest?.version ?? null };
}

/** What the setup guide can check for itself. */
async function releaseSetup() {
  const dir = releaseDir();
  let freeBytes: number | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    const s = statfsSync(dir);
    freeBytes = Number(s.bavail) * Number(s.bsize);
  } catch { /* Shown as unknown. */ }
  return { signingKeyReady: Boolean(await signingKey()), storageDir: dir, storageOnDisk: true, freeBytes };
}

export async function releaseRoutes(app: FastifyInstance) {
  // ---- PCs
  app.post("/updates/check", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({
      key: z.string().trim().min(10).max(20_000),
      installationId: z.uuid(),
      nonce: z.uuid(),
      version: versionField,
      pcName: z.string().trim().max(120).optional(),
      os: z.string().trim().max(120).optional(),
      arch: z.enum(["x64", "arm64"]).default("x64"),
    }).parse(req.body);
    const k = await signingKey();
    if (!k) throw new AppError(503, "LICENSING_NOT_READY", "Licensing is not set up on this server.");
    const license = verifySignedLicense(body.key, k.publicKeyPem);
    if (!license || !license.installationIds.includes(body.installationId)) throw new AppError(401, "LICENSE_NOT_RECOGNISED", "This key does not match this PC.");
    const now = new Date();
    const [device] = await db.insert(schema.licenseInstallations)
      .values({ installationId: body.installationId, licenseId: license.licenseId, organizationId: license.organizationId ?? null, customerName: license.customerName ?? null, licenseType: license.licenseType ?? null, appVersion: body.version, pcName: body.pcName, osVersion: body.os, arch: body.arch, lastSyncAt: now })
      .onConflictDoUpdate({ target: schema.licenseInstallations.installationId, set: { appVersion: body.version, pcName: body.pcName, osVersion: body.os, arch: body.arch, licenseType: license.licenseType ?? null, lastSyncAt: now } })
      .returning();
    const owner = await db.query.desktopLicenses.findFirst({ where: eq(schema.desktopLicenses.id, device.licenseId) });
    const allowed = device.status === "active" && (!owner || owner.status === "active");
    const [releases, rollbacks] = await Promise.all([db.query.desktopReleases.findMany(), db.query.desktopRollbacks.findMany({ where: eq(schema.desktopRollbacks.status, "active") })]);
    const decision = allowed ? decide(device, body.version, releases, rollbacks) : null;
    const r = decision?.release;
    const manifest: ReleaseManifest = {
      version: 2,
      nonce: body.nonce,
      installationId: body.installationId,
      serverTime: now.toISOString(),
      suspendedVersions: releases.filter((x) => x.status === "paused" || x.status === "withdrawn").map((x) => x.version),
      release: r ? {
        version: r.version, title: r.title, sha256: r.sha256!, sha512: r.sha512!, size: r.sizeBytes ?? 0, notes: r.notes, message: r.notificationMessage,
        mandatory: r.mandatory, automatic: r.automatic, restartRequired: r.restartRequired, deadline: r.updateDeadline?.toISOString() ?? null,
        window: r.maintenanceStart !== null && r.maintenanceEnd !== null ? { start: r.maintenanceStart, end: r.maintenanceEnd } : null,
        minSupportedVersion: r.minSupportedVersion, rollback: decision!.rollback, channel: r.channel, signatureStatus: r.signatureStatus,
        feedToken: await downloadToken(body.installationId, r.version),
      } : null,
    };
    const { encoded } = await signText(JSON.stringify(manifest));
    return { token: `DRYCARERELEASE2.${encoded}` };
  });

  const downloadable = async (token: string) => {
    const t = await readDownloadToken(token);
    const [device, release, rollbacks] = await Promise.all([
      db.query.licenseInstallations.findFirst({ where: eq(schema.licenseInstallations.installationId, t.i) }),
      db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.version, t.v) }),
      db.query.desktopRollbacks.findMany({ where: eq(schema.desktopRollbacks.status, "active") }),
    ]);
    if (!device || device.status !== "active") throw forbidden("This PC may not download updates.");
    if (!release || !release.sha256 || !existsSync(fileOf(release))) throw notFound("Update");
    // A stopped release cannot be downloaded even with a link already handed out, unless it is a rollback's destination.
    const rollbackTarget = release.status !== "withdrawn" && rollbacks.some((b) => b.toVersion === release.version && inScope(b, device));
    if (!LIVE.includes(release.status) && !rollbackTarget) throw notFound("Update");
    return release;
  };

  app.get("/updates/feed/:token/latest.yml", async (req, reply) => {
    const { token } = z.object({ token: z.string().max(2000) }).parse(req.params);
    const r = await downloadable(token);
    const name = path.basename(fileOf(r));
    reply.header("content-type", "text/yaml").header("cache-control", "no-store");
    return `version: ${r.version}\nfiles:\n  - url: ${name}\n    sha512: ${r.sha512}\n    size: ${r.sizeBytes}\npath: ${name}\nsha512: ${r.sha512}\nreleaseDate: '${(r.publishedAt ?? r.createdAt).toISOString()}'\n`;
  });

  app.get("/updates/feed/:token/:file", async (req, reply) => {
    const { token, file: asked } = z.object({ token: z.string().max(2000), file: z.string().max(160) }).parse(req.params);
    const r = await downloadable(token);
    const file = fileOf(r);
    if (asked !== path.basename(file)) throw notFound("Update");
    const size = statSync(file).size;
    const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ""));
    reply.header("accept-ranges", "bytes").header("content-type", "application/octet-stream");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      reply.code(206).header("content-range", `bytes ${start}-${end}/${size}`).header("content-length", end - start + 1);
      return reply.send(createReadStream(file, { start, end }));
    }
    reply.header("content-length", size);
    return reply.send(createReadStream(file));
  });

  app.post("/updates/report", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({
      key: z.string().trim().min(10).max(20_000),
      installationId: z.uuid(),
      fromVersion: z.string().trim().max(40).nullable().optional(),
      toVersion: z.string().trim().max(40),
      status: z.enum(["downloading", "downloaded", "installing", "succeeded", "failed", "rolled_back"]),
      detail: z.string().trim().max(500).nullable().optional(),
    }).parse(req.body);
    // Only a licensed PC may report for itself, or a stranger could pause a rollout with made-up failures.
    const reporting = await signingKey();
    const licensed = reporting && verifySignedLicense(body.key, reporting.publicKeyPem);
    if (!licensed || !licensed.installationIds.includes(body.installationId)) throw new AppError(401, "LICENSE_NOT_RECOGNISED", "This key does not match this PC.");
    await db.insert(schema.desktopUpdateReports).values({ installationId: body.installationId, fromVersion: body.fromVersion ?? null, toVersion: body.toVersion, status: body.status, detail: body.detail ?? null });
    const now = new Date();
    await db.update(schema.licenseInstallations).set({
      updateStatus: body.status, updateStatusAt: now,
      ...(body.status === "succeeded" ? { appVersion: body.toVersion, lastSuccessVersion: body.toVersion, lastSuccessAt: now, lastError: null } : {}),
      ...(body.status === "failed" || body.status === "rolled_back" ? { lastError: body.detail ?? body.status } : {}),
    }).where(eq(schema.licenseInstallations.installationId, body.installationId));
    if (body.status === "failed" || body.status === "rolled_back") await maybeAutoPause(req, body.toVersion);
    return { ok: true };
  });

  // ---- The owner
  app.get("/platform-admin/releases", async (req) => {
    requirePlatformAdmin(req);
    const [releases, reports, devices, rollbacks, publishers] = await Promise.all([
      db.query.desktopReleases.findMany({ orderBy: [desc(schema.desktopReleases.createdAt)] }),
      db.execute<{ version: string; status: string; n: number }>(sql`select to_version as version, status, count(distinct installation_id)::int as n from desktop_update_reports group by 1, 2`),
      db.query.licenseInstallations.findMany(),
      db.query.desktopRollbacks.findMany({ orderBy: [desc(schema.desktopRollbacks.createdAt)] }),
      db.execute<{ id: string; name: string }>(sql`select id, name from users where is_platform_admin`),
    ]);
    const list = [...reports];
    const byVersion = (version: string) => Object.fromEntries(list.filter((x) => x.version === version).map((x) => [x.status, x.n]));
    const newest = (channel: string) => releases.filter((r) => r.channel === channel && ["published", "staged"].includes(r.status)).map((r) => r.version).sort(compareVersions).pop() ?? null;
    const statuses = devices.map((d) => pcStatus(d, releases, rollbacks).status);
    const stable = newest("stable");
    return {
      setup: await releaseSetup(),
      summary: {
        totalReleases: releases.length,
        latestStable: stable,
        latestBeta: newest("beta"),
        registeredPcs: devices.length,
        onLatest: stable ? devices.filter((d) => d.appVersion === stable).length : 0,
        pending: statuses.filter((s) => ["available", "required", "downloading", "installing"].includes(s)).length,
        failures: statuses.filter((s) => s === "failed").length,
        offline: statuses.filter((s) => s === "offline").length,
      },
      releases: releases.map((r) => {
        const eligible = devices.filter((d) => isForPc(r, d));
        return {
          ...r,
          reports: byVersion(r.version),
          installed: devices.filter((d) => d.appVersion === r.version).length,
          publishedByName: [...publishers].find((p) => p.id === r.publishedBy)?.name ?? null,
          eligible: eligible.length,
          stageCounts: (r.stages as number[]).map((percent) => ({ percent, selected: eligible.filter((d) => rolloutBucket(d.installationId, r.version) < percent).length })),
          downloadUrl: r.sha256 ? `/api/v1/platform-admin/releases/${r.id}/download` : null,
        };
      }),
      rollbacks: rollbacks.map((b) => ({ ...b, progress: list.filter((x) => x.version === b.toVersion).reduce<Record<string, number>>((m, x) => ({ ...m, [x.status]: x.n }), {}), onOldVersion: devices.filter((d) => d.appVersion === b.fromVersion).length, onTarget: devices.filter((d) => d.appVersion === b.toVersion).length })),
      recentFailures: await db.select().from(schema.desktopUpdateReports).where(sql`${schema.desktopUpdateReports.status} in ('failed', 'rolled_back')`).orderBy(desc(schema.desktopUpdateReports.createdAt)).limit(20),
    };
  });

  const configBody = {
    productName: z.string().trim().min(2).max(120).optional(),
    buildNumber: z.string().trim().max(40).nullable().optional(),
    title: z.string().trim().max(160).nullable().optional(),
    channel: z.enum(["stable", "beta", "preview"]).optional(),
    notes: z.string().trim().max(4000).optional(),
    releaseDate: z.iso.date().nullable().optional(),
    architecture: z.enum(["x64", "arm64"]).optional(),
    packageType: z.enum(["exe", "msi"]).optional(),
    mandatory: z.boolean().optional(),
    automatic: z.boolean().optional(),
    restartRequired: z.boolean().optional(),
    updateDeadline: z.iso.datetime().nullable().optional(),
    maintenanceStart: z.number().int().min(0).max(23).nullable().optional(),
    maintenanceEnd: z.number().int().min(0).max(23).nullable().optional(),
    minSupportedVersion: versionField.nullable().optional(),
    rollbackAvailable: z.boolean().optional(),
    notificationMessage: z.string().trim().max(500).nullable().optional(),
    target: targetSchema.optional(),
    stages: z.array(z.number().int().min(1).max(100)).min(1).max(8).optional(),
    failureThresholdPct: z.number().int().min(1).max(100).optional(),
    failureMinCount: z.number().int().min(1).max(10000).optional(),
  };
  const problemsWith = (next: Parameters<typeof releaseConfigProblems>[0]) => {
    const problems = releaseConfigProblems(next);
    if (problems.length) throw new AppError(422, "RELEASE_SETTINGS_CONFLICT", problems.join(" "));
  };

  app.post("/platform-admin/releases", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({ version: versionField, ...configBody }).parse(req.body);
    const taken = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.version, body.version) });
    if (taken) throw conflict(`Version ${body.version} already exists.`, "RELEASE_EXISTS");
    problemsWith({ ...body, updateDeadline: body.updateDeadline ?? null });
    const stages = body.stages ?? [10, 25, 50, 100];
    const [row] = await db.insert(schema.desktopReleases).values({ ...body, stages, rolloutPercent: stages[0], updateDeadline: body.updateDeadline ? new Date(body.updateDeadline) : null, createdBy: auth.userId }).returning();
    await audit(db, req, { action: "platform.release_created", resourceType: "desktop_release", resourceId: row.id, actorUserId: auth.userId, after: { version: row.version, channel: row.channel } });
    reply.code(201);
    return row;
  });

  /** The installer, sent as the raw request body and streamed to disk. */
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));
    scope.put("/platform-admin/releases/:id/file", { bodyLimit: MAX_PACKAGE_BYTES }, async (req) => {
      const auth = requirePlatformAdmin(req);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const release = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.id, id) });
      if (!release) throw notFound("Release");
      if (release.publishedAt || LIVE.includes(release.status)) throw conflict("This version has been released, so its file can never be replaced. Add a new version instead.", "RELEASE_FILE_LOCKED");
      mkdirSync(releaseDir(), { recursive: true });
      const target = fileOf(release);
      const temporary = `${target}.${id}.part`;
      const sha256 = createHash("sha256");
      const sha512 = createHash("sha512");
      let size = 0;
      const counter = new Transform({ transform(chunk: Buffer, _enc, next) {
        size += chunk.length;
        if (size > MAX_PACKAGE_BYTES) return next(new AppError(413, "PACKAGE_TOO_LARGE", "This file is larger than the 1 GB limit."));
        sha256.update(chunk);
        sha512.update(chunk);
        next(null, chunk);
      } });
      try {
        await pipeline(req.body as Readable, counter, createWriteStream(temporary));
      } catch (cause) {
        rmSync(temporary, { force: true });
        throw cause;
      }
      const refuse = (code: string, message: string) => { rmSync(temporary, { force: true }); return new AppError(422, code, message); };
      const head = Buffer.alloc(8);
      const fd = openSync(temporary, "r");
      readSync(fd, head, 0, 8, 0);
      closeSync(fd);
      const isExe = head.subarray(0, 2).toString("latin1") === "MZ";
      const isMsi = head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
      if (size < 1024 || (release.packageType === "exe" && !isExe) || (release.packageType === "msi" && !isMsi)) throw refuse("NOT_AN_INSTALLER", `This file is not a Windows .${extensionOf(release)} installer.`);
      const digest = sha256.digest("hex");
      const expected = String(req.headers["x-expected-sha256"] ?? "").trim().toLowerCase();
      if (expected && expected !== digest) throw refuse("CHECKSUM_MISMATCH", "This file's SHA-256 does not match the checksum you entered, so it may be damaged.");
      const signature = await signatureOf(temporary);
      if (signature.status === "invalid") throw refuse("SIGNATURE_INVALID", "This file carries a digital signature that does not check out, so it may have been changed. It was not saved.");
      renameSync(temporary, target);
      const [row] = await db.update(schema.desktopReleases).set({ fileName: path.basename(target), sha256: digest, sha512: sha512.digest("base64"), sizeBytes: size, signatureStatus: signature.status, signaturePublisher: signature.publisher }).where(eq(schema.desktopReleases.id, id)).returning();
      await audit(db, req, { action: "platform.release_file_uploaded", resourceType: "desktop_release", resourceId: id, actorUserId: auth.userId, after: { version: release.version, sha256: digest, size, signature: signature.status } });
      return row;
    });
  });

  app.get("/platform-admin/releases/:id/download", async (req, reply) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const r = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.id, id) });
    if (!r || !r.sha256 || !existsSync(fileOf(r))) throw notFound("Installer");
    reply.header("content-type", "application/octet-stream").header("content-disposition", `attachment; filename="${path.basename(fileOf(r))}"`).header("content-length", statSync(fileOf(r)).size);
    return reply.send(createReadStream(fileOf(r)));
  });

  app.patch("/platform-admin/releases/:id", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ ...configBody, rolloutPercent: z.number().int().min(1).max(100).optional(), reason }).parse(req.body);
    const before = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.id, id) });
    if (!before) throw notFound("Release");
    const { reason: why, updateDeadline: deadline, ...values } = body;
    problemsWith({
      version: before.version, mandatory: values.mandatory ?? before.mandatory, automatic: values.automatic ?? before.automatic,
      updateDeadline: deadline === undefined ? before.updateDeadline?.toISOString() ?? null : deadline,
      maintenanceStart: values.maintenanceStart === undefined ? before.maintenanceStart : values.maintenanceStart,
      maintenanceEnd: values.maintenanceEnd === undefined ? before.maintenanceEnd : values.maintenanceEnd,
      minSupportedVersion: values.minSupportedVersion === undefined ? before.minSupportedVersion : values.minSupportedVersion,
    });
    return db.transaction(async (tx) => {
      const [row] = await tx.update(schema.desktopReleases).set({ ...values, ...(deadline !== undefined ? { updateDeadline: deadline ? new Date(deadline) : null } : {}) }).where(eq(schema.desktopReleases.id, id)).returning();
      await audit(tx, req, { action: "platform.release_updated", resourceType: "desktop_release", resourceId: id, actorUserId: auth.userId, before: { rolloutPercent: before.rolloutPercent, mandatory: before.mandatory }, after: { ...values, reason: why } });
      return row;
    });
  });

  /** Moving a release through its life. */
  app.post("/platform-admin/releases/:id/action", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      action: z.enum(["test", "stage", "next_stage", "publish", "pause", "resume", "withdraw", "recommend"]),
      /** The owner accepts that this version is not code-signed. It stays labelled as not verified. */
      allowUnsigned: z.boolean().default(false),
      reason,
    }).parse(req.body);
    const r = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.id, id) });
    if (!r) throw notFound("Release");
    const stages = r.stages as number[];
    const needsFile = () => {
      if (!r.sha256 || !existsSync(fileOf(r))) throw conflict("Upload the installer first.", "RELEASE_FILE_MISSING");
      if (r.packageType !== "exe") throw conflict("Only an .exe can be delivered by the updater. An .msi is for installing by hand.", "PACKAGE_NOT_AUTOMATIC");
      if (r.signatureStatus === "invalid") throw conflict("This file's signature does not check out.", "SIGNATURE_INVALID");
    };
    const signedOrAccepted = () => {
      if (r.signatureStatus === "valid" || r.unsignedApproved || body.allowUnsigned) return;
      throw new AppError(409, "RELEASE_NOT_SIGNED", "This installer is not code-signed. Sign it, or confirm that you accept releasing it without a verified signature.");
    };
    if (r.status === "withdrawn") throw conflict("A withdrawn release cannot be used again. Add a new version instead.", "RELEASE_WITHDRAWN");
    let change: Partial<Release> = {};
    switch (body.action) {
      case "test": needsFile(); change = { status: "testing", pauseReason: null }; break;
      case "stage": needsFile(); signedOrAccepted(); change = { status: "staged", currentStage: 0, rolloutPercent: stages[0], pauseReason: null, publishedAt: r.publishedAt ?? new Date(), publishedBy: auth.userId, unsignedApproved: r.unsignedApproved || (r.signatureStatus !== "valid" && body.allowUnsigned) }; break;
      case "next_stage": {
        if (r.status !== "staged") throw conflict("Only a staged rollout has a next stage.", "NOT_STAGED");
        const next = Math.min(r.currentStage + 1, stages.length - 1);
        change = { currentStage: next, rolloutPercent: stages[next], ...(stages[next] >= 100 ? { status: "published" } : {}) };
        break;
      }
      case "publish": needsFile(); signedOrAccepted(); change = { status: "published", currentStage: stages.length - 1, rolloutPercent: 100, pauseReason: null, publishedAt: r.publishedAt ?? new Date(), publishedBy: auth.userId, unsignedApproved: r.unsignedApproved || (r.signatureStatus !== "valid" && body.allowUnsigned) }; break;
      case "pause":
        if (!LIVE.includes(r.status)) throw conflict("Only a release that is out can be paused.", "NOT_LIVE");
        change = { status: "paused", pauseReason: body.reason };
        break;
      case "resume":
        if (r.status !== "paused") throw conflict("Only a paused release can be resumed.", "NOT_PAUSED");
        needsFile();
        signedOrAccepted();
        change = { status: r.rolloutPercent >= 100 ? "published" : "staged", pauseReason: null, publishedAt: r.publishedAt ?? new Date(), publishedBy: r.publishedBy ?? auth.userId, unsignedApproved: r.unsignedApproved || (r.signatureStatus !== "valid" && body.allowUnsigned) };
        break;
      case "withdraw": change = { status: "withdrawn", pauseReason: body.reason, recommended: false }; break;
      case "recommend": if (r.status === "withdrawn" || !r.sha256) throw conflict("A withdrawn release cannot be recommended.", "RELEASE_WITHDRAWN"); change = { recommended: true }; break;
    }
    return db.transaction(async (tx) => {
      if (body.action === "recommend") await tx.update(schema.desktopReleases).set({ recommended: false }).where(eq(schema.desktopReleases.channel, r.channel));
      const [row] = await tx.update(schema.desktopReleases).set(change).where(eq(schema.desktopReleases.id, id)).returning();
      await audit(tx, req, { action: `platform.release_${body.action}`, resourceType: "desktop_release", resourceId: id, actorUserId: auth.userId, before: { status: r.status, rolloutPercent: r.rolloutPercent }, after: { status: row.status, rolloutPercent: row.rolloutPercent, reason: body.reason, allowUnsigned: body.allowUnsigned } });
      return row;
    });
  });

  /** Stops every release at once. PCs already updated stay as they are until a rollback is started. */
  app.post("/platform-admin/releases/emergency-stop", async (req) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({ reason }).parse(req.body);
    const rows = await db.update(schema.desktopReleases).set({ status: "paused", pauseReason: `Emergency stop: ${body.reason}` }).where(inArray(schema.desktopReleases.status, LIVE)).returning({ version: schema.desktopReleases.version });
    await audit(db, req, { action: "platform.release_emergency_stop", resourceType: "desktop_release", actorUserId: auth.userId, after: { versions: rows.map((r) => r.version), reason: body.reason } });
    return { paused: rows.map((r) => r.version) };
  });

  /** Sends PCs on a bad version back to an earlier one. Only the program goes back: migrations only add to the database, and a backup is taken first. */
  app.post("/platform-admin/releases/rollbacks", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({ fromVersion: versionField, toVersion: versionField, scope: z.discriminatedUnion("type", [z.object({ type: z.literal("all") }), z.object({ type: z.literal("installations"), ids: z.array(z.uuid()).min(1).max(5000) })]), reason }).parse(req.body);
    if (compareVersions(body.toVersion, body.fromVersion) >= 0) throw conflict("A rollback must go to an earlier version.", "ROLLBACK_NOT_EARLIER");
    const to = await db.query.desktopReleases.findFirst({ where: eq(schema.desktopReleases.version, body.toVersion) });
    if (!to || !to.sha256 || !existsSync(fileOf(to))) throw conflict("That version's installer is not available.", "RELEASE_FILE_MISSING");
    if (to.status === "withdrawn") throw conflict("That version has been withdrawn.", "RELEASE_WITHDRAWN");
    if (!to.rollbackAvailable) throw conflict("That version is marked as not suitable for going back to.", "ROLLBACK_NOT_AVAILABLE");
    const [row] = await db.insert(schema.desktopRollbacks).values({ fromVersion: body.fromVersion, toVersion: body.toVersion, scope: body.scope, reason: body.reason, createdBy: auth.userId }).returning();
    await audit(db, req, { action: "platform.release_rollback_started", resourceType: "desktop_release", resourceId: to.id, actorUserId: auth.userId, after: { from: body.fromVersion, to: body.toVersion, scope: body.scope.type, reason: body.reason } });
    reply.code(201);
    return row;
  });

  app.post("/platform-admin/releases/rollbacks/:id/stop", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    const [row] = await db.update(schema.desktopRollbacks).set({ status: "stopped" }).where(eq(schema.desktopRollbacks.id, id)).returning();
    if (!row) throw notFound("Rollback");
    await audit(db, req, { action: "platform.release_rollback_stopped", resourceType: "desktop_release", actorUserId: auth.userId, after: { id, reason: body.reason } });
    return row;
  });

  // ---- PCs, for the owner
  app.get("/platform-admin/release-pcs", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ search: z.string().trim().max(120).optional(), version: z.string().max(40).optional(), os: z.string().max(120).optional(), status: z.string().max(40).optional(), channel: z.string().max(20).optional(), seenWithinDays: z.coerce.number().int().min(1).max(3650).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(25) }).parse(req.query);
    const [devices, releases, rollbacks, orgs] = await Promise.all([
      db.query.licenseInstallations.findMany({ orderBy: [desc(schema.licenseInstallations.lastSyncAt)], limit: 5000 }),
      db.query.desktopReleases.findMany(),
      db.query.desktopRollbacks.findMany({ where: eq(schema.desktopRollbacks.status, "active") }),
      db.execute<{ id: string; name: string }>(sql`select o.id, o.name from organizations o where o.id in (select organization_id from license_installations where organization_id is not null)`),
    ]);
    const names = new Map([...orgs].map((o) => [o.id, o.name]));
    const s = q.search?.toLowerCase();
    const rows = devices.map((d) => { const { status: updateState, latestEligible } = pcStatus(d, releases, rollbacks); return { ...d, business: d.organizationId ? names.get(d.organizationId) ?? null : null, updateState, latestEligible }; }).filter((d) =>
      (!s || [d.customerName, d.business, d.pcName, d.installationId].some((v) => v?.toLowerCase().includes(s)))
      && (!q.version || d.appVersion === q.version) && (!q.os || d.osVersion === q.os) && (!q.status || d.updateState === q.status) && (!q.channel || d.channel === q.channel)
      && (!q.seenWithinDays || (d.lastSyncAt && Date.now() - d.lastSyncAt.getTime() <= q.seenWithinDays * 86_400_000)));
    return {
      total: rows.length, page: q.page, pageSize: q.pageSize,
      items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      filters: { versions: [...new Set(devices.map((d) => d.appVersion).filter(Boolean))].sort(), systems: [...new Set(devices.map((d) => d.osVersion).filter(Boolean))].sort() },
    };
  });

  app.patch("/platform-admin/release-pcs/:installationId", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { installationId } = z.object({ installationId: z.uuid() }).parse(req.params);
    const body = z.object({ channel: z.enum(["stable", "beta", "preview"]).optional(), betaGroup: z.boolean().optional(), reason }).parse(req.body);
    const { reason: why, ...values } = body;
    const [row] = await db.update(schema.licenseInstallations).set(values).where(eq(schema.licenseInstallations.installationId, installationId)).returning();
    if (!row) throw notFound("PC");
    await audit(db, req, { action: "platform.release_pc_updated", resourceType: "license_installation", resourceId: installationId, actorUserId: auth.userId, after: { ...values, reason: why } });
    return row;
  });

  app.get("/platform-admin/release-pcs/:installationId/history", async (req) => {
    requirePlatformAdmin(req);
    const { installationId } = z.object({ installationId: z.uuid() }).parse(req.params);
    const [reports, checkIns] = await Promise.all([
      db.select().from(schema.desktopUpdateReports).where(eq(schema.desktopUpdateReports.installationId, installationId)).orderBy(desc(schema.desktopUpdateReports.createdAt)).limit(200),
      db.select().from(schema.licenseSyncEvents).where(eq(schema.licenseSyncEvents.installationId, installationId)).orderBy(desc(schema.licenseSyncEvents.createdAt)).limit(50),
    ]);
    return { reports, checkIns };
  });

  // ---- How much each feature is used. Counts per shop and day only.
  app.get("/platform-admin/feature-usage", async (req) => {
    requirePlatformAdmin(req);
    const { days, feature } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30), feature: z.string().max(80).optional() }).parse(req.query);
    const since = sql`current_date - ${days}::int`;
    const half = Math.floor(days / 2);
    const NOT_TEST = CUSTOMER_ORG;
    const scope = feature ? sql`and u.feature = ${feature}` : sql``;
    const [trend, [{ previous, active }]] = await Promise.all([
      db.execute<{ day: string; value: number }>(sql`
        select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(u.count), 0)::int as value
        from generate_series(current_date - ${days}::int, current_date, interval '1 day') d
        left join (feature_usage_daily u join organizations o on o.id = u.organization_id and ${NOT_TEST}) on u.day = d::date ${scope}
        group by d order by d`),
      db.execute<{ previous: number; active: number }>(sql`
        select coalesce(sum(u.count) filter (where u.day < ${since}), 0)::int as previous,
               count(distinct u.organization_id) filter (where u.day >= ${since})::int as active
        from feature_usage_daily u join organizations o on o.id = u.organization_id
        where u.day >= current_date - ${days * 2}::int and ${NOT_TEST}`),
    ]);
    const [rows, byPlan, customers, [{ total }]] = await Promise.all([
      db.execute<{ feature: string; uses: number; customers: number; recent: number; earlier: number }>(sql`
        select u.feature, sum(u.count)::int as uses, count(distinct u.organization_id)::int as customers,
          coalesce(sum(u.count) filter (where u.day >= current_date - ${half}::int), 0)::int as recent,
          coalesce(sum(u.count) filter (where u.day < current_date - ${half}::int), 0)::int as earlier
        from feature_usage_daily u join organizations o on o.id = u.organization_id
        where u.day >= ${since} and ${NOT_TEST} group by 1 order by 2 desc`),
      db.execute<{ plan: string; feature: string; uses: number; customers: number }>(sql`
        select coalesce(p.name, 'No plan') as plan, u.feature, sum(u.count)::int as uses, count(distinct u.organization_id)::int as customers
        from feature_usage_daily u join organizations o on o.id = u.organization_id
        left join lateral (select s.plan_id from commercial_subscriptions s where s.organization_id = o.id order by s.created_at desc limit 1) s on true
        left join commercial_plans p on p.id = s.plan_id
        where u.day >= ${since} and ${NOT_TEST} group by 1, 2 order by 1, 3 desc`),
      feature
        ? db.execute<{ id: string; name: string; uses: number; lastDay: string }>(sql`
            select o.id, o.name, sum(u.count)::int as uses, max(u.day) as "lastDay" from feature_usage_daily u join organizations o on o.id = u.organization_id
            where u.day >= ${since} and u.feature = ${feature} and ${NOT_TEST} group by 1, 2 order by 3 desc limit 200`)
        : Promise.resolve([]),
      db.execute<{ total: number }>(sql`select count(*)::int as total from organizations o where ${NOT_TEST} and o.status in ('trial', 'active')`),
    ]);
    return { days, totalCustomers: total, activeCustomers: active, previousUses: previous, trend: [...trend], features: [...rows], byPlan: [...byPlan], customers: [...customers] };
  });
}
