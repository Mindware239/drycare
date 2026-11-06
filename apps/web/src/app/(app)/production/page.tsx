"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, LayoutGrid, RefreshCw, Search, X } from "lucide-react";
import { STAGE_LABELS, allowedTransitions, type GarmentStage } from "@drycare/shared";
import { SlideGroup } from "@/components/SlideGroup";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { appLocale, appZone } from "@/lib/format";
import { Alert, Spinner, cx } from "@/components/ui";

type Row = {
  id: string; tag_code: string; current_status: GarmentStage; version: number; workflow_stages: GarmentStage[]; location: string;
  assigned_user_id: string | null; storage_location_id: string | null; order_id: string; order_number: string; promised_at: string;
  express: boolean; customer_name: string; garment_type_name: string; service_name: string; colour: string | null;
  storage_code: string | null; assigned_to: string | null; overdue: boolean; stage_since: string | null;
};
type Staff = { userId: string; name: string; role?: string };
type Rack = { id: string; code: string; name?: string };
type Kpi = "production" | "overdue" | "ready" | "attention" | "away";
type Flag = "overdue" | "express" | "rework" | "issue" | "away";

/** Each service follows its own steps. The board groups them into five lanes, so every shop reads it the same way. */
const LANES: { label: string; stages: GarmentStage[]; dot: string }[] = [
  { label: "Received", stages: ["received", "inspection", "sorting"], dot: "#8a8780" },
  { label: "Cleaning", stages: ["cleaning", "drying"], dot: "#3d6fb5" },
  { label: "Finishing", stages: ["finishing", "rework"], dot: "#3d6fb5" },
  { label: "Quality check", stages: ["quality_control", "exception"], dot: "#b8860b" },
  { label: "Ready", stages: ["packing", "ready"], dot: "var(--dc-green)" },
];
const laneOf = (s: GarmentStage) => LANES.findIndex((l) => l.stages.includes(s));
const PER_LANE = 3;
const PER_LANE_NARROW = 6;
const isAway = (g: Row) => Boolean(g.location) && !["shop_counter", "shop_storage"].includes(g.location);
const isDoneStage = (s: GarmentStage) => s === "ready";
const isLate = (g: Row) => g.overdue && !isDoneStage(g.current_status);

/** The next production step that can be taken right from the board. */
function nextStep(g: Row): GarmentStage | null {
  return allowedTransitions(g.workflow_stages, g.current_status).find((t) => t.kind === "advance" || t.kind === "rework_return")?.to ?? null;
}

function since(iso: string | null) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d`;
}

function dueText(g: Row) {
  const due = new Date(g.promised_at);
  const when = due.toLocaleString(appLocale(), { timeZone: appZone(), day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if (!isLate(g)) return g.current_status === "ready" ? `Ready · was due ${when}` : when;
  const mins = Math.round((Date.now() - due.getTime()) / 60_000);
  const late = mins >= 1440 ? `${Math.floor(mins / 1440)} day${mins >= 2880 ? "s" : ""} late` : mins >= 60 ? `${Math.floor(mins / 60)}h late` : `${mins}m late`;
  return `${late} · ${when}`;
}

const sameDay = (iso: string, offset: number) => {
  const zone = appZone();
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: zone });
  return day(new Date(iso)) === day(new Date(Date.now() + offset * 86_400_000));
};

export default function ProductionPage() {
  const { branchId, branch, session, can } = useSession();
  const { data, error, loading, reload } = useApi<Row[]>(`/production/queues?branchId=${branchId}`);
  const canWork = can("garments.process");
  const staff = useApi<Staff[]>(canWork ? `/production/staff?branchId=${branchId}` : null);
  const racks = useApi<Rack[]>(canWork ? `/storage-locations?branchId=${branchId}` : null);
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("all");
  const [service, setService] = useState("all");
  const [person, setPerson] = useState("all");
  const [due, setDue] = useState("any");
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [flags, setFlags] = useState<Partial<Record<Flag, boolean>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "green" | "amber" | "red"; text: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState(0);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  // Screens are left open on the shop floor, so the board keeps itself current.
  useEffect(() => {
    const timer = setInterval(() => { if (!busy) reload(); }, 30_000);
    return () => clearInterval(timer);
  }, [busy, reload]);
  useEffect(() => { if (data) setUpdatedAt(new Date()); }, [data]);

  const all = useMemo(() => data ?? [], [data]);
  const count = {
    production: all.filter((g) => g.current_status !== "ready").length,
    overdue: all.filter(isLate).length,
    ready: all.filter((g) => g.current_status === "ready").length,
    attention: all.filter((g) => g.current_status === "rework" || g.current_status === "exception").length,
    away: all.filter(isAway).length,
  };
  const services = useMemo(() => [...new Set(all.map((g) => g.service_name))].sort(), [all]);
  const q = query.trim().toLocaleLowerCase();
  const rows = all.filter((g) => {
    if (q && ![g.tag_code, g.order_number, g.garment_type_name, g.colour, g.service_name, g.customer_name, g.storage_code, g.assigned_to].some((v) => String(v ?? "").toLocaleLowerCase().includes(q))) return false;
    if (lane !== "all" && laneOf(g.current_status) !== Number(lane)) return false;
    if (service !== "all" && g.service_name !== service) return false;
    if (person === "me" && g.assigned_user_id !== session.user.id) return false;
    if (person === "none" && g.assigned_user_id) return false;
    if (!["all", "me", "none"].includes(person) && g.assigned_user_id !== person) return false;
    if (due === "overdue" && !isLate(g)) return false;
    if (due === "today" && !sameDay(g.promised_at, 0)) return false;
    if (due === "tomorrow" && !sameDay(g.promised_at, 1)) return false;
    if (kpi === "production" && g.current_status === "ready") return false;
    if (kpi === "overdue" && !isLate(g)) return false;
    if (kpi === "ready" && g.current_status !== "ready") return false;
    if (kpi === "attention" && !["rework", "exception"].includes(g.current_status)) return false;
    if (kpi === "away" && !isAway(g)) return false;
    if (flags.overdue && !isLate(g)) return false;
    if (flags.express && !g.express) return false;
    if (flags.rework && g.current_status !== "rework") return false;
    if (flags.issue && g.current_status !== "exception") return false;
    if (flags.away && !isAway(g)) return false;
    return true;
  });
  const filtered = Boolean(q || lane !== "all" || service !== "all" || person !== "all" || due !== "any" || kpi || Object.values(flags).some(Boolean));
  const clearAll = () => { setQuery(""); setLane("all"); setService("all"); setPerson("all"); setDue("any"); setKpi(null); setFlags({}); setPages({}); };

  const flagChips: { key: Flag; label: string; n: number; tone: string }[] = [
    { key: "overdue", label: "Overdue", n: count.overdue, tone: "var(--dc-red-bg)" },
    { key: "express", label: "Express", n: all.filter((g) => g.express).length, tone: "var(--dc-amber-bg, #fdf3e1)" },
    { key: "rework", label: "Rework", n: all.filter((g) => g.current_status === "rework").length, tone: "var(--dc-amber-bg, #fdf3e1)" },
    { key: "issue", label: "Issue", n: all.filter((g) => g.current_status === "exception").length, tone: "var(--dc-red-bg)" },
    { key: "away", label: "Away", n: count.away, tone: "var(--dc-soft)" },
  ];
  const active: { label: string; clear: () => void }[] = [
    ...(lane !== "all" ? [{ label: `Stage: ${LANES[Number(lane)].label}`, clear: () => setLane("all") }] : []),
    ...(service !== "all" ? [{ label: `Service: ${service}`, clear: () => setService("all") }] : []),
    ...(person !== "all" ? [{ label: person === "me" ? "My work" : person === "none" ? "Unassigned" : `Staff: ${staff.data?.find((s) => s.userId === person)?.name ?? ""}`, clear: () => setPerson("all") }] : []),
    ...(due !== "any" ? [{ label: due === "overdue" ? "Due: overdue" : due === "today" ? "Due: today" : "Due: tomorrow", clear: () => setDue("any") }] : []),
    ...(q ? [{ label: `Search: ${query.trim()}`, clear: () => setQuery("") }] : []),
  ];

  // Shift insights, from what is on the board now.
  const queues = LANES.slice(0, 4).map((l, i) => {
    const inLane = all.filter((g) => laneOf(g.current_status) === i);
    const avg = inLane.length ? inLane.reduce((n, g) => n + (g.stage_since ? Date.now() - new Date(g.stage_since).getTime() : 0), 0) / inLane.length : 0;
    return { label: l.label, n: inLane.length, avg };
  });
  const bottleneck = [...queues].sort((a, b) => b.n - a.n)[0];
  const workload = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of all) if (g.current_status !== "ready" && g.assigned_to) map.set(g.assigned_to, (map.get(g.assigned_to) ?? 0) + 1);
    return [...map].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [all]);
  const unassigned = all.filter((g) => g.current_status !== "ready" && !g.assigned_to).length;
  const rackUse = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of all) if (g.storage_code) map.set(g.storage_code, (map.get(g.storage_code) ?? 0) + 1);
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [all]);
  const readyToday = all.filter((g) => g.current_status === "ready" && g.stage_since && sameDay(g.stage_since, 0)).length;

  const picked = all.filter((g) => selected.has(g.id));
  const pickedMovable = picked.filter((g) => nextStep(g));
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleLane = (items: Row[]) => setSelected((cur) => {
    const n = new Set(cur);
    const everyOne = items.every((g) => n.has(g.id));
    for (const g of items) if (everyOne) n.delete(g.id); else n.add(g.id);
    return n;
  });

  /** Runs one change per garment, and says which ones it could not do. */
  async function forEach(list: Row[], change: (g: Row) => Promise<unknown>, done: (n: number) => string) {
    setBusy(true);
    setResult(null);
    let moved = 0;
    const problems: string[] = [];
    for (const g of list) {
      try {
        await change(g);
        moved++;
      } catch (e) {
        problems.push(`${g.tag_code}: ${(e as ApiError).message}`);
      }
    }
    setSelected(new Set());
    setResult({ tone: problems.length ? (moved ? "amber" : "red") : "green", text: `${done(moved)}${problems.length ? ` ${problems.slice(0, 3).join("; ")}` : ""}` });
    setBusy(false);
    reload();
  }
  const advance = (g: Row) => { const to = nextStep(g); if (to) return api(`/garments/${g.id}/transitions`, { body: { to, version: g.version } }); return Promise.reject(new Error("needs the scan station")); };
  const moveOne = (g: Row) => void forEach([g], advance, () => `${g.tag_code} moved to ${STAGE_LABELS[nextStep(g)!]}.`);
  const moveSelected = () => void forEach(pickedMovable, advance, (n) => `${n} garment${n === 1 ? "" : "s"} moved.`);
  const assignSelected = (userId: string) => void forEach(picked, (g) => api(`/garments/${g.id}/assignments`, { body: { userId: userId === "none" ? null : userId, version: g.version } }), (n) => `${n} garment${n === 1 ? "" : "s"} ${userId === "none" ? "unassigned" : `assigned to ${staff.data?.find((s) => s.userId === userId)?.name ?? "staff"}`}.`);
  const rackSelected = (id: string) => void forEach(picked, (g) => api(`/garments/${g.id}/storage-location`, { body: { storageLocationId: id } }), (n) => `${n} garment${n === 1 ? "" : "s"} moved to rack ${racks.data?.find((r) => r.id === id)?.code ?? ""}.`);

  const kpis: { key: Kpi; label: string; value: number; hint: string; icon: React.ReactNode; bg: string; fg: string; danger?: boolean }[] = [
    { key: "production", label: "In production", value: count.production, hint: "Not yet ready", icon: <LayoutGrid className="h-3.5 w-3.5" />, bg: "#d8e7fa", fg: "#2a4f86" },
    { key: "overdue", label: "Overdue", value: count.overdue, hint: "Past promised time", icon: <Clock3 className="h-3.5 w-3.5" />, bg: "var(--dc-red-bg)", fg: "var(--dc-red-fg)", danger: count.overdue > 0 },
    { key: "ready", label: "Ready for pickup", value: count.ready, hint: "Awaiting handover", icon: <Check className="h-3.5 w-3.5" />, bg: "var(--dc-green-bg)", fg: "var(--dc-green-fg)" },
    { key: "attention", label: "Needs attention", value: count.attention, hint: "Rework or exception", icon: <CircleAlert className="h-3.5 w-3.5" />, bg: "#fdf3e1", fg: "#8a5a00" },
    { key: "away", label: "Away from shop", value: count.away, hint: "At an external facility", icon: <ArrowLeftRight className="h-3.5 w-3.5" />, bg: "var(--dc-soft)", fg: "var(--dc-ink)" },
  ];
  const lanesShown = narrow ? [tab] : LANES.map((_, i) => i);
  const perLane = narrow ? PER_LANE_NARROW : PER_LANE;
  const selectClass = "h-11 rounded-xl border bg-[var(--dc-card)] px-3 text-sm";
  const selectStyle = { borderColor: "var(--dc-line)", color: "var(--dc-ink)" };

  return (
    <div className="dcd flex flex-col gap-[18px] pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-1">
          <h1 className="dcd-h text-[34px] leading-tight">Production board</h1>
          <p className="text-[15px]" style={{ color: "var(--dc-sub)" }}>{`Every garment in work at ${branch?.name ?? "your branch"}, by stage. Each service follows its own steps.`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-semibold">{`Working as ${session.user.name}`}</span>
          <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: "var(--dc-soft)" }}>{session.role.name}</span>
          <button type="button" onClick={reload} disabled={loading && Boolean(data)} className="dc-press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-semibold" style={{ borderColor: "var(--dc-solid)" }}>
            <RefreshCw className={cx("h-4 w-4", loading && data && "animate-spin")} />Refresh
          </button>
          {canWork && <Link href="/scan" className="dc-press inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold" style={{ background: "var(--dc-green)", color: "#151514" }}>Open scan station</Link>}
        </div>
      </div>
      <p role="status" className="-mt-2 text-[13px]" style={{ color: "var(--dc-sub)" }}>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString(appLocale(), { timeZone: appZone(), hour: "numeric", minute: "2-digit" })} · refreshes by itself every 30 seconds` : "Loading production board…"}</p>

      {error && <Alert>{error.message}</Alert>}
      {result && <Alert tone={result.tone} onClose={() => setResult(null)}>{result.text}</Alert>}
      {loading && !data ? <Spinner /> : (
        <>
          <div role="group" aria-label="Production summary" className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(176px,1fr))" }}>
            {kpis.map((k) => (
              <button key={k.key} type="button" aria-pressed={kpi === k.key} onClick={() => setKpi(kpi === k.key ? null : k.key)} className="dc-press flex cursor-pointer flex-col gap-1.5 rounded-2xl border-[1.5px] px-[18px] py-4 text-start transition-colors" style={{ borderColor: kpi === k.key ? "var(--dc-solid)" : "var(--dc-line)", background: kpi === k.key ? "var(--dc-solid)" : "var(--dc-card)", color: kpi === k.key ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">{k.label}<span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: k.bg, color: k.fg }}>{k.icon}</span></span>
                <span className="dcd-h text-[34px] leading-none tabular-nums" style={{ color: k.danger && kpi !== k.key ? "var(--dc-red-fg)" : undefined }}>{k.value}</span>
                <span className="text-[13px] opacity-80">{k.hint}</span>
              </button>
            ))}
          </div>

          <details className="dcd-card rounded-2xl px-4 py-1" style={{ borderRadius: 16 }}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[15px] font-bold"><span>Shift insights</span><span className="text-[13px] font-medium" style={{ color: "var(--dc-sub)" }}>{`${readyToday} ready today · ${all.filter((g) => g.current_status === "rework").length} in rework`}</span></summary>
            <div className="grid gap-4 pb-3.5 pt-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <div className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: "var(--dc-sub)" }}>Bottleneck</span><span className="text-[15px] font-semibold">{bottleneck?.n ? bottleneck.label : "No queue"}</span><span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>{bottleneck?.n ? `${bottleneck.n} garments · about ${since(new Date(Date.now() - bottleneck.avg).toISOString())} at this stage` : "Nothing waiting"}</span></div>
              <div className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: "var(--dc-sub)" }}>Staff workload (open garments)</span>
                {workload.map(([name, n]) => <div key={name} className="grid items-center gap-2 text-[13px]" style={{ gridTemplateColumns: "88px 1fr 28px" }}><span className="truncate">{name}</span><span aria-hidden="true" className="h-2 overflow-hidden rounded" style={{ background: "var(--dc-soft)" }}><span className="block h-full rounded" style={{ width: `${Math.round((n / workload[0][1]) * 100)}%`, background: "var(--dc-solid)" }} /></span><span className="text-end tabular-nums">{n}</span></div>)}
                <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>{`${unassigned} unassigned`}</span>
              </div>
              <div className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: "var(--dc-sub)" }}>Racks in use</span>
                <div className="flex flex-wrap gap-1.5">{rackUse.length ? rackUse.map(([code, n]) => <span key={code} className="rounded-lg px-2.5 py-1 text-[13px]" style={{ background: "var(--dc-soft)" }}><strong>{code}</strong> {n}</span>) : <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>No garments on racks</span>}</div>
              </div>
              <div className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold" style={{ color: "var(--dc-sub)" }}>Queues</span><span className="text-sm">{queues.map((x) => `${x.label} ${x.n}`).join(" · ")}</span></div>
            </div>
          </details>

          <div className="flex flex-col gap-2.5 rounded-2xl border bg-[var(--dc-card)] p-3" style={{ borderColor: "var(--dc-line)" }}>
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="relative min-w-60 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute start-3.5 top-3.5 h-4 w-4" style={{ color: "var(--dc-sub)" }} />
                <span className="sr-only">Search garments</span>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tag, order, garment, customer, rack or staff" autoComplete="off" className="h-11 w-full rounded-xl border bg-[var(--dc-card)] pe-3 ps-10 text-sm outline-none" style={selectStyle} />
              </label>
              <select aria-label="Stage" value={lane} onChange={(e) => setLane(e.target.value)} className={selectClass} style={selectStyle}><option value="all">All stages</option>{LANES.map((l, i) => <option key={l.label} value={i}>{l.label}</option>)}</select>
              <select aria-label="Service" value={service} onChange={(e) => setService(e.target.value)} className={selectClass} style={selectStyle}><option value="all">All services</option>{services.map((s) => <option key={s}>{s}</option>)}</select>
              <select aria-label="Assigned staff" value={person} onChange={(e) => setPerson(e.target.value)} className={selectClass} style={selectStyle}><option value="all">Everyone&apos;s work</option><option value="me">My work</option><option value="none">Unassigned</option>{(staff.data ?? []).map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}</select>
              <select aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} className={selectClass} style={selectStyle}><option value="any">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="tomorrow">Due tomorrow</option></select>
            </div>
            <div role="group" aria-label="Status filters" className="flex flex-wrap items-center gap-2">
              {flagChips.map((f) => (
                <button key={f.key} type="button" aria-pressed={!!flags[f.key]} onClick={() => setFlags({ ...flags, [f.key]: !flags[f.key] })} className="dcd-pill min-h-10 cursor-pointer rounded-full border-[1.5px] px-3.5 text-sm font-medium" style={{ borderColor: flags[f.key] ? "var(--dc-solid)" : "var(--dc-line)", background: flags[f.key] ? "var(--dc-solid)" : f.n ? f.tone : "transparent", color: flags[f.key] ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{`${f.label} · ${f.n}`}</button>
              ))}
              <span role="status" className="ms-auto text-sm" style={{ color: "var(--dc-sub)" }}>{`${rows.length} of ${all.length} garments`}</span>
            </div>
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-2" style={{ borderColor: "var(--dc-line)" }}>
                <span className="text-[13px] font-semibold" style={{ color: "var(--dc-sub)" }}>Active:</span>
                {active.map((a) => <button key={a.label} type="button" onClick={a.clear} aria-label={`Remove filter ${a.label}`} className="dcd-pill inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[13px]" style={{ background: "var(--dc-soft)" }}>{a.label}<X aria-hidden="true" className="h-3 w-3" /></button>)}
                <button type="button" onClick={clearAll} className="cursor-pointer text-[13px] font-semibold underline">Clear all</button>
              </div>
            )}
          </div>

          {picked.length > 0 && (
            <div role="region" aria-label="Bulk actions" className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] bg-[var(--dc-card)] p-3 shadow-lg" style={{ borderColor: "var(--dc-solid)" }}>
              <strong className="text-[15px]">{`${picked.length} selected`}</strong>
              <button type="button" onClick={moveSelected} disabled={busy || !pickedMovable.length} className="dc-press min-h-10 cursor-pointer rounded-full px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "var(--dc-solid)", color: "var(--dc-on-solid)" }}>Move to next step</button>
              <label className="flex items-center gap-2 text-sm">Assign<select value="" disabled={busy} onChange={(e) => e.target.value && assignSelected(e.target.value)} className="h-10 rounded-xl border bg-[var(--dc-card)] px-2 text-sm" style={selectStyle}><option value="">Choose staff…</option>{(staff.data ?? []).map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}<option value="none">Remove assignment</option></select></label>
              {!!racks.data?.length && <label className="flex items-center gap-2 text-sm">Rack<select value="" disabled={busy} onChange={(e) => e.target.value && rackSelected(e.target.value)} className="h-10 rounded-xl border bg-[var(--dc-card)] px-2 text-sm" style={selectStyle}><option value="">Choose rack…</option>{racks.data.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label>}
              {pickedMovable.length < picked.length && <span className="text-[13px]" style={{ color: "#8a5a00" }}>{`${picked.length - pickedMovable.length} need the scan station`}</span>}
              <button type="button" onClick={() => setSelected(new Set())} className="ms-auto cursor-pointer text-sm font-medium underline">Clear selection</button>
            </div>
          )}

          {narrow && (
            <SlideGroup role="tablist" label="Stage" className="flex gap-1 overflow-x-auto rounded-full p-1" style={{ background: "var(--dc-soft)" }}>
              {LANES.map((l, i) => <button key={l.label} type="button" role="tab" aria-selected={tab === i} aria-checked={tab === i} onClick={() => setTab(i)} className="min-h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3.5 text-sm font-semibold" style={{ color: tab === i ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{`${l.label} · ${rows.filter((g) => laneOf(g.current_status) === i).length}`}</button>)}
            </SlideGroup>
          )}

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-[var(--dc-card)] px-4 py-14 text-center" style={{ borderColor: "var(--dc-line)" }}>
              <span className="text-[17px] font-semibold">{all.length ? "No garments match these filters" : "Your production queue is clear"}</span>
              <span className="text-sm" style={{ color: "var(--dc-sub)" }}>{all.length ? "Try a different search or clear the filters." : "New orders appear here as garments are received."}</span>
              {filtered && <button type="button" onClick={clearAll} className="dc-press mt-2 min-h-10 cursor-pointer rounded-full border-[1.5px] px-4 text-sm font-semibold" style={{ borderColor: "var(--dc-solid)" }}>Clear all filters</button>}
            </div>
          ) : (
            <div className="grid gap-3 overflow-x-auto pb-1.5" style={{ gridTemplateColumns: narrow ? "minmax(0,1fr)" : "repeat(5,minmax(252px,1fr))" }}>
              {lanesShown.map((i) => {
                const l = LANES[i];
                const items = rows.filter((g) => laneOf(g.current_status) === i).sort((a, b) => Date.parse(a.promised_at) - Date.parse(b.promised_at));
                const everyOne = items.length > 0 && items.every((g) => selected.has(g.id));
                const total = Math.max(1, Math.ceil(items.length / perLane));
                const page = Math.min(pages[i] ?? 0, total - 1);
                const shown = items.slice(page * perLane, page * perLane + perLane);
                const steps = l.stages.filter((s) => s !== "exception" && s !== "rework").map((s) => STAGE_LABELS[s]).join(" · ");
                return (
                  <section key={l.label} aria-label={l.label} className="flex min-h-60 min-w-0 flex-col gap-2.5 rounded-[18px] border p-3" style={{ borderColor: "var(--dc-line)", background: i === 4 ? "var(--dc-green-bg)" : "var(--dc-soft2, var(--dc-soft))" }}>
                    <div className="flex items-start gap-2 px-0.5 pb-1 pt-0.5">
                      {canWork && <input type="checkbox" checked={everyOne} disabled={!items.length} onChange={() => toggleLane(items)} aria-label={`Select all in ${l.label}`} className="mt-0.5 h-5 w-5 flex-none cursor-pointer" style={{ accentColor: "var(--dc-solid)" }} />}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold"><span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: l.dot }} />{l.label}<span className="ms-auto rounded-full border px-2 text-xs font-semibold tabular-nums" style={{ borderColor: "var(--dc-line)", background: "var(--dc-card)" }}>{items.length}</span></h2>
                        <span className="text-xs" style={{ color: "var(--dc-sub)" }}>{steps}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {shown.map((g) => <GarmentCard key={g.id} g={g} canWork={canWork} picked={selected.has(g.id)} busy={busy} onPick={() => toggle(g.id)} onMove={() => moveOne(g)} />)}
                    </div>
                    {total > 1 && (
                      <nav aria-label={`${l.label} pages`} className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <button type="button" onClick={() => setPages({ ...pages, [i]: page - 1 })} disabled={page === 0} aria-label={`Previous garments in ${l.label}`} className="dc-press grid h-9 w-9 cursor-pointer place-items-center rounded-full border bg-[var(--dc-card)] disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: "var(--dc-line)" }}><ChevronLeft aria-hidden="true" className="h-[18px] w-[18px] rtl:rotate-180" /></button>
                        <span role="status" className="text-[13px] font-semibold tabular-nums">{`${page * perLane + 1}–${Math.min((page + 1) * perLane, items.length)} of ${items.length}`}</span>
                        <button type="button" onClick={() => setPages({ ...pages, [i]: page + 1 })} disabled={page >= total - 1} aria-label={`More garments in ${l.label}`} className="dc-press grid h-9 w-9 cursor-pointer place-items-center rounded-full border bg-[var(--dc-card)] disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: "var(--dc-line)" }}><ChevronRight aria-hidden="true" className="h-[18px] w-[18px] rtl:rotate-180" /></button>
                      </nav>
                    )}
                    {items.length === 0 && <span className="px-1 py-3 text-center text-[13px]" style={{ color: "var(--dc-sub)" }}>No garments at this stage</span>}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GarmentCard({ g, canWork, picked, busy, onPick, onMove }: { g: Row; canWork: boolean; picked: boolean; busy: boolean; onPick: () => void; onMove: () => void }) {
  const late = isLate(g);
  const away = isAway(g);
  const next = nextStep(g);
  const atQc = g.current_status === "quality_control";
  const stuck = g.current_status === "exception";
  const scan = `/scan?tag=${encodeURIComponent(g.tag_code)}`;
  const chips: { t: string; bg: string; fg: string }[] = [
    ...(late ? [{ t: "Overdue", bg: "var(--dc-red-bg)", fg: "var(--dc-red-fg)" }] : []),
    ...(g.express ? [{ t: "Express", bg: "#fdf3e1", fg: "#8a5a00" }] : []),
    ...(g.current_status === "rework" ? [{ t: "Rework", bg: "#fdf3e1", fg: "#8a5a00" }] : []),
    ...(stuck ? [{ t: "Issue", bg: "var(--dc-red-bg)", fg: "var(--dc-red-fg)" }] : []),
    ...(away ? [{ t: "Away", bg: "var(--dc-soft)", fg: "var(--dc-ink)" }] : []),
  ];
  const where = away ? g.location.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase()) : g.storage_code ? `Rack ${g.storage_code}` : "In shop";
  const primary = !away && (atQc || Boolean(next));
  const actionClass = "dc-press flex min-h-9 w-full cursor-pointer items-center justify-center rounded-full border-[1.5px] px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  const actionStyle = primary ? { borderColor: "var(--dc-solid)", background: "var(--dc-solid)", color: "var(--dc-on-solid)" } : { borderColor: "var(--dc-line)", background: "var(--dc-card)", color: "var(--dc-ink)" };
  return (
    <article aria-label={`${g.tag_code}, ${g.garment_type_name}, ${g.customer_name}${late ? ", overdue" : ""}`} className="relative flex flex-col gap-2 rounded-[14px] border-[1.5px] bg-[var(--dc-card)] p-3 ps-3.5 transition-colors hover:border-[#8a8780]" style={{ borderColor: picked ? "var(--dc-solid)" : late ? "var(--dc-red-fg)" : "var(--dc-line)" }}>
      <span aria-hidden="true" className="absolute bottom-3 start-0 top-3 w-[3px] rounded-e" style={{ background: late ? "var(--dc-red-fg)" : g.express ? "#b8860b" : "transparent" }} />
      <div className="flex items-center gap-2">
        {canWork && <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${g.tag_code}`} className="h-5 w-5 flex-none cursor-pointer" style={{ accentColor: "var(--dc-solid)" }} />}
        <Link href={scan} className="flex min-w-0 flex-wrap items-baseline gap-x-2 hover:underline"><strong className="text-[13px] tabular-nums [overflow-wrap:anywhere]">{g.tag_code}</strong><span className="text-xs" style={{ color: "var(--dc-sub)" }}>{`Order #${g.order_number}`}</span></Link>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold leading-snug">{g.garment_type_name}{g.colour ? ` · ${g.colour}` : ""}</span>
        <span className="text-[13px]" style={{ color: "var(--dc-sub)" }}>{`${g.service_name} · ${g.customer_name}`}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--dc-soft)" }}>{`${STAGE_LABELS[g.current_status]}${g.stage_since ? ` · ${since(g.stage_since)}` : ""}`}</span>
        {chips.map((c) => <span key={c.t} className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: c.bg, color: c.fg }}>{c.t}</span>)}
      </div>
      <dl className="m-0 grid gap-x-2.5 gap-y-0.5 text-xs" style={{ gridTemplateColumns: "auto 1fr" }}>
        <dt style={{ color: "var(--dc-sub)" }}>Due</dt><dd className="m-0 font-semibold" style={{ color: late ? "var(--dc-red-fg)" : undefined }}>{dueText(g)}</dd>
        <dt style={{ color: "var(--dc-sub)" }}>Staff</dt><dd className="m-0">{g.assigned_to ?? "Unassigned"}</dd>
        <dt style={{ color: "var(--dc-sub)" }}>Where</dt><dd className="m-0">{where}</dd>
      </dl>
      {canWork && !away && !atQc && next
        ? <button type="button" onClick={onMove} disabled={busy} className={actionClass} style={actionStyle}>{`Move to ${STAGE_LABELS[next]}`}</button>
        : <Link href={scan} className={actionClass} style={actionStyle}>{canWork && atQc ? "Inspect" : "View details"}</Link>}
    </article>
  );
}
