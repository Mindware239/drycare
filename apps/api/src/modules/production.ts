import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import bwipjs from "bwip-js";
import { allowedTransitions, findTransition, inspectionSchema, reworkTarget, storageAssignSchema, transitionSchema, type GarmentStage } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { assertBranchAccess, can, requirePermission, type AuthContext } from "../lib/context";
import { audit } from "../lib/audit";
import { forbidden, notFound, unprocessable, badRequest } from "../lib/errors";
import { recordGarmentTransition, refreshOrderStatus } from "../lib/orderStatus";

async function garmentView(tx: DbOrTx, auth: AuthContext, where: ReturnType<typeof eq>) {
  const [row] = await tx
    .select({
      garment: schema.garments,
      orderNumber: schema.orders.orderNumber,
      orderStatus: schema.orders.operationalStatus,
      promisedAt: schema.orders.promisedAt,
      express: schema.orders.express,
      customerName: schema.customers.name,
      item: schema.orderItems,
      storageCode: schema.storageLocations.code,
    })
    .from(schema.garments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.garments.orderId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.garments.orderItemId))
    .leftJoin(schema.storageLocations, eq(schema.storageLocations.id, schema.garments.storageLocationId))
    .where(and(eq(schema.garments.organizationId, auth.orgId), where))
    .limit(1);
  if (!row) throw notFound("Garment");
  assertBranchAccess(auth, row.garment.currentBranchId);
  const history = await tx.execute(sql`
    select h.previous_status, h.new_status, h.transition_kind, h.notes, h.occurred_at, u.name as actor
    from garment_status_history h left join users u on u.id = h.actor_user_id where h.garment_id = ${row.garment.id} order by h.occurred_at desc`);
  const inspections = await tx.query.qualityInspections.findMany({ where: eq(schema.qualityInspections.garmentId, row.garment.id), orderBy: desc(schema.qualityInspections.createdAt) });
  const siblings = await tx.execute(sql`select count(*)::int as total, count(*) filter (where current_status in ('ready','delivered'))::int as done from garments where order_id = ${row.garment.orderId} and current_status <> 'cancelled'`);
  const allowed = allowedTransitions(row.garment.workflowStages as GarmentStage[], row.garment.currentStatus as GarmentStage).map((t) => ({
    ...t,
    permitted: !t.permission || can(auth, t.permission),
  }));
  return {
    ...row.garment,
    orderNumber: row.orderNumber,
    orderStatus: row.orderStatus,
    promisedAt: row.promisedAt,
    express: row.express,
    overdue: row.promisedAt < new Date() && !["ready", "delivered", "dispatched", "cancelled"].includes(row.garment.currentStatus),
    customerName: row.customerName,
    garmentTypeName: row.item.garmentTypeName,
    serviceName: row.item.serviceName,
    colour: row.item.colour,
    brand: row.item.brand,
    fabric: row.item.fabric,
    conditionNotes: row.item.conditionNotes,
    conditionFlags: row.item.conditionFlags,
    careInstructions: row.item.careInstructions,
    storageCode: row.storageCode,
    orderProgress: siblings[0],
    allowed,
    history,
    inspections,
  };
}

const garmentIdParam = z.object({ garmentId: z.uuid() });

export async function productionRoutes(app: FastifyInstance) {
  // Screen F01: scanner input resolves a tag (FR-GAR-002). Scanners type the code followed by Enter.
  app.get("/garments/by-tag/:tagCode", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { tagCode } = z.object({ tagCode: z.string().trim().min(3).max(60) }).parse(req.params);
    return garmentView(db, auth, eq(schema.garments.tagCode, tagCode.toUpperCase()));
  });

  app.get("/garments/:garmentId", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const { garmentId } = garmentIdParam.parse(req.params);
    return garmentView(db, auth, eq(schema.garments.id, garmentId));
  });

  // FR-WF-003/004, SRS §9.4: validated transitions only; actor, time, previous and new stage recorded.
  app.post("/garments/:garmentId/transitions", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { garmentId } = garmentIdParam.parse(req.params);
    const body = transitionSchema.extend({ version: z.number().int().optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const [g] = await tx.select().from(schema.garments).where(and(eq(schema.garments.id, garmentId), eq(schema.garments.organizationId, auth.orgId))).for("update");
      if (!g) throw notFound("Garment");
      assertBranchAccess(auth, g.currentBranchId);
      if (body.version !== undefined && body.version !== g.version) throw unprocessable("This garment was updated by someone else. Rescan and try again.", "STALE_VERSION");
      const t = findTransition(g.workflowStages as GarmentStage[], g.currentStatus as GarmentStage, body.to);
      if (!t) throw unprocessable(`Cannot move from ${g.currentStatus} to ${body.to}`, "INVALID_TRANSITION");
      if (t.kind === "qc_pass" || t.kind === "qc_fail") throw unprocessable("Submit a quality inspection to pass or fail this garment", "USE_INSPECTION");
      if (t.permission && !can(auth, t.permission)) throw forbidden();
      if (t.kind === "exception" && !body.notes?.trim()) throw badRequest("Describe the exception (e.g. missing from rack, damage found)");
      if (["cleaning", "drying", "finishing", "quality_control", "rework", "packing", "ready", "dispatched", "delivered"].includes(body.to)) {
        const [pendingApproval] = await tx.execute<{ id: string }>(sql`
          select id from customer_approvals
          where organization_id = ${auth.orgId} and order_item_id = ${g.orderItemId} and status = 'pending'
          limit 1
        `);
        if (pendingApproval) throw unprocessable("Customer approval is required before production can continue", "CUSTOMER_APPROVAL_REQUIRED");
      }
      // Shop racks only exist at the shop; garments finished at a central facility are racked when they come back.
      const atShop = !["at_facility", "in_transit_to_facility", "in_transit_to_shop"].includes(g.location);
      if (body.to === "ready" && atShop && !g.storageLocationId) throw unprocessable("Assign a rack / storage location before marking ready", "LOCATION_REQUIRED");
      if (t.kind === "rework_return") {
        await tx.update(schema.reworkRecords).set({ resolvedAt: new Date() }).where(and(eq(schema.reworkRecords.garmentId, g.id), sql`${schema.reworkRecords.resolvedAt} is null`));
      }
      await recordGarmentTransition(tx, g, body.to, t.kind, auth.userId, { notes: body.notes, correlationId: req.id });
      if (t.kind === "exception" || t.kind === "exception_resolve") {
        await audit(tx, req, { action: `garment.${t.kind}`, resourceType: "garment", resourceId: g.id, before: { status: g.currentStatus }, after: { status: body.to, notes: body.notes } });
      }
      await refreshOrderStatus(tx, auth.orgId, g.orderId);
      return garmentView(tx, auth, eq(schema.garments.id, g.id));
    });
  });

  // Screen F02 / SRS §8.3: inspection result drives pass → packing or fail → rework.
  app.post("/garments/:garmentId/inspections", async (req, reply) => {
    const auth = requirePermission(req, "qc.approve");
    const { garmentId } = garmentIdParam.parse(req.params);
    const body = inspectionSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [g] = await tx.select().from(schema.garments).where(and(eq(schema.garments.id, garmentId), eq(schema.garments.organizationId, auth.orgId))).for("update");
      if (!g) throw notFound("Garment");
      assertBranchAccess(auth, g.currentBranchId);
      if (g.currentStatus !== "quality_control") throw unprocessable("Garment is not at the quality-control stage", "NOT_AT_QC");
      if (body.outcome === "fail" && !body.reworkReason?.trim()) throw badRequest("A rework reason is required when failing an inspection");
      const [insp] = await tx.insert(schema.qualityInspections).values({ organizationId: auth.orgId, garmentId: g.id, inspectorUserId: auth.userId, outcome: body.outcome, checklist: body.checklist, notes: body.notes }).returning();
      if (body.outcome === "pass") {
        const t = findTransition(g.workflowStages as GarmentStage[], "quality_control", "packing") ?? { to: "packing" as GarmentStage };
        await recordGarmentTransition(tx, g, t.to, "qc_pass", auth.userId, { notes: body.notes, correlationId: req.id, set: { qcPassedAt: new Date() } });
      } else {
        const target = reworkTarget(g.workflowStages as GarmentStage[]);
        await tx.insert(schema.reworkRecords).values({ organizationId: auth.orgId, garmentId: g.id, inspectionId: insp.id, reason: body.reworkReason!, returnedTo: target, createdBy: auth.userId });
        await recordGarmentTransition(tx, g, "rework", "qc_fail", auth.userId, { notes: body.reworkReason, correlationId: req.id, set: { qcPassedAt: null } });
      }
      await refreshOrderStatus(tx, auth.orgId, g.orderId);
      return garmentView(tx, auth, eq(schema.garments.id, g.id));
    });
    reply.code(201);
    return result;
  });

  app.post("/garments/:garmentId/storage-location", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { garmentId } = garmentIdParam.parse(req.params);
    const body = storageAssignSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const g = await tx.query.garments.findFirst({ where: and(eq(schema.garments.id, garmentId), eq(schema.garments.organizationId, auth.orgId)) });
      if (!g) throw notFound("Garment");
      const loc = await tx.query.storageLocations.findFirst({ where: and(eq(schema.storageLocations.id, body.storageLocationId), eq(schema.storageLocations.organizationId, auth.orgId)) });
      if (!loc || loc.branchId !== g.currentBranchId) throw badRequest("Storage location does not belong to the garment's branch");
      await tx.update(schema.garments).set({ storageLocationId: loc.id, updatedAt: new Date() }).where(eq(schema.garments.id, g.id));
      await tx.insert(schema.garmentStatusHistory).values({ organizationId: auth.orgId, garmentId: g.id, previousStatus: g.currentStatus, newStatus: g.currentStatus, transitionKind: "location", actorUserId: auth.userId, branchId: g.currentBranchId, notes: `Stored at ${loc.code}` });
      return garmentView(tx, auth, eq(schema.garments.id, g.id));
    });
  });

  // Screen C03: production board grouped by stage.
  app.get("/production/queues", async (req) => {
    const auth = requirePermission(req, "orders.read");
    const q = z.object({ branchId: z.uuid().optional() }).parse(req.query);
    if (q.branchId) assertBranchAccess(auth, q.branchId);
    const branchFilter = q.branchId
      ? sql`and g.current_branch_id = ${q.branchId}`
      : auth.branchIds.length
        ? sql`and g.current_branch_id = any(${`{${auth.branchIds.join(",")}}`}::uuid[])`
        : sql``;
    const rows = await db.execute(sql`
      select g.id, g.tag_code, g.current_status, g.version, g.workflow_stages, g.location, g.assigned_user_id, g.storage_location_id,
             o.id as order_id, o.order_number, o.promised_at, o.express, c.name as customer_name,
             oi.garment_type_name, oi.service_name, oi.colour, sl.code as storage_code, u.name as assigned_to,
             (o.promised_at < now()) as overdue,
             (select max(h.occurred_at) from garment_status_history h where h.garment_id = g.id and h.new_status = g.current_status) as stage_since
      from garments g
      join orders o on o.id = g.order_id join customers c on c.id = o.customer_id join order_items oi on oi.id = g.order_item_id
      left join storage_locations sl on sl.id = g.storage_location_id left join users u on u.id = g.assigned_user_id
      where g.organization_id = ${auth.orgId} and g.current_status not in ('delivered','cancelled') ${branchFilter}
      order by o.express desc, o.promised_at asc
      limit 1000
    `);
    return rows;
  });

  app.get("/production/staff", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { branchId } = z.object({ branchId: z.uuid() }).parse(req.query);
    assertBranchAccess(auth, branchId);
    return db.execute(sql`
      select u.id as "userId", u.name
      from organization_memberships m
      join users u on u.id = m.user_id
      join roles r on r.id = m.role_id
      where m.organization_id = ${auth.orgId}
        and m.status = 'active'
        and u.status = 'active'
        and 'garments.process' = any(r.permissions)
        and (cardinality(m.branch_ids) = 0 or ${branchId} = any(m.branch_ids))
      order by u.name
    `);
  });

  app.post("/garments/:garmentId/assignments", async (req) => {
    const auth = requirePermission(req, "garments.process");
    const { garmentId } = garmentIdParam.parse(req.params);
    const body = z.object({ userId: z.uuid().nullable(), version: z.number().int() }).parse(req.body);
    return db.transaction(async (tx) => {
      const [garment] = await tx
        .select()
        .from(schema.garments)
        .where(and(eq(schema.garments.id, garmentId), eq(schema.garments.organizationId, auth.orgId)))
        .for("update");
      if (!garment) throw notFound("Garment");
      assertBranchAccess(auth, garment.currentBranchId);
      if (body.version !== garment.version) throw unprocessable("This garment was updated by someone else. Rescan and try again.", "STALE_VERSION");
      if (body.userId) {
        const [assignee] = await tx.execute<{ userId: string; name: string }>(sql`
          select u.id as "userId", u.name
          from organization_memberships m
          join users u on u.id = m.user_id
          join roles r on r.id = m.role_id
          where m.organization_id = ${auth.orgId}
            and m.user_id = ${body.userId}
            and m.status = 'active'
            and u.status = 'active'
            and 'garments.process' = any(r.permissions)
            and (cardinality(m.branch_ids) = 0 or ${garment.currentBranchId} = any(m.branch_ids))
          limit 1
        `);
        if (!assignee) throw badRequest("Choose an active production employee who can access this branch");
      }
      if (garment.assignedUserId === body.userId) return garmentView(tx, auth, eq(schema.garments.id, garment.id));

      const [updated] = await tx
        .update(schema.garments)
        .set({ assignedUserId: body.userId, version: sql`${schema.garments.version} + 1`, updatedAt: new Date() })
        .where(and(eq(schema.garments.id, garment.id), eq(schema.garments.version, body.version)))
        .returning();
      if (!updated) throw unprocessable("This garment was updated by someone else. Rescan and try again.", "STALE_VERSION");
      await audit(tx, req, {
        action: body.userId ? "garment.assigned" : "garment.unassigned",
        resourceType: "garment",
        resourceId: garment.id,
        before: { assignedUserId: garment.assignedUserId },
        after: { assignedUserId: body.userId },
      });
      return garmentView(tx, auth, eq(schema.garments.id, garment.id));
    });
  });

  app.get("/production/overdue", async (req) => {
    const auth = requirePermission(req, "orders.read");
    return db.execute(sql`
      select o.id, o.order_number, o.promised_at, o.operational_status, c.name as customer_name, c.phone,
             (select count(*)::int from garments g where g.order_id = o.id and g.current_status not in ('ready','delivered','cancelled','dispatched')) as pending_garments
      from orders o join customers c on c.id = o.customer_id
      where o.organization_id = ${auth.orgId} and o.promised_at < now() and o.operational_status in ('received','in_processing','partially_ready')
      order by o.promised_at asc limit 200
    `);
  });

  // Barcode image for garment labels (Code 128). Printed via the browser at the configured label size.
  app.get("/garments/barcode/:tagCode", async (req, reply) => {
    requirePermission(req, "orders.read");
    const { tagCode } = z.object({ tagCode: z.string().regex(/^[A-Z0-9-]{3,60}$/) }).parse(req.params);
    const { type } = z.object({ type: z.enum(["code128", "qrcode"]).default("code128") }).parse(req.query);
    // Bag codes use the same endpoint; the value is only an internal reference, never customer data.
    const svg = type === "qrcode"
      ? bwipjs.toSVG({ bcid: "qrcode", text: tagCode, scale: 3, eclevel: "M" } as Parameters<typeof bwipjs.toSVG>[0])
      : bwipjs.toSVG({ bcid: "code128", text: tagCode, scale: 2, height: 10, includetext: false });
    reply.header("content-type", "image/svg+xml").header("cache-control", "private, max-age=86400");
    return svg;
  });
}
