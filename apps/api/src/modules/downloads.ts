/**
 * The apps a customer can download from the website. Windows is the newest stable version released in Software releases, so
 * nothing appears here until the owner has released it. Android is the newest build published by apps/android/scripts/build.mjs.
 */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { compareVersions } from "@drycare/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { notFound } from "../lib/errors";

const releaseDir = () => path.resolve(env.RELEASE_DIR ?? path.join(process.cwd(), ".local", "releases"));
const windowsFile = (r: { version: string; architecture: string }) => path.join(releaseDir(), `DryCare-Setup-${r.version}-${r.architecture}.exe`);
const androidDir = () => path.join(releaseDir(), "android");

async function latestWindows() {
  const rows = await db.query.desktopReleases.findMany({ where: and(eq(schema.desktopReleases.channel, "stable"), eq(schema.desktopReleases.packageType, "exe"), eq(schema.desktopReleases.architecture, "x64"), inArray(schema.desktopReleases.status, ["staged", "published"])), orderBy: [desc(schema.desktopReleases.createdAt)] });
  return rows.filter((r) => r.sha256 && existsSync(windowsFile(r))).sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

function latestAndroid(): { version: string; file: string; sizeBytes: number; sha256: string } | null {
  const manifest = path.join(androidDir(), "latest.json");
  if (!existsSync(manifest)) return null;
  try {
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    return existsSync(path.join(androidDir(), path.basename(m.file))) ? { ...m, file: path.basename(m.file) } : null;
  } catch {
    return null;
  }
}

export async function downloadRoutes(app: FastifyInstance) {
  app.get("/commercial/downloads", async () => {
    const win = await latestWindows();
    const android = latestAndroid();
    return {
      trialDays: env.TRIAL_DAYS,
      windows: win ? { version: win.version, sizeBytes: win.sizeBytes, sha256: win.sha256, signed: win.signatureStatus === "valid", url: "/api/v1/commercial/downloads/windows" } : null,
      android: android ? { version: android.version, sizeBytes: android.sizeBytes, sha256: android.sha256, url: "/api/v1/commercial/downloads/android" } : null,
    };
  });

  app.get("/commercial/downloads/windows", async (_req, reply) => {
    const win = await latestWindows();
    if (!win) throw notFound("Windows download");
    reply.header("content-type", "application/octet-stream").header("content-disposition", `attachment; filename="DryCare-Setup-${win.version}.exe"`).header("x-content-type-options", "nosniff");
    if (win.sizeBytes) reply.header("content-length", win.sizeBytes);
    return reply.send(createReadStream(windowsFile(win)));
  });

  app.get("/commercial/downloads/android", async (_req, reply) => {
    const android = latestAndroid();
    if (!android) throw notFound("Android download");
    reply.header("content-type", "application/vnd.android.package-archive").header("content-disposition", `attachment; filename="Drycare-${android.version}.apk"`).header("content-length", android.sizeBytes).header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(path.join(androidDir(), android.file)));
  });
}
