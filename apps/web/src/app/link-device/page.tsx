"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, Laptop, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Wordmark } from "@/components/Brand";

type Request = {
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  expiresAt: string; deviceName: string;
  shop: { name: string; branchName: string; branchCode: string; gstin: string | null };
  existing: { linkable: boolean; managedByDevice: boolean; youAreOwner: boolean } | null;
  activeDevice: { name: string; lastSeenAt: string | null } | null;
  entitled: boolean;
};

export default function LinkDevicePage() {
  return <Suspense fallback={<Shell><p className="text-sm text-slate-600">Loading…</p></Shell>}><LinkDevice /></Suspense>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f6] p-5">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_10px_40px_rgba(15,23,42,.06)]">
        <Wordmark />
        <div className="mt-8">{children}</div>
      </section>
    </main>
  );
}

function LinkDevice() {
  const params = useSearchParams();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [req, setReq] = useState<Request | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<{ organizationId: string; entitled: boolean } | null>(null);

  useEffect(() => {
    api("/auth/session").then(() => setSignedIn(true)).catch(() => setSignedIn(false));
  }, []);
  useEffect(() => {
    if (!signedIn || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return;
    setErr("");
    api<Request>(`/sync/link/requests/${code}`).then(setReq).catch((e: ApiError) => { setReq(null); setErr(e.status === 404 ? "No PC is waiting with this code. Check the code shown on the PC." : e.message); });
  }, [signedIn, code]);

  async function approve(replaceExisting = false) {
    setBusy("approve");
    setErr("");
    try {
      const r = await api<{ organizationId: string; entitled: boolean }>("/sync/link/approve", { body: { code, replaceExisting } });
      setDone(r);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy("");
    }
  }
  async function deny() {
    setBusy("deny");
    await api("/sync/link/deny", { body: { code } }).catch(() => {});
    setReq((r) => (r ? { ...r, status: "denied" } : r));
    setBusy("");
  }
  async function openShop(path: string) {
    await api("/auth/switch-organization", { body: { organizationId: done!.organizationId } }).catch(() => {});
    window.location.href = path;
  }

  if (signedIn === null) return <Shell><p className="flex items-center gap-2 text-sm text-slate-600"><LoaderCircle className="h-4 w-4 animate-spin" />Loading…</p></Shell>;
  if (!signedIn) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in to approve your shop PC</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Sign in with your DryCare Cloud account, or create one, to link the PC showing code <b className="font-mono">{code || "…"}</b>.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href={`/login?next=${encodeURIComponent(`/link-device?code=${code}`)}`}><Button size="lg" className="w-full">Sign in</Button></Link>
          <Link href={`/signup?next=${encodeURIComponent(`/link-device?code=${code}`)}`}><Button size="lg" variant="secondary" className="w-full">Create a cloud account</Button></Link>
        </div>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleCheck className="h-6 w-6" /></span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">PC linked</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">The PC now uploads its records to <b>{req?.shop.name}</b> in DryCare Cloud. The cloud copy is view-only; the shop keeps working on the PC as before.</p>
        {!done.entitled && <div className="mt-4"><Alert tone="amber">Cloud sync is a paid add-on. Choose a DryCare Cloud plan for this shop to start uploading — until then everything stays safely on the PC.</Alert></div>}
        <div className="mt-6 flex flex-col gap-2">
          {!done.entitled && <Button size="lg" className="w-full" onClick={() => openShop("/billing")}>Choose a cloud plan</Button>}
          <Button size="lg" variant={done.entitled ? "primary" : "secondary"} className="w-full" onClick={() => openShop("/dashboard")}>Open the shop in DryCare Cloud</Button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Link a shop PC</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Check that this code matches the one on the PC.</p>
      <Field label="Code shown on the PC" className="mt-4"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-2345" className="font-mono text-lg tracking-widest" maxLength={9} /></Field>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}
      {req && (
        <div className="mt-5 space-y-4">
          {req.status !== "pending" ? (
            <Alert tone="amber">{req.status === "expired" ? "This code has expired. Start linking again on the PC." : req.status === "denied" ? "This request was declined." : "This code was already used."}</Alert>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold text-slate-900"><Laptop className="h-4 w-4 text-slate-500" />{req.deviceName}</p>
                <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-slate-600">
                  <dt>Shop</dt><dd className="font-medium text-slate-900">{req.shop.name}</dd>
                  <dt>Branch</dt><dd>{req.shop.branchName} ({req.shop.branchCode})</dd>
                  {req.shop.gstin && <><dt>GSTIN</dt><dd className="font-mono">{req.shop.gstin}</dd></>}
                </dl>
              </div>
              {req.existing && !req.existing.linkable ? (
                <Alert>{!req.existing.managedByDevice ? "A cloud business already uses this shop's identity and cannot be linked to a PC." : "Only the owner of this shop's cloud copy can link a PC to it. Sign in with that account."}</Alert>
              ) : (
                <>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" />{req.existing ? "The PC will upload to your existing cloud copy of this shop." : "A view-only cloud copy of this shop will be created for your account."}</li>
                    <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" />You can disconnect the PC here at any time; it then stops uploading.</li>
                  </ul>
                  {req.activeDevice && <Alert tone="amber"><span className="flex gap-2"><TriangleAlert className="h-4 w-4 shrink-0" />“{req.activeDevice.name}” is linked now. Only one PC per shop can upload (to keep invoice numbers unique); approving will disconnect it.</span></Alert>}
                  <div className="flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={deny} loading={busy === "deny"}>Decline</Button>
                    <Button className="flex-1" onClick={() => approve(Boolean(req.activeDevice))} loading={busy === "approve"}>{req.activeDevice ? "Replace and link" : "Approve"}</Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
