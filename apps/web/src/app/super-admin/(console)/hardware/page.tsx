"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Ban, Plus, Printer, Radio, RotateCcw, ScanLine, X } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, Panel, dateLabel, useAdminData } from "../admin-ui";

type Policy = { printers: string[]; scanners: string[]; rfidReaders: string[]; driverUrl: string | null };
type Sold = { id: string; serialNumber: string; billNumber: string; model: string; customerName: string | null; organizationName: string | null; soldOn: string | null; status: string; connectedAt: string | null };
const EMPTY = { serialNumber: "", billNumber: "", model: "", customerName: "", soldOn: "" };

export default function HardwarePage() {
  const { data, error, reload } = useAdminData<Policy>("/platform-admin/hardware");
  const sold = useAdminData<Sold[]>("/platform-admin/sold-printers");
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
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
      setNotice(`Printer ${form.serialNumber} recorded. It can now be connected at installation.`);
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
        description="Tag printers Mindware has sold, and the scanners and RFID readers you accept."
        actions={<Button onClick={() => void save()} loading={saving} disabled={!changed}>Save changes</Button>}
      />
      <div className="mb-5 space-y-3">
        {(error || saveError || sold.error) && <Alert>{error || saveError || sold.error}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
        <Alert tone="amber">A PC works offline, so it learns about new printers only from its license key. After selling a printer to a shop on the PC edition, renew that shop&apos;s key with the same customer name, then connect the printer.</Alert>
      </div>

      <Panel title={<span className="flex items-center gap-2"><Printer className="h-4 w-4 text-brand-700" />Tag printers sold by Mindware</span>} description="Any model can be sold. At installation the driver goes on first, then the serial number and bill number connect the printer. A printer with no match cannot be connected." padded={false}>
        <form onSubmit={addSold} className="grid items-end gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="Serial number" required><Input required value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value.toUpperCase() })} className="font-mono" /></Field>
          <Field label="Bill number" required><Input required value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value.toUpperCase() })} className="font-mono" /></Field>
          <Field label="Model" required><Input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. TSC TE244" /></Field>
          <Field label="Customer" hint="Same name as on their license key"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
          <Field label="Sold on"><Input type="date" value={form.soldOn} onChange={(e) => setForm({ ...form, soldOn: e.target.value })} /></Field>
          <Button type="submit" loading={adding} disabled={!form.serialNumber.trim() || !form.billNumber.trim() || form.model.trim().length < 2}><Plus className="h-4 w-4" />Add printer</Button>
        </form>
        {!sold.data ? <div className="p-5"><LoadingRows /></div> : !sold.data.length ? <EmptyState icon={Printer} title="No printers recorded yet">Until a printer is recorded here, its serial number and bill number will not connect.</EmptyState> : (
          <DataTable minWidth={780} head={["Serial number", "Bill number", "Model", "Customer", "Status", ""]}>
            {sold.data.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-3 font-mono text-xs font-semibold">{p.serialNumber}</td>
                <td className="px-5 py-3 font-mono text-xs">{p.billNumber}</td>
                <td className="px-5 py-3">{p.model}{p.soldOn && <span className="block text-xs text-slate-500">Sold {dateLabel(p.soldOn)}</span>}</td>
                <td className="px-5 py-3">{p.organizationName ?? p.customerName ?? "—"}</td>
                <td className="px-5 py-3">{p.status === "revoked" ? <Badge color="red">Blocked</Badge> : p.connectedAt ? <Badge color="green">Connected {dateLabel(p.connectedAt)}</Badge> : <Badge color="slate">Not connected yet</Badge>}</td>
                <td className="px-5 py-3 text-right">{p.status === "revoked"
                  ? <Button size="sm" variant="ghost" onClick={() => void setStatus(p, "active")}><RotateCcw className="h-3.5 w-3.5" />Allow</Button>
                  : <Button size="sm" variant="ghost" onClick={() => void setStatus(p, "revoked")}><Ban className="h-3.5 w-3.5" />Block</Button>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {!draft ? <div className="mt-6"><Panel><LoadingRows /></Panel></div> : (
        <div className="mt-6 space-y-6">
          <Panel title="Printer driver link" description="Shown to the installer as the first step. Leave it blank if you install from your own files.">
            <Input value={draft.driverUrl ?? ""} onChange={(e) => setDraft({ ...draft, driverUrl: e.target.value })} placeholder="https://…" aria-label="Driver download link" />
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <ModelList icon={ScanLine} title="Approved barcode scanners" help="Shown to shops on the scanner test screen, but not blocked. A USB scanner types into the computer like a keyboard, so the software cannot tell which model is connected." placeholder="e.g. Honeywell HH400" models={draft.scanners} onChange={(scanners) => setDraft({ ...draft, scanners })} />
            <ModelList icon={Radio} title="Approved RFID terminals and readers" help="Handheld terminals and USB readers, for your own reference, for the same reason. Any reader works once it is set to type each tag's number into the selected box." placeholder="e.g. Zebra MC3300x" models={draft.rfidReaders} onChange={(rfidReaders) => setDraft({ ...draft, rfidReaders })} />
          </div>
        </div>
      )}
    </>
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
