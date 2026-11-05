import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, isPrinterApproved, resolveFeatures, splitInclusiveTax } from "./features";
import { DEFAULT_LABEL_SETTINGS, withBasicTag } from "./schemas";
import { signedLicenseSchema } from "./license";

describe("plan features", () => {
  it("gives everything when no plan limits apply", () => {
    const features = resolveFeatures(null);
    expect(FEATURE_KEYS.every((key) => features[key])).toBe(true);
  });
  it("uses what the plan says", () => {
    const features = resolveFeatures({ labelDesigner: true, inventory: false });
    expect(features.labelDesigner).toBe(true);
    expect(features.inventory).toBe(false);
  });
  it("keeps new paid extras off, and existing modules on, when a plan never set them", () => {
    const features = resolveFeatures({});
    expect(features.labelDesigner).toBe(false);
    expect(features.customerMemberships).toBe(false);
    expect(features.deliveries).toBe(true);
  });
  it("lets a shop's exception beat the plan in both directions", () => {
    const features = resolveFeatures({ labelDesigner: false, inventory: true }, { labelDesigner: true, inventory: false });
    expect(features.labelDesigner).toBe(true);
    expect(features.inventory).toBe(false);
  });
});

describe("GST included in a price", () => {
  it("takes the tax out of the price, so the parts add up exactly", () => {
    expect(splitInclusiveTax(118000, 1800)).toEqual({ taxable: 100000, tax: 18000 });
    const { taxable, tax } = splitInclusiveTax(99900, 1800);
    expect(taxable + tax).toBe(99900);
  });
  it("charges nothing at 0%", () => {
    expect(splitInclusiveTax(99900, 0)).toEqual({ taxable: 99900, tax: 0 });
  });
});

describe("approved printers", () => {
  it("allows every printer until a list is set", () => {
    expect(isPrinterApproved({ name: "Any Printer" }, [])).toBe(true);
  });
  it("matches part of the name or the driver, ignoring case", () => {
    expect(isPrinterApproved({ name: "Counter printer", driver: "TSC TE244" }, ["tsc te244"])).toBe(true);
    expect(isPrinterApproved({ name: "TSC TE244 (Copy 1)" }, ["TSC TE244"])).toBe(true);
  });
  it("refuses anything else, and a blank entry never matches", () => {
    expect(isPrinterApproved({ name: "Microsoft Print to PDF", driver: "Microsoft" }, ["TSC TE244"])).toBe(false);
    expect(isPrinterApproved({ name: "Any Printer" }, ["  "])).toBe(false);
  });
});

describe("basic tag", () => {
  it("always prints the 38 x 30 mm taffeta tag, whatever design was saved", () => {
    const custom = { ...DEFAULT_LABEL_SETTINGS, garmentDesign: { ...DEFAULT_LABEL_SETTINGS.garmentDesign, widthMm: 70, heightMm: 40 } };
    const basic = withBasicTag(custom);
    expect([basic.garmentDesign.widthMm, basic.garmentDesign.heightMm, basic.bagDesign.widthMm, basic.bagDesign.heightMm]).toEqual([38, 30, 38, 30]);
  });
  it("offers a line barcode or a QR code", () => {
    expect(withBasicTag(DEFAULT_LABEL_SETTINGS).garmentDesign.barcode.type).toBe("code128");
    expect(withBasicTag({ ...DEFAULT_LABEL_SETTINGS, basicTagStyle: "qr" }).garmentDesign.barcode.type).toBe("qrcode");
  });
});

describe("license format", () => {
  const base = { version: 1, licenseId: "3f9c2a7e-1b2c-4d5e-8f90-123456789abc", plan: "Starter", issuedAt: new Date().toISOString(), expiresAt: null, installationIds: ["3f9c2a7e-1b2c-4d5e-8f90-123456789abc"] };
  it("still reads keys issued before features existed", () => {
    expect(signedLicenseSchema.parse(base).features).toBeUndefined();
  });
  it("reads features and hardware", () => {
    const parsed = signedLicenseSchema.parse({ ...base, features: { labelDesigner: false }, hardware: { printers: ["TSC"], scanners: [] } });
    expect(parsed.features?.labelDesigner).toBe(false);
    expect(parsed.hardware?.printers).toEqual(["TSC"]);
  });
});
