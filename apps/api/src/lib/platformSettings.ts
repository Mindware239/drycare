/** Software-owner settings: who DryCare invoices come from, how shops can pay, and payment gateway keys. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type DbOrTx } from "../db/client";
import { openSecret, secretHint } from "./secretBox";

const text = (max = 200) => z.string().trim().max(max).default("");
const gstinRe = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const sellerBillingSchema = z.object({
  legalName: text(),
  tradeName: text(),
  gstin: z.string().trim().toUpperCase().refine((v) => v === "" || gstinRe.test(v), "Enter a valid 15-character GSTIN").default(""),
  pan: z.string().trim().toUpperCase().refine((v) => v === "" || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "Enter a valid 10-character PAN").default(""),
  cin: text(30),
  addressLine1: text(),
  addressLine2: text(),
  city: text(80),
  state: text(80),
  pincode: z.string().trim().refine((v) => v === "" || /^[1-9][0-9]{5}$/.test(v), "Enter a 6-digit PIN code").default(""),
  country: z.string().trim().max(80).default("India"),
  email: z.union([z.literal(""), z.email()]).default(""),
  phone: text(30),
  website: text(120),
  bank: z.object({
    accountName: text(120),
    accountNumber: z.string().trim().regex(/^[0-9]{0,20}$/, "Account number can only contain digits").default(""),
    ifsc: z.string().trim().toUpperCase().refine((v) => v === "" || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Enter a valid 11-character IFSC").default(""),
    bankName: text(120),
    branch: text(120),
  }).default({ accountName: "", accountNumber: "", ifsc: "", bankName: "", branch: "" }),
  upiId: z.string().trim().refine((v) => v === "" || /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(v), "Enter a UPI ID like name@bank").default(""),
  upiPayeeName: text(80),
  invoice: z.object({
    prefix: z.string().trim().max(20).regex(/^[A-Za-z0-9/\-]*$/, "Use letters, numbers, / and - only").default("DC/"),
    nextNumber: z.number().int().min(1).max(99_999_999).default(1),
    sacCode: z.string().trim().regex(/^[0-9]{4,8}$/, "SAC code is 4–8 digits").default("997331"),
    gstRateBps: z.number().int().min(0).max(2800).default(1800),
    terms: text(2000),
    footer: text(500),
    signatory: text(120),
  }).default({ prefix: "DC/", nextNumber: 1, sacCode: "997331", gstRateBps: 1800, terms: "", footer: "", signatory: "" }),
});
export type SellerBilling = z.infer<typeof sellerBillingSchema>;

export const paymentMethodsSchema = z.object({
  upi: z.boolean().default(true),
  bankTransfer: z.boolean().default(true),
  cash: z.boolean().default(false),
  instructions: text(1000),
});

/** What is stored: secrets are sealed with secretBox. */
type StoredRazorpay = { enabled: boolean; mode: "test" | "live"; keyId: string; keySecret?: string; webhookSecret?: string; lastTest?: { at: string; ok: boolean; message: string } };
type StoredPayments = { methods: z.infer<typeof paymentMethodsSchema>; razorpay: StoredRazorpay };

const DEFAULT_PAYMENTS: StoredPayments = {
  methods: { upi: true, bankTransfer: true, cash: false, instructions: "" },
  razorpay: { enabled: false, mode: "test", keyId: "" },
};

async function read(tx: DbOrTx, key: string) {
  const row = await tx.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, key) });
  return row?.value;
}

export async function write(tx: DbOrTx, key: string, value: Record<string, unknown>, userId: string) {
  await tx.insert(schema.platformSettings).values({ key, value, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

export async function getSellerBilling(tx: DbOrTx): Promise<SellerBilling> {
  return sellerBillingSchema.parse((await read(tx, "seller_billing")) ?? {});
}

export async function getStoredPayments(tx: DbOrTx): Promise<StoredPayments> {
  const v = ((await read(tx, "payments")) ?? {}) as Partial<StoredPayments>;
  return { methods: paymentMethodsSchema.parse(v.methods ?? {}), razorpay: { ...DEFAULT_PAYMENTS.razorpay, ...(v.razorpay ?? {}) } };
}

/** Safe for the browser: never contains secret values, only whether they are set and their last 4 characters. */
export function paymentsView(p: StoredPayments) {
  const hint = (sealed?: string) => {
    if (!sealed) return null;
    try { return secretHint(openSecret(sealed)); } catch { return "unreadable"; }
  };
  const { keySecret, webhookSecret, ...razorpay } = p.razorpay;
  return {
    methods: p.methods,
    razorpay: { ...razorpay, keySecretHint: hint(keySecret), webhookSecretHint: hint(webhookSecret), ready: razorpayReady(p) },
  };
}

export const razorpayReady = (p: StoredPayments) => Boolean(p.razorpay.enabled && p.razorpay.keyId && p.razorpay.keySecret);

/** Server-side only: decrypted Razorpay credentials, or null when online payment is off or incomplete. */
export async function razorpayCredentials(tx: DbOrTx) {
  const p = await getStoredPayments(tx);
  if (!razorpayReady(p)) return null;
  return {
    mode: p.razorpay.mode,
    keyId: p.razorpay.keyId,
    keySecret: openSecret(p.razorpay.keySecret!),
    webhookSecret: p.razorpay.webhookSecret ? openSecret(p.razorpay.webhookSecret) : null,
  };
}

/** Whether the seller profile has what a GST tax invoice legally needs. */
export function billingGaps(s: SellerBilling) {
  const gaps: string[] = [];
  if (!s.legalName) gaps.push("legal business name");
  if (!s.addressLine1 || !s.city || !s.state || !s.pincode) gaps.push("registered address");
  if (!s.gstin && s.invoice.gstRateBps > 0) gaps.push("GSTIN (or set GST rate to 0% if not registered)");
  return gaps;
}

export type { StoredPayments };
