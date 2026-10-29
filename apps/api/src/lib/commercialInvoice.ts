/** GST tax invoices for DryCare subscriptions (Mindware → shop). Issued once per paid subscription payment. */
import { eq, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "../db/client";
import { getSellerBilling, sellerBillingSchema } from "./platformSettings";

/** GST state codes (first two digits of a GSTIN). */
const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", punjab: "03", chandigarh: "04", uttarakhand: "05", haryana: "06", delhi: "07",
  rajasthan: "08", "uttar pradesh": "09", bihar: "10", sikkim: "11", "arunachal pradesh": "12", nagaland: "13", manipur: "14",
  mizoram: "15", tripura: "16", meghalaya: "17", assam: "18", "west bengal": "19", jharkhand: "20", odisha: "21", chhattisgarh: "22",
  "madhya pradesh": "23", gujarat: "24", "dadra and nagar haveli and daman and diu": "26", maharashtra: "27", karnataka: "29", goa: "30",
  lakshadweep: "31", kerala: "32", "tamil nadu": "33", puducherry: "34", "andaman and nicobar islands": "35", telangana: "36",
  "andhra pradesh": "37", ladakh: "38",
};

export function stateCode(gstin?: string | null, state?: string | null) {
  if (gstin && /^[0-9]{2}/.test(gstin)) return gstin.slice(0, 2);
  return state ? STATE_CODES[state.trim().toLowerCase()] ?? null : null;
}

/** What the shop must pay for a plan: the plan price, plus GST when the price excludes it. */
export function planGross(plan: { pricePaise: number; gstInclusive: boolean }, gstRateBps: number) {
  return plan.gstInclusive ? plan.pricePaise : plan.pricePaise + Math.round((plan.pricePaise * gstRateBps) / 10_000);
}

/** Splits an amount that includes GST into taxable value and tax (intra-state: CGST + SGST, otherwise IGST). */
export function splitGst(totalPaise: number, rateBps: number, intraState: boolean) {
  const subtotal = Math.round((totalPaise * 10_000) / (10_000 + rateBps));
  const tax = totalPaise - subtotal;
  if (!intraState) return { subtotal, cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { subtotal, cgst, sgst: tax - cgst, igst: 0 };
}

/** Issues the invoice for a paid subscription payment. Idempotent: returns the existing invoice if one exists. */
export async function issueCommercialInvoice(tx: DbOrTx, paymentId: string) {
  const existing = await tx.query.commercialInvoices.findFirst({ where: eq(schema.commercialInvoices.paymentId, paymentId) });
  if (existing) return existing;
  const payment = await tx.query.commercialPayments.findFirst({ where: eq(schema.commercialPayments.id, paymentId) });
  if (!payment || payment.status !== "paid") return null;
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, payment.organizationId) });
  if (!org) return null;
  const subscription = payment.subscriptionId ? await tx.query.commercialSubscriptions.findFirst({ where: eq(schema.commercialSubscriptions.id, payment.subscriptionId) }) : undefined;
  const plan = subscription ? await tx.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.id, subscription.planId) }) : undefined;

  // Lock the seller settings row so two invoices can never take the same number.
  await tx.execute(sql`insert into platform_settings (key, value_json) values ('seller_billing', '{}'::jsonb) on conflict (key) do nothing`);
  await tx.execute(sql`select 1 from platform_settings where key = 'seller_billing' for update`);
  const seller = await getSellerBilling(tx);
  const number = `${seller.invoice.prefix}${String(seller.invoice.nextNumber).padStart(5, "0")}`;
  await tx.update(schema.platformSettings)
    .set({ value: sellerBillingSchema.parse({ ...seller, invoice: { ...seller.invoice, nextNumber: seller.invoice.nextNumber + 1 } }) as Record<string, unknown> })
    .where(eq(schema.platformSettings.key, "seller_billing"));

  const billing = org.settings.billing;
  const buyerState = billing?.address?.state ?? org.settings.state ?? null;
  const sellerCode = stateCode(seller.gstin, seller.state);
  const buyerCode = stateCode(org.gstin, buyerState);
  const intraState = Boolean(sellerCode && buyerCode && sellerCode === buyerCode);
  const rate = seller.invoice.gstRateBps;
  const split = splitGst(payment.amountPaise, rate, intraState);
  const meta = payment.providerPayload as { periodStart?: string; periodEnd?: string };
  const periodStart = meta.periodStart ? new Date(meta.periodStart) : subscription?.startsAt ?? null;
  const periodEnd = meta.periodEnd ? new Date(meta.periodEnd) : subscription?.endsAt ?? null;
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(d) : "");

  const [invoice] = await tx.insert(schema.commercialInvoices).values({
    number,
    organizationId: org.id,
    paymentId: payment.id,
    subscriptionId: subscription?.id,
    planId: plan?.id,
    periodStart,
    periodEnd,
    currency: payment.currency,
    gstRateBps: rate,
    subtotalPaise: split.subtotal,
    cgstPaise: split.cgst,
    sgstPaise: split.sgst,
    igstPaise: split.igst,
    totalPaise: payment.amountPaise,
    seller: { ...seller, stateCode: sellerCode },
    buyer: {
      name: org.legalName || org.name,
      tradeName: org.name,
      gstin: org.gstin,
      address: billing?.address ?? {},
      state: buyerState,
      stateCode: buyerCode,
      email: billing?.email ?? null,
      phone: billing?.phone ?? null,
    },
    lines: [{
      description: `DryCare ${plan?.name ?? "subscription"}${periodStart && periodEnd ? ` · ${fmt(periodStart)} – ${fmt(periodEnd)}` : ""}`,
      sacCode: seller.invoice.sacCode,
      quantity: 1,
      taxablePaise: split.subtotal,
    }],
  }).returning();
  return invoice;
}
