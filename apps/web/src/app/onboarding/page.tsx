"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, Download, LifeBuoy, MailCheck, ShieldCheck, ShoppingBag, Store, Tags } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, cx } from "@/components/ui";
import { Wordmark } from "@/components/Brand";

type TrialStatus = { status: string; trialStartsAt: string | null; trialEndsAt: string | null; daysRemaining: number | null; expired: boolean; emailVerified: boolean };
type Session = { user: { name: string; email: string }; organization: { name: string } };

const CATALOGUE_KEY = "drycare.onboarding.catalogueReviewed";

export default function OnboardingPage() {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [catalogueReviewed, setCatalogueReviewed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<TrialStatus>("/auth/trial-status").then(setTrial).catch((e: ApiError) => setError(e.message));
    api<Session>("/auth/session").then(setSession).catch(() => {});
    try {
      setCatalogueReviewed(localStorage.getItem(CATALOGUE_KEY) === "1");
    } catch {}
  }, []);

  const expiry = trial?.trialEndsAt ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(trial.trialEndsAt)) : null;
  const firstName = session?.user.name?.split(" ")[0];
  const emailVerified = trial?.emailVerified ?? false;

  const steps = [
    { icon: Store, title: "Create your store", text: "Business profile, first branch and a ready-made price list for 230+ garments.", done: true, action: "View settings", href: "/settings" },
    { icon: MailCheck, title: "Verify your email", text: emailVerified ? "Your email is verified. Password reset and order emails will reach you." : `We sent a link to ${session?.user.email ?? "your inbox"}. It keeps your account recoverable.`, done: emailVerified, action: "Verify email", href: "/verify-email" },
    { icon: Tags, title: "Check your prices", text: "Starting prices are filled in for you. Adjust them to your shop's rates before the first order.", done: catalogueReviewed, action: "Review prices", href: "/catalogue", onClick: () => { try { localStorage.setItem(CATALOGUE_KEY, "1"); } catch {} } },
    { icon: Download, title: "Install on the counter PC", text: "The Windows app keeps working without internet and backs up your data automatically.", done: false, optional: true, action: "Download", href: "/download" },
  ];
  const essentials = steps.filter((s) => !s.optional);
  const doneCount = essentials.filter((s) => s.done).length;
  const allDone = doneCount === essentials.length;
  const nextIndex = steps.findIndex((s) => !s.done && !s.optional);

  return (
    <main className="min-h-screen bg-[#f4f7f6]">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" aria-label="DryCare home"><Wordmark /></Link>
          {trial && !trial.expired && trial.daysRemaining !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
              <CalendarClock className="h-3.5 w-3.5" />{trial.daysRemaining} {trial.daysRemaining === 1 ? "day" : "days"} left in your trial
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-5 py-10 sm:px-8 md:py-14 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          {error && <div className="mb-5"><Alert>{error}</Alert></div>}
          <p className="text-sm font-medium text-brand-700">{firstName ? `Welcome, ${firstName}` : "Welcome to DryCare"}{session?.organization.name ? ` · ${session.organization.name}` : ""}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{allDone ? "Your store is ready." : "Let's get your store ready."}</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-6 text-slate-600">{allDone ? "Everything essential is set up. Take your first order whenever you are ready." : "A few quick steps so your first day at the counter goes smoothly. You can come back to this page any time."}</p>

          <div className="mt-6 max-w-md">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>{doneCount} of {essentials.length} essentials done</span>
              <span className="tabular-nums">{Math.round((doneCount / essentials.length) * 100)}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={essentials.length} aria-valuenow={doneCount} aria-label="Setup progress">
              <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${(doneCount / essentials.length) * 100}%` }} />
            </div>
          </div>

          <ol className="mt-8 space-y-3">
            {steps.map((s, i) => {
              const isNext = i === nextIndex;
              return (
                <li key={s.title} className={cx("flex flex-col gap-4 rounded-2xl border bg-white p-5 sm:flex-row sm:items-center", isNext ? "border-brand-300 shadow-[0_8px_30px_rgba(15,106,93,.08)] ring-1 ring-brand-200" : "border-slate-200")}>
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", s.done ? "bg-brand-600 text-white" : isNext ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "bg-slate-100 text-slate-500")}>
                      {s.done ? <Check className="h-5 w-5" strokeWidth={2.5} /> : <s.icon className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[15px] font-semibold text-slate-900">{s.title}</h2>
                        {s.done ? <StepTag tone="done">Done</StepTag> : isNext ? <StepTag tone="next">Next step</StepTag> : s.optional ? <StepTag tone="optional">Optional</StepTag> : null}
                      </div>
                      <p className="mt-1 text-sm leading-5 text-slate-500">{s.text}</p>
                    </div>
                  </div>
                  {!(s.done && s.href === "/verify-email") && (
                    <Link href={s.href} onClick={s.onClick} className="shrink-0 sm:ml-2">
                      <Button size="sm" variant={isNext ? "primary" : "secondary"} className="w-full sm:w-auto">
                        {s.done ? (s.href === "/catalogue" ? "Review again" : s.action) : s.action}{isNext && <ArrowRight className="h-4 w-4" />}
                      </Button>
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center">
            <Link href="/pos"><Button size="lg" className="w-full sm:w-auto"><ShoppingBag className="h-4 w-4" />Take your first order</Button></Link>
            <Link href="/dashboard"><Button size="lg" variant="secondary" className="w-full sm:w-auto">Go to dashboard</Button></Link>
            <span className="text-xs text-slate-500 sm:ml-2">Unfinished steps stay on your dashboard checklist.</span>
          </div>
        </section>

        <aside className="h-fit space-y-4 lg:sticky lg:top-8">
          <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
            <div className="bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-100">Free trial</p>
              <p className="mt-2 flex items-baseline gap-2"><span className="text-4xl font-bold tabular-nums">{trial?.daysRemaining ?? "—"}</span><span className="text-sm text-brand-100">{trial?.daysRemaining === 1 ? "day left" : "days left"}</span></p>
              <p className="mt-1 text-sm text-brand-50/90">{expiry ? `Every feature is open until ${expiry}.` : "Loading your trial…"}</p>
            </div>
            <ul className="space-y-3 p-6 text-sm text-slate-600">
              {["Orders, garment tags and production board", "Billing with GST, payments and receipts", "Pickups, deliveries and customer wallet"].map((t) => (
                <li key={t} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <p className="flex gap-2.5 text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />Your records are never deleted when a trial ends. Choose a plan any time to keep working.</p>
            <p className="flex gap-2.5 text-slate-600"><LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>Need help setting up? <Link href="/contact" className="font-medium text-brand-700 hover:underline">Talk to our team</Link></span></p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function StepTag({ tone, children }: { tone: "done" | "next" | "optional"; children: React.ReactNode }) {
  return (
    <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone === "done" ? "bg-emerald-50 text-emerald-700" : tone === "next" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600")}>{children}</span>
  );
}
