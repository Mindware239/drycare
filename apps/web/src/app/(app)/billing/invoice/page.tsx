"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { useApi } from "@/lib/api";
import { Alert, Button, Spinner } from "@/components/ui";
import { SubscriptionInvoice, type SubscriptionInvoiceData } from "@/components/SubscriptionInvoice";

function InvoiceInner() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useApi<SubscriptionInvoiceData>(id ? `/commercial/invoices/${id}` : null);
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner />;
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href="/billing" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Plan & billing</Link>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save PDF</Button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-slate-100 p-4 print:bg-white print:p-0"><SubscriptionInvoice invoice={data} /></div>
    </>
  );
}

export default function BillingInvoicePage() {
  return <Suspense><InvoiceInner /></Suspense>;
}
