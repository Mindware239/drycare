"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthHeading, AuthNotice, AuthShell } from "@/components/marketing/AuthShell";

const cta = { textDecoration: "none" } as const;

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthShell><p className="dc-small" style={{ margin: 0 }}>Loading…</p></AuthShell>}>
      <VerifyEmailContent />
    </Suspense>
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

  if (state === "checking") return <AuthShell><p className="dc-small" style={{ margin: 0 }}>Checking your verification link…</p></AuthShell>;
  if (state === "verified") {
    return (
      <AuthShell>
        <AuthHeading title="Email verified">Your account email is confirmed. Password resets and order emails will reach you.</AuthHeading>
        <Link href="/onboarding" className="dc-btn-block" style={cta}>Continue setup</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <AuthHeading title="This link can't be used">{message || "The link is invalid or has expired."} Sign in and request a new link from the setup page.</AuthHeading>
      <Link href="/verify-email" className="dc-btn-block" style={cta}>Send a new link</Link>
    </AuthShell>
  );
}

/** Opened from the setup checklist: explain where the link went and offer a fresh one. */
function CheckInbox() {
  const [email, setEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [signedIn, setSignedIn] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

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
      else if (r.emailConfigured === false) setNotice({ tone: "bad", text: "A new link was created, but email sending is not set up on this Drycare system yet, so it could not be delivered. Ask your Drycare administrator." });
      else setNotice({ tone: "good", text: `A new link is on its way to ${email}. It works for 24 hours.` });
    } catch (e) {
      setNotice({ tone: "bad", text: (e as ApiError).status === 429 ? "You've asked for several links already. Please wait a few minutes and check your spam folder." : (e as ApiError).message });
    } finally {
      setSending(false);
    }
  }

  if (!signedIn) {
    return (
      <AuthShell>
        <AuthHeading title="Sign in to continue">Open the link from your verification email, or sign in to request a new one.</AuthHeading>
        <Link href="/login?next=/verify-email" className="dc-btn-block" style={cta}>Sign in</Link>
      </AuthShell>
    );
  }
  if (verified) {
    return (
      <AuthShell>
        <AuthHeading title="Your email is already verified">{email} is confirmed. Nothing more to do here.</AuthHeading>
        <Link href="/onboarding" className="dc-btn-block" style={cta}>Back to setup</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <AuthHeading title="Check your inbox">
        We sent a verification link to <strong style={{ color: "#151514" }}>{email ?? "your email"}</strong>. Open it on any device to confirm your account. It can take a minute to arrive, so check the spam folder too.
      </AuthHeading>
      {notice && <AuthNotice tone={notice.tone}>{notice.text}</AuthNotice>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" className="dc-btn-block" onClick={resend} disabled={sending || !email}>{sending ? "Sending…" : "Send a new link"}</button>
        <Link href="/onboarding" className="dc-btn dc-btn-line" style={{ textAlign: "center" }}>← Back to setup</Link>
      </div>
    </AuthShell>
  );
}
