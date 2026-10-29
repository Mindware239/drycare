"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, dateTime, money } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, OrderStatusBadge, PageHeader, Spinner, Stat, Table, Td, cx } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
import { ScheduleModal } from "@/components/ScheduleModal";
import { CustomerWallet } from "@/components/CustomerWallet";
import { CLAIM_KINDS, CLAIM_STATUS_LABELS, type ClaimKind, type ClaimStatus } from "@drycare/shared";

const TABS = ["Orders", "Garments", "Payments", "Wallet", "Claims", "Addresses", "Preferences"] as const;

function CustomerProfileInner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { can, branchId } = useSession();
  const [scheduling, setScheduling] = useState(false);
  const { data: c, error, loading, reload } = useApi(`/customers/${id}`);
  const orders = useApi<any[]>(can("orders.read") ? `/customers/${id}/orders` : null);
  const garments = useApi<any[]>(can("orders.read") ? `/customers/${id}/garments` : null);
  const payments = useApi<any[]>(can("reports.financial") ? `/customers/${id}/payments` : null);
  const [tab, setTab] = useState<(typeof TABS)[number]>(can("orders.read") ? "Orders" : "Addresses");
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);

  if (loading && !c) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!c) return null;

  async function toggleActive() {
    await api(`/customers/${id}`, { method: "PATCH", body: { status: c.status === "active" ? "inactive" : "active" } });
    reload();
  }

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.customerCode}</span> · {c.phone ?? "No phone"} {c.email && `· ${c.email}`}
            <Badge>{c.customerType.replace("_", "-")}</Badge>
            {c.status !== "active" && <Badge color="red">{c.status}</Badge>}
          </span>
        }
        actions={
          <>
            {can("customers.write") && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {can("customers.merge") && (
              <Button variant="secondary" onClick={() => setMerging(true)}>
                Merge duplicate
              </Button>
            )}
            {can("customers.write") && (
              <Button variant="ghost" onClick={toggleActive}>
                {c.status === "active" ? "Mark inactive" : "Reactivate"}
              </Button>
            )}
            {can("deliveries.manage") && c.status === "active" && (
              <Button variant="secondary" onClick={() => setScheduling(true)}>
                Schedule pickup
              </Button>
            )}
            {can("orders.create") && c.status === "active" && (
              <Link href={`/pos?customerId=${c.id}`}>
                <Button>New order</Button>
              </Link>
            )}
          </>
        }
      />
      <div className={cx("mb-5 grid grid-cols-2 gap-3", c.financialVisible ? "lg:grid-cols-5" : "lg:grid-cols-2")}>
        <Stat label="Total orders" value={c.stats.totalOrders} />
        {c.financialVisible && <Stat label="Total spent" value={money(c.stats.totalBilled)} />}
        {c.financialVisible && <Stat label="Avg. order value" value={money(c.stats.averageOrderValue)} />}
        <Stat label="Ready to collect" value={c.stats.readyOrders} tone={c.stats.readyOrders ? "green" : undefined} />
        {c.financialVisible && <Stat label="Outstanding" value={money(c.stats.outstanding)} tone={c.stats.outstanding > 0 ? "amber" : undefined} />}
      </div>
      {c.careInstructions && (
        <div className="mb-4">
          <Alert tone="blue">Care preferences: {c.careInstructions}</Alert>
        </div>
      )}
      <div className="dc-tabs mb-3 flex gap-1 whitespace-nowrap border-b border-slate-200">
        {TABS.filter((t) => (t !== "Orders" || can("orders.read")) && (t !== "Payments" || c.financialVisible) && (t !== "Garments" || can("orders.read")) && (t !== "Claims" || can("complaints.manage"))).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Orders" && (
        <Card padded={false}>
          {orders.error && <Alert>{orders.error.message}</Alert>}
          {orders.loading && !orders.data && !orders.error && <Spinner />}
          <Table head={["Order", "Received", "Promised", "Items", ...(c.financialVisible ? ["Total", "Balance"] : []), "Status"]}>
            {orders.data?.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/orders/view?id=${o.id}`)}>
                <Td className="font-medium text-brand-700">{o.order_number}</Td>
                <Td>{dateTime(o.received_at)}</Td>
                <Td>{dateTime(o.promised_at)}</Td>
                <Td className="text-right">{o.garment_count}</Td>
                {c.financialVisible && <Td className="text-right tabular-nums">{money(o.grand_total)}</Td>}
                {c.financialVisible && <Td className={cx("text-right tabular-nums", Number(o.balance) > 0 && "font-medium text-amber-700")}>{money(o.balance)}</Td>}
                <Td>
                  <OrderStatusBadge status={o.operational_status} />
                </Td>
              </tr>
            ))}
          </Table>
          {orders.data?.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No orders yet.</p>}
        </Card>
      )}
      {tab === "Garments" && (
        <Card padded={false}>
          {garments.error && <Alert>{garments.error.message}</Alert>}
          {!garments.data && !garments.error ? <Spinner /> : garments.data ? (
            <Table head={["Tag", "Garment", "Service", "Order", "Received", "Colour", "Status", ...(c.financialVisible ? ["Charged"] : [])]}>
              {garments.data.map((g: any) => (
                <tr key={g.id}>
                  <Td className="font-mono text-xs">{g.tag_code}</Td>
                  <Td className="font-medium">{g.garment_type_name}</Td>
                  <Td>{g.service_name}</Td>
                  <Td><Link className="text-brand-700 hover:underline" href={`/orders/view?id=${g.order_id}`}>{g.order_number}</Link></Td>
                  <Td>{dateTime(g.received_at)}</Td>
                  <Td>{g.colour ?? "—"}</Td>
                  <Td><Badge color={g.current_status === "delivered" ? "green" : g.current_status === "exception" ? "red" : "blue"}>{String(g.current_status).replace(/_/g, " ")}</Badge></Td>
                  {c.financialVisible && <Td className="text-right tabular-nums">{money(g.unit_price)}</Td>}
                </tr>
              ))}
            </Table>
          ) : null}
          {garments.data?.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No garment history yet.</p>}
        </Card>
      )}
      {tab === "Payments" && (
        <Card padded={false}>
          {payments.error && <Alert>{payments.error.message}</Alert>}
          {payments.loading && !payments.data && !payments.error && <Spinner />}
          <Table head={["Date", "Reference", "Order", "Method", "Amount", "Refunded"]}>
            {payments.data?.map((p) => (
              <tr key={p.id}>
                <Td>{dateTime(p.received_at)}</Td>
                <Td className="font-mono text-xs">{p.payment_reference}</Td>
                <Td>{p.order_number}</Td>
                <Td>{p.payment_method.toUpperCase()}</Td>
                <Td className="text-right tabular-nums">{money(p.amount)}</Td>
                <Td className="text-right tabular-nums">{Number(p.refunded) ? money(p.refunded) : "—"}</Td>
              </tr>
            ))}
          </Table>
          {payments.data?.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No payments yet.</p>}
        </Card>
      )}
      {tab === "Wallet" && <CustomerWallet customerId={c.id} customerName={c.name} />}
      {tab === "Claims" && <CustomerClaims customerId={c.id} />}
      {tab === "Addresses" && <Addresses customer={c} reload={reload} />}
      {tab === "Preferences" && (
        <Card>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Order updates via</dt>
              <dd className="font-medium">{c.notificationChannel}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Marketing consent</dt>
              <dd className="font-medium">{c.marketingConsent ? `Yes (since ${dateOnly(c.marketingConsentAt)})` : "No"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Preferred language</dt>
              <dd className="font-medium">{c.preferredLanguage}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Customer GSTIN</dt>
              <dd className="font-medium">{c.gstin || "Not provided"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Customer since</dt>
              <dd className="font-medium">{dateOnly(c.createdAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Internal notes</dt>
              <dd>{c.notes || "—"}</dd>
            </div>
          </dl>
        </Card>
      )}
      {scheduling && <ScheduleModal branchId={branchId} customerId={c.id} canCredit={can("orders.release_with_due")} onClose={() => setScheduling(false)} onDone={() => (setScheduling(false), reload())} />}
      {editing && <CustomerForm initial={c} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), reload())} />}
      {merging && <MergeModal target={c} onClose={() => setMerging(false)} onDone={() => (setMerging(false), reload(), orders.reload(), payments.reload())} />}
    </div>
  );
}

function Addresses({ customer, reload }: { customer: any; reload: () => void }) {
  const { can } = useSession();
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = { label: "Home", line1: "", locality: "", city: "", state: "", pincode: "", isDefault: false };
  const [f, setF] = useState(emptyForm);
  const [err, setErr] = useState("");
  async function save() {
    setErr("");
    try {
      if (editingId) {
        await api(`/customers/${customer.id}/addresses/${editingId}`, { method: "PATCH", body: f });
      } else {
        await api(`/customers/${customer.id}/addresses`, { body: { ...f, isDefault: f.isDefault || customer.addresses.length === 0 } });
      }
      setEditingId(null);
      setF(emptyForm);
      reload();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  function edit(address: any) {
    setErr("");
    setEditingId(address.id);
    setF({
      label: address.label ?? "Home",
      line1: address.address.line1 ?? "",
      locality: address.address.locality ?? "",
      city: address.address.city ?? "",
      state: address.address.state ?? "",
      pincode: address.address.pincode ?? "",
      isDefault: address.isDefault,
    });
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Saved addresses">
        {customer.addresses.length === 0 ? (
          <p className="text-sm text-slate-500">No addresses saved.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {customer.addresses.map((a: any) => (
              <li key={a.id} className="rounded-lg border border-slate-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{a.label} {a.isDefault && <Badge color="brand">Default</Badge>}</p>
                    <p className="text-slate-600">{[a.address.line1, a.address.locality, a.address.city, a.address.state, a.address.pincode].filter(Boolean).join(", ")}</p>
                  </div>
                  {can("customers.write") && <Button size="sm" variant="secondary" onClick={() => edit(a)}>Edit</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can("customers.write") && (
        <Card title={editingId ? "Edit pickup / delivery address" : "Add pickup / delivery address"}>
          {err && <Alert>{err}</Alert>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Label">
              <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} />
            </Field>
            <Field label="Locality">
              <Input value={f.locality} onChange={(e) => setF({ ...f, locality: e.target.value })} />
            </Field>
            <Field label="City">
              <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            </Field>
            <Field label="State">
              <Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
            </Field>
            <Field label="PIN code">
              <Input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
            Set as default address
          </label>
          <div className="mt-3 flex gap-2">
            <Button onClick={save} disabled={!f.line1.trim()}>{editingId ? "Save address" : "Add address"}</Button>
            {editingId && <Button variant="secondary" onClick={() => { setEditingId(null); setF(emptyForm); }}>Cancel</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}

function MergeModal({ target, onClose, onDone }: { target: any; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [source, setSource] = useState<any>(null);
  const [err, setErr] = useState("");
  async function search() {
    const r = await api(`/customers?q=${encodeURIComponent(q)}&limit=10&includeInactive=true`);
    setResults(r.items.filter((x: any) => x.id !== target.id));
  }
  async function merge() {
    try {
      await api(`/customers/${target.id}/merge`, { body: { sourceCustomerId: source.id } });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  return (
    <Modal
      open
      title={`Merge a duplicate into ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!source} onClick={merge}>
            Merge
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">All orders, invoices, payments and addresses of the duplicate move to this profile. The duplicate is kept as &quot;merged&quot; for the audit trail.</p>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the duplicate" />
        <Button variant="secondary" onClick={search}>
          Find
        </Button>
      </div>
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={r.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="src" checked={source?.id === r.id} onChange={() => setSource(r)} /> {r.name} · {r.phone ?? "no phone"} · {r.customerCode} ({r.totalOrders} orders)
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export default function CustomerProfile() {
  return (
    <Suspense>
      <CustomerProfileInner />
    </Suspense>
  );
}

/** Damage, loss and service complaints this customer has raised, newest first. */
function CustomerClaims({ customerId }: { customerId: string }) {
  const claims = useApi<any[]>(`/claims?status=all&customerId=${customerId}`);
  const tone: Record<string, "red" | "amber" | "blue" | "slate" | "green"> = { open: "red", investigating: "amber", approved: "blue", rejected: "slate", settled: "green" };
  return (
    <Card padded={false} title={`${claims.data?.length ?? 0} claim${claims.data?.length === 1 ? "" : "s"}`} actions={<Link href={`/claims?customerId=${customerId}`}><Button size="sm">New claim</Button></Link>}>
      {claims.error && <div className="p-4"><Alert>{claims.error.message}</Alert></div>}
      {!claims.data ? <Spinner /> : !claims.data.length ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">No complaints or damage claims from this customer.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {claims.data.map((cl) => (
            <li key={cl.id}>
              <Link href={`/claims?id=${cl.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{cl.claimNumber} · {CLAIM_KINDS[cl.kind as ClaimKind] ?? cl.kind}</span>
                  <span className="block truncate text-xs text-slate-500">{dateOnly(cl.createdAt)}{cl.orderNumber ? ` · ${cl.orderNumber}` : ""} · {cl.description}</span>
                </span>
                {Number(cl.approvedAmount) > 0 && <span className="text-sm font-semibold tabular-nums text-slate-900">{money(cl.approvedAmount)}</span>}
                <Badge color={tone[cl.status] ?? "slate"}>{CLAIM_STATUS_LABELS[cl.status as ClaimStatus] ?? cl.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
