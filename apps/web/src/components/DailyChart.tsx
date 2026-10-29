"use client";
import { useState } from "react";
import { money } from "@/lib/format";

/** Grouped daily totals using the dashboard's brand and collection colors. */
const SERIES = [
  { key: "billed", label: "Billed", color: "#0d8573" },
  { key: "collected", label: "Collected", color: "#f97316" },
] as const;

type Row = { day: string; billed: number; collected: number };

export function DailyChart({ data }: { data: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const W = 640;
  const H = 200;
  const pad = { l: 56, r: 8, t: 8, b: 24 };
  const max = Math.max(1, ...data.flatMap((d) => [d.billed, d.collected]));
  const nice = niceMax(max);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(18, (slot - 6) / 2 - 1));
  const y = (v: number) => pad.t + plotH - (v / nice) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * nice);
  const label = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const every = Math.ceil(data.length / 8);

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-slate-600">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        <button className="ml-auto text-slate-500 underline-offset-2 hover:underline" onClick={() => setShowTable(!showTable)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1">Day</th>
              <th className="py-1 text-right">Billed</th>
              <th className="py-1 text-right">Collected</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t border-slate-100">
                <td className="py-1">{label(d.day)}</td>
                <td className="py-1 text-right tabular-nums">{money(d.billed)}</td>
                <td className="py-1 text-right tabular-nums">{money(d.collected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Billed and collected amounts per day">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="dc-chart-grid" stroke="#e2e8f0" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#64748b">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = pad.l + i * slot + (slot - (barW * 2 + 2)) / 2;
              return (
                <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} className={hover === i ? "dc-chart-hover" : undefined} fill={hover === i ? "#f1f5f9" : "transparent"} />
                  {SERIES.map((s, si) => {
                    const v = d[s.key];
                    const h = Math.max(0, y(0) - y(v));
                    return h > 0 ? <path key={s.key} d={roundedTop(x0 + si * (barW + 2), y(v), barW, h, Math.min(4, barW / 2))} fill={s.color} /> : null;
                  })}
                  {i % every === 0 && (
                    <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#64748b">
                      {label(d.day)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="dc-chart-axis" stroke="#cbd5e1" />
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
              style={{ left: `${Math.min(75, ((pad.l + hover * slot + slot) / W) * 100)}%` }}
            >
              <p className="mb-1 font-medium text-slate-800">{label(data[hover].day)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center gap-1.5 text-slate-700">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  {s.label}: <span className="tabular-nums">{money(data[hover][s.key])}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceMax(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

const compact = (paise: number) => {
  const r = paise / 100;
  if (r >= 100000) return `₹${(r / 100000).toFixed(1)}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(r)}`;
};
