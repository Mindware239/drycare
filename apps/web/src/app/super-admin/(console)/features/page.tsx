"use client";
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Building2, CircleAlert, CircleCheck, Eye, EyeOff, Info, KeyRound, Pencil, Plus, Search, ShieldCheck, Store, Trash2, Users } from "lucide-react";
import { FEATURE_CATEGORIES, formatMoney, type FeatureCategory } from "@drycare/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { ConsoleHeader, LoadingRows, MetricCard, Panel, SegmentedTabs, useAdminData } from "../admin-ui";

type Feature = {
  key: string; label: string; description: string; category: FeatureCategory; dependsOn?: string[]; custom: boolean; planManaged: boolean;
  enabled: boolean; upgradeMessage: string; inPlan: Record<string, boolean>; allowedFor: number; blockedFor: number;
};
type Plan = { id: string; name: string; published: boolean; pricePaise: number; currency: string; interval: string; subscribers: number; onOlderVersion: number };
type Check = { status: "ok" | "warn" | "info"; title: string; detail: string };
type Module = { path: string; label: string; feature?: string; why?: string };
type Data = {
  summary: { plans: number; activePlans: number; customers: number; trial: number; active: number; suspended: number; standaloneLicenses: number; expiredLicenses: number; customersWithExceptions: number; extraGrants: number };
  plans: Plan[];
  features: Feature[];
  modules: Module[];
  checks: Check[];
};
type Tab = "plans" | "check" | "always";
const cellKey = (planId: string, key: string) => `${planId}:${key}`;

export default function FeaturesPage() {
  const { data, error, reload } = useAdminData<Data>("/platform-admin/features");
  const [tab, setTab] = useState<Tab>("plans");
  const [editing, setEditing] = useState<Feature | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [applyExisting, setApplyExisting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => data?.features.filter((f) => (!category || f.category === category) && (!q || f.label.toLowerCase().includes(q) || f.description.toLowerCase().includes(q))), [data, category, q]);
  const s = data?.summary;
  const pending = Object.keys(changes).length;
  const touchedPlans = new Set(Object.keys(changes).map((k) => k.split(":")[0]));
  const affected = data?.plans.filter((p) => touchedPlans.has(p.id)).reduce((n, p) => n + p.subscribers, 0) ?? 0;

  function toggle(planId: string, f: Feature, on: boolean) {
    const key = cellKey(planId, f.key);
    setChanges((current) => {
      const next = { ...current };
      if (on === f.inPlan[planId]) delete next[key];
      else next[key] = on;
      return next;
    });
  }
  async function saveMatrix(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailure("");
    try {
      const list = Object.entries(changes).map(([k, on]) => { const [planId, key] = k.split(":"); return { planId, key, on }; });
      const r = await api<{ updatedCustomers: number }>("/platform-admin/features/matrix", { method: "PUT", body: { changes: list, applyToExisting: applyExisting, reason } });
      setNotice(applyExisting ? `Saved. New customers get this, and ${r.updatedCustomers} current customer${r.updatedCustomers === 1 ? " was" : "s were"} updated.` : "Saved for new customers. Current customers keep what they bought.");
      setChanges({});
      setReason("");
      setApplyExisting(false);
      await reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  async function setVisible(plan: Plan, published: boolean) {
    setFailure("");
    try {
      await api(`/platform-admin/plans/${plan.id}`, { method: "PATCH", body: { published } });
      setNotice(published ? `${plan.name} is now offered to new customers.` : `${plan.name} is hidden from new customers. Its ${plan.subscribers} current customer${plan.subscribers === 1 ? "" : "s"} keep it and can still renew.`);
      await reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not save.");
    }
  }

  return (
    <>
      <ConsoleHeader
        title="Features & permissions"
        description="Choose what each plan includes and which plans new customers can buy. Customers who already bought a plan keep what they bought."
        actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add feature</Button>}
      />
      <div className="mb-5 space-y-3">
        {(error || failure) && <Alert>{error || failure}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Store} label="Plans offered" value={s ? `${s.activePlans} of ${s.plans}` : "—"} tone="emerald" detail="Visible to new customers" />
        <MetricCard icon={Building2} label="Customers" value={s?.customers ?? "—"} tone="violet" detail={s ? `${s.active} paying · ${s.trial} on trial · ${s.suspended} suspended` : ""} />
        <MetricCard icon={KeyRound} label="PC licenses" value={s?.standaloneLicenses ?? "—"} tone="emerald" detail={s ? `${s.expiredLicenses} expired` : ""} />
        <MetricCard icon={ShieldCheck} label="Customers with exceptions" value={s?.customersWithExceptions ?? "—"} tone="violet" detail={s ? `${s.extraGrants} extra features granted` : ""} />
      </div>

      {editing && <EditFeature feature={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={async (text) => { setEditing(null); setNotice(text); await reload(); }} />}

      <div className="mb-4">
        <SegmentedTabs<Tab> value={tab} onChange={setTab} options={[
          { value: "plans", label: "Features by plan" },
          { value: "check", label: "Health check", count: data?.checks.filter((c) => c.status === "warn").length || undefined },
          { value: "always", label: "Always included" },
        ]} />
      </div>

      {tab === "plans" && (
        <Panel padded={false}>
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
            <label className="relative min-w-52 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a feature" className="ps-9" aria-label="Find a feature" /></label>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Category"><option value="">All categories</option>{FEATURE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          </div>
          {!data || !shown ? <div className="p-5"><LoadingRows rows={8} /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="align-top">
                    <th scope="col" className="sticky start-0 z-10 min-w-72 bg-slate-50 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-slate-500">Feature</th>
                    {data.plans.map((p) => (
                      <th key={p.id} scope="col" className={cx("min-w-40 border-s border-slate-100 px-3 py-3 text-center font-normal", p.published ? "bg-slate-50" : "bg-amber-50/60")}>
                        <span className="block text-sm font-semibold text-slate-900">{p.name}</span>
                        <span className="block text-xs text-slate-500">{formatMoney(p.pricePaise, p.currency, "en-IN").replace(/\.00$/, "")} / {p.interval === "year" ? "year" : "month"}</span>
                        <button type="button" onClick={() => void setVisible(p, !p.published)} aria-pressed={p.published} className={cx("dc-press mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", p.published ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>
                          {p.published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}{p.published ? "Offered to new" : "Hidden from new"}
                        </button>
                        <span className="mt-1.5 flex items-center justify-center gap-1 text-xs text-slate-500"><Users className="h-3 w-3" />{p.subscribers} current</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_CATEGORIES.filter((c) => shown.some((f) => f.category === c)).map((c) => (
                    <FragmentRows key={c} title={c} cols={data.plans.length + 1}>
                      {shown.filter((f) => f.category === c).map((f) => (
                        <tr key={f.key} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <th scope="row" className="sticky start-0 z-10 bg-white px-4 py-2.5 text-start font-normal">
                            <span className="flex items-start justify-between gap-2">
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                                  {f.label}
                                  {!f.enabled && <Badge color="red">Off for everyone</Badge>}
                                  {f.custom && <Badge color="slate">Listed only</Badge>}
                                </span>
                                <span className="mt-0.5 block text-xs leading-4 text-slate-500">{f.description}</span>
                                {(f.allowedFor > 0 || f.blockedFor > 0) && <span className="mt-0.5 block text-xs text-amber-700">{[f.allowedFor > 0 && `Added for ${f.allowedFor}`, f.blockedFor > 0 && `Blocked for ${f.blockedFor}`].filter(Boolean).join(" · ")}</span>}
                              </span>
                              <button type="button" onClick={() => setEditing(f)} aria-label={`Edit ${f.label}`} className="dc-press shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                            </span>
                          </th>
                          {data.plans.map((p) => {
                            const key = cellKey(p.id, f.key);
                            const on = changes[key] ?? f.inPlan[p.id];
                            return (
                              <td key={p.id} className={cx("border-s border-slate-100 text-center", key in changes && "bg-amber-50")}>
                                {f.planManaged
                                  ? <input type="checkbox" checked={on} onChange={(e) => toggle(p.id, f, e.target.checked)} aria-label={`${f.label} in ${p.name}`} className="h-4 w-4 cursor-pointer accent-brand-700" />
                                  : <span className="text-xs text-slate-400">Sold separately</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </FragmentRows>
                  ))}
                </tbody>
              </table>
              {!shown.length && <p className="p-6 text-center text-sm text-slate-500">No feature matches that.</p>}
            </div>
          )}
          {pending > 0 && (
            <form onSubmit={saveMatrix} className="sticky bottom-0 z-20 flex flex-wrap items-end gap-3 border-t border-slate-200 bg-white p-4 shadow-[0_-8px_20px_rgba(21,21,20,.06)]">
              <div className="min-w-60 flex-1">
                <p className="text-sm font-semibold text-slate-900">{pending} change{pending === 1 ? "" : "s"} for new customers</p>
                <label className="mt-1 flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={applyExisting} onChange={(e) => setApplyExisting(e.target.checked)} />
                  <span>Also change this for the {affected} current customer{affected === 1 ? "" : "s"} on {touchedPlans.size === 1 ? "this plan" : "these plans"}<span className="block text-xs text-slate-500">Leave this off and they keep what they bought.</span></span>
                </label>
              </div>
              <Field label="Reason" required className="min-w-64"><Input required minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Saved in the audit log" /></Field>
              <div className="flex gap-2"><Button type="submit" loading={saving} disabled={reason.trim().length < 8}>Save</Button><Button type="button" variant="ghost" onClick={() => setChanges({})}>Undo</Button></div>
            </form>
          )}
        </Panel>
      )}

      {tab === "check" && (
        <Panel title="Health check" description="Run each time this page opens. It compares every screen in the software with this list, and looks for plans and customers that need attention.">
          {!data ? <LoadingRows rows={5} /> : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {data.checks.map((c) => (
                <li key={c.title} className="flex gap-3 p-3">
                  {c.status === "ok" ? <CircleCheck aria-label="Fine" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : c.status === "warn" ? <CircleAlert aria-label="Needs attention" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Info aria-label="For information" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                  <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{c.title}</p><p className="text-xs leading-5 text-slate-600">{c.detail}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "always" && (
        <Panel title="Every screen in the software" description="Screens with a feature can be switched off. The others are in every plan, for the reason shown. Tell your developer if one of these should become switchable.">
          {!data ? <LoadingRows rows={8} /> : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {data.modules.map((m) => (
                <li key={m.path} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="font-medium text-slate-900">{m.label}</span>
                  {m.feature ? <Badge color="green">Controlled by {data.features.find((f) => f.key === m.feature)?.label ?? m.feature}</Badge> : <span className="text-xs text-slate-500">Always included: {m.why}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <p className="mt-4 text-sm text-slate-600">Prices and limits are in <Link href="/super-admin/plans" className="font-semibold underline">Plans & pricing</Link>. To change one customer, open them in <Link href="/super-admin/customers" className="font-semibold underline">Customers & businesses</Link>.</p>
    </>
  );
}

function FragmentRows({ title, cols, children }: { title: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/70"><th colSpan={cols} scope="colgroup" className="sticky start-0 px-4 py-1.5 text-start text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</th></tr>
      {children}
    </>
  );
}

function EditFeature({ feature, onClose, onDone }: { feature: Feature | null; onClose: () => void; onDone: (text: string) => void | Promise<void> }) {
  const [label, setLabel] = useState(feature?.label ?? "");
  const [description, setDescription] = useState(feature?.description ?? "");
  const [category, setCategory] = useState<string>(feature?.category ?? FEATURE_CATEGORIES[0]);
  const [enabled, setEnabled] = useState(feature?.enabled ?? true);
  const [message, setMessage] = useState(feature?.upgradeMessage ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { label, description, category, enabled, upgradeMessage: message, reason };
      if (feature) await api(`/platform-admin/features/${feature.key}`, { method: "PUT", body });
      else await api("/platform-admin/features", { body });
      await onDone(feature ? `${label} saved.` : `${label} added. Tick it for the plans that include it.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!feature || reason.trim().length < 8) { setError("Give a reason (at least 8 characters) first."); return; }
    setBusy(true);
    try {
      await api(`/platform-admin/features/${feature.key}`, { method: "DELETE", body: { reason } });
      await onDone(`${feature.label} removed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove.");
      setBusy(false);
    }
  }
  return (
    <div className="mb-6"><Panel title={feature ? `Edit ${feature.label}` : "Add a feature"} description={!feature || feature.custom ? "A feature added here appears on plans and the pricing page, such as Priority support. It does not open or lock a screen by itself: that needs your developer." : undefined}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><Input required minLength={2} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Priority support" /></Field>
          <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{FEATURE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        </div>
        <Field label="Description" required><Textarea required rows={2} minLength={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Upgrade message" hint="Shown to shops without this feature. Leave blank to show the description."><Textarea rows={2} maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Available to customers</label>
        {feature && !enabled && feature.enabled && <Alert tone="amber">Every cloud customer loses this at once, including those who paid for it. Their data is kept.</Alert>}
        <Field label="Reason" required hint="Saved permanently in the audit log. Minimum 8 characters."><Input required minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>{feature ? "Save" : "Add feature"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          {feature?.custom && <Button type="button" variant="ghost" onClick={() => void remove()}><Trash2 className="h-3.5 w-3.5" />Remove</Button>}
        </div>
      </form>
    </Panel></div>
  );
}
