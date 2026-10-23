import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

export type OtpPurpose = "verify_email" | "password_change" | "password_reset";

type Outbound = { to: string; subject: string; text: string; html: string; sentAt: Date };

const outbox: Outbound[] = [];

let transporter: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transporter === undefined) {
    transporter = env.SMTP_URL.length > 0 ? nodemailer.createTransport(env.SMTP_URL) : null;
  }
  return transporter;
}

/** Console transport for local runs without SMTP; tests read this outbox. */
export function getOutbox(): readonly Outbound[] {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}

const PURPOSE_COPY: Record<OtpPurpose, { subject: string; lead: string; action: string }> = {
  verify_email: {
    subject: "Verify your email",
    lead: `Welcome to ${env.APP_NAME}. Use this code to finish creating your account:`,
    action: "verify your email",
  },
  password_change: {
    subject: "Confirm your password change",
    lead: "Use this code to confirm the password change you requested:",
    action: "change your password",
  },
  password_reset: {
    subject: "Reset your password",
    lead: "Use this code to choose a new password:",
    action: "reset your password",
  },
};

function renderOtp(code: string, lead: string, minutes: number): { text: string; html: string } {
  const text = `${lead}\n\n${code}\n\nThis code expires in ${minutes} minutes. If you did not request it, ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px">
  <p>${lead}</p>
  <p style="font-size:28px;letter-spacing:6px;font-weight:600;margin:24px 0">${code}</p>
  <p style="color:#666">This code expires in ${minutes} minutes. If you did not request it, ignore this email.</p>
</div>`;
  return { text, html };
}

/**
 * Fire-and-forget: SMTP to a real relay costs seconds (connect, TLS, auth,
 * DATA, QUIT), and none of it is needed to answer the HTTP request. Failures
 * are logged; the user can request a new code.
 */
function deliver(mail: Omit<Outbound, "sentAt">): void {
  const transport = getTransport();
  if (!transport) {
    outbox.push({ ...mail, sentAt: new Date() });
    console.log(`[mail:console] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return;
  }
  transport.sendMail({ from: env.SMTP_FROM, ...mail }).catch((error: unknown) => {
    console.error(`[mail] delivery failed to=${mail.to} subject="${mail.subject}"`, error);
  });
}

export function sendOtpMail(
  to: string,
  code: string,
  purpose: OtpPurpose,
  firstName: string,
): void {
  const copy = PURPOSE_COPY[purpose];
  const body = renderOtp(code, `Hi ${firstName}, ${copy.lead}`, Math.round(env.OTP_TTL_SECONDS / 60));
  deliver({ to, subject: `${copy.subject} — ${env.APP_NAME}`, ...body });
}

export function sendAccountExistsMail(to: string, firstName: string): void {
  const text = `Hi ${firstName}, an account already exists for this address. If you forgot your password, use the reset link on the sign-in page.`;
  deliver({
    to,
    subject: `Your ${env.APP_NAME} account`,
    text,
    html: `<p>${text}</p>`,
  });
}

export function sendPasswordChangedMail(to: string, firstName: string): void {
  const text = `Hi ${firstName}, your password was changed and all other sessions were signed out. If this was not you, reset your password immediately.`;
  deliver({
    to,
    subject: "Your password was changed",
    text,
    html: `<p>${text}</p>`,
  });
}
