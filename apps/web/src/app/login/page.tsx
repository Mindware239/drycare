"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { landingPath } from "@/lib/landing";
import { AuthHeading, AuthNotice, AuthShell, PasswordInput } from "@/components/marketing/AuthShell";

type SystemInfo = { allowSignup: boolean; setupRequired: boolean; edition: string; version: string; license?: { required: boolean; active: boolean } };

function LoginForm({ desktop, onForgot }: { desktop: boolean; onForgot: () => void }) {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/auth/login", { body: { email, password, remember } });
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        window.location.href = next;
        return;
      }
      window.location.href = await landingPath();
    } catch (err) {
      setError((err as ApiError).message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <AuthNotice tone="bad">{error}</AuthNotice>}
      {desktop && <AuthNotice>This PC uses its own local store account. Sign in with the email and password entered during this PC&apos;s first store setup; web, cloud, and other computers&apos; accounts are separate.</AuthNotice>}
      <label className="dc-label-lg">Email address
        <input className="dc-input dc-input-lg" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourstore.in" />
      </label>
      <label className="dc-label-lg">
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          Password
          {desktop
            ? <Link href="/desktop-recovery" className="dc-textlink">Forgot password?</Link>
            : <button type="button" onClick={onForgot} className="dc-textlink">Forgot password?</button>}
        </span>
        <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "#33332f", cursor: "pointer", minHeight: 44 }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 20, height: 20, accentColor: "#151514", margin: 0 }} />
        Keep me signed in on this device
      </label>
      <button type="submit" disabled={loading} className="dc-btn-block">{loading ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api<{ message: string }>("/auth/forgot-password", { body: { email: email.trim().toLowerCase() } });
      setSent(res.message);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={onBack} style={{ font: "inherit", fontSize: 15, fontWeight: 500, background: "transparent", border: 0, padding: "4px 0", alignSelf: "flex-start", color: "#151514", minHeight: 44 }}>← Back to sign in</button>
      <AuthHeading title="Reset your password">Enter your account email and we&apos;ll send you a link to set a new password.</AuthHeading>
      {sent ? (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 12, background: "#dff3e4", borderRadius: 16, padding: 20, color: "#174f27" }}>
          <span className="dc-t" style={{ fontSize: 20, letterSpacing: "normal", color: "#151514" }}>Check your inbox</span>
          <span style={{ fontSize: 15, lineHeight: 1.55 }}>{sent}</span>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {error && <AuthNotice tone="bad">{error}</AuthNotice>}
          <label className="dc-label-lg">Email address
            <input className="dc-input dc-input-lg" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourstore.in" />
          </label>
          <button type="submit" disabled={loading} className="dc-btn-block">{loading ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
    </>
  );
}

export default function LoginPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  useEffect(() => {
    api<SystemInfo>("/system/info")
      .then((i) => {
        if (i.license?.required && !i.license.active) {
          window.location.replace("/activate");
          return;
        }
        // Fresh standalone install: go straight to first-time setup.
        if (i.setupRequired) window.location.replace("/signup");
        else setInfo(i);
      })
      .catch(() => {});
  }, []);
  const desktop = info?.edition === "desktop";

  return (
    <AuthShell showWebsiteLinks={!desktop}>
      {mode === "forgot" ? (
        <ForgotPassword onBack={() => setMode("signin")} />
      ) : (
        <>
          <AuthHeading title="Welcome back">Sign in to manage your orders, garments and deliveries.</AuthHeading>
          <Suspense><LoginForm desktop={desktop} onForgot={() => setMode("forgot")} /></Suspense>
          {!desktop && (
            <div style={{ paddingTop: 20, borderTop: "1px solid #eeece6", fontSize: 15, color: "#4f4e4a", display: "flex", flexDirection: "column", gap: 6 }}>
              <span>New to Drycare? <Link href="/#demo" style={{ fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>Book a free demo</Link></span>
              {info?.allowSignup && <span>Ready to start? <Link href="/signup" style={{ fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>Set up your store</Link></span>}
            </div>
          )}
          {desktop && !info?.setupRequired && (
            <p style={{ margin: 0, paddingTop: 20, borderTop: "1px solid #eeece6", fontSize: 14, lineHeight: 1.5, color: "#4f4e4a" }}>If you don&apos;t know the first setup account, contact the person who set up this PC&apos;s store. Reinstalling does not create a new account or remove saved store data.</p>
          )}
        </>
      )}
    </AuthShell>
  );
}
