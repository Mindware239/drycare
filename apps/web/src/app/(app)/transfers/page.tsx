"use client";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Box, Truck } from "lucide-react";
import { LOCATION_LABELS, expandScanCode, normalizeEpc, type GarmentLocation } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { appLocale, appZone } from "@/lib/format";

type Stage = "packing" | "transit" | "at_facility" | "done";
type Row = {
  id: string; batchNumber: string; direction: string; facilityName: string; transportReference: string | null; status: string; createdAt: string; dispatchedAt: string | null; receivedAt: string | null; expectedBackAt: string | null;
  bags: number; garments: number; scanned: number; arrived: number; atFacility: number; returnId: string | null; returnStatus: string | null; back: number; backExpected: number; missing: number; standalone: boolean; stage: Stage; doneAt: string | null;
};
type WaitingBag = { id: string; bagCode: string; orderNumber: string; customerName: string; garments: { tagCode: string; garmentType: string }[] };
type Garment = { id: string; tagCode: string; bagId: string; location: string; garmentType: string; service: string; colour: string | null; dispatchVerified: boolean; receiptVerified: boolean };
type Bag = { id: string; bagCode: string; orderId: string; orderNumber: string; customerName: string };
type Detail = {
  id: string; batchNumber: string; status: string; direction: string; facilityName: string; createdAt: string; dispatchedAt: string | null; receivedAt: string | null; expectedBackAt: string | null; transportReference: string | null;
  createdByName: string | null; dispatchedByName: string | null; receivedByName: string | null; bags: Bag[]; garments: Garment[]; scans: { id: string; code: string; result: string; scannedAt: string; scannedBy: string | null }[];
};
type Mode = "new" | "pickret" | "view" | "pack" | "recv" | "ret";
type Dlg = { mode: Mode; row?: Row };

const garmentsWord = (n: number) => (n === 1 ? "1 garment" : `${n} garments`);
const bagsWord = (n: number) => (n === 1 ? "1 bag" : `${n} bags`);
const fmt = (t: string | number) => new Date(t).toLocaleString(appLocale(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: appZone() });
function ago(t: string) {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 0)} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
const STAGE_INDEX: Record<Stage, number> = { packing: 0, transit: 1, at_facility: 2, done: 3 };
const STAGE_STYLE: Record<Stage, { label: string; bg: string; fg: string }> = {
  packing: { label: "Packing", bg: "var(--dc-soft)", fg: "var(--dc-ink)" },
  transit: { label: "In transit", bg: "var(--dc-blue-bg)", fg: "var(--dc-blue-fg)" },
  at_facility: { label: "At facility", bg: "var(--dc-amber-bg)", fg: "var(--dc-amber-fg)" },
  done: { label: "Returned", bg: "var(--dc-green-bg)", fg: "var(--dc-green-fg)" },
};

const BTN: CSSProperties = { fontSize: 14, fontWeight: 600, minHeight: 44, padding: "0 18px", borderRadius: 999, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 };
const OUTLINE: CSSProperties = { ...BTN, border: "1.5px solid var(--dc-solid)", background: "var(--dc-card)", color: "var(--dc-ink)" };
const SOLID: CSSProperties = { ...BTN, border: "1.5px solid var(--dc-solid)", background: "var(--dc-solid)", color: "var(--dc-on-solid)" };
const GREEN: CSSProperties = { ...BTN, padding: "0 20px", border: "1.5px solid var(--dc-green)", background: "var(--dc-green)", color: "#151514" };
const FIELD: CSSProperties = { fontSize: 15, minHeight: 44, padding: "0 12px", border: "1.5px solid var(--dc-grey)", borderRadius: 12, background: "var(--dc-card)", color: "var(--dc-ink)", width: "100%" };
const SR: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/** Send, At facility, Back at shop, with the current step marked. */
function Track({ at, large, label }: { at: number; large?: boolean; label: string }) {
  const size = large ? 22 : 18;
  return (
    <ol aria-label={label} className="flex flex-wrap items-center" style={{ listStyle: "none", margin: large ? 0 : "4px 0 0", padding: 0, gap: large ? "4px 8px" : "4px 6px" }}>
      {["Send", "At facility", "Back at shop"].map((text, i) => {
        const done = i < at, cur = i === at;
        return (
          <li key={text} aria-current={cur ? "step" : undefined} className="flex items-center" style={{ gap: large ? 8 : 6, fontSize: large ? 13 : 12, fontWeight: cur ? 700 : 500, color: done || cur ? "var(--dc-ink)" : "var(--dc-sub)" }}>
            {i > 0 && <span aria-hidden="true" style={{ width: large ? 20 : 12, height: 2, borderRadius: 1, background: i <= at ? "var(--dc-green)" : "var(--dc-line)" }} />}
            <span aria-hidden="true" className="grid place-items-center" style={{ width: size, height: size, borderRadius: "50%", fontSize: large ? 11 : 10, fontWeight: 700, background: done ? "var(--dc-green)" : cur ? "var(--dc-solid)" : "var(--dc-card)", color: "#151514", border: done || cur ? 0 : "1.5px solid var(--dc-grey)" }}>{done ? "✓" : ""}</span>
            {text}
            <span style={SR}>{done ? ", done" : cur ? ", current" : ", not yet"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ now, max, color, height = 8, label }: { now: number; max: number; color: string; height?: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(1, max)} aria-valuenow={Math.min(now, Math.max(1, max))} style={{ height, borderRadius: height / 2, background: "var(--dc-line2)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${max ? Math.min(100, Math.round((now / max) * 100)) : 0}%`, borderRadius: height / 2, background: color, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} />
    </div>
  );
}

/** Everything a row shows, worked out from one journey. */
function describe(r: Row, waiting: number) {
  const draftReturn = r.standalone && r.status === "draft";
  const on = r.standalone ? (r.stage === "done" ? 3 : r.status === "draft" ? 1 : 2) : STAGE_INDEX[r.stage];
  const style = STAGE_STYLE[r.stage];
  const label = draftReturn ? "Packing return" : r.stage === "transit" && r.arrived > 0 ? "Receiving at facility" : r.stage === "at_facility" && r.returnId ? "Coming back" : style.label;
  const late = Boolean(r.expectedBackAt && r.stage !== "done" && r.stage !== "packing" && new Date(r.expectedBackAt).getTime() < Date.now());
  let pLabel: string, pNow: number, pMax: number, pColor = "var(--dc-green)";
  if (r.stage === "packing") { pLabel = "Packed"; pNow = r.garments; pMax = r.garments + waiting; pColor = "var(--dc-grey)"; }
  else if (draftReturn) { pLabel = "Packed"; pNow = r.scanned; pMax = r.garments; pColor = "var(--dc-grey)"; }
  else if (r.stage === "transit") { pLabel = "Received at facility"; pNow = r.arrived; pMax = r.garments; pColor = "var(--dc-blue)"; }
  else { pLabel = "Back at shop"; pNow = r.back; pMax = r.backExpected; if (r.missing && r.stage === "done") pColor = "#b4471a"; }
  const when = r.stage === "packing" || draftReturn ? `Draft created ${ago(r.createdAt)}` : r.stage === "transit" ? `Sent ${ago(r.dispatchedAt ?? r.createdAt)}` : r.stage === "done" ? `Returned ${fmt(r.doneAt ?? r.createdAt)}` : r.standalone ? `Sent ${ago(r.dispatchedAt ?? r.createdAt)}` : `Received at facility ${ago(r.receivedAt ?? r.createdAt)}`;
  const due = r.expectedBackAt && (r.stage === "transit" || r.stage === "at_facility") ? (late ? `Late · was due back ${fmt(r.expectedBackAt)}` : `Back by ${fmt(r.expectedBackAt)}`) : null;
  const missNote = !r.missing ? null : r.stage === "done" ? `${garmentsWord(r.missing)} never came back. Raise a claim with ${r.facilityName}.` : r.missing === 1 ? "1 garment not scanned at the facility. Scan it on return if it turns up, or raise a claim." : `${r.missing} garments not scanned at the facility. Scan them on return if they turn up, or raise a claim.`;
  const next = r.stage === "packing" ? "finish packing and dispatch (at the shop)" : draftReturn ? "finish packing and dispatch (at the facility)" : r.stage === "transit" ? `scan the bags in at ${r.facilityName}` : r.stage === "at_facility" ? "scan garments back in at the shop" : r.missing ? "follow up on missing garments" : "nothing, all garments are back";
  const action: { label: string; mode: Mode } | null = r.stage === "packing" || draftReturn ? { label: "Continue packing", mode: "pack" } : r.stage === "transit" ? { label: "Receive at facility", mode: "recv" } : r.stage === "at_facility" ? { label: "Receive return", mode: "ret" } : null;
  return { on, style, label, late, pLabel, pNow, pMax, pColor, when, due, missNote, next, action };
}

function TransfersInner() {
  const { branchId, session, can } = useSession();
  const query = branchId ? `?branchId=${branchId}` : "";
  const journeys = useApi<Row[]>(`/transfers/journeys${query}`);
  const waiting = useApi<WaitingBag[]>(`/transfers/waiting${query}`);
  const asked = useSearchParams().get("batch");
  const [tab, setTab] = useState<"active" | "done">("active");
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canMove = can("garments.process");
  const rows = useMemo(() => journeys.data ?? [], [journeys.data]);
  const waitingBags = useMemo(() => waiting.data ?? [], [waiting.data]);
  const waitingGarments = waitingBags.reduce((n, b) => n + b.garments.length, 0);
  const active = rows.filter((r) => r.stage !== "done").sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage] || b.createdAt.localeCompare(a.createdAt));
  const done = rows.filter((r) => r.stage === "done").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const list = tab === "active" ? active : done;
  const returning = rows.filter((r) => r.stage === "at_facility" && !(r.standalone && r.status === "draft"));
  const refresh = () => { journeys.reload(); waiting.reload(); };
  function say(text: string) {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(""), 3800);
  }

  // A link to one batch, as used by older pages and bookmarks.
  const openedAsked = useRef(false);
  useEffect(() => {
    if (!asked || openedAsked.current || !journeys.data) return;
    const row = journeys.data.find((r) => r.id === asked || r.returnId === asked);
    if (row) { openedAsked.current = true; setDlg({ mode: "view", row }); setTab(row.stage === "done" ? "done" : "active"); }
  }, [asked, journeys.data]);

  function open(row: Row, mode: Mode) {
    setDlg({ mode, row });
  }
  function openReturn() {
    if (!returning.length) return say("No batch is at a facility right now.");
    if (returning.length === 1) return open(returning[0], "ret");
    setDlg({ mode: "pickret" });
  }
  const shownRow = dlg?.row ? rows.find((r) => r.id === dlg.row!.id) ?? dlg.row : undefined;

  const how = [
    { Icon: ArrowUp, title: "1 · Send", text: "Create a batch, scan each bag, then scan every garment tag in it. Dispatch when all are verified.", where: "At the shop", count: (n: number) => (n === 0 ? "None packing" : n === 1 ? "1 batch packing" : `${n} batches packing`), n: rows.filter((r) => r.stage === "packing").length },
    { Icon: Truck, title: "2 · Receive at facility", text: "Open the batch at the facility and scan the tags as bags are unpacked. Missing pieces are flagged.", where: "At the facility", count: (n: number) => (n === 0 ? "None in transit" : n === 1 ? "1 batch in transit" : `${n} batches in transit`), n: rows.filter((r) => r.stage === "transit").length },
    { Icon: Box, title: "3 · Return receiving", text: "Cleaned garments come back in a return batch. Scan them at the shop to confirm all are back.", where: "Back at the shop", count: (n: number) => (n === 0 ? "None ready to return" : n === 1 ? "1 batch ready to return" : `${n} batches ready to return`), n: rows.filter((r) => r.stage === "at_facility").length },
  ];

  return (
    <div className="dcd flex flex-col gap-[18px] pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1" style={{ maxWidth: 760 }}>
          <h1 className="dcd-h m-0" style={{ fontSize: 34, lineHeight: 1.15 }}>Facility transfers</h1>
          <span style={{ fontSize: 15, color: "var(--dc-sub)" }}>Send bags to the processing facility and receive them back. Every garment is scanned in and out, so nothing goes missing unnoticed.</span>
        </div>
        {canMove && (
          <div className="flex flex-wrap gap-[10px]">
            <button type="button" className="dc-press dcd-lift" style={OUTLINE} onClick={openReturn}><ArrowDown aria-hidden="true" size={18} />Return to shop</button>
            <button type="button" className="dc-press dcd-lift" style={GREEN} onClick={() => setDlg({ mode: "new" })}><ArrowUp aria-hidden="true" size={18} />Send to facility</button>
          </div>
        )}
      </div>

      <ol aria-label="How transfers work" className="grid gap-3" style={{ listStyle: "none", margin: 0, padding: 0, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {how.map(({ Icon, title, text, where, n, count }) => (
          <li key={title} className="flex items-start" style={{ gap: 14, padding: 18, borderRadius: 16, background: "var(--dc-card)", border: "1px solid var(--dc-line)" }}>
            <span aria-hidden="true" className="grid flex-none place-items-center" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--dc-green-bg)", color: "var(--dc-green-fg)" }}><Icon size={18} /></span>
            <span className="flex min-w-0 flex-col gap-1">
              <strong style={{ fontSize: 15 }}>{title}</strong>
              <span style={{ fontSize: 14, color: "var(--dc-sub)", lineHeight: 1.5 }}>{text}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: "var(--dc-soft)" }}>{where}</span>
                <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: n ? "var(--dc-blue-bg)" : "var(--dc-soft)", color: n ? "var(--dc-blue-fg)" : "var(--dc-sub)" }}>{count(n)}</span>
              </span>
            </span>
          </li>
        ))}
      </ol>

      {journeys.error && <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 12, background: "var(--dc-red-bg)", color: "var(--dc-red-fg)", fontSize: 14 }}>{journeys.error.message}</p>}

      <section aria-label="Batches" style={{ background: "var(--dc-card)", border: "1px solid var(--dc-line)", borderRadius: 20, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--dc-line2)" }}>
          <div role="tablist" aria-label="Batch status" className="relative inline-grid" style={{ gridTemplateColumns: "1fr 1fr", padding: 4, borderRadius: 12, background: "var(--dc-soft)", border: "1px solid var(--dc-line)" }}>
            <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4, insetInlineStart: tab === "active" ? 4 : "50%", width: "calc(50% - 4px)", borderRadius: 9, background: "var(--dc-card)", border: "1.5px solid var(--dc-solid)", boxShadow: "0 1px 4px rgba(21,21,20,.14)", transition: "inset-inline-start .45s cubic-bezier(.2,.8,.2,1)" }} />
            {([["active", "Active batches", active.length], ["done", "Completed", done.length]] as const).map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="relative z-[1] cursor-pointer whitespace-nowrap" style={{ fontSize: 14, fontWeight: 600, minHeight: 40, padding: "0 16px", border: 0, borderRadius: 9, background: "transparent", color: tab === id ? "var(--dc-ink)" : "var(--dc-sub)", transition: "color .35s ease" }}>
                {label} · <span style={{ display: "inline-block", minWidth: "1.2em", padding: "0 6px", borderRadius: 999, background: tab === id ? "var(--dc-green-bg)" : "transparent", transition: "background .35s ease" }}>{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div role="tabpanel" key={tab}>
          {!journeys.data ? (
            <p role="status" style={{ margin: 0, padding: "56px 20px", textAlign: "center", fontSize: 15, color: "var(--dc-sub)" }}>Loading…</p>
          ) : !list.length ? (
            <div className="flex flex-col items-center gap-1.5 text-center" style={{ padding: "56px 20px" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{tab === "active" ? "No batches in progress" : "No completed batches yet"}</span>
              <span style={{ fontSize: 14, color: "var(--dc-sub)" }}>{tab === "active" ? "Start with “Send to facility” when the van is ready to leave." : "Batches appear here once every garment is back at the shop."}</span>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {list.map((r, j) => {
                const d = describe(r, waitingGarments);
                return (
                  <li key={r.id} className="dcd-pop grid items-center lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)_auto]" style={{ gap: "12px 20px", padding: "16px 20px", borderTop: j ? "1px solid var(--dc-line2)" : 0, animationDelay: `${j * 60}ms` }}>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => open(r, "view")} className="cursor-pointer" style={{ fontSize: 16, fontWeight: 700, padding: "2px 0", minHeight: 28, border: 0, background: "transparent", color: "var(--dc-ink)", textDecoration: "underline", textUnderlineOffset: 4, textDecorationColor: "var(--dc-grey)" }}>{r.batchNumber}<span style={SR}>, view details</span></button>
                        <span style={{ fontSize: 13, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: d.style.bg, color: d.style.fg }}>{d.label}</span>
                        {r.missing > 0 && <span style={{ fontSize: 13, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "var(--dc-red-bg)", color: "var(--dc-red-fg)" }}>⚠ {`${r.missing} missing`}</span>}
                      </div>
                      <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>{`${r.facilityName} · ${bagsWord(r.bags)} · ${garmentsWord(r.garments)}`}{r.transportReference ? ` · ${r.transportReference}` : ""}</span>
                      <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{d.when}</span>
                      {d.due && <span style={{ fontSize: 14, fontWeight: 600, color: d.late ? "var(--dc-red-fg)" : "var(--dc-ink)" }}>{d.due}</span>}
                      {d.missNote && <span className="flex items-start gap-1.5" style={{ fontSize: 13, color: "var(--dc-red-fg)", padding: "6px 10px", borderRadius: 8, background: "var(--dc-red-bg)" }}><span aria-hidden="true">⚠</span><span>{d.missNote}</span></span>}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex justify-between gap-2" style={{ fontSize: 13 }}><span style={{ color: "var(--dc-sub)" }}>{d.pLabel}</span><strong className="tabular-nums">{`${d.pNow} of ${d.pMax}`}</strong></div>
                      <Progress now={d.pNow} max={d.pMax} color={d.pColor} label={`${r.batchNumber} ${d.pLabel}: ${d.pNow} of ${d.pMax}`} />
                      <Track at={d.on} label={`${r.batchNumber} progress`} />
                    </div>
                    <div className="flex flex-wrap justify-start gap-2 lg:justify-end" style={{ maxWidth: 340 }}>
                      <span className="text-start lg:text-end" style={{ flexBasis: "100%", fontSize: 13 }}><strong>Next:</strong> {d.next}</span>
                      <button type="button" className="dc-press dcd-lift" aria-label={`Details for ${r.batchNumber}`} onClick={() => open(r, "view")} style={{ ...OUTLINE, minHeight: 40, borderColor: "var(--dc-line)" }}>Details</button>
                      {d.action && canMove && <button type="button" className="dc-press dcd-lift" onClick={() => open(r, d.action!.mode)} style={{ ...SOLID, minHeight: 40 }}>{d.action.label}</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {dlg?.mode === "new" && <NewBatch defaultFacility={(session.organization.settings as { facilityName?: string } | null)?.facilityName ?? "Central processing facility"} known={rows.map((r) => r.facilityName)} waitingGarments={waitingGarments} branchId={branchId} onClose={() => setDlg(null)} onCreated={(row) => { refresh(); setTab("active"); setDlg({ mode: "pack", row }); }} />}
      {dlg?.mode === "pickret" && (
        <Dialog narrow kicker="Step 3 · Return receiving" title="Which batch came back?" sub="Batches currently at a facility." onClose={() => setDlg(null)} footer={<div className="flex justify-end" style={{ padding: "14px 24px", borderTop: "1px solid var(--dc-line2)" }}><button type="button" className="dc-press" style={OUTLINE} onClick={() => setDlg(null)}>Close</button></div>}>
          <span style={{ fontSize: 14 }}>Choose the batch that came back from the facility.</span>
          <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {returning.map((r) => (
              <li key={r.id}><button type="button" onClick={() => open(r, "ret")} className="dcd-pill flex w-full cursor-pointer items-center justify-between gap-3 text-start" style={{ padding: "14px 16px", borderRadius: 14, border: "1.5px solid var(--dc-line)", background: "var(--dc-card)", color: "var(--dc-ink)" }}><span className="flex flex-col"><strong>{r.batchNumber}</strong><span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{`${r.facilityName} · ${garmentsWord(r.backExpected)} expected`}{r.expectedBackAt ? ` · back by ${fmt(r.expectedBackAt)}` : ""}</span></span><span aria-hidden="true" style={{ fontSize: 18 }}>→</span></button></li>
            ))}
          </ul>
        </Dialog>
      )}
      {dlg && shownRow && !["new", "pickret"].includes(dlg.mode) && (
        <BatchDialog key={`${shownRow.id}:${dlg.mode}`} row={shownRow} mode={dlg.mode} canMove={canMove} waiting={waitingBags} onChanged={refresh} onMode={(mode) => open(shownRow, mode)} onClose={() => setDlg(null)} onFinished={(text, toTab) => { setDlg(null); refresh(); say(text); if (toTab) setTab(toTab); }} />
      )}
      {toast && <div role="status" style={{ position: "fixed", insetInlineStart: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, background: "#151514", color: "#faf8f4", padding: "12px 18px", borderRadius: 12, fontSize: 14, boxShadow: "0 12px 32px rgba(0,0,0,.3)", maxWidth: "calc(100% - 32px)" }}>{toast}</div>}
    </div>
  );
}

function Dialog({ kicker, title, sub, narrow, onClose, children, footer, locked }: { kicker: string; title: string; sub: string; narrow?: boolean; onClose: () => void; children: ReactNode; footer: ReactNode; locked?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => setShown(true), 20);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !lockedRef.current) closeRef.current(); };
    window.addEventListener("keydown", key);
    if (!panel.current?.contains(document.activeElement)) panel.current?.querySelector<HTMLElement>("[data-autofocus],button")?.focus();
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); back?.focus?.(); };
  }, []);
  function trap(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,textarea,summary,a[href]")];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  return createPortal(
    <div className="dcd">
      <div onClick={() => { if (!locked) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(21,21,20,.45)" }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap} className="flex flex-col" style={{ position: "fixed", top: "min(6vh,48px)", left: "50%", transform: `translateX(-50%) ${shown ? "" : "translateY(14px) scale(.98)"}`, opacity: shown ? 1 : 0, transition: "opacity .25s ease,transform .35s cubic-bezier(.2,.8,.2,1)", zIndex: 61, width: narrow ? 520 : 780, maxWidth: "calc(100% - 24px)", maxHeight: "88vh", background: "var(--dc-card)", borderRadius: 22, boxShadow: "0 30px 80px rgba(0,0,0,.3)", overflow: "hidden", color: "var(--dc-ink)" }}>
        <div className="flex items-start justify-between gap-3" style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--dc-line2)" }}>
          <div className="flex min-w-0 flex-col gap-1">
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--dc-green-fg)" }}>{kicker}</span>
            <h2 className="dcd-h m-0" style={{ fontSize: 24, overflowWrap: "anywhere" }}>{title}</h2>
            <span style={{ fontSize: 14, color: "var(--dc-sub)" }}>{sub}</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex-none cursor-pointer" style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid var(--dc-line)", background: "var(--dc-card)", color: "var(--dc-ink)", fontSize: 18 }}>×</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" style={{ padding: "18px 24px" }}>{children}</div>
        {footer}
      </div>
    </div>,
    document.body,
  );
}

function NewBatch({ defaultFacility, known, waitingGarments, branchId, onClose, onCreated }: { defaultFacility: string; known: string[]; waitingGarments: number; branchId: string | null | undefined; onClose: () => void; onCreated: (row: Row) => void }) {
  const options = [...new Set([defaultFacility, ...known])];
  const [choice, setChoice] = useState(options[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const facility = choice === "__other" ? other.trim() : choice;
  async function create() {
    if (!branchId) return setError("Choose a branch first.");
    setBusy(true);
    setError("");
    try {
      const b = await api<{ id: string; batchNumber: string; createdAt: string }>("/transfers", { body: { branchId, direction: "to_facility", facilityName: facility } });
      onCreated({ id: b.id, batchNumber: b.batchNumber, direction: "to_facility", facilityName: facility, transportReference: null, status: "draft", createdAt: b.createdAt, dispatchedAt: null, receivedAt: null, expectedBackAt: null, bags: 0, garments: 0, scanned: 0, arrived: 0, atFacility: 0, returnId: null, returnStatus: null, back: 0, backExpected: 0, missing: 0, standalone: false, stage: "packing", doneAt: null });
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Dialog narrow kicker="Step 1 · Send" title="New transfer batch" sub="Pick where this batch is going." onClose={onClose} footer={
      <div className="flex flex-wrap items-center justify-end gap-2" style={{ padding: "14px 24px", borderTop: "1px solid var(--dc-line2)" }}>
        <button type="button" className="dc-press" style={OUTLINE} onClick={onClose}>Cancel</button>
        <button type="button" className="dc-press" style={{ ...GREEN, opacity: busy || facility.length < 2 ? 0.55 : 1 }} disabled={busy || facility.length < 2} onClick={() => void create()}>Create batch</button>
      </div>}>
      {error && <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--dc-red-fg)", fontWeight: 600 }}>{error}</p>}
      <label className="flex min-w-0 flex-col gap-1.5" style={{ fontSize: 14, fontWeight: 600 }}>Facility
        <select data-autofocus value={choice} onChange={(e) => setChoice(e.target.value)} style={FIELD}>{options.map((o) => <option key={o} value={o}>{o}</option>)}<option value="__other">Another facility…</option></select>
      </label>
      {choice === "__other" && <label className="flex min-w-0 flex-col gap-1.5" style={{ fontSize: 14, fontWeight: 600 }}>Facility name<input autoFocus maxLength={80} value={other} onChange={(e) => setOther(e.target.value)} style={FIELD} /></label>}
      <div className="flex flex-col gap-1" style={{ padding: "14px 16px", borderRadius: 14, background: "var(--dc-soft2)", fontSize: 14 }}><strong>{`${garmentsWord(waitingGarments)} waiting to send`}</strong><span>You’ll scan bags and garments on the next step. Nothing is sent until you dispatch.</span></div>
    </Dialog>
  );
}

type Feedback = { kind: "ok" | "warn" | "err"; msg: string; fix?: string };
const FB = { ok: ["✓", "var(--dc-green-bg)", "var(--dc-green-fg)", "Done"], warn: ["!", "var(--dc-amber-bg)", "var(--dc-amber-fg)", "Notice"], err: ["✕", "var(--dc-red-bg)", "var(--dc-red-fg)", "Error"] } as const;

function BatchDialog({ row, mode, canMove, waiting, onChanged, onMode, onClose, onFinished }: { row: Row; mode: Mode; canMove: boolean; waiting: WaitingBag[]; onChanged: () => void; onMode: (m: Mode) => void; onClose: () => void; onFinished: (text: string, tab?: "active" | "done") => void }) {
  const [returnId, setReturnId] = useState(row.returnId);
  const first = useApi<Detail>(`/transfers/${row.id}`);
  const second = useApi<Detail>(returnId && returnId !== row.id ? `/transfers/${returnId}` : null);
  const out = first.data;
  const back = row.standalone ? first.data : second.data;
  const scanning = mode === "pack" || mode === "recv" || mode === "ret";
  // Before the return has started, the list comes from the batch that went out. Opening this moves nothing.
  const notStarted = mode === "ret" && !returnId;
  const b = mode === "ret" && !notStarted ? back : out;
  const starting = useRef<Promise<string> | null>(null);
  /** The garments start coming back at the first scan or at Finish, so an accidental click changes nothing. */
  function returnBatch() {
    if (returnId) return Promise.resolve(returnId);
    starting.current ??= api<{ id: string }>(`/transfers/${row.id}/start-return`, { body: {} }).then((r) => { setReturnId(r.id); return r.id; }).catch((e) => { starting.current = null; throw e; });
    return starting.current;
  }
  const reload = () => { first.reload(); second.reload(); onChanged(); };

  const [code, setCode] = useState("");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [filter, setFilter] = useState<"all" | "missing" | "pending" | "ok">("all");
  const [confirm, setConfirm] = useState<null | "dispatch" | "discard" | "finish">(null);
  const [notes, setNotes] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [expBack, setExpBack] = useState(() => {
    const t = new Date(Date.now() + 24 * 3600000);
    t.setMinutes(0, 0, 0);
    return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [why, setWhy] = useState(false);
  const [lastBag, setLastBag] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const lastScan = useRef({ code: "", at: 0 });
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const readTags = useRef(new Set<string>());
  useEffect(() => { if (scanning && b) scanRef.current?.focus(); }, [scanning, Boolean(b)]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Reads wait their turn, so a handheld's burst is never lost while one is being checked. */
  async function drain() {
    if (draining.current || !b) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const value = queue.current.shift()!;
        try {
          const target = mode === "ret" ? await returnBatch() : b.id;
          const r = await api<{ result: string; message: string }>(`/transfers/${target}/scan`, { body: { code: value } });
          if (r.result === "verified" || r.result === "bag_added" || r.result === "bag_seen") setFb({ kind: "ok", msg: r.message });
          else if (r.result === "duplicate") setFb({ kind: "warn", msg: `Duplicate scan: ${r.message}`, fix: "No action needed." });
          else if (r.result === "not_found") setFb({ kind: "err", msg: r.message, fix: "Check the label is clean and complete, or type the tag." });
          else setFb({ kind: "err", msg: r.message, fix: "Keep it aside and check its order." });
          const bag = b.bags.find((x) => value === x.bagCode);
          if (bag) setLastBag(bag.id);
        } catch (e) {
          setFb({ kind: "err", msg: (e as ApiError).message });
        }
      }
      reload();
    } finally {
      draining.current = false;
      scanRef.current?.focus();
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = expandScanCode(code);
    setCode("");
    if (!value) return setFb({ kind: "err", msg: "Nothing was scanned.", fix: "Point the scanner at the tag, or type it and press Enter." });
    // Some scanners send the code twice or an extra Enter; ignore an identical scan within 800 ms.
    if (lastScan.current.code === value && Date.now() - lastScan.current.at < 800) return;
    lastScan.current = { code: value, at: Date.now() };
    // Holding a handheld's trigger repeats each RFID tag for as long as it is held. Once per step is enough.
    if (normalizeEpc(value) && !/^\d+$/.test(value)) {
      const key = `${b?.status}:${value}`;
      if (readTags.current.has(key)) return;
      readTags.current.add(key);
    }
    queue.current.push(value);
    void drain();
  }
  async function run(work: () => Promise<unknown>, done: string, toTab?: "active" | "done") {
    setBusy(true);
    setError("");
    try {
      await work();
      onFinished(done, toTab);
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }
  async function removeBag(bagId: string) {
    try { await api(`/transfers/${row.id}/bags/${bagId}`, { method: "DELETE" }); reload(); } catch (e) { setFb({ kind: "err", msg: (e as ApiError).message }); }
  }
  async function addBag(bagId: string) {
    try {
      const bag = waiting.find((x) => x.id === bagId);
      await api(`/transfers/${row.id}/bags`, { body: { bagId } });
      setFb({ kind: "ok", msg: `${bag?.bagCode ?? "Bag"} added. Scan its garment tags to verify them.` });
      setLastBag(bagId);
      reload();
    } catch (e) { setFb({ kind: "err", msg: (e as ApiError).message }); }
  }

  const loading = !b || (mode === "view" && Boolean(returnId) && !back);
  const failed = first.error ?? second.error;
  const title = `${row.batchNumber} · ${row.facilityName}`;
  const KICK: Record<string, string> = { pack: "Step 1 · Send", recv: "Step 2 · Receive at facility", ret: "Step 3 · Return receiving", view: "Batch details" };

  if (loading || failed) {
    return (
      <Dialog kicker={KICK[mode]} title={title} sub="" onClose={onClose} footer={<div className="flex justify-end" style={{ padding: "14px 24px", borderTop: "1px solid var(--dc-line2)" }}><button type="button" className="dc-press" style={OUTLINE} onClick={onClose}>Close</button></div>}>
        <p role={failed ? "alert" : "status"} style={{ margin: 0, fontSize: 15, color: failed ? "var(--dc-red-fg)" : "var(--dc-sub)" }}>{failed?.message ?? "Loading…"}</p>
      </Dialog>
    );
  }

  const garments = b!.garments;
  const onWay = TRANSIT[b!.direction];
  // What is expected on this leg: not garments already flagged missing, or already back some other way.
  const expected = notStarted ? garments.filter((g) => g.location === "at_facility") : mode === "ret" ? garments.filter((g) => g.location === onWay || g.receiptVerified) : garments;
  const got = notStarted ? 0 : expected.filter((g) => (mode === "pack" ? g.dispatchVerified : g.receiptVerified)).length;
  const left = expected.length - got;
  const lost = mode === "ret" ? garments.filter((g) => g.location === "missing" && (notStarted || !g.receiptVerified)).length : 0;
  const unscanned = garments.filter((g) => !g.dispatchVerified).length;
  const stage = row.stage;
  const draftReturn = row.standalone && row.status === "draft";

  function stateOf(g: Garment): { label: string; icon: string; bg: string; fg: string; cls: "ok" | "pending" | "missing" } {
    const ok = (label: string) => ({ label, icon: "✓", bg: "var(--dc-green-bg)", fg: "var(--dc-green-fg)", cls: "ok" as const });
    const pending = (label: string) => ({ label, icon: "○", bg: "var(--dc-card)", fg: "var(--dc-sub)", cls: "pending" as const });
    const miss = (label: string) => ({ label, icon: "⚠", bg: "var(--dc-red-bg)", fg: "var(--dc-red-fg)", cls: "missing" as const });
    if (mode === "pack" || stage === "packing" || draftReturn) return g.dispatchVerified ? ok("Packed") : pending("Not scanned");
    if (mode === "recv" || stage === "transit") return g.receiptVerified ? ok("Received") : g.location === "missing" ? miss("Missing") : pending("Not scanned");
    const rg = back?.garments.find((x) => x.id === g.id);
    const now = rg ?? g;
    if (rg?.receiptVerified) return ok("Back");
    if (now.location === "missing") return miss(stage === "done" ? "Missing" : "Missing at facility");
    if (now.location === "at_facility") return pending("At facility");
    if (now.location === "in_transit_to_shop") return pending("Not scanned");
    if (now.location === "shop_storage" || now.location === "collected") return ok("Back");
    return pending(LOCATION_LABELS[now.location as GarmentLocation] ?? now.location);
  }
  const counts = { all: garments.length, ok: 0, pending: 0, missing: 0 };
  garments.forEach((g) => { counts[stateOf(g).cls]++; });
  const okWord = stage === "packing" ? "Packed" : stage === "transit" ? "Received" : "Back";
  const pendingWord = stage === "packing" ? "Not scanned" : stage === "transit" ? "Not scanned" : stage === "at_facility" ? "At facility" : "Not back";

  const shownGarments = (bagId: string) => garments.filter((g) => g.bagId === bagId && (mode !== "view" || filter === "all" || stateOf(g).cls === filter));
  const shownBags = b!.bags.filter((bag) => mode !== "view" || filter === "all" || shownGarments(bag.id).length);

  const history = !out ? [] : [
    ...(back && back.id !== out.id && back.receivedAt ? [{ t: `Return received · ${back.garments.filter((g) => g.receiptVerified).length} back`, at: back.receivedAt, by: back.receivedByName }] : []),
    ...(back && back.id !== out.id && back.dispatchedAt ? [{ t: `Return started · ${back.batchNumber}`, at: back.dispatchedAt, by: back.dispatchedByName }] : []),
    ...(out.receivedAt ? [{ t: `${out.direction === "to_shop" ? "Received at the shop" : "Received at facility"} · ${out.garments.filter((g) => g.receiptVerified).length} of ${out.garments.length}`, at: out.receivedAt, by: out.receivedByName }] : []),
    ...(out.dispatchedAt ? [{ t: `Dispatched · ${bagsWord(out.bags.length)}, ${garmentsWord(out.garments.length)}`, at: out.dispatchedAt, by: out.dispatchedByName }] : []),
    { t: "Batch created", at: out.createdAt, by: out.createdByName },
  ];
  const scans = [...(out?.scans ?? []), ...(back && back.id !== out?.id ? back.scans : [])].sort((x, y) => y.scannedAt.localeCompare(x.scannedAt));

  const expT = new Date(expBack).getTime();
  const askBack = confirm === "dispatch" && b!.direction === "to_facility";
  const expBad = askBack && !(expT > Date.now());
  const emptyPack = garments.length === 0;

  const toNote = (text: string) => <label className="flex min-w-0 flex-col gap-1.5" style={{ fontSize: 14, fontWeight: 600 }}>{text}<textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...FIELD, padding: "10px 12px" }} /></label>;
  let panel: ReactNode = null;
  if (confirm === "dispatch") {
    panel = (
      <ConfirmPanel title={`Dispatch ${row.batchNumber} to ${row.facilityName}?`} text={`${garmentsWord(garments.length)} in ${bagsWord(b!.bags.length)}. You can’t add or remove garments after dispatch.`} list={b!.bags.map((bag) => `${bag.bagCode} · ${garmentsWord(garments.filter((g) => g.bagId === bag.id).length)}`)} ok="Dispatch batch" cancel="Keep packing" tone="green" busy={busy || expBad} error={error} onCancel={() => { setConfirm(null); setError(""); }}
        onGo={() => void run(() => api(`/transfers/${row.id}/dispatch`, { body: { acceptUnverified: unscanned > 0, ...(vehicle.trim() ? { transportReference: vehicle.trim() } : {}), ...(askBack ? { expectedBackAt: new Date(expBack).toISOString() } : {}) } }), `${row.batchNumber} dispatched to ${row.facilityName}.`, "active")}>
        {unscanned > 0 && <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dc-red-fg)" }}>{`${garmentsWord(unscanned)} not scanned into a bag. Dispatching anyway is recorded in the audit log.`}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {askBack && <div className="flex flex-col gap-1.5"><label className="flex min-w-0 flex-col gap-1.5" style={{ fontSize: 14, fontWeight: 600 }}>Expected back<input type="datetime-local" value={expBack} aria-invalid={expBad} onChange={(e) => setExpBack(e.target.value)} style={FIELD} /></label>{expBad && <span role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--dc-red-fg)" }}>Expected return must be in the future.</span>}</div>}
          <label className="flex min-w-0 flex-col gap-1.5" style={{ fontSize: 14, fontWeight: 600 }}>Vehicle or driver (optional)<input maxLength={80} value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. DL 01 AB 1234" style={FIELD} /></label>
        </div>
      </ConfirmPanel>
    );
  } else if (confirm === "discard") {
    panel = <ConfirmPanel title={`Discard draft ${row.batchNumber}?`} text={garments.length ? `The ${garmentsWord(garments.length)} go back to “Waiting to send”.` : "The empty draft will be removed."} ok="Discard batch" cancel="Keep it" tone="red" busy={busy} error={error} onCancel={() => { setConfirm(null); setError(""); }} onGo={() => void run(() => api(`/transfers/${row.id}`, { method: "DELETE" }), `${row.batchNumber} discarded.`)} />;
  } else if (confirm === "finish") {
    const isReturn = mode === "ret";
    panel = (
      <ConfirmPanel title={isReturn ? `Finish with ${garmentsWord(left)} not back?` : `Finish with ${garmentsWord(left)} not scanned?`} text={isReturn ? `They’ll be flagged missing and need a claim or follow-up with ${row.facilityName}. Only a manager can do this.` : "They’ll be flagged missing on this batch so the shop can follow up. They can still be scanned in on return. Only a manager can do this."} list={[isReturn ? `${got} back at the shop` : `${got} received at ${row.facilityName}`, isReturn ? `${left} not back → flagged missing` : `${left} not scanned → flagged missing`]} ok="Flag missing & finish" cancel="Keep scanning" tone="amber" busy={busy || notes.trim().length < 3} error={error} onCancel={() => { setConfirm(null); setError(""); }}
        onGo={() => void run(async () => api(`/transfers/${mode === "ret" ? await returnBatch() : b!.id}/receive`, { body: { partial: true, notes: notes.trim() } }), isReturn ? `${row.batchNumber} return complete.` : `${row.batchNumber} received at the facility.`, isReturn ? "done" : "active")}>
        {toNote("What happened?")}
      </ConfirmPanel>
    );
  }
  const finish = () => (left ? setConfirm("finish") : void run(async () => api(`/transfers/${mode === "ret" ? await returnBatch() : b!.id}/receive`, { body: {} }), mode === "ret" ? `${row.batchNumber} return complete.` : `${row.batchNumber} received at the facility.`, mode === "ret" ? "done" : "active"));

  const action = describe(row, waiting.reduce((n, x) => n + x.garments.length, 0)).action;
  const footer = panel ?? (
    <div className="flex flex-wrap items-center gap-2" style={{ padding: "14px 24px", borderTop: "1px solid var(--dc-line2)" }}>
      {mode === "pack" && <button type="button" onClick={() => setConfirm("discard")} className="dc-press" style={{ ...BTN, border: "1.5px solid transparent", background: "transparent", color: "var(--dc-red-fg)" }}>Discard draft</button>}
      <span className="flex-1" style={{ minWidth: 120, fontSize: 13, color: "var(--dc-sub)" }}>
        {mode === "pack" ? (unscanned ? `Saved as a draft as you go. ${garmentsWord(unscanned)} not scanned yet.` : "Saved as a draft as you go.") : mode === "recv" ? (left ? `${garmentsWord(left)} not scanned yet.` : "All garments received.") : mode === "ret" ? (left ? `${garmentsWord(left)} still expected.` : "Everything expected is back.") : stage === "done" && row.missing ? "Missing garments need a claim or follow-up with the facility." : ""}
      </span>
      <button type="button" className="dc-press" style={OUTLINE} onClick={onClose}>Close</button>
      {mode === "pack" && <button type="button" className="dc-press" aria-disabled={emptyPack} style={{ ...GREEN, opacity: emptyPack ? 0.55 : 1 }} onClick={() => { if (emptyPack) setWhy(true); else setConfirm("dispatch"); }}>Review &amp; dispatch</button>}
      {mode === "recv" && <button type="button" className="dc-press" style={GREEN} disabled={busy} onClick={finish}>Finish receiving</button>}
      {mode === "ret" && (notStarted || b!.status === "dispatched") && <button type="button" className="dc-press" style={GREEN} disabled={busy} onClick={finish}>Finish return</button>}
      {mode === "view" && action && canMove && <button type="button" className="dc-press" style={GREEN} onClick={() => onMode(action.mode)}>{action.label}</button>}
      {why && emptyPack && <span className="text-end" style={{ flexBasis: "100%", fontSize: 13, color: "var(--dc-red-fg)", fontWeight: 600 }}>Add at least one garment first.</span>}
      {error && <span role="alert" className="text-end" style={{ flexBasis: "100%", fontSize: 13, color: "var(--dc-red-fg)", fontWeight: 600 }}>{error}</span>}
    </div>
  );

  const on = describe(row, 0).on;
  const lookStyle = STAGE_STYLE[stage];
  const sub = mode === "pack" ? "Scan a bag label, then every garment tag going into it." : mode === "recv" ? "Unpack each bag and scan every tag." : mode === "ret" ? lost ? `Scan every garment as it comes off the van. ${garmentsWord(lost)} already flagged missing at the facility.` : "Scan every garment as it comes off the van." : `Created ${fmt(row.createdAt)} by ${out?.createdByName ?? "—"}`;
  const FACT = (k: string, v: string, small?: boolean, color?: string) => (
    <div key={k} className="flex min-w-0 flex-col gap-0.5" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--dc-card)", border: "1px solid var(--dc-line)" }}>
      <dt style={{ fontSize: 12, fontWeight: 600, color: "var(--dc-sub)" }}>{k}</dt>
      <dd className="dcd-h" style={{ margin: 0, fontSize: small ? 15 : 22, lineHeight: 1.25, letterSpacing: 0, color: color ?? "var(--dc-ink)", overflowWrap: "anywhere" }}>{v}</dd>
    </div>
  );

  return (
    <Dialog kicker={KICK[mode]} title={title} sub={sub} onClose={() => { if (confirm) { setConfirm(null); setError(""); } else onClose(); }} locked={Boolean(confirm)} footer={footer}>
      {mode === "view" && (
        <>
          <div className="flex flex-col gap-3.5" style={{ padding: 16, borderRadius: 16, background: "var(--dc-soft2)", border: "1px solid var(--dc-line2)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <span style={{ fontSize: 13, fontWeight: 700, padding: "4px 12px", borderRadius: 999, background: lookStyle.bg, color: lookStyle.fg }}>{describe(row, 0).label}</span>
              <Track at={on} large label="Batch progress" />
            </div>
            <dl className="grid gap-2.5" style={{ margin: 0, gridTemplateColumns: "repeat(auto-fit,minmax(112px,1fr))" }}>
              {FACT("Bags", String(row.bags))}
              {FACT("Garments", String(row.garments))}
              {FACT(row.dispatchedAt ? "Sent" : "Created", fmt(row.dispatchedAt ?? row.createdAt), true)}
              {stage === "done" ? FACT("Returned", fmt(row.doneAt ?? row.createdAt), true) : row.expectedBackAt ? FACT(describe(row, 0).late ? "Was due back" : "Back by", fmt(row.expectedBackAt), true, describe(row, 0).late ? "var(--dc-red-fg)" : undefined) : null}
              {FACT("Missing", String(row.missing), false, row.missing ? "var(--dc-red-fg)" : "var(--dc-green-fg)")}
            </dl>
            {row.missing > 0 && (
              <div role="note" className="flex items-start gap-2.5" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--dc-red-bg)", fontSize: 14, color: "var(--dc-red-fg)" }}>
                <span aria-hidden="true" className="grid flex-none place-items-center" style={{ width: 22, height: 22, borderRadius: "50%", background: "#9a3a12", color: "#fff", fontSize: 12, fontWeight: 700 }}>!</span>
                <span>{stage === "done" ? `${garmentsWord(row.missing)} never came back from ${row.facilityName}. Raise a claim with the facility and inform the customer.` : row.missing === 1 ? "1 garment wasn’t scanned at the facility. If it turns up, scan it on return. Otherwise raise a claim." : `${row.missing} garments weren’t scanned at the facility. If they turn up, scan them on return. Otherwise raise a claim.`}</span>
              </div>
            )}
          </div>
          {stage !== "packing" && garments.length > 0 && (
            <div role="group" aria-label="Show garments" className="flex flex-wrap items-center gap-2">
              <span style={{ fontSize: 14, fontWeight: 600, marginInlineEnd: 4 }}>Garments</span>
              {([["all", "All"], ["missing", "Missing"], ["pending", pendingWord], ["ok", okWord]] as const).filter(([id]) => id === "all" || counts[id] > 0).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className="dcd-pill cursor-pointer" style={{ fontSize: 13, fontWeight: 600, minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${filter === id ? "var(--dc-solid)" : "var(--dc-line)"}`, background: filter === id ? "var(--dc-solid)" : "var(--dc-card)", color: filter === id ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{`${label} · ${counts[id]}`}</button>
              ))}
            </div>
          )}
        </>
      )}

      {scanning && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-2" style={{ fontSize: 14 }}><span style={{ fontWeight: 600 }}>{mode === "pack" ? "Scanned into bags" : mode === "recv" ? "Received" : "Back at shop"}</span><strong className="tabular-nums">{`${got} of ${expected.length}`}</strong></div>
            <Progress now={got} max={expected.length} color="var(--dc-green)" height={10} label={mode === "pack" ? "Scanned into bags" : mode === "recv" ? "Received" : "Back at shop"} />
          </div>
          <form onSubmit={submit} className="flex flex-col gap-1.5">
            <label htmlFor="tr-scan" style={{ fontSize: 14, fontWeight: 600 }}>{mode === "pack" ? "Bag label or garment tag" : "Garment tag"}</label>
            <div className="flex gap-2">
              <input id="tr-scan" data-autofocus ref={scanRef} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} placeholder={mode === "pack" ? "e.g. a bag label or garment tag" : "e.g. a garment tag"} aria-invalid={fb?.kind === "err"} className="min-w-0 flex-1 font-mono" style={{ fontSize: 16, minHeight: 48, padding: "0 14px", border: `1.5px solid ${fb?.kind === "err" ? "#b4471a" : "var(--dc-grey)"}`, borderRadius: 12, background: "var(--dc-card)", color: "var(--dc-ink)" }} />
              {/* Stays enabled while reads are checked: browsers ignore the Enter key when a form's button is disabled. */}
              <button type="submit" className="dc-press" style={{ ...SOLID, minHeight: 48 }}>Scan</button>
            </div>
            <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{mode === "pack" ? "Scanning a bag label adds it to this batch. Scan every garment tag to verify what is inside." : mode === "recv" ? "Scan tags in any order. Only garments in this batch are accepted." : "Garments flagged missing at the facility can still be scanned back."}</span>
            <div aria-live="polite" style={{ minHeight: 24 }}>
              {fb && <span className="dcd-pop inline-flex items-start gap-2" style={{ fontSize: 14, fontWeight: 600, padding: "8px 12px", borderRadius: 10, background: FB[fb.kind][1], color: FB[fb.kind][2] }}><span aria-hidden="true">{FB[fb.kind][0]}</span><span className="flex flex-col gap-0.5"><span><span style={SR}>{FB[fb.kind][3]}: </span>{fb.msg}</span>{fb.fix && <span style={{ fontWeight: 500 }}>{fb.fix}</span>}</span></span>}
            </div>
          </form>
        </>
      )}

      {mode === "pack" && b!.bags.length > 0 && (
        <div role="group" aria-label="Bags" className="flex flex-wrap items-center gap-2">
          <span style={{ fontSize: 14, fontWeight: 600, marginInlineEnd: 4 }}>Packing into</span>
          {b!.bags.map((bag, i) => {
            const current = lastBag ? lastBag === bag.id : i === b!.bags.length - 1;
            return <span key={bag.id} className="inline-flex items-center" style={{ fontSize: 14, fontWeight: 600, minHeight: 40, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${current ? "var(--dc-solid)" : "var(--dc-line)"}`, background: current ? "var(--dc-solid)" : "var(--dc-card)", color: current ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{`${bag.bagCode} · ${garments.filter((g) => g.bagId === bag.id).length}`}</span>;
          })}
        </div>
      )}

      {shownBags.map((bag) => {
        const items = shownGarments(bag.id);
        const all = garments.filter((g) => g.bagId === bag.id);
        const c = { ok: 0, pending: 0, missing: 0 };
        all.forEach((g) => { c[stateOf(g).cls]++; });
        const summary = mode === "view" && stage !== "packing" && all.length ? [c.ok ? `${c.ok} ${okWord.toLowerCase()}` : "", c.pending ? `${c.pending} ${pendingWord.toLowerCase()}` : "", c.missing ? `${c.missing} missing` : ""].filter(Boolean).join(" · ") : "";
        return (
          <section key={bag.id} aria-label={`${bag.bagCode}, ${garmentsWord(all.length)}`} style={{ border: "1px solid var(--dc-line)", borderRadius: 16, overflow: "hidden" }}>
            <div className="flex items-center justify-between gap-2" style={{ padding: "10px 14px", background: "var(--dc-soft2)", borderBottom: "1px solid var(--dc-line2)" }}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{bag.bagCode} <span style={{ fontWeight: 500, color: "var(--dc-sub)" }}>· {garmentsWord(all.length)}</span></h3>
                <span style={{ fontSize: 13, color: "var(--dc-sub)" }}><a href={`/orders/view?id=${bag.orderId}`} style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}>{bag.orderNumber}</a>{` · ${bag.customerName}`}{summary ? ` · ${summary}` : ""}</span>
              </div>
              {mode === "pack" && <button type="button" aria-label={`Remove bag ${bag.bagCode}`} onClick={() => void removeBag(bag.id)} className="cursor-pointer" style={{ fontSize: 13, fontWeight: 600, minHeight: 32, padding: "0 10px", border: 0, background: "transparent", color: "var(--dc-red-fg)", textDecoration: "underline", textUnderlineOffset: 3 }}>Remove bag</button>}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((g) => {
                const st = stateOf(g);
                return (
                  <li key={g.id} className="flex flex-wrap items-center justify-between" style={{ gap: "8px 10px", padding: "10px 14px", borderTop: "1px solid var(--dc-soft)", background: "var(--dc-card)" }}>
                    <span className="flex min-w-0 flex-col" style={{ flex: "1 1 200px", lineHeight: 1.35 }}>
                      <span className="font-mono" style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{g.tagCode}</span>
                      <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{g.garmentType}{g.colour ? ` · ${g.colour}` : ""}{` · ${g.service}`}</span>
                    </span>
                    <span className="whitespace-nowrap" style={{ fontSize: 13, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.fg, border: st.cls === "pending" ? "1px solid var(--dc-line)" : 0 }}><span aria-hidden="true">{st.icon} </span>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {mode === "view" && garments.length > 0 && !shownBags.length && <p style={{ margin: 0, padding: 20, borderRadius: 14, border: "1.5px dashed var(--dc-line)", textAlign: "center", fontSize: 14, color: "var(--dc-sub)" }}>No garments in this view.</p>}
      {scanning && b!.bags.length === 0 && <p style={{ margin: 0, padding: 20, borderRadius: 14, border: "1.5px dashed var(--dc-line)", textAlign: "center", fontSize: 14, color: "var(--dc-sub)" }}>No bags yet. Scan a bag label to add it to this batch.</p>}

      {mode === "pack" && b!.direction === "to_facility" && (
        <details style={{ border: "1px solid var(--dc-line)", borderRadius: 16, padding: "4px 14px" }}>
          <summary className="flex cursor-pointer items-center justify-between" style={{ listStyle: "none", minHeight: 44, fontSize: 15, fontWeight: 700 }}>{`Waiting to send · ${garmentsWord(waiting.reduce((n, x) => n + x.garments.length, 0))}`}<span style={{ fontSize: 13, fontWeight: 500, color: "var(--dc-sub)" }}>No scanner? Add from here</span></summary>
          <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: "0 0 10px" }}>
            {waiting.map((w) => (
              <li key={w.id} className="grid items-center gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) auto", padding: "8px 0", borderTop: "1px solid var(--dc-soft)" }}>
                <span className="flex min-w-0 flex-col" style={{ lineHeight: 1.35 }}>
                  <span className="font-mono" style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{w.bagCode}</span>
                  <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{`${w.garments.map((g) => g.garmentType).join(", ")} · ${w.customerName}`}</span>
                </span>
                <button type="button" aria-label={`Add ${w.bagCode} to this batch`} onClick={() => void addBag(w.id)} className="dc-press cursor-pointer" style={{ fontSize: 13, fontWeight: 600, minHeight: 36, padding: "0 12px", borderRadius: 999, border: "1.5px solid var(--dc-solid)", background: "var(--dc-card)", color: "var(--dc-ink)" }}>Add to batch</button>
              </li>
            ))}
            {!waiting.length && <li style={{ padding: "8px 0", fontSize: 14, color: "var(--dc-sub)" }}>Nothing else is waiting to send.</li>}
          </ul>
        </details>
      )}

      {mode === "view" && (
        <div className="flex flex-col gap-1.5">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>History <span style={{ fontWeight: 500, color: "var(--dc-sub)" }}>· {history.length === 1 ? "1 entry" : `${history.length} entries`}</span></h3>
          <ol style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {history.map((h, k) => (
              <li key={`${h.t}${h.at}`} className="relative flex flex-col gap-0.5" style={{ padding: "0 0 16px", paddingInlineStart: 28, fontSize: 14 }}>
                {k < history.length - 1 && <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 5, top: 16, bottom: 0, width: 2, background: "var(--dc-line)" }} />}
                <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 0, top: 4, width: 12, height: 12, borderRadius: "50%", background: k === 0 ? "var(--dc-green)" : "var(--dc-grey)", boxShadow: `0 0 0 3px ${k === 0 ? "var(--dc-green-bg)" : "var(--dc-soft)"}` }} />
                <span style={{ fontWeight: 600 }}>{h.t}</span>
                <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{`${fmt(h.at)} · ${h.by ?? "—"}`}</span>
              </li>
            ))}
          </ol>
          {scans.length > 0 && (
            <details style={{ border: "1px solid var(--dc-line)", borderRadius: 16, padding: "4px 14px" }}>
              <summary className="flex cursor-pointer items-center" style={{ listStyle: "none", minHeight: 44, fontSize: 15, fontWeight: 700 }}>{`Scan log · ${scans.length}`}</summary>
              <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: "0 0 10px", maxHeight: 280, overflowY: "auto" }}>
                {scans.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2" style={{ padding: "6px 0", borderTop: "1px solid var(--dc-soft)", fontSize: 13 }}><span className="font-mono">{s.code}</span><span style={{ color: "var(--dc-sub)" }}>{`${s.result.replace("_", " ")} · ${fmt(s.scannedAt)}${s.scannedBy ? ` · ${s.scannedBy}` : ""}`}</span></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}

const TRANSIT: Record<string, string> = { to_facility: "in_transit_to_facility", to_shop: "in_transit_to_shop" };

function ConfirmPanel({ title, text, list, ok, cancel, tone, busy, error, onCancel, onGo, children }: { title: string; text: string; list?: string[]; ok: string; cancel: string; tone: "green" | "red" | "amber"; busy: boolean; error: string; onCancel: () => void; onGo: () => void; children?: ReactNode }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  const look = { green: { border: "var(--dc-green)", bg: "var(--dc-green-bg)", btn: { background: "var(--dc-green)", borderColor: "var(--dc-green)", color: "#151514" } }, red: { border: "var(--dc-red-fg)", bg: "var(--dc-red-bg)", btn: { background: "#9a3a12", borderColor: "#9a3a12", color: "#fff" } }, amber: { border: "var(--dc-amber-fg)", bg: "var(--dc-amber-bg)", btn: {} } }[tone];
  return (
    <div role="alertdialog" aria-label={title} className="flex flex-none flex-col gap-3 overflow-y-auto" style={{ padding: "16px 24px", borderTop: `1.5px solid ${look.border}`, background: look.bg, maxHeight: "60vh" }}>
      <strong style={{ fontSize: 15 }}>{title}</strong>
      <span style={{ fontSize: 14 }}>{text}</span>
      {list?.length ? <ul className="flex flex-col gap-0.5" style={{ margin: 0, paddingInlineStart: 20, fontSize: 14, listStyle: "disc" }}>{list.map((l) => <li key={l}>{l}</li>)}</ul> : null}
      {children}
      {error && <span role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--dc-red-fg)" }}>{error}</span>}
      <div className="flex flex-wrap justify-end gap-2">
        <button ref={cancelRef} type="button" className="dc-press" style={OUTLINE} onClick={onCancel}>{cancel}</button>
        <button type="button" className="dc-press" disabled={busy} onClick={onGo} style={{ ...SOLID, ...look.btn, opacity: busy ? 0.55 : 1 }}>{ok}</button>
      </div>
    </div>
  );
}

export default function TransfersPage() {
  return <Suspense><TransfersInner /></Suspense>;
}
