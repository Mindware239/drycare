"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDown, Mail, MessageCircle, Printer } from "lucide-react";
import { allBillTemplates, chooseBillTemplate, DEFAULT_BILL_MESSAGES, renderBillMessage, type BillTemplateSettings, type BillingProfile } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { Alert, Button, Select, Spinner } from "@/components/ui";
import { BillDocument, billPageCss } from "@/components/BillDocument";

/** One order's bill, in whichever template the shop chooses: to print, save as PDF, send by WhatsApp or email. */
function ReceiptPageInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { data: o, error } = useApi(`/orders/${id}`);
  const session = useApi("/auth/session");
  const [picked, setPicked] = useState<string | null>(params.get("format") ?? params.get("template"));
  const [logoOk, setLogoOk] = useState(true);
  const [qrOk, setQrOk] = useState(true);
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const [lengthMm, setLengthMm] = useState<number | undefined>();
  const org = session.data?.organization;
  const settings: Partial<BillTemplateSettings> | undefined = org?.settings?.billTemplates;
  const billing: Partial<BillingProfile> = org?.settings?.billing ?? {};
  const template = useMemo(() => chooseBillTemplate(settings, billing.invoice?.paper, picked), [settings, billing.invoice?.paper, picked]);

  // Save as PDF names the file from the page title.
  useEffect(() => { if (o) document.title = `${o.invoice?.invoiceNumber ?? o.orderNumber} ${o.customer?.name ?? ""}`.replace(/[\\/:*?"<>|]/g, "-"); }, [o]);

  // A roll prints as long as the bill is, so the bill is measured, including when its logo or QR finish loading.
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const measure = () => setLengthMm(el.getBoundingClientRect().height / (96 / 25.4));
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [template, !!o, !!org]);

  if (error) return <Alert>{error.message}</Alert>;
  if (!o || !org) return <Spinner />;

  const messages = settings?.messages ?? DEFAULT_BILL_MESSAGES;
  const values = {
    customer: o.customer?.name, shop: org.name, shopPhone: billing.phone || o.branch?.phone, invoice: o.invoice?.invoiceNumber, order: o.orderNumber,
    pieces: o.garments.filter((g: any) => g.currentStatus !== "cancelled").length, items: o.items.map((i: any) => `${i.garmentTypeName}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", "),
    total: money(o.invoice?.payable ?? o.grandTotal), paid: money(o.invoice?.paid ?? 0), balance: money(o.invoice?.balance ?? 0), ready: dateTime(o.promisedAt), upi: billing.upi?.vpa,
  };
  const digits = String(o.customer?.phone ?? "").replace(/\D/g, "");
  const whatsapp = digits ? `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(renderBillMessage(messages.whatsapp, values))}` : null;

  async function sendEmail() {
    setSending(true);
    setNotice(null);
    try {
      const r = await api<{ to: string }>(`/orders/${id}/send-bill`, { body: { channel: "email" } });
      setNotice({ tone: "green", text: `Bill email queued for ${r.to}.` });
    } catch (e) {
      setNotice({ tone: "red", text: (e as ApiError).message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <style>{billPageCss(template, lengthMm)}</style>
      <div className="no-print mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-center gap-2">
        <Select value={template.id} onChange={(e) => setPicked(e.target.value)} className="w-auto" aria-label="Bill format">
          {allBillTemplates(settings).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
        <Button variant="secondary" onClick={() => window.print()} title="In the print window, choose Save as PDF as the printer"><FileDown className="h-4 w-4" />Save as PDF</Button>
        {whatsapp ? <a href={whatsapp} target="_blank" rel="noreferrer"><Button variant="secondary"><MessageCircle className="h-4 w-4" />WhatsApp</Button></a> : <Button variant="secondary" disabled title="This customer has no mobile number"><MessageCircle className="h-4 w-4" />WhatsApp</Button>}
        <Button variant="secondary" onClick={() => void sendEmail()} loading={sending} disabled={!o.customer?.email} title={o.customer?.email ? `Send to ${o.customer.email}` : "This customer has no email address"}><Mail className="h-4 w-4" />Email</Button>
      </div>
      <div className="no-print mx-auto mb-4 max-w-4xl space-y-2">
        {notice && <Alert tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Alert>}
        <p className="text-center text-xs text-slate-500">To save a PDF, press Save as PDF, then choose &quot;Save as PDF&quot; as the printer in the window that opens.</p>
      </div>
      {/* Hidden checks: a logo or QR that fails to load is left off the bill rather than printing a broken picture. */}
      <div className="flex justify-center"><div ref={sheet} className="shadow-lg print:shadow-none">
        <BillDocument template={template} order={o} org={org} logoSrc={org.hasLogo && logoOk ? "/api/v1/organizations/current/logo" : null} qrSrc={qrOk ? `/api/v1/orders/${o.id}/upi-qr` : null} />
      </div></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {org.hasLogo && <img src="/api/v1/organizations/current/logo" alt="" hidden onError={() => setLogoOk(false)} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {billing.upi?.vpa && Number(o.invoice?.balance ?? 0) > 0 && <img src={`/api/v1/orders/${o.id}/upi-qr`} alt="" hidden onError={() => setQrOk(false)} />}
    </div>
  );
}

export default function ReceiptPage() {
  return <Suspense><ReceiptPageInner /></Suspense>;
}
