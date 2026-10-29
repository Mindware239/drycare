import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Permission } from "@drycare/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { forbidden, unauthorized, AppError } from "./errors";

export const SESSION_COOKIE = "dc_session";

export interface AuthContext {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  isPlatformAdmin: boolean;
  orgId: string;
  orgName: string;
  orgStatus: string;
  roleKey: string;
  roleName: string;
  permissions: Set<string>;
  /** Empty = all branches. */
  branchIds: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const REMEMBER_DAYS = 30;

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string, organizationId: string, options: { remember?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const ttlMs = options.remember ? REMEMBER_DAYS * 86_400_000 : env.SESSION_TTL_HOURS * 3600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(schema.sessions).values({
    id: hashToken(token),
    userId,
    organizationId,
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 300),
    expiresAt,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    // remember: false gives a browser-session cookie that is dropped when the browser closes.
    ...(options.remember === false ? {} : { expires: expiresAt }),
  });
}

/** Resolves the session cookie into an authorization context. Tenant scope always comes from here, never from the request body. */
export async function loadAuth(req: FastifyRequest): Promise<AuthContext | undefined> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      userId: schema.users.id,
      userName: schema.users.name,
      email: schema.users.email,
      userStatus: schema.users.status,
      isPlatformAdmin: schema.users.isPlatformAdmin,
      orgId: schema.organizations.id,
      orgName: schema.organizations.name,
      orgStatus: schema.organizations.status,
      membershipStatus: schema.memberships.status,
      branchIds: schema.memberships.branchIds,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
      permissions: schema.roles.permissions,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.sessions.organizationId))
    .innerJoin(
      schema.memberships,
      and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.organizationId, schema.organizations.id)),
    )
    .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
    .where(and(eq(schema.sessions.id, hashToken(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || r.userStatus !== "active" || r.membershipStatus !== "active") return undefined;
  return {
    sessionId: r.sessionId,
    userId: r.userId,
    userName: r.userName,
    email: r.email,
    isPlatformAdmin: r.isPlatformAdmin,
    orgId: r.orgId,
    orgName: r.orgName,
    orgStatus: r.orgStatus,
    roleKey: r.roleKey,
    roleName: r.roleName,
    permissions: new Set(r.permissions),
    branchIds: r.branchIds,
  };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  if (req.auth.orgStatus === "suspended" || req.auth.orgStatus === "terminated") {
    throw new AppError(403, "TENANT_SUSPENDED", "This business account is suspended. Contact support.");
  }
  return req.auth;
}

export function can(auth: AuthContext, permission: Permission | string) {
  return auth.permissions.has(permission);
}

export function requirePermission(req: FastifyRequest, ...perms: Permission[]): AuthContext {
  const auth = requireAuth(req);
  for (const p of perms) if (!auth.permissions.has(p)) throw forbidden();
  return auth;
}

export function requirePlatformAdmin(req: FastifyRequest): AuthContext {
  const auth = requireAuth(req);
  if (!auth.isPlatformAdmin) throw forbidden("DryCare platform administrator access is required");
  return auth;
}

export function assertBranchAccess(auth: AuthContext, branchId: string) {
  if (auth.branchIds.length > 0 && !auth.branchIds.includes(branchId)) throw forbidden("You do not have access to this branch");
}
