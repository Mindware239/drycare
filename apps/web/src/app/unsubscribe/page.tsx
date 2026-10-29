"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, MailX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button } from "@/components/ui";

type UnsubscribeLink = { organizationId: string; customerId: string; token: string };

export default function UnsubscribePage() {
  const [link, setLink] = useState<UnsubscribeLink | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const organizationId = query.get("organizationId") ?? "";
    const customerId = query.get("customerId") ?? "";
    const token = query.get("token") ?? "";
    if (!organizationId || !customerId || !token) {
      setState("error");
      setError("This unsubscribe link is incomplete. Contact the store if you still receive promotional emails.");
      return;
    }
    setLink({ organizationId, customerId, token });
    setState("ready");
  }, []);

  async function unsubscribe() {
    if (!link) return;
    setError("");
    try {
      await api("/marketing/unsubscribe", { method: "POST", body: link });
      setState("done");
    } catch (e) {
      setError((e as ApiError).message);
      setState("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          {state === "done" ? <CheckCircle2 className="h-6 w-6" /> : <MailX className="h-6 w-6" />}
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-950">{state === "done" ? "You’re unsubscribed" : "Email preferences"}</h1>
        {state === "error" ? <div className="mt-4 text-left"><Alert>{error}</Alert></div> : state === "done" ? (
          <p className="mt-2 text-sm text-slate-600">You will no longer receive promotional emails from this store. Important order updates are not affected.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">Stop receiving promotional emails from this store? Order updates about your garments will not be affected.</p>
            <Button className="mt-5 w-full" disabled={state === "loading" || !link} onClick={unsubscribe}>
              Unsubscribe from promotions
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
