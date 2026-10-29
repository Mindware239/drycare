"use client";
import { useState } from "react";
import { Laptop } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal } from "@/components/ui";

type Device = { id: string; name: string; status: string; branchName: string; appVersion: string | null; lastSeenAt: string | null; lastPushAt: string | null; credentialExpiresAt: string; revokedAt: string | null; revokeReason: string | null; eventsApplied: number; problems: number };

/** Cloud web: the shop PC that uploads to this business, with a way to disconnect it. Hidden in the Windows app. */
export function LinkedPcCard() {
  const list = useApi<Device[]>("/sync/devices");
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (list.error || !list.data?.length) return null;

  async function revoke() {
    setBusy(true);
    setErr("");
    try {
      await api(`/sync/devices/${revoking!.id}/revoke`, { body: { reason } });
      setRevoking(null);
      list.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="shop-pc">
      <Card title={<span className="flex items-center gap-2"><Laptop className="h-4 w-4 text-brand-600" />Linked shop PC</span>}>
        <p className="text-sm text-slate-600">This PC uploads the shop's orders, bills and stock to DryCare Cloud. Only one PC can upload at a time, so invoice numbers stay unique.</p>
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {list.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{d.name} <Badge color={d.status === "active" ? "green" : "slate"}>{d.status === "active" ? "Connected" : "Disconnected"}</Badge></p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {d.branchName}{d.appVersion ? ` · DryCare ${d.appVersion}` : ""} · last upload {d.lastPushAt ? dateTime(d.lastPushAt) : "not yet"} · {d.eventsApplied.toLocaleString("en-IN")} changes received{d.problems ? ` · ${d.problems} refused or in conflict` : ""}
                </p>
                {d.revokedAt && <p className="mt-0.5 text-xs text-slate-500">Disconnected {dateTime(d.revokedAt)}{d.revokeReason ? ` — ${d.revokeReason}` : ""}</p>}
              </div>
              {d.status === "active" && <Button size="sm" variant="secondary" onClick={() => { setRevoking(d); setReason(""); setErr(""); }}>Disconnect</Button>}
            </li>
          ))}
        </ul>
      </Card>
      {revoking && (
        <Modal open title={`Disconnect ${revoking.name}?`} onClose={() => setRevoking(null)} footer={<><Button variant="ghost" onClick={() => setRevoking(null)}>Keep connected</Button><Button variant="danger" onClick={revoke} loading={busy} disabled={reason.trim().length < 3}>Disconnect</Button></>}>
          {err && <Alert>{err}</Alert>}
          <p className="text-sm text-slate-600">The PC keeps working and keeps its data, but stops uploading until it is linked again. Use this if the PC was replaced, lost or stolen.</p>
          <Field label="Reason" required><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Old counter PC replaced" /></Field>
        </Modal>
      )}
    </div>
  );
}
