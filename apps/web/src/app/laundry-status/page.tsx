"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock3, Loader2, Shirt, Wind, Flame } from "lucide-react";
import { Logo } from "@/components/Brand";

type Status = {
  orderNumber: string; status: string; serviceName: string; createdAt: string; completedAt: string | null; storeName: string; branchName: string; branchPhone: string | null;
  sessions: { machine: string; machineType: string; status: string; statusSource: string; program: string | null; startedAt: string | null; expectedEndAt: string | null; endedAt: string | null }[];
};

const STEP: Record<string, string> = {
  pending_payment: "Waiting for payment at the counter",
  paid: "Paid — your machine will be started shortly",
  in_progress: "Your laundry is in the machine",
  ready: "Done! Your laundry is ready to collect",
  collected: "Collected. Thank you!",
  cancelled: "This order was cancelled",
};
const ICON: Record<string, typeof Shirt> = { washer: Shirt, dryer: Wind, iron_station: Flame };

/** Public page opened from the receipt QR. Shows machine progress only — no personal or payment details. */
function StatusInner() {
  const token = useSearchParams().get("t") ?? "";
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!token) {
      setError("This status link is incomplete. Scan the QR code on your receipt again.");
      return;
    }
    let alive = true;
    const load = () => fetch(`/api/v1/public/laundry-status/${encodeURIComponent(token)}`)
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? "We couldn't find this order." : "Could not load the status. Please try again."); return r.json(); })
      .then((d) => alive && (setData(d), setError("")))
      .catch((e: Error) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 to-white px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center gap-3"><Logo className="h-9 w-9" /><div><p className="font-semibold text-slate-900">{data?.storeName ?? "DryCare"}</p><p className="text-xs text-slate-500">{data?.branchName ?? "Self-service laundry"}</p></div></div>
        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : !data ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Order {data.orderNumber}</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{STEP[data.status] ?? data.status}</h1>
            <p className="mt-1 text-sm text-slate-500">{data.serviceName}</p>
            <ul className="mt-5 space-y-3">
              {data.sessions.map((s, i) => {
                const Icon = ICON[s.machineType] ?? Shirt;
                const left = s.status === "running" && s.expectedEndAt ? Math.round((new Date(s.expectedEndAt).getTime() - Date.now()) / 60_000) : null;
                return (
                  <li key={i} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{s.machine}</p>
                      <p className="text-xs text-slate-500">{s.program ?? ""}</p>
                    </div>
                    <span className="text-right text-xs font-semibold">
                      {s.status === "completed" ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Finished</span>
                        : s.status === "running" ? <span className="inline-flex items-center gap-1 text-violet-700"><Clock3 className="h-4 w-4" />{left !== null && left > 0 ? `~${left} min left` : "Finishing — staff will confirm"}</span>
                        : s.status === "failed" ? <span className="text-red-700">Stopped — please see staff</span>
                        : <span className="text-blue-700">Booked</span>}
                    </span>
                  </li>
                );
              })}
              {!data.sessions.length && <li className="text-sm text-slate-500">A machine will be assigned at the counter.</li>}
            </ul>
            {data.status === "ready" && <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Please collect your laundry from the counter{data.branchPhone ? ` · ${data.branchPhone}` : ""}.</p>}
            <p className="mt-5 text-center text-[11px] text-slate-400">Updates automatically · times are estimates</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function LaundryStatusPage() {
  return <Suspense><StatusInner /></Suspense>;
}
