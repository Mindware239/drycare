"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { LAUNDRY_MACHINE_LABELS, LAUNDRY_METHOD_LABELS, LAUNDRY_PRICING_METHODS, type LaundryMachineType, type LaundryPricingMethod } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, cx } from "@/components/ui";
import { KioskAndScale, PriceList } from "./extras";
import { StatusChip, kg, type LaundryConfig, type LaundryMachineRow, type LaundryRuleRow, type LaundryServiceRow } from "../laundry-ui";

function Setup() {
  const { branchId, branch, can } = useSession();
  const params = useSearchParams();
  const initialTab = params.get("tab");
  const [tab, setTab] = useState<"pricing" | "prices" | "machines" | "devices">(initialTab === "machines" || initialTab === "prices" || initialTab === "devices" ? initialTab : "prices");
  const config = useApi<LaundryConfig>(`/laundry/config?branchId=${branchId}`);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = (tone: "green" | "red", text: string) => setMsg({ tone, text });

  async function installDefaults() {
    setBusy(true);
    try {
      const r = await api<{ added: number }>("/laundry/setup-defaults", { body: {} });
      notify("green", `${r.added} starter services added. Review the prices below.`);
      config.reload();
    } catch (e) {
      notify("red", (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (config.error) return <Alert>{config.error.message}</Alert>;
  if (!config.data) return <Spinner />;
  return (
    <div className="space-y-5">
      <PageHeader title="Laundry setup & pricing" subtitle="Self-service services, how each is charged, and the machines in your shop. Separate from your dry-cleaning catalogue." />
      <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold">
        {([["prices", "Price list"], ["pricing", "Services & pricing"], ["machines", `Machines at ${branch?.name ?? "this store"}`], ["devices", "Kiosk & scale"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx("rounded-lg px-4 py-2", tab === k ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50")}>{l}</button>)}
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {tab === "prices" ? (
        config.data.services.length
          ? <PriceList key={JSON.stringify(config.data.services.map((x) => x.rules))} services={config.data.services} branchId={branchId} onSaved={(t) => { notify("green", t); config.reload(); }} />
          : <Alert tone="amber">Add services first (Services & pricing tab).</Alert>
      ) : tab === "devices" ? (
        <KioskAndScale branchId={branchId} branchName={branch?.name ?? "this store"} canManageStaff={can("staff.manage")} />
      ) : tab === "pricing" ? (
        <>
          {!config.data.services.length && (
            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-brand-200 bg-brand-50 p-5">
              <Sparkles className="h-6 w-6 text-brand-700" />
              <p className="min-w-[14rem] flex-1 text-sm text-slate-700">Start with six ready-made services (wash, dry, ironing and combinations) with typical prices you can change.</p>
              <Button onClick={installDefaults} loading={busy}>Add starter services</Button>
            </div>
          )}
          {config.data.services.map((s) => <ServiceCard key={s.id} service={s} branchId={branchId} onSaved={(t) => { notify("green", t); config.reload(); }} onError={(t) => notify("red", t)} />)}
        </>
      ) : (
        <Machines machines={config.data.machines} controlModes={config.data.controlModes} branchId={branchId} onSaved={(t) => { notify("green", t); config.reload(); }} />
      )}
    </div>
  );
}

function ServiceCard({ service, branchId, onSaved, onError }: { service: LaundryServiceRow; branchId: string; onSaved: (t: string) => void; onError: (t: string) => void }) {
  const [taxPct, setTaxPct] = useState(String(service.taxBps / 100));
  const [items, setItems] = useState(service.items.filter((i) => i.active).map((i) => ({ name: i.name, price: String(i.unitPrice / 100) })));
  const [editItems, setEditItems] = useState(false);
  const usesItems = service.rules.some((r) => r.method === "item");

  async function patch(body: object, ok: string) {
    try {
      await api(`/laundry/services/${service.id}`, { method: "PATCH", body });
      onSaved(ok);
    } catch (e) {
      onError((e as ApiError).message);
    }
  }
  async function saveItems() {
    try {
      await api(`/laundry/services/${service.id}/items`, { method: "PUT", body: { items: items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), unitPrice: rupeesToPaise(i.price || "0"), active: true })) } });
      setEditItems(false);
      onSaved(`${service.name}: item prices saved.`);
    } catch (e) {
      onError((e as ApiError).message);
    }
  }

  return (
    <Card title={<span className="flex flex-wrap items-center gap-2">{service.name}<Badge color={service.active ? "green" : "slate"}>{service.active ? "Offered" : "Hidden"}</Badge><span className="text-xs font-normal text-slate-500">uses {service.machineTypes.map((t) => LAUNDRY_MACHINE_LABELS[t].toLowerCase()).join(" → ")}</span></span>}
      actions={<div className="flex items-center gap-2"><label className="flex items-center gap-1 text-xs text-slate-500">GST %<Input value={taxPct} onChange={(e) => setTaxPct(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => Number(taxPct) * 100 !== service.taxBps && patch({ taxBps: Math.round(Number(taxPct) * 100) }, `${service.name}: GST updated.`)} className="h-8 w-16" /></label><Button size="sm" variant="secondary" onClick={() => patch({ active: !service.active }, service.active ? `${service.name} hidden.` : `${service.name} offered.`)}>{service.active ? "Hide" : "Offer"}</Button></div>}>
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {LAUNDRY_PRICING_METHODS.map((m) => <RuleEditor key={m} service={service} method={m} rule={service.rules.find((r) => r.method === m)} branchId={branchId} onSaved={onSaved} onError={onError} />)}
      </div>
      {usesItems && (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold text-slate-800">Item prices</p>{!editItems && <Button size="sm" variant="secondary" onClick={() => setEditItems(true)}>Edit items</Button>}</div>
          {!editItems ? (
            <div className="mt-2 flex flex-wrap gap-2">{service.items.filter((i) => i.active).map((i) => <span key={i.id} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{i.name} · {money(i.unitPrice)}</span>)}{!service.items.some((i) => i.active) && <span className="text-xs text-slate-500">No items yet.</span>}</div>
          ) : (
            <div className="mt-2 space-y-2">
              {items.map((it, n) => (
                <div key={n} className="flex gap-2">
                  <Input value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === n ? { ...x, name: e.target.value } : x)))} placeholder="Item name" />
                  <Input value={it.price} onChange={(e) => setItems(items.map((x, j) => (j === n ? { ...x, price: e.target.value.replace(/[^0-9.]/g, "") } : x)))} placeholder="₹" className="w-28" />
                  <button type="button" onClick={() => setItems(items.filter((_, j) => j !== n))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove item"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setItems([...items, { name: "", price: "" }])}><Plus className="h-4 w-4" />Add item</Button><Button size="sm" onClick={saveItems}>Save items</Button></div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RuleEditor({ service, method, rule, branchId, onSaved, onError }: { service: LaundryServiceRow; method: LaundryPricingMethod; rule?: LaundryRuleRow; branchId: string; onSaved: (t: string) => void; onError: (t: string) => void }) {
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [price, setPrice] = useState(rule ? String(rule.unitPrice / 100) : "");
  const [minKg, setMinKg] = useState(rule ? String(rule.minWeightGrams / 1000) : "0");
  const [stepKg, setStepKg] = useState(rule ? String(rule.weightIncrementGrams / 1000) : "0.5");
  const [minMin, setMinMin] = useState(rule ? String(rule.minMinutes) : "0");
  const [minCharge, setMinCharge] = useState(rule ? String(rule.minimumCharge / 100) : "0");
  const [label, setLabel] = useState(rule?.packageLabel ?? "");
  const [branchOnly, setBranchOnly] = useState(Boolean(rule?.branchId));
  const [dirty, setDirty] = useState(false);
  const d = <T,>(f: (v: T) => void) => (v: T) => { f(v); setDirty(true); };
  const unit = method === "weight" ? "per kg" : method === "cycle" ? "per cycle" : method === "time" ? "per minute" : method === "package" ? "package price" : "";

  async function save() {
    try {
      await api(`/laundry/services/${service.id}/rules/${method}`, { method: "PUT", body: {
        branchId: branchOnly ? branchId : null, enabled, unitPrice: method === "item" ? 0 : rupeesToPaise(price || "0"),
        minWeightGrams: Math.round(Number(minKg || 0) * 1000), weightIncrementGrams: Math.max(1, Math.round(Number(stepKg || 0.1) * 1000)),
        minMinutes: Number(minMin || 0), minimumCharge: rupeesToPaise(minCharge || "0"), packageLabel: label || null,
      } });
      setDirty(false);
      onSaved(`${service.name}: ${LAUNDRY_METHOD_LABELS[method].toLowerCase()} saved${branchOnly ? " for this store" : ""}.`);
    } catch (e) {
      onError((e as ApiError).message);
    }
  }

  return (
    <div className={cx("rounded-xl border p-3", enabled ? "border-brand-200 bg-brand-50/40" : "border-slate-200 bg-white")}>
      <label className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{LAUNDRY_METHOD_LABELS[method]}</span>
        <input type="checkbox" checked={enabled} onChange={(e) => d(setEnabled)(e.target.checked)} className="h-4 w-4 accent-brand-700" aria-label={`Enable ${LAUNDRY_METHOD_LABELS[method]}`} />
      </label>
      {enabled && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {method !== "item" && <Field label={`Price (₹) ${unit}`}><Input value={price} onChange={(e) => d(setPrice)(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>}
          {method === "weight" && <>
            <Field label="Minimum kg"><Input value={minKg} onChange={(e) => d(setMinKg)(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
            <Field label="Round up to (kg)"><Input value={stepKg} onChange={(e) => d(setStepKg)(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
          </>}
          {method === "time" && <Field label="Minimum minutes"><Input value={minMin} onChange={(e) => d(setMinMin)(e.target.value.replace(/\D/g, ""))} /></Field>}
          {method === "package" && <Field label="Package name" className="col-span-2"><Input value={label} onChange={(e) => d(setLabel)(e.target.value)} placeholder="e.g. One load up to 7 kg" /></Field>}
          {method === "item" && <p className="col-span-2 text-xs text-slate-500">Uses the item price list below.</p>}
          <Field label="Minimum charge (₹)"><Input value={minCharge} onChange={(e) => d(setMinCharge)(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500"><input type="checkbox" checked={branchOnly} onChange={(e) => d(setBranchOnly)(e.target.checked)} />Price for this store only</label>
        {dirty && <Button size="sm" onClick={save}>Save</Button>}
      </div>
    </div>
  );
}

function Machines({ machines, controlModes, branchId, onSaved }: { machines: LaundryMachineRow[]; controlModes: string[]; branchId: string; onSaved: (t: string) => void }) {
  const [editing, setEditing] = useState<LaundryMachineRow | "new" | null>(null);
  return (
    <Card title={`${machines.length} machine${machines.length === 1 ? "" : "s"}`} actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add machine</Button>} padded={false}>
      {!machines.length ? <p className="p-6 text-center text-sm text-slate-500">Add each washing machine, dryer and ironing station with its capacity and programs.</p> : (
        <ul className="divide-y divide-slate-100">
          {machines.map((m) => (
            <li key={m.id} className={cx("flex flex-wrap items-center gap-3 px-4 py-3", !m.active && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{m.name} <span className="font-mono text-xs font-normal text-slate-500">{m.code}</span></p>
                <p className="text-xs text-slate-500">{LAUNDRY_MACHINE_LABELS[m.machineType]}{m.capacityGrams ? ` · ${kg(m.capacityGrams)}` : ""} · {m.controlMode === "http" ? "Connected (IoT)" : "Manual start by staff"} · {m.programs.filter((p) => p.active).map((p) => `${p.name} ${p.durationMinutes}m`).join(", ") || "no programs"}</p>
              </div>
              {m.active ? <StatusChip status={m.status} /> : <Badge>switched off</Badge>}
              <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <MachineForm machine={editing === "new" ? null : editing} controlModes={controlModes} branchId={branchId} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); onSaved(t); }} />}
    </Card>
  );
}

function MachineForm({ machine, controlModes, branchId, onClose, onSaved }: { machine: LaundryMachineRow | null; controlModes: string[]; branchId: string; onClose: () => void; onSaved: (t: string) => void }) {
  const [code, setCode] = useState(machine?.code ?? "");
  const [name, setName] = useState(machine?.name ?? "");
  const [type, setType] = useState<LaundryMachineType>(machine?.machineType ?? "washer");
  const [capacity, setCapacity] = useState(machine?.capacityGrams ? String(machine.capacityGrams / 1000) : type === "iron_station" ? "" : "8");
  const [mode, setMode] = useState(machine?.controlMode ?? "manual");
  const [baseUrl, setBaseUrl] = useState(machine?.adapterConfig.baseUrl ?? "");
  const [deviceId, setDeviceId] = useState(machine?.adapterConfig.deviceId ?? "");
  const [active, setActive] = useState(machine?.active ?? true);
  const [programs, setPrograms] = useState((machine?.programs.filter((p) => p.active) ?? []).map((p) => ({ name: p.name, minutes: String(p.durationMinutes) })).concat(machine ? [] : type === "dryer" ? [{ name: "Normal heat", minutes: "40" }] : type === "washer" ? [{ name: "Normal 40°", minutes: "45" }, { name: "Quick 30°", minutes: "30" }] : [{ name: "Ironing slot", minutes: "30" }]));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErr("");
    const body = {
      name, capacityKg: capacity ? Number(capacity) : undefined, controlMode: mode,
      adapterConfig: mode === "http" ? { baseUrl: baseUrl || undefined, deviceId: deviceId || undefined } : {},
      programs: programs.filter((p) => p.name.trim() && Number(p.minutes) > 0).map((p) => ({ name: p.name.trim(), durationMinutes: Number(p.minutes) })),
    };
    try {
      if (machine) await api(`/laundry/machines/${machine.id}`, { method: "PATCH", body: { ...body, active } });
      else await api("/laundry/machines", { body: { ...body, branchId, code, machineType: type } });
      onSaved(`${name} saved.`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={machine ? `Edit ${machine.name}` : "Add machine"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={name.trim().length < 2 || (!machine && !code.trim())}>Save machine</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Machine number" hint="Shown on the machine, e.g. W1"><Input value={code} disabled={Boolean(machine)} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12))} className="font-mono" /></Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Washer 1 (LG 8 kg)" /></Field>
        <Field label="Type"><Select value={type} disabled={Boolean(machine)} onChange={(e) => setType(e.target.value as LaundryMachineType)}>{Object.entries(LAUNDRY_MACHINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Capacity (kg)" hint="Larger loads are refused"><Input value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        <Field label="How is it started?" className="sm:col-span-2">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            {controlModes.map((c) => <option key={c} value={c}>{c === "manual" ? "Staff press start on the machine (any machine)" : "Connected controller (IoT / smart machine)"}</option>)}
          </Select>
        </Field>
        {mode === "http" && <>
          <Field label="Controller address" className="sm:col-span-2" hint="The machine controller's API base URL"><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.1.50:8080" /></Field>
          <Field label="Device ID"><Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-3">DryCare sends a start command and reads status from the controller. If the controller does not confirm, the machine is never shown as running. See the integration notes in docs/LAUNDRY_IOT.md.</p>
        </>}
      </div>
      <Field label="Programs">
        <div className="space-y-2">
          {programs.map((p, n) => (
            <div key={n} className="flex gap-2">
              <Input value={p.name} onChange={(e) => setPrograms(programs.map((x, j) => (j === n ? { ...x, name: e.target.value } : x)))} placeholder="Program name" />
              <Input value={p.minutes} onChange={(e) => setPrograms(programs.map((x, j) => (j === n ? { ...x, minutes: e.target.value.replace(/\D/g, "") } : x)))} placeholder="Minutes" className="w-28" />
              <button type="button" onClick={() => setPrograms(programs.filter((_, j) => j !== n))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove program"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setPrograms([...programs, { name: "", minutes: "" }])}><Plus className="h-4 w-4" />Add program</Button>
        </div>
      </Field>
      {machine && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />In use (untick to remove from the shop floor)</label>}
    </Modal>
  );
}

export default function LaundrySetupPage() {
  return <Suspense><Setup /></Suspense>;
}
