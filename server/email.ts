import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./db/client";

export type EmailDeliveryStatus = "pending" | "sent" | "failed" | "skipped";
export type EmailSenderProfile = "operational" | "security";

interface EmailDeliveryInput {
  userId?: string;
  recipient: string;
  eventType: string;
  subject: string;
  html: string;
  senderProfile?: EmailSenderProfile;
  respectPreference?: boolean;
}

interface EmailDeliveryResult {
  id: string;
  configured: boolean;
  status: EmailDeliveryStatus;
  error?: string;
}

type EmailLanguage = "id" | "en";

function applicationUrl(path: string) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const basePath =
    configuredBasePath && configuredBasePath !== "/"
      ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
      : "";
  return new URL(`${basePath}${path}`, new URL(appUrl).origin).toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailFrame(
  title: string,
  message: string,
  action?: { label: string; url: string },
  language: EmailLanguage = "id",
) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message).replaceAll("\n", "<br />");
  const actionHtml = action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#007a74;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:9px">${escapeHtml(action.label)}</a></p>`
    : "";
  return `
    <div style="background:#f3f8f8;padding:32px 16px;font-family:Arial,sans-serif;color:#203f4d">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #d9e7e7;border-radius:16px;overflow:hidden">
        <div style="height:6px;background:#42beb9"></div>
        <div style="padding:30px">
          <div style="display:flex;align-items:center;gap:10px;margin:0 0 18px">
            <img src="${escapeHtml(applicationUrl("/perumnet-mark.png"))}" alt="PerumNet Enterprise" width="48" height="48" style="display:block;object-fit:contain" />
            <p style="margin:0;color:#0b817b;font-size:12px;font-weight:700;letter-spacing:1.5px">PERUMNET ENTERPRISE</p>
          </div>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.35;color:#203f4d">${safeTitle}</h1>
          <p style="margin:0;color:#5d737c;font-size:15px;line-height:1.7">${safeMessage}</p>
          ${actionHtml}
          <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e8efef;color:#809097;font-size:12px;line-height:1.6">
            ${language === "en" ? "Support" : "Bantuan"}: <a href="mailto:enterprise@perumnet.id" style="color:#0b817b">enterprise@perumnet.id</a>
          </p>
        </div>
      </div>
    </div>
  `;
}

async function preferenceAllowsEmail(
  client: DatabaseClient,
  userId: string | undefined,
) {
  if (!userId) return true;
  const result = await client.execute({
    sql: "SELECT email_notifications FROM user_profiles WHERE user_id=? LIMIT 1",
    args: [userId],
  });
  const preference = result.rows[0]?.email_notifications;
  return preference === null || preference === undefined || Number(preference) !== 0;
}

async function recordDelivery(
  client: DatabaseClient,
  input: EmailDeliveryInput,
  result: EmailDeliveryResult,
  providerId?: string,
) {
  await client.execute({
    sql: `
      INSERT INTO email_deliveries
        (id,user_id,event_type,sender_profile,recipient,subject,status,provider_id,error_message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET
        status=excluded.status,
        provider_id=excluded.provider_id,
        error_message=excluded.error_message,
        created_at=excluded.created_at
    `,
    args: [
      result.id,
      input.userId ?? null,
      input.eventType,
      input.senderProfile ?? "operational",
      input.recipient,
      input.subject,
      result.status,
      providerId ?? null,
      result.error ?? null,
      new Date().toISOString(),
    ],
  });
}

export function emailDeliveryConfigured(
  profile: EmailSenderProfile = "operational",
) {
  return (
    emailMode() === "live" &&
    (smtpConfigured(profile) || Boolean(process.env.RESEND_API_KEY))
  );
}

export function emailMode() {
  if (process.env.APP_MODE === "demo") return "capture" as const;
  const configured = process.env.EMAIL_MODE?.toLowerCase();
  if (configured === "capture" || configured === "disabled") return configured;
  return "live" as const;
}

function securitySmtpConfigured() {
  return Boolean(
    process.env.SECURITY_SMTP_USER &&
      process.env.SECURITY_SMTP_PASS,
  );
}

function smtpConfigured(profile: EmailSenderProfile = "operational") {
  const securityCredentials =
    profile === "security" && securitySmtpConfigured();
  return Boolean(
    (process.env.SECURITY_SMTP_HOST ?? process.env.SMTP_HOST) &&
      process.env.SMTP_PORT &&
      (securityCredentials
        ? process.env.SECURITY_SMTP_USER && process.env.SECURITY_SMTP_PASS
        : process.env.SMTP_USER && process.env.SMTP_PASS),
  );
}

export function emailProviderName(
  profile: EmailSenderProfile = "operational",
) {
  if (emailMode() === "capture") return "capture";
  if (smtpConfigured(profile)) return "smtp";
  if (process.env.RESEND_API_KEY) return "resend";
  return "disabled";
}

async function enqueueOutbox(
  client: DatabaseClient,
  input: EmailDeliveryInput,
  status: "Pending" | "Skipped",
  error?: string,
) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO email_outbox
      (id,user_id,event_type,sender_profile,recipient,subject,body_html,status,provider,
       attempt_count,next_attempt_at,last_error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
    args: [
      id,
      input.userId ?? null,
      input.eventType,
      input.senderProfile ?? "operational",
      input.recipient,
      input.subject,
      input.html,
      status,
      emailProviderName(input.senderProfile),
      timestamp,
      error ?? null,
      timestamp,
      timestamp,
    ],
  });
  return id;
}

export async function sendEmailDelivery(
  client: DatabaseClient,
  input: EmailDeliveryInput,
): Promise<EmailDeliveryResult> {
  const configured = emailDeliveryConfigured(input.senderProfile);
  if (
    input.respectPreference !== false &&
    !(await preferenceAllowsEmail(client, input.userId))
  ) {
    const id = await enqueueOutbox(
      client,
      input,
      "Skipped",
      "Preferensi notifikasi email dinonaktifkan.",
    );
    const result = {
      id,
      configured,
      status: "skipped" as const,
      error: "Preferensi notifikasi email dinonaktifkan.",
    };
    await recordDelivery(client, input, result);
    return result;
  }
  if (emailMode() === "capture") {
    const id = await enqueueOutbox(
      client,
      input,
      "Skipped",
      "Mode demo capture: email tidak dikirim ke penerima.",
    );
    const result = {
      id,
      configured: true,
      status: "skipped" as const,
      error: "Mode demo capture: email tidak dikirim ke penerima.",
    };
    await recordDelivery(client, input, result);
    return result;
  }
  if (!configured) {
    const id = await enqueueOutbox(
      client,
      input,
      "Skipped",
      "Provider SMTP/Resend belum dikonfigurasi.",
    );
    const result = {
      id,
      configured: false,
      status: "skipped" as const,
      error: "Provider SMTP/Resend belum dikonfigurasi.",
    };
    await recordDelivery(client, input, result);
    return result;
  }
  const id = await enqueueOutbox(client, input, "Pending");
  return { id, configured: true, status: "pending" };
}

const retryMinutes = [1, 5, 15, 60] as const;

function senderProfile(row: Record<string, unknown>): EmailSenderProfile {
  return row.sender_profile === "security" ? "security" : "operational";
}

async function sendWithSmtp(row: Record<string, unknown>) {
  const nodemailer = (await import("nodemailer")).default;
  const profile = senderProfile(row);
  const dedicatedSecurity =
    profile === "security" && securitySmtpConfigured();
  const host =
    (dedicatedSecurity ? process.env.SECURITY_SMTP_HOST : undefined) ??
    process.env.SMTP_HOST;
  const port = Number(
    (dedicatedSecurity ? process.env.SECURITY_SMTP_PORT : undefined) ??
      process.env.SMTP_PORT ??
      465,
  );
  const secureValue =
    (dedicatedSecurity ? process.env.SECURITY_SMTP_SECURE : undefined) ??
    process.env.SMTP_SECURE;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure:
      secureValue === "true" ||
      (secureValue !== "false" && port === 465),
    auth: {
      user: dedicatedSecurity
        ? process.env.SECURITY_SMTP_USER
        : process.env.SMTP_USER,
      pass: dedicatedSecurity
        ? process.env.SECURITY_SMTP_PASS
        : process.env.SMTP_PASS,
    },
    tls: {
      servername:
        (dedicatedSecurity
          ? process.env.SECURITY_SMTP_TLS_SERVERNAME
          : undefined) ??
        process.env.SMTP_TLS_SERVERNAME ??
        host,
      rejectUnauthorized: true,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const info = await transporter.sendMail({
    from:
      (dedicatedSecurity
        ? process.env.SECURITY_EMAIL_FROM ??
          "PerumNet <no-reply@perumnet.id>"
        : process.env.EMAIL_FROM) ??
      "PerumNet Enterprise <enterprise@perumnet.id>",
    replyTo:
      (profile === "security"
        ? process.env.SECURITY_EMAIL_REPLY_TO
        : undefined) ??
      process.env.EMAIL_REPLY_TO ??
      "PerumNet Enterprise <enterprise@perumnet.id>",
    to: String(row.recipient),
    subject: String(row.subject),
    html: String(row.body_html),
  });
  transporter.close();
  return info.messageId;
}

async function sendWithResend(row: Record<string, unknown>) {
  const profile = senderProfile(row);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:
        (profile === "security"
          ? process.env.SECURITY_EMAIL_FROM
          : undefined) ??
        process.env.EMAIL_FROM ??
        "PerumNet Enterprise <enterprise@perumnet.id>",
      reply_to:
        (profile === "security"
          ? process.env.SECURITY_EMAIL_REPLY_TO
          : undefined) ??
        process.env.EMAIL_REPLY_TO ??
        "enterprise@perumnet.id",
      to: [String(row.recipient)],
      subject: String(row.subject),
      html: String(row.body_html),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.message ?? `Provider email merespons ${response.status}.`,
    );
  }
  return payload?.id;
}

async function deliverOutboxRow(
  client: DatabaseClient,
  row: Record<string, unknown>,
) {
  const profile = senderProfile(row);
  const provider = emailProviderName(profile);
  const attempt = Number(row.attempt_count ?? 0) + 1;
  const timestamp = new Date().toISOString();
  const input: EmailDeliveryInput = {
    userId: row.user_id ? String(row.user_id) : undefined,
    recipient: String(row.recipient),
    eventType: String(row.event_type),
    senderProfile: profile,
    subject: String(row.subject),
    html: String(row.body_html),
  };
  try {
    const providerId =
      provider === "smtp"
        ? await sendWithSmtp(row)
        : provider === "resend"
          ? await sendWithResend(row)
          : undefined;
    if (!providerId && provider === "disabled") {
      throw new Error("Provider email belum dikonfigurasi.");
    }
    await client.execute({
      sql: `UPDATE email_outbox SET status='Sent',provider=?,provider_id=?,
        attempt_count=?,locked_at=NULL,last_error=NULL,sent_at=?,updated_at=?
        WHERE id=?`,
      args: [
        provider,
        providerId ?? null,
        attempt,
        timestamp,
        timestamp,
        row.id,
      ],
    });
    await recordDelivery(
      client,
      input,
      {
        id: String(row.id),
        configured: true,
        status: "sent",
      },
      providerId,
    );
    return { id: String(row.id), status: "sent" as const };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Pengiriman email gagal.";
    const exhausted = attempt >= 5;
    const retryAt = new Date(
      Date.now() +
        (retryMinutes[Math.min(attempt - 1, retryMinutes.length - 1)] ?? 60) *
          60_000,
    ).toISOString();
    await client.execute({
      sql: `UPDATE email_outbox SET status='Failed',provider=?,
        attempt_count=?,next_attempt_at=?,locked_at=NULL,last_error=?,updated_at=?
        WHERE id=?`,
      args: [provider, attempt, retryAt, message, timestamp, row.id],
    });
    if (exhausted) {
      await recordDelivery(client, input, {
        id: String(row.id),
        configured: true,
        status: "failed",
        error: message,
      });
    }
    return {
      id: String(row.id),
      status: "failed" as const,
      exhausted,
      error: message,
    };
  }
}

export async function dispatchEmailOutbox(
  client: DatabaseClient,
  batchSize = 20,
) {
  if (emailMode() !== "live" || !emailDeliveryConfigured()) {
    return [];
  }
  const timestamp = new Date().toISOString();
  const staleLock = new Date(Date.now() - 10 * 60_000).toISOString();
  await client.execute({
    sql: `UPDATE email_outbox SET status='Failed',locked_at=NULL,
      next_attempt_at=?,last_error='Worker lock expired',updated_at=?
      WHERE status='Processing' AND locked_at<?`,
    args: [timestamp, timestamp, staleLock],
  });
  const candidates = await client.execute({
    sql: `SELECT id FROM email_outbox
      WHERE status IN ('Pending','Failed') AND attempt_count<5
        AND next_attempt_at<=?
      ORDER BY next_attempt_at,created_at LIMIT ?`,
    args: [timestamp, Math.max(1, Math.min(100, batchSize))],
  });
  const results: Array<Record<string, unknown>> = [];
  for (const candidate of candidates.rows) {
    const lockedAt = new Date().toISOString();
    await client.execute({
      sql: `UPDATE email_outbox SET status='Processing',locked_at=?,updated_at=?
        WHERE id=? AND status IN ('Pending','Failed') AND attempt_count<5
          AND next_attempt_at<=?`,
      args: [lockedAt, lockedAt, candidate.id, lockedAt],
    });
    const claimed = await client.execute({
      sql: "SELECT * FROM email_outbox WHERE id=? AND status='Processing' AND locked_at=? LIMIT 1",
      args: [candidate.id, lockedAt],
    });
    if (!claimed.rows[0]) continue;
    results.push(await deliverOutboxRow(client, claimed.rows[0]));
  }
  return results;
}

export async function retryEmailOutbox(
  client: DatabaseClient,
  outboxId: string,
) {
  const current = await client.execute({
    sql: "SELECT id FROM email_outbox WHERE id=? AND status='Failed' LIMIT 1",
    args: [outboxId],
  });
  if (!current.rows.length) return false;
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `UPDATE email_outbox SET status='Pending',attempt_count=0,
      next_attempt_at=?,locked_at=NULL,last_error=NULL,updated_at=?
      WHERE id=? AND status='Failed'`,
    args: [timestamp, timestamp, outboxId],
  });
  return true;
}

export async function sendAccountCreatedEmail(
  client: DatabaseClient,
  user: {
    id: string;
    name: string;
    email: string;
    preferredLanguage?: EmailLanguage;
  },
) {
  const en = user.preferredLanguage === "en";
  return sendEmailDelivery(client, {
    userId: user.id,
    recipient: user.email,
    eventType: "account_created",
    senderProfile: "security",
    subject: en
      ? "Your PerumNet Enterprise account is ready"
      : "Akun PerumNet Enterprise Anda sudah siap",
    html: emailFrame(
      en ? `Welcome, ${user.name}` : `Selamat datang, ${user.name}`,
      en
        ? "An administrator created your PerumNet Enterprise account. Sign in with this email address and the initial password shared through a secure channel."
        : "Administrator telah membuat akun PerumNet Enterprise untuk Anda. Masuk menggunakan alamat email ini dan kata sandi awal yang disampaikan administrator melalui kanal aman.",
      {
        label: en ? "Open PerumNet Enterprise" : "Buka PerumNet Enterprise",
        url: applicationUrl("/admin"),
      },
      user.preferredLanguage,
    ),
  });
}

export async function sendTestEmail(
  client: DatabaseClient,
  user: {
    id: string;
    name: string;
    email: string;
    preferredLanguage?: EmailLanguage;
  },
) {
  const en = user.preferredLanguage === "en";
  return sendEmailDelivery(client, {
    userId: user.id,
    recipient: user.email,
    eventType: "test",
    subject: en
      ? "PerumNet Enterprise notification test"
      : "Tes notifikasi PerumNet Enterprise",
    html: emailFrame(
      en ? "Email notifications are connected" : "Notifikasi email berhasil terhubung",
      en
        ? `Hello ${user.name}, this email confirms that PerumNet Enterprise can deliver notifications to your account.`
        : `Halo ${user.name}, email ini memastikan konfigurasi notifikasi PerumNet Enterprise dapat mengirim pesan ke akun Anda.`,
      {
        label: en ? "Open settings" : "Buka pengaturan",
        url: applicationUrl("/admin"),
      },
      user.preferredLanguage,
    ),
    respectPreference: false,
  });
}

export async function notifyProjectStakeholders(
  client: DatabaseClient,
  input: {
    projectId: string;
    eventType: string;
    subject: string;
    message: string;
    subjectEn?: string;
    messageEn?: string;
    includeFinance?: boolean;
  },
) {
  const result = await client.execute({
    sql: `
      SELECT DISTINCT u.id,u.name,u.email,
        COALESCE(up.preferred_language,'id') AS preferred_language
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id=u.id
      WHERE u.status='Aktif' AND (
        u.role='Admin'
        OR (? = 1 AND u.role='Finance')
        OR u.id IN (
          SELECT manager_id FROM projects WHERE id=? AND manager_id IS NOT NULL
        )
        OR u.id IN (
          SELECT user_id FROM project_members WHERE project_id=?
        )
      )
    `,
    args: [input.includeFinance ? 1 : 0, input.projectId, input.projectId],
  });
  return Promise.allSettled(
    result.rows.map((row) => {
      const language = String(row.preferred_language) === "en" ? "en" : "id";
      const subject =
        language === "en" ? input.subjectEn ?? input.subject : input.subject;
      const message =
        language === "en" ? input.messageEn ?? input.message : input.message;
      return sendEmailDelivery(client, {
        userId: String(row.id),
        recipient: String(row.email),
        eventType: input.eventType,
        subject,
        html: emailFrame(
          subject,
          `${String(row.name)}, ${message}`,
          {
            label: language === "en" ? "Open project" : "Buka proyek",
            url: applicationUrl("/admin"),
          },
          language,
        ),
      });
    }),
  );
}

/**
 * Goes to the NEW address. The change only takes effect when this link comes
 * back, which is what stops a stolen session from redirecting account recovery.
 */
export async function sendEmailChangeConfirmationEmail(
  client: DatabaseClient,
  user: {
    id: string;
    email: string;
    preferredLanguage?: EmailLanguage;
  },
  newEmail: string,
  token: string,
  validMinutes: number,
) {
  const en = user.preferredLanguage === "en";
  const confirmUrl = applicationUrl(
    `/api/auth/confirm-email-change?token=${encodeURIComponent(token)}`,
  );
  return sendEmailDelivery(client, {
    userId: user.id,
    recipient: newEmail,
    eventType: "email_change_confirm",
    senderProfile: "security",
    subject: en
      ? "Confirm your new PerumNet Enterprise email address"
      : "Konfirmasi alamat email PerumNet Enterprise yang baru",
    html: emailFrame(
      en ? "Confirm this email address" : "Konfirmasi alamat email ini",
      en
        ? `A request was made to move the PerumNet Enterprise account currently using ${user.email} to this address. The account keeps its old address until you confirm here. This link is valid for ${validMinutes} minutes. Ignore this email if you did not request the change.`
        : `Ada permintaan memindahkan akun PerumNet Enterprise yang saat ini memakai ${user.email} ke alamat ini. Akun tetap memakai alamat lama sampai Anda mengonfirmasi di sini. Tautan ini berlaku ${validMinutes} menit. Abaikan email ini bila Anda tidak meminta perubahan tersebut.`,
      {
        label: en ? "Confirm email address" : "Konfirmasi alamat email",
        url: confirmUrl,
      },
      user.preferredLanguage,
    ),
    respectPreference: false,
  });
}

/**
 * Goes to the OLD address, at request time. If someone else asked for the
 * change, this is how the real owner finds out while they can still act.
 */
export async function sendEmailChangeRequestedEmail(
  client: DatabaseClient,
  user: {
    id: string;
    email: string;
    preferredLanguage?: EmailLanguage;
  },
  newEmail: string,
) {
  const en = user.preferredLanguage === "en";
  return sendEmailDelivery(client, {
    userId: user.id,
    recipient: user.email,
    eventType: "email_change_requested",
    senderProfile: "security",
    subject: en
      ? "An email address change was requested on your account"
      : "Ada permintaan penggantian alamat email pada akun Anda",
    html: emailFrame(
      en ? "Did you request this?" : "Apakah ini permintaan Anda?",
      en
        ? `A request was made to move this PerumNet Enterprise account to ${newEmail}. Nothing has changed yet — the account still uses this address until the new one is confirmed. If this was not you, change your password now and tell your administrator; changing your password also signs out every other device.`
        : `Ada permintaan memindahkan akun PerumNet Enterprise ini ke ${newEmail}. Belum ada yang berubah — akun masih memakai alamat ini sampai alamat baru dikonfirmasi. Bila ini bukan Anda, segera ganti kata sandi dan beri tahu administrator; mengganti kata sandi sekaligus mengakhiri sesi di perangkat lain.`,
      {
        label: en ? "Open PerumNet Enterprise" : "Buka PerumNet Enterprise",
        url: applicationUrl("/admin"),
      },
      user.preferredLanguage,
    ),
    respectPreference: false,
  });
}

/** Goes to the OLD address once the change has actually taken effect. */
export async function sendEmailChangedEmail(
  client: DatabaseClient,
  user: {
    id: string;
    preferredLanguage?: EmailLanguage;
  },
  previousEmail: string,
  newEmail: string,
) {
  const en = user.preferredLanguage === "en";
  return sendEmailDelivery(client, {
    userId: user.id,
    recipient: previousEmail,
    eventType: "email_changed",
    senderProfile: "security",
    subject: en
      ? "The email address on your PerumNet Enterprise account has changed"
      : "Alamat email akun PerumNet Enterprise Anda telah berubah",
    html: emailFrame(
      en ? "This account now uses a different address" : "Akun ini kini memakai alamat lain",
      en
        ? `The PerumNet Enterprise account that used this address now signs in with ${newEmail}. Every session on the account was ended as part of the change. If this was not you, contact your administrator immediately.`
        : `Akun PerumNet Enterprise yang memakai alamat ini sekarang masuk dengan ${newEmail}. Seluruh sesi akun tersebut diakhiri sebagai bagian dari perubahan ini. Bila ini bukan Anda, segera hubungi administrator.`,
      {
        label: en ? "Open PerumNet Enterprise" : "Buka PerumNet Enterprise",
        url: applicationUrl("/admin"),
      },
      user.preferredLanguage,
    ),
    respectPreference: false,
  });
}

export async function sendPasswordResetEmail(
  client: DatabaseClient,
  user: {
    id: string;
    email: string;
    preferredLanguage?: EmailLanguage;
  },
  token: string,
  surface: "admin" | "panel" = "admin",
) {
  const en = user.preferredLanguage === "en";
  const resetUrl = applicationUrl(
    `/${surface}?resetToken=${encodeURIComponent(token)}`,
  );
  return sendEmailDelivery(client, {
    userId: user.id,
    recipient: user.email,
    eventType: "password_reset",
    senderProfile: "security",
    subject: en
      ? "Reset your PerumNet Enterprise password"
      : "Pemulihan kata sandi PerumNet Enterprise",
    html: emailFrame(
      en ? "Reset your password" : "Atur ulang kata sandi",
      en
        ? "We received an account recovery request. This link is valid for 30 minutes. Ignore this email if you did not request a password change."
        : "Permintaan pemulihan akun diterima. Tautan ini berlaku selama 30 menit. Abaikan email ini bila Anda tidak meminta perubahan kata sandi.",
      {
        label: en ? "Reset password" : "Atur ulang kata sandi",
        url: resetUrl,
      },
      user.preferredLanguage,
    ),
    respectPreference: false,
  });
}
