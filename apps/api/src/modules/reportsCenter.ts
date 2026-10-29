/**
 * Reports centre: a catalogue of ready-made shop reports, each returning typed columns, rows and totals so the web
 * screen can show, total, print and export any of them the same way. All reports are branch-scoped by role.
 */
import type { FastifyInstance } from "fastify";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Permission } from "@drycare/shared";
import { db } from "../db/client";
import { can, requirePermission, type AuthContext } from "../lib/context";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { invoiceCreditSql, invoicePaidSql } from "../lib/balances";
import { branchSql } from "./reports";

type ColType = "text" | "money" | "int" | "date" | "datetime" | "pct";
type Col = { key: string; label: string; type: ColType; total?: boolean };
type Ctx = { auth: AuthContext; from: string; to: string; branchId?: string; days: number };
type Report = { key: string; group: string; title: string; description: string; perm: Permission; columns: Col[]; usesDates?: boolean; run: (c: Ctx) => Promise<Record<string, unknown>[]> };

const TZ = "Asia/Kolkata";
const day = (col: string) => sql.raw(`(${col} at time zone '${TZ}')::date`);
const inRange = (col: string, c: Ctx) => sql`${day(col)} between ${c.from}::date and ${c.to}::date`;
const br = (c: Ctx, col: string) => branchSql(c.auth, col, c.branchId);
const rows = async (q: SQL) => (await db.execute(q)) as unknown as Record<string, unknown>[];

const salesBy = (label: string, key: string): Pick<Report, "columns" | "run"> => ({
  columns: [{ key: "label", label, type: "text" }, { key: "orders", label: "Orders", type: "int", total: true }, { key: "quantity", label: "Qty", type: "int", total: true }, { key: "discount", label: "Discount", type: "money", total: true }, { key: "tax", label: "GST", type: "money", total: true }, { key: "total", label: "Total", type: "money", total: true }],
  run: (c) => rows(sql`
    select ${sql.raw(key)} as label, count(distinct o.id)::int as orders, sum(oi.quantity)::int as quantity, sum(oi.discount_amount) as discount, sum(oi.tax_amount) as tax, sum(oi.line_total) as total
    from order_items oi join orders o on o.id = oi.order_id join invoices i on i.order_id = o.id join branches b on b.id = o.branch_id
    where o.organization_id = ${c.auth.orgId} and i.status <> 'cancelled' and ${inRange("i.issued_at", c)} ${br(c, "o.branch_id")}
    group by 1 order by total desc`),
});

const REPORTS: Report[] = [
  // ---------------- sales
  { key: "sales-service", group: "Sales", title: "Sales by service", description: "Billed quantity and value for each service", perm: "reports.financial", usesDates: true, ...salesBy("Service", "oi.service_name") },
  { key: "sales-garment", group: "Sales", title: "Sales by garment", description: "Which garments bring the most business", perm: "reports.financial", usesDates: true, ...salesBy("Garment", "oi.garment_type_name") },
  { key: "sales-day", group: "Sales", title: "Daily sales", description: "Billed value day by day", perm: "reports.financial", usesDates: true, ...salesBy("Date", `(i.issued_at at time zone '${TZ}')::date::text`) },
  {
    key: "sales-branch", group: "Sales", title: "Branch-wise sales", description: "Dry cleaning, self-service laundry and collections per branch", perm: "reports.financial", usesDates: true,
    columns: [{ key: "branch", label: "Branch", type: "text" }, { key: "orders", label: "Orders", type: "int", total: true }, { key: "billed", label: "Dry cleaning", type: "money", total: true }, { key: "laundry", label: "Self-service", type: "money", total: true }, { key: "collected", label: "Collected", type: "money", total: true }, { key: "dues", label: "Dues now", type: "money", total: true }],
    run: (c) => rows(sql`
      select b.name as branch,
        (select count(*)::int from orders o where o.branch_id = b.id and ${inRange("o.received_at", c)}) as orders,
        coalesce((select sum(i.grand_total) from invoices i where i.branch_id = b.id and i.status <> 'cancelled' and ${inRange("i.issued_at", c)}),0) as billed,
        coalesce((select sum(lo.total) from laundry_orders lo where lo.branch_id = b.id and lo.status <> 'cancelled' and ${inRange("lo.created_at", c)}),0) as laundry,
        coalesce((select sum(p.amount) from payments p where p.branch_id = b.id and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at", c)}),0) as collected,
        coalesce((select sum(i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql}) from invoices i where i.branch_id = b.id and i.status <> 'cancelled'),0) as dues
      from branches b where b.organization_id = ${c.auth.orgId} ${br(c, "b.id")} order by b.created_at`),
  },
  {
    key: "gst-summary", group: "Sales", title: "GST summary", description: "Taxable value and GST by rate, split B2B (customer GSTIN) and B2C, for GSTR-1 / 3B", perm: "reports.financial", usesDates: true,
    columns: [{ key: "rate", label: "GST rate", type: "text" }, { key: "invoices", label: "Invoices", type: "int", total: true }, { key: "b2b_taxable", label: "B2B taxable", type: "money", total: true }, { key: "b2c_taxable", label: "B2C taxable", type: "money", total: true }, { key: "taxable", label: "Taxable value", type: "money", total: true }, { key: "tax", label: "GST", type: "money", total: true }, { key: "total", label: "Invoice value", type: "money", total: true }],
    run: (c) => rows(sql`
      select (ii.tax_rate_bps_snapshot / 100.0)::numeric(5,2)::text || '%' as rate, count(distinct i.id)::int as invoices,
        coalesce(sum(ii.line_total - ii.tax_amount) filter (where cu.gstin is not null and cu.gstin <> ''),0) as b2b_taxable,
        coalesce(sum(ii.line_total - ii.tax_amount) filter (where cu.gstin is null or cu.gstin = ''),0) as b2c_taxable,
        sum(ii.line_total - ii.tax_amount) as taxable, sum(ii.tax_amount) as tax, sum(ii.line_total) as total
      from invoice_items ii join invoices i on i.id = ii.invoice_id join customers cu on cu.id = i.customer_id
      where i.organization_id = ${c.auth.orgId} and i.status <> 'cancelled' and ${inRange("i.issued_at", c)} ${br(c, "i.branch_id")}
      group by ii.tax_rate_bps_snapshot order by ii.tax_rate_bps_snapshot`),
  },
  {
    key: "discounts", group: "Sales", title: "Discounts & credit notes", description: "Order discounts, coupons and collection credit notes", perm: "reports.financial", usesDates: true,
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "reference", label: "Order / note", type: "text" }, { key: "customer", label: "Customer", type: "text" }, { key: "kind", label: "Type", type: "text" }, { key: "reason", label: "Reason / coupon", type: "text" }, { key: "amount", label: "Amount", type: "money", total: true }],
    run: (c) => rows(sql`
      select * from (
        select ${day("o.received_at")} as date, o.order_number as reference, cu.name as customer, 'Order discount' as kind, coalesce(mc.code, '') as reason, o.discount_total as amount
        from orders o join customers cu on cu.id = o.customer_id left join marketing_coupons mc on mc.id = o.coupon_id
        where o.organization_id = ${c.auth.orgId} and o.discount_total > 0 and o.cancelled_at is null and ${inRange("o.received_at", c)} ${br(c, "o.branch_id")}
        union all
        select ${day("cn.created_at")}, cn.credit_note_number, cu.name, 'Credit note', coalesce(cn.reason, ''), cn.total_amount
        from credit_notes cn join invoices i on i.id = cn.invoice_id join customers cu on cu.id = i.customer_id
        where cn.organization_id = ${c.auth.orgId} and cn.status = 'issued' and ${inRange("cn.created_at", c)} ${br(c, "i.branch_id")}
      ) x order by date desc`),
  },
  // ---------------- money
  {
    key: "daybook", group: "Money", title: "Day book", description: "Money in and out each day: collections by method, refunds, expenses and net cash", perm: "reports.financial", usesDates: true,
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "cash", label: "Cash in", type: "money", total: true }, { key: "upi", label: "UPI", type: "money", total: true }, { key: "card", label: "Card", type: "money", total: true }, { key: "other", label: "Bank / other", type: "money", total: true }, { key: "refunds", label: "Refunds", type: "money", total: true }, { key: "expenses", label: "Expenses", type: "money", total: true }, { key: "net", label: "Net", type: "money", total: true }],
    run: (c) => rows(sql`
      with days as (select generate_series(${c.from}::date, ${c.to}::date, interval '1 day')::date as d),
      p as (select ${day("p.received_at")} as d, p.payment_method as m, sum(p.amount) as amt from payments p where p.organization_id = ${c.auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at", c)} ${br(c, "p.branch_id")} group by 1, 2),
      r as (select ${day("r.created_at")} as d, sum(r.amount) as amt from refunds r join payments p on p.id = r.payment_id where r.organization_id = ${c.auth.orgId} and r.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("r.created_at", c)} ${br(c, "p.branch_id")} group by 1),
      e as (select e.spent_on::date as d, sum(e.amount) as amt from expenses e where e.organization_id = ${c.auth.orgId} and e.voided_at is null and e.spent_on::date between ${c.from}::date and ${c.to}::date ${br(c, "e.branch_id")} group by 1)
      select days.d as date,
        coalesce((select amt from p where p.d = days.d and m = 'cash'),0) as cash,
        coalesce((select amt from p where p.d = days.d and m = 'upi'),0) as upi,
        coalesce((select amt from p where p.d = days.d and m = 'card'),0) as card,
        coalesce((select sum(amt) from p where p.d = days.d and m not in ('cash','upi','card')),0) as other,
        coalesce((select amt from r where r.d = days.d),0) as refunds,
        coalesce((select amt from e where e.d = days.d),0) as expenses,
        coalesce((select sum(amt) from p where p.d = days.d),0) - coalesce((select amt from r where r.d = days.d),0) - coalesce((select amt from e where e.d = days.d),0) as net
      from days order by days.d desc`),
  },
  {
    key: "payment-methods", group: "Money", title: "Payment methods", description: "Collections by payment method", perm: "reports.financial", usesDates: true,
    columns: [{ key: "method", label: "Method", type: "text" }, { key: "payments", label: "Payments", type: "int", total: true }, { key: "amount", label: "Amount", type: "money", total: true }],
    run: (c) => rows(sql`select initcap(replace(p.payment_method, '_', ' ')) as method, count(*)::int as payments, sum(p.amount) as amount from payments p
      where p.organization_id = ${c.auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at", c)} ${br(c, "p.branch_id")} group by p.payment_method order by amount desc`),
  },
  {
    key: "expenses-category", group: "Money", title: "Expenses by category", description: "Where the money goes", perm: "reports.financial", usesDates: true,
    columns: [{ key: "category", label: "Category", type: "text" }, { key: "entries", label: "Entries", type: "int", total: true }, { key: "amount", label: "Amount", type: "money", total: true }],
    run: (c) => rows(sql`select e.category, count(*)::int as entries, sum(e.amount) as amount from expenses e
      where e.organization_id = ${c.auth.orgId} and e.voided_at is null and e.spent_on::date between ${c.from}::date and ${c.to}::date ${br(c, "e.branch_id")} group by 1 order by amount desc`),
  },
  {
    key: "dues", group: "Money", title: "Customers with dues", description: "Who owes money right now, and for how long", perm: "reports.financial",
    columns: [{ key: "customer", label: "Customer", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "invoices", label: "Open invoices", type: "int", total: true }, { key: "oldest_days", label: "Oldest (days)", type: "int" }, { key: "due", label: "Amount due", type: "money", total: true }],
    run: (c) => rows(sql`
      select cu.name as customer, cu.phone, count(*)::int as invoices, max(extract(day from now() - i.issued_at))::int as oldest_days, sum(i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql}) as due
      from invoices i join customers cu on cu.id = i.customer_id
      where i.organization_id = ${c.auth.orgId} and i.status <> 'cancelled' and i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql} > 0 ${br(c, "i.branch_id")}
      group by cu.id, cu.name, cu.phone order by due desc limit 1000`),
  },
  // ---------------- customers
  {
    key: "top-customers", group: "Customers", title: "Top customers", description: "Best customers by billed value in the period", perm: "reports.financial", usesDates: true,
    columns: [{ key: "customer", label: "Customer", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "orders", label: "Orders", type: "int", total: true }, { key: "billed", label: "Billed", type: "money", total: true }, { key: "last_order", label: "Last order", type: "date" }],
    run: (c) => rows(sql`
      select cu.name as customer, cu.phone, count(distinct o.id)::int as orders, sum(i.grand_total) as billed, max(${day("o.received_at")}) as last_order
      from orders o join customers cu on cu.id = o.customer_id join invoices i on i.order_id = o.id and i.status <> 'cancelled'
      where o.organization_id = ${c.auth.orgId} and ${inRange("o.received_at", c)} ${br(c, "o.branch_id")}
      group by cu.id, cu.name, cu.phone order by billed desc limit 100`),
  },
  {
    key: "inactive-customers", group: "Customers", title: "Inactive customers", description: "Customers who have not visited for a while: win them back", perm: "customers.read",
    columns: [{ key: "customer", label: "Customer", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "orders", label: "Lifetime orders", type: "int" }, { key: "last_order", label: "Last order", type: "date" }, { key: "days_away", label: "Days away", type: "int" }],
    run: (c) => rows(sql`
      select * from (
        select cu.name as customer, cu.phone, count(o.id)::int as orders, max(${day("o.received_at")}) as last_order, (current_date - max(${day("o.received_at")}))::int as days_away
        from customers cu join orders o on o.customer_id = cu.id
        where cu.organization_id = ${c.auth.orgId} and cu.status = 'active' ${br(c, "o.branch_id")}
        group by cu.id, cu.name, cu.phone
      ) x where x.days_away >= ${c.days} order by x.orders desc, x.days_away limit 1000`),
  },
  {
    key: "new-customers", group: "Customers", title: "New customers", description: "Customers added in the period and what they ordered", perm: "customers.read", usesDates: true,
    columns: [{ key: "added", label: "Added", type: "date" }, { key: "customer", label: "Customer", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "orders", label: "Orders", type: "int", total: true }],
    run: (c) => rows(sql`
      select ${day("cu.created_at")} as added, cu.name as customer, cu.phone, (select count(*)::int from orders o where o.customer_id = cu.id) as orders
      from customers cu where cu.organization_id = ${c.auth.orgId} and ${inRange("cu.created_at", c)} ${br(c, "cu.home_branch_id")} order by cu.created_at desc`),
  },
  // ---------------- operations
  {
    key: "pending-register", group: "Operations", title: "Garments pending register", description: "Garments still in the shop by stage and how long they have waited", perm: "orders.read",
    columns: [{ key: "stage", label: "Stage", type: "text" }, { key: "d0_2", label: "0–2 days", type: "int", total: true }, { key: "d3_7", label: "3–7 days", type: "int", total: true }, { key: "d8_14", label: "8–14 days", type: "int", total: true }, { key: "d15", label: "15+ days", type: "int", total: true }, { key: "total", label: "Total", type: "int", total: true }],
    run: (c) => rows(sql`
      select initcap(replace(g.current_status, '_', ' ')) as stage,
        count(*) filter (where now() - g.created_at < interval '3 days')::int as d0_2,
        count(*) filter (where now() - g.created_at >= interval '3 days' and now() - g.created_at < interval '8 days')::int as d3_7,
        count(*) filter (where now() - g.created_at >= interval '8 days' and now() - g.created_at < interval '15 days')::int as d8_14,
        count(*) filter (where now() - g.created_at >= interval '15 days')::int as d15, count(*)::int as total
      from garments g where g.organization_id = ${c.auth.orgId} and g.current_status not in ('delivered','cancelled') ${br(c, "g.current_branch_id")}
      group by g.current_status order by total desc`),
  },
  {
    key: "cancelled-orders", group: "Operations", title: "Cancelled orders", description: "Orders cancelled in the period, with the reason", perm: "orders.read", usesDates: true,
    columns: [{ key: "date", label: "Cancelled", type: "datetime" }, { key: "order", label: "Order", type: "text" }, { key: "customer", label: "Customer", type: "text" }, { key: "reason", label: "Reason", type: "text" }, { key: "value", label: "Value", type: "money", total: true }],
    run: (c) => rows(sql`
      select o.cancelled_at as date, o.order_number as order, cu.name as customer, coalesce(o.cancel_reason, '') as reason, o.grand_total as value
      from orders o join customers cu on cu.id = o.customer_id
      where o.organization_id = ${c.auth.orgId} and o.cancelled_at is not null and ${inRange("o.cancelled_at", c)} ${br(c, "o.branch_id")} order by o.cancelled_at desc`),
  },
  // ---------------- staff
  {
    key: "staff-productivity", group: "Staff", title: "Staff productivity", description: "Orders taken, garments moved, quality checks and money collected by each person", perm: "reports.financial", usesDates: true,
    columns: [{ key: "staff", label: "Staff", type: "text" }, { key: "orders", label: "Orders taken", type: "int", total: true }, { key: "garment_moves", label: "Garment steps", type: "int", total: true }, { key: "qc", label: "QC checks", type: "int", total: true }, { key: "payments", label: "Payments", type: "int", total: true }, { key: "collected", label: "Collected", type: "money", total: true }],
    run: (c) => rows(sql`
      select u.name as staff,
        (select count(*)::int from orders o where o.created_by = u.id and o.organization_id = ${c.auth.orgId} and ${inRange("o.received_at", c)} ${br(c, "o.branch_id")}) as orders,
        (select count(*)::int from garment_status_history h where h.actor_user_id = u.id and h.organization_id = ${c.auth.orgId} and ${inRange("h.occurred_at", c)} ${br(c, "h.branch_id")}) as garment_moves,
        (select count(*)::int from quality_inspections q where q.inspector_user_id = u.id and q.organization_id = ${c.auth.orgId} and ${inRange("q.created_at", c)}) as qc,
        (select count(*)::int from payments p where p.created_by = u.id and p.organization_id = ${c.auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at", c)} ${br(c, "p.branch_id")}) as payments,
        coalesce((select sum(p.amount) from payments p where p.created_by = u.id and p.organization_id = ${c.auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at", c)} ${br(c, "p.branch_id")}),0) as collected
      from organization_memberships m join users u on u.id = m.user_id where m.organization_id = ${c.auth.orgId}
      order by orders desc, garment_moves desc`),
  },
  {
    key: "user-activity", group: "Staff", title: "User activity & sign-ins", description: "Sign-ins and recorded actions for each person", perm: "audit.view", usesDates: true,
    columns: [{ key: "staff", label: "Staff", type: "text" }, { key: "sign_ins", label: "Sign-ins", type: "int", total: true }, { key: "failed", label: "Failed sign-ins", type: "int", total: true }, { key: "actions", label: "Actions", type: "int", total: true }, { key: "last_seen", label: "Last activity", type: "datetime" }],
    run: (c) => rows(sql`
      select u.name as staff,
        count(a.id) filter (where a.action = 'auth.login')::int as sign_ins,
        count(a.id) filter (where a.action = 'auth.login_failed')::int as failed,
        count(a.id) filter (where a.action not like 'auth.%')::int as actions,
        max(a.created_at) as last_seen
      from organization_memberships m join users u on u.id = m.user_id
      left join audit_logs a on a.actor_user_id = u.id and a.organization_id = ${c.auth.orgId} and ${inRange("a.created_at", c)}
      where m.organization_id = ${c.auth.orgId} group by u.id, u.name order by actions desc`),
  },
];

export async function reportsCenterRoutes(app: FastifyInstance) {
  app.get("/reports/catalogue", async (req) => {
    const auth = requirePermission(req, "reports.view");
    return REPORTS.filter((r) => can(auth, r.perm)).map(({ key, group, title, description, columns, usesDates }) => ({ key, group, title, description, columns, usesDates: Boolean(usesDates) }));
  });

  app.get("/reports/run/:key", async (req) => {
    const auth = requirePermission(req, "reports.view");
    const { key } = z.object({ key: z.string().max(40) }).parse(req.params);
    const report = REPORTS.find((r) => r.key === key);
    if (!report) throw notFound("Report");
    if (!can(auth, report.perm)) throw forbidden("You do not have access to this report");
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const q = z.object({ from: z.iso.date().default(today), to: z.iso.date().default(today), branchId: z.uuid().optional(), days: z.coerce.number().int().min(7).max(730).default(60) }).parse(req.query);
    if (q.from > q.to) throw badRequest("The start date must be before the end date");
    if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 731) throw badRequest("Choose a period of at most two years");
    const data = await report.run({ auth, from: q.from, to: q.to, branchId: q.branchId, days: q.days });
    const moneyLike = (t: ColType) => t === "money" || t === "int";
    const normalised = data.map((r) => Object.fromEntries(report.columns.map((col) => [col.key, moneyLike(col.type) && r[col.key] != null ? Number(r[col.key]) : r[col.key] ?? null])));
    const totals = report.columns.some((c) => c.total)
      ? Object.fromEntries(report.columns.filter((c) => c.total).map((c) => [c.key, normalised.reduce((s, r) => s + Number(r[c.key] ?? 0), 0)]))
      : null;
    return { key, title: report.title, description: report.description, columns: report.columns, rows: normalised, totals, range: { from: q.from, to: q.to } };
  });
}
