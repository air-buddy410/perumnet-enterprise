"use client";

import {
  Bell,
  CheckCircle2,
  Clock3,
  Languages,
  LockKeyhole,
  MailCheck,
  RefreshCw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, messageOf } from "../api-client";
import type { AppLanguage } from "../i18n";

interface SettingsViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
  isAdmin: boolean;
}

interface EmailDelivery {
  id: string;
  eventType: string;
  recipient: string;
  subject: string;
  status: "pending" | "sent" | "failed" | "skipped";
  error?: string;
  provider?: string;
  attemptCount?: number;
  createdAt: string;
}

export function SettingsView({
  language,
  notify,
  onLanguageChange,
  isAdmin,
}: SettingsViewProps) {
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(language);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [emailDeliveryConfigured, setEmailDeliveryConfigured] = useState(false);
  const [emailMode, setEmailMode] = useState("disabled");
  const [emailProvider, setEmailProvider] = useState("disabled");
  const [emailDeliveries, setEmailDeliveries] = useState<EmailDelivery[]>([]);
  const [testingEmail, setTestingEmail] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const id = language === "id";

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ preferredLanguage: AppLanguage; emailNotifications: boolean; emailDeliveryConfigured: boolean; emailMode: string; emailProvider: string }>("/api/settings"),
      api<EmailDelivery[]>("/api/notifications/email"),
    ])
      .then(([settings, deliveries]) => {
        if (!active) return;
        setSelectedLanguage(settings.preferredLanguage);
        setEmailNotifications(settings.emailNotifications);
        setEmailDeliveryConfigured(settings.emailDeliveryConfigured);
        setEmailMode(settings.emailMode);
        setEmailProvider(settings.emailProvider);
        setEmailDeliveries(deliveries);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => { active = false; };
  }, [language, notify]);

  async function refreshEmailDeliveries() {
    try {
      setEmailDeliveries(await api<EmailDelivery[]>("/api/notifications/email"));
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function sendTestNotification() {
    setTestingEmail(true);
    try {
      const result = await api<{
        configured: boolean;
        status: EmailDelivery["status"];
        error?: string;
      }>("/api/notifications/email/test", { method: "POST" });
      await refreshEmailDeliveries();
      if (result.status === "sent") {
        notify(id ? "Email uji berhasil dikirim." : "Test email sent successfully.");
      } else if (result.status === "pending") {
        notify(id ? "Email uji masuk antrean pengiriman." : "Test email queued for delivery.");
      } else if (!result.configured) {
        notify(
          id
            ? "Provider email belum dikonfigurasi di server."
            : "The email provider is not configured on the server.",
        );
      } else {
        notify(result.error ?? (id ? "Email uji gagal dikirim." : "Test email failed."));
      }
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setTestingEmail(false);
    }
  }

  async function retryDelivery(deliveryId: string) {
    try {
      await api(`/api/notifications/email/${deliveryId}/retry`, {
        method: "POST",
      });
      await refreshEmailDeliveries();
      notify(
        id
          ? "Email dikembalikan ke antrean pengiriman."
          : "Email returned to the delivery queue.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ preferredLanguage: selectedLanguage, emailNotifications }),
      });
      onLanguageChange(selectedLanguage);
      notify(selectedLanguage === "id" ? "Pengaturan berhasil disimpan." : "Settings saved successfully.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      notify(id ? "Konfirmasi kata sandi tidak sama." : "Password confirmation does not match.");
      return;
    }
    try {
      const result = await api<{ target?: "mailcow" | "local" }>("/api/profile/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify(
        result.target === "mailcow"
          ? id
            ? "Password email berhasil diperbarui untuk webmail dan aplikasi PerumNet lain."
            : "Email password updated for webmail and other PerumNet apps."
          : id
            ? "Kata sandi berhasil diperbarui."
            : "Password updated successfully.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack settings-page" data-testid="settings-view">
      <section className="page-title-row">
        <div><span className="eyebrow">{id ? "PREFERENSI AKUN" : "ACCOUNT PREFERENCES"}</span><h1>{id ? "Pengaturan" : "Settings"}</h1><p>{id ? "Atur bahasa, notifikasi, dan keamanan akun Anda." : "Manage your language, notifications, and account security."}</p></div>
      </section>
      <div className="settings-grid">
        <form className="panel settings-card" onSubmit={savePreferences}>
          <div className="settings-section-head"><span className="metric-icon teal"><Languages size={20} /></span><div><h2>{id ? "Bahasa aplikasi" : "Application language"}</h2><p>{id ? "Bahasa disimpan untuk akun ini dan dipakai saat login berikutnya." : "Your choice is saved to this account and reused on the next sign-in."}</p></div></div>
          <div className="language-options">
            <label className={selectedLanguage === "id" ? "active" : ""}><input type="radio" name="language" checked={selectedLanguage === "id"} onChange={() => setSelectedLanguage("id")} /><span><strong>Bahasa Indonesia</strong><small>{id ? "Gunakan antarmuka dalam Bahasa Indonesia" : "Use the interface in Indonesian"}</small></span></label>
            <label className={selectedLanguage === "en" ? "active" : ""}><input type="radio" name="language" checked={selectedLanguage === "en"} onChange={() => setSelectedLanguage("en")} /><span><strong>English</strong><small>Use the interface in English</small></span></label>
          </div>
          <div className="settings-divider" />
          <label className="toggle-setting"><span className="metric-icon blue"><Bell size={19} /></span><span><strong>{id ? "Notifikasi email" : "Email notifications"}</strong><small>{id ? "Terima pembaruan saat akun dibuat, proyek ditugaskan, invoice dibayar, validasi selesai, dan BAST difinalkan." : "Receive updates when accounts are created, projects assigned, invoices paid, validations completed, and handovers finalized."}</small></span><input type="checkbox" checked={emailNotifications} onChange={(event) => setEmailNotifications(event.target.checked)} /></label>
          <div className={`email-delivery-status ${emailDeliveryConfigured || emailMode === "capture" ? "configured" : "pending"}`}><span className="badge-dot" /><span><strong>{emailMode === "capture" ? (id ? "Mode demo capture aktif" : "Demo capture mode enabled") : emailDeliveryConfigured ? (id ? `Provider ${emailProvider.toUpperCase()} terdeteksi` : `${emailProvider.toUpperCase()} provider detected`) : (id ? "Provider email belum dikonfigurasi" : "Email provider is not configured")}</strong><small>{emailMode === "capture" ? (id ? "Pesan disimpan ke outbox demo tanpa dikirim ke penerima." : "Messages are stored in the demo outbox without being sent.") : emailDeliveryConfigured ? (id ? "Email diproses lewat transactional outbox; kegagalan SMTP tidak membatalkan transaksi bisnis." : "Email is processed through a transactional outbox; SMTP failures do not roll back business transactions.") : (id ? "Isi SMTP Mailcow melalui secret server atau pertahankan Resend untuk kompatibilitas." : "Configure Mailcow SMTP through server secrets or retain Resend for compatibility.")}</small></span></div>
          <div className="email-test-actions">
            <button className="button secondary" type="button" disabled={testingEmail} onClick={sendTestNotification}>
              {testingEmail ? <RefreshCw className="spin" size={16} /> : <MailCheck size={16} />}
              {testingEmail
                ? id ? "Mengirim..." : "Sending..."
                : id ? "Kirim email uji" : "Send test email"}
            </button>
            <span>{id ? "Email dikirim ke alamat akun Anda." : "The email is sent to your account address."}</span>
          </div>
          <div className="email-delivery-history">
            <div className="email-history-head">
              <div>
                <strong>{id ? "Riwayat pengiriman terbaru" : "Recent delivery history"}</strong>
                <span>{id ? "Status aktual dari proses pengiriman aplikasi." : "Actual status from application delivery attempts."}</span>
              </div>
              <button className="icon-button" type="button" aria-label={id ? "Muat ulang riwayat" : "Refresh history"} onClick={refreshEmailDeliveries}><RefreshCw size={15} /></button>
            </div>
            <div className="email-history-list">
              {emailDeliveries.slice(0, 5).map((delivery) => (
                <article key={delivery.id}>
                  <span className={`email-status-icon ${delivery.status}`}>
                    {delivery.status === "sent"
                      ? <CheckCircle2 size={15} />
                      : delivery.status === "failed"
                        ? <TriangleAlert size={15} />
                        : <Clock3 size={15} />}
                  </span>
                  <div>
                    <strong>{delivery.subject}</strong>
                    <small>
                      {delivery.status === "sent"
                        ? id ? "Terkirim" : "Sent"
                        : delivery.status === "failed"
                          ? id ? "Gagal" : "Failed"
                          : delivery.status === "pending"
                            ? id ? "Menunggu antrean" : "Pending"
                            : id ? "Dilewati" : "Skipped"}
                      {delivery.provider ? ` · ${delivery.provider}` : ""}
                      {delivery.attemptCount ? ` · ${delivery.attemptCount}x` : ""}
                      {" · "}
                      {new Intl.DateTimeFormat(id ? "id-ID" : "en-US", {
                        dateStyle: "long",
                        timeStyle: "short",
                        timeZone: "Asia/Makassar",
                      }).format(new Date(delivery.createdAt))}
                    </small>
                    {delivery.error ? <small>{delivery.error}</small> : null}
                  </div>
                  {isAdmin && delivery.status === "failed" ? (
                    <button
                      className="button subtle small email-retry-button"
                      type="button"
                      onClick={() => void retryDelivery(delivery.id)}
                    >
                      <RefreshCw size={13} />
                      {id ? "Coba lagi" : "Retry"}
                    </button>
                  ) : null}
                </article>
              ))}
              {!emailDeliveries.length ? (
                <div className="empty-state compact">
                  <MailCheck size={20} />
                  <span>{id ? "Belum ada aktivitas email." : "No email activity yet."}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="settings-form-actions"><button className="button primary" type="submit"><Save size={16} /> {id ? "Simpan preferensi" : "Save preferences"}</button></div>
        </form>
        <form className="panel settings-card" onSubmit={changePassword}>
          <div className="settings-section-head"><span className="metric-icon orange"><LockKeyhole size={20} /></span><div><h2>{id ? "Keamanan password email" : "Email password security"}</h2><p>{id ? "Gunakan minimal 10 karakter. Password ini dipakai untuk webmail dan aplikasi PerumNet lain." : "Use at least 10 characters. This password is used for webmail and other PerumNet apps."}</p></div></div>
          <div className="form-grid single-column">
            <label className="field full"><span>{id ? "Password email saat ini" : "Current email password"}</span><input type="password" required minLength={8} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
            <label className="field full"><span>{id ? "Password email baru" : "New email password"}</span><input type="password" required minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
            <label className="field full"><span>{id ? "Ulangi password email baru" : "Repeat new email password"}</span><input type="password" required minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          </div>
          <div className="security-note"><ShieldCheck size={18} /><span>{id ? "Perubahan berlaku untuk webmail dan aplikasi PerumNet lain, serta dicatat di audit log keamanan." : "Changes apply to webmail and other PerumNet apps and are recorded in the security audit log."}</span></div>
          <div className="settings-form-actions"><button className="button secondary" type="submit"><LockKeyhole size={16} /> {id ? "Perbarui password email" : "Update email password"}</button></div>
        </form>
      </div>
    </div>
  );
}
