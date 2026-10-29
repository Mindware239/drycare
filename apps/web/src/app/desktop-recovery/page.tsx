"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Wordmark } from "@/components/Brand";
import { api, ApiError } from "@/lib/api";

export default function DesktopRecoveryPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    if (password !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const result = await api<{ email: string }>("/system/desktop-owner-recovery", {
        body: { email, password },
      });
      setDone(`Password reset for ${result.email}. Sign in with the new password.`);
      setPassword("");
      setConfirmPassword("");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 sm:p-8">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <Wordmark />
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">DryCare for PC · local recovery</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Reset this PC&apos;s owner password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This only works in the DryCare Windows app on the PC that holds the store data. It cannot reset a cloud account or an account from another computer.
        </p>

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Use this only if you own or administer this Windows PC. This resets the local owner account password and signs out all existing sessions. Your store records are not deleted.
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          {error && <Alert>{error}</Alert>}
          {done && <Alert tone="green">{done}</Alert>}
          <Field label="Owner email used during this PC's store setup" required>
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="New password" required hint="Use at least 10 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" required>
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={200}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Reset local owner password
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Return to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
