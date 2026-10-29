"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CircleCheck, LoaderCircle, MailCheck, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button } from "@/components/ui";
import { Wordmark } from "@/components/Brand";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Shell><p className="text-sm text-slate-600">Loading…</p></Shell>}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f6] p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_10px_40px_rgba(15,23,42,.06)]">
        <Wordmark />
        <div className="mt-8">{children}</div>
      </section>
    </main>
  );
}

function VerifyEmailContent() {
  const token = useSearchParams().get("token") ?? "";
  return token ? <CheckLink token={token} /> : <CheckInbox />;
}

/** Arrived from the link in the email. */
function CheckLink({ token }: { token: string }) {
  const [state, setState] = useState<"checking" | "verified" | "error">("checking");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/auth/verify-email", { body: { token } })
      .then(() => setState("verified"))
      .catch((error: ApiError) => { setState("error"); setMessage(error.message); });
  }, [token]);

  if (state === "checking") return <Shell><p className="flex items-center gap-2 text-sm text-slate-600"><LoaderCircle className="h-4 w-4 animate-spin" />Checking your verification link…</p></Shell>;
  if (state === "verified") {
    return (
      <Shell>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleCheck className="h-6 w-6" /></span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Email verified</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Your account email is confirmed. Password resets and order emails will reach you.</p>
        <Link href="/onboarding" className="mt-6 block"><Button size="lg" className="w-full">Continue setup</Button></Link>
      </Shell>
    );
  }
  return (
    <Shell>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><TriangleAlert className="h-6 w-6" /></span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">This link can&apos;t be used</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{message || "The link is invalid or has expired."} Sign in and request a new link from the setup page.</p>
      <Link href="/verify-email" className="mt-6 block"><Button size="lg" className="w-full">Send a new link</Button></Link>
    </Shell>
  );
}

/** Opened from the setup checklist: explain where the link went and offer a fresh one. */
function CheckInbox() {
  const [email, setEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [signedIn, setSignedIn] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "green" | "amber" | "red"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([api<{ user: { email: string } }>("/auth/session"), api<{ emailVerified: boolean }>("/auth/trial-status")])
      .then(([s, t]) => { setEmail(s.user.email); setVerified(t.emailVerified); })
      .catch(() => setSignedIn(false));
  }, []);

  async function resend() {
    setSending(true);
    setNotice(null);
    try {
      const r = await api<{ sent: boolean; alreadyVerified: boolean; emailConfigured?: boolean }>("/auth/verify-email/resend", { body: {} });
      if (r.alreadyVerified) setVerified(true);
      else if (r.emailConfigured === false) setNotice({ tone: "amber", text: "A new link was created, but email sending is not set up on this DryCare system yet, so it could not be delivered. Ask your DryCare administrator." });
      else setNotice({ tone: "green", text: `A new link is on its way to ${email}. It works for 24 hours.` });
    } catch (e) {
      setNotice({ tone: "red", text: (e as ApiError).status === 429 ? "You've asked for several links already. Please wait a few minutes and check your spam folder." : (e as ApiError).message });
    } finally {
      setSending(false);
    }
  }

  if (!signedIn) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in to continue</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Open the link from your verification email, or sign in to request a new one.</p>
        <Link href="/login?next=/verify-email" className="mt-6 block"><Button size="lg" className="w-full">Sign in</Button></Link>
      </Shell>
    );
  }
  if (verified) {
    return (
      <Shell>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleCheck className="h-6 w-6" /></span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Your email is already verified</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{email} is confirmed. Nothing more to do here.</p>
        <Link href="/onboarding" className="mt-6 block"><Button size="lg" className="w-full">Back to setup</Button></Link>
      </Shell>
    );
  }
  return (
    <Shell>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><MailCheck className="h-6 w-6" /></span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Check your inbox</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        We sent a verification link to <span className="font-semibold text-slate-900">{email ?? "your email"}</span>. Open it on any device to confirm your account. It can take a minute to arrive — check the spam folder too.
      </p>
      {notice && <div className="mt-4"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      <div className="mt-6 space-y-2">
        <Button size="lg" className="w-full" onClick={resend} loading={sending} disabled={!email}>Send a new link</Button>
        <Link href="/onboarding" className="block"><Button size="lg" variant="ghost" className="w-full"><ArrowLeft className="h-4 w-4" />Back to setup</Button></Link>
      </div>
    </Shell>
  );
}
