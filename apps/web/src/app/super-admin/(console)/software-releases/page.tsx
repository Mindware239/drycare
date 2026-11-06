"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Clock3, FlaskConical, History, Monitor, OctagonX, Package, PackageCheck, Pencil, Plus, RotateCcw, Search, ShieldAlert, Sparkles, UploadCloud, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea, cx } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, MetricCard, Pager, Panel, SegmentedTabs, dateLabel, dateTimeLabel, useAdminData } from "../admin-ui";

type Target = { type: "all" | "beta" } | { type: "customers" | "businesses" | "installations" | "license_types"; ids: string[] };
type Release = {
  id: string; version: string; productName: string; buildNumber: string | null; title: string | null; channel: string; notes: string; releaseDate: string | null; status: string; pauseReason: string | null;
  mandatory: boolean; automatic: boolean; restartRequired: boolean; updateDeadline: string | null; maintenanceStart: number | null; maintenanceEnd: number | null; minSupportedVersion: string | null; rollbackAvailable: boolean; notificationMessage: string | null;
  packageType: string; architecture: string; fileName: string | null; sha256: string | null; sizeBytes: number | null; signatureStatus: string | null; signaturePublisher: string | null; unsignedApproved: boolean; downloadUrl: string | null;
  target: Target; stages: number[]; currentStage: number; rolloutPercent: number; failureThresholdPct: number; failureMinCount: number; recommended: boolean; publishedAt: string | null; publishedByName: string | null; createdAt: string;
  reports: Record<string, number>; installed: number; eligible: number; stageCounts: { percent: number; selected: number }[];
};
type Rollback = { id: string; fromVersion: string; toVersion: string; status: string; reason: string; createdAt: string; scope: { type: string }; onOldVersion: number; onTarget: number; progress: Record<string, number> };
type Data = {
  summary: { totalReleases: number; latestStable: string | null; latestBeta: string | null; registeredPcs: number; onLatest: number; pending: number; failures: number; offline: number };
  releases: Release[]; rollbacks: Rollback[];
  recentFailures: { id: string; installationId: string; fromVersion: string | null; toVersion: string; status: string; detail: string | null; createdAt: string }[];
};
type Pc = {
  installationId: string; customerName: string | null; business: string | null; pcName: string | null; osVersion: string | null; appVersion: string | null; latestEligible: string | null; channel: string; betaGroup: boolean;
  lastSyncAt: string | null; lastSuccessAt: string | null; lastSuccessVersion: string | null; updateState: string; lastError: string | null;
};
type Pcs = { total: number; page: number; pageSize: number; items: Pc[]; filters: { versions: string[]; systems: string[] } };
type Tab = "releases" | "pcs" | "rollback" | "history";

const STATUS: Record<string, { label: string; color: "green" | "amber" | "red" | "slate" | "blue" }> = {
  draft: { label: "Draft", color: "slate" }, testing: { label: "Testing", color: "blue" }, staged: { label: "Staged", color: "amber" }, published: { label: "Published", color: "green" }, paused: { label: "Paused", color: "red" }, withdrawn: { label: "Withdrawn", color: "red" },
};
const NEXT_STATUS: Record<string, string[]> = { draft: ["testing", "staged", "published"], testing: ["staged", "published", "paused", "withdrawn"], staged: ["published", "paused", "withdrawn"], published: ["paused", "withdrawn"] };
const PC_STATUS: Record<string, { label: string; color: "green" | "amber" | "red" | "slate" | "blue" }> = {
  up_to_date: { label: "Up to date", color: "green" }, available: { label: "Update available", color: "blue" }, downloading: { label: "Downloading", color: "blue" }, installing: { label: "Installing", color: "blue" },
  failed: { label: "Update failed", color: "red" }, offline: { label: "Offline", color: "slate" }, required: { label: "Update required", color: "amber" }, unsupported: { label: "Unsupported version", color: "red" },
};
const SIGNATURE: Record<string, { label: string; color: "green" | "amber" | "red" | "slate" }> = {
  valid: { label: "Signed and verified", color: "green" }, not_signed: { label: "Not signed", color: "amber" }, present_unverified: { label: "Signature found, verified on each PC", color: "slate" }, invalid: { label: "Signature invalid", color: "red" }, unknown: { label: "Not checked", color: "slate" },
};
const size = (bytes: number | null) => (!bytes ? "—" : bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(0)} MB`);
const targetLabel = (t: Target) => (!("ids" in t) ? (t.type === "all" ? "All registered PCs" : "Beta testing group") : `${t.ids.length} selected ${t.type === "customers" ? "customers" : t.type === "businesses" ? "businesses" : t.type === "installations" ? "PCs" : "license types"}`);

export default function SoftwareReleasesPage() {
  const { data, error, reload } = useAdminData<Data>("/platform-admin/releases");
  const [tab, setTab] = useState<Tab>("releases");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const done = async (text: string) => { setNotice(text); setFailure(""); await reload(); };
  const s = data?.summary;
  const live = data?.releases.some((r) => ["testing", "staged", "published"].includes(r.status));
  return (
    <>
      <ConsoleHeader title="Software releases" description="Release a new version of Drycare for Windows in controlled stages. A PC gets a change the next time it is online, and offline PCs keep working on the version they have." actions={<><Button variant="danger" disabled={!live} onClick={() => setStopping(true)}><OctagonX className="h-4 w-4" />Emergency stop</Button><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Add new version</Button></>} />
      <div className="mb-5 space-y-3">
        {(error || failure) && <Alert>{error || failure}</Alert>}
        {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Package} label="Total releases" value={s?.totalReleases ?? "—"} tone="violet" detail="Every version added" />
        <MetricCard icon={PackageCheck} label="Latest stable" value={s?.latestStable ?? "None"} tone="emerald" detail="Newest stable version out" />
        <MetricCard icon={FlaskConical} label="Latest beta" value={s?.latestBeta ?? "None"} tone="blue" detail="Newest beta version out" />
        <MetricCard icon={Monitor} label="Registered PCs" value={s?.registeredPcs ?? "—"} tone="violet" detail="PCs that have checked in" />
        <MetricCard icon={CircleCheck} label="PCs on latest version" value={s?.onLatest ?? "—"} tone="emerald" detail="On the latest stable" />
        <MetricCard icon={Clock3} label="Updates pending" value={s?.pending ?? "—"} tone="emerald" detail="Available, required or in progress" />
        <MetricCard icon={CircleAlert} label="Update failures" value={s?.failures ?? "—"} tone="red" detail="PCs whose last update failed" />
        <MetricCard icon={WifiOff} label="Offline PCs" value={s?.offline ?? "—"} tone="violet" detail="Not seen for 7 days" />
      </div>
      <div className="mb-4"><SegmentedTabs<Tab> value={tab} onChange={setTab} options={[{ value: "releases", label: "Deployment" }, { value: "pcs", label: "PCs" }, { value: "rollback", label: "Rollback", count: data?.rollbacks.filter((b) => b.status === "active").length || undefined }, { value: "history", label: "Release history" }]} /></div>

      {tab === "releases" && (!data ? <Panel><LoadingRows /></Panel> : (
        <Panel padded={false} title="Deployment" actions={<Button variant="ghost" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Add new version</Button>}>
          {!data.releases.length ? <div className="p-6"><EmptyState icon={Package} title="No versions yet">Build with pnpm dist, then add the version here and upload its installer.</EmptyState></div> : (
            <DataTable minWidth={980} head={["#", "Release status", "Version", "Channel", "Staged rollout", "Signature", "Mandatory", ""]}>
              {data.releases.map((r, i) => <ReleaseRow key={r.id} index={data.releases.length - i} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onDone={done} onFail={setFailure} />)}
            </DataTable>
          )}
        </Panel>
      ))}
      {tab === "pcs" && <PcsTab />}
      {tab === "rollback" && data && <RollbackTab data={data} onDone={done} onFail={setFailure} />}
      {tab === "history" && (!data ? <Panel><LoadingRows /></Panel> : (
        <Panel padded={false} title="Release history">
          {!data.releases.length ? <div className="p-6"><EmptyState icon={History} title="Nothing yet">Versions appear here once added.</EmptyState></div> : (
            <DataTable minWidth={1100} head={["Version", "Build", "Channel", "Date", "Notes", "Size", "Rollout", "Installed", "Failed", "Status", "Published by"]}>
              {data.releases.map((r) => <tr key={r.id}><td className="px-5 py-3 font-semibold">{r.version}{r.recommended && <span className="ms-1"><Badge color="green">Recommended</Badge></span>}</td><td className="px-5 py-3 text-xs">{r.buildNumber ?? "—"}</td><td className="px-5 py-3 capitalize">{r.channel}</td><td className="px-5 py-3 text-xs text-slate-600">{r.releaseDate ? dateLabel(r.releaseDate) : r.publishedAt ? dateLabel(r.publishedAt) : "—"}</td><td className="max-w-xs truncate px-5 py-3 text-xs text-slate-600" title={r.notes}>{r.notes || "—"}</td><td className="px-5 py-3 text-xs">{size(r.sizeBytes)}</td><td className="px-5 py-3 tabular-nums">{r.rolloutPercent}%</td><td className="px-5 py-3 tabular-nums">{r.reports.succeeded ?? 0}</td><td className="px-5 py-3 tabular-nums">{(r.reports.failed ?? 0) + (r.reports.rolled_back ?? 0)}</td><td className="px-5 py-3"><Badge color={STATUS[r.status]?.color ?? "slate"}>{STATUS[r.status]?.label ?? r.status}</Badge></td><td className="px-5 py-3 text-xs text-slate-600">{r.publishedByName ?? "—"}</td></tr>)}
            </DataTable>
          )}
        </Panel>
      ))}
      {creating && <NewRelease onClose={() => setCreating(false)} onDone={async (t) => { setCreating(false); await done(t); }} />}
      {stopping && <Confirm title="Emergency stop" message="Every release being rolled out pauses at once, and no more PCs can download them. PCs that already updated stay as they are; start a rollback if they need to go back." action="Stop all releases" danger onClose={() => setStopping(false)} run={async (reason) => { const r = await api<{ paused: string[] }>("/platform-admin/releases/emergency-stop", { body: { reason } }); setStopping(false); await done(`Stopped: ${r.paused.join(", ") || "nothing was rolling out"}.`); }} />}
    </>
  );
}

function Confirm({ title, message, action, danger, extra, onClose, run }: { title: string; message: string; action: string; danger?: boolean; extra?: React.ReactNode; onClose: () => void; run: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await run(reason);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
      setBusy(false);
    }
  }
  return (
    <Modal open title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button form="confirm-release" type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < 8}>{action}</Button></>}>
      <form id="confirm-release" onSubmit={go} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-700">{message}</p>
        {extra}
        <Field label="Reason" required hint="Saved permanently in the audit log. Minimum 8 characters."><Input autoFocus minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function ReleaseRow({ r, index, open, onToggle, onDone, onFail }: { r: Release; index: number; open: boolean; onToggle: () => void; onDone: (t: string) => Promise<void>; onFail: (t: string) => void }) {
  const [pending, setPending] = useState<{ action: string; label: string; message: string; danger?: boolean } | null>(null);
  const [allowUnsigned, setAllowUnsigned] = useState(false);
  const [editingRollout, setEditingRollout] = useState(false);
  const unsigned = r.signatureStatus !== "valid" && !r.unsignedApproved;
  const actions: Record<string, { action: string; label: string; message: string; danger?: boolean } | null> = {
    testing: { action: "test", label: "Start testing", message: "Only PCs in the beta testing group are offered this version." },
    staged: r.status === "paused" ? { action: "resume", label: "Resume", message: `The rollout continues at ${r.rolloutPercent}%.` } : { action: "stage", label: "Start rollout", message: `It starts with ${r.stages[0]}% of eligible PCs.` },
    published: r.status === "paused" && r.rolloutPercent >= 100 ? { action: "resume", label: "Resume", message: "It is offered to every eligible PC again." } : { action: "publish", label: "Publish to everyone", message: "Every eligible PC is offered this version." },
    paused: { action: "pause", label: "Pause", message: "No more PCs are offered it, and links already handed out stop working." },
    withdrawn: { action: "withdraw", label: "Withdraw", message: "It stops for good, and cannot be downloaded. Its file is kept for your records.", danger: true },
  };
  const ok = r.reports.succeeded ?? 0;
  const bad = (r.reports.failed ?? 0) + (r.reports.rolled_back ?? 0);
  const nextPercent = r.stages[r.currentStage + 1];
  return (
    <>
      <tr className={cx(open && "bg-slate-50/70")}>
        <td className="px-5 py-3 text-xs text-slate-400 tabular-nums">{index}</td>
        <td className="px-5 py-3">
          <Select aria-label={`Release status of ${r.version}`} value={r.status} className="w-36" disabled={r.status === "withdrawn"} onChange={(e) => { const a = actions[e.target.value]; if (a) setPending(a); }}>
            <option value={r.status}>{STATUS[r.status]?.label ?? r.status}</option>
            {(r.status === "paused" ? (r.rolloutPercent >= 100 ? ["published", "withdrawn"] : ["staged", "published", "withdrawn"]) : NEXT_STATUS[r.status] ?? []).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
          </Select>
        </td>
        <td className="px-5 py-3"><span className="font-semibold">{r.version}</span>{r.recommended && <span className="ms-1.5"><Badge color="green">Recommended</Badge></span>}{r.title && <span className="block text-xs text-slate-500">{r.title}</span>}</td>
        <td className="px-5 py-3 capitalize">{r.channel}</td>
        <td className="px-5 py-3">
          <span className="inline-flex items-center gap-2 tabular-nums"><span className="border-b border-dotted border-slate-400">{["staged", "published"].includes(r.status) ? r.stageCounts.find((c) => c.percent === r.rolloutPercent)?.selected ?? Math.round((r.eligible * r.rolloutPercent) / 100) : r.status === "testing" ? r.stageCounts[0]?.selected ?? 0 : 0}</span> out of {r.eligible}
            <button type="button" aria-label={`Set rollout for ${r.version}`} title="Set updates rollout limit" onClick={() => setEditingRollout(true)} className="dc-press grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-brand-700 hover:bg-brand-100"><Pencil className="h-3.5 w-3.5" /></button>
          </span>
          <span className="block text-xs text-slate-500">{`${r.rolloutPercent}% · ${targetLabel(r.target)}`}</span>
          {r.pauseReason && <span className="block max-w-xs text-xs text-red-700">{r.pauseReason}</span>}
        </td>
        <td className="px-5 py-3">{r.signatureStatus ? <Badge color={SIGNATURE[r.signatureStatus]?.color ?? "slate"}>{SIGNATURE[r.signatureStatus]?.label ?? r.signatureStatus}</Badge> : <span className="text-xs text-slate-400">No file</span>}</td>
        <td className="px-5 py-3"><Toggle label={`Mandatory for ${r.version}`} on={r.mandatory} onChange={(on) => setPending({ action: on ? "mandatory_on" : "mandatory_off", label: on ? "Make mandatory" : "Make optional", message: on ? "Shops cannot postpone this update." : "Shops can postpone this update." })} /></td>
        <td className="px-5 py-3 text-end"><Button size="sm" variant="ghost" onClick={onToggle}>{open ? "Close" : "Details"}</Button></td>
      </tr>
      {open && <tr><td colSpan={8} className="bg-slate-50/70 px-5 pb-5"><ReleaseDetail r={r} ok={ok} bad={bad} nextPercent={nextPercent} onDone={onDone} onFail={onFail} onAction={setPending} /></td></tr>}
      {pending && createPortal(
        <Confirm title={`${pending.label}: ${r.version}`} message={pending.message} action={pending.label} danger={pending.danger} onClose={() => { setPending(null); setAllowUnsigned(false); }}
          extra={["stage", "publish", "resume"].includes(pending.action) && unsigned ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="flex items-center gap-1.5 font-semibold"><ShieldAlert className="h-4 w-4" />This installer is not code-signed</p>
              <p className="mt-1 text-xs">Windows will warn people who run it. PCs still check it against the signed manifest, so a changed file is refused, but it is not a verified production release.</p>
              <label className="mt-2 flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-amber-700" checked={allowUnsigned} onChange={(e) => setAllowUnsigned(e.target.checked)} />I accept releasing it unsigned</label>
            </div>
          ) : undefined}
          run={async (reason) => {
            if (pending.action.startsWith("mandatory_")) await api(`/platform-admin/releases/${r.id}`, { method: "PATCH", body: { mandatory: pending.action === "mandatory_on", ...(pending.action === "mandatory_off" ? { updateDeadline: null } : {}), reason } });
            else await api(`/platform-admin/releases/${r.id}/action`, { body: { action: pending.action, allowUnsigned, reason } });
            setPending(null);
            await onDone(`${r.version}: ${pending.label.toLowerCase()} done.`);
          }} />,
        document.body,
      )}
      {editingRollout && createPortal(<RolloutEditor r={r} onClose={() => setEditingRollout(false)} onDone={async (t) => { setEditingRollout(false); await onDone(t); }} />, document.body)}
    </>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx("relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full border transition-colors", on ? "border-brand-600 bg-brand-600" : "border-slate-300 bg-slate-100")}>
      <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1")} style={!on ? { background: "#cbd0d8" } : undefined} />
    </button>
  );
}

function ReleaseDetail({ r, ok, bad, nextPercent, onDone, onFail, onAction }: { r: Release; ok: number; bad: number; nextPercent?: number; onDone: (t: string) => Promise<void>; onFail: (t: string) => void; onAction: (a: { action: string; label: string; message: string; danger?: boolean }) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [expected, setExpected] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const locked = Boolean(r.publishedAt) || ["testing", "staged", "published"].includes(r.status);
  function upload(chosen: File) {
    // Sent straight as the file, because an installer is far too large to hold in memory.
    const x = new XMLHttpRequest();
    x.open("PUT", `/api/v1/platform-admin/releases/${r.id}/file`);
    x.setRequestHeader("content-type", "application/octet-stream");
    x.setRequestHeader("x-drycare-csrf", "1");
    if (expected.trim()) x.setRequestHeader("x-expected-sha256", expected.trim());
    x.upload.onprogress = (e) => setProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { setProgress(null); if (x.status < 300) void onDone(`Installer uploaded for ${r.version}.`); else onFail((() => { try { return JSON.parse(x.responseText).error.message as string; } catch { return "The upload failed."; } })()); };
    x.onerror = () => { setProgress(null); onFail("The upload failed. Check the connection and try again."); };
    x.send(chosen);
  }
  return (
    <div className="grid gap-5 rounded-xl border border-slate-200 bg-white p-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold text-slate-900">Installer</p>
        {r.fileName ? (
          <dl className="grid gap-x-3 gap-y-1 text-xs" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}>
            <dt className="text-slate-500">Package</dt><dd className="break-all">{r.fileName}</dd>
            <dt className="text-slate-500">Size</dt><dd>{size(r.sizeBytes)} · {r.architecture}</dd>
            <dt className="text-slate-500">SHA-256</dt><dd className="break-all font-mono text-[11px]">{r.sha256}</dd>
            <dt className="text-slate-500">Signature</dt><dd>{SIGNATURE[r.signatureStatus ?? "unknown"]?.label}{r.signaturePublisher ? ` · ${r.signaturePublisher}` : ""}{r.unsignedApproved ? " · Released unsigned by choice" : ""}</dd>
            <dt className="text-slate-500">Download</dt><dd>{r.downloadUrl && <a className="font-medium text-brand-700 underline" href={r.downloadUrl}>Download installer</a>}</dd>
          </dl>
        ) : <p className="text-xs text-slate-500">No installer uploaded.</p>}
        {!locked && (
          <>
            <Field label="Expected SHA-256 (optional)" hint="If you enter it, the upload must match."><Input value={expected} onChange={(e) => setExpected(e.target.value)} className="font-mono" /></Field>
            <input ref={file} type="file" accept={r.packageType === "msi" ? ".msi" : ".exe"} className="hidden" aria-label={`Installer for ${r.version}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <Button size="sm" variant="secondary" disabled={progress !== null} onClick={() => file.current?.click()}><UploadCloud className="h-3.5 w-3.5" />{progress !== null ? `Uploading ${progress}%` : r.fileName ? "Replace installer" : `Upload .${r.packageType}`}</Button>
            {progress !== null && <div className="h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div>}
          </>
        )}
        {locked && <p className="text-xs text-slate-500">This version has been released, so its file is locked and can never be replaced.</p>}
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold text-slate-900">Rollout</p>
        <p className="text-xs text-slate-600">{`${r.eligible} eligible PCs · ${targetLabel(r.target)}`}</p>
        <ol className="space-y-1 text-xs">{r.stageCounts.map((c, i) => <li key={c.percent} className={cx("flex justify-between gap-3 rounded px-2 py-1", i === r.currentStage && ["staged", "published", "paused"].includes(r.status) ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-600")}><span>{`Stage ${i + 1}: ${c.percent}%`}</span><span className="tabular-nums">{`${c.selected} PCs`}</span></li>)}</ol>
        <p className="text-xs text-slate-600">{`Auto-pause at ${r.failureThresholdPct}% failures, once ${r.failureMinCount} PCs have failed.`}</p>
        <p className="text-xs text-slate-700"><strong>{r.installed}</strong> on this version · <strong>{ok}</strong> updated · <strong>{bad}</strong> failed</p>
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold text-slate-900">Settings and actions</p>
        <p className="text-xs leading-5 text-slate-600">{[r.mandatory ? "Mandatory" : "Optional", r.automatic ? "Automatic" : "Asks first", r.restartRequired ? "Restart required" : null, r.updateDeadline ? `Deadline ${dateTimeLabel(r.updateDeadline)}` : null, r.maintenanceStart !== null ? `Window ${r.maintenanceStart}:00–${r.maintenanceEnd}:00` : null, r.minSupportedVersion ? `Minimum ${r.minSupportedVersion}` : null].filter(Boolean).join(" · ")}</p>
        {r.notes && <p className="whitespace-pre-line text-xs text-slate-600">{r.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {r.status === "staged" && nextPercent !== undefined && <Button size="sm" onClick={() => onAction({ action: "next_stage", label: `Go to ${nextPercent}%`, message: `The rollout widens to ${nextPercent}% of eligible PCs. PCs already included stay included.` })}>{`Go to ${nextPercent}%`}</Button>}
          {r.status !== "withdrawn" && r.sha256 && !r.recommended && <Button size="sm" variant="secondary" onClick={() => onAction({ action: "recommend", label: "Mark as recommended", message: "This is shown as the recommended version to go back to." })}><Sparkles className="h-3.5 w-3.5" />Recommend</Button>}
        </div>
      </div>
    </div>
  );
}

function RolloutEditor({ r, onClose, onDone }: { r: Release; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [percent, setPercent] = useState(String(r.rolloutPercent));
  const [type, setType] = useState<Target["type"]>(r.target.type);
  const [ids, setIds] = useState("ids" in r.target ? r.target.ids.join("\n") : "");
  const [threshold, setThreshold] = useState(String(r.failureThresholdPct));
  const [minCount, setMinCount] = useState(String(r.failureMinCount));
  return (
    <Confirm title={`Rollout for ${r.version}`} message="Changing who is included moves PCs in or out. Widening the share only adds PCs." action="Save rollout" onClose={onClose}
      extra={<div className="grid gap-3 sm:grid-cols-2">
        <Field label="Share of eligible PCs (%)"><Input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} /></Field>
        <Field label="Who"><Select value={type} onChange={(e) => setType(e.target.value as Target["type"])}><option value="all">All registered PCs</option><option value="beta">Beta testing group</option><option value="customers">Selected customers</option><option value="businesses">Selected businesses</option><option value="installations">Selected PCs</option><option value="license_types">Selected license types</option></Select></Field>
        {!["all", "beta"].includes(type) && <Field label={type === "customers" ? "Customer names, one per line" : type === "businesses" ? "Business IDs, one per line" : type === "installations" ? "Installation IDs, one per line" : "License types, one per line (annual, lifetime…)"} className="sm:col-span-2"><Textarea rows={3} value={ids} onChange={(e) => setIds(e.target.value)} className="font-mono" /></Field>}
        <Field label="Pause if failures reach (%)"><Input type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
        <Field label="Once this many PCs fail"><Input type="number" min={1} value={minCount} onChange={(e) => setMinCount(e.target.value)} /></Field>
      </div>}
      run={async (reason) => {
        const list = ids.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean);
        await api(`/platform-admin/releases/${r.id}`, { method: "PATCH", body: { rolloutPercent: Number(percent), target: ["all", "beta"].includes(type) ? { type } : { type, ids: list }, failureThresholdPct: Number(threshold), failureMinCount: Number(minCount), reason } });
        await onDone(`Rollout saved for ${r.version}.`);
      }} />
  );
}

function PcsTab() {
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState("");
  const [os, setOs] = useState("");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [seen, setSeen] = useState("");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<Pc | null>(null);
  const [editing, setEditing] = useState<Pc | null>(null);
  const url = useMemo(() => { const p = new URLSearchParams({ page: String(page), pageSize: "25" }); if (search.trim()) p.set("search", search.trim()); if (version) p.set("version", version); if (os) p.set("os", os); if (status) p.set("status", status); if (channel) p.set("channel", channel); if (seen) p.set("seenWithinDays", seen); return `/platform-admin/release-pcs?${p}`; }, [search, version, os, status, channel, seen, page]);
  const { data, error, reload } = useAdminData<Pcs>(url);
  return (
    <Panel padded={false} title="PCs and their versions" description="From each PC's last check-in.">
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
        <label className="relative min-w-52 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" /><Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Customer, business, PC or ID" className="ps-9" aria-label="Search PCs" /></label>
        <Select aria-label="Version" className="w-auto" value={version} onChange={(e) => { setVersion(e.target.value); setPage(1); }}><option value="">All versions</option>{data?.filters.versions.map((v) => <option key={v}>{v}</option>)}</Select>
        <Select aria-label="Operating system" className="w-auto" value={os} onChange={(e) => { setOs(e.target.value); setPage(1); }}><option value="">All systems</option>{data?.filters.systems.map((v) => <option key={v}>{v}</option>)}</Select>
        <Select aria-label="Update status" className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(PC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select aria-label="Release channel" className="w-auto" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All channels</option><option value="stable">Stable</option><option value="beta">Beta</option><option value="preview">Preview</option></Select>
        <Select aria-label="Last check-in" className="w-auto" value={seen} onChange={(e) => { setSeen(e.target.value); setPage(1); }}><option value="">Any check-in</option><option value="1">Last day</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>
      </div>
      {!data ? <div className="p-5"><LoadingRows /></div> : !data.items.length ? <div className="p-6"><EmptyState icon={Monitor} title="No PCs here">PCs appear once they connect with a server address set.</EmptyState></div> : (
        <>
          <DataTable minWidth={1240} head={["Customer", "Business", "PC", "Installation ID", "System", "Version", "Latest eligible", "Channel", "Last check-in", "Last update", "Status", ""]}>
            {data.items.map((p) => (
              <tr key={p.installationId}>
                <td className="px-4 py-3">{p.customerName ?? "—"}</td><td className="px-4 py-3">{p.business ?? "—"}</td><td className="px-4 py-3">{p.pcName ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs" title={p.installationId}>{p.installationId.slice(0, 8)}</td><td className="px-4 py-3 text-xs">{p.osVersion ?? "—"}</td><td className="px-4 py-3 font-medium">{p.appVersion ?? "—"}</td><td className="px-4 py-3">{p.latestEligible ?? "—"}</td>
                <td className="px-4 py-3 capitalize">{p.channel}{p.betaGroup && <span className="ms-1"><Badge color="blue">Beta group</Badge></span>}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{p.lastSyncAt ? dateTimeLabel(p.lastSyncAt) : "Never"}</td><td className="px-4 py-3 text-xs text-slate-600">{p.lastSuccessAt ? `${p.lastSuccessVersion} · ${dateLabel(p.lastSuccessAt)}` : "—"}</td>
                <td className="px-4 py-3"><Badge color={PC_STATUS[p.updateState]?.color ?? "slate"}>{PC_STATUS[p.updateState]?.label ?? p.updateState}</Badge>{p.lastError && p.updateState === "failed" && <span className="block max-w-[14rem] text-xs text-red-700">{p.lastError}</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-end"><Button size="sm" variant="ghost" onClick={() => setViewing(p)}>History</Button><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Channel</Button></td>
              </tr>
            ))}
          </DataTable>
          <div className="p-3"><Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>
        </>
      )}
      {viewing && <PcHistory pc={viewing} onClose={() => setViewing(null)} />}
      {editing && <PcChannel pc={editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
    </Panel>
  );
}

function PcHistory({ pc, onClose }: { pc: Pc; onClose: () => void }) {
  const { data, error } = useAdminData<{ reports: { id: string; fromVersion: string | null; toVersion: string; status: string; detail: string | null; createdAt: string }[]; checkIns: { id: string; result: string; appVersion: string | null; createdAt: string }[] }>(`/platform-admin/release-pcs/${pc.installationId}/history`);
  return (
    <Modal open title={`Update history: ${pc.pcName ?? pc.installationId.slice(0, 8)}`} onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {!data ? <LoadingRows rows={4} /> : !data.reports.length ? <p className="text-sm text-slate-500">No updates recorded yet.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">{data.reports.map((r) => <li key={r.id} className="py-2"><span className="font-medium">{`${r.fromVersion ?? "?"} → ${r.toVersion}`}</span> <span className="text-slate-600">{r.status.replace("_", " ")}</span><span className="block text-xs text-slate-500">{dateTimeLabel(r.createdAt)}{r.detail ? ` · ${r.detail}` : ""}</span></li>)}</ul>
      )}
      {!!data?.checkIns.length && <p className="mt-3 text-xs text-slate-500">{`${data.checkIns.length} recent check-ins. Latest ${dateTimeLabel(data.checkIns[0].createdAt)}.`}</p>}
    </Modal>
  );
}

function PcChannel({ pc, onClose, onDone }: { pc: Pc; onClose: () => void; onDone: () => Promise<void> }) {
  const [channel, setChannel] = useState(pc.channel);
  const [beta, setBeta] = useState(pc.betaGroup);
  return (
    <Confirm title={`Release channel: ${pc.pcName ?? pc.installationId.slice(0, 8)}`} message="Stable PCs only get stable releases. Beta also gets beta, and preview gets everything. The beta testing group is offered releases in testing." action="Save" onClose={onClose}
      extra={<div className="grid gap-3 sm:grid-cols-2"><Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="stable">Stable</option><option value="beta">Beta</option><option value="preview">Preview</option></Select></Field><label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={beta} onChange={(e) => setBeta(e.target.checked)} />In the beta testing group</label></div>}
      run={async (reason) => { await api(`/platform-admin/release-pcs/${pc.installationId}`, { method: "PATCH", body: { channel, betaGroup: beta, reason } }); await onDone(); }} />
  );
}

function RollbackTab({ data, onDone, onFail }: { data: Data; onDone: (t: string) => Promise<void>; onFail: (t: string) => void }) {
  const candidates = data.releases.filter((r) => r.sha256 && r.status !== "withdrawn" && r.rollbackAvailable);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(candidates.find((r) => r.recommended)?.version ?? "");
  const [ids, setIds] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [stopping, setStopping] = useState<Rollback | null>(null);
  const list = ids.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean);
  return (
    <div className="space-y-5">
      <Panel title="Send PCs back to an earlier version" description="Only the program goes back. The database is not rolled back: migrations only add to it, so an earlier version keeps working on it, and each PC backs up before installing.">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <Field label="From the faulty version"><Select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{data.releases.map((r) => <option key={r.id}>{r.version}</option>)}</Select></Field>
          <Field label="To"><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{candidates.map((r) => <option key={r.id} value={r.version}>{`${r.version}${r.recommended ? " (recommended)" : ""}`}</option>)}</Select></Field>
          <Field label="Only these PCs (optional)" hint="Installation IDs, one per line. Blank means all PCs on that version."><Textarea rows={1} value={ids} onChange={(e) => setIds(e.target.value)} className="font-mono" /></Field>
          <Button disabled={!from || !to} onClick={() => setConfirm(true)}><RotateCcw className="h-4 w-4" />Start rollback</Button>
        </div>
      </Panel>
      <Panel padded={false} title="Rollbacks">
        {!data.rollbacks.length ? <div className="p-6"><EmptyState icon={RotateCcw} title="None">Rollbacks you start appear here with their progress.</EmptyState></div> : (
          <DataTable minWidth={760} head={["Started", "Versions", "Reason", "Still on old version", "Now on target", "Failed", "Status", ""]}>
            {data.rollbacks.map((b) => <tr key={b.id}><td className="px-5 py-3 text-xs text-slate-600">{dateTimeLabel(b.createdAt)}</td><td className="px-5 py-3 font-medium">{`${b.fromVersion} → ${b.toVersion}`}</td><td className="max-w-xs px-5 py-3 text-xs text-slate-600">{b.reason}</td><td className="px-5 py-3 tabular-nums">{b.onOldVersion}</td><td className="px-5 py-3 tabular-nums">{b.onTarget}</td><td className="px-5 py-3 tabular-nums">{(b.progress.failed ?? 0) + (b.progress.rolled_back ?? 0)}</td><td className="px-5 py-3"><Badge color={b.status === "active" ? "amber" : "slate"}>{b.status === "active" ? "Running" : "Stopped"}</Badge></td><td className="px-5 py-3 text-end">{b.status === "active" && <Button size="sm" variant="ghost" onClick={() => setStopping(b)}>Stop</Button>}</td></tr>)}
          </DataTable>
        )}
      </Panel>
      {!!data.recentFailures.length && (
        <Panel padded={false} title={<span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 text-amber-600" />Failed updates</span>}>
          <DataTable minWidth={640} head={["When", "PC", "Update", "Result", "Detail"]}>
            {data.recentFailures.map((f) => <tr key={f.id}><td className="px-5 py-3 text-xs text-slate-600">{dateTimeLabel(f.createdAt)}</td><td className="px-5 py-3 font-mono text-xs">{f.installationId.slice(0, 8)}</td><td className="px-5 py-3">{`${f.fromVersion ?? "?"} → ${f.toVersion}`}</td><td className="px-5 py-3"><Badge color="red">{f.status === "rolled_back" ? "Rolled back" : "Failed"}</Badge></td><td className="px-5 py-3 text-xs text-slate-600">{f.detail}</td></tr>)}
          </DataTable>
        </Panel>
      )}
      {confirm && <Confirm title={`Roll back ${from} to ${to}`} message={list.length ? `${list.length} PCs are offered ${to} at their next check-in.` : `Every PC on ${from} is offered ${to} at its next check-in. A PC that is offline gets it when it reconnects.`} action="Start rollback" danger onClose={() => setConfirm(false)} run={async (reason) => { await api("/platform-admin/releases/rollbacks", { body: { fromVersion: from, toVersion: to, scope: list.length ? { type: "installations", ids: list } : { type: "all" }, reason } }); setConfirm(false); setIds(""); await onDone(`Rollback from ${from} to ${to} started.`); }} />}
      {stopping && <Confirm title="Stop this rollback" message="No more PCs are sent back. PCs already sent back stay where they are." action="Stop rollback" onClose={() => setStopping(null)} run={async (reason) => { try { await api(`/platform-admin/releases/rollbacks/${stopping.id}/stop`, { body: { reason } }); setStopping(null); await onDone("Rollback stopped."); } catch (e) { onFail(e instanceof Error ? e.message : "Could not stop."); throw e; } }} />}
    </div>
  );
}

function NewRelease({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [f, setF] = useState({ productName: "Drycare for Windows", version: "", buildNumber: "", title: "", channel: "stable", notes: "", releaseDate: "", architecture: "x64", packageType: "exe", mode: "optional", automatic: false, restartRequired: true, deadline: "", windowStart: "", windowEnd: "", minVersion: "", rollbackAvailable: true, message: "", stages: "10, 25, 50, 100", threshold: "20", minCount: "3" });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mandatory = f.mode === "mandatory";
  // Settings that cannot go together are ruled out here too, and the server checks them again.
  const clash = f.automatic && (f.windowStart === "" || f.windowEnd === "") ? "An automatic update needs a maintenance window, so it never interrupts work." : f.deadline && !mandatory ? "A deadline only applies to a mandatory update." : "";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/platform-admin/releases", { body: {
        productName: f.productName, version: f.version.trim(), buildNumber: f.buildNumber || null, title: f.title || null, channel: f.channel, notes: f.notes, releaseDate: f.releaseDate || null, architecture: f.architecture, packageType: f.packageType,
        mandatory, automatic: f.automatic, restartRequired: f.restartRequired, updateDeadline: f.deadline ? new Date(f.deadline).toISOString() : null, maintenanceStart: f.windowStart === "" ? null : Number(f.windowStart), maintenanceEnd: f.windowEnd === "" ? null : Number(f.windowEnd),
        minSupportedVersion: f.minVersion.trim() || null, rollbackAvailable: f.rollbackAvailable, notificationMessage: f.message || null, stages: f.stages.split(",").map((x) => Number(x.trim())).filter(Boolean), failureThresholdPct: Number(f.threshold), failureMinCount: Number(f.minCount),
      } });
      await onDone(`Version ${f.version} added as a draft. Open Details to upload its installer.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
      setBusy(false);
    }
  }
  return (
    <Modal open title="Add new version" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button form="new-release" type="submit" loading={busy} disabled={!f.version.trim() || Boolean(clash)}>Add as draft</Button></>}>
      <form id="new-release" onSubmit={submit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold text-slate-900">Release information</legend>
          <Field label="Product"><Input value={f.productName} onChange={(e) => set({ productName: e.target.value })} /></Field>
          <Field label="Version" required><Input required value={f.version} onChange={(e) => set({ version: e.target.value })} placeholder="0.1.23" /></Field>
          <Field label="Build number"><Input value={f.buildNumber} onChange={(e) => set({ buildNumber: e.target.value })} /></Field>
          <Field label="Channel"><Select value={f.channel} onChange={(e) => set({ channel: e.target.value })}><option value="stable">Stable</option><option value="beta">Beta</option><option value="preview">Preview</option></Select></Field>
          <Field label="Title"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Release date"><Input type="date" value={f.releaseDate} onChange={(e) => set({ releaseDate: e.target.value })} /></Field>
          <Field label="Release notes" className="sm:col-span-2" hint="Shown to the shop before it updates."><Textarea rows={3} maxLength={4000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold text-slate-900">Package</legend>
          <Field label="Type" hint="The updater delivers an .exe. An .msi is for installing by hand."><Select value={f.packageType} onChange={(e) => set({ packageType: e.target.value })}><option value="exe">Windows .exe installer</option><option value="msi">Windows .msi installer</option></Select></Field>
          <Field label="Architecture"><Select value={f.architecture} onChange={(e) => set({ architecture: e.target.value })}><option value="x64">x64</option><option value="arm64">ARM64</option></Select></Field>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold text-slate-900">Update settings</legend>
          <Field label="This update is"><Select value={f.mode} onChange={(e) => set({ mode: e.target.value, deadline: e.target.value === "mandatory" ? f.deadline : "" })}><option value="optional">Optional: the shop can postpone</option><option value="mandatory">Mandatory: the shop cannot postpone</option></Select></Field>
          <Field label="Deadline" hint="Mandatory updates only."><Input type="datetime-local" disabled={!mandatory} value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} /></Field>
          <Field label="Maintenance window starts (hour)" hint="0 to 23, on the PC's own clock."><Input type="number" min={0} max={23} value={f.windowStart} onChange={(e) => set({ windowStart: e.target.value })} /></Field>
          <Field label="Maintenance window ends (hour)"><Input type="number" min={0} max={23} value={f.windowEnd} onChange={(e) => set({ windowEnd: e.target.value })} /></Field>
          <Field label="Minimum supported version"><Input value={f.minVersion} onChange={(e) => set({ minVersion: e.target.value })} placeholder="e.g. 0.1.20" /></Field>
          <Field label="Message to the shop"><Input maxLength={500} value={f.message} onChange={(e) => set({ message: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.automatic} onChange={(e) => set({ automatic: e.target.checked })} />Automatic: install in the window when the PC is quiet</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.restartRequired} onChange={(e) => set({ restartRequired: e.target.checked })} />Restart required</label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.rollbackAvailable} onChange={(e) => set({ rollbackAvailable: e.target.checked })} />PCs can be sent back to this version</label>
          {clash && <div className="sm:col-span-2"><Alert tone="amber">{clash}</Alert></div>}
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold text-slate-900">Rollout</legend>
          <Field label="Stages (%)"><Input value={f.stages} onChange={(e) => set({ stages: e.target.value })} /></Field>
          <Field label="Pause if failures reach (%)"><Input type="number" min={1} max={100} value={f.threshold} onChange={(e) => set({ threshold: e.target.value })} /></Field>
          <Field label="Once this many PCs fail"><Input type="number" min={1} value={f.minCount} onChange={(e) => set({ minCount: e.target.value })} /></Field>
        </fieldset>
      </form>
    </Modal>
  );
}
