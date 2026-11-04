import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Sign in · Drycare" },
  icons: { icon: "/site/favicon.png" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
