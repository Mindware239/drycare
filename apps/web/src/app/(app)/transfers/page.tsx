"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, PackageCheck, Truck } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, cx } from "@/components/ui";

const STATUS: Record<string, { label: string; color: "slate" | "amber" | "blue" | "green" | "red" }> = {
  draft: { label: "Loading bags", color: "slate" },
  dispatched: { label: "In transit", color: "blue" },
  received: { label: "Received", color: "green" },
  received_with_exceptions: { label: "Received · items missing", color: "red" },
};

/** Shop ⇄ processing facility movements. Each batch is a van load of bags, verified by scanning. */
export default function TransfersPage() {
  const router = useRouter();
  const { branchId, session, can } = useSession();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const batches = useApi<any[]>(`/transfers?status=${tab}${branchId ? `&branchId=${branchId}` : ""}`);
  const [creating, setCreating] = useState<null | "to_facility" | "to_shop">(null);
  const defaultFacility = (session.organization.settings as any)?.facilityName ?? "Central processing facility";
  const [facility, setFacility] = useState(defaultFacility);
  const [vehicle, setVehicle] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canMove = can("garments.process");

  async function create() {
    if (!creating || !branchId) return;
    setSaving(true);
    setError("");
    try {
      const batch = await api<any>("/transfers", { body: { branchId, direction: creating, facilityName: facility, transportReference: vehicle || undefined } });
      router.push(`/transfers/view?id=${batch.id}`);
    } catch (e) {
      setError((e as ApiError).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Facility transfers"
        subtitle="Send bags to the processing facility and receive them back. Every garment is scanned in and out, so nothing goes missing unnoticed."
        actions={canMove && (
          <>
            <Button variant="secondary" onClick={() => setCreating("to_shop")}><ArrowDownToLine className="h-4 w-4" />Return to shop</Button>
            <Button onClick={() => setCreating("to_facility")}><ArrowUpFromLine className="h-4 w-4" />Send to facility</Button>
          </>
        )}
      />
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { icon: ArrowUpFromLine, title: "1 · Send", text: "Create a batch, scan each bag, then scan every garment tag in it. Dispatch when all are verified." },
          { icon: Truck, title: "2 · Receive at facility", text: "Open the batch at the facility and scan the tags as bags are unpacked. Missing pieces are flagged." },
          { icon: PackageCheck, title: "3 · Return receiving", text: "Cleaned garments come back in a return batch. Scan them at the shop to confirm all are back." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-4 w-4" /></span>
            <div><p className="text-sm font-semibold text-slate-900">{title}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{text}</p></div>
          </div>
        ))}
      </div>
      <Card
        title={
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-semibold">
            {(["open", "closed"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx("rounded-md px-3 py-1.5", tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{t === "open" ? "Active batches" : "Completed"}</button>)}
          </div>
        }
        padded={false}
      >
        {batches.error && <div className="p-4"><Alert>{batches.error.message}</Alert></div>}
        {!batches.data ? <Spinner /> : !batches.data.length ? (
          <Empty title={tab === "open" ? "No batches in progress" : "No completed batches yet"}>{tab === "open" ? "Start with “Send to facility” when the van is ready to leave." : ""}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {batches.data.map((b) => (
              <li key={b.id}>
                <a href={`/transfers/view?id=${b.id}`} className="flex flex-wrap items-center gap-4 px-4 py-3.5 hover:bg-slate-50">
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", b.direction === "to_facility" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700")}>
                    {b.direction === "to_facility" ? <ArrowUpFromLine className="h-5 w-5" /> : <ArrowDownToLine className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{b.batchNumber} <span className="font-normal text-slate-500">· {b.direction === "to_facility" ? `to ${b.facilityName}` : `from ${b.facilityName} to shop`}</span></p>
                    <p className="mt-0.5 text-xs text-slate-500">{b.bags} bag{b.bags === 1 ? "" : "s"} · {b.garments} garment{b.garments === 1 ? "" : "s"}{b.transportReference ? ` · ${b.transportReference}` : ""} · {dateTime(b.dispatchedAt ?? b.createdAt)}</p>
                  </div>
                  {b.openExceptions > 0 && <Badge color="red">{b.openExceptions} missing</Badge>}
                  <Badge color={STATUS[b.status]?.color ?? "slate"}>{STATUS[b.status]?.label ?? b.status}</Badge>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && (
        <Modal open title={creating === "to_facility" ? "Send bags to the facility" : "Return garments to the shop"} onClose={() => setCreating(null)}
          footer={<><Button variant="secondary" onClick={() => setCreating(null)}>Cancel</Button><Button onClick={create} loading={saving} disabled={facility.trim().length < 2}>Start scanning</Button></>}>
          {error && <Alert>{error}</Alert>}
          <Field label="Processing facility" required><Input value={facility} onChange={(e) => setFacility(e.target.value)} /></Field>
          <Field label="Vehicle / delivery reference" hint="Optional — e.g. van number or driver name"><Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. DL 01 AB 1234" /></Field>
          <p className="text-xs text-slate-500">{creating === "to_facility" ? "Only bags at this shop can be added." : "Only bags at the facility can be added. Use this at the facility when packing the return van."}</p>
        </Modal>
      )}
    </div>
  );
}
