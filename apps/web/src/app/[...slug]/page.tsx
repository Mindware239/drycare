import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { GenericPage } from "@/components/marketing/MarketingPages";
import { publicPaths } from "@/components/marketing/publicPaths";

const designTitles: Record<string, string> = {
  features: "Features · Drycare Laundry & Dry Cleaning Software",
  about: "About Us · Drycare",
  pricing: "Pricing · Drycare Laundry & Dry Cleaning Software",
  hardware: "Hardware & Accessories · Drycare",
  partners: "Become a Partner · Drycare",
  faq: "FAQ · Drycare Laundry & Dry Cleaning Software",
};

export function generateStaticParams() {
  return publicPaths.map((slug) => ({ slug: slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const path = slug.join("/");
  if (!publicPaths.includes(path)) return {};
  const name = path
    .split("/")
    .pop()
    ?.split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  const title = designTitles[path] ?? `${name} · Drycare`;
  return { title: { absolute: title }, description: `Drycare ${name?.toLowerCase()} for dry-cleaning and laundry business operations.`, icons: { icon: "/site/favicon.png" } };
}

export default async function MarketingPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = slug.join("/");
  if (!publicPaths.includes(path)) notFound();

  return (
    <MarketingShell>
      <GenericPage slug={path} />
    </MarketingShell>
  );
}
