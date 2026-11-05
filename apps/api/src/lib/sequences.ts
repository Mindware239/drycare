import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../db/client";
import { unprocessable } from "./errors";

/**
 * Gap-tolerant, concurrency-safe counters. The upsert takes a row lock, so two counters
 * creating orders at the same moment receive different numbers.
 */
export async function nextNumber(tx: Tx, orgId: string, scope: string): Promise<number> {
  const rows = await tx.execute<{ value: number }>(sql`
    insert into number_sequences (organization_id, scope, next_value)
    values (${orgId}, ${scope}, 2)
    on conflict (organization_id, scope) do update set next_value = number_sequences.next_value + 1
    returning next_value - 1 as value
  `);
  return Number(rows[0].value);
}

export const pad = (n: number, width = 5) => String(n).padStart(width, "0");

/** How many tag and bag numbers this shop has issued so far. */
export async function tagNumbersUsed(tx: Pick<Tx, "execute">, orgId: string) {
  const rows = await tx.execute<{ next_value: number }>(sql`select next_value from number_sequences where organization_id = ${orgId} and scope = 'tag_scan'`);
  return rows[0] ? Number(rows[0].next_value) - 1 : 0;
}

/** Allocate a range of organization-unique numbers for garment and bag barcodes, as long as the shop chose. */
export async function nextTagScanCodes(tx: Tx, orgId: string, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Scan-code count must be a non-negative integer");
  if (count === 0) return [];
  const rows = await tx.execute<{ first: number }>(sql`
    insert into number_sequences (organization_id, scope, next_value)
    values (${orgId}, 'tag_scan', ${count + 1})
    on conflict (organization_id, scope) do update set next_value = number_sequences.next_value + ${count}
    returning next_value - ${count} as first
  `);
  const first = Number(rows[0].first);
  const [org] = await tx.select({ settings: schema.organizations.settings }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const digits = org?.settings.labels?.scanDigits ?? 6;
  if (first + count - 1 > 10 ** digits - 1) throw unprocessable(`This shop has used all ${digits}-digit tag numbers. Choose a longer barcode in Tag setup, then try again.`, "TAG_SCAN_CODES_EXHAUSTED");
  return Array.from({ length: count }, (_, i) => String(first + i).padStart(digits, "0"));
}
