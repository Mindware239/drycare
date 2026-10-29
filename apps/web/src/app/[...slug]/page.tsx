import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { GenericPage } from "@/components/marketing/MarketingPages";
import { publicPaths } from "@/components/marketing/publicPaths";

export function generateStaticParams() {
  return publicPaths.map((slug) => ({ slug: slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const path = slug.join("/");
  if (!publicPaths.includes(path)) return {};
  const title = path
    .split("/")
    .pop()
    ?.split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return { title: `${title} | DryCare`, description: `DryCare ${title?.toLowerCase()} for dry-cleaning and laundry business operations.` };
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
