"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, todayISO } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, cx } from "@/components/ui";
import { CompleteModal, DeliveryStatusBadge, DispatchModal, KIND_LABEL, RescheduleModal, addressLine } from "@/components/DeliveryModals";
import { ScheduleModal } from "@/components/ScheduleModal";
import { OnlineBookingSettings } from "@/components/OnlineBookingSettings";
import { Globe } from "lucide-react";

export default function DeliveriesPage() {
  const { branchId, can } = useSession();
  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const qs = new URLSearchParams({ ...(onlyActive ? { status: "active" } : { date }), ...(kind ? { kind } : {}) });
  const list = useApi<any[]>(`/deliveries?${qs}`);
  const drivers = useApi<any[]>("/drivers");
  const [scheduling, setScheduling] = useState(false);
  const [modal, setModal] = useState<null | { type: "dispatch" | "complete" | "reschedule" | "cancel" | "view"; stop: any }>(null);
  const [err, setErr] = useState("");

  const open = async (type: "dispatch" | "complete" | "reschedule" | "cancel" | "view", id: string) => setModal({ type, stop: await api(`/deliveries/${id}`) });
  const done = () => (setModal(null), list.reload());

  async function assign(id: string, driverUserId: string) {
    setErr("");
    try {
      await api(`/deliveries/${id}/assign`, { body: { driverUserId } });
      list.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  const rows = list.data ?? [];
  const counts = { pickups: rows.filter((r) => r.kind === "pickup").length, deliveries: rows.filter((r) => r.kind === "delivery").length, open: rows.filter((r) => ["scheduled", "assigned", "out"].includes(r.status)).length };

  return (
    <div>
      {bookingOpen && <OnlineBookingSettings onClose={() => setBookingOpen(false)} />}
      <PageHeader
        title="Pickups & deliveries"
        subtitle={`${counts.pickups} pickup(s) · ${counts.deliveries} deliver(ies) · ${counts.open} open`}
        actions={<>
          {can("org.manage") && <Button variant="secondary" onClick={() => setBookingOpen(true)}><Globe className="h-4 w-4" />Online booking</Button>}
          <Button onClick={() => setScheduling(true)}>Schedule pickup / delivery</Button>
        </>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => (setDate(e.target.value), setOnlyActive(false))} className="w-auto" disabled={onlyActive} />
        <Button variant="secondary" size="sm" onClick={() => (setDate(todayISO()), setOnlyActive(false))}>
          Today
        </Button>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
          <option value="">Pickups & deliveries</option>
          <option value="pickup">Pickups only</option>
          <option value="delivery">Deliveries only</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> All open (any date)
        </label>
      </div>
      {err && <Alert onClose={() => setErr("")}>{err}</Alert>}
      <Card padded={false} className="mt-2">
        {list.loading && !list.data ? (
          <Spinner />
        ) : (
          <Table head={["Slot", "Customer & address", "Order", "Agent", "Status", ""]} empty={rows.length === 0 && <Empty title="Nothing scheduled">Use “Schedule pickup / delivery” to add a stop.</Empty>}>
            {rows.map((r) => (
              <tr key={r.id} className={cx(r.status === "failed" && "bg-red-50/40")}>
                <Td>
                  <span className="font-medium">{r.time_slot}</span>
                  {onlyActive && <span className="block text-xs text-slate-500">{r.scheduled_date}</span>}
                  <span className="mt-1 block">
                    <Badge color={r.kind === "pickup" ? "violet" : "brand"}>{KIND_LABEL[r.kind]}</Badge>
                    {r.attempts > 1 && <span className="ml-1 text-xs text-slate-500">try {r.attempts}</span>}
                  </span>
                </Td>
                <Td className="max-w-sm whitespace-normal">
                  <span className="font-medium">{r.customer_name}</span> <span className="text-xs text-slate-500">{r.phone}</span>
                  <span className="block text-xs text-slate-600">{addressLine(r.address_json)}</span>
                </Td>
                <Td>
                  {r.order_id ? (
                    <Link href={`/orders/view?id=${r.order_id}`} className="text-brand-700 hover:underline">
                      {r.order_number}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {r.garment_count > 0 && <span className="block text-xs text-slate-500">{r.garment_count} item(s)</span>}
                  {Number(r.collect_amount) > 0 && <span className="block text-xs font-medium text-amber-700">Collect {money(r.collect_amount)}</span>}
                </Td>
                <Td>
                  {["scheduled", "assigned"].includes(r.status) ? (
                    <Select value={r.driver_user_id ?? ""} onChange={(e) => e.target.value && assign(r.id, e.target.value)} className="w-36 py-1">
                      <option value="">Assign…</option>
                      {drivers.data?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    (r.driver_name ?? "—")
                  )}
                </Td>
                <Td>
                  <DeliveryStatusBadge status={r.status} />
                </Td>
                <Td>
                  <div className="flex gap-1">
                    {r.status === "assigned" && (
                      <Button size="sm" onClick={() => open("dispatch", r.id)}>
                        {r.kind === "delivery" ? "Verify & send" : "Start"}
                      </Button>
                    )}
                    {r.status === "out" && (
                      <Button size="sm" onClick={() => open("complete", r.id)}>
                        Record outcome
                      </Button>
                    )}
                    {["scheduled", "assigned", "failed"].includes(r.status) && (
                      <Button size="sm" variant="secondary" onClick={() => open("reschedule", r.id)}>
                        Reschedule
                      </Button>
                    )}
                    {r.kind === "pickup" && r.status === "completed" && !r.order_id && can("orders.create") && (
                      <Link href={`/pos?customerId=${r.customer_id}&pickupId=${r.id}`}>
                        <Button size="sm">Book order</Button>
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => open("view", r.id)}>
                      Details
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <p className="mt-2 text-xs text-slate-500">Delivery agents see their own stops on the “My deliveries” screen (works on a phone over the shop Wi-Fi).</p>

      {scheduling && <ScheduleModal branchId={branchId} canCredit={can("orders.release_with_due")} onClose={() => setScheduling(false)} onDone={() => (setScheduling(false), list.reload())} />}
      {modal?.type === "dispatch" && <DispatchModal stop={modal.stop} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "complete" && <CompleteModal stop={modal.stop} canCollect={can("payments.collect")} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "reschedule" && <RescheduleModal stop={modal.stop} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "view" && <DetailsModal stop={modal.stop} onClose={() => setModal(null)} onChanged={done} />}
    </div>
  );
}

function DetailsModal({ stop, onClose, onChanged }: { stop: any; onClose: () => void; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const cancellable = ["scheduled", "assigned", "failed"].includes(stop.status);
  return (
    <Modal
      open
      wide
      title={`${KIND_LABEL[stop.kind]} · ${stop.customer_name}`}
      onClose={onClose}
      footer={
        cancellable &&
        (cancelling ? (
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            onClick={() =>
              api(`/deliveries/${stop.id}/cancel`, { body: { reason } })
                .then(onChanged)
                .catch((e: ApiError) => setErr(e.message))
            }
          >
            Confirm cancel
          </Button>
        ) : (
          <Button variant="ghost" className="text-red-600" onClick={() => setCancelling(true)}>
            Cancel this {stop.kind}…
          </Button>
        ))
      }
    >
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <span className="text-slate-500">When:</span> {stop.scheduled_date} · {stop.time_slot}
        </p>
        <p>
          <span className="text-slate-500">Status:</span> <DeliveryStatusBadge status={stop.status} />
        </p>
        <p className="sm:col-span-2">
          <span className="text-slate-500">Address:</span> {addressLine(stop.address_json)}
        </p>
        <p>
          <span className="text-slate-500">Phone:</span> {stop.contact_phone ?? stop.customer_phone}
        </p>
        <p>
          <span className="text-slate-500">Agent:</span> {stop.driver_name ?? "Not assigned"}
        </p>
        {stop.instructions && <p className="sm:col-span-2">Instructions: {stop.instructions}</p>}
      </div>
      {stop.items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {stop.items.map((i: any) => (
            <li key={i.id} className="flex gap-2 px-3 py-1.5">
              <span className="font-mono text-xs">{i.tag_code}</span> {i.garment_type_name} · {i.service_name}
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Timeline</p>
        <ul className="space-y-1 text-sm">
          {stop.events.map((e: any, i: number) => (
            <li key={i}>
              <span className="text-xs text-slate-500">{dateTime(e.occurred_at)}</span> · <strong>{e.event.replace(/_/g, " ")}</strong>
              {e.notes && ` — ${e.notes}`} <span className="text-xs text-slate-500">({e.actor})</span>
            </li>
          ))}
        </ul>
      </div>
      {cancelling && <Textarea rows={2} placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} />}
    </Modal>
  );
}
