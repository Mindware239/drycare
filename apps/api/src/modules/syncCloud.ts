/**
 * Cloud endpoints for shop PCs (phase 3, push only). Not available in the desktop edition.
 *
 *  Linking (device authorisation): PC → POST /sync/link/start → owner approves in the cloud web
 *  (GET /sync/link/requests/:code, POST /sync/link/approve) → PC → POST /sync/link/poll receives its credential once.
 *  Device calls carry `Authorization: Device <deviceId>.<secret>`; only a SHA-256 hash is stored here.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ALL_PERMISSIONS } from "@drycare/shared";
import { db } from "../db/client";
import { env, isDesktop } from "../env";
import { requireAuth, requirePermission } from "../lib/context";
import { audit } from "../lib/audit";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";
import { applyBatch, clearStaged, pushRequestSchema, schemaNumber, stageLargeChanges } from "../sync/apply";

export const DEVICE_CREDENTIAL_DAYS = 90;
const PREVIOUS_CREDENTIAL_GRACE_HOURS = 24;
const LINK_MINUTES = 15;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const userCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("").replace(/^(.{4})/, "$1-");
const newSecret = () => randomBytes(32).toString("base64url");

function cloudOnly() {
  if (isDesktop) throw new AppError(404, "NOT_FOUND", "Not available in the desktop edition");
}

type Device = { id: string; organization_id: string; branch_id: string; name: string; status: string; credential_expires_at: Date };

/** Verifies `Authorization: Device <id>.<secret>`. Organisation and branch always come from the stored device. */
async function authDevice(req: FastifyRequest): Promise<Device> {
  cloudOnly();
  const m = /^Device ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,100})$/.exec(String(req.headers.authorization ?? ""));
  if (!m) throw new AppError(401, "DEVICE_AUTH_REQUIRED", "Device credential missing");
  const [d] = await db.execute<Device & { credential_hash: string; previous_credential_hash: string | null; previous_valid_until: Date | null }>(sql`select * from sync_devices where id = ${m[1]}`);
  const given = Buffer.from(sha256(m[2]));
  const matches = (h: string | null) => !!h && h.length === given.length && timingSafeEqual(Buffer.from(h), given);
  if (!d || !(matches(d.credential_hash) || (matches(d.previous_credential_hash) && d.previous_valid_until && new Date(d.previous_valid_until) > new Date()))) {
    throw new AppError(401, "DEVICE_AUTH_FAILED", "This PC's cloud credential is not valid. Link it again.");
  }
  if (d.status !== "active") throw new AppError(401, "DEVICE_REVOKED", "This PC was disconnected from DryCare Cloud. Link it again.");
  if (new Date(d.credential_expires_at) < new Date()) throw new AppError(401, "DEVICE_CREDENTIAL_EXPIRED", "This PC's cloud credential has expired. Link it again.");
  await db.execute(sql`update sync_devices set last_seen_at = now() where id = ${d.id}`);
  return d;
}

/** Cloud sync is a paid add-on: the business needs a current plan whose entitlements include `cloudSync`. */
export async function cloudSyncEntitled(orgId: string) {
  const [s] = await db.execute<{ status: string; ends_at: Date | null; entitlements_json: Record<string, boolean> }>(sql`
    select s.status, s.ends_at, p.entitlements_json from commercial_subscriptions s join commercial_plans p on p.id = s.plan_id
    where s.organization_id = ${orgId} order by s.created_at desc limit 1`);
  if (!s?.entitlements_json?.cloudSync) return false;
  if (!["active", "trial"].includes(s.status)) return false;
  return !s.ends_at || new Date(s.ends_at).getTime() + 3 * 86_400_000 > Date.now();
}

async function cloudSchemaVersion() {
  const [r] = await db.execute<{ schema_version: string }>(sql`select schema_version from sync_config where id = 1`);
  return r?.schema_version ?? "unknown";
}

export async function syncCloudRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ linking

  app.post("/sync/link/start", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    cloudOnly();
    const body = z.object({
      deviceId: z.uuid(),
      deviceName: z.string().trim().min(1).max(80),
      appVersion: z.string().max(40).optional(),
      schemaVersion: z.string().max(80).optional(),
      shop: z.object({ organizationId: z.uuid(), organizationName: z.string().trim().min(1).max(160), branchId: z.uuid(), branchName: z.string().trim().min(1).max(120), branchCode: z.string().trim().min(1).max(20), gstin: z.string().max(20).nullable().optional() }),
    }).parse(req.body);
    const pollToken = newSecret();
    const code = userCode();
    const [r] = await db.execute<{ id: string; expires_at: Date }>(sql`
      insert into sync_link_requests (user_code, poll_token_hash, device_id, device_name, shop_json, app_version, schema_version, expires_at, created_ip)
      values (${code}, ${sha256(pollToken)}, ${body.deviceId}, ${body.deviceName}, ${JSON.stringify(body.shop)}::jsonb, ${body.appVersion ?? null}, ${body.schemaVersion ?? null},
              now() + make_interval(mins => ${LINK_MINUTES}), ${req.ip}) returning id, expires_at`);
    reply.code(201);
    return { requestId: r.id, userCode: code, pollToken, verificationUrl: `${env.WEB_ORIGIN.replace(/\/$/, "")}/link-device?code=${code}`, expiresAt: r.expires_at, pollIntervalSeconds: 5 };
  });

  // Codes are 8 characters from 32 symbols and live 15 minutes; tight limits make guessing a pending code impractical.
  const linkLimit = { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } };

  app.get("/sync/link/requests/:code", linkLimit, async (req) => {
    cloudOnly();
    const auth = requireAuth(req);
    const { code } = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }).parse(req.params);
    const [r] = await db.execute<{ id: string; status: string; device_id: string; device_name: string; shop_json: any; expires_at: Date }>(sql`select * from sync_link_requests where user_code = ${code}`);
    if (!r) throw notFound("Link code");
    const shop = r.shop_json;
    const [org] = await db.execute<{ id: string; name: string; settings_json: any }>(sql`select id, name, settings_json from organizations where id = ${shop.organizationId}`);
    const [member] = org ? await db.execute(sql`select 1 from organization_memberships m join roles ro on ro.id = m.role_id where m.user_id = ${auth.userId} and m.organization_id = ${org.id} and m.status = 'active' and 'org.manage' = any(ro.permissions)`) : [];
    const [active] = org ? await db.execute<{ id: string; name: string; last_seen_at: Date | null }>(sql`select id, name, last_seen_at from sync_devices where organization_id = ${org.id} and status = 'active'`) : [];
    return {
      status: new Date(r.expires_at) < new Date() && r.status === "pending" ? "expired" : r.status,
      expiresAt: r.expires_at,
      deviceName: r.device_name,
      shop: { name: shop.organizationName, branchName: shop.branchName, branchCode: shop.branchCode, gstin: shop.gstin ?? null },
      existing: org ? { linkable: org.settings_json?.syncSource === "device" && !!member, managedByDevice: org.settings_json?.syncSource === "device", youAreOwner: !!member } : null,
      activeDevice: active && active.id !== r.device_id ? { name: active.name, lastSeenAt: active.last_seen_at } : null,
      entitled: org ? await cloudSyncEntitled(org.id) : false,
    };
  });

  app.post("/sync/link/approve", linkLimit, async (req) => {
    cloudOnly();
    const auth = requireAuth(req);
    const body = z.object({ code: z.string().trim().toUpperCase(), replaceExisting: z.boolean().default(false) }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [r] = await tx.execute<{ id: string; status: string; device_id: string; device_name: string; shop_json: any; expires_at: Date }>(sql`select * from sync_link_requests where user_code = ${body.code} for update`);
      if (!r) throw notFound("Link code");
      if (r.status !== "pending") throw conflict("This link code has already been used or cancelled", "LINK_USED");
      if (new Date(r.expires_at) < new Date()) throw new AppError(410, "LINK_EXPIRED", "This link code has expired. Start linking again on the PC.");
      const shop = r.shop_json as { organizationId: string; organizationName: string; branchId: string; branchName: string; branchCode: string; gstin?: string | null };
      const [org] = await tx.execute<{ id: string; settings_json: any }>(sql`select id, settings_json from organizations where id = ${shop.organizationId} for update`);
      let created = false;
      if (org) {
        if (org.settings_json?.syncSource !== "device") throw conflict("A cloud business already uses this shop's identity and is not a PC copy. It cannot be merged.", "ORG_NOT_LINKABLE");
        const [ok] = await tx.execute(sql`select 1 from organization_memberships m join roles ro on ro.id = m.role_id where m.user_id = ${auth.userId} and m.organization_id = ${org.id} and m.status = 'active' and 'org.manage' = any(ro.permissions)`);
        if (!ok) throw forbidden("Only the owner of this shop's cloud copy can link a PC to it");
      } else {
        const [branchClash] = await tx.execute(sql`select 1 from branches where id = ${shop.branchId}`);
        if (branchClash) throw conflict("This branch id is already used in the cloud", "BRANCH_NOT_LINKABLE");
        const slug = `pc-${shop.organizationId.slice(0, 8)}-${randomBytes(3).toString("hex")}`;
        await tx.execute(sql`insert into organizations (id, name, slug, status, gstin, settings_json) values (${shop.organizationId}, ${shop.organizationName}, ${slug}, 'active', ${shop.gstin ?? null}, ${JSON.stringify({ syncSource: "device" })}::jsonb)`);
        await tx.execute(sql`insert into branches (id, organization_id, name, branch_code) values (${shop.branchId}, ${shop.organizationId}, ${shop.branchName}, ${shop.branchCode})`);
        const [role] = await tx.execute<{ id: string }>(sql`insert into roles (organization_id, key, name, permissions, is_system) values (${shop.organizationId}, 'cloud_owner', 'Owner (cloud, view only)', ${`{${ALL_PERMISSIONS.join(",")}}`}::text[], false) returning id`);
        await tx.execute(sql`insert into organization_memberships (organization_id, user_id, role_id) values (${shop.organizationId}, ${auth.userId}, ${role.id})`);
        created = true;
      }
      const [active] = await tx.execute<{ id: string; name: string }>(sql`select id, name from sync_devices where organization_id = ${shop.organizationId} and status = 'active' for update`);
      if (active && active.id !== r.device_id) {
        if (!body.replaceExisting) throw conflict(`“${active.name}” is already linked to this shop. Until per-branch invoice numbering is available only one PC can be linked; confirm to replace it.`, "DEVICE_ALREADY_LINKED");
        await tx.execute(sql`update sync_devices set status = 'revoked', revoked_at = now(), revoked_by = ${auth.userId}, revoke_reason = ${`Replaced by ${r.device_name}`} where id = ${active.id}`);
      }
      const [otherOrg] = await tx.execute(sql`select 1 from sync_devices where id = ${r.device_id} and organization_id <> ${shop.organizationId}`);
      if (otherOrg) throw conflict("This PC is registered to a different cloud business", "DEVICE_OTHER_ORG");
      await tx.execute(sql`update sync_link_requests set status = 'approved', approved_by = ${auth.userId}, approved_at = now() where id = ${r.id}`);
      await tx.execute(sql`insert into audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, after_json, ip, request_id)
        values (${shop.organizationId}, ${auth.userId}, 'sync.device_link_approved', 'sync_device', ${r.device_id}, ${JSON.stringify({ deviceName: r.device_name, created, replaced: active?.id ?? null })}::jsonb, ${req.ip}, ${req.id})`);
      return { organizationId: shop.organizationId, created };
    });
    return { approved: true, ...result, entitled: await cloudSyncEntitled(result.organizationId) };
  });

  app.post("/sync/link/deny", linkLimit, async (req) => {
    cloudOnly();
    requireAuth(req);
    const { code } = z.object({ code: z.string().trim().toUpperCase() }).parse(req.body);
    await db.execute(sql`update sync_link_requests set status = 'denied' where user_code = ${code} and status = 'pending'`);
    return { denied: true };
  });

  /** The PC asks whether the owner approved; on approval the device credential is issued exactly once. */
  app.post("/sync/link/poll", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req) => {
    cloudOnly();
    const body = z.object({ requestId: z.uuid(), pollToken: z.string().min(20).max(100) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [r] = await tx.execute<{ id: string; status: string; poll_token_hash: string; device_id: string; device_name: string; shop_json: any; expires_at: Date; approved_by: string; app_version: string | null; schema_version: string | null }>(
        sql`select * from sync_link_requests where id = ${body.requestId} for update`);
      if (!r || r.poll_token_hash !== sha256(body.pollToken)) throw new AppError(401, "LINK_AUTH_FAILED", "Unknown link request");
      if (r.status === "pending") return new Date(r.expires_at) < new Date() ? { status: "expired" } : { status: "pending" };
      if (r.status !== "approved") return { status: r.status };
      const secret = newSecret();
      const shop = r.shop_json;
      await tx.execute(sql`
        insert into sync_devices (id, organization_id, branch_id, name, status, credential_hash, credential_expires_at, linked_by, app_version, schema_version)
        values (${r.device_id}, ${shop.organizationId}, ${shop.branchId}, ${r.device_name}, 'active', ${sha256(secret)}, now() + make_interval(days => ${DEVICE_CREDENTIAL_DAYS}), ${r.approved_by}, ${r.app_version}, ${r.schema_version})
        on conflict (id) do update set status = 'active', branch_id = excluded.branch_id, name = excluded.name, credential_hash = excluded.credential_hash,
          credential_expires_at = excluded.credential_expires_at, previous_credential_hash = null, previous_valid_until = null, linked_by = excluded.linked_by,
          revoked_at = null, revoked_by = null, revoke_reason = null`);
      await tx.execute(sql`update sync_link_requests set status = 'consumed' where id = ${r.id}`);
      const [d] = await tx.execute<{ credential_expires_at: Date }>(sql`select credential_expires_at from sync_devices where id = ${r.device_id}`);
      const [approver] = await tx.execute<{ email: string }>(sql`select email from users where id = ${r.approved_by}`);
      return { status: "approved", deviceId: r.device_id, credential: `${r.device_id}.${secret}`, credentialExpiresAt: d.credential_expires_at, organizationId: shop.organizationId, branchId: shop.branchId, approvedBy: approver?.email ?? null, entitled: await cloudSyncEntitled(shop.organizationId) };
    });
  });

  // ------------------------------------------------------------------ device calls

  app.get("/sync/device", async (req) => {
    const d = await authDevice(req);
    return { deviceId: d.id, status: d.status, organizationId: d.organization_id, branchId: d.branch_id, credentialExpiresAt: d.credential_expires_at, entitled: await cloudSyncEntitled(d.organization_id), cloudSchemaVersion: await cloudSchemaVersion() };
  });

  app.post("/sync/device/rotate", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req) => {
    const d = await authDevice(req);
    const secret = newSecret();
    const [r] = await db.execute<{ credential_expires_at: Date }>(sql`update sync_devices set previous_credential_hash = credential_hash,
      previous_valid_until = now() + make_interval(hours => ${PREVIOUS_CREDENTIAL_GRACE_HOURS}), credential_hash = ${sha256(secret)},
      credential_expires_at = now() + make_interval(days => ${DEVICE_CREDENTIAL_DAYS}) where id = ${d.id} returning credential_expires_at`);
    await db.execute(sql`insert into audit_logs (organization_id, action, resource_type, resource_id, ip, request_id) values (${d.organization_id}, 'sync.device_credential_rotated', 'sync_device', ${d.id}, ${req.ip}, ${req.id})`);
    return { credential: `${d.id}.${secret}`, credentialExpiresAt: r.credential_expires_at };
  });

  app.post("/sync/push", { bodyLimit: 4_000_000, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const d = await authDevice(req);
    const body = pushRequestSchema.parse(req.body);
    if (body.events.some((e) => e.deviceId !== d.id)) throw new AppError(400, "DEVICE_MISMATCH", "Events must come from the authenticated device");
    const cloudVersion = await cloudSchemaVersion();
    if (schemaNumber(body.schemaVersion) > schemaNumber(cloudVersion) || body.events.some((e) => schemaNumber(e.schemaVersion) > schemaNumber(cloudVersion))) {
      reply.code(426);
      return { error: { code: "SCHEMA_TOO_NEW", message: "This PC runs a newer DryCare than the cloud. Changes are kept on the PC until the cloud is updated.", details: [{ cloudSchemaVersion: cloudVersion }], requestId: req.id } };
    }
    if (!(await cloudSyncEntitled(d.organization_id))) throw new AppError(402, "CLOUD_PLAN_REQUIRED", "Cloud sync needs an active DryCare Cloud plan for this shop. Changes are kept safely on the PC.");
    const started = Date.now();
    const summary = await db.transaction(async (tx) => {
      // One push per device at a time; a second concurrent push waits here.
      await tx.execute(sql`select id from sync_devices where id = ${d.id} for update`);
      const device = { deviceId: d.id, organizationId: d.organization_id };
      // Parts of a change bigger than one upload are held until the whole change is here (staged commit).
      const staging = await stageLargeChanges(tx, device, body.events);
      const applied = staging.pass.length ? await applyBatch(tx, device, body.batchId, staging.pass) : { results: [], counts: { applied: 0, duplicates: 0, stale: 0, conflicts: 0, rejected: 0, retryable: 0 } };
      await clearStaged(tx, d.id, staging.completed, applied.results, staging.pass);
      const s = { results: [...applied.results, ...staging.results], counts: { ...applied.counts, staged: staging.results.filter((r) => r.outcome === "staged").length } };
      await tx.execute(sql`insert into sync_batches (id, device_id, organization_id, event_count, applied, duplicates, stale, conflicts, rejected, retryable, duration_ms)
        values (${body.batchId}, ${d.id}, ${d.organization_id}, ${body.events.length}, ${s.counts.applied}, ${s.counts.duplicates}, ${s.counts.stale}, ${s.counts.conflicts}, ${s.counts.rejected}, ${s.counts.retryable}, ${Date.now() - started})
        on conflict (id) do nothing`);
      await tx.execute(sql`update sync_devices set last_push_at = now(), schema_version = ${body.schemaVersion}, app_version = ${body.appVersion ?? null} where id = ${d.id}`);
      return s;
    });
    // Sent only after the commit above: an acknowledged event is durable in the cloud.
    return { batchId: body.batchId, committed: true, results: summary.results, counts: summary.counts };
  });

  // ------------------------------------------------------------------ owner management (cloud web)

  app.get("/sync/devices", async (req) => {
    cloudOnly();
    const auth = requirePermission(req, "org.manage");
    return db.execute(sql`select d.id, d.name, d.status, d.branch_id as "branchId", b.name as "branchName", d.app_version as "appVersion", d.last_seen_at as "lastSeenAt",
      d.last_push_at as "lastPushAt", d.credential_expires_at as "credentialExpiresAt", d.revoked_at as "revokedAt", d.revoke_reason as "revokeReason", d.created_at as "createdAt",
      (select count(*)::int from sync_applied_events a where a.device_id = d.id) as "eventsApplied",
      (select count(*)::int from sync_remote_conflicts c where c.device_id = d.id) as "problems"
      from sync_devices d join branches b on b.id = d.branch_id where d.organization_id = ${auth.orgId} order by d.created_at desc`);
  });

  app.post("/sync/devices/:id/revoke", async (req) => {
    cloudOnly();
    const auth = requirePermission(req, "org.manage");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200).default("Disconnected by the owner") }).parse(req.body ?? {});
    const rows = await db.execute(sql`update sync_devices set status = 'revoked', revoked_at = now(), revoked_by = ${auth.userId}, revoke_reason = ${reason}
      where id = ${id} and organization_id = ${auth.orgId} and status = 'active' returning id`);
    if (!rows.length) throw notFound("Linked PC");
    await audit(db, req, { action: "sync.device_revoked", resourceType: "sync_device", resourceId: id, after: { reason } });
    return { revoked: true };
  });
}
