import { describe, expect, it } from "vitest";
import { billableWeight, quoteLaundry, type LaundryRule } from "./laundry";

const base: LaundryRule = { method: "weight", unitPrice: 6000, minWeightGrams: 3000, weightIncrementGrams: 500, minMinutes: 0, minimumCharge: 0 };

describe("self-service laundry pricing", () => {
  it("weight: rounds up to the increment and applies the minimum weight", () => {
    expect(billableWeight(4200, base)).toBe(4500);
    expect(billableWeight(1200, base)).toBe(3000);
    const q = quoteLaundry(base, { weightGrams: 4200, taxBps: 1800 });
    expect(q.billableGrams).toBe(4500);
    expect(q.subtotal).toBe(27000); // 4.5 kg × ₹60
    expect(q.tax).toBe(4860);
    expect(q.total).toBe(31860);
  });
  it("item: sums quantities × rates", () => {
    const q = quoteLaundry({ ...base, method: "item" }, { items: [{ name: "Shirt", unitPrice: 2500, quantity: 3 }, { name: "Saree", unitPrice: 3000, quantity: 1 }], taxBps: 0 });
    expect(q.subtotal).toBe(10500);
    expect(q.lines).toHaveLength(2);
  });
  it("cycle, time and package", () => {
    expect(quoteLaundry({ ...base, method: "cycle", unitPrice: 15000 }, { units: 2, taxBps: 0 }).total).toBe(30000);
    expect(quoteLaundry({ ...base, method: "time", unitPrice: 300, minMinutes: 20 }, { units: 12, taxBps: 0 }).total).toBe(6000);
    expect(quoteLaundry({ ...base, method: "package", unitPrice: 22000, packageLabel: "Load" }, { taxBps: 1800 }).total).toBe(25960);
  });
  it("discounts reduce the taxable amount; minimum charge applies first", () => {
    const q = quoteLaundry({ ...base, method: "cycle", unitPrice: 10000, minimumCharge: 15000 }, { units: 1, discount: { type: "percent", bps: 1000 }, taxBps: 1800 });
    expect(q.subtotal).toBe(15000);
    expect(q.discount).toBe(1500);
    expect(q.tax).toBe(2430);
    expect(q.total).toBe(15930);
    expect(() => quoteLaundry(base, { weightGrams: 3000, discount: { type: "fixed", amount: 999999 }, taxBps: 0 })).toThrow();
  });
  it("rejects missing or invalid input", () => {
    expect(() => quoteLaundry(base, { taxBps: 0 })).toThrow();
    expect(() => quoteLaundry({ ...base, method: "item" }, { items: [], taxBps: 0 })).toThrow();
    expect(() => quoteLaundry({ ...base, method: "cycle" }, { units: 0, taxBps: 0 })).toThrow();
  });
});
