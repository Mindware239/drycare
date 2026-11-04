"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Accordion, DemoSection, useVw } from "./parts";

const software = [
  ["Order Booking & Billing", "Fast counter booking with services, prices and GST invoices"],
  ["Garment Tagging", "Barcode tags with colour, brand and stain notes"],
  ["Order Status Tracking", "Received, in process, ready and delivered, with due dates"],
  ["Pickup & Delivery", "Doorstep pickups, delivery staff and route lists"],
  ["Customers & Memberships", "Profiles, packages, wallets and order updates"],
  ["Multi-Store & Central Plant", "Store-to-plant transfers and store-wise reports"],
];
const industries = [
  { img: "/images/login-hero.jpg", need: "Track every garment from drop-off to delivery", title: "Dry Cleaners", desc: "Booking, garment tagging and order tracking for dry cleaning stores.", mods: ["Order booking", "Garment tagging", "Stain notes", "Due dates", "Customer billing"] },
  { img: "/images/signup-hero.jpg", need: "Faster counters, happier regulars", title: "Laundry Stores", desc: "Wash, fold and iron orders with memberships, packages and payment tracking.", mods: ["Kg / piece pricing", "Memberships", "Prepaid wallet", "Pickup & delivery", "WhatsApp updates"] },
  { img: "/images/super-admin-hero.jpg", need: "Every store and the plant in one view", title: "Laundry Chains & Franchises", desc: "Multiple stores and a central processing plant managed from one login.", mods: ["Store-to-plant transfers", "Central price list", "Store-wise reports", "Staff permissions"] },
];
type Row = [string, string, string?, string?];
const stages: { short: string; title: string; desc: string; next: string; rows: Row[] }[] = [
  { short: "Booking", title: "Order Booking", desc: "Book the order at the counter with services, prices and due date. The customer gets a GST invoice instantly.", next: "Every garment gets a barcode tag.", rows: [["Shirt · Dry clean × 3", "₹360"], ["Saree · Dry clean × 1", "₹350"], ["Total", "₹710", "#2a4f86"]] },
  { short: "Tagging", title: "Garment Tagging", desc: "Each garment is tagged with a barcode, with colour, brand and stain notes recorded.", next: "Tagged garments move to processing.", rows: [["Tag", "DC-1042-03"], ["Item", "Silk saree"], ["Note", "Oil stain", "#d9661b"]] },
  { short: "Processing", title: "Processing", desc: "Garments are washed, dry cleaned or pressed, and scanned at each step so you always know where they are.", next: "Finished garments go through quality check.", rows: [["Dry clean", "24 pcs", "#3d6fb5", "60%"], ["Laundry", "12 pcs", "#3d6fb5", "30%"], ["Steam press", "4 pcs", "#3d6fb5", "10%"]] },
  { short: "Quality", title: "Quality Check", desc: "Each garment is checked, folded or hung, and placed in a rack location.", next: "The order is marked ready and the customer is notified.", rows: [["Checked", "38 / 40", "#2f9b4c", "95%"], ["Rack", "B-12"], ["Re-process", "2 pcs", "#d9661b"]] },
  { short: "Ready", title: "Ready & Notified", desc: "The order is marked ready and the customer gets an SMS or WhatsApp update.", next: "The customer collects it or a delivery is scheduled.", rows: [["Order", "#DC-1042"], ["Status", "Ready", "#2f9b4c"], ["Update sent", "WhatsApp"]] },
  { short: "Delivery", title: "Pickup & Delivery", desc: "Hand over at the counter or deliver to the door, and collect the balance payment.", next: "Payment and order data flow into your reports.", rows: [["Delivery", "Ravi · Kothrud"], ["Balance", "₹350"], ["Payment", "UPI", "#2f9b4c"]] },
];
const features = [
  ["Barcode garment tags", "Print tags and scan garments at every stage."],
  ["WhatsApp & SMS updates", "Tell customers when orders are received and ready."],
  ["Due-date alerts", "See what is due today and what is running late."],
  ["Rack locations", "Find ready garments quickly at pickup time."],
  ["Memberships & packages", "Prepaid plans and wallets that bring customers back."],
  ["GST invoices", "Accurate GST-ready bills for every order."],
  ["Business reports", "Orders, revenue, services and dues in one place."],
];
const hardware = [
  ["Garment tag printers", "Print barcode tags for every garment"],
  ["Barcode scanners", "Scan garments at counter, workshop and delivery"],
  ["Receipt printers", "Print order receipts and invoices"],
  ["Tags & labels", "Laundry-safe tags and label rolls"],
  ["Ribbons", "Ribbons matched to your tag printer"],
];
const services = ["Implementation and installation", "Software customization", "Custom software development", "Data migration", "System integration", "Employee training and onboarding", "Software maintenance and troubleshooting", "Annual Maintenance Contract (AMC)", "Technical support"];
const why = [
  ["Built for laundry workflows", "Software designed around booking, tagging, processing and delivery."],
  ["Software and hardware expertise", "One team for your software and the tag printers and scanners it works with."],
  ["Custom development", "We can customise the software when your store works differently."],
  ["Implementation assistance", "Installation, price list setup and data migration handled with your team."],
  ["Ongoing support", "Maintenance, AMC and technical support after you go live."],
];
export const steps = [
  ["Discuss Requirements", "Tell us about your business, outlets and the modules you need."],
  ["Software Demo", "See the software working with workflows similar to yours."],
  ["Implementation", "We install, configure and migrate your existing data."],
  ["Training & Support", "Your team is trained, and we stay available for support."],
];
const faqs: [string, string][] = [
  ["Is Drycare only for dry cleaners?", "Drycare is built for dry cleaning and laundry businesses, from a single store to chains with a central processing plant."],
  ["How does garment tagging work?", "Each garment gets a barcode tag at booking. Staff scan it at each stage, so you can see exactly where every garment is."],
  ["Can I manage pickups and deliveries?", "Yes. You can schedule pickups and deliveries, assign them to staff and track their status."],
  ["Can customers get order updates?", "Yes. Drycare can send SMS or WhatsApp updates when an order is received and when it is ready."],
  ["Can I run multiple stores and a central plant?", "Yes. You can transfer garments from stores to a central plant and see reports for each store."],
  ["Which hardware do I need?", "A receipt printer, a garment tag printer and a barcode scanner are recommended. Share the devices you already have and we will confirm compatibility."],
];
const floatCard = { position: "absolute", background: "#fff", zIndex: 2, borderRadius: 12, boxShadow: "0 8px 24px rgba(21,21,20,.1)", padding: "12px 14px", display: "flex", flexDirection: "column" } as const;
const spring = "cubic-bezier(.34,1.56,.64,1)";
const pad2 = (n: number) => String(n).padStart(2, "0");

function Hero() {
  const vw = useVw();
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 120); return () => clearTimeout(t); }, []);
  const cw = Math.min(vw, 1180) - 64;
  const twoCol = cw >= 420 * 2 + 56;
  const scale = Math.min(1, (twoCol ? (cw - 56) / 2 : cw) / 520);
  const op = on ? 1 : 0;
  const rX = on ? "0px" : "60px";
  const lX = on ? "0px" : "-60px";
  const cS = on ? 1 : 0.85;
  const slide = (delay: string) => `transform .8s ${spring} ${delay}, opacity .5s ease ${delay}`;
  return (
    <section className="dc-hero-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 520 }}>
        <h1 className="dc-h1">Complete Dry Cleaning &amp; Laundry Store Management</h1>
        <p className="dc-lead" style={{ maxWidth: 480 }}>Book orders, tag every garment, manage pickups and deliveries, and collect payments, all in one software built for dry cleaners and laundries.</p>
        <div className="dc-row" style={{ paddingTop: 6 }}>
          <Link href="#solutions" className="dc-btn dc-btn-dark">Explore Solutions</Link>
          <Link href="#demo" className="dc-btn dc-btn-green">Book a Demo →</Link>
        </div>
      </div>
      <div style={{ width: "100%", maxWidth: 520, justifySelf: "center", height: Math.round(500 * scale) }}>
        <div style={{ position: "relative", width: 520, height: 500, transform: `scale(${scale.toFixed(3)})`, transformOrigin: "top left" }}>
          <div style={{ position: "absolute", left: "50%", top: 20, transform: `translateX(-50%) scale(${on ? 1 : 0.85})`, opacity: op, transition: "transform 1s cubic-bezier(.2,.8,.2,1), opacity .7s ease", width: 300, display: "flex", flexDirection: "column" }}>
            <div style={{ height: 170, borderRadius: 85, background: "#d8e7fa" }} />
            <div style={{ height: 170, borderRadius: 85, background: "#d8e7fa", marginTop: -30 }} />
            <div style={{ height: 170, borderRadius: 85, background: "#d8e7fa", marginTop: -30 }} />
          </div>
          <div style={{ position: "absolute", left: "50%", top: 20, transform: `translateX(-50%) translateY(${on ? "0px" : "40px"})`, opacity: op, transition: "transform 1s cubic-bezier(.2,.8,.2,1) .15s, opacity .8s ease .15s", width: 300, height: 450 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/site/hero-person.webp" alt="Laundry store staff with pressed garments" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", clipPath: "path('M85 0 L215 0 A85 85 0 0 1 263.2 155 A85 85 0 0 1 263.2 295 A85 85 0 0 1 215 450 L85 450 A85 85 0 0 1 36.8 295 A85 85 0 0 1 36.8 155 A85 85 0 0 1 85 0 Z')" }} />
          </div>
          <svg viewBox="0 0 400 400" aria-hidden="true" style={{ position: "absolute", left: "50%", top: 50, transform: "translateX(-50%) rotate(-30deg)", width: 400, height: 400, pointerEvents: "none", overflow: "visible" }}>
            <defs><linearGradient id="dcArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f08a24" /><stop offset=".55" stopColor="#c5d531" /><stop offset="1" stopColor="#3cbf5a" /></linearGradient></defs>
            <circle cx="200" cy="200" r="180" fill="none" stroke="url(#dcArc)" strokeWidth="7" strokeLinecap="round" strokeDasharray="720 1131" style={{ strokeDashoffset: on ? 0 : 720, transition: "stroke-dashoffset 1.6s cubic-bezier(.2,.8,.2,1) .45s" }} />
            <g style={{ opacity: op, transition: "opacity .4s ease 1.9s" }}>
              <circle cx="81.9" cy="64.1" r="11" fill="#fff" stroke="#f08a24" strokeWidth="4" />
              <circle cx="81.9" cy="64.1" r="4" fill="#f08a24" />
            </g>
            <circle cx="380" cy="200" r="7" fill="#3cbf5a" style={{ opacity: op, transition: "opacity .3s ease .45s" }} />
          </svg>
          <div style={{ ...floatCard, right: 0, top: 40, gap: 2, minWidth: 150, opacity: op, transform: `translateX(${rX}) scale(${cS})`, transition: slide("0.8s") }}>
            <span style={{ fontSize: 12, color: "#6b6963" }}>Today&apos;s collection</span>
            <span className="dc-t" style={{ fontSize: 22 }}>₹12,400</span>
            <span style={{ fontSize: 12, color: "#2f9b4c", fontWeight: 500 }}>▲ 18 pickups scheduled</span>
          </div>
          <div style={{ ...floatCard, left: 0, top: 190, gap: 6, width: 168, opacity: op, transform: `translateX(${lX}) scale(${cS})`, transition: slide("1.05s") }}>
            <span style={{ fontSize: 12, color: "#6b6963" }}>Order status</span>
            {[["In process", "57%"], ["Ready", "29%"], ["Delivered", "14%"]].map(([name, pct]) => (
              <div key={name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{name}</span><span style={{ fontWeight: 600, color: "#3d6fb5" }}>{pct}</span></div>
                <div style={{ height: 4, borderRadius: 2, background: "#eeece6" }}><div style={{ height: "100%", borderRadius: 2, width: pct, background: "#3d6fb5" }} /></div>
              </div>
            ))}
          </div>
          <div style={{ ...floatCard, right: 0, bottom: 56, gap: 4, minWidth: 186, opacity: op, transform: `translateX(${rX}) scale(${cS})`, transition: slide("1.3s") }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "#6b6963" }}><span>#DC-1042</span><span style={{ color: "#3d6fb5", background: "#e6effb", padding: "1px 8px", borderRadius: 999, fontWeight: 500 }}>Ready</span></div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Silk saree · Dry clean</span>
            <span style={{ fontSize: 12, color: "#6b6963" }}>→ Pickup today, 6:00 PM</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Workflow() {
  const [i, setI] = useState(0);
  const cur = stages[i];
  const num = pad2(i + 1);
  const pt = (angle: number) => ({ left: `${(50 + 40 * Math.cos((angle * Math.PI) / 180)).toFixed(2)}%`, top: `${(50 + 40 * Math.sin((angle * Math.PI) / 180)).toFixed(2)}%` });
  return (
    <section id="workflow" className="dc-sec">
      <div className="dc-head" style={{ maxWidth: 640 }}>
        <h2 className="dc-h2">From Drop-off to Delivery</h2>
        <p className="dc-body">Follow a garment through every stage. Tap a stage to see what happens and what comes next.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: 48, alignItems: "center" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 540, aspectRatio: "1 / 1", justifySelf: "center" }}>
          <div style={{ position: "absolute", inset: "10%", borderRadius: "50%", border: "3px dashed #c9c6bd" }} />
          <svg viewBox="0 0 100 100" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
            <defs><linearGradient id="dcWfArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f08a24" /><stop offset=".55" stopColor="#c5d531" /><stop offset="1" stopColor="#3cbf5a" /></linearGradient></defs>
            <circle cx="50" cy="50" r="40" fill="none" stroke="url(#dcWfArc)" strokeWidth="2" strokeLinecap="round" transform="rotate(-90 50 50)" style={{ strokeDasharray: `${((i * 60) / 360 * 251.33).toFixed(2)} 251.33`, transition: "stroke-dasharray .8s cubic-bezier(.4,0,.2,1)" }} />
            <g style={{ transform: `rotate(${i * 60}deg)`, transformOrigin: "50px 50px", transition: "transform .8s cubic-bezier(.4,0,.2,1)" }}><circle cx="50" cy="10" r="2.2" fill="#3cbf5a" /></g>
          </svg>
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "50%", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span className="dc-eyebrow">Stage {num} of 6</span>
            <span style={{ fontFamily: '"Urbanist", sans-serif', fontWeight: 600, fontSize: "clamp(20px, 2.4vw, 26px)", lineHeight: 1.1 }}>{cur.title}</span>
            <div className="dc-card" style={{ width: "100%", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7, textAlign: "left", boxShadow: "0 8px 24px rgba(21,21,20,.08)" }}>
              {cur.rows.map(([k, v, c, bar]) => (
                <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}><span style={{ color: "#6b6963" }}>{k}</span><span style={{ fontWeight: 600, color: c ?? "#151514" }}>{v}</span></div>
                  {bar && <div style={{ height: 4, borderRadius: 2, background: "#eeece6" }}><div style={{ height: "100%", borderRadius: 2, width: bar, background: c }} /></div>}
                </div>
              ))}
            </div>
          </div>
          {stages.map((stage, k) => (
            <button key={stage.short} type="button" onClick={() => setI(k)} style={{ position: "absolute", ...pt(-90 + k * 60), transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "transparent", border: 0, padding: 0, font: "inherit", color: "#151514", zIndex: 2 }}>
              <span style={{ width: "clamp(44px, 8vw, 58px)", height: "clamp(44px, 8vw, 58px)", borderRadius: "50%", border: "1.5px solid #151514", background: k === i ? "#3cbf5a" : "#fff", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 600, boxShadow: k === i ? "0 0 0 6px #dff3e4" : "none", transition: "background .25s ease, box-shadow .25s ease" }}>{pad2(k + 1)}</span>
              <span style={{ fontSize: 12, fontWeight: 600, background: "#fff", padding: "1px 6px", borderRadius: 6, whiteSpace: "nowrap" }}>{stage.short}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 460 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dc-num" style={{ background: "#151514", color: "#faf8f4" }}>{num}</span>
            <span className="dc-t" style={{ fontSize: 24 }}>{cur.title}</span>
          </div>
          <p className="dc-body">{cur.desc}</p>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#fdeedd", borderRadius: 12, padding: "14px 16px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#8a4b12", whiteSpace: "nowrap", paddingTop: 1 }}>Next →</span>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: "#5c3209" }}>{cur.next}</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" aria-label="Previous stage" onClick={() => setI((i + 5) % 6)} style={{ font: "inherit", fontSize: 14, fontWeight: 500, width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #151514", background: "transparent", color: "#151514" }}>←</button>
            <button type="button" aria-label="Next stage" onClick={() => setI((i + 1) % 6)} style={{ font: "inherit", fontSize: 14, fontWeight: 500, width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #151514", background: "#151514", color: "#faf8f4" }}>→</button>
            <span style={{ fontSize: 14, color: "#6b6963", marginLeft: 6 }}>Tap any stage or use the arrows</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="dc-sec">
      <div className="dc-head">
        <h2 className="dc-h2">How It Works</h2>
        <p className="dc-body">From first conversation to everyday use, in four steps.</p>
      </div>
      <div className="dc-g-steps">
        {steps.map(([title, desc], i) => (
          <div key={title} className="dc-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: "#d8e7fa", color: "#2a4f86" }}>Step {i + 1}</span>
              <span style={{ fontSize: 18, color: i === steps.length - 1 ? "transparent" : "#151514" }}>→</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="dc-t6">{title}</span>
              <span className="dc-small">{desc}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />

      <section id="solutions" className="dc-sec">
        <h2 className="dc-h2">Explore Our Software</h2>
        <div className="dc-g-soft">
          {software.map(([title, desc], i) => (
            <Link key={title} href="#demo" className="dc-card dc-hover-card" style={{ textDecoration: "none", color: "#151514", padding: 24, display: "flex", flexDirection: "column", gap: 28, minHeight: 190 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="dc-num">{pad2(i + 1)}</span>
                <span style={{ fontSize: 18 }}>→</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
                <span className="dc-t" style={{ fontSize: 20 }}>{title}</span>
                <span className="dc-small">{desc}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section id="industries" className="dc-sec">
        <div className="dc-head">
          <h2 className="dc-h2">Built for Every Laundry Business</h2>
          <p className="dc-body">Whether you run one counter or a chain with a central plant.</p>
        </div>
        <div className="dc-g-ind">
          {industries.map((ind) => (
            <div key={ind.title} className="dc-ind">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div className="dc-ind-img"><img src={ind.img} alt="" loading="lazy" /></div>
              <div style={{ padding: "18px 14px 14px", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#2a4f86", letterSpacing: ".02em" }}>{ind.need}</span>
                <span className="dc-t6">{ind.title}</span>
                <span className="dc-small">{ind.desc}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ind.mods.map((m) => <span key={m} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#f3f1ec", color: "#33332f" }}>{m}</span>)}
                </div>
                <Link href="#workflow" style={{ marginTop: "auto", paddingTop: 8, fontSize: 14, fontWeight: 500, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>See how it works →</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Workflow />

      <div className="dc-band">
        <section id="features" className="dc-band-sec">
          <div className="dc-head">
            <h2 className="dc-h2">Key Features</h2>
            <p className="dc-body">The everyday tools your team needs, built into one system.</p>
            <Link href="/features" className="dc-btn dc-btn-outline" style={{ marginTop: 8 }}>See all features →</Link>
          </div>
          <div className="dc-g-feat">
            {features.map(([title, desc], i) => (
              <div key={title} className="dc-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <span className="dc-num" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 12 }}>{pad2(i + 1)}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="dc-t" style={{ fontSize: 18 }}>{title}</span>
                  <span className="dc-small">{desc}</span>
                </div>
              </div>
            ))}
            <Link href="#demo" style={{ textDecoration: "none", background: "#3cbf5a", color: "#151514", border: "1.5px solid #3cbf5a", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14 }}>
              <span style={{ fontSize: 22 }}>→</span>
              <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}>See every feature in a live demo</span>
            </Link>
          </div>
        </section>
      </div>

      <section id="hardware" className="dc-split" style={{ alignItems: "center" }}>
        <div className="dc-side">
          <h2 className="dc-h2">Software &amp; Hardware Integration</h2>
          <p className="dc-body">Drycare works with the tag printers, scanners and receipt printers your counter and workshop rely on. We help you choose compatible devices and set them up with your system.</p>
          <Link href="#demo" className="dc-btn dc-btn-outline" style={{ marginTop: 8 }}>Ask about compatible hardware →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
          {hardware.map(([title, desc]) => (
            <div key={title} className="dc-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
              <span className="dc-small">{desc}</span>
            </div>
          ))}
          <div style={{ position: "relative", minHeight: 110, borderRadius: 14, overflow: "hidden", background: "#d8e7fa" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/site/hardware.webp" alt="Garment tag printer and scanner at a laundry counter" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </section>

      <section id="services" className="dc-split" style={{ alignItems: "start" }}>
        <div className="dc-side">
          <h2 className="dc-h2">Software Services &amp; Support</h2>
          <p className="dc-body">From first setup to everyday support, our team helps you get the most out of your software.</p>
          <Link href="#demo" className="dc-btn dc-btn-green" style={{ alignSelf: "flex-start", marginTop: 8 }}>Discuss Your Requirements →</Link>
        </div>
        <div className="dc-card-18" style={{ padding: "6px 24px", display: "flex", flexDirection: "column" }}>
          {services.map((title, i) => (
            <div key={title} style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 14, alignItems: "center", padding: "16px 0", borderBottom: i === services.length - 1 ? 0 : "1px solid #eeece6" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#2a4f86" }}>{pad2(i + 1)}</span>
              <span style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.4 }}>{title}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="dc-band">
        <section id="why" className="dc-band-sec">
          <div className="dc-head">
            <h2 className="dc-h2">Why Choose Drycare</h2>
            <p className="dc-body">One team for your business software, the hardware it runs with, and the support that keeps it running.</p>
          </div>
          <div className="dc-g-why">
            {why.map(([title, desc], i) => (
              <div key={title} style={{ borderTop: "1.5px solid #151514", paddingTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#2a4f86" }}>{pad2(i + 1)}</span>
                <span className="dc-t" style={{ fontSize: 18, lineHeight: 1.3 }}>{title}</span>
                <span className="dc-small">{desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <HowItWorks />

      <div className="dc-band">
        <section id="faq" className="dc-band-sec" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "40px 72px", alignItems: "start" }}>
          <div className="dc-side" style={{ maxWidth: 400 }}>
            <h2 className="dc-h2">Frequently Asked Questions</h2>
            <p className="dc-body">Can&apos;t find what you&apos;re looking for? Our team is happy to help.</p>
            <Link href="/contact" className="dc-btn dc-btn-outline" style={{ marginTop: 8 }}>Contact our team →</Link>
          </div>
          <Accordion items={faqs} size="sm" />
        </section>
      </div>

      <DemoSection />
    </>
  );
}
