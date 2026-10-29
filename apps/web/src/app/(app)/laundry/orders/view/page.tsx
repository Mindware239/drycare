"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, PackageCheck, PlayCircle, Printer, XCircle } from "lucide-react";
import { LAUNDRY_METHOD_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, SHOP_PAYMENT_METHODS, type LaundryPricingMethod } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { ORDER_STATUS, kg, type LaundryConfig } from "../../laundry-ui";

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m;

function OrderInner() {
  const id = useSearchParams().get("id") ?? "";
  const { can } = useSession();
  const o = useApi<any>(id ? `/laundry/orders/${id}` : null);
  const cfg = useApi<LaundryConfig>(o.data ? `/laundry/config?branchId=${o.data.branchId}` : null);
  const [modal, setModal] = useState<null | "pay" | "cancel" | "book" | { verify: any }>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  async function act(key: string, path: string, ok: string, body: object = {}) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await api<any>(path, { body });
      o.setData(r.order ?? r);
      setMsg({ tone: "green", text: ok });
    } catch (e) {
      setMsg({ tone: "red", text: (e as ApiError).message });
      o.reload();
    } finally {
      setBusy("");
    }
  }

  if (o.error) return <Alert>{o.error.message}</Alert>;
  if (!o.data) return <Spinner />;
  const d = o.data;
  const st = ORDER_STATUS[d.status] ?? { label: d.status, color: "slate" as const };
  const done = ["cancelled", "collected"].includes(d.status);
  const service = cfg.data?.services.find((s) => s.id === d.serviceId);
  const bookable = (cfg.data?.machines ?? []).filter((m) => m.active && m.status === "available" && service?.machineTypes.includes(m.machineType));

  return (
    <div className="space-y-5">
      <Link href="/laundry/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Self-service orders</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-slate-900">{d.orderNumber}</h1><Badge color={st.color}>{st.label}</Badge></div>
          <p className="mt-1 text-sm text-slate-500">{d.serviceName} · {LAUNDRY_METHOD_LABELS[d.pricingMethod as LaundryPricingMethod]} · {d.guestName ?? d.customer?.name}{d.guestPhone ? ` (${d.guestPhone})` : ""} · {dateTime(d.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/laundry/receipt?id=${d.id}`} target="_blank" rel="noreferrer"><Button variant="secondary"><Printer className="h-4 w-4" />Receipt</Button></a>
          {!done && d.balance > 0 && can("laundry.operate") && <Button onClick={() => setModal("pay")}>Take {money(d.balance)}</Button>}
          {!done && can("laundry.operate") && bookable.length > 0 && <Button variant="secondary" onClick={() => setModal("book")}>Book a machine</Button>}
          {["ready", "paid", "in_progress"].includes(d.status) && can("laundry.operate") && <Button variant="secondary" onClick={() => act("collect", `/laundry/orders/${d.id}/collect`, "Marked as collected.")} loading={busy === "collect"}><PackageCheck className="h-4 w-4" />Collected</Button>}
          {!done && can("laundry.operate") && <Button variant="ghost" className="text-red-600" onClick={() => setModal("cancel")}><XCircle className="h-4 w-4" />Cancel</Button>}
        </div>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {d.cancelReason && <Alert>Cancelled: {d.cancelReason}</Alert>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card title="Machines" padded={false}>
            {!d.sessions.length ? <p className="p-4 text-sm text-slate-500">No machine booked yet.{bookable.length ? " Use “Book a machine”." : ""}</p> : (
              <ul className="divide-y divide-slate-100">
                {d.sessions.map((s: any) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{s.machine_name} <span className="font-normal text-slate-500">· {s.program_name ?? "Standard"} · {s.duration_minutes} min</span></p>
                      <p className="text-xs text-slate-500">{s.started_at ? `Started ${dateTime(s.started_at)}` : "Not started"}{s.ended_at ? ` · ended ${dateTime(s.ended_at)}` : ""}{s.status === "running" ? ` · ${s.status_source === "device" ? "confirmed by machine" : "started by staff"}` : ""}</p>
                      {s.error && <p className="text-xs font-medium text-red-700">{s.error}</p>}
                    </div>
                    <Badge color={s.status === "running" ? "violet" : s.status === "completed" ? "green" : s.status === "reserved" ? "blue" : s.status === "failed" ? "red" : "slate"}>{s.status}</Badge>
                    {can("laundry.operate") && s.status === "reserved" && <>
                      <Button size="sm" onClick={() => act(`start-${s.id}`, `/laundry/sessions/${s.id}/start`, `${s.machine_name} started.`)} loading={busy === `start-${s.id}`} disabled={d.balance > 0}><PlayCircle className="h-4 w-4" />Start</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(`cancel-${s.id}`, `/laundry/sessions/${s.id}/cancel`, "Booking cancelled.")}>Cancel booking</Button>
                    </>}
                    {can("laundry.operate") && s.status === "running" && <Button size="sm" onClick={() => act(`done-${s.id}`, `/laundry/sessions/${s.id}/complete`, "Cycle marked finished.")} loading={busy === `done-${s.id}`}><CheckCircle2 className="h-4 w-4" />Finished</Button>}
                  </li>
                ))}
              </ul>
            )}
            {d.balance > 0 && d.sessions.some((s: any) => s.status === "reserved") && <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700">Take the payment to unlock the machine.</p>}
          </Card>

          <Card title="Charges" padded={false}>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {d.items.map((i: any) => <tr key={i.id}><td className="px-4 py-2.5">{i.description}{d.pricingMethod === "item" ? ` × ${i.quantity}` : ""}</td><td className="px-4 py-2.5 text-right tabular-nums">{money(i.amount)}</td></tr>)}
              </tbody>
            </table>
            <dl className="ml-auto max-w-sm space-y-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-sm">
              {d.weightGrams ? <div className="flex justify-between text-slate-500"><dt>Weight (billed)</dt><dd>{kg(d.weightGrams)} ({kg(d.billableGrams)})</dd></div> : null}
              <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular-nums">{money(d.subtotal)}</dd></div>
              {d.discountTotal > 0 && <div className="flex justify-between text-slate-600"><dt>Discount{d.discountReason ? ` (${d.discountReason})` : ""}</dt><dd className="tabular-nums">− {money(d.discountTotal)}</dd></div>}
              <div className="flex justify-between text-slate-600"><dt>GST {d.taxBps / 100}%</dt><dd className="tabular-nums">{money(d.taxTotal)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(d.total)}</dd></div>
              <div className="flex justify-between text-emerald-700"><dt>Paid</dt><dd className="tabular-nums">{money(d.paid)}</dd></div>
              {d.refunded > 0 && <div className="flex justify-between text-red-600"><dt>Refunded</dt><dd className="tabular-nums">{money(d.refunded)}</dd></div>}
              <div className="flex justify-between font-semibold text-amber-700"><dt>Due</dt><dd className="tabular-nums">{money(d.balance)}</dd></div>
            </dl>
          </Card>
        </div>

        <Card title="Payments" padded={false}>
          {!d.payments.length ? <p className="p-4 text-sm text-slate-500">No payments yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.payments.map((p: any) => (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between"><span className="font-semibold tabular-nums">{money(p.allocated_amount)}</span><span className="flex gap-1.5">{p.status !== "succeeded" && <Badge color={p.status === "pending" ? "amber" : "red"}>{p.status === "pending" ? "awaiting bank check" : p.status}</Badge>}<Badge>{methodLabel(p.payment_method)}</Badge></span></div>
                  <p className="text-xs text-slate-500">{dateTime(p.received_at)} · {p.collected_by}{p.provider_reference ? ` · Ref ${p.provider_reference}` : ""}</p>
                  {p.status === "pending" && can("laundry.operate") && <button type="button" className="mt-1 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setModal({ verify: p })}>Verify transfer…</button>}
                </li>
              ))}
            </ul>
          )}
          {d.refunds.length > 0 && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">{d.refunds.map((r: any) => <p key={r.id}>Refund {money(r.amount)} ({methodLabel(r.method)}) — “{r.reason}”</p>)}</div>}
        </Card>
      </div>

      {modal === "pay" && <PayModal order={d} onClose={() => setModal(null)} onDone={(x) => { o.setData(x); setModal(null); setMsg({ tone: "green", text: "Payment recorded." }); }} />}
      {modal === "cancel" && <CancelModal order={d} canRefund={can("payments.refund")} onClose={() => setModal(null)} onDone={(x) => { o.setData(x); setModal(null); setMsg({ tone: "green", text: "Order cancelled." }); cfg.reload(); }} />}
      {modal === "book" && <BookModal order={d} machines={bookable} onClose={() => setModal(null)} onDone={(x) => { o.setData(x); setModal(null); setMsg({ tone: "green", text: "Machine booked." }); cfg.reload(); }} />}
      {modal && typeof modal === "object" && "verify" in modal && <VerifyModal orderId={d.id} payment={modal.verify} onClose={() => setModal(null)} onDone={(x) => { o.setData(x); setModal(null); }} />}
    </div>
  );
}

function PayModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: (o: any) => void }) {
  const [amount, setAmount] = useState((order.balance / 100).toFixed(2));
  const [method, setMethod] = useState("cash");
  const [ref, setRef] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      onDone(await api(`/laundry/orders/${order.id}/payments`, { body: { payments: [{ amount: rupeesToPaise(amount), method, reference: ref || undefined, awaitingVerification: method === "bank_transfer" && pending ? true : undefined }] }, idempotencyKey: key }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Take payment · ${money(order.balance)} due`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Record payment</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select></Field>
        {method !== "cash" && <Field label="Reference" className="col-span-2"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
      </div>
      {method === "bank_transfer" && <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="mt-0.5" />Not yet seen in the bank — record as awaiting verification (machine stays locked)</label>}
    </Modal>
  );
}

function CancelModal({ order, canRefund, onClose, onDone }: { order: any; canRefund: boolean; onClose: () => void; onDone: (o: any) => void }) {
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("cash");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      onDone(await api(`/laundry/orders/${order.id}/cancel`, { body: { reason, refundMethod: order.paid > 0 ? method : undefined } }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title="Cancel order" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Keep order</Button><Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3 || (order.paid > 0 && !canRefund)}>Cancel{order.paid > 0 ? ` & refund ${money(order.paid)}` : ""}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">Booked machines are released. Orders whose machine has already run cannot be cancelled here.</p>
      {order.paid > 0 && (canRefund
        ? <Field label="Refund by"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{SHOP_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select></Field>
        : <Alert tone="amber">{money(order.paid)} was paid. A manager must cancel this order to approve the refund.</Alert>)}
      <Field label="Reason" required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function BookModal({ order, machines, onClose, onDone }: { order: any; machines: LaundryConfig["machines"]; onClose: () => void; onDone: (o: any) => void }) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const m = machines.find((x) => x.id === machineId);
  const [programId, setProgramId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      onDone(await api(`/laundry/orders/${order.id}/sessions`, { body: { machineId, programId: programId || m?.programs.find((p) => p.active)?.id } }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title="Book a machine" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!machineId}>Book</Button></>}>
      {err && <Alert>{err}</Alert>}
      <Field label="Machine"><Select value={machineId} onChange={(e) => { setMachineId(e.target.value); setProgramId(""); }}>{machines.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.machineType.replace("_", " ")}{x.capacityGrams ? `, ${x.capacityGrams / 1000} kg` : ""})</option>)}</Select></Field>
      {m && m.programs.some((p) => p.active) && <Field label="Program"><Select value={programId} onChange={(e) => setProgramId(e.target.value)}>{m.programs.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.durationMinutes} min</option>)}</Select></Field>}
    </Modal>
  );
}

function VerifyModal({ orderId, payment, onClose, onDone }: { orderId: string; payment: any; onClose: () => void; onDone: (o: any) => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function submit(outcome: "confirmed" | "rejected") {
    setErr("");
    try {
      onDone(await api(`/laundry/orders/${orderId}/verify-payment/${payment.id}`, { body: { outcome, note } }));
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  return (
    <Modal open title={`Verify bank transfer · ${money(payment.allocated_amount)}`} onClose={onClose} footer={<><Button variant="danger" onClick={() => submit("rejected")} disabled={note.trim().length < 3}>Not received</Button><Button onClick={() => submit("confirmed")} disabled={note.trim().length < 3}>Received in bank</Button></>}>
      {err && <Alert>{err}</Alert>}
      <Field label="Verification note" required><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Seen in bank statement" /></Field>
    </Modal>
  );
}

export default function LaundryOrderPage() {
  return <Suspense><OrderInner /></Suspense>;
}
