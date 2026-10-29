"use client";
import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { LAUNDRY_MACHINE_LABELS, LAUNDRY_METHOD_LABELS, type LaundryMachineType, type LaundryPricingMethod } from "@drycare/shared";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, todayISO } from "@/lib/format";
import { Alert, Button, Card, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";

const ago = (d: number) => new Date(Date.now() + 5.5 * 3600_000 - d * 86_400_000).toISOString().slice(0, 10);

export default function LaundryReportsPage() {
  const { session, branchId } = useSession();
  const [from, setFrom] = useState(ago(29));
  const [to, setTo] = useState(todayISO());
  const [store, setStore] = useState(branchId);
  const r = useApi<any>(`/laundry/reports?from=${from}&to=${to}${store ? `&branchId=${store}` : ""}`);
  const d = r.data;

  function exportCsv() {
    if (!d) return;
    const rows = [["Section", "Item", "Orders / cycles", "Revenue (INR)", "Utilization %"]];
    for (const x of d.byService) rows.push(["Service", x.label, x.orders, (x.revenue / 100).toFixed(2), ""]);
    for (const x of d.byMethod) rows.push(["Pricing method", LAUNDRY_METHOD_LABELS[x.label as LaundryPricingMethod] ?? x.label, x.orders, (x.revenue / 100).toFixed(2), ""]);
    for (const x of d.byMachine) rows.push(["Machine", `${x.name} (${x.code})`, x.cycles, (Number(x.revenue) / 100).toFixed(2), x.utilizationPct]);
    for (const x of d.byBranch) rows.push(["Store", x.label, x.orders, (x.revenue / 100).toFixed(2), ""]);
    for (const x of d.daily) rows.push(["Day", x.day, x.orders, (x.revenue / 100).toFixed(2), ""]);
    const csv = rows.map((row) => row.map((v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `self-service-laundry-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const max = Math.max(1, ...(d?.daily ?? []).map((x: any) => Number(x.revenue)));
  return (
    <div className="space-y-5">
      <PageHeader title="Self-service laundry reports" subtitle="Sales, machine usage and maintenance for the wash, dry and ironing business."
        actions={<><Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button><Button variant="secondary" onClick={exportCsv} disabled={!d}><Download className="h-4 w-4" />Export CSV</Button></>} />
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          {[["Today", 0], ["7 days", 6], ["30 days", 29], ["90 days", 89]].map(([l, n]) => <Button key={l as string} size="sm" variant={from === ago(n as number) && to === todayISO() ? "primary" : "secondary"} onClick={() => { setFrom(ago(n as number)); setTo(todayISO()); }}>{l}</Button>)}
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" aria-label="From" />
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" aria-label="To" />
          <Select value={store} onChange={(e) => setStore(e.target.value)} className="h-8 w-auto text-xs" aria-label="Store">
            <option value="">All my stores</option>
            {session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      </Card>
      {r.error && <Alert>{r.error.message}</Alert>}
      {!d ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Orders" value={d.totals.orders} />
            <Kpi label="Completed" value={d.totals.completed} />
            <Kpi label="Cancelled" value={d.totals.cancelled} />
            <Kpi label="Sales" value={money(d.totals.billed)} hint={`GST ${money(d.totals.tax)}`} />
            <Kpi label="Collected" value={money(d.totals.collected - d.totals.refunded)} hint={d.totals.refunded ? `${money(d.totals.refunded)} refunded` : "net of refunds"} />
            <Kpi label="Outstanding" value={money(d.totals.outstanding)} tone={d.totals.outstanding ? "text-amber-700" : undefined} />
            <Kpi label="Laundry weight" value={`${(d.totals.grams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`} />
          </div>

          {d.openMaintenance.length > 0 && <Alert tone="amber">Maintenance open: {d.openMaintenance.map((m: any) => `${m.machine} — ${m.kind}`).join(" · ")}</Alert>}

          <Card title="Sales by day">
            {!d.daily.length ? <p className="text-sm text-slate-500">No sales in this period.</p> : (
              <div className="flex h-48 items-end gap-1.5 overflow-x-auto">
                {d.daily.map((x: any) => (
                  <div key={x.day} className="group flex h-full min-w-8 max-w-14 flex-1 flex-col items-center justify-end gap-1" title={`${x.day}: ${money(x.revenue)} · ${x.orders} orders`}>
                    <span className="text-[10px] font-semibold tabular-nums text-slate-600">{money(x.revenue).replace(/\.00$/, "")}</span>
                    <div className="w-full rounded-t bg-brand-500 group-hover:bg-brand-700" style={{ height: `${Math.max(3, (Number(x.revenue) / max) * 75)}%` }} />
                    <span className="text-[10px] text-slate-400">{x.day.slice(8)}/{x.day.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Breakdown title="By service" rows={d.byService} />
            <Breakdown title="By pricing method" rows={d.byMethod.map((x: any) => ({ ...x, label: LAUNDRY_METHOD_LABELS[x.label as LaundryPricingMethod] ?? x.label }))} />
            <Breakdown title="By store" rows={d.byBranch} />
          </div>

          <Card title="Machines" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2.5">Machine</th><th className="px-4 py-2.5 text-right">Cycles</th><th className="px-4 py-2.5 text-right">Avg cycle</th><th className="px-4 py-2.5 text-right">Failures</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5">Utilization</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {d.byMachine.map((m: any) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5"><span className="font-medium text-slate-900">{m.name}</span><span className="block text-xs text-slate-500">{LAUNDRY_MACHINE_LABELS[m.machineType as LaundryMachineType]} · {m.code} · {m.branchCode}</span></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.cycles}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.avgMinutes ? `${m.avgMinutes} min` : "—"}</td>
                      <td className={cx("px-4 py-2.5 text-right tabular-nums", m.failures && "text-red-600")}>{m.failures}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(m.revenue)}</td>
                      <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${m.utilizationPct}%` }} /></div><span className="text-xs tabular-nums text-slate-600">{m.utilizationPct}%</span></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Utilization = run time ÷ 12 opening hours per day. Revenue is counted on the first completed machine of each order.</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><p className={cx("mt-1 text-xl font-semibold tabular-nums text-slate-900", tone)}>{value}</p>{hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}</div>;
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; orders: number; revenue: number | string }[] }) {
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0) || 1;
  return (
    <Card title={title}>
      {!rows.length ? <p className="text-sm text-slate-500">No data.</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between text-sm"><span className="text-slate-700">{r.label} <span className="text-xs text-slate-400">· {r.orders}</span></span><span className="font-semibold tabular-nums">{money(r.revenue)}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((Number(r.revenue) / total) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
