"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

export type QueueState = { available: boolean; found?: boolean; offline: boolean; stuck: boolean; problem: string | null; jobs: { id: number; document: string; status: string; ageSeconds: number }[] };

const queueUrl = (printer: string) => `/labels/queue?printer=${encodeURIComponent(printer)}`;

/**
 * Follows a printer's queue through Windows. An empty queue means the printer took every job: Windows
 * cannot tell whether the tags came out well, which is why staff are still asked to scan one.
 * Each check starts PowerShell, so it runs often only while a print is being followed.
 */
export function usePrinterQueue(printer: string, mode: "off" | "idle" | "watching") {
  const [queue, setQueue] = useState<QueueState | null>(null);
  // An answer to a question asked before the latest print says nothing about that print.
  const generation = useRef(0);
  const asking = useRef(-1);
  const refresh = useCallback(async () => {
    const asked = generation.current;
    if (!printer || asking.current === asked) return;
    asking.current = asked;
    try {
      const next = await api<QueueState>(queueUrl(printer));
      if (asked === generation.current) setQueue(next);
    } catch {
      // The next check tries again.
    } finally {
      if (asking.current === asked) asking.current = -1;
    }
  }, [printer]);
  /** Forget what was known. Call this right after sending a print. */
  const restart = useCallback(() => {
    generation.current += 1;
    setQueue(null);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (mode === "off" || !printer) return;
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, mode === "watching" ? 2500 : 15000);
    return () => clearInterval(timer);
  }, [mode, printer, refresh]);
  return { queue, refresh, restart };
}

/** The printer's state after a print, or at any time in the printer panel. */
export function PrinterQueueStatus({ printer, queue, onChanged, compact = false }: { printer: string; queue: QueueState | null; onChanged: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!queue?.available) return null;

  const cancel = async () => {
    setBusy(true);
    setMessage("");
    try {
      const { removed } = await api<{ removed: number }>("/labels/queue/clear", { body: { printer } });
      setMessage(removed ? `Cancelled ${removed} waiting print job${removed === 1 ? "" : "s"}.` : "No Drycare jobs were waiting.");
      onChanged();
    } catch (e) {
      setMessage((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const waiting = queue.jobs.length;
  let tone = "border-slate-200 bg-slate-50 text-slate-800";
  let icon = <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" />;
  let text = "Ready. No jobs waiting.";
  if (queue.offline) {
    tone = "border-red-200 bg-red-50 text-red-900";
    icon = <TriangleAlert className="h-4 w-4 shrink-0" />;
    text = "Printer is offline. Check that it is on and the USB cable is connected.";
  } else if (queue.problem || queue.stuck) {
    tone = "border-amber-200 bg-amber-50 text-amber-900";
    icon = <TriangleAlert className="h-4 w-4 shrink-0" />;
    text = queue.problem ?? "Printing has stopped. Check the printer: is the roll or ribbon finished, is the cover open, or is a tag jammed? Fix it and press FEED.";
  } else if (waiting) {
    icon = <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-brand-600" />;
    text = `Printing… ${waiting} job${waiting === 1 ? "" : "s"} in the queue.`;
  }

  return (
    <div className={`rounded-xl border p-3 ${tone}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">{icon}<span>{text}</span></p>
        {waiting > 0 && (queue.stuck || !compact) && <Button size="sm" variant="secondary" loading={busy} onClick={cancel}>Cancel waiting jobs</Button>}
      </div>
      {message && <p className="mt-2 text-xs">{message}</p>}
    </div>
  );
}
