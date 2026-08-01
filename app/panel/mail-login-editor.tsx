"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  History,
  Laptop,
  LoaderCircle,
  Mail,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Tablet,
  Upload,
} from "lucide-react";
import styles from "./mail-login-editor.module.css";

type ThemeKey = "enterprise" | "perumnet";
type PreviewSize = "desktop" | "tablet" | "mobile";

type ThemeConfig = {
  themeKey: ThemeKey;
  browserTitle: string;
  eyebrow: string;
  headline: string;
  description: string;
  cardTitle: string;
  logoUrl: string;
  faviconUrl: string;
  revision: number;
  isActive: boolean;
  updatedAt: string;
};

type Version = {
  id: string;
  activeTheme: ThemeKey;
  contentHash: string;
  deploymentMode: "capture" | "ssh";
  status: "Publishing" | "Deployed" | "Failed" | "Rolled Back";
  errorMessage: string | null;
  createdByName: string | null;
  createdAt: string;
  deployedAt: string | null;
};

type MailLoginState = {
  activeTheme: ThemeKey;
  themes: Record<ThemeKey, ThemeConfig>;
  deployment: {
    mode: "capture" | "ssh";
    live: boolean;
    last: Version | null;
  };
  versions: Version[];
};

type EditableConfig = Pick<
  ThemeConfig,
  "browserTitle" | "eyebrow" | "headline" | "description" | "cardTitle" | "revision"
>;

const themeLabels: Record<ThemeKey, { name: string; description: string }> = {
  enterprise: {
    name: "Enterprise",
    description: "Identitas konsultan IT dengan komposisi formal dan profesional.",
  },
  perumnet: {
    name: "PerumNet",
    description: "Tampilan ringan yang mengikuti karakter login Hotspot PerumNet.",
  },
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "Permintaan tidak dapat diproses.");
  return payload.data as T;
}

function editable(config: ThemeConfig): EditableConfig {
  return {
    browserTitle: config.browserTitle,
    eyebrow: config.eyebrow,
    headline: config.headline,
    description: config.description,
    cardTitle: config.cardTitle,
    revision: config.revision,
  };
}

function fullDate(value: string | null) {
  if (!value) return "Belum diterapkan";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Makassar",
    timeZoneName: "short",
  }).format(new Date(value));
}

function filePreview(file: File | null, fallback: string) {
  return file ? URL.createObjectURL(file) : fallback;
}

export function MailLoginEditor() {
  const [state, setState] = useState<MailLoginState | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<ThemeKey>("enterprise");
  const [form, setForm] = useState<EditableConfig | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [favicon, setFavicon] = useState<File | null>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<MailLoginState>("/api/cms/mail-login")
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setSelectedTheme(next.activeTheme);
        setForm(editable(next.themes[next.activeTheme]));
      })
      .catch((error) => {
        if (!cancelled) setMessage({ tone: "error", text: error instanceof Error ? error.message : "Konfigurasi gagal dimuat." });
      });
    return () => { cancelled = true; };
  }, []);

  const current = state?.themes[selectedTheme];
  const logoPreview = useMemo(() => current ? filePreview(logo, current.logoUrl) : "", [logo, current]);
  const faviconPreview = useMemo(() => current ? filePreview(favicon, current.faviconUrl) : "", [favicon, current]);
  useEffect(() => () => {
    if (logoPreview.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    if (faviconPreview.startsWith("blob:")) URL.revokeObjectURL(faviconPreview);
  }, [logoPreview, faviconPreview]);

  const chooseTheme = (theme: ThemeKey) => {
    if (!state) return;
    setSelectedTheme(theme);
    setForm(editable(state.themes[theme]));
    setLogo(null);
    setFavicon(null);
    setMessage(null);
  };

  const update = (key: keyof EditableConfig, value: string) => {
    setForm((currentForm) => currentForm ? { ...currentForm, [key]: value } : currentForm);
  };

  const save = async () => {
    if (!state || !form) return;
    const warning = state.deployment.live
      ? `Tema ${themeLabels[selectedTheme].name} akan langsung diterapkan ke mail.perumnet.id. Lanjutkan?`
      : "Perubahan akan disimpan sebagai simulasi demo dan tidak mengubah Mailcow produksi. Lanjutkan?";
    if (!window.confirm(warning)) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = new FormData();
      data.set("payload", JSON.stringify({
        theme: selectedTheme,
        activeTheme: selectedTheme,
        ...form,
      }));
      if (logo) data.set("logo", logo);
      if (favicon) data.set("favicon", favicon);
      const next = await request<MailLoginState>("/api/cms/mail-login", { method: "PUT", body: data });
      setState(next);
      setSelectedTheme(next.activeTheme);
      setForm(editable(next.themes[next.activeTheme]));
      setLogo(null);
      setFavicon(null);
      setMessage({
        tone: "success",
        text: next.deployment.live
          ? "Tema berhasil diterapkan ke PerumNet Mail."
          : "Konfigurasi demo berhasil disimpan dalam mode simulasi.",
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Tema gagal disimpan." });
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (version: Version) => {
    if (!state || !window.confirm(`Pulihkan tema ${themeLabels[version.activeTheme].name} dari ${fullDate(version.deployedAt || version.createdAt)}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await request<MailLoginState>(`/api/cms/mail-login/rollback/${version.id}`, { method: "POST" });
      setState(next);
      setSelectedTheme(next.activeTheme);
      setForm(editable(next.themes[next.activeTheme]));
      setLogo(null);
      setFavicon(null);
      setMessage({ tone: "success", text: "Versi tema berhasil dipulihkan." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Versi gagal dipulihkan." });
    } finally {
      setBusy(false);
    }
  };

  if (!state || !current || !form) {
    return <div className={styles.loading}><LoaderCircle className={styles.spin} size={22} /><span>{message?.text || "Memuat konfigurasi PerumNet Mail…"}</span></div>;
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <div>
          <span>LOGIN PERUMNET MAIL</span>
          <h2>Kelola identitas login tanpa menyentuh autentikasi.</h2>
          <p>Pilih tema, perbarui konten dan aset, lalu simpan. Form, CSRF, reset password, FIDO2, dan pilihan bahasa tetap dikelola Mailcow.</p>
        </div>
        <a href="https://mail.perumnet.id/" target="_blank" rel="noreferrer"><ExternalLink size={17} /> Buka PerumNet Mail</a>
      </header>

      <section className={styles.statusBar}>
        <div className={state.deployment.live ? styles.liveStatus : styles.captureStatus}>
          <ShieldCheck size={18} />
          <span><strong>{state.deployment.live ? "Terhubung ke produksi" : "Mode simulasi demo"}</strong><small>{state.deployment.live ? "Simpan langsung menerapkan perubahan ke Mailcow." : "Perubahan tidak dikirim ke Mailcow produksi."}</small></span>
        </div>
        <div><small>Tema aktif</small><strong>{themeLabels[state.activeTheme].name}</strong></div>
        <div><small>Deployment terakhir</small><strong>{fullDate(state.deployment.last?.deployedAt ?? null)}</strong></div>
      </section>

      {message && <div className={`${styles.notice} ${message.tone === "error" ? styles.noticeError : styles.noticeSuccess}`}>{message.text}</div>}

      <section className={styles.themeSection}>
        <div className={styles.sectionHeading}><div><span>PILIH TEMA</span><h3>Dua identitas, satu login yang aman.</h3></div><p>Tema yang dipilih akan menjadi aktif saat disimpan.</p></div>
        <div className={styles.themeGrid}>
          {(["enterprise", "perumnet"] as ThemeKey[]).map((theme) => {
            const item = state.themes[theme];
            const selected = theme === selectedTheme;
            return (
              <button key={theme} type="button" className={selected ? styles.themeSelected : ""} onClick={() => chooseTheme(theme)} aria-pressed={selected}>
                <span className={`${styles.themeSwatch} ${theme === "enterprise" ? styles.enterpriseSwatch : styles.perumnetSwatch}`}><img src={item.logoUrl} alt="" /></span>
                <span><strong>{themeLabels[theme].name}</strong><small>{themeLabels[theme].description}</small></span>
                <span className={styles.themeState}>{item.isActive ? "Aktif sekarang" : selected ? "Akan diaktifkan" : "Pilih tema"}</span>
                {selected && <Check size={18} />}
              </button>
            );
          })}
        </div>
      </section>

      <div className={styles.workspace}>
        <section className={styles.editorCard}>
          <div className={styles.cardHeading}><div><span>KONTEN & ASET</span><h3>Tema {themeLabels[selectedTheme].name}</h3></div><span>Revisi {form.revision}</span></div>
          <div className={styles.fields}>
            <Field label="Judul browser" value={form.browserTitle} onChange={(value) => update("browserTitle", value)} maxLength={80} />
            <Field label="Label brand" value={form.eyebrow} onChange={(value) => update("eyebrow", value)} maxLength={80} />
            <Field label="Judul utama" value={form.headline} onChange={(value) => update("headline", value)} maxLength={180} />
            <TextArea label="Deskripsi" value={form.description} onChange={(value) => update("description", value)} maxLength={500} />
            <Field label="Judul kartu login" value={form.cardTitle} onChange={(value) => update("cardTitle", value)} maxLength={100} />
            <AssetField label="Logo tema" helper="PNG, JPG, atau WebP · maks. 2 MB" currentUrl={logoPreview} file={logo} onChange={setLogo} />
            <AssetField label="Favicon" helper="Opsional. Jika kosong, dibuat otomatis dari logo." currentUrl={faviconPreview} file={favicon} onChange={setFavicon} compact />
          </div>
          <div className={styles.saveBar}>
            <span><ShieldCheck size={16} /> Perubahan gagal akan mengembalikan versi sebelumnya.</span>
            <button type="button" onClick={save} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />}{state.deployment.live ? "Simpan & terapkan" : "Simpan simulasi"}</button>
          </div>
        </section>

        <section className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <div><span>PRATINJAU</span><h3>{previewSize === "desktop" ? "Desktop" : previewSize === "tablet" ? "Tablet" : "Mobile"}</h3></div>
            <div className={styles.viewportTabs}>
              <button className={previewSize === "desktop" ? styles.viewportActive : ""} onClick={() => setPreviewSize("desktop")} aria-label="Pratinjau desktop"><Laptop size={17} /></button>
              <button className={previewSize === "tablet" ? styles.viewportActive : ""} onClick={() => setPreviewSize("tablet")} aria-label="Pratinjau tablet"><Tablet size={17} /></button>
              <button className={previewSize === "mobile" ? styles.viewportActive : ""} onClick={() => setPreviewSize("mobile")} aria-label="Pratinjau mobile"><Smartphone size={17} /></button>
            </div>
          </div>
          <div className={styles.previewStage}>
            <div className={styles.previewFrame} data-viewport={previewSize}>
              <MailPreview theme={selectedTheme} config={form} logoUrl={logoPreview} faviconUrl={faviconPreview} />
            </div>
          </div>
        </section>
      </div>

      <section className={styles.historyCard}>
        <div className={styles.sectionHeading}><div><span>RIWAYAT VERSI</span><h3>Publikasi dan pemulihan tema.</h3></div><History size={20} /></div>
        <div className={styles.historyList}>
          {state.versions.map((version, index) => (
            <article key={version.id}>
              <span className={`${styles.versionStatus} ${version.status === "Failed" ? styles.versionFailed : version.status === "Rolled Back" ? styles.versionRolledBack : ""}`}>{version.status}</span>
              <div><strong>{themeLabels[version.activeTheme].name}</strong><small>{fullDate(version.deployedAt || version.createdAt)} · {version.deploymentMode === "ssh" ? "Produksi" : "Simulasi"}{version.createdByName ? ` · ${version.createdByName}` : ""}</small>{version.errorMessage && <em>{version.errorMessage}</em>}</div>
              <code>{version.contentHash.slice(0, 10)}</code>
              <button type="button" disabled={busy || index === 0 || !["Deployed", "Rolled Back"].includes(version.status)} onClick={() => rollback(version)}><RotateCcw size={15} /> Pulihkan</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  return <label className={styles.field}><span>{label}<small>{value.length}/{maxLength}</small></span><input value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextArea({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  return <label className={styles.field}><span>{label}<small>{value.length}/{maxLength}</small></span><textarea rows={4} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AssetField({ label, helper, currentUrl, file, onChange, compact = false }: { label: string; helper: string; currentUrl: string; file: File | null; onChange: (file: File | null) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const choose = () => {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  };
  const changed = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (selected && selected.size > 2 * 1024 * 1024) {
      window.alert("Ukuran gambar maksimal 2 MB.");
      return;
    }
    onChange(selected);
  };
  return (
    <div className={styles.assetField}>
      <span>{label}</span>
      <div className={styles.assetControl}>
        <span className={compact ? styles.assetPreviewCompact : styles.assetPreview}><img src={currentUrl} alt={`Pratinjau ${label.toLowerCase()}`} /></span>
        <span><strong>{file?.name || "Aset aktif"}</strong><small>{helper}</small></span>
        <button type="button" onClick={choose}><Upload size={15} /> Ganti</button>
        <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={changed} />
      </div>
    </div>
  );
}

function MailPreview({ theme, config, logoUrl, faviconUrl }: { theme: ThemeKey; config: EditableConfig; logoUrl: string; faviconUrl: string }) {
  return (
    <div className={`${styles.mailPreview} ${theme === "enterprise" ? styles.previewEnterprise : styles.previewPerumnet}`}>
      <div className={styles.previewVisual}>
        <div className={styles.previewOrb} />
        <img src={logoUrl} alt="" />
        <span>{config.eyebrow}</span>
        <h4>{config.headline}</h4>
        <p>{config.description}</p>
      </div>
      <div className={styles.previewFormSide}>
        <div className={styles.fakeBrowser}><img src={faviconUrl} alt="" /><span>{config.browserTitle}</span><i /></div>
        <div className={styles.previewLoginCard}>
          <div className={styles.fakeCardHead}><strong>{config.cardTitle}</strong><span>◐　EN</span></div>
          <div className={styles.fakeBrand}><img src={logoUrl} alt="" /><span>{config.eyebrow}</span></div>
          <small>Sign in</small>
          <div className={styles.fakeInput}>Email address</div>
          <div className={styles.fakeInput}>Password</div>
          <div className={styles.fakeLink}>Lupa kata sandi?</div>
          <button type="button"><Mail size={14} /> Login</button>
        </div>
      </div>
    </div>
  );
}
