/**
 * Super admin controls for one customer: which features this shop gets, renewing or changing its plan without a
 * payment record, cancelling it, and the printers and scanners accepted across all customers.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { FEATURES, FEATURE_KEYS, PLAN_FEATURE_KEYS, resolveFeatures, type FeatureKey, type FeatureOverrideExpiry, type FeatureOverrides } from "@drycare/shared";
import { db, schema } from "../db/client";
import { audit } from "../lib/audit";
import { requirePlatformAdmin } from "../lib/context";
import { FEATURE_REGISTRY_KEY, HARDWARE_POLICY_KEY, branchLimit, featureLocks, featureRegistry, hardwarePolicy, orgFeatures } from "../lib/entitlements";
import { conflict, notFound } from "../lib/errors";
import { write } from "../lib/platformSettings";
import { CUSTOMER_ORG } from "./platformConsole";

const reason = z.string().trim().min(8, "Give a reason (at least 8 characters)").max(500);
const models = z.array(z.string().trim().min(2).max(120)).max(200).transform((list) => [...new Set(list)]);

async function customerOrg(id: string) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
  if (!org || org.settings.platformInternal) throw notFound("Customer organization");
  return org;
}

export async function platformEntitlementRoutes(app: FastifyInstance) {
  app.get("/platform-admin/organizations/:id/entitlements", async (req) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const org = await customerOrg(id);
    const sub = await db.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, id), orderBy: [desc(schema.commercialSubscriptions.createdAt)] });
    const plan = sub && await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub.planId) });
    return {
      plan: plan ? { id: plan.id, name: plan.name, status: sub!.status, endsAt: sub!.endsAt } : null,
      // What the plan alone gives, so the screen can show when an exception changes it.
      planFeatures: resolveFeatures(org.status === "trial" ? null : plan?.entitlements ?? null),
      overrides: org.featureOverrides,
      expiry: org.featureOverrideExpiry,
      effective: await orgFeatures(id),
      locks: await featureLocks(id),
      globallyOff: (await featureRegistry()).globallyOff,
      branches: {
        planLimit: org.status === "trial" ? null : plan?.branchLimit ?? null,
        override: org.branchLimitOverride,
        limit: await branchLimit(id),
        active: (await db.$count(schema.branches, and(eq(schema.branches.organizationId, id), eq(schema.branches.status, "active")))),
      },
    };
  });

  // ---- All customers: the list of features, the global switch, and who has what
  app.get("/platform-admin/features", async (req) => {
    requirePlatformAdmin(req);
    const [registry, plans, overrideRows, [counts], [licenses]] = await Promise.all([
      featureRegistry(),
      db.query.commercialPlans.findMany({ columns: { id: true, name: true, code: true, published: true, entitlements: true }, orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise] }),
      db.execute<{ overrides: Record<string, boolean> }>(sql`select o.feature_overrides_json as overrides from organizations o where ${CUSTOMER_ORG} and o.feature_overrides_json <> '{}'::jsonb`),
      db.execute<{ customers: number; trial: number; active: number; suspended: number }>(sql`select count(*)::int as customers, count(*) filter (where o.status = 'trial')::int as trial, count(*) filter (where o.status = 'active')::int as active, count(*) filter (where o.status = 'suspended')::int as suspended from organizations o where ${CUSTOMER_ORG}`),
      db.execute<{ total: number; expired: number }>(sql`select count(*)::int as total, count(*) filter (where expires_at is not null and expires_at <= now())::int as expired from desktop_licenses`),
    ]);
    const real = plans.filter((p) => !/^(smoke|billtest)-/.test(p.code));
    const published = real.filter((p) => p.published);
    const customRows = [...overrideRows];
    return {
      summary: {
        plans: real.length,
        activePlans: published.length,
        ...counts,
        standaloneLicenses: licenses.total,
        expiredLicenses: licenses.expired,
        customersWithExceptions: customRows.length,
        extraGrants: customRows.reduce((n, r) => n + Object.values(r.overrides).filter(Boolean).length, 0),
      },
      features: FEATURE_KEYS.map((key) => ({
        key,
        ...FEATURES[key],
        enabled: !registry.globallyOff.includes(key),
        upgradeMessage: registry.upgradeMessages[key] ?? "",
        plans: published.filter((p) => resolveFeatures(p.entitlements)[key]).map((p) => p.name),
        allowedFor: customRows.filter((r) => r.overrides[key] === true).length,
        blockedFor: customRows.filter((r) => r.overrides[key] === false).length,
      })),
    };
  });

  app.put("/platform-admin/features/:key", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { key } = z.object({ key: z.enum(FEATURE_KEYS as [string, ...string[]]) }).parse(req.params);
    const body = z.object({ enabled: z.boolean(), upgradeMessage: z.string().trim().max(400).default(""), reason }).parse(req.body);
    const before = await featureRegistry();
    const globallyOff = body.enabled ? before.globallyOff.filter((k) => k !== key) : [...new Set([...before.globallyOff, key])];
    const upgradeMessages = { ...before.upgradeMessages };
    if (body.upgradeMessage) upgradeMessages[key] = body.upgradeMessage;
    else delete upgradeMessages[key];
    const next = { globallyOff, upgradeMessages };
    await db.transaction(async (tx) => {
      await write(tx, FEATURE_REGISTRY_KEY, next, auth.userId);
      await audit(tx, req, { action: "platform.feature_settings_changed", resourceType: "platform_settings", resourceId: undefined, actorUserId: auth.userId, before, after: { ...next, feature: key, reason: body.reason } });
    });
    return next;
  });

  app.put("/platform-admin/organizations/:id/entitlements", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      overrides: z.partialRecord(z.enum(PLAN_FEATURE_KEYS as [string, ...string[]]), z.boolean()),
      /** The last day of a temporary exception. Left out, an exception lasts until it is changed. */
      expires: z.partialRecord(z.enum(PLAN_FEATURE_KEYS as [string, ...string[]]), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")).optional(),
      /** Left out = keep as it is. Null = go back to what the plan says. */
      branchLimit: z.number().int().min(1).max(1000).nullable().optional(),
      reason,
    }).parse(req.body);
    const before = await customerOrg(id);
    const overrides = body.overrides as FeatureOverrides;
    const featureOverrideExpiry: FeatureOverrideExpiry = {};
    for (const [key, day] of Object.entries(body.expires ?? {})) {
      const until = new Date(`${day}T23:59:59.999+05:30`);
      if (!(key in overrides)) continue;
      if (until.getTime() <= Date.now()) throw conflict(`The end date for ${FEATURES[key as FeatureKey].label} must be in the future.`, "END_DATE_IN_PAST");
      featureOverrideExpiry[key as FeatureKey] = until.toISOString();
    }
    const branchLimitOverride = body.branchLimit === undefined ? before.branchLimitOverride : body.branchLimit;
    await db.transaction(async (tx) => {
      await tx.update(schema.organizations).set({ featureOverrides: overrides, featureOverrideExpiry, branchLimitOverride, updatedAt: new Date() }).where(eq(schema.organizations.id, id));
      await audit(tx, req, { action: "platform.features_changed", resourceType: "organization", resourceId: id, orgId: id, actorUserId: auth.userId, before: { overrides: before.featureOverrides, expiry: before.featureOverrideExpiry, branchLimit: before.branchLimitOverride }, after: { overrides, branchLimit: branchLimitOverride, reason: body.reason } });
    });
    return { overrides, effective: await orgFeatures(id) };
  });

  /** Renew, extend or change a plan without recording a payment, e.g. for a complimentary period or an agreed extension. */
  app.post("/platform-admin/organizations/:id/subscription", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ planId: z.uuid(), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason }).parse(req.body);
    const org = await customerOrg(id);
    const plan = await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, body.planId) });
    if (!plan) throw notFound("Plan");
    const endsAt = new Date(`${body.endsOn}T23:59:59.999+05:30`);
    if (endsAt.getTime() <= Date.now()) throw conflict("The end date must be in the future.", "END_DATE_IN_PAST");
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const latest = await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, id), orderBy: [desc(schema.commercialSubscriptions.createdAt)] });
      let subscription;
      if (latest?.planId === plan.id) {
        [subscription] = await tx.update(schema.commercialSubscriptions).set({ status: "active", endsAt, cancelAt: null, canceledAt: null, updatedAt: now })
          .where(eq(schema.commercialSubscriptions.id, latest.id)).returning();
      } else {
        if (latest) {
          await tx.update(schema.commercialSubscriptions).set({ status: "canceled", canceledAt: now, updatedAt: now }).where(eq(schema.commercialSubscriptions.id, latest.id));
        }
        [subscription] = await tx.insert(schema.commercialSubscriptions).values({ organizationId: id, planId: plan.id, status: "active", provider: "manual_admin", startsAt: now, endsAt }).returning();
      }
      // A suspended account stays suspended: reactivating it is a separate, deliberate action.
      if (org.status === "trial") await tx.update(schema.organizations).set({ status: "active", updatedAt: now }).where(eq(schema.organizations.id, id));
      await audit(tx, req, {
        action: latest?.planId === plan.id ? "platform.subscription_renewed" : "platform.subscription_plan_changed",
        resourceType: "commercial_subscription", resourceId: subscription.id, orgId: id, actorUserId: auth.userId,
        before: latest ? { planId: latest.planId, status: latest.status, endsAt: latest.endsAt } : null,
        after: { plan: plan.code, endsAt, reason: body.reason },
      });
      return subscription;
    });
    reply.code(201);
    return result;
  });

  /** Stops the plan now. The shop stays signed in, read-only, and can pay again; nothing is deleted or refunded. */
  app.post("/platform-admin/organizations/:id/subscription/cancel", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    await customerOrg(id);
    const now = new Date();
    return db.transaction(async (tx) => {
      const latest = await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, id), orderBy: [desc(schema.commercialSubscriptions.createdAt)] });
      if (!latest || latest.status === "canceled") throw conflict("This business has no plan to cancel.", "NO_ACTIVE_SUBSCRIPTION");
      const [subscription] = await tx.update(schema.commercialSubscriptions).set({ status: "canceled", canceledAt: now, endsAt: now, updatedAt: now }).where(eq(schema.commercialSubscriptions.id, latest.id)).returning();
      await audit(tx, req, { action: "platform.subscription_cancelled", resourceType: "commercial_subscription", resourceId: latest.id, orgId: id, actorUserId: auth.userId, before: { status: latest.status, endsAt: latest.endsAt }, after: { status: "canceled", reason: body.reason } });
      return subscription;
    });
  });

  app.get("/platform-admin/hardware", async (req) => {
    requirePlatformAdmin(req);
    return hardwarePolicy();
  });

  app.put("/platform-admin/hardware", async (req) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({ printers: models.default([]), scanners: models, rfidReaders: models.default([]), requireDevices: z.boolean().default(true), driverUrl: z.url("Enter a full web link").max(500).nullable().optional().or(z.literal("").transform(() => null)) }).parse(req.body);
    const before = await hardwarePolicy();
    await db.transaction(async (tx) => {
      await write(tx, HARDWARE_POLICY_KEY, body, auth.userId);
      await audit(tx, req, { action: "platform.hardware_policy_changed", resourceType: "platform_settings", actorUserId: auth.userId, before, after: body });
    });
    return body;
  });
}
