"use client";
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CalendarDays, Eye, EyeOff, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { ORDER_STATUS_LABELS, STAGE_LABELS, type GarmentStage, type OrderStatus } from "@drycare/shared";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  secondary: "bg-white text-slate-800 border border-slate-200 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-700 hover:bg-slate-100",
};

export function Button({ variant = "primary", loading, className, children, disabled, size = "md", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : size === "lg" ? "h-11 px-5 text-base" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Fields are full width unless the caller passes its own w-* class. */
const withWidth = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? className : cx("w-full", className));
const fieldBase = "block h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cx(fieldBase, withWidth(className))} />;
});

/** Password field with a show/hide eye button. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput({ className, ...rest }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className={cx("relative", withWidth(className))}>
      <input ref={ref} {...rest} type={show ? "text" : "password"} className={cx(fieldBase, "w-full pr-11")} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldBase, "pr-8", withWidth(className))}>
      {children}
    </select>
  );
}

export function DateInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cx("relative block", withWidth(className))}>
      <input {...rest} type="date" className={cx(fieldBase, "pr-9", withWidth(className))} />
      <CalendarDays aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
    </span>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx("block min-h-24 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50", withWidth(className))} />;
}

export function Field({ label, hint, children, className, required }: { label: string; hint?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    // The hint sits outside the <label> so the field's accessible name is just the label, not label + hint.
    <div className={cx("block", className)}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </span>
        {children}
      </label>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tone = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
};
export type Tone = keyof typeof tone;

export function Badge({ children, color = "slate", className }: { children: ReactNode; color?: Tone; className?: string }) {
  return <span className={cx("inline-flex min-h-5 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", tone[color], className)}>{children}</span>;
}

const orderTone: Record<string, Tone> = {
  draft: "slate",
  received: "blue",
  in_processing: "violet",
  partially_ready: "amber",
  ready: "green",
  partially_delivered: "amber",
  delivered: "slate",
  cancelled: "red",
};
export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge color={orderTone[status] ?? "slate"}>{ORDER_STATUS_LABELS[status as OrderStatus] ?? status}</Badge>;
}

const stageTone: Partial<Record<GarmentStage, Tone>> = {
  received: "blue",
  quality_control: "amber",
  rework: "red",
  exception: "red",
  packing: "violet",
  ready: "green",
  dispatched: "brand",
  delivered: "slate",
  cancelled: "slate",
};
export function StageBadge({ stage }: { stage: string }) {
  return <Badge color={stageTone[stage as GarmentStage] ?? "violet"}>{STAGE_LABELS[stage as GarmentStage] ?? stage}</Badge>;
}

export function PaymentStatusBadge({ total, paid, cancelled }: { total: number; paid: number; cancelled?: boolean }) {
  if (cancelled) return <Badge color="red">Cancelled</Badge>;
  if (paid >= total) return <Badge color="green">Paid</Badge>;
  if (paid > 0) return <Badge color="amber">Part paid</Badge>;
  return <Badge color="red">Unpaid</Badge>;
}

export function Alert({ children, tone: t = "red", onClose }: { children: ReactNode; tone?: "red" | "amber" | "green" | "blue"; onClose?: () => void }) {
  const cls = { red: "border-red-200 bg-red-50 text-red-800", amber: "border-amber-200 bg-amber-50 text-amber-900", green: "border-emerald-200 bg-emerald-50 text-emerald-800", blue: "border-blue-200 bg-blue-50 text-blue-800" }[t];
  return (
    <div role="alert" className={cx("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", cls)}>
      {t !== "green" && <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Toast({ children, tone: t = "blue" }: { children: ReactNode; tone?: "red" | "amber" | "green" | "blue" }) {
  const cls = { red: "border-red-200 bg-red-50 text-red-800", amber: "border-amber-200 bg-amber-50 text-amber-900", green: "border-emerald-200 bg-emerald-50 text-emerald-800", blue: "border-blue-200 bg-blue-50 text-blue-800" }[t];
  return <div role={t === "red" ? "alert" : "status"} aria-live={t === "red" ? "assertive" : "polite"} className={cx("rounded-md border px-3 py-2 text-sm", cls)}>{children}</div>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <LoaderCircle className="h-5 w-5 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center" role="status">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone: t }: { label: string; value: ReactNode; hint?: string; tone?: "red" | "green" | "amber" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" title={hint}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", t === "red" ? "text-red-600" : t === "green" ? "text-emerald-700" : t === "amber" ? "text-amber-600" : "text-slate-900")}>{value}</p>
      {hint && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean | "xl" }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [];
    (focusable()[0] ?? dialog)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx("w-full rounded-lg border border-slate-200 bg-white", wide === "xl" ? "max-w-4xl" : wide ? "max-w-2xl" : "max-w-md")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 id={titleId} className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  // Headings follow their column: a right-aligned (amounts) or centred column gets a matching heading.
  const tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const cells = table.tBodies[0]?.rows[0]?.cells;
    table.tHead?.rows[0]?.querySelectorAll("th").forEach((th, i) => {
      const cls = cells?.[i]?.className ?? "";
      th.style.textAlign = /(^|\s)text-right(\s|$)/.test(cls) ? "right" : /(^|\s)text-center(\s|$)/.test(cls) ? "center" : "";
    });
  });
  return (
    <div className="w-full overflow-x-auto">
      <table ref={tableRef} className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx("whitespace-nowrap px-4 py-2.5", className)}>{children}</td>;
