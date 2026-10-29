"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Wordmark } from "@/components/Brand";

const links = [
  ["Features", "/features"],
  ["How it works", "/how-it-works"],
  ["Pricing", "/pricing"],
  ["Customer stories", "/reviews"],
  ["Resources", "/resources"],
];

export function MarketingShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="bg-slate-950 px-4 py-2.5 text-center text-xs font-medium text-slate-200 sm:text-sm">
        Built for daily shop operations <span className="mx-2 text-brand-300">•</span> Windows desktop + secure cloud account <span className="mx-2 hidden text-brand-300 sm:inline">•</span><Link className="hidden font-semibold text-white underline decoration-brand-400 underline-offset-4 sm:inline" href="/demo">Book a free demo</Link>
      </div>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link href="/" aria-label="DryCare home"><Wordmark /></Link>
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary navigation">
            {links.map(([label, href]) => (
              <Link key={href} href={href} className={`text-sm font-medium ${pathname === href ? "text-brand-700" : "text-slate-600 hover:text-slate-950"}`}>{label}</Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <Link href="/login" className="text-sm font-semibold text-slate-700">Sign in</Link>
            <Link href="/signup" className="rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(15,106,93,.22)] transition hover:-translate-y-0.5 hover:bg-brand-800">Start free trial</Link>
          </div>
          <button type="button" className="rounded-md p-2 text-slate-700 lg:hidden" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-menu" className="border-t border-slate-100 px-5 py-4 lg:hidden" aria-label="Mobile navigation">
            <div className="grid gap-1">
              {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">{label}</Link>)}
              <Link href="/login" onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-sm font-medium text-slate-700">Sign in</Link>
              <Link href="/signup" onClick={() => setOpen(false)} className="mt-2 rounded-md bg-brand-700 px-4 py-3 text-center text-sm font-semibold text-white">Start free trial</Link>
            </div>
          </nav>
        )}
      </header>
      <main>{children}</main>
      <footer className="relative overflow-hidden border-t border-slate-800 bg-slate-950 text-slate-300">
        <div className="pointer-events-none absolute -right-40 -top-40 h-96 w-96 rounded-full bg-brand-600/10 blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-2 lg:grid-cols-5 lg:px-8">
          <div className="lg:col-span-2">
            <Wordmark dark />
            <p className="mt-5 max-w-sm text-sm leading-6 text-slate-400">Windows software for dry-cleaning and laundry operations, from customer intake and garment tracking to billing and business reports.</p>
            <p className="mt-5 text-xs text-slate-500">Built for India · Currency: INR</p>
          </div>
          <FooterLinks title="Product" links={[["Features", "/features"], ["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Download", "/download"]]} />
          <FooterLinks title="Company" links={[["About", "/about"], ["Customer stories", "/reviews"], ["Contact", "/contact"], ["Demo", "/demo"]]} />
          <FooterLinks title="Legal" links={[["Privacy", "/legal/privacy"], ["Terms", "/legal/terms"], ["Refund policy", "/legal/refund-policy"], ["Cancellation", "/legal/cancellation-policy"]]} />
        </div>
        <div className="border-t border-slate-800 px-5 py-5 text-center text-xs text-slate-500">© {new Date().getFullYear()} DryCare. All rights reserved.</div>
      </footer>
    </div>
  );
}

function FooterLinks({ title, links }: { title: string; links: string[][] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <ul className="mt-4 space-y-3">
        {links.map(([label, href]) => <li key={href}><Link href={href} className="text-sm text-slate-400 hover:text-white">{label}</Link></li>)}
      </ul>
    </div>
  );
}
