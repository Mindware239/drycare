import { z } from "zod";
import { PROCESS_STAGES, GARMENT_STAGES } from "./workflow";

/** Request schemas shared by the API (validation) and the web app (form typing). */

const money = z.number().int().min(0);
const phone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{6,20}$/, "Invalid phone number");
const dutyDaySchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).refine((day) => {
  if (!day.enabled) return true;
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : -1;
  };
  return toMinutes(day.start) >= 0 && toMinutes(day.end) > toMinutes(day.start);
}, "Duty end time must be after start time");
const dutyScheduleSchema = z.partialRecord(
  z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
  dutyDaySchema,
);

export const signupSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  // Optional at signup: the server names the first branch "Main Store" and derives a short code for order numbers.
  branchName: z.string().trim().min(2).max(120).optional(),
  branchCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, "2–8 letters or digits")
    .optional(),
  phone: phone.optional(),
  city: z.string().trim().max(80).optional(),
  gstin: z.string().trim().max(20).optional(),
  state: z.string().trim().max(80).optional(),
  businessType: z.string().trim().max(80).optional(),
  outletCount: z.coerce.number().int().min(1).max(1000).default(1),
  counterCount: z.coerce.number().int().min(1).max(1000).default(1),
  acceptedTerms: z.literal(true, { error: "You must accept the terms and privacy policy" }),
  marketingConsent: z.boolean().default(false),
});

export const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(200),
  /** true: stay signed in for 30 days; false: until the browser closes; omitted: the normal session length. */
  remember: z.boolean().optional(),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  branchCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/),
  phone: phone.optional(),
  address: z.object({ line1: z.string().max(200).optional(), city: z.string().max(80).optional(), state: z.string().max(80).optional(), pincode: z.string().max(10).optional() }).optional(),
  timezone: z.string().default("Asia/Kolkata"),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  password: z.string().min(10).max(200),
  roleKey: z.string().min(2),
  branchIds: z.array(z.uuid()).default([]),
  phone: phone.optional(),
  address: z.object({
    line1: z.string().trim().max(200).optional(),
    locality: z.string().trim().max(120).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    pincode: z.string().trim().max(10).optional(),
  }).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  joiningDate: z.iso.date().optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: phone.optional(),
  monthlySalary: z.number().int().min(0).max(10_000_000_000).optional(),
  dutySchedule: dutyScheduleSchema.optional(),
});

export const staffProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phone.nullable().optional(),
  address: z.object({
    line1: z.string().trim().max(200),
    locality: z.string().trim().max(120),
    city: z.string().trim().max(80),
    state: z.string().trim().max(80),
    pincode: z.string().trim().max(10),
  }).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  joiningDate: z.iso.date().nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: phone.nullable().optional(),
  monthlySalary: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  dutySchedule: dutyScheduleSchema.nullable().optional(),
});

const clockTimeSchema = z.string().regex(/^\d{2}:\d{2}$/).refine((time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours < 24 && minutes < 60;
}, "Enter a valid local time");

export const staffAttendanceSchema = z.object({
  membershipId: z.uuid(),
  branchId: z.uuid(),
  workDate: z.iso.date(),
  status: z.enum(["present", "absent"]),
  checkIn: clockTimeSchema.nullable().optional(),
  checkOut: clockTimeSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).superRefine((entry, ctx) => {
  if (entry.status === "absent" && (entry.checkIn || entry.checkOut)) {
    ctx.addIssue({ code: "custom", path: ["checkIn"], message: "Absent staff cannot have check-in or check-out times" });
  }
  if (entry.checkIn && entry.checkOut && entry.checkOut <= entry.checkIn) {
    ctx.addIssue({ code: "custom", path: ["checkOut"], message: "Check-out time must be after check-in" });
  }
});

export const staffLeaveSchema = z.object({
  membershipId: z.uuid(),
  branchId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  reason: z.string().trim().max(500).nullable().optional(),
}).refine((leave) => leave.endDate >= leave.startDate, {
  path: ["endDate"],
  message: "Leave end date must be on or after its start date",
});

export const addressSchema = z.object({
  label: z.string().trim().max(40).default("Home"),
  line1: z.string().trim().max(200),
  locality: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
  isDefault: z.boolean().default(false),
});

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phone.nullable().optional().or(z.literal("").transform(() => null)),
  alternatePhone: phone.nullable().optional().or(z.literal("").transform(() => null)),
  email: z.email().nullable().optional().or(z.literal("").transform(() => null)),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/, "Enter a valid GSTIN").nullable().optional().or(z.literal("").transform(() => undefined)),
  customerType: z.enum(["walk_in", "regular", "vip", "corporate", "online"]).default("walk_in"),
  preferredLanguage: z.string().max(20).default("en"),
  careInstructions: z.string().max(1000).optional(),
  notificationChannel: z.enum(["sms", "whatsapp", "email", "none"]).default("whatsapp"),
  marketingConsent: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
  address: addressSchema.optional(),
});
export const customerUpdateSchema = customerSchema.partial().extend({ status: z.enum(["active", "inactive"]).optional() });

export const garmentTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(40).default("General"),
  active: z.boolean().default(true),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40).default("General"),
  serviceCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,12}$/),
  unitType: z.enum(["per_piece", "per_kg", "per_pair", "per_package"]).default("per_piece"),
  workflowStages: z.array(z.enum(PROCESS_STAGES as [string, ...string[]])).min(2),
  active: z.boolean().default(true),
});

export const servicePriceSchema = z.object({
  garmentTypeId: z.uuid(),
  serviceId: z.uuid(),
  unitPrice: money.min(1),
  taxBps: z.number().int().min(0).max(5000).default(1800),
  minimumCharge: money.optional(),
  effectiveFrom: z.iso.datetime().optional(),
});

export const priceListSchema = z.object({
  name: z.string().trim().min(1).max(80),
  branchId: z.uuid().nullable().default(null),
  effectiveFrom: z.iso.datetime().optional(),
});

export const orderItemInput = z.object({
  garmentTypeId: z.uuid(),
  serviceId: z.uuid(),
  quantity: z.number().int().min(1).max(200),
  colour: z.string().max(40).optional(),
  brand: z.string().max(60).optional(),
  fabric: z.string().max(60).optional(),
  conditionNotes: z.string().max(1000).optional(),
  conditionFlags: z.array(z.enum(["stain", "tear", "missing_button", "colour_fade", "shrinkage", "other"])).default([]),
  careInstructions: z.string().max(1000).optional(),
  specialCareApprovalRequired: z.boolean().default(false),
  specialCareReason: z.string().trim().min(3).max(300).optional(),
  discountFlat: money.default(0),
  /** Requires prices.override; reason is mandatory when set. */
  overrideUnitPrice: money.optional(),
  overrideReason: z.string().max(300).optional(),
}).superRefine((item, ctx) => {
  if (item.specialCareApprovalRequired && !item.specialCareReason) {
    ctx.addIssue({ code: "custom", path: ["specialCareReason"], message: "Give the customer-approval reason for special care" });
  }
});

/** store_credit = paid from the customer's prepaid DryCare wallet (not new money; the top-up was the receipt). */
export const PAYMENT_METHODS = ["cash", "upi", "card", "bank_transfer", "wallet", "other", "store_credit"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Ways the shop itself pays (expenses, refunds by hand): never the customer's wallet. */
export const SHOP_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) => m !== "store_credit") as Exclude<PaymentMethod, "store_credit">[];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", wallet: "Paytm / e-wallet", other: "Other", store_credit: "Customer wallet" };

export const paymentInput = z.object({
  amount: z.number().int().min(1),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().max(120).optional(),
  /** Bank transfers not yet seen in the bank account are recorded as pending and do not reduce the balance. */
  awaitingVerification: z.boolean().optional(),
});

export const orderCreateSchema = z.object({
  customerId: z.uuid(),
  branchId: z.uuid(),
  couponCode: z.string().trim().min(3).max(32).toUpperCase().optional(),
  orderSource: z.enum(["walk_in", "phone", "website", "pickup"]).default("walk_in"),
  promisedAt: z.iso.datetime(),
  express: z.boolean().default(false),
  discountBps: z.number().int().min(0).max(10000).default(0),
  notes: z.string().max(2000).optional(),
  deliveryMethod: z.enum(["counter", "home_delivery"]).default("counter"),
  items: z.array(orderItemInput).min(1).max(100),
  payments: z.array(paymentInput).max(4).default([]),
  /** Links garments collected on a completed pickup to this order. */
  pickupId: z.uuid().optional(),
});
export const orderQuoteSchema = orderCreateSchema.omit({ payments: true, promisedAt: true, pickupId: true }).extend({ promisedAt: z.iso.datetime().optional() });

export const transitionSchema = z.object({
  to: z.enum(GARMENT_STAGES),
  notes: z.string().max(1000).optional(),
});

export const inspectionSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  checklist: z.record(z.string(), z.boolean()).default({}),
  notes: z.string().max(1000).optional(),
  reworkReason: z.string().max(300).optional(),
});

export const storageAssignSchema = z.object({ storageLocationId: z.uuid() });

export const collectPaymentSchema = z.object({ payments: z.array(paymentInput).min(1).max(4) });

export const refundSchema = z.object({
  amount: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const customerApprovalConfirmationSchema = z.object({
  method: z.enum(["verbal", "signature"]),
  customerName: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(500).optional(),
}).superRefine((input, ctx) => {
  if (input.method === "verbal" && !input.notes?.trim()) {
    ctx.addIssue({ code: "custom", path: ["notes"], message: "Record how the customer gave verbal approval" });
  }
});

export const customerApprovalOtpRequestSchema = z.object({
  channel: z.enum(["email", "sms"]),
});

export const customerApprovalOtpVerifySchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
  customerName: z.string().trim().min(2).max(120),
});

export const handoverSchema = z.object({
  garmentIds: z.array(z.uuid()).min(1),
  method: z.enum(["counter", "otp", "signature"]).default("counter"),
  notes: z.string().max(500).optional(),
  allowWithBalance: z.boolean().default(false),
});

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const shiftOpenSchema = z.object({ branchId: z.uuid(), openingCash: money });
export const shiftCloseSchema = z.object({ countedCash: money, notes: z.string().max(500).optional() });

export const storageLocationSchema = z.object({ branchId: z.uuid(), code: z.string().trim().min(1).max(20), description: z.string().max(120).optional() });

export const expenseSchema = z.object({
  branchId: z.uuid(),
  category: z.string().trim().min(2).max(60),
  amount: z.number().int().min(1),
  method: z.enum(PAYMENT_METHODS).refine((m) => m !== "store_credit", "Expenses cannot be paid from a customer's wallet"),
  spentOn: z.iso.date(),
  description: z.string().max(500).optional(),
  vendor: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(80).optional(),
  /** Cash taken from the open shift's drawer; requires an open shift at the branch. */
  paidFromDrawer: z.boolean().optional(),
});
export const EXPENSE_CATEGORIES = ["Rent", "Electricity & water", "Salaries & wages", "Solvents & chemicals", "Detergents & consumables", "Packaging & hangers", "Machine maintenance", "Delivery & fuel", "Facility / outsourcing charges", "Marketing", "Office & stationery", "Taxes & fees", "Claims & compensation", "Other"] as const;

export const dateRangeQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  branchId: z.uuid().optional(),
});

export const marketingAudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("inactive"), inactiveDays: z.number().int().min(30).max(365) }),
]);

export const marketingCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(2).max(160),
  body: z.string().trim().min(5).max(3000),
  audience: marketingAudienceSchema,
  discountPercent: z.number().int().min(1).max(100).optional(),
  couponExpiresAt: z.iso.datetime().optional(),
  couponMaxRedemptions: z.number().int().min(1).max(100000).optional(),
  action: z.enum(["draft", "send", "schedule"]),
  scheduledAt: z.iso.datetime().optional(),
}).superRefine((campaign, ctx) => {
  if (campaign.action === "schedule" && !campaign.scheduledAt) {
    ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Choose a send date and time" });
  }
  if (campaign.action !== "schedule" && campaign.scheduledAt) {
    ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "A send date is only valid for a scheduled campaign" });
  }
  if (campaign.discountPercent !== undefined && !campaign.couponExpiresAt) {
    ctx.addIssue({ code: "custom", path: ["couponExpiresAt"], message: "A coupon expiry date is required when the campaign includes a discount" });
  }
  if (campaign.discountPercent === undefined && (campaign.couponExpiresAt !== undefined || campaign.couponMaxRedemptions !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["discountPercent"], message: "Coupon expiry and redemption limits require a discount" });
  }
  if (campaign.discountPercent !== undefined && !campaign.body.includes("{{coupon_code}}")) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Include {{coupon_code}} in the message so customers receive the redeemable offer code" });
  }
});

// ---------------------------------------------------------------- pickup & delivery

export const TIME_SLOTS = ["08:00-10:00", "10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00"] as const;

export const deliveryAddressSchema = z.object({
  line1: z.string().trim().min(3).max(200),
  locality: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
  landmark: z.string().trim().max(120).optional(),
});

export const deliveryCreateSchema = z
  .object({
    kind: z.enum(["pickup", "delivery"]),
    customerId: z.uuid(),
    branchId: z.uuid(),
    orderId: z.uuid().optional(),
    /** Delivery only: which ready garments go out. Defaults to every ready garment of the order. */
    garmentIds: z.array(z.uuid()).optional(),
    addressId: z.uuid().optional(),
    address: deliveryAddressSchema.optional(),
    contactPhone: z.string().trim().max(20).optional(),
    scheduledDate: z.iso.date(),
    timeSlot: z.enum(TIME_SLOTS),
    instructions: z.string().max(500).optional(),
    /** Delivery only: driver collects the outstanding balance on the doorstep. */
    collectOnDelivery: z.boolean().default(false),
    /** Delivery only: hand over on credit (needs orders.release_with_due). */
    onCredit: z.boolean().default(false),
  })
  .refine((v) => v.addressId || v.address, { message: "Choose a saved address or enter one", path: ["address"] })
  .refine((v) => v.kind === "pickup" || v.orderId, { message: "A delivery needs an order", path: ["orderId"] });

export const deliveryCompleteSchema = z.object({
  outcome: z.enum(["completed", "failed"]),
  method: z.enum(["otp", "signature", "in_person"]).optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
  receivedBy: z.string().trim().max(120).optional(),
  failureReason: z.enum(["customer_not_available", "address_not_found", "customer_refused", "payment_not_ready", "other"]).optional(),
  notes: z.string().max(500).optional(),
  bagCount: z.number().int().min(0).max(100).optional(),
  payments: z.array(paymentInput).max(2).default([]),
});

export const deliveryRescheduleSchema = z.object({ scheduledDate: z.iso.date(), timeSlot: z.enum(TIME_SLOTS), notes: z.string().max(300).optional() });

/** Tag / label printer layout. Printer choice and print density are set in the operating-system printer driver. */
export const labelSettingsSchema = z.object({
  garmentWidthMm: z.number().int().min(20).max(120).default(50),
  garmentHeightMm: z.number().int().min(15).max(120).default(25),
  bagWidthMm: z.number().int().min(30).max(150).default(75),
  bagHeightMm: z.number().int().min(25).max(150).default(50),
  barcode: z.enum(["code128", "qrcode"]).default("code128"),
  /** Printed customer detail. Tags travel to the facility, so a short form is the default. */
  customerOnTag: z.enum(["none", "first_name", "full_name"]).default("first_name"),
  showHumanReadable: z.boolean().default(true),
  showColour: z.boolean().default(true),
  copies: z.number().int().min(1).max(5).default(1),
});
export type LabelSettings = z.infer<typeof labelSettingsSchema>;
export const DEFAULT_LABEL_SETTINGS: LabelSettings = labelSettingsSchema.parse({});

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const optionalPattern = (re: RegExp, message: string) =>
  z.string().trim().toUpperCase().regex(re, message).optional().or(z.literal("").transform(() => undefined));

/**
 * What a store prints on its invoices: contact details, tax identifiers, where customers can pay
 * (bank / UPI) and invoice wording. Bank and UPI details are the store's own receiving accounts.
 */
export const billingProfileSchema = z.object({
  address: z.object({
    line1: optionalText(120),
    line2: optionalText(120),
    city: optionalText(60),
    state: optionalText(60),
    pincode: z.string().trim().regex(/^\d{6}$/, "PIN code must be 6 digits").optional().or(z.literal("").transform(() => undefined)),
  }).default({}),
  phone: optionalText(30),
  email: z.email().optional().or(z.literal("").transform(() => undefined)),
  website: optionalText(120),
  pan: optionalPattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F"),
  sacCode: z.string().trim().regex(/^\d{4,8}$/, "SAC code is 4–8 digits").optional().or(z.literal("").transform(() => undefined)),
  bank: z.object({
    accountName: optionalText(120),
    bankName: optionalText(120),
    accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Account number is 6–20 digits").optional().or(z.literal("").transform(() => undefined)),
    ifsc: optionalPattern(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234"),
    branch: optionalText(120),
  }).default({}),
  upi: z.object({
    vpa: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{2,64}$/, "UPI ID looks like shopname@okhdfcbank").optional().or(z.literal("").transform(() => undefined)),
    payeeName: optionalText(60),
  }).default({}),
  invoice: z.object({
    title: optionalText(40),
    terms: optionalText(1500),
    signatory: optionalText(80),
    paper: z.enum(["80mm", "a4", "a5"]).default("80mm"),
    showBank: z.boolean().default(true),
    showUpiQr: z.boolean().default(true),
    showLogo: z.boolean().default(true),
  }).default({ paper: "80mm", showBank: true, showUpiQr: true, showLogo: true }),
});
export type BillingProfile = z.infer<typeof billingProfileSchema>;
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
