/**
 * Stock of consumables (solvent, detergent, hangers, packing), suppliers and purchase orders.
 * Stock on hand is always derived from the append-only movement ledger, per branch, in thousandths of a unit.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  goodsReceiptSchema, inventoryItemSchema, purchaseOrderSchema, STARTER_INVENTORY, stockMovementSchema, supplierSchema, toMilli,
} from "@drycare/shared";
import { db, schema, type DbOrTx, type Tx } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors";
import { nextNumber, pad } from "../lib/sequences";
import { assertDrawerCash, openShiftFor } from "./payments";

const uuid = z.uuid();
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
/** Value of a quantity (thousandths) at a unit price (paise), rounded to the paisa. */
const lineValue = (milli: number, unitCost: number) => Math.round((milli * unitCost) / 1000);
const fmtQty = (milli: number, unit: string) => `${Number((milli / 1000).toFixed(3))} ${unit}`;

function branchScope(auth: AuthContext, branchId?: string) {
  if (branchId) {
    assertBranchAccess(auth, branchId);
    return [branchId];
  }
  return auth.branchIds.length ? auth.branchIds : null;
}

async function itemOf(tx: DbOrTx, orgId: string, id: string) {
  const item = await tx.query.inventoryItems.findFirst({ where: and(eq(schema.inventoryItems.id, id), eq(schema.inventoryItems.organizationId, orgId)) });
  if (!item) throw notFound("Stock item");
  return item;
}

async function supplierOf(tx: DbOrTx, orgId: string, id: string) {
  const s = await tx.query.suppliers.findFirst({ where: and(eq(schema.suppliers.id, id), eq(schema.suppliers.organizationId, orgId)) });
  if (!s) throw notFound("Supplier");
  return s;
}

/** Serialises stock changes for one item at one branch so two people can never take the last litre twice. */
async function lockStock(tx: Tx, itemId: string, branchId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${itemId}:${branchId}`}))`);
  const [r] = await tx.execute<{ milli: string }>(sql`select coalesce(sum(quantity_milli), 0) as milli from inventory_movements where item_id = ${itemId} and branch_id = ${branchId}`);
  return Number(r.milli);
}

async function createItem(tx: Tx, orgId: string, body: z.infer<typeof inventoryItemSchema>) {
  const dup = await tx.execute(sql`select 1 from inventory_items where organization_id = ${orgId} and lower(name) = lower(${body.name}) limit 1`);
  if (dup.length) throw conflict(`“${body.name}” is already in your stock list`, "DUPLICATE_ITEM");
  if (body.preferredSupplierId) await supplierOf(tx, orgId, body.preferredSupplierId);
  const seq = await nextNumber(tx, orgId, "inventory_item");
  const [row] = await tx.insert(schema.inventoryItems).values({
    organizationId: orgId, itemCode: `ITM-${pad(seq, 4)}`, name: body.name, category: body.category, unit: body.unit,
    reorderLevelMilli: toMilli(body.reorderLevel ?? 0), lastUnitCost: body.lastUnitCost ?? 0, preferredSupplierId: body.preferredSupplierId ?? null,
    notes: body.notes || null, isActive: body.isActive ?? true,
  }).returning();
  return row;
}

function poTotals(lines: { quantityMilli: number; unitCost: number; taxBps: number }[]) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const l of lines) {
    const v = lineValue(l.quantityMilli, l.unitCost);
    subtotal += v;
    taxTotal += Math.round((v * l.taxBps) / 10_000);
  }
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

async function poDetail(tx: DbOrTx, orgId: string, id: string) {
  const po = await tx.query.purchaseOrders.findFirst({ where: and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, orgId)) });
  if (!po) throw notFound("Purchase order");
  const [supplier, branch, lines, receipts, creator] = await Promise.all([
    tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, po.supplierId) }),
    tx.query.branches.findFirst({ where: eq(schema.branches.id, po.branchId) }),
    tx.select({
      id: schema.purchaseOrderLines.id, itemId: schema.purchaseOrderLines.itemId, quantityMilli: schema.purchaseOrderLines.quantityMilli,
      receivedMilli: schema.purchaseOrderLines.receivedMilli, unitCost: schema.purchaseOrderLines.unitCost, taxBps: schema.purchaseOrderLines.taxBps,
      itemName: schema.inventoryItems.name, itemCode: schema.inventoryItems.itemCode, unit: schema.inventoryItems.unit, category: schema.inventoryItems.category,
    }).from(schema.purchaseOrderLines).innerJoin(schema.inventoryItems, eq(schema.inventoryItems.id, schema.purchaseOrderLines.itemId))
      .where(eq(schema.purchaseOrderLines.purchaseOrderId, id)).orderBy(asc(schema.inventoryItems.name)),
    tx.select({
      id: schema.inventoryMovements.id, itemName: schema.inventoryItems.name, unit: schema.inventoryItems.unit, quantityMilli: schema.inventoryMovements.quantityMilli,
      unitCost: schema.inventoryMovements.unitCost, note: schema.inventoryMovements.note, createdAt: schema.inventoryMovements.createdAt, by: schema.users.name,
      expenseId: schema.inventoryMovements.expenseId,
    }).from(schema.inventoryMovements).innerJoin(schema.inventoryItems, eq(schema.inventoryItems.id, schema.inventoryMovements.itemId))
      .leftJoin(schema.users, eq(schema.users.id, schema.inventoryMovements.createdBy))
      .where(eq(schema.inventoryMovements.purchaseOrderId, id)).orderBy(desc(schema.inventoryMovements.createdAt)),
    tx.query.users.findFirst({ where: eq(schema.users.id, po.createdBy), columns: { name: true } }),
  ]);
  return { ...po, supplier, branchName: branch?.name, branchCode: branch?.branchCode, createdByName: creator?.name, lines, receipts };
}

const poLinesSchema = purchaseOrderSchema.shape.lines;

async function validatedLines(tx: DbOrTx, orgId: string, lines: z.infer<typeof poLinesSchema>) {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (ids.length !== lines.length) throw badRequest("Each item can appear only once on a purchase order");
  const items = await tx.select({ id: schema.inventoryItems.id }).from(schema.inventoryItems)
    .where(and(eq(schema.inventoryItems.organizationId, orgId), inArray(schema.inventoryItems.id, ids)));
  if (items.length !== ids.length) throw notFound("Stock item");
  return lines.map((l) => ({ itemId: l.itemId, quantityMilli: toMilli(l.quantity), unitCost: l.unitCost, taxBps: l.taxBps }));
}

export async function inventoryRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ items & stock

  app.get("/inventory/items", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const q = z.object({ branchId: uuid.optional(), includeInactive: z.enum(["true", "false"]).optional() }).parse(req.query);
    const branches = branchScope(auth, q.branchId);
    const branchFilter = branches ? sql`and m.branch_id = any(${`{${branches.join(",")}}`}::uuid[])` : sql``;
    const rows = await db.execute<Record<string, unknown>>(sql`
      select i.id, i.item_code as "itemCode", i.name, i.category, i.unit, i.reorder_level_milli as "reorderLevelMilli",
             i.last_unit_cost as "lastUnitCost", i.preferred_supplier_id as "preferredSupplierId", s.name as "supplierName",
             i.notes, i.is_active as "isActive",
             coalesce((select sum(m.quantity_milli) from inventory_movements m where m.item_id = i.id ${branchFilter}), 0)::bigint as "onHandMilli",
             (select max(m.created_at) from inventory_movements m where m.item_id = i.id ${branchFilter}) as "lastMovementAt",
             coalesce((select sum(l.quantity_milli - l.received_milli) from purchase_order_lines l join purchase_orders po on po.id = l.purchase_order_id
                       where l.item_id = i.id and po.status in ('ordered', 'partial') ${branches ? sql`and po.branch_id = any(${`{${branches.join(",")}}`}::uuid[])` : sql``}), 0)::bigint as "onOrderMilli"
      from inventory_items i left join suppliers s on s.id = i.preferred_supplier_id
      where i.organization_id = ${auth.orgId} ${q.includeInactive === "true" ? sql`` : sql`and i.is_active`}
      order by i.category, i.name`);
    return rows.map((r) => {
      const onHandMilli = Number(r.onHandMilli);
      const reorderLevelMilli = Number(r.reorderLevelMilli);
      return {
        ...r, onHandMilli, reorderLevelMilli, onOrderMilli: Number(r.onOrderMilli), lastUnitCost: Number(r.lastUnitCost),
        stockValue: Math.max(0, lineValue(onHandMilli, Number(r.lastUnitCost))),
        low: reorderLevelMilli > 0 && onHandMilli <= reorderLevelMilli,
      };
    });
  });

  app.post("/inventory/items", async (req, reply) => {
    const auth = requirePermission(req, "inventory.manage");
    const body = inventoryItemSchema.extend({ opening: z.object({ branchId: uuid, quantity: z.number().positive().max(10_000_000) }).optional() }).parse(req.body);
    if (body.opening) assertBranchAccess(auth, body.opening.branchId);
    const row = await db.transaction(async (tx) => {
      const item = await createItem(tx, auth.orgId, body);
      if (body.opening) {
        await tx.insert(schema.inventoryMovements).values({
          organizationId: auth.orgId, branchId: body.opening.branchId, itemId: item.id, kind: "opening", quantityMilli: toMilli(body.opening.quantity),
          unitCost: item.lastUnitCost || null, note: "Opening stock when the item was added", createdBy: auth.userId,
        });
      }
      await audit(tx, req, { action: "inventory.item_created", resourceType: "inventory_item", resourceId: item.id, after: { ...item, opening: body.opening } });
      return item;
    });
    reply.code(201);
    return row;
  });

  /** One-click starter list for a new shop. Adds only names that are not already there. */
  app.post("/inventory/items/starter", async (req, reply) => {
    const auth = requirePermission(req, "inventory.manage");
    const added = await db.transaction(async (tx) => {
      const existing = new Set((await tx.select({ name: schema.inventoryItems.name }).from(schema.inventoryItems).where(eq(schema.inventoryItems.organizationId, auth.orgId))).map((r) => r.name.toLowerCase()));
      let n = 0;
      for (const s of STARTER_INVENTORY) {
        if (existing.has(s.name.toLowerCase())) continue;
        await createItem(tx, auth.orgId, { name: s.name, category: s.category, unit: s.unit, reorderLevel: s.reorderLevel });
        n++;
      }
      if (n) await audit(tx, req, { action: "inventory.starter_added", resourceType: "inventory_item", after: { added: n } });
      return n;
    });
    reply.code(201);
    return { added };
  });

  app.patch("/inventory/items/:id", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = inventoryItemSchema.partial().parse(req.body);
    return db.transaction(async (tx) => {
      const before = await itemOf(tx, auth.orgId, id);
      if (body.name && body.name.toLowerCase() !== before.name.toLowerCase()) {
        const dup = await tx.execute(sql`select 1 from inventory_items where organization_id = ${auth.orgId} and lower(name) = lower(${body.name}) and id <> ${id} limit 1`);
        if (dup.length) throw conflict(`“${body.name}” is already in your stock list`, "DUPLICATE_ITEM");
      }
      if (body.preferredSupplierId) await supplierOf(tx, auth.orgId, body.preferredSupplierId);
      const [row] = await tx.update(schema.inventoryItems).set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.unit !== undefined && { unit: body.unit }),
        ...(body.reorderLevel !== undefined && { reorderLevelMilli: toMilli(body.reorderLevel) }),
        ...(body.lastUnitCost !== undefined && { lastUnitCost: body.lastUnitCost }),
        ...(body.preferredSupplierId !== undefined && { preferredSupplierId: body.preferredSupplierId }),
        ...(body.notes !== undefined && { notes: body.notes || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: new Date(),
      }).where(eq(schema.inventoryItems.id, id)).returning();
      await audit(tx, req, { action: "inventory.item_updated", resourceType: "inventory_item", resourceId: id, before, after: row });
      return row;
    });
  });

  app.get("/inventory/items/:id/movements", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const q = z.object({ branchId: uuid.optional() }).parse(req.query);
    await itemOf(db, auth.orgId, id);
    const branches = branchScope(auth, q.branchId);
    return db.select({
      id: schema.inventoryMovements.id, kind: schema.inventoryMovements.kind, quantityMilli: schema.inventoryMovements.quantityMilli,
      unitCost: schema.inventoryMovements.unitCost, note: schema.inventoryMovements.note, createdAt: schema.inventoryMovements.createdAt,
      by: schema.users.name, branchCode: schema.branches.branchCode, poNumber: schema.purchaseOrders.poNumber, purchaseOrderId: schema.inventoryMovements.purchaseOrderId,
    }).from(schema.inventoryMovements)
      .leftJoin(schema.users, eq(schema.users.id, schema.inventoryMovements.createdBy))
      .leftJoin(schema.branches, eq(schema.branches.id, schema.inventoryMovements.branchId))
      .leftJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, schema.inventoryMovements.purchaseOrderId))
      .where(and(eq(schema.inventoryMovements.itemId, id), branches ? inArray(schema.inventoryMovements.branchId, branches) : undefined))
      .orderBy(desc(schema.inventoryMovements.createdAt), desc(schema.inventoryMovements.id)).limit(300);
  });

  /** Opening stock, use, wastage, return to supplier, or a stock check that sets the counted quantity. */
  app.post("/inventory/movements", async (req, reply) => {
    const auth = requirePermission(req, "inventory.manage");
    const body = stockMovementSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const branch = await db.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
    if (!branch) throw notFound("Branch");
    const result = await db.transaction(async (tx) => {
      const item = await itemOf(tx, auth.orgId, body.itemId);
      if (!item.isActive) throw unprocessable("This item is switched off. Switch it back on to record stock.");
      const onHand = await lockStock(tx, item.id, body.branchId);
      const qty = toMilli(body.quantity);
      let delta: number;
      if (body.kind === "count") delta = qty - onHand;
      else if (body.kind === "opening") {
        if (qty <= 0) throw badRequest("Enter a quantity");
        delta = qty;
      } else {
        if (qty <= 0) throw badRequest("Enter a quantity");
        if (qty > onHand) throw unprocessable(`Only ${fmtQty(Math.max(0, onHand), item.unit)} of ${item.name} is in stock. Do a stock check if the shelf has more.`, "INSUFFICIENT_STOCK");
        delta = -qty;
      }
      if ((body.kind === "wastage" || body.kind === "count") && delta < 0 && !body.note) {
        throw badRequest(body.kind === "count" ? "Say why the shelf has less than expected" : "Say what was wasted or damaged");
      }
      const [m] = await tx.insert(schema.inventoryMovements).values({
        organizationId: auth.orgId, branchId: body.branchId, itemId: item.id, kind: body.kind, quantityMilli: delta,
        unitCost: body.unitCost ?? (item.lastUnitCost || null), note: body.note || null, createdBy: auth.userId,
      }).returning();
      if (body.kind === "opening" && body.unitCost !== undefined) await tx.update(schema.inventoryItems).set({ lastUnitCost: body.unitCost, updatedAt: new Date() }).where(eq(schema.inventoryItems.id, item.id));
      await audit(tx, req, { action: `inventory.${body.kind}`, resourceType: "inventory_item", resourceId: item.id, after: { branchId: body.branchId, delta, before: onHand, after: onHand + delta, note: body.note } });
      return { movement: m, onHandMilli: onHand + delta };
    });
    reply.code(201);
    return result;
  });

  /** Purchased, used, wasted per item over a period (for the Usage tab and CSV). */
  app.get("/inventory/usage", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const q = z.object({ from: z.iso.date(), to: z.iso.date(), branchId: uuid.optional() }).parse(req.query);
    const branches = branchScope(auth, q.branchId);
    const branchFilter = branches ? sql`and m.branch_id = any(${`{${branches.join(",")}}`}::uuid[])` : sql``;
    const rows = await db.execute<Record<string, string>>(sql`
      select i.id, i.item_code as "itemCode", i.name, i.category, i.unit, i.last_unit_cost as "lastUnitCost",
             coalesce(sum(m.quantity_milli) filter (where m.kind = 'purchase'), 0) as purchased,
             coalesce(sum(m.quantity_milli * coalesce(m.unit_cost, 0) / 1000) filter (where m.kind = 'purchase'), 0) as "purchasedValue",
             coalesce(-sum(m.quantity_milli) filter (where m.kind = 'use'), 0) as used,
             coalesce(-sum(m.quantity_milli) filter (where m.kind = 'wastage'), 0) as wasted,
             coalesce(-sum(m.quantity_milli) filter (where m.kind = 'return'), 0) as returned,
             coalesce(sum(m.quantity_milli) filter (where m.kind = 'count'), 0) as "countDifference"
      from inventory_movements m join inventory_items i on i.id = m.item_id
      where m.organization_id = ${auth.orgId} ${branchFilter}
        and (m.created_at at time zone 'Asia/Kolkata')::date between ${q.from}::date and ${q.to}::date
      group by i.id order by i.category, i.name`);
    return rows.map((r) => ({
      ...r, lastUnitCost: Number(r.lastUnitCost), purchased: Number(r.purchased), purchasedValue: Math.round(Number(r.purchasedValue)), used: Number(r.used),
      wasted: Number(r.wasted), returned: Number(r.returned), countDifference: Number(r.countDifference),
      usedValue: lineValue(Number(r.used) + Number(r.wasted), Number(r.lastUnitCost)),
    }));
  });

  // ------------------------------------------------------------------ suppliers

  app.get("/suppliers", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    return db.execute(sql`
      select s.*, s.contact_person as "contactPerson", s.is_active as "isActive", s.created_at as "createdAt",
             (select count(*)::int from purchase_orders po where po.supplier_id = s.id and po.status <> 'cancelled') as "orderCount",
             (select coalesce(sum(po.total), 0)::bigint from purchase_orders po where po.supplier_id = s.id and po.status in ('partial', 'received')) as "purchasedTotal",
             (select max(po.created_at) from purchase_orders po where po.supplier_id = s.id) as "lastOrderAt"
      from suppliers s where s.organization_id = ${auth.orgId} order by s.is_active desc, s.name`);
  });

  app.post("/suppliers", async (req, reply) => {
    const auth = requirePermission(req, "inventory.manage");
    const body = supplierSchema.parse(req.body);
    const dup = await db.execute(sql`select 1 from suppliers where organization_id = ${auth.orgId} and lower(name) = lower(${body.name}) limit 1`);
    if (dup.length) throw conflict(`A supplier called “${body.name}” already exists`, "DUPLICATE_SUPPLIER");
    const [row] = await db.insert(schema.suppliers).values({
      organizationId: auth.orgId, name: body.name, contactPerson: body.contactPerson || null, phone: body.phone || null, email: body.email || null,
      gstin: body.gstin || null, address: body.address || null, notes: body.notes || null, isActive: body.isActive ?? true,
    }).returning();
    await audit(db, req, { action: "supplier.created", resourceType: "supplier", resourceId: row.id, after: row });
    reply.code(201);
    return row;
  });

  app.patch("/suppliers/:id", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = supplierSchema.partial().parse(req.body);
    const before = await supplierOf(db, auth.orgId, id);
    const clean = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "" ? null : v]));
    const [row] = await db.update(schema.suppliers).set({ ...clean, updatedAt: new Date() }).where(eq(schema.suppliers.id, id)).returning();
    await audit(db, req, { action: "supplier.updated", resourceType: "supplier", resourceId: id, before, after: row });
    return row;
  });

  // ------------------------------------------------------------------ purchase orders

  app.get("/purchase-orders", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const q = z.object({ status: z.enum(["open", "draft", "ordered", "partial", "received", "cancelled", "all"]).default("all"), branchId: uuid.optional() }).parse(req.query);
    const branches = branchScope(auth, q.branchId);
    const statusFilter = q.status === "all" ? sql`` : q.status === "open" ? sql`and po.status in ('draft', 'ordered', 'partial')` : sql`and po.status = ${q.status}`;
    return db.execute(sql`
      select po.id, po.po_number as "poNumber", po.status, po.expected_on as "expectedOn", po.total, po.created_at as "createdAt", po.ordered_at as "orderedAt",
             s.name as "supplierName", b.branch_code as "branchCode", u.name as "createdByName",
             (select count(*)::int from purchase_order_lines l where l.purchase_order_id = po.id) as "lineCount",
             (po.status in ('ordered', 'partial') and po.expected_on is not null and po.expected_on::date < ${istToday()}::date) as overdue
      from purchase_orders po join suppliers s on s.id = po.supplier_id join branches b on b.id = po.branch_id left join users u on u.id = po.created_by
      where po.organization_id = ${auth.orgId} ${statusFilter} ${branches ? sql`and po.branch_id = any(${`{${branches.join(",")}}`}::uuid[])` : sql``}
      order by po.created_at desc limit 300`);
  });

  app.get("/purchase-orders/:id", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const po = await poDetail(db, auth.orgId, id);
    assertBranchAccess(auth, po.branchId);
    return po;
  });

  app.post("/purchase-orders", async (req, reply) => {
    const auth = requirePermission(req, "inventory.manage");
    const body = purchaseOrderSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const id = await db.transaction(async (tx) => {
      const branch = await tx.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!branch) throw notFound("Branch");
      const supplier = await supplierOf(tx, auth.orgId, body.supplierId);
      if (!supplier.isActive) throw unprocessable("This supplier is switched off");
      const lines = await validatedLines(tx, auth.orgId, body.lines);
      const year = new Date().getFullYear();
      const seq = await nextNumber(tx, auth.orgId, `purchase_order:${year}`);
      const [po] = await tx.insert(schema.purchaseOrders).values({
        organizationId: auth.orgId, branchId: body.branchId, supplierId: body.supplierId, poNumber: `PO/${year}/${pad(seq, 4)}`,
        status: body.place ? "ordered" : "draft", orderedAt: body.place ? new Date() : null, expectedOn: body.expectedOn ?? null, notes: body.notes || null,
        ...poTotals(lines), createdBy: auth.userId,
      }).returning();
      await tx.insert(schema.purchaseOrderLines).values(lines.map((l) => ({ organizationId: auth.orgId, purchaseOrderId: po.id, ...l })));
      await audit(tx, req, { action: "purchase_order.created", resourceType: "purchase_order", resourceId: po.id, after: { ...po, lines } });
      return po.id;
    });
    reply.code(201);
    return poDetail(db, auth.orgId, id);
  });

  /** Drafts can be changed freely; once ordered only the expected date and notes can change. */
  app.put("/purchase-orders/:id", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = purchaseOrderSchema.omit({ branchId: true }).partial({ lines: true, supplierId: true }).parse(req.body);
    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, auth.orgId))).for("update");
      if (!po) throw notFound("Purchase order");
      assertBranchAccess(auth, po.branchId);
      if (po.status === "received" || po.status === "cancelled") throw conflict("This purchase order is closed");
      const patch: Partial<typeof schema.purchaseOrders.$inferInsert> = { expectedOn: body.expectedOn ?? po.expectedOn, notes: body.notes ?? po.notes, updatedAt: new Date() };
      if (po.status === "draft") {
        if (body.supplierId) patch.supplierId = (await supplierOf(tx, auth.orgId, body.supplierId)).id;
        if (body.lines) {
          const lines = await validatedLines(tx, auth.orgId, body.lines);
          await tx.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, id));
          await tx.insert(schema.purchaseOrderLines).values(lines.map((l) => ({ organizationId: auth.orgId, purchaseOrderId: id, ...l })));
          Object.assign(patch, poTotals(lines));
        }
        if (body.place) Object.assign(patch, { status: "ordered", orderedAt: new Date() });
      } else if (body.lines || (body.supplierId && body.supplierId !== po.supplierId)) {
        throw conflict("Items and supplier can only be changed while the order is a draft");
      }
      await tx.update(schema.purchaseOrders).set(patch).where(eq(schema.purchaseOrders.id, id));
      await audit(tx, req, { action: "purchase_order.updated", resourceType: "purchase_order", resourceId: id, before: po, after: patch });
    });
    return poDetail(db, auth.orgId, id);
  });

  /** Cancels an order with nothing received, or closes a part-received one (the rest is no longer expected). */
  app.post("/purchase-orders/:id/cancel", async (req) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) }).parse(req.body);
    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, auth.orgId))).for("update");
      if (!po) throw notFound("Purchase order");
      assertBranchAccess(auth, po.branchId);
      if (po.status === "received" || po.status === "cancelled") throw conflict("This purchase order is already closed");
      const status = po.status === "partial" ? "received" : "cancelled";
      await tx.update(schema.purchaseOrders).set({ status, cancelReason: reason, updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, id));
      await audit(tx, req, { action: status === "cancelled" ? "purchase_order.cancelled" : "purchase_order.closed_short", resourceType: "purchase_order", resourceId: id, after: { reason } });
    });
    return poDetail(db, auth.orgId, id);
  });

  /** Goods arrive: stock goes up, the line's received quantity and the item's price are updated, optionally the bill is filed as an expense. */
  app.post("/purchase-orders/:id/receive", async (req, reply) => {
    const auth = requirePermission(req, "inventory.manage");
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = goodsReceiptSchema.parse(req.body);
    if (body.bill && !can(auth, "expenses.manage")) throw forbidden("Recording the supplier bill needs permission to record expenses");
    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, auth.orgId))).for("update");
      if (!po) throw notFound("Purchase order");
      assertBranchAccess(auth, po.branchId);
      if (po.status === "draft") throw conflict("Place the order before receiving goods");
      if (po.status !== "ordered" && po.status !== "partial") throw conflict("This purchase order is closed");
      const lines = await tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, id));
      const byId = new Map(lines.map((l) => [l.id, l]));
      const receiving = body.lines.filter((r) => r.quantity > 0);
      if (!receiving.length) throw badRequest("Enter the quantity received for at least one item");
      let value = 0;
      const updates: { line: (typeof lines)[number]; milli: number; unitCost: number }[] = [];
      for (const r of receiving) {
        const line = byId.get(r.lineId);
        if (!line) throw notFound("Purchase order line");
        const milli = toMilli(r.quantity);
        const remaining = line.quantityMilli - line.receivedMilli;
        if (milli > remaining) {
          const item = await itemOf(tx, auth.orgId, line.itemId);
          throw unprocessable(`Only ${fmtQty(remaining, item.unit)} of ${item.name} is still due on this order`, "OVER_RECEIPT");
        }
        const unitCost = r.unitCost ?? line.unitCost;
        const v = lineValue(milli, unitCost);
        value += v + Math.round((v * line.taxBps) / 10_000);
        updates.push({ line, milli, unitCost });
      }
      let expenseId: string | null = null;
      if (body.bill && value > 0) {
        let shiftId: string | null = null;
        if (body.bill.paidFromDrawer) {
          if (body.bill.method !== "cash") throw badRequest("Only cash can be paid from the cash drawer");
          const shift = await openShiftFor(tx, auth, po.branchId);
          if (!shift) throw unprocessable("Open a cashier shift at this branch to pay from the cash drawer", "NO_OPEN_SHIFT");
          await assertDrawerCash(tx, shift, value);
          shiftId = shift.id;
        }
        const supplier = await supplierOf(tx, auth.orgId, po.supplierId);
        const [exp] = await tx.insert(schema.expenses).values({
          organizationId: auth.orgId, branchId: po.branchId, category: body.bill.category, amount: value, method: body.bill.method, spentOn: istToday(),
          vendor: supplier.name, reference: body.bill.reference || null, description: `Goods received against ${po.poNumber}`, shiftId, createdBy: auth.userId,
        }).returning();
        expenseId = exp.id;
        await audit(tx, req, { action: "expense.recorded", resourceType: "expense", resourceId: exp.id, after: { amount: value, category: exp.category, fromDrawer: Boolean(shiftId), purchaseOrder: po.poNumber } });
      }
      for (const u of updates) {
        await lockStock(tx, u.line.itemId, po.branchId);
        await tx.insert(schema.inventoryMovements).values({
          organizationId: auth.orgId, branchId: po.branchId, itemId: u.line.itemId, kind: "purchase", quantityMilli: u.milli, unitCost: u.unitCost,
          purchaseOrderId: id, expenseId, note: body.note || null, createdBy: auth.userId,
        });
        await tx.update(schema.purchaseOrderLines).set({ receivedMilli: u.line.receivedMilli + u.milli }).where(eq(schema.purchaseOrderLines.id, u.line.id));
        await tx.update(schema.inventoryItems).set({ lastUnitCost: u.unitCost, updatedAt: new Date() }).where(eq(schema.inventoryItems.id, u.line.itemId));
        u.line.receivedMilli += u.milli;
      }
      const complete = lines.every((l) => l.receivedMilli >= l.quantityMilli);
      await tx.update(schema.purchaseOrders).set({ status: complete ? "received" : "partial", updatedAt: new Date() }).where(eq(schema.purchaseOrders.id, id));
      await audit(tx, req, { action: "purchase_order.received", resourceType: "purchase_order", resourceId: id, after: { lines: updates.map((u) => ({ itemId: u.line.itemId, milli: u.milli, unitCost: u.unitCost })), value, expenseId, complete } });
    });
    reply.code(201);
    return poDetail(db, auth.orgId, id);
  });
}
