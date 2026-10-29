"use client";

/** Shared pieces of the store sign-in, sign-up and password reset screens. */
import { useState } from "react";
import { ChevronRight, Eye, EyeOff, LockKeyhole, type LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";

export const primaryButton = "flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-800 via-teal-700 to-emerald-600 text-base font-semibold text-white shadow-[0_14px_34px_-10px_rgba(15,118,110,0.6)] transition hover:brightness-110 disabled:opacity-60";
export const inputBox = "block h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10";

export function BrandName({ className }: { className?: string }) {
  return <span className={cx("font-bold tracking-tight", className)}>Dry<span className="text-teal-500">Care</span></span>;
}

export function IconInput({ icon: Icon, ...rest }: { icon: LucideIcon } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
      <input {...rest} className={inputBox} />
    </div>
  );
}

export function SecretInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
      <input {...props} type={show ? "text" : "password"} className={cx(inputBox, "pr-12")} />
      <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-700">
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

export function AuthTile({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/[0.08] p-4 shadow-lg backdrop-blur-md">
      <div>
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md"><Icon className="h-5 w-5" /></span>
        <p className="mt-4 text-base font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-slate-200">{text}</p>
      </div>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10"><ChevronRight className="h-4 w-4" /></span>
    </div>
  );
}

export function AuthBadge({ icon: Icon, lines }: { icon: LucideIcon; lines: [string, string] }) {
  return (
    <span className="flex items-center gap-3"><Icon className="h-6 w-6 shrink-0 text-white" /><span className="leading-5">{lines[0]}<br />{lines[1]}</span></span>
  );
}
