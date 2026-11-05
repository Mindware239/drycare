"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, ScanLine, TriangleAlert } from "lucide-react";
import { STAGE_LABELS, expandScanCode, isSampleScanNumber, type GarmentStage } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, StageBadge, Textarea, cx } from "@/components/ui";
import { TagRecord, TagTimeline, type TagTraceData } from "@/components/TagTrace";

const QC_CHECKLIST = [
  ["clean", "Clean — no remaining soil or odour"],
  ["stains", "Stains treated / removed as far as possible"],
  ["no_new_damage", "No new damage, shrinkage or colour bleed"],
  ["fittings", "Buttons, zips and trims intact"],
  ["finish", "Pressed and finished correctly"],
] as const;

function ScanInner() {
  const params = useSearchParams();
  const { can, branchId } = useSession();
  const [code, setCode] = useState(params.get("tag") ?? "");
  const [g, setG] = useState<any>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [reworkReason, setReworkReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const opened = useRef("");
  // The record shown under the scan. The count fetches it again after each change, so the history stays current.
  const [traced, setTraced] = useState<{ code: string; n: number } | null>(null);
  const trace = useApi<TagTraceData>(traced ? `/tags/trace?code=${encodeURIComponent(traced.code)}&n=${traced.n}` : null);
  const refreshTrace = () => setTraced((t) => t && { ...t, n: t.n + 1 });
  const locations = useApi<any[]>(`/storage-locations?branchId=${branchId}`);
  const staff = useApi<{ userId: string; name: string }[]>(
    can("garments.process") && branchId ? `/production/staff?branchId=${encodeURIComponent(branchId)}` : null,
  );

  async function lookup(tag: string, advance = autoAdvance) {
    const t = expandScanCode(tag);
    if (!t) return;
    setMsg(null);
    setBusy(true);
    try {
      // Every scan is recorded, even when nothing about the label changes. A shop in read-only mode can still look.
      await api("/tags/scans", { body: { code: t } }).catch((e: ApiError) => { if (e.status === 404) throw e; });
      let garment;
      try {
        garment = await api(`/garments/by-tag/${encodeURIComponent(t)}`);
      } catch (e) {
        // A bag label has no stage of its own: show what is inside it.
        if ((e as ApiError).status !== 404) throw e;
        setG(null);
        setTraced((current) => ({ code: t, n: (current?.n ?? 0) + 1 }));
        return;
      }
      const next = garment.allowed.find((a: any) => a.kind === "advance" || a.kind === "rework_return");
      if (advance && next && next.permitted && !(next.to === "ready" && !garment.storageLocationId)) {
        garment = await api(`/garments/${garment.id}/transitions`, { body: { to: next.to, version: garment.version } });
        setMsg({ tone: "green", text: `${garment.tagCode} → ${STAGE_LABELS[next.to as GarmentStage]}` });
      }
      resetForms(garment);
      setTraced((current) => ({ code: t, n: (current?.n ?? 0) + 1 }));
    } catch (e) {
      setG(null);
      setTraced(null);
      const missing = (e as ApiError).status === 404;
      // Tags printed from the designer and the scanner test have no order behind them.
      if (missing && (/^(TEST-|DCTEST-|DC1$)|-\d{4}-00000-/.test(t) || isSampleScanNumber(t))) setMsg({ tone: "green", text: `Scanner is working: it read ${t}. This is a sample tag, so it has no order. Real tags open their garment here.` });
      else setMsg({ tone: "red", text: missing ? `Tag ${t} not found` : (e as ApiError).message });
    } finally {
      setBusy(false);
      setCode("");
      inputRef.current?.focus();
    }
  }

  function resetForms(garment: any) {
    setG(garment);
    setNotes("");
    setChecklist({});
    setReworkReason("");
    setLocationId(garment.storageLocationId ?? "");
  }

  useEffect(() => {
    const t = params.get("tag");
    // Once per tag in the address: React repeats this on the dev server, and each lookup writes to the garment's history.
    if (t && opened.current !== t) { opened.current = t; lookup(t, false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(fn: () => Promise<any>, success: string) {
    setBusy(true);
    setMsg(null);
    try {
      resetForms(await fn());
      refreshTrace();
      setMsg({ tone: "green", text: success });
    } catch (e) {
      setMsg({ tone: "red", text: (e as ApiError).message });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const transition = (to: string) => act(() => api(`/garments/${g.id}/transitions`, { body: { to, notes: notes || undefined, version: g.version } }), `Moved to ${STAGE_LABELS[to as GarmentStage]}`);
  const assign = (userId: string | null) =>
    act(() => api(`/garments/${g.id}/assignments`, { body: { userId, version: g.version } }), userId ? "Garment assigned" : "Garment unassigned");
  const inspect = (outcome: "pass" | "fail") =>
    act(() => api(`/garments/${g.id}/inspections`, { body: { outcome, checklist, notes: notes || undefined, reworkReason: reworkReason || undefined } }), outcome === "pass" ? "QC passed → packing" : "QC failed → sent for rework");
  const store = () => act(() => api(`/garments/${g.id}/storage-location`, { body: { storageLocationId: locationId } }), "Rack location saved");

  const stages: string[] = g?.workflowStages ?? [];
  const currentIdx = g ? stages.indexOf(g.currentStatus) : -1;
  const allChecked = QC_CHECKLIST.every(([k]) => checklist[k]);

  return (
    <div>
      <PageHeader title="Scan station" subtitle="Scan a tag or bag label, or type its number and press Enter, to see its customer, order and complete history." />
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(code);
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <div className="relative min-w-64 flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
            <Input ref={inputRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan the barcode or type its number" className="py-3 pl-11 font-mono text-base" aria-label="Barcode number" />
          </div>
          <Button type="submit" size="lg" loading={busy}>
            Look up
          </Button>
          <label className="flex items-center gap-2 text-sm text-slate-700" title="Each scan moves the garment one stage forward. QC and rack assignment still need confirmation.">
            <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} /> Auto-advance on scan
          </label>
        </form>
        {msg && (
          <div className={cx("mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", msg.tone === "green" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
            {msg.tone === "green" ? <CircleCheck className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
            {msg.text}
          </div>
        )}
      </Card>

      {g && (
        <div className="mt-5 grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
          <div className="space-y-5 lg:col-span-2">
            <Card
              title={
                <span className="flex items-center gap-2">
                  <span className="font-mono">{g.tagCode}</span> <StageBadge stage={g.currentStatus} />
                  {g.express && <Badge color="amber">Express</Badge>}
                  {g.overdue && <Badge color="red">Overdue</Badge>}
                </span>
              }
              actions={
                <Link href={`/orders/view?id=${g.orderId}`} className="text-xs font-medium text-brand-700 hover:underline">
                  Order {g.orderNumber}
                </Link>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-lg font-semibold">
                    {g.garmentTypeName} <span className="font-normal text-slate-500">· {g.serviceName}</span>
                  </p>
                  <p className="text-sm text-slate-600">{[g.colour, g.brand, g.fabric].filter(Boolean).join(" · ") || "No colour/brand recorded"}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Customer: {g.customerName} · Due {dateTime(g.promisedAt)}
                  </p>
                  <p className="text-sm text-slate-600">
                    Order progress: {g.orderProgress.done}/{g.orderProgress.total} ready · Rack {g.storageCode ?? "—"}
                  </p>
                  {can("garments.process") && (
                    <Field label="Production assignee">
                      <Select
                        value={g.assignedUserId ?? ""}
                        onChange={(e) => assign(e.target.value || null)}
                        disabled={busy || staff.loading}
                        aria-label="Production assignee"
                      >
                        <option value="">Unassigned</option>
                        {(staff.data ?? []).map((person) => (
                          <option key={person.userId} value={person.userId}>{person.name}</option>
                        ))}
                      </Select>
                      {staff.error && <p className="mt-1 text-xs text-red-600">{staff.error.message}</p>}
                    </Field>
                  )}
                </div>
                <div className="space-y-2">
                  {(g.conditionFlags?.length > 0 || g.conditionNotes) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                      <p className="font-medium">Condition at intake</p>
                      {g.conditionFlags?.length > 0 && <p>{g.conditionFlags.join(", ").replace(/_/g, " ")}</p>}
                      {g.conditionNotes && <p>{g.conditionNotes}</p>}
                    </div>
                  )}
                  {g.careInstructions && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-sm text-blue-900">
                      <p className="font-medium">Care instructions</p>
                      <p>{g.careInstructions}</p>
                    </div>
                  )}
                </div>
              </div>
              <ol className="mt-4 flex flex-wrap items-center gap-1 text-xs">
                {stages.map((s, i) => (
                  <li key={s} className={cx("rounded-full px-2.5 py-1", i < currentIdx ? "bg-brand-100 text-brand-800" : i === currentIdx ? "bg-brand-600 font-semibold text-white" : "bg-slate-100 text-slate-500")}>
                    {STAGE_LABELS[s as GarmentStage]}
                  </li>
                ))}
              </ol>
            </Card>

            {g.currentStatus === "quality_control" && can("qc.approve") && (
              <Card title="Quality inspection">
                <div className="space-y-2">
                  {QC_CHECKLIST.map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!checklist[k]} onChange={(e) => setChecklist({ ...checklist, [k]: e.target.checked })} /> {label}
                    </label>
                  ))}
                  <Field label="Inspection notes">
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  <Field label="Rework reason (if failing)">
                    <Input value={reworkReason} onChange={(e) => setReworkReason(e.target.value)} placeholder="e.g. collar stain still visible" />
                  </Field>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={() => inspect("pass")} disabled={!allChecked || busy}>
                      Pass QC
                    </Button>
                    <Button variant="danger" onClick={() => inspect("fail")} disabled={!reworkReason.trim() || busy}>
                      Fail → rework
                    </Button>
                    {!allChecked && <span className="self-center text-xs text-slate-500">Tick every check to pass.</span>}
                  </div>
                </div>
              </Card>
            )}
            {g.currentStatus === "quality_control" && !can("qc.approve") && <Alert tone="amber">Waiting for a quality inspector.</Alert>}

            {(["packing", "ready"].includes(g.currentStatus) || g.allowed.some((a: any) => a.to === "ready")) && (
              <Card title="Rack / storage location">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Location" className="w-48">
                    <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                      <option value="">Select rack…</option>
                      {locations.data?.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} {l.description ? `· ${l.description}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button variant="secondary" onClick={store} disabled={!locationId || locationId === g.storageLocationId || busy}>
                    Save location
                  </Button>
                </div>
              </Card>
            )}

            {g.currentStatus !== "quality_control" && (
              <Card title="Move garment">
                {g.allowed.filter((a: any) => a.kind !== "qc_pass" && a.kind !== "qc_fail").length === 0 ? (
                  <p className="text-sm text-slate-500">{g.currentStatus === "delivered" ? "This garment has been delivered." : "No further moves from this stage here."}</p>
                ) : (
                  <div className="space-y-3">
                    <Field label="Notes" hint="Required for exceptions (e.g. missing from rack, damage found)">
                      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      {g.allowed
                        .filter((a: any) => a.kind !== "qc_pass" && a.kind !== "qc_fail")
                        .map((a: any) => (
                          <Button
                            key={a.to + a.kind}
                            variant={a.kind === "exception" ? "danger" : a.kind === "exception_resolve" ? "secondary" : "primary"}
                            disabled={!a.permitted || busy || (a.to === "ready" && !g.storageLocationId)}
                            title={!a.permitted ? "You don't have permission" : a.to === "ready" && !g.storageLocationId ? "Assign a rack first" : undefined}
                            onClick={() => transition(a.to)}
                          >
                            {a.kind === "exception" ? "Report exception" : a.kind === "exception_resolve" ? `Resolve → ${STAGE_LABELS[a.to as GarmentStage]}` : `→ ${STAGE_LABELS[a.to as GarmentStage]}`}
                          </Button>
                        ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>

          {trace.data && trace.data.label.id === g.id && <TagTimeline data={trace.data} />}
        </div>
      )}
      {traced && trace.error && <div className="mt-5"><Alert>{trace.error.message}</Alert></div>}
      {trace.data && (!g || trace.data.label.id === g.id) && traced && (
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-3 [&>*]:min-w-0">
          <div className={g ? "lg:col-span-3" : "lg:col-span-2"}><TagRecord data={trace.data} /></div>
          {!g && <TagTimeline data={trace.data} />}
        </div>
      )}
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense>
      <ScanInner />
    </Suspense>
  );
}
