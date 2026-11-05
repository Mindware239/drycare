"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, FileText, Radio, Search, Trash2, X } from "lucide-react";
import { PAYMENT_METHOD_LABELS, normalizeEpc } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, StageBadge, Table, Td, cx } from "@/components/ui";

type TagRead = { epc: string; state: "linked" | "free" | "unknown" | "retired" | "elsewhere"; garmentId?: string; tagCode?: string; scanCode?: string; stage?: string; garment?: string; service?: string; orderId?: string; orderNumber?: string; customerName?: string };
type BasketOrder = { id: string; orderNumber: string; customerName: string; invoiceNumber: string | null; total?: number; paid?: number; balance?: number; tags: TagRead[]; openGarments: number; missing: number; notReady: number };
type OrderGarments = { id: string; orderNumber: string; customerName: string | null; garments: { id: string; tagCode: string; scanCode: string; stage: string; garment: string; service: string; colour: string | null; epc: string | null }[] };

const OTHER_STATE = { free: "Not on any garment", unknown: "New tag, not on any garment", retired: "Retired tag", elsewhere: "On a garment at another branch" };
const METHODS = ["cash", "upi", "card", "bank_transfer"] as const;

/** How long after the last character a tag number with no ending key counts as finished. */
const IDLE_MS = 300;
/** Tags read within this time go to the server together, so holding the trigger does not send one request per tag. */
const BATCH_MS = 150;
/** The shortest common RFID tag number, used to accept a number when the reader sends nothing after it. */
const FULL_EPC = 24;

function signalRead() {
  try {
    navigator.vibrate?.(30);
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.05;
    tone.frequency.value = 1400;
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.05);
    tone.onended = () => void audio.close();
  } catch { /* A device with no sound or vibration still reads tags. */ }
}

/**
 * Where a reader types. Handheld terminals and USB readers set to keyboard mode send each tag's number, usually
 * followed by Enter, Tab or a space, and some send nothing after it. A trigger held down sends many tags quickly and
 * repeats them, so this works without re-drawing on each character and passes on each tag once per read.
 */
function ReaderBox({ onRead, placeholder, busy }: { onRead: (epcs: string[]) => void; placeholder: string; busy?: boolean }) {
  const [bad, setBad] = useState("");
  const [count, setCount] = useState(0);
  const [hideKeyboard, setHideKeyboard] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const batch = useRef<string[]>([]);
  const seen = useRef(new Set<string>());
  const batchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onRead);
  latest.current = onRead;
  useEffect(() => {
    input.current?.focus();
    try { setHideKeyboard(localStorage.getItem("rfid-hide-keyboard") === "1"); } catch { /* Private windows can refuse storage. */ }
    return () => { clearTimeout(batchTimer.current); clearTimeout(idleTimer.current); };
  }, []);
  const take = (text: string) => {
    const parts = text.split(/[\r\n,;\t ]+/).filter(Boolean);
    const good = parts.map(normalizeEpc).filter(Boolean) as string[];
    if (parts.length && good.length < parts.length) setBad(`Not an RFID number: ${parts.find((part) => !normalizeEpc(part))}`);
    else if (good.length) setBad("");
    const fresh = good.filter((epc) => !seen.current.has(epc));
    if (!fresh.length) return;
    for (const epc of fresh) seen.current.add(epc);
    batch.current.push(...fresh);
    setCount(seen.current.size);
    signalRead();
    clearTimeout(batchTimer.current);
    batchTimer.current = setTimeout(() => {
      const list = batch.current;
      batch.current = [];
      if (list.length) latest.current(list);
    }, BATCH_MS);
  };
  const flush = () => {
    const el = input.current;
    if (!el?.value) return;
    const text = el.value;
    el.value = "";
    take(text);
  };
  const toggleKeyboard = (on: boolean) => {
    setHideKeyboard(on);
    try { localStorage.setItem("rfid-hide-keyboard", on ? "1" : "0"); } catch { /* Only a convenience. */ }
    input.current?.focus();
  };
  return (
    <div>
      <div className="relative">
        <Radio className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
        <Input
          ref={input}
          defaultValue=""
          inputMode={hideKeyboard ? "none" : "text"}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onInput={(e) => {
            clearTimeout(idleTimer.current);
            const value = e.currentTarget.value;
            // A reader that ends each number with a space, or sends several together.
            if (/[\s,;]/.test(value)) { flush(); return; }
            if (value.length >= FULL_EPC) idleTimer.current = setTimeout(flush, IDLE_MS);
          }}
          onPaste={(e) => { const text = e.clipboardData.getData("text"); if (/[\r\n,;\t ]/.test(text.trim())) { e.preventDefault(); take(text); } }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); clearTimeout(idleTimer.current); flush(); } }}
          onBlur={(e) => { if (!e.relatedTarget) setTimeout(() => input.current?.focus(), 150); }}
          placeholder={placeholder}
          aria-label="RFID reader input"
          className="h-12 pl-11 font-mono text-base"
          disabled={busy}
        />
      </div>
      {bad && <p className="mt-1 text-sm text-red-700">{bad}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Keep the cursor here and pull the trigger, or type a number and press Enter.{count > 0 && <strong className="ml-1 text-slate-700">{count} read.</strong>}</span>
        <label className="flex min-h-8 items-center gap-1.5"><input type="checkbox" checked={hideKeyboard} onChange={(e) => toggleKeyboard(e.target.checked)} />Hide the on-screen keyboard</label>
      </div>
    </div>
  );
}

/** Read the tags in the customer's basket, see what is due, collect it and hand over. */
function BillTab() {
  const { can } = useSession();
  const [epcs, setEpcs] = useState<string[]>([]);
  const [basket, setBasket] = useState<{ orders: BasketOrder[]; others: TagRead[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [reference, setReference] = useState("");
  const keys = useRef(new Map<string, string>());
  const latestLoad = useRef(0);
  const current = useRef<string[]>([]);
  // Starting again clears the reader's memory too, so the same tags can be read once more.
  const [round, setRound] = useState(0);

  const load = useCallback(async (list: string[]) => {
    const mine = ++latestLoad.current;
    if (!list.length) { setBasket(null); return; }
    try {
      // A slow answer must never replace a newer one while tags are still arriving.
      const result = await api<{ orders: BasketOrder[]; others: TagRead[] }>("/rfid/basket", { body: { epcs: list } });
      if (mine === latestLoad.current) setBasket(result);
    } catch (e) {
      if (mine === latestLoad.current) setError((e as ApiError).message);
    }
  }, []);
  const apply = (next: string[]) => { current.current = next; setEpcs(next); void load(next); };
  const read = (more: string[]) => {
    setError("");
    setNotice("");
    apply([...new Set([...current.current, ...more])]);
  };
  const remove = (epc: string) => apply(current.current.filter((x) => x !== epc));

  async function settle(order: BasketOrder) {
    setBusy(order.id);
    setError("");
    setNotice("");
    try {
      const balance = order.balance ?? 0;
      if (balance > 0) {
        if (method !== "cash" && !reference.trim()) throw new Error(`Enter the ${PAYMENT_METHOD_LABELS[method]} reference.`);
        const key = keys.current.get(order.id) ?? newIdempotencyKey();
        keys.current.set(order.id, key);
        await api(`/orders/${order.id}/payments`, { body: { payments: [{ amount: balance, method, reference: reference.trim() || undefined }] }, idempotencyKey: key });
        keys.current.delete(order.id);
      }
      const ready = order.tags.filter((t) => t.stage === "ready");
      if (ready.length) await api(`/orders/${order.id}/handover`, { body: { garmentIds: ready.map((t) => t.garmentId), notes: "Billed by RFID" } });
      setNotice(`${order.orderNumber}: ${balance > 0 ? `${money(balance)} collected` : "nothing due"}${ready.length ? `, ${ready.length} garment${ready.length === 1 ? "" : "s"} handed over` : ""}. Their tags can be used again.`);
      setReference("");
      const gone = new Set(ready.map((t) => t.epc));
      apply(current.current.filter((x) => !gone.has(x)));
    } catch (e) {
      setError((e as ApiError).message);
      await load(current.current);
    } finally {
      setBusy("");
    }
  }

  const orders = basket?.orders ?? [];
  const showsMoney = orders.some((o) => o.balance !== undefined);
  const totalDue = orders.reduce((s, o) => s + (o.balance ?? 0), 0);
  return (
    <div className="space-y-4">
      <Card>
        <ReaderBox key={round} onRead={read} placeholder="Read the tags in the basket" />
        {epcs.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span>{epcs.length} tag{epcs.length === 1 ? "" : "s"} read{showsMoney ? ` · ${money(totalDue)} due` : ""}</span><button type="button" onClick={() => { apply([]); setNotice(""); setRound((n) => n + 1); }} className="font-semibold underline underline-offset-4">Start again</button></div>}
      </Card>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {orders.length > 1 && <Alert tone="amber">These tags belong to {orders.length} orders{new Set(orders.map((o) => o.customerName)).size > 1 ? " of different customers. Check the basket" : ""}.</Alert>}
      {orders.map((o) => {
        const due = o.balance ?? 0;
        const ready = o.tags.filter((t) => t.stage === "ready").length;
        return (
          <Card key={o.id} title={<span className="flex flex-wrap items-center gap-2">{o.customerName}<Link href={`/orders/view?id=${o.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{o.orderNumber}</Link></span>} actions={<a href={`/print/receipt?id=${o.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"><FileText className="h-3.5 w-3.5" />Bill</a>}>
            <ul className="divide-y divide-slate-100 text-sm">
              {o.tags.map((t) => (
                <li key={t.epc} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><span className="font-medium">{t.garment}</span> <span className="text-slate-500">· {t.service}</span><span className="block font-mono text-xs text-slate-500">{t.scanCode}</span></span>
                  <StageBadge stage={t.stage ?? ""} />
                  <button type="button" onClick={() => remove(t.epc)} aria-label={`Take ${t.garment} out of the basket`} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            {o.missing > 0 && <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-amber-800"><AlertTriangle className="h-4 w-4" />{o.missing} more garment{o.missing === 1 ? "" : "s"} on this order not read.</p>}
            {o.notReady > 0 && <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-800"><AlertTriangle className="h-4 w-4" />{o.notReady} garment{o.notReady === 1 ? " is" : "s are"} not ready, so {o.notReady === 1 ? "it stays" : "they stay"} at the shop.</p>}
            {showsMoney && (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                <div className="flex gap-1.5"><dt className="text-slate-500">Total</dt><dd className="font-semibold">{money(o.total)}</dd></div>
                <div className="flex gap-1.5"><dt className="text-slate-500">Paid</dt><dd className="font-semibold">{money(o.paid)}</dd></div>
                <div className="flex gap-1.5"><dt className="text-slate-500">Due</dt><dd className={cx("font-bold", due > 0 ? "text-red-700" : "text-emerald-700")}>{money(due)}</dd></div>
              </dl>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {due > 0 && can("payments.collect") && (
                <>
                  <Field label="Received by" className="w-40"><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</Select></Field>
                  {method !== "cash" && <Field label="Reference" className="w-48"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card / UTR ref" /></Field>}
                </>
              )}
              <Button onClick={() => void settle(o)} loading={busy === o.id} disabled={(!can("garments.process") && ready > 0) || (due > 0 && !can("payments.collect")) || (due === 0 && ready === 0)}>
                {due > 0 ? `Collect ${money(due)}${ready ? ` and hand over ${ready}` : ""}` : ready ? `Hand over ${ready}` : "Nothing to do yet"}
              </Button>
            </div>
          </Card>
        );
      })}
      {(basket?.others ?? []).length > 0 && (
        <Card title="Other tags read"><ul className="space-y-1 text-sm">{basket!.others.map((t) => <li key={t.epc} className="flex items-center justify-between gap-3"><span className="font-mono text-xs">{t.epc}</span><span className="text-slate-600">{OTHER_STATE[t.state as keyof typeof OTHER_STATE]}</span><button type="button" onClick={() => remove(t.epc)} aria-label="Remove" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></li>)}</ul></Card>
      )}
    </div>
  );
}

/** Put a tag on each garment of an order. Reading a tag links it and moves on to the next garment. */
function LinkTab({ initial }: { initial: string }) {
  const [code, setCode] = useState(initial);
  const [order, setOrder] = useState<OrderGarments | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Refused reads must be readable again, so a refusal clears the reader's memory.
  const [readerRound, setReaderRound] = useState(0);
  const load = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setError("");
    try {
      setOrder(await api<OrderGarments>(`/rfid/order?code=${encodeURIComponent(value.trim())}`));
      setSelected(null);
    } catch (e) {
      setOrder(null);
      setError((e as ApiError).message);
    }
  }, []);
  useEffect(() => { if (initial) void load(initial); }, [initial, load]);
  const target = order?.garments.find((g) => g.id === selected && !g.epc) ?? order?.garments.find((g) => !g.epc);

  async function link(epcs: string[]) {
    if (!order) return;
    // Holding the trigger repeats a tag just linked. That is not a mistake, so it is ignored.
    const fresh = epcs.filter((epc) => !order.garments.some((g) => g.epc === epc));
    if (!fresh.length) return;
    // A handheld can pick up the tag next door. Guessing could put it on the wrong garment, so nothing is linked.
    if (fresh.length > 1) {
      setError(`${fresh.length} tags were read together, so none was linked. Move other tags away, hold the reader close to this one tag, and read again.`);
      setReaderRound((n) => n + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = order.garments.find((g) => g.id === selected && !g.epc) ?? order.garments.find((g) => !g.epc);
      if (!next) throw new Error("Every garment on this order already has a tag.");
      await api("/rfid/link", { body: { garmentId: next.id, epc: fresh[0] } });
      setOrder({ ...order, garments: order.garments.map((g) => (g.id === next.id ? { ...g, epc: fresh[0] } : g)) });
      setSelected(null);
    } catch (e) {
      setReaderRound((n) => n + 1);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unlink(epc: string) {
    setError("");
    try {
      await api("/rfid/unlink", { body: { epc } });
      if (order) setOrder({ ...order, garments: order.garments.map((g) => (g.epc === epc ? { ...g, epc: null } : g)) });
      setReaderRound((n) => n + 1);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }
  const linked = order?.garments.filter((g) => g.epc).length ?? 0;
  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); void load(code); }} className="flex flex-wrap gap-2">
          <div className="relative min-w-64 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Order number, or scan a tag's barcode" className="pl-9" aria-label="Order number or barcode" /></div>
          <Button type="submit" variant="secondary">Find order</Button>
        </form>
      </Card>
      {error && <Alert>{error}</Alert>}
      {order && (
        <Card title={<span>{order.orderNumber} <span className="font-normal text-slate-500">· {order.customerName}</span></span>} actions={<Badge color={linked === order.garments.length ? "green" : "amber"}>{linked} of {order.garments.length} linked</Badge>}>
          {!order.garments.length ? <p className="text-sm text-slate-500">This order has no garments still at the shop.</p> : (
            <>
              {target ? <div className="mb-3"><p className="mb-2 text-sm font-semibold">Next: put a tag on <span className="text-brand-700">{target.garment}</span> ({target.scanCode}) and read it</p><ReaderBox key={readerRound} onRead={(e) => void link(e)} placeholder={`Read the tag for ${target.garment}`} /></div> : <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700"><Check className="h-4 w-4" />Every garment has a tag.</p>}
              <ul className="divide-y divide-slate-100 text-sm">
                {order.garments.map((g) => (
                  <li key={g.id} className={cx("flex items-center gap-3 py-2", target?.id === g.id && "rounded bg-brand-50 px-2")}>
                    <button type="button" disabled={!!g.epc} onClick={() => setSelected(g.id)} className="min-w-0 flex-1 text-left disabled:cursor-default"><span className="font-medium">{g.garment}</span> <span className="text-slate-500">· {[g.service, g.colour].filter(Boolean).join(" · ")}</span><span className="block font-mono text-xs text-slate-500">{g.scanCode}</span></button>
                    {g.epc ? <><span className="font-mono text-xs text-slate-600" title={g.epc}>RFID …{g.epc.slice(-8)}</span><Button size="sm" variant="ghost" onClick={() => void unlink(g.epc!)}>Remove</Button></> : <Badge color="amber">No tag</Badge>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

/** Read garments anywhere, such as a rack or a trolley, to see what they are and record that they were seen there. */
function TrackTab() {
  const [place, setPlace] = useState("");
  const [items, setItems] = useState<TagRead[]>([]);
  const [error, setError] = useState("");
  async function read(epcs: string[]) {
    setError("");
    try {
      const r = await api<{ items: TagRead[] }>("/rfid/read", { body: { epcs, place: place.trim() || undefined } });
      setItems((cur) => [...r.items, ...cur.filter((c) => !r.items.some((n) => n.epc === c.epc))]);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }
  const linked = items.filter((i) => i.state === "linked");
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_240px]">
          <ReaderBox onRead={(e) => void read(e)} placeholder="Read tags to see where garments are" />
          <Field label="Where you are reading (optional)"><Input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={60} placeholder="e.g. Rack A, delivery van" /></Field>
        </div>
      </Card>
      {error && <Alert>{error}</Alert>}
      {items.length > 0 && (
        <Card padded={false} title={`${items.length} tag${items.length === 1 ? "" : "s"} read · ${linked.length} on garments`} actions={<Button size="sm" variant="ghost" onClick={() => setItems([])}>Clear</Button>}>
          <Table head={["Garment", "Customer", "Order", "Stage", "RFID"]}>
            {items.map((i) => (
              <tr key={i.epc}>
                {i.state === "linked" ? <>
                  <Td><Link href={`/tags/view?code=${i.scanCode}`} className="font-medium text-brand-700 hover:underline">{i.garment}</Link><p className="font-mono text-xs text-slate-500">{i.scanCode}</p></Td>
                  <Td>{i.customerName}</Td>
                  <Td><Link href={`/orders/view?id=${i.orderId}`} className="hover:underline">{i.orderNumber}</Link></Td>
                  <Td><StageBadge stage={i.stage ?? ""} /></Td>
                </> : <td colSpan={4} className="px-4 py-3 text-sm text-slate-500">{OTHER_STATE[i.state as keyof typeof OTHER_STATE]}</td>}
                <Td className="font-mono text-xs">…{i.epc.slice(-8)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function TagsTab() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const summary = useApi<{ counts: { total: number; free: number; linked: number; retired: number }; recent: { id: string; epc: string; action: string; notes: string | null; at: string; actor: string | null; scanCode: string | null }[] }>("/rfid/summary");
  const tags = useApi<any[]>(`/rfid/tags?${new URLSearchParams({ status, search })}`);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const refresh = () => { void summary.reload(); void tags.reload(); };
  async function add(epcs: string[]) {
    setMsg(null);
    try {
      const r = await api<{ added: number; alreadyKnown: number }>("/rfid/tags", { body: { epcs: epcs.slice(0, 500) } });
      setMsg({ tone: "green", text: `${r.added} new tag${r.added === 1 ? "" : "s"} added${r.alreadyKnown ? `, ${r.alreadyKnown} already in your list` : ""}.` });
      refresh();
    } catch (e) {
      setMsg({ tone: "red", text: (e as ApiError).message });
    }
  }
  async function retire(epc: string) {
    const reason = window.prompt("Why is this tag being retired? For example: lost, damaged.");
    if (!reason) return;
    setMsg(null);
    try {
      await api(`/rfid/tags/${epc}/retire`, { body: { reason } });
      refresh();
    } catch (e) {
      setMsg({ tone: "red", text: (e as ApiError).message });
    }
  }
  const c = summary.data?.counts;
  return (
    <div className="space-y-4">
      {c && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([["All tags", c.total], ["Free to use", c.free], ["On garments", c.linked], ["Retired", c.retired]] as [string, number][]).map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p></div>)}</div>}
      <Card><p className="mb-2 text-sm font-semibold">Add new tags</p><ReaderBox onRead={(e) => void add(e)} placeholder="Read new tags to add them" /></Card>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="RFID number, barcode, order or customer" className="min-w-56 flex-1" aria-label="Search tags" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">{[["all", "All"], ["free", "Free to use"], ["linked", "On garments"], ["retired", "Retired"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </div>
        {!tags.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["RFID number", "Status", "On garment", "Order", ""]} empty={!tags.data.length && <Empty title="No tags yet">Tags join this list when you add them or link them to a garment.</Empty>}>
            {tags.data.map((t) => (
              <tr key={t.epc}>
                <Td className="font-mono text-xs">{t.epc}</Td>
                <Td>{t.status === "linked" ? <Badge color="blue">On a garment</Badge> : t.status === "free" ? <Badge color="green">Free</Badge> : <Badge color="slate">Retired</Badge>}{t.retireReason && <p className="text-xs text-slate-500">{t.retireReason}</p>}</Td>
                <Td>{t.scanCode ? <Link href={`/tags/view?code=${t.scanCode}`} className="text-brand-700 hover:underline">{t.garment} · {t.scanCode}</Link> : "—"}</Td>
                <Td>{t.orderId ? <Link href={`/orders/view?id=${t.orderId}`} className="hover:underline">{t.orderNumber}<span className="block text-xs text-slate-500">{t.customerName}</span></Link> : "—"}</Td>
                <Td>{t.status !== "retired" && <Button size="sm" variant="ghost" onClick={() => void retire(t.epc)} aria-label={`Retire ${t.epc}`}><Trash2 className="h-3.5 w-3.5" />Retire</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {!!summary.data?.recent.length && (
        <Card title="Recent activity" padded={false}>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
            {summary.data.recent.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2"><span><span className="font-medium capitalize">{e.action}</span> <span className="font-mono text-xs text-slate-500">…{e.epc.slice(-8)}</span>{e.scanCode && <span className="text-slate-500"> · {e.scanCode}</span>}{e.notes && <span className="text-slate-500"> · {e.notes}</span>}</span><span className="text-xs text-slate-500">{dateTime(e.at)}{e.actor ? ` · ${e.actor}` : ""}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

const TABS = [["bill", "RFID billing"], ["link", "Link tags"], ["track", "Track garments"], ["tags", "All tags"]] as const;

function RfidInner() {
  const params = useSearchParams();
  const order = params.get("order") ?? "";
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(order ? "link" : "bill");
  return (
    <div className="space-y-5">
      <PageHeader title="RFID" subtitle="Link RFID tags to garments, find them, and bill at handover by reading the basket." />
      <details className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-900">Setting up a handheld terminal</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open this page in the terminal&apos;s browser and sign in.</li>
          <li>In the terminal&apos;s own RFID settings, turn on keyboard output for tag reads, so each tag&apos;s number is typed into the selected box. The setting has a different name on each brand. Zebra calls it DataWedge.</li>
          <li>Choose to send the tag&apos;s number (its EPC), followed by Enter.</li>
          <li>Tick <strong>Hide the on-screen keyboard</strong> below the reading box, and pull the trigger. The count goes up as tags are read.</li>
          <li>For linking, turn the reader&apos;s power down so it reads only the tag in front of it.</li>
        </ol>
      </details>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key} className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700")}>{label}</button>)}
      </div>
      {tab === "bill" ? <BillTab /> : tab === "link" ? <LinkTab initial={order} /> : tab === "track" ? <TrackTab /> : <TagsTab />}
    </div>
  );
}

export default function RfidPage() {
  return <Suspense><RfidInner /></Suspense>;
}
