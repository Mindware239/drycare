/**
 * How a shop's bills look. Ready-made templates cover the common papers. A shop copies one, changes it and picks its
 * default. Every template prints or saves as PDF. WhatsApp and email use a message with the bill's details filled in.
 */
import { z } from "zod";

export const BILL_SECTIONS = {
  header: "Shop name, address and GSTIN",
  title: "Bill title and number",
  customer: "Customer",
  service: "Dates and pieces",
  items: "Items",
  totals: "Totals and tax",
  words: "Amount in words",
  payments: "Payments received",
  payTo: "Bank and UPI QR",
  terms: "Terms and conditions",
  message: "Your footer message",
  signature: "Signature",
} as const;
export type BillSectionKey = keyof typeof BILL_SECTIONS;
const SECTION_KEYS = Object.keys(BILL_SECTIONS) as [BillSectionKey, ...BillSectionKey[]];

export const BILL_PAPERS = {
  thermal80: { label: "80 mm thermal roll", widthMm: 80, heightMm: 0 },
  thermal58: { label: "58 mm thermal roll", widthMm: 58, heightMm: 0 },
  a4: { label: "A4 page", widthMm: 210, heightMm: 297 },
  a5: { label: "A5 page", widthMm: 148, heightMm: 210 },
  a5l: { label: "A5 landscape", widthMm: 210, heightMm: 148 },
  letter: { label: "Letter page", widthMm: 216, heightMm: 279 },
  custom: { label: "Custom size", widthMm: 100, heightMm: 150 },
} as const;
export type BillPaper = keyof typeof BILL_PAPERS;

export const billTemplateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(2, "Name the template").max(60),
  paper: z.enum(Object.keys(BILL_PAPERS) as [BillPaper, ...BillPaper[]]),
  /** Custom size only. A height of 0 grows with the bill, like a roll. */
  widthMm: z.number().min(40).max(420),
  heightMm: z.number().min(0).max(600),
  marginMm: z.number().min(0).max(30),
  /** Text size, as a percentage of normal. */
  textSize: z.number().int().min(70).max(150),
  font: z.enum(["sans", "serif", "mono"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour"),
  /** Band puts the shop heading on a coloured strip. */
  headerStyle: z.enum(["plain", "centered", "band"]),
  title: z.string().trim().max(60),
  sections: z.array(z.object({ key: z.enum(SECTION_KEYS), show: z.boolean() })).min(1).max(20),
  columns: z.object({ sac: z.boolean(), rate: z.boolean(), taxable: z.boolean(), gst: z.boolean(), colour: z.boolean(), condition: z.boolean() }),
  showLogo: z.boolean(),
  showBank: z.boolean(),
  showUpiQr: z.boolean(),
  /** Your own words, above the items and at the very end. */
  topNote: z.string().trim().max(400),
  bottomNote: z.string().trim().max(400),
});
export type BillTemplate = z.infer<typeof billTemplateSchema>;

export const billMessagesSchema = z.object({
  whatsapp: z.string().trim().min(1, "Write the WhatsApp message").max(2000),
  emailSubject: z.string().trim().min(1, "Write the email subject").max(200),
  emailBody: z.string().trim().min(1, "Write the email").max(5000),
});
export type BillMessages = z.infer<typeof billMessagesSchema>;

export const billTemplateSettingsSchema = z.object({
  templates: z.array(billTemplateSchema).max(50),
  defaultId: z.string().max(40).nullable(),
  messages: billMessagesSchema,
});
export type BillTemplateSettings = z.infer<typeof billTemplateSettingsSchema>;

const order = (keys: BillSectionKey[]) => [...keys.map((key) => ({ key, show: true })), ...SECTION_KEYS.filter((key) => !keys.includes(key)).map((key) => ({ key, show: false }))];
const ROLL = order(["header", "title", "customer", "service", "items", "totals", "payments", "payTo", "terms", "message"]);
const PAGE = order(["header", "title", "customer", "service", "items", "totals", "words", "payTo", "terms", "message", "signature"]);
const full = { sac: true, rate: true, taxable: true, gst: true, colour: true, condition: false };
const short = { sac: false, rate: true, taxable: false, gst: false, colour: false, condition: true };
const base = { title: "", showLogo: true, showBank: true, showUpiQr: true, topNote: "", bottomNote: "" };

export const BILL_PRESETS: BillTemplate[] = [
  { ...base, id: "preset-thermal-80", name: "Thermal receipt, 80 mm", paper: "thermal80", widthMm: 80, heightMm: 0, marginMm: 3, textSize: 100, font: "mono", accent: "#000000", headerStyle: "centered", sections: ROLL, columns: short },
  { ...base, id: "preset-thermal-58", name: "Thermal receipt, 58 mm", paper: "thermal58", widthMm: 58, heightMm: 0, marginMm: 2, textSize: 90, font: "mono", accent: "#000000", headerStyle: "centered", sections: order(["header", "title", "customer", "service", "items", "totals", "payTo", "message"]), columns: short, showBank: false },
  { ...base, id: "preset-a4-gst", name: "A4 GST invoice", paper: "a4", widthMm: 210, heightMm: 297, marginMm: 12, textSize: 100, font: "sans", accent: "#1e293b", headerStyle: "plain", sections: PAGE, columns: full },
  { ...base, id: "preset-a4-modern", name: "A4 modern, colour heading", paper: "a4", widthMm: 210, heightMm: 297, marginMm: 12, textSize: 100, font: "sans", accent: "#1f6b34", headerStyle: "band", sections: PAGE, columns: { ...full, sac: false } },
  { ...base, id: "preset-a4-simple", name: "A4 simple bill", paper: "a4", widthMm: 210, heightMm: 297, marginMm: 15, textSize: 110, font: "serif", accent: "#000000", headerStyle: "centered", title: "BILL", sections: order(["header", "title", "customer", "items", "totals", "message", "signature"]), columns: { ...short, condition: false } },
  { ...base, id: "preset-a5", name: "A5 invoice", paper: "a5", widthMm: 148, heightMm: 210, marginMm: 7, textSize: 85, font: "sans", accent: "#1e293b", headerStyle: "plain", sections: order(["header", "title", "customer", "service", "items", "totals", "payTo", "terms", "message"]), columns: { ...full, sac: false, taxable: false } },
  { ...base, id: "preset-a5-landscape", name: "A5 landscape invoice", paper: "a5l", widthMm: 210, heightMm: 148, marginMm: 7, textSize: 85, font: "sans", accent: "#1e293b", headerStyle: "plain", sections: order(["header", "title", "customer", "service", "items", "totals", "message"]), columns: { ...full, sac: false } },
  { ...base, id: "preset-letter", name: "Letter size invoice", paper: "letter", widthMm: 216, heightMm: 279, marginMm: 13, textSize: 100, font: "sans", accent: "#1e293b", headerStyle: "plain", sections: PAGE, columns: full },
];

export const DEFAULT_BILL_MESSAGES: BillMessages = {
  whatsapp: "Hello {{customer}},\nThank you for choosing {{shop}}.\n\nBill: {{invoice}}\nOrder: {{order}} ({{pieces}} pieces)\nItems: {{items}}\nTotal: {{total}}\nPaid: {{paid}}\nBalance: {{balance}}\nReady by: {{ready}}\n\nThank you!",
  emailSubject: "{{shop}}: bill {{invoice}} for order {{order}}",
  emailBody: "Hello {{customer}},\n\nThank you for choosing {{shop}}. Here is your bill.\n\nBill number: {{invoice}}\nOrder: {{order}}\nPieces: {{pieces}}\nItems: {{items}}\n\nTotal: {{total}}\nPaid: {{paid}}\nBalance due: {{balance}}\nReady by: {{ready}}\n\nThank you,\n{{shop}}\n{{shopPhone}}",
};

export const BILL_MESSAGE_FIELDS = {
  customer: "Customer name", shop: "Shop name", shopPhone: "Shop phone", invoice: "Bill number", order: "Order number", pieces: "Number of pieces", items: "Items",
  total: "Total", paid: "Paid", balance: "Balance due", ready: "Ready by", upi: "UPI ID",
} as const;
export type BillMessageField = keyof typeof BILL_MESSAGE_FIELDS;

/** Fills in a WhatsApp or email message. Anything it does not know is left out, so a typing slip never shows braces. */
export function renderBillMessage(text: string, values: Partial<Record<BillMessageField, string | number | null | undefined>>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => String(values[key as BillMessageField] ?? ""));
}

export const emptyBillSettings = (): BillTemplateSettings => ({ templates: [], defaultId: null, messages: DEFAULT_BILL_MESSAGES });

const LEGACY_PAPER: Record<string, string> = { "80mm": "preset-thermal-80", a4: "preset-a4-gst", a5: "preset-a5" };

/** Every template a shop can choose: the ready-made ones, then its own. */
export const allBillTemplates = (settings?: Partial<BillTemplateSettings> | null) => [...BILL_PRESETS, ...(settings?.templates ?? [])];

/** Which template to use: the one asked for, the shop's default, then the paper chosen before templates existed. */
export function chooseBillTemplate(settings: Partial<BillTemplateSettings> | null | undefined, legacyPaper?: string | null, asked?: string | null) {
  const all = allBillTemplates(settings);
  const find = (id?: string | null) => (id ? all.find((t) => t.id === id) : undefined);
  return find(asked) ?? find(asked ? LEGACY_PAPER[asked] : null) ?? find(settings?.defaultId) ?? find(legacyPaper ? LEGACY_PAPER[legacyPaper] : null) ?? BILL_PRESETS[0];
}

/** The real size to print at. Height 0 means it grows with the bill. */
export function billPaperSize(t: Pick<BillTemplate, "paper" | "widthMm" | "heightMm">) {
  if (t.paper === "custom") return { widthMm: t.widthMm, heightMm: t.heightMm };
  const { widthMm, heightMm } = BILL_PAPERS[t.paper];
  return { widthMm, heightMm };
}
