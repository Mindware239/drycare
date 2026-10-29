"use client";
/** A4 GST tax invoice for a DryCare subscription (Mindware → shop). Printed from the super admin console and the shop's billing screen. */
import { amountInWords, money } from "@/lib/format";
import { cx } from "@/components/ui";

export type SubscriptionInvoiceData = {
  id: string;
  number: string;
  status: "issued" | "void";
  issuedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  gstRateBps: number;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  voidReason: string | null;
  seller: {
    legalName: string; tradeName: string; gstin: string; pan: string; cin: string; addressLine1: string; addressLine2: string; city: string; state: string; pincode: string;
    stateCode: string | null; email: string; phone: string; website: string;
    bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string; branch: string };
    upiId: string; invoice: { terms: string; footer: string; signatory: string };
  };
  buyer: { name: string; tradeName: string; gstin: string | null; address: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string }; state: string | null; stateCode: string | null; email: string | null; phone: string | null };
  lines: { description: string; sacCode: string; quantity: number; taxablePaise: number }[];
  payment: { provider: string; reference: string; paidAt: string } | null;
};

const date = (v: string | null) => (v ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(v)) : "—");
const PAID_VIA: Record<string, string> = { manual_upi: "UPI", manual_bank_transfer: "Bank transfer", manual_cash: "Cash", razorpay: "Online (Razorpay)" };

export function SubscriptionInvoice({ invoice: inv }: { invoice: SubscriptionInvoiceData }) {
  const s = inv.seller;
  const b = inv.buyer;
  const rate = inv.gstRateBps / 100;
  const intra = inv.igstPaise === 0 && inv.cgstPaise + inv.sgstPaise > 0;
  const addr = [b.address.line1, b.address.line2, [b.address.city, b.address.pincode].filter(Boolean).join(" "), b.state].filter(Boolean).join(", ");
  return (
    <article className="relative mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-[10pt] leading-relaxed text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      {inv.status === "void" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="-rotate-[24deg] rounded-xl border-8 border-red-500/40 px-10 py-2 text-[64pt] font-black tracking-widest text-red-500/30">VOID</span>
        </div>
      )}
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-4">
        <div>
          <p className="text-[16pt] font-bold leading-tight">{s.tradeName || s.legalName}</p>
          {s.tradeName && s.legalName && s.tradeName !== s.legalName && <p className="text-[9pt] text-slate-600">{s.legalName}</p>}
          <p className="mt-1 max-w-[95mm] text-[9pt] text-slate-600">{[s.addressLine1, s.addressLine2, `${s.city} ${s.pincode}`.trim(), s.state].filter(Boolean).join(", ")}</p>
          <p className="text-[9pt] text-slate-600">{[s.phone, s.email, s.website].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-[9pt]">{s.gstin && <><b>GSTIN</b> {s.gstin} · </>}{s.pan && <><b>PAN</b> {s.pan}</>}{s.cin && <> · <b>CIN</b> {s.cin}</>}</p>
        </div>
        <div className="text-right">
          <p className="text-[15pt] font-bold uppercase tracking-wide">Tax invoice</p>
          <table className="ml-auto mt-2 text-[9pt]">
            <tbody>
              <tr><td className="pr-3 text-slate-500">Invoice no.</td><td className="font-mono font-semibold">{inv.number}</td></tr>
              <tr><td className="pr-3 text-slate-500">Invoice date</td><td>{date(inv.issuedAt)}</td></tr>
              <tr><td className="pr-3 text-slate-500">Place of supply</td><td>{b.state ?? "—"}{b.stateCode ? ` (${b.stateCode})` : ""}</td></tr>
              <tr><td className="pr-3 text-slate-500">Reverse charge</td><td>No</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[8pt] font-semibold uppercase tracking-wider text-slate-500">Billed to</p>
          <p className="mt-1 font-semibold">{b.name}</p>
          {b.tradeName && b.tradeName !== b.name && <p className="text-[9pt]">{b.tradeName}</p>}
          {addr && <p className="text-[9pt] text-slate-600">{addr}</p>}
          <p className="text-[9pt]">{b.gstin ? <><b>GSTIN</b> {b.gstin}</> : "Unregistered (no GSTIN)"}</p>
          {(b.email || b.phone) && <p className="text-[9pt] text-slate-600">{[b.phone, b.email].filter(Boolean).join(" · ")}</p>}
        </div>
        <div>
          <p className="text-[8pt] font-semibold uppercase tracking-wider text-slate-500">Subscription period</p>
          <p className="mt-1">{date(inv.periodStart)} – {date(inv.periodEnd)}</p>
          {inv.payment && (
            <>
              <p className="mt-2 text-[8pt] font-semibold uppercase tracking-wider text-slate-500">Payment received</p>
              <p className="text-[9pt]">{PAID_VIA[inv.payment.provider] ?? inv.payment.provider} · <span className="font-mono">{inv.payment.reference}</span> · {date(inv.payment.paidAt)}</p>
            </>
          )}
        </div>
      </section>

      <table className="mt-5 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-y border-slate-900 bg-slate-50 text-left">
            <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5">SAC</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Taxable value</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="px-2 py-2 align-top">{i + 1}</td><td className="px-2 py-2">{l.description}</td><td className="px-2 py-2 font-mono">{l.sacCode}</td>
              <td className="px-2 py-2 text-right">{l.quantity}</td><td className="px-2 py-2 text-right tabular-nums">{money(l.taxablePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 flex justify-end">
        <table className="w-[80mm] text-[9pt]">
          <tbody>
            <tr><td className="py-0.5 text-slate-600">Taxable value</td><td className="text-right tabular-nums">{money(inv.subtotalPaise)}</td></tr>
            {intra ? (
              <>
                <tr><td className="py-0.5 text-slate-600">CGST @ {rate / 2}%</td><td className="text-right tabular-nums">{money(inv.cgstPaise)}</td></tr>
                <tr><td className="py-0.5 text-slate-600">SGST @ {rate / 2}%</td><td className="text-right tabular-nums">{money(inv.sgstPaise)}</td></tr>
              </>
            ) : (
              <tr><td className="py-0.5 text-slate-600">IGST @ {rate}%</td><td className="text-right tabular-nums">{money(inv.igstPaise)}</td></tr>
            )}
            <tr className="border-t-2 border-slate-900 text-[11pt] font-bold"><td className="pt-1.5">Total</td><td className="pt-1.5 text-right tabular-nums">{money(inv.totalPaise)}</td></tr>
            <tr><td colSpan={2} className="pt-1 text-right text-[8.5pt] font-semibold text-emerald-700">{inv.status === "void" ? "" : "Paid in full"}</td></tr>
          </tbody>
        </table>
      </section>
      <p className="mt-2 text-[9pt]"><b>Amount in words:</b> {amountInWords(inv.totalPaise)}</p>
      {inv.status === "void" && inv.voidReason && <p className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-[9pt] text-red-800"><b>Void:</b> {inv.voidReason}</p>}

      <footer className="mt-8 grid grid-cols-2 gap-6 border-t border-slate-200 pt-4 text-[8.5pt]">
        <div className="space-y-1 text-slate-600">
          {s.invoice.terms && <p className="whitespace-pre-line">{s.invoice.terms}</p>}
          {s.bank.accountNumber && <p><b className="text-slate-800">Bank:</b> {s.bank.accountName} · {s.bank.bankName} · A/c {s.bank.accountNumber} · IFSC {s.bank.ifsc}</p>}
          {s.upiId && <p><b className="text-slate-800">UPI:</b> {s.upiId}</p>}
          <p>This is a computer-generated invoice.</p>
        </div>
        <div className="flex flex-col items-end justify-end text-right">
          <p>For {s.legalName || s.tradeName}</p>
          <p className={cx("mt-10 border-t border-slate-400 pt-1", !s.invoice.signatory && "text-slate-500")}>{s.invoice.signatory || "Authorised signatory"}</p>
        </div>
      </footer>
      {s.invoice.footer && <p className="mt-4 text-center text-[8pt] text-slate-500">{s.invoice.footer}</p>}
    </article>
  );
}
