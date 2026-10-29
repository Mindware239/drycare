"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeIndianRupee, Building2, CalendarClock, CircleCheck, Clock3, Inbox, Info, RefreshCw, Repeat, TrendingUp, UserPlus, Wallet } from "lucide-react";
import { Alert, Button, cx } from "@/components/ui";
import { money } from "@/lib/format";
import { ConsoleHeader, LoadingRows, MetricCard, Panel, actionLabel, dateTimeLabel, useAdmin, useAdminData } from "./admin-ui";

type Dashboard = {
  metrics: {
    customers: number; new7: number; new30: number; trialsActive: number; trialsExpiring7: number; trialsLapsed: number; suspended: number;
    paidActive: number; mrrPaise: number; renewals14: number; lapsedSubscriptions: number; collectedPaise: number; collected30Paise: number;
    paymentCount: number; newLeads: number; verifiedOwners: number; conversionBps: number | null; publishedPlans: number;
  };
  signups: { day: string; count: number }[];
  activity: { id: string; action: string; createdAt: string; actorEmail: string | null; organizationName: string | null; organizationId: string | null }[];
  alerts: { tone: "red" | "amber" | "blue"; title: string; detail: string; href: string }[];
};

export default function SuperAdminDashboard() {
  const admin = useAdmin();
  const { data, error, loading, reload } = useAdminData<Dashboard>("/platform-admin/dashboard");
  const m = data?.metrics;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <ConsoleHeader
        title={admin.name && admin.name !== "DryCare Admin" ? `${greeting}, ${admin.name.split(" ")[0]}` : greeting}
        description="Live figures for the DryCare software business. Collections count only payments verified in your bank or UPI account; nothing here is estimated."
        actions={<Button variant="secondary" onClick={reload} loading={loading && Boolean(data)}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      {!m ? <Panel><LoadingRows rows={8} /></Panel> : (
        <div className="space-y-6">
          {data.alerts.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.alerts.map((a) => (
                <Link key={a.title} href={a.href} className={cx("group flex items-start gap-3 rounded-2xl border p-4 transition hover:shadow-md",
                  a.tone === "red" ? "border-red-200 bg-red-50/70" : a.tone === "amber" ? "border-amber-200 bg-amber-50/70" : "border-blue-200 bg-blue-50/70")}>
                  {a.tone === "blue" ? <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /> : <AlertTriangle className={cx("mt-0.5 h-5 w-5 shrink-0", a.tone === "red" ? "text-red-700" : "text-amber-700")} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{a.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-600">{a.detail}</span>
                  </span>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Building2} label="Registered businesses" value={m.customers.toLocaleString("en-IN")} detail={`${m.new7} new this week · ${m.new30} in 30 days`} href="/super-admin/customers" />
            <MetricCard icon={Clock3} label="Active free trials" value={m.trialsActive.toLocaleString("en-IN")} detail={`${m.trialsExpiring7} ending within 7 days · ${m.trialsLapsed} lapsed`} tone="amber" href="/super-admin/trials" />
            <MetricCard icon={CircleCheck} label="Paid subscriptions" value={m.paidActive.toLocaleString("en-IN")} detail={`${m.renewals14} renewing in 14 days · ${m.suspended} suspended accounts`} tone="emerald" href="/super-admin/subscriptions" />
            <MetricCard icon={TrendingUp} label="Trial → paid conversion" value={m.conversionBps === null ? "—" : `${(m.conversionBps / 100).toFixed(1)}%`} detail="Businesses with a verified payment ÷ businesses that started a trial" tone="violet" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Repeat} label="Monthly recurring revenue" value={money(m.mrrPaise)} detail="Active subscriptions at list price; annual plans ÷ 12" tone="blue" href="/super-admin/revenue" />
            <MetricCard icon={Wallet} label="Collected (last 30 days)" value={money(m.collected30Paise)} detail="Verified payments received in the last 30 days" tone="emerald" href="/super-admin/revenue" />
            <MetricCard icon={BadgeIndianRupee} label="Collected (all time)" value={money(m.collectedPaise)} detail={`${m.paymentCount.toLocaleString("en-IN")} verified payment${m.paymentCount === 1 ? "" : "s"}`} href="/super-admin/payments" />
            <MetricCard icon={Inbox} label="New website enquiries" value={m.newLeads.toLocaleString("en-IN")} detail="Demo and sales requests not yet contacted" tone="amber" href="/super-admin/leads" />
          </div>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Panel title="New registrations" description="Businesses that signed up each day, last 30 days (India time)">
              <SignupChart rows={data.signups} />
            </Panel>
            <Panel title="Recent activity" description="Sign-ups and super admin actions" padded={false} actions={<Link href="/super-admin/audit-logs" className="text-xs font-semibold text-brand-700 hover:underline">Full audit log</Link>}>
              {data.activity.length === 0 ? <p className="p-6 text-sm text-slate-500">No activity recorded yet.</p> : (
                <ul className="divide-y divide-slate-100">
                  {data.activity.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                      <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", a.action.includes("failed") ? "bg-red-500" : a.action.startsWith("platform.") ? "bg-brand-500" : "bg-slate-300")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{actionLabel(a.action)}</p>
                        <p className="truncate text-xs text-slate-500">
                          {a.organizationName && a.organizationId ? <Link href={`/super-admin/customers/view?id=${a.organizationId}`} className="hover:underline">{a.organizationName}</Link> : a.actorEmail ?? "System"}
                        </p>
                      </div>
                      <time className="shrink-0 text-[11px] text-slate-400">{dateTimeLabel(a.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <QuickLink href="/super-admin/payments" icon={Wallet} title="Record a verified payment" detail="Activate a plan after checking UPI or bank receipt" />
            <QuickLink href="/super-admin/trials?window=expiring" icon={CalendarClock} title="Trials ending soon" detail="Follow up before shops lose access" />
            <QuickLink href="/super-admin/customers?sort=newest" icon={UserPlus} title="Newest registrations" detail="Welcome and onboard new businesses" />
          </div>
        </div>
      )}
    </>
  );
}

function SignupChart({ rows }: { rows: { day: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const fmt = (day: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00`));
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums text-slate-900">{total}<span className="ml-2 text-sm font-normal text-slate-500">registrations</span></p>
      <div className="mt-5 flex h-40 items-end gap-[3px]" role="img" aria-label={`Daily registrations over 30 days, ${total} in total, peak ${max} in a day`}>
        {rows.map((r) => (
          <div key={r.day} className="group relative flex h-full flex-1 items-end">
            <div className={cx("w-full rounded-t-[3px] transition", r.count ? "bg-brand-500 group-hover:bg-brand-700" : "bg-slate-100")} style={{ height: `${r.count ? Math.max(6, (r.count / max) * 100) : 3}%` }} />
            <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white group-hover:block">{fmt(r.day)} · {r.count}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>{rows[0] && fmt(rows[0].day)}</span><span>Today</span>
      </div>
    </div>
  );
}

function QuickLink({ href, icon: Icon, title, detail }: { href: string; icon: typeof Wallet; title: string; detail: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow-md">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-700"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block truncate text-xs text-slate-500">{detail}</span></span>
      <ArrowRight className="h-4 w-4 text-slate-400" />
    </Link>
  );
}
