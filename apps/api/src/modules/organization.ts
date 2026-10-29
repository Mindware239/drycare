import type { FastifyInstance } from "fastify";
import { hash } from "@node-rs/argon2";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { branchSchema, staffAttendanceSchema, staffCreateSchema, staffLeaveSchema, staffProfileSchema, storageLocationSchema } from "@drycare/shared";
import { db, schema } from "../db/client";
import { assertBranchAccess, requirePermission, requireAuth } from "../lib/context";
import { audit } from "../lib/audit";
import { conflict, notFound, badRequest, forbidden } from "../lib/errors";
import { issueToken, linkFor } from "../lib/tokens";
import { GSTIN_PATTERN, billingProfileSchema, labelSettingsSchema } from "@drycare/shared";
import bwipjs from "bwip-js";
import { orgView } from "../lib/orgView";
import { invoiceTotals } from "../lib/balances";

const orgUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(160).optional(),
  gstin: z.string().trim().toUpperCase().refine((v) => v === "" || GSTIN_PATTERN.test(v), "GSTIN should look like 22AAAAA0000A1Z5").optional(),
  settings: z
    .object({
      maxDiscountBpsWithoutApproval: z.number().int().min(0).max(10000).optional(),
      expressSurchargeBps: z.number().int().min(0).max(20000).optional(),
      defaultTurnaroundHours: z.number().int().min(1).max(720).optional(),
      invoiceFooter: z.string().max(500).optional(),
      requireFullPaymentBeforeHandover: z.boolean().optional(),
      customerDuplicateMatch: z.array(z.enum(["phone", "email"])).max(2).optional(),
      labels: labelSettingsSchema.optional(),
      billing: billingProfileSchema.optional(),
      facilityName: z.string().trim().min(2).max(80).optional(),
    })
    .optional(),
});

export async function organizationRoutes(app: FastifyInstance) {
  app.get("/organizations/current", async (req) => {
    const auth = requireAuth(req);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    return org && orgView(org);
  });

  /** Logo for invoices and receipts. Validated by file signature, at most 300 KB. */
  app.put("/organizations/current/logo", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const body = z.object({ mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), data: z.string().min(1).max(410_000) }).parse(req.body);
    const bytes = Buffer.from(body.data, "base64");
    if (!bytes.length || bytes.length > 300_000) throw badRequest("Logo must be 300 KB or smaller");
    const ok =
      (body.mimeType === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (body.mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (body.mimeType === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
    if (!ok) throw badRequest("The file is not a valid PNG, JPEG or WebP image");
    await db.update(schema.organizations).set({ logoData: bytes, logoMimeType: body.mimeType, updatedAt: new Date() }).where(eq(schema.organizations.id, auth.orgId));
    await audit(db, req, { action: "organization.logo_updated", resourceType: "organization", resourceId: auth.orgId, after: { bytes: bytes.length, mimeType: body.mimeType } });
    return { ok: true };
  });

  app.delete("/organizations/current/logo", async (req) => {
    const auth = requirePermission(req, "org.manage");
    await db.update(schema.organizations).set({ logoData: null, logoMimeType: null, updatedAt: new Date() }).where(eq(schema.organizations.id, auth.orgId));
    await audit(db, req, { action: "organization.logo_removed", resourceType: "organization", resourceId: auth.orgId });
    return { ok: true };
  });

  app.get("/organizations/current/logo", async (req, reply) => {
    const auth = requireAuth(req);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { logoData: true, logoMimeType: true } });
    if (!org?.logoData || !org.logoMimeType) throw notFound("Logo");
    return reply.header("Cache-Control", "private, max-age=300").header("X-Content-Type-Options", "nosniff").type(org.logoMimeType).send(org.logoData);
  });

  /**
   * UPI payment QR for an order's outstanding balance, built only from the store's saved UPI ID.
   * Any UPI app (GPay, PhonePe, Paytm, BHIM) opens it with the payee and amount filled in.
   */
  app.get("/orders/:orderId/upi-qr", async (req, reply) => {
    const auth = requirePermission(req, "orders.read");
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.params);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId), columns: { name: true, settings: true } });
    const upi = org?.settings.billing?.upi;
    if (!upi?.vpa) throw notFound("UPI ID is not set up in Business settings");
    const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, auth.orgId)) });
    if (!order) throw notFound("Order");
    const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.orderId, orderId) });
    const totals = invoice ? await invoiceTotals(db, auth.orgId, invoice.id) : undefined;
    const due = Math.max(0, totals?.balance ?? 0);
    const params = new URLSearchParams({ pa: upi.vpa, pn: (upi.payeeName || org!.name).slice(0, 60), cu: "INR", tn: `Order ${order.orderNumber}` });
    if (due > 0) params.set("am", (due / 100).toFixed(2));
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: `upi://pay?${params.toString()}`, scale: 3, eclevel: "M" } as Parameters<typeof bwipjs.toSVG>[0]);
    return reply.header("content-type", "image/svg+xml").header("cache-control", "no-store").send(svg);
  });

  app.patch("/organizations/current", async (req) => {
    const auth = requirePermission(req, "org.manage");
    const body = orgUpdateSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const before = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
      const [after] = await tx
        .update(schema.organizations)
        .set({ name: body.name, legalName: body.legalName, gstin: body.gstin, settings: body.settings ? { ...before!.settings, ...body.settings } : undefined, updatedAt: new Date() })
        .where(eq(schema.organizations.id, auth.orgId))
        .returning();
      await audit(tx, req, { action: "organization.updated", resourceType: "organization", resourceId: auth.orgId, before: before && orgView(before), after: orgView(after) });
      return orgView(after);
    });
  });

  // ---------------- branches
  app.get("/branches", async (req) => {
    const auth = requireAuth(req);
    const rows = await db.query.branches.findMany({ where: eq(schema.branches.organizationId, auth.orgId), orderBy: asc(schema.branches.createdAt) });
    return rows.filter((b) => auth.branchIds.length === 0 || auth.branchIds.includes(b.id));
  });

  app.post("/branches", async (req, reply) => {
    const auth = requirePermission(req, "branches.manage");
    const body = branchSchema.parse(req.body);
    const [row] = await db.transaction(async (tx) => {
      const r = await tx.insert(schema.branches).values({ organizationId: auth.orgId, name: body.name, branchCode: body.branchCode, phone: body.phone, address: body.address ?? {}, timezone: body.timezone, status: body.status }).returning();
      await audit(tx, req, { action: "branch.created", resourceType: "branch", resourceId: r[0].id, after: r[0] });
      return r;
    });
    reply.code(201);
    return row;
  });

  app.patch("/branches/:branchId", async (req) => {
    const auth = requirePermission(req, "branches.manage");
    const { branchId } = z.object({ branchId: z.uuid() }).parse(req.params);
    const body = branchSchema.partial().parse(req.body);
    return db.transaction(async (tx) => {
      const before = await tx.query.branches.findFirst({ where: and(eq(schema.branches.id, branchId), eq(schema.branches.organizationId, auth.orgId)) });
      if (!before) throw notFound("Branch");
      const [after] = await tx.update(schema.branches).set({ ...body, updatedAt: new Date() }).where(eq(schema.branches.id, branchId)).returning();
      await audit(tx, req, { action: "branch.updated", resourceType: "branch", resourceId: branchId, before, after });
      return after;
    });
  });

  // ---------------- storage locations
  app.get("/storage-locations", async (req) => {
    const auth = requireAuth(req);
    const { branchId } = z.object({ branchId: z.uuid().optional() }).parse(req.query);
    return db.query.storageLocations.findMany({
      where: and(eq(schema.storageLocations.organizationId, auth.orgId), branchId ? eq(schema.storageLocations.branchId, branchId) : undefined),
      orderBy: asc(schema.storageLocations.code),
    });
  });

  app.post("/storage-locations", async (req, reply) => {
    const auth = requirePermission(req, "branches.manage");
    const body = storageLocationSchema.parse(req.body);
    const branch = await db.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) });
    if (!branch) throw notFound("Branch");
    const [row] = await db.insert(schema.storageLocations).values({ organizationId: auth.orgId, ...body }).returning();
    reply.code(201);
    return row;
  });

  // ---------------- staff
  app.get("/roles", async (req) => {
    const auth = requireAuth(req);
    return db.query.roles.findMany({ where: eq(schema.roles.organizationId, auth.orgId), orderBy: asc(schema.roles.createdAt) });
  });

  app.get("/staff", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const selection = {
      membershipId: schema.memberships.id,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.memberships.status,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
      branchIds: schema.memberships.branchIds,
      lastLoginAt: schema.users.lastLoginAt,
      phone: schema.staffProfiles.phone,
      address: schema.staffProfiles.address,
      jobTitle: schema.staffProfiles.jobTitle,
      joiningDate: schema.staffProfiles.joiningDate,
      emergencyContactName: schema.staffProfiles.emergencyContactName,
      emergencyContactPhone: schema.staffProfiles.emergencyContactPhone,
      dutySchedule: schema.staffProfiles.dutySchedule,
      photoAvailable: schema.staffProfiles.photoMimeType,
      ...(auth.roleKey === "owner" ? { monthlySalary: schema.staffProfiles.monthlySalary } : {}),
    };
    const rows = await db
      .select(selection)
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .leftJoin(schema.staffProfiles, eq(schema.staffProfiles.membershipId, schema.memberships.id))
      .where(eq(schema.memberships.organizationId, auth.orgId))
      .orderBy(desc(schema.memberships.createdAt));
    return rows.map(({ photoAvailable, ...staff }) => ({
      ...staff,
      photoUrl: photoAvailable ? `/api/v1/staff/${staff.membershipId}/photo` : null,
    }));
  });

  /**
   * MVP staff onboarding: the manager sets an initial password and shares it in person.
   * Email invitations with expiring tokens (FR-AUTH-008) are tracked in docs/PROGRESS.md.
   */
  app.post("/staff", async (req, reply) => {
    const auth = requirePermission(req, "staff.manage");
    const body = staffCreateSchema.parse(req.body);
    if (auth.roleKey !== "owner" && body.monthlySalary !== undefined) throw forbidden("Only owners can view or change staff salary");
    const role = await db.query.roles.findFirst({ where: and(eq(schema.roles.organizationId, auth.orgId), eq(schema.roles.key, body.roleKey)) });
    if (!role) throw badRequest("Unknown role");
    if (role.key === "owner" && auth.roleKey !== "owner") throw badRequest("Only an owner can create another owner");
    if (body.branchIds.length) {
      const owned = await db.select({ id: schema.branches.id }).from(schema.branches).where(and(eq(schema.branches.organizationId, auth.orgId), inArray(schema.branches.id, body.branchIds)));
      if (owned.length !== body.branchIds.length) throw badRequest("Invalid branch");
    }
    const existing = await db.query.users.findFirst({ where: eq(schema.users.email, body.email) });
    if (existing) throw conflict("A user with this email already exists");
    const passwordHash = await hash(body.password);
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({ email: body.email, name: body.name, passwordHash, phone: body.phone ?? null }).returning();
      const [m] = await tx.insert(schema.memberships).values({ organizationId: auth.orgId, userId: user.id, roleId: role.id, branchIds: body.branchIds }).returning();
      await tx.insert(schema.staffProfiles).values({
        organizationId: auth.orgId,
        membershipId: m.id,
        phone: body.phone ?? null,
        address: body.address ?? {},
        jobTitle: body.jobTitle ?? null,
        joiningDate: body.joiningDate ?? null,
        emergencyContactName: body.emergencyContactName ?? null,
        emergencyContactPhone: body.emergencyContactPhone ?? null,
        monthlySalary: auth.roleKey === "owner" ? body.monthlySalary ?? null : null,
        dutySchedule: body.dutySchedule ?? {},
      });
      await audit(tx, req, { action: "staff.created", resourceType: "membership", resourceId: m.id, after: { email: body.email, role: role.key, branchIds: body.branchIds, profileCreated: true } });
      return { userId: user.id, membershipId: m.id };
    });
    reply.code(201);
    return result;
  });

  app.patch("/staff/:membershipId", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["active", "suspended"]).optional(), roleKey: z.string().optional(), branchIds: z.array(z.uuid()).optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const before = await tx.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, auth.orgId)) });
      if (!before) throw notFound("Staff member");
      if (before.userId === auth.userId && body.status === "suspended") throw badRequest("You cannot suspend yourself");
      let roleId: string | undefined;
      if (body.roleKey) {
        const role = await tx.query.roles.findFirst({ where: and(eq(schema.roles.organizationId, auth.orgId), eq(schema.roles.key, body.roleKey)) });
        if (!role) throw badRequest("Unknown role");
        const currentRole = await tx.query.roles.findFirst({ where: eq(schema.roles.id, before.roleId) });
        if (auth.roleKey !== "owner" && (role.key === "owner" || currentRole?.key === "owner")) {
          throw forbidden("Only an owner can assign or change an owner's role");
        }
        roleId = role.id;
      }
      const [after] = await tx.update(schema.memberships).set({ status: body.status, roleId, branchIds: body.branchIds }).where(eq(schema.memberships.id, membershipId)).returning();
      if (body.status === "suspended") {
        // FR-AUTH-003/007: suspension revokes active sessions immediately.
        await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, before.userId), eq(schema.sessions.organizationId, auth.orgId)));
      }
      await audit(tx, req, { action: "staff.updated", resourceType: "membership", resourceId: membershipId, before, after });
      return after;
    });
  });

  app.patch("/staff/:membershipId/profile", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const body = staffProfileSchema.parse(req.body);
    if (auth.roleKey !== "owner" && body.monthlySalary !== undefined) throw forbidden("Only owners can view or change staff salary");

    return db.transaction(async (tx) => {
      const membership = await tx.query.memberships.findFirst({
        where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, auth.orgId)),
      });
      if (!membership) throw notFound("Staff member");

      const before = await tx.query.staffProfiles.findFirst({ where: eq(schema.staffProfiles.membershipId, membershipId) });
      const profileValues = {
        phone: body.phone,
        address: body.address === null ? {} : body.address,
        jobTitle: body.jobTitle,
        joiningDate: body.joiningDate,
        emergencyContactName: body.emergencyContactName,
        emergencyContactPhone: body.emergencyContactPhone,
        monthlySalary: body.monthlySalary,
        dutySchedule: body.dutySchedule === null ? {} : body.dutySchedule,
        updatedAt: new Date(),
      };

      if (before) {
        await tx.update(schema.staffProfiles).set(profileValues).where(eq(schema.staffProfiles.membershipId, membershipId));
      } else {
        await tx.insert(schema.staffProfiles).values({
          organizationId: auth.orgId,
          membershipId,
          phone: body.phone ?? null,
          address: body.address ?? {},
          jobTitle: body.jobTitle ?? null,
          joiningDate: body.joiningDate ?? null,
          emergencyContactName: body.emergencyContactName ?? null,
          emergencyContactPhone: body.emergencyContactPhone ?? null,
          monthlySalary: auth.roleKey === "owner" ? body.monthlySalary ?? null : null,
          dutySchedule: body.dutySchedule ?? {},
        });
      }

      if (body.name || body.phone !== undefined) {
        await tx.update(schema.users)
          .set({ name: body.name, phone: body.phone, updatedAt: new Date() })
          .where(eq(schema.users.id, membership.userId));
      }
      await audit(tx, req, {
        action: "staff.profile_updated",
        resourceType: "membership",
        resourceId: membershipId,
        after: { updatedFields: Object.keys(body).filter((key) => key !== "monthlySalary"), salaryChanged: body.monthlySalary !== undefined },
      });
      return { ok: true };
    });
  });

  app.put("/staff/:membershipId/photo", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const body = z.object({
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      data: z.string().min(1).max(820_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    }).parse(req.body);
    const membership = await db.query.memberships.findFirst({
      where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, auth.orgId)),
    });
    if (!membership) throw notFound("Staff member");

    const photoData = Buffer.from(body.data, "base64");
    if (!photoData.length || photoData.length > 600_000 || photoData.toString("base64") !== body.data) throw badRequest("Photo must be 600 KB or smaller");
    const validSignature =
      (body.mimeType === "image/jpeg" && photoData[0] === 0xff && photoData[1] === 0xd8 && photoData[2] === 0xff) ||
      (body.mimeType === "image/png" && photoData.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (body.mimeType === "image/webp" && photoData.toString("ascii", 0, 4) === "RIFF" && photoData.toString("ascii", 8, 12) === "WEBP");
    if (!validSignature) throw badRequest("The uploaded file does not match a supported image format");

    await db.insert(schema.staffProfiles).values({
      organizationId: auth.orgId,
      membershipId,
      photoData,
      photoMimeType: body.mimeType,
    }).onConflictDoUpdate({
      target: schema.staffProfiles.membershipId,
      set: { photoData, photoMimeType: body.mimeType, updatedAt: new Date() },
    });
    await audit(db, req, { action: "staff.photo_updated", resourceType: "membership", resourceId: membershipId });
    return { ok: true };
  });

  app.delete("/staff/:membershipId/photo", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const membership = await db.query.memberships.findFirst({
      where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, auth.orgId)),
    });
    if (!membership) throw notFound("Staff member");
    await db.update(schema.staffProfiles).set({ photoData: null, photoMimeType: null, updatedAt: new Date() }).where(eq(schema.staffProfiles.membershipId, membershipId));
    await audit(db, req, { action: "staff.photo_removed", resourceType: "membership", resourceId: membershipId });
    return { ok: true };
  });

  app.get("/staff/:membershipId/photo", async (req, reply) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const profile = await db.query.staffProfiles.findFirst({
      where: and(eq(schema.staffProfiles.membershipId, membershipId), eq(schema.staffProfiles.organizationId, auth.orgId)),
      columns: { photoData: true, photoMimeType: true },
    });
    if (!profile?.photoData || !profile.photoMimeType) throw notFound("Employee photo");
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .type(profile.photoMimeType)
      .send(profile.photoData);
  });

  app.get("/staff/attendance", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { branchId, workDate } = z.object({ branchId: z.uuid(), workDate: z.iso.date() }).parse(req.query);
    assertBranchAccess(auth, branchId);
    const branch = await db.query.branches.findFirst({ where: and(eq(schema.branches.id, branchId), eq(schema.branches.organizationId, auth.orgId)) });
    if (!branch) throw notFound("Branch");

    const employees = await db
      .select({
        membershipId: schema.memberships.id,
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.staffProfiles.phone,
        jobTitle: schema.staffProfiles.jobTitle,
        roleName: schema.roles.name,
        branchIds: schema.memberships.branchIds,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .leftJoin(schema.staffProfiles, eq(schema.staffProfiles.membershipId, schema.memberships.id))
      .where(and(eq(schema.memberships.organizationId, auth.orgId), eq(schema.memberships.status, "active")))
      .orderBy(asc(schema.users.name));
    const branchEmployees = employees.filter((person) => person.branchIds.length === 0 || person.branchIds.includes(branchId));
    const membershipIds = branchEmployees.map((person) => person.membershipId);
    if (!membershipIds.length) return [];

    const [attendance, leaves] = await Promise.all([
      db.query.staffAttendance.findMany({
        where: and(
          eq(schema.staffAttendance.organizationId, auth.orgId),
          eq(schema.staffAttendance.branchId, branchId),
          eq(schema.staffAttendance.workDate, workDate),
          inArray(schema.staffAttendance.membershipId, membershipIds),
        ),
      }),
      db.query.staffLeaves.findMany({
        where: and(
          eq(schema.staffLeaves.organizationId, auth.orgId),
          eq(schema.staffLeaves.branchId, branchId),
          lte(schema.staffLeaves.startDate, workDate),
          gte(schema.staffLeaves.endDate, workDate),
          inArray(schema.staffLeaves.membershipId, membershipIds),
        ),
      }),
    ]);
    const attendanceByMember = new Map(attendance.map((record) => [record.membershipId, record]));
    const leaveByMember = new Map(leaves.map((leave) => [leave.membershipId, leave]));
    return branchEmployees.map((person) => {
      const record = attendanceByMember.get(person.membershipId);
      const leave = leaveByMember.get(person.membershipId);
      return {
        membershipId: person.membershipId,
        userId: person.userId,
        name: person.name,
        email: person.email,
        phone: person.phone,
        jobTitle: person.jobTitle,
        roleName: person.roleName,
        status: leave ? "on_leave" : record?.status ?? "unrecorded",
        checkIn: leave ? null : record?.checkIn ?? null,
        checkOut: leave ? null : record?.checkOut ?? null,
        note: leave?.reason ?? record?.note ?? null,
        leaveId: leave?.id ?? null,
        branchId,
        workDate,
      };
    });
  });

  app.put("/staff/attendance", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const body = staffAttendanceSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    return db.transaction(async (tx) => {
      const [branch, member] = await Promise.all([
        tx.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) }),
        tx.query.memberships.findFirst({ where: and(eq(schema.memberships.id, body.membershipId), eq(schema.memberships.organizationId, auth.orgId), eq(schema.memberships.status, "active")) }),
      ]);
      if (!branch) throw notFound("Branch");
      if (!member) throw notFound("Active staff member");
      if (member.branchIds.length > 0 && !member.branchIds.includes(body.branchId)) throw forbidden("This employee is not assigned to the selected branch");
      if (body.status === "present" && (body.checkIn || body.checkOut)) {
        const validForTimeZone = (time: string) => {
          const [hours, minutes] = time.split(":").map(Number);
          return hours < 24 && minutes < 60;
        };
        if ([body.checkIn, body.checkOut].some((time) => time && !validForTimeZone(time))) throw badRequest("Enter a valid local branch time");
      }

      const leave = await tx.query.staffLeaves.findFirst({
        where: and(
          eq(schema.staffLeaves.organizationId, auth.orgId),
          eq(schema.staffLeaves.membershipId, body.membershipId),
          eq(schema.staffLeaves.branchId, body.branchId),
          lte(schema.staffLeaves.startDate, body.workDate),
          gte(schema.staffLeaves.endDate, body.workDate),
        ),
      });
      if (leave) throw conflict("This employee is recorded as on leave for this date. Remove the leave record before entering attendance.");

      const before = await tx.query.staffAttendance.findFirst({
        where: and(
          eq(schema.staffAttendance.organizationId, auth.orgId),
          eq(schema.staffAttendance.membershipId, body.membershipId),
          eq(schema.staffAttendance.branchId, body.branchId),
          eq(schema.staffAttendance.workDate, body.workDate),
        ),
      });
      const [after] = await tx.insert(schema.staffAttendance).values({
        organizationId: auth.orgId,
        membershipId: body.membershipId,
        branchId: body.branchId,
        workDate: body.workDate,
        status: body.status,
        checkIn: body.status === "present" ? body.checkIn ?? null : null,
        checkOut: body.status === "present" ? body.checkOut ?? null : null,
        note: body.note ?? null,
        recordedBy: auth.userId,
      }).onConflictDoUpdate({
        target: [schema.staffAttendance.organizationId, schema.staffAttendance.membershipId, schema.staffAttendance.branchId, schema.staffAttendance.workDate],
        set: {
          status: body.status,
          checkIn: body.status === "present" ? body.checkIn ?? null : null,
          checkOut: body.status === "present" ? body.checkOut ?? null : null,
          note: body.note ?? null,
          recordedBy: auth.userId,
          updatedAt: new Date(),
        },
      }).returning();
      await audit(tx, req, {
        action: "staff.attendance_recorded",
        resourceType: "staff_attendance",
        resourceId: after.id,
        before,
        after: { membershipId: body.membershipId, branchId: body.branchId, workDate: body.workDate, status: body.status, checkIn: after.checkIn, checkOut: after.checkOut },
      });
      return after;
    });
  });

  app.get("/staff/:membershipId/leaves", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, auth.orgId)) });
    if (!membership) throw notFound("Staff member");
    return db.query.staffLeaves.findMany({
      where: and(
        eq(schema.staffLeaves.organizationId, auth.orgId),
        eq(schema.staffLeaves.membershipId, membershipId),
        auth.branchIds.length ? inArray(schema.staffLeaves.branchId, auth.branchIds) : undefined,
      ),
      orderBy: [desc(schema.staffLeaves.startDate), desc(schema.staffLeaves.createdAt)],
    });
  });

  app.post("/staff/leaves", async (req, reply) => {
    const auth = requirePermission(req, "staff.manage");
    const body = staffLeaveSchema.parse(req.body);
    assertBranchAccess(auth, body.branchId);
    const [branch, member] = await Promise.all([
      db.query.branches.findFirst({ where: and(eq(schema.branches.id, body.branchId), eq(schema.branches.organizationId, auth.orgId)) }),
      db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, body.membershipId), eq(schema.memberships.organizationId, auth.orgId), eq(schema.memberships.status, "active")) }),
    ]);
    if (!branch) throw notFound("Branch");
    if (!member) throw notFound("Active staff member");
    if (member.branchIds.length > 0 && !member.branchIds.includes(body.branchId)) throw forbidden("This employee is not assigned to the selected branch");

    const [overlap, attended] = await Promise.all([
      db.query.staffLeaves.findFirst({
        where: and(
          eq(schema.staffLeaves.organizationId, auth.orgId),
          eq(schema.staffLeaves.membershipId, body.membershipId),
          eq(schema.staffLeaves.branchId, body.branchId),
          lte(schema.staffLeaves.startDate, body.endDate),
          gte(schema.staffLeaves.endDate, body.startDate),
        ),
      }),
      db.query.staffAttendance.findFirst({
        where: and(
          eq(schema.staffAttendance.organizationId, auth.orgId),
          eq(schema.staffAttendance.membershipId, body.membershipId),
          eq(schema.staffAttendance.branchId, body.branchId),
          eq(schema.staffAttendance.status, "present"),
          gte(schema.staffAttendance.workDate, body.startDate),
          lte(schema.staffAttendance.workDate, body.endDate),
        ),
      }),
    ]);
    if (overlap) throw conflict("A leave period already covers some of these dates");
    if (attended) throw conflict(`Attendance is already marked present on ${attended.workDate}. Correct attendance before recording leave.`);

    const [leave] = await db.insert(schema.staffLeaves).values({
      organizationId: auth.orgId,
      membershipId: body.membershipId,
      branchId: body.branchId,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason ?? null,
      recordedBy: auth.userId,
    }).returning();
    await audit(db, req, { action: "staff.leave_recorded", resourceType: "staff_leave", resourceId: leave.id, after: leave });
    reply.code(201);
    return leave;
  });

  app.delete("/staff/leaves/:leaveId", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { leaveId } = z.object({ leaveId: z.uuid() }).parse(req.params);
    const leave = await db.query.staffLeaves.findFirst({
      where: and(
        eq(schema.staffLeaves.id, leaveId),
        eq(schema.staffLeaves.organizationId, auth.orgId),
        auth.branchIds.length ? inArray(schema.staffLeaves.branchId, auth.branchIds) : undefined,
      ),
    });
    if (!leave) throw notFound("Leave record");
    await db.delete(schema.staffLeaves).where(eq(schema.staffLeaves.id, leaveId));
    await audit(db, req, { action: "staff.leave_removed", resourceType: "staff_leave", resourceId: leaveId, before: leave });
    return { ok: true };
  });

  /** Owner/manager creates a one-time reset link to hand to a staff member (works without email). */
  app.post("/staff/:membershipId/reset-link", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.params);
    const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, auth.orgId)) });
    if (!m) throw notFound("Staff member");
    const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, m.roleId) });
    if (role?.key === "owner" && auth.roleKey !== "owner") throw forbidden("Only an owner can reset an owner's password");
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
    const { token, expiresAt } = await issueToken(db, { purpose: "password_reset", email: user!.email, userId: user!.id, organizationId: auth.orgId, createdBy: auth.userId });
    await audit(db, req, { action: "staff.reset_link_created", resourceType: "membership", resourceId: membershipId, after: { email: user!.email } });
    return { url: linkFor(req, "password_reset", token), expiresAt };
  });

  app.get("/staff/invitations", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    return db.execute(sql`
      select t.id, t.email, t.payload, t.expires_at, t.created_at, u.name as invited_by from auth_tokens t left join users u on u.id = t.created_by
      where t.organization_id = ${auth.orgId} and t.purpose = 'invitation' and t.used_at is null and t.revoked_at is null and t.expires_at > now()
      order by t.created_at desc`);
  });

  app.post("/staff/invitations", async (req, reply) => {
    const auth = requirePermission(req, "staff.manage");
    const body = z
      .object({ name: z.string().trim().min(2).max(120), email: z.email().toLowerCase(), roleKey: z.string().min(2), branchIds: z.array(z.uuid()).default([]) })
      .parse(req.body);
    const role = await db.query.roles.findFirst({ where: and(eq(schema.roles.organizationId, auth.orgId), eq(schema.roles.key, body.roleKey)) });
    if (!role) throw badRequest("Unknown role");
    if (role.key === "owner" && auth.roleKey !== "owner") throw badRequest("Only an owner can invite another owner");
    const existing = await db.execute(sql`select 1 from organization_memberships m join users u on u.id = m.user_id where m.organization_id = ${auth.orgId} and u.email = ${body.email}`);
    if (existing.length) throw conflict("This person is already a staff member");
    const { token, expiresAt, row } = await issueToken(db, { purpose: "invitation", email: body.email, organizationId: auth.orgId, payload: { name: body.name, roleKey: body.roleKey, branchIds: body.branchIds }, createdBy: auth.userId });
    await audit(db, req, { action: "staff.invited", resourceType: "invitation", resourceId: row.id, after: { email: body.email, role: role.key } });
    reply.code(201);
    return { id: row.id, url: linkFor(req, "invitation", token), expiresAt };
  });

  app.post("/staff/invitations/:id/revoke", async (req) => {
    const auth = requirePermission(req, "staff.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [row] = await db
      .update(schema.authTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.authTokens.id, id), eq(schema.authTokens.organizationId, auth.orgId), eq(schema.authTokens.purpose, "invitation")))
      .returning();
    if (!row) throw notFound("Invitation");
    await audit(db, req, { action: "staff.invitation_revoked", resourceType: "invitation", resourceId: id });
    return { ok: true };
  });

  app.get("/audit-logs", async (req) => {
    const auth = requirePermission(req, "audit.view");
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), action: z.string().optional() }).parse(req.query);
    return db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        resourceType: schema.auditLogs.resourceType,
        resourceId: schema.auditLogs.resourceId,
        actorName: schema.users.name,
        ip: schema.auditLogs.ip,
        requestId: schema.auditLogs.requestId,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
      .where(and(eq(schema.auditLogs.organizationId, auth.orgId), q.action ? sql`${schema.auditLogs.action} like ${q.action + "%"}` : undefined))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(q.limit);
  });
}
