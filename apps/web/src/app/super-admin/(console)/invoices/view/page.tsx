"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Button, Textarea } from "@/components/ui";
import { SubscriptionInvoice, type SubscriptionInvoiceData } from "@/components/SubscriptionInvoice";
import { LoadingRows, Panel, useAdminData } from "../../admin-ui";

function InvoiceView() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, reload } = useAdminData<SubscriptionInvoiceData>(id ? `/platform-admin/invoices/${id}` : null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");

  async function voidInvoice() {
    setActionError("");
    try {
      await api(`/platform-admin/invoices/${id}/void`, { body: { reason } });
      setVoiding(false);
      void reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not void this invoice.");
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/super-admin/invoices" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />All invoices</Link>
        {data && (
          <div className="flex gap-2">
            {data.status === "issued" && <Button variant="secondary" onClick={() => setVoiding(true)}><Ban className="h-4 w-4" />Void invoice</Button>}
            <Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save PDF</Button>
          </div>
        )}
      </div>
      {(error || actionError) && <div className="mb-4 print:hidden"><Alert>{error || actionError}</Alert></div>}
      {voiding && (
        <Panel className="mb-5 print:hidden" title="Void this invoice?" description="The number stays used and the invoice stays on record marked VOID. The customer's subscription is not changed.">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. payment reversed by the bank" />
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={reason.trim().length < 8} onClick={() => void voidInvoice()}>Void invoice</Button>
            <Button variant="ghost" onClick={() => setVoiding(false)}>Cancel</Button>
          </div>
        </Panel>
      )}
      {!data ? <Panel><LoadingRows /></Panel> : <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100 p-4 print:border-0 print:bg-white print:p-0"><SubscriptionInvoice invoice={data} /></div>}
    </>
  );
}

export default function InvoiceViewPage() {
  return <Suspense><InvoiceView /></Suspense>;
}
