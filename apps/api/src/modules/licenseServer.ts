/**
 * Remote control of PC licenses. A PC checks in here when it has internet (lib/licenseSync.ts); the reply is signed with
 * the licensing key and carries any newer key. Suspending, revoking, renewing or changing features therefore reaches a
 * PC at its next successful check-in, never before: a PC that stays offline cannot receive a command.
 */
import type { FastifyInstance } from "fastify";
import { createPrivateKey, sign } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveFeatures, type LicenseStatusToken } from "@drycare/shared";
import { db, schema } from "../db/client";
import { audit } from "../lib/audit";
import { requirePlatformAdmin } from "../lib/context";
import { featureRegistry, rfidModuleActive } from "../lib/entitlements";
import { AppError, conflict, notFound } from "../lib/errors";
import { verifySignedLicense } from "../lib/license";
import { openSecret } from "../lib/secretBox";
import { issueKey, signingKey } from "./platformLicenses";
import { soldPrintersFor } from "./printerRegistry";

const reason = z.string().trim().min(8, "Give a reason (at least 8 characters)").max(500);
type License = typeof schema.desktopLicenses.$inferSelect;

async function headOf(id: string): Promise<License | null> {
  let row = (await db.query.desktopLicenses.findFirst({ where: eq(schema.desktopLicenses.id, id) })) ?? null;
  for (let i = 0; row?.supersededBy && i < 100; i++) row = (await db.query.desktopLicenses.findFirst({ where: eq(schema.desktopLicenses.id, row.supersededBy) })) ?? row;
  return row;
}

/** Every key in this license's history, newest last. Devices may check in with any of them. */
async function chainIds(head: License) {
  const rows = await db.select({ id: schema.desktopLicenses.id, next: schema.desktopLicenses.supersededBy }).from(schema.desktopLicenses).where(and(eq(schema.desktopLicenses.customerName, head.customerName)));
  const ids = [head.id];
  for (let current = head.id, i = 0; i < 100; i++) {
    const prev = rows.find((r) => r.next === current);
    if (!prev) break;
    ids.push(prev.id);
    current = prev.id;
  }
  return ids;
}

/** If this customer's plan, exceptions or devices sold have changed, the signed key must change with them. */
async function latestKey(head: License, k: NonNullable<Awaited<ReturnType<typeof signingKey>>>, req: Parameters<typeof issueKey>[0]) {
  const current = verifySignedLicense(head.key, k.publicKeyPem, Date.now());
  if (!current) return head;
  const org = head.organizationId ? await db.query.organizations.findFirst({ where: eq(schema.organizations.id, head.organizationId) }) : undefined;
  if (!org) return head;
  const sub = await db.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, org.id), orderBy: [desc(schema.commercialSubscriptions.createdAt)] });
  const active = sub?.status === "active";
  const plan = active ? await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub!.planId) }) : undefined;
  const planChanged = Boolean(plan && plan.name !== head.plan);
  const base = planChanged ? sub!.entitlementsSnapshot ?? plan!.entitlements : head.boughtFeatures ?? current.features ?? null;
  const { globallyOff } = await featureRegistry();
  const features = { ...resolveFeatures(base, org.featureOverrides, { expiry: org.featureOverrideExpiry, globallyOff }), rfid: current.features?.rfid === true || (await rfidModuleActive(org.id)) };
  // A payment that runs past this key's end date extends it. Being offline never does.
  const paidUntil = active && sub?.endsAt ? sub.endsAt.toISOString() : null;
  const expiresAt = current.expiresAt && paidUntil && Date.parse(paidUntil) > Date.parse(current.expiresAt) ? paidUntil : current.expiresAt;
  const bySerial = (list: { serial: string }[] | undefined) => JSON.stringify([...(list ?? [])].map((p) => p.serial).sort());
  const sold = await soldPrintersFor(org.id, head.customerName);
  const same = !planChanged && expiresAt === current.expiresAt
    && (!current.features || JSON.stringify(sorted(features)) === JSON.stringify(sorted(resolveFeatures(current.features))))
    && bySerial(sold) === bySerial(current.hardware?.soldPrinters);
  if (same) return head;
  return issueKey(req, k, head.issuedBy, {
    organizationId: head.organizationId ?? undefined, customerName: head.customerName, plan: plan?.name ?? head.plan, expiresAt, installationIds: head.installationIds, note: head.note ?? undefined,
    features, bought: planChanged ? base : head.boughtFeatures ?? current.features ?? null, limits: planChanged ? { branches: sub!.branchLimitSnapshot ?? plan!.branchLimit } : current.limits, renewalOf: head.id, automatic: true,
  }).then(async () => (await headOf(head.id))!);
}
const sorted = (o: Record<string, boolean>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "rfid").sort(([a], [b]) => a.localeCompare(b)));

export async function licenseServerRoutes(app: FastifyInstance) {
  // ---- The PC checks in. It proves itself with its signed key, which only names the PCs it was issued for.
  app.post("/license/sync", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({
      key: z.string().trim().min(10).max(20_000),
      installationId: z.uuid(),
      nonce: z.uuid(),
      appVersion: z.string().trim().max(40).default("unknown"),
      usage: z.array(z.object({ feature: z.string().max(80), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().min(0).max(100_000_000) })).max(5000).default([]),
    }).parse(req.body);
    const k = await signingKey();
    if (!k) throw new AppError(503, "LICENSING_NOT_READY", "Licensing is not set up on this server.");
    const shown = verifySignedLicense(body.key, k.publicKeyPem);
    if (!shown || !shown.installationIds.includes(body.installationId)) throw new AppError(401, "LICENSE_NOT_RECOGNISED", "This key does not match this PC.");

    const reply = async (status: LicenseStatusToken["status"], licenseId: string, extra: { key?: string; reason?: string | null } = {}) => {
      const payload: LicenseStatusToken = { version: 1, nonce: body.nonce, installationId: body.installationId, licenseId, status, reason: extra.reason ?? null, key: extra.key, serverTime: new Date().toISOString() };
      const bytes = Buffer.from(JSON.stringify(payload));
      await db.insert(schema.licenseSyncEvents).values({ installationId: body.installationId, licenseId, result: extra.key && extra.key !== body.key ? `${status}+new_key` : status, appVersion: body.appVersion }).catch(() => {});
      return { token: `DRYCARESTATUS1.${bytes.toString("base64url")}.${sign(null, bytes, createPrivateKey(openSecret(k.privateKeySealed))).toString("base64url")}` };
    };

    const first = await db.query.desktopLicenses.findFirst({ where: eq(schema.desktopLicenses.id, shown.licenseId) });
    // A key issued outside this register (by the command line tool) cannot be managed from here.
    if (!first) return reply("active", shown.licenseId);
    let head = (await headOf(first.id))!;

    const now = new Date();
    const [device] = await db.insert(schema.licenseInstallations)
      .values({ installationId: body.installationId, licenseId: head.id, organizationId: head.organizationId, customerName: head.customerName, appVersion: body.appVersion, lastSyncAt: now })
      .onConflictDoUpdate({ target: schema.licenseInstallations.installationId, set: { licenseId: head.id, organizationId: head.organizationId, customerName: head.customerName, appVersion: body.appVersion, lastSyncAt: now } })
      .returning();
    if (head.organizationId && body.usage.length) {
      for (const u of body.usage) {
        await db.insert(schema.featureUsageDaily).values({ organizationId: head.organizationId, feature: u.feature, day: u.day, count: u.count })
          .onConflictDoUpdate({ target: [schema.featureUsageDaily.organizationId, schema.featureUsageDaily.feature, schema.featureUsageDaily.day], set: { count: sql`${schema.featureUsageDaily.count} + ${u.count}` } });
      }
    }
    if (device.status === "deactivated") return reply("deactivated", head.id, { reason: device.statusReason });
    if (head.status === "suspended" || head.status === "revoked") return reply(head.status, head.id, { reason: head.statusReason });
    if (!head.installationIds.includes(body.installationId)) return reply("deactivated", head.id, { reason: "This PC is no longer on the license." });
    head = await latestKey(head, k, req);
    return reply("active", head.id, { key: head.key === body.key ? undefined : head.key });
  });

  // ---- The owner
  app.get("/platform-admin/licenses/:id/detail", async (req) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const head = await headOf(id);
    if (!head) throw notFound("License");
    const k = await signingKey();
    const ids = await chainIds(head);
    const [devices, events, history] = await Promise.all([
      db.select().from(schema.licenseInstallations).where(inArray(schema.licenseInstallations.licenseId, ids)).orderBy(desc(schema.licenseInstallations.lastSyncAt)),
      db.select().from(schema.licenseSyncEvents).where(inArray(schema.licenseSyncEvents.licenseId, ids)).orderBy(desc(schema.licenseSyncEvents.createdAt)).limit(50),
      db.execute(sql`select a.id, a.action, a.created_at as "createdAt", a.after_json as after, u.name as "actor" from audit_logs a left join users u on u.id = a.actor_user_id where a.resource_type = 'desktop_license' and a.resource_id::text = any(${sql.raw(`array[${ids.map((x) => `'${x}'`).join(",")}]::text[]`)}) order by a.created_at desc limit 50`),
    ]);
    const known = new Set(devices.map((d) => d.installationId));
    return {
      license: { ...head, key: undefined },
      key: head.key,
      payload: k ? verifySignedLicense(head.key, k.publicKeyPem) : null,
      devices,
      // PCs on the key that have never checked in.
      neverSeen: head.installationIds.filter((x) => !known.has(x)),
      events,
      history: [...history],
    };
  });

  /** Reaches a PC at its next successful check-in. */
  app.post("/platform-admin/licenses/:id/status", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["active", "suspended", "revoked"]), reason }).parse(req.body);
    const head = await headOf(id);
    if (!head) throw notFound("License");
    return db.transaction(async (tx) => {
      const [row] = await tx.update(schema.desktopLicenses).set({ status: body.status, statusReason: body.status === "active" ? null : body.reason }).where(eq(schema.desktopLicenses.id, head.id)).returning();
      await audit(tx, req, { action: `platform.desktop_license_${body.status === "active" ? "reactivated" : body.status}`, resourceType: "desktop_license", resourceId: head.id, orgId: head.organizationId ?? undefined, actorUserId: auth.userId, before: { status: head.status }, after: { status: body.status, reason: body.reason } });
      return { ...row, key: undefined };
    });
  });

  /** One PC on a license stops, the others carry on. */
  app.post("/platform-admin/license-devices/:installationId/status", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { installationId } = z.object({ installationId: z.uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["active", "deactivated"]), licenseId: z.uuid(), reason }).parse(req.body);
    const head = await headOf(body.licenseId);
    if (!head) throw notFound("License");
    if (!head.installationIds.includes(installationId)) throw conflict("This PC is not on this license.", "DEVICE_NOT_ON_LICENSE");
    await db.transaction(async (tx) => {
      await tx.insert(schema.licenseInstallations)
        .values({ installationId, licenseId: head.id, organizationId: head.organizationId, customerName: head.customerName, status: body.status, statusReason: body.status === "active" ? null : body.reason })
        .onConflictDoUpdate({ target: schema.licenseInstallations.installationId, set: { status: body.status, statusReason: body.status === "active" ? null : body.reason } });
      await audit(tx, req, { action: `platform.license_device_${body.status}`, resourceType: "desktop_license", resourceId: head.id, orgId: head.organizationId ?? undefined, actorUserId: auth.userId, after: { installationId, reason: body.reason } });
    });
    return { ok: true };
  });

  /** Features, offline period and what happens at expiry, for this license. Issues a new signed key, picked up at the next check-in. */
  app.put("/platform-admin/licenses/:id/terms", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      licenseType: z.enum(["subscription", "standalone", "lifetime", "annual", "monthly", "enterprise", "trial"]).optional(),
      offlineGraceDays: z.number().int().min(1).max(3650).nullable().optional(),
      expiryPolicy: z.enum(["read_only", "locked"]).optional(),
      features: z.record(z.string().max(80), z.boolean()).optional(),
      reason,
    }).parse(req.body);
    const k = await signingKey();
    if (!k) throw conflict("Create the signing key first.", "SIGNING_KEY_MISSING");
    const head = await headOf(id);
    if (!head) throw notFound("License");
    const current = verifySignedLicense(head.key, k.publicKeyPem);
    if (!current) throw conflict("This license's key cannot be read with the current signing key.", "KEY_UNREADABLE");
    const issued = await issueKey(req, k, auth.userId, {
      organizationId: head.organizationId ?? undefined, customerName: head.customerName, plan: head.plan, expiresAt: current.expiresAt, installationIds: head.installationIds, note: body.reason,
      features: body.features ? { ...current.features, ...body.features } : current.features, bought: body.features ? { ...(head.boughtFeatures ?? current.features), ...body.features } : undefined, limits: current.limits, renewalOf: head.id,
      licenseType: body.licenseType, offlineGraceDays: body.offlineGraceDays === undefined ? undefined : body.offlineGraceDays, expiryPolicy: body.expiryPolicy,
    });
    reply.code(201);
    return { id: issued.id };
  });
}
