"use client";
import { useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus, SlidersHorizontal, Wallet } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner, cx } from "@/components/ui";

type Entry = { id: string; kind: "topup" | "spend" | "refund" | "adjust" | "claim"; amount: number; balanceAfter: number; note: string | null; createdAt: string; by: string | null; method: string | null; reference: string | null };
const KIND: Record<Entry["kind"], { label: string; tone: "green" | "blue" | "amber" | "slate" }> = {
  topup: { label: "Top-up", tone: "green" }, spend: { label: "Paid order", tone: "blue" }, refund: { label: "Refund back", tone: "amber" }, adjust: { label: "Adjustment", tone: "slate" }, claim: { label: "Claim compensation", tone: "green" },
};
const TOPUP_METHODS = ["cash", "upi", "card", "bank_transfer", "wallet", "other"] as const;

/** Prepaid wallet: balance, top-up at the counter, statement, and manager adjustments. */
export function CustomerWallet({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { branchId, can } = useSession();
  const { data, error, reload } = useApi<{ balance: number; entries: Entry[] }>(`/customers/${customerId}/wallet`);
  const [mode, setMode] = useState<"topup" | "adjust" | null>(null);
  return (
    <div className="space-y-4">
      {error && <Alert>{error.message}</Alert>}
      <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-5">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-600 text-white"><Wallet className="h-6 w-6" /></span>
        <div className="flex-1">
          <p className="text-sm text-slate-600">Wallet balance</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">{data ? money(data.balance) : "…"}</p>
          <p className="text-xs text-slate-500">Prepaid money {customerName} can use to pay orders at the counter.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("payments.collect") && <Button onClick={() => setMode("topup")}><Plus className="h-4 w-4" />Add money</Button>}
          {can("payments.refund") && <Button variant="secondary" onClick={() => setMode("adjust")}><SlidersHorizontal className="h-4 w-4" />Adjust</Button>}
        </div>
      </section>
      <Card padded={false} title="Wallet statement">
        {!data ? <div className="p-6"><Spinner /></div> : !data.entries.length ? <p className="px-4 py-10 text-center text-sm text-slate-500">No wallet activity yet. Add money to start.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Details</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{dateTime(e.createdAt)}</td>
                    <td className="px-4 py-2.5"><Badge color={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{[e.kind === "topup" && e.method ? PAYMENT_METHOD_LABELS[e.method as keyof typeof PAYMENT_METHOD_LABELS] ?? e.method : null, e.reference, e.note, e.by && `by ${e.by}`].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={cx("px-4 py-2.5 text-right font-semibold tabular-nums", e.amount >= 0 ? "text-emerald-700" : "text-slate-800")}>
                      <span className="inline-flex items-center gap-1">{e.amount >= 0 ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{e.amount >= 0 ? "+" : "−"}{money(Math.abs(e.amount))}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{money(e.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {mode === "topup" && <TopUp customerId={customerId} branchId={branchId} onClose={() => setMode(null)} onDone={() => { setMode(null); void reload(); }} />}
      {mode === "adjust" && <Adjust customerId={customerId} onClose={() => setMode(null)} onDone={() => { setMode(null); void reload(); }} />}
    </div>
  );
}

function TopUp({ customerId, branchId, onClose, onDone }: { customerId: string; branchId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof TOPUP_METHODS)[number]>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/customers/${customerId}/wallet/topups`, { body: { branchId, amount: rupeesToPaise(amount), method, reference: reference.trim() || undefined, note: note.trim() || undefined } });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }
  return (
    <Modal open title="Add money to wallet" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">{[500, 1000, 2000, 5000].map((v) => <button key={v} type="button" onClick={() => setAmount(String(v))} className={cx("rounded-lg border px-3 py-1.5 text-sm", amount === String(v) ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600")}>₹{v.toLocaleString("en-IN")}</button>)}</div>
        <Field label="Amount (₹)" required><Input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus /></Field>
        <Field label="Received by"><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{TOPUP_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</Select></Field>
        {method !== "cash" && method !== "wallet" && <Field label="Transaction reference" required><Input required value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card / UTR ref" /></Field>}
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly advance" maxLength={200} /></Field>
        <p className="text-xs text-slate-500">This is money received now: it counts in today&apos;s collections and the cash drawer. Paying orders from the wallet later is not counted again.</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!Number(amount)}>Add {amount ? `₹${Number(amount).toLocaleString("en-IN")}` : "money"}</Button></div>
      </form>
    </Modal>
  );
}

function Adjust({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const v = rupeesToPaise(amount);
      await api(`/customers/${customerId}/wallet/adjustments`, { body: { amount: dir === "add" ? v : -v, reason } });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }
  return (
    <Modal open title="Adjust wallet balance" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-600">For corrections or goodwill credit. No money changes hands; the reason is recorded in the audit log.</p>
        <Field label="Change"><Select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}><option value="add">Add to balance</option><option value="remove">Remove from balance</option></Select></Field>
        <Field label="Amount (₹)" required><Input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        <Field label="Reason" required><Input required minLength={8} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goodwill for late delivery" /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!Number(amount) || reason.trim().length < 8}>Save adjustment</Button></div>
      </form>
    </Modal>
  );
}
