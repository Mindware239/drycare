"use client";
import { shopMethods } from "@/lib/format";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Crown, Printer, RefreshCw, XCircle } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, money } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner, Table, Td } from "@/components/ui";

type Plan = { id: string; name: string; price: number; durationDays: number; discountBps: number; freeExpress: boolean; perks: string[]; active: boolean };
type Membership = { id: string; planId: string; planName: string; discountBps: number; freeExpress: boolean; perks: string[]; pricePaid: number; invoiceNumber: string | null; startsAt: string; endsAt: string; status: string; cancelReason: string | null; method: string | null; reference: string | null };
const METHODS = ["cash", "upi", "card", "bank_transfer"] as const;

/** This customer's membership: what they have now, selling or renewing one, and past purchases. */
export function CustomerMembership({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { can, branchId } = useSession();
  const { data, error, reload } = useApi<{ current: Membership | null; history: Membership[] }>(`/customers/${customerId}/memberships`);
  const plans = useApi<Plan[]>("/membership-plans");
  const [selling, setSelling] = useState<string | "" | null>(null);
  const [cancelling, setCancelling] = useState<Membership | null>(null);
  const now = Date.now();
  const current = data?.current ?? null;
  // A renewal bought early waits here until today's membership ends.
  const latestLive = data?.history.find((m) => m.status === "active" && new Date(m.endsAt).getTime() > now);
  const onSale = plans.data?.filter((p) => p.active) ?? [];
  const canRenew = latestLive && onSale.some((p) => p.id === latestLive.planId);

  return (
    <div className="space-y-4">
      {error && <Alert>{error.message}</Alert>}
      <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-5">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500 text-white"><Crown className="h-6 w-6" /></span>
        <div className="min-w-48 flex-1">
          {!data ? <p className="text-sm text-slate-500">Loading…</p> : current ? (
            <>
              <p className="text-xl font-bold text-slate-900">{current.planName}</p>
              <p className="text-sm text-emerald-700">{current.discountBps / 100}% off every order{current.freeExpress ? " and free express" : ""}, applied automatically</p>
              {current.perks.length > 0 && <p className="text-sm text-slate-600">Also promised: {current.perks.join(", ")}</p>}
              <p className="text-xs text-slate-500">Valid until {dateOnly(latestLive?.endsAt ?? current.endsAt)}</p>
            </>
          ) : (
            <>
              <p className="text-xl font-bold text-slate-900">Not a member</p>
              <p className="text-sm text-slate-500">{customerName} has no current membership.</p>
            </>
          )}
        </div>
        {can("payments.collect") && (
          <div className="flex flex-wrap gap-2">
            {canRenew ? <Button onClick={() => setSelling(latestLive.planId)}><RefreshCw className="h-4 w-4" />Renew</Button>
              : !latestLive && <Button onClick={() => setSelling("")} disabled={!onSale.length}><Crown className="h-4 w-4" />Sell membership</Button>}
          </div>
        )}
      </section>
      {plans.data && !onSale.length && !latestLive && <Alert tone="amber">No membership plans are on sale yet. {can("catalogue.manage") ? <Link href="/memberships" className="font-semibold underline">Create a plan</Link> : "Ask your manager to create one."}</Alert>}

      <Card padded={false} title="Membership history">
        {!data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Plan", "Valid", "Paid", "Status", ""]} empty={!data.history.length && <p className="px-4 py-10 text-center text-sm text-slate-500">No memberships yet.</p>}>
            {data.history.map((m) => {
              const live = m.status === "active" && new Date(m.endsAt).getTime() > now;
              return (
                <tr key={m.id}>
                  <Td><p className="font-medium text-slate-900">{m.planName}</p><p className="text-xs text-slate-500">{m.discountBps / 100}% off</p></Td>
                  <Td className="text-xs text-slate-600">{dateOnly(m.startsAt)} to {dateOnly(m.endsAt)}</Td>
                  <Td className="tabular-nums">{money(m.pricePaid)}<p className="text-xs text-slate-500">{[m.method ? PAYMENT_METHOD_LABELS[m.method as keyof typeof PAYMENT_METHOD_LABELS] ?? m.method : null, m.reference].filter(Boolean).join(" · ")}</p></Td>
                  <Td>{m.status === "cancelled" ? <><Badge color="slate">Cancelled</Badge>{m.cancelReason && <p className="mt-1 text-xs text-slate-500">{m.cancelReason}</p>}</> : !live ? <Badge color="amber">Expired</Badge> : new Date(m.startsAt).getTime() > now ? <Badge color="blue">Starts later</Badge> : <Badge color="green">Current</Badge>}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {m.invoiceNumber && <a href={`/print/membership?id=${m.id}`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><Printer className="h-3.5 w-3.5" />Invoice</Button></a>}
                      {live && can("payments.refund") && <Button size="sm" variant="ghost" onClick={() => setCancelling(m)}><XCircle className="h-3.5 w-3.5" />Cancel</Button>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {selling !== null && <Sell customerId={customerId} branchId={branchId} plans={onSale} initialPlanId={selling} onClose={() => setSelling(null)} onDone={() => { setSelling(null); void reload(); }} />}
      {cancelling && <Cancel membership={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void reload(); }} />}
    </div>
  );
}

function Sell({ customerId, branchId, plans, initialPlanId, onClose, onDone }: { customerId: string; branchId: string; plans: Plan[]; initialPlanId: string; onClose: () => void; onDone: () => void }) {
  const [planId, setPlanId] = useState(initialPlanId || plans[0]?.id || "");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const plan = plans.find((p) => p.id === planId);
  const paid = (plan?.price ?? 0) > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/customers/${customerId}/memberships`, { body: { planId, branchId, ...(paid ? { method, reference: reference.trim() || undefined } : {}) } });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }

  return (
    <Modal open title={initialPlanId ? "Renew membership" : "Sell membership"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Plan" required>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={!!initialPlanId}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price)} · {p.discountBps / 100}% off · {p.durationDays} days</option>)}
          </Select>
        </Field>
        {plan && (
          <ul className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <li>✓ {plan.discountBps / 100}% off every order</li>
            {plan.freeExpress && <li>✓ Free express service</li>}
            {plan.perks.map((perk) => <li key={perk}>✓ {perk}</li>)}
          </ul>
        )}
        {paid && <Field label="Received by"><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{shopMethods(METHODS).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</Select></Field>}
        {paid && method !== "cash" && <Field label="Transaction reference" required><Input required value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card / UTR ref" /></Field>}
        {paid && <p className="text-xs text-slate-500">This is money received now: it counts in today&apos;s collections and the cash drawer.</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!plan}>{paid ? `Collect ${money(plan!.price)}` : "Add membership"}</Button></div>
      </form>
    </Modal>
  );
}

function Cancel({ membership, onClose, onDone }: { membership: Membership; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/customer-memberships/${membership.id}/cancel`, { body: { reason } });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }
  return (
    <Modal open title={`Cancel ${membership.planName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Alert tone="amber">The discount stops now. No money is returned automatically: if you agree a refund, give it separately, for example as a wallet adjustment.</Alert>
        <Field label="Reason" required><Input required minLength={8} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer moved away" autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Keep membership</Button><Button type="submit" variant="danger" loading={saving} disabled={reason.trim().length < 8}>Cancel membership</Button></div>
      </form>
    </Modal>
  );
}
