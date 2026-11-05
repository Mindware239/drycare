"use client";
import { useState, type FormEvent } from "react";
import { Check, Download, Printer, Trash2 } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select, cx } from "@/components/ui";

type Connected = { id: string; serialNumber: string; billNumber: string; model: string; printerName: string | null };

/** Installing a printer sold by Mindware: install its driver, then connect it with its serial and bill number. */
export function PrinterConnect({ windowsPrinters, directAvailable, required, onChanged }: { windowsPrinters: { name: string }[]; directAvailable: boolean; required: boolean; onChanged: () => void }) {
  const { data, reload } = useApi<{ driverUrl: string | null; printers: Connected[] }>("/labels/shop-printers");
  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [bill, setBill] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const taken = new Set(data?.printers.map((p) => p.printerName));
  const free = windowsPrinters.filter((p) => !taken.has(p.name));
  const driverDone = !directAvailable || windowsPrinters.length > 0;

  async function connect(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const row = await api<Connected>("/labels/shop-printers", { body: { serial, bill, printerName: directAvailable ? name : undefined } });
      setNotice(`${row.model} connected. It can print now.`);
      setSerial("");
      setBill("");
      setName("");
      await reload();
      onChanged();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(p: Connected) {
    setError("");
    try {
      await api(`/labels/shop-printers/${p.id}`, { method: "DELETE" });
      await reload();
      onChanged();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }
  const step = (n: number, done: boolean, text: string) => <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-emerald-600 text-white" : "bg-slate-900 text-white")} aria-label={text}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>;

  return (
    <section aria-label="Connect a printer" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Printer className="h-4 w-4" />Connect a Mindware printer</h2>
        {required && <Badge color={data?.printers.length ? "green" : "amber"}>{data?.printers.length ? `${data.printers.length} connected` : "Needed before printing"}</Badge>}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {notice && <div className="mt-3"><Alert tone="green">{notice}</Alert></div>}
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex gap-3">
          {step(1, driverDone && directAvailable, "Step 1")}
          <div className="text-sm">
            <p className="font-semibold text-slate-900">Install the printer driver first</p>
            <p className="mt-0.5 text-slate-600">{directAvailable ? (windowsPrinters.length ? `Windows shows ${windowsPrinters.length} printer${windowsPrinters.length === 1 ? "" : "s"}. If yours is missing, install its driver and refresh.` : "No printer found yet. Install the driver, connect the USB cable, then refresh.") : "Install the driver on this computer, and make sure the printer shows in Windows."}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {data?.driverUrl && <a href={data.driverUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" />Download driver</Button></a>}
              {directAvailable && <Button size="sm" variant="ghost" onClick={onChanged}>Refresh</Button>}
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          {step(2, !!data?.printers.length, "Step 2")}
          <form onSubmit={connect} className="grid flex-1 items-end gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {directAvailable && <Field label="Printer in Windows" required><Select required value={name} onChange={(e) => setName(e.target.value)} disabled={!free.length}><option value="">{free.length ? "Choose" : "None to connect"}</option>{free.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</Select></Field>}
            <Field label="Serial number" required><Input required value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} placeholder="On the printer's label" className="font-mono" /></Field>
            <Field label="Bill number" required><Input required value={bill} onChange={(e) => setBill(e.target.value.toUpperCase())} placeholder="On your Mindware bill" className="font-mono" /></Field>
            <Button type="submit" loading={saving} disabled={!serial.trim() || !bill.trim() || (directAvailable && !name)}>Connect printer</Button>
          </form>
        </div>
      </div>
      {!!data?.printers.length && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          {data.printers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className="font-medium">{p.model}</span>{p.printerName && <span className="text-slate-500"> · {p.printerName}</span>}<span className="block font-mono text-xs text-slate-500">Serial {p.serialNumber} · Bill {p.billNumber}</span></span>
              <button type="button" onClick={() => void remove(p)} aria-label={`Disconnect ${p.model}`} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"><Trash2 className="h-3.5 w-3.5" />Disconnect</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
