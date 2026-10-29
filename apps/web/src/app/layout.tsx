import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://drycare.in"),
  title: { default: "DryCare", template: "%s · DryCare" },
  description: "DryCare — Windows software for dry-cleaning and laundry store management.",
  openGraph: {
    type: "website",
    siteName: "DryCare",
    locale: "en_IN",
  },
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: "DryCare", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f6a5d" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
