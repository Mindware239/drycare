"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/components/ui";

export type DayPoint = { day: string; value: number };
const INK = "var(--chart-ink)";

const dayLabel = (day: string, year = false) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(new Date(`${day}T00:00:00`));
/** A round top for the y axis, so gridlines fall on numbers people read easily. */
function niceMax(max: number) {
  if (max <= 4) return Math.max(max, 1);
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

/**
 * One series over days. A line for steady counts, bars for sparse ones. One axis only.
 * Hover or arrow keys read any day; the same figures are in the table below it.
 */
export function DayChart({ points, kind = "line", height = 240, unit, format = (n) => n.toLocaleString("en-IN"), label, empty = "Nothing recorded in this period.", table = true }: { points: DayPoint[]; kind?: "line" | "bar"; height?: number; unit?: string; format?: (n: number) => string; label: string; empty?: string; table?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const watch = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    watch.observe(box.current);
    return () => watch.disconnect();
  }, []);
  const total = points.reduce((n, p) => n + p.value, 0);
  const top = niceMax(Math.max(0, ...points.map((p) => p.value)));
  // With nothing to show, a scale would only suggest figures that do not exist.
  const ticks = total === 0 ? [0] : top <= 2 ? [0, top] : [0, top / 2, top];
  const left = Math.max(28, Math.max(...ticks.map((t) => format(t).length)) * 7 + 8);
  const right = 8, topPad = 10, bottom = 26;
  const plotW = Math.max(1, width - left - right), plotH = height - topPad - bottom;
  const n = Math.max(points.length, 1);
  const slot = plotW / n;
  const x = (i: number) => left + slot * i + slot / 2;
  const y = (v: number) => topPad + plotH - (v / top) * plotH;
  const baseline = y(0);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)} ${baseline}L${x(0).toFixed(1)} ${baseline}Z` : "";
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 84))));
  function move(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(Math.min(points.length - 1, Math.max(0, Math.floor((e.clientX - r.left - left) / slot))));
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const last = points.length - 1;
    setAt((c) => (e.key === "Home" ? 0 : e.key === "End" ? last : Math.min(last, Math.max(0, (c ?? last) + (e.key === "ArrowLeft" ? -1 : 1)))));
  }
  const shown = at === null ? null : points[at];
  const tipLeft = at === null ? 0 : Math.min(Math.max(x(at), 64), Math.max(64, width - 64));
  const barW = Math.max(2, Math.min(slot - 2, 22));
  const active = points.filter((p) => p.value > 0);
  return (
    <div>
      <div ref={box} dir="ltr" className="relative outline-none" style={{ height }} role="img" tabIndex={0} aria-label={`${label}: ${format(total)} in total. Use the arrow keys to read each day.`} onPointerMove={move} onPointerLeave={() => setAt(null)} onFocus={() => setAt((c) => c ?? points.length - 1)} onBlur={() => setAt(null)} onKeyDown={key}>
        {width > 0 && (
          <svg width={width} height={height} aria-hidden="true" className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>{format(t)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % every === 0 ? <text key={p.day} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={INK}>{dayLabel(p.day)}</text> : null))}
            {kind === "line" && total > 0 && (
              <>
                <path d={area} fill="var(--chart-mark)" opacity={0.1} />
                <path d={line} fill="none" stroke="var(--chart-mark)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {active.length === 1 && <circle cx={x(points.indexOf(active[0]))} cy={y(active[0].value)} r={4} fill="var(--chart-mark)" stroke="var(--chart-surface)" strokeWidth={2} />}
              </>
            )}
            {kind === "bar" && points.map((p, i) => {
              if (!p.value) return null;
              const h = Math.max(3, baseline - y(p.value));
              const r = Math.min(4, barW / 2, h);
              const bx = x(i) - barW / 2, by = baseline - h;
              return <path key={p.day} d={`M${bx} ${baseline}V${by + r}Q${bx} ${by} ${bx + r} ${by}H${bx + barW - r}Q${bx + barW} ${by} ${bx + barW} ${by + r}V${baseline}Z`} fill="var(--chart-mark)" opacity={at === null || at === i ? 1 : 0.55} />;
            })}
            {at !== null && kind === "line" && total > 0 && (
              <>
                <line x1={x(at)} x2={x(at)} y1={topPad} y2={baseline} stroke={INK} strokeWidth={1} />
                <circle cx={x(at)} cy={y(points[at].value)} r={5} fill="var(--chart-mark)" stroke="var(--chart-surface)" strokeWidth={2} />
              </>
            )}
          </svg>
        )}
        {shown && (
          <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg px-2.5 py-1.5 shadow-lg" style={{ left: tipLeft, top: 0, transform: "translateX(-50%)", background: "#151514", color: "#faf8f4" }}>
            <span className="block text-sm font-semibold tabular-nums">{format(shown.value)}{unit ? ` ${unit}` : ""}</span>
            <span className="block text-[11px] opacity-75">{dayLabel(shown.day, true)}</span>
          </div>
        )}
        {width > 0 && total === 0 && <p className="absolute inset-x-0 text-center text-sm" style={{ top: height / 2 - 18, color: INK }}>{empty}</p>}
      </div>
      {table && active.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-medium text-slate-500 hover:text-slate-800">View as table</summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-start">
              <thead className="sticky top-0 bg-white text-slate-500"><tr><th className="px-3 py-1.5 font-medium">Day</th><th className="px-3 py-1.5 text-end font-medium">{unit ?? "Value"}</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{[...active].reverse().map((p) => <tr key={p.day}><td className="px-3 py-1.5">{dayLabel(p.day, true)}</td><td className="px-3 py-1.5 text-end tabular-nums">{format(p.value)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** Ranked bars: one colour, the length is the value. Each row can open its detail. */
export function BarList({ rows, max, onPick, picked }: { rows: { key: string; label: ReactNode; value: number; display?: string; aside?: ReactNode }[]; max?: number; onPick?: (key: string) => void; picked?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] font-medium text-slate-800">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-2"><span className="text-[13px] font-semibold tabular-nums text-slate-900">{r.display ?? r.value.toLocaleString("en-IN")}</span>{r.aside}</span>
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded bg-slate-100"><span className="block h-full rounded transition-[width] duration-500" style={{ width: `${Math.max(r.value ? 1.5 : 0, Math.min(100, (r.value / top) * 100))}%`, background: "var(--chart-mark)" }} /></span>
          </>
        );
        return (
          <li key={r.key}>
            {onPick ? <button type="button" aria-pressed={picked === r.key} onClick={() => onPick(r.key)} className={cx("block w-full cursor-pointer rounded-lg px-2 py-2 text-start transition hover:bg-slate-50", picked === r.key && "bg-brand-50 hover:bg-brand-50")}>{body}</button> : <div className="px-2 py-2">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
