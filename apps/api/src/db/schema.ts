import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  customType,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Conventions (SRS §10.1): UUID keys, timestamptz, money as integer minor units (bigint),
 * explicit currency, organization_id on every tenant-owned row, append-only ledgers.
 */
const id = () => uuid("id").primaryKey().defaultRandom();
const orgId = () => uuid("organization_id").notNull().references(() => organizations.id);
const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ---------------------------------------------------------------- identity & tenancy

export const publicLeads = pgTable("public_leads", {
  id: id(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  city: text("city"),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("trial"), // trial | active | past_due | suspended | terminated
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  trialSource: text("trial_source"),
  defaultCurrency: text("default_currency").notNull().default("INR"),
  defaultTimezone: text("default_timezone").notNull().default("Asia/Kolkata"),
  gstin: text("gstin"),
  /** Business logo printed on invoices (PNG/JPEG/WebP, small). */
  logoData: bytea("logo_data"),
  logoMimeType: text("logo_mime_type"),
  settings: jsonb("settings_json").$type<OrgSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const commercialPlans = pgTable(
  "commercial_plans",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    pricePaise: integer("price_paise").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    interval: text("interval").notNull().default("month"),
    gstInclusive: boolean("gst_inclusive").notNull().default(false),
    trialEligible: boolean("trial_eligible").notNull().default(true),
    deviceLimit: integer("device_limit").notNull().default(1),
    branchLimit: integer("branch_limit").notNull().default(1),
    entitlements: jsonb("entitlements_json").$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
    published: boolean("published").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("commercial_plans_code_uq").on(t.code)],
);

export const commercialSubscriptions = pgTable(
  "commercial_subscriptions",
  {
    id: id(),
    organizationId: orgId(),
    planId: uuid("plan_id").notNull().references(() => commercialPlans.id),
    status: text("status").notNull().default("trial"), // trial | active | past_due | canceled | expired
    provider: text("provider").notNull().default("manual"),
    providerReference: text("provider_reference"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("commercial_subscriptions_org_idx").on(t.organizationId), index("commercial_subscriptions_status_idx").on(t.status)],
);

export interface OrgSettings {
  platformInternal?: boolean;
  /** Set on a cloud business that mirrors a shop PC: read-only in the cloud web, changed only by the PC's uploads. */
  syncSource?: "device";
  maxDiscountBpsWithoutApproval?: number;
  expressSurchargeBps?: number;
  defaultTurnaroundHours?: number;
  invoiceFooter?: string;
  requireFullPaymentBeforeHandover?: boolean;
  customerDuplicateMatch?: ("phone" | "email")[];
  labels?: import("@drycare/shared").LabelSettings;
  /** Name of the central processing facility shown on transfer batches. */
  facilityName?: string;
  /** Public pickup-booking page (/book?s=<slug>). */
  onlineBooking?: { enabled: boolean; branchId?: string; message?: string };
  billing?: import("@drycare/shared").BillingProfile;
  state?: string;
  businessType?: string;
  outletCount?: number;
  counterCount?: number;
}

export const commercialPayments = pgTable(
  "commercial_payments",
  {
    id: id(),
    organizationId: orgId(),
    subscriptionId: uuid("subscription_id").references(() => commercialSubscriptions.id),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull(),
    providerPayload: jsonb("provider_payload_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("commercial_payments_provider_ref_uq").on(t.provider, t.providerReference), index("commercial_payments_org_idx").on(t.organizationId)],
);

/** Software-owner (super admin) settings such as the seller billing profile and payment gateways. Secrets inside are encrypted. */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

/** GST tax invoices issued to shops for their DryCare subscription. One per paid subscription payment. */
export const commercialInvoices = pgTable(
  "commercial_invoices",
  {
    id: id(),
    number: text("number").notNull(),
    organizationId: orgId(),
    paymentId: uuid("payment_id").notNull().references(() => commercialPayments.id),
    subscriptionId: uuid("subscription_id").references(() => commercialSubscriptions.id),
    planId: uuid("plan_id").references(() => commercialPlans.id),
    status: text("status").notNull().default("issued"), // issued | void
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    currency: text("currency").notNull().default("INR"),
    gstRateBps: integer("gst_rate_bps").notNull(),
    subtotalPaise: integer("subtotal_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    seller: jsonb("seller_json").$type<Record<string, unknown>>().notNull(),
    buyer: jsonb("buyer_json").$type<Record<string, unknown>>().notNull(),
    lines: jsonb("lines_json").$type<Record<string, unknown>[]>().notNull(),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("commercial_invoices_number_uq").on(t.number),
    uniqueIndex("commercial_invoices_payment_uq").on(t.paymentId),
    index("commercial_invoices_org_idx").on(t.organizationId),
  ],
);

/**
 * Customer wallet (prepaid balance) ledger. Append-only: every top-up, spend, refund-back and adjustment is a row,
 * and balance_after is the running balance (customer row is locked while writing, so it cannot race).
 */
export const customerWalletEntries = pgTable(
  "customer_wallet_entries",
  {
    id: id(),
    organizationId: orgId(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    branchId: uuid("branch_id").references(() => branches.id),
    kind: text("kind").notNull(), // topup | spend | refund | adjust
    amount: integer("amount").notNull(), // + adds to the balance, − takes from it (paise)
    balanceAfter: integer("balance_after").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("wallet_entries_customer_idx").on(t.customerId, t.createdAt), index("wallet_entries_org_idx").on(t.organizationId)],
);

/** Offline activation keys issued for DryCare for Windows from the super admin console. */
export const desktopLicenses = pgTable(
  "desktop_licenses",
  {
    id: uuid("id").primaryKey(), // the licenseId inside the signed key
    organizationId: uuid("organization_id").references(() => organizations.id),
    customerName: text("customer_name").notNull(),
    plan: text("plan").notNull(),
    installationIds: jsonb("installation_ids_json").$type<string[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    key: text("license_key").notNull(),
    note: text("note"),
    issuedBy: uuid("issued_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("desktop_licenses_org_idx").on(t.organizationId), index("desktop_licenses_issued_idx").on(t.issuedAt)],
);

export const branches = pgTable(
  "branches",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    branchCode: text("branch_code").notNull(),
    address: jsonb("address_json").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("branches_org_code_uq").on(t.organizationId, t.branchCode)],
);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | suspended
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: orgId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    isSystem: boolean("is_system").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_org_key_uq").on(t.organizationId, t.key)],
);

export const memberships = pgTable(
  "organization_memberships",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    /** Empty array = access to all branches of the organization. */
    branchIds: uuid("branch_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId)],
);

export const staffProfiles = pgTable(
  "staff_profiles",
  {
    id: id(),
    organizationId: orgId(),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    phone: text("phone"),
    address: jsonb("address_json").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    jobTitle: text("job_title"),
    joiningDate: date("joining_date", { mode: "string" }),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    monthlySalary: bigint("monthly_salary", { mode: "number" }),
    dutySchedule: jsonb("duty_schedule_json").$type<Record<string, { enabled: boolean; start: string; end: string }>>().notNull().default(sql`'{}'::jsonb`),
    photoData: bytea("photo_data"),
    photoMimeType: text("photo_mime_type"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_profiles_membership_uq").on(t.membershipId),
    index("staff_profiles_org_idx").on(t.organizationId),
  ],
);

export const staffAttendance = pgTable(
  "staff_attendance",
  {
    id: id(),
    organizationId: orgId(),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    workDate: date("work_date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    note: text("note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_attendance_day_uq").on(t.organizationId, t.membershipId, t.branchId, t.workDate),
    index("staff_attendance_branch_date_idx").on(t.organizationId, t.branchId, t.workDate),
    check("staff_attendance_status_check", sql`${t.status} in ('present', 'absent')`),
    check("staff_attendance_times_check", sql`${t.status} = 'present' or (${t.checkIn} is null and ${t.checkOut} is null)`),
  ],
);

export const staffLeaves = pgTable(
  "staff_leaves",
  {
    id: id(),
    organizationId: orgId(),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    reason: text("reason"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("staff_leaves_org_dates_idx").on(t.organizationId, t.startDate, t.endDate),
    index("staff_leaves_membership_branch_idx").on(t.membershipId, t.branchId),
    check("staff_leaves_dates_check", sql`${t.startDate} <= ${t.endDate}`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the opaque cookie token
    userId: uuid("user_id").notNull().references(() => users.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    activeBranchId: uuid("active_branch_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- customers

export const customers = pgTable(
  "customers",
  {
    id: id(),
    organizationId: orgId(),
    customerCode: text("customer_code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    phoneNormalized: text("phone_normalized"),
    alternatePhone: text("alternate_phone"),
    email: text("email"),
    gstin: text("gstin"),
    customerType: text("customer_type").notNull().default("walk_in"),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    careInstructions: text("care_instructions"),
    notificationChannel: text("notification_channel").notNull().default("whatsapp"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    notes: text("notes"),
    status: text("status").notNull().default("active"), // active | inactive | merged
    mergedIntoId: uuid("merged_into_id"),
    homeBranchId: uuid("home_branch_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_org_code_uq").on(t.organizationId, t.customerCode),
    index("customers_org_phone_idx").on(t.organizationId, t.phoneNormalized),
    index("customers_org_name_idx").on(t.organizationId, t.name),
  ],
);

export const customerAddresses = pgTable("customer_addresses", {
  id: id(),
  organizationId: orgId(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  label: text("label").notNull().default("Home"),
  address: jsonb("address_json").$type<Record<string, string>>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- catalogue & pricing

export const garmentTypes = pgTable(
  "garment_types",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    category: text("category").notNull().default("General"),
    active: boolean("active").notNull().default(true),
    photoData: bytea("photo_data"),
    photoMimeType: text("photo_mime_type"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("garment_types_org_name_uq").on(t.organizationId, t.name)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    category: text("category").notNull().default("General"),
    serviceCode: text("service_code").notNull(),
    unitType: text("unit_type").notNull().default("per_piece"),
    /** Ordered workflow template for this service (received … ready). */
    workflowStages: text("workflow_stages").array().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("services_org_code_uq").on(t.organizationId, t.serviceCode)],
);

export const priceLists = pgTable("price_lists", {
  id: id(),
  organizationId: orgId(),
  branchId: uuid("branch_id").references(() => branches.id), // null = organization-wide
  name: text("name").notNull(),
  currency: text("currency").notNull().default("INR"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});

/** Prices are effective-dated rows; editing a price closes the old row and inserts a new one. */
export const servicePrices = pgTable(
  "service_prices",
  {
    id: id(),
    organizationId: orgId(),
    priceListId: uuid("price_list_id").notNull().references(() => priceLists.id),
    garmentTypeId: uuid("garment_type_id").notNull().references(() => garmentTypes.id),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    unitPrice: money("unit_price"),
    taxBps: integer("tax_bps").notNull().default(1800),
    minimumCharge: money("minimum_charge"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("service_prices_lookup_idx").on(t.organizationId, t.priceListId, t.garmentTypeId, t.serviceId)],
);

// ---------------------------------------------------------------- orders & garments

export const numberSequences = pgTable(
  "number_sequences",
  {
    id: id(),
    organizationId: orgId(),
    scope: text("scope").notNull(), // e.g. "order:MAIN:2026"
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [uniqueIndex("number_sequences_scope_uq").on(t.organizationId, t.scope)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    orderNumber: text("order_number").notNull(),
    orderSource: text("order_source").notNull().default("walk_in"),
    operationalStatus: text("operational_status").notNull().default("received"),
    deliveryMethod: text("delivery_method").notNull().default("counter"),
    express: boolean("express").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    promisedAt: timestamp("promised_at", { withTimezone: true }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    subtotal: money("subtotal"),
    surchargeTotal: money("surcharge_total"),
    discountTotal: money("discount_total"),
    taxTotal: money("tax_total"),
    grandTotal: money("grand_total"),
    discountBps: integer("discount_bps").notNull().default(0),
    couponId: uuid("coupon_id").references(() => marketingCoupons.id),
    currency: text("currency").notNull().default("INR"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_org_number_uq").on(t.organizationId, t.orderNumber),
    index("orders_org_status_idx").on(t.organizationId, t.operationalStatus),
    index("orders_org_promised_idx").on(t.organizationId, t.promisedAt),
    index("orders_customer_idx").on(t.customerId),
  ],
);

export const orderItems = pgTable("order_items", {
  id: id(),
  organizationId: orgId(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  garmentTypeId: uuid("garment_type_id").notNull().references(() => garmentTypes.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  servicePriceId: uuid("service_price_id"),
  /** Snapshots so later catalogue edits never change historical orders. */
  garmentTypeName: text("garment_type_name").notNull(),
  serviceName: text("service_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price"),
  listUnitPrice: money("list_unit_price"),
  overrideReason: text("override_reason"),
  surchargeAmount: money("surcharge_amount"),
  discountAmount: money("discount_amount"),
  taxBps: integer("tax_bps").notNull().default(0),
  taxAmount: money("tax_amount"),
  lineTotal: money("line_total"),
  colour: text("colour"),
  brand: text("brand"),
  fabric: text("fabric"),
  conditionNotes: text("condition_notes"),
  conditionFlags: text("condition_flags").array().notNull().default(sql`'{}'::text[]`),
  careInstructions: text("care_instructions"),
  createdAt: createdAt(),
});

export const customerApprovals = pgTable(
  "customer_approvals",
  {
    id: id(),
    organizationId: orgId(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id),
    trigger: text("approval_trigger").notNull(),
    reason: text("reason").notNull(),
    additionalCharge: money("additional_charge"),
    status: text("status").notNull().default("pending"),
    method: text("method"),
    customerName: text("customer_name"),
    witnessedBy: uuid("witnessed_by").references(() => users.id),
    notes: text("notes"),
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customer_approvals_item_trigger_uq").on(t.orderItemId, t.trigger),
    index("customer_approvals_order_status_idx").on(t.organizationId, t.orderId, t.status),
    check("customer_approvals_trigger_check", sql`${t.trigger} in ('additional_charge', 'special_care')`),
    check("customer_approvals_status_check", sql`${t.status} in ('pending', 'approved')`),
    check("customer_approvals_method_check", sql`${t.method} is null or ${t.method} in ('verbal', 'signature', 'email_otp', 'sms_otp')`),
  ],
);

export const storageLocations = pgTable(
  "storage_locations",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    code: text("code").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("storage_locations_branch_code_uq").on(t.branchId, t.code)],
);

export const garments = pgTable(
  "garments",
  {
    id: id(),
    organizationId: orgId(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id),
    tagCode: text("tag_code").notNull(),
    tagVersion: integer("tag_version").notNull().default(1),
    garmentTypeId: uuid("garment_type_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    workflowStages: text("workflow_stages").array().notNull(),
    currentStatus: text("current_status").notNull().default("received"),
    currentBranchId: uuid("current_branch_id").notNull(),
    storageLocationId: uuid("storage_location_id").references(() => storageLocations.id),
    /** Bag / packet the garment travels in. Every garment of an order belongs to exactly one bag. */
    bagId: uuid("bag_id"),
    /** Physical custody, tracked separately from the processing stage (see GARMENT_LOCATIONS). */
    location: text("location").notNull().default("shop_counter"),
    assignedUserId: uuid("assigned_user_id"),
    qcPassedAt: timestamp("qc_passed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("garments_org_tag_uq").on(t.organizationId, t.tagCode),
    index("garments_order_idx").on(t.orderId),
    index("garments_org_status_idx").on(t.organizationId, t.currentStatus),
  ],
);

// ---------------------------------------------------------------- bags, facility transfers & scans

/** A bag / packet holding garments of one order. Reprinting its label never creates a new bag. */
export const bags = pgTable(
  "bags",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    bagCode: text("bag_code").notNull(),
    expectedCount: integer("expected_count").notNull(),
    location: text("location").notNull().default("shop_counter"),
    labelPrintCount: integer("label_print_count").notNull().default(0),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("bags_org_code_uq").on(t.organizationId, t.bagCode), index("bags_order_idx").on(t.orderId)],
);

/**
 * A movement of bags between the shop and the processing facility. Shop → facility batches are
 * dispatched by the shop and received at the facility; facility → shop batches the reverse.
 */
export const transferBatches = pgTable(
  "transfer_batches",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    batchNumber: text("batch_number").notNull(),
    direction: text("direction").notNull(), // to_facility | to_shop
    facilityName: text("facility_name").notNull(),
    transportReference: text("transport_reference"),
    status: text("status").notNull().default("draft"), // draft | dispatched | received | received_with_exceptions
    notes: text("notes"),
    createdBy: uuid("created_by").notNull(),
    dispatchedBy: uuid("dispatched_by"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    receivedBy: uuid("received_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("transfer_batches_org_number_uq").on(t.organizationId, t.batchNumber),
    index("transfer_batches_org_status_idx").on(t.organizationId, t.status),
    check("transfer_batches_direction_check", sql`${t.direction} in ('to_facility', 'to_shop')`),
    check("transfer_batches_status_check", sql`${t.status} in ('draft', 'dispatched', 'received', 'received_with_exceptions')`),
  ],
);

export const transferBatchBags = pgTable(
  "transfer_batch_bags",
  {
    id: id(),
    organizationId: orgId(),
    batchId: uuid("batch_id").notNull().references(() => transferBatches.id),
    bagId: uuid("bag_id").notNull().references(() => bags.id),
    expectedCount: integer("expected_count").notNull(),
    addedBy: uuid("added_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("transfer_batch_bags_uq").on(t.batchId, t.bagId)],
);

/**
 * Every barcode scan at dispatch or receipt. A garment counts as verified in a batch step at most
 * once (unique index); repeat scans are stored with result "duplicate" for the record.
 */
export const scanEvents = pgTable(
  "scan_events",
  {
    id: id(),
    organizationId: orgId(),
    batchId: uuid("batch_id").references(() => transferBatches.id),
    step: text("step").notNull(), // dispatch | receipt
    scannedCode: text("scanned_code").notNull(),
    bagId: uuid("bag_id"),
    garmentId: uuid("garment_id"),
    result: text("result").notNull(), // verified | duplicate | unexpected | not_found
    scannedBy: uuid("scanned_by").notNull(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scan_events_batch_idx").on(t.batchId, t.step),
    uniqueIndex("scan_events_verified_uq").on(t.batchId, t.step, t.garmentId).where(sql`${t.result} = 'verified'`),
  ],
);

/** Missing, damaged, wrongly tagged or delayed garments found during transfers. */
export const garmentExceptions = pgTable(
  "garment_exceptions",
  {
    id: id(),
    organizationId: orgId(),
    garmentId: uuid("garment_id").notNull().references(() => garments.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    batchId: uuid("batch_id").references(() => transferBatches.id),
    kind: text("kind").notNull(), // missing | damaged | wrong_tag | delayed
    notes: text("notes"),
    status: text("status").notNull().default("open"), // open | resolved
    resolution: text("resolution"),
    createdBy: uuid("created_by").notNull(),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("garment_exceptions_org_status_idx").on(t.organizationId, t.status),
    index("garment_exceptions_order_idx").on(t.orderId),
    check("garment_exceptions_kind_check", sql`${t.kind} in ('missing', 'damaged', 'wrong_tag', 'delayed')`),
  ],
);

/** Label print requests. Browser printing cannot confirm paper output, so staff confirm the result. */
export const labelPrintJobs = pgTable(
  "label_print_jobs",
  {
    id: id(),
    organizationId: orgId(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    scope: text("scope").notNull(), // all | bag | garments
    labelCount: integer("label_count").notNull(),
    status: text("status").notNull().default("pending"), // pending | printed | failed
    error: text("error"),
    requestedBy: uuid("requested_by").notNull(),
    confirmedBy: uuid("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("label_print_jobs_order_idx").on(t.orderId), check("label_print_jobs_status_check", sql`${t.status} in ('pending', 'printed', 'failed')`)],
);

export const garmentStatusHistory = pgTable(
  "garment_status_history",
  {
    id: id(),
    organizationId: orgId(),
    garmentId: uuid("garment_id").notNull().references(() => garments.id),
    previousStatus: text("previous_status"),
    newStatus: text("new_status").notNull(),
    transitionKind: text("transition_kind").notNull(),
    previousLocation: text("previous_location"),
    newLocation: text("new_location"),
    actorUserId: uuid("actor_user_id").notNull(),
    branchId: uuid("branch_id"),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: text("correlation_id"),
  },
  (t) => [index("garment_history_garment_idx").on(t.garmentId, t.occurredAt)],
);

export const qualityInspections = pgTable("quality_inspections", {
  id: id(),
  organizationId: orgId(),
  garmentId: uuid("garment_id").notNull().references(() => garments.id),
  inspectorUserId: uuid("inspector_user_id").notNull(),
  outcome: text("outcome").notNull(), // pass | fail
  checklist: jsonb("checklist_json").$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const reworkRecords = pgTable("rework_records", {
  id: id(),
  organizationId: orgId(),
  garmentId: uuid("garment_id").notNull().references(() => garments.id),
  inspectionId: uuid("inspection_id").references(() => qualityInspections.id),
  reason: text("reason").notNull(),
  returnedTo: text("returned_to").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- billing & payments

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").notNull().default("issued"), // issued | cancelled
    currency: text("currency").notNull().default("INR"),
    subtotal: money("subtotal"),
    surchargeTotal: money("surcharge_total"),
    discountTotal: money("discount_total"),
    taxTotal: money("tax_total"),
    grandTotal: money("grand_total"),
    sellerGstin: text("seller_gstin"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoices_org_number_uq").on(t.organizationId, t.invoiceNumber), index("invoices_order_idx").on(t.orderId)],
);

export const invoiceItems = pgTable("invoice_items", {
  id: id(),
  organizationId: orgId(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  orderItemId: uuid("order_item_id"),
  descriptionSnapshot: text("description_snapshot").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price"),
  surchargeAmount: money("surcharge_amount"),
  discountAmount: money("discount_amount"),
  taxRateBpsSnapshot: integer("tax_rate_bps_snapshot").notNull(),
  taxAmount: money("tax_amount"),
  lineTotal: money("line_total"),
});

export const cashierShifts = pgTable("cashier_shifts", {
  id: id(),
  organizationId: orgId(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  userId: uuid("user_id").notNull(),
  status: text("status").notNull().default("open"),
  openingCash: money("opening_cash"),
  expectedCash: money("expected_cash"),
  countedCash: money("counted_cash"),
  difference: money("difference"),
  notes: text("notes"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

/**
 * Credit notes reduce an issued invoice (e.g. a discount agreed at collection) without editing it.
 * Balance = grand_total − issued credit notes − net payments. One collection discount per invoice.
 */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: id(),
    organizationId: orgId(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    creditNoteNumber: text("credit_note_number").notNull(),
    kind: text("kind").notNull().default("collection_discount"),
    discountType: text("discount_type").notNull(), // percent | fixed
    discountValue: integer("discount_value").notNull(), // bps for percent, paise for fixed
    taxableAmount: money("taxable_amount"),
    taxAmount: money("tax_amount"),
    totalAmount: money("total_amount"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("issued"),
    createdBy: uuid("created_by").notNull(),
    approvedBy: uuid("approved_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_notes_org_number_uq").on(t.organizationId, t.creditNoteNumber),
    uniqueIndex("credit_notes_one_discount_uq").on(t.invoiceId).where(sql`${t.kind} = 'collection_discount' and ${t.status} = 'issued'`),
    index("credit_notes_invoice_idx").on(t.invoiceId),
    check("credit_notes_type_check", sql`${t.discountType} in ('percent', 'fixed')`),
  ],
);

/** Append-only payment ledger. Corrections happen through refunds, never edits. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    paymentReference: text("payment_reference").notNull(),
    paymentMethod: text("payment_method").notNull(),
    amount: money("amount"),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("succeeded"), // pending | processing | succeeded | failed | cancelled
    providerReference: text("provider_reference"),
    shiftId: uuid("shift_id").references(() => cashierShifts.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_org_ref_uq").on(t.organizationId, t.paymentReference),
    index("payments_org_received_idx").on(t.organizationId, t.receivedAt),
    index("payments_provider_ref_idx").on(t.providerReference),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: id(),
    organizationId: orgId(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id),
    /** Exactly one of invoice (dry-cleaning order) or self-service laundry order. */
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    laundryOrderId: uuid("laundry_order_id").references(() => laundryOrders.id),
    allocatedAmount: money("allocated_amount"),
    createdAt: createdAt(),
  },
  (t) => [
    index("allocations_invoice_idx").on(t.invoiceId),
    index("allocations_laundry_order_idx").on(t.laundryOrderId),
    check("payment_allocations_target_check", sql`num_nonnulls(${t.invoiceId}, ${t.laundryOrderId}) = 1`),
  ],
);

export const refunds = pgTable("refunds", {
  id: id(),
  organizationId: orgId(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  /** Exactly one of invoice or self-service laundry order (enforced by a check constraint in the migration). */
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  laundryOrderId: uuid("laundry_order_id").references(() => laundryOrders.id),
  amount: money("amount"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("succeeded"),
  method: text("method").notNull(),
  approvedBy: uuid("approved_by").notNull(),
  providerReference: text("provider_reference"),
  shiftId: uuid("shift_id").references(() => cashierShifts.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- expenses

export const expenses = pgTable("expenses", {
  id: id(),
  organizationId: orgId(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  category: text("category").notNull(),
  amount: money("amount"),
  currency: text("currency").notNull().default("INR"),
  method: text("method").notNull(),
  spentOn: text("spent_on").notNull(),
  description: text("description"),
  vendor: text("vendor"),
  /** Bill / receipt number from the supplier. */
  reference: text("reference"),
  /** Set when cash was paid out of an open cashier shift's drawer; lowers that shift's expected cash. */
  shiftId: uuid("shift_id").references(() => cashierShifts.id),
  /** Expenses are never deleted; a mistaken entry is voided with a reason and drops out of totals. */
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: uuid("voided_by"),
  voidReason: text("void_reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- inventory & purchasing

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("suppliers_org_idx").on(t.organizationId)],
);

/** Consumables the shop buys and uses up. Stock on hand is never stored; it is the sum of movements per branch. */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: id(),
    organizationId: orgId(),
    itemCode: text("item_code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    /** Thousandths of a unit (1.5 L = 1500). */
    reorderLevelMilli: bigint("reorder_level_milli", { mode: "number" }).notNull().default(0),
    /** Latest purchase price per unit (paise), used to value stock. */
    lastUnitCost: money("last_unit_cost"),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => suppliers.id),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("inventory_items_org_code_uq").on(t.organizationId, t.itemCode), index("inventory_items_org_idx").on(t.organizationId)],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    poNumber: text("po_number").notNull(),
    status: text("status").notNull().default("draft"), // draft | ordered | partial | received | cancelled
    expectedOn: text("expected_on"),
    notes: text("notes"),
    subtotal: money("subtotal"),
    taxTotal: money("tax_total"),
    total: money("total"),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchase_orders_org_number_uq").on(t.organizationId, t.poNumber),
    index("purchase_orders_org_status_idx").on(t.organizationId, t.status),
    check("purchase_orders_status_check", sql`${t.status} in ('draft', 'ordered', 'partial', 'received', 'cancelled')`),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    organizationId: orgId(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    receivedMilli: bigint("received_milli", { mode: "number" }).notNull().default(0),
    unitCost: money("unit_cost"),
    taxBps: integer("tax_bps").notNull().default(0),
  },
  (t) => [index("purchase_order_lines_po_idx").on(t.purchaseOrderId), check("purchase_order_lines_qty_check", sql`${t.quantityMilli} > 0 and ${t.receivedMilli} >= 0`)],
);

/** Append-only stock ledger (guarded by a trigger). + adds to the shelf, − takes from it. */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),
    kind: text("kind").notNull(), // opening | purchase | use | wastage | count | return
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    unitCost: bigint("unit_cost", { mode: "number" }),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
    expenseId: uuid("expense_id").references(() => expenses.id),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_movements_item_idx").on(t.organizationId, t.itemId, t.branchId),
    index("inventory_movements_org_time_idx").on(t.organizationId, t.createdAt),
    check("inventory_movements_kind_check", sql`${t.kind} in ('opening', 'purchase', 'use', 'wastage', 'count', 'return')`),
  ],
);

// ---------------------------------------------------------------- customer claims

/** Damage, loss and service complaints, from report to decision to settlement. */
export const claims = pgTable(
  "claims",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    claimNumber: text("claim_number").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    orderId: uuid("order_id").references(() => orders.id),
    garmentId: uuid("garment_id").references(() => garments.id),
    exceptionId: uuid("exception_id").references(() => garmentExceptions.id),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    customerAsk: bigint("customer_ask", { mode: "number" }),
    status: text("status").notNull().default("open"), // open | investigating | approved | rejected | settled
    resolution: text("resolution"), // wallet_credit | cash | reclean | none
    approvedAmount: money("approved_amount"),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    settledBy: uuid("settled_by"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    walletEntryId: uuid("wallet_entry_id").references(() => customerWalletEntries.id),
    expenseId: uuid("expense_id").references(() => expenses.id),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("claims_org_number_uq").on(t.organizationId, t.claimNumber),
    index("claims_org_status_idx").on(t.organizationId, t.status),
    index("claims_customer_idx").on(t.customerId),
    index("claims_order_idx").on(t.orderId),
    check("claims_status_check", sql`${t.status} in ('open', 'investigating', 'approved', 'rejected', 'settled')`),
  ],
);

/** Append-only claim timeline (guarded by a trigger). */
export const claimEvents = pgTable(
  "claim_events",
  {
    id: id(),
    organizationId: orgId(),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    kind: text("kind").notNull(), // created | note | status | decision | settled
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    amount: bigint("amount", { mode: "number" }),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("claim_events_claim_idx").on(t.claimId, t.createdAt)],
);

// ---------------------------------------------------------------- local sync queue (desktop → cloud, phase 2)

/** Single row: whether change capture is on, this install's device id and cloud link state. */
export const syncConfig = pgTable(
  "sync_config",
  {
    id: integer("id").primaryKey().default(1),
    captureEnabled: boolean("capture_enabled").notNull().default(false),
    deviceId: uuid("device_id").notNull().defaultRandom(),
    /** Latest applied migration tag; copied into every event so the cloud can refuse newer schemas. */
    schemaVersion: text("schema_version").notNull().default("unknown"),
    cloudLinked: boolean("cloud_linked").notNull().default(false),
    /** not_linked | ok | offline | relink_required | plan_required | schema_too_new */
    cloudState: text("cloud_state").notNull().default("not_linked"),
    cloudUrl: text("cloud_url"),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: updatedAt(),
  },
  (t) => [check("sync_config_singleton", sql`${t.id} = 1`)],
);

/** Which tables are captured, and how the cloud must treat them (see docs/DESKTOP_CLOUD_PLAN.md). */
export const syncEntities = pgTable(
  "sync_entities",
  {
    tableName: text("table_name").primaryKey(),
    entityClass: text("entity_class").notNull(), // ledger | financial | operational | master
  },
  (t) => [check("sync_entities_class_check", sql`${t.entityClass} in ('ledger', 'financial', 'operational', 'master')`)],
);

/**
 * Change events written by a trigger in the same transaction as the business change.
 * Event `id` is stable and is the cloud's de-duplication key; `seq` is the local apply order.
 */
export const syncOutbox = pgTable(
  "sync_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    organizationId: uuid("organization_id"),
    branchId: uuid("branch_id"),
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    entityClass: text("entity_class").notNull(),
    op: text("op").notNull(), // insert | update | delete | snapshot (baseline copy made at linking: insert or update)
    rowData: jsonb("row_data"),
    schemaVersion: text("schema_version").notNull(),
    deviceId: uuid("device_id").notNull(),
    /** Database transaction id: events sharing it belong to one business operation and are applied together. */
    txid: bigint("txid", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"), // pending | sending | staged (part of a large change held by the cloud) | synced | failed | conflict | skipped
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sync_outbox_seq_uq").on(t.seq),
    uniqueIndex("sync_outbox_idem_uq").on(t.idempotencyKey),
    index("sync_outbox_due_idx").on(t.status, t.nextAttemptAt, t.seq),
    index("sync_outbox_entity_idx").on(t.entityTable, t.entityId),
    check("sync_outbox_op_check", sql`${t.op} in ('insert', 'update', 'delete', 'snapshot')`),
    check("sync_outbox_status_check", sql`${t.status} in ('pending', 'sending', 'staged', 'synced', 'failed', 'conflict', 'skipped')`),
  ],
);

/** A change the cloud refused because it would overwrite different data. Never resolved silently. */
export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: id(),
    organizationId: uuid("organization_id"),
    outboxId: uuid("outbox_id").notNull().references(() => syncOutbox.id),
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    entityClass: text("entity_class").notNull(),
    reason: text("reason").notNull(),
    localData: jsonb("local_data"),
    remoteData: jsonb("remote_data"),
    status: text("status").notNull().default("open"), // open | resolved
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("sync_conflicts_status_idx").on(t.status), index("sync_conflicts_entity_idx").on(t.entityTable, t.entityId)],
);

// ---------------------------------------------------------------- cloud side of sync (phase 3)

/**
 * A shop PC linked to a cloud business. At most one active device per organisation until per-branch
 * invoice numbering exists (phase 4), so two PCs can never issue the same invoice number offline.
 * Only hashes of device credentials are stored.
 */
export const syncDevices = pgTable(
  "sync_devices",
  {
    id: uuid("id").primaryKey(), // the PC's sync_config.device_id
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // active | revoked
    credentialHash: text("credential_hash").notNull(),
    credentialExpiresAt: timestamp("credential_expires_at", { withTimezone: true }).notNull(),
    /** After a rotation the previous credential keeps working briefly, in case the PC never received the new one. */
    previousCredentialHash: text("previous_credential_hash"),
    previousValidUntil: timestamp("previous_valid_until", { withTimezone: true }),
    linkedBy: uuid("linked_by").notNull(),
    appVersion: text("app_version"),
    schemaVersion: text("schema_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastPushAt: timestamp("last_push_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"),
    revokeReason: text("revoke_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sync_devices_one_active_per_org").on(t.organizationId).where(sql`${t.status} = 'active'`),
    check("sync_devices_status_check", sql`${t.status} in ('active', 'revoked')`),
  ],
);

/** Owner approval of a PC ("device authorisation"): the PC shows a code, the owner approves it in the cloud. */
export const syncLinkRequests = pgTable(
  "sync_link_requests",
  {
    id: id(),
    userCode: text("user_code").notNull(),
    pollTokenHash: text("poll_token_hash").notNull(),
    deviceId: uuid("device_id").notNull(),
    deviceName: text("device_name").notNull(),
    /** What the PC says it is. Only trusted after the owner approves it. */
    shop: jsonb("shop_json").$type<{ organizationId: string; organizationName: string; branchId: string; branchName: string; branchCode: string; gstin?: string | null }>().notNull(),
    appVersion: text("app_version"),
    schemaVersion: text("schema_version"),
    status: text("status").notNull().default("pending"), // pending | approved | denied | consumed | expired
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdIp: text("created_ip"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sync_link_requests_code_uq").on(t.userCode), check("sync_link_requests_status_check", sql`${t.status} in ('pending', 'approved', 'denied', 'consumed', 'expired')`)],
);

/** Every event the cloud has committed, so a replayed event is recognised; no row data is kept here. */
export const syncAppliedEvents = pgTable(
  "sync_applied_events",
  {
    eventId: uuid("event_id").primaryKey(),
    deviceId: uuid("device_id").notNull().references(() => syncDevices.id),
    organizationId: orgId(),
    payloadHash: text("payload_hash").notNull(),
    outcome: text("outcome").notNull(), // applied | stale
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    batchId: uuid("batch_id").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_applied_events_device_idx").on(t.deviceId, t.seq)],
);

/** Last change applied to each record, to refuse out-of-order updates and spot changes made outside sync. */
export const syncEntityState = pgTable(
  "sync_entity_state",
  {
    organizationId: orgId(),
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull(),
    rowHash: text("row_hash").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.entityTable, t.entityId] })],
);

/**
 * Parts of one large PC change (more events than fit in one upload) held until the last part arrives, then applied
 * together in one transaction, so a partly uploaded sale is never visible. Rows are deleted once the change is settled.
 */
export const syncStagedEvents = pgTable(
  "sync_staged_events",
  {
    eventId: uuid("event_id").primaryKey(),
    deviceId: uuid("device_id").notNull().references(() => syncDevices.id),
    organizationId: orgId(),
    txid: bigint("txid", { mode: "number" }).notNull(),
    groupSize: integer("group_size").notNull(),
    event: jsonb("event_json").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_staged_events_group_idx").on(t.deviceId, t.txid)],
);

/** One row per push (audit and support). Counts only — never payloads. */
export const syncBatches = pgTable(
  "sync_batches",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id").notNull().references(() => syncDevices.id),
    organizationId: orgId(),
    eventCount: integer("event_count").notNull(),
    applied: integer("applied").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    stale: integer("stale").notNull().default(0),
    conflicts: integer("conflicts").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    retryable: integer("retryable").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_batches_device_idx").on(t.deviceId, t.receivedAt)],
);

/** Conflicts and refusals seen by the cloud: metadata and hashes only, for investigation. */
export const syncRemoteConflicts = pgTable(
  "sync_remote_conflicts",
  {
    id: id(),
    organizationId: orgId(),
    deviceId: uuid("device_id").notNull(),
    eventId: uuid("event_id").notNull(),
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    code: text("code").notNull(),
    reason: text("reason").notNull(),
    incomingHash: text("incoming_hash").notNull(),
    existingHash: text("existing_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("sync_remote_conflicts_org_idx").on(t.organizationId, t.createdAt)],
);

/** PC staff copied to the cloud as non-login users (names for reports, links for staff records). */
export const syncShadowUsers = pgTable("sync_shadow_users", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  organizationId: orgId(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- reliability & audit

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: id(),
    organizationId: orgId(),
    key: text("key").notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    response: jsonb("response_json"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_org_key_route_uq").on(t.organizationId, t.key, t.route)],
);

/** Transactional outbox: written in the same DB transaction as the business change. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    organizationId: orgId(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending | processed | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_pending_idx").on(t.status, t.availableAt)],
);

export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    audience: jsonb("audience").notNull(),
    couponCode: text("coupon_code"),
    discountBps: integer("discount_bps"),
    couponExpiresAt: timestamp("coupon_expires_at", { withTimezone: true }),
    couponMaxRedemptions: integer("coupon_max_redemptions"),
    status: text("status").notNull().default("draft"), // draft | scheduled | processing | sending | sent | failed | cancelled
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    recipientCount: integer("recipient_count"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("marketing_campaigns_org_status_idx").on(t.organizationId, t.status, t.scheduledAt),
  ],
);

export const marketingCoupons = pgTable(
  "marketing_coupons",
  {
    id: id(),
    organizationId: orgId(),
    campaignId: uuid("campaign_id").notNull().references(() => marketingCampaigns.id),
    code: text("code").notNull(),
    discountBps: integer("discount_bps").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxRedemptions: integer("max_redemptions"),
    minimumOrderValue: money("minimum_order_value").notNull().default(0),
    firstOrderOnly: boolean("first_order_only").notNull().default(false),
    status: text("status").notNull().default("active"), // active | disabled
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("marketing_coupons_org_code_uq").on(t.organizationId, t.code),
    uniqueIndex("marketing_coupons_campaign_uq").on(t.campaignId),
    index("marketing_coupons_org_status_idx").on(t.organizationId, t.status, t.expiresAt),
  ],
);

export const marketingCouponRedemptions = pgTable(
  "marketing_coupon_redemptions",
  {
    id: id(),
    organizationId: orgId(),
    couponId: uuid("coupon_id").notNull().references(() => marketingCoupons.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketing_coupon_redemptions_customer_uq").on(t.couponId, t.customerId),
    uniqueIndex("marketing_coupon_redemptions_order_uq").on(t.orderId),
    index("marketing_coupon_redemptions_org_coupon_idx").on(t.organizationId, t.couponId),
  ],
);

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: id(),
    organizationId: orgId(),
    customerId: uuid("customer_id"),
    campaignId: uuid("campaign_id").references(() => marketingCampaigns.id),
    customerApprovalId: uuid("customer_approval_id").references(() => customerApprovals.id),
    eventType: text("event_type").notNull(),
    channel: text("channel").notNull(),
    recipient: text("recipient"),
    subject: text("subject"),
    body: text("body").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("queued"), // queued | sent | failed | skipped
    attempts: integer("attempts").notNull().default(0),
    providerResponse: jsonb("provider_response"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notification_jobs_dedupe_uq").on(t.organizationId, t.dedupeKey),
    index("notification_jobs_campaign_idx").on(t.campaignId, t.status),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id"),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    before: jsonb("before_json"),
    after: jsonb("after_json"),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)],
);

// ---------------------------------------------------------------- pickup & delivery (FR-DEL)

export const deliveries = pgTable(
  "pickup_deliveries",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    /** Delivery: the order being returned. Pickup: set once the collected garments are booked. */
    orderId: uuid("order_id").references(() => orders.id),
    kind: text("kind").notNull(), // pickup | delivery
    status: text("status").notNull().default("scheduled"), // scheduled | assigned | out | completed | failed | cancelled
    address: jsonb("address_json").$type<Record<string, string>>().notNull(),
    contactPhone: text("contact_phone"),
    scheduledDate: text("scheduled_date").notNull(),
    timeSlot: text("time_slot").notNull(),
    instructions: text("instructions"),
    driverUserId: uuid("driver_user_id"),
    /** Delivery OTP is stored hashed; the customer receives it by message. */
    otpHash: text("otp_hash"),
    collectAmount: money("collect_amount"),
    bagCount: integer("bag_count"),
    confirmationMethod: text("confirmation_method"),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deliveries_org_date_idx").on(t.organizationId, t.scheduledDate), index("deliveries_driver_idx").on(t.driverUserId, t.scheduledDate)],
);

export const deliveryItems = pgTable("delivery_items", {
  id: id(),
  organizationId: orgId(),
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
  garmentId: uuid("garment_id").notNull().references(() => garments.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

/** Append-only timeline of every delivery action (FR-DEL-004/005). */
export const deliveryEvents = pgTable("delivery_events", {
  id: id(),
  organizationId: orgId(),
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
  event: text("event").notNull(),
  notes: text("notes"),
  actorUserId: uuid("actor_user_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- one-time links (FR-AUTH-004 / 008)

/** Password-reset and staff-invitation links. Only a hash of the token is stored; links are single-use and expire. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    purpose: text("purpose").notNull(), // password_reset | invitation
    tokenHash: text("token_hash").notNull().unique(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id),
    email: text("email").notNull(),
    payload: jsonb("payload").$type<{ name?: string; roleKey?: string; branchIds?: string[]; otpHash?: string; attempts?: number }>().notNull().default(sql`'{}'::jsonb`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_org_purpose_idx").on(t.organizationId, t.purpose)],
);


// ---------------------------------------------------------------- self-service laundry module
// Independent of the dry-cleaning order flow: own services, pricing, machines and orders. Payments
// reuse the shared ledger (payments + payment_allocations.laundry_order_id) so cash shifts and
// collection reports include self-service takings.

export const laundryServices = pgTable(
  "laundry_services",
  {
    id: id(),
    organizationId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Which machine types the service needs, in order: e.g. ["washer","dryer"]. */
    machineTypes: text("machine_types").array().notNull().default(sql`'{}'::text[]`),
    taxBps: integer("tax_bps").notNull().default(1800),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("laundry_services_org_code_uq").on(t.organizationId, t.code)],
);

/** One row per service + pricing method (+ optional branch override). Money in paise, weight in grams. */
export const laundryPricingRules = pgTable(
  "laundry_pricing_rules",
  {
    id: id(),
    organizationId: orgId(),
    serviceId: uuid("service_id").notNull().references(() => laundryServices.id),
    branchId: uuid("branch_id").references(() => branches.id),
    method: text("method").notNull(), // weight | item | cycle | time | package
    enabled: boolean("enabled").notNull().default(true),
    unitPrice: money("unit_price"), // per kg | per cycle | per minute | package price (item uses item rates)
    minWeightGrams: integer("min_weight_grams").notNull().default(0),
    weightIncrementGrams: integer("weight_increment_grams").notNull().default(100),
    minMinutes: integer("min_minutes").notNull().default(0),
    minimumCharge: money("minimum_charge"),
    packageLabel: text("package_label"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("laundry_pricing_rules_uq").on(t.serviceId, t.method, t.branchId).where(sql`${t.branchId} is not null`),
    uniqueIndex("laundry_pricing_rules_default_uq").on(t.serviceId, t.method).where(sql`${t.branchId} is null`),
    check("laundry_pricing_rules_method_check", sql`${t.method} in ('weight', 'item', 'cycle', 'time', 'package')`),
  ],
);

export const laundryItemRates = pgTable(
  "laundry_item_rates",
  {
    id: id(),
    organizationId: orgId(),
    serviceId: uuid("service_id").notNull().references(() => laundryServices.id),
    name: text("name").notNull(),
    unitPrice: money("unit_price"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("laundry_item_rates_uq").on(t.serviceId, t.name)],
);

export const laundryMachines = pgTable(
  "laundry_machines",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    machineType: text("machine_type").notNull(), // washer | dryer | iron_station
    capacityGrams: integer("capacity_grams"),
    /** available | reserved | running | completed | out_of_service | maintenance */
    status: text("status").notNull().default("available"),
    controlMode: text("control_mode").notNull().default("manual"), // manual | http
    adapterConfig: jsonb("adapter_config").$type<{ baseUrl?: string; deviceId?: string }>().notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("laundry_machines_branch_code_uq").on(t.branchId, t.code),
    check("laundry_machines_type_check", sql`${t.machineType} in ('washer', 'dryer', 'iron_station')`),
    check("laundry_machines_status_check", sql`${t.status} in ('available', 'reserved', 'running', 'completed', 'out_of_service', 'maintenance')`),
  ],
);

export const laundryPrograms = pgTable("laundry_programs", {
  id: id(),
  organizationId: orgId(),
  machineId: uuid("machine_id").notNull().references(() => laundryMachines.id),
  name: text("name").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  active: boolean("active").notNull().default(true),
});

export const laundryOrders = pgTable(
  "laundry_orders",
  {
    id: id(),
    organizationId: orgId(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    orderNumber: text("order_number").notNull(),
    /** Random reference printed as a QR so the customer can follow the machine status without logging in. */
    statusToken: text("status_token").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    serviceId: uuid("service_id").notNull().references(() => laundryServices.id),
    serviceName: text("service_name").notNull(),
    pricingMethod: text("pricing_method").notNull(),
    weightGrams: integer("weight_grams"),
    billableGrams: integer("billable_grams"),
    units: integer("units"), // cycles or minutes
    subtotal: money("subtotal"),
    discountTotal: money("discount_total"),
    discountReason: text("discount_reason"),
    taxBps: integer("tax_bps").notNull().default(0),
    taxTotal: money("tax_total"),
    total: money("total"),
    estimatedMinutes: integer("estimated_minutes"),
    /** pending_payment | paid | in_progress | ready | collected | cancelled */
    status: text("status").notNull().default("pending_payment"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("laundry_orders_org_number_uq").on(t.organizationId, t.orderNumber),
    uniqueIndex("laundry_orders_token_uq").on(t.statusToken),
    index("laundry_orders_branch_created_idx").on(t.branchId, t.createdAt),
    check("laundry_orders_status_check", sql`${t.status} in ('pending_payment', 'paid', 'in_progress', 'ready', 'collected', 'cancelled')`),
  ],
);

export const laundryOrderItems = pgTable("laundry_order_items", {
  id: id(),
  organizationId: orgId(),
  orderId: uuid("order_id").notNull().references(() => laundryOrders.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price"),
  amount: money("amount"),
});

/**
 * A machine run for an order. At most one reserved/running session per machine (unique index),
 * which is what makes double booking impossible even under concurrent requests.
 */
export const laundrySessions = pgTable(
  "laundry_sessions",
  {
    id: id(),
    organizationId: orgId(),
    orderId: uuid("order_id").notNull().references(() => laundryOrders.id),
    machineId: uuid("machine_id").notNull().references(() => laundryMachines.id),
    programId: uuid("program_id").references(() => laundryPrograms.id),
    programName: text("program_name"),
    durationMinutes: integer("duration_minutes").notNull(),
    /** reserved | running | completed | failed | cancelled */
    status: text("status").notNull().default("reserved"),
    /** Who vouches for the state: staff (manual mode) or device (adapter confirmed). */
    statusSource: text("status_source").notNull().default("staff"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    expectedEndAt: timestamp("expected_end_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startedBy: uuid("started_by"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("laundry_sessions_one_active_per_machine_uq").on(t.machineId).where(sql`${t.status} in ('reserved', 'running')`),
    index("laundry_sessions_order_idx").on(t.orderId),
    check("laundry_sessions_status_check", sql`${t.status} in ('reserved', 'running', 'completed', 'failed', 'cancelled')`),
  ],
);

export const laundryMaintenance = pgTable("laundry_maintenance", {
  id: id(),
  organizationId: orgId(),
  machineId: uuid("machine_id").notNull().references(() => laundryMachines.id),
  kind: text("kind").notNull(), // breakdown | service | cleaning | inspection
  notes: text("notes").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  resolvedBy: uuid("resolved_by"),
});
