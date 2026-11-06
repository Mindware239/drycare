/**
 * Super admin controls for one customer: which features this shop gets, renewing or changing its plan without a
 * payment record, cancelling it, and the printers and scanners accepted across all customers.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { APP_MODULES, FEATURES, FEATURE_CATEGORIES, FEATURE_KEYS, PLAN_FEATURE_KEYS, resolveFeatures, type FeatureKey, type FeatureOverrideExpiry, type FeatureOverrides } from "@drycare/shared";
import { db, schema } from "../db/client";
import { audit } from "../lib/audit";
import { requirePlatformAdmin } from "../lib/context";
import { FEATURE_REGISTRY_KEY, HARDWARE_POLICY_KEY, branchLimit, featureLocks, featureRegistry, hardwarePolicy, orgFeatures, subscriptionSnapshot, type FeatureRegistry } from "../lib/entitlements";
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
      planFeatures: resolveFeatures(org.status === "trial" ? null : sub?.entitlementsSnapshot ?? plan?.entitlements ?? null),
      // Whether the plan has moved on since this shop bought it.
      olderPlanVersion: Boolean(org.status !== "trial" && sub?.entitlementsSnapshot && plan && FEATURE_KEYS.some((key) => key !== "rfid" && resolveFeatures(sub.entitlementsSnapshot)[key] !== resolveFeatures(plan.entitlements)[key])),
      overrides: org.featureOverrides,
      expiry: org.featureOverrideExpiry,
      effective: await orgFeatures(id),
      locks: await featureLocks(id),
      globallyOff: (await featureRegistry()).globallyOff,
      branches: {
        planLimit: org.status === "trial" ? null : sub?.branchLimitSnapshot ?? plan?.branchLimit ?? null,
        override: org.branchLimitOverride,
        limit: await branchLimit(id),
        active: (await db.$count(schema.branches, and(eq(schema.branches.organizationId, id), eq(schema.branches.status, "active")))),
      },
    };
  });

  // ---- All customers: the list of features, plans, and who has what
  app.get("/platform-admin/features", async (req) => {
    requirePlatformAdmin(req);
    const [registry, allPlans, overrideRows, [counts], [licenses], subs, [lapsedExceptions]] = await Promise.all([
      featureRegistry(),
      db.query.commercialPlans.findMany({ orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise] }),
      db.execute<{ overrides: Record<string, boolean> }>(sql`select o.feature_overrides_json as overrides from organizations o where ${CUSTOMER_ORG} and o.feature_overrides_json <> '{}'::jsonb`),
      db.execute<{ customers: number; trial: number; active: number; suspended: number }>(sql`select count(*)::int as customers, count(*) filter (where o.status = 'trial')::int as trial, count(*) filter (where o.status = 'active')::int as active, count(*) filter (where o.status = 'suspended')::int as suspended from organizations o where ${CUSTOMER_ORG}`),
      db.execute<{ total: number; expired: number }>(sql`select count(*)::int as total, count(*) filter (where expires_at is not null and expires_at <= now())::int as expired from desktop_licenses`),
      db.execute<{ planId: string; snapshot: Record<string, boolean> | null }>(sql`select distinct on (s.organization_id) s.plan_id as "planId", s.entitlements_snapshot_json as snapshot, s.status, s.ends_at from commercial_subscriptions s join organizations o on o.id = s.organization_id where ${CUSTOMER_ORG} order by s.organization_id, s.created_at desc`),
      db.execute<{ n: number }>(sql`select count(*)::int as n from organizations o where ${CUSTOMER_ORG} and exists (select 1 from jsonb_each_text(o.feature_override_expiry_json) e where e.value::timestamptz <= now())`),
    ]);
    const real = allPlans.filter((p) => !/^(smoke|billtest|e2e)-/.test(p.code));
    const published = real.filter((p) => p.published);
    const customRows = [...overrideRows];
    const subRows = [...subs].filter((r) => (r as unknown as { status: string }).status === "active");
    const isOlder = (plan: (typeof real)[number], snapshot: Record<string, boolean> | null) => {
      if (!snapshot) return false;
      const live = resolveFeatures(plan.entitlements) as Record<string, boolean>;
      const bought = resolveFeatures(snapshot) as Record<string, boolean>;
      return FEATURE_KEYS.some((key) => key !== "rfid" && live[key] !== bought[key]);
    };
    const planRows = real.map((p) => {
      const on = subRows.filter((r) => r.planId === p.id);
      return { id: p.id, name: p.name, published: p.published, pricePaise: p.pricePaise, currency: p.currency, interval: p.interval, subscribers: on.length, onOlderVersion: on.filter((r) => isOlder(p, r.snapshot)).length };
    });
    const features = [
      ...FEATURE_KEYS.map((key) => ({
        key, ...FEATURES[key], ...registry.edits[key], custom: false, planManaged: key !== "rfid",
        inPlan: Object.fromEntries(real.map((p) => [p.id, resolveFeatures(p.entitlements)[key]])),
      })),
      ...registry.custom.map((c) => ({ ...c, custom: true, planManaged: true, inPlan: Object.fromEntries(real.map((p) => [p.id, p.entitlements[c.key] === true])) })),
    ].map((f) => ({
      ...f,
      enabled: !registry.globallyOff.includes(f.key),
      upgradeMessage: registry.upgradeMessages[f.key] ?? "",
      allowedFor: customRows.filter((r) => r.overrides[f.key] === true).length,
      blockedFor: customRows.filter((r) => r.overrides[f.key] === false).length,
    }));

    const checks: { status: "ok" | "warn" | "info"; title: string; detail: string }[] = [];
    const add = (status: "ok" | "warn" | "info", title: string, detail: string) => checks.push({ status, title, detail });
    const controlled = APP_MODULES.filter((m) => m.feature).length;
    const unknown = APP_MODULES.filter((m) => m.feature && !FEATURE_KEYS.includes(m.feature));
    add(unknown.length ? "warn" : "ok", "Every screen is accounted for", `${APP_MODULES.length} screens: ${controlled} can be switched off, ${APP_MODULES.length - controlled} are in every plan. The automated tests fail if a new screen is added without being listed.`);
    const inNoPlan = features.filter((f) => f.planManaged && !f.custom && f.enabled && !published.some((p) => f.inPlan[p.id]));
    add(inNoPlan.length ? "warn" : "ok", "Every feature is in a plan on offer", inNoPlan.length ? `Nobody new can buy: ${inNoPlan.map((f) => f.label).join(", ")}.` : "New customers can buy every feature through some plan.");
    add(published.length ? "ok" : "warn", "New customers have a plan to buy", published.length ? `Offered: ${published.map((p) => p.name).join(", ")}.` : "No plan is offered, so new customers cannot subscribe.");
    const hiddenInUse = planRows.filter((p) => !p.published && p.subscribers > 0);
    if (hiddenInUse.length) add("info", "Hidden plans still in use", hiddenInUse.map((p) => `${p.name}: ${p.subscribers} customer${p.subscribers === 1 ? "" : "s"} keep it and can renew`).join(". ") + ".");
    const older = planRows.filter((p) => p.onOlderVersion > 0);
    add(older.length ? "info" : "ok", "Current customers and the latest plans", older.length ? older.map((p) => `${p.name}: ${p.onOlderVersion} customer${p.onOlderVersion === 1 ? " keeps" : "s keep"} what they bought, which differs from the plan today`).join(". ") + "." : "Every current customer has the same features as their plan today.");
    if (registry.globallyOff.length) add("warn", "Switched off for everyone", features.filter((f) => !f.enabled).map((f) => f.label).join(", ") + ".");
    if (lapsedExceptions.n) add("info", "Ended exceptions", `${lapsedExceptions.n} customer${lapsedExceptions.n === 1 ? " has" : "s have"} a temporary exception that has ended. It has stopped applying by itself.`);
    if (registry.custom.length) add("info", "Listed-only features", `${registry.custom.map((c) => c.label).join(", ")} appear on plans and the pricing page, but open or lock no screen.`);
    add("info", "PC licenses do not update by themselves", "A PC works offline, so changes reach it when you renew its license key.");

    return {
      summary: { plans: real.length, activePlans: published.length, ...counts, standaloneLicenses: licenses.total, expiredLicenses: licenses.expired, customersWithExceptions: customRows.length, extraGrants: customRows.reduce((n, r) => n + Object.values(r.overrides).filter(Boolean).length, 0) },
      plans: planRows,
      features,
      modules: APP_MODULES,
      checks,
    };
  });

  const featureBody = z.object({
    label: z.string().trim().min(2, "Enter a name").max(80),
    description: z.string().trim().min(3, "Enter a description").max(400),
    category: z.enum(FEATURE_CATEGORIES),
    enabled: z.boolean().default(true),
    upgradeMessage: z.string().trim().max(400).default(""),
    reason,
  });
  const saveRegistry = async (req: FastifyRequest, userId: string, before: FeatureRegistry, next: FeatureRegistry, detail: object) => {
    await db.transaction(async (tx) => {
      await write(tx, FEATURE_REGISTRY_KEY, next, userId);
      await audit(tx, req, { action: "platform.feature_settings_changed", resourceType: "platform_settings", actorUserId: userId, before, after: { ...next, ...detail } });
    });
  };
  const withSwitches = (registry: FeatureRegistry, key: string, enabled: boolean, message: string): FeatureRegistry => {
    const upgradeMessages = { ...registry.upgradeMessages };
    if (message) upgradeMessages[key] = message;
    else delete upgradeMessages[key];
    return { ...registry, upgradeMessages, globallyOff: enabled ? registry.globallyOff.filter((k) => k !== key) : [...new Set([...registry.globallyOff, key])] };
  };

  /** A feature added by the owner, such as Priority support. It appears on plans, but no screen depends on it. */
  app.post("/platform-admin/features", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = featureBody.parse(req.body);
    const before = await featureRegistry();
    const base = `custom_${body.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "feature"}`;
    const lower = body.label.toLowerCase();
    if (before.custom.some((c) => c.label.toLowerCase() === lower) || FEATURE_KEYS.some((k) => (before.edits[k]?.label ?? FEATURES[k].label).toLowerCase() === lower)) throw conflict(`A feature called ${body.label} already exists.`, "FEATURE_NAME_TAKEN");
    let key = base;
    for (let n = 2; before.custom.some((c) => c.key === key); n++) key = `${base}_${n}`;
    const next = withSwitches({ ...before, custom: [...before.custom, { key, label: body.label, description: body.description, category: body.category }] }, key, body.enabled, body.upgradeMessage);
    await saveRegistry(req, auth.userId, before, next, { added: key, reason: body.reason });
    reply.code(201);
    return { key };
  });

  app.put("/platform-admin/features/:key", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { key } = z.object({ key: z.string().max(80) }).parse(req.params);
    const body = featureBody.parse(req.body);
    const before = await featureRegistry();
    const builtIn = FEATURE_KEYS.includes(key as FeatureKey);
    if (!builtIn && !before.custom.some((c) => c.key === key)) throw notFound("Feature");
    const details = { label: body.label, description: body.description, category: body.category };
    const next = withSwitches(
      builtIn ? { ...before, edits: { ...before.edits, [key]: details } } : { ...before, custom: before.custom.map((c) => (c.key === key ? { ...c, ...details } : c)) },
      key, body.enabled, body.upgradeMessage,
    );
    await saveRegistry(req, auth.userId, before, next, { feature: key, reason: body.reason });
    return next;
  });

  /** Only features the owner added can go: the built-in ones have screens and server rules behind them. */
  app.delete("/platform-admin/features/:key", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { key } = z.object({ key: z.string().max(80) }).parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    const before = await featureRegistry();
    if (!before.custom.some((c) => c.key === key)) throw conflict("Only features you added can be removed. Turn a built-in feature off instead.", "FEATURE_BUILT_IN");
    const next = { ...withSwitches(before, key, true, ""), custom: before.custom.filter((c) => c.key !== key) };
    await saveRegistry(req, auth.userId, before, next, { removed: key, reason: body.reason });
    await db.execute(sql`update commercial_plans set entitlements_json = entitlements_json - ${key}, updated_at = now() where entitlements_json ? ${key}`);
    return { removed: true };
  });

  /** Plan features from the table. New customers always get the change; current customers only if the owner says so. */
  app.put("/platform-admin/features/matrix", async (req) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      changes: z.array(z.object({ planId: z.uuid(), key: z.string().max(80), on: z.boolean() })).min(1).max(2000),
      applyToExisting: z.boolean().default(false),
      reason,
    }).parse(req.body);
    const registry = await featureRegistry();
    for (const c of body.changes) {
      if (c.key === "rfid") throw conflict("The RFID module is sold separately, not through plans.", "FEATURE_NOT_IN_PLANS");
      if (!FEATURE_KEYS.includes(c.key as FeatureKey) && !registry.custom.some((f) => f.key === c.key)) throw notFound(`Feature ${c.key}`);
    }
    const byPlan = new Map<string, Record<string, boolean>>();
    for (const c of body.changes) byPlan.set(c.planId, { ...byPlan.get(c.planId), [c.key]: c.on });
    let updatedCustomers = 0;
    await db.transaction(async (tx) => {
      for (const [planId, entries] of byPlan) {
        const plan = await tx.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, planId) });
        if (!plan) throw notFound("Plan");
        await tx.update(schema.commercialPlans).set({ entitlements: { ...plan.entitlements, ...entries }, updatedAt: new Date() }).where(eq(schema.commercialPlans.id, planId));
        if (body.applyToExisting) {
          const rows = await tx.execute<{ id: string }>(sql`update commercial_subscriptions set entitlements_snapshot_json = coalesce(entitlements_snapshot_json, '{}'::jsonb) || ${JSON.stringify(entries)}::jsonb, updated_at = now() where plan_id = ${planId} and status in ('active', 'past_due') returning id`);
          updatedCustomers += [...rows].length;
        }
        await audit(tx, req, { action: "platform.plan_features_changed", resourceType: "commercial_plan", resourceId: planId, actorUserId: auth.userId, before: plan.entitlements, after: { entries, applyToExisting: body.applyToExisting, reason: body.reason } });
      }
    });
    return { updatedCustomers };
  });

  /** One customer moves to what their plan includes today. */
  app.post("/platform-admin/organizations/:id/subscription/latest-features", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    await customerOrg(id);
    const sub = await db.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, id), orderBy: [desc(schema.commercialSubscriptions.createdAt)] });
    const plan = sub && (await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub.planId) }));
    if (!sub || !plan) throw conflict("This business has no plan.", "NO_ACTIVE_SUBSCRIPTION");
    await db.transaction(async (tx) => {
      await tx.update(schema.commercialSubscriptions).set({ ...subscriptionSnapshot(plan), updatedAt: new Date() }).where(eq(schema.commercialSubscriptions.id, sub.id));
      await audit(tx, req, { action: "platform.subscription_features_updated", resourceType: "commercial_subscription", resourceId: sub.id, orgId: id, actorUserId: auth.userId, before: sub.entitlementsSnapshot, after: { plan: plan.code, reason: body.reason } });
    });
    return { effective: await orgFeatures(id) };
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
        [subscription] = await tx.insert(schema.commercialSubscriptions).values({ organizationId: id, planId: plan.id, status: "active", provider: "manual_admin", startsAt: now, endsAt, ...subscriptionSnapshot(plan) }).returning();
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
