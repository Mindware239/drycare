"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Cloud, FileText, Mail, ReceiptText, ShieldCheck, Truck, UserRound, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Alert, Field, Input, cx } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { AuthBadge, AuthTile, BrandName, IconInput, SecretInput, primaryButton } from "@/components/AuthUi";

const businessTypes = [
  { value: "dry_cleaning", title: "Dry cleaning", text: "Garment care and dry-cleaning" },
  { value: "laundry", title: "Laundry", text: "Wash, iron and folding services" },
  { value: "ironing", title: "Ironing", text: "Pressing and ironing pickup" },
  { value: "mixed", title: "Mixed services", text: "More than one service type" },
] as const;

export default function SignupPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [f, setF] = useState({ ownerName: "", email: "", password: "", confirmPassword: "", businessName: "", branchName: "", phone: "", state: "", city: "", gstin: "", businessType: "dry_cleaning", outletCount: 1, counterCount: 1, acceptedTerms: false, marketingConsent: false });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof f) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target instanceof HTMLInputElement && event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setF((current) => ({ ...current, [key]: value }));
  };

  const nextStep = () => {
    setError("");
    if (!f.ownerName.trim() || !f.email.trim() || f.password.length < 10) {
      setError("Complete your name, email and a password of at least 10 characters.");
      return;
    }
    if (f.password !== f.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setStep(2);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { confirmPassword, ...account } = f;
      const body = {
        ...Object.fromEntries(Object.entries(account).filter(([, value]) => typeof value !== "string" || value.trim() !== "")),
        outletCount: Number(account.outletCount),
        counterCount: Number(account.counterCount),
      };
      await api("/organizations", { body });
      // Came from linking a shop PC: go straight back to that approval (only this one in-app path is accepted).
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && /^\/link-device\?code=[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(next) ? next : "/onboarding");
    } catch (err) {
      setError((err as ApiError).message);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f2f8f8] lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(520px,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[#06262c] text-white lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start">
        {/* Store photo on the right, fading into the dark panel behind the text */}
        <div className="absolute inset-y-0 right-0 w-[48%] bg-cover bg-center 2xl:w-[50%]" style={{ backgroundImage: "url(/images/signup-hero.jpg)" }} aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#06262c_0%,#06262c_56%,rgba(6,38,44,0.75)_68%,rgba(6,38,44,0.15)_86%,rgba(6,38,44,0)_100%)] 2xl:bg-[linear-gradient(90deg,#06262c_0%,#06262c_40%,rgba(6,38,44,0.82)_50%,rgba(6,38,44,0.2)_66%,rgba(6,38,44,0)_80%)]" aria-hidden="true" />
        <div className="absolute -left-32 top-10 h-[30rem] w-[30rem] rounded-full bg-teal-500/15 blur-3xl" aria-hidden="true" />

        <div className="relative flex h-full min-h-0 flex-col justify-between p-10 2xl:p-14 [@media(max-height:820px)]:py-7">
          <Link href="/" className="flex w-fit items-center gap-3.5"><Logo className="h-14 w-14 rounded-2xl" /><BrandName className="text-[32px] text-white" /></Link>

          <div className="max-w-[440px] py-8 2xl:max-w-[500px] 2xl:py-10 [@media(max-height:820px)]:py-4">
            <div className="grid grid-cols-2 gap-3.5">
              <AuthTile icon={FileText} title="Orders" text="Barcode tracked" />
              <AuthTile icon={ReceiptText} title="Billing" text="GST ready" />
              <AuthTile icon={Users} title="Customers" text="Complete history" />
              <AuthTile icon={Truck} title="Delivery" text="Handover proof" />
            </div>
            <h2 className="mt-8 text-[38px] font-bold leading-[1.1] tracking-tight 2xl:mt-10 2xl:text-5xl [@media(max-height:820px)]:mt-5 [@media(max-height:820px)]:text-[32px]">
              Run the counter with every garment
              <span className="block bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">accounted for.</span>
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-200">One system for intake, processing, billing and customer collection — designed around real dry-cleaning and laundry workflows.</p>
          </div>

          <div className="max-w-[500px] border-t border-white/15 pt-6">
            <div className="flex items-center gap-5 text-sm text-slate-200">
              <AuthBadge icon={ShieldCheck} lines={["Secure", "& reliable"]} />
              <span className="h-9 w-px bg-white/15" />
              <AuthBadge icon={Cloud} lines={["Local-first", "Windows app"]} />
              <span className="h-9 w-px bg-white/15" />
              <AuthBadge icon={Users} lines={["Role-based", "team access"]} />
            </div>
          </div>
        </div>
      </aside>

      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-6 sm:px-8 xl:px-12">
        <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-teal-100/80 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-cyan-100/80 blur-2xl" aria-hidden="true" />

        <div className="relative w-full max-w-[640px] rounded-3xl border border-white bg-white px-6 py-7 shadow-[0_30px_80px_-30px_rgba(6,38,44,0.25)] sm:px-10 sm:py-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2.5"><Logo className="h-11 w-11 rounded-xl" /><BrandName className="text-2xl text-slate-900" /></Link>
            <p className="text-sm text-slate-500">Already have a store? <Link href="/login" className="font-semibold text-teal-700 hover:text-teal-800">Sign in</Link></p>
          </div>

          <div className="mt-8 flex items-center gap-4 2xl:px-6" aria-label={`Step ${step} of 2`}>
            {[1, 2].map((item) => (
              <div key={item} className={cx("flex items-center gap-3", item === 1 && "flex-1")}>
                <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold", step >= item ? "bg-teal-800 text-white" : "bg-slate-100 text-slate-700")}>{step > item ? <Check className="h-4 w-4" /> : item}</span>
                <p className={cx("text-sm font-semibold", step === item ? "text-slate-900" : "text-slate-400")}>{item === 1 ? "Owner account" : "Create store"}</p>
                {item === 1 && <div className={cx("mx-2 h-px flex-1", step === 2 ? "bg-teal-600" : "bg-slate-200")} />}
              </div>
            ))}
          </div>

          <div className="mt-8 2xl:px-6">
            {step === 1 ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">YOUR ACCOUNT</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">First, create your login</h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600">This account will own the store and can invite staff. You will create the store details in the next step.</p>
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
                  <Field label="Your full name" required className="sm:col-span-2"><IconInput icon={UserRound} required value={f.ownerName} onChange={set("ownerName")} placeholder="Owner or manager name" autoComplete="name" /></Field>
                  <Field label="Work email" required className="sm:col-span-2"><IconInput icon={Mail} required type="email" value={f.email} onChange={set("email")} placeholder="you@yourstore.com" autoComplete="email" /></Field>
                  <Field label="Password" required hint="Minimum 10 characters"><SecretInput required value={f.password} onChange={set("password")} placeholder="Create a password" autoComplete="new-password" /></Field>
                  <Field label="Confirm password" required><SecretInput required value={f.confirmPassword} onChange={set("confirmPassword")} placeholder="Confirm password" autoComplete="new-password" /></Field>
                  <div className="pt-1 sm:col-span-2"><button type="button" onClick={nextStep} className={primaryButton}>Continue to create store <ArrowRight className="h-5 w-5" /></button></div>
                </div>
              </>
            ) : (
              <form onSubmit={submit}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">YOUR STORE</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">Create your DryCare store</h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600">Set up the first branch now. Your starter catalogue and counter workflow will be ready from day one.</p>
                {error && <div className="mt-6"><Alert>{error}</Alert></div>}
                <fieldset className="mt-7">
                  <legend className="mb-3 text-xs font-semibold text-slate-700">What kind of business do you run?</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {businessTypes.map((type) => (
                      <label key={type.value} className={`cursor-pointer rounded-xl border p-4 transition ${f.businessType === type.value ? "border-teal-600 bg-teal-50 ring-2 ring-teal-600/10" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                        <input className="sr-only" type="radio" name="businessType" value={type.value} checked={f.businessType === type.value} onChange={set("businessType")} />
                        <span className="flex items-center justify-between"><span className="font-semibold text-slate-900">{type.title}</span>{f.businessType === type.value && <Check className="h-4 w-4 text-teal-700" />}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{type.text}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <Field label="Store or business name" required className="sm:col-span-2"><Input className="h-12 rounded-xl" required value={f.businessName} onChange={set("businessName")} placeholder="e.g. CleanCare Garment Services" /></Field>
                  <Field label="First branch name" hint="Optional — we'll call it “Main Store”. You can add more branches later." className="sm:col-span-2"><Input className="h-12 rounded-xl" value={f.branchName} onChange={set("branchName")} placeholder="Main Store" /></Field>
                  <Field label="City"><Input className="h-12 rounded-xl" value={f.city} onChange={set("city")} placeholder="e.g. Pune" /></Field>
                  <Field label="State"><Input className="h-12 rounded-xl" value={f.state} onChange={set("state")} placeholder="e.g. Maharashtra" /></Field>
                  <Field label="Mobile number"><Input className="h-12 rounded-xl" value={f.phone} onChange={set("phone")} placeholder="+91" autoComplete="tel" /></Field>
                  <Field label="GSTIN" hint="Optional — can be added later"><Input className="h-12 rounded-xl" value={f.gstin} onChange={(event) => setF({ ...f, gstin: event.target.value.toUpperCase() })} placeholder="22AAAAA0000A1Z5" /></Field>
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2"><Field label="Outlets"><Input className="h-12 rounded-xl" type="number" min={1} max={1000} value={f.outletCount} onChange={set("outletCount")} /></Field><Field label="Counters"><Input className="h-12 rounded-xl" type="number" min={1} max={1000} value={f.counterCount} onChange={set("counterCount")} /></Field></div>
                  <div className="space-y-4 sm:col-span-2">
                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600"><input required type="checkbox" checked={f.acceptedTerms} onChange={set("acceptedTerms")} className="mt-1 h-4 w-4 accent-brand-700" /><span>I agree to the <Link target="_blank" href="/legal/terms" className="font-semibold text-brand-700">Terms of Service</Link> and <Link target="_blank" href="/legal/privacy" className="font-semibold text-brand-700">Privacy Policy</Link>.</span></label>
                    <label className="flex items-start gap-3 text-sm text-slate-600"><input type="checkbox" checked={f.marketingConsent} onChange={set("marketingConsent")} className="mt-0.5 h-4 w-4 accent-brand-700" /><span>Send me useful setup tips and product updates. You can unsubscribe anytime.</span></label>
                    <div className="flex gap-3 pt-1"><button type="button" onClick={() => { setStep(1); setError(""); }} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /> Back</button><button type="submit" disabled={loading} className={cx(primaryButton, "flex-1")}>{loading ? "Creating store…" : "Create store"}<ArrowRight className="h-5 w-5" /></button></div>
                  </div>
                </div>
              </form>
            )}
          </div>
          <p className="mt-8 text-center text-xs text-slate-400">DryCare · Private, local-first store operations</p>
        </div>
      </section>
    </main>
  );
}
