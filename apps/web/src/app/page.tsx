import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingHome } from "@/components/marketing/MarketingPages";

export const metadata: Metadata = {
  title: { absolute: "Drycare | Dry Cleaning & Laundry Store Management Software" },
  description: "Book orders, tag every garment, manage pickups and deliveries, and collect payments, all in one software built for dry cleaners and laundries.",
  icons: { icon: "/site/favicon.png" },
};

export default function Home() {
  return <MarketingShell><MarketingHome /></MarketingShell>;
}
