"use client";
import { useMemo, useState } from "react";
import { Banknote, CircleCheck, CircleMinus, CirclePlus, Clock3, CreditCard, Landmark, Lock, Receipt, Smartphone, Wallet } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, rupeesToPaise, todayISO } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Table, Td, Textarea, cx } from "@/components/ui";

/** Indian notes and coins in the drawer, largest first. */
const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const METHOD_META: Record<string, { label: string; icon: typeof Banknote }> = {
  cash: { label: "Cash", icon: Banknote },
  upi: { label: "UPI", icon: Smartphone },
  card: { label: "Card", icon: CreditCard },
  bank_transfer: { label: "Bank transfer", icon: Landmark },
  wallet: { label: "Wallet", icon: Wallet },
  other: { label: "Other", icon: Receipt },
};

function isoDaysAgo(days: number) {
  return new Date(Date.now() + 5.5 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);
}
function duration(from: string, to?: string | null) {
  const mins = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 60_000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export default function CashierPage() {
  const { branchId, branch, can } = useSession();
  const current = useApi<any>("/cashier-shifts/current");
  const history = useApi<any[]>(can("shifts.manage") ? "/cashier-shifts" : null);
  const [range, setRange] = useState({ from: todayISO(), to: todayISO(), preset: "today" });
  const recon = useApi<any[]>(can("reports.financial") ? `/payments/reconciliation?from=${range.from}&to=${range.to}${branchId ? `&branchId=${branchId}` : ""}` : null);
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState(false);
  const [msg, setMsg] = useState<{ t: "green" | "red" | "amber"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const shift = current.data?.shift;

  async function open() {
    setMsg(null);
    setBusy(true);
    try {
      await api("/cashier-shifts", { body: { branchId, openingCash: rupeesToPaise(opening || "0") } });
      setOpening("");
      current.reload();
      history.reload();
      setMsg({ t: "green", m: "Shift started. Cash you collect is now counted in your drawer." });
    } catch (e) {
      setMsg({ t: "red", m: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  const presets = [
    { key: "today", label: "Today", from: todayISO(), to: todayISO() },
    { key: "yesterday", label: "Yesterday", from: isoDaysAgo(1), to: isoDaysAgo(1) },
    { key: "week", label: "Last 7 days", from: isoDaysAgo(6), to: todayISO() },
    { key: "month", label: "This month", from: `${todayISO().slice(0, 8)}01`, to: todayISO() },
  ];
  const reconTotal = (recon.data ?? []).reduce((s, r) => ({ collected: s.collected + Number(r.collected), refunded: s.refunded + Number(r.refunded), net: s.net + Number(r.net) }), { collected: 0, refunded: 0, net: 0 });

  return (
    <div className="space-y-5">
      <PageHeader title="Cashier & shifts" subtitle={`Open a shift before taking cash at ${branch?.name ?? "the counter"}, then count the drawer when you close so every rupee is reconciled.`} />
      {msg && <Alert tone={msg.t} onClose={() => setMsg(null)}>{msg.m}</Alert>}

      {current.loading && !current.data ? <Spinner /> : shift ? (
        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/60 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" /></span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Your shift is open</p>
                <p className="text-xs text-slate-500">Since {dateTime(shift.openedAt)} · {duration(shift.openedAt)} · {shift.paymentCount} payment{shift.paymentCount === 1 ? "" : "s"} taken</p>
              </div>
            </div>
            <Button onClick={() => setClosing(true)}><Lock className="h-4 w-4" />Count drawer & close shift</Button>
          </div>
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-6">
            <Kpi label="Opening cash" value={money(shift.openingCash)} icon={Wallet} />
            <Kpi label="Cash received" value={money(shift.cashIn)} icon={CirclePlus} tone="text-emerald-700" />
            <Kpi label="Cash refunds" value={money(shift.cashOut)} icon={CircleMinus} tone={shift.cashOut ? "text-red-600" : undefined} />
            <Kpi label="Cash expenses" value={money(shift.cashExpenses ?? 0)} icon={Receipt} tone={shift.cashExpenses ? "text-red-600" : undefined} />
            <Kpi label="UPI / card / bank" value={money(shift.nonCash)} icon={Smartphone} hint="Not in the drawer" />
            <div className="bg-emerald-600 p-4 text-white">
              <p className="text-xs font-medium text-emerald-100">Expected in drawer</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(shift.expectedCash)}</p>
              <p className="mt-1 text-[11px] text-emerald-100">Opening + received − refunds − expenses</p>
            </div>
          </div>
        </section>
      ) : can("payments.collect") ? (
        <Card title={<span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-brand-700" />Start your shift at {branch?.name}</span>}>
          <p className="mb-4 text-sm text-slate-600">Count the cash already in the drawer (the float) and enter it. You cannot take cash payments until a shift is open.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Opening cash in drawer (₹)">
              <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^0-9.]/g, ""))} className="w-48 text-lg" placeholder="0" autoFocus />
            </Field>
            <Button size="lg" onClick={open} loading={busy}>Open shift</Button>
          </div>
        </Card>
      ) : (
        <Alert tone="blue">Your role does not take payments, so you do not need a cashier shift.</Alert>
      )}

      {can("reports.financial") && (
        <Card
          title="Collections by payment method"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                {presets.map((p) => <button key={p.key} type="button" onClick={() => setRange({ from: p.from, to: p.to, preset: p.key })} className={cx("rounded-md px-2.5 py-1", range.preset === p.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{p.label}</button>)}
              </div>
              <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value, preset: "" })} className="h-8 w-auto py-0 text-xs" aria-label="From" />
              <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value, preset: "" })} className="h-8 w-auto py-0 text-xs" aria-label="To" />
            </div>
          }
          padded={false}
        >
          {!recon.data ? <Spinner /> : (
            <>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                {recon.data.filter((r) => Number(r.collected) || Number(r.refunded)).map((r) => {
                  const meta = METHOD_META[r.method] ?? { label: r.method, icon: Receipt };
                  const share = reconTotal.net ? Math.round((Number(r.net) / reconTotal.net) * 100) : 0;
                  return (
                    <div key={r.method} className="rounded-xl border border-slate-200 p-3">
                      <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><meta.icon className="h-4 w-4" />{meta.label}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{money(r.net)}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} /></div>
                      <p className="mt-1 text-[11px] text-slate-500">{share}% of net{Number(r.refunded) ? ` · ${money(r.refunded)} refunded` : ""}</p>
                    </div>
                  );
                })}
                {!reconTotal.collected && !reconTotal.refunded && <p className="col-span-full py-4 text-center text-sm text-slate-500">No payments in this period.</p>}
              </div>
              <Table head={["Method", "Collected", "Refunded", "Net"]}>
                {recon.data.map((r) => (
                  <tr key={r.method}>
                    <Td className="font-medium">{METHOD_META[r.method]?.label ?? r.method}</Td>
                    <Td className="text-right tabular-nums">{money(r.collected)}</Td>
                    <Td className="text-right tabular-nums">{Number(r.refunded) ? `− ${money(r.refunded)}` : "—"}</Td>
                    <Td className="text-right font-medium tabular-nums">{money(r.net)}</Td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <Td>Total</Td>
                  <Td className="text-right tabular-nums">{money(reconTotal.collected)}</Td>
                  <Td className="text-right tabular-nums">{reconTotal.refunded ? `− ${money(reconTotal.refunded)}` : "—"}</Td>
                  <Td className="text-right tabular-nums">{money(reconTotal.net)}</Td>
                </tr>
              </Table>
            </>
          )}
        </Card>
      )}

      {history.data && (
        <Card title="Shift history" padded={false}>
          {!history.data.length ? <Empty title="No shifts yet">Closed shifts and their cash count appear here.</Empty> : (
            <Table head={["Cashier", "Branch", "Opened", "Duration", "Expected", "Counted", "Result"]}>
              {history.data.map(({ shift: s, userName, branchCode }) => (
                <tr key={s.id}>
                  <Td className="font-medium">{userName}</Td>
                  <Td>{branchCode}</Td>
                  <Td>{dateTime(s.openedAt)}</Td>
                  <Td>{s.closedAt ? duration(s.openedAt, s.closedAt) : <Badge color="green">Open now</Badge>}</Td>
                  <Td className="text-right tabular-nums">{s.closedAt ? money(s.expectedCash) : "—"}</Td>
                  <Td className="text-right tabular-nums">{s.closedAt ? money(s.countedCash) : "—"}</Td>
                  <Td>{!s.closedAt ? "—" : s.difference === 0 ? <Badge color="green">Matched</Badge> : s.difference < 0 ? <Badge color="red">Short {money(-s.difference)}</Badge> : <Badge color="amber">Over {money(s.difference)}</Badge>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {closing && shift && (
        <CloseShiftModal
          shift={shift}
          onClose={() => setClosing(false)}
          onClosed={(r) => {
            setClosing(false);
            setMsg(r.difference === 0
              ? { t: "green", m: `Shift closed. Drawer matches: ${money(r.countedCash)}.` }
              : { t: "amber", m: `Shift closed with the drawer ${r.difference < 0 ? "short" : "over"} by ${money(Math.abs(r.difference))} (counted ${money(r.countedCash)}, expected ${money(r.expectedCash)}).` });
            current.reload();
            history.reload();
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone, hint }: { label: string; value: string; icon: typeof Wallet; tone?: string; hint?: string }) {
  return (
    <div className="bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className={cx("mt-1 text-xl font-semibold tabular-nums text-slate-900", tone)}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Count notes and coins (or enter a total), see the difference before closing, and explain it. */
function CloseShiftModal({ shift, onClose, onClosed }: { shift: any; onClose: () => void; onClosed: (r: any) => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [manual, setManual] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fromNotes = useMemo(() => DENOMINATIONS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0) * 100, [counts]);
  const counted = manual ? rupeesToPaise(manual) : fromNotes;
  const difference = counted - shift.expectedCash;
  const hasCount = manual !== "" || Object.values(counts).some((v) => v !== "");

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      onClosed(await api(`/cashier-shifts/${shift.id}/close`, { body: { countedCash: counted, notes: notes.trim() || undefined } }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal open wide title="Count the drawer and close your shift" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Keep shift open</Button><Button onClick={submit} loading={busy} disabled={!hasCount || Number.isNaN(counted) || (difference !== 0 && notes.trim().length < 3)}>Close shift</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes & coins</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DENOMINATIONS.map((d) => (
              <label key={d} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <span className="w-10 shrink-0 text-sm font-semibold text-slate-700">₹{d}</span>
                <span className="text-slate-300">×</span>
                <Input inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => { setManual(""); setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, "").slice(0, 5) }); }} className="h-8 min-w-12 px-2 text-right" aria-label={`Number of ₹${d}`} placeholder="0" />
              </label>
            ))}
          </div>
          <Field label="Or enter the counted total (₹)" className="mt-3">
            <Input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={fromNotes ? (fromNotes / 100).toFixed(2) : "0.00"} className="w-48" />
          </Field>
        </div>
        <div className="space-y-3">
          <dl className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Expected</dt><dd className="font-semibold tabular-nums">{money(shift.expectedCash)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Counted</dt><dd className="font-semibold tabular-nums">{hasCount ? money(counted) : "—"}</dd></div>
            <div className={cx("flex items-center justify-between border-t border-slate-200 pt-2 font-semibold", !hasCount ? "text-slate-400" : difference === 0 ? "text-emerald-700" : difference < 0 ? "text-red-600" : "text-amber-700")}>
              <dt>{!hasCount ? "Difference" : difference === 0 ? "Matches" : difference < 0 ? "Short" : "Over"}</dt>
              <dd className="flex items-center gap-1 tabular-nums">{hasCount && difference === 0 && <CircleCheck className="h-4 w-4" />}{hasCount ? money(Math.abs(difference)) : "—"}</dd>
            </div>
          </dl>
          <Field label={difference !== 0 && hasCount ? "Explain the difference" : "Notes (optional)"} required={difference !== 0 && hasCount}>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={difference !== 0 && hasCount ? "e.g. ₹50 change given from personal cash" : ""} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
