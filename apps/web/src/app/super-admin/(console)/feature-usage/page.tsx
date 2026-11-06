"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Building2, Download, Layers, Search, Sparkles, TrendingDown, TrendingUp, X } from "lucide-react";
import { FEATURES, type FeatureKey } from "@drycare/shared";
import { Alert, Button, Input, cx } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, MetricCard, Panel, SegmentedTabs, dateLabel, exportCsv, useAdminData } from "../admin-ui";
import { BarList, DayChart } from "../charts";

type Row = { feature: string; uses: number; customers: number; recent: number; earlier: number };
type Data = { days: number; totalCustomers: number; activeCustomers: number; previousUses: number; trend: { day: string; value: number }[]; features: Row[]; byPlan: { plan: string; feature: string; uses: number; customers: number }[]; customers: { id: string; name: string; uses: number; lastDay: string }[] };
const nameOf = (key: string) => FEATURES[key as FeatureKey]?.label ?? key;
const count = (n: number) => n.toLocaleString("en-IN");
type Period = "7" | "30" | "90" | "365";

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-xs text-slate-500">{now ? "New" : "—"}</span>;
  const change = Math.round(((now - before) / before) * 100);
  const Icon = change >= 0 ? TrendingUp : TrendingDown;
  return <span className={cx("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", change >= 0 ? "text-emerald-700" : "text-red-700")}><Icon aria-hidden="true" className="h-3.5 w-3.5" />{change >= 0 ? "+" : ""}{change}%</span>;
}

export default function FeatureUsagePage() {
  const [days, setDays] = useState<Period>("30");
  const [picked, setPicked] = useState("");
  const [search, setSearch] = useState("");
  const { data, error, loading } = useAdminData<Data>(`/platform-admin/feature-usage?days=${days}${picked ? `&feature=${encodeURIComponent(picked)}` : ""}`);
  const features = useMemo(() => data?.features ?? [], [data]);
  const plans = useMemo(() => [...new Set(data?.byPlan.map((r) => r.plan))], [data]);
  const totalUses = features.reduce((n, f) => n + f.uses, 0);
  const allKeys = Object.keys(FEATURES);
  const unused = allKeys.filter((k) => !features.some((f) => f.feature === k));
  const adoption = (f: Row) => (data?.totalCustomers ? (f.customers / data.totalCustomers) * 100 : 0);
  const top = features.slice(0, 8);
  const byAdoption = [...features].sort((a, b) => b.customers - a.customers).slice(0, 8);
  const least = [...features].sort((a, b) => a.uses - b.uses).slice(0, 5);
  const rows = features.filter((f) => nameOf(f.feature).toLowerCase().includes(search.trim().toLowerCase()));
  const pickedUses = picked ? features.find((f) => f.feature === picked)?.uses ?? 0 : totalUses;

  return (
    <>
      <ConsoleHeader
        title="Feature usage"
        description="What shops really use, to guide plans and development. Only counts per shop and day are kept: no customer, order or staff details."
        actions={<Button variant="secondary" disabled={!features.length} onClick={() => exportCsv(`feature-usage-${days}-days.csv`, features.map((f) => ({ Feature: nameOf(f.feature), Uses: f.uses, "Active customers": f.customers, "Adoption %": Math.round(adoption(f)) })))}><Download className="h-4 w-4" />Export CSV</Button>}
      />
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SegmentedTabs<Period> value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "1 year" }]} />
        {picked && <button type="button" onClick={() => setPicked("")} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">{nameOf(picked)}<X aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only">Show all features</span></button>}
      </div>

      {!data ? <Panel><LoadingRows rows={8} /></Panel> : (
        <div className={cx("space-y-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Activity} label="Total uses" value={count(totalUses)} delta={<Change now={totalUses} before={data.previousUses} />} detail={`Compared with the ${days} days before`} />
            <MetricCard icon={Building2} label="Active shops" value={count(data.activeCustomers)} detail={`Out of ${count(data.totalCustomers)} current customers`} />
            <MetricCard icon={Layers} label="Features in use" value={`${features.length} of ${allKeys.length}`} detail={unused.length ? `${unused.length} not used in this period` : "Every feature was used"} />
            <MetricCard icon={Sparkles} label="Most used" value={<span className="text-[22px]">{features[0] ? nameOf(features[0].feature) : "—"}</span>} detail={features[0] && totalUses ? `${Math.round((features[0].uses / totalUses) * 100)}% of all uses` : "No usage yet"} />
          </div>

          <Panel title={picked ? `${nameOf(picked)} over time` : "Uses over time"} description={`${count(pickedUses)} uses in the last ${days} days`}>
            <DayChart points={data.trend} kind="line" height={260} unit="uses" label={picked ? `${nameOf(picked)} uses per day` : "Feature uses per day"} empty="No usage in this period. Counts appear as shops use the software." />
          </Panel>

          {!features.length ? <Panel><EmptyState icon={BarChart3} title="No usage yet">Counts appear as customers use the software.</EmptyState></Panel> : (
            <>
              <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
                <Panel title="Most used features" description="Select one to see its trend and its customers."><BarList rows={top.map((f) => ({ key: f.feature, label: nameOf(f.feature), value: f.uses }))} onPick={(k) => setPicked(picked === k ? "" : k)} picked={picked} /></Panel>
                <Panel title="Adoption" description="Share of current customers who used each feature in this period."><BarList max={100} rows={byAdoption.map((f) => ({ key: f.feature, label: nameOf(f.feature), value: adoption(f), display: `${Math.round(adoption(f))}%`, aside: <span className="text-xs text-slate-500">{f.customers === 1 ? "1 shop" : `${f.customers} shops`}</span> }))} /></Panel>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
                <Panel title="By plan" description="The most used features on each plan.">
                  <div className="grid gap-5 sm:grid-cols-2">
                    {plans.map((plan) => {
                      const planRows = data.byPlan.filter((r) => r.plan === plan);
                      return (
                        <div key={plan} className="min-w-0">
                          <p className="mb-1 flex items-baseline justify-between gap-2 px-2 text-sm font-semibold text-slate-900"><span className="truncate">{plan}</span><span className="text-xs font-normal tabular-nums text-slate-500">{`${count(planRows.reduce((n, r) => n + r.uses, 0))} uses`}</span></p>
                          <BarList rows={planRows.slice(0, 4).map((r) => ({ key: r.feature, label: nameOf(r.feature), value: r.uses }))} />
                        </div>
                      );
                    })}
                  </div>
                </Panel>
                <Panel title="Needs attention" description="Least used, and worth reviewing for plans or training.">
                  <ul className="divide-y divide-slate-100 text-sm">{least.map((f) => <li key={f.feature} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate text-slate-800">{nameOf(f.feature)}</span><span className="tabular-nums text-slate-500">{count(f.uses)}</span></li>)}</ul>
                  {!!unused.length && <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold text-slate-700">{`${unused.length} features not used in this period`}</summary><p className="mt-2 leading-5 text-slate-500">{unused.map(nameOf).join(", ")}.</p></details>}
                </Panel>
              </div>

              {picked && (
                <Panel title={`Customers using ${nameOf(picked)}`} padded={false}>
                  {!data.customers.length ? <EmptyState icon={BarChart3} title="Nobody in this period">Try a longer period.</EmptyState> : (
                    <DataTable minWidth={520} head={["Customer", "Uses", "Last used"]}>
                      {data.customers.map((c) => <tr key={c.id}><td className="px-5 py-3"><Link href={`/super-admin/customers/view?id=${c.id}`} className="font-medium text-slate-900 hover:underline">{c.name}</Link></td><td className="px-5 py-3 tabular-nums">{count(c.uses)}</td><td className="px-5 py-3 text-xs text-slate-600">{dateLabel(c.lastDay)}</td></tr>)}
                    </DataTable>
                  )}
                </Panel>
              )}

              <Panel title="All features" description="Trend compares the later half of the period with the earlier half." padded={false} actions={<label className="relative w-56 max-w-full"><Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" /><Input aria-label="Search features" placeholder="Search features" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" /></label>}>
                <DataTable minWidth={720} head={["Feature", "Uses", "Shops", "Adoption", "Trend", ""]}>
                  {rows.map((f) => (
                    <tr key={f.feature}>
                      <td className="px-5 py-3 font-medium text-slate-900">{nameOf(f.feature)}</td>
                      <td className="px-5 py-3 tabular-nums">{count(f.uses)}</td>
                      <td className="px-5 py-3 tabular-nums">{f.customers}</td>
                      <td className="px-5 py-3"><span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded bg-slate-100"><span className="block h-full rounded" style={{ width: `${adoption(f)}%`, background: "var(--chart-mark)" }} /></span><span className="text-xs tabular-nums text-slate-600">{`${Math.round(adoption(f))}%`}</span></span></td>
                      <td className="px-5 py-3"><Change now={f.recent} before={f.earlier} /></td>
                      <td className="px-5 py-3 text-end"><Button size="sm" variant="ghost" onClick={() => { setPicked(f.feature); window.scrollTo({ top: 0, behavior: "smooth" }); }}>View</Button></td>
                    </tr>
                  ))}
                </DataTable>
              </Panel>
            </>
          )}
        </div>
      )}
    </>
  );
}
