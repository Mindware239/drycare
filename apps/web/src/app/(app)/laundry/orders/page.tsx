"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CirclePlus, Search } from "lucide-react";
import { LAUNDRY_METHOD_LABELS, type LaundryPricingMethod } from "@drycare/shared";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, todayISO } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { ORDER_STATUS, kg } from "../laundry-ui";

export default function LaundryOrdersPage() {
  const { branchId, can } = useSession();
  const [status, setStatus] = useState("");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  useEffect(() => { const t = setTimeout(() => setSearch(input.trim()), 300); return () => clearTimeout(t); }, [input]);
  const q = new URLSearchParams({ branchId, from, to, ...(status ? { status } : {}), ...(search ? { search } : {}) });
  const list = useApi<any[]>(`/laundry/orders?${q}`);

  return (
    <div className="space-y-5">
      <PageHeader title="Self-service orders" subtitle="Every wash, dry and ironing order with its payment and machine status." actions={can("laundry.operate") && <Link href="/laundry/new"><Button><CirclePlus className="h-4 w-4" />New order</Button></Link>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <label className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Order no., name or mobile" className="pl-9" aria-label="Search" /></label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" />
        </div>
        {!list.data ? <Spinner /> : !list.data.length ? <Empty title="No self-service orders in this period" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Service</th><th className="px-4 py-2.5">Machines</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Total</th><th className="px-4 py-2.5 text-right">Paid</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3"><Link href={`/laundry/orders/view?id=${o.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{o.orderNumber}</Link><span className="block text-xs text-slate-500">{dateTime(o.createdAt)}</span></td>
                    <td className="px-4 py-3">{o.customerName}<span className="block text-xs text-slate-500">{o.phone ?? ""}</span></td>
                    <td className="px-4 py-3">{o.serviceName}<span className="block text-xs text-slate-500">{LAUNDRY_METHOD_LABELS[o.pricingMethod as LaundryPricingMethod]}{o.weightGrams ? ` · ${kg(o.weightGrams)}` : ""}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-600">{o.machines?.replaceAll(":", " · ") ?? "—"}</td>
                    <td className="px-4 py-3"><Badge color={ORDER_STATUS[o.status]?.color ?? "slate"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(o.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(o.paid) >= Number(o.total) ? <span className="text-emerald-700">{money(o.paid)}</span> : <span className="text-amber-700">{money(o.paid)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
