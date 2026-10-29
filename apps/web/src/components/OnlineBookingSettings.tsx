"use client";
import { useEffect, useState } from "react";
import { Copy, ExternalLink, Globe, MessageCircle, Printer } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Alert, Button, Field, Input, Modal, Select } from "@/components/ui";
import { copyText } from "@/lib/clipboard";

type Data = { settings: { enabled: boolean; branchId?: string; message?: string }; slug: string; url: string; desktop: boolean };

/** Owner switch for the public pickup-booking page, with its link and a printable QR code. */
export function OnlineBookingSettings({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const { data, error } = useApi<Data>("/booking/settings");
  const [s, setS] = useState<Data["settings"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (data) setS(data.settings); }, [data]);

  async function save(next: Data["settings"]) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<Data>("/booking/settings", { method: "PUT", body: next });
      setS(r.settings);
      setMsg({ tone: "green", text: next.enabled ? "Online booking is on. Share the link below." : "Online booking is off." });
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }
  const url = data?.url ?? "";
  return (
    <Modal open title="Online pickup booking" onClose={onClose}>
      {error && <Alert>{error.message}</Alert>}
      {!s || !data ? null : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Customers open your booking page, choose a day and time, and the request appears here as a pickup marked “Online booking”.</p>
          {data.desktop && <Alert tone="amber">On the Windows app the page only works for devices on your shop network. Use DryCare Cloud for a public link.</Alert>}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span><span className="block text-sm font-semibold text-slate-900">Accept online pickup requests</span><span className="text-xs text-slate-500">You can switch it off any time.</span></span>
            <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={s.enabled} disabled={saving} onChange={(e) => void save({ ...s, enabled: e.target.checked })} />
          </label>
          {session.branches.length > 1 && (
            <Field label="Requests go to branch">
              <Select value={s.branchId ?? ""} onChange={(e) => setS({ ...s, branchId: e.target.value || undefined })}>
                <option value="">Main branch</option>
                {session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Message on the page (optional)"><Input value={s.message ?? ""} onChange={(e) => setS({ ...s, message: e.target.value })} maxLength={300} placeholder="Free pickup on orders above ₹300" /></Field>
          <Button variant="secondary" size="sm" loading={saving} onClick={() => void save(s)}>Save</Button>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          {s.enabled && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Globe className="h-4 w-4 text-brand-700" />Your booking link</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-700">{url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { void copyText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy link"}</Button>
                <a href={url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><ExternalLink className="h-4 w-4" />Open</Button></a>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Book a free pickup from ${session.organization.name}: ${url}`)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4" />Share on WhatsApp</Button></a>
              </div>
              <div className="mt-4 flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/v1/booking/qr" alt="QR code for the booking page" className="h-28 w-28 rounded-lg border border-slate-200 bg-white p-1" />
                <div className="text-xs text-slate-600">
                  <p>Print this QR for your counter, bags and visiting cards.</p>
                  <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(`<title>Book a pickup</title><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>${session.organization.name.replace(/</g, "&lt;")}</h1><h2>Scan to book a free pickup</h2><img src="${location.origin}/api/v1/booking/qr" style="width:320px"><p>${url}</p><script>setTimeout(()=>print(),500)</script></body>`); w.document.close(); } }}><Printer className="h-4 w-4" />Print QR poster</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
