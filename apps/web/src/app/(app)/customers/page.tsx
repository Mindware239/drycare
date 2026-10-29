"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, money } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { CustomerForm, CUSTOMER_TYPES as TYPES } from "@/components/CustomerForm";

function CustomersInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [customerType, setCustomerType] = useState(params.get("customerType") ?? "");
  const [inactive, setInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams({
    limit: "50",
    ...(params.get("q") ? { q: params.get("q")! } : {}),
    ...(params.get("customerType") ? { customerType: params.get("customerType")! } : {}),
    ...(inactive ? { includeInactive: "true" } : {}),
  });
  const { data, error, loading } = useApi(`/customers?${qs}`);

  return (
    <div>
      <PageHeader title="Customers" actions={can("customers.write") && <Button onClick={() => setCreating(true)}>New customer</Button>} />
      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams();
          if (q.trim()) next.set("q", q.trim());
          if (customerType) next.set("customerType", customerType);
          router.push(`/customers${next.size ? `?${next}` : ""}`);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile, email, customer ID or order" className="w-80" aria-label="Search customers" />
        <Select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className="w-44" aria-label="Filter by customer type">
          <option value="">All customer types</option>
          {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Button variant="secondary" type="submit">
          Search
        </Button>
        <label className="ml-2 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Include inactive
        </label>
      </form>
      {error && <Alert>{error.message}</Alert>}
      <Card padded={false}>
        {loading && !data ? (
          <Spinner />
        ) : (
          <Table head={["ID", "Name", "Phone", "Email", "Type", "Last order", "Orders", ...(data?.financialVisible ? ["Outstanding"] : [])]} empty={data?.items.length === 0 && <Empty title="No customers found" />}>
            {data?.items.map((c: any) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{c.customerCode}</Td>
                <Td className="font-medium">
                  <Link className="font-medium text-brand-700 hover:text-brand-900 hover:underline" href={`/customers/view?id=${encodeURIComponent(c.id)}`}>
                    {c.name}
                  </Link> {c.status === "inactive" && <Badge>Inactive</Badge>}
                </Td>
                <Td>{c.phone ?? "—"}</Td>
                <Td>{c.email ?? "—"}</Td>
                <Td>
                  <Badge color={c.customerType === "vip" ? "violet" : c.customerType === "corporate" ? "blue" : "slate"}>{TYPES[c.customerType] ?? c.customerType}</Badge>
                </Td>
                <Td>{dateOnly(c.lastOrderAt)}</Td>
                <Td className="text-right tabular-nums">{c.totalOrders}</Td>
                {data?.financialVisible && <Td className={c.outstanding > 0 ? "text-right font-medium tabular-nums text-amber-700" : "text-right tabular-nums"}>{money(c.outstanding)}</Td>}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={(c) => router.push(`/customers/view?id=${c.id}`)} />}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense>
      <CustomersInner />
    </Suspense>
  );
}
