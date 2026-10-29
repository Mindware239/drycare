import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";

/**
 * Single definition of "amount paid" and "balance" used by every screen and report (FR-PAY-009):
 *   paid    = Σ allocations of succeeded payments − Σ succeeded refunds against the invoice
 *   credits = Σ issued credit notes (e.g. a discount agreed at collection)
 *   balance = grand_total − credits − paid   (cancelled invoices carry no balance)
 */
export const invoicePaidSql = sql`(
  coalesce((select sum(pa.allocated_amount) from payment_allocations pa join payments p on p.id = pa.payment_id
            where pa.invoice_id = i.id and p.status = 'succeeded'), 0)
  - coalesce((select sum(r.amount) from refunds r where r.invoice_id = i.id and r.status = 'succeeded'), 0)
)`;

export const invoiceCreditSql = sql`(
  coalesce((select sum(cn.total_amount) from credit_notes cn where cn.invoice_id = i.id and cn.status = 'issued'), 0)
)`;

/** Postgres array literal passed as a single bound parameter (drizzle expands JS arrays into lists). */
export const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;

export async function invoiceTotals(tx: DbOrTx, orgId: string, invoiceId: string) {
  const rows = await tx.execute<{ grand_total: string; paid: string; credits: string; status: string }>(sql`
    select i.grand_total, i.status, ${invoicePaidSql} as paid, ${invoiceCreditSql} as credits from invoices i
    where i.id = ${invoiceId} and i.organization_id = ${orgId}
  `);
  const r = rows[0];
  if (!r) return undefined;
  const grandTotal = Number(r.grand_total);
  const paid = Number(r.paid);
  const credits = Number(r.credits);
  return { grandTotal, credits, payable: grandTotal - credits, paid, balance: r.status === "cancelled" ? 0 : grandTotal - credits - paid, status: r.status };
}

export async function customerBalances(tx: DbOrTx, orgId: string, customerIds: string[], branchIds?: string[]) {
  if (customerIds.length === 0) return new Map<string, number>();
  const rows = await tx.execute<{ customer_id: string; balance: string }>(sql`
    select i.customer_id, sum(i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql}) as balance
    from invoices i
    where i.organization_id = ${orgId} and i.status <> 'cancelled'
      and i.customer_id = any(${uuidArray(customerIds)}::uuid[])
      ${branchIds?.length ? sql`and i.branch_id = any(${uuidArray(branchIds)}::uuid[])` : sql``}
    group by i.customer_id
  `);
  return new Map(rows.map((r) => [r.customer_id, Number(r.balance)]));
}
