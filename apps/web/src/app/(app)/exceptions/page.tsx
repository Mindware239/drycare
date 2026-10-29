"use client";
import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { LOCATION_LABELS, type GarmentLocation } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const KIND_LABEL: Record<string, string> = { missing: "Missing", damaged: "Damaged", wrong_tag: "Wrong tag", delayed: "Delayed" };

export default function ExceptionsPage() {
  const { can } = useSession();
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const list = useApi<any[]>(`/garment-exceptions?status=${status}`);
  const [resolving, setResolving] = useState<any>(null);
  const [resolution, setResolution] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function resolve() {
    setSaving(true);
    setError("");
    try {
      await api(`/garment-exceptions/${resolving.id}/resolve`, { body: { resolution, location: location || undefined } });
      setResolving(null);
      list.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Garment exceptions" subtitle="Garments that went missing in transit or were found damaged or wrongly tagged. They stay here until a manager resolves them." />
      <Card padded={false} title={
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-semibold">
          {(["open", "resolved"] as const).map((t) => <button key={t} type="button" onClick={() => setStatus(t)} className={cx("rounded-md px-3 py-1.5", status === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{t === "open" ? "Open" : "Resolved"}</button>)}
        </div>
      }>
        {list.error && <div className="p-4"><Alert>{list.error.message}</Alert></div>}
        {!list.data ? <Spinner /> : !list.data.length ? <Empty title={status === "open" ? "No open exceptions" : "Nothing resolved yet"}>{status === "open" ? "Every garment in transit is accounted for." : ""}</Empty> : (
          <ul className="divide-y divide-slate-100">
            {list.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <CircleAlert className={cx("h-5 w-5 shrink-0", e.status === "open" ? "text-red-500" : "text-slate-300")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900"><span className="font-mono">{e.tagCode}</span> · {e.garmentType} <Badge color={e.kind === "missing" ? "red" : "amber"}>{KIND_LABEL[e.kind] ?? e.kind}</Badge></p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <a className="hover:underline" href={`/orders/view?id=${e.orderId}`}>{e.orderNumber}</a> · {e.customerName}{e.batchNumber ? ` · batch ${e.batchNumber}` : ""} · {dateTime(e.createdAt)} by {e.createdByName}
                  </p>
                  {e.notes && <p className="mt-1 text-sm text-slate-700">“{e.notes}”</p>}
                  {e.resolution && <p className="mt-1 text-sm text-emerald-800">Resolved: {e.resolution}</p>}
                </div>
                <span className="text-xs text-slate-500">{LOCATION_LABELS[e.location as GarmentLocation] ?? e.location}</span>
                {(e.kind === "damaged" || e.kind === "missing") && can("complaints.manage") && <a href={`/claims?exceptionId=${e.id}`} className="text-xs font-medium text-brand-700 hover:underline">Open claim</a>}
                {e.status === "open" && can("garments.override") && <Button size="sm" variant="secondary" onClick={() => { setResolving(e); setResolution(""); setLocation(""); setError(""); }}>Resolve</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {resolving && (
        <Modal open title={`Resolve ${resolving.tagCode}`} onClose={() => setResolving(null)} footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancel</Button><Button onClick={resolve} loading={saving} disabled={resolution.trim().length < 3}>Resolve</Button></>}>
          {error && <Alert>{error}</Alert>}
          <Field label="Where is the garment now?" hint="Choose a place if it has been found. Leave unchanged for a damage note or a claim settled with the customer.">
            <Select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">Leave location unchanged</option>
              <option value="shop_storage">Found — back at the shop</option>
              <option value="at_facility">Found — at the facility</option>
            </Select>
          </Field>
          <Field label="Resolution" required><Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. Found in another bag at the plant; customer informed" /></Field>
        </Modal>
      )}
    </div>
  );
}
