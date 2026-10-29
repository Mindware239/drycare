"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, Building2, CalendarPlus, CheckCircle2, CreditCard, History, Mail, MapPin, Phone, ReceiptIndianRupee, ShieldCheck, Store, Users } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Alert, Badge, Button, Field, Input, Modal, Textarea } from "@/components/ui";
import { DataTable, EmptyState, LoadingRows, Panel, StatusBadge, TrialBadge, actionLabel, dateLabel, dateTimeLabel, relativeDays, useAdminData } from "../../admin-ui";

type Detail = {
  organization: { id: string; name: string; legalName: string | null; slug: string; status: string; gstin: string | null; trialStartedAt: string | null; trialEndsAt: string | null; trialSource: string | null; createdAt: string; settings: Record<string, unknown> };
  users: { id: string; name: string; email: string; phone: string | null; status: string; emailVerifiedAt: string | null; lastLoginAt: string | null; membershipStatus: string; roleName: string; roleKey: string; joinedAt: string }[];
  branches: { id: string; name: string; branchCode: string; phone: string | null; status: string; address: Record<string, string>; createdAt: string }[];
  usage: { customers: number; orders: number; orders30: number; lastOrderAt: string | null; garments: number };
  subscriptions: { id: string; status: string; provider: string; reference: string | null; startsAt: string; endsAt: string | null; canceledAt: string | null; planName: string; pricePaise: number; interval: string }[];
  payments: { id: string; provider: string; reference: string; amountPaise: number; status: string; createdAt: string }[];
  timeline: { id: string; action: string; createdAt: string; actorEmail: string | null; after: Record<string, unknown> | null }[];
};

type Action = { type: "trial" } | { type: "status"; status: "active" | "suspended" };

function CustomerDetailInner() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, reload } = useAdminData<Detail>(id ? `/platform-admin/customers/${id}` : null);
  const [action, setAction] = useState<Action | null>(null);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  if (!id) return <Alert>No customer was selected.</Alert>;
  if (error) return <div className="space-y-4"><BackLink /><Alert>{error}</Alert></div>;
  if (!data) return <Panel><LoadingRows rows={10} /></Panel>;

  const { organization: org, users, branches, usage, subscriptions, payments, timeline } = data;
  const owner = users.find((u) => u.roleKey === "owner") ?? users[0];
  const activeSub = subscriptions.find((s) => s.status === "active" && (!s.endsAt || new Date(s.endsAt) > new Date()));
  const settings = org.settings as { city?: string; state?: string; businessType?: string; outletCount?: number; counterCount?: number };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    setSaving(true);
    setActionError("");
    try {
      if (action.type === "trial") {
        await api(`/platform-admin/organizations/${org.id}/extend-trial`, { body: { days: Number(days), reason } });
        setNotice(`Trial extended by ${days} day${days === "1" ? "" : "s"}.`);
      } else {
        await api(`/platform-admin/organizations/${org.id}/status`, { body: { status: action.status, reason } });
        setNotice(action.status === "suspended" ? "Account suspended. The shop's staff can no longer use DryCare." : "Account reactivated.");
      }
      setAction(null);
      setReason("");
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not update this account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <BackLink />
      {notice && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xl font-semibold text-brand-700">{org.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{org.name}</h1>
                <TrialBadge status={org.status} trialEndsAt={org.trialEndsAt} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-600">
                {owner && <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-slate-400" />{owner.name}</span>}
                {owner && <a href={`mailto:${owner.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Mail className="h-4 w-4 text-slate-400" />{owner.email}</a>}
                {owner?.phone && <a href={`tel:${owner.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Phone className="h-4 w-4 text-slate-400" />{owner.phone}</a>}
                {(settings.city || settings.state) && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-400" />{[settings.city, settings.state].filter(Boolean).join(", ")}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {org.status === "trial" && <Button variant="secondary" onClick={() => { setAction({ type: "trial" }); setDays("7"); setActionError(""); }}><CalendarPlus className="h-4 w-4" />Extend trial</Button>}
            <Link href={`/super-admin/payments?org=${org.id}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand-700 px-3.5 text-sm font-medium text-white hover:bg-brand-800"><CreditCard className="h-4 w-4" />Record payment</Link>
            {org.status === "suspended"
              ? <Button variant="secondary" onClick={() => { setAction({ type: "status", status: "active" }); setActionError(""); }}><CheckCircle2 className="h-4 w-4" />Reactivate</Button>
              : <Button variant="danger" onClick={() => { setAction({ type: "status", status: "suspended" }); setActionError(""); }}><Ban className="h-4 w-4" />Suspend</Button>}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard icon={ShieldCheck} title="Subscription">
          {activeSub ? <><p className="font-semibold text-slate-900">{activeSub.planName}</p><p className="text-xs text-slate-500">{money(activeSub.pricePaise)} / {activeSub.interval} · renews {dateLabel(activeSub.endsAt)}</p></> : <><p className="font-semibold text-slate-900">No active paid plan</p><p className="text-xs text-slate-500">{subscriptions.length ? `${subscriptions.length} past subscription record${subscriptions.length === 1 ? "" : "s"}` : "Has never paid"}</p></>}
        </InfoCard>
        <InfoCard icon={CalendarPlus} title="Trial">
          {org.trialEndsAt ? <><p className="font-semibold text-slate-900">Ends {dateLabel(org.trialEndsAt)}</p><p className="text-xs text-slate-500">{relativeDays(org.trialEndsAt)} · started {dateLabel(org.trialStartedAt)}</p></> : <p className="font-semibold text-slate-900">No trial recorded</p>}
        </InfoCard>
        <InfoCard icon={ReceiptIndianRupee} title="Usage">
          <p className="font-semibold text-slate-900">{usage.orders.toLocaleString("en-IN")} orders · {usage.garments.toLocaleString("en-IN")} garments</p>
          <p className="text-xs text-slate-500">{usage.orders30} orders in 30 days · last {usage.lastOrderAt ? dateLabel(usage.lastOrderAt) : "never"}</p>
        </InfoCard>
        <InfoCard icon={Building2} title="Business">
          <p className="font-semibold text-slate-900">{branches.length} branch{branches.length === 1 ? "" : "es"} · {usage.customers.toLocaleString("en-IN")} customers</p>
          <p className="text-xs text-slate-500">GSTIN {org.gstin ?? "not provided"} · joined {dateLabel(org.createdAt)}</p>
        </InfoCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Team" description="Store users. Passwords are never visible to DryCare staff." padded={false}>
          <DataTable minWidth={560} head={["User", "Role", "Email", "Last sign-in"]}>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-5 py-3"><p className="font-medium text-slate-900">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                <td className="px-5 py-3"><Badge color={u.roleKey === "owner" ? "brand" : "slate"}>{u.roleName}</Badge>{u.membershipStatus !== "active" && <span className="ml-1"><StatusBadge status={u.membershipStatus} /></span>}</td>
                <td className="px-5 py-3">{u.emailVerifiedAt ? <Badge color="green">verified</Badge> : <Badge color="amber">unverified</Badge>}</td>
                <td className="px-5 py-3 text-xs text-slate-600">{u.lastLoginAt ? dateTimeLabel(u.lastLoginAt) : "Never"}</td>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel title="Branches" padded={false}>
          <DataTable minWidth={480} head={["Branch", "Code", "Status", "Created"]} empty={!branches.length && <EmptyState icon={Store} title="No branches" />}>
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="px-5 py-3"><p className="font-medium text-slate-900">{b.name}</p><p className="text-xs text-slate-500">{[b.address?.city, b.address?.state].filter(Boolean).join(", ") || b.phone || "—"}</p></td>
                <td className="px-5 py-3 font-mono text-xs">{b.branchCode}</td>
                <td className="px-5 py-3"><StatusBadge status={b.status} /></td>
                <td className="px-5 py-3 text-xs text-slate-600">{dateLabel(b.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Subscriptions" padded={false}>
          <DataTable minWidth={560} head={["Plan", "Status", "Period", "Source"]} empty={!subscriptions.length && <EmptyState icon={ShieldCheck} title="No subscriptions yet">Recording a verified payment creates the subscription.</EmptyState>}>
            {subscriptions.map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-3"><p className="font-medium text-slate-900">{s.planName}</p><p className="text-xs text-slate-500">{money(s.pricePaise)} / {s.interval}</p></td>
                <td className="px-5 py-3"><StatusBadge status={s.status === "active" && s.endsAt && new Date(s.endsAt) <= new Date() ? "expired" : s.status} /></td>
                <td className="px-5 py-3 text-xs text-slate-600">{dateLabel(s.startsAt)} → {dateLabel(s.endsAt)}</td>
                <td className="px-5 py-3 text-xs text-slate-600">{s.provider.replace("manual_", "").replaceAll("_", " ")}{s.reference && <span className="block font-mono">{s.reference}</span>}</td>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel title="Payments" padded={false}>
          <DataTable minWidth={520} head={["Date", "Channel", "Reference", "Amount"]} empty={!payments.length && <EmptyState icon={CreditCard} title="No payments recorded" />}>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-3 text-xs text-slate-600">{dateTimeLabel(p.createdAt)}</td>
                <td className="px-5 py-3">{p.provider.replace("manual_", "").replaceAll("_", " ")}</td>
                <td className="px-5 py-3 font-mono text-xs">{p.reference}</td>
                <td className="px-5 py-3 font-semibold tabular-nums">{money(p.amountPaise)} <StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>

      <Panel title="Account history" description="Registration, sign-ins and every change made from the Control Center" padded={false}>
        {!timeline.length ? <EmptyState icon={History} title="No history recorded" /> : (
          <ol className="divide-y divide-slate-100">
            {timeline.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
                <time className="w-44 shrink-0 text-xs text-slate-400">{dateTimeLabel(t.createdAt)}</time>
                <span className="text-sm font-medium text-slate-800">{actionLabel(t.action)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {typeof t.after?.reason === "string" ? `“${t.after.reason}”` : ""}{t.actorEmail ? ` · ${t.actorEmail}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {action && (
        <Modal open title={action.type === "trial" ? "Extend free trial" : action.status === "suspended" ? "Suspend account" : "Reactivate account"} onClose={() => setAction(null)}
          footer={<><Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button type="submit" form="customer-action" variant={action.type === "status" && action.status === "suspended" ? "danger" : "primary"} loading={saving}>{action.type === "trial" ? `Extend by ${days || 0} days` : action.status === "suspended" ? "Suspend account" : "Reactivate account"}</Button></>}>
          <form id="customer-action" onSubmit={submit} className="space-y-4">
            {actionError && <Alert>{actionError}</Alert>}
            <p className="text-sm text-slate-600">{org.name}{owner ? ` · ${owner.email}` : ""}</p>
            {action.type === "status" && action.status === "suspended" && <Alert tone="amber">All staff of this business will be blocked from DryCare immediately. Their data is kept and access returns when you reactivate.</Alert>}
            {action.type === "trial" && (
              <Field label="Additional days" required hint={`Current end: ${dateLabel(org.trialEndsAt)}. Maximum 90 days per extension.`}>
                <Input type="number" min={1} max={90} required value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            )}
            <Field label="Reason" required hint="Saved permanently in the audit log. Minimum 8 characters.">
              <Textarea rows={3} minLength={8} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action.type === "trial" ? "e.g. Owner requested more time to set up both branches" : "e.g. Payment not received after three reminders"} />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BackLink() {
  return <Link href="/super-admin/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />All customers</Link>;
}

function InfoCard({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Icon className="h-4 w-4" />{title}</p>
      <div className="space-y-0.5 text-sm">{children}</div>
    </div>
  );
}

export default function CustomerDetailPage() {
  return <Suspense><CustomerDetailInner /></Suspense>;
}
