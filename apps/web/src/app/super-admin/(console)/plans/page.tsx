"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Plus, Store } from "lucide-react";
import { CORE_FEATURE_LABELS, FEATURES, PLAN_FEATURE_KEYS } from "@drycare/shared";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Alert, Badge, Button, Field, Input, Modal, Select } from "@/components/ui";
import { ConsoleHeader, EmptyState, LoadingRows, Panel, useAdminData } from "../admin-ui";

type Plan = {
  id: string; code: string; name: string; description: string | null; pricePaise: number; currency: string; interval: string;
  gstInclusive: boolean; trialEligible: boolean; deviceLimit: number; branchLimit: number; entitlements: Record<string, boolean>;
  published: boolean; sortOrder: number; updatedAt: string;
};

export default function PlansPage() {
  const { data, error, reload } = useAdminData<Plan[]>("/platform-admin/plans");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const plans = data?.filter((p) => !p.code.startsWith("smoke-")) ?? null;
  const testPlans = data?.filter((p) => p.code.startsWith("smoke-")).length ?? 0;

  return (
    <>
      <ConsoleHeader
        title="Plans & pricing"
        description="Plans shown on the public pricing page and used when you activate a customer's subscription. A plan needs an approved price before it can be published. Changing a price affects new subscriptions only; customers already paying keep their current period."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New plan</Button>}
      />
      <div className="mb-6"><ReferralPanel /></div>
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-5"><Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert></div>}
      {!plans ? <Panel><LoadingRows /></Panel> : plans.length === 0 ? <Panel><EmptyState icon={Store} title="No plans yet">Create your first plan, set its price and publish it.</EmptyState></Panel> : (
        <div className="space-y-5">
          {plans.map((plan) => <PlanEditor key={`${plan.id}-${plan.updatedAt}`} plan={plan} onSaved={(msg) => { setNotice(msg); void reload(); }} />)}
          {testPlans > 0 && <p className="text-xs text-slate-400">{testPlans} automated-test plan{testPlans === 1 ? " is" : "s are"} hidden from this list.</p>}
        </div>
      )}
      {creating && <CreatePlan onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setNotice("Plan created as an unpublished draft. Set its price and features, then publish it."); void reload(); }} />}
    </>
  );
}

function PlanEditor({ plan, onSaved }: { plan: Plan; onSaved: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [price, setPrice] = useState(String(plan.pricePaise / 100));
  const [published, setPublished] = useState(plan.published);
  const priceChanged = Math.round(Number(price) * 100) !== plan.pricePaise;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await api(`/platform-admin/plans/${plan.id}`, {
        method: "PATCH",
        body: {
          name: String(form.get("name")),
          description: String(form.get("description")) || null,
          pricePaise: Math.round(Number(price) * 100),
          interval: String(form.get("interval")),
          gstInclusive: form.get("gstInclusive") === "on",
          trialEligible: form.get("trialEligible") === "on",
          deviceLimit: Number(form.get("deviceLimit")),
          branchLimit: Number(form.get("branchLimit")),
          sortOrder: Number(form.get("sortOrder")),
          published,
          entitlements: Object.fromEntries(PLAN_FEATURE_KEYS.map((key) => [key, form.get(`feature-${key}`) === "on"])),
        },
      });
      onSaved(`${String(form.get("name"))} saved${published ? " and visible on the pricing page" : ""}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{plan.name}</h2>
          <Badge color={published ? "green" : "amber"}>{published ? "Published" : "Draft"}</Badge>
          <span className="font-mono text-xs text-slate-400">{plan.code}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-slate-700">{money(Math.round(Number(price || 0) * 100))}<span className="font-normal text-slate-400"> / {plan.interval === "year" ? "year" : "month"}</span></span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPublished((p) => !p)} aria-pressed={published}>{published ? <><EyeOff className="h-4 w-4" />Unpublish</> : <><Eye className="h-4 w-4" />Publish</>}</Button>
          <Button type="submit" size="sm" loading={saving}>Save plan</Button>
        </div>
      </div>
      <div className="space-y-5 p-5">
        {error && <Alert>{error}</Alert>}
        <p className="text-xs text-slate-500">{plan.published ? "Offered to new customers." : "Hidden from new customers."} Changes to features and limits apply to new customers. Customers who already bought this plan keep what they bought and can still renew it.</p>
        {priceChanged && plan.published && <Alert tone="amber">The new price applies to new subscriptions only. Shops already paying keep their current price until their next renewal is recorded.</Alert>}
        {published && Number(price) <= 0 && <Alert tone="red">A published plan needs a price above ₹0.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Plan name" required><Input name="name" required minLength={2} maxLength={80} defaultValue={plan.name} /></Field>
          <Field label="Price (₹)" required><Input type="number" min="0" step="1" required value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Billing period"><Select name="interval" defaultValue={plan.interval}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Annual</option></Select></Field>
          <Field label="Display order" hint="Lower numbers appear first"><Input name="sortOrder" type="number" min="0" max="1000" defaultValue={plan.sortOrder} /></Field>
          <Field label="Windows computers allowed"><Input name="deviceLimit" type="number" min="1" max="1000" required defaultValue={plan.deviceLimit} /></Field>
          <Field label="Branches / outlets allowed"><Input name="branchLimit" type="number" min="1" max="1000" required defaultValue={plan.branchLimit} /></Field>
          <Field label="Short description" className="sm:col-span-2"><Input name="description" maxLength={500} defaultValue={plan.description ?? ""} placeholder="e.g. For a single shop with one billing counter" /></Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="gstInclusive" type="checkbox" defaultChecked={plan.gstInclusive} className="h-4 w-4 accent-brand-700" />Price includes GST</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="trialEligible" type="checkbox" defaultChecked={plan.trialEligible} className="h-4 w-4 accent-brand-700" />Free trial available</label>
        </div>
        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Included features</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PLAN_FEATURE_KEYS.map((key) => (
              <label key={key} className="flex items-start gap-2 text-sm text-slate-700" title={FEATURES[key].description}>
                <input name={`feature-${key}`} type="checkbox" defaultChecked={plan.entitlements[key] ?? FEATURES[key].whenUnset} className="mt-0.5 h-4 w-4 accent-brand-700" />
                <span>{FEATURES[key].label}<span className="block text-xs text-slate-500">{FEATURES[key].description}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Every plan includes: {CORE_FEATURE_LABELS.join(", ")}. To make an exception for one shop, open it under Customers.</p>
        </fieldset>
      </div>
    </form>
  );
}

function CreatePlan({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [interval, setInterval] = useState("month");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const suggested = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/platform-admin/plans", { body: { name, code: code || suggested, interval } });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="New plan" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-plan" loading={saving} disabled={name.trim().length < 2}>Create draft</Button></>}>
      <form id="new-plan" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Plan name" required><Input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Professional" /></Field>
        <Field label="Plan code" hint="Permanent identifier used in records. Lowercase letters, numbers and hyphens."><Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder={suggested || "professional"} /></Field>
        <Field label="Billing period"><Select value={interval} onChange={(e) => setInterval(e.target.value)}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Annual</option></Select></Field>
      </form>
    </Modal>
  );
}

function ReferralPanel() {
  const { data, reload } = useAdminData<{ code: string; percent: number; endsOn: string; active: boolean; used: number }>("/platform-admin/referral-offer");
  const [f, setF] = useState<{ code: string; percent: string; endsOn: string; active: boolean } | null>(null);
  const [message, setMessage] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ code: data.code, percent: String(data.percent), endsOn: data.endsOn, active: data.active }); }, [data]);
  if (!f || !data) return <Panel><LoadingRows rows={1} /></Panel>;
  const ended = f.endsOn < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/platform-admin/referral-offer", { method: "PUT", body: { code: f!.code.trim(), percent: Number(f!.percent), endsOn: f!.endsOn, active: f!.active } });
      setMessage({ tone: "green", text: "Saved. The website banner follows this." });
      await reload();
    } catch (e) {
      setMessage({ tone: "red", text: e instanceof Error ? e.message : "Could not save." });
    }
    setBusy(false);
  }
  return (
    <Panel title="Referral offer" description={`Takes a percentage off quarterly and yearly plans, for customers in India. Shown as a banner on the website until its last day. Used on ${data.used} paid ${data.used === 1 ? "subscription" : "subscriptions"}.`}>
      {message && <div className="mb-3"><Alert tone={message.tone === "green" ? "green" : undefined}>{message.text}</Alert></div>}
      <div className="grid items-end gap-3 sm:grid-cols-[1.4fr_120px_180px_auto_auto]">
        <Field label="Code"><Input value={f.code} maxLength={40} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Discount (%)"><Input type="number" min={1} max={90} value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>
        <Field label="Last day"><Input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        <label className="flex items-center gap-2 pb-2.5 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />On</label>
        <Button loading={busy} onClick={() => void save()}>Save</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{!f.active ? "Off: the code and banner are not available." : ended ? "This offer has ended, so the code and banner are not available." : "Live now on the website."}</p>
    </Panel>
  );
}
