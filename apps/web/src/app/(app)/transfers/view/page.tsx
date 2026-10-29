"use client";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, CircleAlert, Copy, PackageCheck, ScanLine, Send, Trash2, XCircle } from "lucide-react";
import { LOCATION_LABELS, type GarmentLocation } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, Spinner, Textarea, cx } from "@/components/ui";

type ScanResult = { result: string; message: string; at: number };

const RESULT_STYLE: Record<string, { tone: string; icon: typeof CheckCircle2 }> = {
  verified: { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2 },
  bag_added: { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: PackageCheck },
  bag_seen: { tone: "border-blue-200 bg-blue-50 text-blue-900", icon: PackageCheck },
  duplicate: { tone: "border-amber-200 bg-amber-50 text-amber-900", icon: Copy },
  unexpected: { tone: "border-red-200 bg-red-50 text-red-900", icon: CircleAlert },
  not_found: { tone: "border-red-200 bg-red-50 text-red-900", icon: XCircle },
};

function TransferInner() {
  const id = useSearchParams().get("id") ?? "";
  const { can } = useSession();
  const batch = useApi<any>(id ? `/transfers/${id}` : null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<ScanResult[]>([]);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<null | "dispatch" | "receive" | "partial">(null);
  const [notes, setNotes] = useState("");
  const [acting, setActing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const b = batch.data;
  const open = b && (b.status === "draft" || b.status === "dispatched");
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  // Loading and receiving are separate checks; start each with an empty scan feed.
  useEffect(() => setFeed([]), [b?.status]);

  async function submitScan(event: FormEvent) {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value || busy) return;
    // Some scanners send the code twice or an extra Enter; ignore an identical scan within 800 ms.
    if (lastScan.current.code === value && Date.now() - lastScan.current.at < 800) return setCode("");
    lastScan.current = { code: value, at: Date.now() };
    setBusy(true);
    setError("");
    try {
      const r = await api<{ result: string; message: string }>(`/transfers/${id}/scan`, { body: { code: value } });
      setFeed((f) => [{ ...r, at: Date.now() }, ...f].slice(0, 12));
      batch.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setCode("");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function act() {
    setActing(true);
    setError("");
    try {
      if (confirm === "dispatch") await api(`/transfers/${id}/dispatch`, { body: { acceptUnverified: unverifiedDispatch > 0 } });
      else await api(`/transfers/${id}/receive`, { body: confirm === "partial" ? { partial: true, notes } : {} });
      setConfirm(null);
      setNotes("");
      batch.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setActing(false);
    }
  }

  async function removeBag(bagId: string) {
    try {
      await api(`/transfers/${id}/bags/${bagId}`, { method: "DELETE" });
      batch.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  if (batch.error) return <Alert>{batch.error.message}</Alert>;
  if (!b) return <Spinner />;

  const step: "dispatch" | "receipt" = b.step;
  const garments: any[] = b.garments;
  const verifiedKey = step === "dispatch" ? "dispatchVerified" : "receiptVerified";
  const verified = garments.filter((g) => g[verifiedKey]).length;
  const unverifiedDispatch = garments.filter((g) => !g.dispatchVerified).length;
  const missing = garments.filter((g) => !g.receiptVerified);
  const toFacility = b.direction === "to_facility";
  const pct = garments.length ? Math.round((verified / garments.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <a href="/transfers" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />All transfers</a>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">{b.batchNumber}</h1>
            <Badge color={b.status === "draft" ? "slate" : b.status === "dispatched" ? "blue" : b.status === "received" ? "green" : "red"}>
              {b.status === "draft" ? "Loading bags" : b.status === "dispatched" ? "In transit" : b.status === "received" ? "Received" : "Received · items missing"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {toFacility ? `Shop → ${b.facilityName}` : `${b.facilityName} → shop (return receiving)`}
            {b.transportReference ? ` · ${b.transportReference}` : ""} · created by {b.createdByName} {dateTime(b.createdAt)}
            {b.dispatchedAt ? ` · dispatched ${dateTime(b.dispatchedAt)} by ${b.dispatchedByName}` : ""}
            {b.receivedAt ? ` · received ${dateTime(b.receivedAt)} by ${b.receivedByName}` : ""}
          </p>
        </div>
        {open && can("garments.process") && (
          step === "dispatch"
            ? <Button size="lg" onClick={() => setConfirm("dispatch")} disabled={!b.bags.length}><Send className="h-4 w-4" />Dispatch {b.bags.length} bag{b.bags.length === 1 ? "" : "s"}</Button>
            : <Button size="lg" onClick={() => setConfirm(missing.length ? "partial" : "receive")}><PackageCheck className="h-4 w-4" />{missing.length ? `Confirm receipt (${missing.length} missing)` : "Confirm all received"}</Button>
        )}
      </div>

      {error && <Alert onClose={() => setError("")}>{error}</Alert>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {open && (
            <Card>
              <form onSubmit={submitScan} className="flex gap-2">
                <label className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <Input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder={step === "dispatch" ? "Scan a bag label, then each garment tag" : "Scan each garment tag as it is unpacked"} className="h-14 pl-12 font-mono text-lg" aria-label="Scan barcode" autoComplete="off" />
                </label>
                <Button type="submit" size="lg" className="h-14" loading={busy}>Enter</Button>
              </form>
              <p className="mt-2 text-xs text-slate-500">
                {step === "dispatch"
                  ? "Scanning a bag adds it to this batch. A bag scan alone does not prove what is inside — scan every garment tag to verify the contents."
                  : "Only garments scanned here are treated as received. Unscanned garments stay listed below as missing."}
              </p>
              {feed.length > 0 && (
                <ul className="mt-3 space-y-1.5" aria-live="polite">
                  {feed.map((f, i) => {
                    const style = RESULT_STYLE[f.result] ?? RESULT_STYLE.verified;
                    const Icon = style.icon;
                    return <li key={f.at} className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", style.tone, i > 0 && "opacity-70")}><Icon className="h-4 w-4 shrink-0" />{f.message}</li>;
                  })}
                </ul>
              )}
            </Card>
          )}

          {b.bags.length === 0 ? (
            <Card><p className="py-8 text-center text-sm text-slate-500">No bags yet. Scan a bag label to add it to this batch.</p></Card>
          ) : b.bags.map((bag: any) => {
            const inBag = garments.filter((g) => g.bagId === bag.id);
            const done = inBag.filter((g) => g[verifiedKey]).length;
            return (
              <Card key={bag.id} padded={false}
                title={<div className="flex flex-wrap items-center gap-2"><span className="font-mono">{bag.bagCode}</span><span className="text-xs font-normal text-slate-500">· <a className="hover:underline" href={`/orders/view?id=${bag.orderId}`}>{bag.orderNumber}</a> · {bag.customerName}</span></div>}
                actions={<div className="flex items-center gap-2"><Badge color={done === inBag.length ? "green" : "amber"}>{done}/{inBag.length} verified</Badge>{b.status === "draft" && <button type="button" onClick={() => removeBag(bag.id)} aria-label={`Remove ${bag.bagCode}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</div>}>
                <ul className="divide-y divide-slate-100">
                  {inBag.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      {g[verifiedKey] ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : step === "receipt" && b.status !== "dispatched" ? <XCircle className="h-5 w-5 shrink-0 text-red-500" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
                      <span className="w-48 shrink-0 font-mono text-xs">{g.tagCode}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-800">{g.garmentType}{g.colour ? ` · ${g.colour}` : ""} <span className="text-slate-400">· {g.service}</span></span>
                      <span className="hidden text-xs text-slate-500 sm:inline">{LOCATION_LABELS[g.location as GarmentLocation] ?? g.location}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        <div className="space-y-5">
          <Card title={step === "dispatch" ? "Loading check" : "Receiving check"}>
            <div className="flex items-end justify-between">
              <div><p className="text-3xl font-semibold tabular-nums text-slate-900">{verified}<span className="text-lg text-slate-400"> / {garments.length}</span></p><p className="text-xs text-slate-500">garments verified by scan</p></div>
              <div className="text-right"><p className="text-xl font-semibold tabular-nums">{b.bags.length}</p><p className="text-xs text-slate-500">bags</p></div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={cx("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${pct}%` }} /></div>
            {step === "receipt" && missing.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-800">{b.status === "dispatched" ? "Not scanned yet" : "Missing"} ({missing.length})</p>
                <ul className="mt-1.5 space-y-0.5 text-sm text-red-900">{missing.slice(0, 12).map((g) => <li key={g.id}><span className="font-mono text-xs">{g.tagCode}</span> — {g.garmentType}</li>)}</ul>
              </div>
            )}
          </Card>
          <Card title="Scan log" padded={false}>
            {!b.scans.length ? <p className="p-4 text-sm text-slate-500">No scans yet.</p> : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-xs">
                {b.scans.map((s: any) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <span className="font-mono">{s.code}</span>
                    <span className="flex items-center gap-2"><Badge color={s.result === "verified" ? "green" : s.result === "duplicate" ? "amber" : "red"}>{s.result.replace("_", " ")}</Badge><span className="text-slate-400">{new Date(s.scannedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {confirm && (
        <Modal open title={confirm === "dispatch" ? "Dispatch this batch?" : confirm === "partial" ? "Receive with missing garments?" : "Confirm receipt"} onClose={() => setConfirm(null)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Keep scanning</Button><Button variant={confirm === "partial" ? "danger" : "primary"} onClick={act} loading={acting} disabled={confirm === "partial" && notes.trim().length < 3}>{confirm === "dispatch" ? "Dispatch now" : confirm === "partial" ? "Record missing & receive" : "Confirm received"}</Button></>}>
          {confirm === "dispatch" && (unverifiedDispatch > 0
            ? <Alert tone="amber">{unverifiedDispatch} garment{unverifiedDispatch === 1 ? " has" : "s have"} not been scanned into {unverifiedDispatch === 1 ? "its bag" : "their bags"}. Dispatching anyway is recorded in the audit log.</Alert>
            : <p className="text-sm text-slate-600">All {garments.length} garments in {b.bags.length} bag{b.bags.length === 1 ? "" : "s"} are verified. They will be marked in transit to {toFacility ? b.facilityName : "the shop"}.</p>)}
          {confirm === "receive" && <p className="text-sm text-slate-600">All {garments.length} garments were scanned. They will be marked {toFacility ? "at the facility" : "back at the shop"}.</p>}
          {confirm === "partial" && (
            <>
              <Alert tone="red">{missing.length} garment{missing.length === 1 ? " was" : "s were"} not scanned. {missing.length === 1 ? "It" : "They"} will be marked missing on {missing.length === 1 ? "its order" : "their orders"} until found. Only a manager can confirm a partial receipt.</Alert>
              <Field label="What happened?" required><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Shirt not in bag; facility asked to check" /></Field>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

export default function TransferViewPage() {
  return <Suspense><TransferInner /></Suspense>;
}
