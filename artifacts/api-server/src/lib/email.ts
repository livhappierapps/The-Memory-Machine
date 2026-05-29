import { Resend } from "resend";
import { logger } from "./logger";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Memory Machine <noreply@memorymachine.app>";
const APP_URL = process.env.APP_URL ?? "https://memorymachine.replit.app";

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!resend) {
    logger.warn({ to, subject }, "Email not sent — RESEND_API_KEY not configured");
    return false;
  }
  try {
    const result = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (result.error) {
      logger.error({ err: result.error, to, subject }, "Resend error sending email");
      return false;
    }
    logger.info({ to, subject }, "Email sent");
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
    return false;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;background:#1a1a22;color:#e0e0e0;margin:0;padding:0}
  .container{max-width:560px;margin:40px auto;padding:32px;background:#2f2f37;border-radius:12px;border:1px solid #444}
  h1{color:#1ad4be;font-size:22px;margin-top:0}
  .otp{font-size:36px;font-weight:700;letter-spacing:8px;color:#1ad4be;background:#1a1a22;padding:16px 24px;border-radius:8px;text-align:center;margin:24px 0}
  .btn{display:inline-block;padding:14px 28px;background:#1ad4be;color:#1a1a22;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:16px 0}
  .cancel-btn{display:inline-block;padding:14px 28px;background:#e53e3e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:16px 0}
  .warning{background:#7f1d1d;border:1px solid #e53e3e;border-radius:8px;padding:16px;margin:20px 0;color:#fca5a5}
  .muted{color:#888;font-size:13px}
  p{line-height:1.6}</style></head>
  <body><div class="container">${body}<p class="muted">You're receiving this because you have an account with Memory Machine. If you didn't request this, <a href="${APP_URL}" style="color:#1ad4be">sign in immediately</a> and change your password.</p></div></body></html>`;
}

export function deletionInitiatedEmail(opts: {
  otp: string;
  targetType: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  cancelUrl: string;
  waitHours: number;
}): { subject: string; html: string } {
  const subject = "⚠️ Deletion request initiated — Memory Machine";
  const rangeText =
    opts.targetType === "account"
      ? "your entire account"
      : opts.targetType === "history"
        ? "your full conversation history"
        : opts.dateFrom || opts.dateTo
          ? `conversations from ${formatDate(opts.dateFrom)} to ${formatDate(opts.dateTo)}`
          : "selected conversations";
  const body = `<h1>Deletion request received</h1>
  <p>A request was made to delete <strong>${rangeText}</strong> from your Memory Machine account.</p>
  <div class="warning">⚠ This action has a <strong>${opts.waitHours >= 336 ? "2-week" : "24-hour"}</strong> waiting period before it is executed. You can cancel at any time during this window.</div>
  <p>Enter this verification code to confirm the request:</p>
  <div class="otp">${opts.otp}</div>
  <p>Or click the button below to <strong>cancel this deletion immediately</strong>:</p>
  <a href="${opts.cancelUrl}" class="cancel-btn">Cancel Deletion Now</a>
  <p class="muted">This code expires in 15 minutes. If you didn't request this, <strong>cancel immediately</strong> — someone may have access to your account.</p>`;
  return { subject, html: baseTemplate(subject, body) };
}

export function deletionCancelledEmail(opts: { targetType: string }): { subject: string; html: string } {
  const subject = "Deletion cancelled — Memory Machine";
  const typeLabel =
    opts.targetType === "account" ? "account deletion" : opts.targetType === "history" ? "full history deletion" : "conversation deletion";
  const body = `<h1>Deletion cancelled</h1>
  <p>Your <strong>${typeLabel}</strong> request has been successfully cancelled. Your data is safe.</p>
  <p>If you didn't cancel this yourself, your account may be compromised. <a href="${APP_URL}/settings" style="color:#1ad4be">Check your account settings</a> and change your password immediately.</p>`;
  return { subject, html: baseTemplate(subject, body) };
}

export function deletionLinkEmail(opts: {
  targetType: string;
  executeAt: string;
  executeUrl: string;
  cancelUrl: string;
}): { subject: string; html: string } {
  const subject = "⚠️ Final deletion link — Memory Machine";
  const typeLabel =
    opts.targetType === "account"
      ? "your entire account"
      : opts.targetType === "history"
        ? "your full conversation history"
        : "selected conversations";
  const body = `<h1>Ready to execute deletion</h1>
  <div class="warning">⚠ This is the final step. Clicking the link below will <strong>permanently delete</strong> ${typeLabel}. This cannot be undone.</div>
  <p>Click below to proceed with deletion. You will be asked for one final verification code.</p>
  <a href="${opts.executeUrl}" class="btn">Proceed with Deletion</a>
  <p>Or cancel immediately:</p>
  <a href="${opts.cancelUrl}" class="cancel-btn">Cancel — Keep My Data</a>
  <p class="muted">This link expires in 48 hours. Do not share it with anyone.</p>`;
  return { subject, html: baseTemplate(subject, body) };
}

export function deletionConfirmedEmail(opts: { targetType: string }): { subject: string; html: string } {
  const subject = "Deletion complete — Memory Machine";
  const typeLabel =
    opts.targetType === "account"
      ? "Your account and all associated data have"
      : opts.targetType === "history"
        ? "Your full conversation history has"
        : "The selected conversations have";
  const body = `<h1>Deletion complete</h1>
  <p>${typeLabel} been permanently deleted from Memory Machine.</p>
  <p class="muted">We store no backups of deleted data beyond your own snapshot files (if you created any). Your privacy is paramount.</p>`;
  return { subject, html: baseTemplate(subject, body) };
}

export function latePaymentEmail(): { subject: string; html: string } {
  const subject = "Payment overdue — Memory Machine";
  const body = `<h1>Outstanding payment</h1>
  <div class="warning">⚠ Your Memory Machine account has an outstanding payment. Some features may be limited soon.</div>
  <p>Please update your payment method to keep full access to your account.</p>
  <a href="${APP_URL}/settings" class="btn">Update Payment</a>`;
  return { subject, html: baseTemplate(subject, body) };
}

export { APP_URL };
