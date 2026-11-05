"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, Building2, Check, CircleAlert, Crown, Factory, IndianRupee, MapPin, Phone, Plus, Barcode, ScanLine, Settings2, Shirt, Target, Truck, UserRound, Users, Wallet, WashingMachine } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, money, rupeesToPaise, todayISO } from "@/lib/format";
import { Alert, Button, Card, Field, Input, Modal, OrderStatusBadge, Spinner, cx } from "@/components/ui";

type DashboardData = {
  financialVisible: boolean;
  sales: { grossBilled: number; netSales: number; invoices: number; tax: number; discounts: number } | null;
  collections: { net: number; refunded: number; collected: number } | null;
  receivables: { outstanding: number; openInvoices: number } | null;
  expenses: number | null;
  operations: { orders_received: number; orders_completed: number; ready_orders: number; overdue_orders: number; awaiting_processing: number; ready_garments: number; exceptions: number; reworkRate: number; inspections: number };
  branches: { id: string; name: string; branch_code: string; orders: number; billed: number; collected: number; laundry: number; outstanding: number }[];
  previous: { grossBilled?: number; collections?: number; expenses?: number; orders: number; garments: number };
  garments: { handled: number; avgTurnaroundDays: number | null };
  laundry: { billed: number; orders: number } | null;
  counters: { branchId: string; branchName: string; userId: string; staffName: string; payments: number; total: number; cash: number; upi: number; card: number; other: number }[];
  paymentMethods: { method: string; total: number; count: number }[];
};
type StageTag = { stage: string; scanCode: string; tagCode: string; garment: string; customerName: string };
type AttentionItem = { id?: string; orderNumber?: string; customerId: string; name: string; phone: string | null; items?: string | null; days: number; balance?: number | null; invoices?: number };
type RouteStop = { id: string; kind: string; status: string; slot: string; address: Record<string, string>; phone: string | null; name: string; driver: string | null };
type LiveData = {
  serverTime: string;
  targets: { billingPerDay?: number; duesLimit?: number; garmentsPerDay?: number };
  production: { stages: { stage: string; count: number }[]; tags: StageTag[]; exceptions: number; lateOrders: number };
  attention: { overdue: AttentionItem[]; ready: AttentionItem[]; dues: AttentionItem[]; counts: { overdue: number; ready: number; dues: number } };
  recentOrders: { id: string; orderNumber: string; name: string; items: string | null; promisedAt: string; status: string; late: boolean; total: number | null }[];
  trend: { day: string; billed: number; collected: number; garments: number }[];
  route: RouteStop[] | null;
};

const IST_DAY = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const inrK = (paise: number) => (paise >= 100_000 ? `₹${(paise / 100_000).toFixed(1)}k` : inr(paise));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

type PeriodName = "Today" | "This week" | "This month" | "Quarter" | "Custom";
/** Each period up to today, and the same stretch of the one before, so a part-finished week is compared fairly. */
function periodRange(name: PeriodName, today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (name === "This week") {
    const back = (d.getUTCDay() + 6) % 7;
    const from = shift(today, -back);
    return { from, to: today, compareFrom: shift(from, -7), compareTo: shift(today, -7), cmp: "last week" };
  }
  if (name === "This month" || name === "Quarter") {
    const size = name === "Quarter" ? 3 : 1;
    const startMonth = name === "Quarter" ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth();
    const from = new Date(Date.UTC(d.getUTCFullYear(), startMonth, 1));
    const prevFrom = new Date(Date.UTC(d.getUTCFullYear(), startMonth - size, 1));
    const lastOfPrev = new Date(Date.UTC(d.getUTCFullYear(), startMonth, 0));
    const elapsed = Math.round((d.getTime() - from.getTime()) / 86_400_000);
    const prevTo = new Date(Math.min(prevFrom.getTime() + elapsed * 86_400_000, lastOfPrev.getTime()));
    return { from: iso(from), to: today, compareFrom: iso(prevFrom), compareTo: iso(prevTo), cmp: name === "Quarter" ? "last quarter" : "last month" };
  }
  return { from: today, to: today, compareFrom: shift(today, -1), compareTo: shift(today, -1), cmp: "yesterday" };
}

const STAGES = [
  { key: "received", label: "Received", status: "Waiting", dot: "var(--dc-grey)", chipBg: "var(--dc-soft)", chipFg: "var(--dc-sub)", tile: "#e4e1da", hint: "Tagged at the counter, waiting to be sorted" },
  { key: "cleaning", label: "Cleaning", status: "In progress", dot: "var(--dc-blue)", chipBg: "var(--dc-blue-bg)", chipFg: "var(--dc-blue-fg)", tile: "#cfdcf0", hint: "Being checked, sorted, washed or dry-cleaned" },
  { key: "finishing", label: "Finishing", status: "In progress", dot: "var(--dc-blue)", chipBg: "var(--dc-blue-bg)", chipFg: "var(--dc-blue-fg)", tile: "#cfdcf0", hint: "Pressing, quality check and packing" },
  { key: "ready", label: "Ready", status: "Ready for handoff", dot: "var(--dc-green)", chipBg: "var(--dc-green-bg)", chipFg: "var(--dc-green-fg)", tile: "#3cbf5a", hint: "Packed and waiting for pickup, or out for delivery" },
  { key: "delivered", label: "Delivered", status: "✓ Completed", dot: "var(--dc-solid)", chipBg: "var(--dc-soft)", chipFg: "var(--dc-ink)", tile: "#faf8f4", hint: "Handed over to customers today" },
] as const;

/** Slides in the first time it scrolls into view. Sections appear only after data loads, so it waits for the element. */
function useEnter() {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el || inView) return;
    const seen = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); seen.disconnect(); } }, { threshold: 0.05 });
    seen.observe(el);
    return () => seen.disconnect();
  }, [el, inView]);
  return { ref, inView };
}

/** Counts from zero to one each time the key changes, for numbers that roll up. */
function useCountUp(key: string, ready: boolean) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setProgress(1); return; }
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 1000);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    setProgress(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
  return progress;
}

function Ring({ size, stroke, value, color, show, children, label }: { size: number; stroke: number; value: number; color: string; show: boolean; children: ReactNode; label: string }) {
  const r = size / 2 - stroke + 1;
  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="block -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dc-line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" pathLength={100} style={{ strokeDasharray: 100, strokeDashoffset: show ? 100 - Math.min(100, value) : 100, transition: "stroke-dashoffset 2.2s cubic-bezier(.25,.7,.2,1) .2s" }} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-[1.1]">{children}</span>
    </div>
  );
}

/** The three shortcuts under the greeting: each glides to its section and briefly outlines it. */
function GlanceCard({ value, label, sub, tone, icon, onClick }: { value: string | number; label: string; sub: string; tone: "plain" | "red" | "blue"; icon: ReactNode; onClick: () => void }) {
  const colors = { plain: ["var(--dc-soft)", "var(--dc-ink)", "var(--dc-ink)"], red: ["var(--dc-red-bg)", "var(--dc-red-fg)", "var(--dc-red-fg)"], blue: ["var(--dc-blue-bg)", "var(--dc-blue-fg)", "var(--dc-ink)"] }[tone];
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${value}. ${sub}`} className="dcd-lift flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left" style={{ background: "var(--dc-card)", borderColor: "var(--dc-line)" }}>
      <span aria-hidden="true" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] font-bold" style={{ background: colors[0], color: colors[1] }}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex items-baseline gap-2"><span className="dcd-h text-xl" style={{ color: colors[2] }}>{value}</span><span className="truncate text-sm font-semibold">{label}</span></span>
        <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>{sub}</span>
      </span>
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: "var(--dc-solid)", color: "var(--dc-on-solid)" }}><ArrowDown className="h-4 w-4" strokeWidth={2.6} /></span>
    </button>
  );
}

type KpiCell = { label: string; def: string; value: string; big: boolean; key: string; delta: number | null; goodWhenUp?: boolean; cmp: string; note: string; ring: number | null; target: string; spark: number[]; href?: string };

function Kpi({ k, index, show, columns }: { k: KpiCell; index: number; show: boolean; columns: string }) {
  const good = k.delta !== null && k.delta !== 0 && (k.delta > 0) === (k.goodWhenUp ?? true);
  const max = Math.max(1, ...k.spark);
  const inner = (
    <>
      {k.ring !== null && (
        <span className="absolute right-4 top-4">
          <Ring size={52} stroke={5} value={k.ring} color={k.key} show={show} label={`${k.label}: ${k.ring}% ${k.target}`}><span className="text-[13px] font-bold tabular-nums">{k.ring}%</span></Ring>
        </span>
      )}
      <span className="flex items-center gap-2 pr-[60px] text-[15px] font-semibold"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: k.key }} />{k.label}</span>
      <span className="-mt-1 pr-[60px] text-[13px]" style={{ color: "var(--dc-sub)" }}>{k.def}</span>
      <span className={cx("dcd-h mt-1.5 leading-[1.1] tabular-nums", k.big ? "text-[clamp(30px,2.5vw,38px)]" : "text-[clamp(26px,2.2vw,30px)]")}>{k.value}</span>
      <span className="flex flex-wrap items-center gap-2">
        {k.delta !== null && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[13px] font-semibold" style={{ background: k.delta === 0 ? "var(--dc-soft)" : good ? "var(--dc-green-bg)" : "var(--dc-red-bg)", color: k.delta === 0 ? "var(--dc-sub)" : good ? "var(--dc-green-fg)" : "var(--dc-red-fg)" }}>
            {k.delta !== 0 && <span aria-hidden="true">{k.delta > 0 ? "▲" : "▼"}</span>}{Math.abs(k.delta)}%<span className="font-medium">vs {k.cmp}</span>
          </span>
        )}
        <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>{k.note}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-2 border-t border-dashed pt-2.5 text-[13px]" style={{ borderColor: "var(--dc-line)", color: "var(--dc-sub)" }}>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--dc-ink)" }}>Target</span>
        <span>{k.ring !== null && <strong className="font-semibold" style={{ color: "var(--dc-ink)" }}>{k.ring}% </strong>}{k.target}</span>
      </span>
      {k.spark.length > 0 && (
        <span aria-hidden="true" className="mt-1.5 flex h-6 items-end gap-[3px]">
          {k.spark.map((v, i) => <span key={i} className="flex-1 rounded-[2px]" style={{ height: show ? `${Math.max(8, (v / max) * 100)}%` : "6%", background: i === k.spark.length - 1 ? k.key : "var(--dc-line)", transition: `height .7s cubic-bezier(.2,.8,.2,1) ${0.2 + i * 0.03}s` }} />)}
        </span>
      )}
    </>
  );
  const style: CSSProperties = { background: index < 2 ? "var(--dc-card)" : "var(--dc-card2)", borderColor: "var(--dc-line2)" };
  const cls = cx("relative flex flex-col gap-2 p-[22px] pb-5 border-t first:border-t-0", columns, "transition-colors");
  return k.href
    ? <Link href={k.href} className={cx(cls, "dcd-row")} style={style}>{inner}</Link>
    : <div className={cls} style={style}>{inner}</div>;
}

function Targets({ current, onClose, onSaved }: { current: LiveData["targets"]; onClose: () => void; onSaved: () => void }) {
  const [billing, setBilling] = useState(current.billingPerDay ? String(current.billingPerDay / 100) : "");
  const [dues, setDues] = useState(current.duesLimit ? String(current.duesLimit / 100) : "");
  const [garments, setGarments] = useState(current.garmentsPerDay ? String(current.garmentsPerDay) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/organizations/current", { method: "PATCH", body: { settings: { dashboardTargets: { ...(billing ? { billingPerDay: rupeesToPaise(billing) } : {}), ...(dues ? { duesLimit: rupeesToPaise(dues) } : {}), ...(garments ? { garmentsPerDay: Number(garments) } : {}) } } } });
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }
  const digits = (set: (v: string) => void) => (e: { target: { value: string } }) => set(e.target.value.replace(/[^0-9.]/g, ""));
  return (
    <Modal open title="Your dashboard targets" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-600">The rings on the dashboard measure against these. Weeks, months and quarters multiply the daily numbers by the days so far.</p>
        <Field label="Billing target per day (₹)"><Input inputMode="decimal" value={billing} onChange={digits(setBilling)} placeholder="20000" autoFocus /></Field>
        <Field label="Highest dues you are comfortable with (₹)" hint="Lower is better."><Input inputMode="decimal" value={dues} onChange={digits(setDues)} placeholder="5000" /></Field>
        <Field label="Garments you can handle per day"><Input inputMode="numeric" value={garments} onChange={digits(setGarments)} placeholder="80" /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save targets</Button></div>
      </form>
    </Modal>
  );
}

function ProductionLine({ live, inView, sectionRef, flash, canOrders }: { live: LiveData; inView: boolean; sectionRef: (el: HTMLElement | null) => void; flash: boolean; canOrders: boolean }) {
  const counts = Object.fromEntries(live.production.stages.map((s) => [s.stage, s.count]));
  const total = STAGES.reduce((sum, s) => sum + (counts[s.key] ?? 0), 0);
  const finished = (counts.ready ?? 0) + (counts.delivered ?? 0);
  const [picked, setPicked] = useState(() => { const busiest = [...STAGES].sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0))[0]; return STAGES.findIndex((s) => s.key === busiest.key); });
  const cur = STAGES[picked];
  const tags = live.production.tags.filter((t) => t.stage === cur.key);
  const shirt = (fill: string, i: number, stage: number) => (
    <span key={i} className="dcd-tile" style={{ opacity: inView ? 1 : 0, transition: `opacity .4s ease ${0.25 + stage * 0.1 + i * 0.05}s` }}>
      <span className="grid h-[30px] w-[30px] place-items-center rounded-lg" style={{ background: fill, boxShadow: "0 2px 0 rgba(0,0,0,.35)", animation: `dcBob 2.6s ease-in-out ${((stage * 3 + i) % 7) * 0.35}s infinite` }}><Shirt className="h-4 w-4" color="#151514" /></span>
    </span>
  );
  return (
    <section id="sec-line" ref={sectionRef} aria-labelledby="line-h" className={cx("dcd-card dcd-enter flex flex-col gap-5 p-[clamp(20px,2.5vw,28px)]", inView && "is-in")} style={{ boxShadow: flash ? "0 0 0 3px var(--dc-grey)" : undefined }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="line-h" className="dcd-h text-[22px]">Production line</h2>
          <p className="text-sm" style={{ color: "var(--dc-sub)" }}>{total ? `${finished} of ${total} garments finished (ready or delivered) · ${pct(finished, total)}%. Select a stage to see its tags.` : "Nothing in the shop right now. Garments appear here as soon as an order is booked."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live.production.exceptions > 0 && canOrders && <Link href="/exceptions" className="dcd-pill inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold" style={{ borderColor: "var(--dc-red-fg)", color: "var(--dc-red-fg)" }}><CircleAlert className="h-4 w-4" />{live.production.exceptions} exception{live.production.exceptions === 1 ? "" : "s"}</Link>}
          {canOrders && <Link href="/production" className="dcd-pill inline-flex min-h-10 items-center gap-1 rounded-full border px-4 text-sm font-semibold" style={{ borderColor: "var(--dc-line)" }}>Open production board <ArrowRight className="h-4 w-4" /></Link>}
        </div>
      </div>
      <div className="-m-1 overflow-x-auto p-1">
        <div className="flex min-w-[760px] flex-col gap-2.5">
          <div className="grid grid-cols-5 gap-2.5">
            {STAGES.map((s, i) => {
              const on = picked === i;
              const count = counts[s.key] ?? 0;
              return (
                <button key={s.key} type="button" onClick={() => setPicked(i)} aria-pressed={on} className="dcd-lift flex min-h-[156px] cursor-pointer flex-col gap-2.5 rounded-2xl border-[1.5px] p-4 text-left" style={{ background: on ? "var(--dc-solid)" : "var(--dc-soft2)", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)", borderColor: on ? "var(--dc-solid)" : "var(--dc-line)" }}>
                  <span className="flex min-w-0 items-center justify-between gap-2"><span className="truncate text-[15px] font-semibold">{i + 1}. {s.label}</span><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.dot, boxShadow: `0 0 0 2px ${on ? "var(--dc-solid)" : "var(--dc-card)"}` }} /></span>
                  <span className="flex items-baseline gap-1.5"><span className="dcd-h text-[30px] leading-none tabular-nums">{count}</span><span className="text-sm font-semibold">{pct(count, total)}%</span></span>
                  <span aria-hidden="true" className="block h-1 overflow-hidden rounded-sm" style={{ background: on ? "#6b6963" : "var(--dc-line2)" }}><span className="block h-full rounded-sm" style={{ width: inView ? `${pct(count, total)}%` : "0%", background: s.dot, transition: "width .9s cubic-bezier(.2,.8,.2,1) .3s" }} /></span>
                  <span className="-mt-1 text-[13px] opacity-80">of {total} garments today</span>
                  <span className="mt-auto self-start rounded-full px-2.5 py-[3px] text-[13px] font-semibold" style={{ background: s.chipBg, color: s.chipFg }}>{s.status}</span>
                </button>
              );
            })}
          </div>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--dc-sub)" }}><strong style={{ color: "var(--dc-ink)" }}>How to read:</strong> each <span aria-hidden="true" className="inline-grid h-[22px] w-[22px] place-items-center rounded-md" style={{ background: "#e4e1da" }}><Shirt className="h-3 w-3" color="#151514" /></span> tile is one garment. Garments move left to right, from Received to Delivered.</span>
          <div className="relative rounded-[18px] p-2.5" style={{ background: "#1d1d1b", boxShadow: "inset 0 -5px 0 #0f0f0e" }}>
            <div aria-hidden="true" className="absolute inset-2.5 rounded-[10px]" style={{ background: "repeating-linear-gradient(90deg,#2a2a27 0 20px,#31312e 20px 40px)", animation: "dcBelt 1.4s linear infinite" }} />
            <div className="relative grid grid-cols-5 gap-2.5">
              {STAGES.map((s, i) => {
                const on = picked === i;
                const count = counts[s.key] ?? 0;
                const shown = Math.min(count, 6);
                return (
                  <button key={s.key} type="button" onClick={() => setPicked(i)} aria-label={`Show ${s.label} tags`} className="relative flex min-h-24 cursor-pointer flex-col gap-2 rounded-[10px] px-3 pb-3 pt-2.5 text-left" style={{ background: on ? "rgba(60,191,90,.16)" : "rgba(255,255,255,.02)", boxShadow: `inset 0 0 0 1.5px ${on ? "#3cbf5a" : "rgba(255,255,255,.06)"}`, transition: "background .3s ease,box-shadow .3s ease" }}>
                    <span className="flex items-center justify-between gap-1.5 text-[13px] font-semibold text-[#faf8f4]"><span>{s.label}</span><span className="rounded-full px-2 py-px" style={{ background: "rgba(255,255,255,.12)" }}>{count}</span></span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {Array.from({ length: shown }, (_, j) => shirt(s.tile, j, i))}
                      {count > shown && <span className="px-1 text-[13px] font-semibold text-[#faf8f4]">+{count - shown}</span>}
                    </span>
                    {i < 4 && <span aria-hidden="true" className="absolute -right-4 top-1/2 z-[2] -mt-[11px] grid h-[22px] w-[22px] place-items-center rounded-full text-[13px] font-bold text-[#151514]" style={{ background: "#3cbf5a", boxShadow: "0 0 0 3px #1d1d1b" }}>→</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>Up to 6 tiles shown per stage. “+16” means 16 more garments.</span>
        </div>
      </div>
      {canOrders && (
        <div key={cur.key} className="flex flex-col gap-2.5 border-t pt-4" style={{ borderColor: "var(--dc-line2)" }} aria-live="polite">
          <span className="text-sm" style={{ color: "var(--dc-sub)" }}><strong style={{ color: "var(--dc-ink)" }}>{cur.label}</strong> · {counts[cur.key] ?? 0} of {total} garments · {cur.hint}.</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((g, i) => (
              <Link key={g.scanCode} href={`/tags/view?code=${g.scanCode}`} title={`${g.tagCode} · ${g.customerName}`} className="dcd-pill dcd-pop inline-flex items-center gap-2 rounded-full border px-3 py-[7px] text-sm" style={{ background: "var(--dc-soft2)", borderColor: "var(--dc-line)", animationDelay: `${i * 0.05}s` }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dc-sub)" }}>Tag</span><strong className="font-semibold tabular-nums">{g.scanCode}</strong><span style={{ color: "var(--dc-sub)" }}>{g.garment}</span>
              </Link>
            ))}
            {!tags.length && <span className="text-sm" style={{ color: "var(--dc-sub)" }}>No garments at this stage.</span>}
            {(counts[cur.key] ?? 0) > tags.length && <Link href="/tags" className="dcd-pill inline-flex items-center rounded-full border px-3 py-[7px] text-sm font-semibold" style={{ borderColor: "var(--dc-line)" }}>See all tags</Link>}
          </div>
        </div>
      )}
    </section>
  );
}

function BilledChart({ trend, inView, selected, setSelected, sectionRef, flash }: { trend: LiveData["trend"]; inView: boolean; selected: number; setSelected: (i: number) => void; sectionRef: (el: HTMLElement | null) => void; flash: boolean }) {
  const week = trend.slice(-7);
  const top = Math.max(100_000, ...week.map((d) => d.billed), ...week.map((d) => d.collected));
  // A round top line, with four even steps under it.
  const stepBase = Math.pow(10, Math.floor(Math.log10(top / 4)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * stepBase).find((v) => v * 4 >= top) ?? stepBase * 10;
  const max = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const sel = week[selected] ?? week[week.length - 1];
  const totalB = week.reduce((s, d) => s + d.billed, 0);
  const totalC = week.reduce((s, d) => s + d.collected, 0);
  const label = (d: { day: string }, i: number) => {
    const date = new Date(`${d.day}T00:00:00Z`);
    return { day: i === week.length - 1 ? "Today" : date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }), date: date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) };
  };
  const owedSel = sel.billed - sel.collected;
  const owedAll = totalB - totalC;
  return (
    <section id="sec-chart" ref={sectionRef} aria-labelledby="chart-h" className={cx("dcd-card dcd-enter flex flex-col gap-4 p-[clamp(20px,2.5vw,28px)]", inView && "is-in")} style={{ boxShadow: flash ? "0 0 0 3px var(--dc-blue)" : undefined }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="chart-h" className="dcd-h text-[22px]">Billed vs collected</h2><p className="text-sm" style={{ color: "var(--dc-sub)" }}>Last 7 days. The gap is money still owed by customers. Select a day for its numbers.</p></div>
        <div className="flex flex-wrap gap-4 text-sm"><span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--dc-solid)" }} />Billed (solid)</span><span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-[3px]" style={{ background: "repeating-linear-gradient(135deg,#3cbf5a 0 3px,#7fd694 3px 6px)" }} />Collected (striped)</span></div>
      </div>
      <div key={sel.day} className="dcd-pop flex flex-wrap items-center gap-x-5 gap-y-1 rounded-[14px] px-4 py-3 text-sm" style={{ background: "var(--dc-soft)" }} aria-live="polite">
        <strong>{selected === week.length - 1 ? "Today, " : ""}{label(sel, selected).date}</strong>
        <span>Billed <strong>{inr(sel.billed)}</strong></span>
        <span>Collected <strong>{inr(sel.collected)}</strong></span>
        <span className="ml-auto rounded-full px-2.5 py-1 font-semibold" style={{ background: owedSel > 0 ? "var(--dc-red-bg)" : "var(--dc-green-bg)", color: owedSel > 0 ? "var(--dc-red-fg)" : "var(--dc-green-fg)" }}>{owedSel > 0 ? `Still owed ${inr(owedSel)}` : owedSel < 0 ? `Extra collected ${inr(-owedSel)}` : "Nothing owed"}</span>
      </div>
      <div className="grid grid-cols-[46px_1fr] gap-x-2">
        <div className="relative h-[200px]">{ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 text-[13px]" style={{ bottom: `calc(${(t / max) * 100}% - 8px)`, color: "var(--dc-sub)" }}>{inrK(t)}</span>)}</div>
        <div className="relative h-[200px]">
          {ticks.map((t) => <span key={t} aria-hidden="true" className="absolute inset-x-0 h-px" style={{ bottom: `${(t / max) * 100}%`, background: t ? "var(--dc-line2)" : "var(--dc-line)" }} />)}
          <div className="absolute inset-0 grid grid-cols-7">
            {week.map((d, i) => {
              const on = selected === i;
              return (
                <button key={d.day} type="button" onClick={() => setSelected(i)} aria-pressed={on} aria-label={`${label(d, i).day} ${label(d, i).date}: billed ${inr(d.billed)}, collected ${inr(d.collected)}`} title={`Billed ${inr(d.billed)} · Collected ${inr(d.collected)}`} className="dcd-col relative flex cursor-pointer items-end justify-center gap-[6%] rounded-t-lg px-[8%]" style={{ background: on ? "var(--dc-soft)" : undefined }}>
                  {on && inView && <span className="dcd-pop absolute z-10 rounded-md border px-1.5 text-xs font-semibold" style={{ bottom: `calc(${(d.billed / max) * 100}% + 6px)`, background: "var(--dc-card)", borderColor: "var(--dc-line)" }}>{inrK(d.billed)}</span>}
                  <span className="dcd-bar w-[40%] max-w-6 rounded-t-md" style={{ height: inView ? `${(d.billed / max) * 100}%` : 0, background: "var(--dc-solid)", transitionDelay: `${0.25 + i * 0.07}s` }} />
                  <span className="dcd-bar w-[40%] max-w-6 rounded-t-md" style={{ height: inView ? `${(d.collected / max) * 100}%` : 0, background: "repeating-linear-gradient(135deg,#3cbf5a 0 3px,#7fd694 3px 6px)", transitionDelay: `${0.32 + i * 0.07}s` }} />
                </button>
              );
            })}
          </div>
        </div>
        <span />
        <div className="mt-2 grid grid-cols-7">
          {week.map((d, i) => <span key={d.day} className="flex flex-col items-center text-center text-[13px] leading-tight" style={{ color: selected === i ? "var(--dc-ink)" : "var(--dc-sub)", fontWeight: selected === i ? 700 : 400 }}><span>{label(d, i).day}</span><span>{label(d, i).date}</span></span>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-3.5 text-sm" style={{ borderColor: "var(--dc-line2)", color: "var(--dc-sub)" }}>
        <span>7-day billed <strong style={{ color: "var(--dc-ink)" }}>{inr(totalB)}</strong></span>
        <span>Collected <strong style={{ color: "var(--dc-ink)" }}>{inr(totalC)}</strong> ({pct(totalC, totalB)}%)</span>
        <span>Still owed <strong style={{ color: "var(--dc-red-fg)" }}>{inr(Math.max(0, owedAll))}</strong></span>
      </div>
    </section>
  );
}

const callHref = (phone: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null);
/** Opens WhatsApp with the message ready to send. Nothing leaves until staff press send, and no provider is needed. */
function whatsappHref(phone: string | null, text: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(text)}`;
}
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function NeedsAttention({ live, shopName, financial, sectionRef, inView, flash, tab, setTab }: { live: LiveData; shopName: string; financial: boolean; sectionRef: (el: HTMLElement | null) => void; inView: boolean; flash: boolean; tab: "overdue" | "ready" | "dues"; setTab: (t: "overdue" | "ready" | "dues") => void }) {
  const { attention: a } = live;
  const tabs = [
    { key: "overdue" as const, label: "Overdue", color: "#b4471a", count: a.counts.overdue, viewAll: "/orders?view=overdue" },
    { key: "ready" as const, label: "Ready", color: "#3cbf5a", count: a.counts.ready, viewAll: "/orders?view=ready" },
    ...(financial ? [{ key: "dues" as const, label: "Dues", color: "#3d6fb5", count: a.counts.dues, viewAll: "/orders?view=unpaid" }] : []),
  ];
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  const items = a[current.key];
  const empty = { overdue: "No late orders. Well done.", ready: "Nothing is waiting to be collected.", dues: "No customer owes money." }[current.key];
  return (
    <section id="sec-att" ref={sectionRef} aria-labelledby="att-h" className={cx("dcd-card dcd-enter flex flex-col gap-4 p-[clamp(20px,2.5vw,24px)]", inView && "is-in")} style={{ boxShadow: flash ? "0 0 0 3px #b4471a" : undefined }}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="att-h" className="dcd-h text-[22px]">Needs attention</h2>
        <span className="rounded-full px-2.5 py-[3px] text-[13px] font-semibold" style={{ background: "var(--dc-soft)" }}>{a.counts.overdue + a.counts.ready + (financial ? a.counts.dues : 0)} open</span>
      </div>
      <div role="tablist" aria-label="Attention type" className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const on = t.key === current.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)} className="dcd-pill flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-semibold" style={{ background: on ? "var(--dc-solid)" : "var(--dc-card)", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)", borderColor: on ? "var(--dc-solid)" : "var(--dc-line)" }}>
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.label}
              <span className="rounded-full px-2 py-px text-[13px]" style={{ background: on ? "#3cbf5a" : "var(--dc-soft)", color: on ? "#151514" : "var(--dc-ink)" }}>{t.count}</span>
            </button>
          );
        })}
      </div>
      {current.key === "overdue" && items.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug" style={{ background: "var(--dc-red-bg)", borderColor: "#f3c9b4", color: "var(--dc-red-fg)" }}>
          <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#b4471a] text-[13px] font-bold text-white">!</span>
          <span><strong>High priority.</strong> These orders are past their promised date. Call the customer with a new time.</span>
        </div>
      )}
      <ul key={current.key} className="flex flex-col">
        {items.map((item, i) => {
          const isDue = current.key === "dues";
          const tag = current.key === "overdue" ? { icon: "!", text: `${item.days} day${item.days === 1 ? "" : "s"} late`, bg: "var(--dc-red-bg)", fg: "var(--dc-red-fg)" }
            : current.key === "ready" ? { icon: "✓", text: item.days ? `Waiting ${item.days} day${item.days === 1 ? "" : "s"}` : "Ready today", bg: "var(--dc-green-bg)", fg: "var(--dc-green-fg)" }
            : { icon: "₹", text: `${item.days} day${item.days === 1 ? "" : "s"} unpaid`, bg: "var(--dc-blue-bg)", fg: "var(--dc-blue-fg)" };
          const meta = isDue ? `${inr(item.balance ?? 0)} · ${item.invoices} invoice${item.invoices === 1 ? "" : "s"}`
            : [item.orderNumber, item.items, current.key === "ready" && item.balance != null ? (item.balance > 0 ? `${inr(item.balance)} due` : "paid") : null].filter(Boolean).join(" · ");
          const message = current.key === "ready"
            ? `${shopName}: Your order ${item.orderNumber} is ready for collection.${item.balance ? ` Balance ${inr(item.balance)}.` : ""}`
            : `${shopName}: A reminder that ${inr(item.balance ?? 0)} is due on your account. Thank you.`;
          const action = current.key === "overdue" ? { label: "Call now", href: callHref(item.phone), external: false } : { label: current.key === "ready" ? "Notify" : "Remind", href: whatsappHref(item.phone, message), external: true };
          const open = isDue ? `/customers/view?id=${item.customerId}` : `/orders/view?id=${item.id}`;
          return (
            <li key={item.id ?? item.customerId} className="dcd-pop flex items-center gap-3 border-t py-3" style={{ borderColor: "var(--dc-line2)", animationDelay: `${i * 0.05}s` }}>
              <span aria-hidden="true" className="dcd-h grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm" style={{ background: "var(--dc-soft)" }}>{initials(item.name)}</span>
              <Link href={open} className="flex min-w-0 flex-1 flex-col gap-[3px] hover:underline">
                <span className="truncate text-[15px] font-semibold">{item.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[13px] font-semibold" style={{ background: tag.bg, color: tag.fg }}><span aria-hidden="true">{tag.icon}</span>{tag.text}</span>
                  <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>{meta}</span>
                </span>
              </Link>
              {action.href ? (
                <a href={action.href} {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})} aria-label={`${action.label} ${item.name}`} className="dcd-lift inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-4 text-sm font-semibold" style={{ borderColor: "var(--dc-solid)", background: current.key === "overdue" ? "var(--dc-solid)" : "var(--dc-card)", color: current.key === "overdue" ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{action.label}</a>
              ) : <span className="shrink-0 text-xs" style={{ color: "var(--dc-sub)" }}>No phone</span>}
            </li>
          );
        })}
        {!items.length && <li className="border-t py-8 text-center text-sm" style={{ borderColor: "var(--dc-line2)", color: "var(--dc-sub)" }}><Check className="mx-auto mb-1 h-6 w-6 text-[#3cbf5a]" />{empty}</li>}
      </ul>
      {current.count > items.length && <Link href={current.viewAll} className="text-sm font-semibold underline underline-offset-4">See all {current.count}</Link>}
    </section>
  );
}

function RecentOrders({ live, financial, inView, sectionRef }: { live: LiveData; financial: boolean; inView: boolean; sectionRef: (el: HTMLElement | null) => void }) {
  return (
    <section ref={sectionRef} aria-labelledby="orders-h" className={cx("dcd-card dcd-enter overflow-hidden", inView && "is-in")}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-[clamp(20px,2.5vw,28px)] pb-4">
        <div><h2 id="orders-h" className="dcd-h text-[22px]">Recent orders</h2><p className="text-sm" style={{ color: "var(--dc-sub)" }}>Latest drop-offs</p></div>
        <Link href="/orders" className="dcd-pill inline-flex min-h-10 items-center gap-1 rounded-full border px-4 text-sm font-semibold" style={{ borderColor: "var(--dc-line)" }}>All orders <ArrowRight className="h-4 w-4" /></Link>
      </div>
      {!live.recentOrders.length ? <p className="px-7 pb-8 text-sm" style={{ color: "var(--dc-sub)" }}>No orders yet. <Link href="/pos" className="font-semibold underline">Create your first order</Link></p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead style={{ background: "var(--dc-soft)" }}><tr className="text-[13px] font-semibold">{["Order", "Customer", "Items", "Due", "Status", ...(financial ? ["Amount"] : [])].map((h) => <th key={h} className={cx("px-3 py-3 first:pl-5 last:pr-5", h === "Amount" && "text-right")}>{h}</th>)}</tr></thead>
            <tbody>
              {live.recentOrders.map((o) => (
                <tr key={o.id} className="dcd-row border-t" style={{ borderColor: "var(--dc-line2)" }}>
                  <td className="whitespace-nowrap py-3.5 pl-5 pr-3 font-semibold"><Link href={`/orders/view?id=${o.id}`} className="hover:underline">{o.orderNumber}</Link></td>
                  <td className="max-w-[130px] truncate px-3 py-3.5 font-medium" title={o.name}>{o.name}</td>
                  <td className="max-w-[120px] truncate px-3 py-3.5" style={{ color: "var(--dc-sub)" }} title={o.items ?? ""}>{o.items}</td>
                  <td className="whitespace-nowrap px-3 py-3.5" style={o.late ? { color: "var(--dc-red-fg)", fontWeight: 600 } : { color: "var(--dc-sub)" }}>{dateOnly(o.promisedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3.5">{o.late ? <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: "var(--dc-red-bg)", color: "var(--dc-red-fg)" }}>! Overdue</span> : <OrderStatusBadge status={o.status} />}</td>
                  {financial && <td className="whitespace-nowrap py-3.5 pl-3 pr-5 text-right font-semibold tabular-nums">{inr(o.total ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TodaysRoute({ stops, inView, sectionRef }: { stops: RouteStop[]; inView: boolean; sectionRef: (el: HTMLElement | null) => void }) {
  const done = stops.filter((s) => s.status === "completed").length;
  const nextIndex = stops.findIndex((s) => !["completed", "failed"].includes(s.status));
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? (nextIndex >= 0 ? nextIndex : stops.length - 1);
  const stop = stops[selected];
  const drivers = [...new Set(stops.map((s) => s.driver).filter(Boolean))];
  const start = (slot: string) => slot.split("-")[0];
  const state = (i: number) => (stops[i].status === "completed" ? "done" : stops[i].status === "failed" ? "failed" : i === nextIndex ? "next" : "todo");
  const labels = { done: "Done", failed: "Could not complete", next: "Next stop", todo: "Upcoming" };
  const dark = { color: "#faf8f4" };
  return (
    <section ref={sectionRef} aria-labelledby="route-h" className={cx("dcd-enter flex flex-col gap-4 rounded-3xl p-6", inView && "is-in")} style={{ background: "#151514", ...dark }}>
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="route-h" className="dcd-h text-[22px] text-[#faf8f4]">Today&apos;s route</h2><p className="text-sm text-[#cfccc4]">Pickups and deliveries{drivers.length === 1 ? ` · Rider: ${drivers[0]}` : drivers.length > 1 ? ` · ${drivers.length} riders` : ""}</p></div>
        {stops.length > 0 && <span className="whitespace-nowrap text-sm font-semibold">{done === stops.length ? `All ${done} done` : `${done} of ${stops.length} done`}</span>}
      </div>
      {!stops.length ? <p className="rounded-2xl p-5 text-center text-sm text-[#cfccc4]" style={{ background: "#262624" }}>No pickups or deliveries are scheduled for today.</p> : (
        <>
          <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full" style={{ background: "#353532" }}><span className="block h-full rounded-full" style={{ width: inView ? `${pct(done, stops.length)}%` : 0, background: "#3cbf5a", transition: "width 1s ease .3s" }} /></span>
          <div className="overflow-x-auto rounded-2xl p-4" style={{ background: "#1d1d1b" }}>
            <ol className="flex min-w-max items-start">
              {[{ store: true } as const, ...stops.map((s, i) => ({ store: false as const, s, i }))].map((n, idx) => {
                if (n.store) return <li key="store" className="flex w-[70px] flex-col items-center gap-1.5 text-center"><span className="relative z-[1] grid h-8 w-8 place-items-center rounded-full bg-[#faf8f4] text-[13px] font-bold text-[#151514]">S</span><span className="text-sm font-semibold">Store</span><span className="text-[13px] text-[#cfccc4]">Start</span></li>;
                const st = state(n.i);
                const on = selected === n.i;
                return (
                  <li key={n.s.id} className="relative flex w-[70px] flex-col items-center gap-1.5 text-center">
                    <span aria-hidden="true" className="absolute right-1/2 top-[15px] h-0.5 w-full" style={{ background: st === "todo" ? "repeating-linear-gradient(90deg,#6b6963 0 5px,transparent 5px 10px)" : st === "next" ? "#353532" : "#3cbf5a" }}>
                      {st === "next" && inView && <span title="Rider" className="absolute -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#3cbf5a] bg-[#faf8f4]" style={{ animation: "dcRide 6s linear infinite" }} />}
                    </span>
                    <button type="button" onClick={() => setPicked(n.i)} aria-pressed={on} aria-label={`Stop ${n.i + 1}: ${n.s.name}, ${n.s.kind} at ${start(n.s.slot)}, ${labels[st]}`} className="dcd-tile relative z-[1] grid h-8 w-8 cursor-pointer place-items-center rounded-full text-[13px] font-bold" style={{ background: st === "done" ? "#3cbf5a" : st === "failed" ? "#b4471a" : st === "next" ? "#faf8f4" : "#1d1d1b", color: st === "todo" ? "#faf8f4" : "#151514", border: st === "next" ? "3px solid #3cbf5a" : st === "todo" ? "2px solid #8a8780" : "0", outline: on ? "3px solid rgba(250,248,244,.55)" : "none", outlineOffset: 2 }}>{st === "done" ? "✓" : st === "failed" ? "!" : n.i + 1}</button>
                    <span className="max-w-[66px] truncate text-sm font-semibold">{n.s.name.split(/\s+/)[0]}</span>
                    <span className="text-[13px]" style={{ color: st === "next" ? "#faf8f4" : "#cfccc4", fontWeight: st === "next" ? 600 : 400 }}>{start(n.s.slot)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#cfccc4]">
            {[["#3cbf5a", "Done"], ["#faf8f4", "Next stop"], ["transparent", "Upcoming"], ["#b4471a", "Could not complete"]].map(([color, text]) => <span key={text} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-[#8a8780]" style={{ background: color }} />{text}</span>)}
          </div>
          {stop && (
            <div key={stop.id} className="dcd-pop flex items-center gap-3 rounded-2xl p-4" style={{ background: "#262624" }} aria-live="polite">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-[3px] border-[#3cbf5a] bg-[#faf8f4] text-sm font-bold text-[#151514]">{selected + 1}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">Stop {selected + 1} · {stop.name}</span><span className="block truncate text-sm text-[#cfccc4]">{stop.kind === "pickup" ? "Pickup" : "Delivery"}{stop.address?.area || stop.address?.city ? ` · ${stop.address.area || stop.address.city}` : ""}{stop.driver ? ` · ${stop.driver}` : ""}</span></span>
              <span className="flex flex-col items-end gap-1"><span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: state(selected) === "done" || state(selected) === "next" ? "#2d3a2f" : "#353532", color: state(selected) === "next" || state(selected) === "done" ? "#bfe9c9" : "#e4e1da" }}>{labels[state(selected)]}</span><span className="text-sm font-semibold">{start(stop.slot)}</span></span>
              {callHref(stop.phone) && <a href={callHref(stop.phone)!} aria-label={`Call ${stop.name}`} className="dcd-tile grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#6b6963]"><Phone className="h-4 w-4" /></a>}
            </div>
          )}
        </>
      )}
      <Link href="/deliveries" className="dcd-lift mt-auto flex min-h-12 items-center justify-center rounded-full border text-sm font-semibold text-[#faf8f4]" style={{ borderColor: "#faf8f4" }}>Schedule a stop</Link>
    </section>
  );
}

const METHOD_LABELS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", wallet: "Wallet", cheque: "Cheque" };

function BranchTable({ data }: { data: DashboardData }) {
  const rows = data.branches;
  const totalSales = rows.reduce((s, b) => s + b.billed + b.laundry, 0);
  if (!rows.length) return <p className="px-5 py-8 text-sm text-slate-500">No branch activity.</p>;
  const cell = "px-4 py-3 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">Branch</th>{["Orders", "Dry cleaning", "Self-service", "Collected", "Dues"].map((h) => <th key={h} className="px-4 py-3 text-right">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((b) => (
            <tr key={b.id} className="dcd-row">
              <td className="px-4 py-3">
                <span className="flex items-center gap-2 font-medium text-slate-800"><MapPin className="h-3.5 w-3.5 text-slate-400" />{b.name}</span>
                {rows.length > 1 && <span className="mt-1.5 block h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-600" style={{ width: `${totalSales ? ((b.billed + b.laundry) / totalSales) * 100 : 0}%` }} /></span>}
              </td>
              <td className={cx(cell, "text-slate-600")}>{b.orders}</td>
              <td className={cx(cell, "text-slate-700")}>{money(b.billed)}</td>
              <td className={cx(cell, "text-slate-700")}>{money(b.laundry)}</td>
              <td className={cx(cell, "font-semibold text-slate-900")}>{money(b.collected)}</td>
              <td className={cx(cell, b.outstanding > 0 ? "text-amber-700" : "text-slate-400")}>{money(b.outstanding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CounterTable({ data }: { data: DashboardData }) {
  const total = data.paymentMethods.reduce((s, m) => s + m.total, 0);
  const COLORS = ["#3cbf5a", "#3d6fb5", "#f08a24", "#8b5cf6", "#64748b"];
  return (
    <div>
      {data.paymentMethods.length > 0 && (
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">{data.paymentMethods.map((m, i) => <span key={m.method} style={{ width: `${(m.total / total) * 100}%`, background: COLORS[i % 5] }} />)}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{data.paymentMethods.map((m, i) => <span key={m.method} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % 5] }} />{METHOD_LABELS[m.method] ?? m.method} <strong className="tabular-nums text-slate-900">{money(m.total)}</strong></span>)}</div>
        </div>
      )}
      {!data.counters.length ? <p className="px-5 py-8 text-sm text-slate-500">No payments collected in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Counter / cashier</th>{["Cash", "UPI", "Card / other", "Total"].map((h) => <th key={h} className="px-4 py-3 text-right">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.counters.map((c) => (
                <tr key={`${c.branchId}-${c.userId}`} className="dcd-row">
                  <td className="px-4 py-3"><span className="block font-medium text-slate-800">{c.staffName}</span><span className="text-xs text-slate-500">{c.branchName} · {c.payments} payment{c.payments === 1 ? "" : "s"}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(c.cash)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(c.upi)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(c.card + c.other)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PERIODS: PeriodName[] = ["Today", "This week", "This month", "Quarter", "Custom"];

export default function DashboardPage() {
  const { session, branchId, branch, can, has } = useSession();
  const today = todayISO();
  const [period, setPeriod] = useState<PeriodName>("Today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [allBranches, setAllBranches] = useState(true);
  const [settingTargets, setSettingTargets] = useState(false);
  const [attTab, setAttTab] = useState<"overdue" | "ready" | "dues">("overdue");
  const [chartDay, setChartDay] = useState(6);
  const [flash, setFlash] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => { const t = setTimeout(() => setEntered(true), 80); return () => clearTimeout(t); }, []);

  const branchQuery: Record<string, string> = !allBranches && branchId ? { branchId } : {};
  const range = useMemo(() => (period === "Custom"
    ? { from: customFrom, to: customTo, compareFrom: undefined, compareTo: undefined, cmp: "the days before" }
    : periodRange(period, today)), [period, customFrom, customTo, today]);
  const qs = new URLSearchParams({ from: range.from, to: range.to, ...(range.compareFrom ? { compareFrom: range.compareFrom, compareTo: range.compareTo! } : {}), ...branchQuery });
  const { data, error, reload: reloadData } = useApi<DashboardData>(`/dashboard?${qs}`);
  const liveQ = useApi<LiveData>(`/dashboard/live?${new URLSearchParams(branchQuery)}`);
  const members = useApi<{ current: number; expiring: number }>(has("customerMemberships") && can("customers.read") ? "/customer-memberships/summary" : null);
  const live = liveQ.data;
  const reloadLive = liveQ.reload;

  // Keeps itself current through the day. Numbers change without rolling up again.
  useEffect(() => { if (live) setUpdated(new Date()); }, [live]);
  useEffect(() => {
    const timer = setInterval(() => { void reloadLive(); void reloadData(); }, 60_000);
    return () => clearInterval(timer);
  }, [reloadLive, reloadData]);

  const firstName = session.user.name.trim().split(/\s+/)[0] || "there";
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  const clock = updated ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(updated) : "";

  const lineEl = useEnter();
  const kpiEl = useEnter();
  const chartEl = useEnter();
  const attEl = useEnter();
  const ordersEl = useEnter();
  const routeEl = useEnter();

  const glide = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(id);
    setTimeout(() => setFlash(""), 1800);
  }, []);

  const count = useCountUp(`${period}:${range.from}:${range.to}`, !!data && kpiEl.inView);
  const canOrders = can("orders.read");
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  const change = (now: number, before: number | undefined) => (before ? Math.round(((now - before) / before) * 100) : null);

  const counts = Object.fromEntries((live?.production.stages ?? []).map((s) => [s.stage, s.count]));
  const lineTotal = STAGES.reduce((sum, s) => sum + (counts[s.key] ?? 0), 0);
  const finished = (counts.ready ?? 0) + (counts.delivered ?? 0);
  const inStore = lineTotal - (counts.delivered ?? 0);
  const todayRow = live?.trend[live.trend.length - 1];
  const owedToday = todayRow ? Math.max(0, todayRow.billed - todayRow.collected) : 0;
  const financial = !!data?.financialVisible;
  const targets = live?.targets ?? {};

  const kpis: KpiCell[] = useMemo(() => {
    if (!data || !live) return [];
    const spark = (pick: (d: LiveData["trend"][number]) => number) => live.trend.map(pick);
    const garmentsTarget = targets.garmentsPerDay ? targets.garmentsPerDay * days : 0;
    const handledNote = data.garments.avgTurnaroundDays === null ? "None delivered yet" : data.garments.avgTurnaroundDays < 0.1 ? "Same-day turnaround" : `avg ${data.garments.avgTurnaroundDays.toFixed(1)} days turnaround`;
    const noTarget = "Not set yet";
    if (data.sales && data.collections && data.receivables) {
      const billingTarget = targets.billingPerDay ? targets.billingPerDay * days : 0;
      const billed = data.sales.grossBilled;
      return [
        { label: "Billed", def: "Total invoiced to customers", value: inr(billed * count), big: true, key: "var(--dc-solid)", delta: change(billed, data.previous.grossBilled), cmp: range.cmp, note: `${data.operations.orders_received} order${data.operations.orders_received === 1 ? "" : "s"}`, ring: billingTarget ? pct(billed, billingTarget) : null, target: billingTarget ? `of ${inr(billingTarget)} billing target` : noTarget, spark: spark((d) => d.billed), href: can("reports.financial") ? "/reports" : undefined },
        { label: "Collected", def: "Payments received · cash, UPI, card", value: inr(data.collections.net * count), big: true, key: "var(--dc-green)", delta: change(data.collections.net, data.previous.collections), cmp: range.cmp, note: billed ? `${pct(data.collections.net, billed)}% of billed` : "Nothing billed yet", ring: billed ? pct(data.collections.net, billed) : null, target: billed ? "of billed amount collected" : "Shows once something is billed", spark: spark((d) => d.collected), href: can("payments.collect") ? "/cashier" : undefined },
        { label: "Outstanding dues", def: "Billed but not yet paid, as of now", value: inr(data.receivables.outstanding * count), big: false, key: "var(--dc-blue)", delta: null, cmp: range.cmp, note: `${data.receivables.openInvoices} unpaid invoice${data.receivables.openInvoices === 1 ? "" : "s"}`, ring: targets.duesLimit ? pct(data.receivables.outstanding, targets.duesLimit) : null, target: targets.duesLimit ? `of ${inr(targets.duesLimit)} limit · lower is better` : noTarget, spark: spark((d) => Math.max(0, d.billed - d.collected)), href: canOrders ? "/orders?view=unpaid" : undefined },
        { label: "Garments handled", def: "Received or delivered in this period", value: Math.round(data.garments.handled * count).toLocaleString("en-IN"), big: false, key: "var(--dc-grey)", delta: change(data.garments.handled, data.previous.garments), cmp: range.cmp, note: handledNote, ring: garmentsTarget ? pct(data.garments.handled, garmentsTarget) : null, target: garmentsTarget ? `of ${garmentsTarget.toLocaleString("en-IN")} garment capacity used` : noTarget, spark: spark((d) => d.garments), href: canOrders ? "/tags" : undefined },
      ];
    }
    const n = (v: number) => Math.round(v * count).toLocaleString("en-IN");
    return [
      { label: "Orders received", def: "Booked in this period", value: n(data.operations.orders_received), big: true, key: "var(--dc-solid)", delta: change(data.operations.orders_received, data.previous.orders), cmp: range.cmp, note: "", ring: null, target: "No target", spark: [], href: canOrders ? "/orders" : undefined },
      { label: "Garments handled", def: "Received or delivered in this period", value: n(data.garments.handled), big: true, key: "var(--dc-grey)", delta: change(data.garments.handled, data.previous.garments), cmp: range.cmp, note: handledNote, ring: garmentsTarget ? pct(data.garments.handled, garmentsTarget) : null, target: garmentsTarget ? `of ${garmentsTarget.toLocaleString("en-IN")} garment capacity used` : noTarget, spark: spark((d) => d.garments), href: canOrders ? "/tags" : undefined },
      { label: "Ready to collect", def: "Orders waiting for handoff", value: n(data.operations.ready_orders), big: false, key: "var(--dc-green)", delta: null, cmp: range.cmp, note: `${data.operations.ready_garments} garments on racks`, ring: null, target: "No target", spark: [], href: canOrders ? "/orders?view=ready" : undefined },
      { label: "Overdue orders", def: "Past their promised date", value: n(data.operations.overdue_orders), big: false, key: "var(--dc-red-fg)", delta: null, cmp: range.cmp, note: `${data.operations.exceptions} garment exceptions`, ring: null, target: "No target", spark: [], href: canOrders ? "/orders?view=overdue" : undefined },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, live, count, days, range.cmp]);

  const extras: [string, string, string | undefined][] = data ? [
    ...(data.sales ? [["Net sales (before GST)", money(data.sales.netSales), "/reports"], ["GST billed", money(data.sales.tax), "/reports"], ["Discounts given", money(data.sales.discounts), "/reports"]] as [string, string, string][] : []),
    ...(data.expenses !== null ? [["Expenses", money(data.expenses), can("expenses.manage") ? "/expenses" : undefined]] as [string, string, string | undefined][] : []),
    ...(data.collections ? [["Refunds", money(data.collections.refunded), undefined]] as [string, string, undefined][] : []),
    ...(data.laundry && has("laundry") ? [["Self-service sales", money(data.laundry.billed), "/laundry/reports"]] as [string, string, string][] : []),
    ["Quality rework", `${(data.operations.reworkRate * 100).toFixed(1)}%`, undefined],
    ...(members.data ? [["Current members", String(members.data.current), "/memberships"], ["Memberships ending soon", String(members.data.expiring), "/memberships"]] as [string, string, string][] : []),
  ] : [];

  const quick: { href: string; icon: typeof Plus; label: string }[] = [
    can("orders.create") && { href: "/pos", icon: Plus, label: "New order" },
    can("garments.process") && { href: "/scan", icon: ScanLine, label: "Scan a garment" },
    canOrders && { href: "/tags", icon: Barcode, label: "Tag tracking" },
    can("customers.read") && { href: "/customers", icon: Users, label: "Find a customer" },
    can("deliveries.manage") && has("deliveries") && { href: "/deliveries", icon: Truck, label: "Schedule a stop" },
    can("payments.collect") && { href: "/cashier", icon: Wallet, label: "Cashier & shift" },
    can("laundry.operate") && has("laundry") && { href: "/laundry/new", icon: WashingMachine, label: "Self-service order" },
    has("customerMemberships") && can("customers.read") && { href: "/memberships", icon: Crown, label: "Memberships" },
    canOrders && { href: "/production", icon: Factory, label: "Production board" },
  ].filter(Boolean) as { href: string; icon: typeof Plus; label: string }[];

  const multiBranch = session.branches.length > 1;
  return (
    <div className="dcd mx-auto flex max-w-[1400px] flex-col gap-7 pb-8">
      {/* Greeting */}
      <section className={cx("dcd-enter flex flex-wrap items-end justify-between gap-5", entered && "is-in")}>
        <div className="flex flex-wrap items-center gap-5">
          <Ring size={88} stroke={8} value={pct(finished, lineTotal)} color="var(--dc-green)" show={entered && !!live} label={`${finished} of ${lineTotal} garments finished today, ${pct(finished, lineTotal)} percent`}>
            <span className="dcd-h text-[22px]">{pct(finished, lineTotal)}%</span><span className="text-xs" style={{ color: "var(--dc-sub)" }}>done</span>
          </Ring>
          <div className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2.5 text-sm" style={{ color: "var(--dc-sub)" }}>{dateLabel}{clock && <><span aria-hidden="true">·</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#3cbf5a]" />Updated {clock}</span></>}</span>
            <h1 className="dcd-h text-[clamp(28px,3vw,36px)] leading-[1.15]">{greeting}, {firstName}</h1>
            <span className="text-base" style={{ color: "var(--dc-sub)" }}><strong style={{ color: "var(--dc-ink)" }}>{finished} of {lineTotal}</strong> garments finished today. The ring shows today&apos;s progress.</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {can("garments.process") && <Link href="/scan" className="dcd-lift inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] px-[22px] text-[15px] font-semibold" style={{ borderColor: "var(--dc-solid)", background: "var(--dc-card)" }}><ScanLine className="h-[18px] w-[18px]" />Scan garment</Link>}
          {can("orders.create") && <Link href="/pos" className="dcd-lift inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-[#3cbf5a] bg-[#3cbf5a] px-[22px] text-[15px] font-semibold text-[#151514]"><Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />New order</Link>}
        </div>
      </section>

      {live && (
        <section aria-label="Today at a glance" className={cx("dcd-enter grid gap-3 md:grid-cols-3", entered && "is-in")} style={{ transitionDelay: ".05s" }}>
          <GlanceCard value={inStore} label="garments in store" sub="Open production line" tone="plain" icon={<Shirt className="h-4 w-4" />} onClick={() => glide("sec-line")} />
          {canOrders && <GlanceCard value={live.production.lateOrders} label={live.production.lateOrders === 1 ? "order late" : "orders late"} sub="See late orders" tone="red" icon="!" onClick={() => { setAttTab("overdue"); glide("sec-att"); }} />}
          {financial && <GlanceCard value={inr(owedToday)} label="still owed today" sub="Open billing graph" tone="blue" icon={<IndianRupee className="h-4 w-4" />} onClick={() => { setChartDay(6); glide("sec-chart"); }} />}
        </section>
      )}

      {error && <Alert>{error.message}</Alert>}
      {liveQ.error && <Alert>{liveQ.error.message}</Alert>}
      {!data || !live ? (!error && !liveQ.error && <Spinner />) : (
        <>
          {/* Period numbers */}
          <section ref={kpiEl.ref} aria-labelledby="kpi-h" className={cx("dcd-enter overflow-hidden rounded-3xl border-[1.5px]", kpiEl.inView && "is-in")} style={{ background: "var(--dc-card)", borderColor: "var(--dc-solid)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5" style={{ borderColor: "var(--dc-line2)" }}>
              <h2 id="kpi-h" className="text-[15px] font-semibold" style={{ fontFamily: "inherit" }}>Showing <span className="dcd-h">{period === "Custom" ? `${dateOnly(range.from)} to ${dateOnly(range.to)}` : period.toLowerCase()}</span> <span className="font-normal" style={{ color: "var(--dc-sub)" }}>· compared with {range.cmp}</span></h2>
              <div className="flex flex-wrap items-center gap-2">
                {multiBranch && (
                  <div className="flex gap-1 rounded-full p-1" style={{ background: "var(--dc-soft)" }}>
                    {[[true, "All branches"], [false, branch?.name ?? "This branch"]].map(([all, name]) => <button key={String(all)} type="button" onClick={() => setAllBranches(all as boolean)} aria-pressed={allBranches === all} className="dcd-pill min-h-10 cursor-pointer rounded-full px-3.5 text-sm font-semibold" style={{ background: allBranches === all ? "var(--dc-solid)" : "transparent", color: allBranches === all ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{name as string}</button>)}
                  </div>
                )}
                <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1 rounded-full p-1" style={{ background: "var(--dc-soft)" }}>
                  {PERIODS.map((p) => {
                    const on = period === p;
                    return <button key={p} type="button" role="radio" aria-checked={on} onClick={() => setPeriod(p)} className="dcd-pill flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold" style={{ background: on ? "var(--dc-solid)" : "transparent", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{on && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#3cbf5a]" />}{p}</button>;
                  })}
                </div>
                {can("org.manage") && <button type="button" onClick={() => setSettingTargets(true)} title="Set your targets" className="dcd-pill inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold" style={{ borderColor: "var(--dc-line)" }}><Target className="h-4 w-4" />Targets</button>}
              </div>
            </div>
            {period === "Custom" && (
              <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm" style={{ borderColor: "var(--dc-line2)" }}>
                <Input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="w-auto" aria-label="From date" />
                <span>to</span>
                <Input type="date" value={customTo} min={customFrom} max={IST_DAY(new Date())} onChange={(e) => setCustomTo(e.target.value)} className="w-auto" aria-label="To date" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map((k, i) => <Kpi key={k.label} k={k} index={i} show={kpiEl.inView} columns={cx("sm:border-t-0 xl:border-l", i % 2 === 1 && "sm:border-l", i >= 2 && "sm:border-t xl:border-t-0", i === 0 && "xl:border-l-0")} />)}
            </div>
          </section>

          <ProductionLine live={live} inView={lineEl.inView} sectionRef={lineEl.ref} flash={flash === "sec-line"} canOrders={canOrders} />

          {(financial || canOrders) && (
            <div className={cx("grid items-start gap-6", financial && canOrders && "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
              {financial && <BilledChart trend={live.trend} inView={chartEl.inView} selected={chartDay} setSelected={setChartDay} sectionRef={chartEl.ref} flash={flash === "sec-chart"} />}
              {canOrders && <NeedsAttention live={live} shopName={session.organization.name} financial={financial} sectionRef={attEl.ref} inView={attEl.inView} flash={flash === "sec-att"} tab={attTab} setTab={setAttTab} />}
            </div>
          )}

          {(canOrders || live.route) && (
            <div className={cx("grid items-start gap-6", canOrders && live.route && "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
              {canOrders && <RecentOrders live={live} financial={financial} inView={ordersEl.inView} sectionRef={ordersEl.ref} />}
              {live.route && <TodaysRoute stops={live.route} inView={routeEl.inView} sectionRef={routeEl.ref} />}
            </div>
          )}

          {/* Everything else an owner checks: added to the design so nothing from the old dashboard is lost. */}
          <section aria-label="More numbers" className="dcd-card p-[clamp(20px,2.5vw,24px)]">
            <h2 className="dcd-h text-[22px]">More numbers</h2>
            <p className="text-sm" style={{ color: "var(--dc-sub)" }}>For the same period, unless the name says otherwise.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {extras.map(([label, value, href]) => {
                const inner = <><span className="block text-[13px]" style={{ color: "var(--dc-sub)" }}>{label}</span><span className="dcd-h mt-0.5 block text-xl tabular-nums">{value}</span></>;
                const cls = "block rounded-[14px] border p-3";
                return href ? <Link key={label} href={href} className={cx(cls, "dcd-lift")} style={{ borderColor: "var(--dc-line)" }}>{inner}</Link> : <div key={label} className={cls} style={{ borderColor: "var(--dc-line)" }}>{inner}</div>;
              })}
            </div>
            {quick.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: "var(--dc-line2)" }}>
                {quick.map((q) => <Link key={q.href} href={q.href} className="dcd-pill inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold" style={{ borderColor: "var(--dc-line)" }}><q.icon className="h-4 w-4" />{q.label}</Link>)}
                {can("org.manage") && <Link href="/settings" className="dcd-pill inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold" style={{ borderColor: "var(--dc-line)" }}><Settings2 className="h-4 w-4" />Business settings</Link>}
              </div>
            )}
          </section>

          {financial && (
            <section className="grid gap-5 2xl:grid-cols-2 [&>*]:min-w-0">
              <Card padded={false} title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-500" />Sales by branch</span>}><BranchTable data={data} /></Card>
              <Card padded={false} title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-slate-500" />Counter-wise takings</span>} actions={can("payments.collect") ? <Link href="/cashier" className="text-xs font-semibold text-brand-700 hover:underline">Cashier & shifts</Link> : undefined}><CounterTable data={data} /></Card>
            </section>
          )}
          {settingTargets && <Targets current={targets} onClose={() => setSettingTargets(false)} onSaved={() => { setSettingTargets(false); void reloadLive(); }} />}
        </>
      )}
    </div>
  );
}
