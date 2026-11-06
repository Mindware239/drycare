"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, type ApiError } from "@/lib/api";
import { PageHero } from "./parts";

const WHO: [string, string][] = [
  ["Billing software and POS dealers", "Add a laundry and dry-cleaning product to what you already sell."],
  ["Barcode and printer sellers", "Sell the software along with the printers, scanners and labels."],
  ["Laundry equipment suppliers", "Offer your customers the software that runs their store."],
  ["IT and business consultants", "Bring Drycare to the laundry businesses you advise."],
];
const STEPS: [string, string][] = [
  ["Apply", "Tell us about your business and the area you cover."],
  ["Talk to our team", "We go through the product, and agree the partnership terms with you."],
  ["Start selling", "You introduce Drycare to laundry and dry-cleaning businesses."],
];
const TYPES = ["Billing software / POS dealer", "Barcode / printer seller", "Laundry equipment supplier", "IT / business consultant", "Other"];

export function PartnersPage() {
  const form = useRef<HTMLElement>(null);
  const blank = { name: "", business: "", phone: "", email: "", city: "", type: TYPES[0], message: "" };
  const [f, setF] = useState(blank);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      await api("/public/leads", { body: { type: "contact", name: f.name, businessName: f.business, email: f.email, phone: f.phone, city: f.city, message: `Interested in: Partner programme\nBusiness type: ${f.type}${f.message.trim() ? `\nMessage: ${f.message.trim()}` : ""}` } });
      setState("sent");
    } catch (e) {
      setError((e as ApiError).message);
      setState("idle");
    }
  }
  return (
    <>
      <PageHero eyebrow="Partners" title="Sell Drycare in Your Area" description="We are looking for partners to bring Drycare to dry cleaners and laundries. Tell us about your business and our team will talk you through it.">
        <button type="button" onClick={() => form.current?.scrollIntoView({ behavior: "smooth" })} className="dc-btn dc-btn-green" style={{ alignSelf: "center" }}>Become a Partner →</button>
      </PageHero>
      <section className="dc-sec" style={{ gap: 28 }}>
        <div className="dc-head" style={{ maxWidth: 680 }}><h2 className="dc-h2">Who We Are Looking For</h2></div>
        <div className="dc-g-soft">
          {WHO.map(([title, text]) => <article key={title} className="dc-card-18 dc-hw-card" style={{ padding: 22 }}><h3 className="dc-t" style={{ margin: "0 0 6px", fontSize: 19 }}>{title}</h3><p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#33332f" }}>{text}</p></article>)}
        </div>
      </section>
      <section className="dc-sec" style={{ paddingTop: 16, gap: 28 }}>
        <div className="dc-head" style={{ maxWidth: 680 }}><h2 className="dc-h2">How It Works</h2></div>
        <div className="dc-g-3">
          {STEPS.map(([title, text], i) => <article key={title} className="dc-card-18" style={{ padding: 22 }}><span className="dc-num" style={{ fontSize: 13 }}>{`0${i + 1}`}</span><h3 className="dc-t" style={{ margin: "8px 0 6px", fontSize: 19 }}>{title}</h3><p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#33332f" }}>{text}</p></article>)}
        </div>
      </section>
      <section ref={form} id="apply" className="dc-sec" style={{ paddingTop: 16, gap: 24 }}>
        <div className="dc-head" style={{ maxWidth: 680 }}><h2 className="dc-h2">Apply to Become a Partner</h2></div>
        <div className="dc-card-18" style={{ padding: "clamp(18px, 3vw, 32px)" }}>
          {state === "sent" ? (
            <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, padding: "16px 4px" }}>
              <span className="dc-t" style={{ fontSize: 28, fontWeight: 600 }}>Application received</span>
              <span style={{ fontSize: 16, color: "#4f4e4a" }}>Thanks! Our team will contact you.</span>
              <button type="button" className="dc-btn dc-btn-outline" onClick={() => { setF(blank); setState("idle"); }}>Send another</button>
            </div>
          ) : (
            <form onSubmit={submit} aria-label="Partner application" className="dc-form">
              {error && <p role="alert" className="dc-full" style={{ margin: 0, color: "#9a3a12", fontWeight: 600 }}>{error}</p>}
              <label className="dc-label">Full name<input className="dc-input" required minLength={2} autoComplete="name" value={f.name} onChange={set("name")} /></label>
              <label className="dc-label">Business name<input className="dc-input" required value={f.business} onChange={set("business")} /></label>
              <label className="dc-label">Phone number<input className="dc-input" required type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} /></label>
              <label className="dc-label">Email<input className="dc-input" required type="email" autoComplete="email" value={f.email} onChange={set("email")} /></label>
              <label className="dc-label">City<input className="dc-input" required value={f.city} onChange={set("city")} /></label>
              <label className="dc-label">Your business<select className="dc-input" value={f.type} onChange={set("type")}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label className="dc-label dc-full">Message (optional)<textarea className="dc-input" rows={3} maxLength={1000} placeholder="The area you cover, and the customers you already sell to" value={f.message} onChange={set("message")} /></label>
              <button type="submit" disabled={state === "sending"} className="dc-btn dc-btn-green dc-full" style={{ justifyContent: "center" }}>{state === "sending" ? "Sending…" : "Send Application →"}</button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
