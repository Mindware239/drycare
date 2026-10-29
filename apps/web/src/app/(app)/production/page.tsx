"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CheckSquare, Clock3, Factory, RefreshCw, Search, Shirt, Square, Timer, Truck, UserRound, X } from "lucide-react";
import { LOCATION_LABELS, STAGE_LABELS, allowedTransitions, type GarmentLocation, type GarmentStage } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, PageHeader, Select, Spinner, cx } from "@/components/ui";

const COLUMNS: GarmentStage[] = ["received", "inspection", "sorting", "cleaning", "drying", "finishing", "quality_control", "rework", "packing", "ready", "exception"];

const stageAccent: Partial<Record<GarmentStage, string>> = {
  received: "border-t-sky-400",
  inspection: "border-t-blue-400",
  sorting: "border-t-indigo-400",
  cleaning: "border-t-cyan-500",
  drying: "border-t-teal-500",
  finishing: "border-t-violet-400",
  quality_control: "border-t-purple-400",
  rework: "border-t-amber-500",
  packing: "border-t-blue-500",
  ready: "border-t-emerald-500",
  exception: "border-t-red-500",
};

type Row = {
  id: string; tag_code: string; current_status: GarmentStage; version: number; workflow_stages: GarmentStage[]; location: string;
  assigned_user_id: string | null; storage_location_id: string | null; order_id: string; order_number: string; promised_at: string;
  express: boolean; customer_name: string; garment_type_name: string; service_name: string; colour: string | null;
  storage_code: string | null; assigned_to: string | null; overdue: boolean; stage_since: string | null;
};

/** The single next production step for a garment, if it can be taken from the board. */
function nextStep(g: Row): GarmentStage | null {
  return allowedTransitions(g.workflow_stages, g.current_status).find((t) => t.kind === "advance" || t.kind === "rework_return")?.to ?? null;
}

function timeIn(since: string | null) {
  if (!since) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d`;
}

export default function ProductionPage() {
  const { branchId, branch, session, can } = useSession();
  const { data, error, loading, reload } = useApi<Row[]>(`/production/queues?branchId=${branchId}`);
  const staff = useApi<{ userId: string; name: string }[]>(can("garments.process") ? `/production/staff?branchId=${branchId}` : null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [expressOnly, setExpressOnly] = useState(false);
  const [service, setService] = useState("");
  const [assignee, setAssignee] = useState("");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "green" | "amber" | "red"; text: string } | null>(null);

  // Keep the board current for screens left open on the shop floor.
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { if (!busy) reload(); }, 30_000);
    return () => clearInterval(t);
  }, [autoRefresh, busy, reload]);

  const allRows = data ?? [];
  const services = useMemo(() => [...new Set(allRows.map((g) => g.service_name))].sort(), [allRows]);
  const overdueCount = allRows.filter((g) => g.overdue && g.current_status !== "ready").length;
  const readyCount = allRows.filter((g) => g.current_status === "ready").length;
  const attentionCount = allRows.filter((g) => ["rework", "exception"].includes(g.current_status)).length;
  const awayCount = allRows.filter((g) => g.location && !["shop_counter", "shop_storage"].includes(g.location)).length;
  const rows = allRows.filter((g) => {
    const query = search.trim().toLocaleLowerCase();
    return (!overdueOnly || (g.overdue && g.current_status !== "ready"))
      && (!expressOnly || g.express)
      && (!service || g.service_name === service)
      && (!assignee || (assignee === "me" ? g.assigned_user_id === session.user.id : assignee === "none" ? !g.assigned_user_id : g.assigned_user_id === assignee))
      && (!query || [g.tag_code, g.order_number, g.garment_type_name, g.colour, g.service_name, g.customer_name, g.storage_code].some((v) => String(v ?? "").toLocaleLowerCase().includes(query)));
  });
  const byStage = (s: string) => rows.filter((g) => g.current_status === s);
  const visibleCols = COLUMNS.filter((c) => byStage(c).length > 0 || ["received", "cleaning", "quality_control", "packing", "ready"].includes(c));
  const filtersOn = Boolean(search || overdueOnly || expressOnly || service || assignee);

  const picked = allRows.filter((g) => selected.has(g.id));
  const targets = [...new Set(picked.map(nextStep))];
  const commonNext = targets.length === 1 ? targets[0] : null;
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleColumn = (items: Row[]) => setSelected((cur) => {
    const n = new Set(cur);
    const all = items.every((g) => n.has(g.id));
    for (const g of items) if (all) n.delete(g.id); else n.add(g.id);
    return n;
  });

  async function moveSelected() {
    setBusy(true);
    setResult(null);
    let moved = 0;
    const problems: string[] = [];
    for (const g of picked) {
      const to = nextStep(g);
      if (!to) { problems.push(`${g.tag_code}: ${g.current_status === "quality_control" ? "needs a QC inspection at the scan station" : "no next step from the board"}`); continue; }
      try {
        await api(`/garments/${g.id}/transitions`, { body: { to, version: g.version } });
        moved++;
      } catch (e) {
        problems.push(`${g.tag_code}: ${(e as ApiError).message}`);
      }
    }
    setSelected(new Set());
    setResult({ tone: problems.length ? (moved ? "amber" : "red") : "green", text: `${moved} garment${moved === 1 ? "" : "s"} moved.${problems.length ? ` ${problems.length} not moved — ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "…" : ""}` : ""}` });
    setBusy(false);
    reload();
  }

  async function assignSelected(userId: string) {
    setBusy(true);
    setResult(null);
    let done = 0;
    const problems: string[] = [];
    for (const g of picked) {
      try {
        await api(`/garments/${g.id}/assignments`, { body: { userId: userId === "none" ? null : userId, version: g.version } });
        done++;
      } catch (e) {
        problems.push(`${g.tag_code}: ${(e as ApiError).message}`);
      }
    }
    setSelected(new Set());
    const who = userId === "none" ? "unassigned" : `assigned to ${staff.data?.find((s) => s.userId === userId)?.name ?? "staff"}`;
    setResult({ tone: problems.length ? "amber" : "green", text: `${done} garment${done === 1 ? "" : "s"} ${who}.${problems.length ? ` ${problems.length} skipped — ${problems.slice(0, 2).join("; ")}` : ""}` });
    setBusy(false);
    reload();
  }

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title="Production board"
        subtitle={`Every garment in work at ${branch?.name ?? "your branch"}. Tick garments to move them to the next step or assign them to staff; open one for QC, rack or exceptions.`}
        actions={
          <>
            <Button variant="secondary" onClick={reload} loading={loading && Boolean(data)}><RefreshCw className="h-4 w-4" />Refresh</Button>
            {can("garments.process") && <Link href="/scan"><Button>Open scan station</Button></Link>}
          </>
        }
      />
      {error && <Alert>{error.message}</Alert>}
      {result && <Alert tone={result.tone} onClose={() => setResult(null)}>{result.text}</Alert>}
      {loading && !data ? <Spinner /> : (
        <>
          <section aria-label="Production summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: "In production", value: allRows.length - readyCount, note: "Not yet ready", icon: Factory, tone: "text-brand-700 bg-brand-50 border-brand-100", onClick: () => { setOverdueOnly(false); setExpressOnly(false); } },
              { label: "Overdue", value: overdueCount, note: "Past promised time", icon: Clock3, tone: overdueCount ? "text-red-700 bg-red-50 border-red-100" : "text-slate-500 bg-slate-50 border-slate-200", onClick: () => setOverdueOnly(true) },
              { label: "Ready for pickup", value: readyCount, note: "Awaiting handover", icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
              { label: "Needs attention", value: attentionCount, note: "Rework or exception", icon: AlertTriangle, tone: attentionCount ? "text-amber-700 bg-amber-50 border-amber-100" : "text-slate-500 bg-slate-50 border-slate-200" },
              { label: "Away from shop", value: awayCount, note: "At facility or in transit", icon: Truck, tone: awayCount ? "text-violet-700 bg-violet-50 border-violet-100" : "text-slate-500 bg-slate-50 border-slate-200", href: "/transfers" },
            ].map(({ label, value, note, icon: Icon, tone, onClick, href }) => {
              const inner = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-500">{label}</p>
                    <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl border", tone)}><Icon className="h-[18px] w-[18px]" /></span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p>
                  <p className="mt-1 text-xs text-slate-500">{note}</p>
                </>
              );
              const cls = "rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm";
              return href ? <Link key={label} href={href} className={cx(cls, "hover:border-brand-300")}>{inner}</Link>
                : onClick ? <button key={label} type="button" onClick={onClick} className={cx(cls, "hover:border-brand-300")}>{inner}</button>
                : <div key={label} className={cls}>{inner}</div>;
            })}
          </section>

          <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm" aria-label="Production board filters">
            <label className="relative min-w-0 flex-1 basis-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tag, order, garment, customer, rack…" aria-label="Search garments"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-100" />
            </label>
            <Select value={service} onChange={(e) => setService(e.target.value)} className="h-10 w-auto" aria-label="Service">
              <option value="">All services</option>
              {services.map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-10 w-auto" aria-label="Assigned to">
              <option value="">Everyone&apos;s work</option>
              <option value="me">My work</option>
              <option value="none">Unassigned</option>
              {(staff.data ?? []).map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
            </Select>
            <FilterChip on={overdueOnly} onChange={setOverdueOnly} tone="red">Overdue <span className="tabular-nums">{overdueCount}</span></FilterChip>
            <FilterChip on={expressOnly} onChange={setExpressOnly} tone="amber">Express</FilterChip>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="h-3.5 w-3.5 accent-brand-700" />Auto-refresh</label>
            <span className="text-xs tabular-nums text-slate-500">{rows.length} of {allRows.length}</span>
          </section>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
              <Search className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">{allRows.length ? "No garments match these filters" : "Your production queue is clear"}</p>
              <p className="mt-1 text-sm text-slate-500">{allRows.length ? "Try a different search or clear the filters." : "New orders will appear here as garments enter production."}</p>
              {filtersOn && <button type="button" onClick={() => { setSearch(""); setOverdueOnly(false); setExpressOnly(false); setService(""); setAssignee(""); }} className="mt-3 text-sm font-semibold text-brand-700">Clear filters</button>}
            </div>
          ) : (
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4">
              {visibleCols.map((stage) => {
                const items = byStage(stage);
                const urgent = stage === "rework" || stage === "exception";
                const allPicked = items.length > 0 && items.every((g) => selected.has(g.id));
                return (
                  <section key={stage} className={cx("flex max-h-[70vh] w-[min(82vw,300px)] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 border-t-4 bg-slate-50/80 shadow-sm sm:w-[280px]", stageAccent[stage] ?? "border-t-slate-300")}>
                    <header className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        {can("garments.process") && items.length > 0 && (
                          <button type="button" onClick={() => toggleColumn(items)} aria-label={`Select all in ${STAGE_LABELS[stage]}`} className="text-slate-400 hover:text-brand-700">
                            {allPicked ? <CheckSquare className="h-4 w-4 text-brand-700" /> : <Square className="h-4 w-4" />}
                          </button>
                        )}
                        <h3 className={cx("truncate text-sm font-semibold", urgent ? "text-red-700" : "text-slate-800")}>{STAGE_LABELS[stage]}</h3>
                      </div>
                      <span className={cx("flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums", urgent ? "bg-red-50 text-red-700" : stage === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-600 ring-1 ring-slate-200")}>{items.length}</span>
                    </header>
                    <div className="flex min-h-28 flex-col gap-2 overflow-y-auto p-2">
                      {items.map((g) => {
                        const isOverdue = g.overdue && stage !== "ready";
                        const isPicked = selected.has(g.id);
                        const away = g.location && !["shop_counter", "shop_storage"].includes(g.location);
                        const stuck = g.stage_since && Date.now() - new Date(g.stage_since).getTime() > 24 * 3600_000 && stage !== "ready";
                        return (
                          <div key={g.id} className={cx("group relative rounded-xl border bg-white text-sm shadow-sm transition hover:border-brand-300 hover:shadow-md", isPicked ? "border-brand-500 ring-2 ring-brand-500/20" : isOverdue ? "border-red-200" : "border-slate-200")}>
                            {can("garments.process") && (
                              <button type="button" onClick={() => toggle(g.id)} aria-label={`Select ${g.tag_code}`} className="absolute left-2 top-2.5 z-10 text-slate-300 hover:text-brand-700">
                                {isPicked ? <CheckSquare className="h-4 w-4 text-brand-700" /> : <Square className="h-4 w-4" />}
                              </button>
                            )}
                            <Link href={`/scan?tag=${g.tag_code}`} className="block p-3 pl-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                              <div className="flex items-start justify-between gap-2">
                                <span className="break-all font-mono text-[11px] font-medium text-slate-500">{g.tag_code}</span>
                                {g.express && <Badge color="amber">Express</Badge>}
                              </div>
                              <p className="mt-1.5 font-semibold text-slate-900">{g.garment_type_name}{g.colour && <span className="font-normal text-slate-500"> · {g.colour}</span>}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{g.service_name} <span className="text-slate-300">·</span> {g.customer_name}</p>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {g.assigned_to && <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-800"><UserRound className="h-3 w-3" />{g.assigned_to}</span>}
                                {away && <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-800"><Truck className="h-3 w-3" />{LOCATION_LABELS[g.location as GarmentLocation] ?? g.location}</span>}
                                {g.storage_code && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Rack {g.storage_code}</span>}
                              </div>
                              <div className="mt-2 flex items-end justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
                                <span className={cx(isOverdue ? "font-semibold text-red-600" : "text-slate-500")}>{isOverdue && "Overdue · "}Due {dateTime(g.promised_at)}</span>
                                {g.stage_since && <span className={cx("inline-flex shrink-0 items-center gap-0.5", stuck ? "font-semibold text-amber-700" : "text-slate-400")} title="Time in this stage"><Timer className="h-3 w-3" />{timeIn(g.stage_since)}</span>}
                              </div>
                            </Link>
                          </div>
                        );
                      })}
                      {items.length === 0 && <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 py-5 text-xs text-slate-400">No garments in this stage</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/15">
            <span className="flex items-center gap-2 pl-1 text-sm font-semibold text-slate-900"><Shirt className="h-4 w-4 text-brand-700" />{picked.length} selected</span>
            <Button onClick={moveSelected} loading={busy} disabled={!targets.some(Boolean)}>
              {commonNext ? <>Move to {STAGE_LABELS[commonNext]}</> : "Move each to its next step"}<ArrowRight className="h-4 w-4" />
            </Button>
            <Select value="" onChange={(e) => e.target.value && assignSelected(e.target.value)} disabled={busy} className="h-9 w-auto" aria-label="Assign selected">
              <option value="">Assign to…</option>
              {(staff.data ?? []).map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
              <option value="none">Remove assignment</option>
            </Select>
            {targets.includes(null) && <span className="text-xs text-amber-700">Some need QC or a rack at the scan station</span>}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear selection"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ on, onChange, tone, children }: { on: boolean; onChange: (v: boolean) => void; tone: "red" | "amber"; children: React.ReactNode }) {
  const active = tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={cx("inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition", on ? active : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
      {children}
    </button>
  );
}
