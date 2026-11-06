/**
 * Printers and scanners sold by Mindware. The software owner records each one with its serial and bill number, and a
 * serial number can exist only once. At installation those two numbers connect the device to the shop, on a PC even
 * without internet, because the signed license key lists what was sold to that customer. A shop cannot remove a device:
 * only the software owner can disable it or replace it with another.
 *
 * On a PC a TSC printer reports its own serial number, so the physical unit is checked when connecting and before
 * printing. Other printers cannot be asked, and a USB scanner only types, so for those these numbers prove what was sold
 * and registered, not which unit is plugged in.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type DbOrTx } from "../db/client";
import { isDesktop } from "../env";
import { audit } from "../lib/audit";
import { requirePermission, requirePlatformAdmin } from "../lib/context";
import { hardwarePolicy, type SoldPrinter } from "../lib/entitlements";
import { AppError, conflict, notFound } from "../lib/errors";
import { readPrinterSerial } from "../lib/printerSerial";

export const normalizeNumber = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");
const numberField = (label: string) => z.string().trim().min(2, `Enter the ${label}`).max(80).transform(normalizeNumber);

const deviceType = z.enum(["printer", "scanner"]);
type DeviceType = z.infer<typeof deviceType>;
const WORD: Record<DeviceType, string> = { printer: "printer", scanner: "scanner" };

/** The printers and scanners sold to one customer, for its signed license key. */
export async function soldPrintersFor(organizationId: string | null | undefined, customerName: string): Promise<SoldPrinter[]> {
  const rows = await db.execute<SoldPrinter>(sql`
    select serial_number as serial, bill_number as bill, model, device_type as kind from sold_printers
    where status = 'active' and (${organizationId ? sql`organization_id = ${organizationId} or ` : sql``} lower(customer_name) = lower(${customerName}))`);
  return [...rows].map((r) => ({ serial: r.serial, bill: r.bill, model: r.model, kind: r.kind }));
}

/** On a PC the key decides: a device left out of a renewed key stops working, even though the PC is offline. */
async function connectedDevices(orgId: string, tx: DbOrTx = db) {
  const rows = await tx.query.shopPrinters.findMany({ where: eq(schema.shopPrinters.organizationId, orgId), orderBy: [desc(schema.shopPrinters.createdAt)] });
  const sold = isDesktop ? (await hardwarePolicy(tx)).soldPrinters : undefined;
  return rows.map((row) => ({ ...row, disabled: Boolean(sold && !sold.some((p) => p.serial === row.serialNumber)) }));
}

/** Names of the Windows printers this shop may print to. */
export async function usablePrinterNames(orgId: string) {
  const rows = await connectedDevices(orgId);
  return new Set(rows.filter((r) => r.deviceType === "printer" && !r.disabled).map((r) => r.printerName).filter(Boolean));
}

/** A confirmed answer stays good this long, so a run of tags does not ask before every job. */
const CHECK_FOR_MS = 2 * 60_000;
const lastCheck = new Map<string, number>();

/**
 * Before a job goes out: the printer on this Windows name must be the one registered. A printer that once confirmed its
 * serial must keep answering, unless it is busy with jobs already queued.
 */
export async function assertSamePrinter(orgId: string, printerName: string, waitingJobs: number) {
  const row = (await connectedDevices(orgId)).find((d) => d.deviceType === "printer" && !d.disabled && d.printerName === printerName);
  if (!row) return;
  const key = `${printerName}:${row.serialNumber}`;
  if (Date.now() - (lastCheck.get(key) ?? 0) < CHECK_FOR_MS) return;
  const reported = await readPrinterSerial(printerName);
  if (reported && reported !== row.serialNumber) {
    lastCheck.delete(key);
    throw new AppError(403, "PRINTER_SERIAL_MISMATCH", `This is not the registered printer. It reports serial number ${reported}, but ${row.serialNumber} is registered here. To change the printer, contact Mindware.`);
  }
  if (reported) {
    lastCheck.set(key, Date.now());
    if (!row.serialConfirmed) await db.update(schema.shopPrinters).set({ serialConfirmed: true }).where(eq(schema.shopPrinters.id, row.id));
    return;
  }
  if (row.serialConfirmed && !waitingJobs) throw new AppError(409, "PRINTER_NOT_ANSWERING", `${printerName} did not answer. Check that it is switched on and its USB cable is connected, then try again.`);
}

/** Which devices a shop must still connect. Trials and shops without a current plan are not held to this. */
export async function missingDevices(orgId: string, tx: DbOrTx = db) {
  const policy = await hardwarePolicy(tx);
  let mandatory: boolean;
  if (isDesktop) mandatory = Boolean(policy.soldPrinters);
  else {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { status: true, settings: true } });
    mandatory = policy.requireDevices !== false && org?.status === "active" && !org.settings?.platformInternal;
  }
  if (!mandatory) return { printer: false, scanner: false };
  const usable = (await connectedDevices(orgId, tx)).filter((d) => !d.disabled);
  return { printer: !usable.some((d) => d.deviceType === "printer"), scanner: !usable.some((d) => d.deviceType === "scanner") };
}

/** Every scanning screen passes through here. */
export async function requireScanner(orgId: string, tx: DbOrTx = db) {
  if ((await missingDevices(orgId, tx)).scanner) throw new AppError(403, "SCANNER_NOT_CONNECTED", "Connect your Mindware scanner before scanning. Enter its serial number and bill number in Tag designer, or contact Mindware.");
}

/** Whether these two numbers belong to a device of this type that Mindware sold to this shop. */
async function verifySale(orgId: string, kind: DeviceType, serial: string, bill: string) {
  const refused = new AppError(403, "PRINTER_NOT_SOLD_BY_MINDWARE", `These numbers do not match a ${WORD[kind]} sold by Mindware. Check the serial number and bill number, or contact Mindware.`);
  if (isDesktop) {
    const sold = (await hardwarePolicy()).soldPrinters;
    const match = sold?.find((p) => p.serial === serial && p.bill === bill && (p.kind ?? "printer") === kind);
    if (!match) throw sold ? refused : new AppError(409, "KEY_HAS_NO_PRINTER_LIST", "This PC's license key has no device list yet. Ask Mindware to renew the key.");
    return { model: match.model, soldPrinterId: null };
  }
  const row = await db.query.soldPrinters.findFirst({ where: and(eq(schema.soldPrinters.serialNumber, serial), eq(schema.soldPrinters.billNumber, bill)) });
  if (!row || row.status !== "active" || row.deviceType !== kind) throw refused;
  if (row.organizationId && row.organizationId !== orgId) throw new AppError(403, "PRINTER_SOLD_TO_ANOTHER_SHOP", `This ${WORD[kind]} was sold to another customer. Contact Mindware.`);
  return { model: row.model, soldPrinterId: row.id };
}

/** A serial number identifies one device, whether a printer or a scanner, and is never used twice. */
async function assertSerialFree(tx: DbOrTx, serial: string) {
  const taken = await tx.query.soldPrinters.findFirst({ where: eq(schema.soldPrinters.serialNumber, serial) });
  if (taken) throw conflict(`Serial number ${serial} is already recorded.`, "SERIAL_ALREADY_RECORDED");
}

export async function printerRegistryRoutes(app: FastifyInstance) {
  // ---- The shop, at installation
  app.get("/labels/shop-printers", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { driverUrl } = await hardwarePolicy();
    return { driverUrl: driverUrl ?? null, printers: await connectedDevices(auth.orgId), missing: await missingDevices(auth.orgId) };
  });

  app.post("/labels/shop-printers", async (req, reply) => {
    const auth = requirePermission(req, "org.manage");
    const body = z.object({ deviceType: deviceType.default("printer"), serial: numberField("serial number"), bill: numberField("bill number"), printerName: z.string().trim().max(200).optional() }).parse(req.body);
    if (isDesktop && body.deviceType === "printer" && !body.printerName) throw new AppError(400, "CHOOSE_PRINTER", "Install the driver, then choose the printer from the list.");
    const sale = await verifySale(auth.orgId, body.deviceType, body.serial, body.bill);
    // The printer itself has the last word, where it can answer.
    const reported = body.deviceType === "printer" && body.printerName ? await readPrinterSerial(body.printerName) : null;
    if (reported && reported !== body.serial) throw new AppError(403, "PRINTER_SERIAL_MISMATCH", `This printer reports serial number ${reported}, not ${body.serial}. Check the number on its label, or choose the right printer.`);
    const created = await db.transaction(async (tx) => {
      const elsewhere = await tx.query.shopPrinters.findFirst({ where: eq(schema.shopPrinters.serialNumber, body.serial) });
      if (elsewhere && elsewhere.organizationId !== auth.orgId) throw new AppError(403, "PRINTER_SOLD_TO_ANOTHER_SHOP", `This ${WORD[body.deviceType]} is already connected to another shop. Contact Mindware.`);
      if (elsewhere) throw conflict(`This ${WORD[body.deviceType]} is already connected${elsewhere.printerName ? ` as ${elsewhere.printerName}` : ""}.`, "PRINTER_ALREADY_CONNECTED");
      const [row] = await tx.insert(schema.shopPrinters).values({ organizationId: auth.orgId, deviceType: body.deviceType, serialNumber: body.serial, billNumber: body.bill, model: sale.model, printerName: body.printerName ?? null, serialConfirmed: Boolean(reported), connectedBy: auth.userId }).returning();
      if (sale.soldPrinterId) await tx.update(schema.soldPrinters).set({ organizationId: auth.orgId, connectedAt: new Date(), updatedAt: new Date() }).where(eq(schema.soldPrinters.id, sale.soldPrinterId));
      await audit(tx, req, { action: "printer.connected", resourceType: "shop_printer", resourceId: row.id, after: row });
      return row;
    });
    reply.code(201);
    return created;
  });

  // ---- The software owner
  app.get("/platform-admin/sold-printers", async (req) => {
    requirePlatformAdmin(req);
    return db.execute(sql`
      select p.id, p.device_type as "deviceType", p.serial_number as "serialNumber", p.bill_number as "billNumber", p.model, p.customer_name as "customerName", p.sold_on as "soldOn", p.status, p.note, p.connected_at as "connectedAt", o.name as "organizationName", p.organization_id as "organizationId"
      from sold_printers p left join organizations o on o.id = p.organization_id order by p.created_at desc limit 1000`);
  });

  app.post("/platform-admin/sold-printers", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      deviceType: deviceType.default("printer"), serialNumber: numberField("serial number"), billNumber: numberField("bill number"), model: z.string().trim().min(2, "Enter the model").max(120),
      organizationId: z.uuid().nullable().optional(), customerName: z.string().trim().max(160).optional(), soldOn: z.iso.date().optional(), note: z.string().trim().max(300).optional(),
    }).parse(req.body);
    await assertSerialFree(db, body.serialNumber);
    // Typing the shop's exact name ties the printer to that shop, so no other shop can connect it.
    const named = !body.organizationId && body.customerName ? await db.execute<{ id: string }>(sql`select id from organizations where lower(name) = lower(${body.customerName}) limit 2`) : [];
    const [row] = await db.insert(schema.soldPrinters).values({ deviceType: body.deviceType, serialNumber: body.serialNumber, billNumber: body.billNumber, model: body.model, organizationId: body.organizationId ?? (named.length === 1 ? named[0].id : null), customerName: body.customerName || null, soldOn: body.soldOn ?? null, note: body.note || null, createdBy: auth.userId }).returning();
    await audit(db, req, { action: "platform.printer_sold", resourceType: "sold_printer", resourceId: row.id, actorUserId: auth.userId, after: row });
    reply.code(201);
    return row;
  });

  /**
   * Disabling takes a device out of use at once and disconnects it from its shop; allowing it again means connecting it
   * again. On a PC this applies when the shop's key is renewed, since the PC works offline.
   */
  app.post("/platform-admin/sold-printers/:id/status", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(["active", "revoked"]) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [row] = await tx.update(schema.soldPrinters).set({ status, ...(status === "revoked" ? { connectedAt: null } : {}), updatedAt: new Date() }).where(eq(schema.soldPrinters.id, id)).returning();
      if (!row) throw notFound("Device");
      if (status === "revoked") await tx.delete(schema.shopPrinters).where(eq(schema.shopPrinters.serialNumber, row.serialNumber));
      await audit(tx, req, { action: `platform.printer_${status}`, resourceType: "sold_printer", resourceId: id, actorUserId: auth.userId, after: row });
      return row;
    });
  });

  /** Changing a device: the old one is disabled and the new one is recorded for the same shop, in one step. */
  app.post("/platform-admin/sold-printers/:id/replace", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ serialNumber: numberField("serial number"), billNumber: numberField("bill number"), model: z.string().trim().min(2, "Enter the model").max(120).optional(), reason: z.string().trim().min(3, "Enter why it is being replaced").max(300) }).parse(req.body);
    const replaced = await db.transaction(async (tx) => {
      const old = await tx.query.soldPrinters.findFirst({ where: eq(schema.soldPrinters.id, id) });
      if (!old) throw notFound("Device");
      await assertSerialFree(tx, body.serialNumber);
      await tx.update(schema.soldPrinters).set({ status: "revoked", connectedAt: null, note: `Replaced by ${body.serialNumber}: ${body.reason}`, updatedAt: new Date() }).where(eq(schema.soldPrinters.id, id));
      await tx.delete(schema.shopPrinters).where(eq(schema.shopPrinters.serialNumber, old.serialNumber));
      const [row] = await tx.insert(schema.soldPrinters).values({ deviceType: old.deviceType, serialNumber: body.serialNumber, billNumber: body.billNumber, model: body.model ?? old.model, organizationId: old.organizationId, customerName: old.customerName, soldOn: new Date().toISOString().slice(0, 10), note: `Replaces ${old.serialNumber}: ${body.reason}`, createdBy: auth.userId }).returning();
      await audit(tx, req, { action: "platform.printer_replaced", resourceType: "sold_printer", resourceId: row.id, actorUserId: auth.userId, before: old, after: row });
      return row;
    });
    reply.code(201);
    return replaced;
  });
}
