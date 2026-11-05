"use client";
import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Check, CircleSlash, SlidersHorizontal } from "lucide-react";
import { CORE_FEATURE_LABELS, FEATURES, FEATURE_KEYS, type FeatureKey, type FeatureMap, type FeatureOverrides } from "@drycare/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { LoadingRows, Panel, dateLabel, useAdminData } from "../../admin-ui";

type Entitlements = {
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
  const [branchLimit, setBranchLimit] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!data) return;
    setBranchLimit(data.branches.override === null ? "" : String(data.branches.override));
    setChoices(Object.fromEntries(FEATURE_KEYS.map((key) => [key, data.overrides[key] === undefined ? "plan" : data.overrides[key] ? "on" : "off"])) as Record<FeatureKey, Choice>);
  }, [data]);
  const changed = !!data && !!choices && (branchLimit !== (data.branches.override === null ? "" : String(data.branches.override)) || FEATURE_KEYS.some((key) => choices[key] !== (data.overrides[key] === undefined ? "plan" : data.overrides[key] ? "on" : "off")));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!choices) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      const overrides = Object.fromEntries(FEATURE_KEYS.filter((key) => choices[key] !== "plan").map((key) => [key, choices[key] === "on"]));
      await api(`/platform-admin/organizations/${orgId}/entitlements`, { method: "PUT", body: { overrides, branchLimit: branchLimit ? Number(branchLimit) : null, reason } });
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
          {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {FEATURE_KEYS.map((key) => {
              const effective = choices[key] === "plan" ? data.planFeatures[key] : choices[key] === "on";
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-48 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">{FEATURES[key].label}<Badge color={effective ? "green" : "slate"}>{effective ? "On" : "Off"}</Badge></p>
                    <p className="text-xs text-slate-500">{FEATURES[key].description}</p>
                  </div>
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
          <p className="text-xs text-slate-500">Always included: {CORE_FEATURE_LABELS.join(", ")}.</p>
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
