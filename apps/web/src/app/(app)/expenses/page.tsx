"use client";
import { useEffect, useMemo, useState } from "react";
import { Ban, CalendarDays, Download, Plus, Receipt, Search, Tags, Wallet } from "lucide-react";
import { EXPENSE_CATEGORIES, PAYMENT_METHOD_LABELS, SHOP_PAYMENT_METHODS } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, dateTime, money, rupeesToPaise, todayISO } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m;
function monthRange(offset: number) {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = offset === 0 ? now : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export default function ExpensesPage() {
  const { branchId, branch } = useSession();
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(monthRange(0));
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const query = new URLSearchParams({ from: range.from, to: range.to, ...(branchId ? { branchId } : {}), ...(category ? { category } : {}), ...(search ? { search } : {}) });
  const list = useApi<any[]>(`/expenses?${query}`);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<any>(null);
  const [notice, setNotice] = useState("");

  const rows = list.data ?? [];
  const live = rows.filter(({ e }) => !e.voidedAt);
  const total = live.reduce((s, { e }) => s + Number(e.amount), 0);
  const fromDrawer = live.filter(({ e }) => e.shiftId).reduce((s, { e }) => s + Number(e.amount), 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const { e } of live) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [live]);

  function exportCsv() {
    const header = ["Date", "Branch", "Category", "Vendor", "Bill no.", "Description", "Paid by", "From drawer", "Amount (INR)", "Recorded by", "Status"];
    const esc = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; };
    const lines = rows.map(({ e, branchCode, createdByName }) => [e.spentOn, branchCode, e.category, e.vendor, e.reference, e.description, methodLabel(e.method), e.shiftId ? "Yes" : "No", (Number(e.amount) / 100).toFixed(2), createdByName, e.voidedAt ? `Voided: ${e.voidReason}` : "Recorded"].map(esc).join(","));
    const url = URL.createObjectURL(new Blob(["﻿", [header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const presets = [
    { key: "today", label: "Today", ...{ from: todayISO(), to: todayISO() } },
    { key: "month", label: "This month", ...monthRange(0) },
    { key: "last", label: "Last month", ...monthRange(-1) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        subtitle={`Rent, salaries, chemicals and other running costs for ${branch?.name ?? "your store"}. They appear on the dashboard and reports separately from sales.`}
        actions={<><Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />Export</Button><Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add expense</Button></>}
      />
      {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Wallet} label="Total spent" value={money(total)} hint={`${dateOnly(range.from)} – ${dateOnly(range.to)}`} />
        <Kpi icon={Receipt} label="Entries" value={String(live.length)} hint={rows.length !== live.length ? `${rows.length - live.length} voided` : "All active"} />
        <Kpi icon={Tags} label="Biggest category" value={byCategory[0]?.[0] ?? "—"} hint={byCategory[0] ? money(byCategory[0][1]) : "No expenses yet"} small />
        <Kpi icon={CalendarDays} label="Paid from cash drawer" value={money(fromDrawer)} hint="Deducted from shift cash" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
              {presets.map((p) => <button key={p.key} type="button" onClick={() => { setPreset(p.key); setRange({ from: p.from, to: p.to }); }} className={cx("rounded-md px-2.5 py-1", preset === p.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{p.label}</button>)}
            </div>
            <Input type="date" value={range.from} max={range.to} onChange={(e) => { setPreset(""); setRange({ ...range, from: e.target.value }); }} className="h-8 w-36 py-0 text-xs" aria-label="From" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" value={range.to} min={range.from} onChange={(e) => { setPreset(""); setRange({ ...range, to: e.target.value }); }} className="h-8 w-36 py-0 text-xs" aria-label="To" />
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-44 py-0 text-xs" aria-label="Category">
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <label className="relative ml-auto"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Vendor, bill no., note" className="h-8 w-52 pl-8 text-xs" aria-label="Search expenses" /></label>
          </div>
          {list.error && <div className="p-4"><Alert>{list.error.message}</Alert></div>}
          {!list.data ? <Spinner /> : !rows.length ? (
            <Empty title="No expenses in this period">Use “Add expense” to record rent, wages, chemicals or any other cost.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5">Details</th><th className="px-4 py-2.5">Paid by</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5" /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ e, branchCode, createdByName }) => (
                    <tr key={e.id} className={cx("align-top", e.voidedAt && "bg-slate-50/60 text-slate-400")}>
                      <td className="whitespace-nowrap px-4 py-3">{dateOnly(e.spentOn)}<span className="block text-[11px] text-slate-400">{branchCode}</span></td>
                      <td className="px-4 py-3"><Badge color={e.voidedAt ? "slate" : "violet"}>{e.category}</Badge></td>
                      <td className="px-4 py-3">
                        <p className={cx("font-medium", e.voidedAt ? "line-through" : "text-slate-800")}>{e.vendor || e.description || "—"}</p>
                        <p className="text-xs text-slate-500">{[e.vendor && e.description ? e.description : null, e.reference ? `Bill ${e.reference}` : null, `by ${createdByName}`].filter(Boolean).join(" · ")}</p>
                        {e.voidedAt && <p className="mt-0.5 text-xs text-red-600">Voided {dateTime(e.voidedAt)} — {e.voidReason}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{methodLabel(e.method)}{e.shiftId && <span className="block text-[11px] text-amber-700">from cash drawer</span>}</td>
                      <td className={cx("whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums", e.voidedAt ? "line-through" : "text-slate-900")}>{money(e.amount)}</td>
                      <td className="px-2 py-3 text-right">{!e.voidedAt && <button type="button" onClick={() => setVoiding(e)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Void this expense" aria-label="Void expense"><Ban className="h-4 w-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-slate-50 font-semibold"><td colSpan={4} className="px-4 py-2.5">Total ({live.length} active)</td><td className="px-4 py-2.5 text-right tabular-nums">{money(total)}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card title="Where the money went">
          {!byCategory.length ? <p className="text-sm text-slate-500">Category totals appear once expenses are recorded.</p> : (
            <ul className="space-y-3">
              {byCategory.map(([cat, amt]) => (
                <li key={cat}>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">{cat}</span><span className="font-semibold tabular-nums">{money(amt)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(3, Math.round((amt / total) * 100))}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {adding && <AddExpenseModal branchId={branchId} onClose={() => setAdding(false)} onSaved={(msg) => { setAdding(false); setNotice(msg); list.reload(); }} />}
      {voiding && <VoidExpenseModal expense={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); setNotice("Expense voided. It no longer counts in totals."); list.reload(); }} />}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, small }: { icon: typeof Wallet; label: string; value: string; hint?: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className={cx("mt-1.5 truncate font-semibold tabular-nums text-slate-900", small ? "text-lg" : "text-xl sm:text-2xl")}>{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function AddExpenseModal({ branchId, onClose, onSaved }: { branchId: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [f, setF] = useState({ category: "Detergents & consumables", custom: "", amount: "", method: "cash", spentOn: todayISO(), vendor: "", reference: "", description: "", fromDrawer: true });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = rupeesToPaise(f.amount);
  const category = f.category === "Other" && f.custom.trim() ? f.custom.trim() : f.category;

  async function save() {
    setErr("");
    setBusy(true);
    try {
      await api("/expenses", { body: {
        branchId, category, amount, method: f.method, spentOn: f.spentOn,
        vendor: f.vendor.trim() || undefined, reference: f.reference.trim() || undefined, description: f.description.trim() || undefined,
        paidFromDrawer: f.method === "cash" && f.fromDrawer ? true : undefined,
      } });
      onSaved(`${money(amount)} recorded under ${category}${f.method === "cash" && f.fromDrawer ? " and deducted from your cash drawer" : ""}.`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal open wide title="Add expense" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!(amount > 0) || category.length < 2}>Save {amount > 0 ? money(amount) : ""}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        {f.category === "Other" ? (
          <Field label="Describe the category"><Input value={f.custom} onChange={(e) => setF({ ...f, custom: e.target.value })} placeholder="e.g. Insurance" maxLength={60} /></Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Amount (₹)" required><Input inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" className="text-lg" /></Field>
        <Field label="Date" required><Input type="date" value={f.spentOn} max={todayISO()} onChange={(e) => setF({ ...f, spentOn: e.target.value })} /></Field>
        <Field label="Paid by">
          <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{SHOP_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
        </Field>
        <Field label="Paid to (vendor / person)"><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="e.g. Sharma Chemicals" /></Field>
        <Field label="Bill / receipt no."><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Optional" /></Field>
        <Field label="Note" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. 20 L perchloroethylene" /></Field>
      </div>
      {f.method === "cash" && (
        <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" checked={f.fromDrawer} onChange={(e) => setF({ ...f, fromDrawer: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-700" />
          <span>Paid from the shop&apos;s cash drawer<span className="block text-xs text-amber-800">Lowers the expected cash of your open shift so the drawer still balances. Untick if paid from personal or office cash.</span></span>
        </label>
      )}
    </Modal>
  );
}

function VoidExpenseModal({ expense, onClose, onDone }: { expense: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setErr("");
    setBusy(true);
    try {
      await api(`/expenses/${expense.id}/void`, { body: { reason } });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Void ${money(expense.amount)} · ${expense.category}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Keep</Button><Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>Void expense</Button></>}>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">The entry stays in the list, crossed out, and stops counting in totals and reports. This is recorded in the audit log.</p>
      <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" autoFocus /></Field>
    </Modal>
  );
}
