/**
 * Modules sold on their own, outside the plans. The RFID module has its own period and price, and each payment gets
 * its own GST invoice, so it never mixes with the shop's plan subscription.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { audit } from "../lib/audit";
import { issueCommercialInvoice } from "../lib/commercialInvoice";
import { requirePlatformAdmin } from "../lib/context";
import { conflict, notFound } from "../lib/errors";

const ADDON = "rfid";
const DAYS_PER_MONTH = 30;

export async function platformAddonRoutes(app: FastifyInstance) {
  app.get("/platform-admin/organizations/:id/addons/rfid", async (req) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const history = await db.query.organizationAddons.findMany({ where: and(eq(schema.organizationAddons.organizationId, id), eq(schema.organizationAddons.addon, ADDON)), orderBy: [desc(schema.organizationAddons.createdAt)], limit: 24 });
    const current = history.find((a) => a.status === "active" && a.endsAt.getTime() > Date.now()) ?? null;
    return { current, history };
  });

  /** Records money received for the RFID module, extends it, and issues a separate invoice. */
  app.post("/platform-admin/organizations/:id/addons/rfid", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      months: z.number().int().min(1).max(60),
      /** Including GST. Zero records a free period, with no invoice. */
      amountPaise: z.number().int().min(0).max(100_000_000_000),
      reference: z.string().trim().max(120).optional(),
      note: z.string().trim().max(300).optional(),
    }).refine((v) => v.amountPaise === 0 || !!v.reference, { message: "Enter the payment reference", path: ["reference"] }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
      if (!org || org.settings.platformInternal) throw notFound("Customer organization");
      const now = new Date();
      const latest = await tx.query.organizationAddons.findFirst({ where: and(eq(schema.organizationAddons.organizationId, id), eq(schema.organizationAddons.addon, ADDON), eq(schema.organizationAddons.status, "active")), orderBy: [desc(schema.organizationAddons.endsAt)] });
      // Paying early adds on to the end date, so the shop never loses days it paid for.
      const startsAt = latest && latest.endsAt > now ? latest.endsAt : now;
      const endsAt = new Date(startsAt.getTime() + body.months * DAYS_PER_MONTH * 86_400_000);
      const [addon] = await tx.insert(schema.organizationAddons).values({ organizationId: id, addon: ADDON, startsAt, endsAt, pricePaise: body.amountPaise, note: body.note || null, createdBy: auth.userId }).returning();
      let invoice = null;
      if (body.amountPaise > 0) {
        const [payment] = await tx.insert(schema.commercialPayments).values({
          organizationId: id, provider: "manual", providerReference: body.reference || `rfid-${randomUUID()}`, amountPaise: body.amountPaise, status: "paid",
          providerPayload: { addon: ADDON, description: "DryCare RFID module", periodStart: startsAt.toISOString(), periodEnd: endsAt.toISOString(), recordedBy: auth.userId },
        }).onConflictDoNothing().returning();
        if (!payment) throw conflict("This payment reference has already been recorded.", "PAYMENT_ALREADY_RECORDED");
        invoice = await issueCommercialInvoice(tx, payment.id);
        await tx.update(schema.organizationAddons).set({ paymentId: payment.id }).where(eq(schema.organizationAddons.id, addon.id));
      }
      await audit(tx, req, { action: "platform.rfid_module_paid", resourceType: "organization", resourceId: id, orgId: id, actorUserId: auth.userId, after: { startsAt, endsAt, amountPaise: body.amountPaise, reference: body.reference, invoice: invoice?.number } });
      return { addon, invoice };
    });
    reply.code(201);
    return result;
  });

  /** RFID tags are goods sold apart from the software, so each sale gets its own invoice and never switches the module on. */
  app.post("/platform-admin/organizations/:id/addons/rfid-tags", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      quantity: z.number().int().min(1).max(10_000_000),
      amountPaise: z.number().int().min(1, "Enter the amount received").max(100_000_000_000),
      reference: z.string().trim().min(1, "Enter the payment reference").max(120),
    }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
      if (!org || org.settings.platformInternal) throw notFound("Customer organization");
      const now = new Date();
      const [payment] = await tx.insert(schema.commercialPayments).values({
        organizationId: id, provider: "manual", providerReference: body.reference, amountPaise: body.amountPaise, status: "paid",
        providerPayload: { addon: "rfid_tags", quantity: body.quantity, description: `RFID tags × ${body.quantity.toLocaleString("en-IN")}`, recordedBy: auth.userId },
      }).onConflictDoNothing().returning();
      if (!payment) throw conflict("This payment reference has already been recorded.", "PAYMENT_ALREADY_RECORDED");
      const invoice = await issueCommercialInvoice(tx, payment.id);
      await tx.insert(schema.organizationAddons).values({ organizationId: id, addon: "rfid_tags", startsAt: now, endsAt: now, pricePaise: body.amountPaise, paymentId: payment.id, note: `${body.quantity} tags`, createdBy: auth.userId });
      await audit(tx, req, { action: "platform.rfid_tags_sold", resourceType: "organization", resourceId: id, orgId: id, actorUserId: auth.userId, after: { quantity: body.quantity, amountPaise: body.amountPaise, reference: body.reference, invoice: invoice?.number } });
      return { invoice };
    });
    reply.code(201);
    return result;
  });

  app.get("/platform-admin/organizations/:id/addons/rfid-tags", async (req) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return db.query.organizationAddons.findMany({ where: and(eq(schema.organizationAddons.organizationId, id), eq(schema.organizationAddons.addon, "rfid_tags")), orderBy: [desc(schema.organizationAddons.createdAt)], limit: 24 });
  });

  /** Ends the module now. Tags and history are kept, ready for when it is switched on again. */
  app.post("/platform-admin/organizations/:id/addons/rfid/stop", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(8, "Give a reason (at least 8 characters)").max(300) }).parse(req.body);
    return db.transaction(async (tx) => {
      const stopped = await tx.update(schema.organizationAddons).set({ status: "stopped", note: reason, updatedAt: new Date() }).where(and(eq(schema.organizationAddons.organizationId, id), eq(schema.organizationAddons.addon, ADDON), eq(schema.organizationAddons.status, "active"))).returning();
      if (!stopped.length) throw conflict("The RFID module is not active for this shop.", "ADDON_NOT_ACTIVE");
      await audit(tx, req, { action: "platform.rfid_module_stopped", resourceType: "organization", resourceId: id, orgId: id, actorUserId: auth.userId, after: { reason } });
      return { stopped: stopped.length };
    });
  });
}
