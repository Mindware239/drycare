"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Building2, KeyRound, Search, ShieldCheck, Store, ToggleRight, TriangleAlert } from "lucide-react";
import { FEATURE_CATEGORIES, type FeatureCategory } from "@drycare/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ConsoleHeader, LoadingRows, MetricCard, Panel, useAdminData } from "../admin-ui";

type Feature = { key: string; label: string; description: string; category: FeatureCategory; dependsOn?: string[]; enabled: boolean; upgradeMessage: string; plans: string[]; allowedFor: number; blockedFor: number };
type Data = {
  summary: { plans: number; activePlans: number; customers: number; trial: number; active: number; suspended: number; standaloneLicenses: number; expiredLicenses: number; customersWithExceptions: number; extraGrants: number };
  features: Feature[];
};

export default function FeaturesPage() {
  const { data, error, reload } = useAdminData<Data>("/platform-admin/features");
  const [editing, setEditing] = useState<Feature | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState("");
  const q = query.trim().toLowerCase();
  const shown = data?.features.filter((f) => (!category || f.category === category) && (!q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || f.plans.some((p) => p.toLowerCase().includes(q))));
  const s = data?.summary;
  return (
    <>
      <ConsoleHeader title="Features & permissions" description="Every feature in Drycare, which plans include it, and who has an exception. Choose a plan's features in Plans & pricing, and one customer's in that customer's page." />
      <div className="mb-5 space-y-3">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Store} label="Plans" value={s ? `${s.activePlans} of ${s.plans}` : "—"} tone="emerald" detail="Published, of all plans" />
        <MetricCard icon={Building2} label="Customers" value={s?.customers ?? "—"} tone="violet" detail={s ? `${s.active} paying · ${s.trial} on trial · ${s.suspended} suspended` : ""} />
        <MetricCard icon={KeyRound} label="PC licenses" value={s?.standaloneLicenses ?? "—"} tone="emerald" detail={s ? `${s.expiredLicenses} expired` : ""} />
        <MetricCard icon={ShieldCheck} label="Customers with exceptions" value={s?.customersWithExceptions ?? "—"} tone="violet" detail={s ? `${s.extraGrants} extra features granted` : ""} />
      </div>
      {editing && <EditFeature feature={editing} onClose={() => setEditing(null)} onDone={async (text) => { setEditing(null); setNotice(text); await reload(); }} />}
      <Panel title={<span className="flex items-center gap-2"><ToggleRight className="h-4 w-4 text-brand-700" />All features</span>} description="Turning a feature off here removes it for every customer at once, whatever their plan or exception says. PC licenses pick this up when their key is next issued or renewed.">
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="relative min-w-52 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by feature or plan" className="ps-9" aria-label="Search features" /></label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Category"><option value="">All categories</option>{FEATURE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </div>
        {!shown ? <LoadingRows rows={8} /> : FEATURE_CATEGORIES.filter((c) => shown.some((f) => f.category === c)).map((c) => (
          <div key={c} className="mb-5 last:mb-0">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{c}</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {shown.filter((f) => f.category === c).map((f) => (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-60 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">{f.label}{f.enabled ? <Badge color="green">Available</Badge> : <Badge color="red">Off for everyone</Badge>}<span className="font-mono text-[11px] font-normal text-slate-400">{f.key}</span></p>
                    <p className="mt-0.5 text-xs text-slate-500">{f.description}</p>
                    <p className="mt-1 text-xs text-slate-600">{f.key === "rfid" ? "Sold separately, by paid period." : f.plans.length ? `In: ${f.plans.join(", ")}` : "In no published plan"}{f.allowedFor > 0 && ` · Added for ${f.allowedFor}`}{f.blockedFor > 0 && ` · Blocked for ${f.blockedFor}`}{f.dependsOn?.length ? " · Needs another feature" : ""}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>Edit</Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>
      <p className="mt-4 text-sm text-slate-600">To choose what a plan includes, open <Link href="/super-admin/plans" className="font-semibold underline">Plans & pricing</Link>. To change one customer, open them in <Link href="/super-admin/customers" className="font-semibold underline">Customers & businesses</Link>.</p>
    </>
  );
}

function EditFeature({ feature, onClose, onDone }: { feature: Feature; onClose: () => void; onDone: (text: string) => void | Promise<void> }) {
  const [enabled, setEnabled] = useState(feature.enabled);
  const [message, setMessage] = useState(feature.upgradeMessage);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/platform-admin/features/${feature.key}`, { method: "PUT", body: { enabled, upgradeMessage: message, reason } });
      await onDone(`${feature.label} saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-6"><Panel title={`Edit ${feature.label}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Available to customers</label>
        {!enabled && feature.enabled && <Alert tone="amber"><span className="inline-flex items-center gap-1.5"><TriangleAlert className="h-4 w-4" />Every cloud customer loses this at once, including those who paid for it. Their data is kept.</span></Alert>}
        <Field label="Upgrade message" hint="Shown to shops without this feature. Leave blank to show the description."><Textarea rows={2} maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={feature.description} /></Field>
        <Field label="Reason" required hint="Saved permanently in the audit log. Minimum 8 characters."><Input required minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex gap-2"><Button type="submit" loading={busy}>Save</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Panel></div>
  );
}
