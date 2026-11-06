"use client";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { STAGE_LABELS, type GarmentStage } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { appLocale, appZone, money } from "@/lib/format";
import { DcDialog } from "@/components/DcDialog";

type Ex = {
  id: string; number: number; kind: string; notes: string | null; status: "open" | "resolved"; resolution: string | null; outcome: string | null; details: Record<string, string | boolean> | null; version: number; createdAt: string; updatedAt: string; resolvedAt: string | null; reopenedAt: string | null;
  garmentId: string; tagCode: string; location: string; stage: string; workflowStages: string[]; garmentType: string; orderId: string; orderNumber: string; customerName: string; batchNumber: string | null; facilityName: string | null; batchDirection: string | null; createdByName: string | null; resolvedByName: string | null; reopenedByName: string | null;
};
type HistoryRow = { id: string; kind: string; text: string; createdAt: string; by: string | null };
type Field = { key: string; type: "input" | "area" | "select" | "check"; label: string; help?: string; ph?: string; opts?: { value: string; label: string }[]; wide?: boolean; ro?: boolean; check: (v: string, e: Ex, f: Record<string, string>) => string | null };
type Outcome = { id: string; label: string; help: string; fields: string[]; confirm: string };

const OVERDUE_HOURS = 48;
/** "Open" as a status. Elsewhere "Open" is a verb on a button and translates differently, so this has its own key; the mark does not show. */
const OPEN_STATUS = "Open\u2060";
const TYPES: Record<string, { label: string; bg: string; fg: string; icon: string; bar: string; short: string }> = {
  missing: { label: "Missing in transit", bg: "var(--dc-red-bg)", fg: "var(--dc-red-fg)", icon: "⚠", bar: "#b4471a", short: "Missing" },
  damaged: { label: "Damaged", bg: "var(--dc-amber-bg)", fg: "var(--dc-amber-fg)", icon: "!", bar: "#c9a227", short: "Damaged" },
  wrong_tag: { label: "Wrong tag", bg: "var(--dc-blue-bg)", fg: "var(--dc-blue-fg)", icon: "#", bar: "#3d6fb5", short: "Wrong tag" },
  delayed: { label: "Delayed", bg: "var(--dc-soft)", fg: "var(--dc-ink)", icon: "◷", bar: "#8a8780", short: "Delayed" },
};
const COMP: Outcome = { id: "comp", label: "Customer compensated", help: "Record the amount, how it was paid and the reference.", fields: ["amount", "method", "txn"], confirm: "Confirm compensation" };
const ACCEPT: Outcome = { id: "accepted", label: "Customer informed and accepted", help: "Customer agreed to take the garment as it is.", fields: [], confirm: "Confirm acceptance" };
const OUTCOMES: Record<string, Outcome[]> = {
  missing: [{ id: "found", label: "Found and scanned back", help: "The garment turned up. Scan its tag to confirm.", fields: ["tagScan", "foundWhere", "foundAt"], confirm: "Confirm found" }, { id: "claim", label: "Claim raised with the facility", help: "Record the facility’s claim reference and details.", fields: ["ref", "claimDetail"], confirm: "Confirm claim" }, COMP],
  damaged: [ACCEPT, COMP, { id: "rework", label: "Sent back for re-processing", help: "The garment goes back to production for another attempt.", fields: ["step"], confirm: "Confirm re-processing" }],
  wrong_tag: [{ id: "retag", label: "Re-tagged", help: "A new tag was printed and attached to the garment.", fields: ["oldTag", "newTag", "verify"], confirm: "Confirm re-tag" }, { id: "matched", label: "Matched to the correct order", help: "The garment belongs to a different order.", fields: ["correctOrder", "verify"], confirm: "Confirm match" }],
  delayed: [ACCEPT, COMP],
};
const allOutcomes = Object.values(OUTCOMES).flat();
const list = (...v: string[]) => v.map((x) => ({ value: x, label: x }));
const FIELDS: Record<string, Field> = {
  dmg: { key: "dmg", type: "area", label: "Damage details", help: "Where the damage is and what it looks like.", ph: "e.g. Colour bleed along the lower border, about 10 cm", wide: true, check: (v) => (v.trim().length < 10 ? "Describe the damage in at least 10 characters." : null) },
  evid: { key: "evid", type: "select", label: "Supporting evidence", help: "What backs this up.", opts: list("Photo on file", "Customer signed note", "Inspected by supervisor"), check: (v) => (!v ? "Choose the supporting evidence." : null) },
  tagScan: { key: "tagScan", type: "input", label: "Garment tag", help: "Scan or type. Must match the missing garment’s tag.", check: (v) => (!v.trim() ? "Scan or type the garment’s tag." : null) },
  foundWhere: { key: "foundWhere", type: "input", label: "Where it was found", ph: "e.g. In the next day’s return bag", check: (v) => (v.trim().length < 3 ? "Say where it was found." : null) },
  foundAt: { key: "foundAt", type: "select", label: "Where is it now?", opts: [{ value: "shop_storage", label: "Back at the shop" }, { value: "at_facility", label: "At the facility" }], check: (v) => (!v ? "Choose where the garment is now." : null) },
  ref: { key: "ref", type: "input", label: "Claim reference", help: "From the facility’s claim email or slip.", ph: "e.g. CP-CLM-2291", check: (v) => (v.trim().length < 3 ? "Enter the claim reference (at least 3 characters)." : null) },
  claimDetail: { key: "claimDetail", type: "area", label: "Claim details", help: "What was claimed and who you spoke to.", ph: "e.g. Claimed full value, spoke to Mr Rao at the plant", wide: true, check: (v) => (v.trim().length < 5 ? "Add the claim details (at least 5 characters)." : null) },
  amount: { key: "amount", type: "input", label: "Amount", ph: "e.g. 450", check: (v) => (!v.trim() ? "Enter the amount." : !/^\d+(\.\d{1,2})?$/.test(v.trim()) || !(Number(v) > 0) ? "Enter an amount above zero, with up to 2 decimals." : null) },
  method: { key: "method", type: "select", label: "Paid by", opts: list("Cash", "UPI", "Card refund", "Store credit", "Bank transfer"), check: (v) => (!v ? "Choose how the customer was paid." : null) },
  txn: { key: "txn", type: "input", label: "Transaction / credit reference", help: "Required for everything except cash.", ph: "e.g. UPI ref 432198765012", check: (v, _e, f) => (f.method && f.method !== "Cash" && v.trim().length < 4 ? "Enter the transaction or credit reference." : null) },
  step: { key: "step", type: "select", label: "Send back to", check: (v) => (!v ? "Choose where the garment goes." : null) },
  oldTag: { key: "oldTag", type: "input", label: "Old tag", help: "From this exception. Can’t be changed.", ro: true, check: () => null },
  newTag: { key: "newTag", type: "input", label: "New tag", help: "As printed on the new label.", check: (v, e) => (v.trim().length < 4 ? "Enter the new tag as printed." : v.trim().toUpperCase() === e.tagCode.toUpperCase() ? "The new tag must be different from the old one." : null) },
  correctOrder: { key: "correctOrder", type: "input", label: "Correct order", help: "The order number it really belongs to.", check: (v, e) => (!v.trim() ? "Enter the order number." : v.trim().toUpperCase() === e.orderNumber.toUpperCase() ? "That’s the same order. Choose the order it really belongs to." : null) },
  verify: { key: "verify", type: "check", label: "I checked the garment against the tag/order in person", wide: true, check: (v) => (v !== "yes" ? "Confirm you checked the garment in person." : null) },
  note: { key: "note", type: "area", label: "Resolution note (internal)", help: "Required. Kept in the history. Never shown to the customer.", ph: "What happened and what the customer was told", wide: true, check: (v) => (v.trim().length < 5 ? "Write at least 5 characters so others understand what happened." : null) },
};
const REVIEW_LABEL: Record<string, string> = { dmg: "Damage", evid: "Evidence", tagScan: "Tag scanned", foundWhere: "Found", foundAt: "Now at", ref: "Claim reference", claimDetail: "Claim details", amount: "Amount", method: "Paid by", txn: "Reference", step: "Send back to", oldTag: "Old tag", newTag: "New tag", correctOrder: "Correct order", verify: "Checked in person" };

const BTN: CSSProperties = { fontSize: 14, fontWeight: 600, minHeight: 44, padding: "0 18px", borderRadius: 999, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 };
const OUTLINE: CSSProperties = { ...BTN, border: "1.5px solid var(--dc-solid)", background: "var(--dc-card)", color: "var(--dc-ink)" };
const SOLID: CSSProperties = { ...BTN, border: "1.5px solid var(--dc-solid)", background: "var(--dc-solid)", color: "var(--dc-on-solid)" };
const GREEN: CSSProperties = { ...BTN, padding: "0 20px", border: "1.5px solid var(--dc-green)", background: "var(--dc-green)", color: "#151514" };
const INPUT: CSSProperties = { fontSize: 15, width: "100%", minHeight: 44, padding: "0 12px", borderRadius: 12, background: "var(--dc-card)", color: "var(--dc-ink)" };
const SR: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

const code = (e: Ex) => `EX-${String(e.number).padStart(4, "0")}`;
const fmt = (t: string) => new Date(t).toLocaleString(appLocale(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: appZone() });
function dur(ms: number) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (h < 24) return `${h}h`;
  const rest = h % 24;
  return rest ? `${Math.floor(h / 24)}d ${rest}h` : `${Math.floor(h / 24)}d`;
}
const isOverdue = (e: Ex) => e.status === "open" && Date.now() - new Date(e.createdAt).getTime() > OVERDUE_HOURS * 3600000;
const typeOf = (e: Ex) => TYPES[e.kind] ?? TYPES.delayed;
const outcomeOf = (e: Ex) => allOutcomes.find((o) => o.id === e.outcome);
function sourceOf(e: Ex) {
  if (e.batchNumber) return [e.kind === "missing" ? (e.batchDirection === "to_shop" ? "Not back from facility" : "Not scanned at facility") : "Found during a transfer", `batch ${e.batchNumber}`, e.facilityName].filter(Boolean).join(" · ");
  return `Garment stage: ${STAGE_LABELS[e.stage as GarmentStage] ?? e.stage}`;
}
function detailText(e: Ex) {
  const d = e.details;
  if (!d) return "";
  const parts: string[] = [];
  if (d.amount) parts.push(money(Math.round(Number(d.amount) * 100)), String(d.method ?? ""));
  if (d.ref) parts.push(`claim ${d.ref}`);
  if (d.newTag) parts.push(`${d.oldTag} → ${d.newTag}`);
  if (d.correctOrder) parts.push(`order ${d.correctOrder}`);
  if (d.step) parts.push(`to ${(STAGE_LABELS[d.step as GarmentStage] ?? String(d.step)).toLowerCase()}`);
  if (d.foundWhere) parts.push(`found: ${d.foundWhere}`);
  return parts.filter(Boolean).join(" · ");
}

export default function ExceptionsPage() {
  const { session, can } = useSession();
  const all = useApi<Ex[]>("/garment-exceptions?status=all");
  const rows = useMemo(() => all.data ?? [], [all.data]);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [type, setType] = useState("all");
  const [od, setOd] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("oldest");
  const [dlg, setDlg] = useState<{ mode: "view" | "resolve"; id: string } | null>(null);
  const [toast, setToast] = useState("");
  const isManager = can("garments.override");
  const meName = session.user.name;
  const meRole = session.role.name;

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3800); return () => clearTimeout(t); }, [toast]);

  const opens = rows.filter((e) => e.status === "open");
  const resolved = rows.filter((e) => e.status === "resolved");
  const inTab = tab === "open" ? opens : resolved;
  const needle = q.trim().toLowerCase();
  const matched = inTab.filter((e) => (type === "all" || e.kind === type) && (!od || isOverdue(e)) && (!needle || [code(e), e.tagCode, e.customerName, e.orderNumber, e.garmentType].some((v) => v.toLowerCase().includes(needle))));
  const time = (t: string | null) => new Date(t ?? 0).getTime();
  const SORTS: Record<string, (a: Ex, b: Ex) => number> = { oldest: (a, b) => time(a.createdAt) - time(b.createdAt), newest: (a, b) => time(b.createdAt) - time(a.createdAt), overdue: (a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || time(a.createdAt) - time(b.createdAt), updated: (a, b) => time(b.updatedAt) - time(a.updatedAt) };
  const shown = [...matched].sort(SORTS[sort]);
  const filtered = Boolean(needle) || type !== "all" || od;
  const clear = () => { setType("all"); setOd(false); setQ(""); };

  const kpis = [
    { id: "open", label: OPEN_STATUS, n: opens.length, hint: "Waiting for a manager", go: { tab: "open" as const, type: "all", od: false } },
    { id: "overdue", label: "Overdue", n: opens.filter(isOverdue).length, hint: `Open more than ${OVERDUE_HOURS} hours`, go: { tab: "open" as const, type: "all", od: true } },
    { id: "missing", label: "Missing", n: opens.filter((e) => e.kind === "missing").length, hint: "Open · in transit", go: { tab: "open" as const, type: "missing", od: false } },
    { id: "damaged", label: "Damaged", n: opens.filter((e) => e.kind === "damaged").length, hint: "Open · found at QC", go: { tab: "open" as const, type: "damaged", od: false } },
    { id: "resolved", label: "Resolved", n: resolved.length, hint: "Kept for the record", go: { tab: "resolved" as const, type: "all", od: false } },
  ];
  const kinds = [{ id: "all", label: "All", n: inTab.length }, ...["missing", "damaged", "wrong_tag", "delayed"].map((k) => ({ id: k, label: TYPES[k].short, n: inTab.filter((e) => e.kind === k).length })).filter((k) => k.id !== "delayed" || k.n > 0)];
  const current = dlg ? rows.find((e) => e.id === dlg.id) : undefined;

  return (
    <div className="dcd flex flex-col gap-[18px] pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1" style={{ maxWidth: 760 }}>
          <h1 className="dcd-h m-0" style={{ fontSize: 34, lineHeight: 1.15 }}>Garment exceptions</h1>
          <span style={{ fontSize: 15, color: "var(--dc-sub)" }}>Garments that went missing in transit or were found damaged or wrongly tagged. They stay here until a manager resolves them.</span>
        </div>
        {meName && (
          <span className="inline-flex items-center gap-2.5" style={{ minHeight: 44, padding: "0 14px 0 6px", borderRadius: 999, background: "var(--dc-card)", border: "1px solid var(--dc-line)", fontSize: 14 }}>
            <span aria-hidden="true" className="grid place-items-center" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--dc-green)", color: "#151514", fontWeight: 700 }}>{meName[0]?.toUpperCase()}</span>
            <span>Signed in as <strong>{meName}</strong>{meRole ? ` · ${meRole}` : ""}</span>
          </span>
        )}
      </div>

      {all.error && <div role="alert" className="flex flex-wrap items-center gap-3" style={{ padding: "14px 16px", borderRadius: 14, background: "var(--dc-red-bg)", color: "var(--dc-red-fg)", fontSize: 14 }}><span className="flex-1" style={{ minWidth: 220 }}>{all.error.message}</span><button type="button" className="dc-press" style={{ ...OUTLINE, minHeight: 40 }} onClick={() => all.reload()}>Try again</button></div>}

      <div role="group" aria-label="Summary" className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {kpis.map((k) => {
          const on = tab === k.go.tab && type === k.go.type && od === k.go.od && !needle;
          const warn = k.id === "overdue" && k.n > 0;
          return (
            <button key={k.id} type="button" aria-pressed={on} onClick={() => { setTab(k.go.tab); setType(k.go.type); setOd(k.go.od); setQ(""); }} className="dcd-lift flex cursor-pointer flex-col gap-1.5 text-start" style={{ padding: "14px 16px", borderRadius: 16, border: `1.5px solid ${on ? "var(--dc-solid)" : warn ? "#e8b8a3" : "var(--dc-line)"}`, background: on ? "var(--dc-solid)" : "var(--dc-card)", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</span>
              <span className="dcd-h" style={{ fontSize: 30, lineHeight: 1, letterSpacing: 0, color: on ? "var(--dc-on-solid)" : warn ? "var(--dc-red-fg)" : "var(--dc-ink)" }}>{k.n}</span>
              <span style={{ fontSize: 12, color: on ? "var(--dc-on-solid)" : "var(--dc-sub)", opacity: on ? 0.8 : 1 }}>{k.hint}</span>
            </button>
          );
        })}
      </div>

      <section aria-label="Exceptions" style={{ background: "var(--dc-card)", border: "1px solid var(--dc-line)", borderRadius: 20, overflow: "hidden" }}>
        <div className="flex flex-col gap-3" style={{ padding: "14px 16px", borderBottom: "1px solid var(--dc-line2)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Exception status" className="relative inline-grid" style={{ gridTemplateColumns: "1fr 1fr", padding: 4, borderRadius: 12, background: "var(--dc-soft)", border: "1px solid var(--dc-line)" }}>
              <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4, insetInlineStart: tab === "open" ? 4 : "50%", width: "calc(50% - 4px)", borderRadius: 9, background: "var(--dc-card)", border: "1.5px solid var(--dc-solid)", boxShadow: "0 1px 4px rgba(21,21,20,.14)", transition: "inset-inline-start .45s cubic-bezier(.2,.8,.2,1)" }} />
              {([["open", OPEN_STATUS, opens.length], ["resolved", "Resolved", resolved.length]] as const).map(([id, label, n]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="relative z-[1] cursor-pointer whitespace-nowrap" style={{ fontSize: 14, fontWeight: 600, minHeight: 40, padding: "0 16px", border: 0, borderRadius: 9, background: "transparent", color: tab === id ? "var(--dc-ink)" : "var(--dc-sub)", transition: "color .35s ease" }}>
                  {label} · <span style={{ display: "inline-block", minWidth: "1.2em", padding: "0 6px", borderRadius: 999, background: tab === id ? (id === "open" && n ? "var(--dc-red-bg)" : "var(--dc-green-bg)") : "transparent", color: tab === id && id === "open" && n ? "var(--dc-red-fg)" : "inherit", transition: "background .35s ease" }}>{n}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2.5" style={{ flex: "1 1 260px", maxWidth: 420, minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1.5px solid var(--dc-grey)", background: "var(--dc-card)" }}>
              <Search aria-hidden="true" size={16} style={{ color: "var(--dc-sub)", flex: "none" }} />
              <span style={SR}>Search exceptions</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Exception ID, tag, customer or order" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 outline-none" style={{ fontSize: 15, border: 0, background: "transparent", color: "var(--dc-ink)", minHeight: 40 }} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Exception type" className="flex flex-wrap gap-1.5">
              {kinds.map((k) => {
                const on = type === k.id;
                return <button key={k.id} type="button" aria-pressed={on} onClick={() => setType(k.id)} className="dcd-pill cursor-pointer" style={{ fontSize: 13, fontWeight: 600, minHeight: 36, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${on ? "var(--dc-solid)" : "var(--dc-line)"}`, background: on ? "var(--dc-solid)" : "var(--dc-card)", color: on ? "var(--dc-on-solid)" : "var(--dc-ink)" }}>{`${k.label} · ${k.n}`}</button>;
              })}
              <button type="button" aria-pressed={od} onClick={() => setOd(!od)} className="dcd-pill cursor-pointer" style={{ fontSize: 13, fontWeight: 600, minHeight: 36, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${od ? "#9a3a12" : "var(--dc-line)"}`, background: od ? "#9a3a12" : "var(--dc-card)", color: od ? "#fff" : "var(--dc-ink)" }}><span aria-hidden="true">◷ </span>{`Overdue only · ${inTab.filter(isOverdue).length}`}</button>
            </div>
            <label className="flex items-center gap-2 ms-auto" style={{ fontSize: 14, fontWeight: 600 }}>Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="cursor-pointer" style={{ fontSize: 14, minHeight: 40, padding: "0 10px", border: "1.5px solid var(--dc-grey)", borderRadius: 10, background: "var(--dc-card)", color: "var(--dc-ink)" }}><option value="oldest">Oldest reported</option><option value="newest">Newest reported</option><option value="overdue">Longest overdue</option><option value="updated">Recently updated</option></select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2.5" style={{ fontSize: 13, color: "var(--dc-sub)" }}>
            <span role="status">{tab === "open" ? `Showing ${shown.length} of ${inTab.length} open exceptions` : `Showing ${shown.length} of ${inTab.length} resolved exceptions`}</span>
            {filtered && <button type="button" onClick={clear} className="cursor-pointer" style={{ fontSize: 13, fontWeight: 600, minHeight: 32, padding: "0 6px", border: 0, background: "transparent", color: "var(--dc-blue-fg)", textDecoration: "underline", textUnderlineOffset: 3 }}>Clear filters</button>}
          </div>
        </div>
        <div role="tabpanel" key={`${tab}${type}${od}`}>
          {!all.data ? (
            <p role="status" style={{ margin: 0, padding: "56px 20px", textAlign: "center", fontSize: 15, color: "var(--dc-sub)" }}>Loading exceptions…</p>
          ) : !shown.length ? (
            <div className="flex flex-col items-center gap-2 text-center" style={{ padding: "56px 20px" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{filtered && inTab.length ? "No exceptions match your search or filters" : tab === "open" ? "No open exceptions" : "Nothing resolved yet"}</span>
              <span style={{ fontSize: 14, color: "var(--dc-sub)" }}>{filtered && inTab.length ? "Try a different search, or clear the filters." : tab === "open" ? "Every garment in transit is accounted for." : "Resolved exceptions are kept here for the record."}</span>
              {filtered && inTab.length > 0 && <button type="button" className="dc-press mt-1.5" style={OUTLINE} onClick={clear}>Clear filters</button>}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shown.map((e, j) => {
                const T = typeOf(e), open = e.status === "open", late = isOverdue(e), oc = outcomeOf(e);
                const age = Date.now() - new Date(e.createdAt).getTime();
                return (
                  <li key={e.id} className="dcd-pop dcd-row grid items-center lg:grid-cols-[minmax(0,1.6fr)_minmax(200px,1fr)_auto]" style={{ gap: "12px 20px", padding: "16px 20px", borderTop: j ? "1px solid var(--dc-line2)" : 0, boxShadow: `inset 3px 0 0 ${open ? T.bar : "var(--dc-line)"}`, animationDelay: `${Math.min(j, 10) * 60}ms` }}>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span style={{ fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: T.bg, color: T.fg }}><span aria-hidden="true">{T.icon} </span>{T.label}</span>
                        {late && <span style={{ fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#9a3a12", color: "#fff" }}><span aria-hidden="true">◷ </span>{`Overdue by ${dur(age - OVERDUE_HOURS * 3600000)}`}</span>}
                        {open && e.reopenedAt && <span style={{ fontSize: 13, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "var(--dc-soft)" }}>Reopened</span>}
                        <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{code(e)}</span>
                      </div>
                      <button type="button" onClick={() => setDlg({ mode: "view", id: e.id })} className="dc-ex-link cursor-pointer self-start text-start" style={{ fontSize: 15, fontWeight: 700, padding: "2px 0", minHeight: 28, border: 0, background: "transparent", textDecoration: "underline", textUnderlineOffset: 4, overflowWrap: "anywhere" }}>{e.garmentType} · <span className="font-mono" style={{ fontSize: 14 }}>{e.tagCode}</span><span style={SR}>, view details</span></button>
                      <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>{e.customerName} · Order <a href={`/orders/view?id=${e.orderId}`} className="dc-ex-link" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>{e.orderNumber}</a></span>
                      <span style={{ fontSize: 13, color: "var(--dc-sub)", overflowWrap: "anywhere" }}>{sourceOf(e)}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{open ? "Open for" : "Resolved"}</span>
                      <strong style={{ fontSize: 15, color: late ? "var(--dc-red-fg)" : "var(--dc-ink)", overflowWrap: "anywhere" }}>{open ? dur(age) : oc?.label ?? e.resolution}</strong>
                      <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{open ? `Reported ${fmt(e.createdAt)} by ${e.createdByName ?? "—"}` : `${fmt(e.resolvedAt ?? e.updatedAt)} by ${e.resolvedByName ?? "—"}`}</span>
                      {open && e.reopenedAt && <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{`Reopened ${fmt(e.reopenedAt)} by ${e.reopenedByName ?? "—"}`}</span>}
                    </div>
                    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                      <button type="button" className="dc-press dcd-lift" aria-label={`Details for ${code(e)}, ${e.garmentType}`} onClick={() => setDlg({ mode: "view", id: e.id })} style={{ ...OUTLINE, minHeight: 40, borderColor: "var(--dc-line)" }}>Details</button>
                      {open && isManager && <button type="button" className="dc-press dcd-lift" aria-label={`Resolve ${code(e)}, ${e.garmentType}`} onClick={() => setDlg({ mode: "resolve", id: e.id })} style={{ ...SOLID, minHeight: 40 }}>Resolve</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {dlg && current && <ExceptionDialog key={`${current.id}:${dlg.mode}`} e={current} mode={dlg.mode} isManager={isManager} canNote={can("garments.process")} canClaim={can("complaints.manage")} onMode={(mode) => setDlg({ mode, id: current.id })} onClose={() => setDlg(null)} onChanged={() => all.reload()} onDone={(text, toTab) => { setDlg(null); all.reload(); setToast(text); if (toTab) { setTab(toTab); clear(); } }} />}
      {toast && <div role="status" style={{ position: "fixed", insetInlineStart: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, background: "#151514", color: "#faf8f4", padding: "12px 18px", borderRadius: 12, fontSize: 14, boxShadow: "0 12px 32px rgba(0,0,0,.3)", maxWidth: "calc(100% - 32px)" }}>{toast}</div>}
    </div>
  );
}

function ExceptionDialog({ e, mode, isManager, canNote, canClaim, onMode, onClose, onChanged, onDone }: { e: Ex; mode: "view" | "resolve"; isManager: boolean; canNote: boolean; canClaim: boolean; onMode: (m: "view" | "resolve") => void; onClose: () => void; onChanged: () => void; onDone: (text: string, tab?: "open" | "resolved") => void }) {
  const T = typeOf(e), open = e.status === "open", late = isOverdue(e), oc0 = outcomeOf(e);
  const age = Date.now() - new Date(e.createdAt).getTime();
  const history = useApi<HistoryRow[]>(mode === "view" ? `/garment-exceptions/${e.id}/history` : null);
  const [form, setForm] = useState<Record<string, string>>({ oldTag: e.tagCode });
  const [tried, setTried] = useState(false);
  const [review, setReview] = useState(false);
  const [version, setVersion] = useState(e.version);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; stale?: boolean } | null>(null);
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState("");
  const [noteKind, setNoteKind] = useState<"internal" | "customer">("internal");
  const [note, setNote] = useState("");
  const [noteTried, setNoteTried] = useState(false);

  const list = OUTCOMES[e.kind] ?? OUTCOMES.delayed;
  const oc = list.find((o) => o.id === form.outcome);
  const keys = oc ? [...(e.kind === "damaged" ? ["dmg", "evid"] : []), ...oc.fields, "note"] : ["note"];
  const fieldOf = (k: string): Field => (k === "step" ? { ...FIELDS.step, opts: e.workflowStages.map((s) => ({ value: s, label: STAGE_LABELS[s as GarmentStage] ?? s })) } : FIELDS[k]);
  const problems = keys.map((k) => ({ k, m: fieldOf(k).check(form[k] ?? "", e, form) })).filter((p): p is { k: string; m: string } => Boolean(p.m));
  const notOk = !oc || problems.length > 0;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const label = (k: string, v: string) => (k === "foundAt" ? (v === "shop_storage" ? "Back at the shop" : "At the facility") : k === "step" ? STAGE_LABELS[v as GarmentStage] ?? v : k === "verify" ? "Yes" : k === "amount" ? money(Math.round(Number(v) * 100)) : v);

  async function confirm() {
    if (!oc) return;
    setBusy(true);
    setErr(null);
    const details: Record<string, string | boolean> = {};
    for (const k of keys) if (k !== "note" && k !== "foundAt" && form[k]) details[k] = k === "verify" ? true : form[k].trim();
    try {
      await api(`/garment-exceptions/${e.id}/resolve`, { body: { resolution: form.note.trim(), outcome: oc.id, details, version, ...(form.foundAt ? { location: form.foundAt } : {}) } });
      onDone(`${code(e)} resolved.`, "resolved");
    } catch (x) {
      const a = x as ApiError & { code?: string };
      setErr({ msg: a.message, stale: a.code === "EXCEPTION_CHANGED" });
      setBusy(false);
    }
  }
  async function doReopen() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/garment-exceptions/${e.id}/reopen`, { body: { reason: reason.trim(), version: e.version } });
      onDone(`${code(e)} reopened.`, "open");
    } catch (x) {
      setErr({ msg: (x as ApiError).message });
      setBusy(false);
    }
  }
  async function addNote() {
    setNoteTried(true);
    if (note.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/garment-exceptions/${e.id}/notes`, { body: { kind: noteKind, text: note.trim() } });
      setNote("");
      setNoteTried(false);
      history.reload();
      onChanged();
    } catch (x) {
      setErr({ msg: (x as ApiError).message });
    }
    setBusy(false);
  }
  const events = history.data ?? [];
  const hasResolvedEvent = events.some((h) => h.text.startsWith("Resolved"));
  const timeline: { key: string; t: string; meta: string; tag?: string; customer?: boolean }[] = [
    ...events.map((h) => ({ key: h.id, t: h.text, meta: `${fmt(h.createdAt)} · ${h.by ?? "—"}`, tag: h.kind === "internal" ? "Internal note" : h.kind === "customer" ? "Customer message · not sent" : undefined, customer: h.kind === "customer" })),
    // Older records, and garments found by scanning, have their outcome on the exception itself.
    ...(e.resolvedAt && !hasResolvedEvent ? [{ key: "resolved", t: `Resolved: ${e.resolution ?? ""}`, meta: `${fmt(e.resolvedAt)} · ${e.resolvedByName ?? "—"}` }] : []),
    { key: "reported", t: `Reported · ${T.label}${e.notes ? ` — ${e.notes}` : ""}`, meta: `${fmt(e.createdAt)} · ${e.createdByName ?? "—"}` },
  ];

  const facts: { k: string; v: string; c?: string }[] = [
    { k: "Where it came from", v: sourceOf(e) },
    { k: "Originally reported", v: `${fmt(e.createdAt)} by ${e.createdByName ?? "—"}` },
    open ? { k: late ? "Overdue" : "Open for", v: late ? `by ${dur(age - OVERDUE_HOURS * 3600000)} (open ${dur(age)})` : dur(age), c: late ? "var(--dc-red-fg)" : undefined } : { k: "Outcome", v: [oc0?.label ?? e.resolution, detailText(e)].filter(Boolean).join(" · "), c: "var(--dc-green-fg)" },
    ...(e.reopenedAt ? [{ k: "Last reopened", v: `${fmt(e.reopenedAt)} by ${e.reopenedByName ?? "—"}` }] : []),
  ];
  const kicker: ReactNode = <span className="self-start" style={{ fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: T.bg, color: T.fg }}><span aria-hidden="true">{T.icon} </span>{open ? T.label : `${T.label} · resolved`}</span>;
  const foot = (left: ReactNode, sec: ReactNode, pri?: ReactNode) => <div className="flex flex-wrap items-center gap-2" style={{ padding: "14px 24px", borderTop: "1px solid var(--dc-line2)" }}><span className="flex-1" style={{ minWidth: 160, fontSize: 13, color: "var(--dc-sub)" }}>{left}</span>{sec}{pri}</div>;
  const closeBtn = <button type="button" className="dc-press dcd-lift" style={OUTLINE} onClick={onClose}>Close</button>;

  let footer: ReactNode;
  if (mode === "resolve") {
    footer = review
      ? foot("", <button type="button" className="dc-press dcd-lift" style={OUTLINE} onClick={() => { setReview(false); setErr(null); }}>Back to edit</button>, <button type="button" className="dc-press dcd-lift" style={{ ...GREEN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void confirm()}>{busy ? "Saving…" : oc?.confirm}</button>)
      : foot(isManager ? "You’ll check everything before it’s saved." : "", <button type="button" className="dc-press dcd-lift" style={OUTLINE} onClick={onClose}>Cancel</button>, isManager ? <button type="button" className="dc-press dcd-lift" style={GREEN} onClick={() => { if (notOk) setTried(true); else { setReview(true); setErr(null); } }}>Review resolution</button> : undefined);
  } else {
    const claimLink = (e.kind === "damaged" || e.kind === "missing") && canClaim ? <a href={`/claims?exceptionId=${e.id}`} className="dc-ex-link" style={{ fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>Open a claim</a> : null;
    footer = foot(claimLink ?? (!isManager ? "Only a manager can resolve or reopen." : ""), closeBtn, !isManager ? undefined : open ? <button type="button" className="dc-press dcd-lift" style={GREEN} onClick={() => onMode("resolve")}>Resolve</button> : reopen ? undefined : <button type="button" className="dc-press dcd-lift" style={GREEN} onClick={() => setReopen(true)}>Reopen…</button>);
  }

  return (
    <DcDialog width={700} kicker={kicker} title={`${e.garmentType} · ${e.tagCode}`} sub={`${code(e)} · ${e.customerName} · Order ${e.orderNumber}`} onClose={() => { if (reopen) setReopen(false); else if (review) setReview(false); else onClose(); }} footer={footer}>
      {err && (
        <div role="alert" className="flex flex-col gap-2" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--dc-red-bg)", color: "var(--dc-red-fg)", fontSize: 14 }}>
          <strong>{err.msg}</strong>
          {err.stale && <button type="button" className="dc-press self-start" style={{ ...OUTLINE, minHeight: 40 }} onClick={async () => { const rows = await api<Ex[]>("/garment-exceptions?status=all"); const cur = rows.find((x) => x.id === e.id); onChanged(); if (cur) { setVersion(cur.version); setReview(false); setErr(null); if (cur.status !== "open") onMode("view"); } }}>Load latest and review</button>}
        </div>
      )}
      <dl className="grid gap-2.5" style={{ margin: 0, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {facts.map((f) => <div key={f.k} className="flex min-w-0 flex-col gap-0.5" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--dc-soft2)", border: "1px solid var(--dc-line2)" }}><dt style={{ fontSize: 12, fontWeight: 600, color: "var(--dc-sub)" }}>{f.k}</dt><dd style={{ margin: 0, fontSize: 15, fontWeight: 600, color: f.c ?? "var(--dc-ink)", overflowWrap: "anywhere" }}>{f.v}</dd></div>)}
      </dl>
      {e.notes && <p style={{ margin: 0, padding: "12px 14px", borderRadius: 12, background: "var(--dc-soft)", fontSize: 14, overflowWrap: "anywhere" }}>{`Reported note: “${e.notes}”`}</p>}

      {mode === "resolve" && !review && (
        <form noValidate onSubmit={(x: FormEvent) => x.preventDefault()} className="flex flex-col gap-3.5">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>How was it resolved?</h3>
          <fieldset className="flex flex-col gap-2" style={{ margin: 0, padding: 0, border: 0 }}>
            <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Outcome</legend>
            {list.map((o, i) => {
              const on = form.outcome === o.id;
              return (
                <label key={o.id} className="dcd-pill flex cursor-pointer items-start gap-3" style={{ padding: "12px 14px", borderRadius: 14, border: `1.5px solid ${on ? "var(--dc-solid)" : tried && !oc ? "#b4471a" : "var(--dc-line)"}`, background: on ? "var(--dc-soft2)" : "var(--dc-card)" }}>
                  <input type="radio" name="outcome" data-autofocus={i === 0 ? true : undefined} checked={on} onChange={() => setForm((f) => ({ oldTag: e.tagCode, outcome: o.id, note: f.note ?? "", dmg: f.dmg ?? "", evid: f.evid ?? "" }))} className="flex-none" style={{ width: 20, height: 20, marginTop: 2, accentColor: "var(--dc-solid)" }} />
                  <span className="flex flex-col gap-0.5"><span style={{ fontSize: 15, fontWeight: 600 }}>{o.label}</span><span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{o.help}</span></span>
                </label>
              );
            })}
            {tried && !oc && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dc-red-fg)" }}><span aria-hidden="true">⚠ </span>Choose an outcome.</span>}
          </fieldset>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))" }}>
            {keys.map((k) => {
              const f = fieldOf(k), bad = tried ? f.check(form[k] ?? "", e, form) : null;
              const border = `1.5px solid ${bad ? "#b4471a" : "var(--dc-grey)"}`;
              const id = `ex-${k}`;
              return (
                <div key={k} className="flex min-w-0 flex-col gap-1.5" style={{ gridColumn: f.wide ? "1 / -1" : undefined }}>
                  {f.type === "check" ? (
                    <label className="flex cursor-pointer items-start gap-2.5" style={{ minHeight: 44, fontSize: 14, fontWeight: 600, padding: "10px 12px", borderRadius: 12, border }}><input type="checkbox" checked={form[k] === "yes"} onChange={(x) => set(k, x.target.checked ? "yes" : "")} className="flex-none" style={{ width: 20, height: 20, margin: 0, accentColor: "var(--dc-solid)" }} />{f.label}</label>
                  ) : <label htmlFor={id} style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</label>}
                  {f.type === "input" && <input id={id} value={form[k] ?? ""} readOnly={f.ro} onChange={(x) => set(k, x.target.value)} autoComplete="off" spellCheck={false} placeholder={f.ph} aria-invalid={Boolean(bad)} style={{ ...INPUT, border, background: f.ro ? "var(--dc-soft)" : "var(--dc-card)" }} />}
                  {f.type === "area" && <textarea id={id} rows={2} value={form[k] ?? ""} onChange={(x) => set(k, x.target.value)} placeholder={f.ph} aria-invalid={Boolean(bad)} style={{ ...INPUT, border, padding: "10px 12px", resize: "vertical" }} />}
                  {f.type === "select" && <select id={id} value={form[k] ?? ""} onChange={(x) => set(k, x.target.value)} aria-invalid={Boolean(bad)} className="cursor-pointer" style={{ ...INPUT, border }}><option value="">Choose…</option>{f.opts?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
                  {f.help && <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{f.help}</span>}
                  {bad && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dc-red-fg)" }}><span aria-hidden="true">⚠ </span>{bad}</span>}
                </div>
              );
            })}
          </div>
          {!isManager && <p role="note" style={{ margin: 0, padding: "12px 14px", borderRadius: 12, background: "var(--dc-amber-bg)", fontSize: 14, color: "var(--dc-amber-fg)" }}>Only a manager can resolve exceptions. You can still add an internal note from Details.</p>}
        </form>
      )}

      {mode === "resolve" && review && oc && (
        <div role="group" className="flex flex-col gap-3">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Check before you confirm</h3>
          <dl className="grid" style={{ margin: 0, gridTemplateColumns: "minmax(120px,auto) 1fr", gap: "8px 16px", padding: "14px 16px", borderRadius: 14, border: "1px solid var(--dc-line)" }}>
            <dt style={{ fontSize: 14, color: "var(--dc-sub)" }}>Outcome</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{oc.label}</dd>
            {keys.filter((k) => k !== "note" && form[k]).map((k) => <div key={k} className="contents"><dt style={{ fontSize: 14, color: "var(--dc-sub)" }}>{REVIEW_LABEL[k]}</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{label(k, form[k])}</dd></div>)}
            <dt style={{ fontSize: 14, color: "var(--dc-sub)" }}>Note</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{form.note}</dd>
          </dl>
          {form.amount && <div role="note" className="flex items-start gap-2.5" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--dc-amber-bg)", border: "1.5px solid #c9a227", fontSize: 14, color: "var(--dc-amber-fg)" }}><span><strong>Financial impact:</strong>{` ${money(Math.round(Number(form.amount) * 100))} paid to ${e.customerName} by ${form.method}. This records it here only. Add it to your cash book.`}</span></div>}
          {oc.id === "matched" && <p style={{ margin: 0, fontSize: 14 }}>This records which order it belongs to. It does not move the garment or change either order’s bill.</p>}
          <p style={{ margin: 0, fontSize: 14 }}>{`${code(e)} will be marked resolved and moved to the Resolved tab. You can reopen it later if needed.`}</p>
        </div>
      )}

      {mode === "view" && (
        <>
          {reopen && (
            <div role="group" className="flex flex-col gap-2.5" style={{ padding: 14, borderRadius: 14, border: "1.5px solid #c9a227", background: "var(--dc-amber-bg)" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{`Reopen ${code(e)}`}</h3>
              <label htmlFor="reopen-note" style={{ fontSize: 14, fontWeight: 600 }}>Why reopen?</label>
              <textarea id="reopen-note" autoFocus rows={2} value={reason} onChange={(x) => setReason(x.target.value)} style={{ ...INPUT, border: "1.5px solid var(--dc-grey)", padding: "10px 12px", resize: "vertical" }} />
              <span style={{ fontSize: 13 }}>The original report date is kept. Reopening is recorded in the history. It does not move the garment back.</span>
              <div className="flex flex-wrap justify-end gap-2"><button type="button" className="dc-press" style={{ ...OUTLINE, minHeight: 40 }} onClick={() => setReopen(false)}>Cancel</button><button type="button" className="dc-press" disabled={busy || reason.trim().length < 5} onClick={() => void doReopen()} style={{ ...SOLID, minHeight: 40, opacity: busy || reason.trim().length < 5 ? 0.55 : 1 }}>Reopen exception</button></div>
            </div>
          )}
          {canNote && (
            <div role="group" className="flex flex-col gap-2" style={{ padding: 14, borderRadius: 14, border: "1px solid var(--dc-line)" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Add a note</h3>
              <div role="radiogroup" aria-label="Who can see this note" className="flex flex-wrap gap-2">
                {([["internal", "Internal note"], ["customer", "Message to customer"]] as const).map(([id, text]) => (
                  <label key={id} className="dcd-pill flex cursor-pointer items-center gap-2" style={{ minHeight: 40, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${noteKind === id ? "var(--dc-solid)" : "var(--dc-line)"}`, background: noteKind === id ? "var(--dc-soft2)" : "var(--dc-card)", fontSize: 14, fontWeight: 600 }}><input type="radio" name="note-kind" checked={noteKind === id} onChange={() => setNoteKind(id)} style={{ width: 18, height: 18, margin: 0, accentColor: "var(--dc-solid)" }} />{text}</label>
                ))}
              </div>
              <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{noteKind === "internal" ? "Only staff can see internal notes. Never shown to the customer." : "Saved as a draft for the customer. It is not sent from here."}</span>
              <textarea aria-label="Note text" rows={2} value={note} onChange={(x) => setNote(x.target.value)} placeholder={noteKind === "internal" ? "e.g. Called the facility, they’re checking the van" : "e.g. We’re tracing your garment and will update you by tomorrow."} style={{ ...INPUT, border: `1.5px solid ${noteTried && note.trim().length < 3 ? "#b4471a" : "var(--dc-grey)"}`, padding: "10px 12px", resize: "vertical" }} />
              {noteTried && note.trim().length < 3 && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dc-red-fg)" }}><span aria-hidden="true">⚠ </span>Write at least 3 characters.</span>}
              <button type="button" className="dc-press dcd-lift self-end" style={OUTLINE} disabled={busy} onClick={() => void addNote()}>{noteKind === "internal" ? "Add note" : "Save draft message"}</button>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>History <span style={{ fontWeight: 500, color: "var(--dc-sub)" }}>· {timeline.length === 1 ? "1 entry" : `${timeline.length} entries`}</span></h3>
            <ol style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
              {timeline.map((h, k) => (
                <li key={h.key} className="relative flex flex-col gap-[3px]" style={{ padding: "0 0 16px", paddingInlineStart: 28, fontSize: 14 }}>
                  {k < timeline.length - 1 && <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 5, top: 16, bottom: 0, width: 2, background: "var(--dc-line)" }} />}
                  <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 0, top: 4, width: 12, height: 12, borderRadius: "50%", background: k === 0 ? "var(--dc-green)" : "var(--dc-grey)", boxShadow: `0 0 0 3px ${k === 0 ? "var(--dc-green-bg)" : "var(--dc-soft)"}` }} />
                  {h.tag && <span className="self-start" style={{ fontSize: 12, fontWeight: 700, padding: "1px 8px", borderRadius: 6, background: h.customer ? "var(--dc-blue-bg)" : "var(--dc-soft)", color: h.customer ? "var(--dc-blue-fg)" : "var(--dc-ink)" }}>{h.tag}</span>}
                  <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{h.t}</span>
                  <span style={{ fontSize: 13, color: "var(--dc-sub)" }}>{h.meta}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </DcDialog>
  );
}
