"use client";
import { SlideGroup } from "@/components/SlideGroup";
import { shopMethods } from "@/lib/format";
import { appLocale } from "@/lib/format";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, MapPin, Minus, Plus, Search, ShoppingCart, UserRound, X } from "lucide-react";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { GarmentThumb } from "@/components/GarmentArt";

interface Line {
  key: string;
  garmentTypeId: string;
  serviceId: string;
  quantity: number;
  colour: string;
  brand: string;
  conditionFlags: string[];
  conditionNotes: string;
  careInstructions: string;
  specialCareApprovalRequired: boolean;
  specialCareReason: string;
  stainCharge: string;
}

const FLAGS: [string, string][] = [
  ["stain", "Stain"],
  ["tear", "Tear"],
  ["missing_button", "Missing button"],
  ["colour_fade", "Colour fade"],
  ["shrinkage", "Shrinkage"],
  ["other", "Other"],
];

const DISCOUNT_REASONS = ["Regular customer", "Service delay", "Festival offer", "Price match", "Other"];
const readyLabel = (d: Date) => (isNaN(d.getTime()) ? "the chosen date" : d.toLocaleDateString(appLocale(), { weekday: "short", day: "numeric", month: "short" }));

const CATEGORY_ORDER = [
  "Men", "Women", "Ethnic", "Kids & Baby", "Household Linen", "Home Furnishing", "Accessories", "Premium & Delicate",
  "Footwear & Leather", "Commercial Linen", "Repair & Alterations",
  // Categories from earlier built-in lists, for stores that kept them.
  "Kids", "Woollens", "Household", "Footwear & Bags", "General", "Others",
];

const stainPaise = (l: Line) => (l.conditionFlags.includes("stain") ? rupeesToPaise(l.stainCharge || "0") || 0 : 0);

function localDateTimeValue(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function PosInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, branchId, branch, can } = useSession();
  const garmentTypes = useApi<any[]>("/garment-types");
  const services = useApi<any[]>("/services");
  const branchPrices = useApi<{ garmentTypeId: string; serviceId: string; unitPrice: number }[]>(branchId ? `/branch-prices?branchId=${branchId}` : null);
  const priceMap = useMemo(() => new Map((branchPrices.data ?? []).map((p) => [`${p.garmentTypeId}:${p.serviceId}`, Number(p.unitPrice)])), [branchPrices.data]);
  const priceOf = (gtId: string, svcId: string) => priceMap.get(`${gtId}:${svcId}`);
  const turnaround = Number((session.organization.settings as any)?.defaultTurnaroundHours ?? 48);

  const [customer, setCustomer] = useState<any>(null);
  const wallet = useApi<{ balance: number }>(customer?.id ? `/customers/${customer.id}/wallet` : null);
  const walletBalance = wallet.data?.balance ?? 0;
  const [lines, setLines] = useState<Line[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [garmentSearch, setGarmentSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [express, setExpress] = useState(false);
  const [discType, setDiscType] = useState<"amount" | "percent">("percent");
  const [discValue, setDiscValue] = useState("");
  const [discReason, setDiscReason] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [promisedAt, setPromisedAt] = useState(localDateTimeValue(new Date(Date.now() + turnaround * 3600_000)));
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"counter" | "home_delivery">("counter");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("cash");
  const [payRef, setPayRef] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteError, setQuoteError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const cartScroll = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Phones and tablets: hide the floating "View cart" bar while the cart itself is on screen (it would cover the total).
  const [cartInView, setCartInView] = useState(false);
  useEffect(() => {
    const el = document.getElementById("pos-cart");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCartInView(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const idemKey = useRef(newIdempotencyKey());
  const pickupId = params.get("pickupId") ?? undefined;

  useEffect(() => {
    if (services.data && !serviceId) setServiceId(services.data.find((s) => s.active)?.id ?? "");
  }, [services.data, serviceId]);

  useEffect(() => {
    const cid = params.get("customerId");
    if (cid && !customer) api(`/customers/${cid}`).then(setCustomer).catch(() => {});
  }, [params, customer]);

  const orgSettings = session.organization.settings as { expressSurchargeBps?: number; maxDiscountBpsWithoutApproval?: number };
  const expressBps = orgSettings?.expressSurchargeBps ?? 5000;
  const maxDiscountPct = (orgSettings?.maxDiscountBpsWithoutApproval ?? 1000) / 100;
  /** The server takes a percentage, so a rupee discount becomes the percentage of the list price that gives it. */
  const listTotal = lines.reduce((sum, l) => sum + ((priceOf(l.garmentTypeId, l.serviceId) ?? 0) + stainPaise(l)) * l.quantity, 0) * (express ? 1 + expressBps / 10000 : 1);
  const discountBps = discType === "percent"
    ? Math.min(10000, Math.round((Number(discValue) || 0) * 100))
    : listTotal > 0 ? Math.min(10000, Math.round((((Number(discValue) || 0) * 100) / listTotal) * 10000)) : 0;
  const pickSpeed = (isExpress: boolean) => {
    setExpress(isExpress);
    setPromisedAt(localDateTimeValue(new Date(Date.now() + (isExpress ? Math.max(1, Math.round(turnaround / 2)) : turnaround) * 3600_000)));
  };
  const payload = useMemo(
    () => ({
      customerId: customer?.id,
      branchId,
      express,
      discountBps,
      couponCode: couponCode.trim() || undefined,
      deliveryMethod,
      // Orders have no field of their own for this, so the reason stays with the order in its notes.
      notes: [notes.trim(), discountBps && discReason ? `Discount reason: ${discReason}` : ""].filter(Boolean).join("\n") || undefined,
      items: lines.map((l) => ({
        garmentTypeId: l.garmentTypeId,
        serviceId: l.serviceId,
        quantity: l.quantity,
        colour: l.colour || undefined,
        brand: l.brand || undefined,
        conditionFlags: l.conditionFlags,
        conditionNotes: l.conditionNotes || undefined,
        careInstructions: l.careInstructions || undefined,
        specialCareApprovalRequired: l.specialCareApprovalRequired,
        specialCareReason: l.specialCareApprovalRequired ? l.specialCareReason : undefined,
        stainCharge: stainPaise(l) || undefined,
      })),
    }),
    [customer, branchId, express, discountBps, discReason, couponCode, deliveryMethod, notes, lines],
  );

  // Live server-side quote: the backend is the only source of prices.
  useEffect(() => {
    if (!lines.length || !customer) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      api("/orders/quote", { body: payload })
        .then((q) => {
          setQuote(q);
          setQuoteError("");
        })
        .catch((e: ApiError) => setQuoteError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [payload, lines.length, customer]);

  function addGarment(gtId: string) {
    if (!serviceId) return;
    setLines((ls) => {
      const same = ls.find((l) => l.garmentTypeId === gtId && l.serviceId === serviceId && !l.colour && !l.brand && !l.conditionFlags.length && !l.conditionNotes && !l.careInstructions && !l.specialCareApprovalRequired && !l.specialCareReason && !l.stainCharge);
      if (same) {
        setFlash(same.key);
        return ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const key = newIdempotencyKey();
      setFlash(key);
      return [...ls, { key, garmentTypeId: gtId, serviceId, quantity: 1, colour: "", brand: "", conditionFlags: [], conditionNotes: "", careInstructions: "", specialCareApprovalRequired: false, specialCareReason: "", stainCharge: "" }];
    });
  }
  /** Undo one tap on a garment tile for the current service, preferring a line without extra details. */
  function removeOne(gtId: string) {
    setLines((ls) => {
      const candidates = ls.filter((l) => l.garmentTypeId === gtId && l.serviceId === serviceId);
      const target = candidates.find((l) => !l.colour && !l.brand && !l.conditionFlags.length && !l.conditionNotes) ?? candidates[candidates.length - 1];
      if (!target) return ls;
      return target.quantity > 1 ? ls.map((l) => (l === target ? { ...l, quantity: l.quantity - 1 } : l)) : ls.filter((l) => l !== target);
    });
  }
  const quantityFor = (gtId: string) => lines.filter((l) => l.garmentTypeId === gtId && l.serviceId === serviceId).reduce((sum, l) => sum + l.quantity, 0);
  // Keep the item just tapped in view inside the cart (desktop, where the cart is a fixed side panel), and highlight it briefly.
  useEffect(() => {
    if (!flash) return;
    const box = cartScroll.current;
    const row = box?.querySelector<HTMLElement>(`[data-line="${flash}"]`);
    if (box && row && window.matchMedia("(min-width: 1280px)").matches) {
      const top = row.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: top - 8, behavior: "smooth" });
    }
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash, lines]);
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const advance = payAmount ? rupeesToPaise(payAmount) : 0;
  const grand = quote?.totals.grandTotal ?? 0;
  const approvalHoldsRequired = Number(quote?.approvalsRequired ?? 0) > 0;
  const balanceDue = Math.max(0, (quote ? grand : 0) - advance);

  async function save() {
    setError("");
    if (!customer) return setError("Select or create a customer first.");
    if (!lines.length) return setError("Add at least one garment.");
    if (approvalHoldsRequired && advance > 0) return setError("Collect payment after all customer approval holds are resolved.");
    if (isNaN(advance) || advance < 0) return setError("Advance amount is not valid.");
    if (advance > grand) return setError("Advance cannot exceed the order total.");
    if (advance > 0 && payMethod !== "cash" && !payRef.trim()) return setError(`Enter the ${payMethod.toUpperCase()} transaction reference.`);
    setSaving(true);
    try {
      const order = await api("/orders", {
        body: {
          ...payload,
          promisedAt: new Date(promisedAt).toISOString(),
          payments: advance > 0 ? [{ amount: advance, method: payMethod, reference: payRef || undefined }] : [],
          pickupId,
        },
        idempotencyKey: idemKey.current,
      });
      // If the store prints tags automatically, go to them first. That page links back to the order.
      let autoPrint = false;
      try {
        const org = await api<{ settings?: { labels?: { autoPrintOnOrder?: boolean } } }>("/organizations/current");
        autoPrint = !!org.settings?.labels?.autoPrintOnOrder;
      } catch { /* the order is saved either way; tags can still be printed from it */ }
      router.push(autoPrint ? `/print/labels?id=${order.id}&auto=1` : `/orders/view?id=${order.id}&created=1`);
    } catch (e) {
      setError((e as ApiError).message);
      setSaving(false);
    }
  }

  const gtById = (id: string) => garmentTypes.data?.find((g) => g.id === id);
  // Counter order: everyday clothing first, then special items; custom categories follow alphabetically.
  const categoryRank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  const categories = [...new Set((garmentTypes.data ?? []).filter((g) => g.active).map((g) => g.category as string))].sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b));
  const filteredGarments = [...(garmentTypes.data ?? [])].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category)).filter((g) =>
    g.active &&
    (categoryFilter === "All" || g.category === categoryFilter) &&
    (!garmentSearch.trim() || `${g.name} ${g.category}`.toLowerCase().includes(garmentSearch.trim().toLowerCase())),
  );
  const garmentCount = lines.reduce((s, l) => s + l.quantity, 0);
  const serviceName = services.data?.find((s) => s.id === serviceId)?.name ?? "this service";
  // Catalogue prices only; the server quote (with GST, discounts and surcharges) replaces this once a customer is chosen.
  const estimate = lines.reduce((sum, l) => sum + ((priceOf(l.garmentTypeId, l.serviceId) ?? 0) + stainPaise(l)) * l.quantity, 0);
  const problem = !customer ? "Step 1: select a customer"
    : !lines.length ? "Step 2: add garments"
    : quoteError ? "Fix the problem above to save"
    : discountBps > 0 && !discReason && !couponCode ? "Choose a reason for the discount"
    : isNaN(advance) ? "The advance amount is not valid"
    : advance > grand && !!quote ? "The advance is more than the total"
    : "";
  const steps = [
    { label: "Customer", done: !!customer, current: !customer },
    { label: "Garments", done: lines.length > 0, current: !!customer && !lines.length },
    { label: "Review & create", done: false, current: !!customer && lines.length > 0 },
  ];

  return (
    <div className="dcd space-y-5 pb-20 xl:pb-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="dcd-h text-[clamp(28px,3vw,36px)] leading-tight">New order</h1>
          <p className="text-[15px]" style={{ color: "var(--dc-sub)" }}>Receive garments at the counter. Prices come from the {branch?.name ?? "branch"} price list.</p>
        </div>
        <ol className="flex flex-wrap items-center gap-2" aria-label="Order steps">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2" aria-current={s.current ? "step" : undefined}>
              {i > 0 && <span aria-hidden="true" className="h-0.5 w-5 rounded" style={{ background: steps[i - 1].done ? "var(--dc-green)" : "var(--dc-line)" }} />}
              <span className="flex min-h-10 items-center gap-2 rounded-full border ps-1.5 pe-3.5 text-sm font-semibold" style={{ borderColor: s.current ? "var(--dc-solid)" : s.done ? "#cfe9d6" : "var(--dc-line)", background: s.current ? "var(--dc-card)" : s.done ? "var(--dc-green-bg)" : "transparent", color: s.current || s.done ? "var(--dc-ink)" : "var(--dc-sub)" }}>
                <span className="grid h-7 w-7 place-items-center rounded-full text-[13px]" style={{ background: s.done ? "var(--dc-green)" : s.current ? "var(--dc-solid)" : "transparent", color: s.done ? "#151514" : s.current ? "var(--dc-on-solid)" : "var(--dc-sub)", border: s.done || s.current ? 0 : "1.5px solid var(--dc-line)" }}>{s.done ? <Check className="h-4 w-4" /> : i + 1}</span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-5">
          {pickupId && <Alert tone="blue">Booking the garments collected on a home pickup. Tag every garment from the pickup bag.</Alert>}
          <div>
            <CustomerPicker customer={customer} onChange={setCustomer} canCreate={can("customers.write")} />
          </div>

          <section className="dcd-card p-[clamp(18px,2.2vw,24px)]" aria-labelledby="gar-h">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <StepDot n={2} done={garmentCount > 0} />
                <h2 id="gar-h" className="dcd-h text-[22px]">Garments</h2>
                <span className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold" style={{ background: garmentCount ? "var(--dc-green)" : "var(--dc-soft)", color: garmentCount ? "#151514" : "var(--dc-ink)" }}>{garmentCount} pc{garmentCount === 1 ? "" : "s"}</span>
              </div>
              <SlideGroup label="Service" className="flex flex-wrap gap-1 rounded-full p-1" style={{ background: "var(--dc-soft)" }}>
                {services.data?.filter((s) => s.active).map((s) => {
                  const on = serviceId === s.id;
                  return <button type="button" key={s.id} role="radio" aria-checked={on} onClick={() => setServiceId(s.id)} className="dcd-pill min-h-10 cursor-pointer rounded-full px-4 text-sm font-semibold" style={{ background: "transparent", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{s.name}</button>;
                })}
              </SlideGroup>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="relative min-w-52 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute start-3.5 top-3 h-4 w-4 text-slate-400" />
                <Input value={garmentSearch} onChange={(event) => setGarmentSearch(event.target.value)} placeholder="Find a garment" className="h-10 rounded-xl ps-10" aria-label="Find a garment" />
              </label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter garments by category">
                {["All", ...categories].map((category) => {
                  const on = categoryFilter === category;
                  return <button key={category} type="button" aria-pressed={on} onClick={() => setCategoryFilter(category)} className="dcd-pill min-h-10 cursor-pointer rounded-full border px-3.5 text-sm font-medium" style={{ borderColor: on ? "var(--dc-solid)" : "var(--dc-line)", background: on ? "var(--dc-solid)" : "var(--dc-card)", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{category}</button>;
                })}
              </div>
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--dc-sub)" }}>Use <strong>+</strong> to add as <strong style={{ color: "var(--dc-ink)" }}>{serviceName}</strong>. Switch service to add the same garment with a different service.</p>
            {filteredGarments.length ? (
              <div className="-mx-1 mt-3 grid max-h-[620px] grid-cols-2 gap-3 overflow-y-auto px-1 py-1 sm:grid-cols-3 lg:grid-cols-4">
                {filteredGarments.map((g) => {
                  const qty = quantityFor(g.id);
                  const price = priceOf(g.id, serviceId);
                  const unpriced = price === undefined;
                  const also = lines.filter((l) => l.garmentTypeId === g.id && l.serviceId !== serviceId).map((l) => `${l.quantity} × ${services.data?.find((s) => s.id === l.serviceId)?.name ?? ""}`).join(", ");
                  return (
                    <div key={g.id} className={cx("dcd-lift flex flex-col overflow-hidden rounded-2xl border", unpriced && "opacity-60")} style={{ borderColor: qty ? "var(--dc-green)" : "var(--dc-line)", background: "var(--dc-card)", boxShadow: qty ? "0 6px 16px rgba(60,191,90,.18)" : undefined }}>
                      <button type="button" onClick={() => addGarment(g.id)} disabled={!serviceId || unpriced} title={unpriced ? `No ${serviceName} price set for ${g.name}. Add it in Services & prices.` : `Add ${g.name}`} className="flex flex-1 items-start gap-2 px-3.5 pb-2 pt-3 text-start disabled:cursor-not-allowed">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--dc-sub)" }}>{g.category}</span>
                          <span className="block truncate text-[15px] font-semibold" title={g.name}>{g.name}</span>
                          <span className={cx("dcd-h mt-1 block tabular-nums", unpriced ? "text-xs font-medium text-amber-700" : "text-lg")}>{unpriced ? "Price not set" : money(price).replace(/\.00$/, "")}</span>
                        </span>
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg"><GarmentThumb garment={g} /></span>
                      </button>
                      {also && <p className="truncate px-3.5 pb-1 text-[11px]" style={{ color: "var(--dc-sub)" }} title={`Also in order: ${also}`}>Also: {also}</p>}
                      <div className="flex items-center gap-1 border-t p-2" style={{ borderColor: qty ? "#d7ecdc" : "var(--dc-line2)", background: qty ? "var(--dc-green-bg)" : "var(--dc-soft2)" }}>
                        <button type="button" onClick={() => removeOne(g.id)} disabled={!qty} aria-label={`Remove one ${g.name}`} className="grid h-9 w-9 place-items-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: qty ? "var(--dc-solid)" : "var(--dc-line)", background: "var(--dc-card)" }}><Minus className="h-4 w-4" /></button>
                        <span className="flex-1 text-center text-sm font-medium" style={{ color: qty ? "var(--dc-ink)" : "var(--dc-sub)" }}>{qty ? `${qty} in order` : "Add"}</span>
                        <button type="button" onClick={() => addGarment(g.id)} disabled={!serviceId || unpriced} aria-label={`Add one ${g.name}`} className="dc-press grid h-9 w-9 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "var(--dc-solid)", color: "var(--dc-on-solid)" }}><Plus className="h-4 w-4" strokeWidth={2.6} /></button>
                      </div>
                    </div>
                  );
                })}
                {can("catalogue.manage") && (
                  <a href="/catalogue" className="dcd-lift flex min-h-36 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed p-3 text-center" style={{ borderColor: "var(--dc-line)", color: "var(--dc-sub)" }}>
                    <Plus className="h-5 w-5" />
                    <span className="text-[13px] font-semibold">Add garment</span>
                    <span className="text-[11px]">or change prices</span>
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed px-4 py-8 text-center" style={{ borderColor: "var(--dc-line)" }}><p className="text-sm font-medium">No matching garments</p><button type="button" onClick={() => { setGarmentSearch(""); setCategoryFilter("All"); }} className="mt-1 text-sm font-semibold underline underline-offset-4">Clear the search</button></div>
            )}
          </section>

          <section className="dcd-card p-[clamp(18px,2.2vw,24px)]" aria-labelledby="ready-h">
            <div className="flex items-center gap-2.5"><StepDot n={3} done={false} /><h2 id="ready-h" className="dcd-h text-[22px]">Ready date &amp; handover</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {([[false, "Standard", turnaround], [true, `Express +${expressBps / 100}%`, Math.max(1, Math.round(turnaround / 2))]] as [boolean, string, number][]).map(([isExpress, label, hours]) => {
                const on = express === isExpress;
                return (
                  <button key={label} type="button" aria-pressed={on} onClick={() => pickSpeed(isExpress)} className="dcd-lift cursor-pointer rounded-2xl border-[1.5px] p-3.5 text-start" style={{ borderColor: on ? "var(--dc-solid)" : "var(--dc-line)", background: on ? "var(--dc-soft)" : "var(--dc-card)" }}>
                    <span className="block text-[15px] font-semibold">{label}{isExpress && quote?.membership?.freeExpress ? " · free for this member" : ""}</span>
                    <span className="block text-sm" style={{ color: "var(--dc-sub)" }}>Ready {readyLabel(new Date(Date.now() + hours * 3600_000))}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Ready by, exact date and time"><Input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} /></Field>
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Handover</span>
                <SlideGroup label="Handover" className="flex gap-1 rounded-full p-1" style={{ background: "var(--dc-soft)" }}>
                  {([["counter", "Counter pickup"], ["home_delivery", "Home delivery"]] as const).map(([value, label]) => {
                    const on = deliveryMethod === value;
                    return <button key={value} type="button" role="radio" aria-checked={on} onClick={() => setDeliveryMethod(value)} className="dcd-pill min-h-10 flex-1 cursor-pointer rounded-full text-sm font-semibold" style={{ background: "transparent", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{label}</button>;
                  })}
                </SlideGroup>
              </div>
            </div>
            <p className="mt-2 text-sm" style={{ color: "var(--dc-sub)" }}>{deliveryMethod === "counter" ? `Customer collects from the store from ${readyLabel(new Date(promisedAt))}.` : `Delivered on or after ${readyLabel(new Date(promisedAt))}. Schedule the stop in Pickups & deliveries when it is ready.`}</p>
            <div className="mt-3"><Field label="Order notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
          </section>
        </div>

        <aside id="pos-cart" className="scroll-mt-20 xl:sticky xl:top-20">
          <section aria-label="Order ticket" className="flex flex-col overflow-hidden rounded-3xl border-[1.5px] shadow-lg xl:max-h-[calc(100vh-6rem)]" style={{ borderColor: "#151514", background: "var(--dc-card)" }}>
            <header className="flex items-center gap-2 px-5 py-4 text-[#faf8f4]" style={{ background: "#151514" }}>
              <div className="min-w-0 flex-1">
                <h2 className="dcd-h text-xl text-[#faf8f4]">Order ticket</h2>
                <p className="truncate text-[13px] text-[#cfccc4]">{customer ? `${customer.name} · ${deliveryMethod === "counter" ? "counter pickup" : "home delivery"}` : "No customer selected yet"}</p>
              </div>
              {lines.length > 0 && <button type="button" onClick={() => { setLines([]); setOpenLine(null); }} className="rounded px-1.5 py-1 text-xs font-medium text-[#cfccc4] hover:text-white">Clear</button>}
              <span className="rounded-full bg-[#3cbf5a] px-2.5 py-1 text-[13px] font-semibold text-[#151514]">{garmentCount} pc{garmentCount === 1 ? "" : "s"}</span>
            </header>

            <div ref={cartScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              {!lines.length ? (
                <div className="px-5 py-7 text-center"><p className="text-[15px] font-semibold">No garments yet</p><p className="mt-1 text-sm" style={{ color: "var(--dc-sub)" }}>Use + on a garment to add it here.</p></div>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--dc-line2)" }}>
                  {lines.map((l, idx) => {
                    const q = quote?.lines?.[idx];
                    const gt = gtById(l.garmentTypeId);
                    const unit = priceOf(l.garmentTypeId, l.serviceId);
                    const amount = q ? q.total : unit !== undefined ? (unit + stainPaise(l)) * l.quantity : null;
                    const detailCount = (l.colour ? 1 : 0) + (l.brand ? 1 : 0) + l.conditionFlags.length + (l.careInstructions ? 1 : 0) + (l.specialCareApprovalRequired ? 1 : 0);
                    const open = openLine === l.key;
                    return (
                      <li key={l.key} data-line={l.key} className={cx("px-4 py-2.5 transition-colors duration-500", open && "bg-slate-50", flash === l.key && "bg-brand-50")}>
                        <div className="flex items-start gap-2.5">
                          {gt && <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 p-0.5"><GarmentThumb garment={gt} /></span>}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900" title={gt?.name}>{gt?.name}</p>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{amount === null ? "—" : money(amount)}</span>
                              <button type="button" aria-label={`Remove ${gt?.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="-me-1 shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Select value={l.serviceId} onChange={(e) => update(l.key, { serviceId: e.target.value })} className="h-7 w-[112px] py-0 ps-2 pe-6 text-xs sm:w-[132px] sm:pe-7" aria-label="Service">
                                {services.data?.filter((sv) => sv.active).map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                              </Select>
                              <div className="flex h-7 items-center rounded-md border border-slate-300">
                                <button type="button" className="flex h-full w-7 items-center justify-center hover:bg-slate-100" aria-label="Decrease" onClick={() => (l.quantity > 1 ? update(l.key, { quantity: l.quantity - 1 }) : setLines((ls) => ls.filter((x) => x.key !== l.key)))}><Minus className="h-3.5 w-3.5" /></button>
                                <span className="w-7 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                                <button type="button" className="flex h-full w-7 items-center justify-center hover:bg-slate-100" aria-label="Increase" onClick={() => update(l.key, { quantity: Math.min(200, l.quantity + 1) })}><Plus className="h-3.5 w-3.5" /></button>
                              </div>
                              <button type="button" onClick={() => setOpenLine(open ? null : l.key)} aria-expanded={open} className={cx("ms-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium", detailCount ? "text-amber-800 hover:bg-amber-50" : "text-brand-700 hover:bg-brand-50")}>
                                {detailCount ? `Details · ${detailCount}` : "Details"}<ChevronDown className={cx("h-3.5 w-3.5 transition", open && "rotate-180")} />
                              </button>
                            </div>
                            {!open && (l.colour || l.brand || l.conditionFlags.length > 0) && (
                              <p className="mt-1 truncate text-[11px] text-slate-500">{[l.colour, l.brand, ...l.conditionFlags.map((f) => (f === "stain" && stainPaise(l) ? `Stain +${money(stainPaise(l)).replace(/\.00$/, "")} each` : FLAGS.find(([k]) => k === f)?.[1]))].filter(Boolean).join(" · ")}</p>
                            )}
                          </div>
                        </div>
                        {open && (
                          <div className="mt-2.5 space-y-2 ps-[50px]">
                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="Colour" value={l.colour} onChange={(e) => update(l.key, { colour: e.target.value })} className="h-8 py-1 text-xs" />
                              <Input placeholder="Brand" value={l.brand} onChange={(e) => update(l.key, { brand: e.target.value })} className="h-8 py-1 text-xs" />
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {FLAGS.map(([k, label]) => {
                                const on = l.conditionFlags.includes(k);
                                return <button type="button" key={k} onClick={() => update(l.key, { conditionFlags: on ? l.conditionFlags.filter((f) => f !== k) : [...l.conditionFlags, k] })} className={cx("rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset", on ? "bg-amber-100 text-amber-900 ring-amber-300" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}>{label}</button>;
                              })}
                            </div>
                            {l.conditionFlags.includes("stain") && (
                              <label className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
                                Stain treatment charge, per piece
                                <Input inputMode="decimal" value={l.stainCharge} onChange={(e) => update(l.key, { stainCharge: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="₹ 0" aria-label="Stain treatment charge per piece" className="h-8 w-24 py-1 text-end text-xs" />
                              </label>
                            )}
                            {(l.conditionFlags.length > 0 || l.conditionNotes) && <Input placeholder="Where is the damage / stain? (shown to QC)" value={l.conditionNotes} onChange={(e) => update(l.key, { conditionNotes: e.target.value })} className="h-8 py-1 text-xs" />}
                            <Input placeholder="Care instructions (optional)" value={l.careInstructions} onChange={(e) => update(l.key, { careInstructions: e.target.value })} className="h-8 py-1 text-xs" />
                            <label className="flex items-center gap-2 text-[11px] font-medium text-amber-800">
                              <input type="checkbox" checked={l.specialCareApprovalRequired} onChange={(e) => update(l.key, { specialCareApprovalRequired: e.target.checked, specialCareReason: e.target.checked ? l.specialCareReason : "" })} />
                              Hold for customer approval before special care
                            </label>
                            {l.specialCareApprovalRequired && <Input required minLength={3} maxLength={300} placeholder="What treatment needs customer approval?" value={l.specialCareReason} onChange={(e) => update(l.key, { specialCareReason: e.target.value })} className="h-8 py-1 text-xs" />}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="space-y-2 border-t px-5 py-4" style={{ borderColor: "var(--dc-line2)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Discount <span className="font-normal" style={{ color: "var(--dc-sub)" }}>(optional · up to {maxDiscountPct}%)</span></p>
                  <SlideGroup label="Discount type" className="flex gap-0.5 rounded-full p-0.5" style={{ background: "var(--dc-soft)" }}>
                    {([["amount", "₹"], ["percent", "%"]] as const).map(([value, label]) => {
                      const on = discType === value;
                      return <button key={value} type="button" role="radio" aria-checked={on} aria-label={value === "amount" ? "Fixed amount" : "Percentage"} onClick={() => { setDiscType(value); setDiscValue(""); }} className="h-8 w-9 cursor-pointer rounded-full text-sm font-bold" style={{ background: "transparent", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{label}</button>;
                    })}
                  </SlideGroup>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input inputMode="decimal" value={discValue} onChange={(e) => { setDiscValue(e.target.value.replace(/[^0-9.]/g, "")); if (e.target.value) setCouponCode(""); }} placeholder={discType === "amount" ? "₹ 0" : "0 %"} disabled={!!couponCode} aria-label="Discount" />
                  <Select value={discReason} onChange={(e) => setDiscReason(e.target.value)} aria-label="Discount reason" disabled={!discountBps}>
                    <option value="">Reason…</option>
                    {DISCOUNT_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </Select>
                </div>
                <Input value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); if (e.target.value) setDiscValue(""); }} placeholder="Or a coupon code" autoCapitalize="characters" aria-label="Coupon code" />
              </div>

              {can("payments.collect") && (
                <div className="space-y-2 border-t px-5 py-4" style={{ borderColor: "var(--dc-line2)" }}>
                  <p className="text-sm font-semibold">Advance payment</p>
                  {approvalHoldsRequired && <Alert>Advance collection is disabled while approval is pending.</Alert>}
                  <SlideGroup label="Payment method" radius={12} className="grid grid-cols-3 gap-1.5">
                    {shopMethods(PAYMENT_METHODS).map((m) => {
                      const on = payMethod === m;
                      const off = approvalHoldsRequired || (m === "store_credit" && !walletBalance);
                      return <button key={m} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => setPayMethod(m)} className="dcd-pill min-h-10 cursor-pointer rounded-xl border px-1 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: on ? "var(--dc-solid)" : "var(--dc-line)", background: "transparent", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{m === "store_credit" ? `Wallet ${money(walletBalance).replace(/\.00$/, "")}` : PAYMENT_METHOD_LABELS[m]}</button>;
                    })}
                  </SlideGroup>
                  <div className={cx("grid gap-2", payMethod !== "cash" && payMethod !== "store_credit" && "grid-cols-2")}>
                    <Input inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount ₹" aria-label="Advance amount" disabled={approvalHoldsRequired} />
                    {payMethod !== "cash" && payMethod !== "store_credit" && <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Reference no." aria-label="Transaction reference" disabled={approvalHoldsRequired} />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setPayAmount((grand / 100).toFixed(2))} disabled={!grand || approvalHoldsRequired} className="dcd-pill min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: "var(--dc-line)" }}>Paid in full</button>
                    <button type="button" onClick={() => setPayAmount("")} className="dcd-pill min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-semibold" style={{ borderColor: "var(--dc-line)" }}>No advance</button>
                    {walletBalance > 0 && <button type="button" disabled={!grand || approvalHoldsRequired} onClick={() => { setPayMethod("store_credit"); setPayAmount((Math.min(walletBalance, grand) / 100).toFixed(2)); }} className="dcd-pill min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-semibold disabled:opacity-40" style={{ borderColor: "var(--dc-line)" }}>Use wallet</button>}
                  </div>
                </div>
              )}
            </div>

            <footer className="space-y-2 border-t border-dashed px-5 py-4" style={{ borderColor: "var(--dc-line)", background: "var(--dc-soft2)" }}>
              {approvalHoldsRequired && <Alert>This order will be held for customer approval. Production and payment collection unlock after approval is recorded on the order.</Alert>}
              {quoteError && <Alert>{quoteError}</Alert>}
              {quote?.membership && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  <strong>{quote.membership.planName} member.</strong>{" "}
                  {quote.membership.applied
                    ? `${quote.membership.discountBps / 100}% off applied.${couponCode ? " Discounts do not add up, so the coupon was not used." : ""}${quote.membership.freeExpress ? " Express is free." : ""}`
                    : `A bigger discount is being used instead of the ${quote.membership.discountBps / 100}% membership discount.`}
                </p>
              )}
              {quote ? (
                <dl className="space-y-0.5 text-sm" style={{ color: "var(--dc-sub)" }}>
                  <Row label={`Subtotal · ${garmentCount} piece${garmentCount === 1 ? "" : "s"}`} value={money(quote.totals.subtotal)} />
                  {lines.some(stainPaise) ? <Row label="Includes stain treatment" value={money(lines.reduce((sum, l) => sum + stainPaise(l) * l.quantity, 0))} /> : null}
                  {quote.totals.surchargeTotal ? <Row label="Express surcharge" value={`+ ${money(quote.totals.surchargeTotal)}`} /> : null}
                  {quote.totals.discountTotal ? <Row label={`Discount${discReason ? ` · ${discReason}` : ""}`} value={`− ${money(quote.totals.discountTotal)}`} /> : null}
                  <Row label="GST" value={`+ ${money(quote.totals.taxTotal)}`} />
                </dl>
              ) : lines.length > 0 ? (
                <p className="text-xs" style={{ color: "var(--dc-sub)" }}>{customer ? "Calculating the final bill…" : "Estimate from your price list. Select a customer to see the final bill with GST and discounts."}</p>
              ) : null}
              <div className="flex items-baseline justify-between border-t pt-2" style={{ borderColor: "var(--dc-line)" }}>
                <span className="text-[15px] font-semibold">{quote ? "Total" : "Estimate"}</span>
                <span className="dcd-h text-[28px] tabular-nums">{money(quote ? grand : estimate).replace(/\.00$/, "")}</span>
              </div>
              {advance > 0 && <div className="flex justify-between text-sm" style={{ color: "var(--dc-sub)" }}><span>Advance ({payMethod === "store_credit" ? "Wallet" : PAYMENT_METHOD_LABELS[payMethod as keyof typeof PAYMENT_METHOD_LABELS]})</span><span>− {money(advance)}</span></div>}
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5 text-[15px] font-semibold" style={{ background: balanceDue > 0 ? "var(--dc-red-bg)" : "var(--dc-green-bg)", color: balanceDue > 0 ? "var(--dc-red-fg)" : "var(--dc-green-fg)" }}><span>Balance due at handover</span><span className="dcd-h text-xl tabular-nums">{money(balanceDue).replace(/\.00$/, "")}</span></div>
              {error && <Alert>{error}</Alert>}
              <button type="button" onClick={() => void save()} disabled={saving || !!problem} className="dcd-lift flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full text-base font-semibold text-[#151514] disabled:cursor-not-allowed disabled:hover:transform-none" style={{ background: problem ? "#cdebd5" : "#3cbf5a" }}>
                {saving ? "Saving order…" : `Save order · ${money(quote ? grand : estimate).replace(/\.00$/, "")}`}
              </button>
              <p className="text-center text-[13px]" style={{ color: "var(--dc-sub)" }}>{problem || `${garmentCount} piece${garmentCount === 1 ? "" : "s"} for ${customer?.name}`}</p>
            </footer>
          </section>
        </aside>
      </div>

      {lines.length > 0 && !cartInView && (
        <a href="#pos-cart" className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-xl bg-[#151514] px-4 py-3 text-white shadow-lg xl:hidden">
          <ShoppingCart className="h-5 w-5" />
          <span className="flex-1 text-sm font-semibold">{garmentCount} pc{garmentCount === 1 ? "" : "s"} · {money(quote ? grand : estimate)}</span>
          <span className="text-sm font-semibold">View ticket →</span>
        </a>
      )}
    </div>
  );
}

function StepDot({ n, done }: { n: number; done: boolean }) {
  return <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold" style={{ background: done ? "var(--dc-green)" : "var(--dc-solid)", color: done ? "#151514" : "var(--dc-on-solid)" }}>{done ? <Check className="h-4 w-4" /> : n}</span>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

type AddressDraft = { line1: string; locality: string; city: string; state: string; pincode: string };
const emptyAddress: AddressDraft = { line1: "", locality: "", city: "", state: "", pincode: "" };

function AddressFields({ value, onChange }: { value: AddressDraft; onChange: (value: AddressDraft) => void }) {
  const set = (key: keyof AddressDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="House, building & street" className="sm:col-span-2">
        <Input value={value.line1} onChange={set("line1")} placeholder="Flat / house no., street, landmark" autoComplete="street-address" />
      </Field>
      <Field label="Area / locality">
        <Input value={value.locality} onChange={set("locality")} placeholder="Locality" autoComplete="address-level3" />
      </Field>
      <Field label="City">
        <Input value={value.city} onChange={set("city")} placeholder="City" autoComplete="address-level2" />
      </Field>
      <Field label="State">
        <Input value={value.state} onChange={set("state")} placeholder="State" autoComplete="address-level1" />
      </Field>
      <Field label="PIN code">
        <Input value={value.pincode} onChange={set("pincode")} placeholder="PIN code" autoComplete="postal-code" inputMode="numeric" />
      </Field>
    </div>
  );
}

function addressText(address: Record<string, string> | undefined) {
  if (!address) return "";
  return [address.line1, address.locality, address.city, address.state, address.pincode].filter(Boolean).join(", ");
}

function CustomerPicker({ customer, onChange, canCreate }: { customer: any; onChange: (c: any) => void; canCreate: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notificationChannel: "whatsapp", marketingConsent: false, ...emptyAddress });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddress);
  const [err, setErr] = useState("");
  const [addressErr, setAddressErr] = useState("");
  const [dupId, setDupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const recent = useApi<{ items: any[] }>(customer ? null : "/customers?limit=4");
  const choose = (id: string) => api(`/customers/${id}`).then(onChange);
  useEffect(() => setHighlight(0), [results]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => api(`/customers?q=${encodeURIComponent(q.trim())}&limit=8`).then((r) => setResults(r.items)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);

  async function create(force = false) {
    setErr("");
    setBusy(true);
    const hasAddress = [form.line1, form.locality, form.city, form.state, form.pincode].some((value) => value.trim() !== "");
    const address = hasAddress
      ? {
          label: "Home",
          line1: form.line1.trim(),
          locality: form.locality.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          pincode: form.pincode.trim() || undefined,
          isDefault: true,
        }
      : undefined;
    try {
      const c = await api(`/customers${force ? "?force=true" : ""}`, { body: { name: form.name, phone: form.phone, email: form.email, notificationChannel: form.notificationChannel, marketingConsent: form.marketingConsent, ...(address ? { address } : {}) } });
      onChange({
        ...c,
        addresses: address ? [{ label: "Home", address, isDefault: true }] : [],
      });
      setCreating(false);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.message);
      setDupId(ae.code === "POSSIBLE_DUPLICATE" ? (ae.details?.[0]?.customerId ?? null) : null);
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress() {
    if (!customer) return;
    setAddressErr("");
    setAddressBusy(true);
    try {
      const saved = await api(`/customers/${customer.id}/addresses`, {
        body: {
          label: "Home",
          line1: addressDraft.line1.trim(),
          locality: addressDraft.locality.trim() || undefined,
          city: addressDraft.city.trim() || undefined,
          state: addressDraft.state.trim() || undefined,
          pincode: addressDraft.pincode.trim() || undefined,
          isDefault: !customer.addresses?.some((address: any) => address.isDefault),
        },
      });
      const addresses = customer.addresses ?? [];
      onChange({
        ...customer,
        addresses: [...addresses.map((address: any) => ({ ...address, isDefault: saved.isDefault ? false : address.isDefault })), saved],
      });
      setAddressDraft(emptyAddress);
      setAddingAddress(false);
    } catch (e) {
      setAddressErr((e as ApiError).message);
    } finally {
      setAddressBusy(false);
    }
  }

  if (customer) {
    const addresses = customer.addresses ?? [];
    const primaryAddress = addresses.find((address: any) => address.isDefault) ?? addresses[0];
    const primaryAddressText = addressText(primaryAddress?.address);
    return (
      <Card className="border-brand-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-900">{customer.name}</p>
                <Badge color="green"><Check className="h-3 w-3" /> Customer selected</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {customer.customerCode} <span className="mx-1 text-slate-300">·</span> {customer.phone ?? "No phone"}
                {customer.stats?.outstanding > 0 && <span className="ms-2 font-medium text-amber-700">Previous dues {money(customer.stats.outstanding)}</span>}
              </p>
              {primaryAddressText ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-600">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" />
                  <span><span className="font-medium text-slate-700">{primaryAddress?.label ?? "Address"}:</span> {primaryAddressText}{addresses.length > 1 ? ` · +${addresses.length - 1} more` : ""}</span>
                </p>
              ) : canCreate ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" /> No saved address yet</p>
              ) : null}
              {customer.careInstructions && <p className="mt-2 text-xs text-amber-800">Care note: {customer.careInstructions}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canCreate && (
              <Button variant="secondary" size="sm" onClick={() => setAddingAddress((value) => !value)}>
                <MapPin className="h-3.5 w-3.5" /> Add address
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => onChange(null)}>Change</Button>
          </div>
        </div>
        {addingAddress && canCreate && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Save a customer address</h3>
              <p className="mt-0.5 text-xs text-slate-500">The address will be available for this customer&apos;s future orders.</p>
            </div>
            {addressErr && <div className="mb-3"><Alert tone="amber">{addressErr}</Alert></div>}
            <AddressFields value={addressDraft} onChange={setAddressDraft} />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setAddingAddress(false); setAddressErr(""); }}>Cancel</Button>
              <Button size="sm" loading={addressBusy} disabled={!addressDraft.line1.trim()} onClick={saveAddress}>Save address</Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      title={
        <div className="flex items-center gap-2.5">
          <StepDot n={1} done={false} />
          <span className="dcd-h text-[22px]">Customer</span>
        </div>
      }
    >
      {!creating ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
              if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setHighlight((highlight + 1) % results.length); }
              else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setHighlight((highlight - 1 + results.length) % results.length); }
              else if (e.key === "Enter" && results[highlight]) { e.preventDefault(); void choose(results[highlight].id); }
              else if (e.key === "Escape") setQ("");
            }} placeholder="Mobile number, name, email or customer code" aria-label="Find customer" className="h-12 rounded-xl ps-9" />
          </div>
          <p className="text-[13px] text-slate-500">Type at least 2 letters or digits. ↑ ↓ to move, Enter to select.</p>
          {results.length > 0 && (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {results.map((c, i) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void choose(c.id)} className={cx("flex w-full items-center justify-between gap-3 px-3 py-3 text-start text-sm transition hover:bg-brand-50/60", i === highlight && "bg-slate-100")}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{c.name?.slice(0, 1)?.toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">{c.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{c.phone ?? "No phone"} · {c.customerCode}</span>
                      </span>
                    </span>
                    {c.outstanding > 0 && <Badge color="amber">Due {money(c.outstanding)}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && <p className="text-sm text-slate-500">No customer found.</p>}
          {canCreate && (
            <Button
              variant="secondary"
              size="md"
              className="mt-1 border-dashed"
              onClick={() => {
                setCreating(true);
                const digits = q.replace(/\D/g, "");
                setForm({ name: digits.length >= 6 ? "" : q, phone: digits.length >= 6 ? q : "", email: "", notificationChannel: "whatsapp", marketingConsent: false, ...emptyAddress });
                setErr("");
                setDupId(null);
              }}
            >
              <Plus className="h-4 w-4" /> New customer
            </Button>
          )}
          {!q.trim() && !!recent.data?.items.length && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-sm text-slate-500">Recent</span>
              {recent.data.items.map((c) => <button key={c.id} type="button" onClick={() => void choose(c.id)} aria-label={`Select recent customer ${c.name}`} className="dcd-pill min-h-10 cursor-pointer rounded-full border border-slate-200 px-3.5 text-sm font-medium text-slate-800">{c.name}</button>)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {err && (
            <Alert tone="amber">
              {err}
              {dupId && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => api(`/customers/${dupId}`).then((c) => (onChange(c), setCreating(false)))}>
                    Use existing customer
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => create(true)}>
                    Create anyway
                  </Button>
                </div>
              )}
            </Alert>
          )}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Contact details</h3>
              <p className="mt-0.5 text-xs text-slate-500">Name is required. Add a mobile number to find this customer quickly next time.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Full name" required>
                <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
              </Field>
              <Field label="Mobile" hint="Optional, but recommended">
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" inputMode="tel" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
              </Field>
              <Field label="Order updates via" hint="Booking, ready, and payment updates">
                <Select value={form.notificationChannel} onChange={(e) => setForm({ ...form, notificationChannel: e.target.value })}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="none">Don't notify</option>
                </Select>
              </Field>
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} className="mt-0.5" />
              <span>Customer agrees to promotional emails and offers. Optional; order updates are separate.</span>
            </label>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><MapPin className="h-4 w-4 text-brand-700" /> Home address <span className="font-normal text-slate-400">Optional</span></h3>
                <p className="mt-0.5 text-xs text-slate-500">Save a delivery address to the customer&apos;s profile for future visits.</p>
              </div>
              <Badge color="slate">Saved to profile</Badge>
            </div>
            <AddressFields value={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">You can add or update addresses later from the customer profile.</p>
            <div className="flex gap-2">
            <Button onClick={() => create(false)} loading={busy} disabled={!form.name.trim()}>
              Save customer
            </Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setErr(""); }}>
              Cancel
            </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function PosPage() {
  return (
    <Suspense>
      <PosInner />
    </Suspense>
  );
}
