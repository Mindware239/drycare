import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { marketingAudienceSchema, marketingCampaignSchema } from "@drycare/shared";
import { db, schema } from "../db/client";
import { requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { eligibleMarketingCustomers, enqueueMarketingCampaign } from "../lib/marketing";
import { isValidMarketingUnsubscribeToken } from "../lib/marketingConsent";
import { env } from "../env";
import { emailConfigured, emailFrom } from "../lib/mailer";

const emailReady = emailConfigured;
const marketingReady = () => emailReady() && !!env.MARKETING_UNSUBSCRIBE_SECRET;
const allowedVariables = new Set([
  "customer_name",
  "customer_first_name",
  "store_name",
  "store_phone",
  "campaign_name",
  "coupon_code",
  "coupon_expiry_date",
]);
const ownerOnly = (req: Parameters<typeof requirePermission>[0]) => {
  const auth = requirePermission(req, "org.manage");
  if (auth.roleKey !== "owner") throw forbidden("Only the store owner can manage marketing campaigns");
  return auth;
};

export async function marketingRoutes(app: FastifyInstance) {
  app.post("/public/leads", async (req, reply) => {
    const body = z.object({
      type: z.enum(["demo", "contact"]),
      name: z.string().trim().min(2).max(120),
      businessName: z.string().trim().max(160).optional(),
      email: z.email().max(255),
      phone: z.string().trim().max(30).optional(),
      city: z.string().trim().max(100).optional(),
      message: z.string().trim().min(10).max(3000),
    }).parse(req.body);
    const [lead] = await db.insert(schema.publicLeads).values(body).returning({ id: schema.publicLeads.id });
    reply.code(201);
    return { leadId: lead.id, status: "received" };
  });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.get("/marketing/status", async (req) => {
    const auth = ownerOnly(req);
    return {
      emailConfigured: emailReady(),
      marketingConfigured: marketingReady(),
      emailFrom: emailFrom(),
      optedInCustomers: await db.execute<{ count: number }>(sql`
        select count(*)::int as count
        from customers
        where organization_id = ${auth.orgId}
          and status = 'active'
          and marketing_consent = true
          and email is not null
          and length(trim(email)) > 0`),
    };
  });

  app.get("/marketing/campaigns", async (req) => {
    const auth = ownerOnly(req);
    return db
      .select({
        id: schema.marketingCampaigns.id,
        name: schema.marketingCampaigns.name,
        subject: schema.marketingCampaigns.subject,
        body: schema.marketingCampaigns.body,
        audience: schema.marketingCampaigns.audience,
        couponCode: schema.marketingCampaigns.couponCode,
        discountBps: schema.marketingCampaigns.discountBps,
        couponExpiresAt: schema.marketingCampaigns.couponExpiresAt,
        status: schema.marketingCampaigns.status,
        scheduledAt: schema.marketingCampaigns.scheduledAt,
        recipientCount: schema.marketingCampaigns.recipientCount,
        createdAt: schema.marketingCampaigns.createdAt,
        sentAt: schema.marketingCampaigns.sentAt,
        createdByName: schema.users.name,
        sentCount: sql<number>`count(*) filter (where ${schema.notificationJobs.status} = 'sent')::int`,
        failedCount: sql<number>`count(*) filter (where ${schema.notificationJobs.status} = 'failed')::int`,
        queuedCount: sql<number>`count(*) filter (where ${schema.notificationJobs.status} = 'queued')::int`,
      })
      .from(schema.marketingCampaigns)
      .leftJoin(schema.users, eq(schema.users.id, schema.marketingCampaigns.createdBy))
      .leftJoin(schema.notificationJobs, eq(schema.notificationJobs.campaignId, schema.marketingCampaigns.id))
      .where(eq(schema.marketingCampaigns.organizationId, auth.orgId))
      .groupBy(schema.marketingCampaigns.id, schema.users.name)
      .orderBy(desc(schema.marketingCampaigns.createdAt))
      .limit(100);
  });

  app.post("/marketing/preview", async (req) => {
    const auth = ownerOnly(req);
    const { audience } = z.object({ audience: marketingAudienceSchema }).parse(req.body);
    const recipients = await eligibleMarketingCustomers(db, auth.orgId, audience);
    return {
      recipientCount: recipients.length,
      cooldownDays: 90,
      consentRequired: true,
      emailOnly: true,
      emailConfigured: marketingReady(),
    };
  });

  app.post("/marketing/campaigns", async (req, reply) => {
    const auth = ownerOnly(req);
    const body = marketingCampaignSchema.parse(req.body);
    const variables = `${body.subject}\n${body.body}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
    for (const [, variable] of variables) {
      if (!allowedVariables.has(variable.trim())) throw badRequest(`Unsupported campaign variable: {{${variable.trim()}}}`);
    }
    if (body.action !== "draft" && !marketingReady()) throw badRequest("Marketing email is not configured. Set up email (SMTP or Resend) and MARKETING_UNSUBSCRIBE_SECRET, then restart the API and worker.");
    const scheduledAt = body.action === "schedule" ? new Date(body.scheduledAt!) : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) throw badRequest("Scheduled send time must be in the future");
    const couponExpiresAt = body.couponExpiresAt ? new Date(body.couponExpiresAt) : null;
    if (couponExpiresAt && couponExpiresAt.getTime() <= (scheduledAt?.getTime() ?? Date.now())) {
      throw badRequest("Coupon must remain valid until after the campaign is scheduled to send");
    }

    const created = await db.transaction(async (tx) => {
      const couponCode = body.discountPercent === undefined ? null : `DC-${randomBytes(4).toString("hex").toUpperCase()}`;
      const [campaign] = await tx.insert(schema.marketingCampaigns).values({
        organizationId: auth.orgId,
        name: body.name,
        subject: body.subject,
        body: body.body,
        audience: body.audience,
        couponCode,
        discountBps: body.discountPercent === undefined ? null : body.discountPercent * 100,
        couponExpiresAt,
        couponMaxRedemptions: body.couponMaxRedemptions ?? null,
        status: body.action === "schedule" ? "scheduled" : "draft",
        scheduledAt,
        createdBy: auth.userId,
      }).returning();
      if (couponCode && couponExpiresAt && body.discountPercent !== undefined) {
        await tx.insert(schema.marketingCoupons).values({
          organizationId: auth.orgId,
          campaignId: campaign.id,
          code: couponCode,
          discountBps: body.discountPercent * 100,
          startsAt: scheduledAt ?? new Date(),
          expiresAt: couponExpiresAt,
          maxRedemptions: body.couponMaxRedemptions ?? null,
          status: "disabled",
        });
      }
      const result = body.action === "send" ? await enqueueMarketingCampaign(tx, campaign) : { campaign, recipientCount: null };
      await audit(tx, req, {
        action: body.action === "send" ? "marketing.campaign_queued" : "marketing.campaign_created",
        resourceType: "marketing_campaign",
        resourceId: campaign.id,
        after: { name: campaign.name, status: result.campaign.status, recipientCount: result.recipientCount, audience: campaign.audience, couponCode },
      });
      return result;
    });
    reply.code(201);
    return created;
  });

  app.post("/marketing/campaigns/:campaignId/send", async (req) => {
    const auth = ownerOnly(req);
    if (!marketingReady()) throw badRequest("Marketing email is not configured. Set up email (SMTP or Resend) and MARKETING_UNSUBSCRIBE_SECRET, then restart the API and worker.");
    const { campaignId } = z.object({ campaignId: z.uuid() }).parse(req.params);
    return db.transaction(async (tx) => {
      const campaign = await tx.query.marketingCampaigns.findFirst({
        where: and(eq(schema.marketingCampaigns.id, campaignId), eq(schema.marketingCampaigns.organizationId, auth.orgId)),
      });
      if (!campaign) throw notFound("Marketing campaign");
      if (campaign.status !== "draft") throw badRequest("Only a draft campaign can be sent. Scheduled campaigns send at their chosen time.");
      const result = await enqueueMarketingCampaign(tx, campaign);
      await audit(tx, req, {
        action: "marketing.campaign_queued",
        resourceType: "marketing_campaign",
        resourceId: campaign.id,
        after: { name: campaign.name, recipientCount: result.recipientCount, audience: campaign.audience },
      });
      return result;
    });
  });

  app.post("/marketing/campaigns/:campaignId/cancel", async (req) => {
    const auth = ownerOnly(req);
    const { campaignId } = z.object({ campaignId: z.uuid() }).parse(req.params);
    const [campaign] = await db.update(schema.marketingCampaigns)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(
        eq(schema.marketingCampaigns.id, campaignId),
        eq(schema.marketingCampaigns.organizationId, auth.orgId),
        sql`${schema.marketingCampaigns.status} in ('draft', 'scheduled')`,
      ))
      .returning();
    if (!campaign) throw notFound("Draft or scheduled campaign");
    await audit(db, req, { action: "marketing.campaign_cancelled", resourceType: "marketing_campaign", resourceId: campaign.id, after: { name: campaign.name } });
    return campaign;
  });

  app.post("/marketing/unsubscribe", async (req) => {
    const body = z.object({
      organizationId: z.uuid(),
      customerId: z.uuid(),
      token: z.string().min(20).max(200),
    }).parse({ ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown>) });
    if (!isValidMarketingUnsubscribeToken(body.organizationId, body.customerId, body.token)) throw forbidden("This unsubscribe link is invalid");
    const [customer] = await db.update(schema.customers)
      .set({ marketingConsent: false, marketingConsentAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.customers.id, body.customerId),
        eq(schema.customers.organizationId, body.organizationId),
      ))
      .returning({ id: schema.customers.id });
    if (!customer) throw notFound("Customer");
    await audit(db, req, {
      action: "marketing.unsubscribed",
      resourceType: "customer",
      resourceId: customer.id,
      orgId: body.organizationId,
      after: { marketingConsent: false },
    });
    return { ok: true };
  });
}
