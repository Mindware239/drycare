"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { landingPath } from "@/lib/landing";
import { Alert, cx } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { BrandName, SecretInput, primaryButton } from "@/components/AuthUi";

/** Opened from the "reset your password" email link: /reset-password?token=… */
function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [link, setLink] = useState<{ email: string; organizationName?: string } | null>(null);
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setLinkError("This reset link is incomplete. Open the link from your email again, or request a new one.");
      return;
    }
    api<{ purpose: string; email: string; organizationName?: string }>(`/auth/token/${encodeURIComponent(token)}`)
      .then((t) => (t.purpose === "password_reset" ? setLink(t) : setLinkError("This link is not a password reset link.")))
      .catch((err: ApiError) => setLinkError(err.message));
  }, [token]);

  const checks = [
    { ok: password.length >= 10, label: "At least 10 characters" },
    { ok: password.length > 0 && password === confirm, label: "Passwords match" },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!checks.every((c) => c.ok)) return;
    setSaving(true);
    setError("");
    try {
      await api("/auth/reset-password", { body: { token, password } });
      window.location.replace(await landingPath());
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  }

  if (linkError) {
    return (
      <div className="space-y-5">
        <Alert>{linkError}</Alert>
        <Link href="/login" className={primaryButton}>Back to sign in <ArrowRight className="h-5 w-5" /></Link>
      </div>
    );
  }
  if (!link) return <div className="flex justify-center py-10 text-slate-400"><LoaderCircle className="h-6 w-6 animate-spin" /></div>;

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-center text-[15px] text-slate-500">
        For <strong className="text-slate-900">{link.email}</strong>{link.organizationName && <> at {link.organizationName}</>}
      </p>
      {error && <Alert>{error}</Alert>}
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-800">New password</span>
        <SecretInput autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a new password" />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-800">Confirm new password</span>
        <SecretInput autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" />
      </label>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {checks.map((c) => <li key={c.label} className={cx("flex items-center gap-1.5", c.ok ? "text-emerald-700" : "text-slate-400")}><CheckCircle2 className="h-4 w-4" />{c.label}</li>)}
      </ul>
      <button type="submit" disabled={saving || !checks.every((c) => c.ok)} className={primaryButton}>
        {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <>Save password &amp; sign in <ArrowRight className="h-5 w-5" /></>}
      </button>
      <p className="text-center text-xs text-slate-500">Saving signs this account out on every other device.</p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f2f8f8] px-4 py-10">
      <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-teal-100/80 blur-2xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-cyan-100/80 blur-2xl" aria-hidden="true" />
      <div className="relative w-full max-w-[520px] rounded-3xl border border-white bg-white px-6 py-9 shadow-[0_30px_80px_-30px_rgba(6,38,44,0.25)] sm:px-11">
        <div className="flex flex-col items-center text-center">
          <Link href="/" className="flex items-center gap-3"><Logo className="h-12 w-12 rounded-xl" /><BrandName className="text-[30px] text-slate-900" /></Link>
          <h1 className="mt-7 text-[28px] font-bold tracking-tight text-slate-900">Choose a new password</h1>
        </div>
        <div className="mt-4">
          <Suspense>
            <ResetForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Remembered it? <Link href="/login" className="font-semibold text-teal-700 hover:underline">Sign in</Link></p>
      </div>
    </main>
  );
}
