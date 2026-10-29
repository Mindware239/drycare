"use client";
import { useRef, useState } from "react";
import { TIME_SLOTS } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { money, rupeesToPaise, todayISO } from "@/lib/format";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea, cx } from "@/components/ui";

export const KIND_LABEL: Record<string, string> = { pickup: "Pickup", delivery: "Delivery" };
export const DELIVERY_STATUS: Record<string, { label: string; color: "blue" | "violet" | "amber" | "green" | "red" | "slate" }> = {
  scheduled: { label: "Scheduled", color: "blue" },
  assigned: { label: "Assigned", color: "violet" },
  out: { label: "Out now", color: "amber" },
  completed: { label: "Completed", color: "green" },
  failed: { label: "Failed", color: "red" },
  cancelled: { label: "Cancelled", color: "slate" },
};
export const FAILURE_REASONS: [string, string][] = [
  ["customer_not_available", "Customer not available"],
  ["address_not_found", "Address not found"],
  ["customer_refused", "Customer refused"],
  ["payment_not_ready", "Payment not ready"],
  ["other", "Other"],
];

export function addressLine(a: Record<string, string> | undefined) {
  if (!a) return "";
  return [a.line1, a.locality, a.landmark && `near ${a.landmark}`, a.city, a.pincode].filter(Boolean).join(", ");
}
export const mapsUrl = (a: Record<string, string>) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine(a))}`;

export function DeliveryStatusBadge({ status }: { status: string }) {
  const s = DELIVERY_STATUS[status] ?? { label: status, color: "slate" as const };
  return <Badge color={s.color}>{s.label}</Badge>;
}

/** Verify each garment tag as it goes into the bag (FR-DEL-003). Pickups just confirm departure. */
export function DispatchModal({ stop, onClose, onDone }: { stop: any; onClose: () => void; onDone: (d: any) => void }) {
  const [scanned, setScanned] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const items: any[] = stop.items ?? [];
  const isDelivery = stop.kind === "delivery";
  const allScanned = items.every((i) => scanned.includes(i.tag_code));

  function scan(e: React.FormEvent) {
    e.preventDefault();
    const t = code.trim().toUpperCase();
    setCode("");
    if (!t) return;
    if (!items.some((i) => i.tag_code === t)) setErr(`${t} is not part of this delivery — keep it out of the bag.`);
    else {
      setErr("");
      setScanned((s) => (s.includes(t) ? s : [...s, t]));
    }
    input.current?.focus();
  }

  async function go() {
    setBusy(true);
    setErr("");
    try {
      onDone(await api(`/deliveries/${stop.id}/dispatch`, { body: { scannedTags: scanned } }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={isDelivery ? "Verify bag & send out" : "Start pickup"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy} disabled={isDelivery && !allScanned}>
            {isDelivery ? `Send out (${scanned.length}/${items.length})` : "Leave for pickup"}
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      {isDelivery ? (
        <>
          <p className="text-sm text-slate-600">Scan every garment tag as you put it in the bag.</p>
          <form onSubmit={scan}>
            <Input ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan tag…" className="font-mono" />
          </form>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {items.map((i) => (
              <li key={i.id} className={cx("flex items-center gap-2 px-3 py-2", scanned.includes(i.tag_code) && "bg-emerald-50")}>
                <span className="font-mono text-xs">{i.tag_code}</span>
                <span>
                  {i.garment_type_name}
                  {i.colour && ` · ${i.colour}`}
                </span>
                <span className="ml-auto">{scanned.includes(i.tag_code) ? <Badge color="green">In bag</Badge> : <Badge>Waiting</Badge>}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-slate-600">Confirm you are leaving to collect garments from {stop.customer_name}.</p>
      )}
    </Modal>
  );
}

export function CompleteModal({ stop, canCollect, onClose, onDone }: { stop: any; canCollect: boolean; onClose: () => void; onDone: (d: any) => void }) {
  const isDelivery = stop.kind === "delivery";
  const due = Number(stop.collect_amount ?? 0);
  const [outcome, setOutcome] = useState<"completed" | "failed">("completed");
  const [method, setMethod] = useState(stop.hasOtp ? "otp" : "in_person");
  const [otp, setOtp] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [bags, setBags] = useState("1");
  const [payAmount, setPayAmount] = useState(due ? (due / 100).toFixed(2) : "");
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);

  async function submit() {
    setErr("");
    setBusy(true);
    const paise = rupeesToPaise(payAmount);
    const body: any = { outcome, notes: notes || undefined };
    if (outcome === "failed") body.failureReason = reason || undefined;
    else if (isDelivery) {
      body.method = method;
      if (method === "otp") body.otp = otp;
      else body.receivedBy = receivedBy;
      if (paise > 0) body.payments = [{ amount: paise, method: payMethod, reference: payRef || undefined }];
    } else body.bagCount = Number(bags) || 0;
    try {
      onDone(await api(`/deliveries/${stop.id}/complete`, { body, idempotencyKey: key }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`${KIND_LABEL[stop.kind]} — ${stop.customer_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={outcome === "failed" ? "danger" : "primary"} onClick={submit} loading={busy} disabled={outcome === "failed" && !reason}>
            {outcome === "failed" ? "Record failed attempt" : isDelivery ? "Confirm delivered" : "Confirm collected"}
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {(["completed", "failed"] as const).map((o) => (
          <button key={o} onClick={() => setOutcome(o)} className={cx("flex-1 rounded-md py-2 text-sm font-medium", outcome === o ? (o === "failed" ? "bg-red-600 text-white" : "bg-brand-600 text-white") : "text-slate-600")}>
            {o === "completed" ? (isDelivery ? "Delivered" : "Collected") : "Could not complete"}
          </button>
        ))}
      </div>
      {outcome === "failed" ? (
        <Field label="Reason" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {FAILURE_REASONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      ) : isDelivery ? (
        <>
          <Field label="Proof of delivery">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {stop.hasOtp && <option value="otp">OTP from customer&apos;s phone</option>}
              <option value="signature">Signed on paper receipt</option>
              <option value="in_person">Handed to a named person</option>
            </Select>
          </Field>
          {method === "otp" ? (
            <Field label="6-digit OTP" hint="Ask the customer for the code DryCare sent them">
              <Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} className="text-center font-mono text-lg tracking-[0.4em]" />
            </Field>
          ) : (
            <Field label="Received by" required>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the person" />
            </Field>
          )}
          {due > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Collect {money(due)} before handing over</p>
              {canCollect ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                  </Select>
                  {payMethod !== "cash" && <Input className="col-span-2" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Transaction reference" />}
                </div>
              ) : (
                <p className="text-xs text-amber-800">You are not allowed to collect payments.</p>
              )}
            </div>
          )}
        </>
      ) : (
        <Field label="Bags collected">
          <Input inputMode="numeric" value={bags} onChange={(e) => setBags(e.target.value.replace(/\D/g, ""))} className="w-24" />
        </Field>
      )}
      <Field label="Notes">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function RescheduleModal({ stop, onClose, onDone }: { stop: any; onClose: () => void; onDone: (d: any) => void }) {
  const [date, setDate] = useState(stop.scheduled_date >= todayISO() ? stop.scheduled_date : todayISO());
  const [slot, setSlot] = useState(stop.time_slot);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal
      open
      title="Reschedule"
      onClose={onClose}
      footer={
        <Button
          onClick={() =>
            api(`/deliveries/${stop.id}/reschedule`, { body: { scheduledDate: date, timeSlot: slot, notes: notes || undefined } })
              .then(onDone)
              .catch((e: ApiError) => setErr(e.message))
          }
        >
          Save
        </Button>
      }
    >
      {err && <Alert>{err}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <Input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time slot">
          <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
            {TIME_SLOTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. customer asked for evening" />
      </Field>
    </Modal>
  );
}
