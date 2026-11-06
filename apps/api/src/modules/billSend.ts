/** Sends an order's bill to the customer by email, in the shop's own wording. WhatsApp opens on the staff's device instead. */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_BILL_MESSAGES, formatMoney, renderBillMessage } from "@drycare/shared";
import { db, schema } from "../db/client";
import { audit } from "../lib/audit";
import { assertBranchAccess, requirePermission } from "../lib/context";
import { unprocessable } from "../lib/errors";
import { getOrderDetail } from "./orders";

export async function billSendRoutes(app: FastifyInstance) {
  app.post("/orders/:orderId/send-bill", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    z.object({ channel: z.literal("email") }).parse(req.body);
    const o = await getOrderDetail(db, auth.orgId, orderId);
    assertBranchAccess(auth, o.branchId);
    const to = o.customer?.email;
    if (!to) throw unprocessable("This customer has no email address. Add one on the customer's page first.", "NO_EMAIL");
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { name: true, settings: true, defaultCurrency: true, defaultTimezone: true } });
    const messages = org?.settings.billTemplates?.messages ?? DEFAULT_BILL_MESSAGES;
    const when = new Intl.DateTimeFormat(auth.currency === "INR" ? "en-IN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: auth.timezone }).format(o.promisedAt);
    const values = {
      customer: o.customer?.name, shop: org?.name, shopPhone: org?.settings.billing?.phone || o.branch?.phone, invoice: o.invoice?.invoiceNumber, order: o.orderNumber,
      pieces: o.garments.filter((g) => g.currentStatus !== "cancelled").length, items: o.items.map((i) => `${i.garmentTypeName}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", "),
      total: formatMoney(o.invoice?.payable ?? o.grandTotal, auth.currency), paid: formatMoney(o.invoice?.paid ?? 0, auth.currency), balance: formatMoney(o.invoice?.balance ?? 0, auth.currency), ready: when, upi: org?.settings.billing?.upi?.vpa,
    };
    await db.transaction(async (tx) => {
      await tx.insert(schema.notificationJobs).values({
        organizationId: auth.orgId, customerId: o.customerId, eventType: "bill.sent", channel: "email", recipient: to,
        subject: renderBillMessage(messages.emailSubject, values), body: renderBillMessage(messages.emailBody, values), dedupeKey: `bill:${orderId}:${randomUUID()}`, status: "queued",
      });
      await audit(tx, req, { action: "bill.emailed", resourceType: "order", resourceId: orderId, after: { to } });
    });
    return { to };
  });
}
