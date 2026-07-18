"use client";

import { Bell, Languages, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, messageOf } from "../api-client";
import type { AppLanguage } from "../i18n";

interface SettingsViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
}

export function SettingsView({ language, notify, onLanguageChange }: SettingsViewProps) {
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(language);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const id = language === "id";

  useEffect(() => {
    let active = true;
    api<{ preferredLanguage: AppLanguage; emailNotifications: boolean }>("/api/settings")
      .then((settings) => {
        if (!active) return;
        setSelectedLanguage(settings.preferredLanguage);
        setEmailNotifications(settings.emailNotifications);
      })
      .catch((error) => notify(messageOf(error)));
    return () => { active = false; };
  }, [notify]);

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
      notify(messageOf(error));
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      notify(id ? "Konfirmasi kata sandi tidak sama." : "Password confirmation does not match.");
      return;
    }
    try {
      await api("/api/profile/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify(id ? "Kata sandi berhasil diperbarui." : "Password updated successfully.");
    } catch (error) {
      notify(messageOf(error));
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
            <label className={selectedLanguage === "id" ? "active" : ""}><input type="radio" name="language" checked={selectedLanguage === "id"} onChange={() => setSelectedLanguage("id")} /><span><strong>Bahasa Indonesia</strong><small>Gunakan antarmuka dalam Bahasa Indonesia</small></span></label>
            <label className={selectedLanguage === "en" ? "active" : ""}><input type="radio" name="language" checked={selectedLanguage === "en"} onChange={() => setSelectedLanguage("en")} /><span><strong>English</strong><small>Use the interface in English</small></span></label>
          </div>
          <div className="settings-divider" />
          <label className="toggle-setting"><span className="metric-icon blue"><Bell size={19} /></span><span><strong>{id ? "Notifikasi email" : "Email notifications"}</strong><small>{id ? "Terima pembaruan penting tentang proyek dan tagihan." : "Receive important project and billing updates."}</small></span><input type="checkbox" checked={emailNotifications} onChange={(event) => setEmailNotifications(event.target.checked)} /></label>
          <div className="settings-form-actions"><button className="button primary" type="submit"><Save size={16} /> {id ? "Simpan preferensi" : "Save preferences"}</button></div>
        </form>
        <form className="panel settings-card" onSubmit={changePassword}>
          <div className="settings-section-head"><span className="metric-icon orange"><LockKeyhole size={20} /></span><div><h2>{id ? "Keamanan akun" : "Account security"}</h2><p>{id ? "Gunakan minimal 10 karakter dan jangan pakai ulang kata sandi lama." : "Use at least 10 characters and do not reuse an old password."}</p></div></div>
          <div className="form-grid single-column">
            <label className="field full"><span>{id ? "Kata sandi saat ini" : "Current password"}</span><input type="password" required minLength={8} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
            <label className="field full"><span>{id ? "Kata sandi baru" : "New password"}</span><input type="password" required minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
            <label className="field full"><span>{id ? "Ulangi kata sandi baru" : "Confirm new password"}</span><input type="password" required minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          </div>
          <div className="security-note"><ShieldCheck size={18} /><span>{id ? "Perubahan kata sandi dicatat di audit log keamanan." : "Password changes are recorded in the security audit log."}</span></div>
          <div className="settings-form-actions"><button className="button secondary" type="submit"><LockKeyhole size={16} /> {id ? "Perbarui kata sandi" : "Update password"}</button></div>
        </form>
      </div>
    </div>
  );
}
