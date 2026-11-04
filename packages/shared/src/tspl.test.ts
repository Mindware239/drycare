import { describe, expect, it } from "vitest";
import { labelSettingsSchema } from "./schemas";
import { compactTagCode, expandScanCode } from "./scanCodes";
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
    expect(parsed.garmentDesign.widthMm).toBe(50);
    expect(parsed.garmentDesign.heightMm).toBe(30);
    expect(parsed.density).toBe(10);
    const saved = labelSettingsSchema.parse({ garmentDesign: { widthMm: 50, heightMm: 30, elements: {}, barcode: { type: "code128", show: true, x: 0, y: 0, centered: true, moduleDots: 1, heightDots: 72 } } });
    expect(saved.garmentDesign.barcode.rotation).toBe(0);
    expect(saved.garmentDesign.barcode.compact).toBe(true);
  });
});
