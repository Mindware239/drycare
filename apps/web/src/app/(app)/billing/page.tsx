"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BadgeCheck, CalendarClock, Check, CreditCard, FileText, Landmark, LoaderCircle, QrCode, Send, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { api, useApi, type ApiError } from "@/lib/api";
import { dateOnly, money } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

type Plan = {
  id: string; code: string; name: string; description: string | null; pricePaise: number; payablePaise: number; gstRateBps: number; gstInclusive: boolean;
  interval: string; deviceLimit: number; branchLimit: number; entitlements: Record<string, boolean>;
};
type Billing = {
  organization: { name: string; status: string; trialEndsAt: string | null };
  subscription: { id: string; status: string; startsAt: string; endsAt: string | null; cancelAt: string | null; provider: string; plan: Plan | null } | null;
  plans: Plan[];
  pay: { methods: { upi: boolean; bankTransfer: boolean; instructions: string }; upi: { vpa: string; payeeName: string } | null; bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string; branch: string } | null; online: boolean; payee: string };
  invoices: { id: string; number: string; status: string; issuedAt: string; totalPaise: number; planName: string | null; periodStart: string | null; periodEnd: string | null }[];
  claims: { id: string; provider: string; reference: string; amountPaise: number; status: string; createdAt: string; rejectedReason: string | null }[];
};
type Checkout = { keyId: string; orderId: string; amountPaise: number; currency: string; planName: string; businessName: string; customerName: string };
type RazorpayHandler = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

const FEATURE_LABELS: Record<string, string> = {
  pos: "Counter billing (POS)", garmentTracking: "Barcode garment tracking", production: "Production board", deliveries: "Pickup & delivery", laundry: "Self-service laundry",
  reports: "Reports", marketing: "Marketing campaigns", multiBranch: "Multiple branches", api: "API access", whatsapp: "WhatsApp messages",
};
const per = (interval: string) => (interval === "year" ? "year" : "month");

function loadRazorpay() {
  return new Promise<void>((resolve, reject) => {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the Razorpay payment window. Check the internet connection."));
    document.body.appendChild(s);
  });
}

export default function BillingPage() {
  const info = useApi<{ edition: string }>("/system/info");
  const desktop = info.data?.edition === "desktop";
  const { data, error, reload } = useApi<Billing>(desktop || !info.data ? null : "/commercial/billing");
  const [planId, setPlanId] = useState("");
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  useEffect(() => {
    if (!data || planId) return;
    setPlanId(data.subscription?.plan?.id && data.plans.some((p) => p.id === data.subscription!.plan!.id) ? data.subscription.plan.id : data.plans[0]?.id ?? "");
  }, [data, planId]);

  if (desktop) {
    return (
      <>
        <PageHeader title="Plan & billing" />
        <Alert tone="blue">This Windows PC runs DryCare with a desktop license. Renewals and license keys are handled by your DryCare provider; open <Link href="/settings" className="font-semibold underline">Business settings</Link> to see the license status.</Alert>
      </>
    );
  }
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner />;
  const plan = data.plans.find((p) => p.id === planId);
  const sub = data.subscription;
  const active = sub?.status === "active" && sub.endsAt && new Date(sub.endsAt) > new Date();
  const trialDays = data.organization.trialEndsAt ? Math.ceil((new Date(data.organization.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  const pendingClaim = data.claims.find((c) => c.status === "pending");

  return (
    <>
      <PageHeader title="Plan & billing" subtitle="Your DryCare subscription, how to pay, and GST invoices for your accounts." />
      {notice && <div className="mb-5"><Alert tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Alert></div>}

      {/* Status */}
      <section className={cx("mb-6 flex flex-wrap items-center gap-5 rounded-2xl border p-5", active ? "border-emerald-200 bg-emerald-50/60" : data.organization.status === "trial" && (trialDays ?? 0) > 0 ? "border-blue-200 bg-blue-50/60" : "border-amber-200 bg-amber-50/70")}>
        <span className={cx("grid h-12 w-12 place-items-center rounded-2xl", active ? "bg-emerald-600 text-white" : "bg-white text-amber-600 shadow-sm")}>{active ? <BadgeCheck className="h-6 w-6" /> : <CalendarClock className="h-6 w-6" />}</span>
        <div className="min-w-0 flex-1">
          {active ? (
            <>
              <p className="text-lg font-semibold text-slate-900">{sub.plan?.name ?? "Paid"} plan · active</p>
              <p className="text-sm text-slate-600">Paid until <strong>{dateOnly(sub.endsAt)}</strong>{sub.cancelAt ? " · will not renew" : ". Renew any time before then; extra time is added to the end date."}</p>
            </>
          ) : data.organization.status === "trial" ? (
            <>
              <p className="text-lg font-semibold text-slate-900">{trialDays !== null && trialDays > 0 ? `Free trial · ${trialDays} day${trialDays === 1 ? "" : "s"} left` : "Your free trial has ended"}</p>
              <p className="text-sm text-slate-600">{trialDays !== null && trialDays > 0 ? `Ends ${dateOnly(data.organization.trialEndsAt)}. Choose a plan below to keep using DryCare without interruption.` : "Choose a plan and pay to continue using DryCare."}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-slate-900">{sub ? "Subscription expired" : "No plan yet"}</p>
              <p className="text-sm text-slate-600">Choose a plan and pay to continue.</p>
            </>
          )}
        </div>
        {pendingClaim && <Badge color="amber">Payment {pendingClaim.reference} being verified</Badge>}
      </section>

      {!data.plans.length ? (
        <Alert tone="amber">Plans are not available yet. Please contact DryCare support to subscribe.</Alert>
      ) : (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">1 · Choose a plan</h2>
          <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.plans.map((p, i) => {
              const selected = p.id === planId;
              const current = sub?.plan?.id === p.id && active;
              const features = Object.entries(p.entitlements ?? {}).filter(([, v]) => v).map(([k]) => FEATURE_LABELS[k] ?? k);
              return (
                <button key={p.id} type="button" onClick={() => setPlanId(p.id)}
                  className={cx("relative flex flex-col rounded-2xl border bg-white p-5 text-left transition", selected ? "border-brand-500 ring-4 ring-brand-500/15" : "border-slate-200 hover:border-slate-300 hover:shadow-sm")}>
                  {i === Math.min(1, data.plans.length - 1) && data.plans.length > 1 && <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-brand-700 px-2.5 py-0.5 text-[11px] font-semibold text-white"><Sparkles className="h-3 w-3" />Popular</span>}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-semibold text-slate-900">{p.name}</p>
                    {current ? <Badge color="green">Current plan</Badge> : selected && <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white"><Check className="h-4 w-4" /></span>}
                  </div>
                  {p.description && <p className="mt-1 text-sm text-slate-500">{p.description}</p>}
                  <p className="mt-4"><span className="text-3xl font-bold tracking-tight text-slate-900">{money(p.pricePaise)}</span><span className="text-sm text-slate-500"> / {per(p.interval)}{p.gstInclusive ? " incl. GST" : " + GST"}</span></p>
                  {!p.gstInclusive && p.gstRateBps > 0 && <p className="text-xs text-slate-500">{money(p.payablePaise)} payable with {p.gstRateBps / 100}% GST</p>}
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
                    <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{p.branchLimit} branch{p.branchLimit === 1 ? "" : "es"} · {p.deviceLimit} device{p.deviceLimit === 1 ? "" : "s"}</li>
                    {features.slice(0, 6).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{f}</li>)}
                  </ul>
                </button>
              );
            })}
          </div>

          {plan && (
            <>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">2 · Pay {money(plan.payablePaise)} for {plan.name}{active && sub?.plan?.id === plan.id ? " (renewal)" : ""}</h2>
              {active && sub?.plan && sub.plan.id !== plan.id && <div className="mb-4"><Alert tone="amber">You are on {sub.plan.name} until {dateOnly(sub.endsAt)}. To switch to {plan.name}, contact DryCare support so the change is applied correctly.</Alert></div>}
              <PayOptions billing={data} plan={plan} disabled={Boolean(active && sub?.plan && sub.plan.id !== plan.id)} onDone={(text, tone = "green") => { setNotice({ tone, text }); void reload(); }} />
            </>
          )}
        </>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Invoices" padded={false}>
          {!data.invoices.length ? <p className="px-4 py-6 text-sm text-slate-500">GST invoices appear here after each payment is confirmed.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <Link href={`/billing/invoice?id=${inv.id}`} className="font-mono text-sm font-semibold text-brand-700 hover:underline">{inv.number}</Link>
                  <span className="flex-1 text-xs text-slate-500">{inv.planName ?? "Subscription"} · {dateOnly(inv.periodStart)} – {dateOnly(inv.periodEnd)}</span>
                  <span className="font-semibold tabular-nums">{money(inv.totalPaise)}</span>
                  {inv.status === "void" && <Badge color="red">void</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Payments you reported" padded={false}>
          {!data.claims.length ? <p className="px-4 py-6 text-sm text-slate-500">After paying by UPI or bank transfer, report it above so we can confirm it.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.claims.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-mono text-xs">{c.reference}</span>
                    <span className="flex-1 text-xs text-slate-500">{c.provider === "claim_bank_transfer" ? "Bank transfer" : "UPI"} · {dateOnly(c.createdAt)}</span>
                    <span className="font-semibold tabular-nums">{money(c.amountPaise)}</span>
                    <Badge color={c.status === "verified" ? "green" : c.status === "rejected" ? "red" : "amber"}>{c.status === "pending" ? "being verified" : c.status}</Badge>
                  </div>
                  {c.rejectedReason && <p className="mt-1 text-xs text-red-700">{c.rejectedReason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function PayOptions({ billing, plan, disabled, onDone }: { billing: Billing; plan: Plan; disabled: boolean; onDone: (text: string, tone?: "green" | "red") => void }) {
  const options = [
    ...(billing.pay.online ? [{ key: "online", label: "Pay online", icon: CreditCard }] : []),
    ...(billing.pay.upi ? [{ key: "upi", label: "UPI QR", icon: QrCode }] : []),
    ...(billing.pay.bank ? [{ key: "bank", label: "Bank transfer", icon: Landmark }] : []),
  ] as const;
  const [tab, setTab] = useState<string>(options[0]?.key ?? "");
  const [paying, setPaying] = useState(false);
  if (!options.length) return <Alert tone="amber">Payment details are being set up. Please contact DryCare support to pay.</Alert>;

  async function payOnline() {
    setPaying(true);
    try {
      const c = await api<Checkout>("/commercial/checkout/razorpay", { body: { planId: plan.id } });
      await loadRazorpay();
      const RZ = (window as unknown as { Razorpay: new (o: object) => { open: () => void; on: (e: string, cb: (r: { error?: { description?: string } }) => void) => void } }).Razorpay;
      const rz = new RZ({
        key: c.keyId, order_id: c.orderId, amount: c.amountPaise, currency: c.currency, name: c.businessName, description: `${c.planName} plan`,
        prefill: { name: c.customerName }, theme: { color: "#0f766e" },
        handler: async (r: RazorpayHandler) => {
          try {
            await api("/commercial/checkout/razorpay/verify", { body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } });
            onDone(`Payment received. Your ${c.planName} plan is active and the GST invoice is below.`);
          } catch (e) {
            onDone(`${(e as ApiError).message} Payment ID: ${r.razorpay_payment_id}`, "red");
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rz.on("payment.failed", (r) => onDone(r.error?.description ?? "The payment failed. No money was taken.", "red"));
      rz.open();
    } catch (e) {
      onDone((e as Error).message, "red");
      setPaying(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="dc-tabs flex gap-1 border-b border-slate-100 p-2">
          {options.map((o) => (
            <button key={o.key} type="button" onClick={() => setTab(o.key)} className={cx("inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition", tab === o.key ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:text-slate-800")}>
              <o.icon className="h-4 w-4" />{o.label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === "online" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Pay by UPI app, debit / credit card, net banking or wallet through Razorpay. Your plan is activated instantly and the GST invoice is issued automatically.</p>
              <Button size="lg" onClick={() => void payOnline()} loading={paying} disabled={disabled}><ShieldCheck className="h-4 w-4" />Pay {money(plan.payablePaise)} securely</Button>
              <p className="text-xs text-slate-500">Card and bank details are entered on Razorpay&apos;s secure window; DryCare never sees them.</p>
            </div>
          )}
          {tab === "upi" && billing.pay.upi && (
            <div className="flex flex-wrap items-start gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/v1/commercial/billing/upi-qr?planId=${plan.id}`} alt={`UPI QR for ${money(plan.payablePaise)}`} className="h-48 w-48 rounded-xl border border-slate-200 p-2" />
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <p>Scan with any UPI app (PhonePe, Google Pay, Paytm, BHIM). The amount <strong>{money(plan.payablePaise)}</strong> is filled in.</p>
                <p className="text-slate-600">Or pay to UPI ID <span className="break-all font-mono font-semibold text-slate-900">{billing.pay.upi.vpa}</span> ({billing.pay.upi.payeeName}).</p>
                <p className="text-slate-600">Then enter the UPI transaction ID in step 3.</p>
              </div>
            </div>
          )}
          {tab === "bank" && billing.pay.bank && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {[["Account name", billing.pay.bank.accountName], ["Account number", billing.pay.bank.accountNumber], ["IFSC", billing.pay.bank.ifsc], ["Bank", [billing.pay.bank.bankName, billing.pay.bank.branch].filter(Boolean).join(", ")], ["Amount", money(plan.payablePaise)]].map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-xs text-slate-500">{k}</dt><dd className="break-words font-mono font-semibold text-slate-900">{v}</dd></div>
              ))}
              <p className="text-xs text-slate-500 sm:col-span-2">Use NEFT, IMPS or RTGS, then enter the UTR number in step 3.</p>
            </dl>
          )}
          {billing.pay.methods.instructions && tab !== "online" && <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{billing.pay.methods.instructions}</p>}
        </div>
      </section>
      {(billing.pay.upi || billing.pay.bank) && <ReportPayment plan={plan} upi={Boolean(billing.pay.upi)} bank={Boolean(billing.pay.bank)} disabled={disabled} onDone={onDone} />}
    </div>
  );
}

function ReportPayment({ plan, upi, bank, disabled, onDone }: { plan: Plan; upi: boolean; bank: boolean; disabled: boolean; onDone: (text: string, tone?: "green" | "red") => void }) {
  const [method, setMethod] = useState<"upi" | "bank_transfer">(upi ? "upi" : "bank_transfer");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/commercial/payment-claims", { body: { planId: plan.id, method, reference: reference.trim(), amountPaise: plan.payablePaise, paidOn, note: note.trim() || undefined } });
      setReference("");
      setNote("");
      onDone("Thank you. We'll confirm your payment shortly; your plan is activated and the invoice issued as soon as it is verified.");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-1 flex items-center gap-2 font-semibold text-slate-900"><Send className="h-4 w-4 text-brand-700" />3 · Already paid by UPI or bank? Tell us</p>
      <p className="mb-4 text-xs text-slate-500">We match it with our bank statement and activate your plan.</p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid by">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{upi && <option value="upi">UPI</option>}{bank && <option value="bank_transfer">Bank transfer</option>}</Select>
        </Field>
        <Field label="Date paid"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} max={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label={method === "upi" ? "UPI transaction ID (UTR)" : "Bank UTR number"} required className="sm:col-span-2" hint="12–22 characters, shown in your bank or UPI app">
          <Input required minLength={6} value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className="font-mono" placeholder="e.g. 430212345678" />
        </Field>
        <Field label="Note (optional)" className="sm:col-span-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
      <Button type="submit" className="mt-4 w-full" loading={saving} disabled={disabled || reference.trim().length < 6}>
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Report payment of {money(plan.payablePaise)}
      </Button>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-slate-500"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />Never share your UPI PIN, OTP or bank password with anyone, including DryCare staff.</p>
    </form>
  );
}
