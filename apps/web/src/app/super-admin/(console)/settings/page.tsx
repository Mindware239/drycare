"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Building2, CheckCircle2, CircleAlert, CreditCard, Database, Eye, EyeOff, FileText, KeyRound, Landmark, Mail, PlugZap, QrCode, Server, ShieldCheck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { ConsoleHeader, LoadingRows, Panel, SegmentedTabs, dateTimeLabel, useAdminData } from "../admin-ui";

type System = {
  environment: string; mode: string; appVersion: string; webOrigin: string;
  database: { version: string; now: string; size: string };
  email: { configured: boolean; provider: "smtp" | "resend" | null; from: string | null };
  paymentGateway: { configured: boolean };
  customerApprovals: { configured: boolean };
  marketingUnsubscribe: { configured: boolean };
  licensing: { enforced: boolean; publicKeyConfigured: boolean };
  trialDays: number; sessionTtlHours: number; cookieSecure: boolean;
};
type Seller = {
  legalName: string; tradeName: string; gstin: string; pan: string; cin: string; addressLine1: string; addressLine2: string; city: string; state: string; pincode: string; country: string;
  email: string; phone: string; website: string;
  bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string; branch: string };
  upiId: string; upiPayeeName: string;
  invoice: { prefix: string; nextNumber: number; sacCode: string; gstRateBps: number; terms: string; footer: string; signatory: string };
};
type BillingData = { seller: Seller; gaps: string[]; lastInvoiceNumber: string | null };
type Payments = {
  methods: { upi: boolean; bankTransfer: boolean; cash: boolean; instructions: string };
  razorpay: { enabled: boolean; mode: "test" | "live"; keyId: string; keySecretHint: string | null; webhookSecretHint: string | null; ready: boolean; lastTest?: { at: string; ok: boolean; message: string } };
};

const STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];
type Tab = "company" | "payments" | "system";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("company");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "payments" || t === "system" || t === "company") setTab(t);
  }, []);
  return (
    <>
      <ConsoleHeader title="Settings & payment gateways" description="How DryCare bills shops: your company and GST details on every invoice, how shops can pay, and the health of the server." />
      <div className="mb-6"><SegmentedTabs value={tab} onChange={setTab} options={[{ value: "company", label: "Company & invoices" }, { value: "payments", label: "Payments & gateway" }, { value: "system", label: "System health" }]} /></div>
      {tab === "company" ? <CompanyTab /> : tab === "payments" ? <PaymentsTab /> : <SystemTab />}
    </>
  );
}

// ------------------------------------------------------------------ company & invoices
function CompanyTab() {
  const { data, error } = useAdminData<BillingData>("/platform-admin/settings/billing");
  const [s, setS] = useState<Seller | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  useEffect(() => { if (data) { setS(data.seller); setGaps(data.gaps); } }, [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <Panel><LoadingRows /></Panel>;

  const set = <K extends keyof Seller>(k: K, v: Seller[K]) => setS({ ...s, [k]: v });
  const setBank = (k: keyof Seller["bank"], v: string) => setS({ ...s, bank: { ...s.bank, [k]: v } });
  const setInv = <K extends keyof Seller["invoice"]>(k: K, v: Seller["invoice"][K]) => setS({ ...s, invoice: { ...s.invoice, [k]: v } });
  const preview = `${s.invoice.prefix}${String(s.invoice.nextNumber || 1).padStart(5, "0")}`;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<BillingData>("/platform-admin/settings/billing", { method: "PUT", body: s });
      setGaps(r.gaps);
      setMsg({ tone: "green", text: "Company and invoice details saved. New invoices will use them." });
    } catch (cause) {
      setMsg({ tone: "red", text: cause instanceof Error ? cause.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {gaps.length > 0 && <Alert tone="amber">To issue valid GST tax invoices, add: <strong>{gaps.join(", ")}</strong>. Payments can still be recorded meanwhile.</Alert>}
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title={<T icon={Building2}>Company (seller) details</T>} description="Printed at the top of every DryCare invoice">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" required className="sm:col-span-2"><Input value={s.legalName} onChange={(e) => set("legalName", e.target.value)} placeholder="Mindware Infotech Pvt Ltd" /></Field>
            <Field label="Brand / trade name" className="sm:col-span-2"><Input value={s.tradeName} onChange={(e) => set("tradeName", e.target.value)} placeholder="DryCare" /></Field>
            <Field label="GSTIN" hint="15 characters"><Input value={s.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} className="font-mono" placeholder="27ABCDE1234F1Z5" /></Field>
            <Field label="PAN"><Input value={s.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} maxLength={10} className="font-mono" placeholder="ABCDE1234F" /></Field>
            <Field label="CIN (companies)" className="sm:col-span-2"><Input value={s.cin} onChange={(e) => set("cin", e.target.value.toUpperCase())} className="font-mono" /></Field>
            <Field label="Address line 1" required className="sm:col-span-2"><Input value={s.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} /></Field>
            <Field label="Address line 2" className="sm:col-span-2"><Input value={s.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} /></Field>
            <Field label="City" required><Input value={s.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="PIN code" required><Input value={s.pincode} onChange={(e) => set("pincode", e.target.value)} inputMode="numeric" maxLength={6} /></Field>
            <Field label="State" required hint="Decides CGST + SGST (same state) or IGST" className="sm:col-span-2">
              <Select value={s.state} onChange={(e) => set("state", e.target.value)}><option value="">Select state…</option>{STATES.map((st) => <option key={st}>{st}</option>)}</Select>
            </Field>
            <Field label="Billing email"><Input type="email" value={s.email} onChange={(e) => set("email", e.target.value)} placeholder="accounts@indianbarcode.com" /></Field>
            <Field label="Phone"><Input value={s.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Website" className="sm:col-span-2"><Input value={s.website} onChange={(e) => set("website", e.target.value)} placeholder="www.indianbarcode.com" /></Field>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel title={<T icon={Landmark}>Bank account for receiving payments</T>} description="Shown to shops on their Plan & billing screen and on invoices">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account holder name" className="sm:col-span-2"><Input value={s.bank.accountName} onChange={(e) => setBank("accountName", e.target.value)} /></Field>
              <Field label="Account number"><Input value={s.bank.accountNumber} onChange={(e) => setBank("accountNumber", e.target.value.replace(/\D/g, ""))} className="font-mono" inputMode="numeric" /></Field>
              <Field label="IFSC"><Input value={s.bank.ifsc} onChange={(e) => setBank("ifsc", e.target.value.toUpperCase())} maxLength={11} className="font-mono" placeholder="HDFC0001234" /></Field>
              <Field label="Bank name"><Input value={s.bank.bankName} onChange={(e) => setBank("bankName", e.target.value)} /></Field>
              <Field label="Branch"><Input value={s.bank.branch} onChange={(e) => setBank("branch", e.target.value)} /></Field>
            </div>
          </Panel>
          <Panel title={<T icon={QrCode}>UPI</T>} description="Shops see a scannable UPI QR with the exact amount">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="UPI ID"><Input value={s.upiId} onChange={(e) => set("upiId", e.target.value.trim())} placeholder="mindware@okhdfcbank" className="font-mono" /></Field>
              <Field label="Payee name"><Input value={s.upiPayeeName} onChange={(e) => set("upiPayeeName", e.target.value)} placeholder="Mindware Infotech" /></Field>
            </div>
          </Panel>
          <Panel title={<T icon={FileText}>Invoice numbering & tax</T>} description={data?.lastInvoiceNumber ? `Last issued: ${data.lastInvoiceNumber}` : "No invoices issued yet"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Number prefix" hint="e.g. DC/26-27/"><Input value={s.invoice.prefix} onChange={(e) => setInv("prefix", e.target.value)} className="font-mono" /></Field>
              <Field label="Next number"><Input type="number" min={1} value={s.invoice.nextNumber} onChange={(e) => setInv("nextNumber", Number(e.target.value))} /></Field>
              <p className="-mt-1 text-xs text-slate-500 sm:col-span-2">Next invoice will be <span className="font-mono font-semibold text-slate-800">{preview}</span>. Change the prefix at the start of each financial year.</p>
              <Field label="SAC code" hint="997331 = software licensing; 998315 = hosting"><Input value={s.invoice.sacCode} onChange={(e) => setInv("sacCode", e.target.value)} className="font-mono" maxLength={8} /></Field>
              <Field label="GST rate">
                <Select value={s.invoice.gstRateBps} onChange={(e) => setInv("gstRateBps", Number(e.target.value))}>
                  <option value={1800}>18%</option><option value={1200}>12%</option><option value={500}>5%</option><option value={0}>0% (not GST registered)</option>
                </Select>
              </Field>
              <Field label="Terms on invoice" className="sm:col-span-2"><Textarea rows={2} value={s.invoice.terms} onChange={(e) => setInv("terms", e.target.value)} placeholder="Subscription fees are non-refundable once the period has started." /></Field>
              <Field label="Footer line"><Input value={s.invoice.footer} onChange={(e) => setInv("footer", e.target.value)} placeholder="Thank you for choosing DryCare" /></Field>
              <Field label="Authorised signatory"><Input value={s.invoice.signatory} onChange={(e) => setInv("signatory", e.target.value)} placeholder="Director" /></Field>
            </div>
          </Panel>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="sticky bottom-0 z-10 -mx-2 flex justify-end bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent px-2 pb-4 pt-8"><Button type="submit" size="lg" loading={saving} className="shadow-lg"><ShieldCheck className="h-4 w-4" />Save company & invoice details</Button></div>
    </form>
  );
}

// ------------------------------------------------------------------ payments & gateway
function PaymentsTab() {
  const { data, error, reload } = useAdminData<Payments>("/platform-admin/settings/payments");
  const sys = useAdminData<System>("/platform-admin/system");
  const [p, setP] = useState<Payments | null>(null);
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  useEffect(() => { if (data) setP(data); }, [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!p) return <Panel><LoadingRows /></Panel>;
  const rz = p.razorpay;
  const setM = (k: keyof Payments["methods"], v: boolean | string) => setP({ ...p, methods: { ...p.methods, [k]: v } });
  const setR = (patch: Partial<Payments["razorpay"]>) => setP({ ...p, razorpay: { ...rz, ...patch } });
  const webhookUrl = `${sys.data?.webOrigin ?? (typeof window !== "undefined" ? window.location.origin : "")}/api/v1/webhooks/razorpay`;

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        methods: p!.methods,
        razorpay: { enabled: rz.enabled, mode: rz.mode, keyId: rz.keyId.trim(), ...(keySecret ? { keySecret } : {}), ...(webhookSecret ? { webhookSecret } : {}) },
      };
      setP(await api<Payments>("/platform-admin/settings/payments", { method: "PUT", body }));
      setKeySecret("");
      setWebhookSecret("");
      setMsg({ tone: "green", text: "Payment settings saved." });
    } catch (cause) {
      setMsg({ tone: "red", text: cause instanceof Error ? cause.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }
  async function removeSecret(which: "keySecret" | "webhookSecret") {
    setP(await api<Payments>("/platform-admin/settings/payments", { method: "PUT", body: { methods: p!.methods, razorpay: { enabled: which === "keySecret" ? false : rz.enabled, mode: rz.mode, keyId: rz.keyId, [which]: "" } } }));
  }
  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; message: string }>("/platform-admin/settings/payments/razorpay/test", { body: {} });
      setMsg({ tone: r.ok ? "green" : "red", text: r.message });
      void reload();
    } catch (cause) {
      setMsg({ tone: "red", text: cause instanceof Error ? cause.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] [&>*]:min-w-0">
        <Panel title={<T icon={Wallet}>How shops can pay</T>} description="Shown on each shop's Plan & billing screen">
          <div className="space-y-3">
            <Toggle checked={p.methods.upi} onChange={(v) => setM("upi", v)} title="UPI" text="Shops scan your UPI QR (exact amount filled in), then report the UPI transaction ID for you to verify." />
            <Toggle checked={p.methods.bankTransfer} onChange={(v) => setM("bankTransfer", v)} title="Bank transfer (NEFT / IMPS / RTGS)" text="Your bank details are shown; shops report the UTR number." />
            <Toggle checked={p.methods.cash} onChange={(v) => setM("cash", v)} title="Cash / cheque (record yourself)" text="Not shown to shops. Lets you record cash or cheque on the Payments page." />
            <Field label="Payment instructions for shops"><Textarea rows={3} value={p.methods.instructions} onChange={(e) => setM("instructions", e.target.value)} placeholder="After paying, enter the UTR / UPI reference. Your plan is activated within 2 working hours." /></Field>
          </div>
        </Panel>

        <Panel title={<T icon={CreditCard}>Online payment gateway · Razorpay</T>}
          description="Cards, UPI, net banking and wallets. Paid plans activate instantly and the GST invoice is issued automatically."
          actions={<StatusPill ok={rz.ready} okText={rz.mode === "live" ? "Live" : "Test mode"} badText="Off" />}>
          <div className="space-y-4">
            <Toggle checked={rz.enabled} onChange={(v) => setR({ enabled: v })} title="Accept online payments" text="Shows a “Pay online” button on each shop's Plan & billing screen." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mode">
                <Select value={rz.mode} onChange={(e) => setR({ mode: e.target.value as "test" | "live" })}><option value="test">Test (no real money)</option><option value="live">Live</option></Select>
              </Field>
              <Field label="Key ID" hint={`Starts with rzp_${rz.mode}_`}><Input value={rz.keyId} onChange={(e) => setR({ keyId: e.target.value.trim() })} placeholder={`rzp_${rz.mode}_xxxxxxxxxxxx`} className="font-mono" autoComplete="off" /></Field>
            </div>
            <SecretField label="Key Secret" hint={rz.keySecretHint} value={keySecret} onChange={setKeySecret} show={show} onToggle={() => setShow(!show)} onRemove={() => void removeSecret("keySecret")} />
            <SecretField label="Webhook secret" hint={rz.webhookSecretHint} value={webhookSecret} onChange={setWebhookSecret} show={show} onToggle={() => setShow(!show)} onRemove={() => void removeSecret("webhookSecret")} optional />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              <p className="font-semibold text-slate-800">Webhook address (Razorpay Dashboard → Settings → Webhooks)</p>
              <p className="mt-1 break-all font-mono text-slate-800">{webhookUrl}</p>
              <p className="mt-1">Events: <span className="font-mono">payment.captured</span>, <span className="font-mono">order.paid</span>. Recommended for live mode so a payment is recorded even if the shop closes the browser. The server must be reachable on the internet over HTTPS.</p>
            </div>
            {rz.lastTest && <p className={cx("flex items-start gap-1.5 text-xs", rz.lastTest.ok ? "text-emerald-700" : "text-red-700")}>{rz.lastTest.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5" />}Last test {dateTimeLabel(rz.lastTest.at)}: {rz.lastTest.message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" loading={testing} disabled={!rz.keySecretHint || !rz.keyId} onClick={() => void test()}><PlugZap className="h-4 w-4" />Test connection</Button>
              <a href="https://dashboard.razorpay.com/app/website-app-settings/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-2 text-sm font-medium text-brand-700 hover:underline"><KeyRound className="h-4 w-4" />Get API keys from Razorpay</a>
            </div>
            <p className="text-xs text-slate-500">Keys are encrypted before they are stored and are never shown again; only the last 4 characters are displayed. Other gateways (PhonePe, Cashfree, PayU) can be added on request.</p>
          </div>
        </Panel>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="sticky bottom-0 z-10 -mx-2 flex justify-end bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent px-2 pb-4 pt-8"><Button type="submit" size="lg" loading={saving} className="shadow-lg"><ShieldCheck className="h-4 w-4" />Save payment settings</Button></div>
    </form>
  );
}

function SecretField({ label, hint, value, onChange, show, onToggle, onRemove, optional }: { label: string; hint: string | null; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; onRemove: () => void; optional?: boolean }) {
  return (
    <Field label={`${label}${optional ? " (optional)" : ""}`} hint={hint ? `Saved (${hint}). Leave empty to keep it, or type a new one to replace it.` : "Not saved yet."}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={hint ?? "Paste from Razorpay"} className="pr-10 font-mono" autoComplete="new-password" />
          <button type="button" onClick={onToggle} aria-label={show ? "Hide" : "Show"} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
        {hint && <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button>}
      </div>
    </Field>
  );
}

function Toggle({ checked, onChange, title, text }: { checked: boolean; onChange: (v: boolean) => void; title: string; text: string }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition", checked ? "border-brand-200 bg-brand-50/50" : "border-slate-200 hover:border-slate-300")}>
      <span className={cx("relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-brand-600" : "bg-slate-300")}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      <span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{text}</span></span>
    </label>
  );
}

// ------------------------------------------------------------------ system health
function SystemTab() {
  const { data, error } = useAdminData<System>("/platform-admin/system");
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Panel><LoadingRows /></Panel>;
  return (
    <div className="space-y-6">
      {data.environment !== "production" && <Alert tone="amber">This server is running in <strong>{data.environment}</strong> mode. If email fails, super admin codes are shown in the API terminal; that fallback is disabled in production.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title={<T icon={Mail}>Email delivery</T>}>
          <StatusPill ok={data.email.configured} okText={`${data.email.provider === "smtp" ? "SMTP" : "Resend"} · ${data.email.from}`} badText="Not configured" />
          <p className="mt-3 text-sm leading-6 text-slate-600">Sends super admin sign-in codes, owner email verification, password resets, staff invitations, renewal reminders and receipts. Set in the server&apos;s .env file; test with <code className="rounded bg-slate-100 px-1">pnpm email:check</code>.</p>
        </Panel>
        <Panel title={<T icon={CreditCard}>Online payment gateway</T>}>
          <StatusPill ok={data.paymentGateway.configured} okText="Razorpay connected" badText="Not connected" />
          <p className="mt-3 text-sm leading-6 text-slate-600">Configure under the <strong>Payments &amp; gateway</strong> tab. UPI and bank transfers work without a gateway.</p>
        </Panel>
        <Panel title={<T icon={Server}>Application</T>}>
          <dl className="space-y-2.5 text-sm">
            <Row label="Environment">{data.environment}</Row>
            <Row label="Edition">{data.mode === "saas" ? "Cloud (multi-business)" : "Desktop (single store)"}</Row>
            <Row label="Version">{data.appVersion}</Row>
            <Row label="Public address">{data.webOrigin}</Row>
            <Row label="Free trial length">{data.trialDays} days</Row>
            <Row label="Session length">{data.sessionTtlHours} hours (30 days with “Keep me signed in”)</Row>
            <Row label="Secure cookies (HTTPS)"><StatusPill ok={data.cookieSecure} okText="On" badText="Off — turn on in production" /></Row>
          </dl>
        </Panel>
        <Panel title={<T icon={Database}>Database & other services</T>}>
          <dl className="space-y-2.5 text-sm">
            <Row label="PostgreSQL">{data.database.version}</Row>
            <Row label="Database size">{data.database.size}</Row>
            <Row label="Customer approval codes"><StatusPill ok={data.customerApprovals.configured} okText="Configured" badText="Not configured" /></Row>
            <Row label="Marketing unsubscribe links"><StatusPill ok={data.marketingUnsubscribe.configured} okText="Configured" badText="Not configured" /></Row>
            <Row label="Desktop license public key"><StatusPill ok={data.licensing.publicKeyConfigured} okText="Present" badText="Not set on this server" /></Row>
            <Row label="SMS / WhatsApp"><StatusPill ok={false} okText="" badText="No provider selected" /></Row>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

const T = ({ icon: Icon, children }: { icon: typeof Mail; children: ReactNode }) => <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-700" />{children}</span>;
function StatusPill({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return ok
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{okText}</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"><CircleAlert className="h-3.5 w-3.5" />{badText}</span>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5 last:border-0 last:pb-0"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-800">{children}</dd></div>;
}
