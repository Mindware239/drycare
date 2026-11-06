"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { FEATURES, type FeatureKey } from "@drycare/shared";
import { Alert, Button, Select } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, Panel, dateLabel, useAdminData } from "../admin-ui";

type Row = { feature: string; uses: number; customers: number; recent: number; earlier: number };
type Data = { days: number; totalCustomers: number; features: Row[]; byPlan: { plan: string; feature: string; uses: number; customers: number }[]; customers: { id: string; name: string; uses: number; lastDay: string }[] };
const nameOf = (key: string) => FEATURES[key as FeatureKey]?.label ?? key;

export default function FeatureUsagePage() {
  const [days, setDays] = useState("30");
  const [picked, setPicked] = useState("");
  const { data, error } = useAdminData<Data>(`/platform-admin/feature-usage?days=${days}${picked ? `&feature=${encodeURIComponent(picked)}` : ""}`);
  const plans = useMemo(() => [...new Set(data?.byPlan.map((r) => r.plan))], [data]);
  const least = data ? [...data.features].sort((a, b) => a.uses - b.uses).slice(0, 5) : [];
  const unused = data ? Object.keys(FEATURES).filter((k) => !data.features.some((f) => f.feature === k)) : [];
  return (
    <>
      <ConsoleHeader title="Feature usage" description="How much each feature is used, to guide plans and development. Only counts per shop and day are kept: no customer, order or staff details." actions={<Select value={days} onChange={(e) => setDays(e.target.value)} className="w-auto" aria-label="Period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></Select>} />
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      <Panel title="All features" description={data ? `Adoption is the share of your ${data.totalCustomers} current customers who used a feature in this period. Trend compares the later half of the period with the earlier half.` : undefined} padded={false}>
        {!data ? <div className="p-5"><LoadingRows rows={6} /></div> : !data.features.length ? <EmptyState icon={BarChart3} title="No usage yet">Counts appear as customers use the software.</EmptyState> : (
          <DataTable minWidth={720} head={["Feature", "Uses", "Active customers", "Adoption", "Trend", ""]}>
            {data.features.map((f) => {
              const change = f.earlier ? Math.round(((f.recent - f.earlier) / f.earlier) * 100) : null;
              return (
                <tr key={f.feature}>
                  <td className="px-5 py-3 font-medium text-slate-900">{nameOf(f.feature)}</td>
                  <td className="px-5 py-3 tabular-nums">{f.uses.toLocaleString("en-IN")}</td>
                  <td className="px-5 py-3 tabular-nums">{f.customers}</td>
                  <td className="px-5 py-3 tabular-nums">{data.totalCustomers ? `${Math.round((f.customers / data.totalCustomers) * 100)}%` : "—"}</td>
                  <td className="px-5 py-3">{change === null ? <span className="text-xs text-slate-500">New</span> : <span className={`inline-flex items-center gap-1 text-xs font-medium ${change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{change >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{change >= 0 ? "+" : ""}{change}%</span>}</td>
                  <td className="px-5 py-3 text-end"><Button size="sm" variant="ghost" onClick={() => setPicked(f.feature)}>Customers</Button></td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
      {data && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <Panel title="Least used" description="Among features used at all in this period.">
            <ul className="space-y-1.5 text-sm">{least.map((f) => <li key={f.feature} className="flex justify-between gap-3"><span>{nameOf(f.feature)}</span><span className="tabular-nums text-slate-500">{f.uses.toLocaleString("en-IN")}</span></li>)}</ul>
            {!!unused.length && <p className="mt-3 text-xs leading-5 text-slate-500">Not used in this period: {unused.map(nameOf).join(", ")}.</p>}
          </Panel>
          <Panel title="By plan">
            {!plans.length ? <p className="text-sm text-slate-500">No usage yet.</p> : plans.map((plan) => (
              <div key={plan} className="mb-3 last:mb-0">
                <p className="text-sm font-semibold text-slate-900">{plan}</p>
                <p className="text-xs leading-5 text-slate-600">{data.byPlan.filter((r) => r.plan === plan).slice(0, 6).map((r) => `${nameOf(r.feature)} (${r.uses.toLocaleString("en-IN")})`).join(", ")}</p>
              </div>
            ))}
          </Panel>
        </div>
      )}
      {picked && data && (
        <div className="mt-6"><Panel title={`Customers using ${nameOf(picked)}`} padded={false}>
          {!data.customers.length ? <EmptyState icon={BarChart3} title="Nobody in this period">Try a longer period.</EmptyState> : (
            <DataTable minWidth={520} head={["Customer", "Uses", "Last used"]}>
              {data.customers.map((c) => <tr key={c.id}><td className="px-5 py-3"><Link href={`/super-admin/customers/view?id=${c.id}`} className="font-medium text-slate-900 hover:underline">{c.name}</Link></td><td className="px-5 py-3 tabular-nums">{c.uses.toLocaleString("en-IN")}</td><td className="px-5 py-3 text-xs text-slate-600">{dateLabel(c.lastDay)}</td></tr>)}
            </DataTable>
          )}
        </Panel></div>
      )}
    </>
  );
}
