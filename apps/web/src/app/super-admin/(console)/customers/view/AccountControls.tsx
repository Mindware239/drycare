"use client";
import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Check, CircleSlash, Radio, SlidersHorizontal } from "lucide-react";
import { CORE_FEATURE_LABELS, FEATURES, PLAN_FEATURE_KEYS as FEATURE_KEYS, type FeatureKey, type FeatureMap, type FeatureOverrides } from "@drycare/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { LoadingRows, Panel, dateLabel, useAdminData } from "../../admin-ui";

type Entitlements = {
  expiry?: Partial<Record<FeatureKey, string>>;
  globallyOff?: string[];
  olderPlanVersion?: boolean;
  plan: { id: string; name: string; status: string; endsAt: string | null } | null;
  planFeatures: FeatureMap;
  overrides: FeatureOverrides;
  effective: FeatureMap;
  branches: { planLimit: number | null; override: number | null; limit: number | null; active: number };
};
type Plan = { id: string; name: string; code: string; published: boolean; interval: string };
type Choice = "plan" | "on" | "off";

/** Which features this one shop gets: the plan's list, with exceptions the super admin can set for this shop only. */
export function FeaturesPanel({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const { data, error, reload } = useAdminData<Entitlements>(`/platform-admin/organizations/${orgId}/entitlements`);
  const [choices, setChoices] = useState<Record<FeatureKey, Choice> | null>(null);
  const [ends, setEnds] = useState<Partial<Record<FeatureKey, string>>>({});
  const [branchLimit, setBranchLimit] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!data) return;
    setBranchLimit(data.branches.override === null ? "" : String(data.branches.override));
    setEnds(Object.fromEntries(Object.entries(data.expiry ?? {}).map(([key, iso]) => [key, new Date(iso as string).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })])));
    setChoices(Object.fromEntries(FEATURE_KEYS.map((key) => [key, data.overrides[key] === undefined ? "plan" : data.overrides[key] ? "on" : "off"])) as Record<FeatureKey, Choice>);
  }, [data]);
  const savedEnd = (key: FeatureKey) => { const iso = data?.expiry?.[key]; return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : ""; };
  const changed = !!data && !!choices && (FEATURE_KEYS.some((key) => choices[key] !== "plan" && (ends[key] ?? "") !== savedEnd(key)) || branchLimit !== (data.branches.override === null ? "" : String(data.branches.override)) || FEATURE_KEYS.some((key) => choices[key] !== (data.overrides[key] === undefined ? "plan" : data.overrides[key] ? "on" : "off")));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!choices) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      const overrides = Object.fromEntries(FEATURE_KEYS.filter((key) => choices[key] !== "plan").map((key) => [key, choices[key] === "on"]));
      await api(`/platform-admin/organizations/${orgId}/entitlements`, { method: "PUT", body: { overrides, expires: Object.fromEntries(Object.keys(overrides).filter((key) => ends[key as FeatureKey]).map((key) => [key, ends[key as FeatureKey]])), branchLimit: branchLimit ? Number(branchLimit) : null, reason } });
      setReason("");
      setNotice("Saved. The shop sees this the next time a screen opens. For a shop using the PC edition, renew its license key.");
      await reload();
      onChanged();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-brand-700" />Features for this shop</span>} description={data?.plan ? `Plan: ${data.plan.name}. Exceptions here apply to this shop only.` : "No paid plan yet, so everything is on. Exceptions here apply to this shop only."}>
      {error && <Alert>{error}</Alert>}
      {!data || !choices ? <LoadingRows rows={5} /> : (
        <form onSubmit={save} className="space-y-4">
          {saveError && <Alert>{saveError}</Alert>}
          {data.olderPlanVersion && (
            <Alert tone="blue">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>This shop keeps what it bought. {data.plan?.name} has changed since then.</span>
                <Button type="button" size="sm" variant="secondary" disabled={reason.trim().length < 8} onClick={async () => {
                  setSaveError("");
                  try {
                    await api(`/platform-admin/organizations/${orgId}/subscription/latest-features`, { body: { reason } });
                    setReason("");
                    setNotice("This shop now has what the plan includes today.");
                    await reload();
                    onChanged();
                  } catch (cause) {
                    setSaveError(cause instanceof Error ? cause.message : "Could not save.");
                  }
                }}>Move to the latest plan</Button>
              </span>
              <label className="mt-2 block"><span className="sr-only">Reason</span><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, at least 8 characters" /></label>
            </Alert>
          )}
          {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {FEATURE_KEYS.map((key) => {
              const off = data.globallyOff?.includes(key);
              const effective = !off && (choices[key] === "plan" ? data.planFeatures[key] : choices[key] === "on");
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-48 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">{FEATURES[key].label}<Badge color={effective ? "green" : "slate"}>{effective ? "On" : "Off"}</Badge>{off && <Badge color="red">Off for everyone</Badge>}{choices[key] !== "plan" && <Badge color="amber">Exception</Badge>}<span className="text-xs font-normal text-slate-500">{data.planFeatures[key] ? "Bought" : "Not bought"}</span></p>
                    <p className="text-xs text-slate-500">{FEATURES[key].description}</p>
                  </div>
                  {choices[key] !== "plan" && <label className="flex items-center gap-1.5 text-xs text-slate-600">Until<Input type="date" value={ends[key] ?? ""} onChange={(e) => setEnds({ ...ends, [key]: e.target.value })} className="w-36" aria-label={`${FEATURES[key].label} exception ends`} /></label>}
                  <Select value={choices[key]} onChange={(e) => setChoices({ ...choices, [key]: e.target.value as Choice })} className="w-auto" aria-label={`${FEATURES[key].label} for this shop`}>
                    <option value="plan">As in plan ({data.planFeatures[key] ? "on" : "off"})</option>
                    <option value="on">Always on</option>
                    <option value="off">Always off</option>
                  </Select>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div className="min-w-48 flex-1">
              <p className="text-sm font-medium text-slate-900">Branches allowed</p>
              <p className="text-xs text-slate-500">{data.branches.active} in use. Plan allows {data.branches.planLimit ?? "any number"}. Leave blank to follow the plan. Existing branches are never closed.</p>
            </div>
            <Input type="number" min={1} max={1000} value={branchLimit} onChange={(e) => setBranchLimit(e.target.value)} placeholder="As in plan" className="w-28" aria-label="Branches allowed for this shop" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Always included: {CORE_FEATURE_LABELS.join(", ")}. Leave "Until" blank for an exception with no end date.</p>
            <Button type="button" size="sm" variant="ghost" disabled={FEATURE_KEYS.every((key) => choices[key] === "plan")} onClick={() => setChoices(Object.fromEntries(FEATURE_KEYS.map((key) => [key, "plan"])) as Record<FeatureKey, Choice>)}>Restore plan defaults</Button>
          </div>
          {changed && (
            <>
              <Field label="Reason" required hint="Saved permanently in the audit log. Minimum 8 characters."><Input required minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tag designer included in their negotiated price" /></Field>
              <Button type="submit" loading={saving} disabled={reason.trim().length < 8}><Check className="h-4 w-4" />Save features</Button>
            </>
          )}
        </form>
      )}
    </Panel>
  );
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Renew, extend or change the plan without a payment record, or cancel it. Paid renewals go through "Record payment". */
type RfidAddon = { id: string; startsAt: string; endsAt: string; pricePaise: number; status: string };

/** The RFID module is charged on its own: its own period, its own payments, its own GST invoice. */
export function RfidModulePanel({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const { data, error, reload } = useAdminData<{ current: RfidAddon | null; history: RfidAddon[] }>(`/platform-admin/organizations/${orgId}/addons/rfid`);
  const [months, setMonths] = useState("12");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const latest = data?.history.filter((a) => a.status === "active").sort((a, b) => b.endsAt.localeCompare(a.endsAt))[0];
  async function pay(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      const r = await api<{ invoice: { number: string } | null }>(`/platform-admin/organizations/${orgId}/addons/rfid`, { body: { months: Number(months), amountPaise: Math.round(Number(amount || 0) * 100), reference: reference.trim() || undefined } });
      setNotice(r.invoice ? `Saved. RFID module is on. Invoice ${r.invoice.number} issued.` : "Saved. RFID module is on, free of charge.");
      setAmount("");
      setReference("");
      await reload();
      onChanged();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  async function stop() {
    const reason = window.prompt("Why is the RFID module being stopped for this shop?");
    if (!reason) return;
    setSaveError("");
    try {
      await api(`/platform-admin/organizations/${orgId}/addons/rfid/stop`, { body: { reason } });
      await reload();
      onChanged();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not stop it.");
    }
  }
  return (
    <Panel title={<span className="flex items-center gap-2"><Radio className="h-4 w-4 text-brand-700" />RFID software and tags</span>} description="Sold separately from the plan. Each payment gets its own invoice.">
      {error && <Alert>{error}</Alert>}
      {saveError && <Alert>{saveError}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {!data ? <LoadingRows rows={2} /> : (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            {data.current ? <Badge color="green">On</Badge> : <Badge color="slate">Off</Badge>}
            {latest && new Date(latest.endsAt) > new Date() ? `Paid until ${dateLabel(latest.endsAt)}` : "No paid period running."}
            {latest && new Date(latest.endsAt) > new Date() && <button type="button" onClick={() => void stop()} className="font-semibold text-red-700 underline underline-offset-2">Stop</button>}
          </p>
          <form onSubmit={pay} className="grid items-end gap-3 sm:grid-cols-4">
            <Field label="Period"><Select value={months} onChange={(e) => setMonths(e.target.value)}>{[[1, "1 month"], [3, "3 months"], [6, "6 months"], [12, "1 year"], [24, "2 years"]].map(([m, label]) => <option key={m} value={m}>{label}</option>)}</Select></Field>
            <Field label="Amount received incl. GST (₹)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 for free" /></Field>
            <Field label="Payment reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / UPI / cheque" /></Field>
            <Button type="submit" loading={saving} disabled={Number(amount) > 0 && !reference.trim()}>Record & switch on</Button>
          </form>
          <p className="text-xs text-slate-500">A shop on the PC edition also needs its license key renewed to get this.</p>
          <RfidTagSales orgId={orgId} />
        </div>
      )}
    </Panel>
  );
}

/** Selling the tags themselves: its own invoice, and it does not switch the software on. */
function RfidTagSales({ orgId }: { orgId: string }) {
  const { data, reload } = useAdminData<{ id: string; pricePaise: number; note: string | null; createdAt: string }[]>(`/platform-admin/organizations/${orgId}/addons/rfid-tags`);
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function sell(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ invoice: { number: string } | null }>(`/platform-admin/organizations/${orgId}/addons/rfid-tags`, { body: { quantity: Number(quantity), amountPaise: Math.round(Number(amount) * 100), reference: reference.trim() } });
      setNotice(`Saved. Invoice ${r.invoice?.number ?? ""} issued for ${Number(quantity).toLocaleString("en-IN")} tags.`);
      setQuantity("");
      setAmount("");
      setReference("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold text-slate-900">RFID tags sold</h3>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      <form onSubmit={sell} className="grid items-end gap-3 sm:grid-cols-4">
        <Field label="Number of tags"><Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Amount received incl. GST (₹)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        <Field label="Payment reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / UPI / cheque" /></Field>
        <Button type="submit" variant="secondary" loading={saving} disabled={!Number(quantity) || !Number(amount) || !reference.trim()}>Record tag sale</Button>
      </form>
      {!!data?.length && <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">{data.map((sale) => <li key={sale.id} className="flex justify-between gap-3 px-3 py-2"><span>{sale.note}</span><span className="text-slate-500">₹{(sale.pricePaise / 100).toLocaleString("en-IN")} · {dateLabel(sale.createdAt)}</span></li>)}</ul>}
    </div>
  );
}

export function ManagePlanModal({ orgId, orgName, current, onClose, onDone }: { orgId: string; orgName: string; current: { planId?: string; endsAt: string | null } | null; onClose: () => void; onDone: (message: string) => void }) {
  const plans = useAdminData<Plan[]>("/platform-admin/plans");
  const [mode, setMode] = useState<"set" | "cancel">("set");
  const [planId, setPlanId] = useState(current?.planId ?? "");
  const currentEnd = current?.endsAt && new Date(current.endsAt) > new Date() ? new Date(current.endsAt) : new Date();
  const [endsOn, setEndsOn] = useState(new Date(currentEnd.getTime() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = plans.data?.filter((p) => !p.code.startsWith("smoke-") && (p.published || p.id === current?.planId || p.code === "enterprise")) ?? [];
  useEffect(() => { if (!planId && options[0]) setPlanId(options[0].id); }, [planId, options]);
  const addDays = (days: number) => setEndsOn(new Date(currentEnd.getTime() + days * 86_400_000).toISOString().slice(0, 10));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (mode === "set") {
        await api(`/platform-admin/organizations/${orgId}/subscription`, { body: { planId, endsOn, reason } });
        onDone(`${options.find((p) => p.id === planId)?.name ?? "Plan"} is active until ${dateLabel(`${endsOn}T12:00:00Z`)}. No payment was recorded.`);
      } else {
        await api(`/platform-admin/organizations/${orgId}/subscription/cancel`, { body: { reason } });
        onDone("Plan cancelled. The shop can still sign in and see its data, but cannot make changes until it renews.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the plan.");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Manage plan · ${orgName}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button type="submit" form="manage-plan" variant={mode === "cancel" ? "danger" : "primary"} loading={saving} disabled={reason.trim().length < 8 || (mode === "set" && !planId)}>{mode === "set" ? "Save plan" : "Cancel plan now"}</Button></>}>
      <form id="manage-plan" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={mode === "set" ? "primary" : "secondary"} onClick={() => setMode("set")}><CalendarClock className="h-4 w-4" />Renew or change</Button>
          <Button type="button" size="sm" variant={mode === "cancel" ? "danger" : "secondary"} onClick={() => setMode("cancel")}><CircleSlash className="h-4 w-4" />Cancel plan</Button>
        </div>
        {mode === "set" ? (
          <>
            <Field label="Plan" required>
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.published ? "" : " (not on the pricing page)"}</option>)}
              </Select>
            </Field>
            <Field label="Active until" required hint={current?.endsAt ? `Current end date: ${dateLabel(current.endsAt)}` : undefined}>
              <Input type="date" required min={inDays(1)} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {[["+1 month", 30], ["+3 months", 90], ["+6 months", 182], ["+1 year", 365]].map(([label, days]) => <Button key={label} type="button" size="sm" variant="ghost" onClick={() => addDays(Number(days))}>{label}</Button>)}
            </div>
            <Alert tone="amber">This does not record a payment or issue an invoice. If the customer paid, use Record payment instead.</Alert>
          </>
        ) : <Alert tone="amber">The plan ends now. The shop can still sign in and see its data, but cannot make changes. Nothing is deleted or refunded.</Alert>}
        <Field label="Reason" required hint="Saved permanently in the audit log. Minimum 8 characters.">
          <Textarea rows={2} minLength={8} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "set" ? "e.g. Complimentary month agreed with the owner" : "e.g. Customer asked to stop"} />
        </Field>
      </form>
    </Modal>
  );
}
