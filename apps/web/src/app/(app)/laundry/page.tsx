"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CirclePlus, History, PlayCircle, Plug, RefreshCw, Settings2, Sparkles, Timer, Wrench, X } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, todayISO } from "@/lib/format";
import { Alert, Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { MACHINE_ICON, STATUS_STYLE, StatusChip, kg, machineTypeLabel, remaining, type LaundryConfig, type LaundryMachineRow } from "./laundry-ui";

export default function LaundryBoardPage() {
  const { branchId, branch, can } = useSession();
  const config = useApi<LaundryConfig>(branchId ? `/laundry/config?branchId=${branchId}` : null);
  const today = todayISO();
  const stats = useApi<any>(branchId ? `/laundry/reports?branchId=${branchId}&from=${today}&to=${today}` : null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "amber"; text: string; orderId?: string } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "fail" | "maintenance" | "history"; machine: LaundryMachineRow }>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => { config.reload(); tick((n) => n + 1); }, 15_000);
    return () => clearInterval(t);
  }, [config.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, path: string, ok: string, body: object = {}) {
    setBusy(key);
    setMsg(null);
    try {
      await api(path, { body });
      setMsg({ tone: "green", text: ok });
      config.reload();
      stats.reload();
    } catch (e) {
      const err = e as ApiError;
      const m = config.data?.machines.find((x) => x.session && path.includes(x.session.id));
      setMsg({ tone: err.code === "PAYMENT_REQUIRED" ? "amber" : "red", text: err.message, orderId: m?.session?.orderId });
      config.reload();
    } finally {
      setBusy("");
    }
  }

  async function installDefaults() {
    setBusy("defaults");
    try {
      const r = await api<{ added: number }>("/laundry/setup-defaults", { body: {} });
      setMsg({ tone: "green", text: `${r.added} starter services added with typical prices. Adjust them in Laundry setup & pricing.` });
      config.reload();
    } catch (e) {
      setMsg({ tone: "red", text: (e as ApiError).message });
    } finally {
      setBusy("");
    }
  }

  if (config.error) return <Alert>{config.error.message}</Alert>;
  if (!config.data) return <Spinner />;
  const { services, machines } = config.data;
  const active = machines.filter((m) => m.active);
  const count = (s: string) => active.filter((m) => m.status === s).length;
  const t = stats.data?.totals;
  const groups = (["washer", "dryer", "iron_station"] as const).map((type) => ({ type, items: active.filter((m) => m.machineType === type) })).filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Self-service laundry"
        subtitle={`Live machine status at ${branch?.name ?? "this store"}. Updates every 15 seconds.`}
        actions={<>
          <Button variant="secondary" onClick={() => { config.reload(); stats.reload(); }}><RefreshCw className="h-4 w-4" />Refresh</Button>
          {can("laundry.operate") && <Link href="/laundry/new"><Button><CirclePlus className="h-4 w-4" />New self-service order</Button></Link>}
        </>}
      />
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}{msg.orderId && <> · <Link className="font-semibold underline" href={`/laundry/orders/view?id=${msg.orderId}`}>Open order</Link></>}</Alert>}

      {!services.length && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white"><Sparkles className="h-5 w-5" /></span>
          <div className="min-w-[14rem] flex-1">
            <p className="font-semibold text-slate-900">Set up self-service laundry</p>
            <p className="text-sm text-slate-600">Start with six ready-made services (wash, dry, ironing and combinations) priced by weight, item, cycle, time or package. Every price is editable.</p>
          </div>
          {can("laundry.manage") ? <Button onClick={installDefaults} loading={busy === "defaults"}>Add starter services</Button> : <span className="text-sm text-slate-500">Ask the owner to set this up.</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Available" value={count("available")} tone="text-emerald-700" />
        <Kpi label="Running" value={count("running")} tone="text-violet-700" />
        <Kpi label="To unload" value={count("completed")} tone="text-amber-700" />
        <Kpi label="Today's orders" value={t?.orders ?? "—"} hint={t ? `${t.cancelled} cancelled` : undefined} />
        <Kpi label="Today's sales" value={t ? money(t.billed) : "—"} hint={t ? `${money(t.collected - t.refunded)} collected` : undefined} />
      </div>

      {stats.data?.openMaintenance?.length > 0 && (
        <Alert tone="amber"><span className="inline-flex items-center gap-1.5"><Wrench className="h-4 w-4" />Under maintenance: {stats.data.openMaintenance.map((m: any) => `${m.machine} (${m.kind})`).join(", ")}</span></Alert>
      )}

      {!active.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white">
          <Empty title="No machines added yet">{can("laundry.manage") ? <>Add your washing machines, dryers and ironing stations in <Link href="/laundry/settings?tab=machines" className="font-semibold text-brand-700 underline">Laundry setup</Link>.</> : "Ask the owner to add the shop's machines."}</Empty>
        </div>
      ) : groups.map((g) => (
        <section key={g.type}>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{machineTypeLabel(g.type)}s · {g.items.length}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {g.items.map((m) => <MachineCard key={m.id} m={m} busy={busy} can={can} act={act} open={(kind) => setDialog({ kind, machine: m })} />)}
          </div>
        </section>
      ))}

      {dialog?.kind === "fail" && dialog.machine.session && <ReasonDialog title={`Report a problem · ${dialog.machine.name}`} label="What went wrong?" placeholder="e.g. Machine stopped mid-cycle, water leak" action="Stop & free machine" onClose={() => setDialog(null)} onSubmit={(reason) => act(`fail-${dialog.machine.id}`, `/laundry/sessions/${dialog.machine.session!.id}/fail`, `${dialog.machine.name} freed. Re-book the customer on another machine from the order.`, { reason }).then(() => setDialog(null))} />}
      {dialog?.kind === "maintenance" && <MaintenanceDialog machine={dialog.machine} onClose={() => setDialog(null)} onDone={(text) => { setDialog(null); setMsg({ tone: "green", text }); config.reload(); stats.reload(); }} />}
      {dialog?.kind === "history" && <HistoryDialog machine={dialog.machine} canMaintain={can("laundry.maintain")} onClose={() => setDialog(null)} onResolved={() => { config.reload(); stats.reload(); }} />}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums text-slate-900", tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function MachineCard({ m, busy, can, act, open }: { m: LaundryMachineRow; busy: string; can: (p: any) => boolean; act: (key: string, path: string, ok: string, body?: object) => Promise<void>; open: (kind: "fail" | "maintenance" | "history") => void }) {
  const Icon = MACHINE_ICON[m.machineType];
  const s = m.session;
  const left = s?.status === "running" ? remaining(s.expectedEndAt) : null;
  const style = STATUS_STYLE[m.status] ?? STATUS_STYLE.available;
  return (
    <div className={cx("flex flex-col rounded-2xl border-2 bg-white p-4 shadow-sm", style.card)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className={cx("flex h-11 w-11 items-center justify-center rounded-xl", m.status === "running" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600")}><Icon className={cx("h-6 w-6", m.status === "running" && "animate-pulse")} /></span>
          <div>
            <p className="font-semibold text-slate-900">{m.name}</p>
            <p className="text-xs text-slate-500">{m.code}{m.capacityGrams ? ` · ${kg(m.capacityGrams)}` : ""}{m.controlMode === "http" ? " · connected" : ""}</p>
          </div>
        </div>
        <StatusChip status={m.status} />
      </div>

      <div className="mt-3 min-h-[3.5rem] rounded-xl bg-slate-50 p-3 text-sm">
        {s ? (
          <>
            <p className="font-medium text-slate-800"><Link href={`/laundry/orders/view?id=${s.orderId}`} className="hover:underline">{s.orderNumber}</Link> · {s.customerName}</p>
            <p className="mt-0.5 text-xs text-slate-500">{s.programName ?? "Standard program"}</p>
            {s.status === "running" && left !== null && (
              <p className={cx("mt-1 flex items-center gap-1 text-xs font-semibold", left < 0 ? "text-amber-700" : "text-violet-700")}>
                <Timer className="h-3.5 w-3.5" />
                {left > 0 ? `About ${left} min left` : s.statusSource === "device" ? "Should be finishing now" : "Cycle time is up — check the machine and confirm"}
              </p>
            )}
            {s.status === "running" && <p className="mt-0.5 text-[11px] text-slate-400">{s.statusSource === "device" ? "Status from the machine" : "Started by staff · finish is confirmed by staff"}</p>}
            {s.error && <p className="mt-1 flex items-start gap-1 text-xs font-medium text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.error}</p>}
          </>
        ) : m.status === "completed" ? <p className="text-amber-800">Cycle finished. Take the laundry out, then release the machine.</p>
          : m.status === "available" ? <p className="text-emerald-700">Ready for the next customer.</p>
          : <p className="text-slate-500">Not in use.</p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {can("laundry.operate") && s?.status === "reserved" && <>
          <Button size="sm" onClick={() => act(`start-${m.id}`, `/laundry/sessions/${s.id}/start`, `${m.name} started.`)} loading={busy === `start-${m.id}`}><PlayCircle className="h-4 w-4" />{m.controlMode === "http" ? "Start machine" : "Mark started"}</Button>
          <Button size="sm" variant="secondary" onClick={() => act(`cancel-${m.id}`, `/laundry/sessions/${s.id}/cancel`, `Booking on ${m.name} cancelled.`)} loading={busy === `cancel-${m.id}`}>Cancel booking</Button>
        </>}
        {can("laundry.operate") && s?.status === "running" && <>
          <Button size="sm" onClick={() => act(`done-${m.id}`, `/laundry/sessions/${s.id}/complete`, `${m.name}: cycle marked finished.`)} loading={busy === `done-${m.id}`}><CheckCircle2 className="h-4 w-4" />Cycle finished</Button>
          {m.controlMode === "http" && <Button size="sm" variant="secondary" onClick={() => act(`chk-${m.id}`, `/laundry/sessions/${s.id}/refresh`, `${m.name}: status checked.`)} loading={busy === `chk-${m.id}`}><Plug className="h-4 w-4" />Check machine</Button>}
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => open("fail")}>Problem</Button>
        </>}
        {can("laundry.operate") && m.status === "completed" && <Button size="sm" onClick={() => act(`rel-${m.id}`, `/laundry/machines/${m.id}/release`, `${m.name} is available again.`)} loading={busy === `rel-${m.id}`}>Unloaded · release</Button>}
        {can("laundry.operate") && m.status === "available" && <Link href={`/laundry/new?machine=${m.id}`}><Button size="sm" variant="secondary"><CirclePlus className="h-4 w-4" />Book</Button></Link>}
        {can("laundry.maintain") && m.status === "available" && <Button size="sm" variant="ghost" onClick={() => open("maintenance")}><Wrench className="h-4 w-4" />Maintenance</Button>}
        <Button size="sm" variant="ghost" onClick={() => open("history")}><History className="h-4 w-4" />{["maintenance", "out_of_service"].includes(m.status) ? "Details / resolve" : "History"}</Button>
      </div>
    </div>
  );
}

function ReasonDialog({ title, label, placeholder, action, onClose, onSubmit }: { title: string; label: string; placeholder: string; action: string; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={async () => { setBusy(true); await onSubmit(reason); setBusy(false); }}>{action}</Button></>}>
      <Field label={label} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} autoFocus /></Field>
    </Modal>
  );
}

function MaintenanceDialog({ machine, onClose, onDone }: { machine: LaundryMachineRow; onClose: () => void; onDone: (text: string) => void }) {
  const [kind, setKind] = useState("service");
  const [status, setStatus] = useState("maintenance");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await api(`/laundry/machines/${machine.id}/maintenance`, { body: { kind, status, notes } });
      onDone(`${machine.name} taken out of use (${kind}).`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Maintenance · ${machine.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={notes.trim().length < 3}>Take out of use</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="service">Scheduled service</option><option value="breakdown">Breakdown</option><option value="cleaning">Cleaning</option><option value="inspection">Inspection</option></Select></Field>
        <Field label="Show as"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></Select></Field>
      </div>
      <Field label="Notes" required><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Drum bearing noise, technician booked for Friday" /></Field>
    </Modal>
  );
}

function HistoryDialog({ machine, canMaintain, onClose, onResolved }: { machine: LaundryMachineRow; canMaintain: boolean; onClose: () => void; onResolved: () => void }) {
  const h = useApi<{ maintenance: any[]; cycles: any[] }>(`/laundry/machines/${machine.id}/history`);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function resolve(id: string) {
    setErr("");
    try {
      await api(`/laundry/maintenance/${id}/resolve`, { body: { notes: note || undefined } });
      h.reload();
      onResolved();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  return (
    <Modal open wide title={`${machine.name} · history`} onClose={onClose}>
      {err && <Alert>{err}</Alert>}
      {!h.data ? <Spinner /> : (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Maintenance</p>
            {!h.data.maintenance.length ? <p className="text-sm text-slate-500">No maintenance recorded.</p> : (
              <ul className="space-y-2">
                {h.data.maintenance.map((x) => (
                  <li key={x.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                    <div className="flex items-center justify-between"><Badge color={x.ended_at ? "slate" : "amber"}>{x.kind}</Badge><span className="text-xs text-slate-500">{dateTime(x.started_at)}</span></div>
                    <p className="mt-1 whitespace-pre-line text-slate-700">{x.notes}</p>
                    <p className="mt-1 text-xs text-slate-500">{x.created_by_name}{x.ended_at ? ` · back in use ${dateTime(x.ended_at)}` : " · still open"}</p>
                    {!x.ended_at && canMaintain && (
                      <div className="mt-2 flex gap-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done (optional)" className="h-8 text-xs" /><Button size="sm" onClick={() => resolve(x.id)}>Back in use</Button></div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent cycles</p>
            {!h.data.cycles.length ? <p className="text-sm text-slate-500">No cycles yet.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {h.data.cycles.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-medium">{c.order_number}</span> <span className="text-xs text-slate-500">{c.program_name ?? ""}</span>{c.error && <span className="block text-xs text-red-600">{c.error}</span>}</span>
                    <span className="text-right text-xs"><Badge color={c.status === "completed" ? "green" : c.status === "failed" ? "red" : c.status === "running" ? "violet" : "slate"}>{c.status}</Badge><span className="block text-slate-400">{c.started_at ? dateTime(c.started_at) : "not started"}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}><X className="h-4 w-4" />Close</Button></div>
    </Modal>
  );
}
