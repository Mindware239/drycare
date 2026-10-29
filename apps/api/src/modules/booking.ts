/**
 * Online pickup booking: each shop can switch on a public page (/book?s=<shop>) where customers request a pickup.
 * Requests become scheduled pickups in Pickups & deliveries, marked "Online booking", for staff to confirm.
 */
import type { FastifyInstance } from "fastify";
import bwipjs from "bwip-js";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TIME_SLOTS } from "@drycare/shared";
import { db, schema } from "../db/client";
import { requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { nextNumber, pad } from "../lib/sequences";
import { accessState } from "../lib/subscriptionAccess";
import { env, isDesktop } from "../env";
import { normalizePhone } from "./customers";

const settingsSchema = z.object({ enabled: z.boolean(), branchId: z.uuid().optional(), message: z.string().trim().max(300).optional() });
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function publicShop(slug: string) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.slug, slug) });
  const ob = org?.settings.onlineBooking;
  if (!org || org.settings.platformInternal || !ob?.enabled) return null;
  const branch = ob.branchId
    ? await db.query.branches.findFirst({ where: and(eq(schema.branches.id, ob.branchId), eq(schema.branches.organizationId, org.id)) })
    : await db.query.branches.findFirst({ where: eq(schema.branches.organizationId, org.id), orderBy: (b, { asc }) => asc(b.createdAt) });
  if (!branch) return null;
  return { org, branch, message: ob.message ?? "" };
}

export async function bookingRoutes(app: FastifyInstance) {
  app.get("/booking/settings", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    return { settings: org?.settings.onlineBooking ?? { enabled: false }, slug: org?.slug, url: `${env.WEB_ORIGIN}/book?s=${org?.slug}`, desktop: isDesktop };
  });

  app.put("/booking/settings", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const body = settingsSchema.parse(req.body);
    if (body.branchId) {
      const b = await db.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!b) throw badRequest("Branch not found");
    }
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    await db.update(schema.organizations).set({ settings: { ...org!.settings, onlineBooking: body }, updatedAt: new Date() }).where(eq(schema.organizations.id, auth.orgId));
    await audit(db, req, { action: "booking.settings_updated", resourceType: "organization", resourceId: auth.orgId, before: org!.settings.onlineBooking, after: body });
    return { settings: body, slug: org!.slug, url: `${env.WEB_ORIGIN}/book?s=${org!.slug}`, desktop: isDesktop };
  });

  app.get("/booking/qr", async (req, reply) => {
    const auth = requirePermission(req, "org.manage");
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: `${env.WEB_ORIGIN}/book?s=${org!.slug}`, scale: 4, eclevel: "M" } as Parameters<typeof bwipjs.toSVG>[0]);
    reply.header("content-type", "image/svg+xml");
    return svg;
  });

  app.get("/public/booking/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string().min(2).max(80) }).parse(req.params);
    const shop = await publicShop(slug);
    if (!shop || !(await accessState(shop.org.id)).writable) throw notFound("Online booking for this shop");
    const addr = shop.branch.address ?? {};
    return {
      shopName: shop.org.name,
      branchName: shop.branch.name,
      phone: shop.branch.phone ?? shop.org.settings.billing?.phone ?? null,
      address: [addr.line1, addr.city].filter(Boolean).join(", "),
      message: shop.message,
      slots: TIME_SLOTS,
      firstDate: istToday(),
    };
  });

  app.post("/public/booking/:slug", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { slug } = z.object({ slug: z.string().min(2).max(80) }).parse(req.params);
    const body = z.object({
      name: z.string().trim().min(2, "Enter your name").max(80),
      phone: z.string().trim().regex(/^[+\d][\d\s-]{9,15}$/, "Enter a valid mobile number"),
      line1: z.string().trim().min(5, "Enter your address").max(200),
      area: z.string().trim().max(80).optional(),
      city: z.string().trim().max(60).optional(),
      pincode: z.string().trim().regex(/^\d{6}$/, "PIN code is 6 digits").optional().or(z.literal("")),
      date: z.iso.date(),
      slot: z.enum(TIME_SLOTS),
      items: z.string().trim().max(300).optional(),
      notes: z.string().trim().max(300).optional(),
      /** Honeypot: real visitors never see or fill this field. */
      website: z.string().max(200).optional(),
    }).parse(req.body);
    if (body.website) return { ok: true }; // silently drop bots
    const shop = await publicShop(slug);
    if (!shop || !(await accessState(shop.org.id)).writable) throw notFound("Online booking for this shop");
    const today = istToday();
    const maxDate = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
    if (body.date < today || body.date > maxDate) throw badRequest("Choose a date within the next 30 days");
    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) throw badRequest("Enter a valid mobile number");
    const orgId = shop.org.id;
    const [owner] = await db.execute<{ user_id: string }>(sql`
      select m.user_id from organization_memberships m join roles r on r.id = m.role_id and r.key = 'owner'
      where m.organization_id = ${orgId} and m.status = 'active' order by m.created_at limit 1`);
    if (!owner) throw notFound("Online booking for this shop");

    const result = await db.transaction(async (tx) => {
      let customer = await tx.query.customers.findFirst({ where: and(eq(schema.customers.organizationId, orgId), eq(schema.customers.phoneNormalized, phoneNormalized), eq(schema.customers.status, "active")) });
      if (customer) {
        const [{ open }] = await tx.execute<{ open: number }>(sql`
          select count(*)::int as open from pickup_deliveries where customer_id = ${customer.id} and kind = 'pickup' and status in ('scheduled','assigned') and instructions like 'Online booking%'`);
        if (open >= 2) throw conflict("You already have pickup requests waiting. The shop will call you to confirm.", "TOO_MANY_REQUESTS");
      } else {
        const n = await nextNumber(tx, orgId, "customer");
        [customer] = await tx.insert(schema.customers).values({
          organizationId: orgId, customerCode: `C-${pad(n)}`, name: body.name, phone: body.phone, phoneNormalized,
          homeBranchId: shop.branch.id, notes: "Added from the online booking page",
        }).returning();
      }
      const address = { line1: body.line1, ...(body.area ? { line2: body.area } : {}), ...(body.city ? { city: body.city } : {}), ...(body.pincode ? { pincode: body.pincode } : {}) };
      const [pickup] = await tx.insert(schema.deliveries).values({
        organizationId: orgId, branchId: shop.branch.id, customerId: customer.id, kind: "pickup", status: "scheduled",
        address, contactPhone: body.phone, scheduledDate: body.date, timeSlot: body.slot,
        instructions: `Online booking${body.items ? ` · Items: ${body.items}` : ""}${body.notes ? ` · ${body.notes}` : ""}`.slice(0, 500),
        collectAmount: 0, createdBy: owner.user_id,
      }).returning();
      await tx.insert(schema.auditLogs).values({ organizationId: orgId, action: "booking.requested", resourceType: "pickup", resourceId: pickup.id, after: { customer: customer.customerCode, date: body.date, slot: body.slot }, ip: req.ip, requestId: req.id });
      return { pickup, customer };
    });
    reply.code(201);
    return { ok: true, shopName: shop.org.name, date: body.date, slot: body.slot, reference: result.pickup.id.slice(0, 8).toUpperCase() };
  });
}
