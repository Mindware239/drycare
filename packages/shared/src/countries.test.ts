import { describe, expect, it } from "vitest";
import { COUNTRIES, countryPack, isTimeZone, resolveRegion, startingPrice, todayInZone, validTaxId } from "./countries";
import { formatMoney } from "./money";
import { priceLine } from "./pricing";
import { quoteLaundry } from "./laundry";

describe("country packs", () => {
  it("every pack has a real time zone and currency", () => {
    for (const c of COUNTRIES) {
      expect(isTimeZone(c.timezone), c.code).toBe(true);
      expect(() => formatMoney(100, c.currency), c.code).not.toThrow();
    }
  });

  it("a shop with no country is an Indian shop", () => {
    const r = resolveRegion({ settings: {} });
    expect(r).toMatchObject({ country: "IN", currency: "INR", taxName: "GST", splitsGst: true, hasUpi: true, pricesIncludeTax: false, defaultTaxBps: 1800 });
  });

  it("the owner's choices win over the country's defaults", () => {
    const r = resolveRegion({ defaultCurrency: "AED", defaultTimezone: "Asia/Dubai", settings: { country: "AE", taxName: "Tax", defaultTaxBps: 0, pricesIncludeTax: false } });
    expect(r).toMatchObject({ country: "AE", currency: "AED", taxName: "Tax", defaultTaxBps: 0, pricesIncludeTax: false, splitsGst: false, hasUpi: false });
  });

  it("an unknown country falls back to India", () => {
    expect(countryPack("XX").code).toBe("IN");
  });
});

describe("tax numbers", () => {
  it("checks the format of the shop's country", () => {
    expect(validTaxId("IN", "22AAAAA0000A1Z5")).toBe(true);
    expect(validTaxId("IN", "DE123456789")).toBe(false);
    expect(validTaxId("DE", "DE123456789")).toBe(true);
    expect(validTaxId("AE", "100000000000003")).toBe(true);
    expect(validTaxId("AE", "123")).toBe(false);
  });
  it("accepts any sensible number where the format is not known, and an empty one anywhere", () => {
    expect(validTaxId("FR", "FR 12 345678901")).toBe(true);
    expect(validTaxId("IN", "")).toBe(true);
  });
});

describe("prices that include tax", () => {
  it("the customer pays the price shown, and the bill still adds up", () => {
    const line = priceLine({ unitPrice: 12000, quantity: 1, taxBps: 2000, taxIncluded: true });
    expect(line.total).toBe(12000);
    expect(line.taxable).toBe(10000);
    expect(line.tax).toBe(2000);
  });
  it("adds up with discount and express charge, for awkward amounts too", () => {
    for (const unitPrice of [999, 1234, 2599, 10001]) {
      for (const taxBps of [500, 810, 1900, 2100]) {
        const l = priceLine({ unitPrice, quantity: 3, taxBps, taxIncluded: true, surchargeBps: 5000, discountBps: 1000 });
        expect(l.taxable + l.tax).toBe(l.total);
        expect(l.base + l.surcharge - l.discount).toBe(l.taxable);
        const base = unitPrice * 3;
        const gross = base + Math.round(base * 0.5);
        expect(l.total).toBe(gross - Math.round(gross * 0.1));
      }
    }
  });
  it("prices without tax included work as before", () => {
    expect(priceLine({ unitPrice: 10000, quantity: 1, taxBps: 1800 })).toMatchObject({ taxable: 10000, tax: 1800, total: 11800 });
  });
  it("a tax-free shop has no tax either way", () => {
    expect(priceLine({ unitPrice: 10000, quantity: 1, taxBps: 0, taxIncluded: true })).toMatchObject({ tax: 0, total: 10000 });
  });
  it("laundry prices can include tax too", () => {
    const q = quoteLaundry({ method: "item", unitPrice: 0, minWeightGrams: 0, weightIncrementGrams: 100, minMinutes: 0, minimumCharge: 0 } as never, { items: [{ name: "Shirt", quantity: 1, unitPrice: 12000 }], taxBps: 2000, taxIncluded: true } as never);
    expect(q).toMatchObject({ total: 12000, taxable: 10000, tax: 2000 });
  });
});

describe("formats", () => {
  it("shows each currency's own number of decimals", () => {
    expect(formatMoney(150000, "INR")).toBe("₹1,500.00");
    expect(formatMoney(1500, "USD")).toBe("$15.00");
    expect(formatMoney(1500, "KWD")).toContain("15.000");
  });
  it("today follows the shop's clock", () => {
    const at = new Date("2026-01-01T22:00:00Z");
    expect(todayInZone("Asia/Dubai", at)).toBe("2026-01-02");
    expect(todayInZone("America/New_York", at)).toBe("2026-01-01");
  });
  it("only real time zones pass", () => {
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("Mars/Base")).toBe(false);
    expect(isTimeZone("'; drop table x; --")).toBe(false);
  });
});

describe("starting prices", () => {
  it("leaves rupee prices alone and scales others to round figures", () => {
    expect(startingPrice(8000, "INR")).toBe(8000);
    const usd = startingPrice(8000, "USD");
    expect(usd).toBeGreaterThan(50);
    expect(usd).toBeLessThan(150);
    expect(startingPrice(0, "USD")).toBe(0);
    expect(startingPrice(1, "KWD")).toBeGreaterThanOrEqual(1);
  });
});
