"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Wordmark } from "@/components/Brand";
import { copyText } from "@/lib/clipboard";

type LicenseStatus = {
  required: boolean;
  active: boolean;
  requestCode: string | null;
  plan: string | null;
  expiresAt: string | null;
  error: "not_activated" | "invalid" | "expired" | "demo_ended" | null;
  demo: { startedAt: string; endsAt: string; daysLeft: number; ended: boolean } | null;
};

export default function ActivatePage() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<LicenseStatus>("/system/license/status")
      .then(async (license) => {
        setStatus(license);
        if (!license.required) {
          window.location.replace("/login");
          return;
        }
        // During the demo the owner can open this page from "Upgrade" to activate early.
        if (license.active && !(license.demo && new URLSearchParams(window.location.search).has("upgrade"))) {
          const info = await api<{ setupRequired: boolean }>("/system/info");
          window.location.replace(info.setupRequired ? "/signup" : "/login");
        }
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      await api<LicenseStatus>("/system/license/activate", { body: { key } });
      const info = await api<{ setupRequired: boolean }>("/system/info");
      window.location.replace(info.setupRequired ? "/signup" : "/login");
    } catch (e) {
      setError((e as ApiError).message);
      setLoading(false);
    }
  }

  async function copyRequestCode() {
    if (!status?.requestCode) return;
    try {
      await copyText(status.requestCode);
      setNotice("This PC's activation request code was copied.");
    } catch {
      setNotice("Select and copy the activation request code above.");
    }
  }

  const expiryLabel = status?.expiresAt
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(status.expiresAt))
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 sm:p-8">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <Wordmark />
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">DryCare for PC · license activation</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          {status?.error === "expired" ? "Renew your DryCare license" : status?.error === "demo_ended" ? "Your 7-day demo has ended" : status?.demo ? "Upgrade to the full version" : "Activate this PC"}
        </h1>
        {status?.error === "demo_ended" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Thank you for trying DryCare. <strong>Upgrade to keep using it</strong>: everything you entered during the demo (customers, orders, garments, payments) is kept and will be there as soon as you activate.
          </div>
        )}
        {status?.demo && !status.demo.ended && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
            Your demo has <strong>{status.demo.daysLeft} day{status.demo.daysLeft === 1 ? "" : "s"}</strong> left. Activate now and your data carries on without interruption. <a href="/dashboard" className="font-semibold underline">Back to DryCare</a>
          </div>
        )}
        <ol className="mt-4 space-y-1.5 text-sm leading-6 text-slate-600">
          <li><strong className="text-slate-800">1.</strong> Choose a plan and pay DryCare by UPI or bank transfer{process.env.NEXT_PUBLIC_SITE_URL ? <> (see <a href={`${process.env.NEXT_PUBLIC_SITE_URL}/pricing`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">plans &amp; prices</a>)</> : null}.</li>
          <li><strong className="text-slate-800">2.</strong> Send this PC&apos;s request code (below) with your payment reference to DryCare.</li>
          <li><strong className="text-slate-800">3.</strong> Paste the activation key you receive. It works offline.</li>
        </ol>

        {status?.plan && status.error === "expired" && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            The {status.plan} license{expiryLabel ? ` expired on ${expiryLabel}` : ""}. Enter a renewed key to continue.
          </div>
        )}

        <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">This PC&apos;s activation request code</p>
          {status?.requestCode ? (
            <>
              <Input aria-label="Activation request code" readOnly value={status.requestCode} className="font-mono text-sm" />
              <Button type="button" variant="secondary" onClick={copyRequestCode}>Copy request code</Button>
            </>
          ) : (
            <p className="text-sm text-slate-500">Checking this PC&apos;s license information…</p>
          )}
          <p className="text-xs leading-5 text-slate-500">
            For a license covering multiple PCs, provide each PC&apos;s request code before the keys are issued. Keep the codes with your payment reference.
          </p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={activate}>
          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="green">{notice}</Alert>}
          <Field label="Signed activation key" required hint="Paste the complete key supplied by your DryCare license issuer.">
            <textarea
              aria-label="Signed activation key"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="block min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!status?.required}>
            Activate DryCare
          </Button>
        </form>

        <p className="mt-5 text-xs leading-5 text-slate-500">
          This license is verified offline and is tied to the request code(s) it was issued for. When a license expires, DryCare stops normal use until a renewal key is entered. Your local database and backups are not deleted.
        </p>
      </section>
    </main>
  );
}
