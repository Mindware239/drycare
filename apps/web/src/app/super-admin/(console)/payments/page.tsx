"use client";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CreditCard, FileText, Inbox, Landmark, Search, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ConsoleHeader, CsvButton, DataTable, EmptyState, LoadingRows, Panel, SegmentedTabs, StatusBadge, dateTimeLabel, exportCsv, rupees, useAdminData } from "../admin-ui";

type Payment = { id: string; organizationId: string; organizationName: string; provider: string; reference: string; amountPaise: number; currency: string; status: string; createdAt: string; invoiceId: string | null; invoiceNumber: string | null };
type Claim = { id: string; organizationId: string; organizationName: string; provider: string; reference: string; amountPaise: number; createdAt: string; details: { planId?: string; planName?: string; paidOn?: string; note?: string } };
type Prefill = { claimId: string; orgId: string; orgName: string; planId?: string; method: "upi" | "bank_transfer"; amountPaise: number; reference: string };
type Plan = { id: string; code: string; name: string; pricePaise: number; payablePaise: number; gstInclusive: boolean; interval: string; published: boolean };
type CustomerOption = { id: string; name: string; ownerEmail: string | null; status: string; planName: string | null; subscriptionStatus: string | null; subscriptionEndsAt: string | null };

const CHANNEL_LABELS: Record<string, string> = { manual_upi: "UPI (verified manually)", manual_bank_transfer: "Bank transfer", manual_cash: "Cash / other", razorpay: "Online · Razorpay" };

function PaymentsInner() {
  const preselect = useSearchParams().get("org") ?? "";
  const payments = useAdminData<Payment[]>("/platform-admin/payments");
  const [channel, setChannel] = useState<"all" | "manual_upi" | "manual_bank_transfer" | "manual_cash">("all");
  const [notice, setNotice] = useState<{ text: string; invoiceId?: string } | null>(null);
  const claims = useAdminData<Claim[]>("/platform-admin/payment-claims");
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  const rows = (payments.data ?? []).filter((p) => channel === "all" || p.provider === channel);
  const total = rows.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amountPaise), 0);

  return (
    <>
      <ConsoleHeader
        title="Payments & UPI / bank transfers"
        description="Check that the money has actually arrived in the Mindware bank account before you record it. Recording a payment activates or renews the plan immediately and issues the GST tax invoice."
      />
      {notice && (
        <div className="mb-5">
          <Alert tone="green" onClose={() => setNotice(null)}>
            {notice.text}{notice.invoiceId && <> <Link href={`/super-admin/invoices/view?id=${notice.invoiceId}`} className="font-semibold underline">Open the tax invoice</Link></>}
          </Alert>
        </div>
      )}
      <ClaimsQueue claims={claims.data ?? []} onVerify={(c) => setPrefill({ claimId: c.id, orgId: c.organizationId, orgName: c.organizationName, planId: c.details.planId, method: c.provider === "claim_bank_transfer" ? "bank_transfer" : "upi", amountPaise: c.amountPaise, reference: c.reference })} onRejected={() => void claims.reload()} />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <RecordPayment preselect={preselect} prefill={prefill} onClearPrefill={() => setPrefill(null)} onRecorded={(text, invoiceId) => { setNotice({ text, invoiceId }); setPrefill(null); void payments.reload(); void claims.reload(); }} />
        <Panel title="Payment register" description={`${rows.length} record${rows.length === 1 ? "" : "s"} · ${money(total)} verified`} padded={false}
          actions={<>
            <SegmentedTabs value={channel} onChange={setChannel} options={[{ value: "all", label: "All" }, { value: "manual_upi", label: "UPI" }, { value: "manual_bank_transfer", label: "Bank" }, { value: "manual_cash", label: "Other" }]} />
            <CsvButton disabled={!rows.length} onClick={() => exportCsv(`drycare-payments-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((p) => ({ Date: p.createdAt.slice(0, 19).replace("T", " "), Business: p.organizationName, Channel: CHANNEL_LABELS[p.provider] ?? p.provider, Reference: p.reference, "Amount (INR)": rupees(p.amountPaise), Status: p.status })))} />
          </>}>
          {payments.error && <div className="p-4"><Alert>{payments.error}</Alert></div>}
          {!payments.data ? <LoadingRows /> : (
            <DataTable minWidth={720} head={["Received", "Business", "Channel", "UTR / reference", "Amount", "Status", "Invoice"]}
              empty={!rows.length && <EmptyState icon={CreditCard} title="No payments recorded yet">Verified UPI and bank transfers you record will appear here and count towards collected revenue.</EmptyState>}>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 text-xs text-slate-600">{dateTimeLabel(p.createdAt)}</td>
                  <td className="px-5 py-3"><Link href={`/super-admin/customers/view?id=${p.organizationId}`} className="font-medium text-slate-900 hover:text-brand-700">{p.organizationName}</Link></td>
                  <td className="px-5 py-3 text-slate-700">{CHANNEL_LABELS[p.provider] ?? p.provider}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.reference}</td>
                  <td className="px-5 py-3 font-semibold tabular-nums">{money(p.amountPaise)}</td>
                  <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-5 py-3">{p.invoiceId ? <Link href={`/super-admin/invoices/view?id=${p.invoiceId}`} className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand-700 hover:underline"><FileText className="h-3.5 w-3.5" />{p.invoiceNumber}</Link> : <span className="text-xs text-slate-400">—</span>}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}

function RecordPayment({ preselect, prefill, onClearPrefill, onRecorded }: { preselect: string; prefill: Prefill | null; onClearPrefill: () => void; onRecorded: (message: string, invoiceId?: string) => void }) {
  const plans = useAdminData<Plan[]>("/platform-admin/plans");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [orgId, setOrgId] = useState(preselect);
  const [planId, setPlanId] = useState("");
  const [method, setMethod] = useState<"upi" | "bank_transfer" | "cash">("upi");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customerError, setCustomerError] = useState("");

  const published = useMemo(() => (plans.data ?? []).filter((p) => p.published && !p.code.startsWith("smoke-")), [plans.data]);
  const plan = published.find((p) => p.id === planId);
  const org = options.find((o) => o.id === orgId);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ search, pageSize: "20", sort: search ? "name" : "newest" });
      setCustomerError("");
      void (async () => {
        try {
          const res = await api<{ items: CustomerOption[] }>(`/platform-admin/customers?${q}`);
          let items = res.items;
          // Keep the preselected business in the list even when it is not in the first page of results.
          if (orgId && !items.some((i) => i.id === orgId)) {
            const detail = await api<{ organization: { id: string; name: string; status: string } }>(`/platform-admin/customers/${orgId}`);
            items = [{ id: detail.organization.id, name: detail.organization.name, ownerEmail: null, status: detail.organization.status, planName: null, subscriptionStatus: null, subscriptionEndsAt: null }, ...items];
          }
          if (active) setOptions(items);
        } catch (cause) {
          if (active) setCustomerError(cause instanceof Error ? cause.message : "Could not load customer accounts.");
        }
      })();
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search, orgId]);

  useEffect(() => {
    if (!planId && published.length) setPlanId(published[0].id);
  }, [published, planId]);
  useEffect(() => {
    if (plan && !prefill) setAmount(String(plan.payablePaise / 100));
  }, [plan, prefill]);
  useEffect(() => {
    if (!prefill) return;
    setOrgId(prefill.orgId);
    if (prefill.planId) setPlanId(prefill.planId);
    setMethod(prefill.method);
    setAmount(String(prefill.amountPaise / 100));
    setReference(prefill.reference);
    setReason("");
    setConfirmed(false);
  }, [prefill]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await api(`/platform-admin/organizations/${orgId}/verify-manual-payment`, {
        body: { planId, method, reference: reference.trim(), amountPaise: Math.round(Number(amount) * 100), reason, ...(prefill ? { claimId: prefill.claimId } : {}) },
      }) as { invoice?: { id: string; number: string } | null };
      onRecorded(`Payment of ₹${Number(amount).toLocaleString("en-IN")} recorded for ${org?.name ?? prefill?.orgName ?? "the business"}. Their ${plan?.name} plan is active${res.invoice ? ` and tax invoice ${res.invoice.number} was issued` : ""}.`, res.invoice?.id);
      setReference("");
      setReason("");
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record this payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-brand-700" />Record a verified payment</span>} description="Activates a new plan or renews the current one">
      {!plans.data ? <LoadingRows rows={4} /> : !published.length ? (
        <Alert tone="amber">No plans are published. <Link href="/super-admin/plans" className="font-semibold underline">Set a price and publish a plan</Link> before recording payments.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {prefill && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              <span>Confirming <strong>{prefill.orgName}</strong>&apos;s report. Check your bank statement for reference <span className="font-mono font-semibold">{prefill.reference}</span> before recording.</span>
              <button type="button" onClick={onClearPrefill} aria-label="Cancel" className="text-blue-700 hover:text-blue-900"><X className="h-4 w-4" /></button>
            </div>
          )}
          {(error || customerError) && <Alert>{error || customerError}</Alert>}
          <Field label="Business" required>
            <div className="space-y-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business or owner email" className="pl-9" aria-label="Search businesses" />
              </label>
              <Select required value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Business">
                <option value="">Select a business…</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.ownerEmail ? ` · ${o.ownerEmail}` : ""}</option>)}
              </Select>
              {org?.planName && org.subscriptionStatus === "active" && <p className="text-xs text-slate-500">Currently on {org.planName}. Recording the same plan renews it from the current end date.</p>}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan" required>
              <Select required value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {published.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.payablePaise)}/{p.interval === "year" ? "yr" : "mo"}{p.gstInclusive ? "" : " incl. GST"}</option>)}
              </Select>
            </Field>
            <Field label="Received via" required>
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="upi">UPI</option><option value="bank_transfer">Bank transfer (NEFT / IMPS / RTGS)</option><option value="cash">Cash / other</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount received (₹)" required hint={plan ? `Due ${money(plan.payablePaise)}${plan.gstInclusive ? " (GST included)" : ` = ${money(plan.pricePaise)} + GST`}` : undefined}>
              <Input type="number" min={plan ? plan.payablePaise / 100 : 1} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={method === "upi" ? "UPI reference / UTR" : method === "bank_transfer" ? "Bank UTR number" : "Receipt reference"} required>
              <Input required minLength={4} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "cash" ? "Receipt no." : "12-22 characters"} className="font-mono" />
            </Field>
          </div>
          <Field label="How did you verify it?" required hint="Saved in the audit log. Never enter UPI PINs, OTPs or bank passwords.">
            <Textarea rows={2} required minLength={8} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Checked HDFC statement on 28 Oct, credit of ₹4,999 matches UTR" />
          </Field>
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-700" />
            I confirm this amount has been credited to the Mindware bank account. A customer screenshot alone is not proof of payment.
          </label>
          <Button type="submit" className="w-full" loading={saving} disabled={!confirmed || !orgId || !planId}><ShieldCheck className="h-4 w-4" />Record payment, activate plan &amp; issue invoice</Button>
        </form>
      )}
    </Panel>
  );
}

function ClaimsQueue({ claims, onVerify, onRejected }: { claims: Claim[]; onVerify: (c: Claim) => void; onRejected: () => void }) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function reject(id: string) {
    setError("");
    try {
      await api(`/platform-admin/payment-claims/${id}/reject`, { body: { reason } });
      setRejecting(null);
      setReason("");
      onRejected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reject this report.");
    }
  }
  return (
    <Panel className="mb-6" title={<span className="flex items-center gap-2"><Inbox className="h-4 w-4 text-brand-700" />Payments reported by shops</span>}
      description={claims.length ? `${claims.length} waiting for you to check the bank statement` : "Shops tell you here after paying by UPI or bank transfer"} padded={false}>
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      {!claims.length ? (
        <p className="px-5 py-4 text-sm text-slate-500">Nothing to check. New reports from the shop&apos;s Plan &amp; billing screen appear here.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
              <div className="min-w-[220px] flex-1">
                <Link href={`/super-admin/customers/view?id=${c.organizationId}`} className="font-semibold text-slate-900 hover:text-brand-700">{c.organizationName}</Link>
                <p className="text-xs text-slate-500">{c.details.planName ?? "Plan"} · {c.provider === "claim_bank_transfer" ? "Bank transfer" : "UPI"} · reported {dateTimeLabel(c.createdAt)}{c.details.paidOn ? ` · paid on ${c.details.paidOn}` : ""}</p>
                {c.details.note && <p className="mt-0.5 text-xs italic text-slate-500">“{c.details.note}”</p>}
              </div>
              <span className="font-mono text-xs text-slate-700">{c.reference}</span>
              <span className="font-semibold tabular-nums">{money(c.amountPaise)}</span>
              {rejecting === c.id ? (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason the shop will see" className="w-64" autoFocus />
                  <Button size="sm" variant="danger" disabled={reason.trim().length < 8} onClick={() => void reject(c.id)}>Reject</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => { onVerify(c); window.scrollTo({ top: 0, behavior: "smooth" }); }}><ShieldCheck className="h-4 w-4" />Verify</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setRejecting(c.id); setReason(""); }}>Reject</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function PaymentsPage() {
  return <Suspense><PaymentsInner /></Suspense>;
}
