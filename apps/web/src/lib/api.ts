"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { path?: string; message?: string; customerId?: string }[] = [],
    public requestId?: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      "x-drycare-csrf": "1",
      ...(init.idempotencyKey ? { "idempotency-key": init.idempotencyKey } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 402 && e?.code === "LICENSE_REQUIRED" && typeof window !== "undefined" && window.location.pathname !== "/activate") {
      window.location.href = "/activate";
    }
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.location.href = window.location.pathname.startsWith("/super-admin")
        ? "/super-admin/login"
        : `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    const detailMsg = e?.code === "VALIDATION_ERROR" && e.details?.length ? `: ${e.details.map((d: any) => `${d.path} ${d.message}`).join("; ")}` : "";
    throw new ApiError(res.status, e?.code ?? "ERROR", (e?.message ?? `Request failed (${res.status})`) + detailMsg, e?.details, e?.requestId);
  }
  return json as T;
}

/** Minimal data hook: loading / error / data states with manual reload. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      if (my === seq.current) setError(e as ApiError);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
