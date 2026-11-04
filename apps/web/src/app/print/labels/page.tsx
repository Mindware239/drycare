"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Printer, ScanLine, Settings2, TriangleAlert, XCircle } from "lucide-react";
import { DEFAULT_LABEL_SETTINGS, GARMENT_DESIGN_CODE128, GARMENT_DESIGN_QR, labelSettingsSchema, type LabelDesign, type LabelSettings } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { dateOnly } from "@/lib/format";
import { labelToBitmap, renderLabel, type LabelData, type RenderedLabel } from "@/lib/labelRender";
import { Alert, Badge, Button, Select, Spinner } from "@/components/ui";
import { LabelDesigner, type PrinterDetails } from "@/components/LabelDesigner";
import { SCANNER_SAMPLES, ScannerTest, sampleData } from "@/components/ScannerTest";

type Scope = "all" | "bag" | "garments";
type PrintItem = { key: string; design: LabelDesign; data: LabelData };
type Drawn = PrintItem & { label: RenderedLabel; url: string };
type PrinterInfo = { available: boolean; printers: PrinterDetails[] };

/** The largest group sent to the printer at once: keeps each request small even for big bag labels. */
const BATCH = 20;

/**
 * Bag labels and garment tags for one order. In the PC edition they go straight to the label printer;
 * elsewhere they go through the browser's print dialog. Both use the same dot-exact image.
 */
function LabelsPageInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const test = params.get("test") === "1";
  const order = useApi<any>(test ? null : `/orders/${id}`);
  const org = useApi<any>("/organizations/current");
  const printerInfo = useApi<PrinterInfo>("/labels/printers");
  const [scope, setScope] = useState<Scope>((params.get("scope") as Scope) || "all");
  const [settings, setSettings] = useState<LabelSettings>(DEFAULT_LABEL_SETTINGS);
  const [panel, setPanel] = useState<"" | "design" | "scanner">(test ? "design" : "");
  const [job, setJob] = useState<{ id: string; labelCount: number } | null>(null);
  const [asked, setAsked] = useState(false);
  const [jobStatus, setJobStatus] = useState<"" | "printed" | "failed">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const [override, setOverride] = useState<PrintItem[] | null>(null);

  useEffect(() => {
    if (!org.data) return;
    // Parsing fills in anything a design saved by an older version does not have yet.
    const saved = labelSettingsSchema.safeParse({ ...DEFAULT_LABEL_SETTINGS, ...(org.data.settings?.labels ?? {}) });
    setSettings(saved.success ? saved.data : DEFAULT_LABEL_SETTINGS);
  }, [org.data]);

  // The sample is created once: a new object on each render would redraw the labels forever.
  const o = useMemo(() => (test ? sampleOrder() : order.data), [test, order.data]);
  const direct = printerInfo.data?.available ?? false;
  const printers = useMemo(() => printerInfo.data?.printers ?? [], [printerInfo.data]);

  // On a PC, pick the Windows default printer until the owner chooses one.
  const printerName = settings.printerName || printers.find((p) => p.isDefault)?.name || "";

  const live: any[] = useMemo(() => (o ? o.garments.filter((g: any) => g.currentStatus !== "cancelled") : []), [o]);
  const bags: any[] = useMemo(() => o?.bags ?? [], [o]);

  const customer = !o || settings.customerOnTag === "none" ? "" : settings.customerOnTag === "first_name" ? String(o.customer?.name ?? "").split(/\s+/)[0] : o.customer?.name ?? "";
  const garmentData = (g: any, i: number): LabelData => {
    const it = o.items.find((x: any) => x.id === g.orderItemId);
    return {
      barcodeValue: g.tagCode,
      texts: {
        orderNumber: o.orderNumber, count: `${i + 1}/${live.length}`, tagCode: g.tagCode, garment: it?.garmentTypeName ?? "", service: it?.serviceName ?? "", colour: it?.colour ?? "", customer,
        due: `Due ${dateOnly(o.promisedAt).slice(0, 6)}${o.express ? " EXP" : ""}`,
      },
    };
  };
  const bagData = (b: any): LabelData => ({
    barcodeValue: b.bagCode,
    texts: { title: "BAG", orderNumber: o.orderNumber, pieces: `${b.garmentCount ?? b.expectedCount} pcs`, bagCode: b.bagCode, info: [o.branch?.name, customer].filter(Boolean).join(" · "), due: `Due ${dateOnly(o.promisedAt).slice(0, 6)}${o.express ? " EXP" : ""}` },
  });

  const items: PrintItem[] = useMemo(() => {
    if (!o) return [];
    const list: PrintItem[] = [];
    if (scope !== "garments") bags.forEach((b) => list.push({ key: `bag-${b.id}`, design: settings.bagDesign, data: bagData(b) }));
    if (scope !== "bag") live.forEach((g, i) => list.push({ key: `g-${g.id}`, design: settings.garmentDesign, data: garmentData(g, i) }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, scope, bags, live, settings.bagDesign, settings.garmentDesign, customer]);

  const shown = override ?? items;
  useEffect(() => {
    let current = true;
    Promise.all(shown.map(async (item) => {
      const label = await renderLabel(item.design, item.data);
      return { ...item, label, url: label.canvas.toDataURL("image/png") };
    })).then((result) => { if (current) setDrawn(result); }).catch((e: Error) => setError(e.message));
    return () => { current = false; };
  }, [shown]);

  const samples = useMemo(() => {
    const g = live[0];
    const b = bags[0];
    return {
      garment: g && o ? garmentData(g, 0) : { barcodeValue: "NEWDEL-2026-00001-01", texts: { orderNumber: "NEWDEL-2026-00001", count: "1/3", tagCode: "NEWDEL-2026-00001-01", garment: "Blazer", service: "Dry clean", colour: "Blue", customer: "Neelam", due: "Due 06 Nov" } },
      bag: b && o ? bagData(b) : { barcodeValue: "NEWDEL-2026-00001-B1", texts: { title: "BAG", orderNumber: "NEWDEL-2026-00001", pieces: "3 pcs", bagCode: "NEWDEL-2026-00001-B1", info: "Main Store · Neelam", due: "Due 06 Nov" } },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, live, bags, customer]);

  if (order.error) return <div className="p-6"><Alert>{order.error.message}</Alert></div>;
  if ((!o && !test) || !org.data) return <Spinner />;

  /** Sends labels of one size to the printer in small groups. Returns how many went. */
  async function sendDirect(list: Drawn[], copies: number) {
    const groups = new Map<string, Drawn[]>();
    for (const item of list) {
      const key = `${item.design.widthMm}x${item.design.heightMm}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += BATCH) {
        const part = group.slice(i, i + BATCH);
        await api("/labels/print", { body: {
          printer: printerName, widthMm: part[0].design.widthMm, heightMm: part[0].design.heightMm, gapMm: settings.gapMm, density: settings.density, speed: settings.speed, copies,
          labels: part.map((p) => labelToBitmap(p.label)),
        } });
      }
    }
  }

  async function renderAll(list: PrintItem[]): Promise<Drawn[]> {
    return Promise.all(list.map(async (item) => {
      const label = await renderLabel(item.design, item.data);
      return { ...item, label, url: label.canvas.toDataURL("image/png") };
    }));
  }

  /** One way out for every print: straight to the printer on a PC, otherwise the print dialog. */
  async function output(list: PrintItem[], copies: number) {
    if (direct) {
      if (!printerName) throw new Error("Choose a tag printer in Tag designer first.");
      await sendDirect(await renderAll(list), copies);
      setNotice(`Sent to ${printerName}.`);
    } else {
      setOverride(list);
      await new Promise((resolve) => setTimeout(resolve, 400));
      window.print();
      setOverride(null);
    }
  }

  async function print() {
    setError(""); setNotice(""); setJobStatus(""); setBusy(true);
    try {
      if (!test) setJob(await api(`/orders/${id}/print-jobs`, { body: { scope } }));
      await output(items, settings.copies);
      setAsked(true);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function printSamples(list: PrintItem[]) {
    setError(""); setNotice(""); setBusy(true);
    try {
      await output(list, 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(status: "printed" | "failed") {
    setAsked(false);
    if (!job) return setJobStatus(status);
    try {
      await api(`/print-jobs/${job.id}/result`, { body: { status, error: status === "failed" ? "Labels did not print correctly" : undefined } });
      setJobStatus(status);
      setJob(null);
      order.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function saveSettings() {
    setError(""); setNotice(""); setSaving(true);
    try {
      await api("/organizations/current", { method: "PATCH", body: { settings: { labels: { ...settings, printerName } } } });
      setNotice("Design saved. Every new tag will use it.");
      org.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  const applySample = (sampleId: number) => {
    const preset = sampleId >= 3 ? GARMENT_DESIGN_QR : GARMENT_DESIGN_CODE128;
    const moduleDots = sampleId === 4 ? 5 : sampleId === 3 ? 8 : sampleId === 1 ? 3 : 2;
    setSettings({ ...settings, garmentDesign: { ...preset, widthMm: settings.garmentDesign.widthMm, heightMm: settings.garmentDesign.heightMm, barcode: { ...preset.barcode, moduleDots } } });
    setPanel("design");
    setNotice("Barcode updated in the designer. Check it, then press Save design.");
  };

  const first = drawn[0]?.design;
  const pageCss = `@page { margin: 0${first ? `; size: ${first.widthMm}mm ${first.heightMm}mm` : ""} } @media print { body { background: #fff } .label { break-after: page; margin: 0 !important; box-shadow: none !important; border: none !important } }`;
  const total = items.length * settings.copies;

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <style>{pageCss}</style>
      <div className="no-print mx-auto mb-5 max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{test ? "Tag setup" : `Labels · ${o.orderNumber}`}</h1>
            <p className="text-sm text-slate-500">{test ? "Design your tags and test your scanner." : `${bags.length} bag label${bags.length === 1 ? "" : "s"} · ${live.length} garment tag${live.length === 1 ? "" : "s"}`}{direct && printerName ? ` · ${printerName}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!test && (
              <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="w-auto" aria-label="What to print">
                <option value="all">Bag label + all garment tags</option>
                <option value="bag">Bag label only</option>
                <option value="garments">Garment tags only</option>
              </Select>
            )}
            <Button variant="secondary" onClick={() => setPanel(panel === "design" ? "" : "design")}><Settings2 className="h-4 w-4" />Tag designer</Button>
            <Button variant="secondary" onClick={() => setPanel(panel === "scanner" ? "" : "scanner")}><ScanLine className="h-4 w-4" />Scanner test</Button>
            {!test && <Button onClick={print} loading={busy} disabled={total === 0}><Printer className="h-4 w-4" />Print {total} label{total === 1 ? "" : "s"}</Button>}
          </div>
        </div>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="green">{notice}</Alert>}
        {asked && !jobStatus && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900"><TriangleAlert className="h-4 w-4" />Did all labels print clearly? Scan one tag to check it reads.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => confirm("failed")}><XCircle className="h-4 w-4" />No, retry</Button>
              <Button size="sm" onClick={() => confirm("printed")}><CheckCircle2 className="h-4 w-4" />Yes, printed</Button>
            </div>
          </div>
        )}
        {jobStatus && <Alert tone={jobStatus === "printed" ? "green" : "amber"}>{jobStatus === "printed" ? "Labels marked as printed." : "Marked as failed. Check the printer and labels, then print again — the order and tag numbers stay the same."}</Alert>}
        {!test && o.printJobs?.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            Print history:
            {o.printJobs.slice(0, 5).map((j: any) => <Badge key={j.id} color={j.status === "printed" ? "green" : j.status === "failed" ? "red" : "amber"}>{j.status} · {j.labelCount} · {new Date(j.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Badge>)}
          </div>
        )}
        {panel === "design" && (
          <LabelDesigner
            settings={{ ...settings, printerName }}
            onChange={setSettings}
            samples={samples}
            printers={printers}
            directAvailable={direct}
            onRefreshPrinters={() => printerInfo.reload()}
            saving={saving}
            onSave={saveSettings}
            onTestPrint={(kind) => printSamples([{ key: `test-${kind}`, design: kind === "garment" ? settings.garmentDesign : settings.bagDesign, data: samples[kind] }])}
          />
        )}
        {panel === "scanner" && (
          <ScannerTest
            disabled={busy}
            onPrint={() => printSamples(SCANNER_SAMPLES.map((s) => ({ key: `sample-${s.id}`, design: s.design, data: sampleData(s) })))}
            onUse={(s) => applySample(s.id)}
          />
        )}
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap gap-3">
        {drawn.flatMap((item) => Array.from({ length: override ? 1 : settings.copies }, (_, c) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={`${item.key}-${c}`} src={item.url} alt={item.data.barcodeValue} className="label rounded-sm border border-dashed border-slate-400 bg-white shadow-sm" style={{ width: `${item.design.widthMm}mm`, height: `${item.design.heightMm}mm`, imageRendering: "pixelated" }} />
        )))}
      </div>
    </div>
  );
}

/** A realistic sample for setup: no database records are created. */
function sampleOrder() {
  const items = [{ id: "i1", garmentTypeName: "Shirt", serviceName: "Dry clean", colour: "Blue" }];
  return {
    orderNumber: "TEST-2026-00001", promisedAt: new Date().toISOString(), express: false, customer: { name: "Sample Customer" }, branch: { name: "Main Store" },
    items, garments: [{ id: "g1", tagCode: "TEST-2026-00001-01", orderItemId: "i1", currentStatus: "received" }],
    bags: [{ id: "b1", bagCode: "TEST-2026-00001-B1", garmentCount: 1 }], printJobs: [],
  };
}

export default function LabelsPage() {
  return (
    <Suspense>
      <LabelsPageInner />
    </Suspense>
  );
}
