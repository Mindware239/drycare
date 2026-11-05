"use client";
import Link from "next/link";
import { Barcode, Crown, Printer, Radio, ScanLine, ShoppingBag, Truck } from "lucide-react";
import { LOCATION_LABELS, STAGE_LABELS, type GarmentLocation, type GarmentStage } from "@drycare/shared";
import { dateTime, money } from "@/lib/format";
import { Badge, Card, StageBadge, Table, Td, cx } from "@/components/ui";

export type TagTraceData = {
  kind: "garment" | "bag";
  label: { id: string; scanCode: string; code: string };
  rfid?: { epc: string | null; lastSeen: { at: string; notes: string | null; actor: string | null } | null } | null;
  customer?: { id: string; name: string; code: string | null; phone: string | null };
  membership: { planName: string; discountBps: number; freeExpress: boolean; perks: string[]; endsAt: string } | null;
  order: { id: string; orderNumber: string; status: string; receivedAt: string; promisedAt: string; express: boolean; branchName: string | null; branchCode: string | null; createdBy: string | null; invoiceNumber: string | null; total?: number; paid?: number; credits?: number; balance?: number; discount?: number };
  tags: { id: string; scanCode: string; tagCode: string; status: string; location: string; bagId: string | null; garment: string; service: string; colour: string | null; brand: string | null; rack: string | null; rfid?: string | null }[];
  bags: { id: string; scanCode: string; bagCode: string; pieces: number }[];
  timeline: TimelineEvent[];
};

type TimelineEvent = { id: string; at: string; actor: string | null } & (
  | { type: "status"; from: string | null; to: string; kind: string; notes: string | null; location: string | null; tagCode: string }
  | { type: "scan"; step: string; result: string; code: string; batch: string | null }
  | { type: "delivery"; event: string; notes: string | null }
  | { type: "rfid"; action: string; epc: string; notes: string | null }
  | { type: "print"; scope: string; labels: number; status: string; error: string | null }
);

const stage = (s: string | null) => (s ? STAGE_LABELS[s as GarmentStage] ?? s.replace(/_/g, " ") : "");
const words = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const where = (l: string | null) => (l ? LOCATION_LABELS[l as GarmentLocation] ?? words(l) : "");

function describe(e: TimelineEvent, showTag: boolean): { icon: typeof ScanLine; title: string; detail?: string | null; tone?: "red" | "green" } {
  if (e.type === "status") {
    const tag = showTag ? `${e.tagCode}: ` : "";
    if (e.kind === "intake") return { icon: ShoppingBag, title: `${tag}Tag created when the order was booked`, detail: e.notes };
    if (e.kind === "location") return { icon: Truck, title: `${tag}${e.notes ?? "Location changed"}` };
    if (e.kind === "qc_pass") return { icon: ScanLine, title: `${tag}Passed quality check`, detail: e.notes, tone: "green" };
    if (e.kind === "qc_fail") return { icon: ScanLine, title: `${tag}Failed quality check, sent for rework`, detail: e.notes, tone: "red" };
    return { icon: ScanLine, title: `${tag}Moved to ${stage(e.to)}`, detail: [e.from ? `From ${stage(e.from)}` : "", e.notes].filter(Boolean).join(". "), tone: e.to === "exception" ? "red" : undefined };
  }
  if (e.type === "scan") {
    if (e.step === "lookup") return { icon: ScanLine, title: "Scanned at the scan station" };
    const step = e.step === "dispatch" ? "Scanned when sent to the facility" : "Scanned when received back";
    return { icon: Truck, title: step, detail: [e.batch ? `Batch ${e.batch}` : "", e.result === "verified" ? "" : words(e.result)].filter(Boolean).join(". "), tone: e.result === "verified" ? undefined : "red" };
  }
  if (e.type === "rfid") {
    const title = { linked: "RFID tag linked", unlinked: "RFID tag removed", released: "RFID tag released for reuse", read: "RFID tag read", retired: "RFID tag retired", registered: "RFID tag added" }[e.action] ?? "RFID";
    return { icon: Radio, title, detail: [e.epc, e.notes].filter(Boolean).join(". ") };
  }
  if (e.type === "delivery") return { icon: Truck, title: `Pickup and delivery: ${words(e.event)}`, detail: e.notes };
  const what = e.scope === "bag" ? "Bag label" : e.scope === "garments" ? "Chosen tags" : "Bag label and tags";
  if (e.status === "failed") return { icon: Printer, title: `${what}: print failed`, detail: e.error, tone: "red" };
  return { icon: Printer, title: `${what}: ${e.status === "printed" ? "printed" : "sent to print"}`, detail: `${e.labels} label${e.labels === 1 ? "" : "s"}` };
}

/** Everything that has happened to this label, newest first, with who did it and when. */
export function TagTimeline({ data }: { data: TagTraceData }) {
  return (
    <Card title="Complete history" padded={false}>
      <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto text-sm">
        {data.timeline.map((e) => {
          const d = describe(e, data.kind === "bag");
          const Icon = d.icon;
          return (
            <li key={`${e.type}-${e.id}`} className="flex gap-3 px-4 py-2.5">
              <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", d.tone === "red" ? "text-red-600" : d.tone === "green" ? "text-emerald-600" : "text-slate-400")} />
              <div className="min-w-0">
                <p className={cx("font-medium", d.tone === "red" ? "text-red-800" : "text-slate-800")}>{d.title}</p>
                {d.detail && <p className="text-xs text-slate-600">{d.detail}</p>}
                <p className="text-xs text-slate-500">{dateTime(e.at)}{e.actor ? ` · ${e.actor}` : ""}</p>
              </div>
            </li>
          );
        })}
        {data.timeline.length === 0 && <li className="px-4 py-8 text-center text-slate-500">Nothing recorded yet.</li>}
      </ul>
    </Card>
  );
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-right font-medium text-slate-900">{children}</dd>
  </div>
);

/** Who this label belongs to, the sale behind it, and every other label on the same order. */
export function TagRecord({ data }: { data: TagTraceData }) {
  const { order, customer, membership } = data;
  const showsMoney = order.total !== undefined;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-3">
        <Card title="Barcode">
          <p className="flex items-center gap-2 font-mono text-2xl font-bold text-slate-900"><Barcode className="h-5 w-5 text-slate-400" />{data.label.scanCode}</p>
          <dl className="mt-2">
            <Fact label="Label">{data.kind === "bag" ? "Bag label" : "Garment tag"}</Fact>
            <Fact label="Full number"><span className="font-mono text-xs">{data.label.code}</span></Fact>
            <Fact label="Store code"><span className="font-mono text-xs">{order.branchCode ?? "—"}</span></Fact>
            {data.rfid?.epc && <Fact label="RFID tag"><span className="break-all font-mono text-xs">{data.rfid.epc}</span></Fact>}
            {data.rfid?.lastSeen && <Fact label="Last seen">{dateTime(data.rfid.lastSeen.at)}{data.rfid.lastSeen.notes ? ` · ${data.rfid.lastSeen.notes}` : ""}</Fact>}
          </dl>
        </Card>
        <Card title="Customer">
          {customer ? (
            <dl>
              <Fact label="Name"><Link href={`/customers/view?id=${customer.id}`} className="text-brand-700 hover:underline">{customer.name}</Link></Fact>
              {customer.phone && <Fact label="Phone">{customer.phone}</Fact>}
              {customer.code && <Fact label="Customer number">{customer.code}</Fact>}
              <Fact label="Membership">
                {membership ? <span className="inline-flex items-center gap-1 text-amber-700"><Crown className="h-3.5 w-3.5" />{membership.planName}, {membership.discountBps / 100}% off</span> : "None"}
              </Fact>
            </dl>
          ) : <p className="text-sm text-slate-500">Not recorded.</p>}
        </Card>
        <Card title="Order and sale">
          <dl>
            <Fact label="Order"><Link href={`/orders/view?id=${order.id}`} className="text-brand-700 hover:underline">{order.orderNumber}</Link></Fact>
            <Fact label="Booked">{dateTime(order.receivedAt)}{order.createdBy ? ` · ${order.createdBy}` : ""}</Fact>
            <Fact label="Due">{dateTime(order.promisedAt)}{order.express ? " · Express" : ""}</Fact>
            {order.branchName && <Fact label="Store">{order.branchName}</Fact>}
            {order.invoiceNumber && <Fact label="Invoice">{order.invoiceNumber}</Fact>}
            {showsMoney && <Fact label="Total">{money(order.total!)}</Fact>}
            {showsMoney && <Fact label="Paid">{money(order.paid!)}</Fact>}
            {showsMoney && <Fact label="Balance"><span className={order.balance! > 0 ? "text-red-700" : "text-emerald-700"}>{money(order.balance!)}</span></Fact>}
          </dl>
        </Card>
      </div>
      <Card title={`All labels on this order (${data.tags.length + data.bags.length})`} padded={false}>
        <Table head={["Barcode", "Full number", "Item", "Stage", "Where", "Rack"]}>
          {data.bags.map((b) => (
            <tr key={b.id} className={b.id === data.label.id ? "bg-brand-50" : undefined}>
              <Td className="font-mono font-semibold"><Link href={`/tags/view?code=${b.scanCode}`} className="hover:text-brand-700">{b.scanCode}</Link></Td>
              <Td className="font-mono text-xs text-slate-500">{b.bagCode}</Td>
              <Td>Bag label, {b.pieces} piece{b.pieces === 1 ? "" : "s"}</Td>
              <Td><Badge>Bag</Badge></Td><Td>—</Td><Td>—</Td>
            </tr>
          ))}
          {data.tags.map((t) => (
            <tr key={t.id} className={t.id === data.label.id ? "bg-brand-50" : undefined}>
              <Td className="font-mono font-semibold"><Link href={`/tags/view?code=${t.scanCode}`} className="hover:text-brand-700">{t.scanCode}</Link></Td>
              <Td className="font-mono text-xs text-slate-500">{t.tagCode}{t.rfid && <span className="mt-0.5 flex items-center gap-1 text-slate-400" title={t.rfid}><Radio className="h-3 w-3" />RFID …{t.rfid.slice(-8)}</span>}</Td>
              <Td><span className="font-medium">{t.garment}</span> <span className="text-slate-500">· {[t.service, t.colour, t.brand].filter(Boolean).join(" · ")}</span></Td>
              <Td><StageBadge stage={t.status} /></Td>
              <Td className="text-xs text-slate-600">{where(t.location)}</Td>
              <Td>{t.rack ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
