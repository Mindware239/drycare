"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Flame, Minus, Plus, Printer, Receipt, Scale, Shirt, Wind } from "lucide-react";
import { LAUNDRY_METHOD_LABELS, type LaundryPricingMethod } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey, useApi } from "@/lib/api";
import { money } from "@/lib/format";
import { readScale } from "@/lib/scale";
import { Alert, Button, Field, Input, Select, Spinner, cx } from "@/components/ui";

type Rule = { method: LaundryPricingMethod; enabled: boolean; unitPrice: number; minWeightGrams: number; weightIncrementGrams: number; minMinutes: number; minimumCharge: number; packageLabel: string | null };
type Service = { id: string; code: string; name: string; machineTypes: string[]; taxBps: number; active: boolean; rules: Rule[]; items: { id: string; name: string; unitPrice: number; active: boolean }[] };
type Machine = { id: string; code: string; name: string; machineType: string; capacityGrams: number | null; status: string; active: boolean; controlMode: string; programs: { id: string; name: string; durationMinutes: number; active: boolean }[] };
type Quote = { lines: { description: string; quantity: number; unitPrice: number; amount: number }[]; billableGrams: number | null; units: number | null; subtotal: number; discount: number; tax: number; total: number; taxBps: number };

const SERVICE_ICON = (types: string[]) => (types.includes("iron_station") && types.length === 1 ? Flame : types[0] === "dryer" ? Wind : Shirt);

function ruleHint(r: Rule) {
  switch (r.method) {
    case "weight": return `${money(r.unitPrice)}/kg${r.minWeightGrams ? ` · min ${r.minWeightGrams / 1000} kg` : ""}`;
    case "cycle": return `${money(r.unitPrice)} per cycle`;
    case "time": return `${money(r.unitPrice)}/min${r.minMinutes ? ` · min ${r.minMinutes} min` : ""}`;
    case "package": return `${money(r.unitPrice)}${r.packageLabel ? ` · ${r.packageLabel}` : ""}`;
    default: return "Priced per item";
  }
}

/**
 * Self-service checkout. "staff" mode takes payment at the counter and can start the machine;
 * "kiosk" mode is the customer-facing screen: the customer builds the order and pays at the
 * counter (or by UPI QR), and the machine unlocks only after staff record the payment.
 */
export function LaundryCheckout({ branchId, mode, preselectMachine, onDone }: { branchId: string; mode: "staff" | "kiosk"; preselectMachine?: string; onDone?: () => void }) {
  const config = useApi<{ services: Service[]; machines: Machine[] }>(`/laundry/config?branchId=${branchId}`);
  const [serviceId, setServiceId] = useState("");
  const [method, setMethod] = useState<LaundryPricingMethod | "">("");
  const [weightKg, setWeightKg] = useState("");
  const [units, setUnits] = useState(1);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [machineId, setMachineId] = useState(preselectMachine ?? "");
  const [programId, setProgramId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "upi" | "card" | "later">("cash");
  const [payRef, setPayRef] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [scaleMsg, setScaleMsg] = useState("");
  const [upiOk, setUpiOk] = useState(true);

  const services = (config.data?.services ?? []).filter((s) => s.active && s.rules.some((r) => r.enabled));
  const service = services.find((s) => s.id === serviceId);
  const rules = service?.rules.filter((r) => r.enabled) ?? [];
  const rule = rules.find((r) => r.method === method);
  const weightGrams = Math.round((Number(weightKg) || 0) * 1000);
  const firstType = service?.machineTypes[0];
  const machines = (config.data?.machines ?? []).filter((m) => m.active && m.machineType === firstType);
  const machine = machines.find((m) => m.id === machineId);
  const programs = machine?.programs.filter((p) => p.active) ?? [];

  // Preselected machine (from the board): choose the first service that uses it.
  useEffect(() => {
    if (!preselectMachine || serviceId || !config.data) return;
    const m = config.data.machines.find((x) => x.id === preselectMachine);
    const s = services.find((x) => m && x.machineTypes[0] === m.machineType);
    if (s) setServiceId(s.id);
  }, [config.data, preselectMachine, serviceId, services]);
  useEffect(() => { if (service && !rules.some((r) => r.method === method)) setMethod(rules[0]?.method ?? ""); }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (machine && !programs.some((p) => p.id === programId)) setProgramId(programs[0]?.id ?? ""); }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (machineId && !machines.some((m) => m.id === machineId)) setMachineId(""); }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => {
    if (!service || !method) return null;
    const discount = Number(discountPct) > 0 ? { type: "percent" as const, bps: Math.round(Number(discountPct) * 100) } : undefined;
    return {
      branchId, serviceId: service.id, method,
      weightGrams: method === "weight" ? weightGrams || undefined : weightGrams || undefined,
      units: method === "cycle" || method === "time" ? units : undefined,
      items: method === "item" ? Object.entries(qty).filter(([, q]) => q > 0).map(([itemRateId, quantity]) => ({ itemRateId, quantity })) : undefined,
      discount, discountReason: discount ? discountReason || undefined : undefined,
    };
  }, [branchId, service, method, weightGrams, units, qty, discountPct, discountReason]);

  // Live price from the server (the only source of truth for money).
  useEffect(() => {
    if (!body) return setQuote(null);
    const t = setTimeout(() => {
      api<Quote>("/laundry/quote", { body }).then((q) => { setQuote(q); setQuoteErr(""); }).catch((e: ApiError) => { setQuote(null); setQuoteErr(e.message); });
    }, 250);
    return () => clearTimeout(t);
  }, [body]);

  const overCapacity = Boolean(machine?.capacityGrams && weightGrams > (machine.capacityGrams ?? 0));
  const program = programs.find((p) => p.id === programId);
  const estMinutes = method === "time" ? units : program?.durationMinutes;

  async function fromScale() {
    setScaleMsg("");
    try {
      const r = await readScale();
      setWeightKg(String(r.kg));
      setScaleMsg(`Weight read from scale: ${r.kg} kg`);
    } catch (e) {
      setScaleMsg((e as Error).message || "Could not read the scale. Type the weight instead.");
    }
  }

  async function submit() {
    if (!body || !quote) return;
    setSaving(true);
    setErr("");
    try {
      const payments = mode === "staff" && payMethod !== "later" ? [{ amount: quote.total, method: payMethod, reference: payRef || undefined }] : [];
      const order = await api<any>("/laundry/orders", { body: { ...body, guestName: guestName || undefined, guestPhone: guestPhone || undefined, machineId: machineId || undefined, programId: programId || undefined, payments }, idempotencyKey: idemKey });
      setCreated(order);
      onDone?.();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function startNow() {
    const s = created?.sessions?.find((x: any) => x.status === "reserved");
    if (!s) return;
    setStarting(true);
    setErr("");
    try {
      const r = await api<any>(`/laundry/sessions/${s.id}/start`, { body: {} });
      setCreated(r.order);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    setCreated(null); setServiceId(""); setMethod(""); setWeightKg(""); setUnits(1); setQty({}); setMachineId(""); setProgramId("");
    setGuestName(""); setGuestPhone(""); setDiscountPct(""); setDiscountReason(""); setPayRef(""); setPayMethod("cash"); setIdemKey(newIdempotencyKey()); setErr("");
  }

  if (config.error) return <Alert>{config.error.message}</Alert>;
  if (!config.data) return <Spinner />;
  if (!services.length) return <Alert tone="amber">Self-service laundry is not set up yet. An owner can add services and prices in Laundry setup & pricing.</Alert>;

  if (created) {
    const reserved = created.sessions?.find((x: any) => x.status === "reserved");
    const running = created.sessions?.find((x: any) => x.status === "running");
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">{mode === "kiosk" && created.balance > 0 ? "Order created — please pay at the counter" : "Order confirmed"}</h2>
        <p className="mt-1 font-mono text-lg font-semibold text-slate-700">{created.orderNumber}</p>
        <p className="mt-1 text-sm text-slate-500">{created.serviceName} · total {money(created.total)} · {created.balance > 0 ? `${money(created.balance)} to pay` : "paid"}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div><img src={`/api/v1/laundry/orders/${created.id}/status-qr`} alt="" className="mx-auto h-32 w-32" /><p className="mt-1 text-xs text-slate-500">Scan to follow your machine</p></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {created.balance > 0 && upiOk && <div><img src={`/api/v1/laundry/orders/${created.id}/upi-qr`} alt="" onError={() => setUpiOk(false)} className="mx-auto h-32 w-32" /><p className="mt-1 text-xs text-slate-500">Scan to pay {money(created.balance)} by UPI</p></div>}
        </div>
        {running && <p className="mt-4 rounded-xl bg-violet-50 p-3 text-sm text-violet-800">{running.machine_name} is running · about {running.duration_minutes} minutes.</p>}
        {reserved && <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{reserved.machine_name} is booked for you{created.balance > 0 ? " and unlocks once payment is received." : "."}</p>}
        {err && <div className="mt-4"><Alert>{err}</Alert></div>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {mode === "staff" && reserved && created.balance === 0 && <Button onClick={startNow} loading={starting}>Start {reserved.machine_name}</Button>}
          {mode === "staff" && <a href={`/laundry/receipt?id=${created.id}`} target="_blank" rel="noreferrer"><Button variant="secondary"><Printer className="h-4 w-4" />Receipt</Button></a>}
          {mode === "staff" && <Link href={`/laundry/orders/view?id=${created.id}`}><Button variant="secondary"><Receipt className="h-4 w-4" />Open order</Button></Link>}
          <Button variant={mode === "kiosk" ? "primary" : "ghost"} onClick={reset}>{mode === "kiosk" ? "Done" : "New order"}</Button>
        </div>
      </div>
    );
  }

  const big = mode === "kiosk";
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Step n={1} title="Choose a service">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {services.map((s) => {
              const Icon = SERVICE_ICON(s.machineTypes);
              const sel = s.id === serviceId;
              return (
                <button key={s.id} type="button" onClick={() => setServiceId(s.id)} className={cx("rounded-2xl border-2 bg-white p-4 text-left transition", big && "p-5", sel ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-brand-300")}>
                  <Icon className={cx("h-7 w-7", sel ? "text-brand-700" : "text-slate-400")} />
                  <p className={cx("mt-2 font-semibold text-slate-900", big && "text-lg")}>{s.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{s.rules.filter((r) => r.enabled).map((r) => r.method === "weight" ? `${money(r.unitPrice)}/kg` : r.method === "cycle" ? `${money(r.unitPrice)}/cycle` : r.method === "package" ? `${money(r.unitPrice)} package` : r.method === "time" ? `${money(r.unitPrice)}/min` : "by item")[0]}</p>
                </button>
              );
            })}
          </div>
        </Step>

        {service && (
          <Step n={2} title="How should we charge?">
            <div className="flex flex-wrap gap-2">
              {rules.map((r) => (
                <button key={r.method} type="button" onClick={() => setMethod(r.method)} className={cx("rounded-xl border-2 px-4 py-2.5 text-left", method === r.method ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300")}>
                  <span className="block text-sm font-semibold text-slate-900">{LAUNDRY_METHOD_LABELS[r.method]}</span>
                  <span className="block text-xs text-slate-500">{ruleHint(r)}</span>
                </button>
              ))}
            </div>
          </Step>
        )}

        {rule && (
          <Step n={3} title={method === "weight" ? "Weigh the laundry" : method === "item" ? "Add items" : method === "package" ? "Package" : method === "cycle" ? "Number of cycles" : "Minutes"}>
            {method === "weight" && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Weight (kg)"><Input inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 4.2" className={cx("w-40 text-2xl font-semibold", big && "h-14")} autoFocus /></Field>
                <Button variant="secondary" onClick={fromScale}><Scale className="h-4 w-4" />Read from scale</Button>
                {quote?.billableGrams && <p className="pb-2 text-sm text-slate-500">Billed as <b>{quote.billableGrams / 1000} kg</b>{quote.billableGrams > weightGrams ? ` (rounded up${rule.minWeightGrams > weightGrams ? `, minimum ${rule.minWeightGrams / 1000} kg` : ""})` : ""}</p>}
                {scaleMsg && <p className="w-full text-xs text-slate-500">{scaleMsg}</p>}
              </div>
            )}
            {method === "item" && (
              <div className="grid gap-2 sm:grid-cols-2">
                {service!.items.filter((i) => i.active).map((i) => (
                  <div key={i.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <span><span className="font-medium text-slate-900">{i.name}</span><span className="block text-xs text-slate-500">{money(i.unitPrice)} each</span></span>
                    <Stepper value={qty[i.id] ?? 0} onChange={(v) => setQty({ ...qty, [i.id]: v })} />
                  </div>
                ))}
                {!service!.items.some((i) => i.active) && <p className="text-sm text-slate-500">No items are priced for this service yet.</p>}
              </div>
            )}
            {(method === "cycle" || method === "time") && <div className="flex items-center gap-3"><Stepper value={units} onChange={(v) => setUnits(Math.max(1, v))} step={method === "time" ? 5 : 1} big /><span className="text-sm text-slate-500">{method === "cycle" ? "cycle(s)" : "minutes"}</span></div>}
            {method === "package" && <p className="text-sm text-slate-700">{rule.packageLabel || "Fixed price package"} — {money(rule.unitPrice)}</p>}
            {method !== "weight" && service!.machineTypes[0] !== "iron_station" && (
              <Field label="Load weight (kg, optional)" hint="Used to check machine capacity" className="mt-3 max-w-xs"><Input inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
            )}
          </Step>
        )}

        {rule && machines.length > 0 && (
          <Step n={4} title={`Choose a ${firstType === "dryer" ? "dryer" : firstType === "iron_station" ? "ironing station" : "washing machine"}`} optional={mode === "staff"}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {machines.map((m) => {
                const free = m.status === "available";
                const tooSmall = Boolean(m.capacityGrams && weightGrams > m.capacityGrams);
                return (
                  <button key={m.id} type="button" disabled={!free || tooSmall} onClick={() => setMachineId(m.id === machineId ? "" : m.id)}
                    className={cx("rounded-xl border-2 p-3 text-left disabled:cursor-not-allowed disabled:opacity-50", m.id === machineId ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300")}>
                    <span className="block font-semibold text-slate-900">{m.name}</span>
                    <span className="block text-xs text-slate-500">{m.capacityGrams ? `${m.capacityGrams / 1000} kg` : m.code}</span>
                    <span className={cx("mt-1 block text-xs font-medium", free ? (tooSmall ? "text-amber-700" : "text-emerald-700") : "text-slate-500")}>{free ? (tooSmall ? "Too small for this load" : "Available") : m.status.replaceAll("_", " ")}</span>
                  </button>
                );
              })}
            </div>
            {machine && programs.length > 0 && (
              <Field label="Program" className="mt-3 max-w-sm"><Select value={programId} onChange={(e) => setProgramId(e.target.value)}>{programs.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.durationMinutes} min</option>)}</Select></Field>
            )}
          </Step>
        )}
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Your order</h3>
          {!quote ? <p className="mt-3 text-sm text-slate-500">{quoteErr || "Choose a service to see the price."}</p> : (
            <dl className="mt-3 space-y-1.5 text-sm">
              {quote.lines.map((l, i) => <div key={i} className="flex justify-between gap-2 text-slate-600"><dt className="min-w-0 truncate">{l.description}{l.quantity > 1 && quote.billableGrams === null ? ` × ${l.quantity}` : ""}</dt><dd className="tabular-nums">{money(l.amount)}</dd></div>)}
              {quote.discount > 0 && <div className="flex justify-between text-slate-600"><dt>Discount</dt><dd className="tabular-nums">− {money(quote.discount)}</dd></div>}
              <div className="flex justify-between text-slate-600"><dt>GST ({quote.taxBps / 100}%)</dt><dd className="tabular-nums">{money(quote.tax)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{money(quote.total)}</dd></div>
              {estMinutes ? <p className="flex items-center gap-1 pt-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />About {estMinutes} minutes in the machine</p> : null}
            </dl>
          )}
          {overCapacity && <p className="mt-2 text-xs font-medium text-amber-700">This load is heavier than the selected machine allows.</p>}
        </div>

        {quote && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name (optional)"><Input value={guestName} onChange={(e) => setGuestName(e.target.value)} /></Field>
              <Field label="Mobile (optional)"><Input inputMode="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} /></Field>
            </div>
            {mode === "staff" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Discount %"><Input inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" /></Field>
                  {Number(discountPct) > 0 && <Field label="Reason"><Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} /></Field>}
                </div>
                <Field label="Payment">
                  <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    {(["cash", "upi", "card", "later"] as const).map((m) => <button key={m} type="button" onClick={() => setPayMethod(m)} className={cx("rounded-lg py-2", payMethod === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{m === "upi" ? "UPI" : m === "later" ? "Pay later" : m[0].toUpperCase() + m.slice(1)}</button>)}
                  </div>
                </Field>
                {(payMethod === "upi" || payMethod === "card") && <Field label="Transaction reference" required><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder={payMethod === "upi" ? "UPI ref / UTR" : "Card slip no."} /></Field>}
              </>
            )}
            {err && <Alert>{err}</Alert>}
            <Button size="lg" className="w-full" onClick={submit} loading={saving} disabled={overCapacity || ((payMethod === "upi" || payMethod === "card") && mode === "staff" && !payRef.trim())}>
              {mode === "kiosk" ? `Confirm · pay ${money(quote.total)} at counter` : payMethod === "later" ? "Create order (unpaid)" : `Take ${money(quote.total)} & confirm`}
            </Button>
            <p className="text-[11px] leading-4 text-slate-500">{mode === "kiosk" ? "Your machine unlocks after payment is received at the counter." : "The machine can only be started once the order is fully paid."}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Step({ n, title, optional, children }: { n: number; title: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">{n}</span>{title}
        {optional && <span className="text-xs font-normal text-slate-400">optional — can be booked later</span>}
      </h2>
      {children}
    </section>
  );
}

function Stepper({ value, onChange, step = 1, big }: { value: number; onChange: (v: number) => void; step?: number; big?: boolean }) {
  return (
    <div className="flex items-center rounded-xl border border-slate-200">
      <button type="button" onClick={() => onChange(Math.max(0, value - step))} className={cx("flex items-center justify-center text-slate-600 hover:bg-slate-50", big ? "h-12 w-12" : "h-9 w-9")} aria-label="Less"><Minus className="h-4 w-4" /></button>
      <span className={cx("min-w-10 text-center font-semibold tabular-nums", big && "text-xl")}>{value}</span>
      <button type="button" onClick={() => onChange(value + step)} className={cx("flex items-center justify-center text-slate-600 hover:bg-slate-50", big ? "h-12 w-12" : "h-9 w-9")} aria-label="More"><Plus className="h-4 w-4" /></button>
    </div>
  );
}
