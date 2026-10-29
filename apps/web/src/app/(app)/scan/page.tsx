"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, ScanLine, TriangleAlert } from "lucide-react";
import { STAGE_LABELS, type GarmentStage } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, StageBadge, Textarea, cx } from "@/components/ui";

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
  const locations = useApi<any[]>(`/storage-locations?branchId=${branchId}`);
  const staff = useApi<{ userId: string; name: string }[]>(
    can("garments.process") && branchId ? `/production/staff?branchId=${encodeURIComponent(branchId)}` : null,
  );

  async function lookup(tag: string, advance = autoAdvance) {
    const t = tag.trim().toUpperCase();
    if (!t) return;
    setMsg(null);
    setBusy(true);
    try {
      let garment = await api(`/garments/by-tag/${encodeURIComponent(t)}`);
      const next = garment.allowed.find((a: any) => a.kind === "advance" || a.kind === "rework_return");
      if (advance && next && next.permitted && !(next.to === "ready" && !garment.storageLocationId)) {
        garment = await api(`/garments/${garment.id}/transitions`, { body: { to: next.to, version: garment.version } });
        setMsg({ tone: "green", text: `${t} → ${STAGE_LABELS[next.to as GarmentStage]}` });
      }
      resetForms(garment);
    } catch (e) {
      setG(null);
      setMsg({ tone: "red", text: (e as ApiError).status === 404 ? `Tag ${t} not found` : (e as ApiError).message });
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
    if (t) lookup(t, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(fn: () => Promise<any>, success: string) {
    setBusy(true);
    setMsg(null);
    try {
      resetForms(await fn());
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
      <PageHeader title="Scan station" subtitle="Scan a garment tag with the barcode scanner, or type it and press Enter." />
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
            <Input ref={inputRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AND-2026-00001-01" className="py-3 pl-11 font-mono text-base" aria-label="Garment tag" />
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
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
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

            {["packing", "ready"].includes(g.currentStatus) && (
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

          <Card title="Garment history" padded={false}>
            <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto text-sm">
              {g.history.map((h: any, i: number) => (
                <li key={i} className="px-4 py-2">
                  <p>
                    {h.transition_kind === "location" ? h.notes : `${STAGE_LABELS[h.new_status as GarmentStage] ?? h.new_status}`}
                    {h.transition_kind === "qc_fail" && <Badge color="red" className="ml-1">QC fail</Badge>}
                    {h.transition_kind === "qc_pass" && <Badge color="green" className="ml-1">QC pass</Badge>}
                  </p>
                  {h.notes && h.transition_kind !== "location" && <p className="text-xs text-slate-600">“{h.notes}”</p>}
                  <p className="text-xs text-slate-500">
                    {dateTime(h.occurred_at)} · {h.actor}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
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
