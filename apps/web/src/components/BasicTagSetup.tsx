"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Printer, RefreshCw, Sparkles } from "lucide-react";
import { BASIC_TAG_SIZE, withBasicTag, type LabelSettings } from "@drycare/shared";
import { renderLabel, type LabelData } from "@/lib/labelRender";
import { Button, Field, Input, Select } from "@/components/ui";
import { SCAN_DIGIT_OPTIONS, Stepper, type PrinterDetails } from "@/components/LabelDesigner";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Tag setup for a plan without the tag designer: the ready-made taffeta tag, with only the printer's own settings to choose. */
export function BasicTagSetup({ settings, onChange, sample, printers, directAvailable, printerQueue, changed, saving, onRefreshPrinters, onSave, onTestPrint }: {
  settings: LabelSettings;
  onChange: (settings: LabelSettings) => void;
  sample: LabelData;
  printers: PrinterDetails[];
  directAvailable: boolean;
  printerQueue?: ReactNode;
  changed: boolean;
  saving: boolean;
  onRefreshPrinters: () => void;
  onSave: () => void;
  onTestPrint: () => void;
}) {
  const [preview, setPreview] = useState("");
  const design = settings.garmentDesign;
  useEffect(() => {
    let current = true;
    renderLabel(design, sample).then((label) => { if (current) setPreview(label.canvas.toDataURL("image/png")); }).catch(() => {});
    return () => { current = false; };
  }, [design, sample]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tag setup</h2>
          <p className="text-sm text-slate-500">Your plan prints the ready-made {BASIC_TAG_SIZE.widthMm} × {BASIC_TAG_SIZE.heightMm} mm taffeta tag.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onTestPrint}><Printer className="h-3.5 w-3.5" />Print one test</Button>
          <Button size="sm" onClick={onSave} loading={saving} disabled={!changed}>Save</Button>
        </div>
      </div>
      <div className="grid gap-4 bg-slate-50 p-4 lg:grid-cols-2">
        <div className="grid content-start gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex justify-center rounded-lg bg-slate-100 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="Preview of the tag" className="rounded-sm border border-slate-300 bg-white" style={{ width: "76mm", imageRendering: "pixelated" }} />}
          </div>
          <Field label="Code on the tag">
            <Select value={settings.basicTagStyle} onChange={(e) => onChange(withBasicTag({ ...settings, basicTagStyle: e.target.value as LabelSettings["basicTagStyle"] }))}>
              <option value="line">Line barcode</option>
              <option value="qr">QR code</option>
            </Select>
          </Field>
          <Field label="Barcode length" hint="For new orders. Tags already issued keep their number and still scan.">
            <Select value={settings.scanDigits} onChange={(e) => onChange(withBasicTag({ ...settings, scanDigits: Number(e.target.value) }))}>
              {SCAN_DIGIT_OPTIONS.map(([digits, label]) => <option key={digits} value={digits}>{label}</option>)}
            </Select>
          </Field>
          <p className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-xs leading-5 text-brand-900">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Need other tag sizes or your own layout? The tag designer is included in higher plans. <a href="/billing" className="font-semibold underline underline-offset-2">See plans</a></span>
          </p>
        </div>
        <div className="grid content-start gap-4">
          {directAvailable && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <Field label="Tag printer">
                    <Select value={settings.printerName} onChange={(e) => onChange({ ...settings, printerName: e.target.value })}>
                      <option value="">Choose a printer</option>
                      {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.offline ? " (offline)" : ""}</option>)}
                    </Select>
                  </Field>
                </div>
                <Button variant="secondary" onClick={onRefreshPrinters}><RefreshCw className="h-4 w-4" />Refresh</Button>
              </div>
              {printerQueue}
            </div>
          )}
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <div><span className="mb-1 block text-sm font-medium text-slate-700">Print darkness</span><Stepper label="print darkness" value={settings.density} min={0} max={15} onChange={(density) => onChange({ ...settings, density })} /></div>
            <div><span className="mb-1 block text-sm font-medium text-slate-700">Print speed</span><Stepper label="print speed" value={settings.speed} min={1} max={6} onChange={(speed) => onChange({ ...settings, speed })} /></div>
            <Field label="Gap between tags (mm)"><Input type="number" min={0} max={25} step={0.5} value={settings.gapMm} onChange={(e) => onChange({ ...settings, gapMm: clamp(Number(e.target.value) || 0, 0, 25) })} /></Field>
            <Field label="Copies of each"><Input type="number" min={1} max={5} value={settings.copies} onChange={(e) => onChange({ ...settings, copies: clamp(Number(e.target.value) || 1, 1, 5) })} /></Field>
            <Field label="Customer name on tag" className="sm:col-span-2">
              <Select value={settings.customerOnTag} onChange={(e) => onChange({ ...settings, customerOnTag: e.target.value as LabelSettings["customerOnTag"] })}>
                <option value="first_name">First name only</option>
                <option value="full_name">Full name</option>
                <option value="none">No name</option>
              </Select>
            </Field>
            {directAvailable && (
              <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
                <input type="checkbox" className="mt-1" checked={settings.autoPrintOnOrder} onChange={(e) => onChange({ ...settings, autoPrintOnOrder: e.target.checked })} />
                <span>Print tags as soon as a new order is created</span>
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
