"use client";

import { COUNTRIES, guessCountry, DEFAULT_COUNTRY, countryPack } from "@drycare/shared";
import { currentLanguage } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { AuthHeading, AuthNotice, AuthShell, PasswordInput } from "@/components/marketing/AuthShell";

const businessTypes = [
  { value: "dry_cleaning", title: "Dry cleaning", text: "Garment care and dry-cleaning" },
  { value: "laundry", title: "Laundry", text: "Wash, iron and folding services" },
  { value: "ironing", title: "Ironing", text: "Pressing and ironing pickup" },
  { value: "mixed", title: "Mixed services", text: "More than one service type" },
] as const;

const underlined = { fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 } as const;

export default function SignupPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [f, setF] = useState({ country: DEFAULT_COUNTRY, ownerName: "", email: "", password: "", confirmPassword: "", businessName: "", branchName: "", phone: "", state: "", city: "", gstin: "", businessType: "dry_cleaning", outletCount: 1, counterCount: 1, acceptedTerms: false, marketingConsent: false });
  const pack = countryPack(f.country);
  // Starts on the country this computer's clock is set to.
  useEffect(() => {
    const here = guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language);
    if (here) setF((current) => ({ ...current, country: here }));
  }, []);
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
        language: currentLanguage(),
        outletCount: Number(account.outletCount),
        counterCount: Number(account.counterCount),
      };
      await api("/organizations", { body });
      // Came from linking a shop PC: go straight back to that approval (only this one in-app path is accepted).
      const next = new URLSearchParams(window.location.search).get("next");
      // A plan chosen on the pricing page: the trial has started, so go on to paying for it.
      let wanted: string | null = null;
      try { wanted = localStorage.getItem("drycare.wantPlan"); } catch {}
      window.location.assign(next && /^\/link-device\?code=[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(next) ? next : wanted && /^[a-z0-9-]{1,60}$/.test(wanted) ? `/billing?plan=${wanted}` : "/onboarding");
    } catch (err) {
      setError((err as ApiError).message);
      setLoading(false);
    }
  }

  return (
    <AuthShell maxWidth={640}>
      <div aria-label={`Step ${step} of 2`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {[1, 2].map((item) => (
          <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, flex: item === 1 ? 1 : "none" }}>
            <span style={{ width: 36, height: 36, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 600, background: step > item ? "#3cbf5a" : step === item ? "#151514" : "#f3f1ec", color: step > item ? "#151514" : step === item ? "#faf8f4" : "#4f4e4a" }}>{step > item ? "✓" : item}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: step === item ? "#151514" : "#6b6963", whiteSpace: "nowrap" }}>{item === 1 ? "Owner account" : "Create store"}</span>
            {item === 1 && <span style={{ flex: 1, height: 1, background: step === 2 ? "#3cbf5a" : "#e4e1d9" }} />}
          </div>
        ))}
      </div>

      {step === 1 ? (
        <>
          <AuthHeading title="First, create your login">This account will own the store and can invite staff. You will create the store details in the next step.</AuthHeading>
          <div className="dc-form">
            {error && <div className="dc-full"><AuthNotice tone="bad">{error}</AuthNotice></div>}
            <label className="dc-label-lg dc-full">Your full name<input className="dc-input dc-input-lg" required value={f.ownerName} onChange={set("ownerName")} placeholder="Owner or manager name" autoComplete="name" /></label>
            <label className="dc-label-lg dc-full">Work email<input className="dc-input dc-input-lg" required type="email" value={f.email} onChange={set("email")} placeholder="you@yourstore.in" autoComplete="email" /></label>
            <label className="dc-label-lg"><span>Password <span className="dc-opt">(minimum 10 characters)</span></span><PasswordInput required value={f.password} onChange={set("password")} placeholder="Create a password" autoComplete="new-password" /></label>
            <label className="dc-label-lg"><span>Confirm password</span><PasswordInput required value={f.confirmPassword} onChange={set("confirmPassword")} placeholder="Confirm password" autoComplete="new-password" /></label>
            <button type="button" onClick={nextStep} className="dc-btn-block dc-full" style={{ marginTop: 4 }}>Continue to create store →</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <AuthHeading title="Create your Drycare store">Set up the first branch now. Your starter catalogue and counter workflow will be ready from day one.</AuthHeading>
          {error && <AuthNotice tone="bad">{error}</AuthNotice>}
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ marginBottom: 10, padding: 0, fontSize: 15, fontWeight: 500 }}>What kind of business do you run?</legend>
            <div className="dc-g-2" style={{ gap: 12 }}>
              {businessTypes.map((type) => {
                const on = f.businessType === type.value;
                return (
                  <label key={type.value} style={{ cursor: "pointer", borderRadius: 14, border: `1.5px solid ${on ? "#151514" : "#d6d3cb"}`, background: on ? "#f7f7f5" : "#fff", padding: 16, transition: "border-color .2s ease, background .2s ease" }}>
                    <input className="sr-only" type="radio" name="businessType" value={type.value} checked={on} onChange={set("businessType")} />
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 600 }}>{type.title}{on && <span aria-hidden="true" className="dc-tick" style={{ width: 20, height: 20, fontSize: 11 }}>✓</span>}</span>
                    <span className="dc-small" style={{ display: "block", marginTop: 4, fontSize: 13 }}>{type.text}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="dc-form">
            <label className="dc-label-lg dc-full">Country<select className="dc-input dc-input-lg" value={f.country} onChange={set("country")}>{[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
            <label className="dc-label-lg dc-full">Store or business name<input className="dc-input dc-input-lg" required value={f.businessName} onChange={set("businessName")} placeholder="e.g. CleanCare Garment Services" /></label>
            <label className="dc-label-lg dc-full"><span>First branch name <span className="dc-opt">(optional, we&apos;ll call it “Main Store”)</span></span><input className="dc-input dc-input-lg" value={f.branchName} onChange={set("branchName")} placeholder="Main Store" /></label>
            <label className="dc-label-lg">City<input className="dc-input dc-input-lg" value={f.city} onChange={set("city")} placeholder="e.g. Pune" /></label>
            <label className="dc-label-lg">State<input className="dc-input dc-input-lg" value={f.state} onChange={set("state")} placeholder="e.g. Maharashtra" /></label>
            <label className="dc-label-lg">Mobile number<input className="dc-input dc-input-lg" value={f.phone} onChange={set("phone")} placeholder={`+${pack.dialCode}`} autoComplete="tel" /></label>
            <label className="dc-label-lg"><span>{pack.taxIdLabel} <span className="dc-opt">(optional)</span></span><input className="dc-input dc-input-lg" value={f.gstin} onChange={(event) => setF({ ...f, gstin: event.target.value.toUpperCase() })} placeholder="22AAAAA0000A1Z5" /></label>
            <label className="dc-label-lg">Outlets<input className="dc-input dc-input-lg" type="number" min={1} max={1000} value={f.outletCount} onChange={set("outletCount")} /></label>
            <label className="dc-label-lg">Counters<input className="dc-input dc-input-lg" type="number" min={1} max={1000} value={f.counterCount} onChange={set("counterCount")} /></label>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, lineHeight: 1.5, color: "#33332f" }}><input required type="checkbox" checked={f.acceptedTerms} onChange={set("acceptedTerms")} style={{ width: 20, height: 20, flex: "none", marginTop: 1, accentColor: "#151514" }} /><span>I agree to the <Link target="_blank" href="/legal/terms" style={underlined}>Terms of Service</Link> and <Link target="_blank" href="/legal/privacy" style={underlined}>Privacy Policy</Link>.</span></label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, lineHeight: 1.5, color: "#33332f" }}><input type="checkbox" checked={f.marketingConsent} onChange={set("marketingConsent")} style={{ width: 20, height: 20, flex: "none", marginTop: 1, accentColor: "#151514" }} /><span>Send me useful setup tips and product updates. You can unsubscribe anytime.</span></label>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={() => { setStep(1); setError(""); }} className="dc-btn dc-btn-line" style={{ flex: "none" }}>← Back</button>
            <button type="submit" disabled={loading} className="dc-btn-block" style={{ flex: 1, width: "auto" }}>{loading ? "Creating store…" : "Create store →"}</button>
          </div>
        </form>
      )}

      <div style={{ paddingTop: 20, borderTop: "1px solid #eeece6", fontSize: 15, color: "#4f4e4a" }}>Already have a store? <Link href="/login" style={underlined}>Sign in</Link></div>
    </AuthShell>
  );
}
