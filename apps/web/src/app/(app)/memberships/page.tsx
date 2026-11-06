"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Crown, Pencil, Plus, Search } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { currentRegion, dateOnly, money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, cx } from "@/components/ui";

type MembershipPlan = { id: string; name: string; description: string | null; price: number; taxBps: number; durationDays: number; discountBps: number; freeExpress: boolean; perks: string[]; active: boolean };
type Summary = { current: number; expiring: number; sales: number | null; salesCount: number | null; discountGiven: number | null };
type Member = { id: string; customerId: string; customerName: string; customerPhone: string | null; planName: string; discountBps: number; pricePaid: number; startsAt: string; endsAt: string; status: string };

const STATES = [["current", "Current"], ["expiring", "Expiring in 15 days"], ["expired", "Expired"], ["cancelled", "Cancelled"], ["all", "All"]] as const;

const durationLabel = (days: number) => (days % 365 === 0 ? `${days / 365} year${days === 365 ? "" : "s"}` : days % 30 === 0 ? `${days / 30} month${days === 30 ? "" : "s"}` : `${days} days`);

/** Membership plans this shop sells, and the customers who have them. */
export default function MembershipsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<"members" | "plans">("members");
  return (
    <div className="space-y-5">
      <PageHeader title="Memberships" subtitle="Sell membership plans to your customers. Members get their benefits automatically on every order, and a reminder before their plan ends." />
      <MembershipNumbers />
      <div className="flex gap-1 border-b border-slate-200">
        {([["members", "Members"], ["plans", "Plans"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700")}>{label}</button>
        ))}
      </div>
      {tab === "members" ? <Members /> : <Plans canManage={can("catalogue.manage")} />}
    </div>
  );
}

/** How the membership business is doing this month. */
function MembershipNumbers() {
  const { data } = useApi<Summary>("/customer-memberships/summary");
  if (!data) return null;
  const tiles: [string, string][] = [
    ["Current members", String(data.current)],
    ["Ending in 15 days", String(data.expiring)],
    ...(data.sales !== null ? [["Membership sales this month", `${money(data.sales)} (${data.salesCount})`] as [string, string]] : []),
    ...(data.discountGiven !== null ? [["Discount given to members this month", money(data.discountGiven)] as [string, string]] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{value}</p></div>)}
    </div>
  );
}

function Members() {
  const [state, setState] = useState<(typeof STATES)[number][0]>("current");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);
  const { data, error } = useApi<Member[]>(`/customer-memberships?${new URLSearchParams({ state, search })}`);
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search by customer name or phone" className="ps-9" aria-label="Search members" />
        </label>
        <Select value={state} onChange={(e) => setState(e.target.value as typeof state)} className="w-auto" aria-label="Show">
          {STATES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </Select>
      </div>
      {error && <div className="p-4"><Alert>{error.message}</Alert></div>}
      {!data ? <div className="p-6"><Spinner /></div> : (
        <Table head={["Customer", "Plan", "Discount", "Paid", "Valid", "Status"]} empty={!data.length && <Empty title="No members here">To sell a membership, open a customer and go to the Membership tab.</Empty>}>
          {data.map((m) => (
            <tr key={m.id}>
              <Td><Link href={`/customers/view?id=${m.customerId}`} className="font-medium text-slate-900 hover:text-brand-700">{m.customerName}</Link><p className="text-xs text-slate-500">{m.customerPhone}</p></Td>
              <Td>{m.planName}</Td>
              <Td>{m.discountBps / 100}%</Td>
              <Td className="tabular-nums">{money(m.pricePaid)}</Td>
              <Td className="text-xs text-slate-600">{dateOnly(m.startsAt)} to {dateOnly(m.endsAt)}</Td>
              <Td><MembershipStatus status={m.status} endsAt={m.endsAt} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function MembershipStatus({ status, endsAt }: { status: string; endsAt: string }) {
  if (status === "cancelled") return <Badge color="slate">Cancelled</Badge>;
  return new Date(endsAt) > new Date() ? <Badge color="green">Current</Badge> : <Badge color="amber">Expired</Badge>;
}

function Plans({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useApi<MembershipPlan[]>("/membership-plans");
  const [editing, setEditing] = useState<MembershipPlan | "new" | null>(null);
  return (
    <div className="space-y-4">
      {error && <Alert>{error.message}</Alert>}
      {canManage && <div className="flex justify-end"><Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />New plan</Button></div>}
      {!data ? <Spinner /> : !data.length ? <Card><Empty title="No membership plans yet">Create your first plan, for example Gold: ₹999 for a year with 10% off every order.</Empty></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((plan) => (
            <div key={plan.id} className={cx("rounded-2xl border bg-white p-5", plan.active ? "border-slate-200" : "border-dashed border-slate-300 opacity-70")}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Crown className="h-4 w-4 text-amber-500" />{plan.name}</h2>
                {!plan.active && <Badge color="slate">Not on sale</Badge>}
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{money(plan.price)}<span className="text-sm font-normal text-slate-500"> / {durationLabel(plan.durationDays)}</span></p>
              <p className="text-xs text-slate-500">{plan.taxBps ? `Includes ${plan.taxBps / 100}% GST` : "No GST charged"}</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{plan.discountBps / 100}% off every order</li>
                {plan.freeExpress && <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Free express service</li>}
                {plan.perks.map((perk) => <li key={perk} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{perk}</li>)}
              </ul>
              {plan.description && <p className="mt-2 text-sm text-slate-500">{plan.description}</p>}
              {canManage && <Button size="sm" variant="secondary" className="mt-4" onClick={() => setEditing(plan)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
            </div>
          ))}
        </div>
      )}
      {editing && <PlanForm plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: MembershipPlan | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [price, setPrice] = useState(plan ? String(plan.price / 100) : "");
  const [tax, setTax] = useState(String(plan?.taxBps ?? currentRegion().defaultTaxBps));
  const [duration, setDuration] = useState(String(plan?.durationDays ?? 365));
  const [discount, setDiscount] = useState(plan ? String(plan.discountBps / 100) : "");
  const [active, setActive] = useState(plan?.active ?? true);
  const [freeExpress, setFreeExpress] = useState(plan?.freeExpress ?? false);
  const [perks, setPerks] = useState((plan?.perks ?? []).join("\n"));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const body = { name: name.trim(), description: description.trim() || null, price: rupeesToPaise(price || "0"), taxBps: Number(tax), durationDays: Number(duration), discountBps: Math.round(Number(discount) * 100), freeExpress, perks: perks.split("\n").map((p) => p.trim()).filter(Boolean), active };
    try {
      if (plan) await api(`/membership-plans/${plan.id}`, { method: "PATCH", body });
      else await api("/membership-plans", { body });
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }

  return (
    <Modal open title={plan ? `Edit ${plan.name}` : "New membership plan"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Plan name" required><Input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price (₹)" required><Input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="999" /></Field>
          <Field label="Discount (%)" required><Input required inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="10" /></Field>
          <Field label="Valid for" required>
            <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[[30, "1 month"], [90, "3 months"], [180, "6 months"], [365, "1 year"], [730, "2 years"]].map(([days, label]) => <option key={days} value={days}>{label}</option>)}
              {![30, 90, 180, 365, 730].includes(Number(duration)) && <option value={duration}>{duration} days</option>}
            </Select>
          </Field>
        </div>
        <Field label="GST included in the price" hint="The invoice takes the GST out of the price, so the customer pays exactly the price above. Check the rate with your accountant.">
          <Select value={tax} onChange={(e) => setTax(e.target.value)}>
            {[...new Set([0, ...(currentRegion().splitsGst ? [500, 1200, 1800, 2800] : [currentRegion().defaultTaxBps]), Number(tax)])].sort((a, b) => a - b).map((bps) => [bps, bps ? `${bps / 100}%` : "No GST"] as const).map(([bps, label]) => <option key={bps} value={bps}>{label}</option>)}
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={freeExpress} onChange={(e) => setFreeExpress(e.target.checked)} /><span><span className="font-medium text-slate-900">Free express service</span><span className="block text-xs text-slate-500">Members pay no express surcharge. Applied automatically at the counter.</span></span></label>
        <Field label="Other benefits (optional)" hint="One on each line, up to 8. Customers and staff see these, but staff give them by hand: the software does not apply them.">
          <Textarea rows={3} value={perks} onChange={(e) => setPerks(e.target.value)} placeholder={"Free home pickup and delivery\nFree stain treatment"} />
        </Field>
        <Field label="Description (optional)"><Textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {plan && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />On sale</label>}
        {plan && <p className="text-xs text-slate-500">Changes apply to new sales and renewals. Customers who already bought this plan keep the benefits they paid for.</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={name.trim().length < 2 || !Number(discount)}>{plan ? "Save plan" : "Create plan"}</Button></div>
      </form>
    </Modal>
  );
}
