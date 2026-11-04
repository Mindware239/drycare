"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { landingPath } from "@/lib/landing";
import { AuthHeading, AuthNotice, AuthShell, PasswordChecks, PasswordInput } from "@/components/marketing/AuthShell";

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
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <AuthNotice tone="bad">{linkError}</AuthNotice>
        <Link href="/login" className="dc-btn-block" style={{ textDecoration: "none" }}>Go to sign in →</Link>
      </div>
    );
  }
  if (!invite) return <p className="dc-small" style={{ margin: 0 }}>Checking your invitation…</p>;

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#4f4e4a" }}>
        You&apos;ve been invited to join <strong style={{ color: "#151514" }}>{invite.organizationName ?? "a Drycare store"}</strong> as <strong style={{ color: "#151514" }}>{invite.email}</strong>.
        {existing && " This email already has a Drycare account, so sign in with its password to accept."}
      </p>
      {error && <AuthNotice tone="bad">{error}</AuthNotice>}
      {!existing && (
        <label className="dc-label-lg">Your full name
          <input className="dc-input dc-input-lg" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="As your team will see it" autoComplete="name" />
        </label>
      )}
      <label className="dc-label-lg"><span>{existing ? "Your Drycare password" : "Create a password"}</span>
        <PasswordInput required autoFocus={existing} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={existing ? "Enter your password" : "Create a password"} autoComplete={existing ? "current-password" : "new-password"} />
      </label>
      {!existing && (
        <label className="dc-label-lg"><span>Confirm password</span>
          <PasswordInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" autoComplete="new-password" />
        </label>
      )}
      {checks.length > 0 && <PasswordChecks checks={checks} />}
      <button type="submit" disabled={saving || !ready} className="dc-btn-block">{saving ? "Joining…" : "Join the team →"}</button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <AuthShell>
      <AuthHeading title="Join your team" />
      <Suspense><AcceptForm /></Suspense>
      <div style={{ paddingTop: 20, borderTop: "1px solid #eeece6", fontSize: 15, color: "#4f4e4a" }}>Already joined? <Link href="/login" style={{ fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>Sign in</Link></div>
    </AuthShell>
  );
}
