"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Copy, Download, Fingerprint, KeyRound, LockKeyhole, MonitorDown, Search, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { ConsoleHeader, CsvButton, DataTable, EmptyState, LoadingRows, Panel, dateLabel, exportCsv, useAdminData } from "../admin-ui";

type SigningKey = { exists: boolean; fingerprint?: string; createdAt?: string; publicKeyPem?: string; desktopFile?: string | null };
type License = { id: string; organizationId: string | null; customerName: string; plan: string; installationIds: string[]; expiresAt: string | null; key: string; note: string | null; issuedAt: string; issuedBy: string | null };
type Plan = { id: string; name: string; published: boolean; code: string };
type Customer = { id: string; name: string; ownerEmail: string | null };
type System = { appVersion: string; licensing: { enforced: boolean; publicKeyConfigured: boolean } };

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-pem-file" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LicensesPage() {
  const key = useAdminData<SigningKey>("/platform-admin/licenses/signing-key");
  const licenses = useAdminData<License[]>("/platform-admin/licenses");
  const sys = useAdminData<System>("/platform-admin/system");
  return (
    <>
      <ConsoleHeader title="Licenses & releases" description="DryCare for Windows works offline with an activation key bound to each PC. Create the signing key once, then issue keys here after the customer has paid." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          {key.data?.exists ? <IssueKey onIssued={() => void licenses.reload()} /> : (
            <Panel title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-700" />Issue an activation key</span>}>
              <p className="text-sm text-slate-600">Create the signing key on the right first. After that you can issue keys here in seconds.</p>
            </Panel>
          )}
          <Register licenses={licenses.data} error={licenses.error} />
        </div>
        <div className="space-y-6">
          <SigningKeyPanel state={key.data} onChange={() => void key.reload()} />
          <Panel title={<span className="flex items-center gap-2"><MonitorDown className="h-4 w-4 text-brand-700" />Windows software</span>}>
            <dl className="space-y-3 text-sm">
              <Row label="Server / web version">{sys.data?.appVersion ?? "…"}</Row>
              <Row label="Activation keys">{key.data?.exists ? <Ok>Ready to issue</Ok> : <Warn>Signing key not created</Warn>}</Row>
              <Row label="Code-signing certificate"><Warn>Not purchased (SmartScreen warning)</Warn></Row>
            </dl>
            <Link href="/download" target="_blank" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"><MonitorDown className="h-4 w-4" />Open the public download page</Link>
          </Panel>
          <Panel title="How activation works">
            <ol className="space-y-3 text-sm leading-6 text-slate-600">
              {["The customer installs DryCare; the activation screen shows a request code for that PC.", "Record their payment under Payments.", "Issue a key here with that request code and send it by email or WhatsApp.", "They paste it into the activation screen. It works without internet until the expiry date."].map((t, i) => (
                <li key={i} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>{t}</li>
              ))}
            </ol>
            <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />An issued key cannot be switched off remotely; it stops at its expiry date. For a replaced PC, issue a new key for the new request code.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function SigningKeyPanel({ state, onChange }: { state: SigningKey | null; onChange: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [backupMsg, setBackupMsg] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await api<SigningKey>("/platform-admin/licenses/signing-key", { body: { confirm: "CREATE" } });
      setCreated(r.desktopFile ? `The public key was also saved for desktop builds at ${r.desktopFile}.` : "Download the public key below and place it in apps/desktop/build/license-public.pem before building the installer.");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the key.");
    } finally {
      setBusy(false);
    }
  }
  async function backup(e: FormEvent) {
    e.preventDefault();
    setBackupMsg("");
    setError("");
    try {
      const res = await fetch("/api/v1/platform-admin/licenses/signing-key/backup", { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ passphrase: pass }), credentials: "include" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "Backup failed");
      download(`drycare-license-private-${state?.fingerprint ?? "key"}.pem`, await res.text());
      setPass("");
      setPass2("");
      setBackupMsg("Encrypted backup downloaded. Store it offline (USB / password manager) and keep the passphrase separately.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup failed.");
    }
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-brand-700" />License signing key</span>} description="One key signs every activation key">
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {!state ? <LoadingRows rows={2} /> : !state.exists ? (
        <div className="space-y-3 text-sm text-slate-600">
          <p>Creates the private key that signs activation keys (stored encrypted on this server) and the matching public key that goes inside the Windows app.</p>
          <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Do this once. Every installer built afterwards trusts this key; it cannot be replaced from here without breaking installed copies.</p>
          <Field label='Type CREATE to confirm'><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" /></Field>
          <Button onClick={() => void create()} loading={busy} disabled={confirm !== "CREATE"}><Sparkles className="h-4 w-4" />Create signing key</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {created && <Alert tone="green">{created}</Alert>}
          <dl className="space-y-2.5 text-sm">
            <Row label="Status"><Ok>Active</Ok></Row>
            <Row label="Fingerprint"><span className="font-mono text-xs">{state.fingerprint}</span></Row>
            <Row label="Created">{dateLabel(state.createdAt)}</Row>
          </dl>
          <Button variant="secondary" size="sm" onClick={() => download("license-public.pem", state.publicKeyPem ?? "")}><Download className="h-4 w-4" />Download public key (for desktop builds)</Button>
          <form onSubmit={backup} className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><LockKeyhole className="h-4 w-4" />Back up the private key</p>
            <p className="mb-3 text-xs text-slate-500">If this server is lost you can still issue renewals from the backup. It is locked with a passphrase you choose now.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase (16+ characters)" autoComplete="new-password" aria-label="Backup passphrase" />
              <Input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Repeat passphrase" autoComplete="new-password" aria-label="Repeat backup passphrase" />
            </div>
            <Button type="submit" size="sm" className="mt-2" disabled={pass.length < 16 || pass !== pass2}><Download className="h-4 w-4" />Download encrypted backup</Button>
            {backupMsg && <p className="mt-2 text-xs text-emerald-700">{backupMsg}</p>}
          </form>
        </div>
      )}
    </Panel>
  );
}

function IssueKey({ onIssued }: { onIssued: () => void }) {
  const plans = useAdminData<Plan[]>("/platform-admin/plans");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orgId, setOrgId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [plan, setPlan] = useState("Standard");
  const [term, setTerm] = useState<"1y" | "6m" | "1m" | "never" | "custom">("1y");
  const [custom, setCustom] = useState("");
  const [codes, setCodes] = useState("");
  const [note, setNote] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ key: string; customer: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      void api<{ items: Customer[] }>(`/platform-admin/customers?${new URLSearchParams({ search, pageSize: "20", sort: search ? "name" : "newest" })}`).then((r) => setCustomers(r.items)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const planNames = useMemo(() => [...new Set(["Standard", ...(plans.data ?? []).filter((p) => p.published).map((p) => p.name)])], [plans.data]);
  const expiresOn = term === "never" ? null : term === "custom" ? custom : new Date(Date.now() + ({ "1y": 365, "6m": 182, "1m": 30 } as const)[term] * 86_400_000).toISOString().slice(0, 10);
  const ids = codes.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setIssuing(true);
    setError("");
    try {
      const r = await api<{ key: string }>("/platform-admin/licenses", { body: { organizationId: orgId || undefined, customerName: customerName.trim(), plan: plan.trim(), expiresOn, installationIds: ids, note: note.trim() || undefined } });
      setIssued({ key: r.key, customer: customerName.trim() });
      setCodes("");
      setNote("");
      onIssued();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not issue the key.");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-700" />Issue an activation key</span>} description="Signed instantly with your signing key">
      {issued && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-4 w-4" />Key ready for {issued.customer}</p>
          <code className="mt-2 block max-h-28 overflow-y-auto break-all rounded-lg bg-white p-3 font-mono text-[11px] leading-5 text-slate-800">{issued.key}</code>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(issued.key); setCopied(true); setTimeout(() => setCopied(false), 2000); }}><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy key"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>Issue another</Button>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Customer business">
          <div className="space-y-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search registered businesses (optional)" className="pl-9" aria-label="Search businesses" />
            </label>
            <Select value={orgId} onChange={(e) => { setOrgId(e.target.value); const c = customers.find((x) => x.id === e.target.value); if (c) setCustomerName(c.name); }} aria-label="Registered business">
              <option value="">Not registered online / enter name below</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.ownerEmail ? ` · ${c.ownerEmail}` : ""}</option>)}
            </Select>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name on the license" required><Input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Shop name" /></Field>
          <Field label="Plan" required>
            <Input list="license-plans" value={plan} onChange={(e) => setPlan(e.target.value)} required />
            <datalist id="license-plans">{planNames.map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <Field label="Valid for">
            <Select value={term} onChange={(e) => setTerm(e.target.value as typeof term)}>
              <option value="1y">1 year</option><option value="6m">6 months</option><option value="1m">1 month</option><option value="never">Perpetual (no expiry)</option><option value="custom">Until a date…</option>
            </Select>
          </Field>
          {term === "custom" ? <Field label="Expires on" required><Input type="date" required value={custom} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setCustom(e.target.value)} /></Field>
            : <Field label="Expires on"><Input value={expiresOn ? dateLabel(`${expiresOn}T12:00:00Z`) : "Never"} disabled /></Field>}
        </div>
        <Field label="PC request codes" required hint="From each PC's activation screen. One per line, or separated by commas.">
          <Textarea rows={3} value={codes} onChange={(e) => setCodes(e.target.value)} className="font-mono text-xs" placeholder="3f9c2a7e-1b2c-4d5e-8f90-123456789abc" />
        </Field>
        <Field label="Internal note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid UTR 4302…, 2 counters" maxLength={300} /></Field>
        <Button type="submit" loading={issuing} disabled={!ids.length || !customerName.trim() || (term === "custom" && !custom)}><ShieldCheck className="h-4 w-4" />Sign key for {ids.length || "…"} PC{ids.length === 1 ? "" : "s"}</Button>
      </form>
    </Panel>
  );
}

function Register({ licenses, error }: { licenses: License[] | null; error: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const status = (l: License) => {
    if (!l.expiresAt) return { text: "Perpetual", tone: "text-emerald-700" };
    const d = Math.ceil((new Date(l.expiresAt).getTime() - Date.now()) / 86_400_000);
    return d < 0 ? { text: "Expired", tone: "text-red-700" } : d <= 30 ? { text: `${d} days left`, tone: "text-amber-700" } : { text: `Until ${dateLabel(l.expiresAt)}`, tone: "text-slate-700" };
  };
  return (
    <Panel padded={false} title="Issued keys" description={licenses ? `${licenses.length} key${licenses.length === 1 ? "" : "s"} issued` : undefined}
      actions={<CsvButton disabled={!licenses?.length} onClick={() => exportCsv(`drycare-licenses-${new Date().toISOString().slice(0, 10)}.csv`, (licenses ?? []).map((l) => ({ Customer: l.customerName, Plan: l.plan, PCs: l.installationIds.length, "Issued": l.issuedAt.slice(0, 10), Expires: l.expiresAt?.slice(0, 10) ?? "never", "Issued by": l.issuedBy ?? "", Note: l.note ?? "", "License ID": l.id })))} />}>
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      {!licenses ? <LoadingRows /> : (
        <DataTable minWidth={760} head={["Customer", "Plan", "PCs", "Validity", "Issued", ""]}
          empty={!licenses.length && <EmptyState icon={KeyRound} title="No keys issued yet">Keys you issue appear here so you can copy them again or plan renewals.</EmptyState>}>
          {licenses.map((l) => {
            const st = status(l);
            return (
              <tr key={l.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3">{l.organizationId ? <Link href={`/super-admin/customers/view?id=${l.organizationId}`} className="font-medium text-slate-900 hover:text-brand-700">{l.customerName}</Link> : <span className="font-medium text-slate-900">{l.customerName}</span>}{l.note && <p className="text-xs text-slate-500">{l.note}</p>}</td>
                <td className="px-5 py-3 text-slate-700">{l.plan}</td>
                <td className="px-5 py-3 tabular-nums" title={l.installationIds.join("\n")}>{l.installationIds.length}</td>
                <td className={cx("px-5 py-3 text-sm font-medium", st.tone)}>{st.text}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{dateLabel(l.issuedAt)}<br />{l.issuedBy ?? ""}</td>
                <td className="px-5 py-3"><Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(l.key); setCopied(l.id); setTimeout(() => setCopied(null), 2000); }}><Copy className="h-4 w-4" />{copied === l.id ? "Copied" : "Copy key"}</Button></td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5 last:border-0 last:pb-0"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-800">{children}</dd></div>;
}
const Ok = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />{children}</span>;
const Warn = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center gap-1 text-amber-700"><CircleAlert className="h-4 w-4" />{children}</span>;
