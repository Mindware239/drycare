/**
 * What a shop may use. In the cloud that comes from its plan plus the software owner's exceptions for that shop.
 * A PC works offline, so there it comes from the signed license key. Features are enforced here on the server;
 * the web screens only hide what the server would refuse anyway.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { allFeatures, resolveFeatures, type FeatureKey, type FeatureMap, FEATURES } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { isDesktop } from "../env";
import { AppError } from "./errors";
import { licenseGrants } from "./license";

export type SoldPrinter = { serial: string; bill: string; model: string };
export type HardwarePolicy = { printers: string[]; scanners: string[]; rfidReaders: string[]; driverUrl: string | null; soldPrinters?: SoldPrinter[] };
export const HARDWARE_POLICY_KEY = "hardware_policy";

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
  return { ...features, rfid: await rfidModuleActive(orgId, tx) };
}

async function planFeatures(orgId: string, tx: DbOrTx): Promise<FeatureMap> {
  if (isDesktop) {
    const fromKey = licenseGrants()?.features;
    return fromKey ? resolveFeatures(fromKey) : allFeatures();
  }
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { status: true, settings: true, featureOverrides: true } });
  if (!org || org.settings.platformInternal) return allFeatures();
  // The cloud copy of a shop PC is view-only and must be able to show everything the PC uploads.
  if (org.settings.syncSource === "device") return allFeatures();
  // A trial shows everything, so a shop can judge the higher plans before choosing one.
  if (org.status === "trial") return resolveFeatures(null, org.featureOverrides);
  const sub = await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)], columns: { planId: true } });
  if (!sub) return resolveFeatures(null, org.featureOverrides);
  const plan = await tx.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, sub.planId), columns: { entitlements: true } });
  return resolveFeatures(plan?.entitlements ?? null, org.featureOverrides);
}

export const hasFeature = async (orgId: string, feature: FeatureKey, tx: DbOrTx = db) => (await orgFeatures(orgId, tx))[feature];

export const featureRefused = (feature: FeatureKey) =>
  new AppError(403, "FEATURE_NOT_IN_PLAN", `${FEATURES[feature].label} is not included in your plan. Upgrade on Plan & billing or contact Drycare support.`, [{ feature }]);

export async function requireFeature(orgId: string, feature: FeatureKey, tx: DbOrTx = db) {
  if (!(await hasFeature(orgId, feature, tx))) throw featureRefused(feature);
}

/** Whole screens that belong to one feature. The tag designer is checked where tags are saved and printed. */
const FEATURE_ROUTES: [RegExp, FeatureKey][] = [
  [/^\/api\/v1\/(deliveries|drivers)(\/|$)/, "deliveries"],
  [/^\/api\/v1\/(inventory|purchase-orders|suppliers)(\/|$)/, "inventory"],
  [/^\/api\/v1\/laundry(\/|$)/, "laundry"],
  [/^\/api\/v1\/marketing\/(campaigns|preview)(\/|$)/, "marketing"],
  [/^\/api\/v1\/booking(\/|$)/, "onlineBooking"],
  [/^\/api\/v1\/(membership-plans|customer-memberships)(\/|$)/, "customerMemberships"],
  [/^\/api\/v1\/customers\/[^/]+\/memberships(\/|$)/, "customerMemberships"],
  [/^\/api\/v1\/rfid(\/|$)/, "rfid"],
];

export async function assertFeatureAllowed(req: FastifyRequest) {
  const path = req.url.split("?")[0];
  const match = FEATURE_ROUTES.find(([route]) => route.test(path));
  if (!match || !req.auth?.orgId || req.auth.isPlatformAdmin) return;
  await requireFeature(req.auth.orgId, match[1]);
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
  const sub = await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)], columns: { planId: true } });
  if (!sub) return null;
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
  return { printers: value.printers ?? [], scanners: value.scanners ?? [], rfidReaders: value.rfidReaders ?? [], driverUrl: value.driverUrl ?? null };
}
