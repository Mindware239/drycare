"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Eye, EyeOff, FileText, Mail, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import {
  BILL_MESSAGE_FIELDS, BILL_PAPERS, BILL_PRESETS, BILL_SECTIONS, DEFAULT_BILL_MESSAGES, billPaperSize, chooseBillTemplate, emptyBillSettings, renderBillMessage,
  type BillMessageField, type BillPaper, type BillTemplate, type BillTemplateSettings,
} from "@drycare/shared";
import { api, ApiError } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { BILL_SAMPLE_ORDER, BillDocument, type BillOrg } from "@/components/BillDocument";

const MM = 3.78;
const SAMPLE_VALUES = { customer: "Priya Mehta", shop: "Your shop", shopPhone: "98200 00000", invoice: "INV/2026/000123", order: "SHOP-2026-00123", pieces: 4, items: "Suit (2 pc), Saree (silk), Shirt ×2", total: "₹885.00", paid: "₹500.00", balance: "₹385.00", ready: "Sat, 7 Nov", upi: "yourshop@upi" };

/** A template drawn small, using the real bill. */
function Thumb({ template, org, width, logoSrc }: { template: BillTemplate; org: BillOrg; width: number; logoSrc: string | null }) {
  const size = billPaperSize(template);
  const scale = width / (size.widthMm * MM);
  const fullHeight = (size.heightMm || 170) * MM;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white grayscale-[.4]" style={{ width, height: fullHeight * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: size.widthMm * MM, pointerEvents: "none" }}>
        <BillDocument template={template} order={BILL_SAMPLE_ORDER} org={org} logoSrc={logoSrc} />
      </div>
    </div>
  );
}

/** Choose a ready-made bill format, copy and edit one, and write the WhatsApp and email versions. */
export function BillTemplates({ org, saved, onSaved }: { org: BillOrg & { settings: Record<string, any> }; saved?: BillTemplateSettings; onSaved: () => void }) {
  const [settings, setSettings] = useState<BillTemplateSettings>(() => ({ ...emptyBillSettings(), ...saved }));
  const [editing, setEditing] = useState<BillTemplate | null>(null);
  const [tab, setTab] = useState<"formats" | "messages">("formats");
  const [msg, setMsg] = useState<{ t: "green" | "red"; m: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const logoSrc = org.hasLogo ? "/api/v1/organizations/current/logo" : null;
  const legacyPaper = org.settings.billing?.invoice?.paper;
  const current = chooseBillTemplate(settings, legacyPaper);

  async function persist(next: BillTemplateSettings, ok: string) {
    setSaving(true);
    setMsg(null);
    try {
      await api("/organizations/current", { method: "PATCH", body: { settings: { billTemplates: next } } });
      setSettings(next);
      setMsg({ t: "green", m: ok });
      onSaved();
      return true;
    } catch (e) {
      setMsg({ t: "red", m: (e as ApiError).message });
      return false;
    } finally {
      setSaving(false);
    }
  }
  const copyOf = (t: BillTemplate, name = `${t.name} (my copy)`): BillTemplate => ({ ...t, id: crypto.randomUUID(), name: name.slice(0, 60) });
  const saveEdit = async () => {
    if (!editing) return;
    const exists = settings.templates.some((t) => t.id === editing.id);
    const templates = exists ? settings.templates.map((t) => (t.id === editing.id ? editing : t)) : [...settings.templates, editing];
    if (await persist({ ...settings, templates }, `${editing.name} saved.`)) setEditing(null);
  };

  if (editing) return <Card title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-700" />Edit bill template</span>}><Editor template={editing} org={org} logoSrc={logoSrc} onChange={setEditing} onSave={saveEdit} onCancel={() => setEditing(null)} saving={saving} error={msg?.t === "red" ? msg.m : ""} /></Card>;

  return (
    <div id="bill-templates" className="scroll-mt-20">
      <Card title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-700" />Bill templates</span>} actions={
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {([["formats", "Print & PDF formats"], ["messages", "WhatsApp & email"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key} className={cx("rounded-md px-3 py-1 text-sm font-semibold", tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}>{label}</button>)}
        </div>
      }>
        {msg && <div className="mb-4"><Alert tone={msg.t} onClose={() => setMsg(null)}>{msg.m}</Alert></div>}
        {tab === "formats" ? (
          <>
            <p className="mb-4 text-sm text-slate-600">Pick the format your bills print in. To change one, press Edit and it becomes your own copy. Any format can also be saved as a PDF from the print window.</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {[...BILL_PRESETS, ...settings.templates].map((t) => {
                const mine = settings.templates.some((x) => x.id === t.id);
                const isDefault = current.id === t.id;
                return (
                  <article key={t.id} className={cx("flex flex-col gap-2 rounded-xl border p-3", isDefault ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200")}>
                    <div className="flex h-44 items-start justify-center overflow-hidden rounded-lg bg-slate-100 p-2"><Thumb template={t} org={org} width={billPaperSize(t).widthMm < 100 ? 96 : 130} logoSrc={logoSrc} /></div>
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">{BILL_PAPERS[t.paper].label}{mine ? <Badge color="brand">Mine</Badge> : <Badge color="slate">Ready-made</Badge>}{isDefault && <Badge color="green"><Check className="h-3 w-3" />In use</Badge>}</p>
                    <div className="mt-auto flex flex-wrap gap-1">
                      {!isDefault && <Button size="sm" onClick={() => void persist({ ...settings, defaultId: t.id }, `${t.name} is now your bill format.`)} loading={saving}>Use this</Button>}
                      <Button size="sm" variant="secondary" onClick={() => setEditing(mine ? t : copyOf(t))}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                      {mine && <Button size="sm" variant="ghost" aria-label={`Copy ${t.name}`} onClick={() => void persist({ ...settings, templates: [...settings.templates, copyOf(t, `${t.name} copy`)] }, "Copied.")}><Copy className="h-3.5 w-3.5" /></Button>}
                      {mine && <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => void persist({ ...settings, templates: settings.templates.filter((x) => x.id !== t.id), defaultId: settings.defaultId === t.id ? null : settings.defaultId }, `${t.name} deleted.`)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </article>
                );
              })}
              <button type="button" onClick={() => setEditing({ ...copyOf(BILL_PRESETS[2], "My bill"), paper: "custom", widthMm: 100, heightMm: 150, marginMm: 6, textSize: 85 })} className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700"><Plus className="h-5 w-5" />New format, any size</button>
            </div>
          </>
        ) : <Messages settings={settings} saving={saving} onSave={(messages) => void persist({ ...settings, messages }, "WhatsApp and email messages saved.")} />}
      </Card>
    </div>
  );
}

function Editor({ template: t, org, logoSrc, onChange, onSave, onCancel, saving, error }: { template: BillTemplate; org: BillOrg; logoSrc: string | null; onChange: (t: BillTemplate) => void; onSave: () => void; onCancel: () => void; saving: boolean; error: string }) {
  const set = (patch: Partial<BillTemplate>) => onChange({ ...t, ...patch });
  const size = billPaperSize(t);
  const narrow = size.widthMm < 100;
  const move = (i: number, by: number) => {
    const list = [...t.sections];
    const [item] = list.splice(i, 1);
    list.splice(i + by, 0, item);
    set({ sections: list });
  };
  const previewWidth = 520;
  const scale = Math.min(1, previewWidth / (size.widthMm * MM));
  const tick = (key: keyof BillTemplate, label: string) => <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={t[key] as boolean} onChange={(e) => set({ [key]: e.target.checked })} />{label}</label>;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Template name" required><Input value={t.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paper">
            <Select value={t.paper} onChange={(e) => { const paper = e.target.value as BillPaper; const p = BILL_PAPERS[paper]; set({ paper, widthMm: p.widthMm, heightMm: p.heightMm }); }}>
              {Object.entries(BILL_PAPERS).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Blank edge (mm)"><Input type="number" min={0} max={30} value={t.marginMm} onChange={(e) => set({ marginMm: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
          {t.paper === "custom" && <Field label="Width (mm)"><Input type="number" min={40} max={420} value={t.widthMm} onChange={(e) => set({ widthMm: Math.min(420, Math.max(40, Number(e.target.value) || 40)) })} /></Field>}
          {t.paper === "custom" && <Field label="Height (mm)" hint="0 grows with the bill"><Input type="number" min={0} max={600} value={t.heightMm} onChange={(e) => set({ heightMm: Math.min(600, Math.max(0, Number(e.target.value) || 0)) })} /></Field>}
          <Field label="Text size (%)"><Input type="number" min={70} max={150} step={5} value={t.textSize} onChange={(e) => set({ textSize: Math.min(150, Math.max(70, Number(e.target.value) || 100)) })} /></Field>
          <Field label="Font"><Select value={t.font} onChange={(e) => set({ font: e.target.value as BillTemplate["font"] })}><option value="sans">Clean</option><option value="serif">Traditional</option><option value="mono">Receipt</option></Select></Field>
          <Field label="Heading"><Select value={t.headerStyle} onChange={(e) => set({ headerStyle: e.target.value as BillTemplate["headerStyle"] })}><option value="plain">Left with a line</option><option value="centered">Centred</option><option value="band">Colour band</option></Select></Field>
          <Field label="Colour"><Input type="color" value={t.accent} onChange={(e) => set({ accent: e.target.value })} className="h-10 p-1" /></Field>
          <Field label="Bill title" className="col-span-2" hint="Leave blank to use the title in Invoice details"><Input value={t.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} placeholder="TAX INVOICE" /></Field>
        </div>
        <section>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">What the bill shows, top to bottom</h3>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {t.sections.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1 px-2 py-1.5">
                <span className={cx("min-w-0 flex-1 truncate text-sm", s.show ? "text-slate-800" : "text-slate-400")}>{BILL_SECTIONS[s.key]}</span>
                <button type="button" aria-label={`${s.show ? "Hide" : "Show"} ${BILL_SECTIONS[s.key]}`} onClick={() => set({ sections: t.sections.map((x) => (x.key === s.key ? { ...x, show: !x.show } : x)) })} className="rounded p-1 text-slate-500 hover:bg-slate-100">{s.show ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
                <button type="button" aria-label={`Move ${BILL_SECTIONS[s.key]} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label={`Move ${BILL_SECTIONS[s.key]} down`} disabled={i === t.sections.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Details</h3>
          <div className="grid grid-cols-2 gap-2">
            {tick("showLogo", "Logo")}
            {tick("showBank", "Bank details")}
            {tick("showUpiQr", "UPI QR when money is due")}
            {([["colour", "Garment colour"], ["condition", "Stains and damage"], ...(narrow ? [["rate", "Rate"]] : [["rate", "Rate"], ["sac", "SAC code"], ["taxable", "Taxable value"], ["gst", "GST column"]])] as [keyof BillTemplate["columns"], string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={t.columns[key]} onChange={(e) => set({ columns: { ...t.columns, [key]: e.target.checked } })} />{label}</label>
            ))}
          </div>
        </section>
        <Field label="Your words at the top"><Textarea rows={2} maxLength={400} value={t.topNote} onChange={(e) => set({ topNote: e.target.value })} placeholder="e.g. Festival offer: 10% off this month" /></Field>
        <Field label="Your words at the end"><Textarea rows={2} maxLength={400} value={t.bottomNote} onChange={(e) => set({ bottomNote: e.target.value })} placeholder="e.g. Follow us on Instagram" /></Field>
        <p className="text-xs text-slate-500">Terms, bank details, logo and footer message come from Invoice &amp; payment details above.</p>
        <div className="flex gap-2"><Button onClick={onSave} loading={saving} disabled={t.name.trim().length < 2}>Save template</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
      </div>
      <div className="xl:sticky xl:top-20 xl:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Live preview with a sample bill · {size.widthMm} × {size.heightMm ? `${size.heightMm} mm` : "as long as needed"}</p>
        <div className="overflow-auto rounded-xl bg-slate-100 p-4 xl:max-h-[calc(100vh-8rem)]">
          <div className="mx-auto shadow-lg" style={{ width: size.widthMm * MM * scale, height: size.heightMm ? size.heightMm * MM * scale : undefined }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: size.widthMm * MM }}>
              <BillDocument template={t} order={BILL_SAMPLE_ORDER} org={org} logoSrc={logoSrc} qrSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M0 0h4v4H0zM6 0h4v4H6zM0 6h4v4H0zM6 6h2v2H6zM8 8h2v2H8z'/%3E%3C/svg%3E" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Messages({ settings, saving, onSave }: { settings: BillTemplateSettings; saving: boolean; onSave: (m: BillTemplateSettings["messages"]) => void }) {
  const [m, setM] = useState(settings.messages);
  const [focus, setFocus] = useState<"whatsapp" | "emailSubject" | "emailBody">("whatsapp");
  const changed = useMemo(() => JSON.stringify(m) !== JSON.stringify(settings.messages), [m, settings.messages]);
  const insert = (field: BillMessageField) => setM((cur) => ({ ...cur, [focus]: `${cur[focus]}{{${field}}}` }));
  const box = "whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-800";
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Click a detail to add it to the box you are typing in. Real values replace it on each bill.</p>
      <div className="flex flex-wrap gap-1.5">{(Object.entries(BILL_MESSAGE_FIELDS) as [BillMessageField, string][]).map(([key, label]) => <button key={key} type="button" onClick={() => insert(key)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-400 hover:text-brand-700">+ {label}</button>)}</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MessageCircle className="h-4 w-4 text-emerald-600" />WhatsApp message</h3>
          <Textarea rows={11} aria-label="WhatsApp message" value={m.whatsapp} onFocus={() => setFocus("whatsapp")} onChange={(e) => setM({ ...m, whatsapp: e.target.value })} />
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
          <p className={box}>{renderBillMessage(m.whatsapp, SAMPLE_VALUES)}</p>
        </section>
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Mail className="h-4 w-4 text-blue-600" />Email</h3>
          <Input aria-label="Email subject" value={m.emailSubject} onFocus={() => setFocus("emailSubject")} onChange={(e) => setM({ ...m, emailSubject: e.target.value })} />
          <Textarea rows={9} aria-label="Email message" value={m.emailBody} onFocus={() => setFocus("emailBody")} onChange={(e) => setM({ ...m, emailBody: e.target.value })} />
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
          <p className={box}><b>{renderBillMessage(m.emailSubject, SAMPLE_VALUES)}</b>{"\n\n"}{renderBillMessage(m.emailBody, SAMPLE_VALUES)}</p>
        </section>
      </div>
      <div className="flex gap-2"><Button onClick={() => onSave(m)} loading={saving} disabled={!changed}>Save messages</Button><Button variant="ghost" onClick={() => setM(DEFAULT_BILL_MESSAGES)}>Restore the original wording</Button></div>
    </div>
  );
}
