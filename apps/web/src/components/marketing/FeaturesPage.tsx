"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { FinalCta, useSeen } from "./parts";

type UiRow = [string, string, string?, string?];
type Module = { id: string; short: string; title: string; desc: string; points: string[]; inds: string[]; ui: { label: string; value: string; pill: string; warn?: boolean; rows: UiRow[] } };

const B = "#3d6fb5";
const MODULES: Module[] = [
  { id: "booking", short: "Booking", title: "Order Booking & Billing", desc: "Book orders at the counter in seconds, with services, prices and GST invoices handled for you.", points: ["Quick order booking", "Service price list", "GST-ready invoices", "Express and urgent orders", "Advance payments and discounts", "Customer order history"], inds: ["Counter staff", "Store owners"], ui: { label: "Order #DC-1042", value: "₹860", pill: "Advance paid", rows: [["Shirt · Dry clean × 3", "₹360"], ["Saree · Dry clean × 1", "₹350"], ["Trousers · Steam press × 2", "₹150"]] } },
  { id: "tagging", short: "Tagging", title: "Garment Tagging & Barcode", desc: "Tag every garment with a barcode so nothing gets mixed up between counter, workshop and delivery.", points: ["Barcode garment tags", "Scan at every stage", "Colour and brand notes", "Stain and damage notes", "Garment photos", "Lost-garment search"], inds: ["Counter staff", "Workshop team"], ui: { label: "Tag DC-1042-03", value: "Silk saree", pill: "Stain noted", warn: true, rows: [["Colour", "Maroon"], ["Service", "Dry clean"], ["Note", "Oil stain on border", "#d9661b"]] } },
  { id: "status", short: "Status", title: "Order Status Tracking", desc: "Know where every order is, from received to ready to delivered.", points: ["Received, in process, ready, delivered", "Due dates and alerts", "Ready-for-pickup list", "Rack and bin locations", "Quality check step", "Pending order reports"], inds: ["Store managers", "Workshop team"], ui: { label: "Today", value: "42 orders", pill: "6 due today", warn: true, rows: [["In process", "24", B, "57%"], ["Ready for pickup", "12", "#2f9b4c", "29%"], ["Delivered", "6", B, "14%"]] } },
  { id: "delivery", short: "Delivery", title: "Pickup & Delivery", desc: "Schedule doorstep pickups and deliveries and assign them to your delivery staff.", points: ["Pickup scheduling", "Delivery staff assignment", "Route lists", "Delivery status updates", "Cash on delivery tracking", "Customer address book"], inds: ["Store owners", "Delivery staff"], ui: { label: "Today's pickups", value: "18 scheduled", pill: "4 completed", rows: [["Ravi · Kothrud", "6 pickups"], ["Amit · Baner", "7 pickups"], ["Sunil · Aundh", "5 pickups"]] } },
  { id: "customers", short: "Customers", title: "Customers & Memberships", desc: "Keep customers coming back with memberships, packages and timely updates.", points: ["Customer profiles", "Memberships and packages", "Prepaid wallet", "Order-ready SMS / WhatsApp updates", "Loyalty and offers", "Customer feedback"], inds: ["Store owners", "Counter staff"], ui: { label: "Priya Sharma", value: "Gold member", pill: "Wallet ₹1,200", rows: [["Orders this year", "28"], ["Package", "20 pieces / month"], ["Last order", "Oct 28"]] } },
  { id: "payments", short: "Payments", title: "Payments & Dues", desc: "Track advances, balances and pending dues for every order and customer.", points: ["Multiple payment modes", "Advance and balance tracking", "Pending dues list", "Daily cash summary", "Refunds and adjustments", "Payment reports"], inds: ["Store owners", "Accountants"], ui: { label: "Today's collection", value: "₹12,400", pill: "₹3,150 pending", warn: true, rows: [["UPI", "₹7,200", B, "58%"], ["Cash", "₹4,100", B, "33%"], ["Card", "₹1,100", B, "9%"]] } },
  { id: "plant", short: "Plant", title: "Multi-Store & Central Plant", desc: "Run several stores and a central processing plant from one login.", points: ["Store-to-plant transfers", "Plant processing status", "Central price list", "Store-wise reports", "Store-level permissions", "Consumables stock by location"], inds: ["Laundry chains", "Franchises"], ui: { label: "Central plant", value: "310 garments", pill: "In process", rows: [["From Kothrud store", "120"], ["From Baner store", "104"], ["From Aundh store", "86"]] } },
  { id: "reports", short: "Reports", title: "Reports & Insights", desc: "See orders, revenue, services and dues together, so you can run the business with clarity.", points: ["Daily sales report", "Service-wise revenue", "Pending orders report", "Customer reports", "Store comparison", "GST reports"], inds: ["Store owners", "Managers"], ui: { label: "This month", value: "₹3.8L revenue", pill: "+9% vs last month", rows: [["Dry clean", "₹2.1L", B, "55%"], ["Laundry", "₹1.1L", B, "29%"], ["Steam press", "₹0.6L", B, "16%"]] } },
];
const CAPS = [
  ["Barcode tag printing", "Print garment tags and scan them at every stage."],
  ["WhatsApp & SMS updates", "Tell customers when orders are received and ready."],
  ["GST-ready", "Invoices and reports prepared for GST compliance."],
  ["Role-based permissions", "Control what counter, workshop and delivery staff can see."],
  ["Data migration", "Bring in your existing customers and price list."],
  ["Training & support", "Onboarding for your team, with ongoing support."],
];
const pad2 = (n: number) => String(n).padStart(2, "0");
const rv = (duration: number, delay: number): CSSProperties => ({ transitionDuration: `${duration}s`, transitionDelay: `${delay}s` });

function ModuleSection({ m, index }: { m: Module; index: number }) {
  const [ref, seen] = useSeen<HTMLElement>();
  const flip = index % 2 === 1;
  const vars = { "--dc-from": flip ? "48px" : "-48px", "--dc-row": flip ? "-60px" : "60px" } as CSSProperties;
  return (
    <section ref={ref} id={m.id} aria-labelledby={`h-${m.id}`} data-seen={seen} className={`dc-mod${flip ? " dc-mod-flip" : ""}`} style={vars}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <span className="dc-num dc-rv dc-rv-pop" style={{ alignSelf: "flex-start", width: 44, height: 44, ...rv(0.77, 0.07) }}>{pad2(index + 1)}</span>
        <h2 id={`h-${m.id}`} className="dc-h2 dc-rv dc-rv-side" style={rv(0.84, 0.17)}>{m.title}</h2>
        <p className="dc-rv dc-rv-side" style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#4f4e4a", textWrap: "pretty", ...rv(0.84, 0.32) }}>{m.desc}</p>
        <ul className="dc-points">
          {m.points.map((point, k) => (
            <li key={point} className="dc-rv dc-rv-up" style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", gap: 10, fontSize: 16, lineHeight: 1.5, color: "#33332f", ...rv(0.77, 0.42 + k * 0.07) }}>
              <span aria-hidden="true" className="dc-tick" style={{ marginTop: 1 }}>✓</span><span>{point}</span>
            </li>
          ))}
        </ul>
        <div className="dc-rv dc-rv-up" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 6, ...rv(0.84, 0.91) }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#4f4e4a", marginInlineEnd: 4 }}>Useful for</span>
          {m.inds.map((ind) => <span key={ind} style={{ fontSize: 14, padding: "6px 12px", borderRadius: 999, background: "#f3f1ec", color: "#33332f" }}>{ind}</span>)}
        </div>
      </div>
      <div style={{ position: "relative", minWidth: 0, padding: "clamp(12px, 2vw, 24px)" }}>
        <div aria-hidden="true" className="dc-rv dc-rv-blob" style={{ position: "absolute", inset: 0, borderRadius: 24, background: "#f7f7f5", ...rv(0.98, 0) }} />
        <div aria-hidden="true" className="dc-card-18 dc-rv dc-rv-card" style={{ position: "relative", overflow: "hidden", boxShadow: "0 14px 40px rgba(21,21,20,.08)", ...rv(0.98, 0.21) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid #eeece6" }}>
            <div style={{ display: "flex", gap: 6 }}>{[0, 1, 2].map((d) => <span key={d} style={{ width: 10, height: 10, borderRadius: "50%", background: "#e4e1d9" }} />)}</div>
            <span style={{ fontSize: 14, fontWeight: 600, marginInlineEnd: "auto" }}>{m.short}</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "#f3f1ec", color: "#4f4e4a" }}>Sample</span>
          </div>
          <div style={{ padding: "clamp(16px, 2.4vw, 24px)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <div className="dc-rv dc-rv-up" style={{ display: "flex", flexDirection: "column", gap: 2, ...rv(0.84, 0.42) }}>
                <span style={{ fontSize: 14, color: "#6b6963" }}>{m.ui.label}</span>
                <span style={{ fontFamily: '"Urbanist", sans-serif', fontSize: "clamp(26px, 2.8vw, 34px)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1 }}>{m.ui.value}</span>
              </div>
              <span className="dc-rv dc-rv-pop" style={{ fontSize: 13, fontWeight: 600, padding: "4px 12px", borderRadius: 999, background: m.ui.warn ? "#fdeedd" : "#dff3e4", color: m.ui.warn ? "#8a4b12" : "#1f6b34", ...rv(0.77, 0.56) }}>{m.ui.pill}</span>
            </div>
            <div className="dc-rows">
              {m.ui.rows.map(([k, v, c, bar], r) => (
                <div key={k} className="dc-rowi dc-rv dc-rv-row" style={rv(0.84, 0.63 + r * 0.13)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}><span style={{ color: "#4f4e4a" }}>{k}</span><span style={{ fontWeight: 600, color: c ?? "#151514" }}>{v}</span></div>
                  {bar && <div className="dc-bar"><div style={{ width: seen ? bar : "0%", background: c, transition: `width .98s cubic-bezier(.2,.8,.2,1) ${(0.84 + r * 0.13).toFixed(2)}s` }} /></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Capabilities() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} data-seen={seen} className="dc-g-3">
      {CAPS.map(([title, desc], i) => (
        <div key={title} className="dc-card dc-rv dc-rv-cap" style={{ borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 14, ...rv(0.84, i * 0.1) }}>
          <span className="dc-num" style={{ width: 44, height: 44 }}>{pad2(i + 1)}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 className="dc-t" style={{ margin: 0, fontSize: 20 }}>{title}</h3>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: "#4f4e4a" }}>{desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeaturesPage() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      let next = 0;
      MODULES.forEach((m, i) => { const el = document.getElementById(m.id); if (el && el.getBoundingClientRect().top < 200) next = i; });
      setActive(next);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <section className="dc-center-hero">
        <h1 className="dc-h1" style={{ maxWidth: 860 }}>Everything Your Laundry Store Needs</h1>
        <p className="dc-lead-c" style={{ maxWidth: 620 }}>Order booking, garment tagging, pickups, deliveries and payments, connected in one platform built for dry cleaning and laundry businesses.</p>
        <div className="dc-row" style={{ justifyContent: "center", paddingTop: 8 }}>
          <Link href="/#demo" className="dc-btn dc-btn-green dc-btn-tall">Book a Demo</Link>
          <Link href="/pricing" className="dc-btn dc-btn-line dc-btn-tall">See Pricing →</Link>
        </div>
      </section>

      <nav aria-label="Jump to module" className="dc-jump">
        <div className="dc-wrap" style={{ padding: "10px 32px", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", justifyContent: "safe center" }}>
          {MODULES.map((m, i) => (
            <a key={m.id} href={`#${m.id}`} className="dc-jump-chip" data-on={i === active} aria-current={i === active ? "true" : undefined}><i aria-hidden="true" />{m.short}</a>
          ))}
        </div>
      </nav>

      <div className="dc-wrap" style={{ padding: "clamp(48px, 6vw, 72px) 32px 32px", display: "flex", flexDirection: "column", gap: "clamp(56px, 6vw, 88px)" }}>
        {MODULES.map((m, i) => <ModuleSection key={m.id} m={m} index={i} />)}
      </div>

      <div className="dc-band" style={{ margin: "72px 0" }}>
        <section className="dc-wrap" style={{ padding: "clamp(64px, 8vw, 96px) 32px", display: "flex", flexDirection: "column", gap: 40 }}>
          <div className="dc-head" style={{ maxWidth: 640 }}>
            <h2 className="dc-h2">Built In Across Every Module</h2>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#4f4e4a", textWrap: "pretty" }}>Capabilities that work the same way wherever you are in the software.</p>
          </div>
          <Capabilities />
        </section>
      </div>

      <FinalCta title="See These Features Working for Your Business" />
    </>
  );
}
