"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Ban, Plus, Printer, Radio, Repeat, RotateCcw, ScanLine, X } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, Panel, dateLabel, useAdminData } from "../admin-ui";

type Policy = { printers: string[]; scanners: string[]; rfidReaders: string[]; driverUrl: string | null; requireDevices?: boolean };
type Sold = { id: string; deviceType: "printer" | "scanner"; note: string | null; serialNumber: string; billNumber: string; model: string; customerName: string | null; organizationName: string | null; soldOn: string | null; status: string; connectedAt: string | null };
const EMPTY = { deviceType: "printer" as "printer" | "scanner", serialNumber: "", billNumber: "", model: "", customerName: "", soldOn: "" };
const typeWord = (t: string) => (t === "scanner" ? "Scanner" : "Printer");

export default function HardwarePage() {
  const { data, error, reload } = useAdminData<Policy>("/platform-admin/hardware");
  const sold = useAdminData<Sold[]>("/platform-admin/sold-printers");
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<Sold | null>(null);
  useEffect(() => { if (data) setDraft({ ...data, driverUrl: data.driverUrl ?? "" }); }, [data]);
  const changed = !!draft && !!data && JSON.stringify({ ...draft, driverUrl: draft.driverUrl || null }) !== JSON.stringify({ ...data, driverUrl: data.driverUrl || null });

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      await api("/platform-admin/hardware", { method: "PUT", body: { ...draft, driverUrl: draft.driverUrl || null } });
      setNotice("Saved. Keys you issue or renew from now on carry this.");
      await reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  async function addSold(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setSaveError("");
    setNotice("");
    try {
      await api("/platform-admin/sold-printers", { body: { ...form, customerName: form.customerName || undefined, soldOn: form.soldOn || undefined } });
      setNotice(`${typeWord(form.deviceType)} ${form.serialNumber} recorded. It can now be connected at installation.`);
      setForm(EMPTY);
      await sold.reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setAdding(false);
    }
  }
  async function setStatus(p: Sold, status: string) {
    setSaveError("");
    try {
      await api(`/platform-admin/sold-printers/${p.id}/status`, { body: { status } });
      await sold.reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save.");
    }
  }

  return (
    <>
      <ConsoleHeader
        title="Printers & scanners"
        description="Every printer and scanner Mindware has sold, by serial number, and who is using it."
        actions={<Button onClick={() => void save()} loading={saving} disabled={!changed}>Save changes</Button>}
      />
      <div className="mb-5 space-y-3">
        {(error || saveError || sold.error) && <Alert>{error || saveError || sold.error}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
        <Alert tone="amber">A PC works offline, so it learns about changes only from its license key. After selling, disabling or replacing a device for a shop on the PC edition, renew that shop&apos;s key with the same customer name.</Alert>
      </div>

      <Panel title={<span className="flex items-center gap-2"><Printer className="h-4 w-4 text-brand-700" />Printers and scanners sold by Mindware</span>} description="Each serial number can exist only once. At installation the serial number and bill number connect the device to the shop. Shops cannot remove a device: only you can disable or replace it here." padded={false}>
        {replacing && <ReplaceDevice device={replacing} onClose={() => setReplacing(null)} onDone={async (text) => { setReplacing(null); setNotice(text); await sold.reload(); }} />}
        <form onSubmit={addSold} className="grid items-end gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-7">
          <Field label="Device" required><Select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value as "printer" | "scanner" })}><option value="printer">Printer</option><option value="scanner">Scanner</option></Select></Field>
          <Field label="Serial number" required><Input required value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value.toUpperCase() })} className="font-mono" /></Field>
          <Field label="Bill number" required><Input required value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value.toUpperCase() })} className="font-mono" /></Field>
          <Field label="Model" required><Input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={form.deviceType === "scanner" ? "e.g. Honeywell HH400" : "e.g. TSC TE244"} /></Field>
          <Field label="Customer" hint="Same name as on their license key"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
          <Field label="Sold on"><Input type="date" value={form.soldOn} onChange={(e) => setForm({ ...form, soldOn: e.target.value })} /></Field>
          <Button type="submit" loading={adding} disabled={!form.serialNumber.trim() || !form.billNumber.trim() || form.model.trim().length < 2}><Plus className="h-4 w-4" />Add device</Button>
        </form>
        {!sold.data ? <div className="p-5"><LoadingRows /></div> : !sold.data.length ? <EmptyState icon={Printer} title="No devices recorded yet">Until a device is recorded here, its serial number and bill number will not connect.</EmptyState> : (
          <DataTable minWidth={860} head={["Device", "Serial number", "Bill number", "Model", "Customer", "Status", ""]}>
            {sold.data.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-3">{typeWord(p.deviceType)}</td>
                <td className="px-5 py-3 font-mono text-xs font-semibold">{p.serialNumber}</td>
                <td className="px-5 py-3 font-mono text-xs">{p.billNumber}</td>
                <td className="px-5 py-3">{p.model}{p.soldOn && <span className="block text-xs text-slate-500">Sold {dateLabel(p.soldOn)}</span>}{p.note && <span className="block text-xs text-slate-500">{p.note}</span>}</td>
                <td className="px-5 py-3">{p.organizationName ?? p.customerName ?? "—"}</td>
                <td className="px-5 py-3">{p.status === "revoked" ? <Badge color="red">Disabled</Badge> : p.connectedAt ? <Badge color="green">Connected {dateLabel(p.connectedAt)}</Badge> : <Badge color="slate">Not connected yet</Badge>}</td>
                <td className="px-5 py-3 text-end">{p.status === "revoked"
                  ? <Button size="sm" variant="ghost" onClick={() => void setStatus(p, "active")}><RotateCcw className="h-3.5 w-3.5" />Allow</Button>
                  : <span className="inline-flex gap-1"><Button size="sm" variant="ghost" onClick={() => setReplacing(p)}><Repeat className="h-3.5 w-3.5" />Replace</Button><Button size="sm" variant="ghost" onClick={() => void setStatus(p, "revoked")}><Ban className="h-3.5 w-3.5" />Disable</Button></span>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {!draft ? <div className="mt-6"><Panel><LoadingRows /></Panel></div> : (
        <div className="mt-6 space-y-6">
          <Panel title="Require registered devices" description="When on, a shop with a paid plan must connect a registered printer to print tags and a registered scanner to scan. Free trials are not held to this. Applies to cloud shops; a PC follows its license key.">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={draft.requireDevices !== false} onChange={(e) => setDraft({ ...draft, requireDevices: e.target.checked })} />Printer and scanner are mandatory for paying shops</label>
          </Panel>
          <Panel title="Printer driver link" description="Shown to the installer as the first step. Leave it blank if you install from your own files.">
            <Input value={draft.driverUrl ?? ""} onChange={(e) => setDraft({ ...draft, driverUrl: e.target.value })} placeholder="https://…" aria-label="Driver download link" />
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <ModelList icon={ScanLine} title="Approved barcode scanners" help="Shown to shops on the scanner test screen. A USB scanner types into the computer like a keyboard, so the software cannot tell which model is plugged in: the serial number above is what it checks." placeholder="e.g. Honeywell HH400" models={draft.scanners} onChange={(scanners) => setDraft({ ...draft, scanners })} />
            <ModelList icon={Radio} title="Approved RFID terminals and readers" help="Handheld terminals and USB readers, for your own reference, for the same reason. Any reader works once it is set to type each tag's number into the selected box." placeholder="e.g. Zebra MC3300x" models={draft.rfidReaders} onChange={(rfidReaders) => setDraft({ ...draft, rfidReaders })} />
          </div>
        </div>
      )}
    </>
  );
}

/** Disables a device and records its replacement for the same shop. */
function ReplaceDevice({ device, onClose, onDone }: { device: Sold; onClose: () => void; onDone: (text: string) => void | Promise<void> }) {
  const [f, setF] = useState({ serialNumber: "", billNumber: "", model: device.model, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/platform-admin/sold-printers/${device.id}/replace`, { body: f });
      await onDone(`${device.serialNumber} is disabled and ${f.serialNumber} is recorded for the same shop. Connect it at the shop with its serial and bill number.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid items-end gap-3 border-b border-slate-100 bg-amber-50/50 p-5 sm:grid-cols-2 xl:grid-cols-5">
      <p className="text-sm font-semibold text-slate-900 sm:col-span-2 xl:col-span-5">Replace {typeWord(device.deviceType).toLowerCase()} {device.serialNumber}{device.organizationName || device.customerName ? ` for ${device.organizationName ?? device.customerName}` : ""}</p>
      {error && <div className="sm:col-span-2 xl:col-span-5"><Alert>{error}</Alert></div>}
      <Field label="New serial number" required><Input required value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value.toUpperCase() })} className="font-mono" /></Field>
      <Field label="New bill number" required><Input required value={f.billNumber} onChange={(e) => setF({ ...f, billNumber: e.target.value.toUpperCase() })} className="font-mono" /></Field>
      <Field label="Model" required><Input required value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
      <Field label="Reason" required><Input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Faulty, replaced under warranty" /></Field>
      <div className="flex gap-2"><Button type="submit" loading={busy}>Replace</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
    </form>
  );
}

function ModelList({ icon: Icon, title, help, placeholder, models, onChange }: { icon: typeof Printer; title: string; help: string; placeholder: string; models: string[]; onChange: (models: string[]) => void }) {
  const [value, setValue] = useState("");
  function add(event: FormEvent) {
    event.preventDefault();
    const model = value.trim();
    if (model.length < 2) return;
    if (!models.some((m) => m.toLowerCase() === model.toLowerCase())) onChange([...models, model]);
    setValue("");
  }
  return (
    <Panel title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-700" />{title}</span>} description={help}>
      <form onSubmit={add} className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} maxLength={120} aria-label={`Add to ${title}`} />
        <Button type="submit" variant="secondary" disabled={value.trim().length < 2}>Add</Button>
      </form>
      {models.length === 0 ? <p className="mt-4 text-sm text-slate-500">Nothing added yet.</p> : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {models.map((model) => (
            <li key={model} className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-slate-800">
              {model}
              <button type="button" onClick={() => onChange(models.filter((m) => m !== model))} aria-label={`Remove ${model}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
