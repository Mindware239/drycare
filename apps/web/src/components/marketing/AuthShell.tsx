"use client";

import Link from "next/link";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { SiteBrand } from "./MarketingShell";
import "./site.css";

/** Page frame from the design's Sign in page, shared by every account page. */
export function AuthShell({ children, maxWidth = 460, showWebsiteLinks = true }: { children: ReactNode; maxWidth?: number; showWebsiteLinks?: boolean }) {
  return (
    <div className="dc-site dc-authbg">
      <main className="dc-authmain">
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <SiteBrand />
          {showWebsiteLinks && <Link href="/" style={{ textDecoration: "none", fontSize: 15, fontWeight: 500, color: "#151514", display: "inline-flex", alignItems: "center", minHeight: 44 }}>← Back to website</Link>}
        </header>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 0" }}>
          <div className="dc-authcard" style={{ maxWidth }}>{children}</div>
        </div>
        <footer style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, fontSize: 14, color: "#6b6963" }}>
          <span>© {new Date().getFullYear()} Drycare</span>
          {showWebsiteLinks && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              <Link href="/faq" className="dc-legal">Help &amp; FAQ</Link>
              <Link href="/legal/privacy" className="dc-legal">Privacy Policy</Link>
              <Link href="/legal/terms" className="dc-legal">Terms</Link>
            </div>
          )}
        </footer>
      </main>
    </div>
  );
}

export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h1 className="dc-auth-h1">{title}</h1>
      {children && <p className="dc-auth-sub">{children}</p>}
    </div>
  );
}

export function AuthNotice({ tone = "good", children }: { tone?: "good" | "bad"; children: ReactNode }) {
  return <div role={tone === "bad" ? "alert" : "status"} className={`dc-notice${tone === "bad" ? " dc-notice-bad" : ""}`}><span aria-hidden="true" style={{ fontWeight: 700 }}>{tone === "bad" ? "!" : "✓"}</span><span>{children}</span></div>;
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input {...props} type={show ? "text" : "password"} className={`dc-input dc-input-lg ${props.className ?? ""}`} style={{ paddingRight: 84 }} />
      <button type="button" className="dc-showpw" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
    </span>
  );
}

export function PasswordChecks({ checks }: { checks: { ok: boolean; label: string }[] }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 14 }}>
      {checks.map((c) => <li key={c.label} style={{ display: "flex", alignItems: "center", gap: 6, color: c.ok ? "#1f6b34" : "#8a8780" }}><span aria-hidden="true" className="dc-tick" style={{ width: 18, height: 18, fontSize: 10, background: c.ok ? "#dff3e4" : "#f3f1ec", color: c.ok ? "#1f6b34" : "#8a8780" }}>✓</span>{c.label}</li>)}
    </ul>
  );
}
