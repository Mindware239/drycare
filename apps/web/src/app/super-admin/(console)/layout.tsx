"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BadgeIndianRupee,
  Building2,
  ChartColumnBig,
  Clock3,
  CreditCard,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Repeat,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Button, cx } from "@/components/ui";
import { Logo } from "@/components/Brand";
import { AdminContext, type AdminUser } from "./admin-ui";

const NAV: { section: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
  { section: "Overview", items: [{ href: "/super-admin", label: "Dashboard", icon: LayoutDashboard }] },
  {
    section: "Customers",
    items: [
      { href: "/super-admin/customers", label: "Customers & businesses", icon: Building2 },
      { href: "/super-admin/trials", label: "Free trials", icon: Clock3 },
      { href: "/super-admin/leads", label: "Website enquiries", icon: Inbox },
    ],
  },
  {
    section: "Billing",
    items: [
      { href: "/super-admin/plans", label: "Plans & pricing", icon: Store },
      { href: "/super-admin/subscriptions", label: "Subscriptions & renewals", icon: Repeat },
      { href: "/super-admin/payments", label: "Payments & UPI / bank", icon: CreditCard },
      { href: "/super-admin/invoices", label: "Tax invoices", icon: Receipt },
      { href: "/super-admin/revenue", label: "Revenue & reports", icon: ChartColumnBig },
    ],
  },
  {
    section: "Software",
    items: [{ href: "/super-admin/licenses", label: "Licenses & releases", icon: KeyRound }],
  },
  {
    section: "Administration",
    items: [
      { href: "/super-admin/audit-logs", label: "Audit log", icon: Activity },
      { href: "/super-admin/staff", label: "Admins & security", icon: ShieldCheck },
      { href: "/super-admin/settings", label: "Settings & payment gateways", icon: Settings },
    ],
  },
];

export default function SuperAdminConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    api<{ isPlatformAdmin: boolean; user: AdminUser }>("/auth/session")
      .then((session) => {
        if (!session.isPlatformAdmin) return setState("denied");
        setUser(session.user);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) return router.replace("/super-admin/login");
        setError(cause instanceof Error ? cause.message : "Could not open the control center.");
        setState("error");
      });
  }, [router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  async function logout() {
    await api("/auth/logout", { body: {} }).catch(() => undefined);
    window.location.assign("/super-admin/login");
  }

  if (state === "loading") {
    return <div className="flex min-h-screen items-center justify-center gap-3 bg-slate-50 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" />Opening DryCare Control Center…</div>;
  }
  if (state === "denied") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Super admin access required</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">You are signed in with a store account. Shop owners and staff cannot open the DryCare Control Center.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => router.push("/dashboard")}>Back to my store</Button>
            <Button onClick={logout}>Sign in as super admin</Button>
          </div>
        </div>
      </main>
    );
  }
  if (state === "error" || !user) {
    return <main className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error || "Could not open the control center."}</div></main>;
  }

  const isActive = (href: string) => (href === "/super-admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const current = NAV.flatMap((g) => g.items).find((item) => isActive(item.href));

  const nav = (
    <nav aria-label="Control center" className="flex h-full flex-col bg-slate-950 text-slate-300">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
        <Logo className="h-8 w-8" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-white">DryCare Control Center</p>
          <p className="text-[11px] text-slate-400">Mindware · Software owner</p>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group.section}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                    className={cx("relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                      active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100")}>
                    <item.icon aria-hidden="true" className={cx("h-[17px] w-[17px] shrink-0", active ? "text-brand-300" : "text-slate-500")} strokeWidth={1.9} />
                    <span className="truncate">{item.label}</span>
                    {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-brand-400" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-white/5 p-2">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
        </div>
        <button type="button" onClick={logout} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white">
          <LogOut aria-hidden="true" className="h-4 w-4" />Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <AdminContext.Provider value={user}>
      <div className="min-h-screen bg-slate-50 lg:pl-64">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{nav}</aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
            <div className="relative h-full w-72 max-w-[85vw] shadow-2xl">{nav}</div>
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-slate-400 sm:inline">Control Center</span>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="truncate font-medium text-slate-800">{current?.label ?? "Details"}</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 sm:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" />Verified session
            </span>
            <a href="/" target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 md:inline-flex">
              <BadgeIndianRupee className="h-4 w-4" />Public website
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
