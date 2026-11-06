"use client";
import type { Region } from "@drycare/shared";
import { setRegion, wholeMoney } from "@/lib/format";
import { appLocale } from "@/lib/format";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2, Clock3, LoaderCircle, MapPin, Phone, Shirt, Truck, UserRound } from "lucide-react";
import { Logo } from "@/components/Brand";
import { BrandName, IconInput, inputBox, primaryButton } from "@/components/AuthUi";
import { cx } from "@/components/ui";

const plainBox = inputBox.replace("ps-11", "ps-3");

type MembershipPlan = { id: string; name: string; description: string | null; price: number; durationDays: number; discountBps: number; freeExpress: boolean; perks: string[] };
type CustomerMembership = { planName: string; discountBps: number; startsAt: string; endsAt: string };
type Shop = { region?: Region; shopName: string; branchName: string; phone: string | null; address: string; message: string; slots: string[]; firstDate: string; membershipPlans: MembershipPlan[] };

const slotLabel = (s: string) => s.split("-").map((t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; }).join(" – ");
const nextDays = (first: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(first) + i * 86_400_000).toISOString().slice(0, 10));
const rupees = (minor: number) => (minor === 0 ? "Free" : wholeMoney(minor));

function BookingForm() {
  const slug = useSearchParams().get("s") ?? "";
  const [shop, setShop] = useState<Shop | null>(null);
  const [missing, setMissing] = useState("");
  const [f, setF] = useState({ name: "", phone: "", line1: "", area: "", city: "", pincode: "", date: "", slot: "", items: "", notes: "", website: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ reference: string; date: string; slot: string } | null>(null);
  const [memberships, setMemberships] = useState<CustomerMembership[] | null>(null);
  const [membershipError, setMembershipError] = useState("");
  const [checkingMembership, setCheckingMembership] = useState(false);

  useEffect(() => {
    if (!slug) { setMissing("This booking link is incomplete. Ask the shop for its booking link."); return; }
    fetch(`/api/v1/public/booking/${encodeURIComponent(slug)}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Shop>; })
      .then((s) => { if (s.region) setRegion(s.region, false); setShop(s); setF((x) => ({ ...x, date: s.firstDate, slot: s.slots[1] ?? s.slots[0] })); })
      .catch(() => setMissing("This shop is not taking online bookings right now. Please call the shop."));
  }, [slug]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((current) => ({ ...current, [k]: e.target.value }));
    if (k === "name" || k === "phone") {
      setMemberships(null);
      setMembershipError("");
    }
  };

  async function checkMembership() {
    setCheckingMembership(true);
    setMembershipError("");
    setMemberships(null);
    try {
      const r = await fetch(`/api/v1/public/booking/${encodeURIComponent(slug)}/membership`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-drycare-csrf": "1" },
        body: JSON.stringify({ name: f.name, phone: f.phone }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.message ?? "Could not check your membership. Please try again.");
      setMemberships(j.memberships as CustomerMembership[]);
    } catch (err) {
      setMembershipError((err as Error).message);
    } finally {
      setCheckingMembership(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/public/booking/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.details?.[0]?.message ?? j?.error?.message ?? "Could not send the request. Please try again.");
      setDone({ reference: j.reference, date: f.date, slot: f.slot });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (missing) return <p className="rounded-xl bg-amber-50 p-4 text-center text-sm text-amber-900">{missing}</p>;
  if (!shop) return <div className="flex justify-center py-16 text-slate-400"><LoaderCircle className="h-7 w-7 animate-spin" /></div>;
  if (done) {
    return (
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h2 className="mt-4 text-2xl font-bold text-slate-900">Pickup requested</h2>
        <p className="mt-2 text-slate-600">{shop.shopName} will collect your clothes on <strong>{new Date(done.date).toLocaleDateString(appLocale(), { weekday: "long", day: "numeric", month: "long" })}</strong>, {slotLabel(done.slot)}.</p>
        <p className="mt-1 text-sm text-slate-500">The shop may call you to confirm. Reference <span className="font-mono font-semibold">{done.reference}</span></p>
        {shop.phone && <a href={`tel:${shop.phone}`} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Phone className="h-4 w-4" />Call {shop.shopName}</a>}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-emerald-600 p-5 text-white">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-100"><Truck className="h-4 w-4" />Free pickup request</p>
        <h1 className="mt-1 text-2xl font-bold">{shop.shopName}</h1>
        <p className="mt-1 text-sm text-emerald-50">{[shop.branchName, shop.address].filter(Boolean).join(" · ")}</p>
        {shop.message && <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-sm">{shop.message}</p>}
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Your name</span><IconInput icon={UserRound} required value={f.name} onChange={set("name")} autoComplete="name" placeholder="Full name" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Mobile number</span><IconInput icon={Phone} required type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="98XXXXXXXX" /></label>
      </div>
      {shop.membershipPlans.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-brand-100 bg-brand-50/50 p-4" aria-labelledby="membership-plans-title">
          <div>
            <h2 id="membership-plans-title" className="font-bold text-slate-900">Membership plans</h2>
            <p className="mt-1 text-xs text-slate-600">Get a discount on your orders. Buy or renew at the shop; online payment is not available.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {shop.membershipPlans.map((plan) => (
              <article key={plan.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{plan.name}</h3>
                  <span className="whitespace-nowrap text-sm font-bold text-brand-800">{rupees(plan.price)}</span>
                </div>
                {plan.description && <p className="mt-1 text-xs text-slate-600">{plan.description}</p>}
                <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
                  <li>✓ {plan.discountBps / 100}% off every order</li>
                  {plan.freeExpress && <li>✓ Free express service</li>}
                  {plan.perks.map((perk) => <li key={perk}>✓ {perk}</li>)}
                </ul>
                <p className="mt-2 text-xs text-slate-500">Valid for {plan.durationDays} days</p>
              </article>
            ))}
          </div>
          <div className="border-t border-brand-100 pt-3">
            <p className="text-sm font-semibold text-slate-800">Already a member?</p>
            <p className="mt-1 text-xs text-slate-600">Enter the name and mobile number registered with the shop to check your membership.</p>
            <button type="button" disabled={checkingMembership || f.name.trim().length < 2 || f.phone.trim().length < 10} onClick={() => void checkMembership()} className="mt-2 rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50">
              {checkingMembership ? "Checking…" : "Check membership"}
            </button>
            {membershipError && <p role="alert" className="mt-2 text-sm text-red-700">{membershipError}</p>}
            {memberships && (
              memberships.length === 0
                ? <p className="mt-2 text-sm text-slate-600">No current or upcoming membership was found for those details.</p>
                : <ul className="mt-2 space-y-2">
                    {memberships.map((membership, index) => {
                      const startsAt = new Date(membership.startsAt);
                      const endsAt = new Date(membership.endsAt);
                      const upcoming = startsAt.getTime() > Date.now();
                      return <li key={`${membership.planName}-${membership.startsAt}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">{membership.planName}</span> · {membership.discountBps / 100}% off · {upcoming ? "Starts" : "Valid through"} {new Intl.DateTimeFormat(appLocale(), { day: "numeric", month: "short", year: "numeric" }).format(upcoming ? startsAt : endsAt)}
                      </li>;
                    })}
                  </ul>
            )}
          </div>
        </section>
      )}
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Pickup address</span><IconInput icon={MapPin} required value={f.line1} onChange={set("line1")} autoComplete="street-address" placeholder="House / flat, building, street" /></label>
      <div className="grid grid-cols-3 gap-3">
        <input className={plainBox} value={f.area} onChange={set("area")} placeholder="Area" aria-label="Area" />
        <input className={plainBox} value={f.city} onChange={set("city")} placeholder="City" aria-label="City" autoComplete="address-level2" />
        <input className={plainBox} value={f.pincode} onChange={set("pincode")} placeholder="PIN" inputMode="numeric" maxLength={6} aria-label="PIN code" autoComplete="postal-code" />
      </div>
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-brand-700" />Pickup day</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {nextDays(shop.firstDate, 7).map((d, i) => {
            const dt = new Date(d);
            return (
              <button key={d} type="button" onClick={() => setF({ ...f, date: d })} className={cx("flex min-w-[64px] flex-col items-center rounded-xl border px-3 py-2 text-xs transition", f.date === d ? "border-brand-600 bg-brand-50 text-brand-900 ring-2 ring-brand-600/15" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                <span className="font-semibold">{i === 0 ? "Today" : i === 1 ? "Tomorrow" : dt.toLocaleDateString(appLocale(), { weekday: "short" })}</span>
                <span className="mt-0.5 text-lg font-bold">{dt.getDate()}</span>
                <span>{dt.toLocaleDateString(appLocale(), { month: "short" })}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><Clock3 className="h-4 w-4 text-brand-700" />Time</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shop.slots.map((s) => <button key={s} type="button" onClick={() => setF({ ...f, slot: s })} className={cx("rounded-xl border px-3 py-2.5 text-sm font-medium transition", f.slot === s ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-200 text-slate-600 hover:border-slate-300")}>{slotLabel(s)}</button>)}
        </div>
      </div>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">What should we pick up? (optional)</span><IconInput icon={Shirt} value={f.items} onChange={set("items")} placeholder="e.g. 2 suits, 1 saree, curtains" /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Note for the driver (optional)</span><textarea className={cx(plainBox, "h-20 py-2")} value={f.notes} onChange={set("notes")} maxLength={300} placeholder="Landmark, gate code…" /></label>
      {/* Hidden from people; bots fill it and are ignored. */}
      <input type="text" name="website" value={f.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 opacity-0" />
      <button type="submit" disabled={sending} className={primaryButton}>{sending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <><Truck className="h-5 w-5" />Request pickup</>}</button>
      <p className="text-center text-xs text-slate-500">Your number is shared with {shop.shopName} to arrange pickup{shop.membershipPlans.length ? " and check your membership." : "."}</p>
    </form>
  );
}

export default function BookPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f7f5] px-4 py-8">
      <div className="pointer-events-none absolute -end-28 -top-28 h-80 w-80 rounded-full bg-brand-100/80 blur-2xl" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-xl rounded-3xl border border-white bg-white p-5 shadow-[0_30px_80px_-30px_rgba(21,21,20,0.25)] sm:p-8">
        <Suspense><BookingForm /></Suspense>
        <p className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400"><Logo className="h-4 w-auto" />Powered by <BrandName className="text-xs text-slate-500" /></p>
      </div>
    </main>
  );
}
