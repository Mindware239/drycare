/**
 * Outgoing email. Uses SMTP (e.g. Gmail, Zoho, Outlook) when SMTP_HOST / SMTP_USER / SMTP_PASS are set,
 * otherwise Resend when RESEND_API_KEY is set. The sender is EMAIL_FROM, or the SMTP login when EMAIL_FROM is empty.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

export type EmailResult = { ok: boolean; providerId?: string; error?: string; permanent?: boolean };

const smtpReady = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

export function emailProvider(): "smtp" | "resend" | null {
  if (smtpReady()) return "smtp";
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return "resend";
  return null;
}

export const emailConfigured = () => emailProvider() !== null;

export function emailFrom() {
  if (env.EMAIL_FROM) return env.EMAIL_FROM;
  return smtpReady() ? `DryCare <${env.SMTP_USER}>` : null;
}

let transport: Transporter | undefined;
function smtp() {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    // Gmail shows app passwords in groups of four; the spaces are not part of the password.
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS!.replace(/\s+/g, "") },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transport;
}

/** Checks that the configured provider accepts our login, without sending anything. */
export async function verifyEmail(): Promise<EmailResult> {
  const provider = emailProvider();
  if (!provider) return { ok: false, error: "Email is not configured" };
  if (provider === "resend") return { ok: true };
  try {
    await smtp().verify();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: smtpError(cause) };
  }
}

function smtpError(cause: unknown) {
  const e = cause as { code?: string; responseCode?: number; response?: string; message?: string };
  if (e.code === "EAUTH") return `The mail server rejected the SMTP username or password (${e.responseCode ?? "auth"}). For Gmail, use a 16-character app password.`;
  return `${e.code ?? "SMTP"}: ${String(e.response ?? e.message ?? cause).slice(0, 300)}`;
}

export async function sendEmail(message: { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> }): Promise<EmailResult> {
  const provider = emailProvider();
  const from = emailFrom();
  if (!provider || !from) return { ok: false, error: "Email is not configured", permanent: true };

  if (provider === "smtp") {
    try {
      const info = await smtp().sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html, headers: message.headers });
      return { ok: true, providerId: info.messageId };
    } catch (cause) {
      const e = cause as { code?: string; responseCode?: number };
      // 5xx replies about the recipient are permanent; login, connection and 4xx failures are worth retrying.
      const permanent = typeof e.responseCode === "number" && e.responseCode >= 550 && e.code !== "EAUTH";
      return { ok: false, error: smtpError(cause), permanent };
    }
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}), ...(message.headers ? { headers: message.headers } : {}) }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `Resend returned ${response.status}: ${responseText.slice(0, 300)}`,
      permanent: response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429,
    };
  }
  try {
    return { ok: true, providerId: (JSON.parse(responseText) as { id?: string }).id };
  } catch {
    return { ok: false, error: "Resend returned an invalid response", permanent: false };
  }
}
