"use client";
import { useState, type FormEvent } from "react";
import { Check, Download, Lock, Printer, ScanLine } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select, cx } from "@/components/ui";

type Connected = { id: string; deviceType: "printer" | "scanner"; serialNumber: string; billNumber: string; model: string; printerName: string | null; disabled: boolean; serialConfirmed: boolean };
export type DeviceInfo = { driverUrl: string | null; printers: Connected[]; missing: { printer: boolean; scanner: boolean } };

/**
 * Connecting a device sold by Mindware with its serial and bill number. A printer's driver goes on first. Only Mindware
 * can disable or change a connected device, so there is nothing here to remove it.
 */
export function PrinterConnect({ kind = "printer", windowsPrinters = [], directAvailable = false, required, onChanged }: { kind?: "printer" | "scanner"; windowsPrinters?: { name: string }[]; directAvailable?: boolean; required: boolean; onChanged: () => void }) {
  const { data, reload } = useApi<DeviceInfo>("/labels/shop-printers");
  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [bill, setBill] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const printer = kind === "printer";
  const mine = (data?.printers ?? []).filter((p) => p.deviceType === kind);
  const working = mine.filter((p) => !p.disabled);
  const taken = new Set(working.map((p) => p.printerName));
  const free = windowsPrinters.filter((p) => !taken.has(p.name));
  const driverDone = !directAvailable || windowsPrinters.length > 0;
  const chooseQueue = printer && directAvailable;

  async function connect(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const row = await api<Connected>("/labels/shop-printers", { body: { deviceType: kind, serial, bill, printerName: chooseQueue ? name : undefined } });
      setNotice(printer ? (row.serialConfirmed ? `${row.model} connected. The printer confirmed its serial number.` : `${row.model} connected. It can print now.`) : `${row.model} connected. It can scan now.`);
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
  const step = (n: number, done: boolean, text: string) => <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-emerald-600 text-white" : "bg-slate-900 text-white")} aria-label={text}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>;
  const Icon = printer ? Printer : ScanLine;
  const form = (
    <form onSubmit={connect} className={cx("grid flex-1 items-end gap-2 sm:grid-cols-2", chooseQueue ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
      {chooseQueue && <Field label="Printer in Windows" required><Select required value={name} onChange={(e) => setName(e.target.value)} disabled={!free.length}><option value="">{free.length ? "Choose" : "None to connect"}</option>{free.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</Select></Field>}
      <Field label="Serial number" required><Input required value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} placeholder={printer ? "On the printer's label" : "On the scanner's label"} className="font-mono" /></Field>
      <Field label="Bill number" required><Input required value={bill} onChange={(e) => setBill(e.target.value.toUpperCase())} placeholder="On your Mindware bill" className="font-mono" /></Field>
      <Button type="submit" loading={saving} disabled={!serial.trim() || !bill.trim() || (chooseQueue && !name)}>{printer ? "Connect printer" : "Connect scanner"}</Button>
    </form>
  );

  return (
    <section aria-label={printer ? "Connect a printer" : "Connect a scanner"} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Icon className="h-4 w-4" />{printer ? "Connect a Mindware printer" : "Connect a Mindware scanner"}</h2>
        {required && <Badge color={working.length ? "green" : "amber"}>{working.length ? `${working.length} connected` : printer ? "Needed before printing" : "Needed before scanning"}</Badge>}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {notice && <div className="mt-3"><Alert tone="green">{notice}</Alert></div>}
      {printer ? (
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
          <div className="flex gap-3">{step(2, !!working.length, "Step 2")}{form}</div>
        </div>
      ) : <div className="mt-3 flex">{form}</div>}
      {!!mine.length && (
        <>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {mine.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span><span className="font-medium">{p.model}</span>{p.printerName && <span className="text-slate-500"> · {p.printerName}</span>}<span className="block font-mono text-xs text-slate-500">Serial {p.serialNumber} · Bill {p.billNumber}</span></span>
                {p.disabled ? <Badge color="red">Disabled by Mindware</Badge> : <Badge color="green">{p.serialConfirmed ? "Serial confirmed by the printer" : "Connected"}</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3 w-3 shrink-0" />{printer ? "To change this printer, contact Mindware. They will disable the old one and add the new one." : "To change this scanner, contact Mindware. They will disable the old one and add the new one."}</p>
        </>
      )}
    </section>
  );
}
