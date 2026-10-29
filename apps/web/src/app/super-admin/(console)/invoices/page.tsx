"use client";
import { useState } from "react";
import Link from "next/link";
import { FilePlus2, FileText, IndianRupee, Receipt, Search } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Alert, Button, Input } from "@/components/ui";
import { ConsoleHeader, CsvButton, DataTable, EmptyState, LoadingRows, MetricCard, Panel, SegmentedTabs, StatusBadge, dateLabel, exportCsv, rupees, useAdminData } from "../admin-ui";

type Row = {
  id: string; number: string; status: string; issuedAt: string; organizationId: string; organizationName: string;
  totalPaise: number; subtotalPaise: number; taxPaise: number; periodStart: string | null; periodEnd: string | null; provider: string; reference: string; planName: string | null;
};
type Data = { invoices: Row[]; totals: { count: number; totalPaise: number; taxPaise: number }; paymentsWithoutInvoice: number };

export default function InvoicesPage() {
  const [status, setStatus] = useState<"all" | "issued" | "void">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, reload } = useAdminData<Data>(`/platform-admin/invoices?status=${status}${query ? `&search=${encodeURIComponent(query)}` : ""}`);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function issueMissing() {
    setBusy(true);
    try {
      const r = await api<{ issued: string[] }>("/platform-admin/invoices/issue-missing", { body: {} });
      setNotice(r.issued.length ? `Issued ${r.issued.length} invoice${r.issued.length === 1 ? "" : "s"}: ${r.issued.join(", ")}` : "Every payment already has an invoice.");
      void reload();
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.invoices ?? [];
  return (
    <>
      <ConsoleHeader title="Tax invoices" description="GST invoices issued to shops for their DryCare subscription. An invoice is created automatically for every verified or online payment, numbered in one continuous series."
        actions={<CsvButton disabled={!rows.length} onClick={() => exportCsv(`drycare-invoices-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => ({ Invoice: r.number, Date: r.issuedAt.slice(0, 10), Business: r.organizationName, Plan: r.planName ?? "", "Taxable (INR)": rupees(r.subtotalPaise), "GST (INR)": rupees(r.taxPaise), "Total (INR)": rupees(r.totalPaise), Status: r.status, Payment: r.reference })))} />} />
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-5"><Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert></div>}
      {data && data.paymentsWithoutInvoice > 0 && (
        <div className="mb-5">
          <Alert tone="amber">
            {data.paymentsWithoutInvoice} paid subscription payment{data.paymentsWithoutInvoice === 1 ? " was" : "s were"} recorded before invoicing was set up.{" "}
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void issueMissing()} className="ml-2"><FilePlus2 className="h-4 w-4" />Issue their invoices</Button>
          </Alert>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MetricCard icon={Receipt} label="Invoices issued" value={(data?.totals.count ?? 0).toLocaleString("en-IN")} />
        <MetricCard icon={IndianRupee} label="Invoiced value" value={money(data?.totals.totalPaise ?? 0)} tone="emerald" detail="Including GST, excluding void invoices" />
        <MetricCard icon={FileText} label="GST collected" value={money(data?.totals.taxPaise ?? 0)} tone="violet" detail="CGST + SGST + IGST to deposit" />
      </div>
      <Panel padded={false} title="Invoice register"
        actions={<>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice no. or business" className="w-64 pl-9" aria-label="Search invoices" />
          </form>
          <SegmentedTabs value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "issued", label: "Issued" }, { value: "void", label: "Void" }]} />
        </>}>
        {!data ? <LoadingRows /> : (
          <DataTable minWidth={860} head={["Invoice", "Date", "Business", "Plan & period", "Taxable", "GST", "Total", "Status"]}
            empty={!rows.length && <EmptyState icon={Receipt} title="No invoices yet">Invoices appear here as soon as a subscription payment is verified on the Payments page or paid online.</EmptyState>}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3"><Link href={`/super-admin/invoices/view?id=${r.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{r.number}</Link></td>
                <td className="px-5 py-3 text-xs text-slate-600">{dateLabel(r.issuedAt)}</td>
                <td className="px-5 py-3"><Link href={`/super-admin/customers/view?id=${r.organizationId}`} className="font-medium text-slate-900 hover:text-brand-700">{r.organizationName}</Link></td>
                <td className="px-5 py-3 text-xs text-slate-600">{r.planName ?? "—"}<br />{dateLabel(r.periodStart)} – {dateLabel(r.periodEnd)}</td>
                <td className="px-5 py-3 tabular-nums">{money(r.subtotalPaise)}</td>
                <td className="px-5 py-3 tabular-nums text-slate-600">{money(r.taxPaise)}</td>
                <td className="px-5 py-3 font-semibold tabular-nums">{money(r.totalPaise)}</td>
                <td className="px-5 py-3"><StatusBadge status={r.status === "issued" ? "paid" : "canceled"} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
