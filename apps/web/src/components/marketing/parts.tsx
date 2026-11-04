"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

const subscribeResize = (cb: () => void) => { window.addEventListener("resize", cb); return () => window.removeEventListener("resize", cb); };

/** Window width. Server rendering assumes a desktop layout. */
export function useVw() {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1280);
}

/** True while the element is on screen. Sections replay their entrance, as in the design. */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (!("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

export function Accordion({ items, startOpen = 0, size = "md" }: { items: [string, string][]; startOpen?: number; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="dc-card-18" style={{ padding: "4px 24px", display: "flex", flexDirection: "column" }}>
      {items.map(([q, a], i) => (
        <AccordionRow key={q} q={q} a={a} open={open === i} last={i === items.length - 1} onToggle={() => setOpen(open === i ? -1 : i)} answerSize={size === "sm" ? 14 : 15} />
      ))}
    </div>
  );
}

export function AccordionRow({ q, a, open, last, onToggle, questionSize = 16, answerSize = 15, answerLine = 1.6 }: { q: string; a: string; open: boolean; last: boolean; onToggle: () => void; questionSize?: number; answerSize?: number; answerLine?: number }) {
  return (
    <div style={{ borderBottom: last ? 0 : "1px solid #eeece6", display: "flex", flexDirection: "column" }}>
      <button type="button" className="dc-acc-btn" aria-expanded={open} onClick={onToggle}>
        <span style={{ fontSize: questionSize, fontWeight: 500, lineHeight: 1.4 }}>{q}</span>
        <span aria-hidden="true" className="dc-acc-plus" style={{ transform: `rotate(${open ? "45deg" : "0deg"})` }}>+</span>
      </button>
      <div className="dc-acc-body" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <p style={{ margin: 0, padding: "0 32px 18px 0", fontSize: answerSize, lineHeight: answerLine, color: "#4f4e4a", textWrap: "pretty", opacity: open ? 1 : 0, transform: `translateY(${open ? "0" : "-6px"})`, transition: "opacity .3s ease, transform .35s ease" }}>{a}</p>
        </div>
      </div>
    </div>
  );
}

export function PageHero({ title, description, eyebrow, children }: { title: string; description: string; eyebrow?: string; children?: ReactNode }) {
  return (
    <section className="dc-center-hero">
      {eyebrow && <span className="dc-eyebrow">{eyebrow}</span>}
      <h1 className="dc-h1" style={{ maxWidth: 860 }}>{title}</h1>
      <p className="dc-lead-c" style={{ maxWidth: 620 }}>{description}</p>
      {children}
    </section>
  );
}

export function FinalCta({ title = "See Drycare Working in Your Store", text = "Book a demo and we'll show you how Drycare runs your counter, workshop and deliveries." }: { title?: string; text?: string }) {
  return (
    <section className="dc-cta">
      <div className="dc-cta-in">
        <h2 className="dc-h2-cta" style={{ maxWidth: 760 }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#cfccc4", maxWidth: 540, textWrap: "pretty" }}>{text}</p>
        <div className="dc-row" style={{ justifyContent: "center", paddingTop: 6 }}>
          <Link href="/#demo" className="dc-btn dc-btn-green dc-btn-tall">Book a Demo</Link>
          <Link href="/pricing" className="dc-btn dc-btn-ghost dc-btn-tall">View Pricing</Link>
        </div>
      </div>
    </section>
  );
}

function ChipGroup({ label, hint, options, isOn, onPick }: { label: string; hint?: string; options: string[]; isOn: (o: string) => boolean; onPick: (o: string) => void }) {
  return (
    <div role="group" aria-label={label} className="dc-full" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{label}{hint && <span className="dc-opt"> {hint}</span>}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => <button key={o} type="button" className="dc-chip" aria-pressed={isOn(o)} onClick={() => onPick(o)}>{o}</button>)}
      </div>
    </div>
  );
}

function FormDone({ title, children, onReset, resetLabel }: { title: string; children: ReactNode; onReset: () => void; resetLabel: string }) {
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14, padding: "32px 8px" }}>
      <span style={{ width: 48, height: 48, borderRadius: "50%", background: "#3cbf5a", color: "#151514", display: "grid", placeItems: "center", fontSize: 22, fontWeight: 700 }}>✓</span>
      <span style={{ fontFamily: '"Urbanist", sans-serif', fontWeight: 600, fontSize: 32, lineHeight: 1.1 }}>{title}</span>
      <span style={{ fontSize: 16, color: "#4f4e4a" }}>{children}</span>
      <button type="button" onClick={onReset} className="dc-btn dc-btn-outline">{resetLabel}</button>
    </div>
  );
}

const describe = (rows: [string, string | undefined][]) => rows.filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join("\n");

/** Demo request form. Saved as a website lead, shown in the Control Center under Leads. */
export function DemoSection() {
  const blank = { name: "", phone: "", business: "", city: "", type: "", date: "", time: "Morning (10am – 12pm)", email: "" };
  const [f, setF] = useState(blank);
  const [outlets, setOutlets] = useState("1");
  const [orders, setOrders] = useState("50–200");
  const [current, setCurrent] = useState("Register / paper");
  const [modules, setModules] = useState<string[]>(["Booking & Billing"]);
  const [mode, setMode] = useState("Online video call");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      await api("/public/leads", { body: { type: "demo", name: f.name, businessName: f.business, email: f.email, phone: f.phone, city: f.city, message: describe([
        ["Business type", f.type], ["Number of stores", outlets], ["Orders per day", orders], ["Uses today", current], ["Features needed", modules.join(", ")], ["Demo format", mode], ["Preferred date", f.date], ["Preferred time", f.time],
      ]) } });
      setState("sent");
    } catch (err) {
      setError((err as ApiError).message);
      setState("idle");
    }
  }

  return (
    <section id="demo" style={{ padding: "0 16px 96px" }}>
      <div className="dc-cta-split">
        <div className="dc-side" style={{ gap: 22 }}>
          <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 999, background: "#dff3e4", color: "#1f6b34" }}>Free · No commitment</span>
          <h2 style={{ margin: 0, fontFamily: '"Urbanist", sans-serif', fontWeight: 600, fontSize: "clamp(36px, 4.2vw, 52px)", lineHeight: 1.05, letterSpacing: "-.015em", textWrap: "balance" }}>See Drycare working in your store</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#cfccc4", textWrap: "pretty" }}>Tell us about your store and we&apos;ll show you Drycare with your services, prices and daily workflow.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 6 }}>
            {["20–30 minute live walkthrough", "Shown with your services and price list", "Plan suggestion for your store size"].map((perk) => (
              <div key={perk} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 16 }}><span className="dc-tick" style={{ background: "#3cbf5a", color: "#151514" }}>✓</span><span>{perk}</span></div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 18, borderTop: "1px solid #33332f", marginTop: 6 }}>
            <span style={{ fontSize: 14, color: "#cfccc4" }}>Prefer to talk first?</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Link href="/contact" className="dc-btn dc-btn-ghost-sm">Discuss Your Requirements</Link>
              <Link href="/contact" className="dc-btn dc-btn-ghost-sm" style={{ borderColor: "#55534d" }}>Contact the Team</Link>
            </div>
          </div>
        </div>
        <div className="dc-form-panel">
          {state === "sent" ? (
            <FormDone title="Demo request received" resetLabel="Submit another request" onReset={() => { setF(blank); setState("idle"); }}>Thanks! Our team will contact you on WhatsApp to confirm your demo slot.</FormDone>
          ) : (
            <form onSubmit={submit} className="dc-form">
              <label className="dc-label">Full name<input className="dc-input" required minLength={2} autoComplete="name" placeholder="Rahul Sharma" value={f.name} onChange={set("name")} /></label>
              <label className="dc-label">WhatsApp number<input className="dc-input" required type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" value={f.phone} onChange={set("phone")} /></label>
              <label className="dc-label">Business name<input className="dc-input" required placeholder="FreshFold Laundry" value={f.business} onChange={set("business")} /></label>
              <label className="dc-label">City<input className="dc-input" required autoComplete="address-level2" placeholder="Pune" value={f.city} onChange={set("city")} /></label>
              <label className="dc-label dc-full">Business type
                <select className="dc-input" required value={f.type} onChange={set("type")}>
                  <option value="">Select your business type</option>
                  {["Dry Cleaner", "Laundry Store", "Laundry Chain / Franchise", "Central Processing Plant", "Other"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              <ChipGroup label="Number of stores" options={["1", "2–5", "6–10", "10+"]} isOn={(o) => outlets === o} onPick={setOutlets} />
              <ChipGroup label="Orders per day (approx.)" options={["Under 50", "50–200", "200+"]} isOn={(o) => orders === o} onPick={setOrders} />
              <ChipGroup label="What do you use today?" options={["Register / paper", "Excel", "Other software"]} isOn={(o) => current === o} onPick={setCurrent} />
              <ChipGroup label="Features you need" hint="(optional · select all that apply)" options={["Booking & Billing", "Garment Tagging", "Order Tracking", "Pickup & Delivery", "Memberships", "Multi-Store & Plant", "Reports", "Hardware"]} isOn={(o) => modules.includes(o)} onPick={(o) => setModules(modules.includes(o) ? modules.filter((x) => x !== o) : [...modules, o])} />
              <ChipGroup label="How would you like the demo?" options={["Online video call", "Visit my store"]} isOn={(o) => mode === o} onPick={setMode} />
              <label className="dc-label">Preferred date<input className="dc-input" type="date" value={f.date} onChange={set("date")} /></label>
              <label className="dc-label">Preferred time
                <select className="dc-input" value={f.time} onChange={set("time")}>
                  {["Morning (10am – 12pm)", "Afternoon (12pm – 4pm)", "Evening (4pm – 7pm)"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              <label className="dc-label dc-full">Email<input className="dc-input" required type="email" autoComplete="email" placeholder="rahul@freshfold.in" value={f.email} onChange={set("email")} /></label>
              {error && <p role="alert" className="dc-full dc-err" style={{ margin: 0 }}>{error}</p>}
              <button type="submit" disabled={state === "sending"} className="dc-btn-block dc-full" style={{ marginTop: 6, border: 0 }}>{state === "sending" ? "Sending…" : "Request My Demo →"}</button>
              <span className="dc-full" style={{ fontSize: 13, color: "#6b6963", textAlign: "center" }}>We&apos;ll only use your details to schedule your demo.</span>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/** Sales enquiry form. Saved as a website lead. */
export function EnquiryForm({ interest, onInterest, interestOptions }: { interest: string; onInterest: (value: string) => void; interestOptions: string[] }) {
  const blank = { name: "", business: "", phone: "", email: "", stores: "1", message: "" };
  const [f, setF] = useState(blank);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      await api("/public/leads", { body: { type: "contact", name: f.name, businessName: f.business, email: f.email, phone: f.phone, message: describe([["Interested in", interest], ["Number of stores", f.stores], ["Message", f.message]]) } });
      setState("sent");
    } catch (err) {
      setError((err as ApiError).message);
      setState("idle");
    }
  }

  if (state === "sent") {
    return <FormDone title="Enquiry received" resetLabel="Send another enquiry" onReset={() => { setF(blank); setState("idle"); }}>Thanks! Our team will contact you about: <b style={{ color: "#151514" }}>{interest}</b>.</FormDone>;
  }
  return (
    <form onSubmit={submit} aria-label="Sales enquiry" className="dc-form">
      <label className="dc-label dc-full">I&apos;m interested in
        <select className="dc-input" value={interest} onChange={(e) => onInterest(e.target.value)}>{interestOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
      </label>
      <label className="dc-label">Full name<input className="dc-input" required minLength={2} autoComplete="name" placeholder="Rahul Sharma" value={f.name} onChange={set("name")} /></label>
      <label className="dc-label">Business name<input className="dc-input" required placeholder="FreshFold Laundry" value={f.business} onChange={set("business")} /></label>
      <label className="dc-label">Phone number<input className="dc-input" required type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={f.phone} onChange={set("phone")} /></label>
      <label className="dc-label">Email<input className="dc-input" required type="email" autoComplete="email" placeholder="rahul@company.com" value={f.email} onChange={set("email")} /></label>
      <label className="dc-label dc-full">Number of stores
        <select className="dc-input" value={f.stores} onChange={set("stores")}>{["1", "2–5", "6–10", "10+"].map((o) => <option key={o}>{o}</option>)}</select>
      </label>
      <label className="dc-label dc-full">
        Message <span className="dc-opt">(optional)</span>
        <textarea className="dc-input" rows={3} placeholder="Tell us about your store, services and daily order volume" value={f.message} onChange={set("message")} style={{ resize: "vertical" }} />
      </label>
      {error && <p role="alert" className="dc-full dc-err" style={{ margin: 0 }}>{error}</p>}
      <button type="submit" disabled={state === "sending"} className="dc-btn-block dc-full" style={{ marginTop: 4, border: 0 }}>{state === "sending" ? "Sending…" : "Send Enquiry →"}</button>
      <span className="dc-full" style={{ fontSize: 12, color: "#6b6963", textAlign: "center" }}>We&apos;ll only use your details to respond to this enquiry.</span>
    </form>
  );
}
