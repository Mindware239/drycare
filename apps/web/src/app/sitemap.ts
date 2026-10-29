import type { MetadataRoute } from "next";
import { publicPaths } from "@/components/marketing/publicPaths";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://drycare.in", changeFrequency: "weekly", priority: 1 },
    ...publicPaths
      .filter((path) => !path.startsWith("account/") && path !== "trial")
      .map((path) => ({ url: `https://drycare.in/${path}`, changeFrequency: "monthly" as const, priority: path === "pricing" ? 0.9 : 0.7 })),
  ];
}
