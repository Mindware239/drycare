"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ScanLine, Printer, X } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Button, Input } from "@/components/ui";
import { ConsoleHeader, LoadingRows, Panel, useAdminData } from "../admin-ui";

type Policy = { printers: string[]; scanners: string[] };

export default function HardwarePage() {
  const { data, error, reload } = useAdminData<Policy>("/platform-admin/hardware");
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const changed = !!draft && JSON.stringify(draft) !== JSON.stringify(data);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      await api("/platform-admin/hardware", { method: "PUT", body: draft });
      setNotice("Saved. Keys you issue or renew from now on carry this list.");
      await reload();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ConsoleHeader
        title="Printers & scanners"
        description="The hardware you accept across all customers."
        actions={<Button onClick={() => void save()} loading={saving} disabled={!changed}>Save changes</Button>}
      />
      <div className="mb-5 space-y-3">
        {(error || saveError) && <Alert>{error || saveError}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
        <Alert tone="amber">A PC works offline, so it only learns this list from its license key. After changing it, renew the key for each PC that should follow the new list. Keys already issued keep the list they were signed with.</Alert>
      </div>
      {!draft ? <Panel><LoadingRows /></Panel> : (
        <div className="grid gap-6 xl:grid-cols-2">
          <ModelList
            icon={Printer}
            title="Approved tag printers"
            help="Enforced in Drycare for PC. Enter part of the model name, such as TSC TE244. Any other printer cannot be chosen or printed to. If this list is empty, every printer is allowed. Printing from a web browser goes through the browser's own print dialog, so it cannot be limited."
            placeholder="e.g. TSC TE244"
            models={draft.printers}
            onChange={(printers) => setDraft({ ...draft, printers })}
          />
          <ModelList
            icon={ScanLine}
            title="Approved barcode scanners"
            help="Shown to shops on the scanner test screen, but not blocked. A USB scanner types into the computer like a keyboard, so the software cannot tell which model is connected."
            placeholder="e.g. Honeywell HH400"
            models={draft.scanners}
            onChange={(scanners) => setDraft({ ...draft, scanners })}
          />
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
