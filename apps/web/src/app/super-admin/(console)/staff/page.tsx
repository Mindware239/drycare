"use client";
import { useState, type FormEvent } from "react";
import { KeyRound, LogOut, ShieldCheck, Terminal } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, PasswordInput } from "@/components/ui";
import { ConsoleHeader, DataTable, LoadingRows, Panel, StatusBadge, dateTimeLabel, useAdmin, useAdminData } from "../admin-ui";

type Admin = { id: string; name: string; email: string; status: string; lastLoginAt: string | null; createdAt: string; lockedUntil: string | null; activeSessions: number };

export default function StaffPage() {
  const me = useAdmin();
  const admins = useAdminData<Admin[]>("/platform-admin/admins");
  const [notice, setNotice] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");

  async function revokeOthers() {
    setRevoking(true);
    setError("");
    try {
      const r = await api<{ revoked: number }>("/platform-admin/sessions/revoke-others", { body: {} });
      setNotice(r.revoked ? `Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}.` : "No other active sessions.");
      await admins.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out other sessions.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <ConsoleHeader title="Admins & security" description="People who can open the DryCare Control Center. Every sign-in needs the admin's password and a one-time code sent to their email." />
      {notice && <div className="mb-5"><Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert></div>}
      {error && <div className="mb-5"><Alert>{error}</Alert></div>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <div className="space-y-6">
          <Panel title="Super admins" padded={false}>
            {!admins.data ? <LoadingRows rows={2} /> : (
              <DataTable minWidth={600} head={["Admin", "Status", "Last sign-in", "Active sessions"]}>
                {admins.data.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-3"><p className="font-medium text-slate-900">{a.name} {a.id === me.id && <Badge color="brand">You</Badge>}</p><p className="text-xs text-slate-500">{a.email}</p></td>
                    <td className="px-5 py-3">{a.lockedUntil && new Date(a.lockedUntil) > new Date() ? <Badge color="red">locked</Badge> : <StatusBadge status={a.status} />}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{a.lastLoginAt ? dateTimeLabel(a.lastLoginAt) : "Never"}</td>
                    <td className="px-5 py-3 tabular-nums">{a.activeSessions}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><Terminal className="h-4 w-4" />Adding another super admin</span>}>
            <p className="text-sm leading-6 text-slate-600">For security, new super admins are created on the server, not from the browser. Use a dedicated email address that is not used for any shop account, then run:</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-200">pnpm admin:create -- --email new.admin@indianbarcode.com</pre>
            <p className="mt-2 text-xs text-slate-500">The command asks for a password (at least 12 characters with upper and lower case letters, a number and a symbol).</p>
          </Panel>
        </div>
        <div className="space-y-6">
          <ChangePassword onDone={(msg) => { setNotice(msg); void admins.reload(); }} />
          <Panel title="Sessions">
            <p className="text-sm leading-6 text-slate-600">If you signed in on a shared or lost computer, sign out everywhere except this browser.</p>
            <Button variant="secondary" className="mt-4" onClick={revokeOthers} loading={revoking}><LogOut className="h-4 w-4" />Sign out other sessions</Button>
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Protections in place</span>}>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>• Password + 6-digit email code on every sign-in</li>
              <li>• Codes expire in 10 minutes, single use, 5 attempts</li>
              <li>• Sign-in rate limited; account locks after repeated failures</li>
              <li>• Store accounts can never open this console</li>
              <li>• Every change is written to the audit log with IP address</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function ChangePassword({ onDone }: { onDone: (message: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const checks = [
    { ok: next.length >= 12, label: "12+ characters" },
    { ok: /[a-z]/.test(next) && /[A-Z]/.test(next), label: "Upper & lower case" },
    { ok: /[0-9]/.test(next), label: "A number" },
    { ok: /[^A-Za-z0-9]/.test(next), label: "A symbol (e.g. @ # !)" },
    { ok: next.length > 0 && next === confirm, label: "Passwords match" },
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/platform-admin/me/password", { body: { currentPassword: current, newPassword: next } });
      setCurrent(""); setNext(""); setConfirm("");
      onDone("Password changed. Other devices have been signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Change your password</span>}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Current password" required><PasswordInput autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password" required><PasswordInput autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Confirm new password" required><PasswordInput autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <ul className="grid grid-cols-2 gap-1 text-xs">
          {checks.map((c) => <li key={c.label} className={c.ok ? "text-emerald-700" : "text-slate-400"}>{c.ok ? "✓" : "○"} {c.label}</li>)}
        </ul>
        <Button type="submit" loading={saving} disabled={!checks.every((c) => c.ok) || !current}>Update password</Button>
      </form>
    </Panel>
  );
}
