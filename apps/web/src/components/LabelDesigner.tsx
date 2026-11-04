"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { BAG_DESIGN_CODE128, BAG_DESIGN_QR, GARMENT_DESIGN_CODE128, GARMENT_DESIGN_QR, type LabelDesign, type LabelSettings } from "@drycare/shared";
import { Alert, Button, Field, Input, Select, cx } from "@/components/ui";
import { DOTS_PER_MM, renderLabel, type LabelData, type RenderedLabel } from "@/lib/labelRender";

const NAMES: Record<string, string> = {
  orderNumber: "Order number", count: "Tag count (1/3)", tagCode: "Tag number", garment: "Garment", service: "Service", colour: "Colour", customer: "Customer", due: "Due date",
  title: "Heading", pieces: "Pieces", bagCode: "Bag number", info: "Store and customer",
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** How close to the barcode's corner, in printer dots, counts as grabbing the resize handle. */
const HANDLE = 8;

function Stepper({ label, value, unit, onChange, min, max, step = 1 }: { label: string; value: number; unit?: string; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
      <span className="min-w-[52px] text-center text-sm font-semibold tabular-nums">{value}{unit ?? ""}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

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

/** Visual tag editor: drag items on the preview, change sizes with the + and - buttons. */
export function LabelDesigner({ settings, onChange, samples, printers, directAvailable, onRefreshPrinters, onSave, onTestPrint, saving }: {
  settings: LabelSettings;
  onChange: (settings: LabelSettings) => void;
  samples: { garment: LabelData; bag: LabelData };
  printers: PrinterDetails[];
  directAvailable: boolean;
  onRefreshPrinters: () => void;
  onSave: () => void;
  onTestPrint: (kind: "garment" | "bag") => void;
  saving: boolean;
}) {
  const [kind, setKind] = useState<"garment" | "bag">("garment");
  const [selected, setSelected] = useState("barcode");
  const [render, setRender] = useState<RenderedLabel | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ key: string; startX: number; startY: number; x: number; y: number } | null>(null);
  const resizing = useRef<{ x: number; y: number; w: number; h: number; moduleDots: number; heightDots: number } | null>(null);

  const design = kind === "garment" ? settings.garmentDesign : settings.bagDesign;
  const presets = kind === "garment" ? { code128: GARMENT_DESIGN_CODE128, qrcode: GARMENT_DESIGN_QR } : { code128: BAG_DESIGN_CODE128, qrcode: BAG_DESIGN_QR };
  const setDesign = (next: LabelDesign) => onChange(kind === "garment" ? { ...settings, garmentDesign: next } : { ...settings, bagDesign: next });
  const zoom = Math.min(3, 560 / (design.widthMm * DOTS_PER_MM));

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
  }, [design, kind, samples]);

  const setElement = (key: string, patch: Partial<LabelDesign["elements"][string]>) => setDesign({ ...design, elements: { ...design.elements, [key]: { ...design.elements[key], ...patch } } });
  const setBarcode = (patch: Partial<LabelDesign["barcode"]>) => setDesign({ ...design, barcode: { ...design.barcode, ...patch } });
  const changeType = (type: LabelDesign["barcode"]["type"]) => setDesign({ ...presets[type], widthMm: design.widthMm, heightMm: design.heightMm });

  const toDots = (event: ReactPointerEvent) => {
    const rect = previewRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * design.widthMm * DOTS_PER_MM, y: ((event.clientY - rect.top) / rect.height) * design.heightMm * DOTS_PER_MM };
  };
  const barcodeBox = render?.boxes.find((b) => b.key === "barcode");
  const onPointerDown = (event: ReactPointerEvent) => {
    const at = toDots(event);
    // The corner handle resizes the barcode. Everything else on the tag drags.
    if (selected === "barcode" && barcodeBox && Math.abs(at.x - (barcodeBox.x + barcodeBox.w)) <= HANDLE && Math.abs(at.y - (barcodeBox.y + barcodeBox.h)) <= HANDLE) {
      event.currentTarget.setPointerCapture(event.pointerId);
      resizing.current = { x: barcodeBox.x, y: barcodeBox.y, w: barcodeBox.w, h: barcodeBox.h, moduleDots: design.barcode.moduleDots, heightDots: design.barcode.heightDots };
      return;
    }
    const hit = [...(render?.boxes ?? [])].reverse().find((b) => at.x >= b.x - 3 && at.x <= b.x + b.w + 3 && at.y >= b.y - 3 && at.y <= b.y + b.h + 3);
    if (!hit) return;
    setSelected(hit.key);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { key: hit.key, startX: at.x, startY: at.y, x: hit.x, y: hit.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const at = toDots(event);
    if (resizing.current) {
      const start = resizing.current;
      const wide = Math.max(1, at.x - start.x);
      const tall = Math.max(1, at.y - start.y);
      const sideways = design.barcode.rotation === 90 || design.barcode.rotation === 270;
      // Bar thickness moves in whole printer dots, so the length changes in steps and always stays scannable.
      const units = (sideways ? start.h : start.w) / start.moduleDots;
      if (design.barcode.type === "qrcode") setBarcode({ moduleDots: clamp(Math.round(wide / units), 1, 16) });
      else setBarcode({ moduleDots: clamp(Math.round((sideways ? tall : wide) / units), 1, 16), heightDots: clamp(Math.round(sideways ? wide : tall), 16, 800), centered: false, x: start.x, y: start.y });
      return;
    }
    if (!drag.current) return;
    const x = Math.max(0, Math.round(drag.current.x + at.x - drag.current.startX));
    const y = Math.max(0, Math.round(drag.current.y + at.y - drag.current.startY));
    if (drag.current.key === "barcode") setBarcode({ x, y, centered: false });
    else setElement(drag.current.key, { x, y });
  };

  const current = printers.find((p) => p.name === settings.printerName);
  const box = render?.boxes.find((b) => b.key === selected);
  const code = design.barcode;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tag designer</h2>
          <p className="text-sm text-slate-500">Drag anything on the tag to move it. Use + and − to change sizes. This preview is exactly what prints.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="tablist" aria-label="Label type">
          {(["garment", "bag"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setSelected("barcode"); }} className={cx("rounded-full px-4 py-1.5 text-sm font-semibold", kind === k ? "bg-slate-900 text-white" : "text-slate-700")}>{k === "garment" ? "Garment tag" : "Bag label"}</button>)}
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          <div className="overflow-auto rounded-xl bg-slate-100 p-5">
            <div className="relative mx-auto" style={{ width: design.widthMm * DOTS_PER_MM * zoom, height: design.heightMm * DOTS_PER_MM * zoom }}>
              <canvas ref={previewRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; resizing.current = null; }} className="absolute inset-0 h-full w-full cursor-move touch-none rounded bg-white shadow-md" style={{ imageRendering: "pixelated" }} aria-label="Tag preview" />
              {box && <span aria-hidden="true" className="pointer-events-none absolute rounded-sm border-2 border-[#3d6fb5]" style={{ left: (box.x - 2) * zoom, top: (box.y - 2) * zoom, width: (box.w + 4) * zoom, height: (box.h + 4) * zoom }} />}
              {selected === "barcode" && barcodeBox && <span aria-hidden="true" title="Drag to resize" className="pointer-events-none absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-[#3d6fb5]" style={{ left: (barcodeBox.x + barcodeBox.w) * zoom - 7, top: (barcodeBox.y + barcodeBox.h) * zoom - 7 }} />}
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Tag {design.widthMm} × {design.heightMm} mm
            {render?.barcodeMm && <> · Barcode <strong>{render.barcodeMm.width.toFixed(1)} × {render.barcodeMm.height.toFixed(1)} mm</strong></>}
          </p>
          {render?.warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}

          <div className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Tag width (mm)"><Input type="number" min={20} max={150} value={design.widthMm} onChange={(e) => setDesign({ ...design, widthMm: clamp(Number(e.target.value) || 20, 20, 150) })} /></Field>
            <Field label="Tag height (mm)"><Input type="number" min={15} max={150} value={design.heightMm} onChange={(e) => setDesign({ ...design, heightMm: clamp(Number(e.target.value) || 15, 15, 150) })} /></Field>
            <Field label="Gap between tags (mm)"><Input type="number" min={0} max={25} step={0.5} value={settings.gapMm} onChange={(e) => onChange({ ...settings, gapMm: clamp(Number(e.target.value) || 0, 0, 25) })} /></Field>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Print darkness</span>
              <div className="flex items-center gap-2"><span className="text-xs text-slate-500">Lighter</span><Stepper label="print darkness" value={settings.density} min={0} max={15} onChange={(density) => onChange({ ...settings, density })} /><span className="text-xs text-slate-500">Darker</span></div>
              {directAvailable && <span className="mt-1 block text-xs text-slate-500">Sent to the printer with every tag.</span>}
            </div>
            <div><span className="mb-1 block text-sm font-medium text-slate-700">Print speed</span><Stepper label="print speed" value={settings.speed} min={1} max={6} onChange={(speed) => onChange({ ...settings, speed })} /></div>
            <Field label="Copies of each"><Input type="number" min={1} max={5} value={settings.copies} onChange={(e) => onChange({ ...settings, copies: clamp(Number(e.target.value) || 1, 1, 5) })} /></Field>
            <Field label="Customer on tag"><Select value={settings.customerOnTag} onChange={(e) => onChange({ ...settings, customerOnTag: e.target.value as LabelSettings["customerOnTag"] })}><option value="first_name">First name only</option><option value="full_name">Full name</option><option value="none">Don&apos;t print</option></Select></Field>
            {directAvailable && (
              <Field label="Tag printer" className="sm:col-span-2"><Select value={settings.printerName} onChange={(e) => onChange({ ...settings, printerName: e.target.value })}><option value="">Choose a printer</option>{printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.offline ? " (offline)" : ""}</option>)}</Select></Field>
            )}
          </div>

          {directAvailable && current && (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Printer details</h3>
                <Button size="sm" variant="secondary" onClick={onRefreshPrinters}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {[
                  ["Status", current.status],
                  ["Driver", current.driver ?? "Not reported"],
                  ["Connected on", current.port ?? "Not reported"],
                  ["Resolution", current.dpi ? `${current.dpi} dpi` : "Not reported"],
                  ["Paper set in Windows", current.driverPaper ? `${current.driverPaper.widthMm} × ${current.driverPaper.heightMm} mm` : "Not reported"],
                  ["Jobs waiting", String(current.waitingJobs)],
                ].map(([name, value]) => <div key={name} className="flex justify-between gap-3"><dt className="text-slate-500">{name}</dt><dd className={cx("text-right font-medium", name === "Status" && current.offline ? "text-red-700" : "text-slate-900")}>{value}</dd></div>)}
              </dl>
              {current.offline && <div className="mt-3"><Alert tone="amber">This printer is offline. Check that it is switched on and its USB cable is connected, then press Refresh.</Alert></div>}
              {current.dpi && current.dpi !== 203 && <div className="mt-3"><Alert tone="amber">This printer is {current.dpi} dpi. Tags are designed for 203 dpi printers, so they will print at a different size.</Alert></div>}
              <p className="mt-3 text-xs text-slate-500">Tag size, darkness and speed come from this page and are sent directly to the printer, so you do not need to change them in Windows printer properties.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className={cx("rounded-xl border p-4", selected === "barcode" ? "border-[#3d6fb5]" : "border-slate-200")} onClick={() => setSelected("barcode")}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Barcode</h3>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={code.show} onChange={(e) => setBarcode({ show: e.target.checked })} />Show</label>
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Barcode type</span>
                <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Barcode type">
                  {([["code128", "1D line barcode"], ["qrcode", "2D QR code"]] as const).map(([value, name]) => <button key={value} type="button" role="radio" aria-checked={code.type === value} onClick={() => { if (code.type !== value) changeType(value); }} className={cx("rounded-full px-3 py-1.5 text-sm font-semibold", code.type === value ? "bg-slate-900 text-white" : "text-slate-700")}>{name}</button>)}
                </div>
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Orientation</span>
                <div className="grid grid-cols-4 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Barcode orientation">
                  {([0, 90, 180, 270] as const).map((degrees) => <button key={degrees} type="button" role="radio" aria-checked={(code.rotation ?? 0) === degrees} onClick={() => setBarcode({ rotation: degrees, centered: false, x: render?.boxes.find((b) => b.key === "barcode")?.x ?? code.x })} className={cx("rounded-full py-1.5 text-sm font-semibold", (code.rotation ?? 0) === degrees ? "bg-slate-900 text-white" : "text-slate-700")}>{degrees}°</button>)}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-700">{code.type === "qrcode" ? "Size" : "Length (bar thickness)"}</span><Stepper label="barcode size" value={code.moduleDots} min={1} max={16} onChange={(moduleDots) => setBarcode({ moduleDots })} /></div>
              {code.type === "code128" && <div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-700">Height</span><Stepper label="barcode height" value={Math.round(code.heightDots / DOTS_PER_MM)} unit=" mm" min={2} max={100} onChange={(mm) => setBarcode({ heightDots: mm * DOTS_PER_MM })} /></div>}
              <p className="text-xs text-slate-500">You can also drag the blue corner of the barcode on the tag to resize it.</p>
              {code.type === "code128" && <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={code.compact ?? true} onChange={(e) => setBarcode({ compact: e.target.checked })} /><span>Short barcode (recommended)<span className="block text-xs text-slate-500">Fits thicker bars that scan more easily. The full number still prints as text.</span></span></label>}
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={code.centered} onChange={(e) => setBarcode({ centered: e.target.checked })} />Centre across the tag</label>
              {code.type === "code128" && code.moduleDots === 1 && <Button size="sm" onClick={() => setBarcode({ moduleDots: 2, compact: true, centered: true })}>Fix: use thicker bars</Button>}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Text</span><span>Font size</span></div>
            {Object.entries(design.elements).map(([key, element]) => (
              <div key={key} onClick={() => setSelected(key)} className={cx("flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5", selected === key && "bg-slate-50")}>
                <label className="flex min-w-0 items-center gap-2 text-sm text-slate-800"><input type="checkbox" checked={element.show} onChange={(e) => setElement(key, { show: e.target.checked })} />{NAMES[key] ?? key}</label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs font-semibold text-slate-600"><input type="checkbox" checked={element.bold} onChange={(e) => setElement(key, { bold: e.target.checked })} />Bold</label>
                  <Stepper label={`${NAMES[key] ?? key} font size`} value={element.size} min={8} max={120} step={2} onChange={(size) => setElement(key, { size })} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} loading={saving}>Save design</Button>
            <Button variant="secondary" onClick={() => onTestPrint(kind)}>Print one test</Button>
            <Button variant="ghost" onClick={() => setDesign(presets[code.type])}><RotateCcw className="h-4 w-4" />Reset</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
