import { LABEL_PRESETS, isLineBarcode, type LabelDesign, type LabelSettings } from "@drycare/shared";
import { DOTS_PER_MM, type LabelBox } from "@/lib/labelRender";

type BarcodeType = LabelDesign["barcode"]["type"];

/**
 * Changes the barcode type. Between 1D and 2D the shape changes a lot, so it uses the matching
 * ready-made layout when one exists for this tag size.
 */
export function withBarcodeType(design: LabelDesign, type: BarcodeType, kind: "garment" | "bag"): LabelDesign {
  const code = design.barcode;
  if (isLineBarcode(type) === isLineBarcode(code.type)) {
    // Code 39 is about 1.6 times as long as Code 128, so thin bars are the only fit on a small tag.
    return { ...design, barcode: { ...code, type, ...(type === "code39" && design.widthMm < 65 ? { moduleDots: 1 } : {}) } };
  }
  const preset = LABEL_PRESETS.find((p) => p.kind === kind && isLineBarcode(p.design.barcode.type) === isLineBarcode(type) && p.design.widthMm === design.widthMm && p.design.heightMm === design.heightMm);
  if (preset) return { ...preset.design, barcode: { ...preset.design.barcode, type } };
  return { ...design, barcode: { ...code, type, moduleDots: isLineBarcode(type) ? 2 : 5, centered: isLineBarcode(type), compact: isLineBarcode(type) } };
}

/** One roll is loaded at a time, so a new roll size applies to both garment tags and bag labels. */
export function withRollSize(settings: LabelSettings, widthMm: number, heightMm: number): LabelSettings {
  const fit = (design: LabelDesign, kind: "garment" | "bag"): LabelDesign => {
    const presets = LABEL_PRESETS.filter((p) => p.kind === kind && p.design.widthMm === widthMm && p.design.heightMm === heightMm);
    const same = presets.find((p) => isLineBarcode(p.design.barcode.type) === isLineBarcode(design.barcode.type));
    return (same ?? presets[0])?.design ?? { ...design, widthMm, heightMm };
  };
  return { ...settings, garmentDesign: fit(settings.garmentDesign, "garment"), bagDesign: fit(settings.bagDesign, "bag") };
}

/**
 * Resizes the barcode and moves nearby text out of its way, so a bigger barcode never cuts into the text.
 * If there is no room left on the tag, the usual warning tells the user.
 */
export function resizeBarcode(design: LabelDesign, box: LabelBox, patch: { moduleDots?: number; heightDots?: number }): LabelDesign {
  const code = design.barcode;
  const next = { ...code, ...patch };
  const sideways = code.rotation === 90 || code.rotation === 270;
  const elements = { ...design.elements };

  if (isLineBarcode(code.type)) {
    if (sideways) return { ...design, barcode: next };
    // A taller barcode pushes down whatever sits below it.
    const delta = next.heightDots - code.heightDots;
    for (const [key, e] of Object.entries(elements)) if (delta && e.y >= box.y + box.h - 2) elements[key] = { ...e, y: Math.max(0, e.y + delta) };
    return { ...design, barcode: next, elements };
  }

  // Square codes need blank space on all four sides.
  const units = box.w / code.moduleDots;
  const size = units * next.moduleDots;
  const blank = 4 * next.moduleDots;
  const oldBlank = 4 * code.moduleDots;
  const above = Object.values(elements).filter((e) => e.show && e.y < box.y && e.x < box.x + box.w);
  const topClear = above.reduce((most, e) => Math.max(most, Math.ceil(e.y + e.size * 1.15)), 0);
  const y = Math.max(blank, topClear + blank);
  const x = code.centered ? code.x : Math.max(blank, box.x);
  // Text below follows the barcode's bottom edge in both directions, so growing then shrinking returns it.
  const shift = y + size + blank - (box.y + box.h + oldBlank);
  for (const [key, e] of Object.entries(elements)) {
    const beside = e.x >= box.x + box.w && e.y >= box.y - oldBlank && e.y < box.y + box.h + oldBlank;
    if (beside) elements[key] = { ...e, x: x + size + blank + 4 };
    else if (e.y >= box.y + box.h) elements[key] = { ...e, y: Math.max(0, e.y + shift) };
  }
  return { ...design, barcode: { ...next, x, y }, elements };
}

/** How long the barcode would be at this bar thickness, in millimetres. */
export function barcodeLengthMm(design: LabelDesign, box: LabelBox, moduleDots: number) {
  const sideways = design.barcode.rotation === 90 || design.barcode.rotation === 270;
  return (((sideways ? box.h : box.w) / design.barcode.moduleDots) * moduleDots) / DOTS_PER_MM;
}

/** Puts the barcode number where the long tag or bag number was. Other items keep their place and order. */
export function withShortNumber(design: LabelDesign, kind: "garment" | "bag"): LabelDesign {
  const long = kind === "garment" ? "tagCode" : "bagCode";
  if (!design.elements[long]) return design;
  const { scanCode: _replaced, ...others } = design.elements;
  return { ...design, elements: Object.fromEntries(Object.entries(others).map(([key, e]) => (key === long ? ["scanCode", e] : [key, e]))) };
}

/** The thickest whole-dot barcode that fits the tag with its blank space. */
export function fitBarcode(design: LabelDesign, box: LabelBox): LabelDesign {
  const code = design.barcode;
  const widthDots = Math.round(design.widthMm * DOTS_PER_MM);
  const heightDots = Math.round(design.heightMm * DOTS_PER_MM);
  const sideways = code.rotation === 90 || code.rotation === 270;
  const units = (sideways ? box.h : box.w) / code.moduleDots;
  const fits = isLineBarcode(code.type)
    ? Math.floor((sideways ? heightDots : widthDots) / (units + 20))
    : Math.floor(Math.min(widthDots - box.x, heightDots - box.y) / (units + 4));
  const moduleDots = Math.min(16, Math.max(1, fits));
  return { ...design, barcode: { ...code, moduleDots, ...(isLineBarcode(code.type) && !sideways ? { centered: true } : {}) } };
}
