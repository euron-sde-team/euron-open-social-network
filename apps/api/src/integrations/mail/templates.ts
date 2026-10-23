/**
 * Email templates. Each returns subject + text + HTML. Values interpolated into HTML
 * are escaped; links are built by the caller from APP_WEB_URL.
 *
 * `network` is the name the admins gave the network (settings.networkName, see
 * networkName() in services/settings.service.ts); it falls back to PRODUCT_NAME.
 */
import type { MailMessage } from "./mailer";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function layout(network: string, title: string, bodyHtml: string): string {
  const product = escapeHtml(network);
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:16px;color:#1d4ed8">${product}</td></tr>
<tr><td style="padding:28px 32px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">You received this email because of activity on your ${product} account.</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>`;
}

export function verifyEmail(network: string, to: string, name: string, link: string): MailMessage {
  const subject = `Confirm your email for ${network}`;
  return {
    to,
    subject,
    text: `Hi ${name},\n\nConfirm your email address to finish setting up your account:\n${link}\n\nThe link expires in 24 hours.`,
    html: layout(network, "Confirm your email", `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email address to finish setting up your account.</p>${button(link, "Confirm email")}<p style="font-size:13px;color:#64748b">The link expires in 24 hours. If you did not sign up, ignore this email.</p>`),
  };
}

export function resetPassword(network: string, to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: `Reset your ${network} password`,
    text: `Hi ${name},\n\nReset your password here:\n${link}\n\nThe link expires in 1 hour. If you did not ask for this, ignore this email.`,
    html: layout(network, "Reset your password", `<p>Hi ${escapeHtml(name)},</p><p>Someone asked to reset the password on your account.</p>${button(link, "Choose a new password")}<p style="font-size:13px;color:#64748b">The link expires in 1 hour. If it was not you, ignore this email; your password is unchanged.</p>`),
  };
}

export function notificationDigest(network: string, to: string, name: string, lines: { text: string; href: string }[]): MailMessage {
  const items = lines.map((l) => `<li style="margin:0 0 8px"><a href="${escapeHtml(l.href)}" style="color:#1d4ed8">${escapeHtml(l.text)}</a></li>`).join("");
  return {
    to,
    subject: `You have ${lines.length} new notification${lines.length === 1 ? "" : "s"} on ${network}`,
    text: `Hi ${name},\n\n${lines.map((l) => `- ${l.text}: ${l.href}`).join("\n")}`,
    html: layout(network, "While you were away", `<p>Hi ${escapeHtml(name)},</p><ul style="padding-left:20px">${items}</ul>`),
  };
}
