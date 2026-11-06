"use client";

import { useState } from "react";
import Link from "next/link";
import { AboutPage } from "./AboutPage";
import { FaqPage } from "./FaqPage";
import { FeaturesPage } from "./FeaturesPage";
import { HomePage, HowItWorks, Workflow } from "./HomePage";
import { DemoSection, EnquiryForm, FinalCta, PageHero } from "./parts";
import { PricingPage } from "./PricingPage";
import { HardwarePage } from "./HardwarePage";
import { DownloadsPage } from "./DownloadsPage";
import { PartnersPage } from "./PartnersPage";

export type MarketingPage = { title: string; description: string };

const pageCopy: Record<string, MarketingPage> = {
  "features/billing-and-pos": { title: "Billing and POS", description: "Create orders, calculate prices, issue GST invoices, record payments and keep an accurate outstanding balance." },
  "features/garment-tracking": { title: "Garment-level tracking", description: "Give every physical garment a durable identity and show its processing status from intake to collection." },
  "features/customer-management": { title: "Customer management", description: "Keep customer contacts, addresses, order history and garment history together with consent-aware communication." },
  "features/barcode-and-label-printing": { title: "Barcodes and garment tags", description: "Print Code-128 garment tags and reprint labels without changing the order or financial ledger." },
  "features/reports-and-analytics": { title: "Reports and analytics", description: "Review sales, collections, outstanding balances and operating activity through permission-aware reports." },
  "features/staff-management": { title: "Staff roles and permissions", description: "Use role-based access, branch restrictions and audited actions to keep team responsibilities clear." },
  "features/pickup-and-delivery": { title: "Pickup and delivery", description: "Schedule collections and deliveries, assign drivers and record completion with OTP or configured proof." },
  "how-it-works": { title: "How Drycare Works", description: "From first setup to daily customer handovers, the workflow follows the way a dry-cleaning shop operates." },
  demo: { title: "See Drycare in a Guided Demo", description: "Get a focused walkthrough of customer intake, garment processing, billing and reports for your store." },
  reviews: { title: "Customer Experiences", description: "We publish only genuine, approved feedback. No ratings or customer stories are invented." },
  customers: { title: "Built for Garment-Care Businesses", description: "Drycare supports independent shops, ironing businesses, premium garment care and multi-branch operations." },
  download: { title: "Download Drycare", description: "Get Drycare for Windows or Android. Start with a free trial, then choose a plan when you are ready." },
  resources: { title: "Drycare Resources", description: "Practical setup guides and product help for running garment-care operations." },
  contact: { title: "Talk to Drycare", description: "Send a sales or support enquiry and our team will get back to you." },
  trial: { title: "Start Your Drycare Trial", description: "Create an account and configure your business before activating the Windows application." },
  account: { title: "Your Drycare Account", description: "Sign in to view business, subscription and download information." },
  "account/subscription": { title: "Subscription", description: "Your plan and entitlement details appear after account and subscription services are connected." },
  "account/downloads": { title: "Downloads", description: "Access approved versions of the Drycare Windows installer and release information." },
  "account/billing": { title: "Billing and Invoices", description: "Purchase history and invoices will appear after the commercial billing service is configured." },
  "legal/privacy": { title: "Privacy Policy", description: "How Drycare accounts, business records and application data are handled." },
  "legal/terms": { title: "Terms of Service", description: "The terms governing use of the Drycare website and Windows application." },
  "legal/refund-policy": { title: "Refund Policy", description: "Refund eligibility is defined before checkout and is not assumed here." },
  "legal/cancellation-policy": { title: "Cancellation Policy", description: "How an active plan can be cancelled and what happens to access and data." },
};

const featureDetails: Record<string, { title: string; text: string }[]> = {
  "features/billing-and-pos": [{ title: "Order and invoice workflow", text: "Create one order with multiple garments and services, calculate server-authorized prices and generate GST snapshots." }, { title: "Payment visibility", text: "Record manual cash, UPI, card, bank and wallet entries, deposits and partial collections without editing posted payment amounts." }],
  "features/garment-tracking": [{ title: "Unique physical garment records", text: "Each piece receives one durable tag and tracked workflow status through received, processing, QC, rework, ready and handover." }, { title: "Operational history", text: "Stage changes record actor, time and branch context so the shop can review exceptions and garment history." }],
  "features/customer-management": [{ title: "Customer 360", text: "Maintain contacts, GSTIN, addresses, order history and garment history in an organization-scoped customer profile." }, { title: "Safe communication", text: "Operational channels and marketing consent are distinct, and role permissions control access to financial details." }],
  "features/barcode-and-label-printing": [{ title: "Code-128 garment tags", text: "Generate a stable tenant-wide tag for each physical garment and print or reprint a label for compatible hardware." }, { title: "Verify before purchase", text: "Printer support depends on the exact model and Windows driver. Hardware compatibility is confirmed with support before rollout." }],
  "features/reports-and-analytics": [{ title: "Permission-aware reporting", text: "Review sales, receivables ageing, order operations and branch performance according to the signed-in user's role." }, { title: "Practical exports", text: "Dashboards and CSV exports support counter review and owner reporting without claiming unsupported analytics integrations." }],
  "features/staff-management": [{ title: "Roles and permissions", text: "Use named roles and granular permissions for actions such as pricing overrides, refunds and financial views." }, { title: "Branch boundaries", text: "Staff can be restricted to assigned branches; server authorization remains independent from sidebar visibility." }],
  "features/pickup-and-delivery": [{ title: "Collection and delivery", text: "Schedule work, assign active delivery drivers, dispatch with exact tag scanning and complete or reschedule attempts." }, { title: "Handover evidence", text: "OTP and configured recipient-name proof are supported. GPS, live tracking and photo capture are not represented as present." }],
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function MarketingHome() {
  return <HomePage />;
}

function NumberedCards({ items, columns = 3 }: { items: { title: string; text: string; href?: string; cta?: string }[]; columns?: 2 | 3 }) {
  return (
    <section className="dc-sec" style={{ paddingTop: 16 }}>
      <div className={columns === 2 ? "dc-g-2" : "dc-g-3"}>
        {items.map((item, i) => {
          const body = (
            <>
              <span className="dc-num">{pad2(i + 1)}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="dc-t" style={{ fontSize: 20 }}>{item.title}</span>
                <span className="dc-small">{item.text}</span>
              </div>
              {item.cta && <span style={{ fontSize: 14, fontWeight: 500, marginTop: "auto" }}>{item.cta} →</span>}
            </>
          );
          const style = { padding: 24, display: "flex", flexDirection: "column", gap: 18, textDecoration: "none", color: "#151514" } as const;
          return item.href
            ? <Link key={item.title} href={item.href} className="dc-card dc-hover-card" style={style}>{body}</Link>
            : <div key={item.title} className="dc-card" style={style}>{body}</div>;
        })}
      </div>
    </section>
  );
}

function ContactPage({ page }: { page: MarketingPage }) {
  const options = ["Talk to sales", "Product support", "Not sure yet — help me choose"];
  const [interest, setInterest] = useState(options[0]);
  return (
    <>
      <PageHero title={page.title} description={page.description} />
      <section id="enquiry" style={{ padding: "0 16px 96px" }}>
        <div className="dc-cta-split">
          <div className="dc-side" style={{ gap: 20 }}>
            <h2 className="dc-h2-cta">We&apos;ll help you choose the right setup</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#cfccc4", textWrap: "pretty" }}>Share a few details about your shop. Your enquiry is stored securely for follow-up. Please do not send passwords or payment details.</p>
            <div className="dc-row" style={{ paddingTop: 4 }}><Link href="/#demo" className="dc-btn dc-btn-ghost">Request a Demo</Link></div>
          </div>
          <div className="dc-form-panel"><EnquiryForm interest={interest} onInterest={setInterest} interestOptions={options} /></div>
        </div>
      </section>
    </>
  );
}

function DownloadPage({ page }: { page: MarketingPage }) {
  return <DownloadsPage title={page.title} description={page.description} />;
}

function LegalPage({ page }: { page: MarketingPage }) {
  const heading = { margin: "32px 0 0", fontFamily: '"Urbanist", sans-serif', fontWeight: 600, fontSize: 24 } as const;
  return (
    <>
      <PageHero title={page.title} description={page.description} />
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "16px 32px 96px" }}>
        <p className="dc-body">This page is a notice of the required commercial policy. Final legal language must be reviewed and approved for the company, Indian law, data-processing practices and published refund terms.</p>
        <h2 style={heading}>Scope</h2>
        <p className="dc-body" style={{ marginTop: 10 }}>Drycare is a Windows desktop application for dry-cleaning and laundry business operations. Account, website and desktop licensing terms may differ and must be disclosed consistently.</p>
        <h2 style={heading}>Contact</h2>
        <p className="dc-body" style={{ marginTop: 10 }}>Use the <Link href="/contact" style={{ color: "#2a4f86", textDecoration: "underline", textUnderlineOffset: 4 }}>contact page</Link> to request the applicable policy details.</p>
      </section>
    </>
  );
}

export function GenericPage({ slug }: { slug: string }) {
  if (slug === "features") return <FeaturesPage />;
  if (slug === "about") return <AboutPage />;
  if (slug === "pricing") return <PricingPage />;
  if (slug === "hardware") return <HardwarePage />;
  if (slug === "partners") return <PartnersPage />;
  if (slug === "faq") return <FaqPage />;

  const page = pageCopy[slug] ?? { title: "Drycare", description: "Explore Drycare for dry-cleaning and laundry operations." };
  const hero = <PageHero title={page.title} description={page.description} />;

  if (slug === "contact") return <ContactPage page={page} />;
  if (slug === "demo") return <>{hero}<DemoSection /></>;
  if (slug === "download") return <DownloadPage page={page} />;
  if (slug.startsWith("legal/")) return <LegalPage page={page} />;
  if (slug === "how-it-works") return <>{hero}<Workflow /><HowItWorks /><FinalCta /></>;
  if (slug.startsWith("features/")) return <>{hero}<NumberedCards columns={2} items={featureDetails[slug]} /><FinalCta title="See This Working for Your Business" /></>;
  if (slug === "resources") {
    return <>{hero}<NumberedCards columns={2} items={[
      { title: "Start a Drycare store", text: "Business profile, first branch and starter catalogue", href: "/signup", cta: "Open guide" },
      { title: "Plan the counter setup", text: "Windows PC, printer and network checklist", href: "/download", cta: "Open guide" },
      { title: "Train the team", text: "Roles, permissions and branch boundaries", href: "/features/staff-management", cta: "Open guide" },
      { title: "Understand garment tracking", text: "Tags, production stages and quality control", href: "/features/garment-tracking", cta: "Open guide" },
    ]} /><FinalCta /></>;
  }
  if (slug === "reviews") {
    return <>{hero}<NumberedCards columns={2} items={[
      { title: "Evidence before endorsements", text: "No customer claim is shown until it is genuine and approved for publication. This avoids the misleading reviews that make software selection difficult." },
      { title: "Share how Drycare changed your shop", text: "Using Drycare already? Tell us about your experience.", href: "/contact", cta: "Submit a review" },
    ]} /><FinalCta /></>;
  }
  if (slug === "customers") {
    return <>{hero}<NumberedCards items={[
      { title: "For independent shops", text: "Use one branch, one counter and simple operational controls without a heavy setup process." },
      { title: "For premium care", text: "Track garment-level care instructions and use QC and approval holds before production." },
      { title: "For growing operations", text: "Separate branches and permissions while keeping the same core order-to-delivery workflow." },
    ]} /><FinalCta /></>;
  }
  if (slug === "trial") {
    return <>{hero}<NumberedCards items={[
      { title: "Create account", text: "Provision your business", href: "/signup", cta: "Continue" },
      { title: "View setup", text: "Understand the onboarding flow", href: "/how-it-works", cta: "Continue" },
      { title: "Need a demo", text: "See Drycare before setup", href: "/#demo", cta: "Continue" },
    ]} /></>;
  }
  // account pages
  return <>{hero}<NumberedCards items={[
    { title: "Sign in", text: "Open your secure account", href: "/login", cta: "Continue" },
    { title: "View plans", text: "Understand available plans", href: "/pricing", cta: "Continue" },
    { title: "Request help", text: "Ask about account or licensing", href: "/contact", cta: "Continue" },
  ]} /></>;
}
