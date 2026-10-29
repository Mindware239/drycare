import { describe, expect, it } from "vitest";
import { priceLine, sumLines, invoiceBalance, invoiceState } from "./pricing";
import { allowedTransitions, collectionDiscount, deriveOrderStatus, findTransition, validateTemplate, DEFAULT_TEMPLATE, reworkTarget } from "./workflow";
import { applyBps, toMinor } from "./money";
import { customerApprovalConfirmationSchema, marketingCampaignSchema, orderCreateSchema, staffAttendanceSchema, staffLeaveSchema, staffProfileSchema } from "./schemas";

describe("money", () => {
  it("converts rupees to paise without float drift", () => {
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor("249.99")).toBe(24999);
  });
  it("rounds basis points half away from zero", () => {
    expect(applyBps(25, 1800)).toBe(5); // 4.5 -> 5
    expect(applyBps(-25, 1800)).toBe(-5);
  });
});

describe("pricing", () => {
  it("prices the blueprint example order consistently (AC-05)", () => {
    const suit = priceLine({ unitPrice: 25000, quantity: 1 });
    const shirts = priceLine({ unitPrice: 8000, quantity: 2 });
    const t = sumLines([suit, shirts]);
    expect(t.grandTotal).toBe(41000);
    // same input -> same output
    expect(sumLines([priceLine({ unitPrice: 25000, quantity: 1 }), priceLine({ unitPrice: 8000, quantity: 2 })])).toEqual(t);
  });
  it("applies surcharge, then discount, then tax", () => {
    const l = priceLine({ unitPrice: 10000, quantity: 1, surchargeBps: 5000, discountBps: 1000, taxBps: 1800 });
    expect(l.base).toBe(10000);
    expect(l.surcharge).toBe(5000);
    expect(l.discount).toBe(1500);
    expect(l.taxable).toBe(13500);
    expect(l.tax).toBe(2430);
    expect(l.total).toBe(15930);
  });
  it("never discounts below zero and applies minimum charge", () => {
    expect(priceLine({ unitPrice: 1000, quantity: 1, discountFlat: 5000 }).total).toBe(0);
    expect(priceLine({ unitPrice: 1000, quantity: 1, minimumCharge: 3000 }).base).toBe(3000);
  });
  it("rejects invalid input", () => {
    expect(() => priceLine({ unitPrice: 10.5, quantity: 1 })).toThrow();
    expect(() => priceLine({ unitPrice: 100, quantity: 0 })).toThrow();
  });
});

describe("invoice balance", () => {
  it("partial payment is not marked paid", () => {
    expect(invoiceState(41000, 20000, 0)).toBe("partially_paid");
    expect(invoiceBalance(41000, 20000, 0)).toBe(21000);
  });
  it("refunds reopen a balance", () => {
    expect(invoiceState(41000, 41000, 0)).toBe("paid");
    expect(invoiceState(41000, 41000, 1000)).toBe("partially_paid");
    expect(invoiceBalance(41000, 41000, 1000)).toBe(1000);
  });
});

describe("workflow", () => {
  it("validates templates", () => {
    expect(() => validateTemplate(["received", "cleaning", "ready"])).not.toThrow();
    expect(() => validateTemplate(["cleaning", "ready"])).toThrow();
    expect(() => validateTemplate(["received", "packing", "cleaning", "ready"])).toThrow();
  });
  it("only advances one stage at a time", () => {
    expect(findTransition(DEFAULT_TEMPLATE, "received", "inspection")?.kind).toBe("advance");
    expect(findTransition(DEFAULT_TEMPLATE, "received", "ready")).toBeUndefined();
  });
  it("requires QC approval to leave quality control (AC-07)", () => {
    const t = allowedTransitions(DEFAULT_TEMPLATE, "quality_control");
    expect(t.find((x) => x.to === "packing")?.permission).toBe("qc.approve");
    expect(t.find((x) => x.to === "rework")?.kind).toBe("qc_fail");
  });
  it("never allows a bare transition to delivered", () => {
    for (const s of DEFAULT_TEMPLATE) expect(findTransition(DEFAULT_TEMPLATE, s, "delivered")).toBeUndefined();
    expect(allowedTransitions(DEFAULT_TEMPLATE, "delivered")).toHaveLength(0);
  });
  it("rework returns to cleaning", () => {
    expect(reworkTarget(DEFAULT_TEMPLATE)).toBe("cleaning");
    expect(reworkTarget(["received", "finishing", "quality_control", "packing", "ready"])).toBe("finishing");
  });
  it("derives order status from garments", () => {
    expect(deriveOrderStatus(["received", "received"])).toBe("received");
    expect(deriveOrderStatus(["ready", "cleaning"])).toBe("partially_ready");
    expect(deriveOrderStatus(["ready", "ready", "cancelled"])).toBe("ready");
    expect(deriveOrderStatus(["delivered", "ready"])).toBe("partially_delivered");
    expect(deriveOrderStatus(["delivered", "cancelled"])).toBe("delivered");
    expect(deriveOrderStatus(["cancelled"])).toBe("cancelled");
  });
});

describe("staff profiles", () => {
  it("accepts a weekly duty schedule with valid local times", () => {
    const result = staffProfileSchema.safeParse({
      monthlySalary: 3_250_000,
      dutySchedule: {
        monday: { enabled: true, start: "09:00", end: "18:00" },
        sunday: { enabled: false, start: "09:00", end: "18:00" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid or reversed working hours and negative salary", () => {
    expect(staffProfileSchema.safeParse({ dutySchedule: { monday: { enabled: true, start: "18:00", end: "09:00" } } }).success).toBe(false);
    expect(staffProfileSchema.safeParse({ dutySchedule: { monday: { enabled: true, start: "25:00", end: "26:00" } } }).success).toBe(false);
    expect(staffProfileSchema.safeParse({ monthlySalary: -1 }).success).toBe(false);
  });
});

describe("staff attendance and leave", () => {
  const membershipId = "11111111-1111-4111-8111-111111111111";
  const branchId = "22222222-2222-4222-8222-222222222222";

  it("accepts manual attendance with valid local times and rejects reversed shift times", () => {
    const attendance = {
      membershipId,
      branchId,
      workDate: "2026-10-23",
      status: "present",
      checkIn: "09:00",
      checkOut: "18:00",
    };
    expect(staffAttendanceSchema.safeParse(attendance).success).toBe(true);
    expect(staffAttendanceSchema.safeParse({ ...attendance, checkOut: "08:59" }).success).toBe(false);
    expect(staffAttendanceSchema.safeParse({ ...attendance, checkIn: "25:00" }).success).toBe(false);
  });

  it("requires leave date ranges to be in chronological order", () => {
    const leave = { membershipId, branchId, startDate: "2026-10-23", endDate: "2026-10-25" };
    expect(staffLeaveSchema.safeParse(leave).success).toBe(true);
    expect(staffLeaveSchema.safeParse({ ...leave, endDate: "2026-10-22" }).success).toBe(false);
  });
});

describe("marketing campaigns", () => {
  const campaign = {
    name: "Diwali 2026",
    subject: "A festive offer from DryCare",
    body: "Enjoy our seasonal offer this Diwali.",
    audience: { type: "inactive", inactiveDays: 60 },
    action: "schedule",
    scheduledAt: "2026-11-01T04:30:00.000Z",
  };

  it("accepts scheduled campaigns with a bounded inactivity segment", () => {
    expect(marketingCampaignSchema.safeParse(campaign).success).toBe(true);
  });

  it("requires a schedule for scheduled campaigns and valid segment days", () => {
    expect(marketingCampaignSchema.safeParse({ ...campaign, scheduledAt: undefined }).success).toBe(false);
    expect(marketingCampaignSchema.safeParse({ ...campaign, audience: { type: "inactive", inactiveDays: 5 } }).success).toBe(false);
  });

  it("requires promotional coupon details and a coupon token when offering a discount", () => {
    expect(marketingCampaignSchema.safeParse({
      ...campaign,
      action: "draft",
      scheduledAt: undefined,
      discountPercent: 10,
      couponExpiresAt: "2026-11-30T18:29:59.000Z",
    }).success).toBe(false);
    expect(marketingCampaignSchema.safeParse({
      ...campaign,
      action: "draft",
      scheduledAt: undefined,
      body: "Use {{coupon_code}} for the offer",
      discountPercent: 10,
      couponExpiresAt: "2026-11-30T18:29:59.000Z",
    }).success).toBe(true);
  });

  it("normalizes coupon codes in order requests", () => {
    const parsed = orderCreateSchema.safeParse({
      customerId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      couponCode: "diwali-2026",
      promisedAt: "2026-11-01T04:30:00.000Z",
      items: [{ garmentTypeId: "33333333-3333-4333-8333-333333333333", serviceId: "44444444-4444-4444-8444-444444444444", quantity: 1 }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.couponCode).toBe("DIWALI-2026");
  });

  it("requires a reason for special-care approval holds", () => {
    const request = {
      customerId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      promisedAt: "2026-11-01T04:30:00.000Z",
      items: [{
        garmentTypeId: "33333333-3333-4333-8333-333333333333",
        serviceId: "44444444-4444-4444-8444-444444444444",
        quantity: 1,
        specialCareApprovalRequired: true,
      }],
    };
    expect(orderCreateSchema.safeParse(request).success).toBe(false);
    expect(orderCreateSchema.safeParse({
      ...request,
      items: [{ ...request.items[0], specialCareReason: "Hand-finish delicate buttons" }],
    }).success).toBe(true);
  });

  it("requires witness notes for recorded verbal approval", () => {
    expect(customerApprovalConfirmationSchema.safeParse({ method: "verbal", customerName: "A Customer" }).success).toBe(false);
    expect(customerApprovalConfirmationSchema.safeParse({ method: "verbal", customerName: "A Customer", notes: "Confirmed treatment by phone" }).success).toBe(true);
  });
});

describe("collection discount (credit note)", () => {
  it("matches the ₹540 − ₹40 example with no GST", () => {
    expect(collectionDiscount({ taxableBase: 54000, taxTotal: 0, alreadyCredited: 0, type: "fixed", value: 4000 })).toEqual({ taxable: 4000, tax: 0, total: 4000 });
  });
  it("reduces GST in proportion", () => {
    // ₹1,000 taxable + ₹180 GST; 10% discount → ₹100 off and ₹18 less GST.
    expect(collectionDiscount({ taxableBase: 100000, taxTotal: 18000, alreadyCredited: 0, type: "percent", value: 1000 })).toEqual({ taxable: 10000, tax: 1800, total: 11800 });
  });
  it("rejects discounts above the eligible amount or zero", () => {
    expect(collectionDiscount({ taxableBase: 54000, taxTotal: 0, alreadyCredited: 0, type: "fixed", value: 54001 })).toHaveProperty("error");
    expect(collectionDiscount({ taxableBase: 54000, taxTotal: 0, alreadyCredited: 50000, type: "fixed", value: 5000 })).toHaveProperty("error");
    expect(collectionDiscount({ taxableBase: 54000, taxTotal: 0, alreadyCredited: 0, type: "fixed", value: 0 })).toHaveProperty("error");
  });
});
