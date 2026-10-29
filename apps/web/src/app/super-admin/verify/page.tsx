"use client";

import { useEffect } from "react";

/** Older emails contained sign-in links; super admin sign-in now uses a 6-digit code entered on the login page. */
export default function SuperAdminVerifyPage() {
  useEffect(() => {
    window.location.replace("/super-admin/login");
  }, []);
  return <main className="flex min-h-screen items-center justify-center text-sm text-slate-500">Redirecting to super admin sign in…</main>;
}
