"use client";
import { useEffect, useState } from "react";
import { Cloud, CloudOff, CloudUpload, ExternalLink, Link2, LoaderCircle, RefreshCw, TriangleAlert, Wifi, WifiOff } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Alert, Button, Field, Input, Modal, cx } from "@/components/ui";

type Status = {
  edition: "desktop" | "cloud"; captureEnabled: boolean; cloudConfigured: boolean; cloudLinked: boolean;
  cloudState: "not_linked" | "ok" | "offline" | "relink_required" | "plan_required" | "schema_too_new" | "restored";
  linkedBy: string | null;
  pending: number; failed: number; conflicts: number; synced: number; oldestPendingAt: string | null;
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; linkedAt: string | null;
  syncing: boolean; credentialExpiresAt: string | null;
  linking: { userCode: string; verificationUrl: string; expiresAt: string; status: "waiting" | "approved" | "denied" | "expired" | "failed"; message?: string } | null;
};

const HOLD_TEXT: Record<string, string> = {
  relink_required: "This PC was disconnected from DryCare Cloud or its access expired. Link it again; nothing has been lost.",
  plan_required: "Cloud sync needs an active DryCare Cloud plan for this shop. Changes are kept safely on this PC until then.",
  schema_too_new: "This PC runs a newer DryCare than the cloud. Changes wait on this PC until the cloud is updated.",
  restored: "This PC was restored from a backup, so uploads are paused: sending an older copy could undo newer data in the cloud. Ask DryCare support to check the cloud copy, then link again.",
  offline: "DryCare Cloud could not be reached. Changes are kept on this PC and upload automatically when the connection is back.",
};

/** Top-bar sync indicator of DryCare for Windows. Being online is never shown as proof that the cloud has the data. */
export function SyncStatus({ dark, canManage }: { dark: boolean; canManage: boolean }) {
  const status = useApi<Status>("/sync/status");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const s = status.data;

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => { setOnline(true); status.reload(); }, down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [status.reload]);
  // Poll faster while something is happening.
  useEffect(() => {
    const t = setInterval(() => status.reload(), s?.syncing || s?.linking?.status === "waiting" ? 3000 : 30_000);
    return () => clearInterval(t);
  }, [status.reload, s?.syncing, s?.linking?.status]);

  if (!s || s.edition !== "desktop") return null;

  const hold = s.cloudLinked && s.cloudState !== "ok" ? s.cloudState : null;
  const attention = s.conflicts > 0 || s.failed > 0 || hold === "relink_required" || hold === "plan_required" || hold === "schema_too_new" || hold === "restored";
  const label = !s.cloudConfigured ? "Saved on this PC"
    : !s.cloudLinked ? "Not linked to cloud"
    : s.syncing ? "Syncing…"
    : s.conflicts > 0 ? `${s.conflicts} to review`
    : hold === "restored" ? "Paused after restore"
    : hold === "relink_required" ? "Link again"
    : hold === "plan_required" ? "Cloud plan needed"
    : hold === "schema_too_new" ? "Cloud update pending"
    : s.failed > 0 ? "Sync errors"
    : s.pending > 0 ? `${s.pending.toLocaleString("en-IN")} to upload`
    : "Synced";
  const Icon = s.syncing ? LoaderCircle : attention ? TriangleAlert : !s.cloudLinked ? CloudOff : s.pending ? CloudUpload : Cloud;

  async function act(name: string, path: string, success: (j: any) => string) {
    setBusy(name);
    setNote(null);
    try {
      const j = await api(path, { body: {} });
      setNote({ tone: "green", text: success(j) });
      status.reload();
    } catch (e) {
      setNote({ tone: "red", text: (e as ApiError).message });
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <details className="relative">
        <summary
          className={cx("flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
            attention ? "border-amber-300 bg-amber-50 text-amber-800" : dark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
          aria-label={`Sync status: ${label}`}
          title="Sync status"
        >
          <Icon aria-hidden="true" className={cx("h-4 w-4", s.syncing && "animate-spin")} />
          <span className="hidden lg:inline">{label}</span>
        </summary>
        <div className="absolute right-0 z-40 mt-2 w-[340px] rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-900">Cloud sync</p>
            {s.syncing && <span className="inline-flex items-center gap-1 text-xs text-brand-700"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Uploading…</span>}
          </div>
          <dl className="mt-3 space-y-2.5">
            <Row label="Internet on this PC" value={<span className={cx("inline-flex items-center gap-1", online ? "text-emerald-700" : "text-amber-700")}>{online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{online ? "Online" : "Offline"}</span>} />
            <Row label="DryCare Cloud" value={!s.cloudConfigured ? <span className="text-slate-500">Not set up on this PC</span> : s.cloudLinked ? <span className={hold ? "text-amber-700" : "text-emerald-700"}>{hold ? "Linked · paused" : "Linked"}</span> : <span className="text-slate-500">Not linked</span>} />
            {s.cloudLinked && (
              <>
                {s.linkedBy && <Row label="Approved by" value={<span className="max-w-[170px] truncate">{s.linkedBy}</span>} />}
                <Row label="Waiting to upload" value={<span className="tabular-nums">{s.pending.toLocaleString("en-IN")}</span>} hint={s.oldestPendingAt ? `oldest from ${dateTime(s.oldestPendingAt)}` : undefined} />
                <Row label="Last successful cloud sync" value={s.lastSuccessAt ? dateTime(s.lastSuccessAt) : <span className="text-slate-500">Not yet</span>} />
                {s.failed > 0 && <Row label="Failed uploads" value={<span className="tabular-nums text-amber-700">{s.failed}</span>} hint={s.lastError ?? undefined} />}
                {s.conflicts > 0 && <Row label="Conflicts to review" value={<button type="button" onClick={() => setConflictsOpen(true)} className="font-semibold text-red-700 underline">{s.conflicts} — review</button>} />}
              </>
            )}
          </dl>
          {hold && <div className="mt-3"><Alert tone={hold === "offline" ? "blue" : "amber"}>{HOLD_TEXT[hold]}</Alert></div>}
          {!hold && (
            <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs leading-5 text-slate-600">
              {!s.cloudConfigured ? "Everything is saved in this PC's database and daily backups. DryCare Cloud is not set up on this PC."
                : !s.cloudLinked ? "Link this PC to see orders and reports from anywhere. The shop keeps working offline either way."
                : "Being online does not by itself mean the cloud has your latest changes — check “Last successful cloud sync”."}
            </p>
          )}
          {note && <div className="mt-3"><Alert tone={note.tone}>{note.text}</Alert></div>}
          {canManage && s.cloudConfigured && (
            <div className="mt-3 flex flex-wrap gap-2">
              {(!s.cloudLinked || hold === "relink_required" || hold === "restored") ? (
                <Button size="sm" className="flex-1" onClick={() => setLinkOpen(true)}><Link2 className="h-4 w-4" />{s.cloudLinked ? "Link again" : "Link to DryCare Cloud"}</Button>
              ) : (
                <Button size="sm" className="flex-1" loading={busy === "now"} disabled={s.syncing} onClick={() => act("now", "/sync/now", (j) => j.started ? (j.hold ? HOLD_TEXT[j.hold] ?? "Paused." : `${j.synced} change${j.synced === 1 ? "" : "s"} uploaded.`) : "Already uploading.")}>
                  <RefreshCw className="h-4 w-4" />Sync now
                </Button>
              )}
              {s.failed > 0 && <Button size="sm" variant="secondary" loading={busy === "retry"} onClick={() => act("retry", "/sync/retry", (j) => `${j.retried} change${j.retried === 1 ? "" : "s"} will be tried again.`)}>Retry failed</Button>}
            </div>
          )}
        </div>
      </details>
      {linkOpen && <LinkModal status={s} onClose={() => { setLinkOpen(false); status.reload(); }} reload={status.reload} />}
      {conflictsOpen && <ConflictsModal onClose={() => { setConflictsOpen(false); status.reload(); }} />}
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-800">{value}</dd></div>
      {hint && <p className="mt-0.5 truncate text-right text-[11px] text-slate-500" title={hint}>{hint}</p>}
    </div>
  );
}

/** Device authorisation: the PC shows a code, the owner approves it in DryCare Cloud in their browser. */
function LinkModal({ status, onClose, reload }: { status: Status; onClose: () => void; reload: () => void }) {
  const [name, setName] = useState("Counter PC");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const l = status.linking;
  const waiting = l?.status === "waiting";

  async function start() {
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ verificationUrl: string }>("/sync/cloud-link/start", { body: { deviceName: name.trim() || undefined } });
      window.open(r.verificationUrl, "_blank");
      reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    await api("/sync/cloud-link/cancel", { body: {} }).catch(() => {});
    onClose();
  }

  return (
    <Modal open title="Link this PC to DryCare Cloud" onClose={waiting ? cancel : onClose} footer={
      l?.status === "approved" ? <Button onClick={onClose}>Done</Button>
        : waiting ? <><Button variant="ghost" onClick={cancel}>Cancel</Button><a href={l!.verificationUrl} target="_blank" rel="noreferrer"><Button><ExternalLink className="h-4 w-4" />Open approval page</Button></a></>
        : <><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={start} loading={busy}>Start linking</Button></>
    }>
      {err && <Alert>{err}</Alert>}
      {l?.status === "approved" ? (
        <Alert tone="green">Linked. Your existing records are uploading now; the top bar shows progress. The shop keeps working while it runs.</Alert>
      ) : waiting ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-slate-600">Approve this PC in DryCare Cloud. Your browser opened the approval page; sign in there and check that the code matches:</p>
          <p className="font-mono text-3xl font-bold tracking-[0.2em] text-slate-900">{l!.userCode}</p>
          <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Waiting for approval · expires {dateTime(l!.expiresAt)}</p>
          {l!.message && <p className="text-xs text-amber-700">{l!.message}</p>}
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-600">
          {l?.status === "denied" && <Alert tone="amber">The request was declined in the cloud.</Alert>}
          {l?.status === "expired" && <Alert tone="amber">The code expired. Start again.</Alert>}
          {l?.status === "failed" && <Alert>{l.message ?? "Linking failed."}</Alert>}
          <p>Your orders, bills and reports will also be visible in DryCare Cloud, so you can check the shop from anywhere. The shop keeps working offline; changes upload whenever there is internet.</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>You approve this PC by signing in to DryCare Cloud — your cloud password is never typed here.</li>
            <li>Only one PC per shop can be linked, so invoice numbers stay unique.</li>
            <li>The cloud copy is view-only; keep making changes on this PC.</li>
          </ul>
          <Field label="Name for this PC"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        </div>
      )}
    </Modal>
  );
}

const TABLE_LABEL: Record<string, string> = { invoices: "Invoice", payments: "Payment", orders: "Order", customers: "Customer", refunds: "Refund", expenses: "Expense", inventory_movements: "Stock movement", customer_wallet_entries: "Wallet entry" };

function ConflictsModal({ onClose }: { onClose: () => void }) {
  const list = useApi<any[]>("/sync/conflicts");
  const [picked, setPicked] = useState<{ id: string; action: "retry" | "skip" } | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function resolve() {
    setBusy(true);
    setErr("");
    try {
      await api(`/sync/conflicts/${picked!.id}/resolve`, { body: { action: picked!.action, note } });
      setPicked(null);
      setNote("");
      list.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open wide title="Sync conflicts" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className="text-sm text-slate-600">The cloud has a different copy of these records. Nothing was overwritten. Check the record, then choose: <b>Upload again</b> (after the cloud copy was corrected) or <b>Keep the cloud version</b> (this PC change is not uploaded).</p>
      {err && <Alert>{err}</Alert>}
      {!list.data ? <p className="text-sm text-slate-500">Loading…</p> : !list.data.length ? <Alert tone="green">No open conflicts.</Alert> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {list.data.map((c) => (
            <li key={c.id} className="space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-900">{TABLE_LABEL[c.entityTable] ?? c.entityTable} <span className="font-mono text-xs font-normal text-slate-500">{String(c.entityId).slice(0, 8)}</span></span>
                <span className="text-xs text-slate-500">{dateTime(c.createdAt)}{c.heldChanges ? ` · ${c.heldChanges} later change${c.heldChanges === 1 ? "" : "s"} waiting` : ""}</span>
              </div>
              <p className="text-xs text-slate-600">{String(c.reason).replace(/^[A-Z_]+: /, "")}</p>
              {picked?.id === c.id ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Reason (kept in the audit log)" className="min-w-[14rem] flex-1"><Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Checked with support" /></Field>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
                  <Button size="sm" onClick={resolve} loading={busy} disabled={note.trim().length < 3}>{picked?.action === "retry" ? "Upload again" : "Keep cloud version"}</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setPicked({ id: c.id, action: "retry" }); setNote(""); }}>Upload again</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setPicked({ id: c.id, action: "skip" }); setNote(""); }}>Keep cloud version</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
