"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, CalendarPlus, Clock3, Flame, Hourglass, IndianRupee, Mail, MailCheck, MessageCircle, Phone, Search, Sparkles, TrendingUp, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { ConsoleHeader, CsvButton, DataTable, EmptyState, LoadingRows, MetricCard, Pager, Panel, SegmentedTabs, dateLabel, exportCsv, relativeDays, useAdminData } from "../admin-ui";
import type { CustomerRow } from "../customers/CustomerList";

type Row = CustomerRow & { orders7d: number; firstPaidAt: string | null };
type Summary = { active: number; endingSoon: number; lapsed: number; newThisWeek: number; started90: number; converted90: number; noOrders: number; trialDays: number; conversionRate: number | null };
type Tab = "active" | "expiring" | "lapsed" | "converted";

const daysLeft = (end: string | null) => (end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000) : null);

/** How likely the shop is to buy, from what it actually did during the trial. */
function engagement(r: Row): { label: string; tone: string; icon: typeof Flame } {
  const recentLogin = r.lastLoginAt && Date.now() - new Date(r.lastLoginAt).getTime() < 3 * 86_400_000;
  if (r.orders7d >= 10 || (r.orders >= 20 && recentLogin)) return { label: "Hot", tone: "bg-rose-50 text-rose-700 ring-rose-200", icon: Flame };
  if (r.orders > 0 && recentLogin) return { label: "Engaged", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: TrendingUp };
  if (r.orders > 0) return { label: "Tried it", tone: "bg-blue-50 text-blue-700 ring-blue-200", icon: Sparkles };
  return { label: "At risk", tone: "bg-amber-50 text-amber-800 ring-amber-200", icon: Hourglass };
}

const waNumber = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
};

function TrialsInner() {
  const params = useSearchParams();
  const initial = params.get("window");
  const [tab, setTab] = useState<Tab>(initial === "expiring" || initial === "lapsed" || initial === "converted" ? initial : "active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [extendFor, setExtendFor] = useState<Row | null>(null);
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const summary = useAdminData<Summary>("/platform-admin/trials/summary");
  const status = tab === "converted" ? "all" : "trial";
  const sort = tab === "converted" ? "newest" : "trial_end";
  const list = useAdminData<{ items: Row[]; total: number; page: number; pageSize: number }>(`/platform-admin/customers?${new URLSearchParams({ search, status, window: tab, sort, page: String(page), pageSize: "25" })}`);
  const s = summary.data;
  const rows = list.data?.items ?? [];

  async function remind(r: Row) {
    setSending(r.id);
    setNotice(null);
    try {
      const res = await api<{ to: string }>(`/platform-admin/organizations/${r.id}/trial-reminder`, { body: {} });
      setNotice({ tone: "green", text: `Reminder emailed to ${res.to}.` });
    } catch (e) {
      setNotice({ tone: "red", text: e instanceof Error ? e.message : "Could not send the reminder." });
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      <ConsoleHeader title="Free trials" description={`Every new shop gets a ${s?.trialDays ?? 7}-day free trial. Follow up before it ends, extend it when there's a good reason, and record the first payment to convert it.`}
        actions={<CsvButton disabled={!rows.length} onClick={() => exportCsv(`drycare-trials-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => ({ Business: r.name, Owner: r.ownerName ?? "", Email: r.ownerEmail ?? "", Phone: r.ownerPhone ?? "", City: r.city ?? "", "Trial ends": r.trialEndsAt?.slice(0, 10) ?? "", "Days left": daysLeft(r.trialEndsAt) ?? "", Orders: r.orders, "Orders (7 days)": r.orders7d, "Last sign-in": r.lastLoginAt?.slice(0, 10) ?? "", Engagement: engagement(r).label })))} />} />
      {notice && <div className="mb-5"><Alert tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Alert></div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Clock3} label="Active trials" value={s?.active ?? "—"} detail={`${s?.noOrders ?? 0} haven't created an order yet`} href="/super-admin/trials?window=active" />
        <MetricCard icon={Hourglass} label="Ending in 3 days" value={s?.endingSoon ?? "—"} tone="amber" detail="Call or remind them now" href="/super-admin/trials?window=expiring" />
        <MetricCard icon={IndianRupee} label="Lapsed, unpaid" value={s?.lapsed ?? "—"} tone="red" detail="Read-only until they pay" href="/super-admin/trials?window=lapsed" />
        <MetricCard icon={BadgeCheck} label="Trial → paid (90 days)" value={s?.conversionRate == null ? "—" : `${Math.round(s.conversionRate * 100)}%`} tone="emerald" detail={`${s?.converted90 ?? 0} of ${s?.started90 ?? 0} trials converted`} href="/super-admin/trials?window=converted" />
        <MetricCard icon={UserPlus} label="New this week" value={s?.newThisWeek ?? "—"} tone="violet" detail="Sign-ups in the last 7 days" />
      </div>

      <Panel padded={false}
        title={<SegmentedTabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} options={[
          { value: "active", label: "Active", count: s?.active }, { value: "expiring", label: "Ending soon", count: s?.endingSoon },
          { value: "lapsed", label: "Lapsed", count: s?.lapsed }, { value: "converted", label: "Converted" },
        ]} />}
        actions={
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Business, owner, email or phone" className="w-64 pl-9" aria-label="Search trials" />
          </label>
        }>
        {list.error && <div className="p-4"><Alert>{list.error}</Alert></div>}
        {!list.data ? <LoadingRows /> : (
          <>
            <DataTable minWidth={1040} head={["Business", tab === "converted" ? "Paid since" : "Trial", "Activity", "Signal", "Follow up"]}
              empty={!rows.length && <EmptyState icon={Clock3} title={tab === "converted" ? "No converted trials yet" : "No trials here"}>{tab === "expiring" ? "No trial ends in the next 7 days." : tab === "lapsed" ? "No lapsed, unpaid trials. Nice work." : "New sign-ups appear here automatically."}</EmptyState>}>
              {rows.map((r) => {
                const d = daysLeft(r.trialEndsAt);
                const total = s?.trialDays ?? 7;
                const pct = d === null ? 100 : Math.max(0, Math.min(100, ((total - d) / total) * 100));
                const e = engagement(r);
                return (
                  <tr key={r.id} className="align-top hover:bg-slate-50/60">
                    <td className="px-5 py-4">
                      <Link href={`/super-admin/customers/view?id=${r.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{r.name}</Link>
                      <p className="mt-0.5 text-xs text-slate-500">{r.ownerName ?? "—"}{r.city ? ` · ${r.city}` : ""}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">{r.ownerVerifiedAt ? <MailCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Mail className="h-3.5 w-3.5 text-amber-600" />}{r.ownerEmail ?? "no email"}</p>
                    </td>
                    <td className="w-56 px-5 py-4">
                      {tab === "converted" ? (
                        <><p className="font-medium text-slate-800">{dateLabel(r.firstPaidAt)}</p><p className="text-xs text-slate-500">{r.planName ?? "Plan"} · trial started {dateLabel(r.trialStartedAt)}</p></>
                      ) : (
                        <>
                          <p className={cx("text-sm font-semibold", d === null ? "text-slate-600" : d < 0 ? "text-red-700" : d <= 3 ? "text-amber-700" : "text-slate-800")}>
                            {d === null ? "No end date" : d < 0 ? `Ended ${relativeDays(r.trialEndsAt)}` : d === 0 ? "Ends today" : `${d} day${d === 1 ? "" : "s"} left`}
                          </p>
                          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><span className={cx("block h-full rounded-full", d !== null && d < 0 ? "bg-red-500" : d !== null && d <= 3 ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${pct}%` }} /></span>
                          <p className="mt-1 text-xs text-slate-500">Started {dateLabel(r.trialStartedAt)} · ends {dateLabel(r.trialEndsAt)}</p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      <p><strong className="text-sm text-slate-900">{r.orders}</strong> orders · <strong className="text-slate-900">{r.orders7d}</strong> this week</p>
                      <p className="mt-0.5">{r.users} staff · {r.branches} branch{r.branches === 1 ? "" : "es"}</p>
                      <p className="mt-0.5">Last sign-in {r.lastLoginAt ? relativeDays(r.lastLoginAt) || "today" : "never"}</p>
                    </td>
                    <td className="px-5 py-4"><span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", e.tone)}><e.icon className="h-3.5 w-3.5" />{e.label}</span></td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {tab !== "converted" && <Button size="sm" onClick={() => setExtendFor(r)} variant="secondary"><CalendarPlus className="h-4 w-4" />Extend</Button>}
                        <Link href={`/super-admin/payments?org=${r.id}`}><Button size="sm"><IndianRupee className="h-4 w-4" />{tab === "converted" ? "Record renewal" : "Record payment"}</Button></Link>
                        {tab !== "converted" && r.ownerEmail && <Button size="sm" variant="secondary" loading={sending === r.id} onClick={() => void remind(r)}><Mail className="h-4 w-4" />Remind</Button>}
                        {r.ownerPhone && <a href={`tel:${r.ownerPhone}`} title={`Call ${r.ownerPhone}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"><Phone className="h-4 w-4" /></a>}
                        {r.ownerPhone && <a href={`https://wa.me/${waNumber(r.ownerPhone)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-emerald-600 hover:bg-emerald-50"><MessageCircle className="h-4 w-4" /></a>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </DataTable>
            {list.data.total > list.data.pageSize && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
          </>
        )}
      </Panel>
      {extendFor && <ExtendDialog row={extendFor} onClose={() => setExtendFor(null)} onDone={(text) => { setExtendFor(null); setNotice({ tone: "green", text }); void list.reload(); void summary.reload(); }} />}
    </>
  );
}

function ExtendDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: (text: string) => void }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError("");
    try {
      const org = await api<{ trialEndsAt: string }>(`/platform-admin/organizations/${row.id}/extend-trial`, { body: { days, reason } });
      onDone(`${row.name}'s trial now ends ${dateLabel(org.trialEndsAt)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not extend the trial.");
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`Extend trial for ${row.name}`}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-900">Extend free trial</h2><p className="text-sm text-slate-500">{row.name} · ends {dateLabel(row.trialEndsAt)}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <div className="mt-5 space-y-4">
          <Field label="Add">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}</Select>
          </Field>
          <Field label="Reason" required hint="Saved in the audit log, e.g. owner travelling, waiting for barcode printer">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} loading={saving} disabled={reason.trim().length < 8}><CalendarPlus className="h-4 w-4" />Extend by {days} days</Button>
        </div>
      </div>
    </div>
  );
}

export default function TrialsPage() {
  return <Suspense><TrialsInner /></Suspense>;
}
