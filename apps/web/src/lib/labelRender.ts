"use client";

import { isLineBarcode, numericScanCode, type LabelDesign, type LabelElement } from "@drycare/shared";

/** A 203 dpi printer has about 8 dots per millimetre. */
export const DOTS_PER_MM = 8;
/** Items closer than this to the tag's edge risk being cut off by the printer (1 mm is safe on most rolls). */
const SAFE_EDGE = 4;

export type LabelData = { barcodeValue: string; texts: Record<string, string> };
export type LabelBox = { key: string; x: number; y: number; w: number; h: number };
export type RenderedLabel = {
  canvas: HTMLCanvasElement;
  boxes: LabelBox[];
  widthDots: number;
  heightDots: number;
  barcodeMm: { width: number; height: number } | null;
  warnings: string[];
};

const FONT_FAMILIES: Record<LabelElement["font"], string> = { dm: '"DM Sans", Arial, sans-serif', urbanist: '"Urbanist", Arial, sans-serif', arial: "Arial, sans-serif" };

let fontsReady: Promise<unknown> | null = null;
const loadFonts = () => (fontsReady ??= Promise.all([document.fonts.load('400 24px "DM Sans"'), document.fonts.load('600 24px "DM Sans"'), document.fonts.load('600 24px "Urbanist"')]));

async function drawBarcode(design: LabelDesign, value: string) {
  const { default: bwip } = await import("bwip-js/browser");
  const canvas = document.createElement("canvas");
  const { type, moduleDots, heightDots } = design.barcode;
  if (!isLineBarcode(type)) {
    // At scale 1 the library draws each square 2 pixels wide. Redraw them at exactly the chosen dot size.
    const source = document.createElement("canvas");
    bwip.toCanvas(source, { bcid: type, text: value, scale: 1, ...(type === "qrcode" ? { eclevel: "M" } : {}) } as Parameters<typeof bwip.toCanvas>[1]);
    const squares = Math.round(source.width / 2);
    const rows = Math.round(source.height / 2);
    const pixels = source.getContext("2d")!.getImageData(0, 0, source.width, source.height).data;
    canvas.width = squares * moduleDots;
    canvas.height = rows * moduleDots;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < squares; col++) {
        const at = (row * 2 * source.width + col * 2) * 4;
        // Transparent means blank; otherwise a dark pixel is a filled square.
        if (pixels[at + 3] > 128 && pixels[at] < 128) ctx.fillRect(col * moduleDots, row * moduleDots, moduleDots, moduleDots);
      }
    }
  } else {
    // bwip-js measures height in millimetres at 72 points per inch, so one vertical unit is one dot here.
    bwip.toCanvas(canvas, { bcid: type, text: value, scaleX: moduleDots, scaleY: 1, height: (heightDots * 25.4) / 72, includetext: false });
  }
  return canvas;
}

/** Quarter turns only, which move dots without blurring them. */
function rotate(source: HTMLCanvasElement, degrees: number) {
  if (!degrees) return source;
  const canvas = document.createElement("canvas");
  const sideways = degrees === 90 || degrees === 270;
  canvas.width = sideways ? source.height : source.width;
  canvas.height = sideways ? source.width : source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function drawText(ctx: CanvasRenderingContext2D, key: string, element: LabelElement, text: string, widthDots: number, heightDots: number, warnings: string[]): LabelBox {
  ctx.font = `${element.bold ? 600 : 400} ${element.size}px ${FONT_FAMILIES[element.font ?? "dm"]}`;
  const rotation = element.rotation ?? 0;
  const lineHeight = Math.ceil(element.size * 1.15);
  const align = rotation === 0 ? element.align ?? "left" : "left";
  // Room available in the direction the text runs.
  const room = rotation === 90 ? heightDots - element.y : rotation === 270 ? element.y : rotation === 180 ? element.x : align === "left" ? widthDots - element.x : align === "right" ? element.x : Math.min(element.x, widthDots - element.x) * 2;
  const shown = fitText(ctx, text, Math.max(16, room - 2));
  const w = Math.ceil(ctx.measureText(shown).width);
  if (shown !== text) warnings.push(`"${text}" does not fit, so it is cut short. Make it smaller or move it.`);
  ctx.save();
  ctx.translate(element.x, element.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.textAlign = align;
  ctx.fillText(shown, 0, 0);
  ctx.restore();
  if (rotation === 90) return { key, x: element.x - lineHeight, y: element.y, w: lineHeight, h: w };
  if (rotation === 180) return { key, x: element.x - w, y: element.y - lineHeight, w, h: lineHeight };
  if (rotation === 270) return { key, x: element.x, y: element.y - w, w: lineHeight, h: w };
  const left = align === "left" ? element.x : align === "right" ? element.x - w : element.x - Math.round(w / 2);
  return { key, x: left, y: element.y, w, h: lineHeight };
}

/** Draws one label dot for dot. The same image is used for the preview, the print dialog and direct printing. */
export async function renderLabel(design: LabelDesign, data: LabelData): Promise<RenderedLabel> {
  await loadFonts();
  const widthDots = Math.round(design.widthMm * DOTS_PER_MM);
  const heightDots = Math.round(design.heightMm * DOTS_PER_MM);
  const canvas = document.createElement("canvas");
  canvas.width = widthDots;
  canvas.height = heightDots;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, widthDots, heightDots);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  const boxes: LabelBox[] = [];
  const warnings: string[] = [];
  const addWarning = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };
  const drawnTexts: { text: string; box: LabelBox }[] = [];
  for (const [key, element] of Object.entries(design.elements)) {
    if (!element.show) continue;
    if (element.type === "line" || element.type === "box") {
      const w = element.w ?? 80;
      const h = element.h ?? (element.type === "line" ? 2 : 40);
      if (element.type === "line") ctx.fillRect(element.x, element.y, w, h);
      else {
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(element.x + 1, element.y + 1, w - 2, h - 2);
      }
      boxes.push({ key, x: element.x, y: element.y, w, h });
      continue;
    }
    const text = element.text ?? data.texts[key];
    if (!text) continue;
    const box = drawText(ctx, key, element, text, widthDots, heightDots, warnings);
    boxes.push(box);
    // Lines of text sit a little inside their boxes, so boxes may just touch without the words touching.
    const clash = drawnTexts.find((other) => box.x < other.box.x + other.box.w && box.x + box.w > other.box.x && box.y + 3 < other.box.y + other.box.h && box.y + box.h > other.box.y + 3);
    if (clash) addWarning(`"${clash.text}" and "${text}" are printing on top of each other. Move one of them.`);
    drawnTexts.push({ text, box });
    if (box.x < 0 || box.y < 0 || box.x + box.w > widthDots || box.y + box.h > heightDots) addWarning(`"${text}" goes off the tag. Move it or make it smaller.`);
    else if (box.x < SAFE_EDGE || box.y < SAFE_EDGE || box.x + box.w > widthDots - SAFE_EDGE || box.y + box.h > heightDots - SAFE_EDGE) addWarning(`"${text}" is very close to the edge and may be cut when printed.`);
  }
  if (design.border) {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(SAFE_EDGE, SAFE_EDGE, widthDots - SAFE_EDGE * 2, heightDots - SAFE_EDGE * 2);
  }

  // Turn text into pure black and white before the barcode goes on, so the printer gets clean dots.
  const image = ctx.getImageData(0, 0, widthDots, heightDots);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i] < 150 ? 0 : 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  let barcodeMm: RenderedLabel["barcodeMm"] = null;
  if (design.barcode.show && data.barcodeValue) {
    try {
      const { type, moduleDots: unit, rotation, centered } = design.barcode;
      const isLine = isLineBarcode(type);
      const value = isLine && design.barcode.compact ? numericScanCode(data.barcodeValue) : data.barcodeValue;
      const code = rotate(await drawBarcode(design, value), rotation ?? 0);
      const x = centered ? Math.max(0, Math.round((widthDots - code.width) / 2)) : design.barcode.x;
      const y = design.barcode.y;
      // Scanners need blank space before and after the bars. A QR code needs it on all four sides.
      const blank = (isLine ? 10 : 4) * unit;
      const upright = !rotation || rotation === 180;
      const blankX = !isLine || upright ? blank : 0;
      const blankY = !isLine || !upright ? blank : 0;
      const textOverlap = boxes.some((b) => b.x < x + code.width + blankX && b.x + b.w > x - blankX && b.y < y + code.height + blankY && b.y + b.h > y - blankY);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - blankX, y - blankY, code.width + blankX * 2, code.height + blankY * 2);
      ctx.drawImage(code, x, y);
      boxes.push({ key: "barcode", x, y, w: code.width, h: code.height });
      barcodeMm = { width: code.width / DOTS_PER_MM, height: code.height / DOTS_PER_MM };
      if (x + code.width > widthDots || y + code.height > heightDots) addWarning("The barcode goes off the tag and will not scan. Make it smaller.");
      else if (x < blankX || x + code.width + blankX > widthDots || y < blankY || y + code.height + blankY > heightDots) addWarning("The barcode needs more blank space around it to scan reliably. Move it inward or make it smaller.");
      if (textOverlap) addWarning("Text is touching the barcode's blank space and has been cut. Move the text or the barcode.");
      if (isLine && unit === 1) addWarning("Bars are 1 printer dot wide, the thinnest possible. These often will not scan on taffeta.");
      if (!isLine && unit < 4) addWarning("These squares are very small and may not scan on taffeta. Use size 4 or more.");
    } catch {
      addWarning("This barcode could not be drawn. Check its size and type.");
    }
  }
  return { canvas, boxes, widthDots, heightDots, barcodeMm, warnings };
}

/** Packs a drawn label for the printer: 8 pixels per byte, and a 0 bit prints a black dot. */
export function labelToBitmap(label: RenderedLabel) {
  const { data } = label.canvas.getContext("2d")!.getImageData(0, 0, label.widthDots, label.heightDots);
  const rowBytes = Math.ceil(label.widthDots / 8);
  const bytes = new Uint8Array(rowBytes * label.heightDots).fill(0xff);
  for (let y = 0; y < label.heightDots; y++) {
    for (let x = 0; x < label.widthDots; x++) {
      if (data[(y * label.widthDots + x) * 4] < 128) bytes[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { widthDots: label.widthDots, heightDots: label.heightDots, data: btoa(binary) };
}
