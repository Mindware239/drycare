"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, MailCheck, Store, Tags } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { SiteBrand } from "@/components/marketing/MarketingShell";
import { AuthNotice } from "@/components/marketing/AuthShell";
import "@/components/marketing/site.css";

type TrialStatus = { status: string; trialStartsAt: string | null; trialEndsAt: string | null; daysRemaining: number | null; expired: boolean; emailVerified: boolean };
type Session = { user: { name: string; email: string }; organization: { name: string } };
type License = { plan: string | null; demo: { endsAt: string; daysLeft: number; ended: boolean } | null };

const CATALOGUE_KEY = "drycare.onboarding.catalogueReviewed";
const included = ["Orders, garment tags and production board", "Billing with GST, payments and receipts", "Pickups, deliveries and customer wallet"];
const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date(iso));

function StepTag({ tone, children }: { tone: "done" | "next" | "optional"; children: React.ReactNode }) {
  const colours = tone === "done" ? { background: "#dff3e4", color: "#1f6b34" } : tone === "next" ? { background: "#d8e7fa", color: "#2a4f86" } : { background: "#f3f1ec", color: "#4f4e4a" };
  return <span style={{ ...colours, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999 }}>{children}</span>;
}

export default function OnboardingPage() {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [catalogueReviewed, setCatalogueReviewed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<TrialStatus>("/auth/trial-status").then(setTrial).catch((e: ApiError) => setError(e.message));
    api<Session>("/auth/session").then(setSession).catch(() => {});
    api<{ edition: string }>("/system/info").then(async (info) => {
      if (info.edition !== "desktop") return;
      setDesktop(true);
      // The PC edition's trial is its 7-day demo, which lives with the license rather than the account.
      setLicense(await api<License>("/system/license/status"));
    }).catch(() => {});
    try {
      setCatalogueReviewed(localStorage.getItem(CATALOGUE_KEY) === "1");
    } catch {}
  }, []);

  const firstName = session?.user.name?.split(" ")[0];
  const emailVerified = trial?.emailVerified ?? false;
  const demo = desktop ? license?.demo ?? null : null;
  const daysLeft = desktop ? demo?.daysLeft ?? null : trial?.daysRemaining ?? null;
  const endsAt = desktop ? demo?.endsAt ?? null : trial?.trialEndsAt ?? null;
  const loaded = desktop ? license !== null : trial !== null;
  const onTrial = daysLeft !== null && endsAt !== null;

  const steps = [
    { icon: Store, title: "Create your store", text: "Business profile, first branch and a ready-made price list for 230+ garments.", done: true, action: "View settings", href: "/settings" },
    // On a PC the account stays on that PC, and the app is already installed.
    ...(desktop ? [] : [
      { icon: MailCheck, title: "Verify your email", text: emailVerified ? "Your email is verified. Password reset and order emails will reach you." : `We sent a link to ${session?.user.email ?? "your inbox"}. It keeps your account recoverable.`, done: emailVerified, action: "Verify email", href: "/verify-email" },
    ]),
    { icon: Tags, title: "Check your prices", text: "Starting prices are filled in for you. Adjust them to your shop's rates before the first order.", done: catalogueReviewed, action: catalogueReviewed ? "Review again" : "Review prices", href: "/catalogue", onClick: () => { try { localStorage.setItem(CATALOGUE_KEY, "1"); } catch {} } },
    ...(desktop ? [] : [
      { icon: Download, title: "Install on the counter PC", text: "The Windows app keeps working without internet and backs up your data automatically.", done: false, optional: true, action: "Download", href: "/download" },
    ]),
  ] as { icon: typeof Store; title: string; text: string; done: boolean; optional?: boolean; action: string; href: string; onClick?: () => void }[];
  const essentials = steps.filter((s) => !s.optional);
  const doneCount = essentials.filter((s) => s.done).length;
  const allDone = doneCount === essentials.length;
  const nextIndex = steps.findIndex((s) => !s.done && !s.optional);
  const percent = Math.round((doneCount / essentials.length) * 100);

  return (
    <div className="dc-site" style={{ background: "#f7f7f5" }}>
      <header className="dc-header">
        <div className="dc-header-in" style={{ justifyContent: "space-between" }}>
          <SiteBrand href="/dashboard" />
          {onTrial && <span style={{ fontSize: 14, fontWeight: 600, padding: "8px 14px", borderRadius: 999, background: "#dff3e4", color: "#1f6b34" }}>{daysLeft} {daysLeft === 1 ? "day" : "days"} left in your trial</span>}
        </div>
      </header>

      <main className="dc-fade dc-wrap dc-onboard">
        <section style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
          {error && <AuthNotice tone="bad">{error}</AuthNotice>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="dc-eyebrow">{firstName ? `Welcome, ${firstName}` : "Welcome to Drycare"}{session?.organization.name ? ` · ${session.organization.name}` : ""}</span>
            <h1 className="dc-h1" style={{ fontSize: "clamp(36px, 4.4vw, 52px)" }}>{allDone ? "Your store is ready." : "Let's get your store ready."}</h1>
            <p className="dc-lead" style={{ maxWidth: 560 }}>{allDone ? "Everything essential is set up. Take your first order whenever you are ready." : "A few quick steps so your first day at the counter goes smoothly. You can come back to this page any time."}</p>
          </div>

          <div style={{ maxWidth: 460, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 500, color: "#4f4e4a" }}>
              <span>{doneCount} of {essentials.length} essentials done</span><span>{percent}%</span>
            </div>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={essentials.length} aria-valuenow={doneCount} aria-label="Setup progress" style={{ height: 8, borderRadius: 4, background: "#e4e1d9", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${percent}%`, borderRadius: 4, background: "#3cbf5a", transition: "width .5s ease" }} />
            </div>
          </div>

          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {steps.map((s, i) => {
              const isNext = i === nextIndex;
              return (
                <li key={s.title} className="dc-card dc-onboard-step" style={{ padding: 20, boxShadow: isNext ? "0 0 0 5px #dff3e4" : "none" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, minWidth: 0, flex: 1 }}>
                    {s.done
                      ? <span className="dc-num" style={{ width: 44, height: 44, background: "#3cbf5a", color: "#151514", fontSize: 18, fontWeight: 700 }}>✓</span>
                      : <span className="dc-num" style={{ width: 44, height: 44 }}><s.icon style={{ width: 20, height: 20 }} /></span>}
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <h2 className="dc-t" style={{ margin: 0, fontSize: 19 }}>{s.title}</h2>
                        {s.done ? <StepTag tone="done">Done</StepTag> : isNext ? <StepTag tone="next">Next step</StepTag> : s.optional ? <StepTag tone="optional">Optional</StepTag> : null}
                      </div>
                      <p className="dc-small" style={{ margin: 0 }}>{s.text}</p>
                    </div>
                  </div>
                  {!(s.done && s.href === "/verify-email") && (
                    <Link href={s.href} onClick={s.onClick} className={`dc-btn ${isNext ? "dc-btn-demo" : "dc-btn-outline"}`} style={{ flex: "none", alignSelf: "center", whiteSpace: "nowrap", textAlign: "center" }}>{s.action}{isNext ? " →" : ""}</Link>
                  )}
                </li>
              );
            })}
          </ol>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, paddingTop: 24, borderTop: "1px solid #e4e1d9" }}>
            <Link href="/pos" className="dc-btn dc-btn-green" style={{ whiteSpace: "nowrap" }}>Take your first order →</Link>
            <Link href="/dashboard" className="dc-btn dc-btn-line" style={{ whiteSpace: "nowrap" }}>Go to dashboard</Link>
            <span style={{ fontSize: 14, color: "#6b6963" }}>You can reopen this checklist any time.</span>
          </div>
        </section>

        <aside className="dc-onboard-side">
          <div style={{ background: "#151514", color: "#faf8f4", borderRadius: 18, padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="dc-eyebrow" style={{ color: "#3cbf5a" }}>{onTrial ? "Free trial" : "Your plan"}</span>
              {onTrial ? (
                <>
                  <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: '"Urbanist", sans-serif', fontSize: 52, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1 }}>{daysLeft}</span>
                    <span style={{ fontSize: 15, color: "#cfccc4" }}>{daysLeft === 1 ? "day left" : "days left"}</span>
                  </p>
                  <span style={{ fontSize: 14, lineHeight: 1.5, color: "#cfccc4" }}>Every feature is open until {dateLabel(endsAt!)}.</span>
                </>
              ) : (
                <span className="dc-t" style={{ fontSize: 26 }}>{!loaded ? "Checking…" : license?.plan ?? "Active"}</span>
              )}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: "18px 0 0", borderTop: "1px solid #33332f", display: "flex", flexDirection: "column", gap: 12 }}>
              {included.map((item) => (
                <li key={item} style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", gap: 10, fontSize: 14, lineHeight: 1.45 }}>
                  <span aria-hidden="true" className="dc-tick" style={{ background: "#3cbf5a", color: "#151514" }}>✓</span><span>{item}</span>
                </li>
              ))}
            </ul>
            {desktop && (
              <Link href="/activate?upgrade=1" className="dc-btn dc-btn-ghost-sm" style={{ textAlign: "center" }}>Upgrade to the full version</Link>
            )}
          </div>
          <div className="dc-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, fontSize: 14, lineHeight: 1.5, color: "#4f4e4a" }}>
            <span>Your records are never deleted when a trial ends. Choose a plan any time to keep working.</span>
            {!desktop && <span>Need help setting up? <Link href="/contact" style={{ fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>Talk to our team</Link></span>}
          </div>
        </aside>
      </main>
    </div>
  );
}
