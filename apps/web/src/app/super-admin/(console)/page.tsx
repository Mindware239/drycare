"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CalendarClock, CircleCheck, Clock3, Inbox, Info, RefreshCw, UserPlus, Wallet } from "lucide-react";
import { Alert, Button, cx } from "@/components/ui";
import { money } from "@/lib/format";
import { ConsoleHeader, LoadingRows, MetricCard, Panel, actionLabel, dateTimeLabel, useAdmin, useAdminData } from "./admin-ui";
import { BarList, DayChart } from "./charts";

type Dashboard = {
  metrics: {
    customers: number; new7: number; new30: number; trialsActive: number; trialsExpiring7: number; trialsLapsed: number; suspended: number;
    paidActive: number; mrrPaise: number; renewals14: number; lapsedSubscriptions: number; collectedPaise: number; collected30Paise: number;
    paymentCount: number; newLeads: number; verifiedOwners: number; conversionBps: number | null; publishedPlans: number; everTrialed: number; payingEver: number;
  };
  signups: { day: string; count: number }[];
  collections: { day: string; paise: number }[];
  activity: { id: string; action: string; createdAt: string; actorEmail: string | null; organizationName: string | null; organizationId: string | null }[];
  alerts: { tone: "red" | "amber" | "blue"; title: string; detail: string; href: string }[];
};
const count = (n: number) => n.toLocaleString("en-IN");
const Chip = ({ children, tone = "good" }: { children: React.ReactNode; tone?: "good" | "warn" | "plain" }) => <span className={cx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone === "good" ? "bg-brand-50 text-brand-700" : tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")}>{children}</span>;

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
        description="Live figures for the Drycare software business. Collections count only payments verified in your bank or UPI account; nothing here is estimated."
        actions={<Button variant="secondary" onClick={reload} loading={loading && Boolean(data)}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      {!m ? <Panel><LoadingRows rows={8} /></Panel> : (
        <div className="space-y-6">
          <section aria-label="Revenue" className="dc-hero grid gap-6 overflow-hidden rounded-3xl p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:p-8">
            <div className="flex min-w-0 flex-col justify-between gap-6">
              <div>
                <p className="text-sm font-medium opacity-75">Monthly recurring revenue</p>
                <p className="dcd-h mt-2 break-words text-[44px] leading-none tabular-nums">{money(m.mrrPaise)}</p>
                <p className="mt-3 text-xs leading-5 opacity-70">Active subscriptions at list price; annual plans ÷ 12</p>
              </div>
              <dl className="grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: "rgba(250,248,244,.16)" }}>
                <div className="min-w-0"><dt className="text-xs opacity-70">Collected, 30 days</dt><dd className="dcd-h mt-1 break-words text-xl tabular-nums">{money(m.collected30Paise)}</dd></div>
                <div className="min-w-0"><dt className="text-xs opacity-70">{m.paymentCount === 1 ? "All time · 1 payment" : `All time · ${count(m.paymentCount)} payments`}</dt><dd className="dcd-h mt-1 break-words text-xl tabular-nums">{money(m.collectedPaise)}</dd></div>
              </dl>
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-medium opacity-75">Verified collections per day</p><Link href="/super-admin/revenue" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "#8fd8a2" }}>Revenue<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Link></div>
              <DayChart points={data.collections.map((c) => ({ day: c.day, value: c.paise }))} kind="bar" height={190} format={(p) => money(p)} label="Verified collections per day, last 30 days" empty="No verified payments in the last 30 days." table={false} />
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Building2} label="Registered businesses" value={count(m.customers)} delta={<Chip>{`+${count(m.new7)} this week`}</Chip>} detail={`${count(m.new30)} in the last 30 days`} href="/super-admin/customers" />
            <MetricCard icon={Clock3} label="Active free trials" value={count(m.trialsActive)} delta={m.trialsExpiring7 ? <Chip tone="warn">{`${m.trialsExpiring7} ending soon`}</Chip> : undefined} detail={`${count(m.trialsLapsed)} lapsed without payment`} tone={m.trialsExpiring7 ? "amber" : "brand"} href="/super-admin/trials" />
            <MetricCard icon={CircleCheck} label="Paid subscriptions" value={count(m.paidActive)} delta={m.renewals14 ? <Chip tone="plain">{`${m.renewals14} renewing soon`}</Chip> : undefined} detail={`${count(m.suspended)} suspended accounts`} href="/super-admin/subscriptions" />
            <MetricCard icon={Inbox} label="New enquiries" value={count(m.newLeads)} delta={m.newLeads ? <Chip tone="warn">To contact</Chip> : undefined} detail="Demo and sales requests" tone={m.newLeads ? "amber" : "brand"} href="/super-admin/leads" />
          </div>

          {data.alerts.length > 0 && (
            <Panel title="Needs your attention" padded={false}>
              <ul className="divide-y divide-slate-100">
                {data.alerts.map((a) => (
                  <li key={a.title}>
                    <Link href={a.href} className="group flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                      {a.tone === "blue" ? <Info aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-blue-700" /> : <AlertTriangle aria-hidden="true" className={cx("h-[18px] w-[18px] shrink-0", a.tone === "red" ? "text-red-700" : "text-amber-700")} />}
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{a.title}</span><span className="block truncate text-xs text-slate-500">{a.detail}</span></span>
                      <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
            <Panel title="New registrations" description={`${count(data.signups.reduce((n, s) => n + s.count, 0))} businesses in the last 30 days (India time)`}>
              <DayChart points={data.signups.map((s) => ({ day: s.day, value: s.count }))} kind="bar" height={220} unit="businesses" label="New registrations per day, last 30 days" empty="No registrations in the last 30 days." />
            </Panel>
            <Panel title="From trial to paid" description="Every business that started a trial, and how many have paid">
              <p className="dcd-h px-2 text-[34px] leading-none tabular-nums text-slate-900">{m.conversionBps === null ? "—" : `${(m.conversionBps / 100).toFixed(1)}%`}<span className="ms-2 align-middle font-sans text-xs font-normal tracking-normal text-slate-500">converted</span></p>
              <div className="mt-4"><BarList max={Math.max(1, m.customers)} rows={[{ key: "registered", label: "Registered", value: m.customers }, { key: "trial", label: "Started a trial", value: m.everTrialed }, { key: "paid", label: "Made a verified payment", value: m.payingEver }, { key: "now", label: "Paying now", value: m.paidActive }]} /></div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
            <Panel title="Recent activity" description="Sign-ups and super admin actions" padded={false} actions={<Link href="/super-admin/audit-logs" className="text-xs font-semibold text-brand-700 hover:underline">Full audit log</Link>}>
              {data.activity.length === 0 ? <p className="p-6 text-sm text-slate-500">No activity recorded yet.</p> : (
                <ul className="divide-y divide-slate-100">
                  {data.activity.slice(0, 8).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                      <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.action.includes("failed") ? "bg-red-500" : a.action.startsWith("platform.") ? "bg-brand-500" : "bg-slate-300")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{actionLabel(a.action)}</p>
                        <p className="truncate text-xs text-slate-500">{a.organizationName && a.organizationId ? <Link href={`/super-admin/customers/view?id=${a.organizationId}`} className="hover:underline">{a.organizationName}</Link> : a.actorEmail ?? "System"}</p>
                      </div>
                      <time className="shrink-0 text-[11px] text-slate-400">{dateTimeLabel(a.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <div className="flex flex-col gap-3">
              <QuickLink href="/super-admin/payments" icon={Wallet} title="Record a verified payment" detail="Activate a plan after checking the receipt" />
              <QuickLink href="/super-admin/trials?window=expiring" icon={CalendarClock} title="Trials ending soon" detail="Follow up before shops lose access" />
              <QuickLink href="/super-admin/customers?sort=newest" icon={UserPlus} title="Newest registrations" detail="Welcome and onboard new businesses" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QuickLink({ href, icon: Icon, title, detail }: { href: string; icon: typeof Wallet; title: string; detail: string }) {
  return (
    <Link href={href} className="dc-card-lift group flex items-center gap-3 rounded-[20px] border border-slate-200 bg-white p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon aria-hidden="true" className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block truncate text-xs text-slate-500">{detail}</span></span>
      <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
    </Link>
  );
}
