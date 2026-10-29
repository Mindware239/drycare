"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Permission } from "@drycare/shared";

export interface Session {
  user: { id: string; name: string; email: string };
  isPlatformAdmin: boolean;
  organization: { id: string; name: string; status: string; currency: string; gstin?: string; settings?: Record<string, unknown> };
  role: { key: string; name: string };
  permissions: string[];
  branches: { id: string; name: string; code: string; status: string }[];
}

interface Ctx {
  session: Session;
  can: (p: Permission) => boolean;
  /** Cloud copy of a shop PC: everything is visible, nothing can be changed here (the server enforces this too). */
  readOnly: boolean;
  branchId: string;
  setBranchId: (id: string) => void;
  branch: Session["branches"][number] | undefined;
}

const SessionContext = createContext<Ctx | null>(null);

/** Permissions that only read data, plus org.manage for Plan & billing and the linked-PC card (both allowed server-side). */
const VIEW_ONLY_PERMISSIONS = new Set<string>(["customers.read", "orders.read", "reports.view", "reports.financial", "audit.view", "laundry.view", "org.manage"]);
const BRANCH_KEY = "drycare.branch";

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [branchId, setBranchIdState] = useState(session.branches[0]?.id ?? "");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BRANCH_KEY);
      if (saved && session.branches.some((b) => b.id === saved)) setBranchIdState(saved);
    } catch {}
  }, [session.branches]);
  const readOnly = session.organization.settings?.syncSource === "device";
  const value = useMemo<Ctx>(
    () => ({
      session,
      readOnly,
      can: (p) => session.permissions.includes(p) && (!readOnly || VIEW_ONLY_PERMISSIONS.has(p)),
      branchId,
      branch: session.branches.find((b) => b.id === branchId),
      setBranchId: (id) => {
        setBranchIdState(id);
        try {
          localStorage.setItem(BRANCH_KEY, id);
        } catch {}
      },
    }),
    [session, branchId, readOnly],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
