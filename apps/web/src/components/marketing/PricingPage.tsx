"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { COUNTRIES } from "@drycare/shared";
import { SlideGroup } from "@/components/SlideGroup";
import { chooseVisitorCountry, cleanMoney, ELSEWHERE, visitor, visitorCountry, visitorPrice } from "@/lib/visitor";
import { Accordion, EnquiryForm, useVw } from "./parts";

const FAQS: [string, string][] = [
  ["Which plan is suitable for my laundry?", "Starter suits a single store that needs order booking, garment tagging and billing. Growth adds pickup and delivery, customer updates, memberships and advanced reports. Enterprise is for chains, franchises and central processing plants. Our team can help you decide."],
  ["Can I use Drycare without purchasing hardware?", "Yes. Drycare can be purchased on its own. If you already have a receipt printer, tag printer or scanner, our team can check whether it is compatible."],
  ["Can I print garment tags with barcodes?", "Yes. Drycare supports garment tagging with barcode labels. You will need a compatible tag or label printer, which we can supply as part of a bundle quotation."],
  ["Can I upgrade from Starter to Growth?", "Yes, you can move to Growth as your business grows. Contact our team and they will explain how the change is applied to your current billing period."],
  ["Is pricing calculated per store?", "The Starter and Growth prices shown are for one store. For several stores or a central processing plant, Enterprise pricing is based on your setup and requirements."],
  ["Are GST and installation charges included?", "GST is applied as per applicable rates. Hardware is sold separately from the software. The Hardware & Accessories page shows each package, including its freight, delivery and installation charge in India."],
  ["Can Drycare manage multiple stores and a central plant?", "Yes. The Enterprise Plan includes a multi-store dashboard, store-to-plant garment transfer, consolidated reports and central price control."],
  ["Can I request a custom Enterprise quotation?", "Yes. Share your store count, plant setup and integration needs through the enquiry form, and our team will prepare a quotation."],
];
const DEFAULT_INTEREST = "Not sure yet — help me choose";
type PublicPlan = { id: string; code: string; name: string; description: string | null; pricePaise: number; interval: string; branchLimit: number; deviceLimit: number; included: string[] };
type PublicPlans = { features: { key: string; label: string }[]; plans: PublicPlan[] };
/** Sold by quotation, so it always appears, unless a plan called Enterprise is on offer. */
const CONTACT_PLAN = { id: "contact", name: "Enterprise", tagline: "Centralised management for laundry chains, franchises and central processing plants.", note: "Custom pricing by stores, plants, integrations and support." };

export function PricingPage() {
  const vw = useVw();
  const cw = Math.min(vw, 1180) - 64;
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");
  const annual = period === "year";
  const [offer, setOffer] = useState<PublicPlans | null>(null);
  useEffect(() => { void fetch("/api/v1/commercial/public-plans").then((r) => (r.ok ? r.json() : null)).then(setOffer).catch(() => setOffer({ features: [], plans: [] })); }, []);
  const hasYearly = !!offer?.plans.some((p) => p.interval === "year");
  const hasQuarterly = !!offer?.plans.some((p) => p.interval === "quarter");
  const shownPlans = offer?.plans.filter((p) => p.interval === (period === "year" && !hasYearly ? "month" : period)) ?? [];
  const showContact = !offer?.plans.some((p) => p.name.toLowerCase().startsWith("enterprise"));
  const interestOptions = [DEFAULT_INTEREST, "Talk to sales", ...shownPlans.map((p) => p.name), ...(showContact ? [CONTACT_PLAN.name] : [])];
  // Prices follow the visitor's country, and start in rupees until the browser has told us where that is.
  const [country, setCountry] = useState("IN");
  useEffect(() => setCountry(visitorCountry()), []);
  const place = visitor(country);
  /** A rupee list price as this visitor pays it, in hundredths of their currency. */
  const local = (rupeeMinor: number) => visitorPrice(rupeeMinor, place);
  const show = (minor: number) => cleanMoney(minor, place.currency);
  const [cmp, setCmp] = useState(0);
  const [interest, setInterest] = useState(DEFAULT_INTEREST);
  const enquiry = useRef<HTMLElement>(null);
  /** Online buying is in India for now: a new shop signs up and starts its trial, then lands on the payment step with this plan chosen. */
  const buy = async (code: string) => {
    try { localStorage.setItem("drycare.wantPlan", code); } catch {}
    const signedIn = await fetch("/api/v1/auth/session").then((r) => r.ok).catch(() => false);
    window.location.assign(signedIn ? `/billing?plan=${encodeURIComponent(code)}` : "/signup");
  };
  const goEnquiry = (value: string) => {
    setInterest(value);
    if (enquiry.current) window.scrollTo({ top: enquiry.current.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
  };
  const narrow = cw < 640;
  const safeCmp = Math.min(cmp, Math.max(shownPlans.length - 1, 0));
  const cols = narrow ? (shownPlans.length ? [safeCmp] : []) : shownPlans.map((_, i) => i);
  const cmpCols = narrow ? "minmax(0,1.6fr) minmax(0,1fr)" : `minmax(0,2fr) repeat(${Math.max(shownPlans.length, 1)},minmax(0,1fr))`;
  const featuresInAny = offer?.features.filter((f) => shownPlans.some((p) => p.included.includes(f.key))) ?? [];
  const popular = shownPlans.length > 1 ? 1 : -1;

  return (
    <>
      <section style={{ padding: "16px 16px 96px" }}>
        <div className="dc-wrap" style={{ padding: "clamp(32px, 5vw, 56px) 16px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18, maxWidth: 760, margin: "0 auto" }}>
            <span className="dc-eyebrow">Drycare · Laundry &amp; Dry Cleaning Software</span>
            <h1 className="dc-h1" style={{ fontSize: "clamp(38px, 5vw, 60px)" }}>The Right Plan for Your Laundry Business</h1>
            <p className="dc-lead">From single-store dry cleaners to multi-branch laundry chains, choose a plan that simplifies order booking, garment tracking, pickups, deliveries and payments.</p>
            {hasYearly && <SlideGroup label="Billing period" color="#151514" style={{ display: "flex", gap: 4, padding: 5, borderRadius: 999, background: "#f3f1ec", border: "1px solid #e4e1d9", marginTop: 10 }}>
              {([["Monthly", "month", null], ...(hasQuarterly ? [["Quarterly", "quarter", null]] : []), ["Annual", "year", null]] as ["Monthly" | "Quarterly" | "Annual", "month" | "quarter" | "year", null][]).map(([label, value, tag]) => {
                const on = period === value;
                return (
                  <button key={label} type="button" role="radio" aria-checked={on} onClick={() => setPeriod(value)} style={{ font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 44, padding: "10px 24px", borderRadius: 999, border: 0, background: "transparent", color: on ? "#faf8f4" : "#151514", display: "flex", alignItems: "center", gap: 8 }}>
                    {label}{tag && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: on ? "#3cbf5a" : "#dff3e4", color: on ? "#151514" : "#1f6b34" }}>{tag}</span>}
                  </button>
                );
              })}
            </SlideGroup>}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "#4f4e4a" }}>
              Prices for
              <select aria-label="Prices for" data-i18n-skip="" value={country} onChange={(event) => chooseVisitorCountry(event.target.value)} style={{ font: "inherit", fontWeight: 600, color: "#151514", background: "#fff", border: "1px solid #e4e1d9", borderRadius: 10, padding: "6px 10px", maxWidth: 240 }}>
                {[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}
                <option value={ELSEWHERE}>Other countries (USD)</option>
              </select>
            </label>
            <span aria-live="polite" style={{ fontSize: 14, color: "#6b6963" }}>{period === "quarter" ? "Quarterly plans are billed every 3 months." : annual ? "Annual plans are billed upfront for 12 months." : "Monthly plans are billed every month. Switch to Annual to pay upfront and save."}</span>
          </div>

          <div className="dc-g-plans">
            {!offer && <p style={{ gridColumn: "1 / -1", textAlign: "center", color: "#6b6963" }}>Loading plans…</p>}
            {shownPlans.map((p, index) => {
              const hi = index === popular;
              const sub = hi ? "#cfccc4" : "#4f4e4a";
              const yearly = p.interval === "year";
              const amount = local(p.pricePaise);
              const price = show(amount);
              const quarterly = p.interval === "quarter";
              const per = yearly ? "/ year" : quarterly ? "/ quarter" : "/ month";
              const billing = yearly ? `Billed ${price} upfront each year · about ${show(Math.round(amount / 1200) * 100)}/month` : quarterly ? `Billed ${price} every 3 months · about ${show(Math.round(amount / 300) * 100)}/month` : "Billed monthly";
              const list = [`${p.branchLimit} branch${p.branchLimit === 1 ? "" : "es"} · ${p.deviceLimit} device${p.deviceLimit === 1 ? "" : "s"}`, ...offer?.features.filter((f) => p.included.includes(f.key)).map((f) => f.label) ?? []];
              return (
                <article key={p.id} className={`dc-plan${hi ? " dc-plan-hi" : ""}`}>
                  {hi && <span style={{ position: "absolute", top: -13, left: 28, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", padding: "5px 12px", borderRadius: 999, background: "#3cbf5a", color: "#151514" }}>RECOMMENDED</span>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <h2 className="dc-t" style={{ margin: 0, fontSize: 24 }}>{p.name}</h2>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: sub, minHeight: 45 }}>{p.description}</p>
                  </div>
                  <div className="dc-plan-price" style={{ borderBottom: `1px solid ${hi ? "#33332f" : "#eeece6"}` }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: '"Urbanist", sans-serif', fontSize: 44, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1 }}>{price}</span>
                      <span style={{ fontSize: 15, color: sub }}>{per}</span>
                    </div>
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: sub }}>{billing}</span>
                  </div>
                  <button type="button" onClick={() => { if (place.india) void buy(p.code); else goEnquiry(p.name); }} className={`dc-btn ${hi ? "dc-btn-green" : "dc-btn-outline"}`} style={{ justifyContent: "center", whiteSpace: "nowrap" }}>{`Choose ${p.name} →`}</button>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11 }}>
                    {list.map((feature) => (
                      <li key={feature} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", gap: 10, fontSize: 14, lineHeight: 1.45, color: hi ? "#faf8f4" : "#333330" }}>
                        <span aria-hidden="true" className="dc-tick" style={{ width: 20, height: 20, fontSize: 11, marginTop: 1, background: hi ? "#3cbf5a" : "#dff3e4", color: "#151514" }}>✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
            {offer && showContact && (
              <article className="dc-plan">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <h2 className="dc-t" style={{ margin: 0, fontSize: 24 }}>{CONTACT_PLAN.name}</h2>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#4f4e4a", minHeight: 45 }}>{CONTACT_PLAN.tagline}</p>
                </div>
                <div className="dc-plan-price" style={{ borderBottom: "1px solid #eeece6" }}>
                  <span style={{ fontFamily: '"Urbanist", sans-serif', fontSize: 32, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1 }}>Custom Pricing</span>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#4f4e4a" }}>{CONTACT_PLAN.note}</span>
                </div>
                <button type="button" onClick={() => goEnquiry(CONTACT_PLAN.name)} className="dc-btn dc-btn-outline" style={{ justifyContent: "center", whiteSpace: "nowrap" }}>Contact Us for Pricing →</button>
              </article>
            )}
          </div>
          <p style={{ margin: "28px 0 0", textAlign: "center", fontSize: 14, color: "#6b6963" }}>{place.india ? "Choose a plan to sign up and start using Drycare straight away, then pay online, by UPI or by bank transfer. Prices shown are for one store, plus GST. Hardware is charged separately." : "Online buying is available in India for now. Choose a plan and our team will help you. Prices shown are for one store. Hardware is charged separately."}</p>
        </div>
      </section>

      <section id="bundles" className="dc-sec" style={{ paddingTop: 16, gap: 36 }}>
        <div className="dc-head" style={{ maxWidth: 640 }}>
          <h2 className="dc-h2">Complete Your Store Setup</h2>
          <p className="dc-body">Combine Drycare with compatible printers and scanners for a complete counter and garment-tagging setup.</p>
        </div>
        <div className="dc-card-18" style={{ padding: 26, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <p style={{ margin: 0, flex: "1 1 320px", fontSize: 16, lineHeight: 1.5, color: "#33332f" }}>Starter Setup, Professional Setup and Complete Store Setup: see every item and quantity you get, with prices and delivery.</p>
          <Link href="/hardware#packages" className="dc-btn dc-btn-outline" style={{ alignSelf: "auto" }}>See Hardware Packages →</Link>
        </div>
</section>

      <section className="dc-sec" style={{ paddingTop: 16, gap: 32 }}>
        <div className="dc-head" style={{ maxWidth: 640 }}>
          <h2 className="dc-h2">Compare Plans</h2>
          <p className="dc-body">See what&apos;s included in each plan at a glance.</p>
        </div>
        {narrow && (
          <div role="tablist" aria-label="Choose a plan to compare" style={{ display: "flex", gap: 6, padding: 5, borderRadius: 999, background: "#f3f1ec", alignSelf: "flex-start", flexWrap: "wrap" }}>
            {shownPlans.map((p, i) => <button key={p.id} type="button" role="tab" aria-selected={i === safeCmp} onClick={() => setCmp(i)} style={{ font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 44, padding: "10px 20px", borderRadius: 999, border: 0, background: i === safeCmp ? "#151514" : "transparent", color: i === safeCmp ? "#faf8f4" : "#151514" }}>{p.name.replace(" Plan", "")}</button>)}
          </div>
        )}
        <div style={{ border: "1.5px solid #151514", borderRadius: 18, overflow: "hidden" }}>
          <div role="table" aria-label="Plan feature comparison" style={{ display: "flex", flexDirection: "column", fontSize: 15 }}>
            <div role="row" style={{ display: "grid", gridTemplateColumns: cmpCols, background: "#f7f7f5" }}>
              <span role="columnheader" style={{ padding: "16px 20px", fontWeight: 600, fontSize: 14, color: "#4f4e4a" }}>Feature</span>
              {cols.map((i) => <span key={i} role="columnheader" className="dc-t" style={{ textAlign: "center", padding: "16px 12px", fontSize: 17, letterSpacing: "normal", background: i === popular ? "#d8e7fa" : "transparent" }}>{shownPlans[i].name}</span>)}
            </div>
            {featuresInAny.map((f) => (
              <div key={f.key} role="row" style={{ display: "grid", gridTemplateColumns: cmpCols, borderTop: "1px solid #eeece6", alignItems: "stretch" }}>
                <span role="rowheader" style={{ padding: "14px 20px", fontWeight: 500, display: "flex", alignItems: "center" }}>{f.label}</span>
                {cols.map((i) => (
                  <Fragment key={i}>
                    <span role="cell" style={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "14px 12px", background: i === popular ? "#eef4fc" : "transparent" }}>
                      {shownPlans[i].included.includes(f.key) ? <span role="img" aria-label="Included" className="dc-tick" style={{ width: 24, height: 24 }}>✓</span> : <span role="img" aria-label="Not included" style={{ color: "#9a988f" }}>—</span>}
                    </span>
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="dc-band">
        <section id="faq" className="dc-band-sec" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "40px 72px", alignItems: "start" }}>
          <div className="dc-side" style={{ maxWidth: 400 }}>
            <h2 className="dc-h2">Frequently Asked Questions</h2>
            <p className="dc-body">Have another question about pricing? Our team is happy to help.</p>
            <button type="button" onClick={() => goEnquiry("Talk to sales")} className="dc-btn dc-btn-outline" style={{ marginTop: 8 }}>Ask our team →</button>
          </div>
          <Accordion items={FAQS} />
        </section>
      </div>

      <section ref={enquiry} id="enquiry" style={{ padding: "0 16px 96px" }}>
        <div className="dc-cta-split">
          <div className="dc-side" style={{ gap: 20 }}>
            <h2 style={{ margin: 0, fontFamily: '"Urbanist", sans-serif', fontWeight: 600, fontSize: "clamp(34px, 4.2vw, 52px)", lineHeight: 1.08, letterSpacing: "-.02em", textWrap: "balance" }}>Not Sure Which Plan Fits Your Laundry?</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#cfccc4", textWrap: "pretty" }}>Tell us about your laundry or dry cleaning business, and our team can help you choose the right Drycare plan.</p>
            <div className="dc-row" style={{ paddingTop: 4 }}>
              <button type="button" onClick={() => goEnquiry("Talk to sales")} className="dc-btn dc-btn-green" style={{ minHeight: 44 }}>Talk to Sales</button>
              <Link href="/#demo" className="dc-btn dc-btn-ghost">Request a Demo</Link>
            </div>
          </div>
          <div className="dc-form-panel">
            <EnquiryForm interest={interest} onInterest={setInterest} interestOptions={interestOptions} />
          </div>
        </div>
      </section>
    </>
  );
}
