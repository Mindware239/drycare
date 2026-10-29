"use client";
import { Fragment, useEffect, useState } from "react";
import { Activity, ChevronDown, Search } from "lucide-react";
import { Alert, Input, cx } from "@/components/ui";
import { ConsoleHeader, CsvButton, EmptyState, LoadingRows, Pager, Panel, SegmentedTabs, actionLabel, dateTimeLabel, exportCsv, useAdminData } from "../admin-ui";

type Entry = { id: string; action: string; resourceType: string; resourceId: string | null; ip: string | null; createdAt: string; before: unknown; after: unknown; actorEmail: string | null; organizationName: string | null };
type Page = { items: Entry[]; total: number; page: number; pageSize: number };

export default function AuditLogsPage() {
  const [scope, setScope] = useState<"platform" | "all">("platform");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [input]);
  const { data, error } = useAdminData<Page>(`/platform-admin/audit-logs?${new URLSearchParams({ scope, search, page: String(page), pageSize: "50" })}`);

  return (
    <>
      <ConsoleHeader title="Audit log" description="A permanent record of who did what and when: super admin sign-ins, trial extensions, suspensions, price changes and payment approvals. Entries cannot be edited or deleted." />
      <Panel padded={false}
        title={<SegmentedTabs value={scope} onChange={(v) => { setScope(v); setPage(1); }} options={[{ value: "platform", label: "Control Center actions" }, { value: "all", label: "All platform events" }]} />}
        actions={<>
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Action, email or business" className="h-8 w-64 pl-9 text-xs" aria-label="Search audit log" />
          </label>
          <CsvButton disabled={!data?.items.length} onClick={() => exportCsv("drycare-audit-log.csv", (data?.items ?? []).map((e) => ({ Time: e.createdAt, Action: e.action, Actor: e.actorEmail, Business: e.organizationName, Resource: `${e.resourceType}:${e.resourceId ?? ""}`, IP: e.ip })))} />
        </>}>
        {error && <div className="p-4"><Alert>{error}</Alert></div>}
        {!data ? <LoadingRows /> : !data.items.length ? <EmptyState icon={Activity} title="No matching events" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Event</th><th className="px-5 py-3">By</th><th className="px-5 py-3">Business</th><th className="px-5 py-3">IP address</th><th className="w-10" /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="cursor-pointer hover:bg-slate-50/70" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{dateTimeLabel(e.createdAt)}</td>
                        <td className="px-5 py-3"><p className={cx("font-medium", e.action.includes("failed") ? "text-red-700" : "text-slate-900")}>{actionLabel(e.action)}</p><p className="font-mono text-[11px] text-slate-400">{e.action}</p></td>
                        <td className="px-5 py-3 text-slate-700">{e.actorEmail ?? "System"}</td>
                        <td className="px-5 py-3 text-slate-700">{e.organizationName ?? "—"}</td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">{e.ip ?? "—"}</td>
                        <td className="px-3"><ChevronDown className={cx("h-4 w-4 text-slate-400 transition", open === e.id && "rotate-180")} /></td>
                      </tr>
                      {open === e.id && (
                        <tr className="bg-slate-50/60"><td colSpan={6} className="px-5 py-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <Json label="Before" value={e.before} /><Json label="After" value={e.after} />
                          </div>
                          <p className="mt-2 font-mono text-[11px] text-slate-400">{e.resourceType} {e.resourceId}</p>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-700">{value ? JSON.stringify(value, null, 2) : "—"}</pre>
    </div>
  );
}
