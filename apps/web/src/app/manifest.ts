import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Lets staff install DryCare on Android phones and tablets as a full-screen app (needs HTTPS, e.g. the cloud address). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DryCare — Dry cleaning & laundry",
    short_name: "DryCare",
    description: "Orders, garment tracking, billing and deliveries for dry-cleaning and laundry shops.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f7f8",
    theme_color: "#0f6a5d",
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
