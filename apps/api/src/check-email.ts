/** `pnpm email:check` — tests the SMTP / Resend login without sending; add `--to you@example.com` to send a test email. */
import { emailFrom, emailProvider, sendEmail, verifyEmail } from "./lib/mailer";

async function main() {
  const provider = emailProvider();
  if (!provider) {
    console.log("Email is NOT configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (or RESEND_API_KEY + EMAIL_FROM) in .env.");
    process.exitCode = 1;
    return;
  }
  console.log(`Provider: ${provider} · sender: ${emailFrom()}`);
  const check = await verifyEmail();
  if (!check.ok) {
    console.log(`FAILED: ${check.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(provider === "smtp" ? "OK: connected and signed in to the mail server." : "OK: Resend is configured (it is checked when the first email is sent).");
  const index = process.argv.indexOf("--to");
  const to = index >= 0 ? process.argv[index + 1] : undefined;
  if (to) {
    const sent = await sendEmail({ to, subject: "DryCare test email", text: "This is a test email from DryCare. Email delivery is working." });
    console.log(sent.ok ? `Test email sent to ${to}.` : `Test email FAILED: ${sent.error}`);
    if (!sent.ok) process.exitCode = 1;
  }
}

void main();
