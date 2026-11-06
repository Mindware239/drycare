/**
 * What a shop may use. In the cloud that comes from its plan plus the software owner's exceptions for that shop.
 * A PC works offline, so there it comes from the signed license key. Features are enforced here on the server;
 * the web screens only hide what the server would refuse anyway.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { activeOverride, allFeatures, FEATURE_KEYS, planSnapshot, resolveFeatures, type FeatureCategory, type FeatureKey, type FeatureLock, type FeatureMap, FEATURES } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { isDesktop } from "../env";
import { AppError } from "./errors";
import { licenseGrants } from "./license";

export type SoldPrinter = { serial: string; bill: string; model: string; kind?: "printer" | "scanner" };
export type HardwarePolicy = { printers: string[]; scanners: string[]; rfidReaders: string[]; driverUrl: string | null; soldPrinters?: SoldPrinter[]; /** Paying shops must connect a registered printer and scanner. On unless switched off. */ requireDevices?: boolean };
export const HARDWARE_POLICY_KEY = "hardware_policy";
export const FEATURE_REGISTRY_KEY = "feature_registry";
export type CustomFeature = { key: string; label: string; description: string; category: FeatureCategory };
export type FeatureEdit = Partial<Pick<CustomFeature, "label" | "description" | "category">>;
export type FeatureRegistry = { globallyOff: string[]; upgradeMessages: Record<string, string>; custom: CustomFeature[]; edits: Record<string, FeatureEdit> };

/** What a plan is frozen to when a shop buys it. */
export const subscriptionSnapshot = (plan: { entitlements: Record<string, boolean>; branchLimit: number }) => ({ entitlementsSnapshot: planSnapshot(plan.entitlements), branchLimitSnapshot: plan.branchLimit });

/** The software owner's settings over all customers: features switched off everywhere, and their upgrade wording. */
export async function featureRegistry(tx: DbOrTx = db): Promise<FeatureRegistry> {
  const row = await tx.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, FEATURE_REGISTRY_KEY) });
  const value = (row?.value ?? {}) as Partial<FeatureRegistry>;
  return { globallyOff: value.globallyOff ?? [], upgradeMessages: value.upgradeMessages ?? {}, custom: value.custom ?? [], edits: value.edits ?? {} };
}

/** Whether this shop has a paid period of the RFID module running now. */
export async function rfidModuleActive(orgId: string, tx: DbOrTx = db) {
  const [row] = await tx.select({ id: schema.organizationAddons.id }).from(schema.organizationAddons)
    .where(and(eq(schema.organizationAddons.organizationId, orgId), eq(schema.organizationAddons.addon, "rfid"), eq(schema.organizationAddons.status, "active"), sql`${schema.organizationAddons.endsAt} > now()`, sql`${schema.organizationAddons.startsAt} <= now()`)).limit(1);
  return !!row;
}

export async function orgFeatures(orgId: string, tx: DbOrTx = db): Promise<FeatureMap> {
  const features = await planFeatures(orgId, tx);
  if (isDesktop) return features;
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { settings: true } });
  if (!org || org.settings.platformInternal || org.settings.syncSource === "device") return features;
  // Sold separately, so a plan, a trial or an exception never includes it.
  const { globallyOff } = await featureRegistry(tx);
  return { ...features, rfid: !globallyOff.includes("rfid") && (await rfidModuleActive(orgId, tx)) };
}

async function planFeatures(orgId: string, tx: DbOrTx): Promise<FeatureMap> {
  if (isDesktop) {
    const fromKey = licenseGrants()?.features;
    return fromKey ? resolveFeatures(fromKey) : allFeatures();
  }
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { status: true, settings: true, featureOverrides: true, featureOverrideExpiry: true } });
  if (!org || org.settings.platformInternal) return allFeatures();
  // The cloud copy of a shop PC is view-only and must be able to show everything the PC uploads.
  if (org.settings.syncSource === "device") return allFeatures();
  const rules = { expiry: org.featureOverrideExpiry, globallyOff: (await featureRegistry(tx)).globallyOff };
  // A trial shows everything, so a shop can judge the higher plans before choosing one.
  if (org.status === "trial") return resolveFeatures(null, org.featureOverrides, rules);
  const sub = await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)], columns: { planId: true, entitlementsSnapshot: true } });
  if (!sub) return resolveFeatures(null, org.featureOverrides, rules);
  // What this shop bought, whatever the plan has become since.
  if (sub.entitlementsSnapshot) return resolveFeatures(sub.entitlementsSnapshot, org.featureOverrides, rules);
  const plan = await tx.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub.planId), columns: { entitlements: true } });
  return resolveFeatures(plan?.entitlements ?? null, org.featureOverrides, rules);
}

export const hasFeature = async (orgId: string, feature: FeatureKey, tx: DbOrTx = db) => (await orgFeatures(orgId, tx))[feature];

export const featureRefused = (feature: FeatureKey, lock?: FeatureLock) => {
  const label = FEATURES[feature].label;
  if (lock?.reason === "admin") return new AppError(403, "FEATURE_DISABLED", `${label} has been turned off for your business. Contact Drycare support.`, [{ feature }]);
  if (lock?.reason === "global") return new AppError(403, "FEATURE_UNAVAILABLE", `${label} is not available at the moment.`, [{ feature }]);
  if (lock?.reason === "license") return new AppError(403, "FEATURE_NOT_IN_PLAN", `${label} is not included in your license. Contact Drycare support.`, [{ feature }]);
  return new AppError(403, "FEATURE_NOT_IN_PLAN", `${label} is not included in your plan. Upgrade on Plan & billing or contact Drycare support.`, [{ feature }]);
};

export async function requireFeature(orgId: string, feature: FeatureKey, tx: DbOrTx = db) {
  if (await hasFeature(orgId, feature, tx)) return;
  throw featureRefused(feature, (await featureLocks(orgId, tx))[feature]);
}

/** Why each switched-off feature is off for this shop, and which plans would give it. */
export async function featureLocks(orgId: string, tx: DbOrTx = db): Promise<Partial<Record<FeatureKey, FeatureLock>>> {
  const features = await orgFeatures(orgId, tx);
  const off = FEATURE_KEYS.filter((key) => !features[key]);
  if (!off.length) return {};
  if (isDesktop) return Object.fromEntries(off.map((key) => [key, { reason: "license", plans: [], currentPlan: null, message: null }]));
  const [org, registry, plans, sub] = await Promise.all([
    tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { featureOverrides: true, featureOverrideExpiry: true } }),
    featureRegistry(tx),
    tx.query.commercialPlans.findMany({ where: eq(schema.commercialPlans.published, true), orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise], columns: { id: true, name: true, entitlements: true } }),
    tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)], columns: { planId: true } }),
  ]);
  // A retired plan is no longer offered, but a shop still on it should see its name.
  const label = (key: FeatureKey) => ({ label: registry.edits[key]?.label, description: registry.edits[key]?.description });
  const currentPlan = sub ? (await tx.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub.planId), columns: { name: true } }))?.name ?? null : null;
  return Object.fromEntries(off.map((key): [FeatureKey, FeatureLock] => {
    const message = registry.upgradeMessages[key] ?? null;
    if (registry.globallyOff.includes(key)) return [key, { reason: "global", plans: [], currentPlan, message: null, ...label(key) }];
    if (key === "rfid") return [key, { reason: "addon", plans: [], currentPlan, message, ...label(key) }];
    if (activeOverride(key, org?.featureOverrides, { expiry: org?.featureOverrideExpiry }) === false) return [key, { reason: "admin", plans: [], currentPlan, message: null, ...label(key) }];
    return [key, { reason: "plan", plans: plans.filter((p) => resolveFeatures(p.entitlements)[key]).map((p) => p.name), currentPlan, message, ...label(key) }];
  }));
}

/**
 * Counts of use per shop, feature and day, and nothing else: no customer, order, staff or screen details. Held briefly in
 * memory and written in batches, so counting never slows a request or fails it.
 */
const usagePending = new Map<string, number>();
function noteFeatureUse(orgId: string, feature: string) {
  const key = `${orgId}|${feature}|${new Date().toISOString().slice(0, 10)}`;
  usagePending.set(key, (usagePending.get(key) ?? 0) + 1);
}
export async function flushFeatureUsage() {
  const rows = [...usagePending];
  usagePending.clear();
  for (const [key, count] of rows) {
    const [organizationId, feature, day] = key.split("|");
    await db.insert(schema.featureUsageDaily).values({ organizationId, feature, day, count })
      .onConflictDoUpdate({ target: [schema.featureUsageDaily.organizationId, schema.featureUsageDaily.feature, schema.featureUsageDaily.day], set: { count: sql`${schema.featureUsageDaily.count} + ${count}` } })
      .catch(() => {});
  }
}
setInterval(() => void flushFeatureUsage(), 60_000).unref();

/** Whole screens that belong to one feature. The tag designer is checked where tags are saved and printed. */
const FEATURE_ROUTES: [RegExp, FeatureKey][] = [
  [/^\/api\/v1\/dashboard(\/|$)/, "dashboard"],
  [/^\/api\/v1\/orders(\/|$)/, "orders"],
  [/^\/api\/v1\/(services|garment-types|price-lists|branch-prices|catalogue)(\/|$)/, "catalogue"],
  [/^\/api\/v1\/cashier-shifts(\/|$)/, "cashier"],
  [/^\/api\/v1\/invoices(\/|$)/, "invoices"],
  [/^\/api\/v1\/(print-jobs|garments\/barcode|labels\/print)(\/|$)/, "garmentTags"],
  [/^\/api\/v1\/(garments\/by-tag|tags\/scans)(\/|$)/, "scanStation"],
  [/^\/api\/v1\/garments\/[^/]+\/transitions$/, "scanStation"],
  [/^\/api\/v1\/(deliveries|drivers)(\/|$)/, "deliveries"],
  [/^\/api\/v1\/(inventory|purchase-orders|suppliers)(\/|$)/, "inventory"],
  [/^\/api\/v1\/laundry(\/|$)/, "laundry"],
  [/^\/api\/v1\/marketing\/(campaigns|preview)(\/|$)/, "marketing"],
  [/^\/api\/v1\/booking(\/|$)/, "onlineBooking"],
  [/^\/api\/v1\/(membership-plans|customer-memberships)(\/|$)/, "customerMemberships"],
  [/^\/api\/v1\/customers\/[^/]+\/memberships(\/|$)/, "customerMemberships"],
  [/^\/api\/v1\/customers(\/|$)/, "customers"],
  [/^\/api\/v1\/rfid(\/|$)/, "rfid"],
  [/^\/api\/v1\/reports(\/|$)/, "reports"],
  [/^\/api\/v1\/expenses(\/|$)/, "expenses"],
  [/^\/api\/v1\/claims(\/|$)/, "claims"],
  [/^\/api\/v1\/garment-exceptions(\/|$)/, "garmentExceptions"],
  [/^\/api\/v1\/transfers(\/|$)/, "transfers"],
  [/^\/api\/v1\/production\/(queues|overdue)(\/|$)/, "productionBoard"],
  [/^\/api\/v1\/tags\/trace(\/|$)/, "tagTracking"],
  [/^\/api\/v1\/system\/integrations(\/|$)/, "integrations"],
  [/^\/api\/v1\/audit-logs(\/|$)/, "auditLog"],
  [/^\/api\/v1\/staff\/(attendance|leaves)(\/|$)/, "staffManagement"],
];
/** The staff list is also read by other screens to name people, so only changes to it are stopped. */
const STAFF_CHANGE = /^\/api\/v1\/staff(\/|$)/;

export async function assertFeatureAllowed(req: FastifyRequest) {
  const path = req.url.split("?")[0];
  const feature = FEATURE_ROUTES.find(([route]) => route.test(path))?.[1] ?? (req.method !== "GET" && STAFF_CHANGE.test(path) ? "staffManagement" : undefined);
  if (!feature || !req.auth?.orgId || req.auth.isPlatformAdmin) return;
  await requireFeature(req.auth.orgId, feature);
  noteFeatureUse(req.auth.orgId, feature);
}

/** Without SMS / WhatsApp on the plan, a customer who has an email address still hears about their order. */
export async function customerChannel(orgId: string, channel: string, email: string | null) {
  if ((channel === "sms" || channel === "whatsapp") && !(await hasFeature(orgId, "whatsapp"))) return email ? "email" : "none";
  return channel;
}

/** How many active branches this shop may have. Null means no limit: a trial, or no plan yet. */
export async function branchLimit(orgId: string, tx: DbOrTx = db): Promise<number | null> {
  if (isDesktop) return licenseGrants()?.limits?.branches ?? null;
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { status: true, settings: true, branchLimitOverride: true } });
  if (!org || org.settings.platformInternal || org.settings.syncSource === "device") return null;
  if (org.branchLimitOverride !== null) return org.branchLimitOverride;
  if (org.status === "trial") return null;
  const sub = await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)], columns: { planId: true, branchLimitSnapshot: true } });
  if (!sub) return null;
  if (sub.branchLimitSnapshot !== null) return sub.branchLimitSnapshot;
  const plan = await tx.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub.planId), columns: { branchLimit: true } });
  return plan?.branchLimit ?? null;
}

/** Call inside a transaction, before adding or reopening a branch. Branches a shop already has are never closed. */
export async function assertBranchAvailable(tx: DbOrTx, orgId: string) {
  const limit = await branchLimit(orgId, tx);
  if (limit === null) return;
  // The lock stops two people adding the last allowed branch at the same moment.
  await tx.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).for("update");
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.branches).where(and(eq(schema.branches.organizationId, orgId), eq(schema.branches.status, "active")));
  if (count >= limit) throw new AppError(403, "BRANCH_LIMIT_REACHED", `Your plan includes ${limit} branch${limit === 1 ? "" : "es"}. Upgrade on Plan & billing or contact Drycare support to add more.`, [{ limit }]);
}

/** Printers and scanners the software owner accepts. An empty printer list means no restriction has been set. */
export async function hardwarePolicy(tx: DbOrTx = db): Promise<HardwarePolicy> {
  if (isDesktop) {
    const fromKey = licenseGrants()?.hardware;
    return { printers: fromKey?.printers ?? [], scanners: fromKey?.scanners ?? [], rfidReaders: fromKey?.rfidReaders ?? [], driverUrl: fromKey?.driverUrl ?? null, soldPrinters: fromKey?.soldPrinters };
  }
  const row = await tx.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, HARDWARE_POLICY_KEY) });
  const value = (row?.value ?? {}) as Partial<HardwarePolicy>;
  return { printers: value.printers ?? [], scanners: value.scanners ?? [], rfidReaders: value.rfidReaders ?? [], driverUrl: value.driverUrl ?? null, requireDevices: value.requireDevices ?? true };
}
