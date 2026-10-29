"use client";
import { Flame, Shirt, Wind, type LucideIcon } from "lucide-react";
import { LAUNDRY_MACHINE_LABELS, type LaundryMachineType, type LaundryPricingMethod } from "@drycare/shared";
import { cx } from "@/components/ui";

export type LaundryRuleRow = {
  id: string; serviceId: string; branchId: string | null; method: LaundryPricingMethod; enabled: boolean; unitPrice: number;
  minWeightGrams: number; weightIncrementGrams: number; minMinutes: number; minimumCharge: number; packageLabel: string | null;
};
export type LaundryItemRow = { id: string; serviceId: string; name: string; unitPrice: number; active: boolean };
export type LaundryServiceRow = { id: string; code: string; name: string; machineTypes: LaundryMachineType[]; taxBps: number; active: boolean; rules: LaundryRuleRow[]; items: LaundryItemRow[] };
export type LaundrySessionLive = {
  id: string; machineId: string; status: "reserved" | "running"; statusSource: "staff" | "device"; startedAt: string | null; expectedEndAt: string | null;
  programName: string | null; error: string | null; orderId: string; orderNumber: string; customerName: string;
};
export type LaundryMachineRow = {
  id: string; branchId: string; code: string; name: string; machineType: LaundryMachineType; capacityGrams: number | null; status: string;
  controlMode: string; adapterConfig: { baseUrl?: string; deviceId?: string }; notes: string | null; active: boolean; version: number;
  programs: { id: string; name: string; durationMinutes: number; active: boolean }[];
  session: LaundrySessionLive | null;
};
export type LaundryConfig = { services: LaundryServiceRow[]; machines: LaundryMachineRow[]; controlModes: string[] };

export const MACHINE_ICON: Record<LaundryMachineType, LucideIcon> = { washer: Shirt, dryer: Wind, iron_station: Flame };

export const STATUS_STYLE: Record<string, { label: string; dot: string; chip: string; card: string }> = {
  available: { label: "Available", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", card: "border-emerald-200" },
  reserved: { label: "Booked", dot: "bg-blue-500", chip: "bg-blue-50 text-blue-700 ring-blue-200", card: "border-blue-200" },
  running: { label: "Running", dot: "bg-violet-500 animate-pulse", chip: "bg-violet-50 text-violet-700 ring-violet-200", card: "border-violet-300" },
  completed: { label: "Cycle done · unload", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", card: "border-amber-300" },
  maintenance: { label: "Maintenance", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200", card: "border-slate-200" },
  out_of_service: { label: "Out of service", dot: "bg-red-500", chip: "bg-red-50 text-red-700 ring-red-200", card: "border-red-200" },
};

export const ORDER_STATUS: Record<string, { label: string; color: "slate" | "amber" | "blue" | "violet" | "green" | "red" }> = {
  pending_payment: { label: "Awaiting payment", color: "amber" },
  paid: { label: "Paid · ready to start", color: "blue" },
  in_progress: { label: "In machine", color: "violet" },
  ready: { label: "Ready to collect", color: "green" },
  collected: { label: "Collected", color: "slate" },
  cancelled: { label: "Cancelled", color: "red" },
};

export const machineTypeLabel = (t: LaundryMachineType) => LAUNDRY_MACHINE_LABELS[t];
export const kg = (grams: number | null | undefined) => (grams ? `${(grams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg` : "—");

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.available;
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", s.chip)}><span className={cx("h-2 w-2 rounded-full", s.dot)} />{s.label}</span>;
}

/** Minutes left on a running cycle, from the expected end. Shown as "about", never as a device reading. */
export function remaining(expectedEndAt: string | null) {
  if (!expectedEndAt) return null;
  const mins = Math.round((new Date(expectedEndAt).getTime() - Date.now()) / 60_000);
  return mins;
}
