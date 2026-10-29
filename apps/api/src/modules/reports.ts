import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { dateRangeQuery, expenseSchema } from "@drycare/shared";
import { db, schema } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit } from "../lib/audit";
import { badRequest, notFound, unprocessable } from "../lib/errors";
import { invoiceCreditSql, invoicePaidSql } from "../lib/balances";
import { assertDrawerCash, openShiftFor } from "./payments";

/**
 * Metric definitions (FR-REP-006, SRS C01). Every dashboard figure uses exactly one of these:
 *  - Gross billed sales: Σ invoice grand_total (incl. tax) for non-cancelled invoices issued in range.
 *  - Net sales: gross billed − tax, i.e. taxable value of non-cancelled invoices issued in range.
 *  - Collections: Σ succeeded payments received in range − Σ refunds issued in range.
 *  - Outstanding receivables: Σ (grand_total − paid) over all non-cancelled invoices, as of now.
 *  - Expenses: Σ expenses with spent_on in range. Profit is NOT shown (needs full cost rules).
 *  - Rework rate: failed inspections ÷ all inspections in range.
 */
export const METRIC_DEFINITIONS = {
  grossBilled: "Total of non-cancelled invoices (incl. GST) issued in the period",
  netSales: "Gross billed minus GST: taxable value of non-cancelled invoices issued in the period",
  collections: "Payments received in the period minus refunds issued in the period",
  outstanding: "Unpaid balance across all open invoices right now",
  expenses: "Expenses recorded with a date in the period",
  reworkRate: "Failed inspections as a share of all inspections in the period",
};

function range(q: { from?: string; to?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const from = q.from ?? today;
  const to = q.to ?? today;
  return { from, to };
}

export function branchSql(auth: AuthContext, column: string, branchId?: string) {
  if (branchId) {
    assertBranchAccess(auth, branchId);
    return sql`and ${sql.raw(column)} = ${branchId}`;
  }
  if (auth.branchIds.length) return sql`and ${sql.raw(column)} = any(${`{${auth.branchIds.join(",")}}`}::uuid[])`;
  return sql``;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (req) => {
    const auth = requirePermission(req, "reports.view");
    const q = dateRangeQuery.parse(req.query);
    const { from, to } = range(q);
    const financial = can(auth, "reports.financial");
    const inv = branchSql(auth, "i.branch_id", q.branchId);
    const ord = branchSql(auth, "o.branch_id", q.branchId);
    const pay = branchSql(auth, "p.branch_id", q.branchId);
    const gar = branchSql(auth, "g.current_branch_id", q.branchId);
    const exp = branchSql(auth, "e.branch_id", q.branchId);
    const tz = "Asia/Kolkata";
    const inRange = (col: string) => sql`(${sql.raw(col)} at time zone ${tz})::date between ${from}::date and ${to}::date`;

    const [sales] = await db.execute<Record<string, string>>(sql`
      with billed as (
        select coalesce(sum(i.grand_total),0) as gross, coalesce(sum(i.grand_total - i.tax_total),0) as net,
               coalesce(sum(i.tax_total),0) as tax, coalesce(sum(i.discount_total),0) as discounts, count(*)::int as invoices
        from invoices i where i.organization_id = ${auth.orgId} and i.status <> 'cancelled' and ${inRange("i.issued_at")} ${inv}
      ),
      -- Collection discounts are credit notes dated when issued; they reduce sales and GST in that period.
      credited as (
        select coalesce(sum(cn.total_amount),0) as total, coalesce(sum(cn.taxable_amount),0) as taxable, coalesce(sum(cn.tax_amount),0) as tax
        from credit_notes cn join invoices i on i.id = cn.invoice_id
        where cn.organization_id = ${auth.orgId} and cn.status = 'issued' and i.status <> 'cancelled' and ${inRange("cn.created_at")} ${inv}
      )
      select b.gross - c.total as gross_billed, b.net - c.taxable as net_sales, b.tax - c.tax as tax,
             b.discounts + c.taxable as discounts, b.invoices
      from billed b, credited c`);
    const [coll] = await db.execute<Record<string, string>>(sql`
      select coalesce((select sum(p.amount) from payments p where p.organization_id = ${auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at")} ${pay}),0) as collected,
             coalesce((select sum(r.amount) from refunds r join payments p on p.id = r.payment_id where r.organization_id = ${auth.orgId} and r.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("r.created_at")} ${pay}),0) as refunded`);
    const [recv] = await db.execute<Record<string, string>>(sql`
      select coalesce(sum(i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql}),0) as outstanding,
             count(*) filter (where i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql} > 0)::int as open_invoices
      from invoices i where i.organization_id = ${auth.orgId} and i.status <> 'cancelled' ${inv}`);
    const [ops] = await db.execute<Record<string, number>>(sql`
      select count(*) filter (where ${inRange("o.received_at")})::int as orders_received,
             count(*) filter (where o.closed_at is not null and ${inRange("o.closed_at")})::int as orders_completed,
             count(*) filter (where o.operational_status in ('ready','partially_ready'))::int as ready_orders,
             count(*) filter (where o.promised_at < now() and o.operational_status in ('received','in_processing','partially_ready'))::int as overdue_orders
      from orders o where o.organization_id = ${auth.orgId} ${ord}`);
    const [gstat] = await db.execute<Record<string, number>>(sql`
      select count(*) filter (where g.current_status not in ('ready','dispatched','delivered','cancelled'))::int as awaiting_processing,
             count(*) filter (where g.current_status = 'ready')::int as ready_garments,
             count(*) filter (where g.current_status = 'exception')::int as exceptions
      from garments g where g.organization_id = ${auth.orgId} ${gar}`);
    const [qc] = await db.execute<Record<string, number>>(sql`
      select count(*)::int as inspections, count(*) filter (where qi.outcome = 'fail')::int as failed
      from quality_inspections qi join garments g on g.id = qi.garment_id
      where qi.organization_id = ${auth.orgId} and ${inRange("qi.created_at")} ${gar}`);
    const [ex] = await db.execute<Record<string, string>>(sql`
      select coalesce(sum(e.amount),0) as expenses from expenses e where e.organization_id = ${auth.orgId} and e.voided_at is null and e.spent_on::date between ${from}::date and ${to}::date ${exp}`);
    const daily = await db.execute(sql`
      with days as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as d)
      select d as day,
        coalesce((select sum(i.grand_total) from invoices i where i.organization_id = ${auth.orgId} and i.status <> 'cancelled' and (i.issued_at at time zone ${tz})::date = d ${inv}),0) as billed,
        coalesce((select sum(p.amount) from payments p where p.organization_id = ${auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and (p.received_at at time zone ${tz})::date = d ${pay}),0) as collected,
        coalesce((select sum(e.amount) from expenses e where e.organization_id = ${auth.orgId} and e.voided_at is null and e.spent_on::date = d ${exp}),0) as expenses,
        coalesce((select sum(lo.total) from laundry_orders lo where lo.organization_id = ${auth.orgId} and lo.status <> 'cancelled' and (lo.created_at at time zone ${tz})::date = d ${branchSql(auth, "lo.branch_id", q.branchId)}),0) as laundry
      from days order by d`);
    const branches = await db.execute(sql`
      select b.id, b.name, b.branch_code,
        coalesce((select sum(i.grand_total) from invoices i where i.branch_id = b.id and i.status <> 'cancelled' and ${inRange("i.issued_at")}),0) as billed,
        coalesce((select sum(p.amount) from payments p where p.branch_id = b.id and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at")}),0) as collected,
        (select count(*)::int from orders o where o.branch_id = b.id and ${inRange("o.received_at")}) as orders,
        coalesce((select sum(lo.total) from laundry_orders lo where lo.branch_id = b.id and lo.status <> 'cancelled' and ${inRange("lo.created_at")}),0) as laundry,
        coalesce((select sum(i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql}) from invoices i where i.branch_id = b.id and i.status <> 'cancelled'),0) as outstanding
      from branches b where b.organization_id = ${auth.orgId} ${branchSql(auth, "b.id", q.branchId)} order by b.created_at`);

    // Same-length period just before the selected one, for the "vs previous period" changes.
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const prevTo = new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10);
    const prevFrom = new Date(Date.parse(from) - days * 86_400_000).toISOString().slice(0, 10);
    const inPrev = (col: string) => sql`(${sql.raw(col)} at time zone ${tz})::date between ${prevFrom}::date and ${prevTo}::date`;
    const [prev] = await db.execute<Record<string, string>>(sql`
      select coalesce((select sum(i.grand_total) from invoices i where i.organization_id = ${auth.orgId} and i.status <> 'cancelled' and ${inPrev("i.issued_at")} ${inv}),0) as gross,
             coalesce((select sum(p.amount) from payments p where p.organization_id = ${auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inPrev("p.received_at")} ${pay}),0)
               - coalesce((select sum(r.amount) from refunds r join payments p on p.id = r.payment_id where r.organization_id = ${auth.orgId} and r.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inPrev("r.created_at")} ${pay}),0) as collections,
             coalesce((select sum(e.amount) from expenses e where e.organization_id = ${auth.orgId} and e.voided_at is null and e.spent_on::date between ${prevFrom}::date and ${prevTo}::date ${exp}),0) as expenses,
             (select count(*)::int from orders o where o.organization_id = ${auth.orgId} and ${inPrev("o.received_at")} ${ord}) as orders`);
    const [laundry] = await db.execute<Record<string, string>>(sql`
      select coalesce(sum(lo.total),0) as billed, count(*)::int as orders from laundry_orders lo
      where lo.organization_id = ${auth.orgId} and lo.status <> 'cancelled' and ${inRange("lo.created_at")} ${branchSql(auth, "lo.branch_id", q.branchId)}`);
    const garmentStatus = await db.execute<{ status: string; count: number }>(sql`
      select g.current_status as status, count(*)::int as count from garments g
      where g.organization_id = ${auth.orgId} and g.current_status not in ('delivered','cancelled') ${gar}
      group by g.current_status`);
    const [delivered] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from garments g where g.organization_id = ${auth.orgId} and g.current_status = 'delivered' and ${inRange("g.updated_at")} ${gar}`);
    // Counter-wise takings: who collected the money, at which branch, by payment method.
    const counters = await db.execute<Record<string, string | number>>(sql`
      select p.branch_id as "branchId", b.name as "branchName", p.created_by as "userId", coalesce(u.name, 'Unknown') as "staffName",
        count(*)::int as payments, coalesce(sum(p.amount),0) as total,
        coalesce(sum(p.amount) filter (where p.payment_method = 'cash'),0) as cash,
        coalesce(sum(p.amount) filter (where p.payment_method = 'upi'),0) as upi,
        coalesce(sum(p.amount) filter (where p.payment_method = 'card'),0) as card,
        coalesce(sum(p.amount) filter (where p.payment_method not in ('cash','upi','card')),0) as other
      from payments p join branches b on b.id = p.branch_id left join users u on u.id = p.created_by
      where p.organization_id = ${auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at")} ${pay}
      group by p.branch_id, b.name, p.created_by, u.name order by total desc`);
    const methods = await db.execute<{ method: string; total: string; count: number }>(sql`
      select p.payment_method as method, coalesce(sum(p.amount),0) as total, count(*)::int as count from payments p
      where p.organization_id = ${auth.orgId} and p.status = 'succeeded' and p.payment_method <> 'store_credit' and ${inRange("p.received_at")} ${pay}
      group by p.payment_method order by total desc`);

    const collected = Number(coll.collected);
    const refunded = Number(coll.refunded);
    return {
      range: { from, to },
      definitions: METRIC_DEFINITIONS,
      financialVisible: financial,
      sales: financial
        ? { grossBilled: Number(sales.gross_billed), netSales: Number(sales.net_sales), tax: Number(sales.tax), discounts: Number(sales.discounts), invoices: Number(sales.invoices) }
        : null,
      collections: financial ? { collected, refunded, net: collected - refunded } : null,
      receivables: financial ? { outstanding: Number(recv.outstanding), openInvoices: Number(recv.open_invoices) } : null,
      expenses: financial ? Number(ex.expenses) : null,
      operations: { ...ops, ...gstat, reworkRate: qc.inspections ? qc.failed / qc.inspections : 0, inspections: qc.inspections },
      daily: financial ? daily.map((d) => ({ day: d.day, billed: Number(d.billed), collected: Number(d.collected), expenses: Number(d.expenses), laundry: Number(d.laundry) })) : [],
      branches: financial ? branches.map((b) => ({ ...b, billed: Number(b.billed), collected: Number(b.collected), laundry: Number(b.laundry), outstanding: Number(b.outstanding) })) : [],
      previous: financial ? { from: prevFrom, to: prevTo, grossBilled: Number(prev.gross), collections: Number(prev.collections), expenses: Number(prev.expenses), orders: Number(prev.orders) } : { from: prevFrom, to: prevTo, orders: Number(prev.orders) },
      laundry: financial ? { billed: Number(laundry.billed), orders: Number(laundry.orders) } : null,
      garmentStatus: [...garmentStatus, { status: "delivered", count: delivered.count }],
      counters: financial ? counters.map((c) => ({ ...c, total: Number(c.total), cash: Number(c.cash), upi: Number(c.upi), card: Number(c.card), other: Number(c.other) })) : [],
      paymentMethods: financial ? methods.map((m) => ({ method: m.method, total: Number(m.total), count: m.count })) : [],
    };
  });

  app.get("/reports/sales", async (req) => {
    const auth = requirePermission(req, "reports.financial");
    const q = dateRangeQuery.extend({ groupBy: z.enum(["service", "garment", "branch", "day"]).default("service") }).parse(req.query);
    const { from, to } = range(q);
    const key = { service: "oi.service_name", garment: "oi.garment_type_name", branch: "b.name", day: "(i.issued_at at time zone 'Asia/Kolkata')::date::text" }[q.groupBy];
    return db.execute(sql`
      select ${sql.raw(key)} as label, sum(oi.quantity)::int as quantity, sum(oi.line_total) as total, sum(oi.tax_amount) as tax, sum(oi.discount_amount) as discount, count(distinct o.id)::int as orders
      from order_items oi join orders o on o.id = oi.order_id join invoices i on i.order_id = o.id join branches b on b.id = o.branch_id
      where o.organization_id = ${auth.orgId} and i.status <> 'cancelled'
        and (i.issued_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date ${branchSql(auth, "o.branch_id", q.branchId)}
      group by 1 order by total desc`);
  });

  app.get("/reports/receivables", async (req) => {
    const auth = requirePermission(req, "reports.financial");
    const q = dateRangeQuery.parse(req.query);
    return db.execute(sql`
      select * from (
        select i.id, i.invoice_number, o.id as order_id, o.order_number, c.name as customer_name, c.phone, i.issued_at, i.grand_total,
               i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql} as balance,
               extract(day from now() - i.issued_at)::int as age_days
        from invoices i join orders o on o.id = i.order_id join customers c on c.id = i.customer_id
        where i.organization_id = ${auth.orgId} and i.status <> 'cancelled' ${branchSql(auth, "i.branch_id", q.branchId)}
      ) x where x.balance > 0 order by x.age_days desc limit 500`);
  });

  // ---------------- expenses
  app.get("/expenses", async (req) => {
    const auth = requirePermission(req, "expenses.manage");
    const q = dateRangeQuery.extend({
      category: z.string().trim().max(60).optional(),
      search: z.string().trim().max(80).optional(),
      includeVoided: z.enum(["true", "false"]).default("true"),
    }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const term = q.search ? `%${q.search}%` : null;
    const where = and(
      eq(schema.expenses.organizationId, auth.orgId),
      q.branchId ? eq(schema.expenses.branchId, q.branchId) : auth.branchIds.length ? inArray(schema.expenses.branchId, auth.branchIds) : undefined,
      q.from ? sql`${schema.expenses.spentOn}::date >= ${q.from}::date` : undefined,
      q.to ? sql`${schema.expenses.spentOn}::date <= ${q.to}::date` : undefined,
      q.category ? eq(schema.expenses.category, q.category) : undefined,
      term ? sql`(${schema.expenses.description} ilike ${term} or ${schema.expenses.vendor} ilike ${term} or ${schema.expenses.reference} ilike ${term})` : undefined,
      q.includeVoided === "false" ? isNull(schema.expenses.voidedAt) : undefined,
    );
    return db
      .select({ e: schema.expenses, branchCode: schema.branches.branchCode, createdByName: schema.users.name })
      .from(schema.expenses)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.expenses.branchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.expenses.createdBy))
      .where(where)
      .orderBy(desc(schema.expenses.spentOn), desc(schema.expenses.createdAt))
      .limit(1000);
  });

  app.post("/expenses", async (req, reply) => {
    const auth = requirePermission(req, "expenses.manage");
    const { paidFromDrawer, ...body } = expenseSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const b = await db.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
    if (!b) throw notFound("Branch");
    if (body.spentOn > new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)) throw badRequest("Expense date cannot be in the future");
    if (paidFromDrawer && body.method !== "cash") throw badRequest("Only cash expenses can be paid from the cash drawer");
    const row = await db.transaction(async (tx) => {
      let shiftId: string | null = null;
      if (paidFromDrawer) {
        const shift = await openShiftFor(tx, auth, body.branchId);
        if (!shift) throw unprocessable("Open a cashier shift at this branch to pay from the cash drawer", "NO_OPEN_SHIFT");
        await assertDrawerCash(tx, shift, body.amount);
        shiftId = shift.id;
      }
      const [e] = await tx.insert(schema.expenses).values({ organizationId: auth.orgId, ...body, vendor: body.vendor || null, reference: body.reference || null, shiftId, createdBy: auth.userId }).returning();
      await audit(tx, req, { action: "expense.recorded", resourceType: "expense", resourceId: e.id, after: { amount: e.amount, category: e.category, fromDrawer: Boolean(shiftId) } });
      return e;
    });
    reply.code(201);
    return row;
  });

  /** Mistakes are voided, never deleted, so totals stay explainable. A drawer expense can only be voided while its shift is open. */
  app.post("/expenses/:id/void", async (req) => {
    const auth = requirePermission(req, "expenses.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.expenses).where(and(eq(schema.expenses.id, id), eq(schema.expenses.organizationId, auth.orgId))).for("update");
      if (!row) throw notFound("Expense");
      assertBranchAccess(auth, row.branchId);
      if (row.voidedAt) throw unprocessable("This expense is already voided", "ALREADY_VOIDED");
      if (row.shiftId) {
        const shift = await tx.query.cashierShifts.findFirst({ where: eq(schema.cashierShifts.id, row.shiftId) });
        if (shift?.status !== "open") throw unprocessable("This cash was paid during a shift that is now closed. Record a correcting entry instead.", "SHIFT_CLOSED");
      }
      const [updated] = await tx.update(schema.expenses).set({ voidedAt: new Date(), voidedBy: auth.userId, voidReason: reason }).where(eq(schema.expenses.id, id)).returning();
      await audit(tx, req, { action: "expense.voided", resourceType: "expense", resourceId: id, before: { amount: row.amount, category: row.category }, after: { reason } });
      return updated;
    });
  });

  app.get("/notifications", async (req) => {
    const auth = requirePermission(req, "reports.view");
    return db.query.notificationJobs.findMany({ where: eq(schema.notificationJobs.organizationId, auth.orgId), orderBy: desc(schema.notificationJobs.createdAt), limit: 100 });
  });
}
