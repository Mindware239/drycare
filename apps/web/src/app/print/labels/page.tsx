"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Printer, ScanLine, Settings2, TriangleAlert, XCircle } from "lucide-react";
import { DEFAULT_LABEL_SETTINGS, GARMENT_DESIGN_38_LINE, GARMENT_DESIGN_38_QR, fitBarcodeToDigits, formatMoney, sampleScanCode, labelSettingsSchema, withBasicTag, type FeatureMap, type LabelDesign, type LabelSettings } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { dateOnly } from "@/lib/format";
import { withRollSize } from "@/lib/labelDesign";
import { labelToBitmap, renderLabel, type LabelData, type RenderedLabel } from "@/lib/labelRender";
import { Alert, Badge, Button, Select, Spinner, cx } from "@/components/ui";
import { BarcodeAdjust } from "@/components/BarcodeAdjust";
import { BasicTagSetup } from "@/components/BasicTagSetup";
import { LabelDesigner, type PrinterDetails } from "@/components/LabelDesigner";
import { PrinterConnect } from "@/components/PrinterConnect";
import { PrinterQueueStatus, usePrinterQueue } from "@/components/PrinterQueue";
import { ScannerTest, sampleData, scannerSamples } from "@/components/ScannerTest";

type Scope = "all" | "bag" | "garments";
type PrintItem = { key: string; design: LabelDesign; data: LabelData };
type Drawn = PrintItem & { label: RenderedLabel; url: string };
type PrinterInfo = { available: boolean; restricted?: boolean; needsConnecting?: boolean; printers: (PrinterDetails & { approved?: boolean })[] };

/** The largest group sent to the printer at once: keeps each request small even for big bag labels. */
const BATCH = 20;
/** Above this many labels, ask before using up the roll. */
const CONFIRM_ABOVE = 20;

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
  const session = useApi<{ features?: FeatureMap }>("/auth/session");
  const hardware = useApi<{ printers: string[]; scanners: string[] }>("/labels/hardware");
  const canDesign = session.data?.features?.labelDesigner ?? true;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [watching, setWatching] = useState(false);
  const autoPrint = params.get("auto") === "1";
  const autoStarted = useRef(false);
  const jobRef = useRef<{ id: string; labelCount: number } | null>(null);

  const [adjustKind, setAdjustKind] = useState<"garment" | "bag">(scope === "bag" ? "bag" : "garment");

  // Parsing fills in anything a design saved by an older version does not have yet.
  const savedSettings = useMemo(() => {
    if (!org.data || !session.data) return null;
    const saved = labelSettingsSchema.safeParse({ ...DEFAULT_LABEL_SETTINGS, ...(org.data.settings?.labels ?? {}) });
    const parsed = saved.success ? saved.data : DEFAULT_LABEL_SETTINGS;
    return canDesign ? parsed : withBasicTag(parsed);
  }, [org.data, session.data, canDesign]);
  useEffect(() => {
    if (savedSettings) setSettings(savedSettings);
  }, [savedSettings]);

  // The sample is created once: a new object on each render would redraw the labels forever.
  const branches = useApi<any[]>(test ? "/branches" : null);
  const sampleBranch = branches.data?.[0]?.branchCode as string | undefined;
  const o = useMemo(() => (test ? sampleOrder(sampleBranch ?? "TEST", settings.scanDigits) : order.data), [test, sampleBranch, settings.scanDigits, order.data]);
  const direct = printerInfo.data?.available ?? false;
  // Only printers the software owner accepts can be chosen. The server refuses any other.
  const printers = useMemo(() => (printerInfo.data?.printers ?? []).filter((p) => p.approved !== false), [printerInfo.data]);
  const blockedPrinter = printerInfo.data?.printers.find((p) => p.approved === false && p.name === settings.printerName)?.name;

  // On a PC, pick the Windows default printer until the owner chooses one.
  const printerName = (!blockedPrinter && settings.printerName) || printers.find((p) => p.isDefault)?.name || (printerInfo.data?.restricted ? printers[0]?.name : "") || "";
  const { queue, refresh: refreshQueue, restart: restartQueue } = usePrinterQueue(printerName, !direct ? "off" : watching ? "watching" : panel === "design" ? "idle" : "off");

  const live: any[] = useMemo(() => (o ? o.garments.filter((g: any) => g.currentStatus !== "cancelled") : []), [o]);
  const bags: any[] = useMemo(() => o?.bags ?? [], [o]);

  const customer = !o || settings.customerOnTag === "none" ? "" : settings.customerOnTag === "first_name" ? String(o.customer?.name ?? "").split(/\s+/)[0] : o.customer?.name ?? "";
  const garmentData = (g: any, i: number): LabelData => {
    const it = o.items.find((x: any) => x.id === g.orderItemId);
    return {
      barcodeValue: g.scanCode ?? g.tagCode,
      texts: {
        orderNumber: o.orderNumber, count: `${i + 1}/${live.length}`, tagCode: g.tagCode, scanCode: g.scanCode ?? "", garment: it?.garmentTypeName ?? "", service: it?.serviceName ?? "", colour: it?.colour ?? "", customer,
        due: `Due ${dateOnly(o.promisedAt).slice(0, 6)}${o.express ? " EXP" : ""}`,
        ...commonTexts(),
        brand: it?.brand ?? "", quantity: `${live.length} pcs`, price: it?.unitPrice !== undefined && it?.unitPrice !== null ? formatMoney(it.unitPrice) : "", notes: it?.careInstructions ?? "",
      },
    };
  };
  const commonTexts = () => ({ phone: o.customer?.phone ?? "", store: o.branch?.name ?? "", branchCode: o.branch?.code ?? "", orderSerial: String(o.orderNumber).split("-").at(-1) ?? "", orderDate: o.createdAt ? dateOnly(o.createdAt).slice(0, 6) : "" });
  const bagData = (b: any): LabelData => ({
    barcodeValue: b.scanCode ?? b.bagCode,
    texts: { title: "BAG", orderNumber: o.orderNumber, pieces: `${b.garmentCount ?? b.expectedCount} pcs`, bagCode: b.bagCode, scanCode: b.scanCode ?? "", info: [o.branch?.name, customer].filter(Boolean).join(" · "), due: `Due ${dateOnly(o.promisedAt).slice(0, 6)}${o.express ? " EXP" : ""}`, customer, ...commonTexts() },
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
  const chosen = useMemo(() => (selected.size ? items.filter((item) => selected.has(item.key)) : items), [items, selected]);

  /** Records how a direct print ended, so history does not fill with "pending". */
  const closeJob = (status: "printed" | "failed", reason?: string) => {
    const finished = jobRef.current;
    jobRef.current = null;
    setJob(null);
    if (finished) api(`/print-jobs/${finished.id}/result`, { body: { status, error: reason } }).then(() => order.reload()).catch(() => {});
  };

  // The printer has taken every job once the queue is empty.
  useEffect(() => {
    if (!watching || !queue || queue.jobs.length) return;
    setWatching(false);
    setNotice("The printer has taken all the tags. Scan one to check it reads.");
    closeJob("printed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, watching]);
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
      garment: g && o ? garmentData(g, 0) : { barcodeValue: sampleScanCode(settings.scanDigits), texts: { orderNumber: "NEWDEL-2026-00001", count: "1/3", tagCode: "NEWDEL-2026-00001-01", scanCode: sampleScanCode(settings.scanDigits), garment: "Blazer", service: "Dry clean", colour: "Blue", customer: "Neelam", due: "Due 06 Nov" } },
      bag: b && o ? bagData(b) : { barcodeValue: sampleScanCode(settings.scanDigits), texts: { title: "BAG", orderNumber: "NEWDEL-2026-00001", pieces: "3 pcs", bagCode: "NEWDEL-2026-00001-B1", scanCode: sampleScanCode(settings.scanDigits), info: "Main Store · Neelam", due: "Due 06 Nov" } },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, live, bags, customer]);

  // Opened right after a new order: print once. An order with any print history is never printed automatically,
  // so reloading the page cannot use up more tags.
  const printRef = useRef<(requestId?: string) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!autoPrint || autoStarted.current || !direct || !printerName || !o || !items.length || !drawn.length || settings !== savedSettings) return;
    autoStarted.current = true;
    if (o.printJobs?.length) return;
    if (items.length * settings.copies > CONFIRM_ABOVE) setConfirmLarge(true);
    else void printRef.current(`auto-${id}`);
  }, [autoPrint, direct, printerName, o, items, drawn, settings, savedSettings, id]);

  if (order.error) return <div className="p-6"><Alert>{order.error.message}</Alert></div>;
  if ((!o && !test) || !org.data || !session.data) return <Spinner />;

  /** Sends labels of one size to the printer in small groups. Returns how many went. */
  async function sendDirect(list: Drawn[], copies: number, requestId: string) {
    const groups = new Map<string, Drawn[]>();
    for (const item of list) {
      const key = `${item.design.widthMm}x${item.design.heightMm}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += BATCH) {
        const part = group.slice(i, i + BATCH);
        await api("/labels/print", { body: {
          requestId: `${requestId}-${group[0].design.widthMm}x${group[0].design.heightMm}-${i}`,
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
  async function output(list: PrintItem[], copies: number, requestId: string = crypto.randomUUID()) {
    if (direct) {
      if (!printerName) throw new Error("Choose a tag printer in Tag designer first.");
      await sendDirect(await renderAll(list), copies, requestId);
      setNotice(`Sent to ${printerName}.`);
      restartQueue();
      setWatching(true);
    } else {
      setOverride(list);
      await new Promise((resolve) => setTimeout(resolve, 400));
      window.print();
      setOverride(null);
    }
  }

  async function print(requestId?: string) {
    setError(""); setNotice(""); setJobStatus(""); setBusy(true); setConfirmLarge(false);
    try {
      if (!test) {
        const onlySome = selected.size > 0;
        const garmentIds = chosen.filter((item) => item.key.startsWith("g-")).map((item) => item.key.slice(2));
        const created = await api<{ id: string; labelCount: number }>(`/orders/${id}/print-jobs`, { body: onlySome
          ? { scope: garmentIds.length ? "garments" : "bag", ...(garmentIds.length ? { garmentIds } : {}), labelCount: chosen.length * settings.copies }
          : { scope } });
        setJob(created);
        jobRef.current = created;
      }
      await output(chosen, settings.copies, requestId);
      // Direct printing reports its own progress. The print dialog cannot, so staff are asked.
      if (!direct) setAsked(true);
    } catch (e) {
      setError((e as ApiError).message);
      if (direct) closeJob("failed", (e as ApiError).message);
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
    const preset = sampleId >= 3 ? GARMENT_DESIGN_38_QR : GARMENT_DESIGN_38_LINE;
    setSettings(canDesign ? { ...settings, garmentDesign: fitBarcodeToDigits(preset, settings.scanDigits) } : withBasicTag({ ...settings, basicTagStyle: sampleId >= 3 ? "qr" : "line" }));
    setPanel("design");
    setNotice(canDesign ? "Barcode updated in the designer. Check it, then press Save design." : "Tag updated. Check it, then press Save.");
  };

  printRef.current = print;
  /** Staff cancelled what was waiting, so the print in progress did not finish. */
  const afterCancel = () => {
    if (watching) {
      setWatching(false);
      setNotice("");
      closeJob("failed", "Cancelled from the print queue");
    }
    void refreshQueue();
  };
  const changed = !!savedSettings && JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const first = drawn[0]?.design;
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const startPrint = () => { if (chosen.length * settings.copies > CONFIRM_ABOVE) setConfirmLarge(true); else void print(); };
  // On screen, one printer dot is about one screen pixel, so tags look sharp and easy to read.
  const pageCss = `@page { margin: 0${first ? `; size: ${first.widthMm}mm ${first.heightMm}mm` : ""} } @media screen { .label { zoom: 2.1 } } @media print { body { background: #fff } .label-wrap { display: contents } .label { break-after: page; margin: 0 !important; box-shadow: none !important; border: none !important } }`;
  const total = chosen.length * settings.copies;
  const mixedSizes = !test && scope === "all" && (settings.garmentDesign.widthMm !== settings.bagDesign.widthMm || settings.garmentDesign.heightMm !== settings.bagDesign.heightMm);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <style>{pageCss}</style>
      <div className={cx("no-print mx-auto mb-5 space-y-4", panel === "design" ? "max-w-[1560px]" : "max-w-6xl")}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{test ? "Tag setup" : `Labels · ${o.orderNumber}`}</h1>
            <p className="text-sm text-slate-500">{test ? (canDesign ? "Design your tags and test your scanner." : "Set up your printer and test your scanner.") : `${bags.length} bag label${bags.length === 1 ? "" : "s"} · ${live.length} garment tag${live.length === 1 ? "" : "s"}`}{direct && printerName ? ` · ${printerName}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!test && (
              <Select value={scope} onChange={(e) => { setScope(e.target.value as Scope); setSelected(new Set()); }} className="w-auto" aria-label="What to print">
                <option value="all">Bag label + all garment tags</option>
                <option value="bag">Bag label only</option>
                <option value="garments">Garment tags only</option>
              </Select>
            )}
            {autoPrint && <Link href={`/orders/view?id=${id}&created=1`} className="inline-flex items-center gap-1 px-2 text-sm font-semibold text-slate-900 underline underline-offset-4"><ArrowLeft className="h-4 w-4" />Back to order</Link>}
            <Button variant="secondary" onClick={() => setPanel(panel === "design" ? "" : "design")}><Settings2 className="h-4 w-4" />{canDesign ? "Tag designer" : "Tag setup"}</Button>
            <Button variant="secondary" onClick={() => setPanel(panel === "scanner" ? "" : "scanner")}><ScanLine className="h-4 w-4" />Scanner test</Button>
            {!test && <Button onClick={startPrint} loading={busy} disabled={total === 0}><Printer className="h-4 w-4" />Print {total} {selected.size ? "selected" : `label${total === 1 ? "" : "s"}`}</Button>}
          </div>
        </div>
        {mixedSizes && <Alert tone="amber">Your bag label is {settings.bagDesign.widthMm} × {settings.bagDesign.heightMm} mm and your garment tag is {settings.garmentDesign.widthMm} × {settings.garmentDesign.heightMm} mm. One roll cannot print both: set them to the same size, or print them separately.</Alert>}
        {blockedPrinter && <Alert tone="amber">{printerInfo.data?.needsConnecting ? `${blockedPrinter} is not connected yet. Enter its serial number and bill number below.` : `${blockedPrinter} is not on the approved printer list, so it cannot be used. Choose an approved printer or contact Drycare support.`}</Alert>}
        {direct && printerInfo.data?.restricted && !printerInfo.data.needsConnecting && printers.length === 0 && <Alert tone="amber">None of the printers on this PC are approved. Approved models: {hardware.data?.printers.join(", ")}.</Alert>}
        {(test || (direct && printerInfo.data?.needsConnecting && printers.length === 0)) && <PrinterConnect windowsPrinters={printerInfo.data?.printers ?? []} directAvailable={direct} required={!!printerInfo.data?.needsConnecting} onChanged={() => printerInfo.reload()} />}
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="green">{notice}</Alert>}
        {confirmLarge && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Print {total} labels?</h2>
            <p className="mt-1 text-sm text-slate-600">{chosen.length} label{chosen.length === 1 ? "" : "s"} × {settings.copies} cop{settings.copies === 1 ? "y" : "ies"} on {printerName || "the selected printer"}, {settings.garmentDesign.widthMm} × {settings.garmentDesign.heightMm} mm.</p>
            <div className="mt-3 flex gap-2"><Button onClick={() => print()}>Print {total} labels</Button><Button variant="secondary" onClick={() => setConfirmLarge(false)}>Cancel</Button></div>
          </div>
        )}
        {direct && watching && queue && <PrinterQueueStatus printer={printerName} queue={queue} onChanged={afterCancel} compact />}
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
        {!test && panel === "" && canDesign && (
          <BarcodeAdjust
            kind={adjustKind}
            onKind={setAdjustKind}
            design={adjustKind === "garment" ? settings.garmentDesign : settings.bagDesign}
            onChange={(next) => setSettings(adjustKind === "garment" ? { ...settings, garmentDesign: next } : { ...settings, bagDesign: next })}
            onRollSize={(w, h) => setSettings(withRollSize(settings, w, h))}
            label={drawn.find((d) => d.key.startsWith(adjustKind === "garment" ? "g-" : "bag-"))?.label}
            changed={changed}
            saving={saving}
            onSave={saveSettings}
            onDiscard={() => { if (savedSettings) setSettings(savedSettings); }}
          />
        )}
        {panel === "design" && !canDesign && (
          <BasicTagSetup
            settings={{ ...settings, printerName }}
            onChange={setSettings}
            sample={samples.garment}
            printers={printers}
            directAvailable={direct}
            printerQueue={<PrinterQueueStatus printer={printerName} queue={queue} onChanged={afterCancel} />}
            changed={changed}
            saving={saving}
            onRefreshPrinters={() => printerInfo.reload()}
            onSave={saveSettings}
            onTestPrint={() => printSamples([{ key: "test-garment", design: settings.garmentDesign, data: samples.garment }])}
          />
        )}
        {panel === "design" && canDesign && (
          <LabelDesigner
            settings={{ ...settings, printerName }}
            onChange={setSettings}
            samples={samples}
            usingSample={test}
            printers={printers}
            directAvailable={direct}
            printerQueue={<PrinterQueueStatus printer={printerName} queue={queue} onChanged={afterCancel} />}
            changed={changed}
            onRefreshPrinters={() => printerInfo.reload()}
            saving={saving}
            onSave={saveSettings}
            onTestPrint={(kind) => printSamples([{ key: `test-${kind}`, design: kind === "garment" ? settings.garmentDesign : settings.bagDesign, data: samples[kind] }])}
          />
        )}
        {panel === "scanner" && (
          <ScannerTest
            disabled={busy}
            approvedScanners={hardware.data?.scanners}
            digits={settings.scanDigits}
            onPrint={() => printSamples(scannerSamples(settings.scanDigits).map((s) => ({ key: `sample-${s.id}`, design: s.design, data: sampleData(s) })))}
            onUse={(s) => applySample(s.id)}
          />
        )}
      </div>

      {!test && panel !== "design" && items.length > 1 && (
        <div className="no-print mx-auto mb-3 flex max-w-6xl flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>{selected.size ? `${selected.size} selected. Only these will print.` : "Tick tags to reprint only those. Otherwise all will print."}</span>
          {selected.size > 0 && <button type="button" className="font-semibold text-slate-900 underline underline-offset-4" onClick={() => setSelected(new Set())}>Clear selection</button>}
        </div>
      )}
      {/* The designer has its own preview, but the print dialog still needs these. */}
      <div className={cx("mx-auto max-w-6xl flex-wrap gap-3", panel === "design" && !override ? "hidden" : "flex")}>
        {drawn.flatMap((item) => Array.from({ length: override ? 1 : settings.copies }, (_, c) => (
          <div key={`${item.key}-${c}`} className="label-wrap relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.data.barcodeValue} className={cx("label rounded-sm border bg-white shadow-sm", selected.has(item.key) ? "border-solid border-brand-600 outline-2 outline-brand-500" : "border-dashed border-slate-400")} style={{ width: `${item.design.widthMm}mm`, height: `${item.design.heightMm}mm`, imageRendering: "pixelated" }} />
            {!test && !override && c === 0 && <label className="no-print mt-1.5 flex cursor-pointer items-center gap-1.5 px-1 text-xs font-semibold text-slate-800"><input type="checkbox" aria-label={`Select ${item.data.barcodeValue}`} checked={selected.has(item.key)} onChange={() => toggle(item.key)} />Select</label>}
          </div>
        )))}
      </div>
    </div>
  );
}

/** A realistic sample for setup: no database records are created. */
function sampleOrder(branchCode: string, digits: number) {
  const scanCode = sampleScanCode(digits);
  // Same length as a real number, so a test tag scans as a real one would. Order 00000 is never issued.
  const orderNumber = `${branchCode}-${new Date().getFullYear()}-00000`;
  const items = [{ id: "i1", garmentTypeName: "Shirt", serviceName: "Dry clean", colour: "Blue", brand: "Sample Brand", unitPrice: 15000, careInstructions: "Sample instructions" }];
  return {
    orderNumber, promisedAt: new Date().toISOString(), createdAt: new Date().toISOString(), express: false, customer: { name: "Sample Customer", phone: "98765 43210" }, branch: { name: "Main Store", code: branchCode },
    items, garments: [{ id: "g1", tagCode: `${orderNumber}-01`, scanCode, orderItemId: "i1", currentStatus: "received" }],
    bags: [{ id: "b1", bagCode: `${orderNumber}-B1`, scanCode, garmentCount: 1 }], printJobs: [],
  };
}

export default function LabelsPage() {
  return (
    <Suspense>
      <LabelsPageInner />
    </Suspense>
  );
}
