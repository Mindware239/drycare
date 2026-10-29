export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0d8573" />
      <path d="M16 6.5 9.5 11v1.2h13V11L16 6.5Z" fill="#c9f5ec" />
      <path d="M10 13.5h12l1.5 11a1.5 1.5 0 0 1-1.5 1.7H10a1.5 1.5 0 0 1-1.5-1.7l1.5-11Z" fill="#fff" />
      <circle cx="16" cy="19.5" r="3.2" fill="none" stroke="#0d8573" strokeWidth="1.6" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Logo />
      <span className={`text-lg font-bold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}>
        Dry<span className={dark ? "text-brand-200" : "text-brand-600"}>Care</span>
      </span>
    </span>
  );
}
