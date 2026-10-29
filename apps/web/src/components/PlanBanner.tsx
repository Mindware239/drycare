"use client";
import Link from "next/link";
import { CalendarClock, Lock } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";

type TrialStatus = { access?: { writable: boolean; reason: string; until: string | null } };
type LicenseStatus = { demo: { daysLeft: number; ended: boolean } | null };

/** Trial ending soon, renewal grace, or read-only after expiry. Owners get a link to Plan & billing. */
export function PlanBanner({ canManage }: { canManage: boolean }) {
  const { data } = useApi<TrialStatus>("/auth/trial-status");
  const license = useApi<LicenseStatus>(data?.access?.reason === "desktop" ? "/system/license/status" : null);
  const a = data?.access;
  if (!a) return null;
  // Windows app: 7-day demo, then the upgrade (activation) screen.
  const demo = license.data?.demo;
  if (a.reason === "desktop") {
    if (!demo || demo.ended) return null;
    return (
      <div role="status" className={cx("mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm", demo.daysLeft <= 2 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900")}>
        <CalendarClock className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1"><strong>DryCare demo:</strong> {demo.daysLeft} day{demo.daysLeft === 1 ? "" : "s"} left. After that DryCare asks for an upgrade; your data is kept.{!canManage && " Tell the store owner."}</p>
        {canManage && <Link href="/activate?upgrade=1" className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">Upgrade now</Link>}
      </div>
    );
  }
  if (a.reason === "device_managed") {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Lock className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1"><strong>View-only cloud copy.</strong> This shop is run from its shop PC; orders, bills and stock are changed there and upload automatically.</p>
        {canManage && <Link href="/integrations#shop-pc" className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-100">Linked PC</Link>}
      </div>
    );
  }
  const days = a.until ? Math.ceil((new Date(a.until).getTime() - Date.now()) / 86_400_000) : null;
  let tone: "amber" | "red" | null = null;
  let text = "";
  if (!a.writable) {
    tone = "red";
    text = a.reason === "suspended" ? "This account is on hold. Contact DryCare support."
      : a.reason === "trial_ended" ? "Your free trial has ended. DryCare is read-only: you can see everything, but new orders and changes need a plan."
      : "Your plan has expired. DryCare is read-only until it is renewed.";
  } else if (a.reason === "trial" && days !== null && days <= 3) {
    tone = "amber";
    text = days <= 0 ? "Your free trial ends today." : `Your free trial ends in ${days} day${days === 1 ? "" : "s"}.`;
  } else if (a.reason === "grace") {
    tone = "amber";
    text = `Your plan has ended. Renew within ${Math.max(days ?? 0, 0)} day${days === 1 ? "" : "s"} to avoid interruption.`;
  }
  if (!tone) return null;
  return (
    <div role="status" className={cx("mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm", tone === "red" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
      {tone === "red" ? <Lock className="h-4 w-4 shrink-0" /> : <CalendarClock className="h-4 w-4 shrink-0" />}
      <p className="min-w-0 flex-1">{text}{!canManage && a.reason !== "suspended" && " Ask the store owner to choose a plan."}</p>
      {canManage && a.reason !== "suspended" && (
        <Link href="/billing" className={cx("rounded-lg px-3 py-1.5 text-xs font-semibold text-white", tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700")}>Choose a plan</Link>
      )}
    </div>
  );
}
