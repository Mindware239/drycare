"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Search } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { Alert, Button, Card, Empty, Input, PageHeader, Select, Spinner, StageBadge, Table, Td, cx } from "@/components/ui";

type TagRow = { id: string; scanCode: string; tagCode: string; status: string; createdAt: string; orderId: string; orderNumber: string; customerId: string; customerName: string; customerPhone: string | null; garment: string; service: string; colour: string | null; rack: string | null; charge: number | string | null; printCount: number; rfid: string | null; lastSeenAt: string | null; lastSeenPlace: string | null };
type TagList = { rows: TagRow[]; summary: { total: number; inProcess: number; ready: number; delivered: number; exception: number; withRfid: number; sales: number | null } };

const STATES = [["all", "All"], ["in_process", "In process"], ["ready", "Ready"], ["delivered", "Delivered"], ["exception", "Exception"], ["cancelled", "Cancelled"]] as const;
const PAGE = 50;

/** A value a spreadsheet will keep as text, so long barcodes stay whole and nothing runs as a formula. */
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;

/** Every tag this shop has issued: find any one by barcode, order, customer or garment. */
export default function TagsPage() {
  const router = useRouter();
  const showsRfid = useSession().has("rfid");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATES)[number][0]>("all");
  const [rfid, setRfid] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [input]);
  const filters = { search, status, rfid, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const { data, error } = useApi<TagList>(`/tags?${new URLSearchParams({ ...filters, limit: String(PAGE), offset: String(page * PAGE) })}`);
  const s = data?.summary;
  const shownMoney = s?.sales !== null && s?.sales !== undefined;

  async function exportCsv() {
    setExporting(true);
    setExportError("");
    try {
      const all = await api<TagList>(`/tags?${new URLSearchParams({ ...filters, limit: "5000" })}`);
      const head = ["Barcode", "Full tag number", "RFID", "Order", "Customer", "Phone", "Garment", "Service", "Colour", "Stage", "Rack", "Issued", "Times printed", ...(shownMoney ? ["Charged"] : [])];
      const lines = all.rows.map((r) => [r.scanCode, r.tagCode, r.rfid, r.orderNumber, r.customerName, r.customerPhone, r.garment, r.service, r.colour, r.status, r.rack, dateTime(r.createdAt), r.printCount, ...(shownMoney ? [Number(r.charge ?? 0) / 100] : [])].map(csvCell).join(","));
      const url = URL.createObjectURL(new Blob([`﻿${[head.map(csvCell).join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "drycare-tags.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError((e as ApiError).message);
    } finally {
      setExporting(false);
    }
  }

  const tiles: [string, number | string, (typeof STATES)[number][0] | null][] = s ? [
    ["Tags issued", s.total, "all"], ["In process", s.inProcess, "in_process"], ["Ready", s.ready, "ready"], ["Delivered", s.delivered, "delivered"], ["Exceptions", s.exception, "exception"],
    ...(showsRfid ? [["With RFID tag", s.withRfid, null] as [string, number, null]] : []),
    ...(shownMoney ? [["Sales on these tags", money(s.sales!), null] as [string, string, null]] : []),
  ] : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Tag tracking" subtitle="Every tag issued: which customer, order and sale it belongs to, and where it is now." actions={<Button variant="secondary" onClick={exportCsv} loading={exporting}><Download className="h-4 w-4" />Export</Button>} />
      {exportError && <Alert>{exportError}</Alert>}
      {error && <Alert>{error.message}</Alert>}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {tiles.map(([label, value, state]) => (
            <button key={label} type="button" disabled={!state} onClick={() => { if (state) { setStatus(state); setPage(0); } }} className={cx("rounded-xl border bg-white p-3 text-left", state && state === status ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200", state && "hover:border-slate-400")}>
              <span className="block text-xs text-slate-500">{label}</span>
              <span className="mt-0.5 block text-xl font-bold tabular-nums text-slate-900">{value}</span>
            </button>
          ))}
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <label className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Barcode, RFID, order number, customer, phone or garment" className="pl-9" aria-label="Search tags" />
          </label>
          <Select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }} className="w-auto" aria-label="Stage">
            {STATES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          {showsRfid && <Select value={rfid} onChange={(e) => { setRfid(e.target.value); setPage(0); }} className="w-auto" aria-label="RFID"><option value="all">With or without RFID</option><option value="with">With RFID</option><option value="without">No RFID tag</option></Select>}
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-auto" aria-label="Issued from" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-auto" aria-label="Issued to" />
        </div>
        {!data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Barcode", ...(showsRfid ? ["RFID"] : []), "Customer", "Order", "Item", "Stage", "Rack", "Issued", "Printed", ...(shownMoney ? ["Charged"] : [])]} empty={!data.rows.length && <Empty title="No tags found">Tags appear here as soon as an order is booked.</Empty>}>
            {data.rows.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/tags/view?code=${t.scanCode}`)}>
                <Td><Link href={`/tags/view?code=${t.scanCode}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-brand-700 hover:underline">{t.scanCode}</Link><p className="font-mono text-xs text-slate-500">{t.tagCode}</p></Td>
                {showsRfid && <Td className="text-xs">{t.rfid ? <span className="font-mono" title={t.rfid}>…{t.rfid.slice(-8)}</span> : <span className="text-amber-700">No tag</span>}{t.lastSeenAt && <p className="text-slate-500">Seen {dateTime(t.lastSeenAt)}{t.lastSeenPlace ? ` · ${t.lastSeenPlace}` : ""}</p>}</Td>}
                <Td><Link href={`/customers/view?id=${t.customerId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-900 hover:text-brand-700">{t.customerName}</Link>{t.customerPhone && <p className="text-xs text-slate-500">{t.customerPhone}</p>}</Td>
                <Td><Link href={`/orders/view?id=${t.orderId}`} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">{t.orderNumber}</Link></Td>
                <Td><span className="font-medium">{t.garment}</span><p className="text-xs text-slate-500">{[t.service, t.colour].filter(Boolean).join(" · ")}</p></Td>
                <Td><StageBadge stage={t.status} /></Td>
                <Td>{t.rack ?? "—"}</Td>
                <Td className="text-xs text-slate-600">{dateTime(t.createdAt)}</Td>
                <Td className="tabular-nums">{t.printCount ? `${t.printCount}×` : "Not yet"}</Td>
                {shownMoney && <Td className="text-right tabular-nums">{money(Number(t.charge ?? 0))}</Td>}
              </tr>
            ))}
          </Table>
        )}
        {data && (page > 0 || data.rows.length === PAGE) && (
          <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm text-slate-600">
            <span>Page {page + 1}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={data.rows.length < PAGE} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
