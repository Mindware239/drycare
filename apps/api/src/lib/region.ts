import { eq, sql } from "drizzle-orm";
import { isTimeZone, resolveRegion, type Region } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";

/** The shop's country settings: currency, time zone, tax wording and default rate. */
export async function orgRegion(orgId: string, tx: DbOrTx = db): Promise<Region> {
  const org = await tx.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: { defaultCurrency: true, defaultTimezone: true, settings: true },
  });
  return resolveRegion(org);
}

const safeZone = (timezone: string) => (isTimeZone(timezone) ? timezone : "UTC");

/**
 * A time zone written directly into a query. It has to be literal text: Postgres treats two bound parameters
 * as different expressions, so a query that groups by a local date would be refused with parameters.
 */
export const zone = (timezone: string) => sql.raw(`'${safeZone(timezone)}'`);

/** A column's date where the shop is, as query text. */
export const localDateText = (column: string, timezone: string) => `(${column} at time zone '${safeZone(timezone)}')::date`;
