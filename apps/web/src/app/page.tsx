import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingHome } from "@/components/marketing/MarketingPages";

export const metadata: Metadata = {
  title: "DryCare | Dry Cleaning & Laundry Management Software for Windows",
  description: "Run customers, garment orders, billing, payments and reports with DryCare, a Windows desktop software for dry-cleaning and laundry businesses.",
};

export default function Home() {
  return <MarketingShell><MarketingHome /></MarketingShell>;
}
