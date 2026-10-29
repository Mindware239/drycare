"use client";
import { useState } from "react";
import { Inbox, Mail, MapPin, Phone } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Select } from "@/components/ui";
import { ConsoleHeader, CsvButton, EmptyState, LoadingRows, Panel, SegmentedTabs, StatusBadge, dateTimeLabel, exportCsv, useAdminData } from "../admin-ui";

type Lead = { id: string; type: string; name: string; businessName: string | null; email: string; phone: string | null; city: string | null; message: string; status: string; createdAt: string };
const STATUSES = ["new", "contacted", "qualified", "converted", "closed"] as const;
type Filter = "all" | (typeof STATUSES)[number];

export default function LeadsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, error, reload } = useAdminData<Lead[]>(`/platform-admin/leads?status=${filter}`);
  const [updateError, setUpdateError] = useState("");

  async function setStatus(lead: Lead, status: string) {
    setUpdateError("");
    try {
      await api(`/platform-admin/leads/${lead.id}`, { method: "PATCH", body: { status } });
      await reload();
    } catch (cause) {
      setUpdateError(cause instanceof Error ? cause.message : "Could not update the enquiry.");
    }
  }

  return (
    <>
      <ConsoleHeader title="Website enquiries" description="Demo, sales and support requests sent from the public website contact forms. Move each enquiry through the pipeline as you follow up." />
      <Panel padded={false}
        title={<SegmentedTabs value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} />}
        actions={<CsvButton disabled={!data?.length} onClick={() => exportCsv("drycare-enquiries.csv", (data ?? []).map((l) => ({ Received: l.createdAt.slice(0, 16).replace("T", " "), Type: l.type, Name: l.name, Business: l.businessName, Email: l.email, Phone: l.phone, City: l.city, Message: l.message, Status: l.status })))} />}>
        {(error || updateError) && <div className="p-4"><Alert>{error || updateError}</Alert></div>}
        {!data ? <LoadingRows /> : !data.length ? <EmptyState icon={Inbox} title="No enquiries in this view">Messages from the website contact and demo forms will appear here.</EmptyState> : (
          <ul className="divide-y divide-slate-100">
            {data.map((l) => (
              <li key={l.id} className="grid grid-cols-1 gap-3 px-5 py-4 lg:grid-cols-[1fr_180px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{l.name}{l.businessName && <span className="font-normal text-slate-500"> · {l.businessName}</span>}</p>
                    <StatusBadge status={l.status} />
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{l.type.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{l.message}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1 hover:text-brand-700"><Mail className="h-3.5 w-3.5" />{l.email}</a>
                    {l.phone && <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 hover:text-brand-700"><Phone className="h-3.5 w-3.5" />{l.phone}</a>}
                    {l.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{l.city}</span>}
                    <span>{dateTimeLabel(l.createdAt)}</span>
                  </div>
                </div>
                <Select aria-label={`Status for ${l.name}`} value={l.status} onChange={(e) => setStatus(l, e.target.value)} className="h-9 self-start">
                  {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
