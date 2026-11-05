import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, PLAN_FEATURE_KEYS, isPrinterApproved, resolveFeatures, splitInclusiveTax } from "./features";
import { BILL_PRESETS, billPaperSize, billTemplateSchema, chooseBillTemplate, renderBillMessage } from "./billTemplates";
import { normalizeEpc } from "./scanCodes";
import { DEFAULT_LABEL_SETTINGS, LABEL_PRESETS, branchUpdateSchema, code128DigitBars, fitBarcodeToDigits, isLineBarcode, withBasicTag, withScanDigits } from "./schemas";
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

describe("ready-made tag designs", () => {
  // Code 128 holds six digits in 3 pairs: start, 3 symbols and a check digit at 11 bars each, then a 13-bar stop.
  const SIX_DIGIT_BARS = 68;
  it("every line barcode fits its tag, with blank space at both sides", () => {
    for (const preset of LABEL_PRESETS.filter((p) => isLineBarcode(p.design.barcode.type))) {
      const { moduleDots } = preset.design.barcode;
      expect((SIX_DIGIT_BARS + 20) * moduleDots, preset.name).toBeLessThanOrEqual(preset.design.widthMm * 8);
      expect(moduleDots, preset.name).toBeGreaterThanOrEqual(3);
    }
  });
  it("every design prints the six-digit number and not the long one", () => {
    for (const preset of LABEL_PRESETS) {
      expect(preset.design.elements.scanCode?.show, preset.name).toBe(true);
      expect(preset.design.elements.tagCode, preset.name).toBeUndefined();
      expect(preset.design.elements.bagCode, preset.name).toBeUndefined();
    }
  });
});

describe("barcode length", () => {
  it("knows how much room a number needs", () => {
    expect(code128DigitBars(6)).toBe(68);
    expect(code128DigitBars(12)).toBe(101);
    expect(code128DigitBars(13)).toBe(123);
  });
  it("thins the bars for a longer number, and thickens them again for a shorter one", () => {
    const tag = DEFAULT_LABEL_SETTINGS.garmentDesign;
    expect(tag.widthMm).toBe(38);
    expect(fitBarcodeToDigits(tag, 6).barcode.moduleDots).toBe(3);
    expect(fitBarcodeToDigits(tag, 13).barcode.moduleDots).toBe(2);
    expect(fitBarcodeToDigits(tag, 18).barcode.moduleDots).toBe(1);
    const long = withScanDigits(DEFAULT_LABEL_SETTINGS, 13);
    expect([long.scanDigits, long.garmentDesign.barcode.moduleDots, long.bagDesign.barcode.moduleDots]).toEqual([13, 2, 2]);
    expect(withScanDigits(long, 6).garmentDesign.barcode.moduleDots).toBe(3);
  });
  it("leaves QR codes alone, and the basic tag follows the length too", () => {
    const qr = LABEL_PRESETS.find((p) => p.design.barcode.type === "qrcode")!.design;
    expect(fitBarcodeToDigits(qr, 13)).toEqual(qr);
    expect(withBasicTag({ ...DEFAULT_LABEL_SETTINGS, scanDigits: 13 }).garmentDesign.barcode.moduleDots).toBe(2);
  });
});

describe("bill templates", () => {
  it("every ready-made template is valid and lands on its paper", () => {
    for (const t of BILL_PRESETS) {
      expect(billTemplateSchema.safeParse(t).success, t.name).toBe(true);
      expect(billPaperSize(t).widthMm, t.name).toBeGreaterThan(0);
    }
    expect(billPaperSize(BILL_PRESETS[0])).toEqual({ widthMm: 80, heightMm: 0 });
  });
  it("uses the one asked for, then the shop's default, then the paper chosen before templates existed", () => {
    const mine = { ...BILL_PRESETS[2], id: "mine" };
    expect(chooseBillTemplate({ templates: [mine], defaultId: "mine" }, "80mm").id).toBe("mine");
    expect(chooseBillTemplate({ templates: [mine], defaultId: "mine" }, "80mm", "preset-a5").id).toBe("preset-a5");
    expect(chooseBillTemplate(null, "a4").id).toBe("preset-a4-gst");
    expect(chooseBillTemplate(null, null, "a5").id).toBe("preset-a5");
    expect(chooseBillTemplate(null).id).toBe("preset-thermal-80");
  });
  it("fills in a message and leaves out what it does not know", () => {
    expect(renderBillMessage("Hi {{customer}}, {{ balance }} due {{nonsense}}", { customer: "Asha", balance: "₹10" })).toBe("Hi Asha, ₹10 due ");
  });
});

describe("rfid", () => {
  it("reads a tag number however the reader types it", () => {
    expect(normalizeEpc(" e2 80-11:60 6000 0209 ")).toBe("E280116060000209");
    expect(normalizeEpc("0xABCD1234")).toBe("ABCD1234");
    expect(normalizeEpc("not a tag")).toBeNull();
    expect(normalizeEpc("12")).toBeNull();
  });
  it("is never part of a plan", () => {
    expect(PLAN_FEATURE_KEYS).not.toContain("rfid");
    expect(resolveFeatures({}).rfid).toBe(false);
  });
});

describe("branch edits", () => {
  it("changing a store code changes nothing else", () => {
    expect(branchUpdateSchema.parse({ branchCode: "bkc" })).toEqual({ branchCode: "BKC" });
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
