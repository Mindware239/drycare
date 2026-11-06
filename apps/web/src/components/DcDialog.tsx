"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The dialog from the owner's garment screens: title block, scrolling body, footer. Escape and the backdrop close it unless locked. */
export function DcDialog({ kicker, title, sub, narrow, width, onClose, children, footer, locked }: { kicker: ReactNode; title: string; sub: string; narrow?: boolean; width?: number; onClose: () => void; children: ReactNode; footer: ReactNode; locked?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => setShown(true), 20);
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !lockedRef.current) closeRef.current(); };
    window.addEventListener("keydown", key);
    if (!panel.current?.contains(document.activeElement)) panel.current?.querySelector<HTMLElement>("[data-autofocus],button")?.focus();
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); back?.focus?.(); };
  }, []);
  function trap(e: KeyboardEvent) {
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,textarea,summary,a[href]")];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  return createPortal(
    <div className="dcd">
      <div onClick={() => { if (!locked) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(21,21,20,.45)" }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap} className="flex flex-col" style={{ position: "fixed", top: "min(6vh,48px)", left: "50%", transform: `translateX(-50%) ${shown ? "" : "translateY(14px) scale(.98)"}`, opacity: shown ? 1 : 0, transition: "opacity .25s ease,transform .35s cubic-bezier(.2,.8,.2,1)", zIndex: 61, width: width ?? (narrow ? 520 : 780), maxWidth: "calc(100% - 24px)", maxHeight: "88vh", background: "var(--dc-card)", borderRadius: 22, boxShadow: "0 30px 80px rgba(0,0,0,.3)", overflow: "hidden", color: "var(--dc-ink)" }}>
        <div className="flex items-start justify-between gap-3" style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--dc-line2)" }}>
          <div className="flex min-w-0 flex-col gap-1">
            {typeof kicker === "string" ? <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--dc-green-fg)" }}>{kicker}</span> : kicker}
            <h2 className="dcd-h m-0" style={{ fontSize: 24, overflowWrap: "anywhere" }}>{title}</h2>
            <span style={{ fontSize: 14, color: "var(--dc-sub)", overflowWrap: "anywhere" }}>{sub}</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex-none cursor-pointer" style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid var(--dc-line)", background: "var(--dc-card)", color: "var(--dc-ink)", fontSize: 18 }}>×</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" style={{ padding: "18px 24px" }}>{children}</div>
        {footer}
      </div>
    </div>,
    document.body,
  );
}
