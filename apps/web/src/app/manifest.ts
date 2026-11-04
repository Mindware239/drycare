import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Lets staff install Drycare on Android phones and tablets as a full-screen app (needs HTTPS, e.g. the cloud address). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Drycare — Dry cleaning & laundry",
    short_name: "Drycare",
    description: "Orders, garment tracking, billing and deliveries for dry-cleaning and laundry shops.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f7f5",
    theme_color: "#1f6b34",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New order", url: "/pos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Scan garment", url: "/scan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My deliveries", url: "/driver", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
