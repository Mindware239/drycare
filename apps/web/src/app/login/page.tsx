"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Cloud, FileText, LoaderCircle, Mail, ReceiptText, ShieldCheck, Store, Truck, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { landingPath } from "@/lib/landing";
import { Alert } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { AuthBadge, AuthTile, BrandName, IconInput, SecretInput } from "@/components/AuthUi";

type SystemInfo = { allowSignup: boolean; setupRequired: boolean; edition: string; version: string; license?: { required: boolean; active: boolean } };

function SignInButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading}
      className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-teal-700 via-teal-700 to-emerald-600 text-lg font-semibold text-white shadow-[0_14px_34px_-10px_rgba(15,118,110,0.6)] transition hover:brightness-110 disabled:opacity-60">
      {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : children}
      <span className="absolute inset-y-0 right-0 flex w-14 items-center justify-center bg-black/10"><ArrowRight className="h-5 w-5" /></span>
    </button>
  );
}

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
    <form onSubmit={submit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {desktop && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-3.5 py-2.5 text-xs leading-relaxed text-teal-900">
          This PC uses its own local store account. Sign in with the email and password entered during this PC&apos;s first store setup; web, cloud, and other computers&apos; accounts are separate.
        </div>
      )}
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-800">Email address</span>
        <IconInput icon={Mail} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email address" autoFocus />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-800">Password</span>
        <SecretInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-[18px] w-[18px] rounded accent-teal-700" />
          Keep me signed in
        </label>
        {desktop ? (
          <Link href="/desktop-recovery" className="text-sm font-semibold text-teal-700 hover:underline">Forgot your password?</Link>
        ) : (
          <button type="button" onClick={onForgot} className="text-sm font-semibold text-teal-700 hover:underline">Forgot your password?</button>
        )}
      </div>
      <SignInButton loading={loading}>Sign in</SignInButton>
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
    <div>
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Back to sign in</button>
      <h2 className="text-[28px] font-bold tracking-tight text-slate-900">Reset your password</h2>
      <p className="mt-2 text-[15px] leading-6 text-slate-500">Enter the email you sign in with. We&apos;ll email you a link to choose a new password.</p>
      {sent ? (
        <div className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{sent}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-5">
          {error && <Alert>{error}</Alert>}
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Email address</span>
            <IconInput icon={Mail} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email address" />
          </label>
          <SignInButton loading={loading}>Email me a reset link</SignInButton>
        </form>
      )}
    </div>
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
    <main className="min-h-screen bg-[#f2f8f8] lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(520px,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[#06262c] text-white lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start">
        {/* Store photo on the right, fading into the dark panel behind the text */}
        <div className="absolute inset-y-0 right-0 w-[48%] bg-cover bg-center 2xl:w-[50%]" style={{ backgroundImage: "url(/images/login-hero.jpg)" }} aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#06262c_0%,#06262c_56%,rgba(6,38,44,0.75)_68%,rgba(6,38,44,0.15)_86%,rgba(6,38,44,0)_100%)] 2xl:bg-[linear-gradient(90deg,#06262c_0%,#06262c_40%,rgba(6,38,44,0.82)_50%,rgba(6,38,44,0.2)_66%,rgba(6,38,44,0)_80%)]" aria-hidden="true" />
        <div className="absolute -left-32 top-10 h-[30rem] w-[30rem] rounded-full bg-teal-500/15 blur-3xl" aria-hidden="true" />

        <div className="relative flex h-full flex-col justify-between p-10 2xl:p-14 [@media(max-height:820px)]:py-7">
          <div>
            <Link href="/" className="flex w-fit items-center gap-3.5"><Logo className="h-14 w-14 rounded-2xl" /><BrandName className="text-[32px] text-white" /></Link>
            <p className="mt-5 inline-flex rounded-full border border-white/25 bg-white/5 px-4 py-1.5 text-sm text-slate-100">Dry Cleaning &amp; Laundry Management</p>
          </div>

          <div className="max-w-[440px] py-6 2xl:max-w-[480px]">
            <h1 className="text-[40px] font-bold leading-[1.1] tracking-tight 2xl:text-5xl [@media(max-height:820px)]:text-[34px]">
              <span className="block">Every garment,</span>
              <span className="block">every rupee,</span>
              <span className="block bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">accounted for.</span>
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-200">Customer records, barcode-tagged garments, cleaning stages, quality checks, billing and delivery — all in one system for your dry cleaning business.</p>
            <div className="mt-7 grid grid-cols-2 gap-3.5 [@media(max-height:820px)]:mt-5">
              <AuthTile icon={FileText} title="Orders" text="Barcode tracked" />
              <AuthTile icon={ReceiptText} title="Billing" text="GST ready" />
              <AuthTile icon={Users} title="Customers" text="Complete history" />
              <AuthTile icon={Truck} title="Delivery" text="Handover proof" />
            </div>
          </div>

          <div className="max-w-[480px] border-t border-white/15 pt-6">
            <div className="flex items-center gap-5 text-sm text-slate-200">
              <AuthBadge icon={ShieldCheck} lines={["Secure", "& reliable"]} />
              <span className="h-9 w-px bg-white/15" />
              <AuthBadge icon={Cloud} lines={["Local-first", "Windows app"]} />
              <span className="h-9 w-px bg-white/15" />
              <AuthBadge icon={Users} lines={["Role-based", "team access"]} />
            </div>
          </div>
        </div>
      </aside>

      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-8 sm:px-8">
        <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-teal-100/80 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-cyan-100/80 blur-2xl" aria-hidden="true" />

        <div className="relative w-full max-w-[560px] rounded-3xl border border-white bg-white px-6 py-9 shadow-[0_30px_80px_-30px_rgba(6,38,44,0.25)] sm:px-12 sm:py-11">
          <div className="flex flex-col items-center text-center">
            <Link href="/" className="flex items-center gap-3"><Logo className="h-12 w-12 rounded-xl" /><BrandName className="text-[30px] text-slate-900" /></Link>
            <p className="mt-2 text-sm text-slate-500">{desktop ? "Store sign in on this PC" : "Store Administrator Login"}</p>
          </div>

          <div className="mt-8">
            {mode === "forgot" ? (
              <ForgotPassword onBack={() => setMode("signin")} />
            ) : (
              <>
                <div className="mb-7 text-center">
                  <h2 className="text-[28px] font-bold tracking-tight text-slate-900">Sign in to your account</h2>
                  <p className="mt-1.5 text-[15px] text-slate-500">Use the account your store administrator created for you.</p>
                </div>
                <Suspense>
                  <LoginForm desktop={desktop} onForgot={() => setMode("forgot")} />
                </Suspense>
              </>
            )}

            {info?.allowSignup && mode === "signin" && (
              <>
                <div className="my-6 flex items-center gap-4 text-sm text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
                <Link href="/signup" className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3.5 transition hover:border-teal-200 hover:bg-teal-50/60">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700"><Store className="h-5 w-5" /></span>
                  <span className="flex-1 text-sm leading-5 text-slate-700">New business?<span className="block font-medium text-slate-900">Set up DryCare for your store</span></span>
                  <ArrowRight className="h-5 w-5 text-teal-700" />
                </Link>
              </>
            )}
            {desktop && !info?.setupRequired && (
              <p className="mt-6 text-center text-xs leading-5 text-slate-500">
                If you don&apos;t know the first setup account, contact the person who set up this PC&apos;s store. Reinstalling does not create a new account or remove saved store data.
              </p>
            )}
          </div>
        </div>
        {info && <p className="relative mt-6 text-center text-sm text-slate-500">DryCare {desktop ? "for PC" : "Cloud"} · v{info.version}</p>}
      </section>
    </main>
  );
}
