"use client";
import { useState } from "react";
import Link from "next/link";
import { Repeat } from "lucide-react";
import { money } from "@/lib/format";
import { Alert } from "@/components/ui";
import { ConsoleHeader, CsvButton, DataTable, EmptyState, LoadingRows, Panel, SegmentedTabs, StatusBadge, dateLabel, exportCsv, relativeDays, rupees, useAdminData } from "../admin-ui";

type Subscription = {
  id: string; organizationId: string; organizationName: string; status: string; effectiveStatus: string; provider: string; reference: string | null;
  startsAt: string; endsAt: string | null; cancelAt: string | null; planName: string; pricePaise: number; interval: string; createdAt: string;
};
type Filter = "all" | "active" | "renewing" | "lapsed" | "past_due" | "canceled";

export default function SubscriptionsPage() {
  const [filter, setFilter] = useState<Filter>("active");
  const { data, error } = useAdminData<Subscription[]>(`/platform-admin/subscriptions?status=${filter}`);
  const rows = (data ?? []).filter((s) => !s.planName.startsWith("Smoke Plan"));

  return (
    <>
      <ConsoleHeader
        title="Subscriptions & renewals"
        description="Paid plans and their renewal dates. Renew a plan by recording the next verified payment for the business; the new period starts when the current one ends, so no paid days are lost."
      />
      <Panel padded={false}
        title={<SegmentedTabs value={filter} onChange={setFilter} options={[
          { value: "active", label: "Active" }, { value: "renewing", label: "Renewing in 14 days" }, { value: "lapsed", label: "Expired" },
          { value: "past_due", label: "Past due" }, { value: "canceled", label: "Cancelled" }, { value: "all", label: "All" },
        ]} />}
        actions={<CsvButton disabled={!rows.length} onClick={() => exportCsv(`drycare-subscriptions-${filter}.csv`, rows.map((s) => ({ Business: s.organizationName, Plan: s.planName, "Price (INR)": rupees(s.pricePaise), Interval: s.interval, Status: s.effectiveStatus, Starts: s.startsAt?.slice(0, 10), Ends: s.endsAt?.slice(0, 10), Source: s.provider, Reference: s.reference })))} />}>
        {error && <div className="p-4"><Alert>{error}</Alert></div>}
        {!data ? <LoadingRows /> : (
          <DataTable minWidth={900} head={["Business", "Plan", "Status", "Current period", "Renews / ends", "Last payment", ""]}
            empty={!rows.length && <EmptyState icon={Repeat} title="No subscriptions in this view">Subscriptions are created when you record a verified payment for a business.</EmptyState>}>
            {rows.map((s) => {
              const soon = s.endsAt && new Date(s.endsAt).getTime() - Date.now() < 14 * 86_400_000 && s.effectiveStatus === "active";
              return (
                <tr key={s.id}>
                  <td className="px-5 py-3"><Link href={`/super-admin/customers/view?id=${s.organizationId}`} className="font-semibold text-slate-900 hover:text-brand-700">{s.organizationName}</Link></td>
                  <td className="px-5 py-3"><p className="text-slate-800">{s.planName}</p><p className="text-xs text-slate-500">{money(s.pricePaise)} / {s.interval}</p></td>
                  <td className="px-5 py-3"><StatusBadge status={soon ? "renewing" : s.effectiveStatus} /></td>
                  <td className="px-5 py-3 text-xs text-slate-600">{dateLabel(s.startsAt)} → {dateLabel(s.endsAt)}</td>
                  <td className="px-5 py-3"><p className="text-slate-800">{dateLabel(s.endsAt)}</p><p className={soon ? "text-xs font-medium text-amber-700" : "text-xs text-slate-500"}>{relativeDays(s.endsAt)}</p></td>
                  <td className="px-5 py-3 text-xs text-slate-600">{s.provider.replace("manual_", "").replaceAll("_", " ")}{s.reference && <span className="block font-mono">{s.reference}</span>}</td>
                  <td className="px-5 py-3 text-right"><Link href={`/super-admin/payments?org=${s.organizationId}`} className="text-xs font-semibold text-brand-700 hover:underline">Record renewal</Link></td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
