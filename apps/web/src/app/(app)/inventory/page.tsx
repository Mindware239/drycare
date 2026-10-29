"use client";
import { useEffect, useMemo, useState } from "react";
import { Boxes, ClipboardCheck, Download, History, PackageCheck, PackageMinus, PackagePlus, Pencil, Plus, Printer, Search, ShoppingCart, Sparkles, Trash2, TriangleAlert, Truck, Wallet } from "lucide-react";
import {
  EXPENSE_CATEGORIES, INVENTORY_CATEGORIES, INVENTORY_EXPENSE_CATEGORY, INVENTORY_UNITS, PO_STATUS_LABELS, STOCK_MOVEMENT_LABELS,
} from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, dateTime, money, rupeesToPaise, todayISO } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx, type Tone } from "@/components/ui";

type Item = { id: string; itemCode: string; name: string; category: string; unit: string; reorderLevelMilli: number; lastUnitCost: number; preferredSupplierId: string | null; supplierName: string | null; notes: string | null; isActive: boolean; onHandMilli: number; onOrderMilli: number; stockValue: number; low: boolean; lastMovementAt: string | null };
type Supplier = { id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; gstin: string | null; address: string | null; notes: string | null; isActive: boolean; orderCount: number; purchasedTotal: string; lastOrderAt: string | null };

/** 1500 → "1.5" (quantities are thousandths of a unit). */
const qty = (milli: number) => Number((milli / 1000).toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const qtyU = (milli: number, unit: string) => `${qty(milli)} ${unit}`;
const num = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? NaN : Number(v));
const PO_TONE: Record<string, Tone> = { draft: "slate", ordered: "blue", partial: "amber", received: "green", cancelled: "red" };
const GST_RATES = [0, 5, 12, 18, 28];
const TABS = [
  { key: "stock", label: "Stock", icon: Boxes },
  { key: "orders", label: "Purchase orders", icon: ShoppingCart },
  { key: "suppliers", label: "Suppliers", icon: Truck },
  { key: "usage", label: "Usage report", icon: History },
] as const;

function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const esc = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; };
  const url = URL.createObjectURL(new Blob(["﻿", [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InventoryPage() {
  const { branchId, branch } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("stock");
  const items = useApi<Item[]>(`/inventory/items?branchId=${branchId}&includeInactive=true`);
  const suppliers = useApi<Supplier[]>("/suppliers");
  const [notice, setNotice] = useState("");
  const [poDraft, setPoDraft] = useState<{ supplierId?: string; lines: { itemId: string; quantity: string; rate: string; gst: number }[] } | null>(null);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const [poReload, setPoReload] = useState(0);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("po");
    if (id) { setTab("orders"); setOpenPo(id); }
  }, []);

  function reorderLow() {
    const low = (items.data ?? []).filter((i) => i.isActive && i.low);
    const bySupplier = new Map<string, number>();
    for (const i of low) if (i.preferredSupplierId) bySupplier.set(i.preferredSupplierId, (bySupplier.get(i.preferredSupplierId) ?? 0) + 1);
    const supplierId = [...bySupplier.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    setPoDraft({
      supplierId,
      lines: low.filter((i) => !supplierId || !i.preferredSupplierId || i.preferredSupplierId === supplierId).map((i) => ({
        itemId: i.id, quantity: String(Math.max(1, Number(((i.reorderLevelMilli * 2 - i.onHandMilli - i.onOrderMilli) / 1000).toFixed(3)))), rate: i.lastUnitCost ? String(i.lastUnitCost / 100) : "", gst: 18,
      })),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock & purchasing"
        subtitle={`Solvents, detergents, hangers and packing at ${branch?.name ?? "your store"}: what is on the shelf, what to reorder, and what you bought from whom.`}
        actions={<Button onClick={() => setPoDraft({ lines: [] })}><ShoppingCart className="h-4 w-4" />New purchase order</Button>}
      />
      {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
      <div className="dc-tabs flex gap-1 whitespace-nowrap border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cx("-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>
      {tab === "stock" && <StockTab items={items} suppliers={suppliers.data ?? []} branchId={branchId} onNotice={setNotice} onReorder={reorderLow} />}
      {tab === "orders" && <OrdersTab branchId={branchId} reloadKey={poReload} onOpen={setOpenPo} onNew={() => setPoDraft({ lines: [] })} />}
      {tab === "suppliers" && <SuppliersTab suppliers={suppliers} onNotice={setNotice} />}
      {tab === "usage" && <UsageTab branchId={branchId} />}

      {poDraft && (
        <PoEditor branchId={branchId} draft={poDraft} items={(items.data ?? []).filter((i) => i.isActive)} suppliers={(suppliers.data ?? []).filter((s) => s.isActive)}
          onAddSupplier={() => suppliers.reload()} onClose={() => setPoDraft(null)}
          onSaved={(po) => { setPoDraft(null); setTab("orders"); setPoReload((n) => n + 1); items.reload(); setNotice(`${po.poNumber} ${po.status === "draft" ? "saved as a draft" : `placed with ${po.supplier?.name}`}.`); setOpenPo(po.id); }} />
      )}
      {openPo && <PoDetail id={openPo} onClose={() => setOpenPo(null)} onChanged={(msg) => { setPoReload((n) => n + 1); items.reload(); suppliers.reload(); if (msg) setNotice(msg); }} onEditDraft={(po) => { setOpenPo(null); setPoDraft({ ...po, editId: po.id } as any); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ stock

function StockTab({ items, suppliers, branchId, onNotice, onReorder }: { items: ReturnType<typeof useApi<Item[]>>; suppliers: Supplier[]; branchId: string; onNotice: (m: string) => void; onReorder: () => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [moving, setMoving] = useState<{ item: Item; kind: "use" | "wastage" | "count" | "opening" | "return" } | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const [adding, setAdding] = useState(false);
  const all = items.data ?? [];
  const active = all.filter((i) => i.isActive);
  const low = active.filter((i) => i.low);
  const rows = all.filter((i) => (showOff || i.isActive) && (!lowOnly || i.low) && (!category || i.category === category) && (!search || `${i.name} ${i.itemCode}`.toLowerCase().includes(search.toLowerCase())));
  const value = active.reduce((s, i) => s + i.stockValue, 0);
  const onOrder = active.filter((i) => i.onOrderMilli > 0).length;

  async function addStarter() {
    setAdding(true);
    try {
      const r = await api<{ added: number }>("/inventory/items/starter", { body: {} });
      onNotice(r.added ? `${r.added} common items added. Enter what you have on the shelf with “Stock check”.` : "All common items are already in your list.");
      items.reload();
    } catch (e) {
      onNotice((e as ApiError).message);
    } finally {
      setAdding(false);
    }
  }

  function exportCsv() {
    downloadCsv(`stock-${todayISO()}.csv`, ["Code", "Item", "Category", "Unit", "On hand", "Reorder at", "On order", "Last price (INR)", "Stock value (INR)", "Status"],
      rows.map((i) => [i.itemCode, i.name, i.category, i.unit, i.onHandMilli / 1000, i.reorderLevelMilli / 1000, i.onOrderMilli / 1000, (i.lastUnitCost / 100).toFixed(2), (i.stockValue / 100).toFixed(2), !i.isActive ? "Switched off" : i.low ? "Reorder" : "OK"]));
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Boxes} label="Items tracked" value={String(active.length)} hint={`${all.length - active.length} switched off`} />
        <Kpi icon={TriangleAlert} label="To reorder" value={String(low.length)} hint={low.length ? low.slice(0, 2).map((i) => i.name).join(", ") : "Everything is above its reorder level"} tone={low.length ? "red" : undefined} />
        <Kpi icon={Wallet} label="Stock value" value={money(value)} hint="At the latest purchase price" />
        <Kpi icon={Truck} label="Items on order" value={String(onOrder)} hint="Waiting for supplier delivery" />
      </div>
      {low.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <TriangleAlert className="h-5 w-5 shrink-0 text-red-600" />
          <span className="min-w-[14rem] flex-1"><b>{low.length} item{low.length > 1 ? "s are" : " is"} running low.</b> Create a purchase order with suggested quantities in one click.</span>
          <Button size="sm" onClick={onReorder}><ShoppingCart className="h-4 w-4" />Reorder low stock</Button>
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <label className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" className="h-8 w-52 pl-8 text-xs" aria-label="Search items" /></label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-48 py-0 text-xs" aria-label="Category">
            <option value="">All categories</option>{INVENTORY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="accent-brand-700" />Low stock only</label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} className="accent-brand-700" />Show switched-off items</label>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />Export</Button>
            <Button size="sm" variant="secondary" onClick={addStarter} loading={adding}><Sparkles className="h-4 w-4" />Add common items</Button>
            <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add item</Button>
          </div>
        </div>
        {items.error && <div className="p-4"><Alert>{items.error.message}</Alert></div>}
        {!items.data ? <Spinner /> : !all.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Boxes className="h-10 w-10 text-slate-300" />
            <p className="text-base font-semibold text-slate-800">Start tracking your stock</p>
            <p className="max-w-md text-sm text-slate-500">Add the solvents, detergents, hangers and packing you use. Start with our list of common dry-cleaning supplies and change it to suit your shop.</p>
            <div className="flex gap-2"><Button onClick={addStarter} loading={adding}><Sparkles className="h-4 w-4" />Add common items</Button><Button variant="secondary" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add my own</Button></div>
          </div>
        ) : !rows.length ? <Empty title="No items match">Change the search or filters.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2.5">Item</th><th className="px-4 py-2.5 text-right">On the shelf</th><th className="px-4 py-2.5 text-right">Reorder at</th><th className="px-4 py-2.5 text-right">On order</th><th className="px-4 py-2.5 text-right">Value</th><th className="px-4 py-2.5 text-right">Record</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((i) => (
                  <tr key={i.id} className={cx("align-middle", !i.isActive && "bg-slate-50/70 text-slate-400")}>
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => setEditing(i)} className="group text-left">
                        <span className="font-medium text-slate-900 group-hover:text-brand-700 group-hover:underline">{i.name}</span>
                        <span className="block text-[11px] text-slate-500">{i.itemCode} · {i.category}{i.supplierName ? ` · from ${i.supplierName}` : ""}{!i.isActive ? " · switched off" : ""}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <span className={cx("text-base font-semibold tabular-nums", i.low ? "text-red-600" : "text-slate-900")}>{qty(i.onHandMilli)}</span> <span className="text-xs text-slate-500">{i.unit}</span>
                      {i.low && <Badge color="red" className="ml-2">Reorder</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-600">{i.reorderLevelMilli ? qtyU(i.reorderLevelMilli, i.unit) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-600">{i.onOrderMilli ? qtyU(i.onOrderMilli, i.unit) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{i.lastUnitCost ? money(i.stockValue) : <span className="text-xs text-slate-400">no price</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {i.isActive && (
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setMoving({ item: i, kind: "use" })} title="Record what was used"><PackageMinus className="h-4 w-4" />Use</Button>
                          <Button size="sm" variant="secondary" onClick={() => setMoving({ item: i, kind: "count" })} title="Count the shelf and correct the stock"><ClipboardCheck className="h-4 w-4" />Stock check</Button>
                          <MoreMenu onPick={(kind) => kind === "history" ? setHistory(i) : setMoving({ item: i, kind })} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ItemModal item={editing === "new" ? null : editing} suppliers={suppliers} branchId={branchId} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); onNotice(m); items.reload(); }} />}
      {moving && <MovementModal {...moving} branchId={branchId} onClose={() => setMoving(null)} onSaved={(m) => { setMoving(null); onNotice(m); items.reload(); }} />}
      {history && <HistoryModal item={history} branchId={branchId} onClose={() => setHistory(null)} />}
    </>
  );
}

function MoreMenu({ onPick }: { onPick: (k: "wastage" | "opening" | "return" | "history") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="More actions">More ▾</Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 text-left text-sm shadow-lg">
            {([["opening", PackagePlus, "Add stock (no purchase order)"], ["wastage", Trash2, "Record wastage / damage"], ["return", Truck, "Return to supplier"], ["history", History, "Stock history"]] as const).map(([k, Icon, label]) => (
              <button key={k} type="button" onClick={() => { setOpen(false); onPick(k); }} className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"><Icon className="h-4 w-4 text-slate-400" />{label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Boxes; label: string; value: string; hint?: string; tone?: "red" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className={cx("mt-1.5 truncate text-xl font-semibold tabular-nums sm:text-2xl", tone === "red" ? "text-red-600" : "text-slate-900")}>{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-slate-500" title={hint}>{hint}</p>}
    </div>
  );
}

function ItemModal({ item, suppliers, branchId, onClose, onSaved }: { item: Item | null; suppliers: Supplier[]; branchId: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState({
    name: item?.name ?? "", category: item?.category ?? INVENTORY_CATEGORIES[0], unit: item?.unit ?? "L", reorderLevel: item ? String(item.reorderLevelMilli / 1000) : "",
    price: item?.lastUnitCost ? String(item.lastUnitCost / 100) : "", supplierId: item?.preferredSupplierId ?? "", notes: item?.notes ?? "", opening: "", isActive: item?.isActive ?? true,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setErr("");
    setBusy(true);
    const price = f.price ? rupeesToPaise(f.price) : undefined;
    const body = {
      name: f.name.trim(), category: f.category, unit: f.unit, reorderLevel: num(f.reorderLevel || "0"), lastUnitCost: price,
      preferredSupplierId: f.supplierId || null, notes: f.notes.trim(), isActive: f.isActive,
    };
    try {
      if (item) await api(`/inventory/items/${item.id}`, { method: "PATCH", body });
      else await api("/inventory/items", { body: { ...body, opening: num(f.opening) > 0 ? { branchId, quantity: num(f.opening) } : undefined } });
      onSaved(item ? `${body.name} updated.` : `${body.name} added to your stock list.`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  const valid = f.name.trim().length >= 2 && !isNaN(num(f.reorderLevel || "0")) && (!f.price || rupeesToPaise(f.price) >= 0);
  return (
    <Modal open wide title={item ? `Edit ${item.name}` : "Add stock item"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!valid}>{item ? "Save changes" : "Add item"}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item name" required className="sm:col-span-2"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Perchloroethylene" /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as typeof f.category })}>{INVENTORY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Counted in"><Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{Object.entries(INVENTORY_UNITS).map(([k, v]) => <option key={k} value={k}>{k} ({v})</option>)}</Select></Field>
        <Field label={`Reorder when below (${f.unit})`} hint="You will see a “Reorder” alert at this level. Leave 0 to never alert."><Input inputMode="decimal" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" /></Field>
        <Field label={`Purchase price per ${f.unit} (₹)`} hint="Updated automatically when goods are received."><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" /></Field>
        <Field label="Usually bought from"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">— Not set —</option>{suppliers.filter((s) => s.isActive || s.id === f.supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        {!item ? <Field label={`Already on the shelf (${f.unit})`} hint="Optional opening stock at this branch."><Input inputMode="decimal" value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" /></Field> : <div className="hidden sm:block" />}
        <Field label="Note" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional, e.g. brand or pack size" /></Field>
      </div>
      {item && (
        <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-700" />
          <span>Item in use<span className="block text-xs text-slate-500">Untick to hide an item you no longer stock. Its history is kept.</span></span>
        </label>
      )}
    </Modal>
  );
}

const MOVE_TEXT = {
  use: { title: "Record use", label: "Quantity used", button: "Record use", help: "Take stock off the shelf for work done (e.g. solvent top-up for the machine)." },
  wastage: { title: "Record wastage", label: "Quantity wasted or damaged", button: "Record wastage", help: "Spilled, expired or damaged stock. A note is required." },
  count: { title: "Stock check", label: "Quantity actually on the shelf", button: "Save count", help: "Count what is on the shelf. DryCare corrects the stock to match and records the difference." },
  opening: { title: "Add stock", label: "Quantity added", button: "Add stock", help: "Stock bought without a purchase order, or found. For supplier deliveries, use a purchase order so the bill is tracked." },
  return: { title: "Return to supplier", label: "Quantity returned", button: "Record return", help: "Goods sent back to the supplier." },
} as const;

function MovementModal({ item, kind, branchId, onClose, onSaved }: { item: Item; kind: keyof typeof MOVE_TEXT; branchId: string; onClose: () => void; onSaved: (m: string) => void }) {
  const t = MOVE_TEXT[kind];
  const [q, setQ] = useState(kind === "count" ? qty(item.onHandMilli).replaceAll(",", "") : "");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState(item.lastUnitCost ? String(item.lastUnitCost / 100) : "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const n = num(q);
  const diffMilli = kind === "count" && !isNaN(n) ? Math.round(n * 1000) - item.onHandMilli : 0;
  const after = isNaN(n) ? null : kind === "count" ? Math.round(n * 1000) : kind === "opening" ? item.onHandMilli + Math.round(n * 1000) : item.onHandMilli - Math.round(n * 1000);
  const needsNote = kind === "wastage" || (kind === "count" && diffMilli < 0);
  async function save() {
    setErr("");
    setBusy(true);
    try {
      await api("/inventory/movements", { body: { branchId, itemId: item.id, kind, quantity: n, note: note.trim() || undefined, unitCost: kind === "opening" && price ? rupeesToPaise(price) : undefined } });
      onSaved(kind === "count" ? `${item.name}: stock set to ${qtyU(Math.round(n * 1000), item.unit)}${diffMilli ? ` (${diffMilli > 0 ? "+" : ""}${qty(diffMilli)} ${item.unit})` : ", matched"}.` : `${t.title}: ${qtyU(Math.round(n * 1000), item.unit)} of ${item.name}.`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title={`${t.title} · ${item.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={isNaN(n) || (kind !== "count" && n <= 0) || (needsNote && note.trim().length < 3) || (after !== null && after < 0)}>{t.button}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">{t.help}</p>
      <div className="rounded-xl bg-slate-50 p-3 text-sm">On the shelf now: <b className="tabular-nums">{qtyU(item.onHandMilli, item.unit)}</b></div>
      <Field label={`${t.label} (${item.unit})`} required><Input autoFocus inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value.replace(/[^0-9.]/g, ""))} className="text-lg" placeholder="0" /></Field>
      {kind === "opening" && <Field label={`Price per ${item.unit} (₹)`}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Optional" /></Field>}
      {after !== null && (
        <p className={cx("text-sm", after < 0 ? "text-red-600" : "text-slate-600")}>
          {after < 0 ? `That is more than the ${qtyU(item.onHandMilli, item.unit)} on the shelf. Do a stock check first if the shelf has more.` : <>After this: <b className="tabular-nums">{qtyU(after, item.unit)}</b>{kind === "count" && diffMilli !== 0 && <span className={diffMilli < 0 ? " text-red-600" : " text-emerald-700"}> ({diffMilli > 0 ? "+" : ""}{qty(diffMilli)} {item.unit} difference)</span>}</>}
        </p>
      )}
      <Field label={needsNote ? "Reason" : "Note"} required={needsNote}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "wastage" ? "e.g. Can leaked" : kind === "count" ? "e.g. Monthly count; spillage" : "Optional"} /></Field>
    </Modal>
  );
}

function HistoryModal({ item, branchId, onClose }: { item: Item; branchId: string; onClose: () => void }) {
  const list = useApi<any[]>(`/inventory/items/${item.id}/movements?branchId=${branchId}`);
  return (
    <Modal open wide title={`Stock history · ${item.name}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {list.error && <Alert>{list.error.message}</Alert>}
      {!list.data ? <Spinner /> : !list.data.length ? <Empty title="No stock movements yet" /> : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="py-2">When</th><th className="py-2">What</th><th className="py-2 text-right">Change</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.map((m) => (
                <tr key={m.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-xs text-slate-500">{dateTime(m.createdAt)}<span className="block">{m.by}</span></td>
                  <td className="py-2 pr-3">{STOCK_MOVEMENT_LABELS[m.kind as keyof typeof STOCK_MOVEMENT_LABELS] ?? m.kind}{m.poNumber && <span className="text-xs text-slate-500"> · {m.poNumber}</span>}{m.note && <span className="block text-xs text-slate-500">{m.note}</span>}</td>
                  <td className={cx("whitespace-nowrap py-2 text-right font-semibold tabular-nums", m.quantityMilli < 0 ? "text-red-600" : "text-emerald-700")}>{m.quantityMilli > 0 ? "+" : ""}{qtyU(m.quantityMilli, item.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ purchase orders

function OrdersTab({ branchId, reloadKey, onOpen, onNew }: { branchId: string; reloadKey: number; onOpen: (id: string) => void; onNew: () => void }) {
  const [status, setStatus] = useState("open");
  const list = useApi<any[]>(`/purchase-orders?status=${status}&branchId=${branchId}&r=${reloadKey}`);
  return (
    <Card padded={false} title={
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
        {[["open", "Open"], ["received", "Received"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) => <button key={k} type="button" onClick={() => setStatus(k)} className={cx("rounded-md px-2.5 py-1", status === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{l}</button>)}
      </div>
    }>
      {list.error && <div className="p-4"><Alert>{list.error.message}</Alert></div>}
      {!list.data ? <Spinner /> : !list.data.length ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <ShoppingCart className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">{status === "open" ? "No purchase orders waiting for delivery." : "Nothing here yet."}</p>
          <Button onClick={onNew}><Plus className="h-4 w-4" />New purchase order</Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Supplier</th><th className="px-4 py-2.5">Expected</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(p.id)}>
                  <td className="px-4 py-3"><span className="font-medium text-brand-700">{p.poNumber}</span><span className="block text-[11px] text-slate-500">{dateOnly(p.createdAt)} · {p.lineCount} item{p.lineCount === 1 ? "" : "s"} · {p.createdByName}</span></td>
                  <td className="px-4 py-3 text-slate-800">{p.supplierName}</td>
                  <td className={cx("whitespace-nowrap px-4 py-3", p.overdue && "font-medium text-red-600")}>{p.expectedOn ? dateOnly(p.expectedOn) : "—"}{p.overdue && " · late"}</td>
                  <td className="px-4 py-3"><Badge color={PO_TONE[p.status]}>{PO_STATUS_LABELS[p.status as keyof typeof PO_STATUS_LABELS] ?? p.status}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{money(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type DraftLine = { itemId: string; quantity: string; rate: string; gst: number };

function PoEditor({ branchId, draft, items, suppliers, onAddSupplier, onClose, onSaved }: {
  branchId: string; draft: { supplierId?: string; lines: DraftLine[] } & Record<string, any>; items: Item[]; suppliers: Supplier[];
  onAddSupplier: () => void; onClose: () => void; onSaved: (po: any) => void;
}) {
  const editId: string | undefined = draft.editId;
  const [supplierId, setSupplierId] = useState(draft.supplierId ?? suppliers[0]?.id ?? "");
  const [expectedOn, setExpectedOn] = useState<string>(draft.expectedOn ?? "");
  const [notes, setNotes] = useState<string>(draft.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => editId
    ? draft.lines.map((l: any) => ({ itemId: l.itemId, quantity: String(l.quantityMilli / 1000), rate: String(l.unitCost / 100), gst: l.taxBps / 100 }))
    : draft.lines.length ? draft.lines : [{ itemId: "", quantity: "", rate: "", gst: 18 }]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "draft" | "place">("");
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const calc = lines.map((l) => {
    const q = num(l.quantity), r = rupeesToPaise(l.rate);
    const sub = isNaN(q) || isNaN(r) ? 0 : Math.round(q * r);
    return { sub, tax: Math.round((sub * l.gst) / 100) };
  });
  const subtotal = calc.reduce((s, c) => s + c.sub, 0), tax = calc.reduce((s, c) => s + c.tax, 0);
  const filled = lines.filter((l) => l.itemId);
  const valid = supplierId && filled.length > 0 && filled.every((l) => num(l.quantity) > 0 && rupeesToPaise(l.rate) >= 0) && new Set(filled.map((l) => l.itemId)).size === filled.length;
  const set = (i: number, patch: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save(place: boolean) {
    setErr("");
    setBusy(place ? "place" : "draft");
    const body = { supplierId, expectedOn: expectedOn || undefined, notes: notes.trim() || undefined, place, lines: filled.map((l) => ({ itemId: l.itemId, quantity: num(l.quantity), unitCost: rupeesToPaise(l.rate), taxBps: l.gst * 100 })) };
    try {
      const po = editId ? await api(`/purchase-orders/${editId}`, { method: "PUT", body }) : await api("/purchase-orders", { body: { ...body, branchId } });
      onSaved(po);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy("");
    }
  }

  return (
    <Modal open wide="xl" title={editId ? `Edit ${draft.poNumber}` : "New purchase order"} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="secondary" onClick={() => save(false)} loading={busy === "draft"} disabled={!valid || !!busy}>Save as draft</Button>
      <Button onClick={() => save(true)} loading={busy === "place"} disabled={!valid || !!busy}>Place order · {money(subtotal + tax)}</Button>
    </>}>
      {err && <Alert>{err}</Alert>}
      {!items.length && <Alert tone="amber">Add stock items first (Stock tab → Add common items).</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Supplier" required className="sm:col-span-2">
          <div className="flex gap-2">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="flex-1">
              {!suppliers.length && <option value="">Add a supplier first →</option>}
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Button variant="secondary" onClick={() => setAddingSupplier(true)}><Plus className="h-4 w-4" />New</Button>
          </div>
        </Field>
        <Field label="Expected delivery"><Input type="date" min={todayISO()} value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></Field>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Item</th><th className="w-28 px-3 py-2">Quantity</th><th className="w-28 px-3 py-2">Rate (₹)</th><th className="w-28 px-3 py-2">GST</th><th className="w-28 px-3 py-2 text-right">Amount</th><th className="w-10" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const it = byId.get(l.itemId);
              return (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <Select value={l.itemId} onChange={(e) => { const x = byId.get(e.target.value); set(i, { itemId: e.target.value, rate: l.rate || (x?.lastUnitCost ? String(x.lastUnitCost / 100) : "") }); }} aria-label="Item">
                      <option value="">Choose item…</option>
                      {INVENTORY_CATEGORIES.map((c) => { const opts = items.filter((x) => x.category === c); return opts.length ? <optgroup key={c} label={c}>{opts.map((x) => <option key={x.id} value={x.id} disabled={x.id !== l.itemId && lines.some((o) => o.itemId === x.id)}>{x.name} ({x.unit})</option>)}</optgroup> : null; })}
                    </Select>
                    {it && <span className="mt-0.5 block text-[11px] text-slate-500">On the shelf: {qtyU(it.onHandMilli, it.unit)}</span>}
                  </td>
                  <td className="px-3 py-2"><div className="flex items-center gap-1"><Input inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Quantity" /><span className="text-xs text-slate-500">{it?.unit}</span></div></td>
                  <td className="px-3 py-2"><Input inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" aria-label="Rate" /></td>
                  <td className="px-3 py-2"><Select value={l.gst} onChange={(e) => set(i, { gst: Number(e.target.value) })} aria-label="GST">{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</Select></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(calc[i].sub + calc[i].tax)}</td>
                  <td className="px-1 py-2"><button type="button" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: "", quantity: "", rate: "", gst: 18 }])} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2 text-sm">
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: "", quantity: "", rate: "", gst: 18 }])}><Plus className="h-4 w-4" />Add line</Button>
          <span className="tabular-nums text-slate-600">Items {money(subtotal)} + GST {money(tax)} = <b className="text-slate-900">{money(subtotal + tax)}</b></span>
        </div>
      </div>
      <Field label="Note to supplier"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. deliver before 10 am" /></Field>
      {addingSupplier && <SupplierModal supplier={null} onClose={() => setAddingSupplier(false)} onSaved={(_, s) => { setAddingSupplier(false); setSupplierId(s.id); onAddSupplier(); }} />}
    </Modal>
  );
}

function printPo(po: any, shopName: string) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = po.lines.map((l: any, i: number) => {
    const sub = Math.round((l.quantityMilli * l.unitCost) / 1000);
    return `<tr><td>${i + 1}</td><td>${esc(l.itemName)}</td><td class="r">${qty(l.quantityMilli)} ${esc(l.unit)}</td><td class="r">${money(l.unitCost)}</td><td class="r">${l.taxBps / 100}%</td><td class="r">${money(sub + Math.round((sub * l.taxBps) / 10000))}</td></tr>`;
  }).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(po.poNumber)}</title><style>
    body{font-family:system-ui,sans-serif;color:#0f172a;margin:32px;font-size:13px} h1{font-size:20px;margin:0} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left} th{background:#f8fafc;font-size:11px;text-transform:uppercase;color:#475569} .r{text-align:right}
    .grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px} .muted{color:#64748b} .tot td{font-weight:600;border:0}
  </style></head><body>
    <div class="grid" style="margin-top:0"><div><h1>Purchase order</h1><div class="muted">${esc(shopName)} · ${esc(po.branchName)}</div></div><div style="text-align:right"><b>${esc(po.poNumber)}</b><div class="muted">${dateOnly(po.orderedAt ?? po.createdAt)}</div></div></div>
    <div class="grid"><div><div class="muted">To</div><b>${esc(po.supplier?.name)}</b><div>${esc(po.supplier?.address)}</div><div>${esc(po.supplier?.phone)}</div>${po.supplier?.gstin ? `<div>GSTIN ${esc(po.supplier.gstin)}</div>` : ""}</div>
    <div style="text-align:right">${po.expectedOn ? `<div class="muted">Deliver by</div><b>${dateOnly(po.expectedOn)}</b>` : ""}</div></div>
    <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr class="tot"><td colspan="5" class="r">Items</td><td class="r">${money(po.subtotal)}</td></tr><tr class="tot"><td colspan="5" class="r">GST</td><td class="r">${money(po.taxTotal)}</td></tr><tr class="tot"><td colspan="5" class="r">Total</td><td class="r">${money(po.total)}</td></tr></tfoot></table>
    ${po.notes ? `<p><span class="muted">Note:</span> ${esc(po.notes)}</p>` : ""}
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function PoDetail({ id, onClose, onChanged, onEditDraft }: { id: string; onClose: () => void; onChanged: (msg?: string) => void; onEditDraft: (po: any) => void }) {
  const { session, can } = useSession();
  const po = useApi<any>(`/purchase-orders/${id}`);
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const p = po.data;
  async function place() {
    setBusy(true);
    setErr("");
    try {
      await api(`/purchase-orders/${id}`, { method: "PUT", body: { place: true } });
      po.reload();
      onChanged(`${p.poNumber} placed.`);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  const open = p && (p.status === "ordered" || p.status === "partial");
  return (
    <Modal open wide="xl" title={p ? `${p.poNumber} · ${p.supplier?.name}` : "Purchase order"} onClose={onClose} footer={p && <>
      <Button variant="ghost" onClick={() => printPo(p, session?.organization?.name ?? "")}><Printer className="h-4 w-4" />Print / PDF</Button>
      {(p.status === "draft" || open) && <Button variant="secondary" onClick={() => setCancelling(true)}>{p.status === "partial" ? "Close (rest not coming)" : "Cancel order"}</Button>}
      {p.status === "draft" && <><Button variant="secondary" onClick={() => onEditDraft(p)}><Pencil className="h-4 w-4" />Edit</Button><Button onClick={place} loading={busy}>Place order</Button></>}
      {open && <Button onClick={() => setReceiving(true)}><PackageCheck className="h-4 w-4" />Receive goods</Button>}
    </>}>
      {(po.error || err) && <Alert>{po.error?.message ?? err}</Alert>}
      {!p ? <Spinner /> : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Badge color={PO_TONE[p.status]}>{PO_STATUS_LABELS[p.status as keyof typeof PO_STATUS_LABELS]}</Badge>
            <span className="text-slate-600">Created {dateTime(p.createdAt)} by {p.createdByName}</span>
            {p.expectedOn && <span className="text-slate-600">Expected {dateOnly(p.expectedOn)}</span>}
            <span className="text-slate-600">{p.branchName}</span>
          </div>
          {p.cancelReason && <Alert tone="amber">{p.status === "cancelled" ? "Cancelled" : "Closed early"}: {p.cancelReason}</Alert>}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {p.lines.map((l: any) => {
                  const sub = Math.round((l.quantityMilli * l.unitCost) / 1000);
                  const done = l.receivedMilli >= l.quantityMilli;
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-medium text-slate-800">{l.itemName}<span className="block text-[11px] font-normal text-slate-500">{l.itemCode} · GST {l.taxBps / 100}%</span></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{qtyU(l.quantityMilli, l.unit)}</td>
                      <td className={cx("whitespace-nowrap px-3 py-2 text-right tabular-nums", done ? "text-emerald-700" : l.receivedMilli ? "text-amber-700" : "text-slate-400")}>{qtyU(l.receivedMilli, l.unit)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(l.unitCost)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(sub + Math.round((sub * l.taxBps) / 10_000))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 text-sm"><tr><td colSpan={4} className="px-3 py-2 text-right text-slate-600">Items {money(p.subtotal)} + GST {money(p.taxTotal)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{money(p.total)}</td></tr></tfoot>
            </table>
          </div>
          {p.notes && <p className="text-sm text-slate-600"><span className="text-slate-400">Note:</span> {p.notes}</p>}
          {p.receipts.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Deliveries received</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                {p.receipts.map((r: any) => <li key={r.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span>{qtyU(r.quantityMilli, r.unit)} {r.itemName}{r.expenseId && <Badge color="violet" className="ml-2">bill in expenses</Badge>}{r.note && <span className="block text-xs text-slate-500">{r.note}</span>}</span><span className="text-xs text-slate-500">{dateTime(r.createdAt)} · {r.by}</span></li>)}
              </ul>
            </div>
          )}
        </>
      )}
      {receiving && p && <ReceiveModal po={p} canBill={can("expenses.manage")} onClose={() => setReceiving(false)} onDone={(msg) => { setReceiving(false); po.reload(); onChanged(msg); }} />}
      {cancelling && p && <CancelPoModal po={p} onClose={() => setCancelling(false)} onDone={(msg) => { setCancelling(false); po.reload(); onChanged(msg); }} />}
    </Modal>
  );
}

function ReceiveModal({ po, canBill, onClose, onDone }: { po: any; canBill: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const pending = po.lines.filter((l: any) => l.receivedMilli < l.quantityMilli);
  const [q, setQ] = useState<Record<string, string>>(() => Object.fromEntries(pending.map((l: any) => [l.id, String((l.quantityMilli - l.receivedMilli) / 1000)])));
  const [rate, setRate] = useState<Record<string, string>>(() => Object.fromEntries(pending.map((l: any) => [l.id, String(l.unitCost / 100)])));
  const defaultCategory = INVENTORY_EXPENSE_CATEGORY[pending[0]?.category as keyof typeof INVENTORY_EXPENSE_CATEGORY] ?? "Other";
  const [bill, setBill] = useState({ record: canBill, category: defaultCategory, method: "bank_transfer", reference: "", fromDrawer: true });
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const value = pending.reduce((s: number, l: any) => {
    const n = num(q[l.id] ?? ""), r = rupeesToPaise(rate[l.id] ?? "");
    if (isNaN(n) || isNaN(r)) return s;
    const sub = Math.round(n * r);
    return s + sub + Math.round((sub * l.taxBps) / 10_000);
  }, 0);
  const over = pending.some((l: any) => num(q[l.id] ?? "0") * 1000 > l.quantityMilli - l.receivedMilli + 1e-6);
  const any = pending.some((l: any) => num(q[l.id] ?? "0") > 0);
  async function save() {
    setErr("");
    setBusy(true);
    try {
      await api(`/purchase-orders/${po.id}/receive`, { body: {
        lines: pending.map((l: any) => ({ lineId: l.id, quantity: num(q[l.id] || "0") || 0, unitCost: rupeesToPaise(rate[l.id] ?? "") })).filter((l: any) => l.quantity > 0),
        note: note.trim() || undefined,
        bill: bill.record ? { category: bill.category, method: bill.method, reference: bill.reference.trim() || undefined, paidFromDrawer: bill.method === "cash" && bill.fromDrawer ? true : undefined } : undefined,
      } });
      onDone(`Goods received against ${po.poNumber}; stock updated${bill.record ? ` and ${money(value)} bill recorded in Expenses` : ""}.`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open wide="xl" title={`Receive goods · ${po.poNumber}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!any || over || (bill.record && bill.category.length < 2)}><PackageCheck className="h-4 w-4" />Add to stock · {money(value)}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">Check the delivery against the order. Change the quantity if only part arrived; the rest stays on order.</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Still due</th><th className="w-36 px-3 py-2">Received now</th><th className="w-32 px-3 py-2">Rate (₹)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {pending.map((l: any) => {
              const due = l.quantityMilli - l.receivedMilli;
              const bad = num(q[l.id] ?? "0") * 1000 > due + 1e-6;
              return (
                <tr key={l.id}>
                  <td className="px-3 py-2 font-medium">{l.itemName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{qtyU(due, l.unit)}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-1"><Input inputMode="decimal" value={q[l.id] ?? ""} onChange={(e) => setQ({ ...q, [l.id]: e.target.value.replace(/[^0-9.]/g, "") })} className={cx(bad && "border-red-400")} aria-label={`Received ${l.itemName}`} /><span className="text-xs text-slate-500">{l.unit}</span></div></td>
                  <td className="px-3 py-2"><Input inputMode="decimal" value={rate[l.id] ?? ""} onChange={(e) => setRate({ ...rate, [l.id]: e.target.value.replace(/[^0-9.]/g, "") })} aria-label={`Rate ${l.itemName}`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {over && <p className="text-sm text-red-600">A quantity is more than what is still due on the order.</p>}
      <Field label="Delivery note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. challan no. 4471" /></Field>
      {canBill && (
        <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
          <label className="flex items-start gap-2.5 text-sm text-violet-950">
            <input type="checkbox" checked={bill.record} onChange={(e) => setBill({ ...bill, record: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-700" />
            <span>Record the supplier&apos;s bill ({money(value)}) in Expenses<span className="block text-xs text-violet-800">So the cost shows in your reports. Untick if the bill comes later or you already entered it.</span></span>
          </label>
          {bill.record && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Expense category"><Select value={bill.category} onChange={(e) => setBill({ ...bill, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Paid by"><Select value={bill.method} onChange={(e) => setBill({ ...bill, method: e.target.value })}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Credit / pay later</option></Select></Field>
              <Field label="Bill no."><Input value={bill.reference} onChange={(e) => setBill({ ...bill, reference: e.target.value })} placeholder="Optional" /></Field>
              {bill.method === "cash" && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={bill.fromDrawer} onChange={(e) => setBill({ ...bill, fromDrawer: e.target.checked })} className="h-4 w-4 accent-brand-700" />Paid from the shop&apos;s cash drawer (needs an open shift)</label>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CancelPoModal({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const partial = po.status === "partial";
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await api(`/purchase-orders/${po.id}/cancel`, { body: { reason } });
      onDone(partial ? `${po.poNumber} closed. The undelivered items are no longer on order.` : `${po.poNumber} cancelled.`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title={partial ? `Close ${po.poNumber}` : `Cancel ${po.poNumber}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Keep</Button><Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>{partial ? "Close order" : "Cancel order"}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">{partial ? "Stock already received stays. The remaining quantities stop showing as “on order”." : "Nothing has been received on this order, so no stock changes."}</p>
      <Field label="Reason" required><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier out of stock" /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ suppliers

function SuppliersTab({ suppliers, onNotice }: { suppliers: ReturnType<typeof useApi<Supplier[]>>; onNotice: (m: string) => void }) {
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const list = suppliers.data ?? [];
  return (
    <Card padded={false} title={`${list.filter((s) => s.isActive).length} active suppliers`} actions={<Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add supplier</Button>}>
      {suppliers.error && <div className="p-4"><Alert>{suppliers.error.message}</Alert></div>}
      {!suppliers.data ? <Spinner /> : !list.length ? <Empty title="No suppliers yet">Add the shops and distributors you buy chemicals and packing from.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2.5">Supplier</th><th className="px-4 py-2.5">Contact</th><th className="px-4 py-2.5 text-right">Orders</th><th className="px-4 py-2.5 text-right">Bought</th><th className="px-4 py-2.5">Last order</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((s) => (
                <tr key={s.id} className={cx("cursor-pointer hover:bg-slate-50", !s.isActive && "text-slate-400")} onClick={() => setEditing(s)}>
                  <td className="px-4 py-3"><span className="font-medium text-slate-900">{s.name}</span>{!s.isActive && <Badge className="ml-2">Switched off</Badge>}{s.gstin && <span className="block font-mono text-[11px] text-slate-500">GSTIN {s.gstin}</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{[s.contactPerson, s.phone].filter(Boolean).join(" · ") || "—"}{s.email && <span className="block text-xs text-slate-500">{s.email}</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.orderCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(s.purchasedTotal)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{s.lastOrderAt ? dateOnly(s.lastOrderAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SupplierModal supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); onNotice(m); suppliers.reload(); }} />}
    </Card>
  );
}

function SupplierModal({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: (m: string, s: Supplier) => void }) {
  const [f, setF] = useState({ name: supplier?.name ?? "", contactPerson: supplier?.contactPerson ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", gstin: supplier?.gstin ?? "", address: supplier?.address ?? "", notes: supplier?.notes ?? "", isActive: supplier?.isActive ?? true });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setErr("");
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
      const s = supplier ? await api<Supplier>(`/suppliers/${supplier.id}`, { method: "PATCH", body }) : await api<Supplier>("/suppliers", { body });
      onSaved(supplier ? `${f.name} updated.` : `${f.name} added.`, s);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open wide title={supplier ? `Edit ${supplier.name}` : "Add supplier"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2}>{supplier ? "Save" : "Add supplier"}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" required><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Sharma Chemicals" /></Field>
        <Field label="Contact person"><Input value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} /></Field>
        <Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="GSTIN" hint="Optional, printed on purchase orders"><Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} className="font-mono" /></Field>
        <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Note" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. 30 days credit" /></Field>
      </div>
      {supplier && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="h-4 w-4 accent-brand-700" />Still buying from this supplier</label>}
    </Modal>
  );
}

// ------------------------------------------------------------------ usage

function UsageTab({ branchId }: { branchId: string }) {
  const month = () => { const d = todayISO(); return { from: `${d.slice(0, 8)}01`, to: d }; };
  const [range, setRange] = useState(month());
  const list = useApi<any[]>(`/inventory/usage?from=${range.from}&to=${range.to}&branchId=${branchId}`);
  const rows = list.data ?? [];
  const purchased = rows.reduce((s, r) => s + r.purchasedValue, 0);
  const consumed = rows.reduce((s, r) => s + r.usedValue, 0);
  return (
    <Card padded={false} title={<span>Purchased {money(purchased)} · Used &amp; wasted ≈ {money(consumed)}</span>} actions={<>
      <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8 w-36 py-0 text-xs" aria-label="From" />
      <span className="text-xs text-slate-400">to</span>
      <Input type="date" value={range.to} min={range.from} max={todayISO()} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8 w-36 py-0 text-xs" aria-label="To" />
      <Button size="sm" variant="secondary" disabled={!rows.length} onClick={() => downloadCsv(`stock-usage-${range.from}-to-${range.to}.csv`, ["Code", "Item", "Category", "Unit", "Purchased", "Purchase value (INR)", "Used", "Wasted", "Returned", "Stock-check difference", "Used+wasted value (INR)"],
        rows.map((r) => [r.itemCode, r.name, r.category, r.unit, r.purchased / 1000, (r.purchasedValue / 100).toFixed(2), r.used / 1000, r.wasted / 1000, r.returned / 1000, r.countDifference / 1000, (r.usedValue / 100).toFixed(2)]))}><Download className="h-4 w-4" />Export</Button>
    </>}>
      {list.error && <div className="p-4"><Alert>{list.error.message}</Alert></div>}
      {!list.data ? <Spinner /> : !rows.length ? <Empty title="No stock movements in this period" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2.5">Item</th><th className="px-4 py-2.5 text-right">Bought</th><th className="px-4 py-2.5 text-right">Used</th><th className="px-4 py-2.5 text-right">Wasted</th><th className="px-4 py-2.5 text-right">Stock-check difference</th><th className="px-4 py-2.5 text-right">Cost used</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}<span className="block text-[11px] font-normal text-slate-500">{r.category}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{r.purchased ? <>{qtyU(r.purchased, r.unit)}<span className="block text-[11px] text-slate-500">{money(r.purchasedValue)}</span></> : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{r.used ? qtyU(r.used, r.unit) : "—"}</td>
                  <td className={cx("whitespace-nowrap px-4 py-2.5 text-right tabular-nums", r.wasted > 0 && "text-red-600")}>{r.wasted ? qtyU(r.wasted, r.unit) : "—"}</td>
                  <td className={cx("whitespace-nowrap px-4 py-2.5 text-right tabular-nums", r.countDifference < 0 && "text-red-600")}>{r.countDifference ? `${r.countDifference > 0 ? "+" : ""}${qtyU(r.countDifference, r.unit)}` : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{r.usedValue ? money(r.usedValue) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
