"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Check, ChevronDown, MapPin, Minus, Plus, Search, Shirt, ShoppingCart, UserRound, Wallet, X } from "lucide-react";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Textarea, cx } from "@/components/ui";
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
}

const FLAGS: [string, string][] = [
  ["stain", "Stain"],
  ["tear", "Tear"],
  ["missing_button", "Missing button"],
  ["colour_fade", "Colour fade"],
  ["shrinkage", "Shrinkage"],
  ["other", "Other"],
];

const CATEGORY_ORDER = [
  "Men", "Women", "Ethnic", "Kids & Baby", "Household Linen", "Home Furnishing", "Accessories", "Premium & Delicate",
  "Footwear & Leather", "Commercial Linen", "Repair & Alterations",
  // Categories from earlier built-in lists, for stores that kept them.
  "Kids", "Woollens", "Household", "Footwear & Bags", "General", "Others",
];

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
  const [discountPct, setDiscountPct] = useState("");
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
  const [showOptions, setShowOptions] = useState(false);
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

  const discountBps = Math.round((Number(discountPct) || 0) * 100);
  const payload = useMemo(
    () => ({
      customerId: customer?.id,
      branchId,
      express,
      discountBps,
      couponCode: couponCode.trim() || undefined,
      deliveryMethod,
      notes: notes || undefined,
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
      })),
    }),
    [customer, branchId, express, discountBps, couponCode, deliveryMethod, notes, lines],
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
      const same = ls.find((l) => l.garmentTypeId === gtId && l.serviceId === serviceId && !l.colour && !l.brand && !l.conditionFlags.length && !l.conditionNotes && !l.careInstructions && !l.specialCareApprovalRequired && !l.specialCareReason);
      if (same) {
        setFlash(same.key);
        return ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const key = newIdempotencyKey();
      setFlash(key);
      return [...ls, { key, garmentTypeId: gtId, serviceId, quantity: 1, colour: "", brand: "", conditionFlags: [], conditionNotes: "", careInstructions: "", specialCareApprovalRequired: false, specialCareReason: "" }];
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
      router.push(`/orders/view?id=${order.id}&created=1`);
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
  const estimate = lines.reduce((sum, l) => sum + (priceOf(l.garmentTypeId, l.serviceId) ?? 0) * l.quantity, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
        <div className="space-y-4">
          <PageHeader title="New order" subtitle={`Receiving at ${branch?.name ?? "—"}`} />
          {pickupId && <Alert tone="blue">Booking the garments collected on a home pickup. Tag every garment from the pickup bag.</Alert>}
          <CustomerPicker customer={customer} onChange={setCustomer} canCreate={can("customers.write")} />

          <Card
            title={
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Shirt className="h-4 w-4" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Garments & services</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">Choose a service, then add each garment</p>
                </div>
              </div>
            }
            actions={garmentCount > 0 ? <Badge color="brand">{garmentCount} pcs</Badge> : undefined}
          >
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Default service for new garments</p>
              <div className="flex flex-wrap gap-2">
              {services.data
                ?.filter((s) => s.active)
                .map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setServiceId(s.id)}
                    aria-pressed={serviceId === s.id}
                    className={cx("rounded-full border px-3.5 py-2 text-sm font-medium transition", serviceId === s.id ? "border-brand-700 bg-brand-700 text-white shadow-sm shadow-brand-900/15" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800")}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <label className="relative block">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={garmentSearch} onChange={(event) => setGarmentSearch(event.target.value)} placeholder="Search garments, e.g. shirt, saree, blanket" className="pl-9" aria-label="Search garment types" />
              </label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter garments by category">
                {["All", ...categories].map((category) => <button key={category} type="button" aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} className={cx("shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition", categoryFilter === category ? "border-brand-700 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-800")}>{category}</button>)}
              </div>
              {filteredGarments.length ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {filteredGarments.map((g) => {
                    const qty = quantityFor(g.id);
                    const price = priceOf(g.id, serviceId);
                    const unpriced = price === undefined;
                    return (
                      <div key={g.id} className={cx("group relative flex flex-col overflow-hidden rounded-xl border bg-white text-center shadow-sm transition", qty ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md", unpriced && "opacity-60")}>
                        <button type="button" onClick={() => addGarment(g.id)} disabled={!serviceId || unpriced} title={unpriced ? `No ${serviceName} price set for ${g.name}. Add it in Services & prices.` : `Add ${g.name}`} className="flex flex-1 flex-col items-center gap-1 px-2 pb-2 pt-2.5 disabled:cursor-not-allowed">
                          <span className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg p-1"><GarmentThumb garment={g} className="transition group-hover:scale-105" /></span>
                          <span className="w-full truncate text-[13px] font-semibold text-slate-800">{g.name}</span>
                          <span className={cx("text-[13px] font-bold tabular-nums", unpriced ? "text-[11px] font-medium text-amber-700" : "text-slate-900")}>{unpriced ? "Price not set" : money(price).replace(/\.00$/, "")}</span>
                        </button>
                        {qty > 0 && <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">{qty}</span>}
                        {qty > 0 && (
                          <div className="flex items-center border-t border-brand-100 bg-brand-50/60">
                            <button type="button" onClick={() => removeOne(g.id)} aria-label={`Remove one ${g.name}`} className="flex h-8 flex-1 items-center justify-center text-brand-800 hover:bg-brand-100"><Minus className="h-4 w-4" /></button>
                            <span className="w-8 text-sm font-semibold tabular-nums text-brand-900">{qty}</span>
                            <button type="button" onClick={() => addGarment(g.id)} aria-label={`Add one ${g.name}`} className="flex h-8 flex-1 items-center justify-center text-brand-800 hover:bg-brand-100"><Plus className="h-4 w-4" /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {can("catalogue.manage") && (
                    <a href="/catalogue" className="flex min-h-36 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3 text-center text-slate-500 transition hover:border-brand-400 hover:text-brand-700">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm"><Plus className="h-4 w-4" /></span>
                      <span className="text-[13px] font-semibold">Add garment</span>
                      <span className="text-[11px]">or change prices</span>
                    </a>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center"><p className="text-sm font-medium text-slate-700">No matching garments</p><p className="mt-1 text-xs text-slate-500">Try another search or choose a different category.</p></div>
              )}
            </div>
          </Card>

        </div>

        <aside id="pos-cart" className="scroll-mt-20 xl:sticky xl:top-20 xl:self-start">
          <section className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white xl:max-h-[calc(100vh-7rem)]">
            <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><ShoppingCart className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-900">Cart</h2>
                <p className="truncate text-xs text-slate-500">{customer ? customer.name : "No customer selected yet"}</p>
              </div>
              <Badge color={garmentCount ? "brand" : "slate"}>{garmentCount} pc{garmentCount === 1 ? "" : "s"}</Badge>
              {lines.length > 0 && <button type="button" onClick={() => { setLines([]); setOpenLine(null); }} className="rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-600">Clear</button>}
            </header>

            <div ref={cartScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              {!lines.length ? (
                <div className="px-4 py-8 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Shirt className="h-5 w-5" /></div>
                  <p className="mt-3 text-sm font-medium text-slate-700">Cart is empty</p>
                  <p className="mt-1 text-xs text-slate-500">Tap garments on the left to add them.</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {lines.map((l, idx) => {
                    const q = quote?.lines?.[idx];
                    const gt = gtById(l.garmentTypeId);
                    const unit = priceOf(l.garmentTypeId, l.serviceId);
                    const amount = q ? q.total : unit !== undefined ? unit * l.quantity : null;
                    const detailCount = (l.colour ? 1 : 0) + (l.brand ? 1 : 0) + l.conditionFlags.length + (l.careInstructions ? 1 : 0) + (l.specialCareApprovalRequired ? 1 : 0);
                    const open = openLine === l.key;
                    return (
                      <li key={l.key} data-line={l.key} className={cx("px-3 py-2.5 transition-colors duration-500", open && "bg-slate-50", flash === l.key && "bg-brand-50")}>
                        <div className="flex items-start gap-2.5">
                          {gt && <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 p-0.5"><GarmentThumb garment={gt} /></span>}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900" title={gt?.name}>{gt?.name}</p>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{amount === null ? "—" : money(amount)}</span>
                              <button type="button" aria-label={`Remove ${gt?.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="-mr-1 shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Select value={l.serviceId} onChange={(e) => update(l.key, { serviceId: e.target.value })} className="h-7 w-[112px] py-0 pl-2 pr-6 text-xs sm:w-[132px] sm:pr-7" aria-label="Service">
                                {services.data?.filter((sv) => sv.active).map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                              </Select>
                              <div className="flex h-7 items-center rounded-md border border-slate-300">
                                <button type="button" className="flex h-full w-7 items-center justify-center hover:bg-slate-100" aria-label="Decrease" onClick={() => (l.quantity > 1 ? update(l.key, { quantity: l.quantity - 1 }) : setLines((ls) => ls.filter((x) => x.key !== l.key)))}><Minus className="h-3.5 w-3.5" /></button>
                                <span className="w-7 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                                <button type="button" className="flex h-full w-7 items-center justify-center hover:bg-slate-100" aria-label="Increase" onClick={() => update(l.key, { quantity: Math.min(200, l.quantity + 1) })}><Plus className="h-3.5 w-3.5" /></button>
                              </div>
                              <button type="button" onClick={() => setOpenLine(open ? null : l.key)} aria-expanded={open} className={cx("ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium", detailCount ? "text-amber-800 hover:bg-amber-50" : "text-brand-700 hover:bg-brand-50")}>
                                {detailCount ? `Details · ${detailCount}` : "Details"}<ChevronDown className={cx("h-3.5 w-3.5 transition", open && "rotate-180")} />
                              </button>
                            </div>
                            {!open && (l.colour || l.brand || l.conditionFlags.length > 0) && (
                              <p className="mt-1 truncate text-[11px] text-slate-500">{[l.colour, l.brand, ...l.conditionFlags.map((f) => FLAGS.find(([k]) => k === f)?.[1])].filter(Boolean).join(" · ")}</p>
                            )}
                          </div>
                        </div>
                        {open && (
                          <div className="mt-2.5 space-y-2 pl-[50px]">
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

              <div className="border-t border-slate-100">
                <button type="button" onClick={() => setShowOptions(!showOptions)} aria-expanded={showOptions} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
                  <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-700">Delivery, discount &amp; notes</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      Ready {new Date(promisedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {deliveryMethod === "counter" ? "Counter collection" : "Home delivery"}{express ? " · Express" : ""}{discountPct ? ` · ${discountPct}% off` : ""}{couponCode ? ` · ${couponCode}` : ""}
                    </span>
                  </span>
                  <ChevronDown className={cx("h-4 w-4 shrink-0 text-slate-400 transition", showOptions && "rotate-180")} />
                </button>
                {showOptions && (
                  <div className="space-y-3 px-4 pb-4">
                    <Field label="Promised ready by" required>
                      <Input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
                    </Field>
                    <div className="flex items-end gap-4">
                      <label className="flex items-center gap-2 pb-2.5 text-sm">
                        <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} /> Express
                        {quote?.surchargeBps ? <Badge color="amber">+{quote.surchargeBps / 100}%</Badge> : null}
                      </label>
                      <Field label="Discount %" className="ml-auto w-28">
                        <Input inputMode="decimal" value={discountPct} onChange={(e) => { setDiscountPct(e.target.value.replace(/[^0-9.]/g, "")); if (e.target.value) setCouponCode(""); }} placeholder="0" disabled={!!couponCode} />
                      </Field>
                    </div>
                    <Field label="Coupon code" hint={couponCode ? "Clear the coupon to enter a manual discount" : undefined}>
                      <Input value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); if (e.target.value) setDiscountPct(""); }} placeholder="Enter coupon code" autoCapitalize="characters" />
                    </Field>
                    <Field label="Collection">
                      <Select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as any)}>
                        <option value="counter">Customer collects at counter</option>
                        <option value="home_delivery">Home delivery</option>
                      </Select>
                    </Field>
                    <Field label="Order notes">
                      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>

              {can("payments.collect") && (
                <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Wallet className="h-4 w-4 text-slate-400" />Advance payment</p>
                  {approvalHoldsRequired && <Alert>Advance collection is disabled while approval is pending.</Alert>}
                  <div className="grid grid-cols-2 gap-2">
                    <Input inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount ₹" aria-label="Advance amount" disabled={approvalHoldsRequired} />
                    <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={approvalHoldsRequired} aria-label="Payment method">
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m} disabled={m === "store_credit" && !walletBalance}>
                          {m === "store_credit" ? `Customer wallet (${money(walletBalance)})` : PAYMENT_METHOD_LABELS[m]}
                        </option>
                      ))}
                    </Select>
                    {payMethod !== "cash" && payMethod !== "store_credit" && (
                      <Input className="col-span-2" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="UPI / card reference no." aria-label="Transaction reference" disabled={approvalHoldsRequired} />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => setPayAmount((grand / 100).toFixed(2))} disabled={!grand || approvalHoldsRequired}>Full amount</Button>
                    <Button variant="ghost" size="sm" onClick={() => setPayAmount("")}>No advance</Button>
                    {walletBalance > 0 && (
                      <Button variant="secondary" size="sm" disabled={!grand || approvalHoldsRequired} onClick={() => { setPayMethod("store_credit"); setPayAmount((Math.min(walletBalance, grand) / 100).toFixed(2)); }}>Use wallet {money(walletBalance)}</Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <footer className="space-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              {approvalHoldsRequired && <Alert>This order will be held for customer approval. Production and payment collection unlock after approval is recorded on the order.</Alert>}
              {quoteError && <Alert>{quoteError}</Alert>}
              {quote ? (
                <dl className="space-y-0.5 text-xs text-slate-600">
                  <Row label="Subtotal" value={money(quote.totals.subtotal)} />
                  {quote.totals.surchargeTotal ? <Row label="Express surcharge" value={money(quote.totals.surchargeTotal)} /> : null}
                  {quote.totals.discountTotal ? <Row label="Discount" value={`− ${money(quote.totals.discountTotal)}`} /> : null}
                  <Row label="GST" value={money(quote.totals.taxTotal)} />
                </dl>
              ) : lines.length > 0 ? (
                <p className="text-[11px] leading-4 text-slate-500">{customer ? "Calculating the final bill…" : "Estimate from your price list. Select a customer to see the final bill with GST and discounts."}</p>
              ) : null}
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-700">{quote ? "Total" : "Estimate"}</span>
                <span className="text-xl font-bold tabular-nums text-slate-900">{money(quote ? grand : estimate)}</span>
              </div>
              {advance > 0 && grand > 0 && <p className="text-xs text-slate-600">Advance {money(advance)} · balance at collection <strong className="tabular-nums">{money(Math.max(0, grand - advance))}</strong></p>}
              {error && <Alert>{error}</Alert>}
              <Button size="lg" className="w-full" onClick={save} loading={saving} disabled={!customer || !lines.length || !!quoteError}>
                {!customer ? "Select a customer to continue" : !lines.length ? "Add garments to continue" : `Create order · ${garmentCount} pc${garmentCount === 1 ? "" : "s"}`}
              </Button>
            </footer>
          </section>
        </aside>
      </div>

      {lines.length > 0 && !cartInView && (
        <a href="#pos-cart" className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-xl bg-brand-800 px-4 py-3 text-white shadow-lg shadow-brand-900/30 xl:hidden">
          <ShoppingCart className="h-5 w-5" />
          <span className="flex-1 text-sm font-semibold">{garmentCount} pc{garmentCount === 1 ? "" : "s"} · {money(quote ? grand : estimate)}</span>
          <span className="text-sm font-semibold">View cart →</span>
        </a>
      )}
    </div>
  );
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
                {customer.stats?.outstanding > 0 && <span className="ml-2 font-medium text-amber-700">Previous dues {money(customer.stats.outstanding)}</span>}
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
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><UserRound className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Customer</h2>
            <p className="mt-0.5 text-xs font-normal text-slate-500">Select an existing profile or create a new one</p>
          </div>
        </div>
      }
    >
      {!creating ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by mobile, name, email or customer code" className="h-11 rounded-xl bg-slate-50 pl-9 focus:bg-white" />
          </div>
          {results.length > 0 && (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => api(`/customers/${c.id}`).then(onChange)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition hover:bg-brand-50/60">
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
