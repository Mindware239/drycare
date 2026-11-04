"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { landingPath } from "@/lib/landing";
import { AuthHeading, AuthNotice, AuthShell, PasswordChecks, PasswordInput } from "@/components/marketing/AuthShell";

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
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <AuthNotice tone="bad">{linkError}</AuthNotice>
        <Link href="/login" className="dc-btn-block" style={{ textDecoration: "none" }}>Back to sign in →</Link>
      </div>
    );
  }
  if (!link) return <p className="dc-small" style={{ margin: 0 }}>Checking your link…</p>;

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ margin: 0, fontSize: 15, color: "#4f4e4a" }}>For <strong style={{ color: "#151514" }}>{link.email}</strong>{link.organizationName && <> at {link.organizationName}</>}</p>
      {error && <AuthNotice tone="bad">{error}</AuthNotice>}
      <label className="dc-label-lg"><span>New password</span><PasswordInput autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a new password" /></label>
      <label className="dc-label-lg"><span>Confirm new password</span><PasswordInput autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" /></label>
      <PasswordChecks checks={checks} />
      <button type="submit" disabled={saving || !checks.every((c) => c.ok)} className="dc-btn-block">{saving ? "Saving…" : "Save password & sign in →"}</button>
      <p style={{ margin: 0, fontSize: 13, color: "#6b6963", textAlign: "center" }}>Saving signs this account out on every other device.</p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <AuthHeading title="Choose a new password" />
      <Suspense><ResetForm /></Suspense>
      <div style={{ paddingTop: 20, borderTop: "1px solid #eeece6", fontSize: 15, color: "#4f4e4a" }}>Remembered it? <Link href="/login" style={{ fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>Sign in</Link></div>
    </AuthShell>
  );
}
