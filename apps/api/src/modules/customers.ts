import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, or, sql, ne } from "drizzle-orm";
import { z } from "zod";
import { addressSchema, customerSchema, customerUpdateSchema } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { can, requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { conflict, notFound, badRequest } from "../lib/errors";
import { nextNumber, pad } from "../lib/sequences";
import { customerBalances, invoiceCreditSql, invoicePaidSql } from "../lib/balances";

/** Phone numbers are normalized to their last 10 digits for search and duplicate detection (Indian mobiles). */
export const normalizePhone = (p?: string | null) => {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
};

const idParam = z.object({ customerId: z.uuid() });
const customerDuplicateMatchesSchema = z.array(z.enum(["phone", "email"])).default(["phone"]);

function branchFilter(auth: { branchIds: string[] }, alias: string) {
  return auth.branchIds.length
    ? sql`and ${sql.raw(alias)}.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])`
    : sql``;
}

async function findCustomerDuplicate(
  queryDb: DbOrTx,
  orgId: string,
  rules: ("phone" | "email")[],
  values: { phone?: string | null; email?: string | null },
  excludeId?: string,
) {
  const phoneNormalized = normalizePhone(values.phone);
  const email = values.email?.trim().toLowerCase();
  if ((!rules.includes("phone") || !phoneNormalized) && (!rules.includes("email") || !email)) return undefined;
  return queryDb.query.customers.findFirst({
    where: and(
      eq(schema.customers.organizationId, orgId),
      ne(schema.customers.status, "merged"),
      excludeId ? ne(schema.customers.id, excludeId) : undefined,
      or(
        rules.includes("phone") && phoneNormalized ? eq(schema.customers.phoneNormalized, phoneNormalized) : undefined,
        rules.includes("email") && email ? sql`lower(${schema.customers.email}) = ${email}` : undefined,
      ),
    ),
  });
}

async function getCustomer(orgId: string, customerId: string) {
  const c = await db.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.organizationId, orgId)) });
  if (!c) throw notFound("Customer");
  return c;
}

export async function customerRoutes(app: FastifyInstance) {
  app.get("/customers", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const q = z
      .object({
        q: z.string().trim().max(80).optional(),
        customerType: z.enum(["walk_in", "regular", "vip", "corporate", "online"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
        includeInactive: z.coerce.boolean().default(false),
      })
      .parse(req.query);
    const term = q.q;
    const digits = term?.replace(/\D/g, "");
    const where = and(
      eq(schema.customers.organizationId, auth.orgId),
      ne(schema.customers.status, "merged"),
      q.includeInactive ? undefined : eq(schema.customers.status, "active"),
      q.customerType ? eq(schema.customers.customerType, q.customerType) : undefined,
      term
        ? or(
            ilike(schema.customers.name, `%${term}%`),
            ilike(schema.customers.customerCode, `%${term}%`),
            ilike(schema.customers.email, `%${term}%`),
            digits && digits.length >= 3 ? sql`${schema.customers.phoneNormalized} like ${"%" + digits + "%"}` : undefined,
            sql`exists (select 1 from orders o where o.customer_id = ${schema.customers.id} and o.organization_id = ${auth.orgId} and o.order_number ilike ${term})`,
          )
        : undefined,
    );
    const financialVisible = can(auth, "reports.financial");
    const rows = await db
      .select({
        id: schema.customers.id,
        customerCode: schema.customers.customerCode,
        name: schema.customers.name,
        phone: schema.customers.phone,
        email: schema.customers.email,
        customerType: schema.customers.customerType,
        status: schema.customers.status,
        totalOrders: sql<number>`(select count(*)::int from orders o where o.customer_id = "customers"."id" and o.organization_id = ${auth.orgId} ${branchFilter(auth, "o")})`,
        lastOrderAt: sql<string | null>`(select max(o.received_at) from orders o where o.customer_id = "customers"."id" and o.organization_id = ${auth.orgId} ${branchFilter(auth, "o")})`,
      })
      .from(schema.customers)
      .where(where)
      .orderBy(desc(schema.customers.updatedAt))
      .limit(q.limit)
      .offset(q.offset);
    const balances = financialVisible ? await customerBalances(db, auth.orgId, rows.map((r) => r.id), auth.branchIds) : new Map<string, number>();
    return {
      items: rows.map((r) => ({ ...r, ...(financialVisible ? { outstanding: balances.get(r.id) ?? 0 } : {}) })),
      financialVisible,
      limit: q.limit,
      offset: q.offset,
    };
  });

  app.post("/customers", async (req, reply) => {
    const auth = requirePermission(req, "customers.write");
    const body = customerSchema.parse(req.body);
    const force = z.object({ force: z.coerce.boolean().default(false) }).parse(req.query).force;
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { settings: true } });
    const duplicateRules = customerDuplicateMatchesSchema.parse(org?.settings.customerDuplicateMatch);
    const phoneNormalized = normalizePhone(body.phone);
    if (!force) {
      const duplicate = await findCustomerDuplicate(db, auth.orgId, duplicateRules, body);
      if (duplicate) {
        throw Object.assign(conflict(`A customer with matching details already exists: ${duplicate.name} (${duplicate.customerCode})`, "POSSIBLE_DUPLICATE"), { details: [{ customerId: duplicate.id }] });
      }
    }
    const created = await db.transaction(async (tx) => {
      const n = await nextNumber(tx, auth.orgId, "customer");
      const [c] = await tx
        .insert(schema.customers)
        .values({
          organizationId: auth.orgId,
          customerCode: `C-${pad(n)}`,
          name: body.name,
          phone: body.phone,
          phoneNormalized,
          alternatePhone: body.alternatePhone,
          email: body.email,
          gstin: body.gstin,
          customerType: body.customerType,
          preferredLanguage: body.preferredLanguage,
          careInstructions: body.careInstructions,
          notificationChannel: body.notificationChannel,
          marketingConsent: body.marketingConsent,
          marketingConsentAt: body.marketingConsent ? new Date() : null,
          notes: body.notes,
        })
        .returning();
      if (body.address) {
        await tx.insert(schema.customerAddresses).values({ organizationId: auth.orgId, customerId: c.id, label: body.address.label, address: stripAddress(body.address), isDefault: true });
      }
      await audit(tx, req, { action: "customer.created", resourceType: "customer", resourceId: c.id, after: { code: c.customerCode, name: c.name } });
      return c;
    });
    reply.code(201);
    return created;
  });

  app.get("/customers/:customerId", async (req) => {
    const auth = requirePermission(req, "customers.read");
    const { customerId } = idParam.parse(req.params);
    const c = await getCustomer(auth.orgId, customerId);
    const addresses = await db.query.customerAddresses.findMany({ where: and(eq(schema.customerAddresses.customerId, c.id), eq(schema.customerAddresses.organizationId, auth.orgId)) });
    const financialVisible = can(auth, "reports.financial");
    const stats = await db.execute<{ total_orders: number; total_billed: string; last_order_at: string | null; ready_orders: number; pending_orders: number }>(sql`
      select count(*)::int as total_orders,
             ${financialVisible ? sql`coalesce(sum(case when o.operational_status <> 'cancelled' then o.grand_total end),0)` : sql`0`} as total_billed,
             max(o.received_at) as last_order_at,
             count(*) filter (where o.operational_status in ('ready','partially_ready'))::int as ready_orders,
             count(*) filter (where o.operational_status in ('received','in_processing','partially_ready'))::int as pending_orders
      from orders o where o.customer_id = ${c.id} and o.organization_id = ${auth.orgId} ${branchFilter(auth, "o")}
    `);
    const balances = financialVisible ? await customerBalances(db, auth.orgId, [c.id], auth.branchIds) : new Map<string, number>();
    const s = stats[0];
    const totalOrders = Number(s.total_orders);
    const totalBilled = Number(s.total_billed);
    return {
      ...c,
      addresses,
      financialVisible,
      stats: {
        totalOrders,
        ...(financialVisible ? { totalBilled, averageOrderValue: totalOrders ? Math.round(totalBilled / totalOrders) : 0 } : {}),
        lastOrderAt: s.last_order_at,
        readyOrders: s.ready_orders,
        pendingOrders: s.pending_orders,
        ...(financialVisible ? { outstanding: balances.get(c.id) ?? 0 } : {}),
      },
    };
  });

  app.patch("/customers/:customerId", async (req) => {
    const auth = requirePermission(req, "customers.write");
    const { customerId } = idParam.parse(req.params);
    const body = customerUpdateSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const before = await getCustomer(auth.orgId, customerId);
      if (before.status === "merged") throw badRequest("Merged customers cannot be edited");
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { settings: true } });
      const duplicateRules = customerDuplicateMatchesSchema.parse(org?.settings.customerDuplicateMatch);
      const duplicate = await findCustomerDuplicate(tx, auth.orgId, duplicateRules, body, customerId);
      if (duplicate) {
        throw Object.assign(conflict(`A customer with matching details already exists: ${duplicate.name} (${duplicate.customerCode})`, "POSSIBLE_DUPLICATE"), { details: [{ customerId: duplicate.id }] });
      }
      const { address: _ignored, ...rest } = body;
      const [after] = await tx
        .update(schema.customers)
        .set({
          ...rest,
          gstin: body.gstin,
          phoneNormalized: body.phone !== undefined ? normalizePhone(body.phone) : undefined,
          marketingConsentAt: body.marketingConsent !== undefined && body.marketingConsent !== before.marketingConsent ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, customerId))
        .returning();
      if (body.address) {
        const defaultAddress = await tx.query.customerAddresses.findFirst({
          where: and(eq(schema.customerAddresses.customerId, customerId), eq(schema.customerAddresses.organizationId, auth.orgId), eq(schema.customerAddresses.isDefault, true)),
        });
        const addressValues = { label: body.address.label, address: stripAddress(body.address), isDefault: true, updatedAt: new Date() };
        if (defaultAddress) {
          await tx.update(schema.customerAddresses).set(addressValues).where(and(eq(schema.customerAddresses.id, defaultAddress.id), eq(schema.customerAddresses.organizationId, auth.orgId)));
        } else {
          await tx.insert(schema.customerAddresses).values({ organizationId: auth.orgId, customerId, ...addressValues });
        }
      }
      await audit(tx, req, { action: "customer.updated", resourceType: "customer", resourceId: customerId, before, after });
      return after;
    });
  });

  app.get("/customers/:customerId/orders", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { customerId } = idParam.parse(req.params);
    await getCustomer(auth.orgId, customerId);
    const financialVisible = can(auth, "reports.financial");
    const rows = await db.execute(sql`
      select o.id, o.order_number, o.operational_status, o.received_at, o.promised_at, o.grand_total,
             (select count(*)::int from garments g where g.order_id = o.id) as garment_count,
             coalesce((select sum(i.grand_total - ${invoiceCreditSql} - ${invoicePaidSql}) from invoices i where i.order_id = o.id and i.status <> 'cancelled'), 0) as balance
      from orders o where o.customer_id = ${customerId} and o.organization_id = ${auth.orgId} ${branchFilter(auth, "o")}
      order by o.received_at desc limit 200
    `);
    return financialVisible ? rows : rows.map(({ grand_total: _total, balance: _balance, ...row }) => row);
  });

  app.get("/customers/:customerId/payments", async (req) => {
    const auth = requirePermission(req, "customers.read", "reports.financial");
    const { customerId } = idParam.parse(req.params);
    await getCustomer(auth.orgId, customerId);
    return db.execute(sql`
      select p.id, p.payment_reference, p.payment_method, p.amount, p.status, p.received_at,
             coalesce((select sum(r.amount) from refunds r where r.payment_id = p.id), 0) as refunded,
             (select o.order_number from payment_allocations pa join invoices i on i.id = pa.invoice_id join orders o on o.id = i.order_id where pa.payment_id = p.id limit 1) as order_number
      from payments p where p.customer_id = ${customerId} and p.organization_id = ${auth.orgId}
        ${auth.branchIds.length ? sql`and p.branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])` : sql``}
      order by p.received_at desc limit 200
    `);
  });

  app.get("/customers/:customerId/garments", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { customerId } = idParam.parse(req.params);
    await getCustomer(auth.orgId, customerId);
    const garments = await db.execute(sql`
      select g.id, g.tag_code, g.current_status, g.created_at, g.updated_at, g.delivered_at,
             o.id as order_id, o.order_number, o.received_at,
             oi.garment_type_name, oi.service_name, oi.unit_price, oi.quantity, oi.colour, oi.brand
      from garments g
      join orders o on o.id = g.order_id and o.organization_id = g.organization_id
      join order_items oi on oi.id = g.order_item_id and oi.organization_id = g.organization_id
      where o.customer_id = ${customerId} and g.organization_id = ${auth.orgId} ${branchFilter(auth, "o")}
      order by g.created_at desc limit 500
    `);
    return can(auth, "reports.financial")
      ? garments
      : garments.map(({ unit_price: _unitPrice, ...garment }) => garment);
  });

  app.post("/customers/:customerId/addresses", async (req, reply) => {
    const auth = requirePermission(req, "customers.write");
    const { customerId } = idParam.parse(req.params);
    await getCustomer(auth.orgId, customerId);
    const body = addressSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      if (body.isDefault) await tx.update(schema.customerAddresses).set({ isDefault: false }).where(and(eq(schema.customerAddresses.customerId, customerId), eq(schema.customerAddresses.organizationId, auth.orgId)));
      const [a] = await tx.insert(schema.customerAddresses).values({ organizationId: auth.orgId, customerId, label: body.label, address: stripAddress(body), isDefault: body.isDefault }).returning();
      return a;
    });

    reply.code(201);
    return row;
  });

  app.patch("/customers/:customerId/addresses/:addressId", async (req) => {
    const auth = requirePermission(req, "customers.write");
    const { customerId } = idParam.parse(req.params);
    const { addressId } = z.object({ addressId: z.uuid() }).parse(req.params);
    await getCustomer(auth.orgId, customerId);
    const body = addressSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const existing = await tx.query.customerAddresses.findFirst({
        where: and(eq(schema.customerAddresses.id, addressId), eq(schema.customerAddresses.customerId, customerId), eq(schema.customerAddresses.organizationId, auth.orgId)),
      });
      if (!existing) throw notFound("Customer address");
      if (body.isDefault) await tx.update(schema.customerAddresses).set({ isDefault: false }).where(and(eq(schema.customerAddresses.customerId, customerId), eq(schema.customerAddresses.organizationId, auth.orgId)));
      const [updated] = await tx.update(schema.customerAddresses).set({ label: body.label, address: stripAddress(body), isDefault: body.isDefault, updatedAt: new Date() }).where(eq(schema.customerAddresses.id, addressId)).returning();
      return updated;
    });
  });

  // FR-CRM-009: merge preserves order/payment references and leaves an audit record.
  app.post("/customers/:customerId/merge", async (req) => {
    const auth = requirePermission(req, "customers.merge");
    const { customerId } = idParam.parse(req.params);
    const { sourceCustomerId } = z.object({ sourceCustomerId: z.uuid() }).parse(req.body);
    if (sourceCustomerId === customerId) throw badRequest("Cannot merge a customer into itself");
    return db.transaction(async (tx) => {
      const target = await getCustomer(auth.orgId, customerId);
      const source = await getCustomer(auth.orgId, sourceCustomerId);
      if (target.status === "merged" || source.status === "merged") throw badRequest("Customer already merged");
      for (const table of [schema.orders, schema.invoices, schema.payments, schema.customerAddresses] as const) {
        await tx
          .update(table)
          .set({ customerId: target.id } as never)
          .where(and(eq(table.customerId, source.id), eq(table.organizationId, auth.orgId)));
      }
      await tx.update(schema.customers).set({ status: "merged", mergedIntoId: target.id, updatedAt: new Date() }).where(eq(schema.customers.id, source.id));
      await audit(tx, req, { action: "customer.merged", resourceType: "customer", resourceId: target.id, before: { source: source.customerCode }, after: { target: target.customerCode } });
      return { ok: true, targetId: target.id };
    });
  });
}

function stripAddress(a: z.infer<typeof addressSchema>) {
  const { label: _l, isDefault: _d, ...rest } = a;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
}
