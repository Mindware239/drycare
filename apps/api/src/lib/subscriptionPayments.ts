/** Applies a received subscription payment: activates or renews the plan, records the payment and issues the GST invoice. */
import { and, desc, eq, gt } from "drizzle-orm";
import { schema, type DbOrTx } from "../db/client";
import { conflict } from "./errors";
import { issueCommercialInvoice } from "./commercialInvoice";

type Plan = typeof schema.commercialPlans.$inferSelect;

export async function applySubscriptionPayment(tx: DbOrTx, input: {
  organizationId: string;
  plan: Plan;
  provider: string;
  reference: string;
  amountPaise: number;
  payload: Record<string, unknown>;
}) {
  const { organizationId, plan } = input;
  const existing = await tx.query.commercialSubscriptions.findFirst({
    where: and(
      eq(schema.commercialSubscriptions.organizationId, organizationId),
      eq(schema.commercialSubscriptions.status, "active"),
      gt(schema.commercialSubscriptions.endsAt, new Date()),
    ),
    orderBy: [desc(schema.commercialSubscriptions.createdAt)],
  });
  if (existing && existing.planId !== plan.id) {
    throw conflict("This business already has an active subscription on a different plan. Use “Change plan” on the customer page, or record the payment after the current period ends.", "ACTIVE_SUBSCRIPTION_EXISTS");
  }
  const now = new Date();
  const durationDays = plan.interval === "year" ? 365 : 30;
  // Renewing early extends from the current end date so the shop never loses paid days.
  const periodStart = existing?.endsAt && existing.endsAt > now ? existing.endsAt : now;
  const endsAt = new Date(periodStart.getTime() + durationDays * 86_400_000);
  const pending = existing ? undefined : await tx.query.commercialSubscriptions.findFirst({
    where: and(
      eq(schema.commercialSubscriptions.organizationId, organizationId),
      eq(schema.commercialSubscriptions.planId, plan.id),
      eq(schema.commercialSubscriptions.status, "past_due"),
    ),
    orderBy: [desc(schema.commercialSubscriptions.createdAt)],
  });

  const [subscription] = existing
    ? await tx.update(schema.commercialSubscriptions).set({ provider: input.provider, providerReference: input.reference, endsAt, cancelAt: null, updatedAt: now })
      .where(eq(schema.commercialSubscriptions.id, existing.id)).returning()
    : pending
    ? await tx.update(schema.commercialSubscriptions).set({ status: "active", provider: input.provider, providerReference: input.reference, startsAt: now, endsAt, updatedAt: now })
      .where(eq(schema.commercialSubscriptions.id, pending.id)).returning()
    : await tx.insert(schema.commercialSubscriptions).values({ organizationId, planId: plan.id, status: "active", provider: input.provider, providerReference: input.reference, startsAt: now, endsAt }).returning();

  const [payment] = await tx.insert(schema.commercialPayments).values({
    organizationId,
    subscriptionId: subscription.id,
    provider: input.provider,
    providerReference: input.reference,
    amountPaise: input.amountPaise,
    currency: plan.currency,
    status: "paid",
    providerPayload: { ...input.payload, renewal: Boolean(existing), periodStart: periodStart.toISOString(), periodEnd: endsAt.toISOString() },
  }).returning();
  const [organization] = await tx.update(schema.organizations).set({ status: "active", updatedAt: now })
    .where(eq(schema.organizations.id, organizationId)).returning();
  const invoice = await issueCommercialInvoice(tx, payment.id);
  return { payment, subscription, organization, invoice, renewal: Boolean(existing) };
}
