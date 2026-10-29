"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LAUNDRY_METHOD_LABELS, type LaundryPricingMethod } from "@drycare/shared";
import { useApi } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { Alert, Button, Spinner } from "@/components/ui";

/** 80 mm receipt for a self-service order: itemized charges, GST, payments and a QR to follow the machine. */
function Receipt() {
  const id = useSearchParams().get("id") ?? "";
  const { data: o, error } = useApi<any>(`/laundry/orders/${id}`);
  const session = useApi<any>("/auth/session");
  const [logoOk, setLogoOk] = useState(true);
  if (error) return <Alert>{error.message}</Alert>;
  if (!o || !session.data) return <Spinner />;
  const org = session.data.organization;
  const billing = org.settings?.billing ?? {};
  const half = Math.floor(o.taxTotal / 2);
  return (
    <div className="p-4">
      <style>{`@page { size: 80mm auto; margin: 3mm } @media print { .receipt { box-shadow: none !important } }`}</style>
      <div className="no-print mb-4 text-center"><Button onClick={() => window.print()}>Print receipt</Button></div>
      <div className="receipt mx-auto bg-white p-3 font-mono text-[11px] leading-snug text-black shadow" style={{ width: "76mm" }}>
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoOk && org.hasLogo && <img src="/api/v1/organizations/current/logo" alt="" onError={() => setLogoOk(false)} className="mx-auto mb-1 max-h-12 grayscale" />}
          <p className="text-sm font-bold">{org.name}</p>
          <p>{o.branch?.name}</p>
          {billing.phone && <p>Ph: {billing.phone}</p>}
          {org.gstin && <p>GSTIN: {org.gstin}</p>}
          <p className="mt-1 font-bold">SELF-SERVICE LAUNDRY RECEIPT</p>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p>Order: <b>{o.orderNumber}</b></p>
        <p>Date: {dateTime(o.createdAt)}</p>
        {(o.guestName || o.customer?.customerType !== "self_service_guest") && <p>Customer: {o.guestName ?? o.customer?.name}{o.guestPhone ? ` (${o.guestPhone})` : ""}</p>}
        <p>Service: {o.serviceName}</p>
        <p>Charged: {LAUNDRY_METHOD_LABELS[o.pricingMethod as LaundryPricingMethod]}</p>
        {o.weightGrams && <p>Weight: {(o.weightGrams / 1000).toFixed(2)} kg (billed {(o.billableGrams / 1000).toFixed(2)} kg)</p>}
        <hr className="my-2 border-dashed border-black" />
        {o.items.map((i: any) => <div key={i.id} className="flex justify-between gap-2"><span>{i.description}{o.pricingMethod === "item" ? ` x${i.quantity}` : ""}</span><span>{(i.amount / 100).toFixed(2)}</span></div>)}
        <hr className="my-2 border-dashed border-black" />
        <Line l="Subtotal" r={money(o.subtotal)} />
        {o.discountTotal > 0 && <Line l="Discount" r={`-${money(o.discountTotal)}`} />}
        <Line l={`CGST ${o.taxBps / 200}%`} r={money(half)} />
        <Line l={`SGST ${o.taxBps / 200}%`} r={money(o.taxTotal - half)} />
        <Line l="TOTAL" r={money(o.total)} bold />
        <Line l="Paid" r={money(o.paid)} />
        {o.refunded > 0 && <Line l="Refunded" r={money(o.refunded)} />}
        <Line l="DUE" r={money(o.balance)} bold />
        {o.payments.map((p: any) => <p key={p.id} className="text-[10px]">{dateTime(p.received_at)} {p.payment_method.toUpperCase()} {money(p.allocated_amount)}{p.status !== "succeeded" ? ` (${p.status})` : ""}</p>)}
        {o.sessions.filter((s: any) => s.status !== "cancelled").length > 0 && (
          <>
            <hr className="my-2 border-dashed border-black" />
            {o.sessions.filter((s: any) => s.status !== "cancelled").map((s: any) => <p key={s.id}>Machine: {s.machine_name} · {s.program_name ?? "Standard"} · ~{s.duration_minutes} min</p>)}
          </>
        )}
        <hr className="my-2 border-dashed border-black" />
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/v1/laundry/orders/${o.id}/status-qr`} alt="" className="mx-auto h-[30mm] w-[30mm]" />
          <p className="font-bold">Scan to follow your machine</p>
          <p className="mt-2 text-[10px]">Please collect your laundry promptly after the cycle ends. Staff will help with any machine problem.</p>
          {org.settings?.invoiceFooter && <p className="mt-1 text-[10px]">{org.settings.invoiceFooter}</p>}
        </div>
      </div>
    </div>
  );
}

function Line({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "font-bold" : ""}`}><span>{l}</span><span>{r}</span></div>;
}

export default function LaundryReceiptPage() {
  return <Suspense><Receipt /></Suspense>;
}
