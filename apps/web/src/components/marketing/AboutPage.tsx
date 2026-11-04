"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useVw } from "./parts";

const B = "#3d6fb5", G = "#2f9b4c", O = "#d9661b";
type Row = [string, string, string?, string?];
const expertise: { title: string; desc: string; label: string; value: string; pill: string; warn?: boolean; rows: Row[] }[] = [
  { title: "Order Booking & Billing", desc: "Fast counter booking with services, prices and GST invoices.", label: "Order #DC-1042", value: "₹710", pill: "Advance paid", rows: [["Shirt · Dry clean × 3", "₹360"], ["Saree · Dry clean × 1", "₹350"], ["Due", "Fri, 6 PM"]] },
  { title: "Garment Tagging", desc: "Barcode tags with colour, brand and stain notes.", label: "Tag DC-1042-03", value: "Silk saree", pill: "Stain noted", warn: true, rows: [["Colour", "Maroon"], ["Service", "Dry clean"], ["Note", "Oil stain on border", O]] },
  { title: "Order Status Tracking", desc: "Received, in process, ready and delivered, with due dates.", label: "Today", value: "42 orders", pill: "6 due today", warn: true, rows: [["In process", "24", B, "57%"], ["Ready for pickup", "12", G, "29%"], ["Delivered", "6", B, "14%"]] },
  { title: "Pickup & Delivery", desc: "Doorstep pickups, delivery staff and route lists.", label: "Today's pickups", value: "18 scheduled", pill: "4 completed", rows: [["Ravi · Kothrud", "6 pickups"], ["Amit · Baner", "7 pickups"], ["Sunil · Aundh", "5 pickups"]] },
  { title: "Customers & Memberships", desc: "Profiles, packages, wallets and order updates.", label: "Priya Sharma", value: "Gold member", pill: "Wallet ₹1,200", rows: [["Orders this year", "28"], ["Package", "20 pieces / month"], ["Last order", "Oct 28"]] },
  { title: "Payments & Dues", desc: "Advances, balances and pending dues for every order.", label: "Today's collection", value: "₹12,400", pill: "₹3,150 pending", warn: true, rows: [["UPI", "₹7,200", B, "58%"], ["Cash", "₹4,100", B, "33%"], ["Card", "₹1,100", B, "9%"]] },
  { title: "Multi-Store & Central Plant", desc: "Store-to-plant transfers and store-wise reports.", label: "Central plant", value: "310 garments", pill: "In process", rows: [["From Kothrud store", "120"], ["From Baner store", "104"], ["From Aundh store", "86"]] },
  { title: "Reports & Insights", desc: "Orders, revenue, services and dues in one view.", label: "This month", value: "₹3.8L revenue", pill: "+9% vs last month", rows: [["Dry clean", "₹2.1L", B, "55%"], ["Laundry", "₹1.1L", B, "29%"], ["Steam press", "₹0.6L", B, "16%"]] },
];
const focus = [
  ["Laundry-first software", "Booking, tagging, tracking and delivery in one system."],
  ["Store to plant", "Built for single stores, chains and central plants."],
  ["Custom development", "Changes built for the way your store works."],
  ["Implementation & support", "Setup, data migration, training and ongoing updates."],
];
const pillars = [["Simpler workflows", "Fewer manual steps and less paperwork."], ["Connected data", "Sales, stock and purchases in one place."], ["Better decisions", "Clear reports when you need them."]];
const timeline = [
  ["01", "Understand", "We learn how your business works and where software can help."],
  ["02", "Plan", "We define features, workflows and a clear delivery plan."],
  ["03", "Develop", "We design and build the software, sharing progress as we go."],
  ["04", "Implement", "We set up the software, move your data and train your team."],
  ["05", "Improve", "We refine and update the software as your needs grow."],
];
const pad2 = (n: number) => String(n).padStart(2, "0");

function Expertise({ wide }: { wide: boolean }) {
  const [cur, setCur] = useState(0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: wide ? "minmax(0,5fr) minmax(0,7fr)" : "minmax(0,1fr)", gap: "24px 40px", alignItems: "start" }}>
      {wide ? (
        <div role="tablist" aria-label="Software expertise" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {expertise.map((item, i) => {
            const on = i === cur;
            return (
              <button key={item.title} type="button" role="tab" aria-selected={on} onClick={() => setCur(i)} style={{ font: "inherit", textAlign: "left", display: "grid", gridTemplateColumns: "36px minmax(0,1fr)", gap: 12, alignItems: "start", padding: "12px 14px", borderRadius: 14, color: "#151514", border: `1.5px solid ${on ? "#151514" : "transparent"}`, background: on ? "#fff" : "transparent", transition: "background .25s ease, border-color .25s ease" }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, background: on ? "#3cbf5a" : "#d8e7fa", color: on ? "#151514" : "#2a4f86", transition: "background .25s ease" }}>{pad2(i + 1)}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 7 }}>
                  <span className="dc-t" style={{ fontSize: 17 }}>{item.title}</span>
                  {on && <span className="dc-small" style={{ paddingBottom: 2 }}>{item.desc}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div role="tablist" aria-label="Software expertise" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {expertise.map((item, i) => (
              <button key={item.title} type="button" role="tab" aria-selected={i === cur} onClick={() => setCur(i)} style={{ font: "inherit", flex: "none", fontSize: 14, fontWeight: 600, padding: "10px 16px", minHeight: 44, borderRadius: 999, whiteSpace: "nowrap", border: "1.5px solid #151514", background: i === cur ? "#151514" : "#fff", color: i === cur ? "#faf8f4" : "#151514" }}>{item.title}</button>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#4f4e4a" }}>{expertise[cur].desc}</p>
        </div>
      )}
      <div style={{ background: "#fff", border: "1.5px solid #151514", borderRadius: 20, overflow: "hidden", boxShadow: "0 14px 40px rgba(21,21,20,.08)", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid #eeece6", background: "#f7f7f5" }}>
          <div style={{ display: "flex", gap: 6 }}>{["#f08a24", "#c5d531", "#3cbf5a"].map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}</div>
          <span style={{ fontSize: 14, fontWeight: 600, marginRight: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{expertise[cur].title}</span>
          <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "#dff3e4", color: "#1f6b34", whiteSpace: "nowrap" }}>Sample preview</span>
        </div>
        <div style={{ display: "grid", padding: "clamp(16px, 2.5vw, 28px)", minHeight: 360 }}>
          {expertise.map((item, i) => {
            const on = i === cur;
            return (
              <div key={item.title} aria-hidden={!on} style={{ gridArea: "1 / 1", display: "flex", flexDirection: "column", gap: 16, opacity: on ? 1 : 0, transform: `translateY(${on ? "0px" : "10px"})`, transition: "opacity .4s ease, transform .45s cubic-bezier(.2,.8,.2,1)", pointerEvents: on ? "auto" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, color: "#6b6963" }}>{item.label}</span>
                    <span style={{ fontFamily: '"Urbanist", sans-serif', fontSize: "clamp(28px, 3vw, 36px)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1 }}>{item.value}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 999, background: item.warn ? "#fdeedd" : "#dff3e4", color: item.warn ? "#8a4b12" : "#1f6b34" }}>{item.pill}</span>
                </div>
                <div className="dc-rows">
                  {item.rows.map(([k, v, c, bar]) => (
                    <div key={k} className="dc-rowi">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}><span style={{ color: "#4f4e4a" }}>{k}</span><span style={{ fontWeight: 600, color: c ?? "#151514" }}>{v}</span></div>
                      {bar && <div className="dc-bar"><div style={{ width: bar, background: c }} /></div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Timeline({ wide }: { wide: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const onScroll = () => {
      if (!ref.current) return;
      if (reduce) { setProgress(1); return; }
      const r = ref.current.getBoundingClientRect();
      setProgress(Math.max(0, Math.min(1, (window.innerHeight * 0.8 - r.top) / (r.height * 0.75))));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const fill = `${(progress * 100).toFixed(1)}%`;
  const dot = (on: boolean) => <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "#151514" : "#c9c6bd"}`, background: on ? "#3cbf5a" : "#fff", boxShadow: on ? "0 0 0 6px #dff3e4" : "none", transition: "background .4s ease, box-shadow .4s ease, border-color .4s ease", flex: "none", position: "relative", zIndex: 1 }} />;
  const card = (year: string, title: string, desc: string, on: boolean) => (
    <div style={{ background: "#fff", border: `1.5px solid ${on ? "#151514" : "#e4e1d9"}`, borderRadius: 16, padding: 10, display: "flex", flexDirection: "column", opacity: on ? 1 : 0.4, transform: `translateY(${on ? "0px" : "14px"})`, transition: "opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1), border-color .4s ease" }}>
      <div style={{ padding: "12px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#2a4f86" }}>Step {year}</span>
        <span className="dc-t" style={{ fontSize: 24, lineHeight: 1.1 }}>{title}</span>
        <span className="dc-small">{desc}</span>
      </div>
    </div>
  );
  const isOn = (i: number) => progress >= i / (timeline.length - 1) - 0.02;
  return (
    <div ref={ref}>
      {wide ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 16 }}>
          <span aria-hidden="true" style={{ position: "absolute", left: "10%", right: "10%", top: 9, height: 3, borderRadius: 2, background: "#e4e1d9" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: "10%", right: "10%", top: 9, height: 3, pointerEvents: "none" }}><span style={{ display: "block", height: "100%", width: fill, borderRadius: 2, background: "linear-gradient(90deg,#f08a24,#c5d531,#3cbf5a)", transition: "width .25s linear" }} /></span>
          {timeline.map(([year, title, desc], i) => (
            <li key={year} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>{dot(isOn(i))}<div style={{ width: "100%" }}>{card(year, title, desc, isOn(i))}</div></li>
          ))}
        </ol>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative", display: "flex", flexDirection: "column", gap: 24 }}>
          <span aria-hidden="true" style={{ position: "absolute", left: 9, top: 10, bottom: 10, width: 3, borderRadius: 2, background: "#e4e1d9" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: 9, top: 10, bottom: 10, width: 3, pointerEvents: "none" }}><span style={{ display: "block", width: "100%", height: fill, borderRadius: 2, background: "linear-gradient(180deg,#f08a24,#c5d531,#3cbf5a)", transition: "height .25s linear" }} /></span>
          {timeline.map(([year, title, desc], i) => (
            <li key={year} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", gap: 16, alignItems: "start" }}>{dot(isOn(i))}{card(year, title, desc, isOn(i))}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

const hl = { color: "#151514", background: "#3cbf5a", borderRadius: 6, padding: "2px 10px", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" } as const;

export function AboutPage() {
  const vw = useVw();
  const cw = Math.min(vw, 1180) - 64;
  return (
    <>
      <section className="dc-hero-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 540 }}>
          <span className="dc-eyebrow">About Drycare</span>
          <h1 className="dc-h1">Building Smarter Software for Laundry Businesses</h1>
          <p className="dc-lead" style={{ maxWidth: 480 }}>We build Drycare, software that helps dry cleaners and laundries book orders, track every garment, manage deliveries and get paid, all from one place.</p>
          <div className="dc-row" style={{ paddingTop: 6 }}>
            <Link href="/#solutions" className="dc-btn dc-btn-dark">Explore Our Software →</Link>
            <Link href="/contact" className="dc-btn dc-btn-green">Discuss Your Project</Link>
          </div>
        </div>
        <div style={{ position: "relative", width: "100%", maxWidth: 560, justifySelf: "center", aspectRatio: "3 / 2" }}>
          <div style={{ position: "absolute", inset: "6% 4% 0 10%", borderRadius: "120px 120px 24px 120px", background: "#d8e7fa" }} />
          <div style={{ position: "absolute", inset: "0 10% 6% 4%", borderRadius: "120px 24px 120px 120px", overflow: "hidden", border: "1.5px solid #151514", background: "#eef4fc" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/site/about-hero.avif" alt="Staff pressing a garment in a laundry" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </section>

      <section className="dc-split" style={{ gridTemplateColumns: cw >= 1000 ? "minmax(0,5fr) minmax(0,7fr)" : "minmax(0,1fr)", gap: "40px 72px", alignItems: "start" }}>
        <div className="dc-side" style={{ maxWidth: 480 }}>
          <h2 className="dc-h2">Software built around the laundry counter</h2>
          <p className="dc-body">Drycare is built for dry cleaning and laundry businesses. We study how stores, workshops and delivery teams work, then build software that fits, from a single counter to a chain with a central plant.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: cw >= 520 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 14 }}>
          {focus.map(([title, desc], i) => (
            <div key={title} className="dc-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="dc-num" style={{ fontSize: 13 }}>{pad2(i + 1)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="dc-t" style={{ fontSize: 18 }}>{title}</span>
                <span className="dc-small">{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="dc-sec">
        <div className="dc-head" style={{ maxWidth: 640 }}>
          <h2 className="dc-h2">Our Software Expertise</h2>
          <p className="dc-body">Every module a dry cleaner or laundry needs, from the counter to the doorstep.</p>
        </div>
        <Expertise wide={cw >= 720} />
      </section>

      <section className="dc-wrap" style={{ padding: "40px 32px 96px" }}>
        <div style={{ background: "#151514", color: "#faf8f4", borderRadius: 28, padding: "clamp(28px, 5vw, 64px)", display: "flex", flexDirection: "column", gap: "clamp(28px, 4vw, 44px)" }}>
          <span className="dc-eyebrow" style={{ color: "#3cbf5a" }}>Our Mission</span>
          <p style={{ margin: 0, fontFamily: '"Urbanist", sans-serif', fontSize: "clamp(26px, 3.6vw, 46px)", fontWeight: 600, lineHeight: 1.35, letterSpacing: "-.02em", textWrap: "balance", maxWidth: 960 }}>
            To <span style={hl}>simplify everyday workflows</span> with business software that is easy to use, so teams spend less time on manual work and <span style={hl}>more time growing the business</span>.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: cw >= 760 ? "repeat(3, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 12, paddingTop: 24, borderTop: "1px solid #33332f" }}>
            {pillars.map(([title, desc]) => (
              <div key={title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="dc-tick" style={{ width: 26, height: 26, background: "#3cbf5a", color: "#151514", fontSize: 13 }}>✓</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#cfccc4" }}>{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="dc-band">
        <section className="dc-band-sec" style={{ gap: 48 }}>
          <div className="dc-head" style={{ maxWidth: 640 }}>
            <h2 className="dc-h2">Our Approach</h2>
            <p className="dc-body">A clear five-step process, from first conversation to continuous improvement.</p>
          </div>
          <Timeline wide={cw >= 900} />
        </section>
      </div>

      <section className="dc-cta">
        <div className="dc-cta-in" style={{ padding: "clamp(36px, 6vw, 72px)", gap: 22 }}>
          <h2 className="dc-h2-cta" style={{ maxWidth: 760 }}>Have a Software Idea or Business Challenge?</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#cfccc4", maxWidth: 520, textWrap: "pretty" }}>Tell us what you want to build or fix. We&apos;ll help you plan the right software for it.</p>
          <div className="dc-row" style={{ justifyContent: "center", paddingTop: 6 }}>
            <Link href="/contact" className="dc-btn dc-btn-green">Discuss Your Idea →</Link>
            <Link href="/#solutions" className="dc-btn dc-btn-ghost">Explore Our Software</Link>
          </div>
        </div>
      </section>
    </>
  );
}
