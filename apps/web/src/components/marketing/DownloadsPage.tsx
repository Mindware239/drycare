"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Monitor, Smartphone } from "lucide-react";
import { PageHero } from "./parts";

type App = { version: string; sizeBytes: number | null; sha256: string | null; url: string };
type Downloads = { trialDays: number; windows: (App & { signed: boolean }) | null; android: App | null };
const size = (bytes: number | null) => (bytes ? `${Math.round(bytes / 1048576)} MB` : "");

export function DownloadsPage({ title, description }: { title: string; description: string }) {
  const [data, setData] = useState<Downloads | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void fetch("/api/v1/commercial/downloads").then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed")))).then(setData).catch(() => setFailed(true)); }, []);
  return (
    <>
      <PageHero title={title} description={description} />
      {failed && <p role="alert" style={{ textAlign: "center", color: "#9a3a12" }}>Could not load the downloads. Please refresh the page.</p>}
      {!data && !failed && <p role="status" style={{ textAlign: "center", color: "#6b6963" }}>Loading…</p>}
      {data && (
        <>
          <section className="dc-sec" style={{ paddingTop: 16, gap: 24 }}>
            <div className="dc-g-2">
              <Card icon={<Monitor aria-hidden="true" size={26} />} name="Drycare for Windows" app={data.windows} button="Download for Windows" points={["7-day free trial starts when you install it", "Runs on your PC, and keeps working without internet", "64-bit Windows PC, with disk space for your database and backups", "After the trial, you need a license key for this PC"]} note={data.windows && !data.windows.signed ? "Windows may warn about an unknown publisher. Choose More info, then Run anyway." : undefined} />
              <Card icon={<Smartphone aria-hidden="true" size={26} />} name="Drycare for Android" app={data.android} button="Download for Android" points={[`${data.trialDays}-day free trial when you create an account`, "Uses the same account and data as the website", "Needs an internet connection", "Choose your plan under Plan & billing in the app"]} note={data.android ? "This app is downloaded from here, not from Google Play. Your phone will ask you to allow the install." : undefined} />
            </div>
          </section>
          <section className="dc-sec" style={{ paddingTop: 16, gap: 24 }}>
            <div className="dc-head" style={{ maxWidth: 680 }}>
              <h2 className="dc-h2">From Trial to Subscription</h2>
              <p className="dc-body">Try Drycare first. When you are ready, choose a plan and pay online, by UPI or by bank transfer.</p>
            </div>
            <div className="dc-row"><Link href="/pricing" className="dc-btn dc-btn-green">See Plans →</Link><Link href="/signup" className="dc-btn dc-btn-line">Start Free Trial</Link></div>
          </section>
        </>
      )}
    </>
  );
}

function Card({ icon, name, app, button, points, note }: { icon: React.ReactNode; name: string; app: App | null; button: string; points: string[]; note?: string }) {
  return (
    <article className="dc-card-18 dc-hw-card" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ display: "grid", placeItems: "center", width: 48, height: 48, borderRadius: 14, background: "#dff3e4", color: "#1f6b34" }}>{icon}</span><h2 className="dc-t" style={{ margin: 0, fontSize: 24 }}>{name}</h2></div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {points.map((p) => <li key={p} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", gap: 10, fontSize: 15, lineHeight: 1.45, color: "#33332f" }}><span aria-hidden="true" className="dc-tick" style={{ width: 20, height: 20, fontSize: 11, marginTop: 1 }}>✓</span><span>{p}</span></li>)}
      </ul>
      {app ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 14, borderTop: "1px solid #eeece6" }}>
          <a href={app.url} className="dc-btn dc-btn-green" style={{ alignSelf: "stretch", justifyContent: "center" }}>{button}</a>
          <span style={{ fontSize: 13, color: "#6b6963" }}>{`Version ${app.version}${size(app.sizeBytes) ? ` · ${size(app.sizeBytes)}` : ""}`}</span>
          {note && <span style={{ fontSize: 13, lineHeight: 1.45, color: "#4f4e4a" }}>{note}</span>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 14, borderTop: "1px solid #eeece6" }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Coming soon</p>
          <Link href="/contact" className="dc-btn dc-btn-outline" style={{ alignSelf: "stretch", justifyContent: "center" }}>Ask Us for Early Access</Link>
        </div>
      )}
    </article>
  );
}
