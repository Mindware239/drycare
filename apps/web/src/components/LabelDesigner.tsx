"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Barcode, Check, CircleAlert, CircleCheck, Copy, Download, Eye, EyeOff, Lock, Minus, Pencil, Plus, Printer, RefreshCw, RotateCcw, Square, Trash2, Type, Undo2, Redo2, Unlock, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { LABEL_PRESETS, LABEL_SIZES, MAX_SCAN_DIGITS, MIN_SCAN_DIGITS, el, isLineBarcode, labelDesignSchema, withScanDigits, type LabelDesign, type LabelElement, type LabelSettings, type LabelTemplate } from "@drycare/shared";
import { Alert, Button, Field, Input, Select, cx } from "@/components/ui";
import { barcodeLengthMm, fitBarcode, resizeBarcode, withBarcodeType, withShortNumber } from "@/lib/labelDesign";
import { DOTS_PER_MM, renderLabel, type LabelData, type RenderedLabel } from "@/lib/labelRender";

type Kind = "garment" | "bag";
/** Every length a shop can choose, and how many tags that allows. */
export const SCAN_DIGIT_OPTIONS: [number, string][] = Array.from({ length: MAX_SCAN_DIGITS - MIN_SCAN_DIGITS + 1 }, (_, i) => {
  const digits = MIN_SCAN_DIGITS + i;
  return [digits, `${digits} digits${digits === 6 ? " (recommended)" : ""}${digits <= 12 ? `, up to ${(10 ** digits - 1).toLocaleString("en-IN")} tags` : ""}`];
});
const FIELDS: Record<Kind, [string, string][]> = {
  garment: [["scanCode", "Barcode number"], ["orderNumber", "Order number"], ["orderSerial", "Order serial number"], ["branchCode", "Store code"], ["count", "Tag count (1/3)"], ["tagCode", "Full tag number"], ["garment", "Garment"], ["service", "Service"], ["colour", "Colour"], ["brand", "Brand"], ["customer", "Customer name"], ["phone", "Customer phone"], ["due", "Due date"], ["orderDate", "Order date"], ["quantity", "Pieces in order"], ["store", "Store name"], ["price", "Price"], ["notes", "Special instructions"]],
  bag: [["scanCode", "Barcode number"], ["title", "Heading"], ["orderNumber", "Order number"], ["orderSerial", "Order serial number"], ["branchCode", "Store code"], ["pieces", "Pieces"], ["bagCode", "Full bag number"], ["info", "Store and customer"], ["customer", "Customer name"], ["phone", "Customer phone"], ["store", "Store name"], ["due", "Due date"], ["orderDate", "Order date"]],
};
const BARCODE_TYPES: [LabelDesign["barcode"]["type"], string][] = [["code128", "1D · Code 128 (recommended)"], ["code39", "1D · Code 39"], ["qrcode", "2D · QR code"], ["datamatrix", "2D · Data Matrix"]];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mm = (dots: number) => Math.round((dots / DOTS_PER_MM) * 10) / 10;
/** How close to the barcode's edge, in printer dots, counts as grabbing a resize handle. */
const HANDLE = 8;
const RESIZE_CURSOR = { corner: "nwse-resize", right: "ew-resize", bottom: "ns-resize" } as const;
type ResizeHandle = keyof typeof RESIZE_CURSOR;
/** Half a millimetre. */
const GRID = 4;

export function Stepper({ label, value, unit, display, onChange, min, max, step = 1 }: { label: string; value: number; unit?: string; display?: string; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
      <span className="min-w-13 text-center text-sm font-semibold tabular-nums">{display ?? `${value}${unit ?? ""}`}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Segments<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={label}>
        {options.map(([v, name]) => <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cx("flex-1 rounded-full px-2 py-1.5 text-sm font-semibold", value === v ? "bg-slate-900 text-white" : "text-slate-700")}>{name}</button>)}
      </div>
    </div>
  );
}

/** A named group of settings in a side panel. */
const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section className="border-t border-slate-200 px-4 py-3.5 first:border-t-0">
    <div className="mb-2.5 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>{action}</div>
    <div className="space-y-3">{children}</div>
  </section>
);

/** Small square button used in toolbars and layer rows. */
const IconButton = ({ label, active, onClick, disabled, children }: { label: string; active?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) => (
  <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 disabled:hover:bg-transparent", active && "bg-slate-900 text-white hover:bg-slate-800 hover:text-white")}>{children}</button>
);

/** Millimetre scales along the tag. The shaded band shows where the selected item sits. */
function Ruler({ lengthMm, scale, vertical, from, to }: { lengthMm: number; scale: number; vertical?: boolean; from?: number; to?: number }) {
  const size = lengthMm * scale;
  const ticks = [];
  for (let n = 0; n <= Math.floor(lengthMm); n++) {
    const major = n % 5 === 0;
    if (!major && scale < 4) continue;
    const at = n * scale;
    ticks.push(vertical
      ? <g key={n}><line x1={major ? 8 : 16} x2={22} y1={at} y2={at} stroke="#94a3b8" />{major && n > 0 && <text x={7} y={at + 3} fontSize={9} fill="#475569" textAnchor="middle" transform={`rotate(-90 7 ${at})`}>{n}</text>}</g>
      : <g key={n}><line y1={major ? 8 : 16} y2={22} x1={at} x2={at} stroke="#94a3b8" />{major && n > 0 && <text x={at} y={8} fontSize={9} fill="#475569" textAnchor="middle">{n}</text>}</g>);
  }
  const band = from !== undefined && to !== undefined ? (vertical ? <rect x={0} width={22} y={from} height={Math.max(1, to - from)} fill="#3d6fb5" opacity={0.22} /> : <rect y={0} height={22} x={from} width={Math.max(1, to - from)} fill="#3d6fb5" opacity={0.22} />) : null;
  return <svg aria-hidden="true" className="block overflow-visible" width={vertical ? 22 : size} height={vertical ? size : 22}>{band}{ticks}</svg>;
}

/** A small picture of a design, drawn the same way the tag itself prints. */
function DesignCard({ name, url, active, onClick }: { name: string; url?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cx("group w-full rounded-xl border p-2 text-left transition-colors", active ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400")}>
      <span className="block h-21.5 overflow-hidden rounded-lg bg-slate-100 p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <span className="text-xs text-slate-400">…</span>}
      </span>
      <span className="mt-1.5 flex items-start gap-1 text-xs font-medium leading-4 text-slate-800">{active && <Check className="mt-0.5 h-3 w-3 shrink-0" />}<span>{name}</span></span>
    </button>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-700">{label}</span>{children}</div>;

export type PrinterDetails = {
  name: string;
  offline: boolean;
  isDefault: boolean;
  driver: string | null;
  port: string | null;
  status: string;
  dpi: number | null;
  driverPaper: { widthMm: number; heightMm: number } | null;
  waitingJobs: number;
};

/** Visual tag editor: drag items on the tag, choose one to change it in the panel on the right. */
export function LabelDesigner({ settings, onChange, samples, usingSample, printers, directAvailable, printerQueue, changed, onRefreshPrinters, onSave, onTestPrint, saving }: {
  settings: LabelSettings;
  onChange: (settings: LabelSettings) => void;
  samples: { garment: LabelData; bag: LabelData };
  usingSample: boolean;
  printers: PrinterDetails[];
  directAvailable: boolean;
  printerQueue?: ReactNode;
  changed: boolean;
  onRefreshPrinters: () => void;
  onSave: () => void;
  onTestPrint: (kind: Kind) => void;
  saving: boolean;
}) {
  const [kind, setKind] = useState<Kind>("garment");
  const [tab, setTab] = useState<"design" | "print">("design");
  const [selected, setSelected] = useState("barcode");
  const [render, setRender] = useState<RenderedLabel | null>(null);
  const [zoomSteps, setZoomSteps] = useState(0);
  const [leftTab, setLeftTab] = useState<"designs" | "add" | "layers">("designs");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [snap, setSnap] = useState(true);
  const [guide, setGuide] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [importError, setImportError] = useState("");
  const [panelWidth, setPanelWidth] = useState(560);
  const panelRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ key: string; startX: number; startY: number; x: number; y: number; anchorX: number; w: number } | null>(null);
  const resizing = useRef<{ handle: ResizeHandle; atX: number; atY: number; x: number; y: number; w: number; h: number; design: LabelDesign } | null>(null);
  const [hoverHandle, setHoverHandle] = useState<ResizeHandle | null>(null);
  const past = useRef<LabelDesign[]>([]);
  const future = useRef<LabelDesign[]>([]);

  const design = kind === "garment" ? settings.garmentDesign : settings.bagDesign;
  const presets = useMemo(() => LABEL_PRESETS.filter((p) => p.kind === kind), [kind]);
  const templates = useMemo(() => settings.templates.filter((t) => t.kind === kind), [settings.templates, kind]);
  const widthDots = Math.round(design.widthMm * DOTS_PER_MM);
  const heightDots = Math.round(design.heightMm * DOTS_PER_MM);
  // Half steps of a printer dot wherever the tag fits. Tag bars are whole dots wide, so they stay even on screen.
  const fit = Math.min((panelWidth - 30) / widthDots, 560 / heightDots);
  const zoom = fit < 1 ? Math.max(0.25, fit) : clamp(Math.floor(fit * 2) / 2 + zoomSteps / 2, 1, 8);
  /** 100% is the tag's real size on a standard screen. */
  const zoomPercent = Math.round((zoom * DOTS_PER_MM * 25.4 * 100) / 96);

  // Fit the tag to its panel, so none of it is hidden.
  useEffect(() => {
    if (!panelRef.current) return;
    const observer = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [tab]);

  const replace = (next: LabelDesign) => onChange(kind === "garment" ? { ...settings, garmentDesign: next } : { ...settings, bagDesign: next });
  /** Every change goes through here, so it can be undone. */
  const setDesign = (next: LabelDesign) => {
    past.current = [...past.current.slice(-49), design];
    future.current = [];
    replace(next);
  };
  const undo = () => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(design);
    replace(previous);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(design);
    replace(next);
  };

  // The picture on each design card.
  useEffect(() => {
    let current = true;
    const sample = kind === "garment" ? samples.garment : samples.bag;
    Promise.all([...presets, ...templates].map(async (item) => [item.id, (await renderLabel(item.design, sample)).canvas.toDataURL("image/png")] as const))
      .then((entries) => { if (current) setThumbs(Object.fromEntries(entries)); })
      .catch(() => {});
    return () => { current = false; };
  }, [presets, templates, samples, kind]);

  useEffect(() => {
    let current = true;
    renderLabel(design, kind === "garment" ? samples.garment : samples.bag).then((result) => {
      if (!current) return;
      setRender(result);
      const target = previewRef.current;
      if (!target) return;
      target.width = result.widthDots;
      target.height = result.heightDots;
      target.getContext("2d")!.drawImage(result.canvas, 0, 0);
    });
    return () => { current = false; };
  }, [design, kind, samples, tab]);

  const setElement = (key: string, patch: Partial<LabelElement>) => setDesign({ ...design, elements: { ...design.elements, [key]: { ...design.elements[key], ...patch } } });
  const setBarcode = (patch: Partial<LabelDesign["barcode"]>) => setDesign({ ...design, barcode: { ...design.barcode, ...patch } });
  const nameOf = (key: string) => FIELDS[kind].find(([k]) => k === key)?.[1] ?? (design.elements[key]?.type === "line" ? "Line" : design.elements[key]?.type === "box" ? "Box" : design.elements[key]?.text ? `Text: ${design.elements[key].text}` : "Custom text");

  const addElement = (element: LabelElement, base: string) => {
    let key = base;
    for (let n = 1; design.elements[key]; n++) key = `${base}${n}`;
    setDesign({ ...design, elements: { ...design.elements, [key]: element } });
    setSelected(key);
  };
  const removeElement = (key: string) => {
    const { [key]: _gone, ...rest } = design.elements;
    setDesign({ ...design, elements: rest });
    setSelected("barcode");
  };
  /** Later items are drawn on top of earlier ones. */
  const moveLayer = (key: string, by: number) => {
    const entries = Object.entries(design.elements);
    const from = entries.findIndex(([k]) => k === key);
    const to = clamp(from + by, 0, entries.length - 1);
    const [item] = entries.splice(from, 1);
    entries.splice(to, 0, item);
    setDesign({ ...design, elements: Object.fromEntries(entries) });
  };

  const toDots = (event: ReactPointerEvent) => {
    const rect = previewRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * widthDots, y: ((event.clientY - rect.top) / rect.height) * heightDots };
  };
  const barcodeBox = render?.boxes.find((b) => b.key === "barcode");
  /** Which of the barcode's handles is under the pointer: the corner changes both sizes, the edges change one. */
  const handleAt = (at: { x: number; y: number }): ResizeHandle | null => {
    if (selected !== "barcode" || !barcodeBox || design.barcode.locked) return null;
    const right = Math.abs(at.x - (barcodeBox.x + barcodeBox.w)) <= HANDLE;
    const bottom = Math.abs(at.y - (barcodeBox.y + barcodeBox.h)) <= HANDLE;
    if (right && bottom) return "corner";
    if (right && at.y >= barcodeBox.y && at.y <= barcodeBox.y + barcodeBox.h) return "right";
    if (bottom && at.x >= barcodeBox.x && at.x <= barcodeBox.x + barcodeBox.w) return "bottom";
    return null;
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    const at = toDots(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    // The handles resize the barcode. Everything else on the tag drags.
    const handle = handleAt(at);
    if (handle && barcodeBox) {
      past.current = [...past.current.slice(-49), design];
      future.current = [];
      resizing.current = { handle, atX: at.x, atY: at.y, x: barcodeBox.x, y: barcodeBox.y, w: barcodeBox.w, h: barcodeBox.h, design };
      return;
    }
    const hit = [...(render?.boxes ?? [])].reverse().find((b) => at.x >= b.x - 3 && at.x <= b.x + b.w + 3 && at.y >= b.y - 3 && at.y <= b.y + b.h + 3);
    if (!hit) return;
    setSelected(hit.key);
    const locked = hit.key === "barcode" ? design.barcode.locked : design.elements[hit.key]?.locked;
    if (locked) return;
    past.current = [...past.current.slice(-49), design];
    future.current = [];
    const anchorX = hit.key === "barcode" ? hit.x : design.elements[hit.key].x;
    drag.current = { key: hit.key, startX: at.x, startY: at.y, x: anchorX, y: hit.key === "barcode" ? hit.y : design.elements[hit.key].y, anchorX: hit.x - anchorX, w: hit.w };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const at = toDots(event);
    if (resizing.current) {
      const start = resizing.current;
      const startCode = start.design.barcode;
      const box = { key: "barcode", x: start.x, y: start.y, w: start.w, h: start.h };
      // Follows how far the pointer moved, so grabbing a handle off-centre does not make the barcode jump.
      const wide = Math.max(1, start.w + at.x - start.atX);
      const tall = Math.max(1, start.h + at.y - start.atY);
      const sideways = startCode.rotation === 90 || startCode.rotation === 270;
      const changesX = start.handle !== "bottom";
      const changesY = start.handle !== "right";
      // Bar thickness moves in whole printer dots, so the length changes in steps and always stays scannable.
      const patch: { moduleDots?: number; heightDots?: number } = {};
      if (!isLineBarcode(startCode.type)) {
        patch.moduleDots = clamp(Math.round(changesX ? wide / (start.w / startCode.moduleDots) : tall / (start.h / startCode.moduleDots)), 1, 16);
      } else {
        if (sideways ? changesY : changesX) patch.moduleDots = clamp(Math.round((sideways ? tall : wide) / ((sideways ? start.h : start.w) / startCode.moduleDots)), 1, 16);
        if (sideways ? changesX : changesY) patch.heightDots = clamp(Math.round(startCode.heightDots + (sideways ? at.x - start.atX : at.y - start.atY)), 16, 800);
      }
      // Always worked out from where the drag began, so text moved out of the way comes back when the barcode shrinks.
      replace(resizeBarcode(start.design, box, patch));
      return;
    }
    if (!drag.current) { setHoverHandle(handleAt(at)); return; }
    const d = drag.current;
    let x = Math.max(0, Math.round(d.x + at.x - d.startX));
    let y = Math.max(0, Math.round(d.y + at.y - d.startY));
    if (snap) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
    // Pull to the tag's centre, and show a guide while it is there.
    const middle = x + d.anchorX + d.w / 2;
    const centred = Math.abs(middle - widthDots / 2) < 5;
    if (centred) x = Math.round(widthDots / 2 - d.w / 2 - d.anchorX);
    setGuide(centred);
    if (d.key === "barcode") replace({ ...design, barcode: { ...design.barcode, x, y, centered: false } });
    else replace({ ...design, elements: { ...design.elements, [d.key]: { ...design.elements[d.key], x, y } } });
  };
  const onPointerUp = () => { drag.current = null; resizing.current = null; setGuide(false); };
  /** Grows or shrinks the barcode from the side panel, moving text below it the same way dragging does. */
  const resizeFromPanel = (patch: { moduleDots?: number; heightDots?: number }) => (barcodeBox ? setDesign(resizeBarcode(design, barcodeBox, patch)) : setBarcode(patch));
  /** Finds room on the tag for a new item: the first gap, top to bottom, that its text fits in. */
  const freeSpot = (key: string, size: number) => {
    const taken = render?.boxes ?? [];
    const sample = kind === "garment" ? samples.garment : samples.bag;
    const wide = Math.ceil((sample.texts[key]?.length ?? 8) * size * 0.62) + 4;
    const tall = Math.ceil(size * 1.15);
    for (let y = 6; y + tall <= heightDots - 4; y += 2) {
      for (const x of [10, ...taken.map((b) => b.x + b.w + 8)]) {
        const fits = x + wide <= widthDots - 4 && !taken.some((b) => b.x < x + wide && b.x + b.w > x && b.y < y + tall && b.y + b.h > y);
        if (fits) return { x, y };
      }
    }
    return { x: 10, y: Math.max(6, heightDots - tall - 6) };
  };
  /** Ticked items print. Unticking keeps the item's place, so ticking it again puts it back there. */
  const setOnTag = (key: string, on: boolean) => {
    if (design.elements[key]) { setElement(key, { show: on }); if (on) setSelected(key); return; }
    if (on) { const spot = freeSpot(key, 20); addElement(el(spot.x, spot.y, 20, key === "scanCode"), key); }
  };
  const onKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && selected !== "barcode" && design.elements[selected] && !design.elements[selected].locked) { event.preventDefault(); removeElement(selected); return; }
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const by = event.shiftKey ? 8 : 1;
    if (selected === "barcode") { if (!design.barcode.locked && barcodeBox) setBarcode({ x: Math.max(0, barcodeBox.x + move[0] * by), y: Math.max(0, design.barcode.y + move[1] * by), centered: false }); return; }
    const e = design.elements[selected];
    if (e && !e.locked) setElement(selected, { x: Math.max(0, e.x + move[0] * by), y: Math.max(0, e.y + move[1] * by) });
  };

  /** The largest whole-dot size that fits the tag with its blank space. */
  const autoFit = () => { if (barcodeBox) setDesign(fitBarcode(design, barcodeBox)); };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const template: LabelTemplate = { id: crypto.randomUUID(), name, kind, design };
    onChange({ ...settings, templates: [...settings.templates, template] });
    setTemplateName("");
  };
  const updateTemplates = (next: LabelTemplate[]) => onChange({ ...settings, templates: next });
  const exportDesign = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ name: `${kind} tag`, kind, design }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `drycare-${kind}-tag.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importDesign = async (file: File | undefined) => {
    setImportError("");
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const parsed = labelDesignSchema.safeParse(raw.design ?? raw);
      if (!parsed.success) throw new Error();
      setDesign(parsed.data);
    } catch {
      setImportError("That file is not a Drycare tag design.");
    }
    if (importRef.current) importRef.current.value = "";
  };

  const current = printers.find((p) => p.name === settings.printerName);
  const box = render?.boxes.find((b) => b.key === selected);
  const code = design.barcode;
  const line = isLineBarcode(code.type);
  const element = selected !== "barcode" ? design.elements[selected] : undefined;
  const sizeValue = `${design.widthMm}x${design.heightMm}`;
  const designKey = JSON.stringify(design);
  const longKey = kind === "garment" ? "tagCode" : "bagCode";
  const showsLongNumber = !!design.elements[longKey]?.show;
  const barsAtWidth = barcodeBox ? barcodeLengthMm(design, barcodeBox, code.moduleDots) : null;
  const warnings = render?.warnings ?? [];
  const layers = Object.keys(design.elements).reverse();
  const finishRename = () => {
    const name = renaming?.name.trim();
    if (renaming && name) updateTemplates(settings.templates.map((t) => (t.id === renaming.id ? { ...t, name: name.slice(0, 60) } : t)));
    setRenaming(null);
  };
  const scale = zoom * DOTS_PER_MM;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Top bar: what is being edited, and the actions that apply to all of it. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">Tag designer</h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Label type">
          {(["garment", "bag"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setSelected("barcode"); past.current = []; future.current = []; }} className={cx("rounded-md px-3 py-1 text-sm font-semibold", kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{k === "garment" ? "Garment tag" : "Bag label"}</button>)}
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Section">
          {([["design", "Design"], ["print", "Printer & print"]] as const).map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("rounded-md px-3 py-1 text-sm font-semibold", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{name}</button>)}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {changed && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
          <Button size="sm" variant="secondary" onClick={() => onTestPrint(kind)}><Printer className="h-3.5 w-3.5" />Print one test</Button>
          <Button size="sm" onClick={onSave} loading={saving} disabled={!changed}>Save design</Button>
        </div>
      </div>

      {tab === "print" ? (
        <div className="grid gap-4 bg-slate-50 p-4 lg:grid-cols-2">
          {directAvailable && (
            <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4">
                <div className="min-w-65 flex-1"><Field label="Tag printer"><Select value={settings.printerName} onChange={(e) => onChange({ ...settings, printerName: e.target.value })}><option value="">Choose a printer</option>{printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.offline ? " (offline)" : ""}</option>)}</Select></Field></div>
                <Button variant="secondary" onClick={onRefreshPrinters}><RefreshCw className="h-4 w-4" />Refresh</Button>
              </div>
              <div className="space-y-3 p-4">
                {printerQueue}
                {current ? (
                  <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {[["Status", current.status], ["Driver", current.driver ?? "Not reported"], ["Connected on", current.port ?? "Not reported"], ["Resolution", current.dpi ? `${current.dpi} dpi` : "Not reported"], ["Paper set in Windows", current.driverPaper ? `${current.driverPaper.widthMm} × ${current.driverPaper.heightMm} mm` : "Not reported"], ["Jobs waiting", String(current.waitingJobs)]].map(([name, value]) => <div key={name} className="flex justify-between gap-3 border-b border-slate-100 pb-2"><dt className="text-slate-500">{name}</dt><dd className={cx("text-right font-medium", name === "Status" && current.offline ? "text-red-700" : "text-slate-900")}>{value}</dd></div>)}
                  </dl>
                ) : <p className="text-sm text-slate-500">Choose a printer to see its details.</p>}
                {current?.dpi && current.dpi !== 203 && <Alert tone="amber">This printer is {current.dpi} dpi. Tags are designed for 203 dpi printers, so they will print at a different size.</Alert>}
                <p className="text-xs leading-5 text-slate-500">Tag size, darkness and speed are sent from here with every print, so you do not need to change them in Windows printer properties. Status comes from Windows, which cannot always tell when a printer was just switched off or has run out of tags.</p>
              </div>
            </div>
          )}
          <div className="grid content-start gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <h3 className="text-sm font-semibold text-slate-900 sm:col-span-2">Print quality</h3>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Print darkness</span>
              <div className="flex items-center gap-2"><span className="text-xs text-slate-500">Lighter</span><Stepper label="print darkness" value={settings.density} min={0} max={15} onChange={(density) => onChange({ ...settings, density })} /><span className="text-xs text-slate-500">Darker</span></div>
            </div>
            <div><span className="mb-1 block text-sm font-medium text-slate-700">Print speed</span><Stepper label="print speed" value={settings.speed} min={1} max={6} onChange={(speed) => onChange({ ...settings, speed })} /><span className="mt-1 block text-xs text-slate-500">Slower is sharper on taffeta.</span></div>
            <Field label="Gap between tags (mm)"><Input type="number" min={0} max={25} step={0.5} value={settings.gapMm} onChange={(e) => onChange({ ...settings, gapMm: clamp(Number(e.target.value) || 0, 0, 25) })} /></Field>
            <Field label="Copies of each"><Input type="number" min={1} max={5} value={settings.copies} onChange={(e) => onChange({ ...settings, copies: clamp(Number(e.target.value) || 1, 1, 5) })} /></Field>
          </div>
          <div className="grid content-start gap-4 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Options</h3>
            {directAvailable && <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={settings.autoPrintOnOrder} onChange={(e) => onChange({ ...settings, autoPrintOnOrder: e.target.checked })} /><span><span className="font-medium text-slate-900">Print tags automatically for each new order</span><span className="block text-xs text-slate-500">Tags print as soon as the order is created. An order is only printed automatically once. Reprint from the order at any time.</span></span></label>}
            <Field label="Customer name on tag"><Select value={settings.customerOnTag} onChange={(e) => onChange({ ...settings, customerOnTag: e.target.value as LabelSettings["customerOnTag"] })}><option value="first_name">First name only</option><option value="full_name">Full name</option><option value="none">Don&apos;t print</option></Select></Field>
          </div>
        </div>
      ) : (
        <div className="grid xl:grid-cols-[264px_minmax(0,1fr)_320px]">
          {/* Left: designs, things to add, and everything on the tag. */}
          <div className="border-slate-200 xl:border-r">
            <div className="flex gap-1 border-b border-slate-200 p-2" role="tablist" aria-label="Tools">
              {([["designs", "Designs"], ["add", "On tag"], ["layers", "Layers"]] as const).map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={leftTab === k} onClick={() => setLeftTab(k)} className={cx("flex-1 rounded-md px-2 py-1.5 text-sm font-semibold", leftTab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{name}</button>)}
            </div>
            {leftTab === "designs" && (
              <div className="max-h-180 overflow-y-auto">
                <Section title="Ready-made">
                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">{presets.map((p) => <DesignCard key={p.id} name={p.name} url={thumbs[p.id]} active={JSON.stringify(p.design) === designKey} onClick={() => { setDesign(p.design); setSelected("barcode"); }} />)}</div>
                </Section>
                <Section title="My designs">
                  {templates.length === 0 && <p className="text-xs text-slate-500">Save a design here to reuse it.</p>}
                  {templates.map((t) => (
                    <div key={t.id}>
                      <DesignCard name={t.name} url={thumbs[t.id]} active={JSON.stringify(t.design) === designKey} onClick={() => setDesign(t.design)} />
                      {renaming?.id === t.id ? (
                        <div className="mt-1 flex gap-1"><Input autoFocus aria-label="New name" value={renaming.name} maxLength={60} onChange={(e) => setRenaming({ id: t.id, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") finishRename(); if (e.key === "Escape") setRenaming(null); }} /><Button size="sm" variant="secondary" onClick={finishRename}>OK</Button></div>
                      ) : (
                        <div className="mt-0.5 flex justify-end">
                          <IconButton label={`Rename ${t.name}`} onClick={() => setRenaming({ id: t.id, name: t.name })}><Pencil className="h-3.5 w-3.5" /></IconButton>
                          <IconButton label={`Copy ${t.name}`} onClick={() => updateTemplates([...settings.templates, { ...t, id: crypto.randomUUID(), name: `${t.name} copy`.slice(0, 60) }])}><Copy className="h-3.5 w-3.5" /></IconButton>
                          <IconButton label={`Delete ${t.name}`} onClick={() => updateTemplates(settings.templates.filter((x) => x.id !== t.id))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-1"><Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Name this design" aria-label="Design name" maxLength={60} /><Button size="sm" variant="secondary" onClick={saveTemplate} disabled={!templateName.trim()}>Save</Button></div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={exportDesign}><Download className="h-3.5 w-3.5" />Export</Button>
                    <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()}><Upload className="h-3.5 w-3.5" />Import</Button>
                    <input ref={importRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import a design file" onChange={(e) => importDesign(e.target.files?.[0])} />
                  </div>
                  {importError && <p className="text-xs text-red-700">{importError}</p>}
                </Section>
              </div>
            )}
            {leftTab === "add" && (
              <div className="max-h-180 overflow-y-auto">
                <Section title="Shapes and text">
                  <div className="grid grid-cols-3 gap-2">
                    {([["Text", <Type key="t" className="h-5 w-5" />, () => addElement({ ...el(16, 16, 24), text: "Your text" }, "custom")], ["Line", <Minus key="l" className="h-5 w-5" />, () => addElement({ ...el(16, Math.round(heightDots / 2), 8), type: "line", w: widthDots - 32, h: 2 }, "line")], ["Box", <Square key="b" className="h-5 w-5" />, () => addElement({ ...el(16, 16, 8), type: "box", w: 120, h: 60 }, "box")]] as [string, ReactNode, () => void][]).map(([name, icon, add]) => <button key={name} type="button" onClick={add} className="grid justify-items-center gap-1 rounded-xl border border-slate-200 py-3 text-xs font-medium text-slate-800 hover:border-slate-400">{icon}{name}</button>)}
                  </div>
                </Section>
                <Section title="On the tag">
                  <p className="text-xs leading-5 text-slate-500">Tick what you want printed, then drag it into place on the tag.</p>
                  <div className="space-y-0.5">{FIELDS[kind].map(([key, name]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"><input type="checkbox" checked={!!design.elements[key]?.show} onChange={(e) => setOnTag(key, e.target.checked)} />{name}</label>)}</div>
                  <p className="text-xs leading-5 text-slate-500">Change your store code in <a href="/settings#branches" target="_blank" rel="noreferrer" className="font-semibold text-slate-800 underline underline-offset-2">Business settings, Branches</a>.</p>
                </Section>
                <Section title="Tag">
                  <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={design.border} onChange={(e) => setDesign({ ...design, border: e.target.checked })} />Border around the tag</label>
                </Section>
              </div>
            )}
            {leftTab === "layers" && (
              <div className="max-h-180 overflow-y-auto p-2">
                <p className="px-2 pb-2 text-xs text-slate-500">Top of the list prints on top.</p>
                {[...layers.map((key) => ({ key, name: nameOf(key), show: design.elements[key].show, locked: design.elements[key].locked, type: design.elements[key].type as string })), { key: "barcode", name: "Barcode", show: code.show, locked: code.locked, type: "barcode" }].map((layer) => (
                  <div key={layer.key} className={cx("flex items-center rounded-lg pl-2", selected === layer.key ? "bg-slate-100" : "hover:bg-slate-50")}>
                    <button type="button" onClick={() => setSelected(layer.key)} aria-current={selected === layer.key} className={cx("flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm", layer.show ? "text-slate-800" : "text-slate-400")}>
                      <span className="shrink-0 text-slate-400">{layer.type === "barcode" ? <Barcode className="h-3.5 w-3.5" /> : layer.type === "line" ? <Minus className="h-3.5 w-3.5" /> : layer.type === "box" ? <Square className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />}</span>
                      <span className="truncate">{layer.name}</span>
                    </button>
                    <IconButton label={`${layer.show ? "Hide" : "Show"} ${layer.name}`} onClick={() => (layer.key === "barcode" ? setBarcode({ show: !layer.show }) : setElement(layer.key, { show: !layer.show }))}>{layer.show ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</IconButton>
                    <IconButton label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`} onClick={() => (layer.key === "barcode" ? setBarcode({ locked: !layer.locked }) : setElement(layer.key, { locked: !layer.locked }))}>{layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 opacity-40" />}</IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Centre: the tag itself. */}
          <div className="flex min-w-0 flex-col bg-slate-50">
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5">
              <IconButton label="Undo" onClick={undo}><Undo2 className="h-4 w-4" /></IconButton>
              <IconButton label="Redo" onClick={redo}><Redo2 className="h-4 w-4" /></IconButton>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <IconButton label="Zoom out" disabled={zoom <= 1} onClick={() => setZoomSteps((z) => z - 1)}><ZoomOut className="h-4 w-4" /></IconButton>
              <span className="min-w-12 text-center text-xs font-semibold tabular-nums text-slate-700">{zoomPercent}%</span>
              <IconButton label="Zoom in" disabled={zoom >= 8} onClick={() => setZoomSteps((z) => z + 1)}><ZoomIn className="h-4 w-4" /></IconButton>
              <button type="button" onClick={() => setZoomSteps(0)} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">Fit</button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <label className="flex items-center gap-1.5 px-1 text-xs font-medium text-slate-700"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />Snap to 0.5 mm</label>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="w-36"><Select aria-label="Tag size" value={LABEL_SIZES.some(([w, h]) => `${w}x${h}` === sizeValue) ? sizeValue : ""} onChange={(e) => { if (!e.target.value) return; const [w, h] = e.target.value.split("x").map(Number); setDesign({ ...design, widthMm: w, heightMm: h }); }}><option value="">Custom size</option>{LABEL_SIZES.map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w} × {h} mm</option>)}</Select></div>
                <div className="w-18"><Input aria-label="Tag width in mm" type="number" min={20} max={150} value={design.widthMm} onChange={(e) => setDesign({ ...design, widthMm: clamp(Number(e.target.value) || 20, 20, 150) })} /></div>
                <span className="text-xs text-slate-500">×</span>
                <div className="w-18"><Input aria-label="Tag height in mm" type="number" min={15} max={150} value={design.heightMm} onChange={(e) => setDesign({ ...design, heightMm: clamp(Number(e.target.value) || 15, 15, 150) })} /></div>
              </div>
            </div>
            <div ref={panelRef} className="flex flex-1 overflow-auto p-3" style={{ backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
              <div className="mx-auto grid h-max w-max grid-cols-[22px_auto] grid-rows-[22px_auto]">
                <span aria-hidden="true" className="grid place-items-center text-[9px] font-semibold text-slate-500">mm</span>
                <Ruler lengthMm={design.widthMm} scale={scale} from={box ? box.x * zoom : undefined} to={box ? (box.x + box.w) * zoom : undefined} />
                <Ruler vertical lengthMm={design.heightMm} scale={scale} from={box ? box.y * zoom : undefined} to={box ? (box.y + box.h) * zoom : undefined} />
                <div className="relative" style={{ width: widthDots * zoom, height: heightDots * zoom }}>
                  <canvas ref={previewRef} tabIndex={0} onKeyDown={onKey} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute inset-0 h-full w-full cursor-move touch-none bg-white shadow-lg ring-1 ring-slate-300 focus:outline-2 focus:outline-offset-2 focus:outline-[#3d6fb5]" style={{ imageRendering: "pixelated", cursor: hoverHandle ? RESIZE_CURSOR[hoverHandle] : undefined }} aria-label="Tag preview. Use the arrow keys to move the selected item. Delete removes it." />
                  {box && <span aria-hidden="true" className="pointer-events-none absolute rounded-sm border-2 border-[#3d6fb5]" style={{ left: (box.x - 2) * zoom, top: (box.y - 2) * zoom, width: (box.w + 4) * zoom, height: (box.h + 4) * zoom }} />}
                  {selected === "barcode" && barcodeBox && !code.locked && (
                    <>
                      <span aria-hidden="true" data-handle="right" className="pointer-events-none absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-[#3d6fb5]" style={{ left: (barcodeBox.x + barcodeBox.w) * zoom - 7, top: (barcodeBox.y + barcodeBox.h / 2) * zoom - 7 }} />
                      <span aria-hidden="true" data-handle="bottom" className="pointer-events-none absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-[#3d6fb5]" style={{ left: (barcodeBox.x + barcodeBox.w / 2) * zoom - 7, top: (barcodeBox.y + barcodeBox.h) * zoom - 7 }} />
                      <span aria-hidden="true" data-handle="corner" className="pointer-events-none absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-[#3d6fb5]" style={{ left: (barcodeBox.x + barcodeBox.w) * zoom - 7, top: (barcodeBox.y + barcodeBox.h) * zoom - 7 }} />
                    </>
                  )}
                  {guide && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-[#d9661b]" style={{ left: (widthDots / 2) * zoom }} />}
                </div>
              </div>
            </div>
            {/* Status bar: the facts about this tag, and whether it is safe to print. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <span><strong className="font-semibold text-slate-900">{design.widthMm} × {design.heightMm} mm</strong> · 203 dpi</span>
              {render?.barcodeMm && <span>Barcode <strong className="font-semibold text-slate-900">{render.barcodeMm.width.toFixed(1)} × {render.barcodeMm.height.toFixed(1)} mm</strong></span>}
              {line && <span>Bars {(code.moduleDots / DOTS_PER_MM).toFixed(3)} mm</span>}
              {directAvailable && current && <span>{current.name}: <span className={current.offline ? "font-semibold text-red-700" : ""}>{current.status}</span></span>}
              <span className={cx("ml-auto flex items-center gap-1 font-semibold", warnings.length ? "text-amber-700" : "text-emerald-700")}>{warnings.length ? <CircleAlert className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}{warnings.length ? `${warnings.length} to check` : "Ready to print"}</span>
            </div>
            {(usingSample || warnings.length > 0 || showsLongNumber) && (
              <div className="space-y-2 border-t border-slate-200 p-3">
                {showsLongNumber && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    <span>This design prints the full {kind === "garment" ? "tag" : "bag"} number. The barcode only holds {settings.scanDigits} digits.</span>
                    <Button size="sm" variant="secondary" onClick={() => { setDesign(withShortNumber(design, kind)); setSelected("scanCode"); }}>Print the barcode number instead</Button>
                  </div>
                )}
                {warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}
                {usingSample && <Alert tone="blue">This preview uses sample details, with an all-zero barcode number and order number 00000. Each real tag prints its own numbers and garment.</Alert>}
              </div>
            )}
          </div>

          {/* Right: whatever is selected. */}
          <div className="border-slate-200 xl:border-l">
            <div className="border-b border-slate-200 p-3">
              <Select aria-label="Choose an item to edit" value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="barcode">Barcode</option>
                {Object.keys(design.elements).map((key) => <option key={key} value={key}>{nameOf(key)}</option>)}
              </Select>
            </div>

            {selected === "barcode" && (
              <>
                <Section title="Type">
                  <Select aria-label="Barcode type" value={code.type} onChange={(e) => setDesign(withBarcodeType(design, e.target.value as LabelDesign["barcode"]["type"], kind))}>{BARCODE_TYPES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}</Select>
                  <Field label="Barcode length" hint="For new orders. Tags already issued keep their number and still scan.">
                    <Select value={settings.scanDigits} onChange={(e) => onChange(withScanDigits(settings, Number(e.target.value)))}>
                      {SCAN_DIGIT_OPTIONS.map(([digits, label]) => <option key={digits} value={digits}>{label}</option>)}
                    </Select>
                  </Field>
                </Section>
                <Section title="Size" action={<button type="button" onClick={autoFit} className="text-xs font-semibold text-slate-900 underline underline-offset-4">Auto-fit</button>}>
                  <Row label={line ? "Width" : "Square size"}><Stepper label={line ? "barcode width" : "square size"} value={code.moduleDots} display={line && barsAtWidth ? `${barsAtWidth.toFixed(1)} mm` : undefined} min={1} max={16} onChange={(moduleDots) => resizeFromPanel({ moduleDots })} /></Row>
                  {line && <Row label="Height"><Stepper label="barcode height" value={mm(code.heightDots)} unit=" mm" min={2} max={100} step={0.5} onChange={(h) => resizeFromPanel({ heightDots: Math.round(h * DOTS_PER_MM) })} /></Row>}
                  <p className="text-xs leading-5 text-slate-500">{line ? "Width moves in steps, because each bar is a whole number of printer dots. Height moves freely. You can also drag the blue squares on the barcode." : `Each square is ${(code.moduleDots / DOTS_PER_MM).toFixed(3)} mm. Needs a 2D scanner.`}</p>
                  {line && code.moduleDots === 1 && <Button size="sm" onClick={() => setBarcode({ moduleDots: 2, compact: true, centered: true })}>Fix: use thicker bars</Button>}
                </Section>
                <Section title="Position">
                  <Segments label="Orientation" value={code.rotation} options={[[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]]} onChange={(rotation) => setBarcode({ rotation, centered: false, x: barcodeBox?.x ?? code.x })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From left (mm)"><Input type="number" step={0.5} min={0} value={mm(barcodeBox?.x ?? code.x)} onChange={(e) => setBarcode({ x: Math.max(0, Math.round(Number(e.target.value) * DOTS_PER_MM)), centered: false })} /></Field>
                    <Field label="From top (mm)"><Input type="number" step={0.5} min={0} value={mm(code.y)} onChange={(e) => setBarcode({ y: Math.max(0, Math.round(Number(e.target.value) * DOTS_PER_MM)) })} /></Field>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-700">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={code.show} onChange={(e) => setBarcode({ show: e.target.checked })} />Show</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={code.centered} onChange={(e) => setBarcode({ centered: e.target.checked })} />Centre</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={code.locked} onChange={(e) => setBarcode({ locked: e.target.checked })} />Lock</label>
                  </div>
                </Section>
              </>
            )}

            {element && (
              <>
                {element.type === "text" ? (
                  <Section title="Text">
                    {element.text !== undefined && <Field label="Your text"><Input value={element.text} maxLength={120} onChange={(e) => setElement(selected, { text: e.target.value })} /></Field>}
                    <Row label="Font size"><Stepper label="font size" value={element.size} min={8} max={120} step={2} onChange={(size) => setElement(selected, { size })} /></Row>
                    <Field label="Font"><Select value={element.font} onChange={(e) => setElement(selected, { font: e.target.value as LabelElement["font"] })}><option value="dm">DM Sans</option><option value="urbanist">Urbanist</option><option value="arial">Arial</option></Select></Field>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={element.bold} onChange={(e) => setElement(selected, { bold: e.target.checked })} />Bold</label>
                    <Segments label="Align text from its position" value={element.align} options={[["left", "Left"], ["center", "Centre"], ["right", "Right"]]} onChange={(align) => setElement(selected, { align })} />
                    <Segments label="Rotation" value={element.rotation} options={[[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]]} onChange={(rotation) => setElement(selected, { rotation })} />
                  </Section>
                ) : (
                  <Section title="Size">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Width (mm)"><Input type="number" step={0.5} min={0.5} value={mm(element.w ?? 80)} onChange={(e) => setElement(selected, { w: clamp(Math.round(Number(e.target.value) * DOTS_PER_MM), 1, 1600) })} /></Field>
                      <Field label="Height (mm)"><Input type="number" step={0.125} min={0.125} value={mm(element.h ?? 2)} onChange={(e) => setElement(selected, { h: clamp(Math.round(Number(e.target.value) * DOTS_PER_MM), 1, 1600) })} /></Field>
                    </div>
                  </Section>
                )}
                <Section title="Position">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From left (mm)"><Input type="number" step={0.5} min={0} value={mm(element.x)} onChange={(e) => setElement(selected, { x: Math.max(0, Math.round(Number(e.target.value) * DOTS_PER_MM)) })} /></Field>
                    <Field label="From top (mm)"><Input type="number" step={0.5} min={0} value={mm(element.y)} onChange={(e) => setElement(selected, { y: Math.max(0, Math.round(Number(e.target.value) * DOTS_PER_MM)) })} /></Field>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setElement(selected, { align: "left", x: 16 })}>Left</Button>
                    <Button size="sm" variant="secondary" onClick={() => setElement(selected, { align: "center", x: Math.round(widthDots / 2) })}>Centre</Button>
                    <Button size="sm" variant="secondary" onClick={() => setElement(selected, { align: "right", x: widthDots - 16 })}>Right</Button>
                  </div>
                </Section>
                <Section title="Item">
                  <div className="flex flex-wrap items-center gap-1">
                    <IconButton label={element.show ? "Hide" : "Show"} onClick={() => setElement(selected, { show: !element.show })}>{element.show ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</IconButton>
                    <IconButton label={element.locked ? "Unlock" : "Lock"} active={element.locked} onClick={() => setElement(selected, { locked: !element.locked })}>{element.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</IconButton>
                    <IconButton label="Bring forward" onClick={() => moveLayer(selected, 1)}><ArrowUp className="h-4 w-4" /></IconButton>
                    <IconButton label="Send backward" onClick={() => moveLayer(selected, -1)}><ArrowDown className="h-4 w-4" /></IconButton>
                    {(element.type !== "text" || element.text !== undefined) && <IconButton label="Duplicate" onClick={() => addElement({ ...element, x: element.x + 8, y: element.y + 8 }, element.type === "text" ? "custom" : element.type)}><Copy className="h-4 w-4" /></IconButton>}
                    <IconButton label="Remove from tag" onClick={() => removeElement(selected)}><Trash2 className="h-4 w-4" /></IconButton>
                  </div>
                </Section>
              </>
            )}
            <div className="border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={() => { setDesign(presets[0].design); setSelected("barcode"); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"><RotateCcw className="h-3.5 w-3.5" />Restore default design</button>
              <p className="mt-2 text-xs leading-5 text-slate-500">Arrow keys move the selected item one dot. Shift + arrow moves 1 mm. Ctrl+Z undoes.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
