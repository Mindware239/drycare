/** The Drycare logo. It follows the dark theme, and `dark` forces the version for dark backgrounds. */
export function Logo({ className = "h-8 w-8", dark = false }: { className?: string; dark?: boolean }) {
  const fit = `${className} object-contain`;
  /* eslint-disable @next/next/no-img-element */
  if (dark) return <img src="/site/logo-dark.png" alt="" className={fit} />;
  return (
    <>
      <img src="/site/logo.png" alt="" className={`dc-logo-light ${fit}`} />
      <img src="/site/logo-dark.png" alt="" className={`dc-logo-dark ${fit}`} />
    </>
  );
  /* eslint-enable @next/next/no-img-element */
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Logo className="h-7 w-auto" dark={dark} />
      <span className={`text-xl font-bold tracking-tight ${dark ? "text-white" : "text-slate-900"}`} style={{ fontFamily: '"Urbanist", sans-serif' }}>Drycare</span>
    </span>
  );
}
