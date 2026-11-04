"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AccordionRow } from "./parts";

const FAQ: { id: string; title: string; items: [string, string][] }[] = [
  { id: "start", title: "Getting Started", items: [
    ["What is Drycare?", "Drycare is software for dry cleaning and laundry businesses. It covers order booking, garment tagging, order tracking, pickup and delivery, payments and reports in one system."],
    ["Which businesses is Drycare for?", "Dry cleaners, laundry stores, ironing and steam press shops, and laundry chains with a central processing plant."],
    ["How long does setup take?", "It depends on your store count, price list and existing data. Our team will share a timeline after understanding your setup."],
    ["Can I see a demo first?", "Yes. Book a demo and our team will walk you through Drycare using workflows similar to your store."],
  ] },
  { id: "features", title: "Features", items: [
    ["How does garment tagging work?", "Each garment gets a barcode tag at booking. Staff scan it at each stage, so you can see where every garment is."],
    ["Can customers get order updates?", "Drycare can send SMS or WhatsApp updates when an order is received and when it is ready. Message charges, if any, are confirmed during setup."],
    ["Can I record stains or damage?", "Yes. Staff can add stain and damage notes to a garment, and photos where supported, before processing starts."],
    ["Can I bill by piece and by weight?", "You can set prices per piece and per kg for different services. Our team will set up your price list during onboarding."],
    ["Can I create memberships and packages?", "Yes. Memberships, packages and prepaid wallets are available in the Growth and Enterprise plans."],
    ["How are pickups and deliveries managed?", "You can schedule pickups and deliveries, assign them to delivery staff and track their status."],
  ] },
  { id: "pricing", title: "Pricing & Billing", items: [
    ["How much does Drycare cost?", "Plans start at ₹1,499 per month for one store. See the Pricing page for all plans and annual billing."],
    ["Is pricing per store?", "Starter and Growth prices are for one store. For several stores or a central plant, Enterprise pricing is based on your setup."],
    ["Are GST and installation charges included?", "GST is applied as per applicable rates. Installation and hardware are quoted separately unless included in a bundle quotation."],
    ["Can I change my plan later?", "Yes. Contact our team to upgrade, and they will explain how the change is applied to your current billing period."],
  ] },
  { id: "hardware", title: "Hardware", items: [
    ["What hardware do I need?", "A receipt printer, a garment tag printer and a barcode scanner are recommended for most stores."],
    ["Will my existing printer or scanner work?", "Share your device models with our team and we will confirm compatibility before you buy anything new."],
    ["Can I use Drycare without new hardware?", "Yes. The software can be purchased on its own. Hardware is optional and quoted separately."],
  ] },
  { id: "stores", title: "Multi-Store & Plant", items: [
    ["Can I run more than one store?", "Yes. The Enterprise Plan lets you manage several stores from one login."],
    ["How are garments tracked between a store and the plant?", "Garments are scanned when they leave a store and when they reach the plant, so you can see where every order is."],
    ["Can I see reports for each store?", "Yes. You can view store-wise reports as well as a combined view across all stores."],
  ] },
  { id: "data", title: "Data & Security", items: [
    ["Can I move data from my current software?", "Yes. Data migration for customers and price lists is part of implementation. Our team will check what can be imported from your current system."],
    ["Where is my data stored and backed up?", "Storage and backup depend on your deployment. Our team will explain the setup and backup process for your plan."],
    ["Does Drycare work without internet?", "Please check with our team. Offline support depends on your deployment and setup."],
  ] },
  { id: "support", title: "Support & Training", items: [
    ["What support do I get after setup?", "Email and phone support is included, with priority or dedicated support on higher plans."],
    ["Do you train my staff?", "Yes. Training is included in onboarding so your counter, workshop and delivery staff can use Drycare confidently."],
    ["What does the AMC include?", "AMC covers software maintenance and technical support. Our team will share the exact scope with your quotation."],
  ] },
];

export function FaqPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState("start-0");
  const term = q.trim().toLowerCase();

  const groups = useMemo(() => FAQ
    .filter((g) => cat === "all" || g.id === cat)
    .map((g) => ({ ...g, rows: g.items.map(([question, answer], i) => ({ question, answer, key: `${g.id}-${i}` })).filter((row) => {
      // Every word must appear, ignoring a plural "s", so "garment tags" also finds "garment tagging".
      const text = `${row.question} ${row.answer}`.toLowerCase();
      return !term || term.split(/\s+/).every((word) => text.includes(word.replace(/s$/, "")));
    }) }))
    .filter((g) => g.rows.length), [cat, term]);

  const pick = (id: string) => {
    setCat(id);
    const list = document.getElementById("faq-list");
    if (list) window.scrollTo({ top: Math.max(0, list.getBoundingClientRect().top + window.scrollY - 148), behavior: "smooth" });
  };

  return (
    <>
      <section className="dc-center-hero" style={{ paddingBottom: 32 }}>
        <h1 className="dc-h1">Frequently Asked Questions</h1>
        <p className="dc-lead-c" style={{ maxWidth: 600 }}>Answers about Drycare, from features and pricing to hardware, setup and support.</p>
        <label style={{ position: "relative", width: "100%", maxWidth: 560, marginTop: 8 }}>
          <span className="sr-only">Search questions</span>
          <span aria-hidden="true" style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "#6b6963" }}>⌕</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a question, e.g. garment tags" className="dc-input" style={{ minHeight: 56, padding: "14px 20px 14px 48px", border: "1.5px solid #151514", borderRadius: 999 }} />
        </label>
      </section>

      <nav aria-label="FAQ categories" className="dc-jump">
        <div className="dc-wrap" style={{ padding: "10px 32px", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
          {[{ id: "all", title: "All" }, ...FAQ].map((c) => (
            <button key={c.id} type="button" className="dc-jump-chip" data-on={c.id === cat} aria-pressed={c.id === cat} onClick={() => pick(c.id)}><i aria-hidden="true" />{c.title}</button>
          ))}
        </div>
      </nav>

      <div id="faq-list" style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(40px, 5vw, 64px) 32px 96px", display: "flex", flexDirection: "column", gap: 48, scrollMarginTop: 156 }}>
        {groups.map((g) => (
          <section key={g.id} id={`cat-${g.id}`} aria-labelledby={`faq-${g.id}`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="dc-num" style={{ fontSize: 13 }}>{String(FAQ.findIndex((x) => x.id === g.id) + 1).padStart(2, "0")}</span>
              <h2 id={`faq-${g.id}`} style={{ margin: 0, fontFamily: '"Urbanist", sans-serif', fontWeight: 600, fontSize: "clamp(26px, 2.6vw, 32px)", lineHeight: 1.15, letterSpacing: "-.02em" }}>{g.title}</h2>
            </div>
            <div className="dc-card-18" style={{ padding: "4px 24px", display: "flex", flexDirection: "column" }}>
              {g.rows.map((row, i) => (
                <AccordionRow key={row.key} q={row.question} a={row.answer} questionSize={17} answerSize={16} answerLine={1.65} open={open === row.key || (!!term && g.rows.length <= 3)} last={i === g.rows.length - 1} onToggle={() => setOpen(open === row.key ? "" : row.key)} />
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <div role="status" style={{ textAlign: "center", padding: "48px 24px", border: "1.5px dashed #c9c6bd", borderRadius: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <span className="dc-t" style={{ fontSize: 22, letterSpacing: "normal" }}>No matching questions</span>
            <span style={{ fontSize: 16, color: "#4f4e4a" }}>Try another word, or ask our team directly.</span>
            <button type="button" onClick={() => { setQ(""); setCat("all"); }} className="dc-btn dc-btn-outline" style={{ alignSelf: "center", minHeight: 44 }}>Clear search</button>
          </div>
        )}
      </div>

      <section className="dc-cta">
        <div className="dc-cta-in">
          <h2 className="dc-h2-cta" style={{ maxWidth: 720 }}>Didn&apos;t Find Your Answer?</h2>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#cfccc4", maxWidth: 520, textWrap: "pretty" }}>Talk to our team or book a demo, and we&apos;ll answer your questions for your store.</p>
          <div className="dc-row" style={{ justifyContent: "center", paddingTop: 6 }}>
            <Link href="/#demo" className="dc-btn dc-btn-green dc-btn-tall">Book a Demo</Link>
            <Link href="/contact" className="dc-btn dc-btn-ghost dc-btn-tall">Contact Our Team</Link>
          </div>
        </div>
      </section>
    </>
  );
}
