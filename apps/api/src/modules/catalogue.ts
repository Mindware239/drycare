import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { garmentTypeSchema, priceListSchema, servicePriceSchema, serviceSchema, validateTemplate } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { assertBranchAccess, can, requireAuth, requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { installStandardCatalogue } from "../lib/standardCatalogue";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";

function requireCatalogueRead(req: Parameters<typeof requireAuth>[0]) {
  const auth = requireAuth(req);
  if (!can(auth, "catalogue.manage") && !can(auth, "orders.read") && !can(auth, "orders.create")) {
    throw forbidden("Catalogue access requires orders.read, orders.create, or catalogue.manage");
  }
  return auth;
}

export interface ResolvedPrice {
  servicePriceId: string;
  unitPrice: number;
  taxBps: number;
  minimumCharge: number;
}

/**
 * Price resolution: the price row effective at `at`, preferring a branch-specific price list over
 * the organization-wide one.
 */
export async function resolvePrice(tx: DbOrTx, orgId: string, branchId: string, garmentTypeId: string, serviceId: string, at = new Date()): Promise<ResolvedPrice | undefined> {
  const rows = await tx.execute<{ id: string; unit_price: string; tax_bps: number; minimum_charge: string }>(sql`
    select sp.id, sp.unit_price, sp.tax_bps, sp.minimum_charge
    from service_prices sp join price_lists pl on pl.id = sp.price_list_id
    where sp.organization_id = ${orgId} and pl.status = 'active'
      and (pl.branch_id = ${branchId} or pl.branch_id is null)
      and sp.garment_type_id = ${garmentTypeId} and sp.service_id = ${serviceId}
      and sp.effective_from <= ${at.toISOString()} and (sp.effective_to is null or sp.effective_to > ${at.toISOString()})
      and pl.effective_from <= ${at.toISOString()} and (pl.effective_to is null or pl.effective_to > ${at.toISOString()})
    order by (pl.branch_id is not null) desc, sp.effective_from desc
    limit 1
  `);
  const r = rows[0];
  if (!r) return undefined;
  return { servicePriceId: r.id, unitPrice: Number(r.unit_price), taxBps: r.tax_bps, minimumCharge: Number(r.minimum_charge) };
}

export async function catalogueRoutes(app: FastifyInstance) {
  app.get("/garment-types", async (req) => {
    const auth = requireCatalogueRead(req);
    return db.select({
      id: schema.garmentTypes.id,
      organizationId: schema.garmentTypes.organizationId,
      name: schema.garmentTypes.name,
      category: schema.garmentTypes.category,
      active: schema.garmentTypes.active,
      hasImage: sql<boolean>`${schema.garmentTypes.photoMimeType} is not null`,
      createdAt: schema.garmentTypes.createdAt,
    }).from(schema.garmentTypes)
      .where(eq(schema.garmentTypes.organizationId, auth.orgId))
      .orderBy(asc(schema.garmentTypes.category), asc(schema.garmentTypes.name));
  });

  app.post("/garment-types", async (req, reply) => {
    const auth = requirePermission(req, "catalogue.manage");
    const body = garmentTypeSchema.parse(req.body);
    const [row] = await db.insert(schema.garmentTypes).values({ organizationId: auth.orgId, ...body }).returning();
    await audit(db, req, { action: "garment_type.created", resourceType: "garment_type", resourceId: row.id, after: row });
    reply.code(201);
    return row;
  });

  app.patch("/garment-types/:id", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = garmentTypeSchema.partial().parse(req.body);
    const [row] = await db.update(schema.garmentTypes).set(body).where(and(eq(schema.garmentTypes.id, id), eq(schema.garmentTypes.organizationId, auth.orgId))).returning();
    if (!row) throw notFound("Garment type");
    await audit(db, req, { action: "garment_type.updated", resourceType: "garment_type", resourceId: id, after: row });
    return row;
  });

  app.put("/garment-types/:id/image", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      data: z.string().min(1).max(820_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    }).parse(req.body);
    const photoData = Buffer.from(body.data, "base64");
    if (!photoData.length || photoData.length > 600_000 || photoData.toString("base64") !== body.data) throw badRequest("Image must be 600 KB or smaller");
    const validSignature =
      (body.mimeType === "image/jpeg" && photoData[0] === 0xff && photoData[1] === 0xd8 && photoData[2] === 0xff) ||
      (body.mimeType === "image/png" && photoData.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (body.mimeType === "image/webp" && photoData.toString("ascii", 0, 4) === "RIFF" && photoData.toString("ascii", 8, 12) === "WEBP");
    if (!validSignature) throw badRequest("The uploaded file does not match a supported image format");
    const [row] = await db.update(schema.garmentTypes)
      .set({ photoData, photoMimeType: body.mimeType })
      .where(and(eq(schema.garmentTypes.id, id), eq(schema.garmentTypes.organizationId, auth.orgId)))
      .returning({ id: schema.garmentTypes.id });
    if (!row) throw notFound("Garment type");
    await audit(db, req, { action: "garment_type.image_updated", resourceType: "garment_type", resourceId: id });
    return { ok: true };
  });

  app.delete("/garment-types/:id/image", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [row] = await db.update(schema.garmentTypes)
      .set({ photoData: null, photoMimeType: null })
      .where(and(eq(schema.garmentTypes.id, id), eq(schema.garmentTypes.organizationId, auth.orgId)))
      .returning({ id: schema.garmentTypes.id });
    if (!row) throw notFound("Garment type");
    await audit(db, req, { action: "garment_type.image_removed", resourceType: "garment_type", resourceId: id });
    return { ok: true };
  });

  app.get("/garment-types/:id/image", async (req, reply) => {
    const auth = requireCatalogueRead(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const image = await db.query.garmentTypes.findFirst({
      where: and(eq(schema.garmentTypes.id, id), eq(schema.garmentTypes.organizationId, auth.orgId)),
      columns: { photoData: true, photoMimeType: true },
    });
    if (!image?.photoData || !image.photoMimeType) throw notFound("Garment image");
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .type(image.photoMimeType)
      .send(image.photoData);
  });

  /** How many built-in garments this store does not have yet. */
  app.get("/catalogue/standard", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    return db.transaction((tx) => installStandardCatalogue(tx, auth.orgId, { dryRun: true }));
  });

  /** Adds the missing built-in garments with starting prices. Never changes existing garments or prices. */
  app.post("/catalogue/standard", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    return db.transaction(async (tx) => {
      const result = await installStandardCatalogue(tx, auth.orgId);
      await audit(tx, req, { action: "catalogue.standard_installed", resourceType: "garment_type", after: result });
      return result;
    });
  });

  app.get("/services", async (req) => {
    const auth = requireCatalogueRead(req);
    return db.query.services.findMany({ where: eq(schema.services.organizationId, auth.orgId), orderBy: asc(schema.services.name) });
  });

  app.post("/services", async (req, reply) => {
    const auth = requirePermission(req, "catalogue.manage");
    const body = serviceSchema.parse(req.body);
    const stages = safeTemplate(body.workflowStages);
    const [row] = await db.insert(schema.services).values({ organizationId: auth.orgId, ...body, workflowStages: stages }).returning();
    await audit(db, req, { action: "service.created", resourceType: "service", resourceId: row.id, after: row });
    reply.code(201);
    return row;
  });

  app.patch("/services/:id", async (req) => {
    const auth = requirePermission(req, "catalogue.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = serviceSchema.partial().parse(req.body);
    // Existing garments keep the workflow snapshot they were created with.
    const [row] = await db
      .update(schema.services)
      .set({ ...body, workflowStages: body.workflowStages ? safeTemplate(body.workflowStages) : undefined })
      .where(and(eq(schema.services.id, id), eq(schema.services.organizationId, auth.orgId)))
      .returning();
    if (!row) throw notFound("Service");
    await audit(db, req, { action: "service.updated", resourceType: "service", resourceId: id, after: row });
    return row;
  });

  app.get("/price-lists", async (req) => {
    const auth = requireCatalogueRead(req);
    const rows = await db.query.priceLists.findMany({ where: eq(schema.priceLists.organizationId, auth.orgId), orderBy: asc(schema.priceLists.createdAt) });
    return rows.filter((list) => !list.branchId || !auth.branchIds.length || auth.branchIds.includes(list.branchId));
  });

  app.post("/price-lists", async (req, reply) => {
    const auth = requirePermission(req, "catalogue.manage");
    const body = priceListSchema.parse(req.body);
    if (body.branchId) {
      assertBranchAccess(auth, body.branchId);
      const b = await db.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!b) throw notFound("Branch");
    }
    const [row] = await db
      .insert(schema.priceLists)
      .values({ organizationId: auth.orgId, name: body.name, branchId: body.branchId, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date() })
      .returning();
    reply.code(201);
    return row;
  });

  /** Current price matrix for a price list (only rows effective now). */
  app.get("/price-lists/:id/prices", async (req) => {
    const auth = requireCatalogueRead(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const list = await db.query.priceLists.findFirst({ where: and(eq(schema.priceLists.id, id), eq(schema.priceLists.organizationId, auth.orgId)) });
    if (!list) throw notFound("Price list");
    if (list.branchId) assertBranchAccess(auth, list.branchId);
    const at = new Date();
    if (list.status !== "active" || list.effectiveFrom > at || (list.effectiveTo && list.effectiveTo <= at)) return [];
    return db
      .select({
        id: schema.servicePrices.id,
        organizationId: schema.servicePrices.organizationId,
        priceListId: schema.servicePrices.priceListId,
        garmentTypeId: schema.servicePrices.garmentTypeId,
        serviceId: schema.servicePrices.serviceId,
        unitPrice: schema.servicePrices.unitPrice,
        taxBps: schema.servicePrices.taxBps,
        minimumCharge: schema.servicePrices.minimumCharge,
        effectiveFrom: schema.servicePrices.effectiveFrom,
        effectiveTo: schema.servicePrices.effectiveTo,
        createdBy: schema.servicePrices.createdBy,
        createdAt: schema.servicePrices.createdAt,
      })
      .from(schema.servicePrices)
      .where(and(
        eq(schema.servicePrices.organizationId, auth.orgId),
        eq(schema.servicePrices.priceListId, id),
        lte(schema.servicePrices.effectiveFrom, at),
        or(isNull(schema.servicePrices.effectiveTo), gt(schema.servicePrices.effectiveTo, at)),
      ));
  });

  /** Prices the counter will charge right now at a branch, for every garment and service pair (same rule as resolvePrice). */
  app.get("/branch-prices", async (req) => {
    const auth = requireCatalogueRead(req);
    const { branchId } = z.object({ branchId: z.uuid() }).parse(req.query);
    assertBranchAccess(auth, branchId);
    const now = new Date().toISOString();
    return db.execute<{ garmentTypeId: string; serviceId: string; unitPrice: number }>(sql`
      select distinct on (sp.garment_type_id, sp.service_id)
        sp.garment_type_id as "garmentTypeId", sp.service_id as "serviceId", sp.unit_price::bigint as "unitPrice"
      from service_prices sp join price_lists pl on pl.id = sp.price_list_id
      where sp.organization_id = ${auth.orgId} and pl.status = 'active'
        and (pl.branch_id = ${branchId} or pl.branch_id is null)
        and sp.effective_from <= ${now} and (sp.effective_to is null or sp.effective_to > ${now})
        and pl.effective_from <= ${now} and (pl.effective_to is null or pl.effective_to > ${now})
      order by sp.garment_type_id, sp.service_id, (pl.branch_id is not null) desc, sp.effective_from desc
    `);
  });

  app.get("/price-lists/:id/prices/history", async (req) => {
    const auth = requireCatalogueRead(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z.object({ garmentTypeId: z.uuid().optional(), serviceId: z.uuid().optional() }).parse(req.query);
    const list = await db.query.priceLists.findFirst({ where: and(eq(schema.priceLists.id, id), eq(schema.priceLists.organizationId, auth.orgId)) });
    if (!list) throw notFound("Price list");
    if (list.branchId) assertBranchAccess(auth, list.branchId);
    if (list.status !== "active") throw badRequest("Prices cannot be changed on an inactive price list", "PRICE_LIST_INACTIVE");
    return db
      .select({
        id: schema.servicePrices.id,
        garmentTypeId: schema.servicePrices.garmentTypeId,
        garmentTypeName: schema.garmentTypes.name,
        serviceId: schema.servicePrices.serviceId,
        serviceName: schema.services.name,
        unitPrice: schema.servicePrices.unitPrice,
        taxBps: schema.servicePrices.taxBps,
        minimumCharge: schema.servicePrices.minimumCharge,
        effectiveFrom: schema.servicePrices.effectiveFrom,
        effectiveTo: schema.servicePrices.effectiveTo,
        createdAt: schema.servicePrices.createdAt,
      })
      .from(schema.servicePrices)
      .innerJoin(schema.garmentTypes, eq(schema.garmentTypes.id, schema.servicePrices.garmentTypeId))
      .innerJoin(schema.services, eq(schema.services.id, schema.servicePrices.serviceId))
      .where(and(
        eq(schema.servicePrices.organizationId, auth.orgId),
        eq(schema.servicePrices.priceListId, id),
        q.garmentTypeId ? eq(schema.servicePrices.garmentTypeId, q.garmentTypeId) : undefined,
        q.serviceId ? eq(schema.servicePrices.serviceId, q.serviceId) : undefined,
      ))
      .orderBy(desc(schema.servicePrices.effectiveFrom), desc(schema.servicePrices.createdAt));
  });

  /**
   * FR-CAT-003/005: setting a price closes the currently effective row and inserts a new one,
   * so historical orders and price history are preserved.
   */
  app.post("/price-lists/:id/prices", async (req, reply) => {
    const auth = requirePermission(req, "catalogue.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = servicePriceSchema.parse(req.body);
    const list = await db.query.priceLists.findFirst({ where: and(eq(schema.priceLists.id, id), eq(schema.priceLists.organizationId, auth.orgId)) });
    if (!list) throw notFound("Price list");
    if (list.branchId) assertBranchAccess(auth, list.branchId);
    const [gt, svc] = await Promise.all([
      db.query.garmentTypes.findFirst({ where: and(eq(schema.garmentTypes.id, body.garmentTypeId), eq(schema.garmentTypes.organizationId, auth.orgId)) }),
      db.query.services.findFirst({ where: and(eq(schema.services.id, body.serviceId), eq(schema.services.organizationId, auth.orgId)) }),
    ]);
    if (!gt || !svc) throw badRequest("Unknown garment type or service");
    const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
    if (effectiveFrom < list.effectiveFrom || (list.effectiveTo && effectiveFrom >= list.effectiveTo)) {
      throw badRequest("Price effective date must fall within the price list's effective period", "PRICE_OUTSIDE_LIST_PERIOD");
    }
    const row = await db.transaction(async (tx) => {
      const history = await tx.execute<{ id: string; effective_from: string | Date; effective_to: string | Date | null; unit_price: string; tax_bps: number }>(sql`
        select id, effective_from, effective_to, unit_price, tax_bps
        from service_prices
        where organization_id = ${auth.orgId} and price_list_id = ${id}
          and garment_type_id = ${body.garmentTypeId} and service_id = ${body.serviceId}
        order by effective_from for update
      `);
      if (history.some((price) => timestamp(price.effective_from).getTime() === effectiveFrom.getTime())) {
        throw conflict("A price already exists with this effective date. Choose a different date and time.", "PRICE_EFFECTIVE_DATE_CONFLICT");
      }
      const previous = history
        .filter((price) => timestamp(price.effective_from) < effectiveFrom && (!price.effective_to || timestamp(price.effective_to) > effectiveFrom))
        .at(-1);
      const next = history.find((price) => timestamp(price.effective_from) > effectiveFrom);
      if (previous) {
        await tx.update(schema.servicePrices).set({ effectiveTo: effectiveFrom }).where(eq(schema.servicePrices.id, previous.id));
      }
      const [created] = await tx
        .insert(schema.servicePrices)
        .values({
          organizationId: auth.orgId,
          priceListId: id,
          garmentTypeId: body.garmentTypeId,
          serviceId: body.serviceId,
          unitPrice: body.unitPrice,
          taxBps: body.taxBps,
          minimumCharge: body.minimumCharge ?? 0,
          effectiveFrom,
          effectiveTo: next ? timestamp(next.effective_from) : undefined,
          createdBy: auth.userId,
        })
        .returning();
      await audit(tx, req, {
        action: "price.set",
        resourceType: "service_price",
        resourceId: created.id,
        before: previous ? { unitPrice: previous.unit_price, taxBps: previous.tax_bps } : null,
        after: { garment: gt.name, service: svc.name, unitPrice: created.unitPrice, taxBps: created.taxBps },
      });
      return created;
    });
    reply.code(201);
    return row;
  });
}

function timestamp(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function safeTemplate(stages: string[]) {
  try {
    return validateTemplate(stages);
  } catch (e) {
    throw badRequest((e as Error).message, "INVALID_WORKFLOW");
  }
}
