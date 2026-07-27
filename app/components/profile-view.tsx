"use client";

import { Camera, Mail, MapPin, Phone, Save, UserRound } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { api, messageOf, type SessionUser } from "../api-client";
import type { AppLanguage } from "../i18n";
import { appPath } from "../paths";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  role: SessionUser["role"];
  phone: string;
  jobTitle: string;
  bio: string;
  address: string;
  birthDate: string;
  avatarUrl?: string;
}

interface ProfileViewProps {
  language: AppLanguage;
  user: SessionUser;
  notify: (message: string) => void;
  onUserChange: (user: SessionUser) => void;
}

export function ProfileView({ language, user, notify, onUserChange }: ProfileViewProps) {
  const [profile, setProfile] = useState<ProfileData>({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: "",
    jobTitle: "",
    bio: "",
    address: "",
    birthDate: "",
    avatarUrl: user.avatarUrl,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api<ProfileData>("/api/profile")
      .then((data) => active && setProfile(data))
      .catch((error) => notify(messageOf(error, language)));
    return () => { active = false; };
  }, [language, notify, user.id]);

  function setField<K extends keyof ProfileData>(key: K, value: ProfileData[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await api<ProfileData>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify(profile),
      });
      setProfile(updated);
      onUserChange({ ...user, name: updated.name, email: updated.email, avatarUrl: updated.avatarUrl ?? user.avatarUrl });
      notify(language === "id" ? "Profil berhasil diperbarui." : "Profile updated successfully.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    setUploading(true);
    try {
      const result = await api<{ avatarUrl: string }>("/api/profile/avatar", {
        method: "POST",
        body: form,
      });
      setProfile((current) => ({ ...current, avatarUrl: result.avatarUrl }));
      setFailedAvatarUrl("");
      onUserChange({ ...user, avatarUrl: result.avatarUrl });
      notify(language === "id" ? "Foto profil berhasil diperbarui." : "Profile photo updated.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
  const id = language === "id";

  return (
    <div className="page-stack settings-page" data-testid="profile-view">
      <section className="page-title-row">
        <div><span className="eyebrow">{id ? "AKUN PRIBADI" : "PERSONAL ACCOUNT"}</span><h1>{id ? "Profil Saya" : "My Profile"}</h1><p>{id ? "Perbarui foto dan informasi yang digunakan di seluruh workspace." : "Update the photo and information used across the workspace."}</p></div>
      </section>
      <section className="profile-layout">
        <aside className="panel profile-summary-card">
          <div className="profile-photo-large">
            {profile.avatarUrl && failedAvatarUrl !== profile.avatarUrl ? (
              <img
                src={appPath(profile.avatarUrl)}
                alt={profile.name}
                onError={() => setFailedAvatarUrl(profile.avatarUrl ?? "")}
              />
            ) : initials}
            <button
              type="button"
              disabled={uploading}
              aria-busy={uploading}
              aria-label={id ? "Ganti foto" : "Change photo"}
              onClick={() => inputRef.current?.click()}
            >
              <Camera size={17} />
            </button>
            <input ref={inputRef} hidden disabled={uploading} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} />
          </div>
          <h2>{profile.name}</h2>
          <span className="role-chip admin">{profile.role}</span>
          <p>{profile.jobTitle || (id ? "Jabatan belum diisi" : "Job title not provided")}</p>
          <div className="profile-contact-list">
            <span><Mail size={15} /> {profile.email}</span>
            <span><Phone size={15} /> {profile.phone || "—"}</span>
            <span><MapPin size={15} /> {profile.address || "—"}</span>
          </div>
          <small>{uploading ? (id ? "Mengunggah foto..." : "Uploading photo...") : (id ? "JPG, PNG, atau WebP · maks. 3 MB" : "JPG, PNG, or WebP · max. 3 MB")}</small>
        </aside>
        <form className="panel profile-form-card" onSubmit={save}>
          <div className="panel-head"><div><span className="eyebrow">{id ? "DATA PRIBADI" : "PERSONAL DETAILS"}</span><h2>{id ? "Informasi profil" : "Profile information"}</h2></div><UserRound size={22} /></div>
          <div className="form-grid">
            <label className="field"><span>{id ? "Nama lengkap" : "Full name"}</span><input required value={profile.name} onChange={(event) => setField("name", event.target.value)} /></label>
            <label className="field"><span>Email</span><input required type="email" value={profile.email} onChange={(event) => setField("email", event.target.value)} /></label>
            <label className="field"><span>{id ? "Nomor telepon" : "Phone number"}</span><input value={profile.phone} onChange={(event) => setField("phone", event.target.value)} placeholder="+62..." /></label>
            <label className="field"><span>{id ? "Jabatan" : "Job title"}</span><input value={profile.jobTitle} onChange={(event) => setField("jobTitle", event.target.value)} /></label>
            <label className="field"><span>{id ? "Tanggal lahir" : "Birth date"}</span><input type="date" value={profile.birthDate} onChange={(event) => setField("birthDate", event.target.value)} /></label>
            <label className="field full"><span>{id ? "Alamat" : "Address"}</span><input value={profile.address} onChange={(event) => setField("address", event.target.value)} /></label>
            <label className="field full"><span>Bio</span><textarea rows={4} value={profile.bio} onChange={(event) => setField("bio", event.target.value)} placeholder={id ? "Ceritakan peran dan keahlian Anda..." : "Describe your role and expertise..."} /></label>
          </div>
          <div className="settings-form-actions"><button className="button primary" type="submit" disabled={saving}><Save size={16} /> {saving ? (id ? "Menyimpan..." : "Saving...") : (id ? "Simpan profil" : "Save profile")}</button></div>
        </form>
      </section>
    </div>
  );
}
