import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { subscriptionSnapshot, featureRegistry } from "../lib/entitlements";
import { FEATURES, FEATURE_KEYS, resolveFeatures } from "@drycare/shared";
import { conflict, notFound } from "../lib/errors";

export async function commercialRoutes(app: FastifyInstance) {
  app.get("/commercial/plans", async () => {
    const plans = await db.query.commercialPlans.findMany({
      where: eq(schema.commercialPlans.published, true),
      orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise],
    });
    return plans.map(({ entitlements, ...plan }) => ({ ...plan, entitlements }));
  });

  /** What the public pricing page shows: only the plans offered to new customers, with the features they include. */
  app.get("/commercial/public-plans", async () => {
    const [plans, registry] = await Promise.all([
      db.query.commercialPlans.findMany({ where: eq(schema.commercialPlans.published, true), orderBy: [schema.commercialPlans.sortOrder, schema.commercialPlans.pricePaise] }),
      featureRegistry(),
    ]);
    const list = [
      ...FEATURE_KEYS.filter((key) => key !== "rfid" && !registry.globallyOff.includes(key)).map((key) => ({ key, label: registry.edits[key]?.label ?? FEATURES[key].label })),
      ...registry.custom.filter((c) => !registry.globallyOff.includes(c.key)).map((c) => ({ key: c.key, label: c.label })),
    ];
    return {
      features: list,
      plans: plans.filter((p) => !/^(smoke|billtest)-/.test(p.code)).map((p) => {
        const known = resolveFeatures(p.entitlements) as Record<string, boolean>;
        return {
          id: p.id, code: p.code, name: p.name, description: p.description, pricePaise: p.pricePaise, interval: p.interval, gstInclusive: p.gstInclusive, branchLimit: p.branchLimit, deviceLimit: p.deviceLimit,
          included: list.filter((f) => known[f.key] ?? p.entitlements[f.key] === true).map((f) => f.key),
        };
      }),
    };
  });

  app.get("/commercial/subscription", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const subscription = await db.query.commercialSubscriptions.findFirst({
      where: eq(schema.commercialSubscriptions.organizationId, auth.orgId),
      orderBy: [desc(schema.commercialSubscriptions.createdAt)],
    });
    if (!subscription) return { subscription: null, plan: null };
    const plan = await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, subscription.planId) });
    return { subscription, plan: plan ? { ...plan, entitlements: plan.entitlements } : null };
  });

  app.post("/commercial/subscriptions", async (req, reply) => {
    const auth = requirePermission(req, "org.manage");
    const { planId } = z.object({ planId: z.uuid() }).parse(req.body);
    const plan = await db.query.commercialPlans.findFirst({ where: and(eq(schema.commercialPlans.id, planId), eq(schema.commercialPlans.published, true)) });
    if (!plan) throw notFound("Published plan");

    const existing = await db.query.commercialSubscriptions.findFirst({
      where: and(eq(schema.commercialSubscriptions.organizationId, auth.orgId), isNotNull(schema.commercialSubscriptions.endsAt)),
      orderBy: [desc(schema.commercialSubscriptions.createdAt)],
    });
    if (existing && ["trial", "active", "past_due"].includes(existing.status)) throw conflict("An active subscription or trial already exists.", "SUBSCRIPTION_EXISTS");

    const now = new Date();
    const intervalDays = plan.interval === "year" ? 365 : plan.interval === "quarter" ? 90 : plan.interval === "month" ? 30 : 0;
    if (!intervalDays) throw notFound("Supported billing interval");
    const endsAt = new Date(now.getTime() + intervalDays * 86_400_000);
    const [subscription] = await db.transaction(async (tx) => {
      const [row] = await tx.insert(schema.commercialSubscriptions).values({
        organizationId: auth.orgId,
        planId: plan.id,
        status: plan.pricePaise === 0 ? "active" : "past_due",
        provider: plan.pricePaise === 0 ? "manual" : "pending",
        startsAt: now,
        endsAt,
        ...subscriptionSnapshot(plan),
      }).returning();
      await audit(tx, req, { action: "subscription.requested", resourceType: "subscription", resourceId: row.id, orgId: auth.orgId, before: existing, after: row });
      return [row];
    });
    reply.code(201);
    return { subscription, checkoutRequired: plan.pricePaise > 0, paymentProviderConfigured: false };
  });

  app.post("/commercial/subscriptions/cancel", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const subscription = await db.query.commercialSubscriptions.findFirst({
      where: and(eq(schema.commercialSubscriptions.organizationId, auth.orgId), eq(schema.commercialSubscriptions.status, "active")),
      orderBy: [desc(schema.commercialSubscriptions.createdAt)],
    });
    if (!subscription) throw notFound("Active subscription");
    const cancelAt = subscription.endsAt;
    const [updated] = await db
      .update(schema.commercialSubscriptions)
      .set({ cancelAt, updatedAt: new Date() })
      .where(eq(schema.commercialSubscriptions.id, subscription.id))
      .returning();
    await audit(db, req, { action: "subscription.cancel_requested", resourceType: "subscription", resourceId: subscription.id, orgId: auth.orgId, before: subscription, after: updated });
    return updated;
  });
}
