/**
 * Whether a cloud shop may make changes: during its free trial, while a paid plan is current (plus a short grace
 * period), or when activated without a plan by the software owner. Otherwise the shop is read-only: it can still
 * sign in, see its data, and pay on Plan & billing. The desktop edition is licensed separately and never limited here.
 */
import { desc, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db, schema } from "../db/client";
import { isDesktop } from "../env";
import { AppError } from "./errors";

export const RENEWAL_GRACE_DAYS = 3;

export type AccessState = {
  writable: boolean;
  reason: "trial" | "active" | "grace" | "unmanaged" | "trial_ended" | "subscription_expired" | "suspended" | "desktop" | "device_managed";
  /** When writing stops (trial end, or plan end + grace), if known. */
  until: string | null;
};

export async function accessState(orgId: string): Promise<AccessState> {
  if (isDesktop) return { writable: true, reason: "desktop", until: null };
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org || org.settings.platformInternal) return { writable: true, reason: "unmanaged", until: null };
  if (org.status === "suspended") return { writable: false, reason: "suspended", until: null };
  // A copy of a shop PC: only the PC's uploads change it (phase 3 is one-way), so the cloud web is view-only.
  if (org.settings.syncSource === "device") return { writable: false, reason: "device_managed", until: null };
  const now = Date.now();
  if (org.status === "trial") {
    if (!org.trialEndsAt) return { writable: true, reason: "unmanaged", until: null };
    return org.trialEndsAt.getTime() > now
      ? { writable: true, reason: "trial", until: org.trialEndsAt.toISOString() }
      : { writable: false, reason: "trial_ended", until: org.trialEndsAt.toISOString() };
  }
  const sub = await db.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.organizationId, orgId), orderBy: [desc(schema.commercialSubscriptions.createdAt)] });
  // Activated by the software owner without a recorded plan (legacy or special arrangement).
  if (!sub || !sub.endsAt) return { writable: true, reason: "unmanaged", until: null };
  const graceEnds = sub.endsAt.getTime() + RENEWAL_GRACE_DAYS * 86_400_000;
  if (sub.endsAt.getTime() > now && sub.status === "active") return { writable: true, reason: "active", until: new Date(graceEnds).toISOString() };
  if (graceEnds > now && sub.status !== "canceled") return { writable: true, reason: "grace", until: new Date(graceEnds).toISOString() };
  return { writable: false, reason: "subscription_expired", until: sub.endsAt.toISOString() };
}

/** Requests a read-only shop may still make: signing in/out, paying, and reading its own data. */
const ALWAYS_ALLOWED = [/^\/api\/v1\/auth\//, /^\/api\/v1\/commercial\//, /^\/api\/v1\/webhooks\//, /^\/api\/v1\/system\/(info|desktop-owner-recovery|license)/, /^\/api\/v1\/organizations$/, /^\/api\/v1\/sync\/(link|devices)\//];

const MESSAGES: Record<string, string> = {
  device_managed: "This shop is run from its shop PC. The cloud copy is view-only: make changes on the PC and they will upload automatically.",
  trial_ended: "Your free trial has ended. Choose a plan on Plan & billing to keep adding orders; your data is safe and still visible.",
  subscription_expired: "Your DryCare plan has expired. Renew on Plan & billing to keep adding orders; your data is safe and still visible.",
  suspended: "This account is on hold. Please contact DryCare support.",
};

export async function assertWritable(req: FastifyRequest) {
  if (isDesktop || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const path = req.url.split("?")[0];
  if (!path.startsWith("/api/v1/") || ALWAYS_ALLOWED.some((re) => re.test(path))) return;
  const auth = req.auth;
  if (!auth?.orgId || auth.isPlatformAdmin) return;
  const state = await accessState(auth.orgId);
  if (!state.writable) throw new AppError(state.reason === "device_managed" ? 409 : 402, state.reason === "suspended" ? "ACCOUNT_SUSPENDED" : state.reason === "device_managed" ? "MANAGED_BY_SHOP_PC" : "SUBSCRIPTION_REQUIRED", MESSAGES[state.reason] ?? "A current plan is required.");
}
