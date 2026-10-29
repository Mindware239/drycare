"use client";
import { useState } from "react";
import { Copy, History, MonitorSmartphone, Scale, UserPlus } from "lucide-react";
import { LAUNDRY_METHOD_LABELS, LAUNDRY_PRICING_METHODS, type LaundryPricingMethod } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { dateTime, money, rupeesToPaise } from "@/lib/format";
import { readScale, scaleSupported } from "@/lib/scale";
import { Alert, Badge, Button, Card, Field, Input, PasswordInput, Select } from "@/components/ui";
import type { LaundryServiceRow } from "../laundry-ui";
import { copyText } from "@/lib/clipboard";

type Draft = Record<string, { enabled: boolean; price: string }>;
const key = (serviceId: string, method: string) => `${serviceId}:${method}`;

/** Every self-service price on one screen. Only changed cells are saved; other rule settings are kept. */
export function PriceList({ services, branchId, onSaved }: { services: LaundryServiceRow[]; branchId: string; onSaved: (text: string) => void }) {
  const initial = (): Draft => Object.fromEntries(services.flatMap((s) => LAUNDRY_PRICING_METHODS.map((m) => {
    const r = s.rules.find((x) => x.method === m);
    return [key(s.id, m), { enabled: r?.enabled ?? false, price: r ? String(r.unitPrice / 100) : "" }];
  })));
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const history = useApi<any[]>("/laundry/price-history");

  const changed = services.flatMap((s) => LAUNDRY_PRICING_METHODS.flatMap((m) => {
    const r = s.rules.find((x) => x.method === m);
    const d = draft[key(s.id, m)];
    const price = m === "item" ? 0 : rupeesToPaise(d.price || "0");
    const same = r ? r.enabled === d.enabled && (m === "item" || r.unitPrice === price) : !d.enabled;
    return same ? [] : [{ s, m, r, d, price }];
  }));

  async function saveAll() {
    setSaving(true);
    setErr("");
    let done = 0;
    try {
      for (const c of changed) {
        if (c.d.enabled && c.m !== "item" && !(c.price > 0)) throw new Error(`${c.s.name}: enter a price for ${LAUNDRY_METHOD_LABELS[c.m].toLowerCase()}`);
        await api(`/laundry/services/${c.s.id}/rules/${c.m}`, { method: "PUT", body: {
          branchId: c.r?.branchId ? branchId : null, enabled: c.d.enabled, unitPrice: c.price,
          minWeightGrams: c.r?.minWeightGrams ?? (c.m === "weight" ? 3000 : 0), weightIncrementGrams: c.r?.weightIncrementGrams ?? 500,
          minMinutes: c.r?.minMinutes ?? 0, minimumCharge: c.r?.minimumCharge ?? 0, packageLabel: c.r?.packageLabel ?? null,
        } });
        done++;
      }
      onSaved(`${done} price${done === 1 ? "" : "s"} updated. New orders use them straight away; existing orders keep their price.`);
      history.reload();
    } catch (e) {
      setErr((e as ApiError).message);
      if (done) onSaved(`${done} price(s) saved before the error.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card title="Price list" actions={<><Button variant="ghost" size="sm" onClick={() => setDraft(initial())} disabled={!changed.length}>Undo changes</Button><Button size="sm" onClick={saveAll} loading={saving} disabled={!changed.length}>Save {changed.length || ""} change{changed.length === 1 ? "" : "s"}</Button></>} padded={false}>
        {err && <div className="p-4"><Alert>{err}</Alert></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2.5">Service</th>{LAUNDRY_PRICING_METHODS.map((m) => <th key={m} className="px-3 py-2.5">{LAUNDRY_METHOD_LABELS[m]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-900">{s.name}</p><p className="text-xs text-slate-500">GST {s.taxBps / 100}%{s.active ? "" : " · hidden"}</p></td>
                  {LAUNDRY_PRICING_METHODS.map((m) => {
                    const k = key(s.id, m);
                    const d = draft[k];
                    const r = s.rules.find((x) => x.method === m);
                    const dirty = changed.some((c) => c.s.id === s.id && c.m === m);
                    return (
                      <td key={m} className={dirty ? "bg-amber-50/60 px-3 py-3" : "px-3 py-3"}>
                        <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-600">
                          <input type="checkbox" checked={d.enabled} onChange={(e) => setDraft({ ...draft, [k]: { ...d, enabled: e.target.checked } })} className="h-3.5 w-3.5 accent-brand-700" />
                          {d.enabled ? "Offered" : "Off"}{r?.branchId && <Badge color="blue">this store</Badge>}
                        </label>
                        {m === "item" ? <p className="text-xs text-slate-500">{s.items.filter((i) => i.active).length} item prices</p>
                          : <div className="relative"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span><Input value={d.price} disabled={!d.enabled} onChange={(e) => setDraft({ ...draft, [k]: { ...d, price: e.target.value.replace(/[^0-9.]/g, "") } })} className="h-8 w-28 pl-6 tabular-nums" aria-label={`${s.name} ${LAUNDRY_METHOD_LABELS[m]} price`} /></div>}
                        {d.enabled && m !== "item" && <p className="mt-0.5 text-[10px] text-slate-400">{m === "weight" ? "per kg" : m === "cycle" ? "per cycle" : m === "time" ? "per minute" : "fixed"}</p>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Minimum weight, rounding, minimum minutes and item prices are set in the Services & pricing tab. Prices are before GST.</p>
      </Card>

      <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4" />Price change history</span>} padded={false}>
        {!history.data ? <p className="p-4 text-sm text-slate-500">Loading…</p> : !history.data.length ? <p className="p-4 text-sm text-slate-500">No price changes yet.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.data.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5"><span className="w-40 shrink-0 text-xs text-slate-500">{dateTime(h.createdAt)}</span><span className="min-w-0 flex-1 text-slate-800">{describe(h)}</span><span className="text-xs text-slate-500">{h.changedBy ?? "System"}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function describe(h: { action: string; before: any; after: any; serviceName: string | null }) {
  const svc = h.serviceName ?? "a service";
  if (h.action === "laundry.defaults_installed") return `Starter services installed (${h.after?.added ?? 0})`;
  if (h.action === "laundry.items_updated") return `${svc}: item prices updated (${(h.after ?? []).map((i: any) => `${i.name} ${money(i.unitPrice)}`).join(", ")})`;
  if (h.action === "laundry.service_updated") {
    const parts = [];
    if (h.before?.taxBps !== h.after?.taxBps) parts.push(`GST ${h.before?.taxBps / 100}% → ${h.after?.taxBps / 100}%`);
    if (h.before?.active !== h.after?.active) parts.push(h.after?.active ? "offered" : "hidden");
    if (h.before?.name !== h.after?.name) parts.push(`renamed to ${h.after?.name}`);
    return `${svc}: ${parts.join(", ") || "updated"}`;
  }
  const m = LAUNDRY_METHOD_LABELS[h.after?.method as LaundryPricingMethod] ?? h.after?.method;
  const was = h.before ? `${h.before.enabled ? money(h.before.unitPrice) : "off"}` : "not set";
  const now = h.after?.enabled ? money(h.after.unitPrice) : "off";
  return `${svc} · ${m}: ${was} → ${now}${h.after?.branchId ? " (this store)" : ""}`;
}

/** Kiosk tablet login and weighing-scale check. */
export function KioskAndScale({ branchId, branchName, canManageStaff }: { branchId: string; branchName: string; canManageStaff: boolean }) {
  const kioskUrl = typeof window !== "undefined" ? `${window.location.origin}/laundry-kiosk` : "/laundry-kiosk";
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(`Kiosk tablet · ${branchName}`);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [baud, setBaud] = useState("9600");
  const [reading, setReading] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function createLogin() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/staff", { body: { name, email: email.trim().toLowerCase(), password, roleKey: "kiosk", branchIds: [branchId] } });
      setMsg({ tone: "green", text: `Kiosk login created for ${branchName}. On the tablet, sign in with ${email.trim().toLowerCase()} and open the kiosk address.` });
      setPassword("");
    } catch (e) {
      setMsg({ tone: "red", text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  async function testScale() {
    setReading(null);
    try {
      const r = await readScale({ baudRate: Number(baud) });
      setReading({ tone: "green", text: `Read ${r.kg} kg from the scale${r.raw ? ` (sent “${r.raw}”)` : ""}. Checkout's “Read from scale” will work with these settings.` });
    } catch (e) {
      setReading({ tone: "red", text: (e as Error).message || "Could not read the scale." });
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><MonitorSmartphone className="h-4 w-4" />Customer kiosk tablet</span>}>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Create a kiosk login below. It can take self-service orders and see machines at <b>{branchName}</b> only — no prices setup, refunds, reports or other stores.</li>
          <li>On the tablet, sign in with that login, then open the kiosk address and tap <b>Full screen</b>.</li>
          <li>Never leave the owner&apos;s login on a customer-facing tablet.</li>
        </ol>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 p-2.5">
          <code className="min-w-0 flex-1 truncate text-xs text-slate-700">{kioskUrl}</code>
          <Button size="sm" variant="secondary" onClick={() => { void copyText(kioskUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}</Button>
        </div>
        {canManageStaff ? (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
            <Field label="Login name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Login email" hint="Any address you control, e.g. kiosk1@yourshop.in"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
            <Field label="Password" hint="At least 10 characters. You choose it; keep it with the tablet's setup notes."><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
            <Button onClick={createLogin} loading={busy} disabled={!email.includes("@") || password.length < 10 || name.trim().length < 2}><UserPlus className="h-4 w-4" />Create kiosk login</Button>
          </div>
        ) : <p className="mt-3 text-xs text-slate-500">Ask the owner or manager to create the kiosk login (Staff permission needed).</p>}
      </Card>

      <Card title={<span className="flex items-center gap-2"><Scale className="h-4 w-4" />Weighing scale check</span>}>
        <p className="text-sm text-slate-700">Connect a USB weighing scale to this computer, put a known weight on it, and press <b>Test scale</b>. Works in Chrome or Edge on Windows with scales that send the weight over USB-serial.</p>
        {!scaleSupported() && <div className="mt-3"><Alert tone="amber">This browser cannot read USB scales. Use Chrome or Edge; staff can always type the weight.</Alert></div>}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Baud rate" hint="Check the scale manual; 9600 is most common"><Select value={baud} onChange={(e) => setBaud(e.target.value)} className="w-32">{["2400", "4800", "9600", "19200"].map((b) => <option key={b}>{b}</option>)}</Select></Field>
          <Button onClick={testScale} disabled={!scaleSupported()}><Scale className="h-4 w-4" />Test scale</Button>
        </div>
        {reading && <div className="mt-3"><Alert tone={reading.tone} onClose={() => setReading(null)}>{reading.text}</Alert></div>}
        <p className="mt-3 text-xs text-slate-500">If your scale only shows the weight on its own display, staff type it at checkout — prices are the same either way.</p>
      </Card>
    </div>
  );
}
