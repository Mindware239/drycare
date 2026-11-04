"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { siteContact } from "./siteConfig";
import "./site.css";

const nav = [["Home", "/"], ["Features", "/features"], ["About Us", "/about"], ["Pricing", "/pricing"], ["FAQ", "/faq"]];

const solutions = [["Order Booking & Billing", "booking"], ["Garment Tagging", "tagging"], ["Order Status Tracking", "status"], ["Pickup & Delivery", "delivery"], ["Customers & Memberships", "customers"], ["Payments & Dues", "payments"], ["Multi-Store & Plant", "plant"], ["Reports", "reports"]];
const builtFor = ["Dry Cleaners", "Laundry Stores", "Laundry Chains & Franchises"];
const services = [["Implementation & Installation", "services"], ["Customization", "services"], ["Software Development", "services"], ["Data Migration", "services"], ["AMC & Technical Support", "services"], ["Hardware Integration", "hardware"]];

export function SiteBrand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="dc-brand" aria-label="Drycare home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/site/logo.png" alt="" width={48} height={28} />
      <span>Drycare</span>
    </Link>
  );
}

/** The design's eased scroll to a section, 84px below the sticky header. */
function glideTo(el: Element, offset = 84) {
  const start = window.scrollY;
  const dist = el.getBoundingClientRect().top - offset;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { window.scrollTo(0, start + dist); return; }
  const dur = Math.min(1100, Math.max(500, Math.abs(dist) * 0.35));
  const t0 = performance.now();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, start + dist * ease(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function MarketingShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!link || link.dataset.noglide !== undefined) return;
      const url = new URL(link.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      const target = document.getElementById(url.hash.slice(1));
      if (!target) return;
      event.preventDefault();
      setOpen(false);
      glideTo(target);
      history.replaceState(history.state, "", url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);
  const company: [string, string][] = [["About Us", "/about"], ["Pricing", "/pricing"], ...(pathname === "/features" ? [["Features", "/features"] as [string, string]] : []), ["Why Drycare", "/#why"], ["FAQs", "/faq"], ["Book a Demo", "/#demo"], ["Contact Us", "/contact"]];

  return (
    <div className="dc-site" id="top">
      <header className="dc-header">
        <div className="dc-header-in">
          <SiteBrand />
          <nav aria-label="Main" className="dc-nav">
            {nav.map(([label, href]) => <Link key={href} href={href} aria-current={current(href)}>{label}</Link>)}
          </nav>
          <div className="dc-actions">
            <Link href="/login" className="dc-signin">Sign in</Link>
            <Link href="/#demo" className="dc-btn dc-btn-demo">Book a Demo</Link>
          </div>
          <div className="dc-mob-actions">
            <Link href="/#demo" className="dc-btn dc-btn-demo">Book a Demo</Link>
            <button type="button" className="dc-menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "✕" : "☰"}</button>
          </div>
        </div>
        <nav aria-label="Mobile" className={`dc-mob-nav${open ? " dc-open" : ""}`}>
          {nav.map(([label, href]) => <Link key={href} href={href} aria-current={current(href)} onClick={() => setOpen(false)}>{label}</Link>)}
          <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>
        </nav>
      </header>

      <main className="dc-fade">{children}</main>

      <footer className="dc-footer">
        <div className="dc-footer-in">
          <div className="dc-foot-grid">
            <div className="dc-foot-brand">
              <SiteBrand />
              <span style={{ fontSize: 14, lineHeight: 1.6, color: "#4f4e4a" }}>Software for dry cleaning and laundry businesses.</span>
              {(siteContact.phone || siteContact.email || siteContact.address) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
                  {siteContact.phone && <a href={`tel:${siteContact.phone.replace(/\s/g, "")}`} className="dc-brand" style={{ fontWeight: 400 }}>{siteContact.phone}</a>}
                  {siteContact.email && <a href={`mailto:${siteContact.email}`} className="dc-brand" style={{ fontWeight: 400 }}>{siteContact.email}</a>}
                  {siteContact.address && <span style={{ color: "#4f4e4a" }}>{siteContact.address}</span>}
                </div>
              )}
            </div>
            <div className="dc-foot-col">
              <span className="dc-foot-title">Software Solutions</span>
              {solutions.map(([label, id]) => <Link key={id} className="dc-footlink" href={`/features#${id}`}>{label}</Link>)}
            </div>
            <div className="dc-foot-col">
              <span className="dc-foot-title">Built For</span>
              {builtFor.map((label) => <Link key={label} className="dc-footlink" href="/#industries">{label}</Link>)}
            </div>
            <div className="dc-foot-col">
              <span className="dc-foot-title">Services</span>
              {services.map(([label, id]) => <Link key={label} className="dc-footlink" href={`/#${id}`}>{label}</Link>)}
            </div>
            <div className="dc-foot-col">
              <span className="dc-foot-title">Company</span>
              {company.map(([label, href]) => <Link key={label} className="dc-footlink" href={href} aria-current={current(href)}>{label}</Link>)}
            </div>
          </div>
          <div className="dc-foot-bottom">
            <span>© {new Date().getFullYear()} Drycare. All rights reserved.</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              <Link href="/legal/privacy" className="dc-legal">Privacy Policy</Link>
              <Link href="/legal/terms" className="dc-legal">Terms of Service</Link>
              <Link href="/legal/refund-policy" className="dc-legal">Refund Policy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
