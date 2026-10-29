"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ORDER_STATUS_LABELS } from "@drycare/shared";
import {
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  MapPin,
  Search,
  Shirt,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, isOverdue, money } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, OrderStatusBadge, PaymentStatusBadge, Select, Spinner, cx } from "@/components/ui";

const VIEWS = [
  ["all", "All orders"],
  ["open", "In progress"],
  ["ready", "Ready"],
  ["overdue", "Overdue"],
  ["unpaid", "Dues pending"],
] as const;

type Order = {
  id: string;
  order_number: string;
  operational_status: string;
  received_at: string;
  promised_at: string;
  grand_total: number | string;
  paid: number | string;
  balance: number | string;
  express: boolean;
  currency: string;
  customer_name: string;
  customer_phone: string | null;
  branch_code: string;
  garment_count: number;
};

type OrderList = { items: Order[]; limit: number; offset: number };

function OrdersInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState(params.get("q") ?? "");
  const view = params.get("view") ?? "all";
  const status = params.get("status") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const query = new URLSearchParams({
    view,
    offset: String(offset),
    limit: "30",
    ...(params.get("q") ? { q: params.get("q")! } : {}),
    ...(status ? { status } : {}),
  });
  const { data, error, loading } = useApi<OrderList>(`/orders?${query}`);
  const items = data?.items ?? [];
  const hasFilters = view !== "all" || !!status || !!params.get("q");
  const pageNumber = Math.floor(offset / 30) + 1;

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
    if (!("offset" in patch)) next.delete("offset");
    const search = next.toString();
    router.push(search ? `/orders?${search}` : "/orders");
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    go({ q: q.trim() });
  };

  return (
    <div className="space-y-5 pb-8">
      <section className="relative overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-white via-brand-50/70 to-cyan-50/70 px-5 py-5 shadow-sm sm:px-7 sm:py-6">
        <div className="pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full border border-brand-200/50" />
        <div className="pointer-events-none absolute -right-1 -top-12 h-40 w-40 rounded-full border border-brand-200/40" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">
              <ClipboardList className="h-4 w-4" /> Store operations
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Orders</h1>
            <p className="mt-1.5 text-sm text-slate-600">Track garment care from customer drop-off to collection.</p>
          </div>
          {can("orders.create") && (
            <Link href="/pos">
              <Button className="!bg-brand-700 !text-white shadow-md shadow-brand-900/15 hover:!bg-brand-800">
                <ShoppingBag className="h-4 w-4" /> New order
              </Button>
            </Link>
          )}
        </div>
      </section>

      <Card className="overflow-hidden" padded={false}>
        <div className="border-b border-slate-100 px-3 pt-3 sm:px-4">
          <div className="dc-tabs flex gap-1 pb-2" role="tablist" aria-label="Order views">
            {VIEWS.map(([key, label]) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => go({ view: key, status: "" })}
                  className={cx(
                    "shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition",
                    active ? "bg-brand-700 text-white shadow-sm shadow-brand-900/15" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:px-4">
          <form onSubmit={applySearch} className="flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search order, customer or phone"
                aria-label="Search order, customer or phone"
                className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 focus:bg-white"
              />
            </div>
            <Button type="submit" className="h-10 rounded-xl px-3.5">
              Search
            </Button>
          </form>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500 sm:text-sm">
            <SlidersHorizontal className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Status</span>
            <Select value={status} onChange={(event) => go({ status: event.target.value })} aria-label="Filter by order status" className="h-10 w-full min-w-40 rounded-xl border-slate-200 bg-white sm:w-auto">
              <option value="">Any status</option>
              {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </label>
          {hasFilters && (
            <button type="button" onClick={() => { setQ(""); go({ view: "all", q: "", status: "" }); }} className="inline-flex items-center gap-1 self-start rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:self-center">
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>
      </Card>

      {error && <Alert>{error.message}</Alert>}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600"><ClipboardList className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{view === "all" ? "Order register" : VIEWS.find(([key]) => key === view)?.[1] ?? "Orders"}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{loading && !data ? "Loading orders…" : `${items.length} order${items.length === 1 ? "" : "s"} shown · Page ${pageNumber}`}</p>
            </div>
          </div>
          {view !== "all" && <Badge color={view === "overdue" ? "red" : view === "ready" ? "green" : view === "unpaid" ? "amber" : "blue"}>{VIEWS.find(([key]) => key === view)?.[1]}</Badge>}
        </div>

        {loading && !data ? (
          <Spinner label="Loading orders…" />
        ) : (
          <>
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-white text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Received / promised</th>
                    <th className="px-4 py-3 text-center">Items</th>
                    <th className="px-4 py-3 text-right">Order total</th>
                    <th className="px-4 py-3">Order status</th>
                    <th className="px-4 py-3">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((order) => {
                    const overdue = isOverdue(order.promised_at, order.operational_status);
                    return (
                      <tr key={order.id} className="group transition hover:bg-brand-50/40">
                        <td className="px-4 py-3.5">
                          <Link href={`/orders/view?id=${order.id}`} className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:text-brand-700 hover:underline">
                            {order.order_number}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                          </Link>
                          <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><MapPin className="h-3 w-3" />{order.branch_code}</span>
                          {order.express && <Badge color="amber" className="mt-1">Express</Badge>}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="block font-medium text-slate-800">{order.customer_name}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{order.customer_phone ?? "No phone"}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="block text-xs text-slate-700">{dateTime(order.received_at)}</span>
                          <span className={cx("mt-1 flex items-center gap-1 text-xs", overdue ? "font-medium text-red-600" : "text-slate-500")}>
                            <CalendarClock className="h-3 w-3" /> Due {dateTime(order.promised_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium tabular-nums text-slate-700"><Shirt className="h-3.5 w-3.5 text-slate-500" />{order.garment_count}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="block font-semibold tabular-nums text-slate-800">{money(order.grand_total, order.currency)}</span>
                          <span className={cx("mt-1 block text-xs tabular-nums", Number(order.balance) > 0 ? "font-medium text-amber-700" : "text-slate-500")}>
                            {Number(order.balance) > 0 ? `${money(order.balance, order.currency)} due` : "Settled"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <OrderStatusBadge status={order.operational_status} />
                          {overdue && <Badge color="red" className="ml-1.5">Overdue</Badge>}
                        </td>
                        <td className="px-4 py-3.5">
                          <PaymentStatusBadge total={Number(order.grand_total)} paid={Number(order.paid)} cancelled={order.operational_status === "cancelled"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 xl:hidden">
              {items.map((order) => {
                const overdue = isOverdue(order.promised_at, order.operational_status);
                return (
                  <article key={order.id} className="p-4 transition hover:bg-slate-50/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/orders/view?id=${order.id}`} className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline">
                          {order.order_number}<ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        <p className="mt-1 truncate text-sm font-medium text-slate-800">{order.customer_name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{order.customer_phone ?? "No phone"} <span className="mx-1 text-slate-300">·</span> {order.branch_code}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums text-slate-900">{money(order.grand_total, order.currency)}</p>
                        <p className={cx("mt-1 text-xs tabular-nums", Number(order.balance) > 0 ? "font-medium text-amber-700" : "text-slate-500")}>
                          {Number(order.balance) > 0 ? `${money(order.balance, order.currency)} due` : "Settled"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <OrderStatusBadge status={order.operational_status} />
                      <PaymentStatusBadge total={Number(order.grand_total)} paid={Number(order.paid)} cancelled={order.operational_status === "cancelled"} />
                      {order.express && <Badge color="amber">Express</Badge>}
                      {overdue && <Badge color="red">Overdue</Badge>}
                      <Badge color="slate"><Shirt className="h-3 w-3" />{order.garment_count} items</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Received {dateTime(order.received_at)}</span>
                      <span className={cx("inline-flex items-center gap-1", overdue && "font-medium text-red-600")}><CalendarClock className="h-3.5 w-3.5" /> Due {dateTime(order.promised_at)}</span>
                    </div>
                  </article>
                );
              })}
            </div>

            {items.length === 0 && (
              <Empty title={hasFilters ? "No orders match these filters" : "No orders yet"}>
                <span className="block">
                  {hasFilters ? "Try changing the search or filters." : "Create an order to start tracking garments from intake to collection."}
                </span>
                {hasFilters ? (
                  <button type="button" onClick={() => { setQ(""); go({ view: "all", q: "", status: "" }); }} className="mt-2 font-medium text-brand-700 hover:underline">Clear all filters</button>
                ) : can("orders.create") ? (
                  <Link href="/pos" className="mt-2 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">Create an order <ArrowRight className="h-3.5 w-3.5" /></Link>
                ) : null}
              </Empty>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <p className="text-xs text-slate-500">{items.length} order{items.length === 1 ? "" : "s"} on this page</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => go({ offset: String(Math.max(0, offset - 30)) })}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="min-w-16 text-center text-xs font-medium text-slate-500">Page {pageNumber}</span>
            <Button variant="secondary" size="sm" disabled={items.length < 30} onClick={() => go({ offset: String(offset + 30) })}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
