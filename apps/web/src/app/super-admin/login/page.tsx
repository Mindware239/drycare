"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Info, LoaderCircle, Mail, MailCheck, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { Alert, Field, Input, PasswordInput, cx } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { api } from "@/lib/api";

type Challenge = { challenge: string; expiresAt: string; delivery: "email" | "server_log" | "email_failed"; emailHint: string; devCodeFile?: string };

export default function SuperAdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [notice, setNotice] = useState("");

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      setChallenge(await api<Challenge>("/auth/platform-admin/login", { body: { email: email.trim().toLowerCase(), password } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start sign-in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#f3f8f8] lg:grid-cols-[minmax(0,1.7fr)_minmax(460px,1fr)]">
      <section className="relative hidden overflow-hidden bg-[#06232a] text-white lg:block">
        {/* Store photo on the right, fading into the dark panel behind the text */}
        <div className="absolute inset-y-0 right-0 w-[56%] bg-cover bg-[center_right] 2xl:w-[64%] 2xl:bg-center" style={{ backgroundImage: "url(/images/super-admin-hero.jpg)" }} aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#06232a_0%,#06232a_34%,rgba(6,35,42,0.86)_46%,rgba(6,35,42,0.35)_62%,rgba(6,35,42,0)_78%)]" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#06232a]/70 to-transparent" aria-hidden="true" />
        <div className="absolute -left-40 top-1/3 h-[28rem] w-[28rem] rounded-full bg-teal-500/10 blur-3xl" aria-hidden="true" />

        <div className="relative flex h-full min-h-screen flex-col justify-between p-12 xl:p-14">
          <div className="flex items-center gap-4">
            <Logo className="h-14 w-14 rounded-2xl" />
            <div>
              <p className="text-xl font-semibold tracking-tight">DryCare Control Center</p>
              <p className="text-sm text-slate-300">Mindware · Software owner administration</p>
            </div>
          </div>

          <div className="max-w-[540px] py-10">
            <h1 className="text-5xl font-bold leading-[1.08] tracking-tight xl:text-[56px]">
              Run the DryCare business from
              <span className="block bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">one secure place.</span>
            </h1>
            <p className="mt-6 max-w-[500px] text-lg leading-8 text-slate-300">Customers, trials, plans, payments, renewals and licenses for every dry-cleaning shop on DryCare.</p>
            <ul className="mt-10 space-y-5">
              <Feature icon={ShieldCheck} tone="bg-teal-700/60 text-teal-100 ring-teal-400/20" title="Two-step sign-in" text="Password and a one-time email code" />
              <Feature icon={Users} tone="bg-blue-700/50 text-blue-100 ring-blue-400/20" title="Shop owner and staff accounts" text="Can never sign in here" />
              <Feature icon={FileText} tone="bg-indigo-700/50 text-indigo-100 ring-indigo-400/20" title="Every action recorded" text="In a permanent audit log" />
            </ul>
          </div>

          <p className="flex items-center gap-2.5 text-sm text-slate-400"><ShieldCheck className="h-5 w-5" />Authorised Mindware personnel only. Access is monitored.</p>
        </div>
      </section>

      <section className="relative flex flex-col overflow-hidden p-5 sm:p-8 xl:p-12">
        {/* Soft background shapes */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal-100/70 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-cyan-100/70 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-teal-100/60 blur-2xl" aria-hidden="true" />

        <div className="relative flex flex-1 items-center justify-center">
        <div className="w-full max-w-[540px] rounded-3xl border border-white bg-white p-7 shadow-[0_30px_80px_-30px_rgba(6,35,42,0.25)] sm:p-11">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo className="h-10 w-10 rounded-xl" />
            <div><p className="font-semibold text-slate-900">DryCare Control Center</p><p className="text-xs text-slate-500">Mindware administration</p></div>
          </div>
          {mode === "forgot" ? (
            <ForgotPassword initialEmail={email} onDone={(message) => { setMode("signin"); setPassword(""); setError(""); setNotice(message); }} onCancel={() => setMode("signin")} />
          ) : challenge ? (
            <CodeStep challenge={challenge} onBack={() => { setChallenge(null); setPassword(""); setError(""); }} onResend={() => requestCode()} resending={loading} />
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Step 1 of 2</p>
              <h2 className="mt-3 text-[28px] font-bold leading-tight tracking-tight text-slate-900">Super admin sign in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Enter your DryCare administrator email and password. We will then email you a 6-digit code.</p>
              <form onSubmit={requestCode} className="mt-7 space-y-4">
                {notice && <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}
                {error && <Alert>{error}</Alert>}
                <Field label="Admin email" required>
                  <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="gm@indianbarcode.com" />
                </Field>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="sa-password" className="text-sm font-medium text-slate-700">Password <span className="text-red-500">*</span></label>
                    <button type="button" onClick={() => { setError(""); setNotice(""); setMode("forgot"); }} className="text-sm font-medium text-brand-700 hover:underline">Forgot password?</button>
                  </div>
                  <PasswordInput id="sa-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <PrimaryButton loading={loading}>Continue</PrimaryButton>
              </form>
              <p className="mt-8 text-center text-sm text-slate-500">Running a dry-cleaning shop? <Link href="/login" className="font-medium text-brand-700 hover:underline">Store sign in</Link></p>
            </>
          )}
        </div>
        </div>
        <p className="relative mt-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} Mindware · DryCare. All rights reserved.</p>
      </section>
    </main>
  );
}

function CodeStep({ challenge, onBack, onResend, resending }: { challenge: Challenge; onBack: () => void; onResend: () => void; resending: boolean }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sentAt, setSentAt] = useState(Date.now());
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setDigits(Array(6).fill(""));
    setError("");
    setSentAt(Date.now());
    inputs.current[0]?.focus();
  }, [challenge.challenge]);

  const secondsLeft = Math.max(0, Math.floor((new Date(challenge.expiresAt).getTime() - now) / 1000));
  const resendIn = Math.min(30, Math.max(0, 30 - Math.floor((now - sentAt) / 1000)));
  const code = digits.join("");

  async function verify(value = code) {
    if (value.length !== 6) return;
    setVerifying(true);
    setError("");
    try {
      await api("/auth/platform-admin/verify", { body: { challenge: challenge.challenge, code: value } });
      window.location.replace("/super-admin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the code.");
      setDigits(Array(6).fill(""));
      inputs.current[0]?.focus();
      setVerifying(false);
    }
  }

  function setDigit(index: number, value: string) {
    const v = value.replace(/\D/g, "");
    if (v.length > 1) return fill(v);
    const next = [...digits];
    next[index] = v;
    setDigits(next);
    if (v && index < 5) inputs.current[index + 1]?.focus();
    if (next.every(Boolean)) void verify(next.join(""));
  }
  function fill(value: string) {
    const v = value.replace(/\D/g, "").slice(0, 6).split("");
    const next = Array(6).fill("").map((_, i) => v[i] ?? "");
    setDigits(next);
    inputs.current[Math.min(v.length, 5)]?.focus();
    if (v.length === 6) void verify(v.join(""));
  }
  function onKey(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus();
  }

  return (
    <>
      <button type="button" onClick={onBack} className="mb-7 inline-flex items-center gap-2 text-base font-medium text-slate-700 hover:text-slate-950"><ArrowLeft className="h-5 w-5" />Back</button>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Step 2 of 2</p>
      <h2 className="mt-3 text-[28px] font-bold leading-tight tracking-tight text-slate-900">Enter your verification code</h2>
      <p className="mt-3 text-base text-slate-600">{challenge.delivery === "email" ? "We've sent a 6-digit code to" : "Your 6-digit code is for"}</p>
      <p className="mt-3 inline-flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 text-base font-semibold text-slate-900"><Mail className="h-5 w-5 text-teal-800" />{challenge.emailHint}</p>
      {challenge.delivery !== "email" && <DevCodeNotice challenge={challenge} />}
      <form onSubmit={(e) => { e.preventDefault(); void verify(); }} className="mt-7">
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        <div className="flex justify-between gap-2.5" onPaste={(e: ClipboardEvent) => { e.preventDefault(); fill(e.clipboardData.getData("text")); }}>
          {digits.map((d, i) => (
            <input key={i} ref={(el) => { inputs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={6}
              aria-label={`Digit ${i + 1}`} disabled={verifying || secondsLeft === 0}
              onChange={(e) => setDigit(i, e.target.value)} onKeyDown={(e) => onKey(i, e)} onFocus={(e) => e.target.select()}
              className={cx("h-16 w-full min-w-0 rounded-xl border-2 bg-white text-center text-2xl font-semibold tabular-nums text-slate-900 caret-teal-700 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/15 disabled:bg-slate-50", error ? "border-red-300" : "border-slate-200")} />
          ))}
        </div>
        <p className={cx("mt-3 text-center text-sm", secondsLeft < 60 ? "text-red-600" : "text-slate-500")}>
          {secondsLeft > 0 ? `Code expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "This code has expired. Request a new one."}
        </p>
        <PrimaryButton className="mt-7" loading={verifying} disabled={code.length !== 6 || secondsLeft === 0}>Verify &amp; open Control Center</PrimaryButton>
      </form>
      <p className="mt-6 text-center text-base text-slate-500">
        Didn&apos;t get it?{" "}
        <button type="button" className="font-semibold text-teal-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline" disabled={resendIn > 0 || resending} onClick={onResend}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : resending ? "Sending…" : "Send a new code"}
        </button>
      </p>
    </>
  );
}

function ForgotPassword({ initialEmail, onDone, onCancel }: { initialEmail: string; onDone: (message: string) => void; onCancel: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const checks = [
    { ok: password.length >= 12, label: "12+ characters" },
    { ok: /[a-z]/.test(password) && /[A-Z]/.test(password), label: "Upper & lower case" },
    { ok: /[0-9]/.test(password), label: "A number" },
    { ok: /[^A-Za-z0-9]/.test(password), label: "A symbol (e.g. @ # !)" },
    { ok: password.length > 0 && password === confirm, label: "Passwords match" },
  ];

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      setChallenge(await api<Challenge>("/auth/platform-admin/forgot-password", { body: { email: email.trim().toLowerCase() } }));
      setCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the code.");
    } finally {
      setLoading(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (!challenge || !checks.every((c) => c.ok)) return;
    setLoading(true);
    setError("");
    try {
      await api("/auth/platform-admin/reset-password", { body: { challenge: challenge.challenge, code: code.trim(), password } });
      onDone("Password changed. Sign in with your new password.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset the password.");
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={onCancel} className="mb-7 inline-flex items-center gap-2 text-base font-medium text-slate-700 hover:text-slate-950"><ArrowLeft className="h-5 w-5" />Back to sign in</button>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Reset password</p>
      <h2 className="mt-3 text-[28px] font-bold leading-tight tracking-tight text-slate-900">{challenge ? "Choose a new password" : "Forgot your password?"}</h2>
      {!challenge ? (
        <>
          <p className="mt-2 text-sm leading-6 text-slate-600">Enter your super admin email. We will email you a 6-digit code to set a new password.</p>
          <form onSubmit={sendCode} className="mt-7 space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field label="Admin email" required>
              <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="gm@indianbarcode.com" />
            </Field>
            <PrimaryButton loading={loading}>Email me a reset code</PrimaryButton>
          </form>
        </>
      ) : (
        <>
          {challenge.delivery === "email" ? (
            <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-slate-600"><MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />If <strong className="text-slate-900">{challenge.emailHint}</strong> is a super admin account, a 6-digit code is on its way. It expires in 10 minutes.</p>
          ) : (
            <DevCodeNotice challenge={challenge} />
          )}
          <form onSubmit={reset} className="mt-6 space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field label="6-digit code" required>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="font-semibold tracking-[0.4em]" />
            </Field>
            <Field label="New password" required><PasswordInput autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Confirm new password" required><PasswordInput autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {checks.map((c) => <li key={c.label} className={cx("flex items-center gap-1.5", c.ok ? "text-emerald-700" : "text-slate-400")}><CheckCircle2 className="h-3.5 w-3.5" />{c.label}</li>)}
            </ul>
            <PrimaryButton loading={loading} disabled={code.length !== 6 || !checks.every((c) => c.ok)}>Set new password</PrimaryButton>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">Didn&apos;t get it? <button type="button" className="font-medium text-brand-700 hover:underline" disabled={loading} onClick={() => sendCode()}>Send a new code</button></p>
        </>
      )}
    </>
  );
}

/** Development server only: the code could not be emailed, so say why and where to find it. */
function DevCodeNotice({ challenge }: { challenge: Challenge }) {
  const [copied, setCopied] = useState(false);
  const failed = challenge.delivery === "email_failed";
  return (
    <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm leading-6 text-amber-900 sm:p-5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-400 text-white"><Info className="h-4 w-4" strokeWidth={2.5} /></span>
      <div className="min-w-0">
      <p className="font-semibold text-amber-950">{failed ? "The code could not be emailed" : "Email is not set up on this development server"}</p>
      <p className="mt-1 text-[13px]">
        {failed
          ? "The mail server refused to send it, usually because the SMTP password in the .env file is wrong."
          : "No SMTP or Resend email settings were found in the .env file."}{" "}
        Your code for <strong>{challenge.emailHint}</strong> is shown in the API terminal window{challenge.devCodeFile ? " and saved in this file:" : "."}
      </p>
      {challenge.devCodeFile && (
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md bg-white/80 px-2 py-1 text-xs">{challenge.devCodeFile}</code>
          <button type="button" className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium hover:bg-amber-100"
            onClick={() => { void navigator.clipboard?.writeText(challenge.devCodeFile!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            {copied ? "Copied" : "Copy path"}
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-amber-800">
        To get codes by email, {failed ? "fix SMTP_PASS (for Gmail, a 16-character app password)" : "add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to .env"}, restart the API and run <code className="rounded bg-white/70 px-1">pnpm email:check</code>. This fallback is disabled in production.
      </p>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, tone, title, text }: { icon: LucideIcon; tone: string; title: string; text: string }) {
  return (
    <li className="flex items-center gap-5">
      <span className={cx("grid h-16 w-16 shrink-0 place-items-center rounded-full ring-1 backdrop-blur", tone)}><Icon className="h-7 w-7" /></span>
      <span>
        <span className="block text-lg font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-base text-slate-300">{text}</span>
      </span>
    </li>
  );
}

function PrimaryButton({ children, loading, disabled, className }: { children: React.ReactNode; loading?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button type="submit" disabled={disabled || loading}
      className={cx("relative flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-teal-800 via-teal-700 to-teal-600 px-6 text-base font-semibold text-white shadow-[0_12px_30px_-12px_rgba(15,118,110,0.7)] transition hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none", className)}>
      {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <>{children}<ArrowRight className="absolute right-6 h-5 w-5" /></>}
    </button>
  );
}
