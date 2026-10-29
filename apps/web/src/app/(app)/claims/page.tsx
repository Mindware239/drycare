"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, CircleX, Clock, Gavel, HandCoins, MessageSquarePlus, Plus, Search, ShieldAlert, Wallet } from "lucide-react";
import { CLAIM_KINDS, CLAIM_RESOLUTIONS, CLAIM_STATUS_LABELS, type ClaimKind, type ClaimResolution, type ClaimStatus } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateOnly, dateTime, money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx, type Tone } from "@/components/ui";

const STATUS_TONE: Record<ClaimStatus, Tone> = { open: "red", investigating: "amber", approved: "blue", rejected: "slate", settled: "green" };
const kindLabel = (k: string) => CLAIM_KINDS[k as ClaimKind] ?? k;
const TABS = [["active", "Open"], ["settled", "Settled"], ["rejected", "Rejected"], ["all", "All"]] as const;

type Prefill = { orderId?: string; garmentId?: string; exceptionId?: string; customerId?: string };

function ClaimsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<(typeof TABS)[number][0]>("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const list = useApi<any[]>(`/claims?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ""}&r=${reload}`);
  const summary = useApi<any>(`/claims/summary?r=${reload}`);
  const [creating, setCreating] = useState<Prefill | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const p = Object.fromEntries(["orderId", "garmentId", "exceptionId", "customerId"].map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)) as Prefill;
    if (Object.keys(p).length) setCreating(p);
    const id = params.get("id");
    if (id) setOpenId(id);
  }, [params]);

  const refresh = () => setReload((n) => n + 1);
  const s = summary.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Claims & complaints"
        subtitle="Damaged or lost garments and other customer complaints — from the counter report to a manager's decision and the compensation paid."
        actions={<Button onClick={() => setCreating({})}><Plus className="h-4 w-4" />New claim</Button>}
      />
      {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Gavel} label="Waiting for a decision" value={s ? String(s.pending) : "—"} hint={s?.olderThan3Days ? `${s.olderThan3Days} older than 3 days` : "Decide within 3 days"} tone={s?.olderThan3Days ? "red" : undefined} />
        <Kpi icon={HandCoins} label="Approved — to settle" value={s ? String(s.toSettle) : "—"} hint="Compensation not yet given" />
        <Kpi icon={Wallet} label="Compensation this month" value={s ? money(s.paidThisMonth) : "—"} hint="Wallet credit + payments" />
        <Kpi icon={ShieldAlert} label="Claims in 90 days" value={s ? String(s.last90Days) : "—"} hint={s?.byKind?.[0] ? `Most common: ${kindLabel(s.byKind[0].kind)}` : "—"} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setStatus(k)} className={cx("rounded-md px-2.5 py-1", status === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{l}</button>)}
          </div>
          <label className="relative ml-auto"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Claim no., customer, phone, order, tag" className="h-8 w-64 pl-8 text-xs" aria-label="Search claims" /></label>
        </div>
        {list.error && <div className="p-4"><Alert>{list.error.message}</Alert></div>}
        {!list.data ? <Spinner /> : !list.data.length ? (
          <Empty title={status === "active" ? "No open claims" : "No claims here"}>{status === "active" ? "When a customer reports a damaged or missing garment, log it with “New claim”." : ""}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{c.claimNumber} · {kindLabel(c.kind)}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{c.customerName}{c.customerPhone ? ` · ${c.customerPhone}` : ""}{c.orderNumber ? ` · ${c.orderNumber}` : ""}{c.tagCode ? ` · ${c.tagCode} ${c.garmentType ?? ""}` : ""}</p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-slate-700">{c.description}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    {c.status === "settled" || c.status === "approved" ? <span className="block text-sm font-semibold tabular-nums text-slate-900">{Number(c.approvedAmount) ? money(c.approvedAmount) : CLAIM_RESOLUTIONS[c.resolution as ClaimResolution] ?? ""}</span>
                      : c.customerAsk ? <span className="block tabular-nums">asks {money(c.customerAsk)}</span> : null}
                    <span className={cx(c.ageDays >= 3 && (c.status === "open" || c.status === "investigating") && "font-semibold text-red-600")}>{c.ageDays === 0 ? "today" : `${c.ageDays} day${c.ageDays === 1 ? "" : "s"} ago`}</span>
                  </div>
                  <Badge color={STATUS_TONE[c.status as ClaimStatus]}>{CLAIM_STATUS_LABELS[c.status as ClaimStatus]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <NewClaimModal prefill={creating} onClose={() => { setCreating(null); router.replace("/claims"); }} onCreated={(c) => { setCreating(null); router.replace("/claims"); setNotice(`${c.claimNumber} logged for ${c.customerName}.`); refresh(); setOpenId(c.id); }} />}
      {openId && <ClaimModal id={openId} onClose={() => { setOpenId(null); if (params.get("id")) router.replace("/claims"); }} onChanged={refresh} />}
    </div>
  );
}

export default function Page() {
  return <Suspense><ClaimsPage /></Suspense>;
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Gavel; label: string; value: string; hint?: string; tone?: "red" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className="mt-1.5 truncate text-xl font-semibold tabular-nums sm:text-2xl text-slate-900">{value}</p>
      {hint && <p className={cx("mt-1 truncate text-xs", tone === "red" ? "font-medium text-red-600" : "text-slate-500")} title={hint}>{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ new claim

function NewClaimModal({ prefill, onClose, onCreated }: { prefill: Prefill; onClose: () => void; onCreated: (c: any) => void }) {
  const { branchId } = useSession();
  const [mode, setMode] = useState<"order" | "customer">(prefill.customerId && !prefill.orderId ? "customer" : "order");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [garmentId, setGarmentId] = useState(prefill.garmentId ?? "");
  const [kind, setKind] = useState<ClaimKind>(prefill.exceptionId ? "lost" : "damaged");
  const [description, setDescription] = useState("");
  const [ask, setAsk] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        let orderId = prefill.orderId;
        if (prefill.exceptionId && !orderId) {
          const ex = (await api<any[]>("/garment-exceptions?status=all")).find((e) => e.id === prefill.exceptionId);
          if (ex) { orderId = ex.orderId; setKind(ex.kind === "missing" ? "lost" : ex.kind === "damaged" ? "damaged" : ex.kind === "wrong_tag" ? "wrong_item" : "late"); setDescription(ex.notes ?? ""); }
        }
        if (orderId) setOrder(await api(`/orders/${orderId}`));
        if (prefill.customerId && !orderId) setCustomer(await api(`/customers/${prefill.customerId}`));
      } catch (e) {
        setErr((e as ApiError).message);
      }
    })();
  }, [prefill]);

  useEffect(() => {
    if (q.trim().length < 2 || order || customer) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = mode === "order" ? await api<any>(`/orders?q=${encodeURIComponent(q.trim())}&limit=8`) : await api<any>(`/customers?q=${encodeURIComponent(q.trim())}&limit=8`);
        setResults(Array.isArray(r) ? r : r.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode, order, customer]);

  async function pickOrder(id: string) {
    try {
      setOrder(await api(`/orders/${id}`));
      setQ("");
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  const itemName = (g: any) => order?.items?.find((i: any) => i.id === g.orderItemId)?.garmentTypeName ?? "Garment";
  const target = order || customer;
  async function save() {
    setErr("");
    setBusy(true);
    try {
      const c = await api("/claims", { body: {
        orderId: order?.id, garmentId: garmentId || undefined, exceptionId: prefill.exceptionId, customerId: order ? undefined : customer?.id,
        branchId: order ? undefined : branchId, kind, description: description.trim(), customerAsk: ask ? rupeesToPaise(ask) : undefined,
      } });
      onCreated(c);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal open wide title="New claim" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!target || description.trim().length < 5 || (!!ask && isNaN(rupeesToPaise(ask)))}>Log claim</Button></>}>
      {err && <Alert>{err}</Alert>}
      {!target ? (
        <>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button type="button" onClick={() => { setMode("order"); setResults([]); }} className={cx("rounded-md px-3 py-1.5", mode === "order" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>About an order</button>
            <button type="button" onClick={() => { setMode("customer"); setResults([]); }} className={cx("rounded-md px-3 py-1.5", mode === "customer" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>General complaint</button>
          </div>
          <Field label={mode === "order" ? "Find the order" : "Find the customer"}>
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === "order" ? "Order number, customer name or phone" : "Customer name or phone"} />
          </Field>
          {searching && <p className="text-xs text-slate-500">Searching…</p>}
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 empty:hidden">
            {results.map((r) => mode === "order" ? (
              <li key={r.id}><button type="button" onClick={() => pickOrder(r.id)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"><span><b>{r.order_number}</b> · {r.customer_name}<span className="block text-xs text-slate-500">{r.customer_phone} · {r.garment_count} garments</span></span><span className="text-xs text-slate-500">{dateOnly(r.received_at)}</span></button></li>
            ) : (
              <li key={r.id}><button type="button" onClick={() => setCustomer(r)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"><span><b>{r.name}</b><span className="block text-xs text-slate-500">{r.phone}</span></span></button></li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm">
          <span>{order ? <><b>{order.orderNumber}</b> · {order.customer?.name} · {order.customer?.phone}</> : <><b>{customer.name}</b> · {customer.phone}</>}</span>
          {!prefill.orderId && !prefill.exceptionId && !prefill.customerId && <Button size="sm" variant="ghost" onClick={() => { setOrder(null); setCustomer(null); setGarmentId(""); }}>Change</Button>}
        </div>
      )}
      {order && (
        <Field label="Which garment?">
          <Select value={garmentId} onChange={(e) => setGarmentId(e.target.value)} disabled={!!prefill.exceptionId}>
            <option value="">The whole order</option>
            {order.garments.map((g: any) => <option key={g.id} value={g.id}>{g.tagCode} · {itemName(g)}</option>)}
          </Select>
        </Field>
      )}
      <Field label="What is the problem?" required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(CLAIM_KINDS) as ClaimKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cx("rounded-lg border px-2.5 py-2 text-left text-xs font-medium", kind === k ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600" : "border-slate-200 text-slate-700 hover:border-slate-300")}>{CLAIM_KINDS[k]}</button>
          ))}
        </div>
      </Field>
      <Field label="What the customer said" required><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Burn mark on the left sleeve noticed at pick-up" /></Field>
      <Field label="Customer is asking for (₹)" hint="Optional. The manager decides the actual amount."><Input inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="max-w-48" /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ claim detail

function ClaimModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const claim = useApi<any>(`/claims/${id}`);
  const [action, setAction] = useState<"note" | "decide" | "settle" | null>(null);
  const c = claim.data;
  const done = () => { setAction(null); claim.reload(); onChanged(); };
  const manager = can("payments.refund");
  const active = c && ["open", "investigating", "approved"].includes(c.status);
  return (
    <Modal open wide title={c ? `${c.claimNumber} · ${kindLabel(c.kind)}` : "Claim"} onClose={onClose} footer={c && <>
      {active && <Button variant="secondary" onClick={() => setAction("note")}><MessageSquarePlus className="h-4 w-4" />Add note</Button>}
      {(c.status === "open" || c.status === "investigating") && manager && <Button onClick={() => setAction("decide")}><Gavel className="h-4 w-4" />Decide</Button>}
      {c.status === "approved" && (manager || c.resolution === "reclean") && <Button onClick={() => setAction("settle")}><HandCoins className="h-4 w-4" />Settle</Button>}
      {!active && <Button variant="secondary" onClick={onClose}>Close</Button>}
    </>}>
      {claim.error && <Alert>{claim.error.message}</Alert>}
      {!c ? <Spinner /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={STATUS_TONE[c.status as ClaimStatus]}>{CLAIM_STATUS_LABELS[c.status as ClaimStatus]}</Badge>
            {c.resolution && c.status !== "rejected" && <Badge color="violet">{CLAIM_RESOLUTIONS[c.resolution as ClaimResolution]}{Number(c.approvedAmount) ? ` · ${money(c.approvedAmount)}` : ""}</Badge>}
            <span className="text-xs text-slate-500">Logged {dateTime(c.createdAt)} by {c.createdByName} · {c.branchName}</span>
          </div>
          {(c.status === "open" || c.status === "investigating") && !manager && <Alert tone="blue">A manager will review and decide this claim.</Alert>}
          <dl className="grid gap-3 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Customer</dt><dd><a className="font-medium text-brand-700 hover:underline" href={`/customers/view?id=${c.customerId}`}>{c.customerName}</a><span className="block text-xs text-slate-500">{c.customerPhone}</span></dd></div>
            <div><dt className="text-xs text-slate-500">Order</dt><dd>{c.orderId ? <a className="font-medium text-brand-700 hover:underline" href={`/orders/view?id=${c.orderId}`}>{c.orderNumber}</a> : "—"}{c.orderDate && <span className="block text-xs text-slate-500">{dateOnly(c.orderDate)}</span>}</dd></div>
            <div><dt className="text-xs text-slate-500">Garment</dt><dd>{c.tagCode ? <><span className="font-mono">{c.tagCode}</span> · {c.garmentType}{c.garmentLineTotal !== null && <span className="block text-xs text-slate-500">Cleaning charge {money(c.garmentLineTotal)}</span>}</> : "Whole order / general"}</dd></div>
            <div className="sm:col-span-3"><dt className="text-xs text-slate-500">Customer&apos;s complaint</dt><dd className="text-slate-800">{c.description}{c.customerAsk !== null && <span className="ml-1 font-medium">· asks {money(c.customerAsk)}</span>}</dd></div>
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</p>
            <ol className="relative space-y-3 border-l border-slate-200 pl-5">
              {c.events.map((e: any) => (
                <li key={e.id} className="relative">
                  <span className={cx("absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white", e.kind === "settled" ? "bg-emerald-500" : e.kind === "decision" ? (e.toStatus === "rejected" ? "bg-slate-400" : "bg-blue-500") : e.kind === "created" ? "bg-red-500" : "bg-amber-400")} />
                  <p className="text-sm text-slate-800">{e.kind === "created" ? "Claim logged" : e.kind === "note" ? "Note" : e.kind === "status" ? "Investigation started" : e.kind === "decision" ? "Decision" : "Settled"}{e.note && <span className="text-slate-600"> — {e.note}</span>}</p>
                  <p className="text-xs text-slate-500">{dateTime(e.createdAt)} · {e.by}</p>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
      {action === "note" && c && <NoteModal claim={c} onClose={() => setAction(null)} onDone={done} />}
      {action === "decide" && c && <DecideModal claim={c} onClose={() => setAction(null)} onDone={done} />}
      {action === "settle" && c && <SettleModal claim={c} onClose={() => setAction(null)} onDone={done} />}
    </Modal>
  );
}

function useSubmit(onDone: () => void) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(path: string, body: unknown) {
    setErr("");
    setBusy(true);
    try {
      await api(path, { body });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return { err, busy, run };
}

function NoteModal({ claim, onClose, onDone }: { claim: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [start, setStart] = useState(claim.status === "open");
  const { err, busy, run } = useSubmit(onDone);
  return (
    <Modal open title={`Note on ${claim.claimNumber}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => run(`/claims/${claim.id}/notes`, { note, startInvestigation: start })} loading={busy} disabled={note.trim().length < 3}>Save note</Button></>}>
      {err && <Alert>{err}</Alert>}
      <Field label="What did you find out?" required><Textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Checked with the facility — the stain was there at intake (see intake notes)" /></Field>
      {claim.status === "open" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} className="h-4 w-4 accent-brand-700" />Mark as “Investigating”</label>}
    </Modal>
  );
}

function DecideModal({ claim, onClose, onDone }: { claim: any; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<"approve" | "reject">("approve");
  const [resolution, setResolution] = useState<ClaimResolution>(claim.kind === "stain" || claim.kind === "late" ? "reclean" : "wallet_credit");
  const [amount, setAmount] = useState(claim.customerAsk ? String(claim.customerAsk / 100) : "");
  const [note, setNote] = useState("");
  const { err, busy, run } = useSubmit(onDone);
  const withMoney = outcome === "approve" && (resolution === "wallet_credit" || resolution === "cash");
  const paise = withMoney ? rupeesToPaise(amount) : 0;
  const valid = note.trim().length >= 5 && (!withMoney || paise > 0);
  return (
    <Modal open wide title={`Decide ${claim.claimNumber}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={outcome === "reject" ? "danger" : "primary"} onClick={() => run(`/claims/${claim.id}/decision`, { outcome, resolution: outcome === "reject" ? "none" : resolution, amount: paise, note })} loading={busy} disabled={!valid}>
        {outcome === "reject" ? "Reject claim" : `Approve${withMoney && paise > 0 ? ` ${money(paise)}` : ""}`}
      </Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        {([["approve", CircleCheck, "Approve", "The shop is responsible"], ["reject", CircleX, "Reject", "Not the shop's fault"]] as const).map(([k, Icon, label, sub]) => (
          <button key={k} type="button" onClick={() => setOutcome(k)} className={cx("flex items-start gap-2 rounded-xl border p-3 text-left", outcome === k ? (k === "approve" ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-red-500 bg-red-50 ring-1 ring-red-500") : "border-slate-200")}>
            <Icon className={cx("mt-0.5 h-5 w-5", k === "approve" ? "text-emerald-600" : "text-red-600")} /><span className="text-sm font-semibold">{label}<span className="block text-xs font-normal text-slate-500">{sub}</span></span>
          </button>
        ))}
      </div>
      {outcome === "approve" && (
        <>
          <Field label="How will you make it right?">
            <div className="grid gap-2 sm:grid-cols-3">
              {(["wallet_credit", "cash", "reclean"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setResolution(r)} className={cx("rounded-lg border px-3 py-2 text-left text-sm", resolution === r ? "border-brand-600 bg-brand-50 font-medium text-brand-800 ring-1 ring-brand-600" : "border-slate-200 text-slate-700")}>
                  {CLAIM_RESOLUTIONS[r]}
                  <span className="block text-xs font-normal text-slate-500">{r === "wallet_credit" ? "Customer uses it on future orders" : r === "cash" ? "Cash, UPI or bank transfer now" : "No money changes hands"}</span>
                </button>
              ))}
            </div>
          </Field>
          {withMoney && (
            <Field label="Amount (₹)" required hint={claim.garmentLineTotal !== null ? `Cleaning charge for this garment was ${money(claim.garmentLineTotal)}.${claim.customerAsk ? ` Customer asked for ${money(claim.customerAsk)}.` : ""}` : claim.customerAsk ? `Customer asked for ${money(claim.customerAsk)}.` : undefined}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="max-w-48 text-lg" placeholder="0.00" />
            </Field>
          )}
        </>
      )}
      <Field label={outcome === "approve" ? "Reason for the decision" : "Why is it rejected?"} required hint="The customer may ask; this is kept on the claim."><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "approve" ? "e.g. Burn from our press, agreed with customer" : "e.g. Damage noted at intake and signed by customer"} /></Field>
    </Modal>
  );
}

function SettleModal({ claim, onClose, onDone }: { claim: any; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<"cash" | "upi" | "bank_transfer">("cash");
  const [reference, setReference] = useState("");
  const [fromDrawer, setFromDrawer] = useState(true);
  const [note, setNote] = useState("");
  const { err, busy, run } = useSubmit(onDone);
  const amount = Number(claim.approvedAmount);
  const r = claim.resolution as ClaimResolution;
  return (
    <Modal open title={`Settle ${claim.claimNumber}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button onClick={() => run(`/claims/${claim.id}/settle`, { method: r === "cash" ? method : undefined, reference: reference.trim() || undefined, paidFromDrawer: r === "cash" && method === "cash" ? fromDrawer : undefined, note: note.trim() || undefined })} loading={busy} disabled={r === "cash" && method !== "cash" && !reference.trim()}>
        {r === "wallet_credit" ? `Credit ${money(amount)} to wallet` : r === "cash" ? `Record ${money(amount)} paid` : "Mark as done"}
      </Button></>}>
      {err && <Alert>{err}</Alert>}
      {r === "wallet_credit" && <p className="text-sm text-slate-600"><b>{money(amount)}</b> will be added to {claim.customerName}&apos;s wallet and can be used on any future order. It shows on their wallet statement as claim compensation.</p>}
      {r === "reclean" && <p className="text-sm text-slate-600">Confirm the garment has been re-cleaned or repaired free of charge and the customer is satisfied.</p>}
      {r === "none" && <p className="text-sm text-slate-600">Close this claim without compensation.</p>}
      {r === "cash" && (
        <>
          <p className="text-sm text-slate-600">Pay <b>{money(amount)}</b> to {claim.customerName}. It is recorded under Expenses → “Claims &amp; compensation”.</p>
          <Field label="Paid by"><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option></Select></Field>
          {method === "cash" ? (
            <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-700" />
              <span>Paid from the cash drawer<span className="block text-xs text-amber-800">Lowers your open shift&apos;s expected cash so the drawer still balances.</span></span>
            </label>
          ) : <Field label="Transaction reference" required><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / UPI reference" /></Field>}
        </>
      )}
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
      <p className="flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" />Settling closes the claim. This cannot be undone.</p>
    </Modal>
  );
}
