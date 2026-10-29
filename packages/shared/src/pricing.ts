import { applyBps, type Minor } from "./money";

export interface PriceLineInput {
  unitPrice: Minor;
  quantity: number;
  /** Express / same-day surcharge in basis points applied to the base amount. */
  surchargeBps?: number;
  /** Order-level percentage discount in basis points. */
  discountBps?: number;
  /** Additional flat discount on this line. */
  discountFlat?: Minor;
  /** Tax rate in basis points (e.g. 1800 = 18% GST). Tax is exclusive. */
  taxBps?: number;
  minimumCharge?: Minor;
}

export interface PriceLine {
  base: Minor;
  surcharge: Minor;
  discount: Minor;
  taxable: Minor;
  tax: Minor;
  total: Minor;
}

export function priceLine(input: PriceLineInput): PriceLine {
  if (!Number.isInteger(input.unitPrice) || input.unitPrice < 0) throw new Error("unitPrice must be a non-negative integer");
  if (!(input.quantity > 0)) throw new Error("quantity must be positive");
  let base = Math.round(input.unitPrice * input.quantity);
  if (input.minimumCharge && base < input.minimumCharge) base = input.minimumCharge;
  const surcharge = applyBps(base, input.surchargeBps ?? 0);
  const gross = base + surcharge;
  const pctDiscount = applyBps(gross, input.discountBps ?? 0);
  const discount = Math.min(gross, pctDiscount + (input.discountFlat ?? 0));
  const taxable = gross - discount;
  const tax = applyBps(taxable, input.taxBps ?? 0);
  return { base, surcharge, discount, taxable, tax, total: taxable + tax };
}

export interface Totals {
  subtotal: Minor;
  surchargeTotal: Minor;
  discountTotal: Minor;
  taxTotal: Minor;
  grandTotal: Minor;
}

export function sumLines(lines: PriceLine[]): Totals {
  return lines.reduce<Totals>(
    (t, l) => ({
      subtotal: t.subtotal + l.base,
      surchargeTotal: t.surchargeTotal + l.surcharge,
      discountTotal: t.discountTotal + l.discount,
      taxTotal: t.taxTotal + l.tax,
      grandTotal: t.grandTotal + l.total,
    }),
    { subtotal: 0, surchargeTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0 },
  );
}

export type InvoicePaymentState = "unpaid" | "partially_paid" | "paid" | "cancelled";

/** Balance = total − (allocated payments − refunds). Not clamped, so an overpayment shows as negative. */
export function invoiceBalance(grandTotal: Minor, allocated: Minor, refunded: Minor): Minor {
  return grandTotal - (allocated - refunded);
}

export function invoiceState(grandTotal: Minor, allocated: Minor, refunded: Minor, cancelled = false): InvoicePaymentState {
  if (cancelled) return "cancelled";
  const paid = allocated - refunded;
  if (paid <= 0) return grandTotal === 0 ? "paid" : "unpaid";
  return paid >= grandTotal ? "paid" : "partially_paid";
}
