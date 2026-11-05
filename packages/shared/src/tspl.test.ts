import { describe, expect, it } from "vitest";
import { labelSettingsSchema } from "./schemas";
import { branchCheck, digitsAsShortTag, sampleScanCode, compactTagCode, expandScanCode, isSampleScanNumber, numericScanCode, parseScanNumber } from "./scanCodes";
import { buildTsplJob, bytesPerRow } from "./tspl";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("short barcode codes", () => {
  it("shortens a tag number and expands it back", () => {
    expect(compactTagCode("NEWDEL-2026-00001-01")).toBe("NEWDEL260000101");
    expect(expandScanCode("NEWDEL260000101")).toBe("NEWDEL-2026-00001-01");
    expect(expandScanCode(" newdel260000101\r\n")).toBe("NEWDEL-2026-00001-01");
  });
  it("handles branch codes that end in a digit", () => {
    expect(expandScanCode(compactTagCode("BR1-2026-00042-07"))).toBe("BR1-2026-00042-07");
  });
  it("leaves full numbers, bag codes and unusual tags alone", () => {
    expect(expandScanCode("NEWDEL-2026-00001-01")).toBe("NEWDEL-2026-00001-01");
    expect(expandScanCode("NEWDEL-2026-00001-B1")).toBe("NEWDEL-2026-00001-B1");
    expect(compactTagCode("NEWDEL-2026-00001-B1")).toBe("NEWDEL-2026-00001-B1");
    expect(compactTagCode("NEWDEL-2026-100000-01")).toBe("NEWDEL-2026-100000-01");
    expect(compactTagCode("NEWDEL-2026-00001-100")).toBe("NEWDEL-2026-00001-100");
    expect(expandScanCode("DC1")).toBe("DC1");
  });
});

describe("12-digit barcode numbers", () => {
  it("turns a garment tag into 12 digits and back to its ending", () => {
    const number = numericScanCode("NEWDEL-2026-00001-01");
    expect(number).toMatch(/^\d{12}$/);
    expect(number.startsWith(`0${branchCheck("NEWDEL")}`)).toBe(true);
    expect(parseScanNumber(number)).toEqual({ kind: "garment", check: branchCheck("NEWDEL"), ending: "-2026-00001-01" });
  });
  it("turns a bag code into 12 digits and back to its ending", () => {
    const number = numericScanCode("NEWDEL-2026-00001-B1");
    expect(number).toMatch(/^1\d{11}$/);
    expect(parseScanNumber(number)).toEqual({ kind: "bag", check: branchCheck("NEWDEL"), ending: "-2026-00001-B1" });
  });
  it("gives different branches different numbers", () => {
    expect(numericScanCode("NEWDEL-2026-00001-01")).not.toBe(numericScanCode("AND-2026-00001-01"));
  });
  it("keeps the full code when it does not fit 12 digits", () => {
    expect(numericScanCode("NEWDEL-2026-00001-100")).toBe("NEWDEL-2026-00001-100");
    expect(numericScanCode("NEWDEL-2026-100000-01")).toBe("NEWDEL-2026-100000-01");
  });
  it("still reads what a scanner sends, and tags printed earlier", () => {
    const number = numericScanCode("NEWDEL-2026-00001-01");
    expect(expandScanCode(` ${number}\r\n`)).toBe(number);
    expect(expandScanCode("NEWDEL260000101")).toBe("NEWDEL-2026-00001-01");
    expect(parseScanNumber("NEWDEL260000101")).toBeNull();
  });
  it("recognises sample tags", () => {
    expect(isSampleScanNumber(numericScanCode("NEWDEL-2026-00000-01"))).toBe(true);
    expect(isSampleScanNumber(numericScanCode("NEWDEL-2026-00001-01"))).toBe(false);
    expect(isSampleScanNumber(sampleScanCode())).toBe(true);
    expect(isSampleScanNumber(sampleScanCode(13))).toBe(true);
    expect(isSampleScanNumber("000001")).toBe(false);
  });
  it("leaves a six-digit number exactly as it is", () => {
    expect(numericScanCode("000123")).toBe("000123");
    expect(expandScanCode(" 000123\r\n")).toBe("000123");
  });
  it("leaves a number of any length whole, however it looks", () => {
    expect(expandScanCode("0000000000123")).toBe("0000000000123");
    expect(expandScanCode("123456789012345678")).toBe("123456789012345678");
  });
  it("can still read an old tag from a branch whose code was all digits", () => {
    expect(digitsAsShortTag("12260000101")).toBe("12-2026-00001-01");
    expect(digitsAsShortTag("000123")).toBeNull();
    expect(digitsAsShortTag("NEWDEL260000101")).toBeNull();
  });
});

describe("tag printing", () => {
  it("builds a job with the tag size and print settings", () => {
    const out = text(buildTsplJob({ widthMm: 50, heightMm: 30, gapMm: 2, density: 10, speed: 3, copies: 2, labels: [{ widthDots: 16, heightDots: 1, bitmap: new Uint8Array([0x0f, 0xff]) }] }));
    expect(out).toContain("SIZE 50 mm,30 mm\r\n");
    expect(out).toContain("GAP 2 mm,0 mm\r\n");
    expect(out).toContain("DENSITY 10\r\n");
    expect(out).toContain("SPEED 3\r\n");
    expect(out).toContain("BITMAP 0,0,2,1,0,\x0f\xff\r\n");
    expect(out).toContain("PRINT 1,2\r\n");
  });

  it("rounds a row up to whole bytes", () => {
    expect(bytesPerRow(400)).toBe(50);
    expect(bytesPerRow(401)).toBe(51);
  });

  it("refuses an image that does not match its size", () => {
    expect(() => buildTsplJob({ widthMm: 50, heightMm: 30, gapMm: 2, density: 10, speed: 3, copies: 1, labels: [{ widthDots: 16, heightDots: 2, bitmap: new Uint8Array(2) }] })).toThrow();
  });

  it("keeps older saved settings working by filling in the designs", () => {
    const parsed = labelSettingsSchema.parse({ garmentWidthMm: 50, garmentHeightMm: 25, barcode: "code128", copies: 1 });
    expect(parsed.garmentDesign.widthMm).toBe(38);
    expect(parsed.garmentDesign.heightMm).toBe(30);
    expect(parsed.density).toBe(10);
    const saved = labelSettingsSchema.parse({ garmentDesign: { widthMm: 50, heightMm: 30, elements: {}, barcode: { type: "code128", show: true, x: 0, y: 0, centered: true, moduleDots: 1, heightDots: 72 } } });
    expect(saved.garmentDesign.barcode.rotation).toBe(0);
    expect(saved.garmentDesign.barcode.compact).toBe(true);
  });
});
