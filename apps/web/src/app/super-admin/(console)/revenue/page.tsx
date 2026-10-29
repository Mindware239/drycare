"use client";
import { useState } from "react";
import { BadgeIndianRupee, ChartColumnBig, Info, Users, Wallet } from "lucide-react";
import { money } from "@/lib/format";
import { Alert, Button, Field, Input } from "@/components/ui";
import { ConsoleHeader, CsvButton, DataTable, EmptyState, LoadingRows, MetricCard, Panel, exportCsv, rupees, useAdminData } from "../admin-ui";

type Revenue = {
  from: string; to: string;
  totals: { collectedPaise: number | string; paidCount: number; payingCustomers: number };
  monthly: { month: string; collectedPaise: number | string; payments: number }[];
  byPlan: { plan: string; collectedPaise: number | string; payments: number }[];
  byChannel: { channel: string; collectedPaise: number | string; payments: number }[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const CHANNEL: Record<string, string> = { manual_upi: "UPI", manual_bank_transfer: "Bank transfer", manual_cash: "Cash / other" };

export default function RevenuePage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 364 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [applied, setApplied] = useState({ from, to });
  const { data, error, loading } = useAdminData<Revenue>(`/platform-admin/revenue?from=${applied.from}&to=${applied.to}`);
  const max = Math.max(1, ...(data?.monthly ?? []).map((m) => Number(m.collectedPaise)));
  const monthLabel = (m: string) => new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${m}-01T00:00:00`));

  return (
    <>
      <ConsoleHeader title="Revenue & reports" description="Cash actually collected from verified payments, by month, plan and payment channel. This is a cash-receipts view, not accounting revenue: annual plans are counted in the month they were paid." />
      <Panel className="mb-6">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); setApplied({ from, to }); }}>
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button type="submit" loading={loading && Boolean(data)}>Apply</Button>
          <div className="flex gap-2 sm:ml-auto">
            {[["30 days", 29], ["Quarter", 89], ["Year", 364]].map(([label, days]) => (
              <Button key={label} type="button" variant="secondary" size="sm" onClick={() => { const f = iso(new Date(Date.now() - Number(days) * 86_400_000)); const t = iso(new Date()); setFrom(f); setTo(t); setApplied({ from: f, to: t }); }}>{label}</Button>
            ))}
          </div>
        </form>
      </Panel>
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      {!data ? <Panel><LoadingRows /></Panel> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard icon={Wallet} label="Collected in period" value={money(data.totals.collectedPaise)} detail="Verified payments only" tone="emerald" />
            <MetricCard icon={BadgeIndianRupee} label="Payments" value={data.totals.paidCount.toLocaleString("en-IN")} detail="Verified receipts in period" />
            <MetricCard icon={Users} label="Paying businesses" value={data.totals.payingCustomers.toLocaleString("en-IN")} detail="Distinct businesses that paid" tone="blue" />
          </div>
          <Panel title="Collections by month" actions={<CsvButton disabled={!data.monthly.length} onClick={() => exportCsv(`drycare-revenue-${data.from}-to-${data.to}.csv`, data.monthly.map((m) => ({ Month: m.month, "Collected (INR)": rupees(m.collectedPaise), Payments: m.payments })))} />}>
            {!data.monthly.length ? <EmptyState icon={ChartColumnBig} title="No collections in this period">Recorded payments will build this chart month by month.</EmptyState> : (
              <div className="flex h-56 items-end gap-3 overflow-x-auto pb-1" role="img" aria-label="Monthly collections">
                {data.monthly.map((m) => (
                  <div key={m.month} className="flex h-full min-w-12 flex-1 flex-col items-center justify-end gap-1.5">
                    <span className="text-[11px] font-semibold tabular-nums text-slate-600">{money(m.collectedPaise).replace(".00", "")}</span>
                    <div className="w-full max-w-14 rounded-t-md bg-brand-500" style={{ height: `${Math.max(4, (Number(m.collectedPaise) / max) * 80)}%` }} />
                    <span className="text-[11px] text-slate-500">{monthLabel(m.month)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="By plan" padded={false}>
              <DataTable minWidth={360} head={["Plan", "Payments", "Collected"]} empty={!data.byPlan.length && <EmptyState icon={ChartColumnBig} title="No data" />}>
                {data.byPlan.map((r) => <tr key={r.plan}><td className="px-5 py-3 font-medium">{r.plan}</td><td className="px-5 py-3 tabular-nums">{r.payments}</td><td className="px-5 py-3 font-semibold tabular-nums">{money(r.collectedPaise)}</td></tr>)}
              </DataTable>
            </Panel>
            <Panel title="By payment channel" padded={false}>
              <DataTable minWidth={360} head={["Channel", "Payments", "Collected"]} empty={!data.byChannel.length && <EmptyState icon={ChartColumnBig} title="No data" />}>
                {data.byChannel.map((r) => <tr key={r.channel}><td className="px-5 py-3 font-medium">{CHANNEL[r.channel] ?? r.channel}</td><td className="px-5 py-3 tabular-nums">{r.payments}</td><td className="px-5 py-3 font-semibold tabular-nums">{money(r.collectedPaise)}</td></tr>)}
              </DataTable>
            </Panel>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Refunds, gateway fees, settlements and GST invoices are not tracked yet because no payment gateway is connected. Reconcile these figures with your bank statement and share them with your accountant for GST filing.</p>
          </div>
        </div>
      )}
    </>
  );
}
