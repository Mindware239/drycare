"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, ChartColumn, Download, FileSpreadsheet, IndianRupee, Printer, Search, Shirt, UserRound, Users, type LucideIcon } from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, dateTime, money, todayISO } from "@/lib/format";
import { Alert, Button, Input, PageHeader, Spinner, cx } from "@/components/ui";

type Col = { key: string; label: string; type: "text" | "money" | "int" | "date" | "datetime" | "pct"; total?: boolean };
type Entry = { key: string; group: string; title: string; description: string; columns: Col[]; usesDates: boolean };
type Result = { key: string; title: string; description: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, number> | null; range: { from: string; to: string } };

const GROUP_ICONS: Record<string, LucideIcon> = { Sales: ChartColumn, Money: IndianRupee, Customers: Users, Operations: Shirt, Staff: UserRound };
const PRESETS = [{ label: "Today", days: 0 }, { label: "7 days", days: 6 }, { label: "30 days", days: 29 }, { label: "This month", days: -1 }, { label: "90 days", days: 89 }];

function cell(v: unknown, type: Col["type"]) {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "money") return money(Number(v));
  if (type === "int") return Number(v).toLocaleString("en-IN");
  if (type === "date") return dateOnly(String(v));
  if (type === "datetime") return dateTime(String(v));
  if (type === "pct") return `${(Number(v) * 100).toFixed(1)}%`;
  return String(v);
}

function exportCsv(result: Result) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const head = result.columns.map((c) => esc(c.label)).join(",");
  const body = result.rows.map((r) => result.columns.map((c) => esc(c.type === "money" ? (Number(r[c.key] ?? 0) / 100).toFixed(2) : r[c.key])).join(","));
  const total = result.totals ? [result.columns.map((c, i) => esc(i === 0 ? "Total" : c.key in result.totals! ? (c.type === "money" ? (result.totals![c.key] / 100).toFixed(2) : result.totals![c.key]) : "")).join(",")] : [];
  const url = URL.createObjectURL(new Blob(["﻿", [head, ...body, ...total].join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${result.key}-${result.range.from}-to-${result.range.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { session, branchId } = useSession();
  const catalogue = useApi<Entry[]>("/reports/catalogue");
  const [active, setActive] = useState<string>("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState("Today");
  const [scope, setScope] = useState<"all" | "branch">("all");
  const [days, setDays] = useState(60);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (!active && catalogue.data?.length) setActive(new URLSearchParams(window.location.search).get("r") ?? catalogue.data[0].key);
  }, [catalogue.data, active]);
  const entry = catalogue.data?.find((r) => r.key === active);
  const qs = new URLSearchParams({ from, to, ...(scope === "branch" && branchId ? { branchId } : {}), ...(active === "inactive-customers" ? { days: String(days) } : {}) });
  const report = useApi<Result>(active ? `/reports/run/${active}?${qs}` : null);
  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const r of catalogue.data ?? []) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m.entries()];
  }, [catalogue.data]);
  const rows = (report.data?.rows ?? []).filter((r) => !filter || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(filter.toLowerCase())));

  const applyPreset = (label: string, d: number) => {
    const t = todayISO();
    setPreset(label);
    setTo(t);
    setFrom(d === -1 ? `${t.slice(0, 8)}01` : new Date(new Date(t).getTime() - d * 86_400_000).toISOString().slice(0, 10));
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Ready-made reports for sales, money, customers, operations and staff. Export any report to Excel (CSV) or print it." />
      {catalogue.error && <Alert>{catalogue.error.message}</Alert>}
      {!catalogue.data ? <Spinner /> : !catalogue.data.length ? <Alert tone="amber">Your role has no reports. Ask the store owner for access.</Alert> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Reports" className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm print:hidden lg:sticky lg:top-20">
            {groups.map(([group, items]) => {
              const Icon = GROUP_ICONS[group] ?? BarChart3;
              return (
                <div key={group} className="mb-2 last:mb-0">
                  <p className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400"><Icon className="h-3.5 w-3.5" />{group}</p>
                  {items.map((r) => (
                    <button key={r.key} type="button" onClick={() => { setActive(r.key); setFilter(""); }}
                      className={cx("block w-full rounded-lg px-3 py-2 text-left text-sm transition", active === r.key ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>{r.title}</button>
                  ))}
                </div>
              );
            })}
          </nav>

          <section className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm print:hidden">
              {entry?.usesDates !== false && (
                <>
                  <div className="flex flex-wrap rounded-xl bg-slate-100 p-1">
                    {PRESETS.map((p) => <button key={p.label} type="button" onClick={() => applyPreset(p.label, p.days)} className={cx("rounded-lg px-3 py-1.5 text-xs font-medium", preset === p.label ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{p.label}</button>)}
                  </div>
                  <Input type="date" value={from} max={to} onChange={(e) => { setPreset(""); setFrom(e.target.value); }} className="w-auto py-1.5 text-xs" aria-label="From date" />
                  <span className="text-slate-400">–</span>
                  <Input type="date" value={to} min={from} onChange={(e) => { setPreset(""); setTo(e.target.value); }} className="w-auto py-1.5 text-xs" aria-label="To date" />
                </>
              )}
              {active === "inactive-customers" && (
                <label className="flex items-center gap-2 text-xs text-slate-600">Away for at least
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 rounded-md border border-slate-200 px-2 text-xs">{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
                </label>
              )}
              {session.branches.length > 1 && (
                <div className="ml-auto flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
                  <button type="button" onClick={() => setScope("all")} className={cx("rounded-lg px-3 py-1.5", scope === "all" ? "bg-white shadow-sm" : "text-slate-500")}>All branches</button>
                  <button type="button" onClick={() => setScope("branch")} className={cx("inline-flex items-center gap-1 rounded-lg px-3 py-1.5", scope === "branch" ? "bg-white shadow-sm" : "text-slate-500")}><Building2 className="h-3.5 w-3.5" />Current branch</button>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileSpreadsheet className="h-5 w-5 text-brand-700 print:hidden" />{entry?.title ?? "Report"}</h2>
                  <p className="mt-0.5 text-sm text-slate-500">{entry?.description}{entry?.usesDates && report.data && <> · {report.data.range.from === report.data.range.to ? dateOnly(report.data.range.from) : `${dateOnly(report.data.range.from)} – ${dateOnly(report.data.range.to)}`}</>}</p>
                </div>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter rows" className="w-44 py-1.5 pl-8 text-sm" aria-label="Filter rows" />
                  </label>
                  <Button size="sm" variant="secondary" disabled={!report.data?.rows.length} onClick={() => report.data && exportCsv(report.data)}><Download className="h-4 w-4" />Excel (CSV)</Button>
                  <Button size="sm" variant="secondary" disabled={!report.data} onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
                </div>
              </div>
              {report.error ? <div className="p-5"><Alert>{report.error.message}</Alert></div> : !report.data || report.loading && report.data.key !== active ? <div className="p-8"><Spinner /></div> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <tr>{report.data.columns.map((c) => <th key={c.key} className={cx("whitespace-nowrap px-4 py-3", c.type === "money" || c.type === "int" || c.type === "pct" ? "text-right" : "text-left")}>{c.label}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50/70">
                          {report.data!.columns.map((c, j) => <td key={c.key} className={cx("px-4 py-2.5", c.type === "money" || c.type === "int" || c.type === "pct" ? "text-right tabular-nums" : "", j === 0 ? "font-medium text-slate-800" : "text-slate-600")}>{cell(r[c.key], c.type)}</td>)}
                        </tr>
                      ))}
                      {!rows.length && <tr><td colSpan={report.data.columns.length} className="px-4 py-12 text-center text-sm text-slate-500">{filter ? "No rows match the filter." : "Nothing to report for this period."}</td></tr>}
                    </tbody>
                    {report.data.totals && rows.length > 0 && !filter && (
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                        <tr>{report.data.columns.map((c, i) => <td key={c.key} className={cx("px-4 py-3", c.type === "money" || c.type === "int" ? "text-right tabular-nums" : "")}>{i === 0 ? "Total" : c.key in report.data!.totals! ? cell(report.data!.totals![c.key], c.type) : ""}</td>)}</tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
              {report.data && <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">{rows.length} row{rows.length === 1 ? "" : "s"} · {session.organization.name}{scope === "branch" ? " · current branch" : ""}</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
