/**
 * Printers sold by Mindware. The software owner records each one with its serial and bill number. At installation the
 * driver goes on first, then those two numbers connect the printer to the shop, on a PC even without internet, because
 * the signed license key lists the printers sold to that customer.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { isDesktop } from "../env";
import { audit } from "../lib/audit";
import { requirePermission, requirePlatformAdmin } from "../lib/context";
import { hardwarePolicy, type SoldPrinter } from "../lib/entitlements";
import { AppError, conflict, notFound } from "../lib/errors";

export const normalizeNumber = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");
const numberField = (label: string) => z.string().trim().min(2, `Enter the ${label}`).max(80).transform(normalizeNumber);

/** The printers sold to one customer, for its signed license key. */
export async function soldPrintersFor(organizationId: string | null | undefined, customerName: string): Promise<SoldPrinter[]> {
  const rows = await db.execute<SoldPrinter>(sql`
    select serial_number as serial, bill_number as bill, model from sold_printers
    where status = 'active' and (${organizationId ? sql`organization_id = ${organizationId} or ` : sql``} lower(customer_name) = lower(${customerName}))`);
  return [...rows].map((r) => ({ serial: r.serial, bill: r.bill, model: r.model }));
}

/** Whether these two numbers belong to a printer Mindware sold to this shop. */
async function verifySale(orgId: string, serial: string, bill: string) {
  const refused = new AppError(403, "PRINTER_NOT_SOLD_BY_MINDWARE", "These numbers do not match a printer sold by Mindware. Check the serial number and bill number, or contact Mindware.");
  if (isDesktop) {
    const sold = (await hardwarePolicy()).soldPrinters;
    const match = sold?.find((p) => p.serial === serial && p.bill === bill);
    if (!match) throw sold ? refused : new AppError(409, "KEY_HAS_NO_PRINTER_LIST", "This PC's license key has no printer list yet. Ask Mindware to renew the key.");
    return { model: match.model, soldPrinterId: null };
  }
  const row = await db.query.soldPrinters.findFirst({ where: and(eq(schema.soldPrinters.serialNumber, serial), eq(schema.soldPrinters.billNumber, bill)) });
  if (!row || row.status !== "active") throw refused;
  if (row.organizationId && row.organizationId !== orgId) throw new AppError(403, "PRINTER_SOLD_TO_ANOTHER_SHOP", "This printer was sold to another customer. Contact Mindware.");
  return { model: row.model, soldPrinterId: row.id };
}

export async function printerRegistryRoutes(app: FastifyInstance) {
  // ---- The shop, at installation
  app.get("/labels/shop-printers", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { driverUrl } = await hardwarePolicy();
    const printers = await db.query.shopPrinters.findMany({ where: eq(schema.shopPrinters.organizationId, auth.orgId), orderBy: [desc(schema.shopPrinters.createdAt)] });
    return { driverUrl: driverUrl ?? null, printers };
  });

  app.post("/labels/shop-printers", async (req, reply) => {
    const auth = requirePermission(req, "org.manage");
    const body = z.object({ serial: numberField("serial number"), bill: numberField("bill number"), printerName: z.string().trim().max(200).optional() }).parse(req.body);
    if (isDesktop && !body.printerName) throw new AppError(400, "CHOOSE_PRINTER", "Install the driver, then choose the printer from the list.");
    const sale = await verifySale(auth.orgId, body.serial, body.bill);
    const created = await db.transaction(async (tx) => {
      const elsewhere = await tx.query.shopPrinters.findFirst({ where: eq(schema.shopPrinters.serialNumber, body.serial) });
      if (elsewhere && elsewhere.organizationId !== auth.orgId) throw new AppError(403, "PRINTER_SOLD_TO_ANOTHER_SHOP", "This printer is already connected to another shop. Contact Mindware.");
      if (elsewhere) throw conflict(`This printer is already connected${elsewhere.printerName ? ` as ${elsewhere.printerName}` : ""}.`, "PRINTER_ALREADY_CONNECTED");
      const [row] = await tx.insert(schema.shopPrinters).values({ organizationId: auth.orgId, serialNumber: body.serial, billNumber: body.bill, model: sale.model, printerName: body.printerName ?? null, connectedBy: auth.userId }).returning();
      if (sale.soldPrinterId) await tx.update(schema.soldPrinters).set({ organizationId: auth.orgId, connectedAt: new Date(), updatedAt: new Date() }).where(eq(schema.soldPrinters.id, sale.soldPrinterId));
      await audit(tx, req, { action: "printer.connected", resourceType: "shop_printer", resourceId: row.id, after: row });
      return row;
    });
    reply.code(201);
    return created;
  });

  app.delete("/labels/shop-printers/:id", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return db.transaction(async (tx) => {
      const [row] = await tx.delete(schema.shopPrinters).where(and(eq(schema.shopPrinters.id, id), eq(schema.shopPrinters.organizationId, auth.orgId))).returning();
      if (!row) throw notFound("Printer");
      await tx.update(schema.soldPrinters).set({ connectedAt: null, updatedAt: new Date() }).where(eq(schema.soldPrinters.serialNumber, row.serialNumber));
      await audit(tx, req, { action: "printer.disconnected", resourceType: "shop_printer", resourceId: id, before: row });
      return { removed: true };
    });
  });

  // ---- The software owner
  app.get("/platform-admin/sold-printers", async (req) => {
    requirePlatformAdmin(req);
    return db.execute(sql`
      select p.id, p.serial_number as "serialNumber", p.bill_number as "billNumber", p.model, p.customer_name as "customerName", p.sold_on as "soldOn", p.status, p.note, p.connected_at as "connectedAt", o.name as "organizationName", p.organization_id as "organizationId"
      from sold_printers p left join organizations o on o.id = p.organization_id order by p.created_at desc limit 1000`);
  });

  app.post("/platform-admin/sold-printers", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      serialNumber: numberField("serial number"), billNumber: numberField("bill number"), model: z.string().trim().min(2, "Enter the model").max(120),
      organizationId: z.uuid().nullable().optional(), customerName: z.string().trim().max(160).optional(), soldOn: z.iso.date().optional(), note: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const taken = await db.query.soldPrinters.findFirst({ where: eq(schema.soldPrinters.serialNumber, body.serialNumber) });
    if (taken) throw conflict(`Serial number ${body.serialNumber} is already recorded.`, "SERIAL_ALREADY_RECORDED");
    // Typing the shop's exact name ties the printer to that shop, so no other shop can connect it.
    const named = !body.organizationId && body.customerName ? await db.execute<{ id: string }>(sql`select id from organizations where lower(name) = lower(${body.customerName}) limit 2`) : [];
    const [row] = await db.insert(schema.soldPrinters).values({ serialNumber: body.serialNumber, billNumber: body.billNumber, model: body.model, organizationId: body.organizationId ?? (named.length === 1 ? named[0].id : null), customerName: body.customerName || null, soldOn: body.soldOn ?? null, note: body.note || null, createdBy: auth.userId }).returning();
    await audit(db, req, { action: "platform.printer_sold", resourceType: "sold_printer", resourceId: row.id, actorUserId: auth.userId, after: row });
    reply.code(201);
    return row;
  });

  /** Stops a printer connecting from now on, such as one returned or stolen. Keys already issued still list it until renewed. */
  app.post("/platform-admin/sold-printers/:id/status", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(["active", "revoked"]) }).parse(req.body);
    const [row] = await db.update(schema.soldPrinters).set({ status, updatedAt: new Date() }).where(eq(schema.soldPrinters.id, id)).returning();
    if (!row) throw notFound("Printer");
    await audit(db, req, { action: `platform.printer_${status}`, resourceType: "sold_printer", resourceId: id, actorUserId: auth.userId, after: row });
    return row;
  });
}
