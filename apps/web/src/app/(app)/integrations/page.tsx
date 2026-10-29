"use client";

import { AlertCircle, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { Alert, Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";
import { LinkedPcCard } from "@/components/LinkedPcCard";

interface IntegrationStatus {
  emailProviderConfigured: boolean;
  senderEmail: string | null;
  approvalOtpConfigured: boolean;
  marketingEmailConfigured: boolean;
}

export default function IntegrationsPage() {
  const status = useApi<IntegrationStatus>("/system/integrations");
  if (status.loading) return <Spinner />;
  if (status.error) return <Alert>Could not load integration status: {status.error.message}</Alert>;
  if (!status.data) return <Alert>Integration status is unavailable.</Alert>;

  const ready = status.data.emailProviderConfigured;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations & notifications"
        subtitle="Check email delivery setup for customer messages, approval codes, and campaigns."
      />
      <LinkedPcCard />

      <Card
        title={
          <span className="flex items-center gap-2">
            <Mail aria-hidden="true" className="h-4 w-4 text-brand-600" />
            Resend email
          </span>
        }
        actions={<Badge color={ready ? "green" : "amber"}>{ready ? "Provider configured" : "Setup required"}</Badge>}
      >
        <p className="text-sm text-slate-600">
          The sender address is the business email shown to customers. Approval OTPs are sent to the email address saved on that customer&apos;s profile.
        </p>
        <dl className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Sender address</dt>
            <dd className="mt-1 font-medium text-slate-900">{status.data.senderEmail ?? "Not configured"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email provider</dt>
            <dd className="mt-1 font-medium text-slate-900">{ready ? "Resend is ready" : "Waiting for API configuration"}</dd>
          </div>
        </dl>
        {!ready && (
          <div className="mt-4">
            <Alert tone="amber">
              Add the settings below to the workspace-root <code>.env</code> file. Do not paste API keys into DryCare, source control, or support messages.
            </Alert>
          </div>
        )}
        <div className="mt-4 space-y-3">
          <div className="flex gap-3">
            {ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
            <div>
              <p className="text-sm font-semibold text-slate-900">Configure the sender and provider</p>
              <p className="mt-1 text-sm text-slate-600">
                Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> (for Gmail, a 16-character app password), or <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> for Resend. Run <code>pnpm email:check</code> to test.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            {status.data.approvalOtpConfigured ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
            <div>
              <p className="text-sm font-semibold text-slate-900">Customer approval email OTP</p>
              <p className="mt-1 text-sm text-slate-600">
                {status.data.approvalOtpConfigured
                  ? "Email delivery and the approval signing secret are configured."
                  : <>Also set <code>CUSTOMER_APPROVAL_SECRET</code> to a random secret of at least 32 characters to enable email OTP.</>}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            {status.data.marketingEmailConfigured ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
            <div>
              <p className="text-sm font-semibold text-slate-900">Marketing campaign emails</p>
              <p className="mt-1 text-sm text-slate-600">
                {status.data.marketingEmailConfigured
                  ? "Email sending and unsubscribe protection are configured."
                  : <>Also set <code>MARKETING_UNSUBSCRIBE_SECRET</code> to enable campaign sending with unsubscribe protection.</>}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Start delivery after configuration">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>Save the environment settings in the workspace-root <code>.env</code> file.</li>
          <li>Restart the API so it loads the new settings.</li>
          <li>In another terminal, start the notification worker with <code>pnpm dev:worker</code>. The regular <code>pnpm dev</code> command does not start this worker.</li>
          <li>Update the customer&apos;s email in Customers before requesting an email OTP.</li>
        </ol>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <p>SMS OTP is not available yet because no SMS provider is configured. This page reports configuration status only; it never reads or displays provider secrets.</p>
        </div>
      </Card>
    </div>
  );
}
