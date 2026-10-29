"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Logo } from "@/components/Brand";
import { Alert, Spinner } from "@/components/ui";
import { LaundryCheckout } from "@/components/LaundryCheckout";

type Session = { organization: { name: string }; branches: { id: string; name: string }[]; permissions: string[] };

/**
 * Customer-facing self-service screen for a tablet in the shop. It runs on a staff login (use an
 * operator account) but shows no staff menus; customers build their order and pay at the counter.
 */
function Kiosk() {
  const params = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Session>("/auth/session").then(setSession).catch((e: ApiError) => {
      if (e.status === 401) window.location.href = `/login?next=${encodeURIComponent("/laundry-kiosk")}`;
      else setError(e.message);
    });
  }, []);
  if (error) return <div className="p-6"><Alert>{error}</Alert></div>;
  if (!session) return <Spinner />;
  if (!session.permissions.includes("laundry.operate")) return <div className="p-6"><Alert>This login cannot take self-service orders. Sign in with an operator or counter account.</Alert></div>;
  const branch = session.branches.find((b) => b.id === params.get("branch")) ?? session.branches[0];
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-slate-50">
      <header className="flex items-center justify-between border-b border-brand-100 bg-white/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <div><p className="text-lg font-semibold text-slate-900">{session.organization.name}</p><p className="text-sm text-slate-500">Self-service laundry · {branch?.name}</p></div>
        </div>
        <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Maximize2 className="h-4 w-4" />Full screen</button>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="mb-1 text-3xl font-semibold tracking-tight text-slate-900">Wash · Dry · Iron</h1>
        <p className="mb-5 text-slate-600">Choose your service, weigh your laundry and pick a machine. Pay at the counter or by UPI — your machine unlocks once paid.</p>
        {branch ? <LaundryCheckout branchId={branch.id} mode="kiosk" /> : <Alert>No store is assigned to this login.</Alert>}
      </main>
    </div>
  );
}

export default function KioskPage() {
  return <Suspense><Kiosk /></Suspense>;
}
