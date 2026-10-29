"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, LoaderCircle, UserRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { landingPath } from "@/lib/landing";
import { Alert, cx } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { BrandName, IconInput, SecretInput, primaryButton } from "@/components/AuthUi";

type Invite = { purpose: string; email: string; name?: string; organizationName?: string; existingAccount: boolean };

/** Opened from a staff invitation email or link: /accept-invite?token=… */
function AcceptForm() {
  const token = useSearchParams().get("token") ?? "";
  const [invite, setInvite] = useState<Invite | null>(null);
  const [linkError, setLinkError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setLinkError("This invitation link is incomplete. Open the link from your invitation again, or ask for a new one.");
      return;
    }
    api<Invite>(`/auth/token/${encodeURIComponent(token)}`)
      .then((t) => {
        if (t.purpose !== "invitation") return setLinkError("This link is not a staff invitation.");
        setInvite(t);
        setName(t.name ?? "");
      })
      .catch((err: ApiError) => setLinkError(err.message));
  }, [token]);

  const existing = invite?.existingAccount ?? false;
  const checks = existing ? [] : [
    { ok: name.trim().length >= 2, label: "Your name" },
    { ok: password.length >= 10, label: "At least 10 characters" },
    { ok: password.length > 0 && password === confirm, label: "Passwords match" },
  ];
  const ready = existing ? password.length > 0 : checks.every((c) => c.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError("");
    try {
      await api("/auth/accept-invitation", { body: { token, password, ...(existing ? {} : { name: name.trim() }) } });
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
        <Link href="/login" className={primaryButton}>Go to sign in <ArrowRight className="h-5 w-5" /></Link>
      </div>
    );
  }
  if (!invite) return <div className="flex justify-center py-10 text-slate-400"><LoaderCircle className="h-6 w-6 animate-spin" /></div>;

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-center text-[15px] leading-6 text-slate-500">
        You&apos;ve been invited to join <strong className="text-slate-900">{invite.organizationName ?? "a DryCare store"}</strong> as <strong className="text-slate-900">{invite.email}</strong>.
        {existing && " This email already has a DryCare account, so sign in with its password to accept."}
      </p>
      {error && <Alert>{error}</Alert>}
      {!existing && (
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-800">Your full name</span>
          <IconInput icon={UserRound} required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="As your team will see it" autoComplete="name" />
        </label>
      )}
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-800">{existing ? "Your DryCare password" : "Create a password"}</span>
        <SecretInput required autoFocus={existing} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={existing ? "Enter your password" : "Create a password"} autoComplete={existing ? "current-password" : "new-password"} />
      </label>
      {!existing && (
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-800">Confirm password</span>
          <SecretInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" autoComplete="new-password" />
        </label>
      )}
      {checks.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {checks.map((c) => <li key={c.label} className={cx("flex items-center gap-1.5", c.ok ? "text-emerald-700" : "text-slate-400")}><CheckCircle2 className="h-4 w-4" />{c.label}</li>)}
        </ul>
      )}
      <button type="submit" disabled={saving || !ready} className={primaryButton}>
        {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <>Join the team <ArrowRight className="h-5 w-5" /></>}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f2f8f8] px-4 py-10">
      <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-teal-100/80 blur-2xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-cyan-100/80 blur-2xl" aria-hidden="true" />
      <div className="relative w-full max-w-[520px] rounded-3xl border border-white bg-white px-6 py-9 shadow-[0_30px_80px_-30px_rgba(6,38,44,0.25)] sm:px-11">
        <div className="flex flex-col items-center text-center">
          <Link href="/" className="flex items-center gap-3"><Logo className="h-12 w-12 rounded-xl" /><BrandName className="text-[30px] text-slate-900" /></Link>
          <h1 className="mt-7 text-[28px] font-bold tracking-tight text-slate-900">Join your team</h1>
        </div>
        <div className="mt-4">
          <Suspense>
            <AcceptForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Already joined? <Link href="/login" className="font-semibold text-teal-700 hover:underline">Sign in</Link></p>
      </div>
    </main>
  );
}
