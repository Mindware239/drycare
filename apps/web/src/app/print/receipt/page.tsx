"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BillingProfile } from "@drycare/shared";
import { useApi } from "@/lib/api";
import { amountInWords, dateOnly, dateTime, money } from "@/lib/format";
import { Alert, Button, Select, Spinner } from "@/components/ui";


/** Screen E04: 80 mm thermal receipt or A4 tax invoice, using the store's invoice & payment details. */
function ReceiptPageInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { data: o, error } = useApi(`/orders/${id}`);
  const session = useApi("/auth/session");
  const [logoOk, setLogoOk] = useState(true);
  const [qrOk, setQrOk] = useState(true);
  const [format, setFormat] = useState<string | null>(params.get("format"));
  if (error) return <Alert>{error.message}</Alert>;
  if (!o || !session.data) return <Spinner />;

  const org = session.data.organization;
  const billing: Partial<BillingProfile> = org.settings?.billing ?? {};
  const inv = { paper: "80mm", showBank: true, showUpiQr: true, showLogo: true, ...(billing.invoice ?? {}) };
  const chosen = format ?? inv.paper;
  const paper: "80mm" | "a4" | "a5" = chosen === "a4" || chosen === "a5" ? chosen : "80mm";
  const sheet = paper !== "80mm";
  const branchAddr = o.branch?.address ?? {};
  const a = billing.address ?? {};
  const address = [a.line1, a.line2, a.city ?? branchAddr.city, a.state, a.pincode].filter(Boolean).join(", ") || [branchAddr.line1, branchAddr.city].filter(Boolean).join(", ");
  const phone = billing.phone || o.branch?.phone;
  const pieces = o.garments.filter((g: any) => g.currentStatus !== "cancelled").length;
  const balance = Number(o.invoice?.balance ?? 0);
  const payable = Number(o.invoice?.payable ?? o.grandTotal);
  const credits = (o.creditNotes ?? []).filter((c: any) => c.status === "issued");
  const showQr = inv.showUpiQr && billing.upi?.vpa && balance > 0 && o.operationalStatus !== "cancelled" && qrOk;
  const showBank = inv.showBank && billing.bank?.accountNumber;
  const title = o.operationalStatus === "cancelled" ? "CANCELLED" : inv.title || "TAX INVOICE";
  const footer = org.settings?.invoiceFooter;
  const collected = o.garments.every((g: any) => g.currentStatus === "delivered" || g.currentStatus === "cancelled");
  const logo = inv.showLogo && logoOk && org.hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/api/v1/organizations/current/logo" alt="" onError={() => setLogoOk(false)} className={sheet ? "max-h-16 max-w-[45mm] object-contain" : "mx-auto mb-1 max-h-14 max-w-[50mm] object-contain grayscale"} />
  ) : null;
  const qr = showQr ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/v1/orders/${o.id}/upi-qr`} alt="UPI payment QR" onError={() => setQrOk(false)} className={sheet ? "h-[32mm] w-[32mm]" : "mx-auto h-[34mm] w-[34mm]"} />
  ) : null;

  const toolbar = (
    <div className="no-print mb-4 flex items-center justify-center gap-2">
      <Select value={paper} onChange={(e) => setFormat(e.target.value)} className="w-auto" aria-label="Paper size">
        <option value="80mm">80 mm thermal receipt</option>
        <option value="a4">A4 tax invoice</option>
        <option value="a5">A5 tax invoice</option>
      </Select>
      <Button onClick={() => window.print()}>Print {sheet ? "invoice" : "receipt"}</Button>
    </div>
  );

  if (sheet) {
    const half = Math.floor(o.taxTotal / 2);
    return (
      <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
        <style>{paper === "a5"
          ? `@page { size: A5; margin: 6mm } @media print { .invoice { box-shadow: none !important; margin: 0 !important; min-height: 0 !important } }`
          : `@page { size: A4; margin: 12mm } @media print { .invoice { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important } }`}</style>
        {toolbar}
        <div className="invoice mx-auto bg-white p-[12mm] text-[10pt] leading-snug text-slate-900 shadow" style={{ width: "210mm", minHeight: paper === "a5" ? undefined : "297mm", ...(paper === "a5" ? { zoom: 0.707 } : {}) }}>
          <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4">
            <div className="flex items-start gap-4">
              {logo}
              <div>
                <p className="text-[16pt] font-bold leading-tight">{org.name}</p>
                {address && <p>{address}</p>}
                <p>{[phone && `Phone: ${phone}`, billing.email, billing.website].filter(Boolean).join(" · ")}</p>
                <p>{[org.gstin && `GSTIN: ${org.gstin}`, billing.pan && `PAN: ${billing.pan}`].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[15pt] font-bold tracking-wide">{title}</p>
              <p>Invoice no: <b>{o.invoice?.invoiceNumber}</b></p>
              <p>Date: {dateOnly(o.receivedAt)}</p>
              <p>Order: {o.orderNumber}</p>
            </div>
          </header>

          <section className="mt-4 grid grid-cols-2 gap-6">
            <div>
              <p className="text-[8pt] font-bold uppercase tracking-wider text-slate-500">Bill to</p>
              <p className="font-semibold">{o.customer.name}</p>
              {o.customer.phone && <p>{o.customer.phone}</p>}
              {o.customer.email && <p>{o.customer.email}</p>}
              <p className="text-slate-500">Customer ID {o.customer.customerCode}</p>
            </div>
            <div className="text-right">
              <p className="text-[8pt] font-bold uppercase tracking-wider text-slate-500">Service details</p>
              <p>Received {dateTime(o.receivedAt)}</p>
              <p className="font-semibold">Ready by {dateTime(o.promisedAt)}{o.express ? " · EXPRESS" : ""}</p>
              <p>{pieces} piece{pieces === 1 ? "" : "s"}{o.bags?.length ? ` · Bag ${o.bags.map((b: any) => b.bagCode).join(", ")}` : ""}</p>
              {a.state && <p>Place of supply: {a.state}</p>}
            </div>
          </section>

          <table className="mt-5 w-full border-collapse text-[9pt]">
            <thead>
              <tr className="bg-slate-800 text-left text-white">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5">SAC</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5 text-right">Rate</th>
                <th className="px-2 py-1.5 text-right">Taxable</th>
                <th className="px-2 py-1.5 text-right">GST</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i: any, n: number) => (
                <tr key={i.id} className="border-b border-slate-200 align-top">
                  <td className="px-2 py-1.5">{n + 1}</td>
                  <td className="px-2 py-1.5">{i.garmentTypeName} — {i.serviceName}{i.colour ? <span className="text-slate-500"> · {i.colour}</span> : null}</td>
                  <td className="px-2 py-1.5">{billing.sacCode ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right">{i.quantity}</td>
                  <td className="px-2 py-1.5 text-right">{money(i.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right">{money(i.lineTotal - i.taxAmount)}</td>
                  <td className="px-2 py-1.5 text-right">{money(i.taxAmount)}<span className="block text-[7pt] text-slate-500">{i.taxBps / 100}%</span></td>
                  <td className="px-2 py-1.5 text-right font-semibold">{money(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="mt-4 grid grid-cols-[1fr_75mm] gap-6">
            <div className="space-y-3">
              <p className="text-[9pt]"><b>Amount in words:</b> {amountInWords(payable)}</p>
              {(showBank || showQr) && (
                <div className="flex items-start gap-4 rounded border border-slate-300 p-3">
                  {qr}
                  <div className="text-[9pt]">
                    {showQr && <><p className="font-bold">Scan to pay {money(balance)}</p><p>UPI: {billing.upi?.vpa}</p></>}
                    {showBank && (
                      <div className={showQr ? "mt-2" : ""}>
                        <p className="font-bold">Bank transfer</p>
                        <p>{billing.bank?.accountName}</p>
                        <p>{billing.bank?.bankName}{billing.bank?.branch ? `, ${billing.bank.branch}` : ""}</p>
                        <p>A/c no. {billing.bank?.accountNumber} · IFSC {billing.bank?.ifsc}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <dl className="space-y-1 text-[9.5pt]">
              <Row l="Subtotal" r={money(o.subtotal)} />
              {o.surchargeTotal > 0 && <Row l="Express charge" r={money(o.surchargeTotal)} />}
              {o.discountTotal > 0 && <Row l="Discount" r={`− ${money(o.discountTotal)}`} />}
              <Row l="CGST" r={money(half)} />
              <Row l="SGST" r={money(o.taxTotal - half)} />
              <Row l="Invoice total" r={money(o.grandTotal)} bold />
              {credits.map((c: any) => <Row key={c.id} l={`Credit note ${c.creditNoteNumber}`} r={`− ${money(c.totalAmount)}`} />)}
              {credits.length > 0 && <Row l="Amount payable" r={money(payable)} bold />}
              <Row l="Paid" r={money(o.invoice?.paid)} />
              <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-[11pt] font-bold"><dt>Balance due</dt><dd>{money(balance)}</dd></div>
              <p className="pt-1 text-right text-[8pt] text-slate-500">{balance > 0 ? "Payment due" : "Paid in full"} · {collected ? "Collected" : "Not yet collected"}</p>
            </dl>
          </section>

          <footer className="mt-8 grid grid-cols-[1fr_65mm] gap-6 text-[8.5pt]">
            <div>
              {billing.invoice?.terms && <><p className="font-bold">Terms & conditions</p><p className="whitespace-pre-line text-slate-700">{billing.invoice.terms}</p></>}
              {footer && <p className="mt-2 text-slate-700">{footer}</p>}
            </div>
            <div className="text-right">
              <p>For <b>{org.name}</b></p>
              <div className="h-14" />
              <p className="border-t border-slate-400 pt-1">{billing.invoice?.signatory || "Authorised signatory"}</p>
            </div>
          </footer>
          <p className="mt-6 text-center text-[7.5pt] text-slate-400">This is a computer-generated invoice.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <style>{`@page { size: 80mm auto; margin: 3mm } @media print { .receipt { border: none !important; box-shadow: none !important } }`}</style>
      {toolbar}
      <div className="receipt mx-auto bg-white p-3 font-mono text-[11px] leading-snug text-black shadow" style={{ width: "76mm" }}>
        <div className="text-center">
          {logo}
          <p className="text-sm font-bold">{org.name}</p>
          <p>{o.branch?.name}</p>
          {address && <p>{address}</p>}
          {phone && <p>Ph: {phone}</p>}
          {org.gstin && <p>GSTIN: {org.gstin}</p>}
          {billing.sacCode && <p>SAC: {billing.sacCode}</p>}
          <p className="mt-1 font-bold">{o.operationalStatus === "cancelled" ? "CANCELLED" : `${title} / ORDER RECEIPT`}</p>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p>Order: <b>{o.orderNumber}</b></p>
        <p>Invoice: {o.invoice?.invoiceNumber}</p>
        <p>Date: {dateTime(o.receivedAt)}</p>
        <p>Customer: {o.customer.name} {o.customer.phone ? `(${o.customer.phone})` : ""}</p>
        <p className="font-bold">Ready by: {dateTime(o.promisedAt)}{o.express ? " · EXPRESS" : ""}</p>
        <hr className="my-2 border-dashed border-black" />
        <table className="w-full">
          <thead>
            <tr className="text-left"><th>Item</th><th className="text-right">Qty</th><th className="text-right">Amt</th></tr>
          </thead>
          <tbody>
            {o.items.map((i: any) => (
              <tr key={i.id} className="align-top">
                <td>
                  {i.garmentTypeName}
                  <br />
                  <span className="text-[10px]">{i.serviceName} @{(i.unitPrice / 100).toFixed(2)}{i.conditionFlags?.length ? ` · ${i.conditionFlags.join(",").replace(/_/g, " ")}` : ""}</span>
                </td>
                <td className="text-right">{i.quantity}</td>
                <td className="text-right">{((i.lineTotal - i.taxAmount) / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr className="my-2 border-dashed border-black" />
        <Line l="Subtotal" r={money(o.subtotal)} />
        {o.surchargeTotal > 0 && <Line l="Express" r={money(o.surchargeTotal)} />}
        {o.discountTotal > 0 && <Line l="Discount" r={`-${money(o.discountTotal)}`} />}
        <Line l="CGST" r={money(Math.floor(o.taxTotal / 2))} />
        <Line l="SGST" r={money(o.taxTotal - Math.floor(o.taxTotal / 2))} />
        <Line l={o.invoice?.credits ? "INVOICE TOTAL" : "TOTAL"} r={money(o.grandTotal)} bold />
        {credits.map((c: any) => (
          <div key={c.id}>
            <Line l={`Discount (${c.creditNoteNumber})`} r={`-${money(c.totalAmount)}`} />
            {c.taxAmount > 0 && <p className="text-[10px]">incl. GST reduction {money(c.taxAmount)}</p>}
          </div>
        ))}
        {o.invoice?.credits > 0 && <Line l="AMOUNT PAYABLE" r={money(payable)} bold />}
        <Line l="Advance & payments" r={money(o.invoice?.paid)} />
        <Line l="BALANCE DUE" r={money(balance)} bold />
        {o.payments.map((p: any) => (
          <p key={p.id} className="text-[10px]">
            {dateTime(p.received_at)} {p.payment_method.toUpperCase()} {money(p.allocated_amount)}{p.status !== "succeeded" ? ` (${p.status === "pending" ? "awaiting verification" : p.status})` : ""}
          </p>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <p>Total pieces: {pieces}{o.bags?.length ? ` · Bag ${o.bags.map((b: any) => b.bagCode).join(", ")}` : ""}</p>
        <p>Status: {balance > 0 ? "Payment due" : "Paid"} · {collected ? "Collected" : "Not yet collected"}</p>
        {(showQr || showBank) && <hr className="my-2 border-dashed border-black" />}
        {showQr && (
          <div className="text-center">
            {qr}
            <p className="font-bold">Scan to pay {money(balance)}</p>
            <p className="text-[10px]">UPI: {billing.upi?.vpa}</p>
          </div>
        )}
        {showBank && (
          <div className="mt-1 text-[10px]">
            <p className="font-bold">Bank: {billing.bank?.bankName}</p>
            <p>{billing.bank?.accountName}</p>
            <p>A/c {billing.bank?.accountNumber} · IFSC {billing.bank?.ifsc}</p>
          </div>
        )}
        <hr className="my-2 border-dashed border-black" />
        {billing.invoice?.terms
          ? <p className="whitespace-pre-line text-[9.5px]">{billing.invoice.terms}</p>
          : <p className="text-[10px]">Pre-existing stains/damage noted at intake are the customer&apos;s responsibility. Please bring this receipt at collection.</p>}
        {footer && <p className="mt-1 text-center text-[10px]">{footer}</p>}
        {!footer && <p className="mt-2 text-center">Thank you!</p>}
      </div>
    </div>
  );
}

function Line({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "font-bold" : ""}`}><span>{l}</span><span>{r}</span></div>;
}
function Row({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}><dt>{l}</dt><dd className="tabular-nums">{r}</dd></div>;
}

export default function ReceiptPage() {
  return <Suspense><ReceiptPageInner /></Suspense>;
}
