"use client";

import Link from "next/link";
import { Fragment, useRef, useState } from "react";
import { Accordion, EnquiryForm, useVw } from "./parts";

const PLANS = [
  { id: "starter", name: "Starter Plan", tagline: "Everything you need to run a single laundry or dry cleaning store.", monthly: 1499, annual: 14999, cta: "Choose Starter →", features: ["Order booking and GST invoices", "Garment tagging with barcode labels", "Service and price list (wash, dry clean, iron, steam press)", "Order status: received, in process, ready, delivered", "Due dates and ready-for-pickup tracking", "Customer records and order history", "Advance payments, discounts and multiple payment modes", "Basic daily sales and order reports", "Basic staff access and permissions", "Email and phone support"] },
  { id: "growth", name: "Growth Plan", tagline: "Advanced control for growing laundries, dry cleaners and pickup-delivery services.", monthly: 2499, annual: 24999, cta: "Get Growth Plan →", badge: "RECOMMENDED", lead: "Everything in Starter, plus:", features: ["Pickup and delivery scheduling", "Delivery staff assignment and route lists", "Customer order updates by SMS or WhatsApp", "Packages, memberships and prepaid plans", "Customer wallet, credit and dues tracking", "Stain and damage notes with garment photos", "Rack and bin locations for ready garments", "Consumables inventory (detergents, hangers, packaging)", "Advanced sales, service and customer reports", "Staff shifts, permissions and activity logs", "Priority onboarding and staff training"] },
  { id: "enterprise", name: "Enterprise Plan", tagline: "Centralised management for laundry chains, franchises and central processing plants.", custom: true, cta: "Contact Us for Pricing →", note: "Tailored pricing based on store count, processing plants, integrations and business requirements.", features: ["Everything in Growth", "Centralised multi-store dashboard", "Store-to-plant garment transfer and tracking", "Central workshop and processing management", "Consolidated sales, order and garment reports", "Central price list and service control", "Store and franchise-specific roles and permissions", "Central consumables purchasing", "Custom reports and business integrations", "Dedicated onboarding and priority support"] },
];
const BUNDLES: [string, string[]][] = [
  ["Basic Store Bundle", ["Drycare Starter software", "Compatible receipt printer", "Garment tag / barcode label printer", "Installation assistance"]],
  ["Laundry Growth Bundle", ["Drycare Growth software", "Receipt printer", "Tag printer and barcode scanner", "Setup and staff training"]],
  ["Multi-Store & Plant Bundle", ["Drycare Growth or Enterprise software", "Printers for each store and plant", "Barcode scanners for garment tracking", "Deployment assistance"]],
];
const COMPARE: [string, string, string, string][] = [
  ["Order booking and GST invoices", "Y", "Y", "Y"],
  ["Garment tagging and barcodes", "Y", "Y", "Y"],
  ["Order status tracking", "Y", "Y", "Y"],
  ["Pickup and delivery management", "N", "Y", "Y"],
  ["Customer SMS / WhatsApp updates", "N", "Y", "Y"],
  ["Packages and memberships", "N", "Y", "Y"],
  ["Customer wallet and dues", "N", "Y", "Y"],
  ["Consumables inventory", "N", "Y", "Central"],
  ["Advanced reporting", "Basic", "Y", "Custom"],
  ["Multi-store and central plant", "N", "N", "Y"],
  ["Custom integrations", "N", "N", "Custom"],
  ["Support and onboarding", "Email & phone", "Priority", "Dedicated"],
];
const FAQS: [string, string][] = [
  ["Which plan is suitable for my laundry?", "Starter suits a single store that needs order booking, garment tagging and billing. Growth adds pickup and delivery, customer updates, memberships and advanced reports. Enterprise is for chains, franchises and central processing plants. Our team can help you decide."],
  ["Can I use Drycare without purchasing hardware?", "Yes. Drycare can be purchased on its own. If you already have a receipt printer, tag printer or scanner, our team can check whether it is compatible."],
  ["Can I print garment tags with barcodes?", "Yes. Drycare supports garment tagging with barcode labels. You will need a compatible tag or label printer, which we can supply as part of a bundle quotation."],
  ["Can I upgrade from Starter to Growth?", "Yes, you can move to Growth as your business grows. Contact our team and they will explain how the change is applied to your current billing period."],
  ["Is pricing calculated per store?", "The Starter and Growth prices shown are for one store. For several stores or a central processing plant, Enterprise pricing is based on your setup and requirements."],
  ["Are GST and installation charges included?", "GST is applied as per applicable rates. Installation and hardware are quoted separately unless included in a bundle quotation. Our team will confirm the full amount before you buy."],
  ["Can Drycare manage multiple stores and a central plant?", "Yes. The Enterprise Plan includes a multi-store dashboard, store-to-plant garment transfer, consolidated reports and central price control."],
  ["Can I request a custom Enterprise quotation?", "Yes. Share your store count, plant setup and integration needs through the enquiry form, and our team will prepare a quotation."],
];
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const DEFAULT_INTEREST = "Not sure yet — help me choose";
const interestOptions = [DEFAULT_INTEREST, "Talk to sales", ...PLANS.map((p) => p.name), ...BUNDLES.map((b) => b[0])];

export function PricingPage() {
  const vw = useVw();
  const cw = Math.min(vw, 1180) - 64;
  const [annual, setAnnual] = useState(false);
  const [cmp, setCmp] = useState(1);
  const [interest, setInterest] = useState(DEFAULT_INTEREST);
  const enquiry = useRef<HTMLElement>(null);
  const goEnquiry = (value: string) => {
    setInterest(value);
    if (enquiry.current) window.scrollTo({ top: enquiry.current.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
  };
  const narrow = cw < 640;
  const cols = narrow ? [cmp] : [0, 1, 2];
  const cmpCols = narrow ? "minmax(0,1.6fr) minmax(0,1fr)" : "minmax(0,2fr) repeat(3,minmax(0,1fr))";

  return (
    <>
      <section style={{ padding: "16px 16px 96px" }}>
        <div className="dc-wrap" style={{ padding: "clamp(32px, 5vw, 56px) 16px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18, maxWidth: 760, margin: "0 auto" }}>
            <span className="dc-eyebrow">Drycare · Laundry &amp; Dry Cleaning Software</span>
            <h1 className="dc-h1" style={{ fontSize: "clamp(38px, 5vw, 60px)" }}>The Right Plan for Your Laundry Business</h1>
            <p className="dc-lead">From single-store dry cleaners to multi-branch laundry chains, choose a plan that simplifies order booking, garment tracking, pickups, deliveries and payments.</p>
            <div role="radiogroup" aria-label="Billing period" style={{ display: "flex", gap: 4, padding: 5, borderRadius: 999, background: "#f3f1ec", border: "1px solid #e4e1d9", marginTop: 10 }}>
              {([["Monthly", false, null], ["Annual", true, "Save up to 17%"]] as const).map(([label, value, tag]) => {
                const on = annual === value;
                return (
                  <button key={label} type="button" role="radio" aria-checked={on} onClick={() => setAnnual(value)} style={{ font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 44, padding: "10px 24px", borderRadius: 999, border: 0, background: on ? "#151514" : "transparent", color: on ? "#faf8f4" : "#151514", display: "flex", alignItems: "center", gap: 8, transition: "background .25s ease, color .25s ease" }}>
                    {label}{tag && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: on ? "#3cbf5a" : "#dff3e4", color: on ? "#151514" : "#1f6b34" }}>{tag}</span>}
                  </button>
                );
              })}
            </div>
            <span aria-live="polite" style={{ fontSize: 14, color: "#6b6963" }}>{annual ? "Annual plans are billed upfront for 12 months." : "Monthly plans are billed every month. Switch to Annual to pay upfront and save."}</span>
          </div>

          <div className="dc-g-plans">
            {PLANS.map((p) => {
              const hi = p.id === "growth";
              const sub = hi ? "#cfccc4" : "#4f4e4a";
              let price: string, per: string, billing: string, save = "";
              if (p.custom) { price = "Custom Pricing"; per = ""; billing = p.note ?? ""; }
              else if (annual) {
                const yearly = p.monthly! * 12, diff = yearly - p.annual!;
                price = inr(p.annual!); per = "/ year";
                billing = `Billed ${inr(p.annual!)} upfront each year · about ${inr(Math.round(p.annual! / 12))}/month`;
                if (diff > 0) save = `Save ${inr(diff)} vs monthly (${Math.round((diff / yearly) * 100)}%)`;
              } else { price = inr(p.monthly!); per = "/ month"; billing = `Billed monthly · or ${inr(p.annual!)} when billed annually`; }
              return (
                <article key={p.id} className={`dc-plan${hi ? " dc-plan-hi" : ""}`}>
                  {p.badge && <span style={{ position: "absolute", top: -13, left: 28, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", padding: "5px 12px", borderRadius: 999, background: "#3cbf5a", color: "#151514" }}>{p.badge}</span>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <h2 className="dc-t" style={{ margin: 0, fontSize: 24 }}>{p.name}</h2>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: sub, minHeight: 45 }}>{p.tagline}</p>
                  </div>
                  <div className="dc-plan-price" style={{ borderBottom: `1px solid ${hi ? "#33332f" : "#eeece6"}` }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: '"Urbanist", sans-serif', fontSize: p.custom ? 32 : 44, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1 }}>{price}</span>
                      <span style={{ fontSize: 15, color: sub }}>{per}</span>
                    </div>
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: sub }}>{billing}</span>
                    {save && <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: hi ? "#3cbf5a" : "#dff3e4", color: hi ? "#151514" : "#1f6b34" }}>{save}</span>}
                  </div>
                  <button type="button" onClick={() => goEnquiry(p.name)} style={{ font: "inherit", textAlign: "center", fontSize: 15, fontWeight: 600, padding: "14px 16px", whiteSpace: "nowrap", borderRadius: 999, background: hi ? "#3cbf5a" : p.custom ? "#151514" : "transparent", color: hi ? "#151514" : p.custom ? "#faf8f4" : "#151514", border: `1.5px solid ${hi ? "#3cbf5a" : "#151514"}` }}>{p.cta}</button>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {p.lead && <span style={{ fontSize: 14, fontWeight: 600 }}>{p.lead}</span>}
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11 }}>
                      {p.features.map((feature) => (
                        <li key={feature} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", gap: 10, fontSize: 14, lineHeight: 1.45, color: hi ? "#faf8f4" : "#33332f" }}>
                          <span aria-hidden="true" className="dc-tick" style={{ width: 20, height: 20, fontSize: 11, marginTop: 1, background: hi ? "#3cbf5a" : "#dff3e4", color: hi ? "#151514" : "#1f6b34" }}>✓</span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
          <p style={{ margin: "28px 0 0", textAlign: "center", fontSize: 14, color: "#6b6963" }}>Software prices shown are for one store. Hardware is charged separately.</p>
        </div>
      </section>

      <section id="bundles" className="dc-sec" style={{ paddingTop: 16, gap: 36 }}>
        <div className="dc-head" style={{ maxWidth: 640 }}>
          <h2 className="dc-h2">Complete Your Store Setup</h2>
          <p className="dc-body">Combine Drycare with compatible printers and scanners for a complete counter and garment-tagging setup.</p>
        </div>
        <div className="dc-g-plans" style={{ marginTop: 0 }}>
          {BUNDLES.map(([name, items], i) => (
            <article key={name} className="dc-card-18" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="dc-num" style={{ fontSize: 13 }}>{`0${i + 1}`}</span>
                <h3 className="dc-t" style={{ margin: 0, fontSize: 21, lineHeight: 1.2 }}>{name}</h3>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                {items.map((item) => <li key={item} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", gap: 10, fontSize: 15, lineHeight: 1.45, color: "#33332f" }}><span aria-hidden="true" className="dc-tick" style={{ width: 20, height: 20, fontSize: 11, marginTop: 1 }}>✓</span><span>{item}</span></li>)}
              </ul>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 16, borderTop: "1px solid #eeece6", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: "#6b6963" }}>Price on quotation</span>
                <button type="button" onClick={() => goEnquiry(name)} className="dc-btn dc-btn-outline" style={{ alignSelf: "auto" }}>Get a Quote →</button>
              </div>
            </article>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "#4f4e4a", padding: "14px 18px", borderRadius: 12, background: "#f7f7f5" }}>Hardware is charged separately from software unless a specific bundle quotation says otherwise.</p>
      </section>

      <section className="dc-sec" style={{ paddingTop: 16, gap: 32 }}>
        <div className="dc-head" style={{ maxWidth: 640 }}>
          <h2 className="dc-h2">Compare Plans</h2>
          <p className="dc-body">See what&apos;s included in each plan at a glance.</p>
        </div>
        {narrow && (
          <div role="tablist" aria-label="Choose a plan to compare" style={{ display: "flex", gap: 6, padding: 5, borderRadius: 999, background: "#f3f1ec", alignSelf: "flex-start", flexWrap: "wrap" }}>
            {PLANS.map((p, i) => <button key={p.id} type="button" role="tab" aria-selected={i === cmp} onClick={() => setCmp(i)} style={{ font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 44, padding: "10px 20px", borderRadius: 999, border: 0, background: i === cmp ? "#151514" : "transparent", color: i === cmp ? "#faf8f4" : "#151514" }}>{p.name.replace(" Plan", "")}</button>)}
          </div>
        )}
        <div style={{ border: "1.5px solid #151514", borderRadius: 18, overflow: "hidden" }}>
          <div role="table" aria-label="Plan feature comparison" style={{ display: "flex", flexDirection: "column", fontSize: 15 }}>
            <div role="row" style={{ display: "grid", gridTemplateColumns: cmpCols, background: "#f7f7f5" }}>
              <span role="columnheader" style={{ padding: "16px 20px", fontWeight: 600, fontSize: 14, color: "#4f4e4a" }}>Feature</span>
              {cols.map((i) => <span key={i} role="columnheader" className="dc-t" style={{ textAlign: "center", padding: "16px 12px", fontSize: 17, letterSpacing: "normal", background: i === 1 ? "#d8e7fa" : "transparent" }}>{PLANS[i].name.replace(" Plan", "")}</span>)}
            </div>
            {COMPARE.map(([label, ...values]) => (
              <div key={label} role="row" style={{ display: "grid", gridTemplateColumns: cmpCols, borderTop: "1px solid #eeece6", alignItems: "stretch" }}>
                <span role="rowheader" style={{ padding: "14px 20px", fontWeight: 500, display: "flex", alignItems: "center" }}>{label}</span>
                {cols.map((i) => (
                  <Fragment key={i}>
                    <span role="cell" style={{ display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "14px 12px", background: i === 1 ? "#eef4fc" : "transparent" }}>
                      {values[i] === "Y" ? <span role="img" aria-label="Included" className="dc-tick" style={{ width: 24, height: 24 }}>✓</span>
                        : values[i] === "N" ? <span role="img" aria-label="Not included" style={{ color: "#9a988f" }}>—</span>
                        : <span style={{ fontSize: 13, fontWeight: 600, color: "#2a4f86" }}>{values[i]}</span>}
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
