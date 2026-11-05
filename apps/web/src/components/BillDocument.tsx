"use client";
import type { CSSProperties, ReactNode } from "react";
import { billPaperSize, type BillPaper, type BillSectionKey, type BillTemplate, type BillingProfile } from "@drycare/shared";
import { amountInWords, dateOnly, dateTime, money } from "@/lib/format";

export type BillOrg = { name: string; gstin?: string | null; hasLogo?: boolean; settings?: { billing?: Partial<BillingProfile>; invoiceFooter?: string } };
const FONTS = { sans: '"DM Sans", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", Consolas, monospace' };
const px = (t: BillTemplate, size: number) => `${(size * t.textSize) / 100}px`;

/** One bill, drawn from a template. The same drawing is used by the preview, the printer and Save as PDF. */
export function BillDocument({ template: t, order: o, org, logoSrc, qrSrc }: { template: BillTemplate; order: any; org: BillOrg; logoSrc?: string | null; qrSrc?: string | null }) {
  const { widthMm, heightMm } = billPaperSize(t);
  const narrow = widthMm < 100;
  const billing: Partial<BillingProfile> = org.settings?.billing ?? {};
  const a: any = billing.address ?? {};
  const branchAddr = o.branch?.address ?? {};
  const address = [a.line1, a.line2, a.city ?? branchAddr.city, a.state, a.pincode].filter(Boolean).join(", ") || [branchAddr.line1, branchAddr.city].filter(Boolean).join(", ");
  const phone = billing.phone || o.branch?.phone;
  const cancelled = o.operationalStatus === "cancelled";
  const pieces = o.garments.filter((g: any) => g.currentStatus !== "cancelled").length;
  const balance = Number(o.invoice?.balance ?? 0);
  const payable = Number(o.invoice?.payable ?? o.grandTotal);
  const paid = Number(o.invoice?.paid ?? 0);
  const credits = (o.creditNotes ?? []).filter((c: any) => c.status === "issued");
  const half = Math.floor(o.taxTotal / 2);
  const collected = o.garments.every((g: any) => g.currentStatus === "delivered" || g.currentStatus === "cancelled");
  const title = cancelled ? "CANCELLED" : t.title || billing.invoice?.title || "TAX INVOICE";
  const showQr = t.showUpiQr && billing.upi?.vpa && balance > 0 && !cancelled && qrSrc;
  const showBank = t.showBank && billing.bank?.accountNumber;
  const accent = t.accent;
  const muted = "#64748b";
  const rule: CSSProperties = narrow ? { borderTop: "1px dashed #000", margin: "6px 0" } : {};
  const label = (text: string) => <p style={{ fontSize: px(t, 10), fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: muted }}>{text}</p>;
  const logo = t.showLogo && logoSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoSrc} alt="" style={{ maxHeight: narrow ? "14mm" : "16mm", maxWidth: narrow ? "50mm" : "45mm", objectFit: "contain", filter: narrow ? "grayscale(1)" : undefined, margin: t.headerStyle === "centered" ? "0 auto 4px" : undefined, display: "block" }} />
  ) : null;
  const shopLines = (
    <>
      <p style={{ fontSize: px(t, narrow ? 14 : 21), fontWeight: 700, lineHeight: 1.2 }}>{org.name}</p>
      {narrow && o.branch?.name && <p>{o.branch.name}</p>}
      {address && <p>{address}</p>}
      {(phone || billing.email || billing.website) && <p>{[phone && `${narrow ? "Ph" : "Phone"}: ${phone}`, !narrow && billing.email, !narrow && billing.website].filter(Boolean).join(" · ")}</p>}
      {(org.gstin || billing.pan) && <p>{[org.gstin && `GSTIN: ${org.gstin}`, !narrow && billing.pan && `PAN: ${billing.pan}`].filter(Boolean).join(" · ")}</p>}
      {narrow && billing.sacCode && <p>SAC: {billing.sacCode}</p>}
    </>
  );
  const row = (l: ReactNode, r: ReactNode, strong?: boolean) => <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: strong ? 700 : 400 }}><span>{l}</span><span style={{ whiteSpace: "nowrap" }}>{r}</span></div>;

  const sections: Record<BillSectionKey, () => ReactNode> = {
    header: () => t.headerStyle === "band" ? (
      <header style={{ background: accent, color: "#fff", padding: "12px 14px", display: "flex", gap: 14, alignItems: "center", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>{logo}<div>{shopLines}</div></header>
    ) : t.headerStyle === "centered" ? (
      <header style={{ textAlign: "center" }}>{logo}{shopLines}</header>
    ) : (
      <header style={{ display: "flex", gap: 14, alignItems: "flex-start", borderBottom: `2px solid ${accent}`, paddingBottom: 10 }}>{logo}<div>{shopLines}</div></header>
    ),
    title: () => narrow ? (
      <div><p style={{ textAlign: "center", fontWeight: 700, marginTop: 4 }}>{title}</p><div style={rule} /><p>Order: <b>{o.orderNumber}</b></p><p>Bill no: {o.invoice?.invoiceNumber}</p><p>Date: {dateTime(o.receivedAt)}</p></div>
    ) : (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <p style={{ fontSize: px(t, 19), fontWeight: 700, letterSpacing: ".02em", color: accent }}>{title}</p>
        <div style={{ textAlign: "right" }}><p>Bill no: <b>{o.invoice?.invoiceNumber}</b></p><p>Date: {dateOnly(o.receivedAt)} · Order: {o.orderNumber}</p></div>
      </div>
    ),
    customer: () => narrow ? <p>Customer: {o.customer.name}{o.customer.phone ? ` (${o.customer.phone})` : ""}</p> : (
      <div>{label("Bill to")}<p style={{ fontWeight: 600 }}>{o.customer.name}</p>{o.customer.phone && <p>{o.customer.phone}</p>}{o.customer.email && <p>{o.customer.email}</p>}{o.customer.customerCode && <p style={{ color: muted }}>Customer ID {o.customer.customerCode}</p>}</div>
    ),
    service: () => narrow ? (
      <div><p style={{ fontWeight: 700 }}>Ready by: {dateTime(o.promisedAt)}{o.express ? " · EXPRESS" : ""}</p><p>Pieces: {pieces}{o.bags?.length ? ` · Bag ${o.bags.map((b: any) => b.scanCode ?? b.bagCode).join(", ")}` : ""}</p></div>
    ) : (
      <div style={{ textAlign: "right" }}>{label("Service details")}<p>Received {dateTime(o.receivedAt)}</p><p style={{ fontWeight: 600 }}>Ready by {dateTime(o.promisedAt)}{o.express ? " · EXPRESS" : ""}</p><p>{pieces} piece{pieces === 1 ? "" : "s"}{o.bags?.length ? ` · Bag ${o.bags.map((b: any) => b.bagCode).join(", ")}` : ""}</p>{a.state && <p>Place of supply: {a.state}</p>}</div>
    ),
    items: () => {
      const th: CSSProperties = narrow ? { textAlign: "right", fontWeight: 700 } : { padding: "6px 8px", textAlign: "right", color: "#fff", background: accent, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };
      const td: CSSProperties = narrow ? { textAlign: "right", verticalAlign: "top" } : { padding: "6px 8px", textAlign: "right", verticalAlign: "top", borderBottom: "1px solid #e2e8f0" };
      const c = t.columns;
      return (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: px(t, narrow ? 11 : 12) }}>
          <thead><tr>
            {!narrow && <th style={{ ...th, textAlign: "left" }}>#</th>}
            <th style={{ ...th, textAlign: "left" }}>{narrow ? "Item" : "Description"}</th>
            {!narrow && c.sac && <th style={{ ...th, textAlign: "left" }}>SAC</th>}
            <th style={th}>Qty</th>
            {!narrow && c.rate && <th style={th}>Rate</th>}
            {!narrow && c.taxable && <th style={th}>Taxable</th>}
            {!narrow && c.gst && <th style={th}>GST</th>}
            <th style={th}>{narrow ? "Amt" : "Amount"}</th>
          </tr></thead>
          <tbody>
            {o.items.map((i: any, n: number) => (
              <tr key={i.id}>
                {!narrow && <td style={{ ...td, textAlign: "left" }}>{n + 1}</td>}
                <td style={{ ...td, textAlign: "left" }}>
                  {i.garmentTypeName}{narrow ? <br /> : " — "}<span style={narrow ? { fontSize: px(t, 10) } : undefined}>{i.serviceName}{narrow && c.rate ? ` @${(i.unitPrice / 100).toFixed(2)}` : ""}</span>
                  {i.stainCharge > 0 && <span style={{ display: "block", fontSize: px(t, 10) }}>Includes stain treatment {money(i.stainCharge)}{i.quantity > 1 ? " each" : ""}</span>}
                  {c.colour && i.colour && <span style={{ color: narrow ? undefined : muted }}> · {i.colour}</span>}
                  {c.condition && i.conditionFlags?.length > 0 && <span style={{ fontSize: px(t, 10) }}> · {i.conditionFlags.join(", ").replace(/_/g, " ")}</span>}
                </td>
                {!narrow && c.sac && <td style={{ ...td, textAlign: "left" }}>{billing.sacCode ?? "—"}</td>}
                <td style={td}>{i.quantity}</td>
                {!narrow && c.rate && <td style={td}>{money(i.unitPrice)}</td>}
                {!narrow && c.taxable && <td style={td}>{money(i.lineTotal - i.taxAmount)}</td>}
                {!narrow && c.gst && <td style={td}>{money(i.taxAmount)}<span style={{ display: "block", fontSize: px(t, 9), color: muted }}>{i.taxBps / 100}%</span></td>}
                <td style={{ ...td, fontWeight: narrow ? 400 : 600 }}>{narrow ? (i.lineTotal / 100).toFixed(2) : money(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    totals: () => (
      <div style={narrow ? undefined : { marginLeft: "auto", width: "min(75mm, 100%)" }}>
        {row("Subtotal", money(o.subtotal))}
        {o.surchargeTotal > 0 && row("Express charge", money(o.surchargeTotal))}
        {o.discountTotal > 0 && row("Discount", `− ${money(o.discountTotal)}`)}
        {row("CGST", money(half))}
        {row("SGST", money(o.taxTotal - half))}
        {row("Bill total", money(o.grandTotal), true)}
        {credits.map((c: any) => <div key={c.id}>{row(`Credit note ${c.creditNoteNumber}`, `− ${money(c.totalAmount)}`)}</div>)}
        {credits.length > 0 && row("Amount payable", money(payable), true)}
        {row("Paid", money(paid))}
        <div style={{ borderTop: narrow ? undefined : `2px solid ${accent}`, marginTop: 3, paddingTop: 3, fontSize: px(t, narrow ? 12 : 15) }}>{row("Balance due", money(balance), true)}</div>
        <p style={{ fontSize: px(t, 10), textAlign: narrow ? "left" : "right", color: narrow ? undefined : muted }}>{balance > 0 ? "Payment due" : "Paid in full"} · {collected ? "Collected" : "Not yet collected"}</p>
      </div>
    ),
    words: () => <p><b>Amount in words:</b> {amountInWords(payable)}</p>,
    payments: () => (o.payments?.length ? <div>{narrow ? null : label("Payments received")}{o.payments.map((p: any) => <p key={p.id} style={{ fontSize: px(t, 10) }}>{dateTime(p.received_at)} {String(p.payment_method).toUpperCase()} {money(p.allocated_amount)}{p.status !== "succeeded" ? ` (${p.status === "pending" ? "awaiting verification" : p.status})` : ""}</p>)}</div> : null),
    payTo: () => (showQr || showBank ? (
      <div style={{ display: narrow ? "block" : "flex", gap: 14, border: narrow ? undefined : "1px solid #cbd5e1", padding: narrow ? 0 : 10, textAlign: narrow ? "center" : "left" }}>
        {showQr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrSrc!} alt="UPI payment QR" style={{ width: narrow ? "34mm" : "30mm", height: narrow ? "34mm" : "30mm", margin: narrow ? "0 auto" : undefined, display: "block" }} />
        )}
        <div style={{ fontSize: px(t, 11) }}>
          {showQr && <><p style={{ fontWeight: 700 }}>Scan to pay {money(balance)}</p><p>UPI: {billing.upi?.vpa}</p></>}
          {showBank && <div style={{ marginTop: showQr ? 6 : 0 }}><p style={{ fontWeight: 700 }}>Bank transfer</p><p>{billing.bank?.accountName}</p><p>{billing.bank?.bankName}{billing.bank?.branch ? `, ${billing.bank.branch}` : ""}</p><p>A/c {billing.bank?.accountNumber} · IFSC {billing.bank?.ifsc}</p></div>}
        </div>
      </div>
    ) : null),
    terms: () => (billing.invoice?.terms ? <div style={{ fontSize: px(t, 10) }}><p style={{ fontWeight: 700 }}>Terms &amp; conditions</p><p style={{ whiteSpace: "pre-line" }}>{billing.invoice.terms}</p></div> : narrow ? <p style={{ fontSize: px(t, 10) }}>Pre-existing stains or damage noted at intake are the customer&apos;s responsibility. Please bring this receipt at collection.</p> : null),
    message: () => <p style={{ textAlign: "center" }}>{org.settings?.invoiceFooter || "Thank you!"}</p>,
    signature: () => (
      <div style={{ marginLeft: "auto", width: "60mm", maxWidth: "100%", textAlign: "right", marginTop: 8 }}>
        <p>For <b>{org.name}</b></p><div style={{ height: 44 }} /><p style={{ borderTop: "1px solid #94a3b8", paddingTop: 4 }}>{billing.invoice?.signatory || "Authorised signatory"}</p>
      </div>
    ),
  };

  // On a page, two short sections side by side read better than two long rows.
  const shown = t.sections.filter((s) => s.show).map((s) => s.key);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < shown.length; i++) {
    const key = shown[i];
    const next = shown[i + 1];
    if (!narrow && key === "customer" && next === "service") {
      blocks.push(<div key={key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{sections.customer()}{sections.service()}</div>);
      i++;
      continue;
    }
    const body = sections[key]();
    if (body) blocks.push(<div key={key}>{narrow && i > 0 && !["title", "customer", "service"].includes(key) && <div style={rule} />}{body}</div>);
  }

  const style: CSSProperties = { width: `${widthMm}mm`, minHeight: heightMm ? `${heightMm}mm` : undefined, padding: `${t.marginMm}mm`, boxSizing: "border-box", background: "#fff", color: "#000", fontFamily: FONTS[t.font], fontSize: px(t, narrow ? 11 : 13), lineHeight: 1.35, display: "flex", flexDirection: "column", gap: narrow ? 2 : 12 };
  return (
    <div className="bill-sheet" style={style}>
      {t.topNote && <p style={{ textAlign: "center", whiteSpace: "pre-line" }}>{t.topNote}</p>}
      {blocks}
      {t.bottomNote && <p style={{ textAlign: "center", whiteSpace: "pre-line", fontSize: px(t, 11) }}>{t.bottomNote}</p>}
    </div>
  );
}

/**
 * Tells the browser the paper size, so the print dialog and Save as PDF match the template. A roll has no fixed
 * length and "auto" is not a valid size, so it is given the measured length of this bill.
 */
export function billPageCss(t: BillTemplate, measuredHeightMm?: number) {
  const { widthMm, heightMm } = billPaperSize(t);
  const length = heightMm || Math.ceil(measuredHeightMm ?? 297) + 1;
  return `@page { size: ${widthMm}mm ${length}mm; margin: 0 } @media print { html, body { background: #fff !important } .bill-sheet { box-shadow: none !important; margin: 0 !important; min-height: 0 !important } }`;
}

export const BILL_SAMPLE_ORDER = {
  id: "sample", orderNumber: "SHOP-2026-00123", operationalStatus: "in_processing", receivedAt: new Date().toISOString(), promisedAt: new Date(Date.now() + 2 * 864e5).toISOString(), express: false,
  subtotal: 80000, surchargeTotal: 0, discountTotal: 5000, taxTotal: 13500, grandTotal: 88500,
  invoice: { invoiceNumber: "INV/2026/000123", balance: 38500, payable: 88500, paid: 50000 },
  customer: { name: "Priya Mehta", phone: "+91 98200 11223", email: "priya@example.com", customerCode: "C-00042" },
  branch: { name: "Main Store", phone: "", address: {} },
  items: [
    { id: "1", garmentTypeName: "Suit (2 pc)", serviceName: "Dry clean", quantity: 1, unitPrice: 35000, lineTotal: 37170, taxAmount: 5670, taxBps: 1800, colour: "Navy", conditionFlags: [] },
    { id: "2", garmentTypeName: "Saree (silk)", serviceName: "Dry clean", quantity: 1, unitPrice: 30000, stainCharge: 4000, lineTotal: 31860, taxAmount: 4860, taxBps: 1800, colour: "", conditionFlags: ["stain"] },
    { id: "3", garmentTypeName: "Shirt", serviceName: "Wash & iron", quantity: 2, unitPrice: 7500, lineTotal: 19470, taxAmount: 2970, taxBps: 1800, colour: "White", conditionFlags: [] },
  ],
  garments: [{ currentStatus: "received" }, { currentStatus: "received" }, { currentStatus: "received" }, { currentStatus: "received" }],
  bags: [{ bagCode: "SHOP-2026-00123-B1", scanCode: "000321" }], creditNotes: [], payments: [{ id: "p1", received_at: new Date().toISOString(), payment_method: "cash", allocated_amount: 50000, status: "succeeded" }],
};

export type { BillPaper };
