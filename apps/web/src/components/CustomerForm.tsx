"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";

export const CUSTOMER_TYPES: Record<string, string> = { walk_in: "Walk-in", regular: "Regular", vip: "VIP", corporate: "Corporate", online: "Online" };
const TYPES = CUSTOMER_TYPES;

export function CustomerForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (c: any) => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    alternatePhone: initial?.alternatePhone ?? "",
    email: initial?.email ?? "",
    gstin: initial?.gstin ?? "",
    customerType: initial?.customerType ?? "walk_in",
    notificationChannel: initial?.notificationChannel ?? "whatsapp",
    marketingConsent: initial?.marketingConsent ?? false,
    careInstructions: initial?.careInstructions ?? "",
    notes: initial?.notes ?? "",
    addressLabel: initial?.addresses?.find((a: any) => a.isDefault)?.label ?? "Home",
    line1: initial?.addresses?.find((a: any) => a.isDefault)?.address.line1 ?? "",
    locality: initial?.addresses?.find((a: any) => a.isDefault)?.address.locality ?? "",
    city: initial?.addresses?.find((a: any) => a.isDefault)?.address.city ?? "",
    state: initial?.addresses?.find((a: any) => a.isDefault)?.address.state ?? "",
    pincode: initial?.addresses?.find((a: any) => a.isDefault)?.address.pincode ?? "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save(force = false) {
    setBusy(true);
    setErr("");
    const { line1, locality, city, state, pincode, addressLabel, ...rest } = f;
    const body: any = {
      ...rest,
      phone: rest.phone || null,
      alternatePhone: rest.alternatePhone || null,
      email: rest.email || null,
      gstin: rest.gstin || null,
      careInstructions: rest.careInstructions || undefined,
      notes: rest.notes || undefined,
    };
    if (line1.trim()) {
      body.address = {
        label: addressLabel || "Home",
        line1,
        locality: locality || undefined,
        city: city || undefined,
        state: state || undefined,
        pincode: pincode || undefined,
        isDefault: true,
      };
    }
    try {
      const c = initial ? await api(`/customers/${initial.id}`, { method: "PATCH", body }) : await api(`/customers${force ? "?force=true" : ""}`, { body });
      onSaved(c);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title={initial ? "Edit customer" : "New customer"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {err.includes("already exists") && (
            <Button variant="secondary" onClick={() => save(true)}>
              Create anyway
            </Button>
          )}
          <Button onClick={() => save()} loading={busy} disabled={!f.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      {err && <Alert tone="amber">{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required>
          <Input value={f.name} onChange={set("name")} autoFocus />
        </Field>
        <Field label="Customer type">
          <Select value={f.customerType} onChange={set("customerType")}>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mobile">
          <Input value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="Alternate phone">
          <Input value={f.alternatePhone} onChange={set("alternatePhone")} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Order updates via" hint="Operational messages: booking, ready, payment">
          <Select value={f.notificationChannel} onChange={set("notificationChannel")}>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="none">Don&apos;t notify</option>
          </Select>
        </Field>
        <Field label="GSTIN (optional)" hint="Customer tax registration number, printed where supported on invoices.">
          <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} autoComplete="off" />
        </Field>
        <Field label="Default address" className="sm:col-span-2">
          <Input value={f.line1} onChange={set("line1")} placeholder="House / street / locality" autoComplete="street-address" />
        </Field>
        <Field label="Address label">
          <Input value={f.addressLabel} onChange={set("addressLabel")} placeholder="Home, office…" />
        </Field>
        <Field label="Locality">
          <Input value={f.locality} onChange={set("locality")} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={set("city")} autoComplete="address-level2" />
        </Field>
        <Field label="State">
          <Input value={f.state} onChange={set("state")} autoComplete="address-level1" />
        </Field>
        <Field label="PIN code">
          <Input value={f.pincode} onChange={set("pincode")} autoComplete="postal-code" />
        </Field>
        <Field label="Garment-care preferences" className="sm:col-span-2">
          <Input value={f.careInstructions} onChange={set("careInstructions")} placeholder="e.g. no starch, hang shirts, mild detergent" />
        </Field>
        <Field label="Internal notes" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.marketingConsent} onChange={(e) => setF({ ...f, marketingConsent: e.target.checked })} />
          Customer agrees to receive offers and promotions (marketing consent — separate from order updates)
        </label>
      </div>
    </Modal>
  );
}
