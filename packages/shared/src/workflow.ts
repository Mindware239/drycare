/**
 * Garment processing state machine (SRS §9). Each service defines an ordered list of processing
 * stages; this module decides which transitions are permitted from a garment's current stage.
 */
export const GARMENT_STAGES = [
  "received",
  "inspection",
  "sorting",
  "cleaning",
  "drying",
  "finishing",
  "quality_control",
  "rework",
  "packing",
  "ready",
  "dispatched",
  "delivered",
  "exception",
  "cancelled",
] as const;
export type GarmentStage = (typeof GARMENT_STAGES)[number];

export const STAGE_LABELS: Record<GarmentStage, string> = {
  received: "Received",
  inspection: "Inspection",
  sorting: "Sorting",
  cleaning: "Cleaning",
  drying: "Drying",
  finishing: "Finishing",
  quality_control: "Quality control",
  rework: "Rework",
  packing: "Packing",
  ready: "Ready",
  dispatched: "Dispatched",
  delivered: "Delivered",
  exception: "Exception",
  cancelled: "Cancelled",
};

/** Stages a service template may list, in order, between intake and ready. */
export const PROCESS_STAGES: GarmentStage[] = ["received", "inspection", "sorting", "cleaning", "drying", "finishing", "quality_control", "packing", "ready"];

export const DEFAULT_TEMPLATE: GarmentStage[] = ["received", "inspection", "sorting", "cleaning", "finishing", "quality_control", "packing", "ready"];

export function validateTemplate(stages: string[]): GarmentStage[] {
  if (stages[0] !== "received") throw new Error("Workflow must start at 'received'");
  if (stages[stages.length - 1] !== "ready") throw new Error("Workflow must end at 'ready'");
  let last = -1;
  for (const s of stages) {
    const idx = PROCESS_STAGES.indexOf(s as GarmentStage);
    if (idx === -1) throw new Error(`Unknown stage '${s}'`);
    if (idx <= last) throw new Error("Stages must be unique and in process order");
    last = idx;
  }
  return stages as GarmentStage[];
}

export type TransitionKind =
  | "advance"
  | "qc_pass"
  | "qc_fail"
  | "rework_return"
  | "exception"
  | "exception_resolve"
  | "dispatch"
  | "return_to_store"
  | "deliver"
  | "cancel";

export interface Transition {
  to: GarmentStage;
  kind: TransitionKind;
  /** Permission needed in addition to garments.process, if any. */
  permission?: string;
}

/** Where garments go back to after failing QC: the main cleaning stage if the template has one. */
export function reworkTarget(template: GarmentStage[]): GarmentStage {
  for (const s of ["cleaning", "finishing", "sorting"] as GarmentStage[]) if (template.includes(s)) return s;
  return template[1] ?? "received";
}

/**
 * Transitions available through the generic scan/transition endpoint. QC outcomes go through the
 * inspection endpoint and delivery through handover, so they always record the required evidence.
 */
export function allowedTransitions(template: GarmentStage[], current: GarmentStage): Transition[] {
  const out: Transition[] = [];
  if (current === "delivered" || current === "cancelled") return out;
  if (current === "exception") {
    for (const s of template) out.push({ to: s, kind: "exception_resolve", permission: "garments.override" });
    return out;
  }
  if (current === "rework") {
    out.push({ to: reworkTarget(template), kind: "rework_return" });
  } else if (current === "quality_control") {
    out.push({ to: nextAfter(template, current) ?? "packing", kind: "qc_pass", permission: "qc.approve" });
    out.push({ to: "rework", kind: "qc_fail", permission: "qc.approve" });
  } else if (current === "ready" || current === "dispatched") {
    // Leaving the store, coming back and delivery are recorded only through counter handover or a
    // delivery run (dispatch manifest, proof of delivery) — never a bare status change.
  } else {
    const next = nextAfter(template, current);
    if (next) out.push({ to: next, kind: "advance" });
  }
  out.push({ to: "exception", kind: "exception" });
  return out;
}

function nextAfter(template: GarmentStage[], current: GarmentStage): GarmentStage | undefined {
  const i = template.indexOf(current);
  if (i === -1) return undefined;
  return template[i + 1];
}

export function findTransition(template: GarmentStage[], from: GarmentStage, to: GarmentStage): Transition | undefined {
  return allowedTransitions(template, from).find((t) => t.to === to);
}

export type OrderStatus =
  | "draft"
  | "received"
  | "in_processing"
  | "partially_ready"
  | "ready"
  | "partially_delivered"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  received: "Received",
  in_processing: "In processing",
  partially_ready: "Partially ready",
  ready: "Ready for collection",
  partially_delivered: "Partially delivered",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * Derivation rule (documented per SRS §9.1): the order status is computed from its garments,
 * ignoring cancelled garments unless every garment is cancelled.
 */
export function deriveOrderStatus(stages: GarmentStage[]): OrderStatus {
  if (stages.length === 0) return "draft";
  const live = stages.filter((s) => s !== "cancelled");
  if (live.length === 0) return "cancelled";
  const delivered = live.filter((s) => s === "delivered").length;
  if (delivered === live.length) return "delivered";
  if (delivered > 0) return "partially_delivered";
  const ready = live.filter((s) => s === "ready" || s === "dispatched").length;
  if (ready === live.length) return "ready";
  if (ready > 0) return "partially_ready";
  if (live.every((s) => s === "received")) return "received";
  return "in_processing";
}

/**
 * Physical custody of a garment or bag, tracked independently of its processing stage:
 * a garment can be "cleaning" while "at_facility", or "ready" while "in_transit_to_shop".
 */
export const GARMENT_LOCATIONS = [
  "shop_counter",
  "in_transit_to_facility",
  "at_facility",
  "in_transit_to_shop",
  "shop_storage",
  "missing",
  "collected",
] as const;
export type GarmentLocation = (typeof GARMENT_LOCATIONS)[number];

export const LOCATION_LABELS: Record<GarmentLocation, string> = {
  shop_counter: "At shop (received)",
  in_transit_to_facility: "In transit to facility",
  at_facility: "At processing facility",
  in_transit_to_shop: "In transit to shop",
  shop_storage: "Back at shop",
  missing: "Missing",
  collected: "Collected by customer",
};

/** Where garments must be to join a transfer batch, and where they end up after each step. */
export const TRANSFER_FLOW = {
  to_facility: { from: ["shop_counter", "shop_storage"] as GarmentLocation[], transit: "in_transit_to_facility" as GarmentLocation, arrive: "at_facility" as GarmentLocation },
  to_shop: { from: ["at_facility"] as GarmentLocation[], transit: "in_transit_to_shop" as GarmentLocation, arrive: "shop_storage" as GarmentLocation },
} as const;
export type TransferDirection = keyof typeof TRANSFER_FLOW;

/**
 * Collection-time discount as a credit note. The discount comes off the pre-tax amount still
 * eligible for discount, and GST is reduced in proportion (integer paise, no floating point).
 */
export function collectionDiscount(input: {
  taxableBase: number; // invoice subtotal + surcharges − intake discounts, in paise
  taxTotal: number; // invoice tax, in paise
  alreadyCredited: number; // pre-tax amount already credited, in paise
  type: "percent" | "fixed";
  value: number; // bps when percent, paise when fixed
}) {
  const eligible = Math.max(0, input.taxableBase - input.alreadyCredited);
  const taxable = input.type === "percent" ? Math.round((input.taxableBase * input.value) / 10_000) : input.value;
  if (!Number.isInteger(taxable) || taxable <= 0) return { error: "Enter a discount greater than zero." as const };
  if (taxable > eligible) return { error: `The discount cannot exceed the eligible amount of ${eligible} paise.` as const };
  const tax = input.taxableBase > 0 ? Math.round((taxable * input.taxTotal) / input.taxableBase) : 0;
  return { taxable, tax, total: taxable + tax };
}
