"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, KeyRound, Monitor, Pause, Play, Save } from "lucide-react";
import { FEATURE_CATEGORIES, FEATURES, FEATURE_KEYS, type FeatureKey } from "@drycare/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, MetricCard, Panel, dateLabel, dateTimeLabel, useAdminData } from "../../admin-ui";

type Device = { installationId: string; status: string; statusReason: string | null; appVersion: string | null; firstSeenAt: string; lastSyncAt: string | null };
type Detail = {
  license: { id: string; customerName: string; plan: string; status: string; statusReason: string | null; organizationId: string | null; expiresAt: string | null; issuedAt: string; entitlementVersion: number; installationIds: string[] };
  key: string;
  payload: { licenseType?: string; offlineGraceDays?: number | null; expiryPolicy?: string; features?: Record<string, boolean> } | null;
  devices: Device[];
  neverSeen: string[];
  events: { id: string; installationId: string; result: string; appVersion: string | null; createdAt: string }[];
  history: { id: string; action: string; createdAt: string; actor: string | null; after: { reason?: string } | null }[];
};
const words: Record<string, string> = { active: "Active", suspended: "Suspended", revoked: "Revoked" };
const actionWords: Record<string, string> = {
  "platform.desktop_license_issued": "Issued", "platform.desktop_license_renewed": "New key issued", "platform.desktop_license_suspended": "Suspended", "platform.desktop_license_revoked": "Revoked",
  "platform.desktop_license_reactivated": "Reactivated", "platform.license_device_deactivated": "PC removed", "platform.license_device_active": "PC put back",
};

function Inner() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, reload } = useAdminData<Detail>(id ? `/platform-admin/licenses/${id}/detail` : null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [terms, setTerms] = useState<{ licenseType?: string; grace?: string; policy?: string; features: Record<string, boolean> }>({ features: {} });
  const act = async (call: () => Promise<unknown>, text: string) => {
    setBusy(true);
    setFailure("");
    try {
      await call();
      setReason("");
      setNotice(text);
      setTerms({ features: {} });
      await reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  if (!id) return <Alert>No license chosen.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Panel><LoadingRows /></Panel>;
  const l = data.license;
  const canAct = reason.trim().length >= 8 && !busy;
  const status = (next: string, text: string) => act(() => api(`/platform-admin/licenses/${l.id}/status`, { body: { status: next, reason } }), text);
  const device = (installationId: string, next: string, text: string) => act(() => api(`/platform-admin/license-devices/${installationId}/status`, { body: { status: next, licenseId: l.id, reason } }), text);
  const features = { ...data.payload?.features, ...terms.features };
  const termsChanged = terms.licenseType !== undefined || terms.grace !== undefined || terms.policy !== undefined || Object.keys(terms.features).length > 0;
  const lastSync = data.devices.map((d) => d.lastSyncAt).filter(Boolean).sort().pop();
  return (
    <>
      <Link href="/super-admin/licenses" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Licenses</Link>
      <ConsoleHeader title={l.customerName} description={`${l.plan} · key version ${l.entitlementVersion}. Changes reach a PC at its next successful check-in. A PC that stays offline cannot receive them.`} />
      <div className="mb-5 space-y-3">
        {failure && <Alert>{failure}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={KeyRound} label="Status" value={words[l.status] ?? l.status} tone={l.status === "active" ? "emerald" : "red"} detail={l.statusReason ?? (l.expiresAt ? `Until ${dateLabel(l.expiresAt)}` : "No end date")} />
        <MetricCard icon={Monitor} label="PCs on this license" value={l.installationIds.length} tone="violet" detail={`${data.neverSeen.length} never checked in`} />
        <MetricCard icon={Monitor} label="Last check-in" value={lastSync ? dateLabel(lastSync) : "Never"} tone="emerald" detail={lastSync ? dateTimeLabel(lastSync) : "No PC has connected yet"} />
        <MetricCard icon={KeyRound} label="Offline period" value={data.payload?.offlineGraceDays ? `${data.payload.offlineGraceDays} days` : "Until expiry"} tone="violet" detail={data.payload?.expiryPolicy === "locked" ? "Locked at expiry" : "Read-only at expiry"} />
      </div>
      <Panel title="Change this license" description="Every change needs a reason, kept in the audit log.">
        <Field label="Reason" required><Input minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Payment overdue since March" /></Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {l.status !== "suspended" && <Button variant="secondary" disabled={!canAct} onClick={() => void status("suspended", "Suspended. It applies when each PC next checks in.")}><Pause className="h-4 w-4" />Suspend</Button>}
          {l.status !== "active" && <Button disabled={!canAct} onClick={() => void status("active", "Reactivated. It applies when each PC next checks in.")}><Play className="h-4 w-4" />Reactivate</Button>}
          {l.status !== "revoked" && <Button variant="danger" disabled={!canAct} onClick={() => void status("revoked", "Revoked. It applies when each PC next checks in. Their data stays on the PC.")}><Ban className="h-4 w-4" />Revoke</Button>}
        </div>
      </Panel>
      <div className="mt-6"><Panel title="Terms and features" description="Saving signs a new key, which PCs pick up by themselves when they connect. A PC that never connects keeps its current key.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="License type"><Select value={terms.licenseType ?? data.payload?.licenseType ?? "annual"} onChange={(e) => setTerms({ ...terms, licenseType: e.target.value })}><option value="standalone">Standalone</option><option value="lifetime">Lifetime</option><option value="annual">Annual</option><option value="monthly">Monthly</option><option value="enterprise">Custom enterprise</option><option value="subscription">Cloud subscription</option><option value="trial">Trial</option></Select></Field>
          <Field label="Days a PC may stay offline" hint="Blank: until the key expires."><Input type="number" min={1} max={3650} value={terms.grace ?? String(data.payload?.offlineGraceDays ?? "")} onChange={(e) => setTerms({ ...terms, grace: e.target.value })} /></Field>
          <Field label="At expiry"><Select value={terms.policy ?? data.payload?.expiryPolicy ?? "read_only"} onChange={(e) => setTerms({ ...terms, policy: e.target.value })}><option value="read_only">Read-only: records can be viewed</option><option value="locked">Locked: only the renewal screen</option></Select></Field>
        </div>
        {data.payload?.features ? FEATURE_CATEGORIES.map((c) => (
          <div key={c} className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{c}</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {FEATURE_KEYS.filter((k) => FEATURES[k].category === c).map((k: FeatureKey) => <label key={k} className="flex items-center gap-2 text-sm text-slate-700" title={FEATURES[k].description}><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={features[k] ?? FEATURES[k].whenUnset} onChange={(e) => setTerms({ ...terms, features: { ...terms.features, [k]: e.target.checked } })} />{FEATURES[k].label}</label>)}
            </div>
          </div>
        )) : <p className="mt-4 text-sm text-slate-500">This older key has no feature list and gives full access. Renew it to choose features.</p>}
        <Button className="mt-4" disabled={!canAct || !termsChanged} onClick={() => void act(() => api(`/platform-admin/licenses/${l.id}/terms`, { method: "PUT", body: { reason, licenseType: terms.licenseType, expiryPolicy: terms.policy, ...(terms.grace !== undefined ? { offlineGraceDays: terms.grace ? Number(terms.grace) : null } : {}), ...(Object.keys(terms.features).length ? { features: terms.features } : {}) } }), "New key signed. PCs pick it up when they connect.")}><Save className="h-4 w-4" />Save and sign a new key</Button>
      </Panel></div>
      <div className="mt-6"><Panel title="PCs" description="Removing one PC leaves the others working. Enter a reason above first." padded={false}>
        {!l.installationIds.length ? <div className="p-5"><EmptyState icon={Monitor} title="No PCs">This license has none.</EmptyState></div> : (
          <DataTable minWidth={720} head={["PC", "Version", "First seen", "Last check-in", "Status", ""]}>
            {l.installationIds.map((pcId) => {
              const d = data.devices.find((x) => x.installationId === pcId);
              const off = d?.status === "deactivated";
              return (
                <tr key={pcId}>
                  <td className="px-5 py-3 font-mono text-xs">{pcId}</td>
                  <td className="px-5 py-3">{d?.appVersion ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{d ? dateLabel(d.firstSeenAt) : "—"}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{d?.lastSyncAt ? dateTimeLabel(d.lastSyncAt) : "Never"}</td>
                  <td className="px-5 py-3">{off ? <Badge color="red">Removed</Badge> : d ? <Badge color="green">Active</Badge> : <Badge color="slate">Not seen yet</Badge>}</td>
                  <td className="px-5 py-3 text-end">{off ? <Button size="sm" variant="ghost" disabled={!canAct} onClick={() => void device(pcId, "active", "PC put back.")}>Put back</Button> : <Button size="sm" variant="ghost" disabled={!canAct} onClick={() => void device(pcId, "deactivated", "PC removed. It stops at its next check-in.")}>Remove</Button>}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Check-in history" padded={false}>
          {!data.events.length ? <div className="p-5"><EmptyState icon={Monitor} title="None yet">A PC appears once it connects.</EmptyState></div> : (
            <DataTable minWidth={420} head={["When", "PC", "Result"]}>
              {data.events.slice(0, 25).map((e) => <tr key={e.id}><td className="px-5 py-2.5 text-xs text-slate-600">{dateTimeLabel(e.createdAt)}</td><td className="px-5 py-2.5 font-mono text-xs">{e.installationId.slice(0, 8)}</td><td className="px-5 py-2.5 text-xs">{e.result.replace("+new_key", ", received a new key")}</td></tr>)}
            </DataTable>
          )}
        </Panel>
        <Panel title="Audit log" padded={false}>
          {!data.history.length ? <div className="p-5"><EmptyState icon={KeyRound} title="Nothing yet">Changes appear here.</EmptyState></div> : (
            <DataTable minWidth={420} head={["When", "What", "Who"]}>
              {data.history.map((h) => <tr key={h.id}><td className="px-5 py-2.5 text-xs text-slate-600">{dateTimeLabel(h.createdAt)}</td><td className="px-5 py-2.5 text-xs">{actionWords[h.action] ?? h.action}{h.after?.reason ? `: ${h.after.reason}` : ""}</td><td className="px-5 py-2.5 text-xs text-slate-600">{h.actor ?? "Automatic"}</td></tr>)}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}

export default function LicenseDetailPage() {
  return <Suspense fallback={<LoadingRows />}><Inner /></Suspense>;
}
