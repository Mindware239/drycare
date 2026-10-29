"use client";
import { useState } from "react";
import { CalendarClock, CheckCircle2, Mail, Megaphone, Send, Users } from "lucide-react";
import { api, ApiError, useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

type Audience = { type: "all" } | { type: "inactive"; inactiveDays: number };
type Campaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  audience: Audience;
  couponCode: string | null;
  discountBps: number | null;
  couponExpiresAt: string | null;
  status: string;
  scheduledAt: string | null;
  recipientCount: number | null;
  createdAt: string;
  sentAt: string | null;
  createdByName: string | null;
  sentCount: number;
  failedCount: number;
  queuedCount: number;
};
type MarketingStatus = {
  emailConfigured: boolean;
  marketingConfigured: boolean;
  emailFrom: string | null;
  optedInCustomers: { count: number }[];
};

const campaignState: Record<string, { label: string; tone: "slate" | "green" | "amber" | "red" | "blue" }> = {
  draft: { label: "Draft", tone: "slate" },
  scheduled: { label: "Scheduled", tone: "blue" },
  processing: { label: "Preparing", tone: "amber" },
  sending: { label: "Sending", tone: "amber" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Delivery issues", tone: "red" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

export default function CampaignsPage() {
  const { session } = useSession();
  const status = useApi<MarketingStatus>("/marketing/status");
  const campaigns = useApi<Campaign[]>("/marketing/campaigns");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audienceType, setAudienceType] = useState<"all" | "inactive">("all");
  const [inactiveDays, setInactiveDays] = useState("60");
  const [discountPercent, setDiscountPercent] = useState("");
  const [couponExpires, setCouponExpires] = useState("");
  const [couponMaxRedemptions, setCouponMaxRedemptions] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState<{ recipientCount: number; cooldownDays: number } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  if (session.role.key !== "owner") return <Alert>Only the store owner can create and manage promotional campaigns.</Alert>;

  const audience: Audience = audienceType === "inactive"
    ? { type: "inactive", inactiveDays: Number(inactiveDays) }
    : { type: "all" };

  async function previewAudience() {
    setError("");
    setSuccess("");
    try {
      const result = await api<{ recipientCount: number; cooldownDays: number }>("/marketing/preview", { body: { audience } });
      setPreview(result);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function saveCampaign(action: "draft" | "schedule" | "send") {
    setError("");
    setSuccess("");
    if (action === "send" && !window.confirm("Queue this email campaign for all currently eligible, opted-in customers?")) return;
    setBusy(true);
    try {
      const result = await api<{ campaign: Campaign; recipientCount: number | null }>("/marketing/campaigns", {
        body: {
          name,
          subject,
          body,
          audience,
          ...(discountPercent ? {
            discountPercent: Number(discountPercent),
            couponExpiresAt: new Date(`${couponExpires}T23:59:59`).toISOString(),
            ...(couponMaxRedemptions ? { couponMaxRedemptions: Number(couponMaxRedemptions) } : {}),
          } : {}),
          action,
          ...(action === "schedule" ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        },
      });
      setName("");
      setSubject("");
      setBody("");
      setScheduledAt("");
      setDiscountPercent("");
      setCouponExpires("");
      setCouponMaxRedemptions("");
      setPreview(null);
      setSuccess(action === "send"
        ? `Campaign queued for ${result.recipientCount ?? 0} eligible email address(es).`
        : action === "schedule"
          ? "Campaign scheduled. The worker will queue it at the selected time."
          : "Draft saved.");
      campaigns.reload();
      status.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCampaign(campaign: Campaign) {
    setError("");
    try {
      await api(`/marketing/campaigns/${campaign.id}/cancel`, { body: {} });
      campaigns.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function sendDraft(campaign: Campaign) {
    setError("");
    setSuccess("");
    try {
      const audiencePreview = await api<{ recipientCount: number }>("/marketing/preview", { body: { audience: campaign.audience } });
      if (!audiencePreview.recipientCount) {
        setError("This draft currently has no eligible recipients.");
        return;
      }
      if (!window.confirm(`Queue “${campaign.name}” for ${audiencePreview.recipientCount} eligible opted-in email address(es)?`)) return;
      const result = await api<{ recipientCount: number }>(`/marketing/campaigns/${campaign.id}/send`, { body: {} });
      setSuccess(`Campaign queued for ${result.recipientCount} eligible email address(es).`);
      campaigns.reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const optedInCount = Number(status.data?.optedInCustomers?.[0]?.count ?? 0);
  const canSend = !!status.data?.marketingConfigured;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Marketing campaigns"
        subtitle="Create seasonal offers and win-back emails for customers who explicitly opted in."
      />

      {status.error && <Alert>{status.error.message}</Alert>}
      {campaigns.error && <Alert>{campaigns.error.message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {success && <Alert tone="green">{success}</Alert>}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">Eligible customer base</p><Users className="h-4 w-4 text-brand-700" /></div>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{status.loading ? "—" : optedInCount}</p>
          <p className="mt-1 text-xs text-slate-500">Active customers with marketing consent and an email</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">Email delivery</p><Mail className="h-4 w-4 text-brand-700" /></div>
          <p className="mt-2 text-lg font-semibold text-slate-950">{status.data?.emailConfigured ? "Email configured" : "Not configured"}</p>
          <p className="mt-1 break-all text-xs text-slate-500">{status.data?.emailFrom ?? "Set Resend API key and sender address in the API environment"}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-500">Marketing safeguards</p><CheckCircle2 className="h-4 w-4 text-emerald-700" /></div>
          <p className="mt-2 text-lg font-semibold text-slate-950">Consent + opt-out</p>
          <p className="mt-1 text-xs text-slate-500">Promotional emails require opt-in and include unsubscribe links. 90-day send cooldown.</p>
        </div>
      </section>

      {!canSend && (
        <Alert tone="amber">
          Campaigns can be saved as drafts, but scheduling or sending is disabled until email (SMTP or Resend) and <code>MARKETING_UNSUBSCRIBE_SECRET</code> are set. Add them to the API&apos;s local environment, then restart the API and worker. Never put these values in source control or chat.
        </Alert>
      )}

      <Card title={<span className="inline-flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand-700" />Compose a campaign</span>}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <div className="space-y-3">
            <Field label="Internal campaign name" required hint="Only your team sees this.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Diwali 2026 offer" />
            </Field>
            <Field label="Email subject" required>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder="A festive refresh for your wardrobe" />
            </Field>
            <Field label="Message" required hint="Plain text email. State the offer clearly and include any terms customers should know.">
              <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} placeholder={"Hello,\n\nCelebrate the season with ...\n\nOffer valid until ..."} />
            </Field>
            <p className="text-xs text-slate-500">This sends promotional email copy only; it does not create an automatic redeemable discount or change order prices.</p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <Field label="Audience">
              <Select value={audienceType} onChange={(e) => { setAudienceType(e.target.value as "all" | "inactive"); setPreview(null); }}>
                <option value="all">All eligible opted-in customers</option>
                <option value="inactive">Customers with an older last order</option>
              </Select>
            </Field>
            {audienceType === "inactive" && (
              <Field label="No order in the last (days)" hint="Choose 30–365 days; customers need at least one completed, non-cancelled order.">
                <Input type="number" min={30} max={365} value={inactiveDays} onChange={(e) => { setInactiveDays(e.target.value); setPreview(null); }} />
              </Field>
            )}
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              Only active customers with marketing consent and a valid email are included. Customers sent a promotion within the last 90 days are excluded. Consent is checked again immediately before delivery.
            </div>
            <Button type="button" variant="secondary" onClick={previewAudience}><Users className="h-4 w-4" />Preview eligible audience</Button>
            {preview && <p className="text-sm font-medium text-slate-800">Estimated recipients: <span className="tabular-nums">{preview.recipientCount}</span></p>}
            <div className="border-t border-slate-200 pt-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Redeemable discount (optional)</h3>
              <p className="mb-3 text-xs text-slate-500">Creates a coupon DryCare validates during order pricing. Include <code>{"{{coupon_code}}"}</code> in your message.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Discount percent">
                  <Input type="number" min={1} max={100} value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} placeholder="e.g. 10" />
                </Field>
                {discountPercent && <>
                  <Field label="Coupon expires" required>
                    <Input type="date" value={couponExpires} onChange={(e) => setCouponExpires(e.target.value)} />
                  </Field>
                  <Field label="Maximum redemptions" hint="Optional total-use limit">
                    <Input type="number" min={1} value={couponMaxRedemptions} onChange={(e) => setCouponMaxRedemptions(e.target.value)} placeholder="Unlimited" />
                  </Field>
                </>}
              </div>
            </div>
            <div className="border-t border-slate-200 pt-3">
              <Field label="Schedule send (optional)" hint="Leave blank to choose Send now, or save a draft.">
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || !name.trim() || subject.trim().length < 2 || body.trim().length < 5 || (!!discountPercent && (!couponExpires || Number(discountPercent) < 1 || Number(discountPercent) > 100))} loading={busy} onClick={() => saveCampaign("draft")}>Save draft</Button>
              {scheduledAt && <Button disabled={busy || !canSend || !preview || preview.recipientCount === 0 || !name.trim() || subject.trim().length < 2 || body.trim().length < 5 || (!!discountPercent && (!couponExpires || !body.includes("{{coupon_code}}")))} loading={busy} onClick={() => saveCampaign("schedule")}><CalendarClock className="h-4 w-4" />Schedule</Button>}
              {!scheduledAt && <Button disabled={busy || !canSend || !preview || preview.recipientCount === 0 || !name.trim() || subject.trim().length < 2 || body.trim().length < 5 || (!!discountPercent && (!couponExpires || !body.includes("{{coupon_code}}")))} loading={busy} onClick={() => saveCampaign("send")}><Send className="h-4 w-4" />Send now</Button>}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Campaign history" padded={false}>
        {campaigns.loading && !campaigns.data ? <div className="p-6"><Spinner /></div> : campaigns.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {campaigns.data.map((campaign) => {
              const status = campaignState[campaign.status] ?? { label: campaign.status, tone: "slate" as const };
              return (
                <li key={campaign.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{campaign.name}</h3>
                      <Badge color={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{campaign.subject}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {campaign.audience.type === "inactive" ? `No order in ${campaign.audience.inactiveDays}+ days` : "All eligible opted-in customers"}
                      {" · "}{campaign.recipientCount ?? "Not queued"} recipients
                      {campaign.status === "scheduled" && campaign.scheduledAt ? ` · Sends ${dateTime(campaign.scheduledAt)}` : ""}
                    </p>
                    {campaign.recipientCount !== null && <p className="mt-1 text-xs text-slate-500">Sent {campaign.sentCount} · Queued {campaign.queuedCount} · Failed {campaign.failedCount}</p>}
                    {campaign.couponCode && <p className="mt-1 text-xs font-medium text-brand-700">{campaign.discountBps ? `${campaign.discountBps / 100}% off` : "Coupon"} code: {campaign.couponCode} · expires {dateTime(campaign.couponExpiresAt)}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">Created {dateTime(campaign.createdAt)}{campaign.createdByName ? ` by ${campaign.createdByName}` : ""}</p>
                  </div>
                  {(campaign.status === "draft" || campaign.status === "scheduled") && (
                    <div className="flex shrink-0 gap-2">
                      {campaign.status === "draft" && <Button size="sm" variant="secondary" disabled={!canSend} onClick={() => sendDraft(campaign)}><Send className="h-3.5 w-3.5" />Send draft</Button>}
                      <Button size="sm" variant="ghost" className={cx("self-start text-red-700 hover:bg-red-50")} onClick={() => cancelCampaign(campaign)}>Cancel</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <div className="px-4 py-10 text-center"><Megaphone className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-800">No campaigns created</p><p className="mt-1 text-sm text-slate-500">Create a draft, preview its audience, then send or schedule it.</p></div>}
      </Card>
    </div>
  );
}
