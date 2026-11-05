"use client";

import { Save, Undo2 } from "lucide-react";
import { LABEL_SIZES, isLineBarcode, type LabelDesign } from "@drycare/shared";
import { Alert, Button, Select, cx } from "@/components/ui";
import { Stepper } from "@/components/LabelDesigner";
import { barcodeLengthMm, fitBarcode, resizeBarcode, withBarcodeType } from "@/lib/labelDesign";
import { DOTS_PER_MM, type RenderedLabel } from "@/lib/labelRender";

const TYPES: [LabelDesign["barcode"]["type"], string][] = [["code128", "1D · Code 128"], ["code39", "1D · Code 39"], ["qrcode", "2D · QR code"], ["datamatrix", "2D · Data Matrix"]];

/** Barcode controls on the print page. Tags redraw as these change, and print exactly as shown. */
export function BarcodeAdjust({ kind, onKind, design, onChange, onRollSize, label, changed, saving, onSave, onDiscard }: {
  kind: "garment" | "bag";
  onKind: (kind: "garment" | "bag") => void;
  design: LabelDesign;
  onChange: (design: LabelDesign) => void;
  onRollSize: (widthMm: number, heightMm: number) => void;
  label: RenderedLabel | undefined;
  changed: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const code = design.barcode;
  const line = isLineBarcode(code.type);
  const box = label?.boxes.find((b) => b.key === "barcode");
  const set = (patch: Partial<LabelDesign["barcode"]>) => onChange({ ...design, barcode: { ...code, ...patch } });
  const resize = (patch: { moduleDots?: number; heightDots?: number }) => (box ? onChange(resizeBarcode(design, box, patch)) : set(patch));
  const length = box ? barcodeLengthMm(design, box, code.moduleDots) : null;

  return (
    <section aria-label="Adjust barcode" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900">Adjust barcode</h2>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Which label to adjust">
            {(["garment", "bag"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => onKind(k)} className={cx("rounded-full px-3 py-1 text-sm font-semibold", kind === k ? "bg-slate-900 text-white" : "text-slate-700")}>{k === "garment" ? "Garment tags" : "Bag label"}</button>)}
          </div>
        </div>
        {label?.barcodeMm && <p className="text-sm text-slate-600">Now <strong>{label.barcodeMm.width.toFixed(1)} × {label.barcodeMm.height.toFixed(1)} mm</strong> on a {design.widthMm} × {design.heightMm} mm tag</p>}
      </div>

      <div className="mt-4 grid items-end gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-6">
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Roll size</span>
          <Select aria-label="Roll size" value={`${design.widthMm}x${design.heightMm}`} onChange={(e) => { const [w, h] = e.target.value.split("x").map(Number); onRollSize(w, h); }}>
            {!LABEL_SIZES.some(([w, h]) => w === design.widthMm && h === design.heightMm) && <option value={`${design.widthMm}x${design.heightMm}`}>{design.widthMm} × {design.heightMm} mm</option>}
            {LABEL_SIZES.map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w} × {h} mm</option>)}
          </Select>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Type</span>
          <Select aria-label="Barcode type" value={code.type} onChange={(e) => onChange(withBarcodeType(design, e.target.value as LabelDesign["barcode"]["type"], kind))}>{TYPES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}</Select>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">{line ? "Width" : "Size"}</span>
          <Stepper label={line ? "barcode width" : "barcode size"} value={code.moduleDots} display={line && length ? `${length.toFixed(1)} mm` : undefined} min={1} max={16} onChange={(moduleDots) => resize({ moduleDots })} />
        </div>
        {line && (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Height</span>
            <Stepper label="barcode height" value={Math.round((code.heightDots / DOTS_PER_MM) * 2) / 2} unit=" mm" min={2} max={100} step={0.5} onChange={(mm) => resize({ heightDots: Math.round(mm * DOTS_PER_MM) })} />
          </div>
        )}
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Orientation</span>
          <Select aria-label="Barcode orientation" value={String(code.rotation)} onChange={(e) => set({ rotation: Number(e.target.value) as LabelDesign["barcode"]["rotation"], centered: false, x: box?.x ?? code.x })}>{[0, 90, 180, 270].map((d) => <option key={d} value={d}>{d}°</option>)}</Select>
        </div>
        <Button variant="secondary" disabled={!box} onClick={() => { if (box) onChange(fitBarcode(design, box)); }}>Auto-fit to tag</Button>
      </div>

      {line && <p className="mt-3 text-xs text-slate-500">Width changes in steps because printers print whole dots: each step adds one dot to every bar. A wider barcode scans more easily. Height changes freely.</p>}
      {label?.warnings.length ? <div className="mt-3 space-y-2">{label.warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}</div> : null}

      {changed && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
          <p className="text-sm text-slate-700">These changes will print now. Save them to use on every order.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onDiscard}><Undo2 className="h-3.5 w-3.5" />Undo changes</Button>
            <Button size="sm" onClick={onSave} loading={saving}><Save className="h-3.5 w-3.5" />Save for all orders</Button>
          </div>
        </div>
      )}
    </section>
  );
}
