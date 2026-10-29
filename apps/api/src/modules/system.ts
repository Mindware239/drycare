import type { FastifyInstance } from "fastify";
import os from "node:os";
import { hash } from "@node-rs/argon2";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, sqlClient } from "../db/client";
import { env, isDesktop } from "../env";
import { requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { createBackup, listBackups } from "../lib/backup";
import { activateDesktopLicense, getLicenseStatus } from "../lib/license";
import { emailConfigured, emailFrom, emailProvider } from "../lib/mailer";

/** Adapters that phones on the shop Wi-Fi can never reach (Docker/WSL/Hyper-V/VM/VPN). Listing them only confuses owners. */
const VIRTUAL_ADAPTER = /vEthernet|WSL|Docker|Hyper-V|VirtualBox|VMware|Loopback|Bluetooth|TAP|Tailscale|ZeroTier/i;

export function lanUrls(port: number) {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((i) => i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")).map((i) => ({ name, address: i.address })));
  const real = all.filter((a) => !VIRTUAL_ADAPTER.test(a.name));
  return (real.length ? real : all).map((a) => `http://${a.address}:${port}`);
}

export function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

const desktopOnly = () => {
  if (!isDesktop || !env.BACKUP_DIR) throw new AppError(404, "NOT_FOUND", "Not available in this edition");
};

export async function systemRoutes(app: FastifyInstance) {
  /** Public: lets the sign-in screen decide whether to show first-time setup. */
  app.get("/system/info", async () => {
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from organizations`);
    return {
      edition: env.DRYCARE_MODE,
      version: env.APP_VERSION,
      setupRequired: isDesktop && n === 0,
      allowSignup: !isDesktop || n === 0,
      license: getLicenseStatus(),
      lanAccess: isDesktop && env.API_HOST === "0.0.0.0",
      lanUrls: isDesktop && env.API_HOST === "0.0.0.0" ? lanUrls(env.API_PORT) : [],
    };
  });

  app.get("/system/license/status", async () => getLicenseStatus());

  app.post(
    "/system/license/activate",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 hour",
          keyGenerator: (req) => req.raw.socket.remoteAddress ?? "unknown",
        },
      },
    },
    async (req) => {
      if (!isDesktop || !env.LICENSE_ENFORCED || !isLoopbackAddress(req.raw.socket.remoteAddress)) {
        throw new AppError(404, "NOT_FOUND", "License activation is only available on the DryCare PC");
      }
      const body = z.object({ key: z.string().trim().min(1).max(20_000) }).parse(req.body);
      return activateDesktopLicense(body.key);
    },
  );

  app.get("/system/integrations", async (req) => {
    requirePermission(req, "org.manage");
    const emailProviderConfigured = emailConfigured();
    return {
      emailProviderConfigured,
      emailProvider: emailProvider(),
      senderEmail: emailFrom(),
      approvalOtpConfigured: emailProviderConfigured && Boolean(env.CUSTOMER_APPROVAL_SECRET),
      marketingEmailConfigured: emailProviderConfigured && Boolean(env.MARKETING_UNSUBSCRIBE_SECRET),
    };
  });

  app.post(
    "/system/desktop-owner-recovery",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "10 minutes",
          keyGenerator: (req) => req.raw.socket.remoteAddress ?? "unknown",
        },
      },
    },
    async (req) => {
      if (!isDesktop || !isLoopbackAddress(req.raw.socket.remoteAddress)) {
        throw new AppError(404, "NOT_FOUND", "Not available from this device");
      }
      const body = z.object({
        email: z.email().toLowerCase(),
        password: z.string().min(10).max(200),
      }).parse(req.body);
      const passwordHash = await hash(body.password);

      const recovery = await db.transaction(async (tx) => {
        const [owner] = await tx
          .select({
            id: schema.users.id,
            organizationId: schema.memberships.organizationId,
            email: schema.users.email,
          })
          .from(schema.users)
          .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
          .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
          .where(and(
            eq(schema.users.email, body.email),
            eq(schema.users.status, "active"),
            eq(schema.memberships.status, "active"),
            eq(schema.roles.key, "owner"),
          ))
          .limit(1)
          .for("update");
        if (!owner) throw new AppError(404, "OWNER_ACCOUNT_NOT_FOUND", "No active owner account matches that email on this PC");

        await tx.update(schema.users)
          .set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(schema.users.id, owner.id));
        await tx.update(schema.sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.sessions.userId, owner.id), sql`${schema.sessions.revokedAt} is null`));
        await audit(tx, req, {
          action: "desktop.owner_password_recovered",
          resourceType: "user",
          resourceId: owner.id,
          orgId: owner.organizationId,
          after: { email: owner.email, sessionsRevoked: true },
        });
        return { email: owner.email };
      });

      return { ok: true, email: recovery.email };
    },
  );

  app.get("/system/backups", async (req) => {
    requirePermission(req, "org.manage");
    desktopOnly();
    return { folder: env.BACKUP_DIR, items: (await listBackups(env.BACKUP_DIR!)).slice(0, 50) };
  });

  app.post("/system/backups", async (req, reply) => {
    requirePermission(req, "org.manage");
    desktopOnly();
    const info = await createBackup(sqlClient, env.BACKUP_DIR!, { appVersion: env.APP_VERSION, kind: "manual" });
    await audit(db, req, { action: "system.backup_created", resourceType: "backup", resourceId: info.name, after: { sizeBytes: info.sizeBytes, rows: info.rows } });
    reply.code(201);
    return info;
  });
}
