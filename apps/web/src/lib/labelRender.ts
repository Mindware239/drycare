"use client";

import { compactTagCode, type LabelDesign } from "@drycare/shared";

/** A 203 dpi printer has about 8 dots per millimetre. */
export const DOTS_PER_MM = 8;

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

let fontsReady: Promise<unknown> | null = null;
const loadFonts = () => (fontsReady ??= Promise.all([document.fonts.load('400 24px "DM Sans"'), document.fonts.load('600 24px "DM Sans"')]));

async function drawBarcode(design: LabelDesign, value: string) {
  const { default: bwip } = await import("bwip-js/browser");
  const canvas = document.createElement("canvas");
  const { type, moduleDots, heightDots } = design.barcode;
  if (type === "qrcode") {
    // At scale 1 the library draws each QR square 2 pixels wide. Redraw them at exactly the chosen dot size.
    const source = document.createElement("canvas");
    bwip.toCanvas(source, { bcid: "qrcode", text: value, scale: 1, eclevel: "M" } as Parameters<typeof bwip.toCanvas>[1]);
    const squares = Math.round(source.width / 2);
    const pixels = source.getContext("2d")!.getImageData(0, 0, source.width, source.height).data;
    canvas.width = canvas.height = squares * moduleDots;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let row = 0; row < squares; row++) {
      for (let col = 0; col < squares; col++) {
        const at = (row * 2 * source.width + col * 2) * 4;
        // Transparent means blank; otherwise a dark pixel is a filled square.
        if (pixels[at + 3] > 128 && pixels[at] < 128) ctx.fillRect(col * moduleDots, row * moduleDots, moduleDots, moduleDots);
      }
    }
  } else {
    // bwip-js measures height in millimetres at 72 points per inch, so one vertical unit is one dot here.
    bwip.toCanvas(canvas, { bcid: "code128", text: value, scaleX: moduleDots, scaleY: 1, height: (heightDots * 25.4) / 72, includetext: false });
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
  for (const [key, element] of Object.entries(design.elements)) {
    const text = data.texts[key];
    if (!element.show || !text) continue;
    ctx.font = `${element.bold ? 600 : 400} ${element.size}px "DM Sans", Arial, sans-serif`;
    const shown = fitText(ctx, text, Math.max(16, widthDots - element.x - 4));
    ctx.fillText(shown, element.x, element.y);
    boxes.push({ key, x: element.x, y: element.y, w: Math.ceil(ctx.measureText(shown).width), h: Math.ceil(element.size * 1.15) });
    if (shown !== text) warnings.push(`"${text}" does not fit, so it is cut short. Make it smaller or move it left.`);
    if (element.y + element.size * 1.15 > heightDots) warnings.push(`"${text}" runs off the bottom of the tag.`);
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
      const isLine = type === "code128";
      const value = isLine && design.barcode.compact ? compactTagCode(data.barcodeValue) : data.barcodeValue;
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
      if (x + code.width > widthDots || y + code.height > heightDots) warnings.push("The barcode goes off the tag and will not scan. Make it smaller.");
      else if (x < blankX || x + code.width + blankX > widthDots || y < blankY || y + code.height + blankY > heightDots) warnings.push("The barcode needs more blank space around it to scan reliably. Move it inward or make it smaller.");
      if (textOverlap) warnings.push("Text is touching the barcode's blank space and has been cut. Move the text or the barcode.");
      if (isLine && unit === 1) warnings.push("Bars are 1 printer dot wide, the thinnest possible. These often will not scan on taffeta.");
    } catch {
      warnings.push("This barcode could not be drawn. Check its size and type.");
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
