import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";

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
