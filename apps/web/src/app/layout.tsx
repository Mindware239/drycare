import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import { I18nRoot } from "@/components/I18nRoot";
import { BOOT_SCRIPT } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://drycare.in"),
  title: { default: "Drycare", template: "%s · Drycare" },
  description: "Drycare — Windows software for dry-cleaning and laundry store management.",
  openGraph: {
    type: "website",
    siteName: "Drycare",
    locale: "en_IN",
  },
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: "Drycare", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f6b34" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} /></head>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
        <PwaRegister />
        <I18nRoot />
      </body>
    </html>
  );
}
