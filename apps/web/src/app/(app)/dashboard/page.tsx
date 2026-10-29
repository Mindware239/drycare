"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight, Building2, CalendarDays, CircleAlert, CircleCheck, ClipboardList, Coins, Database, Factory, FileText, MapPin, PackageCheck, Plus, Receipt,
  ScanLine, Shirt, Sparkles, Store, Truck, TrendingDown, TrendingUp, UserRound, Users, Wallet, WashingMachine, type LucideIcon,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, dateTime, money, todayISO } from "@/lib/format";
import { Alert, Badge, Card, Input, OrderStatusBadge, Spinner, cx } from "@/components/ui";
import { DailyChart } from "@/components/DailyChart";

const presets = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 6 },
  { label: "Last 30 days", days: 29 },
  { label: "Last 90 days", days: 89 },
];

type Daily = { day: string; billed: number; collected: number; expenses: number; laundry: number };
type DashboardData = {
  definitions: Record<string, string>;
  financialVisible: boolean;
  sales: { grossBilled: number; netSales: number; invoices: number; tax: number; discounts: number } | null;
  collections: { net: number; refunded: number; collected: number } | null;
  receivables: { outstanding: number; openInvoices: number } | null;
  expenses: number | null;
  operations: { orders_received: number; orders_completed: number; ready_orders: number; overdue_orders: number; awaiting_processing: number; ready_garments: number; exceptions: number; reworkRate: number; inspections: number };
  daily: Daily[];
  branches: { id: string; name: string; branch_code: string; orders: number; billed: number; collected: number; laundry: number; outstanding: number }[];
  previous: { from: string; to: string; grossBilled?: number; collections?: number; expenses?: number; orders: number };
  laundry: { billed: number; orders: number } | null;
  garmentStatus: { status: string; count: number }[];
  counters: { branchId: string; branchName: string; userId: string; staffName: string; payments: number; total: number; cash: number; upi: number; card: number; other: number }[];
  paymentMethods: { method: string; total: number; count: number }[];
};
type DashboardOrder = {
  id: string; order_number: string; operational_status: string; received_at: string; promised_at: string; grand_total: number | string; currency: string;
  express: boolean; customer_name: string; customer_phone: string; branch_code: string; garment_count: number;
};

/** Live garments grouped the way a shop talks about them. */
const STATUS_GROUPS = [
  { label: "Received", color: "#0d8573", statuses: ["received"] },
  { label: "In production", color: "#2563eb", statuses: ["inspection", "sorting", "cleaning", "drying", "finishing", "packing"] },
  { label: "Quality check", color: "#8b5cf6", statuses: ["quality_control", "rework"] },
  { label: "Ready for delivery", color: "#f97316", statuses: ["ready", "dispatched"] },
  { label: "Delivered", color: "#84cc16", statuses: ["delivered"] },
  { label: "Exceptions", color: "#ef4444", statuses: ["exception"] },
];
const METHOD_LABELS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", wallet: "Wallet", cheque: "Cheque" };

function change(current: number, previous: number | undefined) {
  if (previous === undefined) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 24}`);
  const id = `sp-${color.replace("#", "")}`;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-9 w-24" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,30 ${pts.join(" ")} 100,30`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Kpi({ label, value, note, icon: Icon, tone, delta, goodWhenUp = true, spark, href }: {
  label: string; value: string; note: string; icon: LucideIcon; tone: "teal" | "blue" | "amber" | "violet" | "rose"; delta: number | null; goodWhenUp?: boolean; spark?: number[]; href?: string;
}) {
  const tones = {
    teal: { bg: "bg-brand-50 text-brand-700", line: "#0d8573" },
    blue: { bg: "bg-blue-50 text-blue-700", line: "#2563eb" },
    amber: { bg: "bg-amber-50 text-amber-700", line: "#f97316" },
    violet: { bg: "bg-violet-50 text-violet-700", line: "#8b5cf6" },
    rose: { bg: "bg-rose-50 text-rose-700", line: "#e11d48" },
  }[tone];
  const good = delta !== null && delta !== 0 && (delta > 0) === goodWhenUp;
  const body = (
    <div className="flex h-full items-start gap-4">
      <span className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", tones.bg)}><Icon className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-slate-600">{label}</p>
          {delta !== null && (
            <span className={cx("inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", delta === 0 ? "bg-slate-100 text-slate-500" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")} title="Compared with the previous period of the same length">
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}{delta > 0 ? "+" : ""}{delta}%
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <p className="truncate text-[1.6rem] font-bold leading-tight tracking-tight text-slate-950 tabular-nums">{value}</p>
          {spark && <Sparkline values={spark} color={tones.line} />}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
      </div>
    </div>
  );
  const cls = "block rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition";
  return href ? <Link href={href} className={cx(cls, "hover:-translate-y-0.5 hover:shadow-md")}>{body}</Link> : <div className={cls}>{body}</div>;
}

const QUICK_TONES = {
  teal: { card: "border-brand-100 from-brand-50", icon: "bg-brand-700 shadow-brand-900/20", arrow: "text-brand-700" },
  blue: { card: "border-blue-100 from-blue-50", icon: "bg-blue-600 shadow-blue-900/20", arrow: "text-blue-700" },
  violet: { card: "border-violet-100 from-violet-50", icon: "bg-violet-600 shadow-violet-900/20", arrow: "text-violet-700" },
  amber: { card: "border-amber-100 from-amber-50", icon: "bg-amber-500 shadow-amber-900/20", arrow: "text-amber-700" },
  cyan: { card: "border-cyan-100 from-cyan-50", icon: "bg-cyan-600 shadow-cyan-900/20", arrow: "text-cyan-700" },
  emerald: { card: "border-emerald-100 from-emerald-50", icon: "bg-emerald-600 shadow-emerald-900/20", arrow: "text-emerald-700" },
};

function QuickTile({ href, icon: Icon, title, text, tone }: { href: string; icon: LucideIcon; title: string; text: string; tone: keyof typeof QUICK_TONES }) {
  const t = QUICK_TONES[tone];
  return (
    <Link href={href} className={cx("group flex flex-col rounded-2xl border bg-gradient-to-br to-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", t.card)}>
      <span className="flex items-start justify-between">
        <span className={cx("grid h-11 w-11 place-items-center rounded-xl text-white shadow-sm", t.icon)}><Icon className="h-5 w-5" /></span>
        <ArrowRight className={cx("h-4 w-4 transition group-hover:translate-x-0.5", t.arrow)} />
      </span>
      <span className="mt-3 text-sm font-semibold text-slate-900">{title}</span>
      <span className="text-xs text-slate-500">{text}</span>
    </Link>
  );
}

function SectionTitle({ icon: Icon, title, subtitle, tone = "bg-brand-50 text-brand-700" }: { icon: LucideIcon; title: string; subtitle?: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cx("grid h-10 w-10 place-items-center rounded-xl", tone)}><Icon className="h-5 w-5" /></span>
      <div><h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>{subtitle && <p className="mt-0.5 text-xs font-normal text-slate-500">{subtitle}</p>}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { session, branchId, branch, can } = useSession();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState("Today");
  const [allBranches, setAllBranches] = useState(true);
  const branchQuery: Record<string, string> = !allBranches && branchId ? { branchId } : {};
  const qs = new URLSearchParams({ from, to, ...branchQuery });
  const { data, error, loading } = useApi<DashboardData>(`/dashboard?${qs}`);
  const recentOrders = useApi<{ items: DashboardOrder[] }>(can("orders.read") ? `/orders?${new URLSearchParams({ limit: "6", offset: "0", ...branchQuery })}` : null);
  const overdueOrders = useApi<{ items: DashboardOrder[] }>(can("orders.read") ? `/orders?view=overdue&limit=5&offset=0${!allBranches && branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}` : null);
  const readyOrders = useApi<{ items: DashboardOrder[] }>(can("orders.read") ? `/orders?view=ready&limit=5&offset=0${!allBranches && branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}` : null);

  const setPreset = (label: string, days: number) => {
    const t = todayISO();
    setPeriod(label);
    setTo(t);
    setFrom(new Date(new Date(t).getTime() - days * 86400_000).toISOString().slice(0, 10));
  };
  const firstName = session.user.name.trim().split(/\s+/)[0] || "there";
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  const scopeLabel = allBranches ? (session.branches.length > 1 ? `All ${session.branches.length} branches` : session.branches[0]?.name ?? "Your store") : branch?.name ?? "Selected branch";
  const periodLabel = from === to ? dateOnly(from) : `${dateOnly(from)} – ${dateOnly(to)}`;

  const heroActions = [
    can("orders.create") && { href: "/pos", icon: Plus, label: "New order", tone: "from-brand-600 to-brand-800 shadow-brand-900/25" },
    can("garments.process") && { href: "/scan", icon: ScanLine, label: "Scan garments", tone: "from-blue-500 to-blue-700 shadow-blue-900/25" },
    can("orders.read") && { href: "/production", icon: Factory, label: "Production board", tone: "from-violet-500 to-violet-700 shadow-violet-900/25" },
    can("customers.read") && { href: "/customers", icon: Users, label: "Find a customer", tone: "from-cyan-500 to-cyan-700 shadow-cyan-900/25" },
  ].filter(Boolean) as { href: string; icon: LucideIcon; label: string; tone: string }[];

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="dc-hero relative min-h-[176px] overflow-hidden rounded-3xl bg-gradient-to-r from-[#d9f2ee] via-[#cdeee8] to-[#bfe6df]">
          <div className="dc-hero-img absolute inset-y-0 right-0 hidden w-[58%] bg-cover bg-center sm:block" style={{ backgroundImage: "url(/images/dashboard-hero.jpg)" }} aria-hidden="true" />
          <div className="dc-hero-fade absolute inset-y-0 left-0 hidden w-[62%] bg-gradient-to-r from-[#d9f2ee] via-[#d4f0eb] to-transparent sm:block" aria-hidden="true" />
          <div className="relative p-6 sm:p-7">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-brand-800"><Sparkles className="h-4 w-4" />Store overview</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{greeting}, {firstName} <span aria-hidden="true">👋</span></h1>
            <p className="mt-1.5 text-sm text-slate-600">Here&apos;s what&apos;s happening at your store.</p>
            <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm font-medium text-slate-700">
              <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4" />{scopeLabel}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{today}</span>
            </p>
          </div>
        </div>
        {heroActions.length > 0 && (
          <div className="grid grid-cols-2 gap-3 rounded-3xl border border-slate-200/80 bg-white p-3 shadow-sm sm:grid-cols-4 xl:grid-cols-2">
            {heroActions.map((a) => (
              <Link key={a.href} href={a.href} className={cx("group flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-br px-3 py-4 text-center text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg", a.tone)}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30 transition group-hover:bg-white/30"><a.icon className="h-6 w-6" /></span>{a.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Period + scope */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CalendarDays className="h-4 w-4" />Period</span>
          <div className="flex flex-wrap rounded-xl bg-slate-100 p-1">
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={() => setPreset(p.label, p.days)} aria-pressed={period === p.label}
                className={cx("rounded-lg px-3 py-1.5 text-xs font-medium transition", period === p.label ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{p.label}</button>
            ))}
          </div>
          <Input type="date" value={from} max={to} onChange={(e) => { setPeriod("custom"); setFrom(e.target.value); }} className="w-auto border-0 bg-slate-50 px-2.5 py-1.5 text-xs shadow-none" aria-label="From date" />
          <span className="text-slate-400">–</span>
          <Input type="date" value={to} min={from} onChange={(e) => { setPeriod("custom"); setTo(e.target.value); }} className="w-auto border-0 bg-slate-50 px-2.5 py-1.5 text-xs shadow-none" aria-label="To date" />
        </div>
        {session.branches.length > 1 && (
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
            <button type="button" onClick={() => setAllBranches(true)} className={cx("rounded-lg px-3 py-1.5", allBranches ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>All branches</button>
            <button type="button" onClick={() => setAllBranches(false)} className={cx("rounded-lg px-3 py-1.5", !allBranches ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{branch?.name ?? "This branch"}</button>
          </div>
        )}
      </section>

      {error && <Alert>{error.message}</Alert>}
      {loading && !data ? <Spinner /> : data ? (
        <>
          {/* KPIs */}
          {data.financialVisible && data.sales && data.collections && data.receivables ? (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Gross billed" value={money(data.sales.grossBilled)} note={`${data.sales.invoices} invoice${data.sales.invoices === 1 ? "" : "s"} · ${money(data.sales.netSales)} net of GST`} icon={Receipt} tone="teal"
                delta={change(data.sales.grossBilled, data.previous.grossBilled)} spark={data.daily.map((d) => d.billed)} href={can("reports.financial") ? "/reports" : undefined} />
              <Kpi label="Net collections" value={money(data.collections.net)} note={`Received less ${money(data.collections.refunded)} in refunds`} icon={Wallet} tone="blue"
                delta={change(data.collections.net, data.previous.collections)} spark={data.daily.map((d) => d.collected)} href={can("payments.collect") ? "/cashier" : undefined} />
              <Kpi label="Outstanding dues" value={money(data.receivables.outstanding)} note={`${data.receivables.openInvoices} open invoice${data.receivables.openInvoices === 1 ? "" : "s"} · as of now`} icon={Coins} tone="amber"
                delta={null} href={can("orders.read") ? "/orders?view=unpaid" : undefined} />
              <Kpi label="Expenses" value={money(data.expenses)} note="Recorded during the selected period" icon={Database} tone="violet" goodWhenUp={false}
                delta={change(data.expenses ?? 0, data.previous.expenses)} spark={data.daily.map((d) => d.expenses)} href={can("expenses.manage") ? "/expenses" : undefined} />
            </section>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Orders received" value={String(data.operations.orders_received)} note="During the selected period" icon={ClipboardList} tone="blue" delta={change(data.operations.orders_received, data.previous.orders)} href={can("orders.read") ? "/orders" : undefined} />
              <Kpi label="In production" value={String(data.operations.awaiting_processing)} note="Garments moving through care" icon={Factory} tone="violet" delta={null} href={can("orders.read") ? "/production" : undefined} />
              <Kpi label="Ready to collect" value={String(data.operations.ready_orders)} note={`${data.operations.ready_garments} garments on racks`} icon={PackageCheck} tone="teal" delta={null} href={can("orders.read") ? "/orders?view=ready" : undefined} />
              <Kpi label="Overdue orders" value={String(data.operations.overdue_orders)} note={`${data.operations.exceptions} garment exceptions`} icon={CircleAlert} tone="rose" delta={null} href={can("orders.read") ? "/orders?view=overdue" : undefined} />
            </section>
          )}

          {/* Chart + quick access */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] [&>*]:min-w-0">
            {data.financialVisible ? (
              <Card title={<SectionTitle icon={Coins} title="Revenue & collections" subtitle={`Daily billed amount compared with payments received · ${periodLabel}`} />}>
                {data.daily.some((d) => d.billed || d.collected) ? <DailyChart data={data.daily} /> : <p className="py-14 text-center text-sm text-slate-500">No sales or payments in this period yet.</p>}
              </Card>
            ) : (
              <Card title={<SectionTitle icon={ClipboardList} title="Operations" subtitle="Live workload across your store" />}>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {[["Orders received", data.operations.orders_received], ["Completed", data.operations.orders_completed], ["Ready orders", data.operations.ready_orders], ["Overdue", data.operations.overdue_orders], ["Exceptions", data.operations.exceptions], ["Quality rework", `${(data.operations.reworkRate * 100).toFixed(1)}%`]].map(([k, v]) => (
                    <div key={k as string} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">{v}</dd></div>
                  ))}
                </dl>
              </Card>
            )}
            <Card title={<div><h2 className="text-[15px] font-semibold text-slate-900">Quick access</h2><p className="mt-0.5 text-xs font-normal text-slate-500">The tools your team uses most</p></div>}>
              <div className="grid grid-cols-2 gap-3">
                {can("orders.create") && <QuickTile href="/pos" icon={FileText} title="Create an order" text="Start a customer drop-off" tone="teal" />}
                {can("garments.process") && <QuickTile href="/scan" icon={ScanLine} title="Scan a garment" text="Move items to production" tone="blue" />}
                {can("deliveries.manage") && <QuickTile href="/deliveries" icon={Truck} title="Schedule a stop" text="Arrange pickup or delivery" tone="amber" />}
                {can("customers.read") && <QuickTile href="/customers" icon={Users} title="Find a customer" text="View customer profiles" tone="violet" />}
                {can("laundry.operate") && <QuickTile href="/laundry/new" icon={WashingMachine} title="Self-service order" text="Wash, dry & iron" tone="cyan" />}
                {can("payments.collect") && <QuickTile href="/cashier" icon={Wallet} title="Cashier & shift" text="Count the drawer" tone="emerald" />}
              </div>
            </Card>
          </section>

          {/* Branch + counter-wise sales (owners, managers and accounts) */}
          {data.financialVisible && (
            <section className="grid gap-4 min-[1700px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] [&>*]:min-w-0">
              <Card padded={false} title={<SectionTitle icon={Building2} title="Sales by branch" subtitle={`Dry cleaning, self-service laundry and collections · ${periodLabel}`} tone="bg-blue-50 text-blue-700" />}>
                <BranchTable data={data} />
              </Card>
              <Card padded={false} title={<SectionTitle icon={UserRound} title="Counter-wise takings" subtitle="Money collected by each counter / cashier, by payment method" tone="bg-emerald-50 text-emerald-700" />}
                actions={can("payments.collect") ? <Link href="/cashier" className="text-xs font-semibold text-brand-700 hover:underline">Cashier & shifts</Link> : undefined}>
                <CounterTable data={data} />
              </Card>
            </section>
          )}

          {/* Recent orders + garment status */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] [&>*]:min-w-0">
            {can("orders.read") && (
              <Card padded={false} title={<div><h2 className="text-[15px] font-semibold text-slate-900">Recent orders</h2><p className="mt-0.5 text-xs font-normal text-slate-500">Latest customer drop-offs across the selected branch scope</p></div>}
                actions={<Link className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800" href="/orders">All orders <ArrowRight className="h-3.5 w-3.5" /></Link>}>
                {recentOrders.error ? <div className="p-4"><Alert>{recentOrders.error.message}</Alert></div>
                  : recentOrders.loading && !recentOrders.data ? <div className="p-6"><Spinner /></div>
                  : recentOrders.data?.items.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <tr><th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Received</th><th className="px-4 py-3 text-center">Items</th><th className="px-4 py-3">Status</th>{data.financialVisible && <th className="px-4 py-3 text-right">Total</th>}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {recentOrders.data.items.map((o) => (
                            <tr key={o.id} className="hover:bg-slate-50/70">
                              <td className="whitespace-nowrap px-4 py-3"><Link href={`/orders/view?id=${o.id}`} className="font-semibold text-brand-700 hover:text-brand-800">{o.order_number}</Link>{o.express && <Badge color="amber" className="ml-2">Express</Badge>}</td>
                              <td className="px-4 py-3"><span className="block font-medium text-slate-800">{o.customer_name}</span><span className="text-xs text-slate-500">{o.customer_phone}{allBranches && session.branches.length > 1 && <> · {o.branch_code}</>}</span></td>
                              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{dateTime(o.received_at)}</td>
                              <td className="px-4 py-3 text-center tabular-nums text-slate-600">{o.garment_count}</td>
                              <td className="px-4 py-3"><OrderStatusBadge status={o.operational_status} /></td>
                              {data.financialVisible && <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{money(o.grand_total, o.currency)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center">
                      <Shirt className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-sm font-medium text-slate-700">No orders yet</p>
                      {can("orders.create") && <Link href="/pos" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Create your first order <ArrowRight className="h-3.5 w-3.5" /></Link>}
                    </div>
                  )}
              </Card>
            )}
            <Card title={<div><h2 className="text-[15px] font-semibold text-slate-900">Garment status</h2><p className="mt-0.5 text-xs font-normal text-slate-500">Garments in the shop now · delivered in this period</p></div>}
              actions={can("orders.read") ? <Link href="/production" className="text-xs font-semibold text-brand-700 hover:underline">Production board</Link> : undefined}>
              <GarmentStatus rows={data.garmentStatus} />
            </Card>
          </section>

          {/* Order desk */}
          {can("orders.read") && (
            <section className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
              <OrderList title="Ready for collection" icon={PackageCheck} tone="bg-brand-50 text-brand-700" subtitle={`${data.operations.ready_orders} order(s) waiting for handoff`} href="/orders?view=ready" q={readyOrders} financial={data.financialVisible}
                empty={<><CircleCheck className="mx-auto h-7 w-7 text-brand-600" /><p className="mt-2 text-sm font-medium text-slate-700">No handoffs waiting</p></>} showBranch={allBranches && session.branches.length > 1} />
              <OrderList title="Overdue orders" icon={CircleAlert} tone="bg-red-50 text-red-700" subtitle={`${data.operations.overdue_orders} order(s) past their promised date`} href="/orders?view=overdue" q={overdueOrders} financial={false} overdue
                empty={<><CircleCheck className="mx-auto h-7 w-7 text-emerald-500" /><p className="mt-2 text-sm font-medium text-slate-700">All caught up</p></>} showBranch={allBranches && session.branches.length > 1} />
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

function BranchTable({ data }: { data: DashboardData }) {
  const rows = data.branches;
  const totalSales = rows.reduce((s, b) => s + b.billed + b.laundry, 0);
  if (!rows.length) return <p className="px-5 py-8 text-sm text-slate-500">No branch activity.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">Branch</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Dry cleaning</th><th className="px-4 py-3 text-right">Self-service</th><th className="px-4 py-3 text-right">Collected</th><th className="px-4 py-3 text-right">Dues</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((b) => {
            const share = totalSales ? ((b.billed + b.laundry) / totalSales) * 100 : 0;
            return (
              <tr key={b.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 font-medium text-slate-800"><MapPin className="h-3.5 w-3.5 text-slate-400" />{b.name}</span>
                  {rows.length > 1 && <span className="mt-1.5 block h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-600" style={{ width: `${share}%` }} /></span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{b.orders}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{money(b.billed)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{money(b.laundry)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money(b.collected)}</td>
                <td className={cx("px-4 py-3 text-right tabular-nums", b.outstanding > 0 ? "text-amber-700" : "text-slate-400")}>{money(b.outstanding)}</td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 1 && (
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-semibold">
            <tr>
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">{rows.reduce((s, b) => s + b.orders, 0)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(rows.reduce((s, b) => s + b.billed, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(rows.reduce((s, b) => s + b.laundry, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(rows.reduce((s, b) => s + b.collected, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(rows.reduce((s, b) => s + b.outstanding, 0))}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function CounterTable({ data }: { data: DashboardData }) {
  const total = data.paymentMethods.reduce((s, m) => s + m.total, 0);
  return (
    <div>
      {data.paymentMethods.length > 0 && (
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {data.paymentMethods.map((m, i) => <span key={m.method} style={{ width: `${(m.total / total) * 100}%`, background: ["#0d8573", "#2563eb", "#f97316", "#8b5cf6", "#64748b"][i % 5] }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {data.paymentMethods.map((m, i) => (
              <span key={m.method} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: ["#0d8573", "#2563eb", "#f97316", "#8b5cf6", "#64748b"][i % 5] }} />{METHOD_LABELS[m.method] ?? m.method} <strong className="tabular-nums text-slate-900">{money(m.total)}</strong></span>
            ))}
          </div>
        </div>
      )}
      {!data.counters.length ? <p className="px-5 py-8 text-sm text-slate-500">No payments collected in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Counter / cashier</th><th className="px-4 py-3 text-right">Cash</th><th className="px-4 py-3 text-right">UPI</th><th className="px-4 py-3 text-right">Card / other</th><th className="px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.counters.map((c) => (
                <tr key={`${c.branchId}-${c.userId}`} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><span className="block font-medium text-slate-800">{c.staffName}</span><span className="text-xs text-slate-500">{c.branchName} · {c.payments} payment{c.payments === 1 ? "" : "s"}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(c.cash)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(c.upi)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(c.card + c.other)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GarmentStatus({ rows }: { rows: { status: string; count: number }[] }) {
  const groups = STATUS_GROUPS.map((g) => ({ ...g, count: rows.filter((r) => g.statuses.includes(r.status)).reduce((s, r) => s + r.count, 0) }));
  const total = groups.reduce((s, g) => s + g.count, 0);
  if (!total) return <p className="py-8 text-center text-sm text-slate-500">No garments in the shop right now.</p>;
  return (
    <ul className="space-y-3.5">
      {groups.map((g) => {
        const pct = total ? Math.round((g.count / total) * 100) : 0;
        return (
          <li key={g.label} className="grid grid-cols-[minmax(130px,1.3fr)_36px_40px_minmax(60px,1fr)] items-center gap-3 text-sm">
            <span className="flex items-center gap-2 truncate text-slate-700"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />{g.label}</span>
            <span className="text-right font-semibold tabular-nums text-slate-900">{g.count}</span>
            <span className="text-right text-xs tabular-nums text-slate-500">{pct}%</span>
            <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: g.color }} /></span>
          </li>
        );
      })}
    </ul>
  );
}

function OrderList({ title, subtitle, icon, tone, href, q, financial, overdue, empty, showBranch }: {
  title: string; subtitle: string; icon: LucideIcon; tone: string; href: string; q: ReturnType<typeof useApi<{ items: DashboardOrder[] }>>; financial: boolean; overdue?: boolean; empty: ReactNode; showBranch: boolean;
}) {
  return (
    <Card padded={false} title={<SectionTitle icon={icon} title={title} subtitle={subtitle} tone={tone} />} actions={<Link className="text-xs font-semibold text-brand-700 hover:text-brand-800" href={href}>View all</Link>}>
      {q.error ? <div className="p-4"><Alert>{q.error.message}</Alert></div> : q.loading && !q.data ? <div className="p-6"><Spinner /></div> : q.data?.items.length ? (
        <ul className="divide-y divide-slate-100">
          {q.data.items.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/view?id=${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-800">{o.order_number}</span>{o.express && <Badge color="amber">Express</Badge>}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{o.customer_name}{showBranch && ` · ${o.branch_code}`}{overdue && ` · promised ${dateOnly(o.promised_at)}`}</span>
                </span>
                <span className="shrink-0 text-right">
                  {financial && <span className="block text-sm font-semibold tabular-nums text-slate-800">{money(o.grand_total, o.currency)}</span>}
                  <span className={cx("text-xs", overdue ? "rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-700" : "text-slate-500")}>{o.garment_count} item{o.garment_count === 1 ? "" : "s"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <div className="px-4 py-9 text-center">{empty}</div>}
    </Card>
  );
}
