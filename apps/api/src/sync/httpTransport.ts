/** Authenticated HTTPS transport to DryCare Cloud (`POST /api/v1/sync/push`). */
import type { SyncEvent, SyncResult, SyncTransport } from "./transport";

/**
 * Conditions that stop the whole queue without counting against any event's retry budget:
 * the PC must be re-linked, the shop needs a cloud plan, the cloud must be updated, or the cloud asked us to slow down.
 */
export class SyncHold extends Error {
  constructor(public state: "relink_required" | "plan_required" | "schema_too_new" | "rate_limited", message: string, public retryAfterSeconds = 300) {
    super(message);
  }
}

const TIMEOUT_MS = 30_000;

export class HttpSyncTransport implements SyncTransport {
  readonly name = "https";
  constructor(private baseUrl: string, private credential: () => Promise<string>, private appVersion: string) {}

  async push(events: SyncEvent[]): Promise<SyncResult[]> {
    const res = await this.post(events);
    if (res.status === 400 && events.length > 1) {
      // One malformed change must not block the rest: send them one by one to find it.
      const out: SyncResult[] = [];
      for (const e of events) out.push(...(await this.push([e])));
      return out;
    }
    if (res.status === 400) {
      return [{ id: events[0].id, outcome: "error", retryable: false, message: `REJECTED_BY_CLOUD: ${res.body?.error?.message ?? "invalid change"}` }];
    }
    if (res.status === 200 && Array.isArray(res.body?.results)) return res.body.results as SyncResult[];
    if (res.status === 401 || res.status === 403) throw new SyncHold("relink_required", res.body?.error?.message ?? "This PC must be linked to DryCare Cloud again.", 3600);
    if (res.status === 402) throw new SyncHold("plan_required", res.body?.error?.message ?? "Cloud sync needs an active DryCare Cloud plan.", 3600);
    if (res.status === 426) throw new SyncHold("schema_too_new", res.body?.error?.message ?? "The cloud must be updated before this PC can upload.", 3600);
    if (res.status === 429) throw new SyncHold("rate_limited", "The cloud asked DryCare to slow down.", Math.max(5, Number(res.retryAfter) || 60));
    throw new Error(res.status ? `Cloud returned ${res.status}` : "Could not reach DryCare Cloud");
  }

  private async post(events: SyncEvent[]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${this.baseUrl}/api/v1/sync/push`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-drycare-csrf": "1", authorization: `Device ${await this.credential()}` },
        body: JSON.stringify({ batchId: crypto.randomUUID(), schemaVersion: events[0].schemaVersion, appVersion: this.appVersion, events }),
      });
      let body: any;
      try { body = await r.json(); } catch {}
      return { status: r.status, body, retryAfter: r.headers.get("retry-after") };
    } catch (err) {
      // Network failure or timeout: the cloud may or may not have committed. Retrying is safe — committed
      // events come back as "duplicate".
      throw new Error((err as Error).name === "AbortError" ? "DryCare Cloud did not answer in time" : "Could not reach DryCare Cloud");
    } finally {
      clearTimeout(t);
    }
  }
}

/** Small JSON helper for the other cloud calls (link, rotate, device status). */
export async function cloudCall<T>(baseUrl: string, path: string, init: { method?: string; body?: unknown; credential?: string } = {}): Promise<{ status: number; body: T & { error?: { code: string; message: string } } }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl}/api/v1${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      signal: ctrl.signal,
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), "x-drycare-csrf": "1", ...(init.credential ? { authorization: `Device ${init.credential}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    let body: any = {};
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  } catch (err) {
    throw new Error((err as Error).name === "AbortError" ? "DryCare Cloud did not answer in time" : "Could not reach DryCare Cloud");
  } finally {
    clearTimeout(t);
  }
}
