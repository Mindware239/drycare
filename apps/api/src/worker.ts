/**
 * Background worker: drains the transactional outbox into notification jobs and "sends" them.
 * The provider is a log adapter until SMS / WhatsApp / email providers are configured
 * (FR-NOT-002). Failures never affect the business transaction that produced the event.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { formatMoney } from "@drycare/shared";
import { db, schema } from "./db/client";
import { env } from "./env";
import { emailConfigured, sendEmail } from "./lib/mailer";
import { processDueMarketingCampaigns } from "./lib/marketing";
import { marketingUnsubscribeToken } from "./lib/marketingConsent";

interface Provider {
  send(channel: string, to: string, body: string, subject?: string, headers?: Record<string, string>): Promise<{ ok: boolean; providerId?: string; error?: string; permanent?: boolean }>;
}

const configuredProvider: Provider = {
  async send(channel, to, body, subject, headers) {
    if (channel !== "email") return { ok: false, error: `No ${channel} provider is configured`, permanent: true };
    if (!emailConfigured()) return { ok: false, error: "Email delivery (SMTP or Resend) is not configured", permanent: true };
    return sendEmail({ to, subject: subject ?? "A message from DryCare", text: body, headers });
  },
};

const MAX_ATTEMPTS = 5;

async function buildMessage(eventType: string, payload: Record<string, unknown>, orgId: string) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (eventType === "auth.password_reset") {
    // Staff account email, not a customer message.
    return {
      customer: { id: null as unknown as string },
      channel: "email",
      recipient: payload.email as string,
      subject: `${org?.name ?? "DryCare"}: Set your DryCare password`,
      body: `${org?.name ?? "DryCare"}: use this link within 24 hours to set a new DryCare password: ${payload.link}. If you didn't ask for this, ignore this email.`,
    };
  }
  const customer = payload.customerId
    ? await db.query.customers.findFirst({
      where: and(eq(schema.customers.id, payload.customerId as string), eq(schema.customers.organizationId, orgId)),
    })
    : undefined;
  if (!customer) return undefined;
  const order = payload.orderId
    ? await db.query.orders.findFirst({
      where: and(eq(schema.orders.id, payload.orderId as string), eq(schema.orders.organizationId, orgId)),
    })
    : undefined;
  const shop = org?.name ?? "DryCare";
  const fmtDay = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
  const fmtDate = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  let body: string | undefined;
  switch (eventType) {
    case "order.booked": {
      const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from garments where order_id = ${order!.id}`);
      body = `${shop}: Order ${order!.orderNumber} booked — ${n} item(s), total ${formatMoney(order!.grandTotal)}. Expected ready by ${fmtDate(order!.promisedAt)}.`;
      break;
    }
    case "order.ready":
      body = `${shop}: Your order ${order!.orderNumber} is ready for collection.`;
      break;
    case "order.partially_ready":
      body = `${shop}: Part of your order ${order!.orderNumber} is ready. We'll notify you when the rest is done.`;
      break;
    case "order.delayed":
      body = `${shop}: Order ${order!.orderNumber} is now expected by ${fmtDate(new Date(payload.promisedAt as string))}. Sorry for the delay.`;
      break;
    case "order.delivered":
      body = `${shop}: Thank you! Order ${order!.orderNumber} has been delivered.`;
      break;
    case "pickup.scheduled":
      body = `${shop}: Pickup booked for ${fmtDay(payload.date as string)}, ${payload.slot}. Please keep your garments ready.`;
      break;
    case "delivery.scheduled":
      body = `${shop}: Order ${order!.orderNumber} will be delivered on ${fmtDay(payload.date as string)}, ${payload.slot}.${payload.otp ? ` Share OTP ${payload.otp} with our delivery agent only after you receive your garments.` : ""}`;
      break;
    case "pickup.out":
      body = `${shop}: Our agent is on the way to collect your garments.`;
      break;
    case "delivery.out":
      body = `${shop}: Order ${order!.orderNumber} is out for delivery.`;
      break;
    case "delivery.failed":
    case "pickup.failed":
      body = `${shop}: We couldn't complete your ${eventType.startsWith("pickup") ? "pickup" : `delivery of ${order!.orderNumber}`} today. We'll call you to reschedule.`;
      break;
    case "payment.received":
      body = `${shop}: Payment of ${formatMoney(payload.amount as number)} received via ${String(payload.method).toUpperCase()}. Thank you.`;
      break;
    case "customer.approval_otp":
      body = `${shop}: Your customer approval code for order ${order?.orderNumber ?? ""} is ${String(payload.otp)}. It expires in 10 minutes. Share it only with the DryCare staff member handling your order.`;
      break;
  }
  if (!body) return undefined;
  const channel = eventType === "customer.approval_otp" ? "email" : customer.notificationChannel;
  const recipient = channel === "email" ? customer.email : customer.phone;
  const orderNumber = order?.orderNumber;
  const subject = orderNumber ? `${shop}: Order ${orderNumber} update` : `${shop}: Customer update`;
  return { customer, channel, recipient, subject, body };
}

async function processOutbox() {
  const events = await db
    .select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.status, "pending"), lte(schema.outboxEvents.availableAt, new Date())))
    .limit(50);
  for (const ev of events) {
    try {
      const msg = await buildMessage(ev.eventType, ev.payload as Record<string, unknown>, ev.organizationId);
      if (msg) {
        // FR-NOT-005: dedupe key makes re-processing an event idempotent.
        await db
          .insert(schema.notificationJobs)
          .values({
            organizationId: ev.organizationId,
            customerId: msg.customer.id,
            customerApprovalId: ev.eventType === "customer.approval_otp" ? String((ev.payload as Record<string, unknown>).approvalId) : null,
            eventType: ev.eventType,
            channel: msg.channel,
            recipient: msg.recipient,
            subject: msg.subject,
            body: msg.body,
            dedupeKey: `${ev.id}:${msg.channel}`,
            status: msg.channel === "none" || !msg.recipient ? "skipped" : "queued",
          })
          .onConflictDoNothing();
      }
      // One-time codes must not linger in the event log once the message exists.
      const payload = ev.payload as Record<string, unknown>;
      const scrubbed = "otp" in payload ? { ...payload, otp: "[sent]" } : "link" in payload ? { ...payload, link: "[sent]" } : undefined;
      await db
        .update(schema.outboxEvents)
        .set({ status: "processed", processedAt: new Date(), attempts: ev.attempts + 1, ...(scrubbed ? { payload: scrubbed } : {}) })
        .where(eq(schema.outboxEvents.id, ev.id));
    } catch (e) {
      const attempts = ev.attempts + 1;
      await db
        .update(schema.outboxEvents)
        .set({ attempts, lastError: String(e).slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", availableAt: new Date(Date.now() + 2 ** attempts * 1000) })
        .where(eq(schema.outboxEvents.id, ev.id));
    }
  }
}

async function sendQueued() {
  const jobs = await db.select().from(schema.notificationJobs).where(eq(schema.notificationJobs.status, "queued")).limit(50);
  for (const job of jobs) {
    if (job.eventType === "customer.approval_otp") {
      const approval = job.customerApprovalId
        ? await db.query.customerApprovals.findFirst({
          where: and(
            eq(schema.customerApprovals.id, job.customerApprovalId),
            eq(schema.customerApprovals.organizationId, job.organizationId),
            eq(schema.customerApprovals.status, "pending"),
            sql`${schema.customerApprovals.otpExpiresAt} > now()`,
          ),
        })
        : undefined;
      if (!approval) {
        await db.update(schema.notificationJobs)
          .set({ status: "skipped", body: "[redacted]", providerResponse: { skipped: "Approval OTP is expired or resolved" } })
          .where(eq(schema.notificationJobs.id, job.id));
        continue;
      }
    }
    if (job.eventType === "marketing.campaign") {
      const customer = job.customerId
        ? await db.query.customers.findFirst({ where: and(eq(schema.customers.id, job.customerId), eq(schema.customers.organizationId, job.organizationId)) })
        : undefined;
      if (!customer || customer.status !== "active" || !customer.marketingConsent || !customer.email || customer.email !== job.recipient) {
        await db.update(schema.notificationJobs)
          .set({ status: "skipped", providerResponse: { skipped: "Customer is no longer opted in or email changed" } })
          .where(eq(schema.notificationJobs.id, job.id));
        await updateCampaignStatus(job.campaignId);
        continue;
      }
    }
    let body = job.body;
    let subject = job.subject ?? undefined;
    let headers: Record<string, string> | undefined;
    let res: { ok: boolean; providerId?: string; error?: string; permanent?: boolean };
    try {
      if (job.eventType === "marketing.campaign") {
        if (!job.customerId || !env.MARKETING_UNSUBSCRIBE_SECRET) throw new Error("Marketing unsubscribe signing is not configured");
        const [campaign, customer, organization] = await Promise.all([
          job.campaignId ? db.query.marketingCampaigns.findFirst({ where: and(eq(schema.marketingCampaigns.id, job.campaignId), eq(schema.marketingCampaigns.organizationId, job.organizationId)) }) : undefined,
          db.query.customers.findFirst({ where: and(eq(schema.customers.id, job.customerId), eq(schema.customers.organizationId, job.organizationId)) }),
          db.query.organizations.findFirst({ where: eq(schema.organizations.id, job.organizationId) }),
        ]);
        if (!campaign || !customer || !customer.marketingConsent || !customer.email || customer.email !== job.recipient) {
          await db.update(schema.notificationJobs)
            .set({ status: "skipped", providerResponse: { skipped: "Customer is no longer opted in or campaign data is unavailable" } })
            .where(eq(schema.notificationJobs.id, job.id));
          await updateCampaignStatus(job.campaignId);
          continue;
        }
        const replacements: Record<string, string> = {
          customer_name: customer.name,
          customer_first_name: customer.name.trim().split(/\s+/)[0] ?? customer.name,
          store_name: organization?.name ?? "DryCare",
          store_phone: "",
          campaign_name: campaign.name,
          coupon_code: campaign.couponCode ?? "",
          coupon_expiry_date: campaign.couponExpiresAt?.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }) ?? "",
        };
        const render = (text: string) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, variable: string) => replacements[variable] ?? "");
        body = render(job.body);
        subject = render(job.subject ?? "");
        const token = marketingUnsubscribeToken(job.organizationId, job.customerId);
        const url = new URL("/unsubscribe", env.WEB_ORIGIN);
        url.searchParams.set("organizationId", job.organizationId);
        url.searchParams.set("customerId", job.customerId);
        url.searchParams.set("token", token);
        const oneClickUrl = new URL("/api/v1/marketing/unsubscribe", env.WEB_ORIGIN);
        oneClickUrl.searchParams.set("organizationId", job.organizationId);
        oneClickUrl.searchParams.set("customerId", job.customerId);
        oneClickUrl.searchParams.set("token", token);
        body = `${body}\n\nTo stop receiving promotional emails, unsubscribe here:\n${url.toString()}`;
        headers = {
          "List-Unsubscribe": `<${oneClickUrl.toString()}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
      }
      res = await configuredProvider.send(job.channel, job.recipient!, body, subject, headers);
    } catch (e) {
      res = { ok: false, error: String(e), permanent: true };
    }
    const attempts = res.permanent ? MAX_ATTEMPTS : job.attempts + 1;
    const status = res.ok ? "sent" : attempts >= MAX_ATTEMPTS ? "failed" : "queued";
    await db
      .update(schema.notificationJobs)
      .set({
        attempts,
        status,
        sentAt: res.ok ? new Date() : null,
        providerResponse: res,
        ...(job.eventType === "customer.approval_otp" && status !== "queued" ? { body: "[redacted]" } : {}),
      })
      .where(eq(schema.notificationJobs.id, job.id));
    if (job.campaignId) await updateCampaignStatus(job.campaignId);
  }
}

async function updateCampaignStatus(campaignId: string | null) {
  if (!campaignId) return;
  const [summary] = await db.select({
    queued: sql<number>`count(*) filter (where ${schema.notificationJobs.status} = 'queued')::int`,
    failed: sql<number>`count(*) filter (where ${schema.notificationJobs.status} = 'failed')::int`,
  }).from(schema.notificationJobs).where(eq(schema.notificationJobs.campaignId, campaignId));
  if (summary.queued === 0) {
    await db.update(schema.marketingCampaigns)
      .set({ status: summary.failed ? "failed" : "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.marketingCampaigns.id, campaignId));
  }
}

console.log("DryCare worker started");
for (;;) {
  try {
    await processDueMarketingCampaigns();
    await processOutbox();
    await sendQueued();
  } catch (e) {
    console.error("worker tick failed", e);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
