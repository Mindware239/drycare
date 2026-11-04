"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Circle, Printer } from "lucide-react";
import { GARMENT_DESIGN_CODE128, GARMENT_DESIGN_QR, type LabelDesign } from "@drycare/shared";
import { Alert, Button, Field, Input, cx } from "@/components/ui";
import type { LabelData } from "@/lib/labelRender";

export type ScannerSample = { id: number; title: string; value: string; design: LabelDesign };

const textOnly = (design: LabelDesign): LabelDesign => ({
  ...design,
  elements: Object.fromEntries(Object.entries(design.elements).map(([key, element]) => [key, { ...element, show: key === "orderNumber" || key === "tagCode" }])),
});
const qr = (moduleDots: number): LabelDesign => ({ ...textOnly(GARMENT_DESIGN_QR), barcode: { ...GARMENT_DESIGN_QR.barcode, moduleDots, x: 130, y: 44, centered: true } });

/** From easiest to read to hardest, using a code as long as a real tag number where it matters. */
export const SCANNER_SAMPLES: ScannerSample[] = [
  { id: 1, title: "TEST 1 Thick line", value: "DC1", design: { ...textOnly(GARMENT_DESIGN_CODE128), barcode: { ...GARMENT_DESIGN_CODE128.barcode, moduleDots: 3 } } },
  { id: 2, title: "TEST 2 Real tag line", value: "NEWDEL260000102", design: textOnly(GARMENT_DESIGN_CODE128) },
  { id: 3, title: "TEST 3 Large QR", value: "DCTEST-2026-00001-03", design: qr(8) },
  { id: 4, title: "TEST 4 Small QR", value: "DCTEST-2026-00001-04", design: qr(5) },
];
export const sampleData = (s: ScannerSample): LabelData => ({ barcodeValue: s.value, texts: { orderNumber: s.title, tagCode: s.value } });

function advice(passed: Set<number>) {
  if (!passed.size) return null;
  if (passed.has(4)) return { text: "Your scanner reads QR codes, even small ones. Use a QR code: it is the smallest and most reliable on taffeta.", sample: 4 };
  if (passed.has(3)) return { text: "Your scanner reads large QR codes. Use a QR code of about 21 mm or larger, or increase the darkness and test the small one again.", sample: 3 };
  if (passed.has(2)) return { text: "Your scanner reads line barcodes at real tag length. Use a line barcode.", sample: 2 };
  return { text: "Your scanner reads thick line barcodes only, so full tag numbers are too fine for it on this tag. A wider tag, or darker print, is needed. Share this result with support.", sample: 1 };
}

/** Prints four sample tags, then checks which ones the scanner reads. A scanner types like a keyboard, so a text box is all it needs. */
export function ScannerTest({ onPrint, onUse, disabled }: { onPrint: () => void; onUse: (sample: ScannerSample) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const [passed, setPassed] = useState<Set<number>>(new Set());
  const [last, setLast] = useState<{ text: string; matched: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const check = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const match = SCANNER_SAMPLES.find((s) => s.value === text);
    if (match) setPassed((p) => new Set(p).add(match.id));
    setLast({ text, matched: !!match });
    setValue("");
    input.current?.focus();
  };

  const tip = advice(passed);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Scanner test</h2>
          <p className="text-sm text-slate-500">Prints 4 sample tags. Click the box, then scan each one to see which your scanner can read.</p>
        </div>
        <Button variant="secondary" onClick={onPrint} disabled={disabled}><Printer className="h-4 w-4" />Print 4 test tags</Button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          <Field label="Scan here">
            <Input ref={input} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); check(value); } }} placeholder="Click here, then scan a test tag" />
          </Field>
          {last && <p className={cx("text-sm", last.matched ? "text-brand-700" : "text-red-700")}>{last.matched ? "Read correctly: " : "Read, but it does not match a test tag: "}<span className="font-mono">{last.text}</span></p>}
          <p className="text-xs text-slate-500">If nothing appears, the scanner did not read that tag at all.</p>
        </div>
        <ul className="space-y-1.5">
          {SCANNER_SAMPLES.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm text-slate-800">
              {passed.has(s.id) ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
              {s.title}{passed.has(s.id) ? " — read" : ""}
            </li>
          ))}
        </ul>
      </div>
      {tip && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1"><Alert tone="green">{tip.text}</Alert></div>
          <Button onClick={() => onUse(SCANNER_SAMPLES.find((s) => s.id === tip.sample)!)}>Use this barcode</Button>
        </div>
      )}
    </div>
  );
}
