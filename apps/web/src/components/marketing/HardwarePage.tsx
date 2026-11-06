"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { cleanMoney, visitor, visitorCountry } from "@/lib/visitor";
import { EnquiryForm, PageHero } from "./parts";

type Product = { key: string; name: string; category: string; kind: "equipment" | "consumable"; unit: string; description: string; specs: string[]; compatibility: string; pricePaise: number | null; imageUrl: string | null };
type Pack = { key: string; name: string; audience: string; includesSoftware: boolean; items: { product: string; name: string; unit: string; kind: string; qty: number }[]; hardwarePaise: number | null };
type Store = { categories: { key: string; name: string; text: string }[]; deliveryChargePaise: number; products: Product[]; packages: Pack[]; compatible: { printers: string[]; scanners: string[] } };
type Show = "all" | "equipment" | "consumable";
const DEFAULT_INTEREST = "Hardware: help me choose";
const BULK = "Hardware: bulk order for several stores";
const REORDER = "Hardware: reorder consumables";
const inr = (paise: number) => cleanMoney(paise, "INR");
const unitWord = (qty: number, unit: string) => (unit === "piece" ? "" : qty === 1 ? unit : `${unit}s`);

export function HardwarePage() {
  const [store, setStore] = useState<Store | null>(null);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [interest, setInterest] = useState(DEFAULT_INTEREST);
  const [country, setCountry] = useState("IN");
  const enquiry = useRef<HTMLElement>(null);
  useEffect(() => setCountry(visitorCountry()), []);
  useEffect(() => { void fetch("/api/v1/commercial/hardware-store").then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed")))).then(setStore).catch(() => setFailed(true)); }, []);
  // Hardware is priced and delivered in India. Elsewhere it is by quotation.
  const india = visitor(country).india;
  const goEnquiry = (value: string) => {
    setInterest(value);
    if (enquiry.current) window.scrollTo({ top: enquiry.current.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
  };
  const options = [DEFAULT_INTEREST, BULK, REORDER, ...(store?.packages.map((p) => `Hardware: ${p.name}`) ?? []), ...(store?.products.map((p) => `Hardware: ${p.name}`) ?? [])];

  return (
    <>
      <PageHero eyebrow="Hardware & Accessories" title="Everything Your Store Needs to Run Drycare" description="Printers, scanners, tags and counter accessories that work with Drycare, delivered and installed by our team. See exactly what you get before you enquire.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <a href="#packages" className="dc-btn dc-btn-outline" style={{ alignSelf: "auto" }}>See Packages</a>
          <button type="button" onClick={() => goEnquiry(BULK)} className="dc-btn dc-btn-outline" style={{ alignSelf: "auto" }}>Bulk Enquiry for Several Stores</button>
        </div>
      </PageHero>

      {failed && <p role="alert" style={{ textAlign: "center", color: "#9a3a12" }}>Could not load the hardware list. Please refresh the page.</p>}
      {!store && !failed && <p role="status" style={{ textAlign: "center", color: "#6b6963" }}>Loading…</p>}

      {store && (
        <>
          <section id="packages" className="dc-sec" style={{ gap: 36 }}>
            <div className="dc-head" style={{ maxWidth: 680 }}>
              <h2 className="dc-h2">Complete Store Setup Packages</h2>
              <p className="dc-body">Choose a package and see everything that comes with it.</p>
            </div>
            <div className="dc-g-plans" style={{ marginTop: 0 }}>
              {store.packages.map((p, i) => {
                const total = p.hardwarePaise === null ? null : p.hardwarePaise + store.deliveryChargePaise;
                return (
                  <article key={p.key} className="dc-card-18 dc-hw-card" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 18 }}>
                    <div>
                      <span className="dc-num" style={{ fontSize: 13 }}>{`0${i + 1}`}</span>
                      <h3 className="dc-t" style={{ margin: "6px 0 4px", fontSize: 24, lineHeight: 1.2 }}>{p.name}</h3>
                      <p style={{ margin: 0, fontSize: 15, color: "#4f4e4a" }}>{p.audience}</p>
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "#4f4e4a" }}>What you get</p>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                        {p.includesSoftware && <Line qty="" text="Drycare software" note="Plan chosen separately" />}
                        {p.items.map((l) => <Line key={l.product} qty={`${l.qty}`} text={l.name} unit={unitWord(l.qty, l.unit)} />)}
                        {india && <Line qty="" text="Freight, delivery and installation" />}
                      </ul>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16, borderTop: "1px solid #eeece6" }}>
                      {india && total !== null ? (
                        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", fontSize: 14, color: "#33332f" }}>
                          <dt>Hardware</dt><dd style={{ margin: 0, textAlign: "end" }}>{inr(p.hardwarePaise!)}</dd>
                          <dt>Freight, delivery and installation</dt><dd style={{ margin: 0, textAlign: "end" }}>{inr(store.deliveryChargePaise)}</dd>
                          <dt style={{ fontWeight: 700, color: "#151514" }}>Total</dt><dd className="dc-t" style={{ margin: 0, textAlign: "end", fontSize: 22, fontWeight: 700, color: "#151514" }}>{inr(total)}</dd>
                        </dl>
                      ) : india ? (
                        <p style={{ margin: 0, fontSize: 14, color: "#33332f" }}><strong>Price on quotation.</strong>{` Freight, delivery and installation in India: ${inr(store.deliveryChargePaise)}.`}</p>
                      ) : (
                        <p style={{ margin: 0, fontSize: 14, color: "#33332f" }}><strong>Price on quotation.</strong> Freight, delivery and installation are quoted for your country.</p>
                      )}
                      <button type="button" onClick={() => goEnquiry(`Hardware: ${p.name}`)} className="dc-btn dc-btn-outline" style={{ alignSelf: "stretch", justifyContent: "center" }}>Enquire Now →</button>
                    </div>
                  </article>
                );
              })}
            </div>
            <p style={{ margin: 0, fontSize: 14, color: "#4f4e4a", padding: "14px 18px", borderRadius: 12, background: "#f7f7f5" }}>{india ? "Prices exclude GST. The Drycare software plan is charged separately." : "Taxes apply as per your country. The Drycare software plan is charged separately."}</p>
          </section>

          <section className="dc-sec" style={{ paddingTop: 16, gap: 28 }}>
            <div className="dc-head" style={{ maxWidth: 680 }}>
              <h2 className="dc-h2">Hardware &amp; Accessories</h2>
              <p className="dc-body">Equipment is a one-time purchase. Consumables are the items you reorder as you use them.</p>
            </div>
            <div role="group" aria-label="Show products" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {([["all", "All products"], ["equipment", "Equipment"], ["consumable", "Consumables"]] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={show === id} onClick={() => setShow(id)} className="dc-hw-chip" style={{ fontSize: 14, fontWeight: 600, minHeight: 40, padding: "0 16px", borderRadius: 999, cursor: "pointer", border: "1.5px solid #151514", background: show === id ? "#151514" : "#fff", color: show === id ? "#faf8f4" : "#151514" }}>{label}</button>
              ))}
            </div>

            {show !== "consumable" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <h3 className="dc-t" style={{ margin: 0, fontSize: 24 }}>Software &amp; Billing Solutions</h3>
                <article className="dc-card-18 dc-hw-card" style={{ padding: 22, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                    <h4 className="dc-t" style={{ margin: "0 0 4px", fontSize: 19 }}>Drycare Software</h4>
                    <p style={{ margin: 0, fontSize: 15, color: "#4f4e4a" }}>Order booking, billing, garment tracking and store management. Every package runs on it.</p>
                  </div>
                  <Link href="/pricing" className="dc-btn dc-btn-outline" style={{ alignSelf: "auto" }}>See Software Plans →</Link>
                </article>
              </div>
            )}

            {store.categories.map((c) => {
              const items = store.products.filter((p) => p.category === c.key && (show === "all" || p.kind === show));
              if (!items.length) return null;
              return (
                <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <h3 className="dc-t" style={{ margin: "0 0 4px", fontSize: 24 }}>{c.name}</h3>
                    <p style={{ margin: 0, fontSize: 15, color: "#4f4e4a" }}>{c.text}</p>
                  </div>
                  <div className="dc-g-soft">
                    {items.map((p) => (
                      <article key={p.key} className="dc-card-18 dc-hw-card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                        <div style={{ aspectRatio: "16 / 10", background: "#f7f7f5", display: "grid", placeItems: "center", borderBottom: "1px solid #eeece6" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ImageIcon aria-hidden="true" size={36} color="#a19e95" />}
                        </div>
                        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                          <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: p.kind === "consumable" ? "#e3ecf7" : "#f3f1ec", color: p.kind === "consumable" ? "#2a4f86" : "#33332f" }}>{p.kind === "consumable" ? "Consumable · reorder anytime" : "One-time purchase"}</span>
                          <h4 className="dc-t" style={{ margin: 0, fontSize: 19 }}>{p.name}</h4>
                          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#33332f" }}>{p.description}</p>
                          {p.specs.length > 0 && <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 14, color: "#4f4e4a" }}>{p.specs.map((s) => <li key={s}>{s}</li>)}</ul>}
                          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#4f4e4a", flex: 1 }}><strong style={{ color: "#1f6b34" }}>Works with Drycare: </strong>{p.compatibility}</p>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid #eeece6" }}>
                            <span className="dc-t" style={{ fontSize: india && p.pricePaise !== null ? 20 : 15, fontWeight: 700 }}>{india && p.pricePaise !== null ? inr(p.pricePaise) : "Get a quote"}</span>
                            <button type="button" onClick={() => goEnquiry(p.kind === "consumable" ? REORDER : `Hardware: ${p.name}`)} className="dc-btn dc-btn-outline" style={{ alignSelf: "auto" }}>{p.kind === "consumable" ? "Reorder →" : "Enquire Now →"}</button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="dc-sec" style={{ paddingTop: 16, gap: 20 }}>
            <div className="dc-head" style={{ maxWidth: 680 }}>
              <h2 className="dc-h2">Which Devices Work with Drycare?</h2>
              <p className="dc-body">Printers and scanners are connected at installation using the serial number and bill number from Mindware. Already have a device? Tell us the model and we will confirm.</p>
            </div>
            {(store.compatible.printers.length > 0 || store.compatible.scanners.length > 0) && (
              <div className="dc-g-2">
                {store.compatible.printers.length > 0 && <div className="dc-card-18" style={{ padding: 20 }}><h3 className="dc-t" style={{ margin: "0 0 6px", fontSize: 18 }}>Supported printers</h3><p style={{ margin: 0, fontSize: 15, color: "#33332f" }}>{store.compatible.printers.join(", ")}</p></div>}
                {store.compatible.scanners.length > 0 && <div className="dc-card-18" style={{ padding: 20 }}><h3 className="dc-t" style={{ margin: "0 0 6px", fontSize: 18 }}>Supported scanners</h3><p style={{ margin: 0, fontSize: 15, color: "#33332f" }}>{store.compatible.scanners.join(", ")}</p></div>}
              </div>
            )}
          </section>

          <section ref={enquiry} id="enquiry" className="dc-sec" style={{ paddingTop: 16, gap: 24 }}>
            <div className="dc-head" style={{ maxWidth: 680 }}>
              <h2 className="dc-h2">Enquire or Reorder</h2>
              <p className="dc-body">Tell us what you need and how many stores you are setting up. Opening several outlets? Choose the bulk option and we will prepare a quotation.</p>
            </div>
            <div className="dc-card-18" style={{ padding: "clamp(18px, 3vw, 32px)" }}>
              <EnquiryForm interest={interest} onInterest={setInterest} interestOptions={options} />
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Line({ qty, text, note, unit }: { qty: string; text: string; note?: string; unit?: string }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "38px minmax(0,1fr)", gap: 10, fontSize: 15, lineHeight: 1.45, color: "#33332f" }}>
      {qty ? <span aria-label={`Quantity ${qty}`} style={{ fontWeight: 700, color: "#151514", textAlign: "end", whiteSpace: "nowrap" }}>{`${qty} ×`}</span> : <span aria-hidden="true" className="dc-tick" style={{ width: 20, height: 20, fontSize: 11, marginTop: 1, justifySelf: "end" }}>✓</span>}
      <span><span>{text}</span>{unit && <span style={{ marginInlineStart: 6, fontSize: 13, color: "#6b6963" }}>{unit}</span>}{note && <span style={{ display: "block", fontSize: 13, color: "#6b6963" }}>{note}</span>}</span>
    </li>
  );
}
