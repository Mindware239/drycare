"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Circle, Printer } from "lucide-react";
import { GARMENT_DESIGN_38_LINE, GARMENT_DESIGN_38_QR, el, fitBarcodeToDigits, sampleScanCode, type LabelDesign } from "@drycare/shared";
import { Alert, Button, Field, Input, cx } from "@/components/ui";
import type { LabelData } from "@/lib/labelRender";

export type ScannerSample = { id: number; title: string; value: string; design: LabelDesign };

/** A heading saying which test this is, and the code in words where there is room. */
const textOnly = (design: LabelDesign, codeTop?: number): LabelDesign => ({
  ...design,
  elements: { orderNumber: el(10, 8, 22, true), ...(codeTop ? { tagCode: el(10, codeTop, 20) } : {}) },
});
const qr = (moduleDots: number, top: number, codeTop?: number): LabelDesign => ({ ...textOnly(GARMENT_DESIGN_38_QR, codeTop), barcode: { ...GARMENT_DESIGN_38_QR.barcode, moduleDots, y: top, centered: true } });

/** From easiest to read to hardest, using a code as long as this shop's real tags where it matters. */
export const scannerSamples = (digits: number): ScannerSample[] => [
  { id: 1, title: "TEST 1 Thick line", value: "DC1", design: { ...textOnly(GARMENT_DESIGN_38_LINE, 130), barcode: { ...GARMENT_DESIGN_38_LINE.barcode, moduleDots: 4, y: 36, heightDots: 80 } } },
  { id: 2, title: "TEST 2 Real tag line", value: sampleScanCode(digits), design: fitBarcodeToDigits({ ...textOnly(GARMENT_DESIGN_38_LINE, 130), barcode: { ...GARMENT_DESIGN_38_LINE.barcode, y: 36, heightDots: 80 } }, digits) },
  { id: 3, title: "TEST 3 Large QR", value: "DCTEST-2026-00001-03", design: qr(7, 62) },
  { id: 4, title: "TEST 4 Small QR", value: "DCTEST-2026-00001-04", design: qr(5, 56, 186) },
];
export const sampleData = (s: ScannerSample): LabelData => ({ barcodeValue: s.value, texts: { orderNumber: s.title, tagCode: s.value } });

function advice(passed: Set<number>) {
  if (!passed.size) return null;
  if (passed.has(4)) return { text: "Your scanner reads QR codes, even small ones. Use a QR code: it is the smallest and most reliable on taffeta.", sample: 4 };
  if (passed.has(3)) return { text: "Your scanner reads large QR codes. Use a QR code of about 18 mm, or increase the darkness and test the small one again.", sample: 3 };
  if (passed.has(2)) return { text: "Your scanner reads line barcodes at real tag length. Use a line barcode.", sample: 2 };
  return { text: "Your scanner reads thick line barcodes only, so normal tag bars are too fine for it on a tag this narrow. Try darker print, a wider tag, or a scanner that reads QR codes.", sample: 1 };
}

/** Prints four sample tags, then checks which ones the scanner reads. A scanner types like a keyboard, so a text box is all it needs. */
export function ScannerTest({ digits, onPrint, onUse, disabled, approvedScanners }: { digits: number; onPrint: () => void; onUse: (sample: ScannerSample) => void; disabled?: boolean; approvedScanners?: string[] }) {
  const samples = scannerSamples(digits);
  const [value, setValue] = useState("");
  const [passed, setPassed] = useState<Set<number>>(new Set());
  const [last, setLast] = useState<{ text: string; matched: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const check = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const match = samples.find((s) => s.value === text);
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
      {!!approvedScanners?.length && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><strong className="font-semibold text-slate-800">Approved scanners:</strong> {approvedScanners.join(", ")}.</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          <Field label="Scan here">
            <Input ref={input} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); check(value); } }} placeholder="Click here, then scan a test tag" />
          </Field>
          {last && <p className={cx("text-sm", last.matched ? "text-brand-700" : "text-red-700")}>{last.matched ? "Read correctly: " : "Read, but it does not match a test tag: "}<span className="font-mono">{last.text}</span></p>}
          <p className="text-xs text-slate-500">If nothing appears, the scanner did not read that tag at all.</p>
        </div>
        <ul className="space-y-1.5">
          {samples.map((s) => (
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
          <Button onClick={() => onUse(samples.find((s) => s.id === tip.sample)!)}>Use this barcode</Button>
        </div>
      )}
    </div>
  );
}
