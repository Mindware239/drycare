"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PAYMENT_METHOD_LABELS, type BillingProfile, type PaymentMethod } from "@drycare/shared";
import { useApi } from "@/lib/api";
import { amountInWords, currentRegion, dateOnly, money } from "@/lib/format";
import { Alert, Button, Spinner } from "@/components/ui";

type Invoice = {
  invoiceNumber: string | null; planName: string; discountBps: number; pricePaid: number; taxBps: number; taxAmount: number; startsAt: string; endsAt: string; createdAt: string; status: string;
  customer: { name: string; phone: string | null; email: string | null; gstin: string | null };
  branch: { name: string; phone: string | null; address: Record<string, string> | null } | null;
  payment: { paymentMethod: PaymentMethod; providerReference: string | null } | null;
};
type SessionInfo = { organization: { name: string; gstin?: string; settings?: { billing?: Partial<BillingProfile> } } };

/** Tax invoice for a membership sale, or a plain receipt when no GST applies. */
function MembershipInvoiceInner() {
  const id = useSearchParams().get("id") ?? "";
  const { data: m, error } = useApi<Invoice>(id ? `/customer-memberships/${id}/invoice` : null);
  const session = useApi<SessionInfo>("/auth/session");
  if (error) return <div className="p-6"><Alert>{error.message}</Alert></div>;
  if (!m || !session.data) return <Spinner />;

  const org = session.data.organization;
  const billing = org.settings?.billing ?? {};
  const taxed = m.taxAmount > 0;
  const taxable = m.pricePaid - m.taxAmount;
  // A sale at the counter is within the shop's own state, so the GST divides equally into CGST and SGST.
  const sgst = Math.floor(m.taxAmount / 2);
  const cgst = m.taxAmount - sgst;
  const a = billing.address ?? {};
  const b = m.branch?.address ?? {};
  const address = [a.line1, a.line2, a.city ?? b.city, a.state, a.pincode].filter(Boolean).join(", ") || [b.line1, b.city].filter(Boolean).join(", ");
  const phone = billing.phone || m.branch?.phone;

  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-xl justify-center"><Button onClick={() => window.print()}>Print {taxed ? "invoice" : "receipt"}</Button></div>
      <article className="mx-auto max-w-xl rounded-lg bg-white p-6 text-sm text-slate-800 shadow-sm print:max-w-none print:rounded-none print:shadow-none">
        <header className="border-b border-slate-300 pb-3 text-center">
          <h1 className="text-lg font-bold text-slate-900">{org.name}</h1>
          {address && <p className="text-xs">{address}</p>}
          {phone && <p className="text-xs">Phone: {phone}</p>}
          {org.gstin && <p className="text-xs font-medium">{currentRegion().taxIdLabel}: {org.gstin}</p>}
          <p className="mt-2 text-sm font-bold tracking-wide">{taxed ? "TAX INVOICE" : "RECEIPT"}</p>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-slate-300 py-3 text-xs">
          <div><dt className="font-semibold">Number</dt><dd>{m.invoiceNumber ?? "Not numbered"}</dd></div>
          <div><dt className="font-semibold">Date</dt><dd>{dateOnly(m.createdAt)}</dd></div>
          <div><dt className="font-semibold">Customer</dt><dd>{m.customer.name}{m.customer.phone ? ` · ${m.customer.phone}` : ""}</dd></div>
          {m.customer.gstin && <div><dt className="font-semibold">Customer GSTIN</dt><dd>{m.customer.gstin}</dd></div>}
        </dl>
        <div className="border-b border-slate-300 py-3">
          <p className="font-semibold">{m.planName} membership</p>
          <p className="text-xs text-slate-600">Valid {dateOnly(m.startsAt)} to {dateOnly(m.endsAt)} · {m.discountBps / 100}% off orders</p>
          {m.status === "cancelled" && <p className="mt-1 text-xs font-semibold text-red-700">This membership was later cancelled.</p>}
        </div>
        <dl className="space-y-1 py-3 text-sm">
          {taxed && (
            <>
              <Line label="Taxable value" value={money(taxable)} />
              {currentRegion().splitsGst ? <><Line label={`CGST @ ${m.taxBps / 200}%`} value={money(cgst)} />
              <Line label={`SGST @ ${m.taxBps / 200}%`} value={money(sgst)} /></> : <Line label={`${currentRegion().taxName} @ ${m.taxBps / 100}%`} value={money(cgst + sgst)} />}
            </>
          )}
          <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-bold"><dt>Total paid</dt><dd className="tabular-nums">{money(m.pricePaid)}</dd></div>
        </dl>
        {currentRegion().currency === "INR" && <p className="text-xs text-slate-600">{amountInWords(m.pricePaid)}</p>}
        {m.payment && <p className="mt-1 text-xs text-slate-600">Paid by {PAYMENT_METHOD_LABELS[m.payment.paymentMethod] ?? m.payment.paymentMethod}{m.payment.providerReference ? ` · ${m.payment.providerReference}` : ""}</p>}
      </article>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}

export default function MembershipInvoicePage() {
  return <Suspense><MembershipInvoiceInner /></Suspense>;
}
