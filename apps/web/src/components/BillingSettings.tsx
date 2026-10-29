"use client";
import { useEffect, useState } from "react";
import { Building2, FileText, ImageUp, Landmark, QrCode, Trash2 } from "lucide-react";
import type { BillingProfile } from "@drycare/shared";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";

type Org = { id: string; name: string; legalName: string | null; gstin: string | null; hasLogo: boolean; settings: { billing?: BillingProfile; invoiceFooter?: string } };

const EMPTY: BillingProfile = {
  address: {}, bank: {}, upi: {},
  invoice: { paper: "80mm", showBank: true, showUpiQr: true, showLogo: true },
};

const STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman & Nicobar", "Chandigarh", "Dadra & Nagar Haveli and Daman & Diu", "Lakshadweep"];

/**
 * Everything printed on the store's invoices: logo, address, tax IDs, bank account, UPI ID (for the
 * "scan to pay" QR) and invoice wording. Saved in the organization settings; secrets are not involved.
 */
export function BillingSettings({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const [b, setB] = useState<BillingProfile>(() => ({ ...EMPTY, ...org.settings.billing, address: { ...org.settings.billing?.address }, bank: { ...org.settings.billing?.bank }, upi: { ...org.settings.billing?.upi }, invoice: { ...EMPTY.invoice, ...org.settings.billing?.invoice } }));
  const [footer, setFooter] = useState(org.settings.invoiceFooter ?? "");
  const [logoVersion, setLogoVersion] = useState(Date.now());
  const [hasLogo, setHasLogo] = useState(org.hasLogo);
  const [msg, setMsg] = useState<{ t: "green" | "red"; m: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => setHasLogo(org.hasLogo), [org.hasLogo]);

  const set = <K extends keyof BillingProfile>(k: K, v: BillingProfile[K]) => setB((cur) => ({ ...cur, [k]: v }));
  const setIn = <K extends "address" | "bank" | "upi" | "invoice">(k: K, patch: Partial<BillingProfile[K]>) => setB((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api("/organizations/current", { method: "PATCH", body: { settings: { billing: b, invoiceFooter: footer || undefined } } });
      setMsg({ t: "green", m: "Invoice & payment details saved. They now print on every invoice." });
      onSaved();
    } catch (e) {
      const err = e as ApiError;
      setMsg({ t: "red", m: err.message.replace(/^The request contains invalid fields\.:?\s*/i, "Please check: ") });
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 300_000) {
      setMsg({ t: "red", m: "Choose a PNG, JPEG or WebP logo smaller than 300 KB." });
      return;
    }
    setUploading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Could not read the file"));
        r.readAsDataURL(file);
      });
      await api("/organizations/current/logo", { method: "PUT", body: { mimeType: file.type, data } });
      setHasLogo(true);
      setLogoVersion(Date.now());
      setMsg({ t: "green", m: "Logo uploaded." });
    } catch (e) {
      setMsg({ t: "red", m: (e as ApiError).message });
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    await api("/organizations/current/logo", { method: "DELETE" }).catch(() => undefined);
    setHasLogo(false);
  }

  const addressLine = [b.address.line1, b.address.line2, b.address.city, b.address.state, b.address.pincode].filter(Boolean).join(", ");

  return (
    <Card title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-700" />Invoice & payment details</span>}>
      <p className="-mt-1 mb-4 text-sm text-slate-600">What customers see on your bills: logo, address, GST details, where to pay (bank / UPI QR) and your terms.</p>
      {msg && <div className="mb-4"><Alert tone={msg.t} onClose={() => setMsg(null)}>{msg.m}</Alert></div>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Section icon={ImageUp} title="Logo">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {hasLogo ? <img src={`/api/v1/organizations/current/logo?v=${logoVersion}`} alt="Business logo" className="max-h-full max-w-full object-contain" /> : <ImageUp className="h-6 w-6 text-slate-300" />}
              </span>
              <div className="space-y-2">
                <label className={cx("inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50", uploading && "pointer-events-none opacity-60")}>
                  <ImageUp className="h-4 w-4" />{uploading ? "Uploading…" : hasLogo ? "Replace logo" : "Upload logo"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {hasLogo && <button type="button" onClick={removeLogo} className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"><Trash2 className="h-3.5 w-3.5" />Remove</button>}
                <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 300 KB. A square or wide logo on a white background prints best on thermal paper.</p>
              </div>
            </div>
          </Section>

          <Section icon={Building2} title="Address & contact on invoice">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address line 1" className="sm:col-span-2"><Input value={b.address.line1 ?? ""} onChange={(e) => setIn("address", { line1: e.target.value })} placeholder="Shop no., building, street" /></Field>
              <Field label="Address line 2" className="sm:col-span-2"><Input value={b.address.line2 ?? ""} onChange={(e) => setIn("address", { line2: e.target.value })} placeholder="Area / landmark" /></Field>
              <Field label="City"><Input value={b.address.city ?? ""} onChange={(e) => setIn("address", { city: e.target.value })} /></Field>
              <Field label="State" hint="Used for GST place of supply">
                <Select value={b.address.state ?? ""} onChange={(e) => setIn("address", { state: e.target.value })}>
                  <option value="">Select state</option>
                  {STATES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="PIN code"><Input inputMode="numeric" maxLength={6} value={b.address.pincode ?? ""} onChange={(e) => setIn("address", { pincode: e.target.value.replace(/\D/g, "") })} /></Field>
              <Field label="Phone"><Input value={b.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="+91" /></Field>
              <Field label="Email"><Input type="email" value={b.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Website"><Input value={b.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="www.yourstore.in" /></Field>
              <Field label="PAN" hint="Optional"><Input value={b.pan ?? ""} onChange={(e) => set("pan", e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" className="font-mono" /></Field>
              <Field label="SAC code" hint="Dry cleaning / laundry is usually 999712"><Input inputMode="numeric" value={b.sacCode ?? ""} onChange={(e) => set("sacCode", e.target.value.replace(/\D/g, ""))} placeholder="999712" className="font-mono" /></Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">GSTIN is set in Business details above. Confirm your SAC code and GST rate with your accountant.</p>
          </Section>

          <Section icon={Landmark} title="Bank account (for customer transfers)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Account holder name"><Input value={b.bank.accountName ?? ""} onChange={(e) => setIn("bank", { accountName: e.target.value })} /></Field>
              <Field label="Bank name"><Input value={b.bank.bankName ?? ""} onChange={(e) => setIn("bank", { bankName: e.target.value })} placeholder="e.g. HDFC Bank" /></Field>
              <Field label="Account number"><Input inputMode="numeric" value={b.bank.accountNumber ?? ""} onChange={(e) => setIn("bank", { accountNumber: e.target.value.replace(/\D/g, "") })} className="font-mono" /></Field>
              <Field label="IFSC"><Input value={b.bank.ifsc ?? ""} onChange={(e) => setIn("bank", { ifsc: e.target.value.toUpperCase() })} maxLength={11} placeholder="HDFC0001234" className="font-mono" /></Field>
              <Field label="Branch" className="sm:col-span-2"><Input value={b.bank.branch ?? ""} onChange={(e) => setIn("bank", { branch: e.target.value })} /></Field>
            </div>
          </Section>

          <Section icon={QrCode} title="UPI (scan to pay)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="UPI ID" hint="From your GPay / PhonePe / Paytm / bank app"><Input value={b.upi.vpa ?? ""} onChange={(e) => setIn("upi", { vpa: e.target.value.trim().toLowerCase() })} placeholder="yourshop@okhdfcbank" className="font-mono" /></Field>
              <Field label="Payee name shown in the UPI app"><Input value={b.upi.payeeName ?? ""} onChange={(e) => setIn("upi", { payeeName: e.target.value })} placeholder={org.name} /></Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">Each invoice prints a QR with the amount due already filled in. Always confirm the money reached your account before marking an order paid.</p>
          </Section>

          <Section icon={FileText} title="Invoice wording & layout">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paper">
                <Select value={b.invoice.paper} onChange={(e) => setIn("invoice", { paper: e.target.value as "80mm" | "a4" | "a5" })}>
                  <option value="80mm">80 mm thermal receipt</option>
                  <option value="a4">A4 tax invoice</option>
                  <option value="a5">A5 tax invoice</option>
                </Select>
              </Field>
              <Field label="Invoice title"><Input value={b.invoice.title ?? ""} onChange={(e) => setIn("invoice", { title: e.target.value })} placeholder="TAX INVOICE" /></Field>
              <Field label="Authorised signatory" className="sm:col-span-2" hint="Printed under “For {business name}” on A4 invoices"><Input value={b.invoice.signatory ?? ""} onChange={(e) => setIn("invoice", { signatory: e.target.value })} placeholder="e.g. Rajesh Kumar, Proprietor" /></Field>
              <Field label="Terms & conditions" className="sm:col-span-2"><Textarea rows={4} value={b.invoice.terms ?? ""} onChange={(e) => setIn("invoice", { terms: e.target.value })} placeholder={"1. Garments not collected within 30 days are at the owner's risk.\n2. We are not responsible for colour bleeding or shrinkage of delicate fabrics.\n3. Claims must be made at the time of delivery."} /></Field>
              <Field label="Footer message" className="sm:col-span-2"><Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Thank you! Visit again." /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={b.invoice.showLogo} onChange={(e) => setIn("invoice", { showLogo: e.target.checked })} />Print logo</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={b.invoice.showBank} onChange={(e) => setIn("invoice", { showBank: e.target.checked })} />Print bank details</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={b.invoice.showUpiQr} onChange={(e) => setIn("invoice", { showUpiQr: e.target.checked })} />Print UPI QR when money is due</label>
            </div>
          </Section>

          <Button size="lg" onClick={save} loading={saving}>Save invoice & payment details</Button>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice preview</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4 font-mono text-[11px] leading-snug text-slate-900 shadow-sm">
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {hasLogo && b.invoice.showLogo && <img src={`/api/v1/organizations/current/logo?v=${logoVersion}`} alt="" className="mx-auto mb-1 max-h-12 object-contain" />}
              <p className="text-sm font-bold">{org.name}</p>
              {org.legalName && <p>{org.legalName}</p>}
              {addressLine && <p>{addressLine}</p>}
              {(b.phone || b.email) && <p>{[b.phone && `Ph: ${b.phone}`, b.email].filter(Boolean).join(" · ")}</p>}
              {org.gstin && <p>GSTIN: {org.gstin}</p>}
              {b.pan && <p>PAN: {b.pan}</p>}
              <p className="mt-1 font-bold">{b.invoice.title || "TAX INVOICE"}</p>
            </div>
            <hr className="my-2 border-dashed border-slate-400" />
            <p className="text-slate-400">… order items, GST and totals …</p>
            <hr className="my-2 border-dashed border-slate-400" />
            {b.invoice.showBank && b.bank.accountNumber && (
              <div className="mb-2">
                <p className="font-bold">Bank transfer</p>
                <p>{b.bank.accountName}</p>
                <p>{b.bank.bankName}{b.bank.branch ? `, ${b.bank.branch}` : ""}</p>
                <p>A/c {b.bank.accountNumber} · IFSC {b.bank.ifsc}</p>
              </div>
            )}
            {b.invoice.showUpiQr && b.upi.vpa && (
              <div className="flex items-center gap-2">
                <span className="flex h-14 w-14 items-center justify-center rounded border border-slate-300 bg-slate-50"><QrCode className="h-8 w-8 text-slate-400" /></span>
                <div><p className="font-bold">Scan to pay</p><p>{b.upi.vpa}</p></div>
              </div>
            )}
            {b.invoice.terms && <p className="mt-2 whitespace-pre-line text-[10px] text-slate-600">{b.invoice.terms}</p>}
            {footer && <p className="mt-2 text-center">{footer}</p>}
          </div>
          <p className="mt-2 text-xs text-slate-500">Open any order and press <b>Receipt</b> to print a real invoice.</p>
        </aside>
      </div>
    </Card>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon className="h-4 w-4 text-slate-500" />{title}</h3>
      {children}
    </section>
  );
}
