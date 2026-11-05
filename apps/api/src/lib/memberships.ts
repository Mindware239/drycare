import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "../db/client";
import { emit } from "./audit";
import { hasFeature } from "./entitlements";

/** The membership giving this customer a discount right now. A renewal that has not started yet does not count. */
export async function currentMembership(tx: DbOrTx, orgId: string, customerId: string) {
  const now = new Date();
  return tx.query.customerMemberships.findFirst({
    where: and(
      eq(schema.customerMemberships.organizationId, orgId),
      eq(schema.customerMemberships.customerId, customerId),
      eq(schema.customerMemberships.status, "active"),
      lte(schema.customerMemberships.startsAt, now),
      gt(schema.customerMemberships.endsAt, now),
    ),
    orderBy: [desc(schema.customerMemberships.discountBps)],
  });
}

/** How many days before a membership ends the customer hears about it. */
export const RENEWAL_REMINDER_DAYS = 7;

/**
 * Tells customers their membership is about to end, once per membership. Anyone who has already renewed is left
 * alone. Cloud copies of a shop's PC are skipped, because the PC is the one that talks to its customers.
 */
export async function remindExpiringMemberships() {
  const due = await db.execute<{ id: string; organization_id: string; customer_id: string; plan_name: string; ends_at: Date }>(sql`
    select m.id, m.organization_id, m.customer_id, m.plan_name, m.ends_at
    from customer_memberships m join organizations o on o.id = m.organization_id
    where m.status = 'active' and m.renewal_reminder_sent_at is null
      and m.ends_at > now() and m.ends_at <= now() + make_interval(days => ${RENEWAL_REMINDER_DAYS})
      and coalesce(o.settings_json ->> 'syncSource', '') <> 'device'
      and not exists (select 1 from customer_memberships later where later.customer_id = m.customer_id and later.status = 'active' and later.ends_at > m.ends_at)
    limit 100`);
  for (const m of due) {
    if (!(await hasFeature(m.organization_id, "customerMemberships"))) continue;
    await db.transaction(async (tx) => {
      await tx.update(schema.customerMemberships).set({ renewalReminderSentAt: new Date() }).where(eq(schema.customerMemberships.id, m.id));
      await emit(tx, m.organization_id, "membership.expiring", { customerId: m.customer_id, planName: m.plan_name, endsAt: new Date(m.ends_at).toISOString() });
    });
  }
  return due.length;
}
