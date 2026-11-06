"use client";

import { appLocale } from "@/lib/format";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AuthNotice, AuthShell } from "@/components/marketing/AuthShell";
import { copyText } from "@/lib/clipboard";

type LicenseStatus = {
  required: boolean;
  active: boolean;
  requestCode: string | null;
  plan: string | null;
  expiresAt: string | null;
  error: "not_activated" | "invalid" | "expired" | "demo_ended" | "suspended" | "revoked" | "deactivated" | "sync_required" | "clock" | "tampered" | null;
  readOnly?: boolean;
  demo: { startedAt: string; endsAt: string; daysLeft: number; ended: boolean } | null;
};

const steps = [
  "Choose a plan and pay Drycare by UPI or bank transfer.",
  "Send this PC's request code (below) with your payment reference to Drycare.",
  "Paste the activation key you receive. It works offline.",
];

const STOPPED: Record<string, string> = {
  suspended: "This license has been suspended. Please contact Drycare support.",
  revoked: "This license has been cancelled. Please contact Drycare support.",
  deactivated: "This PC has been removed from the license. Please contact Drycare support.",
  sync_required: "This PC has been offline too long. Connect it to the internet and restart Drycare to carry on working.",
  clock: "This PC's date is earlier than when Drycare last ran. Correct the date and restart Drycare.",
  tampered: "This PC's license record has been changed. Connect it to the internet and restart Drycare, or contact Drycare support.",
};

export default function ActivatePage() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<LicenseStatus>("/system/license/status")
      .then(async (license) => {
        setStatus(license);
        if (!license.required) {
          window.location.replace("/login");
          return;
        }
        // During the demo the owner can open this page from "Upgrade" to activate early.
        if (license.active && !(license.demo && new URLSearchParams(window.location.search).has("upgrade"))) {
          const info = await api<{ setupRequired: boolean }>("/system/info");
          window.location.replace(info.setupRequired ? "/signup" : "/login");
        }
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      await api<LicenseStatus>("/system/license/activate", { body: { key } });
      const info = await api<{ setupRequired: boolean }>("/system/info");
      window.location.replace(info.setupRequired ? "/signup" : "/login");
    } catch (e) {
      setError((e as ApiError).message);
      setLoading(false);
    }
  }

  async function copyRequestCode() {
    if (!status?.requestCode) return;
    try {
      await copyText(status.requestCode);
      setNotice("This PC's activation request code was copied.");
    } catch {
      setNotice("Select and copy the activation request code above.");
    }
  }

  const expiryLabel = status?.expiresAt
    ? new Intl.DateTimeFormat(appLocale(), { dateStyle: "long", timeZone: "UTC" }).format(new Date(status.expiresAt))
    : null;

  const title = status?.error === "expired" ? "Renew your Drycare license" : status?.error === "demo_ended" ? "Your 7-day demo has ended" : status?.demo ? "Upgrade to the full version" : "Activate this PC";

  return (
    <AuthShell maxWidth={560} showWebsiteLinks={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="dc-eyebrow">Drycare for PC · License activation</span>
        <h1 className="dc-auth-h1">{title}</h1>
      </div>

      {status && STOPPED[status.error ?? ""] && (
        <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, background: "#fdf3e1", color: "#6e4b0b", fontSize: 14, lineHeight: 1.5 }}>
          {STOPPED[status.error ?? ""]}{" "}Your data is safe.
          {status.readOnly && <>{" "}<a href="/login" style={{ fontWeight: 600, textDecoration: "underline" }}>Open your records (read-only)</a></>}
        </div>
      )}
      {status?.error === "expired" && status.readOnly && (
        <p style={{ marginBottom: 16, fontSize: 14 }}><a href="/login" style={{ fontWeight: 600, textDecoration: "underline" }}>Open your records (read-only)</a></p>
      )}
      {status?.error === "demo_ended" && (
        <div style={{ borderRadius: 12, padding: "14px 16px", background: "#fdeedd", color: "#5c3209", fontSize: 15, lineHeight: 1.5 }}>
          Thank you for trying Drycare. <strong>Upgrade to keep using it</strong>: everything you entered during the demo (customers, orders, garments, payments) is kept and will be there as soon as you activate.
        </div>
      )}
      {status?.demo && !status.demo.ended && (
        <div style={{ borderRadius: 12, padding: "14px 16px", background: "#dff3e4", color: "#174f27", fontSize: 15, lineHeight: 1.5 }}>
          Your demo has <strong>{status.demo.daysLeft} day{status.demo.daysLeft === 1 ? "" : "s"}</strong> left. Activate now and your data carries on without interruption. <a href="/dashboard" style={{ fontWeight: 600, color: "#151514", textDecoration: "underline", textUnderlineOffset: 4 }}>Back to Drycare</a>
        </div>
      )}
      {status?.plan && status.error === "expired" && (
        <div style={{ borderRadius: 12, padding: "14px 16px", background: "#fdeedd", color: "#5c3209", fontSize: 15, lineHeight: 1.5 }}>
          The {status.plan} license{expiryLabel ? ` expired on ${expiryLabel}` : ""}. Enter a renewed key to continue.
        </div>
      )}

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((step, i) => (
          <li key={step} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)", gap: 12, alignItems: "start", fontSize: 15, lineHeight: 1.5, color: "#33332f" }}>
            <span className="dc-num" style={{ width: 32, height: 32, borderRadius: 10, fontSize: 13 }}>{i + 1}</span>
            <span style={{ paddingTop: 4 }}>{step}</span>
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, borderRadius: 14, padding: 18, background: "#f7f7f5" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>This PC&apos;s activation request code</span>
        {status?.requestCode ? (
          <>
            <input className="dc-input" aria-label="Activation request code" readOnly value={status.requestCode} style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 14 }} />
            <button type="button" onClick={copyRequestCode} className="dc-btn dc-btn-outline">Copy request code</button>
          </>
        ) : (
          <span className="dc-small">Checking this PC&apos;s license information…</span>
        )}
        <span style={{ fontSize: 13, lineHeight: 1.5, color: "#6b6963" }}>For a license covering multiple PCs, provide each PC&apos;s request code before the keys are issued. Keep the codes with your payment reference.</span>
      </div>

      <form onSubmit={activate} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {error && <AuthNotice tone="bad">{error}</AuthNotice>}
        {notice && <AuthNotice>{notice}</AuthNotice>}
        <label className="dc-label-lg">Activation key
          <textarea className="dc-input" aria-label="Activation key" required value={key} onChange={(e) => setKey(e.target.value)} rows={4} placeholder="Paste the complete key you received from Drycare" style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13, borderRadius: 12, resize: "vertical" }} />
        </label>
        <button type="submit" disabled={loading || !status?.required} className="dc-btn-block">{loading ? "Activating…" : "Activate Drycare"}</button>
      </form>

      <p style={{ margin: 0, paddingTop: 20, borderTop: "1px solid #eeece6", fontSize: 13, lineHeight: 1.55, color: "#6b6963" }}>This license is verified offline and is tied to the request code(s) it was issued for. When a license expires, Drycare stops normal use until a renewal key is entered. Your local database and backups are not deleted.</p>
    </AuthShell>
  );
}
