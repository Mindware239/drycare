"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { STAGE_LABELS, allowedTransitions, type GarmentStage } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Select, Spinner, StageBadge, Table, Td } from "@/components/ui";
import { RfidReader } from "@/components/RfidReader";

type Read = { epc: string; state: string; garmentId?: string; scanCode?: string; tagCode?: string; stage?: string; version?: number; workflowStages?: string[]; garment?: string; customerName?: string; orderNumber?: string; rack?: string | null };
const stageName = (s: string) => STAGE_LABELS[s as GarmentStage] ?? s.replace(/_/g, " ");

/** Move a trolley of garments to their next stage, or onto a rack, by reading them together. */
export function ProcessTab() {
  const { branchId, can } = useSession();
  const racks = useApi<{ id: string; code: string; description: string | null }[]>(branchId ? `/storage-locations?branchId=${branchId}` : null);
  const [epcs, setEpcs] = useState<string[]>([]);
  const [items, setItems] = useState<Read[]>([]);
  const [rack, setRack] = useState("");
  const [busy, setBusy] = useState("");
  const [round, setRound] = useState(0);
  const [notice, setNotice] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const refresh = async (list: string[], log = false) => {
    const r = await api<{ items: Read[] }>("/rfid/read", { body: { epcs: list, silent: !log } });
    return r.items;
  };
  async function read(more: string[]) {
    setNotice("");
    setProblems([]);
    try {
      const fresh = await refresh(more, true);
      setItems((cur) => [...cur.filter((c) => !fresh.some((f) => f.epc === c.epc)), ...fresh]);
      setEpcs((cur) => [...new Set([...cur, ...more])]);
    } catch (e) {
      setProblems([(e as ApiError).message]);
    }
  }
  const garments = items.filter((i) => i.state === "linked");
  // Garments at the same stage going to the same next stage move together.
  const groups = useMemo(() => {
    const map = new Map<string, { stage: string; to: string | null; list: Read[] }>();
    for (const g of garments) {
      const next = allowedTransitions((g.workflowStages ?? []) as GarmentStage[], g.stage as GarmentStage).find((t) => t.kind === "advance" || t.kind === "rework_return");
      const key = `${g.stage}>${next?.to ?? ""}`;
      const row = map.get(key) ?? { stage: g.stage as string, to: next?.to ?? null, list: [] };
      row.list.push(g);
      map.set(key, row);
    }
    return [...map.values()];
  }, [garments]);

  async function run(label: string, list: Read[], step: (g: Read) => Promise<unknown>, done: string) {
    setBusy(label);
    setNotice("");
    const failed: string[] = [];
    let moved = 0;
    for (const g of list) {
      try {
        await step(g);
        moved++;
      } catch (e) {
        failed.push(`${g.scanCode} ${g.garment}: ${(e as ApiError).message}`);
      }
    }
    if (moved) setNotice(`${moved} garment${moved === 1 ? "" : "s"} ${done}.`);
    setProblems(failed);
    setItems(await refresh(epcs).catch(() => items));
    setBusy("");
  }
  const move = (to: string, list: Read[]) => run(to, list, (g) => api(`/garments/${g.garmentId}/transitions`, { body: { to, version: g.version } }), `moved to ${stageName(to)}`);
  const place = (list: Read[]) => run("rack", list, (g) => api(`/garments/${g.garmentId}/storage-location`, { body: { storageLocationId: rack } }), `put on rack ${racks.data?.find((r) => r.id === rack)?.code ?? ""}`);
  // Some services go straight from finishing to ready, so anything about to be ready can take a rack.
  const rackable = groups.filter((g) => g.to === "ready" || ["packing", "ready"].includes(g.stage)).flatMap((g) => g.list);

  return (
    <div className="space-y-4">
      <Card>
        <RfidReader key={round} onRead={(e) => void read(e)} placeholder="Read the garments you are moving" />
        {items.length > 0 && <div className="mt-2 flex justify-between text-sm"><span>{garments.length} garment{garments.length === 1 ? "" : "s"} read{items.length > garments.length ? `, ${items.length - garments.length} tag${items.length - garments.length === 1 ? "" : "s"} not on a garment` : ""}</span><button type="button" onClick={() => { setItems([]); setEpcs([]); setNotice(""); setProblems([]); setRound((n) => n + 1); }} className="font-semibold underline underline-offset-4">Start again</button></div>}
      </Card>
      {notice && <Alert tone="green">{notice}</Alert>}
      {problems.length > 0 && <Alert><p className="font-semibold">Not moved:</p><ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}
      {groups.map((g) => (
        <Card key={`${g.stage}>${g.to}`} title={<span className="flex flex-wrap items-center gap-2"><StageBadge stage={g.stage} /><span>{g.list.length} garment{g.list.length === 1 ? "" : "s"}</span></span>} actions={
          g.to && can("garments.process") ? <Button size="sm" loading={busy === g.to} disabled={!!busy || (g.to === "ready" && g.list.some((x) => !x.rack))} onClick={() => void move(g.to!, g.list)}>Move to {stageName(g.to)}</Button>
            : g.stage === "quality_control" ? <span className="text-xs font-medium text-amber-800">Each needs its quality check</span>
            : g.stage === "ready" ? <span className="text-xs font-medium text-emerald-700">Ready for handover</span> : null
        }>
          {g.to === "ready" && g.list.some((x) => !x.rack) && <p className="mb-2 text-sm font-medium text-amber-800">Put these on a rack first.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {g.list.map((x) => (
              <li key={x.epc} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span><Link href={g.stage === "quality_control" ? `/scan?tag=${x.scanCode}` : `/tags/view?code=${x.scanCode}`} className="font-medium text-brand-700 hover:underline">{x.garment}</Link> <span className="font-mono text-xs text-slate-500">{x.scanCode}</span></span>
                <span className="text-xs text-slate-500">{x.customerName}{x.rack ? ` · Rack ${x.rack}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {rackable.length > 0 && (
        <Card title="Put on a rack">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Rack" className="min-w-40"><Select value={rack} onChange={(e) => setRack(e.target.value)}><option value="">Choose a rack</option>{racks.data?.map((r) => <option key={r.id} value={r.id}>{r.code}{r.description ? ` · ${r.description}` : ""}</option>)}</Select></Field>
            <Button variant="secondary" loading={busy === "rack"} disabled={!rack || !!busy} onClick={() => void place(rackable)}>Put {rackable.length} on this rack</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

type Expected = { epc: string; garmentId: string; scanCode: string; tagCode: string; stage: string; garment: string; customerName: string; orderId: string; orderNumber: string; rack: string | null; lastSeenAt: string | null; lastSeenPlace: string | null };
type CheckResult = { expected: number; found: number; untagged: number; missing: Expected[]; unexpected: { epc: string; state: string; scanCode?: string; garment?: string; customerName?: string; stage?: string; location?: string }[] };
const PLACES = [["shop", "At the shop"], ["facility", "At the facility"], ["all", "Everywhere in my care"]] as const;

/** Count what is really there: read every tag, and see what should be here but was not read, and what should not be. */
export function StockCheckTab() {
  const { branchId } = useSession();
  const [place, setPlace] = useState<(typeof PLACES)[number][0]>("shop");
  const [rackId, setRackId] = useState("");
  const racks = useApi<{ id: string; code: string }[]>(branchId ? `/storage-locations?branchId=${branchId}` : null);
  const query = new URLSearchParams({ ...(branchId ? { branchId } : {}), place, ...(rackId ? { rackId } : {}) });
  const expected = useApi<{ expected: number; untagged: number }>(`/rfid/expected?${query}`);
  const [epcs, setEpcs] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restart = () => { setEpcs([]); setResult(null); setError(""); setRound((n) => n + 1); };

  async function finish() {
    setBusy(true);
    setError("");
    try {
      setResult(await api<CheckResult>("/rfid/stock-check", { body: { branchId: branchId || undefined, place, rackId: rackId || undefined, epcs } }));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  if (!expected.data && !expected.error) return <Spinner />;
  return (
    <div className="space-y-4">
      {!result ? (
        <Card>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label="What are you checking?"><Select value={place} onChange={(e) => { setPlace(e.target.value as typeof place); restart(); }}>{PLACES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Only one rack (optional)"><Select value={rackId} onChange={(e) => { setRackId(e.target.value); restart(); }}><option value="">All racks</option>{racks.data?.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</Select></Field>
          </div>
          <RfidReader key={round} onRead={(e) => setEpcs((cur) => [...new Set([...cur, ...e])])} placeholder="Walk the shop and read every tag" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Read <strong>{epcs.length}</strong> · should be here <strong>{expected.data?.expected ?? 0}</strong>{expected.data?.untagged ? <span className="text-amber-800"> · {expected.data.untagged} garment{expected.data.untagged === 1 ? " has" : "s have"} no RFID tag, so cannot be counted</span> : null}</p>
            <Button onClick={() => void finish()} loading={busy} disabled={!epcs.length && !expected.data?.expected}>Finish the check</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-base font-semibold">{result.missing.length || result.unexpected.length ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}Found {result.found} of {result.expected}</p>
              <Button variant="secondary" onClick={restart}>Check again</Button>
            </div>
          </Card>
          {result.missing.length > 0 && (
            <Card padded={false} title={<span className="text-red-800">Missing: should be here, but not read ({result.missing.length})</span>}>
              <Table head={["Garment", "Customer", "Stage", "Rack", "Last seen"]}>
                {result.missing.map((g) => (
                  <tr key={g.epc}>
                    <Td><Link href={`/tags/view?code=${g.scanCode}`} className="font-medium text-brand-700 hover:underline">{g.garment}</Link><p className="font-mono text-xs text-slate-500">{g.scanCode}</p></Td>
                    <Td>{g.customerName}<p className="text-xs text-slate-500">{g.orderNumber}</p></Td>
                    <Td><StageBadge stage={g.stage} /></Td>
                    <Td>{g.rack ?? "—"}</Td>
                    <Td className="text-xs text-slate-600">{g.lastSeenAt ? `${dateTime(g.lastSeenAt)}${g.lastSeenPlace ? ` · ${g.lastSeenPlace}` : ""}` : "Not read yet"}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          {result.unexpected.length > 0 && (
            <Card padded={false} title={<span className="text-amber-800">Should not be here ({result.unexpected.length})</span>}>
              <ul className="divide-y divide-slate-100 text-sm">
                {result.unexpected.map((u) => (
                  <li key={u.epc} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    {u.scanCode ? <span><Link href={`/tags/view?code=${u.scanCode}`} className="font-medium text-brand-700 hover:underline">{u.garment}</Link> <span className="text-slate-500">· {u.customerName}</span></span> : <span className="font-mono text-xs">{u.epc}</span>}
                    {u.scanCode ? <StageBadge stage={u.stage ?? ""} /> : <Badge>{u.state === "free" ? "Tag not on a garment" : u.state === "retired" ? "Retired tag" : "Unknown tag"}</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {result.untagged > 0 && <Alert tone="amber">{result.untagged} garment{result.untagged === 1 ? " has" : "s have"} no RFID tag, so {result.untagged === 1 ? "it was" : "they were"} not counted.</Alert>}
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
