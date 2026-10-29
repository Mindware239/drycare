"use client";
import { Suspense, useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Printer, Settings2, TriangleAlert, XCircle } from "lucide-react";
import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { dateOnly } from "@/lib/format";
import { Alert, Badge, Button, Field, Input, Select, Spinner, cx } from "@/components/ui";

type Scope = "all" | "bag" | "garments";

/**
 * Bag labels and individual garment tags for one order. Printing goes through the browser to the
 * label printer selected in the print dialog; staff then confirm whether the labels came out.
 */
function LabelsPageInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const test = params.get("test") === "1";
  const order = useApi<any>(test ? null : `/orders/${id}`);
  const org = useApi<any>("/organizations/current");
  const [scope, setScope] = useState<Scope>((params.get("scope") as Scope) || "all");
  const [settings, setSettings] = useState<LabelSettings>(DEFAULT_LABEL_SETTINGS);
  const [editing, setEditing] = useState(false);
  const [job, setJob] = useState<{ id: string; labelCount: number } | null>(null);
  const [jobStatus, setJobStatus] = useState<"" | "printed" | "failed">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (org.data) setSettings({ ...DEFAULT_LABEL_SETTINGS, ...(org.data.settings?.labels ?? {}) });
  }, [org.data]);

  if (order.error) return <div className="p-6"><Alert>{order.error.message}</Alert></div>;
  if ((!order.data && !test) || !org.data) return <Spinner />;

  const o = test ? sampleOrder() : order.data;
  const live = o.garments.filter((g: any) => g.currentStatus !== "cancelled");
  const item = (iid: string) => o.items.find((i: any) => i.id === iid);
  const bags: any[] = o.bags ?? [];
  const showBags = scope !== "garments";
  const showGarments = scope !== "bag";
  const labelCount = (showBags ? bags.length : 0) + (showGarments ? live.length : 0);
  const customer = settings.customerOnTag === "none" ? "" : settings.customerOnTag === "first_name" ? String(o.customer?.name ?? "").split(/\s+/)[0] : o.customer?.name;
  const barcodeSrc = (code: string) => `/api/v1/garments/barcode/${encodeURIComponent(code)}?type=${settings.barcode}`;

  async function print() {
    setError("");
    setJobStatus("");
    try {
      if (!test) setJob(await api(`/orders/${id}/print-jobs`, { body: { scope } }));
      // Give the browser a moment to paint the labels before opening the print dialog.
      setTimeout(() => window.print(), 150);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function confirm(status: "printed" | "failed") {
    if (!job) return setJobStatus(status);
    try {
      await api(`/print-jobs/${job.id}/result`, { body: { status, error: status === "failed" ? "Labels did not print correctly" : undefined } });
      setJobStatus(status);
      order.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function saveSettings() {
    setError("");
    try {
      await api("/organizations/current", { method: "PATCH", body: { settings: { labels: settings } } });
      setEditing(false);
      org.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const pageCss = `@page { margin: 0 } @media print { body { background: #fff } .label { break-after: page; border: none !important; margin: 0 !important; box-shadow: none !important } }`;
  const garmentStyle: CSSProperties = { width: `${settings.garmentWidthMm}mm`, height: `${settings.garmentHeightMm}mm` };
  const bagStyle: CSSProperties = { width: `${settings.bagWidthMm}mm`, height: `${settings.bagHeightMm}mm` };
  const qr = settings.barcode === "qrcode";
  const copies = Array.from({ length: settings.copies }, (_, i) => i);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <style>{pageCss}</style>
      <div className="no-print mx-auto mb-5 max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{test ? "Test print" : `Labels · ${o.orderNumber}`}</h1>
            <p className="text-sm text-slate-500">{bags.length} bag label{bags.length === 1 ? "" : "s"} · {live.length} garment tag{live.length === 1 ? "" : "s"} · {settings.barcode === "qrcode" ? "QR code" : "Code 128"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="w-auto" aria-label="What to print">
              <option value="all">Bag label + all garment tags</option>
              <option value="bag">Bag label only</option>
              <option value="garments">Garment tags only</option>
            </Select>
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}><Settings2 className="h-4 w-4" />Label setup</Button>
            <Button onClick={print}><Printer className="h-4 w-4" />Print {labelCount * settings.copies} label{labelCount * settings.copies === 1 ? "" : "s"}</Button>
          </div>
        </div>
        {error && <Alert>{error}</Alert>}
        {(job || test) && !jobStatus && (
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
        {editing && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Label setup</h2>
            <p className="mt-1 text-xs text-slate-500">Choose the printer, paper size and darkness in the print dialog (printer driver). Set the label size here to match the roll loaded in the printer — e.g. 50 × 25 mm taffeta tags.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Garment tag width (mm)"><Input type="number" min={20} max={120} value={settings.garmentWidthMm} onChange={(e) => setSettings({ ...settings, garmentWidthMm: Number(e.target.value) })} /></Field>
              <Field label="Garment tag height (mm)"><Input type="number" min={15} max={120} value={settings.garmentHeightMm} onChange={(e) => setSettings({ ...settings, garmentHeightMm: Number(e.target.value) })} /></Field>
              <Field label="Bag label width (mm)"><Input type="number" min={30} max={150} value={settings.bagWidthMm} onChange={(e) => setSettings({ ...settings, bagWidthMm: Number(e.target.value) })} /></Field>
              <Field label="Bag label height (mm)"><Input type="number" min={25} max={150} value={settings.bagHeightMm} onChange={(e) => setSettings({ ...settings, bagHeightMm: Number(e.target.value) })} /></Field>
              <Field label="Barcode type"><Select value={settings.barcode} onChange={(e) => setSettings({ ...settings, barcode: e.target.value as LabelSettings["barcode"] })}><option value="code128">Code 128 (most scanners)</option><option value="qrcode">QR code (needs a 2D scanner)</option></Select></Field>
              <Field label="Customer on tag"><Select value={settings.customerOnTag} onChange={(e) => setSettings({ ...settings, customerOnTag: e.target.value as LabelSettings["customerOnTag"] })}><option value="first_name">First name only</option><option value="full_name">Full name</option><option value="none">Don&apos;t print</option></Select></Field>
              <Field label="Copies of each label"><Input type="number" min={1} max={5} value={settings.copies} onChange={(e) => setSettings({ ...settings, copies: Number(e.target.value) })} /></Field>
              <div className="space-y-2 pt-6 text-sm text-slate-700">
                <label className="flex items-center gap-2"><input type="checkbox" checked={settings.showHumanReadable} onChange={(e) => setSettings({ ...settings, showHumanReadable: e.target.checked })} />Print code under barcode</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={settings.showColour} onChange={(e) => setSettings({ ...settings, showColour: e.target.checked })} />Print garment colour</label>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={saveSettings}>Save setup</Button>
              <a href="/print/labels?test=1" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50">Test print</a>
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto flex max-w-5xl flex-wrap gap-3">
        {showBags && bags.flatMap((b) => copies.map((c) => (
          <div key={`${b.id}-${c}`} className="label flex flex-col overflow-hidden rounded-sm border border-dashed border-slate-400 bg-white p-[2.5mm] shadow-sm" style={bagStyle}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[7pt] font-bold uppercase tracking-wider">Bag</p>
                <p className="truncate text-[11pt] font-black leading-tight">{o.orderNumber}</p>
              </div>
              <div className="text-right">
                <p className="text-[16pt] font-black leading-none">{b.garmentCount ?? b.expectedCount}</p>
                <p className="text-[6.5pt]">pieces</p>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={barcodeSrc(b.bagCode)} alt={b.bagCode} className={cx("mx-auto my-[1mm] min-h-0 flex-1 object-contain", qr ? "w-auto" : "w-full")} />
            {settings.showHumanReadable && <p className="text-center font-mono text-[8pt] font-bold leading-none">{b.bagCode}</p>}
            <div className="mt-[1mm] flex justify-between text-[7pt] leading-tight">
              <span className="truncate">{o.branch?.name}{customer ? ` · ${customer}` : ""}</span>
              <span className="shrink-0 pl-1 font-semibold">Due {dateOnly(o.promisedAt).slice(0, 6)}{o.express ? " · EXP" : ""}</span>
            </div>
          </div>
        )))}
        {showGarments && live.flatMap((g: any, i: number) => copies.map((c) => {
          const it = item(g.orderItemId);
          return (
            <div key={`${g.id}-${c}`} className={cx("label flex overflow-hidden rounded-sm border border-dashed border-slate-400 bg-white px-[2mm] py-[1mm] shadow-sm", qr ? "flex-row items-center gap-[2mm]" : "flex-col justify-between")} style={garmentStyle}>
              {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={barcodeSrc(g.tagCode)} alt={g.tagCode} className="h-full max-h-full w-auto shrink-0 object-contain py-[0.5mm]" />}
              <div className={cx("flex min-w-0 flex-1 flex-col", qr ? "justify-center gap-[0.5mm]" : "h-full justify-between")}>
                <div className="flex justify-between text-[7pt] font-bold leading-tight"><span className="truncate">{o.orderNumber}</span><span className="shrink-0 pl-1">{i + 1}/{live.length}</span></div>
                {!qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={barcodeSrc(g.tagCode)} alt={g.tagCode} className="mx-auto h-[9mm] w-full object-contain" />}
                {settings.showHumanReadable && <div className={cx("font-mono text-[6.5pt] leading-none", !qr && "text-center")}>{g.tagCode}</div>}
                <div className="truncate text-[6.5pt] font-semibold leading-tight">{it?.garmentTypeName} · {it?.serviceName}</div>
                <div className="flex justify-between text-[6.5pt] leading-tight">
                  <span className="truncate">{[settings.showColour ? it?.colour : null, customer].filter(Boolean).join(" · ")}{o.express ? " · EXPRESS" : ""}</span>
                  <span className="shrink-0 pl-1">{dateOnly(o.promisedAt).slice(0, 6)}</span>
                </div>
              </div>
            </div>
          );
        }))}
      </div>
    </div>
  );
}

/** A realistic sample for the test print: no database records are created. */
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
