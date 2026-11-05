import { and, desc, eq, gt, lte } from "drizzle-orm";
import { schema, type DbOrTx } from "../db/client";

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
