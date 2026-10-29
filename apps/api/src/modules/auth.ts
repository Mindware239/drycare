import type { FastifyInstance } from "fastify";
import { hash, verify } from "@node-rs/argon2";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { loginSchema, signupSchema } from "@drycare/shared";
import { db, schema } from "../db/client";
import { createSession, requireAuth, SESSION_COOKIE, hashToken } from "../lib/context";
import { AppError, conflict } from "../lib/errors";
import { audit } from "../lib/audit";
import { provisionOrganization } from "../lib/provision";
import { env, isDesktop } from "../env";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { emit } from "../lib/audit";
import { findValidToken, issueToken, linkFor } from "../lib/tokens";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emailConfigured, sendEmail } from "../lib/mailer";
import { accessState } from "../lib/subscriptionAccess";

const newPassword = z.string().min(10, "Password must be at least 10 characters").max(200);

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
/** Short code used in order numbers (e.g. "CLEANC-2026-00001"); owners never need to type it. */
function deriveBranchCode(businessName: string) {
  const letters = businessName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return letters.length >= 2 ? letters.slice(0, 6) : "MAIN";
}

const OTP_MAX_ATTEMPTS = 5;
/** Development-only copy of the latest super admin code, for when the API terminal is not visible. */
const DEV_OTP_FILE = join(tmpdir(), "drycare-super-admin-otp.txt");
const otpHash = (challenge: string, code: string) => createHash("sha256").update(`${challenge}:${code}`).digest("hex");
const INVALID = () => new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
/** Super admin password rule (also enforced by `pnpm admin:create`). */
export const platformAdminPassword = z.string().max(200)
  .refine((p) => p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p),
    "Use at least 12 characters with uppercase, lowercase, a number and a symbol");
const emailHint = (email: string) => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
};
const platformEmailConfigured = emailConfigured;
/** Without an email provider the code is written to the API server log, but only on a development server. */
function assertPlatformCodeDelivery() {
  if (!platformEmailConfigured() && (env.NODE_ENV === "production" || isDesktop)) {
    throw new AppError(503, "EMAIL_2FA_UNAVAILABLE", "Super admin email verification is not configured. Set up SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) or Resend before signing in.");
  }
}

/** Emails a super admin one-time code (or, on a development server without email, logs it and writes it to DEV_OTP_FILE). */
async function deliverPlatformCode(
  req: { log: { warn: (msg: string) => void; error: (obj: object, msg: string) => void } },
  input: { email: string; userId: string; code: string; expiresAt: Date; kind: "sign-in" | "reset" },
) {
  const { email, code } = input;
  const reset = input.kind === "reset";
  const devFallback = async <T extends "server_log" | "email_failed">(kind: T, why: string) => {
    req.log.warn(`\n\n  DryCare super admin ${reset ? "password reset" : "OTP"} code for ${email}: ${code}  (development only - ${why})\n`);
    await writeFile(DEV_OTP_FILE, `${email} ${code} ${reset ? "(password reset) " : ""}expires ${input.expiresAt.toISOString()}\n`).catch(() => undefined);
    return kind;
  };
  if (!platformEmailConfigured()) return devFallback("server_log", "configure SMTP or Resend to email it");
  const purpose = reset ? "reset your DryCare super admin password" : "sign in to DryCare super admin";
  const warning = reset ? "If you did not ask to reset your password, ignore this email; your password stays unchanged." : "If you did not try to sign in, change your password immediately.";
  const sent = await sendEmail({
    to: email,
    subject: `${code} is your DryCare super admin ${reset ? "password reset code" : "code"}`,
    text: `Use this code to ${purpose}: ${code}\n\nIt expires in 10 minutes and can be used once. ${warning}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px"><p>Use this code to ${purpose}:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p><p style="color:#475569">It expires in 10 minutes and can be used once. ${warning}</p></div>`,
  });
  if (!sent.ok) req.log.error({ userId: input.userId, error: sent.error }, "super admin verification email could not be sent");
  if (sent.ok) return "email" as const;
  // On a development server a broken mail setup must not lock the super admin out.
  return env.NODE_ENV !== "production" && !isDesktop ? devFallback("email_failed", "email could not be sent, check the SMTP settings") : null;
}

export async function authRoutes(app: FastifyInstance) {
  const strictLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  const platformAdminLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  // Screen B01 (minimal): self-service business onboarding — creates tenant, owner, branch and default catalogue.
  app.post("/organizations", strictLimit, async (req, reply) => {
    const body = signupSchema.parse(req.body);
    if (isDesktop) {
      // Standalone edition hosts exactly one business; setup is only possible on a fresh install.
      const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from organizations`);
      if (n > 0) throw new AppError(403, "SETUP_COMPLETE", "This DryCare installation is already set up. Sign in instead.");
    }
    const existing = await db.query.users.findFirst({ where: eq(schema.users.email, body.email) });
    if (existing) throw conflict("An account with this email already exists. Sign in instead.", "EMAIL_TAKEN");
    const passwordHash = await hash(body.password);

    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({ email: body.email, name: body.ownerName, passwordHash, phone: body.phone }).returning();
      const trialStartedAt = new Date();
      const trialEndsAt = new Date(trialStartedAt.getTime() + env.TRIAL_DAYS * 86_400_000);
      const { org, branch } = await provisionOrganization(tx, {
        ...body,
        branchName: body.branchName ?? "Main Store",
        branchCode: body.branchCode ?? deriveBranchCode(body.businessName),
        ownerUserId: user.id,
        status: isDesktop ? "active" : "trial",
        trialStartedAt: isDesktop ? undefined : trialStartedAt,
        trialEndsAt: isDesktop ? undefined : trialEndsAt,
        trialSource: isDesktop ? undefined : "self_service",
      });
      await audit(tx, req, {
        action: "organization.provisioned",
        resourceType: "organization",
        resourceId: org.id,
        orgId: org.id,
        actorUserId: user.id,
        after: { name: org.name, branch: branch.branchCode, trialEndsAt: org.trialEndsAt, marketingConsent: body.marketingConsent },
      });
      return { user, org };
    });
    const verification = await issueToken(db, { purpose: "email_verification", email: result.user.email, organizationId: result.org.id, userId: result.user.id });
    await emit(db, result.org.id, "auth.email_verification", { userId: result.user.id, email: result.user.email, link: linkFor(req, "email_verification", verification.token) });
    await createSession(req, reply, result.user.id, result.org.id);
    reply.code(201);
    return { organizationId: result.org.id, trial: isDesktop ? null : { startsAt: result.org.trialStartedAt, endsAt: result.org.trialEndsAt, days: env.TRIAL_DAYS } };
  });

  app.post("/auth/login", strictLimit, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, body.email) });
    if (!user) {
      await hash("timing-equalizer"); // avoid revealing whether the account exists via timing
      throw INVALID();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
    }
    const ok = await verify(user.passwordHash, body.password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await db
        .update(schema.users)
        .set({ failedLogins: failed >= LOCK_AFTER ? 0 : failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(schema.users.id, user.id));
      await audit(db, req, { action: "auth.login_failed", resourceType: "user", resourceId: user.id, actorUserId: user.id, orgId: undefined });
      throw INVALID();
    }
    if (user.status !== "active") throw INVALID();
    const membership = await db.query.memberships.findFirst({
      where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.status, "active")),
      orderBy: asc(schema.memberships.createdAt),
    });
    if (!membership) throw INVALID();
    await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    await createSession(req, reply, user.id, membership.organizationId, { remember: body.remember });
    await audit(db, req, { action: "auth.login", resourceType: "user", resourceId: user.id, actorUserId: user.id, orgId: membership.organizationId });
    return { ok: true };
  });

  app.post("/auth/platform-admin/login", platformAdminLimit, async (req) => {
    const body = loginSchema.parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, body.email) });
    if (!user) {
      await hash("timing-equalizer");
      throw INVALID();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
    }
    if (!(await verify(user.passwordHash, body.password))) {
      const failed = user.failedLogins + 1;
      await db.update(schema.users)
        .set({ failedLogins: failed >= LOCK_AFTER ? 0 : failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(schema.users.id, user.id));
      await audit(db, req, { action: "auth.platform_admin_login_failed", resourceType: "user", resourceId: user.id, actorUserId: user.id });
      throw INVALID();
    }
    if (user.status !== "active" || !user.isPlatformAdmin) throw INVALID();

    const memberships = await db.select({
      organizationId: schema.organizations.id,
      settings: schema.organizations.settings,
      status: schema.memberships.status,
      roleKey: schema.roles.key,
    })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.status, "active")));
    const platformMembership = memberships.find((membership) => membership.settings.platformInternal && membership.roleKey === "platform_admin");
    if (memberships.length !== 1 || !platformMembership) throw INVALID();

    assertPlatformCodeDelivery();

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await issueToken(db, {
      purpose: "platform_admin_mfa",
      email: user.email,
      organizationId: platformMembership.organizationId,
      userId: user.id,
    });
    await db.update(schema.authTokens)
      .set({ payload: { otpHash: otpHash(challenge.token, code), attempts: 0 } })
      .where(eq(schema.authTokens.id, challenge.row.id));

    const delivery = await deliverPlatformCode(req, { email: user.email, userId: user.id, code, expiresAt: challenge.expiresAt, kind: "sign-in" });
    if (!delivery) {
      await db.update(schema.authTokens).set({ revokedAt: new Date() }).where(eq(schema.authTokens.id, challenge.row.id));
      throw new AppError(503, "EMAIL_2FA_DELIVERY_FAILED", "Could not deliver the verification code. Please try again shortly.");
    }

    await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
    await audit(db, req, {
      action: "auth.platform_admin_challenge_sent",
      resourceType: "user",
      resourceId: user.id,
      orgId: platformMembership.organizationId,
      actorUserId: user.id,
      after: { delivery: delivery === "email" ? "email" : delivery === "email_failed" ? "email_failed_development_server_log" : "development_server_log" },
    });
    return {
      ok: true,
      challenge: challenge.token,
      expiresAt: challenge.expiresAt,
      delivery,
      ...(delivery === "email" ? {} : { devCodeFile: DEV_OTP_FILE }),
      emailHint: emailHint(user.email),
    };
  });

  // Super admin forgot password: a 6-digit code to the admin email, then a new password.
  // The response is the same whether or not the email is a super admin, so it cannot be used to find admin accounts.
  app.post("/auth/platform-admin/forgot-password", platformAdminLimit, async (req) => {
    const body = z.object({ email: z.email().transform((e) => e.trim().toLowerCase()) }).parse(req.body);
    assertPlatformCodeDelivery();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const generic = { ok: true, expiresAt, emailHint: emailHint(body.email), delivery: platformEmailConfigured() ? "email" : "server_log", ...(platformEmailConfigured() ? {} : { devCodeFile: DEV_OTP_FILE }) };

    const user = await db.query.users.findFirst({ where: eq(schema.users.email, body.email) });
    const platformMembership = user?.isPlatformAdmin && user.status === "active"
      ? (await db.select({ organizationId: schema.organizations.id, settings: schema.organizations.settings, roleKey: schema.roles.key })
        .from(schema.memberships)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
        .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
        .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.status, "active"))))
        .find((m) => m.settings.platformInternal && m.roleKey === "platform_admin")
      : undefined;
    if (!user || !platformMembership) {
      await hash("timing-equalizer");
      return { ...generic, challenge: randomBytes(24).toString("base64url") };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await issueToken(db, { purpose: "platform_admin_reset", email: user.email, organizationId: platformMembership.organizationId, userId: user.id });
    await db.update(schema.authTokens).set({ payload: { otpHash: otpHash(challenge.token, code), attempts: 0 } }).where(eq(schema.authTokens.id, challenge.row.id));
    const delivery = await deliverPlatformCode(req, { email: user.email, userId: user.id, code, expiresAt: challenge.expiresAt, kind: "reset" });
    if (!delivery) {
      await db.update(schema.authTokens).set({ revokedAt: new Date() }).where(eq(schema.authTokens.id, challenge.row.id));
      throw new AppError(503, "EMAIL_2FA_DELIVERY_FAILED", "Could not deliver the reset code. Please try again shortly.");
    }
    await audit(db, req, { action: "auth.platform_admin_reset_requested", resourceType: "user", resourceId: user.id, orgId: platformMembership.organizationId, actorUserId: user.id });
    return { ...generic, challenge: challenge.token, expiresAt: challenge.expiresAt, delivery, ...(delivery !== "email" ? { devCodeFile: DEV_OTP_FILE } : {}) };
  });

  app.post("/auth/platform-admin/reset-password", platformAdminLimit, async (req) => {
    const body = z.object({
      challenge: z.string().min(20).max(100),
      code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
      password: platformAdminPassword,
    }).parse(req.body);
    const passwordHash = await hash(body.password);
    const result = await db.transaction(async (tx) => {
      const challenge = await findValidToken(tx, body.challenge, "platform_admin_reset");
      if (!challenge?.userId) return { error: "expired" as const };
      const [counted] = await tx.update(schema.authTokens)
        .set({ payload: sql`jsonb_set(${schema.authTokens.payload}, '{attempts}', to_jsonb(coalesce((${schema.authTokens.payload}->>'attempts')::int, 0) + 1))` })
        .where(and(eq(schema.authTokens.id, challenge.id), isNull(schema.authTokens.usedAt), isNull(schema.authTokens.revokedAt)))
        .returning({ payload: schema.authTokens.payload });
      const attempts = Number(counted?.payload.attempts ?? OTP_MAX_ATTEMPTS + 1);
      const expected = Buffer.from(String(challenge.payload.otpHash ?? ""), "hex");
      const given = Buffer.from(otpHash(body.challenge, body.code), "hex");
      if (!(attempts <= OTP_MAX_ATTEMPTS && expected.length === given.length && timingSafeEqual(expected, given))) {
        if (attempts >= OTP_MAX_ATTEMPTS) await tx.update(schema.authTokens).set({ revokedAt: new Date() }).where(eq(schema.authTokens.id, challenge.id));
        await audit(tx, req, { action: "auth.platform_admin_reset_failed", resourceType: "user", resourceId: challenge.userId, orgId: challenge.organizationId ?? undefined, actorUserId: challenge.userId, after: { attempts } });
        return { error: "wrong" as const, remaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts) };
      }
      const user = await tx.query.users.findFirst({ where: eq(schema.users.id, challenge.userId) });
      if (!user || user.status !== "active" || !user.isPlatformAdmin) return { error: "expired" as const };
      const [used] = await tx.update(schema.authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(schema.authTokens.id, challenge.id), isNull(schema.authTokens.usedAt), isNull(schema.authTokens.revokedAt), gt(schema.authTokens.expiresAt, new Date())))
        .returning({ id: schema.authTokens.id });
      if (!used) return { error: "expired" as const };
      await tx.update(schema.users).set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
      // Sign out every existing super admin session after a password reset.
      await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, user.id), isNull(schema.sessions.revokedAt)));
      await audit(tx, req, { action: "auth.platform_admin_password_reset", resourceType: "user", resourceId: user.id, orgId: challenge.organizationId ?? undefined, actorUserId: user.id });
      return { ok: true as const };
    });
    if ("error" in result) {
      if (result.error === "wrong" && result.remaining > 0) {
        throw new AppError(401, "OTP_INCORRECT", `That code is incorrect. ${result.remaining} attempt${result.remaining === 1 ? "" : "s"} left.`);
      }
      throw new AppError(410, "OTP_EXPIRED", "This code has expired or too many attempts were made. Request a new code.");
    }
    return { ok: true };
  });

  app.post("/auth/platform-admin/verify", platformAdminLimit, async (req, reply) => {
    const body = z.object({ challenge: z.string().min(20).max(100), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const challenge = await findValidToken(tx, body.challenge, "platform_admin_mfa");
      if (!challenge?.userId || !challenge.organizationId) return { error: "expired" as const };
      // Count the attempt before checking it so parallel guesses cannot exceed the limit.
      const [counted] = await tx.update(schema.authTokens)
        .set({ payload: sql`jsonb_set(${schema.authTokens.payload}, '{attempts}', to_jsonb(coalesce((${schema.authTokens.payload}->>'attempts')::int, 0) + 1))` })
        .where(and(eq(schema.authTokens.id, challenge.id), isNull(schema.authTokens.usedAt), isNull(schema.authTokens.revokedAt)))
        .returning({ payload: schema.authTokens.payload });
      const attempts = Number(counted?.payload.attempts ?? OTP_MAX_ATTEMPTS + 1);
      const expected = Buffer.from(String(challenge.payload.otpHash ?? ""), "hex");
      const given = Buffer.from(otpHash(body.challenge, body.code), "hex");
      const matches = attempts <= OTP_MAX_ATTEMPTS && expected.length === given.length && timingSafeEqual(expected, given);
      if (!matches) {
        if (attempts >= OTP_MAX_ATTEMPTS) await tx.update(schema.authTokens).set({ revokedAt: new Date() }).where(eq(schema.authTokens.id, challenge.id));
        await audit(tx, req, { action: "auth.platform_admin_otp_failed", resourceType: "user", resourceId: challenge.userId, orgId: challenge.organizationId, actorUserId: challenge.userId, after: { attempts } });
        return { error: "wrong" as const, remaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts) };
      }
      const user = await tx.query.users.findFirst({ where: eq(schema.users.id, challenge.userId) });
      const organization = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, challenge.organizationId) });
      const membership = await tx.query.memberships.findFirst({
        where: and(
          eq(schema.memberships.userId, challenge.userId),
          eq(schema.memberships.organizationId, challenge.organizationId),
          eq(schema.memberships.status, "active"),
        ),
      });
      const role = membership ? await tx.query.roles.findFirst({ where: eq(schema.roles.id, membership.roleId) }) : undefined;
      if (!user || user.status !== "active" || !user.isPlatformAdmin || !organization?.settings.platformInternal || role?.key !== "platform_admin") return { error: "expired" as const };
      const [used] = await tx.update(schema.authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(schema.authTokens.id, challenge.id), isNull(schema.authTokens.usedAt), isNull(schema.authTokens.revokedAt), gt(schema.authTokens.expiresAt, new Date())))
        .returning({ id: schema.authTokens.id });
      if (!used) return { error: "expired" as const };
      await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
      await audit(tx, req, {
        action: "auth.platform_admin_login",
        resourceType: "user",
        resourceId: user.id,
        orgId: challenge.organizationId,
        actorUserId: user.id,
      });
      return { userId: user.id, organizationId: challenge.organizationId };
    });
    if ("error" in result) {
      if (result.error === "wrong" && result.remaining > 0) {
        throw new AppError(401, "OTP_INCORRECT", `That code is incorrect. ${result.remaining} attempt${result.remaining === 1 ? "" : "s"} left.`);
      }
      throw new AppError(410, "OTP_EXPIRED", "This code has expired or too many attempts were made. Sign in again to get a new code.");
    }
    await createSession(req, reply, result.userId, result.organizationId);
    return { ok: true };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, hashToken(token)));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/session", async (req) => {
    const auth = requireAuth(req);
    const branches = await db.query.branches.findMany({ where: eq(schema.branches.organizationId, auth.orgId), orderBy: asc(schema.branches.createdAt) });
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    return {
      user: { id: auth.userId, name: auth.userName, email: auth.email },
      isPlatformAdmin: auth.isPlatformAdmin,
      organization: { id: auth.orgId, name: auth.orgName, status: auth.orgStatus, currency: org?.defaultCurrency, gstin: org?.gstin, settings: org?.settings, hasLogo: Boolean(org?.logoData && org?.logoMimeType) },
      role: { key: auth.roleKey, name: auth.roleName },
      permissions: [...auth.permissions],
      branches: branches
        .filter((b) => auth.branchIds.length === 0 || auth.branchIds.includes(b.id))
        .map((b) => ({ id: b.id, name: b.name, code: b.branchCode, status: b.status })),
    };
  });

  app.post("/auth/verify-email", strictLimit, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.body);
    await db.transaction(async (tx) => {
      const row = await findValidToken(tx, token, "email_verification");
      if (!row || !row.userId) throw new AppError(410, "LINK_INVALID", "This verification link is invalid or has expired.");
      await tx.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, row.userId));
      await tx.update(schema.authTokens).set({ usedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
      await audit(tx, req, { action: "auth.email_verified", resourceType: "user", resourceId: row.userId, orgId: row.organizationId ?? undefined, actorUserId: row.userId });
    });
    return { verified: true };
  });

  /** Businesses this user can open (e.g. their own cloud shop and the cloud copy of their shop PC). */
  app.get("/auth/organizations", async (req) => {
    const auth = requireAuth(req);
    const rows = await db.execute<{ id: string; name: string; role: string; managed_by_pc: boolean }>(sql`
      select o.id, o.name, r.name as role, coalesce(o.settings_json->>'syncSource' = 'device', false) as managed_by_pc
      from organization_memberships m join organizations o on o.id = m.organization_id join roles r on r.id = m.role_id
      where m.user_id = ${auth.userId} and m.status = 'active' and o.status <> 'terminated' order by o.name`);
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, managedByPc: r.managed_by_pc, current: r.id === auth.orgId }));
  });

  app.post("/auth/switch-organization", async (req) => {
    const auth = requireAuth(req);
    const { organizationId } = z.object({ organizationId: z.uuid() }).parse(req.body);
    const member = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, auth.userId), eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.status, "active")) });
    if (!member) throw new AppError(403, "FORBIDDEN", "You do not have access to that business");
    await db.update(schema.sessions).set({ organizationId, activeBranchId: null }).where(eq(schema.sessions.id, auth.sessionId));
    await audit(db, req, { action: "auth.organization_switched", resourceType: "organization", resourceId: organizationId, orgId: organizationId });
    return { switched: true };
  });

  /** Sends a fresh verification link to the signed-in user (same email as at signup). */
  app.post("/auth/verify-email/resend", { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req) => {
    const auth = requireAuth(req);
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, auth.userId) });
    if (!user) throw new AppError(404, "NOT_FOUND", "Account not found");
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true, email: user.email };
    const verification = await issueToken(db, { purpose: "email_verification", email: user.email, organizationId: auth.orgId, userId: user.id });
    await emit(db, auth.orgId, "auth.email_verification", { userId: user.id, email: user.email, link: linkFor(req, "email_verification", verification.token) });
    await audit(db, req, { action: "auth.email_verification_resent", resourceType: "user", resourceId: user.id });
    return { sent: true, alreadyVerified: false, email: user.email, emailConfigured: emailConfigured() };
  });

  app.get("/auth/trial-status", async (req) => {
    const auth = requireAuth(req);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, auth.orgId) });
    if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");
    const now = Date.now();
    const endsAt = org.trialEndsAt?.getTime();
    return {
      status: org.status,
      trialStartsAt: org.trialStartedAt,
      trialEndsAt: org.trialEndsAt,
      daysRemaining: endsAt ? Math.max(0, Math.ceil((endsAt - now) / 86_400_000)) : null,
      expired: org.status === "trial" && endsAt !== undefined && endsAt <= now,
      emailVerified: !!(await db.query.users.findFirst({ where: eq(schema.users.id, auth.userId) }))?.emailVerifiedAt,
      access: await accessState(auth.orgId),
    };
  });

  // ---------------------------------------------------------------- password reset & invitations

  /** Always answers the same way, so it cannot be used to discover which emails have accounts. */
  app.post("/auth/forgot-password", strictLimit, async (req) => {
    const { email } = z.object({ email: z.email().toLowerCase() }).parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (user && user.status === "active") {
      const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.status, "active")) });
      if (m) {
        const { token } = await issueToken(db, { purpose: "password_reset", email, userId: user.id, organizationId: m.organizationId });
        await emit(db, m.organizationId, "auth.password_reset", { userId: user.id, email, link: linkFor(req, "password_reset", token) });
        await audit(db, req, { action: "auth.reset_requested", resourceType: "user", resourceId: user.id, orgId: m.organizationId, actorUserId: user.id });
      }
    }
    return { ok: true, message: "If this email belongs to an active account, a reset link has been sent. If you don't receive it, ask your store owner for a reset link." };
  });

  /** Lets the reset / invitation page show who the link is for before asking for a password. */
  app.get("/auth/token/:token", strictLimit, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.params);
    const row = await findValidToken(db, token);
    if (!row) throw new AppError(410, "LINK_INVALID", "This link has expired or has already been used. Ask for a new one.");
    const org = row.organizationId ? await db.query.organizations.findFirst({ where: eq(schema.organizations.id, row.organizationId) }) : undefined;
    const existingUser = row.purpose === "invitation" ? await db.query.users.findFirst({ where: eq(schema.users.email, row.email) }) : undefined;
    return { purpose: row.purpose, email: row.email, name: row.payload.name, organizationName: org?.name, expiresAt: row.expiresAt, existingAccount: !!existingUser };
  });

  app.post("/auth/reset-password", strictLimit, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(100), password: newPassword }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const row = await findValidToken(tx, body.token, "password_reset");
      if (!row?.userId) throw new AppError(410, "LINK_INVALID", "This link has expired or has already been used. Ask for a new one.");
      await tx.update(schema.authTokens).set({ usedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
      await tx.update(schema.users).set({ passwordHash: await hash(body.password), failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(schema.users.id, row.userId));
      // Sign out everywhere: whoever knew the old password loses access immediately.
      await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, row.userId), sql`${schema.sessions.revokedAt} is null`));
      await audit(tx, req, { action: "auth.password_reset", resourceType: "user", resourceId: row.userId, orgId: row.organizationId ?? undefined, actorUserId: row.userId });
      return row;
    });
    await createSession(req, reply, result.userId!, result.organizationId!);
    return { ok: true };
  });

  app.post("/auth/accept-invitation", strictLimit, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(100), password: z.string().min(1).max(200), name: z.string().trim().min(2).max(120).optional() }).parse(req.body);
    const out = await db.transaction(async (tx) => {
      const row = await findValidToken(tx, body.token, "invitation");
      if (!row?.organizationId) throw new AppError(410, "LINK_INVALID", "This invitation has expired, been revoked or already been used.");
      const role = await tx.query.roles.findFirst({ where: and(eq(schema.roles.organizationId, row.organizationId), eq(schema.roles.key, row.payload.roleKey ?? "")) });
      if (!role) throw new AppError(410, "LINK_INVALID", "The role in this invitation no longer exists. Ask for a new invitation.");
      let user = await tx.query.users.findFirst({ where: eq(schema.users.email, row.email) });
      if (user) {
        // Joining with an existing DryCare account requires that account's password.
        if (!(await verify(user.passwordHash, body.password))) throw INVALID();
        const member = await tx.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.organizationId, row.organizationId)) });
        if (member) throw conflict("You are already a member of this business. Sign in instead.");
      } else {
        newPassword.parse(body.password);
        [user] = await tx.insert(schema.users).values({ email: row.email, name: body.name ?? row.payload.name ?? row.email, passwordHash: await hash(body.password) }).returning();
      }
      const [m] = await tx
        .insert(schema.memberships)
        .values({ organizationId: row.organizationId, userId: user.id, roleId: role.id, branchIds: row.payload.branchIds ?? [] })
        .returning();
      await tx.update(schema.authTokens).set({ usedAt: new Date(), userId: user.id }).where(eq(schema.authTokens.id, row.id));
      await audit(tx, req, { action: "staff.invitation_accepted", resourceType: "membership", resourceId: m.id, orgId: row.organizationId, actorUserId: user.id, after: { email: row.email, role: role.key } });
      return { userId: user.id, orgId: row.organizationId };
    });
    await createSession(req, reply, out.userId, out.orgId);
    reply.code(201);
    return { ok: true };
  });
}
