"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, MailCheck, MailWarning, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Input, Select } from "@/components/ui";
import { CsvButton, DataTable, EmptyState, LoadingRows, Pager, Panel, SegmentedTabs, TrialBadge, StatusBadge, dateLabel, exportCsv, relativeDays, useAdminData } from "../admin-ui";

export type CustomerRow = {
  id: string; name: string; status: string; gstin: string | null; trialStartedAt: string | null; trialEndsAt: string | null; createdAt: string;
  city: string | null; state: string | null; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null; ownerVerifiedAt: string | null;
  lastLoginAt: string | null; users: number; branches: number; orders: number;
  subscriptionStatus: string | null; planName: string | null; subscriptionEndsAt: string | null;
};
type Page = { items: CustomerRow[]; total: number; page: number; pageSize: number; testCount: number };

type Mode = "customers" | "trials";
const TRIAL_WINDOWS = [
  { value: "active", label: "Active trials" },
  { value: "expiring", label: "Ending in 7 days" },
  { value: "lapsed", label: "Lapsed, unpaid" },
] as const;

export function CustomerList({ mode, initialWindow, initialSort }: { mode: Mode; initialWindow?: string; initialSort?: string }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(mode === "trials" ? "trial" : "all");
  const [trialWindow, setTrialWindow] = useState(mode === "trials" ? (TRIAL_WINDOWS.some((w) => w.value === initialWindow) ? initialWindow! : "active") : "all");
  const [sort, setSort] = useState(initialSort ?? (mode === "trials" ? "trial_end" : "newest"));
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState("");
  const [includeTest, setIncludeTest] = useState(false);

  // Debounced search so the directory filters as the admin types.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = new URLSearchParams({ search, status, window: trialWindow, sort, page: String(page), pageSize: "25", includeTest: String(includeTest) }).toString();
  const { data, error, loading } = useAdminData<Page>(`/platform-admin/customers?${query}`);

  async function exportAll() {
    setExportError("");
    try {
      const rows: CustomerRow[] = [];
      for (let p = 1; ; p++) {
        const res = await api<Page>(`/platform-admin/customers?${new URLSearchParams({ search, status, window: trialWindow, sort, page: String(p), pageSize: "100", includeTest: String(includeTest) })}`);
        rows.push(...res.items);
        if (!res.items.length || rows.length >= res.total) break;
      }
      exportCsv(`drycare-${mode}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => ({
        Business: r.name, Status: r.status, Owner: r.ownerName, Email: r.ownerEmail, Phone: r.ownerPhone, "Email verified": r.ownerVerifiedAt ? "Yes" : "No",
        GSTIN: r.gstin, City: r.city, State: r.state, Registered: r.createdAt?.slice(0, 10), "Trial ends": r.trialEndsAt?.slice(0, 10),
        Plan: r.planName, "Subscription status": r.subscriptionStatus, "Subscription ends": r.subscriptionEndsAt?.slice(0, 10),
        Branches: r.branches, Users: r.users, Orders: r.orders, "Last login": r.lastLoginAt?.slice(0, 10),
      })));
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Export failed.");
    }
  }

  return (
    <Panel padded={false}>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
        {mode === "trials" && <SegmentedTabs value={trialWindow} options={[...TRIAL_WINDOWS]} onChange={(v) => { setTrialWindow(v); setPage(1); }} />}
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search business, owner, email, phone or GSTIN" aria-label="Search customers" className="pl-9" />
        </label>
        {mode === "customers" && (
          <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="lg:w-44">
            <option value="all">All statuses</option><option value="trial">Trial</option><option value="active">Active (paid)</option>
            <option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="terminated">Terminated</option>
          </Select>
        )}
        <Select aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="lg:w-48">
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="trial_end">Trial ending soonest</option>
          <option value="last_login">Recently active</option><option value="name">Business name A–Z</option>
        </Select>
        <CsvButton onClick={exportAll} disabled={!data?.total} />
      </div>
      {Boolean(data?.testCount) && (
        <label className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-600">
          <input type="checkbox" checked={includeTest} onChange={(e) => { setIncludeTest(e.target.checked); setPage(1); }} className="h-3.5 w-3.5 accent-brand-700" />
          Show {data!.testCount} automated test account{data!.testCount === 1 ? "" : "s"} (owner emails ending in @test.local). They are excluded from all dashboard figures.
        </label>
      )}
      {(error || exportError) && <div className="p-4"><Alert>{error || exportError}</Alert></div>}
      {!data ? <LoadingRows /> : (
        <>
          <DataTable minWidth={1040} head={["Business", "Owner", "Status", mode === "trials" ? "Trial ends" : "Plan", "Usage", "Last active", ""]}
            empty={data.total === 0 && <EmptyState icon={Building2} title={search ? "No businesses match your search" : mode === "trials" ? "No trials in this view" : "No customers yet"}>{search ? "Try a different name, email or phone number." : "New registrations from the website will appear here."}</EmptyState>}>
            {data.items.map((r) => (
              <tr key={r.id} className={loading ? "opacity-60" : "transition hover:bg-slate-50/70"}>
                <td className="px-5 py-3.5">
                  <Link href={`/super-admin/customers/view?id=${r.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{r.name}</Link>
                  <p className="mt-0.5 text-xs text-slate-500">{[r.city, r.state].filter(Boolean).join(", ") || "Location not set"} · joined {dateLabel(r.createdAt)}</p>
                </td>
                <td className="px-5 py-3.5">
                  <p className="text-slate-800">{r.ownerName ?? "—"}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    {r.ownerVerifiedAt ? <MailCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Email verified" /> : <MailWarning className="h-3.5 w-3.5 text-amber-500" aria-label="Email not verified" />}
                    {r.ownerEmail ?? "—"}
                  </p>
                </td>
                <td className="px-5 py-3.5"><TrialBadge status={r.status} trialEndsAt={r.trialEndsAt} /></td>
                <td className="px-5 py-3.5">
                  {mode === "trials" ? (
                    <><p className="text-slate-800">{dateLabel(r.trialEndsAt)}</p><p className="mt-0.5 text-xs text-slate-500">{relativeDays(r.trialEndsAt)}</p></>
                  ) : (
                    <><p className="text-slate-800">{r.planName ?? "No paid plan"}</p>{r.subscriptionStatus && <div className="mt-1"><StatusBadge status={r.subscriptionStatus} /></div>}</>
                  )}
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-600">{r.branches} branch{r.branches === 1 ? "" : "es"} · {r.users} user{r.users === 1 ? "" : "s"}<br />{r.orders.toLocaleString("en-IN")} orders</td>
                <td className="px-5 py-3.5 text-xs text-slate-600">{r.lastLoginAt ? dateLabel(r.lastLoginAt) : "Never signed in"}</td>
                <td className="px-5 py-3.5 text-right"><Link href={`/super-admin/customers/view?id=${r.id}`} aria-label={`Open ${r.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ChevronRight className="h-4 w-4" /></Link></td>
              </tr>
            ))}
          </DataTable>
          {data.total > 0 && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        </>
      )}
    </Panel>
  );
}
