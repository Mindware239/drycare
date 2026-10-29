"use client";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bike,
  Boxes,
  ShieldAlert,
  Bell,
  ChartColumn,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Factory,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScanLine,
  Search,
  Settings,
  Shirt,
  Sun,
  Moon,
  Store,
  Truck,
  TriangleAlert,
  WashingMachine,
  CirclePlus,
  SlidersHorizontal,
  ShieldCheck,
  ShoppingBag,
  Tags,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@drycare/shared";
import { api } from "@/lib/api";
import { SessionProvider, useSession, type Session } from "@/lib/session";
import { Spinner, cx } from "@/components/ui";
import { Logo, Wordmark } from "@/components/Brand";
import { PlanBanner } from "@/components/PlanBanner";
import { SyncStatus } from "@/components/SyncStatus";

type NavGroupId = "store" | "garments" | "laundry" | "logistics" | "finance" | "engagement" | "admin";

const NAV_GROUPS: { id: NavGroupId; label: string; icon: LucideIcon }[] = [
  { id: "store", label: "Store management", icon: Store },
  { id: "garments", label: "Garment operations", icon: Shirt },
  { id: "laundry", label: "Self-service laundry", icon: WashingMachine },
  { id: "logistics", label: "Logistics", icon: Truck },
  { id: "finance", label: "Finance & business", icon: Wallet },
  { id: "engagement", label: "Customer engagement", icon: Mail },
  { id: "admin", label: "Administration", icon: Settings },
];

const NAV: { href: string; label: string; icon: LucideIcon; perm?: Permission; group: NavGroupId }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "reports.view", group: "store" },
  { href: "/pos", label: "New order", icon: ShoppingBag, perm: "orders.create", group: "store" },
  { href: "/orders", label: "Orders", icon: ClipboardList, perm: "orders.read", group: "store" },
  { href: "/customers", label: "Customers", icon: Users, perm: "customers.read", group: "store" },
  { href: "/production", label: "Production board", icon: Factory, perm: "orders.read", group: "garments" },
  { href: "/scan", label: "Scan station", icon: ScanLine, perm: "garments.process", group: "garments" },
  { href: "/transfers", label: "Facility transfers", icon: Truck, perm: "orders.read", group: "garments" },
  { href: "/exceptions", label: "Garment exceptions", icon: TriangleAlert, perm: "orders.read", group: "garments" },
  { href: "/laundry", label: "Machines & live status", icon: WashingMachine, perm: "laundry.view", group: "laundry" },
  { href: "/laundry/new", label: "New self-service order", icon: CirclePlus, perm: "laundry.operate", group: "laundry" },
  { href: "/laundry/orders", label: "Self-service orders", icon: ClipboardList, perm: "laundry.view", group: "laundry" },
  { href: "/laundry/reports", label: "Laundry reports", icon: ChartColumn, perm: "laundry.view", group: "laundry" },
  { href: "/laundry/settings", label: "Laundry setup & pricing", icon: SlidersHorizontal, perm: "laundry.manage", group: "laundry" },
  { href: "/deliveries", label: "Pickups & deliveries", icon: Truck, perm: "deliveries.manage", group: "logistics" },
  { href: "/driver", label: "My deliveries", icon: Bike, perm: "deliveries.drive", group: "logistics" },
  { href: "/cashier", label: "Cashier & shifts", icon: Wallet, perm: "payments.collect", group: "finance" },
  { href: "/expenses", label: "Expenses", icon: Receipt, perm: "expenses.manage", group: "finance" },
  { href: "/inventory", label: "Stock & purchasing", icon: Boxes, perm: "inventory.manage", group: "finance" },
  { href: "/reports", label: "Reports", icon: ChartColumn, perm: "reports.view", group: "finance" },
  { href: "/claims", label: "Claims & complaints", icon: ShieldAlert, perm: "complaints.manage", group: "engagement" },
  { href: "/campaigns", label: "Marketing campaigns", icon: Megaphone, perm: "org.manage", group: "engagement" },
  { href: "/catalogue", label: "Services & prices", icon: Tags, perm: "catalogue.manage", group: "admin" },
  { href: "/integrations", label: "Integrations & notifications", icon: Mail, perm: "org.manage", group: "admin" },
  { href: "/staff", label: "Staff & roles", icon: UserCog, perm: "staff.manage", group: "admin" },
  { href: "/settings", label: "Business settings", icon: Settings, perm: "branches.manage", group: "admin" },
  { href: "/billing", label: "Plan & billing", icon: CreditCard, perm: "org.manage", group: "admin" },
  { href: "/audit", label: "Audit & messages", icon: ShieldCheck, perm: "audit.view", group: "admin" },
];

const INITIAL_GROUPS: Record<NavGroupId, boolean> = {
  store: true,
  garments: true,
  laundry: true,
  logistics: true,
  finance: true,
  engagement: true,
  admin: true,
};

function Shell({ children }: { children: ReactNode }) {
  const { session, can, branchId, setBranchId } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState(INITIAL_GROUPS);
  const items = useMemo(
    () => NAV.filter((item) => (!item.perm || can(item.perm)) && (item.href !== "/campaigns" || session.role.key === "owner")),
    [can, session.role.key],
  );
  const visibleGroups = useMemo(
    () => NAV_GROUPS.map((group) => ({ ...group, items: items.filter((item) => item.group === group.id) })).filter((group) => group.items.length > 0),
    [items],
  );
  const currentItem = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const activeGroup = currentItem?.group;

  useEffect(() => setMobileNavOpen(false), [pathname]);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem("drycare.theme");
    } catch {}
    const selected = saved === "dark" ? "dark" : "light";
    setTheme(selected);
    document.documentElement.dataset.theme = selected;
  }, []);
  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem("drycare.sidebar.collapsed") === "true");
    } catch {}
  }, []);
  useEffect(() => {
    if (activeGroup) setOpenGroups((current) => current[activeGroup] ? current : { ...current, [activeGroup]: true });
  }, [activeGroup, pathname]);
  useEffect(() => {
    const here = NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (here?.perm && !can(here.perm) && items[0]) router.replace(items[0].href);
  }, [pathname, can, items, router]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (/^[A-Z0-9]+-\d{4}-\d+-\d+$/i.test(value)) router.push(`/scan?tag=${encodeURIComponent(value.toUpperCase())}`);
    else if (/^[A-Z0-9]+-\d{4}-\d+$/i.test(value) || !can("customers.read")) router.push(`/orders?q=${encodeURIComponent(value)}`);
    else router.push(`/customers?q=${encodeURIComponent(value)}`);
    setQuery("");
  }

  async function logout() {
    await api("/auth/logout", { body: {} }).catch(() => {});
    window.location.href = "/login";
  }

  function toggleTheme() {
    const selected = theme === "dark" ? "light" : "dark";
    setTheme(selected);
    document.documentElement.dataset.theme = selected;
    try {
      window.localStorage.setItem("drycare.theme", selected);
    } catch {}
  }

  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try {
      window.localStorage.setItem("drycare.sidebar.collapsed", String(collapsed));
    } catch {}
  }

  const activeHref = NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const compactNav = sidebarCollapsed && !mobileNavOpen;
  const nav = (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <div className={cx(
        "flex h-16 shrink-0 items-center border-b",
        compactNav ? "justify-center px-2" : "justify-between px-4",
        theme === "dark" ? "border-slate-800" : "border-slate-200",
      )}>
        {compactNav ? <Logo className="h-8 w-8" /> : <Wordmark dark={theme === "dark"} />}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cx("hidden h-9 w-9 items-center justify-center rounded-lg lg:inline-flex", theme === "dark" ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100")}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" className="h-4 w-4" /> : <PanelLeftClose aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
      <div className={cx("flex-1 overflow-y-auto py-3", compactNav ? "space-y-2 px-2" : "space-y-2 px-3")}>
        {visibleGroups.map((group) => {
          const expanded = openGroups[group.id];
          return (
            <section key={group.id} aria-label={group.label}>
              <button
                type="button"
                onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
                aria-expanded={compactNav ? undefined : expanded}
                aria-label={compactNav ? group.label : undefined}
                title={compactNav ? group.label : undefined}
                className={cx(
                  "flex min-h-9 w-full items-center rounded-md text-left text-[11px] font-semibold uppercase tracking-[0.08em]",
                  compactNav ? "justify-center px-1" : "gap-2 px-2",
                  theme === "dark" ? "text-slate-400 hover:bg-slate-800/70" : "text-slate-500 hover:bg-slate-50",
                )}
              >
                <group.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                {!compactNav && <><span className="flex-1">{group.label}</span><ChevronDown aria-hidden="true" className={cx("h-3.5 w-3.5 transition-transform", !expanded && "-rotate-90")} /></>}
              </button>
              {(expanded || compactNav) && (
                <div className={cx("space-y-0.5", compactNav ? "mt-1" : "mt-0.5")}>
                  {group.items.map((item) => {
                    // Highlight only the closest match, so /laundry/new does not also light up /laundry.
                    const active = item.href === activeHref;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        title={compactNav ? item.label : undefined}
                        className={cx(
                          "group relative flex min-h-10 items-center rounded-lg text-[13px] font-medium transition-colors",
                          compactNav ? "justify-center px-1" : "gap-2.5 px-2.5",
                          active
                            ? theme === "dark" ? "bg-brand-500/15 text-brand-100" : "bg-brand-50 text-brand-800"
                            : theme === "dark" ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                        )}
                      >
                        <item.icon aria-hidden="true" className={cx("h-[17px] w-[17px] shrink-0", active ? "text-brand-600" : theme === "dark" ? "text-slate-400 group-hover:text-slate-200" : "text-slate-500 group-hover:text-slate-700")} strokeWidth={1.9} />
                        {!compactNav && <span className="truncate">{item.label}</span>}
                        {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-brand-600" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className={cx("shrink-0 border-t", compactNav ? "p-2" : "p-3", theme === "dark" ? "border-slate-800" : "border-slate-200")}>
        <div title={compactNav ? `${session.user.name} · ${session.role.name}` : undefined} className={cx("mb-2 flex min-w-0 items-center rounded-lg", compactNav ? "justify-center p-1" : "gap-2.5 p-2", theme === "dark" ? "bg-slate-800/70" : "bg-slate-50")}>
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {session.user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          {!compactNav && <div className="min-w-0"><p className={cx("truncate text-sm font-medium", theme === "dark" ? "text-slate-100" : "text-slate-900")}>{session.user.name}</p><p className="truncate text-xs text-slate-500">{session.role.name}</p></div>}
        </div>
        <button type="button" onClick={logout} aria-label="Sign out" title={compactNav ? "Sign out" : undefined} className={cx("flex min-h-9 w-full items-center rounded-lg text-sm font-medium", compactNav ? "justify-center" : "gap-2 px-2.5", theme === "dark" ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100")}>
          <LogOut aria-hidden="true" className="h-4 w-4" />{!compactNav && "Sign out"}
        </button>
      </div>
    </nav>
  );

  const contentWidth = sidebarCollapsed ? "lg:pl-[4.25rem]" : "lg:pl-[16.25rem]";
  const activeBranch = session.branches.find((branch) => branch.id === branchId);
  const activeGroupLabel = NAV_GROUPS.find((group) => group.id === currentItem?.group)?.label;
  const showDashboardCrumb = can("reports.view") && currentItem?.href !== "/dashboard";
  const nestedSegments = currentItem
    ? pathname.split("/").filter(Boolean).slice(currentItem.href.split("/").filter(Boolean).length)
    : [];
  const nestedLabel = nestedSegments.length > 1 || nestedSegments[0] === "view"
    ? "Details"
    : nestedSegments[0]?.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  return (
    <div className={cx("min-h-screen transition-[padding] duration-200", contentWidth)}>
      <aside className={cx("no-print fixed inset-y-0 left-0 z-30 hidden border-r transition-[width] duration-200 lg:block", sidebarCollapsed ? "w-[4.25rem]" : "w-[16.25rem]", theme === "dark" ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white")}>{nav}</aside>
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/45" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation menu" />
          <aside className={cx("absolute inset-y-0 left-0 w-72 border-r", theme === "dark" ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white")}>
            <button type="button" onClick={() => setMobileNavOpen(false)} className={cx("absolute right-3 top-5 z-10 rounded-md p-1", theme === "dark" ? "text-slate-400" : "text-slate-600")} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {nav}
          </aside>
        </div>
      )}
      <header className={cx("no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 lg:px-6", theme === "dark" ? "border-slate-800 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900")}>
        <button type="button" className="rounded-md p-2 lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <Logo className="h-7 w-7" />
          <span className={cx("text-sm font-semibold", theme === "dark" ? "text-slate-100" : "text-slate-800")}>DryCare</span>
        </div>
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Logo className="h-7 w-7" />
          <span className={cx("text-sm font-semibold", theme === "dark" ? "text-slate-100" : "text-slate-800")}>DryCare</span>
        </div>
        {(can("orders.read") || can("customers.read")) && (
          <form onSubmit={search} role="search" className="relative min-w-0 max-w-xl flex-1 lg:ml-2">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customer, phone, order or garment tag"
              className={cx("h-9 w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20", theme === "dark" ? "border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400")}
              aria-label="Global search"
            />
          </form>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {session.branches.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className="hidden text-xs font-medium text-slate-500 xl:inline">Branch</span>
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={cx("h-9 max-w-[96px] rounded-md border px-2 text-sm sm:max-w-52", theme === "dark" ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-800")} aria-label="Active branch">
                {session.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
              </select>
            </label>
          ) : activeBranch && <span className={cx("hidden max-w-52 truncate text-sm sm:inline", theme === "dark" ? "text-slate-300" : "text-slate-600")}>{activeBranch.name}</span>}
          {session.organization.status === "trial" && <span className="hidden rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 md:inline">Trial</span>}
          <SyncStatus dark={theme === "dark"} canManage={can("org.manage")} />
          {can("audit.view") && (
            <Link href="/audit" aria-label="Open audit log and customer messages" title="Audit & messages" className={cx("hidden h-9 w-9 items-center justify-center rounded-md sm:inline-flex", theme === "dark" ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100")}>
              <Bell aria-hidden="true" className="h-[18px] w-[18px]" />
            </Link>
          )}
          <button type="button" onClick={toggleTheme} className={cx("inline-flex h-9 items-center justify-center gap-2 rounded-md border px-2.5 text-sm font-medium", theme === "dark" ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
            <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <details className="relative">
            <summary className={cx("flex h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500", theme === "dark" && "hover:bg-slate-800")} aria-label="Open user and session menu">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{session.user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
              <span className={cx("hidden max-w-36 truncate text-left text-sm font-medium md:block", theme === "dark" ? "text-slate-200" : "text-slate-700")}>{session.user.name}</span>
              <ChevronDown aria-hidden="true" className="hidden h-3.5 w-3.5 text-slate-400 md:block" />
            </summary>
            <div className={cx("absolute right-0 top-11 z-30 w-60 rounded-lg border p-2", theme === "dark" ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white")}>
              <div className="border-b border-slate-100 px-2 py-2">
                <p className={cx("truncate text-sm font-medium", theme === "dark" ? "text-slate-100" : "text-slate-900")}>{session.user.name}</p>
                <p className="truncate text-xs text-slate-500">{session.user.email}</p>
                <p className="mt-1 text-xs text-slate-500">{session.role.name} · {session.organization.name}</p>
              </div>
              <BusinessSwitcher dark={theme === "dark"} />
              <button type="button" onClick={logout} className={cx("mt-1 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-sm", theme === "dark" ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100")}><LogOut aria-hidden="true" className="h-4 w-4" />Sign out</button>
            </div>
          </details>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-5 lg:px-7 lg:py-6">
        <nav aria-label="Breadcrumb" className="mb-4 flex min-w-0 items-center gap-2 text-xs text-slate-500">
          {showDashboardCrumb && <><Link href="/dashboard" className="shrink-0 hover:text-brand-700">Dashboard</Link><span aria-hidden="true">/</span></>}
          {activeGroupLabel && currentItem && <><span className="hidden shrink-0 sm:inline">{activeGroupLabel}</span><span className="hidden sm:inline" aria-hidden="true">/</span><Link href={currentItem.href} aria-current={pathname === currentItem.href ? "page" : undefined} className="truncate font-medium text-slate-700 hover:text-brand-700">{currentItem.label}</Link></>}
          {currentItem && nestedLabel && <><span aria-hidden="true">/</span><span className="truncate text-slate-600">{nestedLabel}</span></>}
        </nav>
        <PlanBanner canManage={can("org.manage")} />
        {children}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    api<Session>("/auth/session")
      .then(setSession)
      .catch(() => (window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`));
  }, []);
  if (!session) return <Spinner label="Opening DryCare…" />;
  return <SessionProvider session={session}><Shell>{children}</Shell></SessionProvider>;
}

/** Shown when the user belongs to more than one business (e.g. their own cloud shop and the cloud copy of their shop PC). */
function BusinessSwitcher({ dark }: { dark: boolean }) {
  const [orgs, setOrgs] = useState<{ id: string; name: string; managedByPc: boolean; current: boolean }[]>([]);
  useEffect(() => {
    api<typeof orgs>("/auth/organizations").then(setOrgs).catch(() => {});
  }, []);
  if (orgs.length < 2) return null;
  async function open(id: string) {
    await api("/auth/switch-organization", { body: { organizationId: id } });
    window.location.href = "/dashboard";
  }
  return (
    <div className="border-b border-slate-100 py-1">
      <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Switch business</p>
      {orgs.map((o) => (
        <button key={o.id} type="button" disabled={o.current} onClick={() => open(o.id)} className={cx("flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm", o.current ? "font-semibold text-brand-700" : dark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100")}>
          <span className="truncate">{o.name}</span>
          {o.managedByPc && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Shop PC</span>}
        </button>
      ))}
    </div>
  );
}
