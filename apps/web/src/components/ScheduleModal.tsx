"use client";
import { useEffect, useState } from "react";
import { TIME_SLOTS } from "@drycare/shared";
import { api, ApiError } from "@/lib/api";
import { money, todayISO } from "@/lib/format";
import { Alert, Button, Field, Input, Modal, Select, cx } from "@/components/ui";
import { addressLine } from "@/components/DeliveryModals";

/** Schedule a pickup or delivery. `customerId` / `orderId` pre-fill it when opened from an order or profile. */
export function ScheduleModal({
  branchId,
  initialKind = "pickup",
  customerId: initialCustomerId,
  orderId: initialOrderId,
  canCredit,
  onClose,
  onDone,
}: {
  branchId: string;
  initialKind?: "pickup" | "delivery";
  customerId?: string;
  orderId?: string;
  canCredit: boolean;
  onClose: () => void;
  onDone: (d: any) => void;
}) {
  const [kind, setKind] = useState<"pickup" | "delivery">(initialKind);
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [customer, setCustomer] = useState<any>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderId, setOrderId] = useState(initialOrderId ?? "");
  const [addressId, setAddressId] = useState("");
  const [addr, setAddr] = useState({ line1: "", locality: "", city: "", pincode: "", landmark: "" });
  const [date, setDate] = useState(todayISO());
  const [slot, setSlot] = useState<string>(TIME_SLOTS[1]);
  const [instructions, setInstructions] = useState("");
  const [payMode, setPayMode] = useState<"collect" | "credit">("collect");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Load the customer's saved addresses and deliverable orders.
  useEffect(() => {
    if (!customerId) {
      setCustomer(null);
      setOrders([]);
      return;
    }
    api(`/customers/${customerId}`).then((full) => {
      setCustomer(full);
      setAddressId((full.addresses.find((a: any) => a.isDefault) ?? full.addresses[0])?.id ?? "");
    });
    api<any[]>(`/customers/${customerId}/orders`).then((os) => setOrders(os.filter((o) => ["ready", "partially_ready", "partially_delivered"].includes(o.operational_status))));
  }, [customerId]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => api(`/customers?q=${encodeURIComponent(q.trim())}&limit=6`).then((r) => setResults(r.items)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const order = orders.find((o) => o.id === orderId);
  const balance = Number(order?.balance ?? 0);

  async function submit() {
    setErr("");
    setBusy(true);
    const address = addressId ? undefined : Object.fromEntries(Object.entries(addr).filter(([, v]) => v.trim()));
    try {
      onDone(
        await api("/deliveries", {
          body: {
            kind,
            customerId,
            branchId,
            orderId: kind === "delivery" ? orderId : undefined,
            addressId: addressId || undefined,
            address,
            scheduledDate: date,
            timeSlot: slot,
            instructions: instructions || undefined,
            collectOnDelivery: kind === "delivery" && balance > 0 && payMode === "collect",
            onCredit: kind === "delivery" && balance > 0 && payMode === "credit",
          },
        }),
      );
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  const complete = customer && (addressId || addr.line1.trim().length >= 3) && (kind === "pickup" || orderId);
  return (
    <Modal
      open
      wide
      title={`Schedule ${kind}`}
      onClose={onClose}
      footer={
        <Button onClick={submit} loading={busy} disabled={!complete}>
          Schedule {kind}
        </Button>
      }
    >
      {err && <Alert>{err}</Alert>}
      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {(["pickup", "delivery"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cx("flex-1 rounded-md py-1.5 text-sm font-medium", kind === k ? "bg-slate-900 text-white" : "text-slate-600")}>
            {k === "pickup" ? "Pick up from customer" : "Deliver to customer"}
          </button>
        ))}
      </div>

      {!customerId ? (
        <Field label="Customer">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mobile number or name" />
          {results.length > 0 && (
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {results.map((c) => (
                <li key={c.id}>
                  <button className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => (setCustomerId(c.id), setQ(""))}>
                    {c.name} · {c.phone ?? "no phone"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      ) : (
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span>
            <strong>{customer?.name ?? "…"}</strong> · {customer?.phone ?? "no phone"}
          </span>
          {!initialCustomerId && (
            <button className="text-xs font-medium text-brand-700" onClick={() => (setCustomerId(""), setOrderId(""), setAddressId(""))}>
              Change
            </button>
          )}
        </div>
      )}

      {customer && kind === "delivery" && (
        <Field label="Order">
          <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Choose an order with ready garments…</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_number} · {o.garment_count} item(s){Number(o.balance) > 0 ? ` · due ${money(o.balance)}` : " · paid"}
              </option>
            ))}
          </Select>
          {orders.length === 0 && <span className="mt-1 block text-xs text-slate-500">No orders of this customer are ready yet.</span>}
        </Field>
      )}

      {kind === "delivery" && balance > 0 && (
        <Field label={`Balance due: ${money(balance)}`}>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={payMode === "collect"} onChange={() => setPayMode("collect")} /> Agent collects on delivery
            </label>
            {canCredit && (
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={payMode === "credit"} onChange={() => setPayMode("credit")} /> Deliver on credit
              </label>
            )}
          </div>
        </Field>
      )}

      {customer && (
        <Field label="Address">
          <Select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
            {customer.addresses?.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.label}: {addressLine(a.address)}
              </option>
            ))}
            <option value="">New address…</option>
          </Select>
          {!addressId && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input className="col-span-2" placeholder="Flat / building / street" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
              <Input placeholder="Locality" value={addr.locality} onChange={(e) => setAddr({ ...addr, locality: e.target.value })} />
              <Input placeholder="Landmark" value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} />
              <Input placeholder="City" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
              <Input placeholder="PIN code" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} />
            </div>
          )}
        </Field>
      )}

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
      <Field label="Instructions for the agent">
        <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. call before arriving, 3rd floor, no lift" />
      </Field>
    </Modal>
  );
}
