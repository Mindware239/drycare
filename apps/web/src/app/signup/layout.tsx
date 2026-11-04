import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Set up your store · Drycare" },
  icons: { icon: "/site/favicon.png" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
