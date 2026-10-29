"use client";
import { useState } from "react";
import { MapPin, Phone } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, todayISO } from "@/lib/format";
import { Badge, Button, Empty, PageHeader, Spinner } from "@/components/ui";
import { CompleteModal, DeliveryStatusBadge, DispatchModal, KIND_LABEL, addressLine, mapsUrl } from "@/components/DeliveryModals";

/** Screen I02 — the delivery agent's worklist. Designed for a phone. Shows only the agent's own stops. */
export default function DriverPage() {
  const { can, session } = useSession();
  const list = useApi<any[]>("/deliveries?status=active");
  const [modal, setModal] = useState<null | { type: "dispatch" | "complete"; stop: any }>(null);
  const open = async (type: "dispatch" | "complete", id: string) => setModal({ type, stop: await api(`/deliveries/${id}`) });
  const mine = (list.data ?? []).filter((r) => r.driver_user_id === session.user.id);
  const today = todayISO();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="My deliveries" subtitle={`${mine.length} open stop(s)`} actions={<Button variant="secondary" onClick={list.reload}>Refresh</Button>} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : mine.length === 0 ? (
        <Empty title="No stops assigned to you">Ask the counter to assign pickups or deliveries.</Empty>
      ) : (
        <ul className="space-y-3">
          {mine.map((s) => (
            <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Badge color={s.kind === "pickup" ? "violet" : "brand"}>{KIND_LABEL[s.kind]}</Badge>
                <span className="text-sm font-semibold">{s.time_slot}</span>
                {s.scheduled_date !== today && <span className="text-xs text-slate-500">{s.scheduled_date}</span>}
                <span className="ml-auto">
                  <DeliveryStatusBadge status={s.status} />
                </span>
              </div>
              <p className="mt-2 text-lg font-semibold">{s.customer_name}</p>
              <p className="text-sm text-slate-600">{addressLine(s.address_json)}</p>
              {s.instructions && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">{s.instructions}</p>}
              <p className="mt-1 text-sm text-slate-600">
                {s.order_number && <>Order {s.order_number} · </>}
                {s.garment_count > 0 && <>{s.garment_count} item(s) · </>}
                {Number(s.collect_amount) > 0 ? <strong className="text-amber-700">Collect {money(s.collect_amount)}</strong> : s.kind === "delivery" ? "Prepaid" : null}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 py-2 text-sm font-medium">
                    <Phone className="h-4 w-4" /> Call
                  </a>
                )}
                <a href={mapsUrl(s.address_json)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 py-2 text-sm font-medium">
                  <MapPin className="h-4 w-4" /> Map
                </a>
                {s.status === "assigned" && (
                  <Button className="col-span-2" size="lg" onClick={() => open("dispatch", s.id)}>
                    {s.kind === "delivery" ? "Verify bag & start" : "Start pickup"}
                  </Button>
                )}
                {s.status === "out" && (
                  <Button className="col-span-2" size="lg" onClick={() => open("complete", s.id)}>
                    {s.kind === "delivery" ? "Deliver" : "Collect garments"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {modal?.type === "dispatch" && <DispatchModal stop={modal.stop} onClose={() => setModal(null)} onDone={() => (setModal(null), list.reload())} />}
      {modal?.type === "complete" && <CompleteModal stop={modal.stop} canCollect={can("payments.collect")} onClose={() => setModal(null)} onDone={() => (setModal(null), list.reload())} />}
    </div>
  );
}
