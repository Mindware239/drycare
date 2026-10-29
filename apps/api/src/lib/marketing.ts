import { and, eq, sql } from "drizzle-orm";
import { marketingAudienceSchema } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";

export async function eligibleMarketingCustomers(query: DbOrTx, organizationId: string, audienceValue: unknown) {
  const audience = marketingAudienceSchema.parse(audienceValue);
  const marketingCooldown = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const inactiveBefore = audience.type === "inactive"
    ? new Date(Date.now() - audience.inactiveDays * 24 * 60 * 60 * 1000)
    : undefined;

  return query
    .select({ id: schema.customers.id, email: schema.customers.email })
    .from(schema.customers)
    .where(and(
      eq(schema.customers.organizationId, organizationId),
      eq(schema.customers.status, "active"),
      eq(schema.customers.marketingConsent, true),
      sql`${schema.customers.email} is not null and length(trim(${schema.customers.email})) > 0`,
      inactiveBefore
        ? sql`exists (
            select 1 from orders o
            where o.organization_id = ${organizationId}
              and o.customer_id = ${schema.customers.id}
              and o.operational_status <> 'cancelled'
            group by o.customer_id
            having max(o.received_at) <= ${inactiveBefore.toISOString()}
          )`
        : undefined,
      audience.type === "inactive"
        ? sql`not exists (
            select 1 from orders active_order
            where active_order.organization_id = ${organizationId}
              and active_order.customer_id = ${schema.customers.id}
              and active_order.operational_status in ('received', 'in_processing', 'partially_ready', 'ready', 'partially_delivered')
          )`
        : undefined,
      sql`not exists (
        select 1 from notification_jobs n
        where n.organization_id = ${organizationId}
          and n.customer_id = ${schema.customers.id}
          and n.event_type = 'marketing.campaign'
          and n.created_at >= ${marketingCooldown.toISOString()}
          and n.status in ('queued', 'sent')
      )`,
    ));
}

export async function enqueueMarketingCampaign(
  tx: DbOrTx,
  campaign: typeof schema.marketingCampaigns.$inferSelect,
) {
  if (campaign.couponExpiresAt && campaign.couponExpiresAt <= new Date()) {
    throw new Error("Campaign coupon expired before it could be sent");
  }
  await tx.update(schema.marketingCoupons)
    .set({ status: "active", startsAt: new Date() })
    .where(and(
      eq(schema.marketingCoupons.organizationId, campaign.organizationId),
      eq(schema.marketingCoupons.campaignId, campaign.id),
    ));
  const recipients = await eligibleMarketingCustomers(tx, campaign.organizationId, campaign.audience);
  const values = recipients.flatMap((customer) => customer.email ? [{
    organizationId: campaign.organizationId,
    customerId: customer.id,
    campaignId: campaign.id,
    eventType: "marketing.campaign",
    channel: "email",
    recipient: customer.email,
    subject: campaign.subject,
    body: campaign.body,
    dedupeKey: `${campaign.id}:${customer.id}`,
    status: "queued",
  }] : []);

  for (let offset = 0; offset < values.length; offset += 500) {
    await tx.insert(schema.notificationJobs).values(values.slice(offset, offset + 500)).onConflictDoNothing();
  }
  if (!values.length) {
    await tx.update(schema.marketingCoupons)
      .set({ status: "disabled" })
      .where(and(
        eq(schema.marketingCoupons.organizationId, campaign.organizationId),
        eq(schema.marketingCoupons.campaignId, campaign.id),
      ));
  }
  const [updated] = await tx.update(schema.marketingCampaigns).set({
    status: values.length ? "sending" : "sent",
    recipientCount: values.length,
    sentAt: values.length ? null : new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.marketingCampaigns.id, campaign.id)).returning();
  return { campaign: updated, recipientCount: values.length };
}

export async function processDueMarketingCampaigns() {
  const claimed = await db.execute<{ id: string }>(sql`
    with due as (
      select id
      from marketing_campaigns
      where status = 'scheduled' and scheduled_at <= now()
      order by scheduled_at
      for update skip locked
      limit 10
    )
    update marketing_campaigns c
    set status = 'processing', updated_at = now()
    from due
    where c.id = due.id
    returning c.id
  `);

  for (const { id } of claimed) {
    try {
      await db.transaction(async (tx) => {
        const campaign = await tx.query.marketingCampaigns.findFirst({
          where: and(eq(schema.marketingCampaigns.id, id), eq(schema.marketingCampaigns.status, "processing")),
        });
        if (campaign) await enqueueMarketingCampaign(tx, campaign);
      });
    } catch (error) {
      console.error(`Could not queue scheduled marketing campaign ${id}`, error);
      await db.update(schema.marketingCampaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(schema.marketingCampaigns.id, id), eq(schema.marketingCampaigns.status, "processing")));
    }
  }
}
