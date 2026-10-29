/**
 * Machine-control abstraction for the self-service laundry module.
 *
 * Most shops run ordinary machines: staff press start, so the "manual" adapter only records what
 * staff confirm and never claims a cycle finished on its own. Smart machines / IoT relays can use
 * the "http" adapter, a small documented contract any controller can implement:
 *
 *   POST {baseUrl}/machines/{deviceId}/start   body {sessionId, programName, durationMinutes}
 *        → 2xx JSON {accepted: true}                 (anything else = not started)
 *   GET  {baseUrl}/machines/{deviceId}/status
 *        → 2xx JSON {state: "idle"|"running"|"done"|"error", remainingSeconds?, error?}
 *
 * Requests carry `Authorization: Bearer $LAUNDRY_IOT_TOKEN` when that env var is set, and time out
 * after 8 seconds. A failed or unanswered request is reported as a failure; the machine is never
 * shown as running unless the device accepted the start.
 */

export type DeviceState = "idle" | "running" | "done" | "error" | "unknown";

export interface MachineRef {
  id: string;
  code: string;
  controlMode: string;
  adapterConfig: { baseUrl?: string; deviceId?: string };
}

export interface StartResult {
  ok: boolean;
  /** true when the device itself confirmed; false when only a person vouched (manual mode). */
  verified: boolean;
  message: string;
}

export interface StatusResult {
  state: DeviceState;
  remainingSeconds?: number;
  message?: string;
}

export interface MachineAdapter {
  key: string;
  start(machine: MachineRef, cycle: { sessionId: string; programName: string; durationMinutes: number }): Promise<StartResult>;
  status(machine: MachineRef): Promise<StatusResult>;
}

const manualAdapter: MachineAdapter = {
  key: "manual",
  async start() {
    return { ok: true, verified: false, message: "Started by staff at the machine" };
  },
  async status() {
    // A plain machine cannot report anything; completion is confirmed by staff.
    return { state: "unknown", message: "Status is confirmed by staff" };
  },
};

const TIMEOUT_MS = 8000;

async function call(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const token = process.env.LAUNDRY_IOT_TOKEN;
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body: body as Record<string, unknown> | null };
  } finally {
    clearTimeout(timer);
  }
}

const httpAdapter: MachineAdapter = {
  key: "http",
  async start(machine, cycle) {
    const { baseUrl, deviceId } = machine.adapterConfig;
    if (!baseUrl || !deviceId) return { ok: false, verified: false, message: "Machine controller address or device ID is not configured" };
    try {
      const r = await call(`${baseUrl.replace(/\/$/, "")}/machines/${encodeURIComponent(deviceId)}/start`, { method: "POST", body: JSON.stringify(cycle) });
      if (r.ok && r.body?.accepted === true) return { ok: true, verified: true, message: "Machine confirmed the start" };
      return { ok: false, verified: false, message: `Machine did not accept the start (HTTP ${r.status}${typeof r.body?.error === "string" ? `: ${r.body.error}` : ""})` };
    } catch (e) {
      return { ok: false, verified: false, message: (e as Error).name === "AbortError" ? "Machine controller did not respond in time" : "Could not reach the machine controller" };
    }
  },
  async status(machine) {
    const { baseUrl, deviceId } = machine.adapterConfig;
    if (!baseUrl || !deviceId) return { state: "unknown", message: "Controller not configured" };
    try {
      const r = await call(`${baseUrl.replace(/\/$/, "")}/machines/${encodeURIComponent(deviceId)}/status`, { method: "GET" });
      const state = r.body?.state;
      if (!r.ok || !["idle", "running", "done", "error"].includes(String(state))) return { state: "unknown", message: `Unexpected controller response (HTTP ${r.status})` };
      return { state: state as DeviceState, remainingSeconds: typeof r.body?.remainingSeconds === "number" ? r.body.remainingSeconds : undefined, message: typeof r.body?.error === "string" ? r.body.error : undefined };
    } catch {
      return { state: "unknown", message: "Could not reach the machine controller" };
    }
  },
};

const ADAPTERS: Record<string, MachineAdapter> = { manual: manualAdapter, http: httpAdapter };
export const MACHINE_CONTROL_MODES = Object.keys(ADAPTERS);
export function adapterFor(machine: Pick<MachineRef, "controlMode">): MachineAdapter {
  return ADAPTERS[machine.controlMode] ?? manualAdapter;
}
