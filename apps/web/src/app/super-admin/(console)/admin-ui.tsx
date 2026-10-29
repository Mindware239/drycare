"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, type LucideIcon } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Badge, Button, cx, type Tone } from "@/components/ui";

export type AdminUser = { id: string; name: string; email: string };
export const AdminContext = createContext<AdminUser | null>(null);
export const useAdmin = () => useContext(AdminContext)!;

/** Data hook for console pages: loads, exposes reload, and keeps the last good data while refreshing. */
export function useAdminData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : "Could not load this page.");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export const dateLabel = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value)) : "—";
export const dateTimeLabel = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

export function relativeDays(value: string | null | undefined) {
  const d = daysUntil(value);
  if (d === null) return "";
  if (d === 0) return "today";
  return d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : `${-d} day${d === -1 ? "" : "s"} ago`;
}

const STATUS_TONES: Record<string, Tone> = {
  active: "green", paid: "green", converted: "green", qualified: "blue", contacted: "blue",
  trial: "amber", trialing: "amber", new: "amber", renewing: "amber", past_due: "amber",
  suspended: "red", expired: "red", failed: "red", canceled: "slate", cancelled: "slate", terminated: "slate", closed: "slate",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return <Badge color={STATUS_TONES[status] ?? "slate"}>{status.replaceAll("_", " ")}</Badge>;
}

/** Trial status as a shop owner would understand it: active with days left, ending soon, or lapsed. */
export function TrialBadge({ status, trialEndsAt }: { status: string; trialEndsAt: string | null }) {
  if (status !== "trial") return <StatusBadge status={status} />;
  const d = daysUntil(trialEndsAt);
  if (d === null) return <Badge color="amber">trial</Badge>;
  if (d < 0) return <Badge color="red">trial lapsed</Badge>;
  return <Badge color={d <= 7 ? "amber" : "blue"}>trial · {d}d left</Badge>;
}

export function ConsoleHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({ icon: Icon, label, value, detail, tone = "brand", href }: { icon: LucideIcon; label: string; value: ReactNode; detail?: ReactNode; tone?: "brand" | "blue" | "amber" | "red" | "violet" | "emerald"; href?: string }) {
  const tones = {
    brand: "bg-brand-50 text-brand-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    violet: "bg-violet-50 text-violet-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{value}</p>
        {detail && <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>}
      </div>
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-[18px] w-[18px]" /></span>
    </div>
  );
  const cls = "block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  return href ? <a href={href} className={cx(cls, "transition hover:border-brand-300 hover:shadow-md")}>{body}</a> : <div className={cls}>{body}</div>;
}

export function Panel({ title, description, actions, children, padded = true, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

export function DataTable({ head, children, empty, minWidth = 860 }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-5 py-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon className="h-5 w-5" /></span>
      <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">{children}</p>}
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
      <p className="text-xs text-slate-500">Showing {first.toLocaleString("en-IN")}–{last.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" disabled={last >= total} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function SegmentedTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-lg px-3 py-1.5 text-xs font-semibold transition", value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
          {o.label}{o.count !== undefined && <span className="ml-1.5 text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Exports rows as a UTF-8 CSV (with BOM so Excel shows ₹ and Indian names correctly). */
export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Prefix formula-like values so spreadsheets never execute them.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled}><Download className="h-4 w-4" />Export CSV</Button>;
}

export const rupees = (paise: number | string | null | undefined) => (Number(paise ?? 0) / 100).toFixed(2);

export const ACTION_LABELS: Record<string, string> = {
  "auth.platform_admin_login": "Super admin signed in",
  "auth.platform_admin_challenge_sent": "Sign-in code issued",
  "auth.platform_admin_otp_failed": "Incorrect sign-in code",
  "auth.platform_admin_login_failed": "Super admin password rejected",
  "platform.trial_extended": "Trial extended",
  "platform.organization_suspended": "Account suspended",
  "platform.organization_reactivated": "Account reactivated",
  "platform.manual_payment_verified": "Payment verified",
  "platform.plan_updated": "Plan updated",
  "platform.plan_created": "Plan created",
  "platform.lead_status_changed": "Enquiry status changed",
  "platform.password_changed": "Admin password changed",
  "platform.password_change_failed": "Password change rejected",
  "platform.sessions_revoked": "Other sessions signed out",
  "organization.provisioned": "Business registered",
  "auth.email_verified": "Owner email verified",
  "auth.login": "Store sign-in",
  "auth.login_failed": "Store sign-in failed",
};
export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action.replaceAll("_", " ").replace(/\./g, " · ");
