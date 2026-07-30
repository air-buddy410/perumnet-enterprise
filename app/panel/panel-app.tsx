"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  Eye,
  FileText,
  Globe2,
  Handshake,
  Home,
  Image as ImageIcon,
  Languages,
  LayoutDashboard,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MessageSquareQuote,
  MonitorUp,
  Network,
  Phone,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Upload,
  UserRoundSearch,
  Wifi,
  X,
} from "lucide-react";
import styles from "./panel.module.css";

type User = { id: string; name: string; email: string; role: string };
type Service = { id: string; slug: string; title: string; titleEn: string; summary: string; summaryEn: string; description: string; descriptionEn: string; features: string[]; featuresEn: string[]; icon: string; sortOrder: number; isPublished: boolean };
type Portfolio = { id: string; title: string; titleEn: string; description: string; descriptionEn: string; imageUrl: string; location: string; locationEn: string; completedAt: string; sortOrder: number; isPublished: boolean };
type Testimonial = { id: string; clientName: string; companyName: string; review: string; reviewEn: string; isVisible: boolean; sortOrder: number };
type Page = { id: string; title: string; titleEn: string; slug: string; excerpt: string; excerptEn: string; content: string; contentEn: string; isPublished: boolean; showInNavigation: boolean; sortOrder: number };
type Faq = { id: string; question: string; questionEn: string; answer: string; answerEn: string; sortOrder: number; isVisible: boolean };
type Partner = { id: string; name: string; organizationType: "partner" | "client"; category: string; websiteUrl: string; logoUrl: string; sortOrder: number; isVisible: boolean };
type LeadStatus = "New" | "Contacted" | "Qualified" | "Proposal" | "Won" | "Lost" | "Spam";
type Lead = {
  id: string;
  fullName: string;
  whatsapp: string;
  email: string | null;
  companyName: string | null;
  jobTitle: string | null;
  location: string;
  serviceInterest: string;
  budgetRange: string | null;
  targetStart: string | null;
  message: string;
  sourcePath: string;
  status: LeadStatus;
  assignedTo: string | null;
  assignedName: string | null;
  retentionUntil: string;
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type LeadNote = { id: string; type: string; body: string; fromStatus: string | null; toStatus: string | null; createdBy: string | null; createdAt: string };
type LeadDetail = Lead & { notes: LeadNote[] };
type LeadStaff = { id: string; name: string; role: string };
type CmsText = { id: string; pageKey: string; contentKey: string; value: string; valueEn: string };
type CmsContent = {
  texts: CmsText[];
  textMap: Record<string, Record<string, string>>;
  textMapEn: Record<string, Record<string, string>>;
  settings: Record<string, string>;
  settingsEn: Record<string, string>;
  services: Service[];
  portfolios: Portfolio[];
  testimonials: Testimonial[];
  pages: Page[];
  faqs: Faq[];
  partners: Partner[];
};

type Section = "overview" | "texts" | "services" | "portfolios" | "partners" | "testimonials" | "faqs" | "pages" | "leads" | "settings";
type Mutate = (job: () => Promise<unknown>, success: string) => void;

const navItems: Array<{ id: Section; label: string; icon: typeof Home }> = [
  { id: "overview", label: "Ringkasan", icon: LayoutDashboard },
  { id: "texts", label: "Teks Situs", icon: FileText },
  { id: "services", label: "Layanan", icon: Wifi },
  { id: "portfolios", label: "Portofolio", icon: ImageIcon },
  { id: "partners", label: "Partner & Klien", icon: Handshake },
  { id: "testimonials", label: "Testimoni", icon: MessageSquareQuote },
  { id: "faqs", label: "FAQ", icon: CircleHelp },
  { id: "pages", label: "Halaman & Legal", icon: Globe2 },
  { id: "leads", label: "Customer Leads", icon: UserRoundSearch },
  { id: "settings", label: "Pengaturan Situs", icon: Settings },
];

const cmsServiceIcons: Record<string, typeof Home> = {
  wifi: Wifi,
  camera: Camera,
  phone: Phone,
  network: Network,
  shield: ShieldCheck,
  home: Home,
  terminal: TerminalSquare,
};

const textLabels: Record<string, Record<string, string>> = {
  home: {
    hero_eyebrow: "Label kecil hero",
    hero_title: "Judul utama",
    hero_description: "Deskripsi hero",
    about_eyebrow: "Label bagian tentang",
    about_title: "Judul bagian tentang",
    about_description: "Deskripsi bagian tentang",
    services_title: "Judul bagian layanan",
    services_description: "Deskripsi bagian layanan",
    portfolio_title: "Judul bagian portofolio",
    partners_eyebrow: "Label bagian partner",
    partners_title: "Judul bagian partner",
    partners_description: "Deskripsi bagian partner",
    testimonials_title: "Judul bagian testimoni",
    closing_title: "Judul CTA penutup",
  },
  services: { page_title: "Judul halaman", page_description: "Deskripsi halaman" },
  portfolio: { page_title: "Judul halaman", page_description: "Deskripsi halaman" },
  testimonials: { page_title: "Judul halaman", page_description: "Deskripsi halaman" },
  contact: { page_title: "Judul halaman", page_description: "Deskripsi halaman" },
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "Permintaan tidak dapat diproses.");
  return payload?.data as T;
}

async function translateTexts(texts: string[]) {
  const data = await request<{ translations: string[] }>("/api/cms/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  return data.translations;
}

function emptyService(): Omit<Service, "id"> {
  return { slug: "", title: "", titleEn: "", summary: "", summaryEn: "", description: "", descriptionEn: "", features: [], featuresEn: [], icon: "network", sortOrder: 0, isPublished: true };
}
function emptyPortfolio(): Omit<Portfolio, "id" | "imageUrl"> {
  return { title: "", titleEn: "", description: "", descriptionEn: "", location: "", locationEn: "", completedAt: "", sortOrder: 0, isPublished: true };
}
function portfolioForm(item?: Portfolio): Omit<Portfolio, "id" | "imageUrl"> {
  if (!item) return emptyPortfolio();
  return {
    title: item.title,
    titleEn: item.titleEn,
    description: item.description,
    descriptionEn: item.descriptionEn,
    location: item.location,
    locationEn: item.locationEn,
    completedAt: item.completedAt,
    sortOrder: item.sortOrder,
    isPublished: item.isPublished,
  };
}
function emptyTestimonial(): Omit<Testimonial, "id"> {
  return { clientName: "", companyName: "", review: "", reviewEn: "", isVisible: true, sortOrder: 0 };
}
function emptyPage(): Omit<Page, "id"> {
  return { title: "", titleEn: "", slug: "", excerpt: "", excerptEn: "", content: "", contentEn: "", isPublished: false, showInNavigation: true, sortOrder: 0 };
}
function emptyFaq(): Omit<Faq, "id"> {
  return { question: "", questionEn: "", answer: "", answerEn: "", sortOrder: 0, isVisible: true };
}
function emptyPartner(): Omit<Partner, "id" | "logoUrl"> {
  return { name: "", organizationType: "partner", category: "", websiteUrl: "", sortOrder: 0, isVisible: true };
}
function partnerForm(item?: Partner): Omit<Partner, "id" | "logoUrl"> {
  if (!item) return emptyPartner();
  return {
    name: item.name,
    organizationType: item.organizationType,
    category: item.category,
    websiteUrl: item.websiteUrl,
    sortOrder: item.sortOrder,
    isVisible: item.isVisible,
  };
}

export function PanelApp() {
  const [user, setUser] = useState<User | null>(null);
  const [content, setContent] = useState<CmsContent | null>(null);
  const [status, setStatus] = useState<"loading" | "login" | "ready" | "denied">("loading");
  const [section, setSection] = useState<Section>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadContent = useCallback(async () => {
    const data = await request<{ content: CmsContent; user: User }>("/api/cms/bootstrap");
    setContent(data.content);
    setUser(data.user);
    setStatus("ready");
  }, []);

  useEffect(() => {
    request<{ user: User | null }>("/api/auth/session")
      .then(({ user: sessionUser }) => {
        if (!sessionUser) return setStatus("login");
        if (sessionUser.role !== "Admin") { setUser(sessionUser); return setStatus("denied"); }
        setUser(sessionUser);
        return loadContent();
      })
      .catch(() => setStatus("login"));
  }, [loadContent]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  };
  const mutate: Mutate = async (job, success) => {
    setBusy(true);
    try { await job(); await loadContent(); flash(success); }
    catch (error) { flash(error instanceof Error ? error.message : "Terjadi kesalahan."); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    await request("/api/auth/logout", { method: "POST" }).catch(() => null);
    setUser(null); setContent(null); setStatus("login");
  };

  if (status === "loading") return <LoadingScreen />;
  if (status === "login") return <LoginScreen onSuccess={loadContent} />;
  if (status === "denied") return <DeniedScreen user={user} onLogout={logout} />;
  if (!content || !user) return <LoadingScreen />;

  const current = navItems.find((item) => item.id === section) || navItems[0];
  return (
    <div className={styles.panelRoot}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sideBrand}><img src="/perumnet-mark.png" alt="" /><span><strong>PERUMNET</strong><small>CONTENT STUDIO</small></span><button onClick={() => setSidebarOpen(false)} aria-label="Tutup menu"><X size={20} /></button></div>
        <div className={styles.sideLabel}>PENGELOLAAN SITUS</div>
        <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? styles.activeSide : ""} onClick={() => { setSection(id); setSidebarOpen(false); }}><Icon size={18} /><span>{label}</span>{section === id && <ChevronRight size={15} />}</button>)}</nav>
        <div className={styles.sideFooter}>
          <div className={styles.legalLinks}><Link href="/syarat-ketentuan" target="_blank">Syarat & Ketentuan</Link><Link href="/kebijakan-privasi" target="_blank">Kebijakan Privasi</Link><Link href="/#faq" target="_blank">FAQ</Link></div>
          <Link href="/" target="_blank" rel="noreferrer"><MonitorUp size={17} /><span>Lihat website</span><ArrowRight size={14} /></Link>
          <Link href="/admin"><BriefcaseBusiness size={17} /><span>Buka ERP</span><ArrowRight size={14} /></Link>
          <div className={styles.userChip}><span>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{user.name}</strong><small>Administrator</small></div><button onClick={logout} aria-label="Keluar"><LogOut size={17} /></button></div>
        </div>
      </aside>
      {sidebarOpen && <button className={styles.backdrop} onClick={() => setSidebarOpen(false)} aria-label="Tutup menu" />}
      <div className={styles.workspace}>
        <header className={styles.topbar}><button className={styles.menuButton} onClick={() => setSidebarOpen(true)} aria-label="Buka menu"><Menu size={21} /></button><div><span>Panel CMS</span><h1>{current.label}</h1></div><Link className={styles.previewLink} href="/" target="_blank" rel="noreferrer" aria-label="Pratinjau situs"><Eye size={18} /><span>Pratinjau situs</span></Link></header>
        <main className={styles.mainContent}>
          {section === "overview" && <Overview content={content} user={user} onNavigate={setSection} />}
          {section === "texts" && <TextEditor key={JSON.stringify(content.texts)} content={content} busy={busy} mutate={mutate} />}
          {section === "services" && <ServiceEditor key={JSON.stringify(content.services)} items={content.services} busy={busy} mutate={mutate} />}
          {section === "portfolios" && <PortfolioEditor key={JSON.stringify(content.portfolios)} items={content.portfolios} busy={busy} mutate={mutate} />}
          {section === "partners" && <PartnerEditor key={JSON.stringify(content.partners)} items={content.partners} busy={busy} mutate={mutate} />}
          {section === "testimonials" && <TestimonialEditor key={JSON.stringify(content.testimonials)} items={content.testimonials} busy={busy} mutate={mutate} />}
          {section === "faqs" && <FaqEditor key={JSON.stringify(content.faqs)} items={content.faqs} busy={busy} mutate={mutate} />}
          {section === "pages" && <PageEditor key={JSON.stringify(content.pages)} items={content.pages} busy={busy} mutate={mutate} />}
          {section === "leads" && <LeadEditor />}
          {section === "settings" && <SettingsEditor key={JSON.stringify([content.settings, content.settingsEn])} settings={content.settings} settingsEn={content.settingsEn} busy={busy} mutate={mutate} />}
        </main>
      </div>
      {notice && <div className={styles.toast}><Check size={17} /> {notice}</div>}
    </div>
  );
}

function LoadingScreen() {
  return <main className={styles.loading}><img src="/perumnet-mark.png" alt="PerumNet Enterprise" /><LoaderCircle size={25} /><p>Menyiapkan Content Studio...</p></main>;
}

function LoginScreen({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("resetToken");
    if (token) {
      const update = window.setTimeout(() => {
        setResetToken(token);
        setMode("reset");
      }, 0);
      return () => window.clearTimeout(update);
    }
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { user } = await request<{ user: User }>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, remember: false }) });
      if (user.role !== "Admin") throw new Error("Akun ini tidak memiliki akses Administrator.");
      await onSuccess();
    } catch (error) { setError(error instanceof Error ? error.message : "Email atau kata sandi salah."); }
    finally { setBusy(false); }
  };
  const submitForgot = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await request<{ message: string; resetToken?: string }>("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, surface: "panel" }),
      });
      setResetToken(result.resetToken ?? "");
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Email pemulihan belum dapat dikirim.");
    } finally { setBusy(false); }
  };
  const submitReset = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    if (password.length < 8) {
      setBusy(false); setError("Kata sandi baru minimal 8 karakter."); return;
    }
    if (password !== confirmPassword) {
      setBusy(false); setError("Konfirmasi kata sandi belum sama."); return;
    }
    try {
      await request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password }),
      });
      window.history.replaceState({}, "", window.location.pathname);
      setMode("login"); setSent(false); setResetToken(""); setConfirmPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Kata sandi belum dapat diperbarui.");
    } finally { setBusy(false); }
  };
  return <main className={styles.loginRoot}>
    <section className={styles.loginVisual}>
      <div className={styles.loginBrand}><img src="/perumnet-mark.png" alt="" /><strong>PERUMNET ENTERPRISE</strong></div>
      <div className={styles.loginCopy}><span>CONTENT MANAGEMENT SYSTEM</span><h1>Kelola website<br /><em>tanpa menyentuh kode.</em></h1><p>Perbarui layanan, portofolio, partner, FAQ, halaman legal, dan informasi kontak dari satu ruang kerja.</p><div><LockKeyhole size={20} /><span><strong>Akses aman Administrator</strong><small>Sesi terlindungi dan tercatat</small></span></div></div>
      <div className={styles.loginStatus}><span /> Sistem pengelolaan konten siap digunakan</div>
    </section>
    <section className={styles.loginFormWrap}>
      {mode === "login" && <form onSubmit={submit} className={styles.loginForm}>
        <div className={styles.portalLabel}><span /> Portal pengelolaan PerumNet</div>
        <span className={styles.formEyebrow}>AKSES ADMIN</span><h2>Selamat datang kembali.</h2><p>Masuk dengan akun Administrator PerumNet Enterprise.</p>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@perumnet.id" required autoComplete="email" /></label>
        <label>Kata sandi<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan kata sandi" required minLength={8} autoComplete="current-password" /></label>
        <button className={styles.loginFormSwitch} type="button" onClick={() => { setMode("forgot"); setError(""); }}>Lupa kata sandi?</button>
        {error && <div className={styles.formError}>{error}</div>}
        <button type="submit" disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={19} /> : <>Masuk ke Panel <ArrowRight size={18} /></>}</button>
        <div className={styles.loginLegal}><Link href="/syarat-ketentuan">Syarat dan Ketentuan</Link><Link href="/kebijakan-privasi">Kebijakan Privasi</Link><Link href="/#faq">FAQ</Link></div>
        <small>© {new Date().getFullYear()} PerumNet Enterprise</small>
      </form>}
      {mode === "forgot" && <form onSubmit={submitForgot} className={styles.loginForm}>
        <button className={styles.loginBack} type="button" onClick={() => { setMode("login"); setSent(false); setError(""); }}><ArrowLeft size={16} /> Kembali ke login</button>
        <Mail className={styles.loginModeIcon} size={25} />
        <span className={styles.formEyebrow}>PEMULIHAN AKSES</span><h2>Lupa kata sandi?</h2><p>Kami akan mengirim tautan pemulihan ke email Administrator yang terdaftar.</p>
        {!sent ? <>
          <label>Email terdaftar<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          {error && <div className={styles.formError}>{error}</div>}
          <button type="submit" disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={19} /> : <>Kirim tautan pemulihan <ArrowRight size={18} /></>}</button>
        </> : <div className={styles.loginSuccess}><strong>Email pemulihan diproses.</strong><span>Jika akun Administrator terdaftar, tautan reset akan dikirim ke {email}.</span>{resetToken && <button type="button" onClick={() => setMode("reset")}>Buka halaman reset</button>}</div>}
      </form>}
      {mode === "reset" && <form onSubmit={submitReset} className={styles.loginForm}>
        <button className={styles.loginBack} type="button" onClick={() => { setMode("forgot"); setError(""); }}><ArrowLeft size={16} /> Kembali</button>
        <KeyRound className={styles.loginModeIcon} size={25} />
        <span className={styles.formEyebrow}>KATA SANDI BARU</span><h2>Amankan akun Anda.</h2><p>Gunakan minimal delapan karakter dan jangan memakai ulang kata sandi lama.</p>
        <label>Kata sandi baru<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
        <label>Konfirmasi kata sandi<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
        {error && <div className={styles.formError}>{error}</div>}
        <button type="submit" disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={19} /> : <>Simpan kata sandi <ArrowRight size={18} /></>}</button>
      </form>}
    </section>
  </main>;
}

function DeniedScreen({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  return <main className={styles.denied}><LockKeyhole size={34} /><h1>Akses panel dibatasi.</h1><p>Akun {user?.email} bukan Administrator. Silakan masuk dengan akun yang memiliki izin pengelolaan website.</p><button onClick={onLogout}>Keluar dan ganti akun</button></main>;
}

function Overview({ content, user, onNavigate }: { content: CmsContent; user: User; onNavigate: (section: Section) => void }) {
  return <>
    <section className={styles.welcome}><div><span><Sparkles size={14} /> KONTEN WEBSITE</span><h2>Selamat bekerja, {user.name.split(" ")[0]}.</h2><p>Konten Indonesia dan Inggris dibaca langsung dari database setelah disimpan.</p></div><a href="/" target="_blank" rel="noreferrer">Buka website <ArrowRight size={17} /></a></section>
    <section className={styles.metrics}>
      <div><span><Wifi size={19} /></span><strong>{content.services.length}</strong><small>Layanan</small></div>
      <div><span><Handshake size={19} /></span><strong>{content.partners.filter((item) => item.isVisible).length}</strong><small>Partner & klien</small></div>
      <div><span><CircleHelp size={19} /></span><strong>{content.faqs.filter((item) => item.isVisible).length}</strong><small>FAQ tampil</small></div>
      <div><span><Globe2 size={19} /></span><strong>{content.pages.filter((item) => item.isPublished).length}</strong><small>Halaman terbit</small></div>
    </section>
    <section className={styles.overviewGrid}>
      <div className={styles.quickPanel}><div className={styles.panelHeading}><div><span>AKSES CEPAT</span><h3>Kelola konten utama</h3></div></div><div className={styles.quickGrid}>{navItems.slice(1).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => onNavigate(id)}><Icon size={20} /><span>{label}</span><ChevronRight size={16} /></button>)}</div></div>
      <div className={styles.siteStatus}><span>SITUS PUBLIK</span><h3>Website aktif dan bilingual.</h3><p>Gunakan terjemahan otomatis sebagai draf, lalu tinjau kembali istilah teknis sebelum menerbitkan konten.</p><div><span /><strong>Online</strong><small>enterprise.perumnet.com · enterprise.perumnet.id</small></div></div>
    </section>
  </>;
}

function SectionTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className={styles.sectionTitle}><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function TranslateButton({ values, onTranslated, busy }: { values: string[]; onTranslated: (values: string[]) => void; busy: boolean }) {
  const [translating, setTranslating] = useState(false);
  return <button type="button" className={styles.translateAction} disabled={busy || translating || values.every((value) => !value.trim())} onClick={async () => {
    setTranslating(true);
    try { onTranslated(await translateTexts(values)); }
    catch (error) { window.alert(error instanceof Error ? error.message : "Terjemahan gagal."); }
    finally { setTranslating(false); }
  }}>{translating ? <LoaderCircle className={styles.spin} size={16} /> : <Languages size={16} />} Terjemahkan ID → EN</button>;
}

function LanguageHeading({ label, helper, action }: { label: string; helper: string; action?: React.ReactNode }) {
  return <div className={styles.languageHeading}><div><strong>{label}</strong><small>{helper}</small></div>{action}</div>;
}

function TextEditor({ content, busy, mutate }: { content: CmsContent; busy: boolean; mutate: Mutate }) {
  const initial = useMemo(() => Object.fromEntries(content.texts.map((item) => [`${item.pageKey}.${item.contentKey}`, item.value])), [content]);
  const initialEn = useMemo(() => Object.fromEntries(content.texts.map((item) => [`${item.pageKey}.${item.contentKey}`, item.valueEn])), [content]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [valuesEn, setValuesEn] = useState<Record<string, string>>(initialEn);
  const save = () => mutate(() => request("/api/cms/texts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: Object.keys(values).map((key) => { const [pageKey, ...rest] = key.split("."); return { pageKey, contentKey: rest.join("."), value: values[key], valueEn: valuesEn[key] || "" }; }) }),
  }), "Teks situs Indonesia dan Inggris berhasil diperbarui.");
  const translateAll = async () => {
    const keys = Object.keys(values);
    const translated = await translateTexts(keys.map((key) => values[key]));
    setValuesEn(Object.fromEntries(keys.map((key, index) => [key, translated[index]])));
  };
  return <>
    <SectionTitle eyebrow="EDIT TEKS SITUS" title="Perbarui pesan di setiap halaman." description="Konten Inggris dapat diterjemahkan otomatis lalu ditinjau sebelum disimpan." action={<div className={styles.actionGroup}><button type="button" className={styles.translateAction} disabled={busy} onClick={() => translateAll().catch((error) => window.alert(error instanceof Error ? error.message : "Terjemahan gagal."))}><Languages size={17} /> Terjemahkan semua</button><button className={styles.primaryAction} disabled={busy} onClick={save}><Save size={17} /> Simpan semua</button></div>} />
    <div className={styles.formStack}>{Object.entries(textLabels).map(([pageKey, fields]) => <section className={styles.editorCard} key={pageKey}><div className={styles.cardHeading}><span>{pageKey === "home" ? "Beranda" : pageKey[0].toUpperCase() + pageKey.slice(1)}</span><small>{Object.keys(fields).length} bidang teks · ID / EN</small></div><div className={styles.bilingualGrid}>{Object.entries(fields).map(([contentKey, label]) => { const id = `${pageKey}.${contentKey}`; const long = contentKey.includes("description") || contentKey.includes("title"); return <div className={styles.translationPair} key={id}><label><span>{label} · Indonesia</span>{long ? <textarea rows={contentKey.includes("description") ? 4 : 2} value={values[id] || ""} onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))} /> : <input value={values[id] || ""} onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))} />}</label><label><span>{label} · English</span>{long ? <textarea rows={contentKey.includes("description") ? 4 : 2} value={valuesEn[id] || ""} onChange={(event) => setValuesEn((current) => ({ ...current, [id]: event.target.value }))} /> : <input value={valuesEn[id] || ""} onChange={(event) => setValuesEn((current) => ({ ...current, [id]: event.target.value }))} />}</label></div>; })}</div></section>)}</div>
  </>;
}

function ServiceEditor({ items, busy, mutate }: { items: Service[]; busy: boolean; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Service, "id">>(current ? { ...current } : emptyService());
  const submit = () => mutate(() => request(`/api/cms/services${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "Layanan berhasil diperbarui." : "Layanan baru berhasil ditambahkan.");
  return <>
    <SectionTitle eyebrow="LAYANAN" title="Kelola solusi dan PerumNet Labs." description="Atur konten bilingual, fitur, ikon, urutan, dan status tayang." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyService()); }}><Plus size={17} /> Layanan baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar layanan">{items.map((item) => { const Icon = cmsServiceIcons[item.icon] || Network; return <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.itemIcon}><Icon size={18} /></span><div><strong>{item.title}</strong><small>{item.isPublished ? "Tayang" : "Disembunyikan"}</small></div><ChevronRight size={16} /></button>; })}</ListPanel><EditorPanel title={selected ? "Edit layanan" : "Layanan baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus layanan ini?")) mutate(() => request(`/api/cms/services/${selected}`, { method: "DELETE" }), "Layanan dihapus."); } : undefined}>
      <LanguageHeading label="Bahasa Indonesia" helper="Konten sumber yang tampil pada pilihan ID." action={<TranslateButton busy={busy} values={[form.title, form.summary, form.description, form.features.join("\n")]} onTranslated={([titleEn, summaryEn, descriptionEn, featuresEn]) => setForm({ ...form, titleEn, summaryEn, descriptionEn, featuresEn: featuresEn.split("\n").filter(Boolean) })} />} />
      <div className={styles.fieldGrid}><Field label="Nama layanan" value={form.title} onChange={(title) => setForm({ ...form, title })} /><Field label="Slug URL" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="otomatis-dari-judul" /><TextArea label="Ringkasan" value={form.summary} rows={3} onChange={(summary) => setForm({ ...form, summary })} /><TextArea label="Deskripsi lengkap" value={form.description} rows={5} onChange={(description) => setForm({ ...form, description })} /><TextArea label="Fitur (satu per baris)" value={form.features.join("\n")} rows={5} onChange={(value) => setForm({ ...form, features: value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></div>
      <LanguageHeading label="English" helper="Tinjau istilah teknis setelah terjemahan otomatis." />
      <div className={styles.fieldGrid}><Field label="Service name" value={form.titleEn} onChange={(titleEn) => setForm({ ...form, titleEn })} /><TextArea label="Summary" value={form.summaryEn} rows={3} onChange={(summaryEn) => setForm({ ...form, summaryEn })} /><TextArea label="Full description" value={form.descriptionEn} rows={5} onChange={(descriptionEn) => setForm({ ...form, descriptionEn })} /><TextArea label="Features (one per line)" value={form.featuresEn.join("\n")} rows={5} onChange={(value) => setForm({ ...form, featuresEn: value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></div>
      <div className={styles.fieldGrid}><SelectField label="Ikon" value={form.icon} options={["wifi","camera","phone","network","shield","home","terminal"]} onChange={(icon) => setForm({ ...form, icon })} /><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><ToggleField label="Tampilkan di website" checked={form.isPublished} onChange={(isPublished) => setForm({ ...form, isPublished })} /></div>
    </EditorPanel></div>
  </>;
}

function PortfolioEditor({ items, busy, mutate }: { items: Portfolio[]; busy: boolean; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState(portfolioForm(current));
  const [file, setFile] = useState<File | null>(null);
  const submit = () => { const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.set(key, String(value))); if (file) body.set("image", file); mutate(() => request(`/api/cms/portfolios${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", body }), selected ? "Portofolio berhasil diperbarui." : "Proyek baru berhasil ditambahkan."); };
  return <>
    <SectionTitle eyebrow="PORTOFOLIO" title="Tampilkan bukti kerja terbaik Anda." description="Unggah foto proyek dan kelola deskripsi Indonesia serta Inggris." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyPortfolio()); setFile(null); }}><Plus size={17} /> Proyek baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar proyek">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm(portfolioForm(item)); setFile(null); }}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className={styles.itemIcon}><Camera size={18} /></span>}<div><strong>{item.title}</strong><small>{item.location || "Tanpa lokasi"}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit portofolio" : "Proyek baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus proyek portofolio ini?")) mutate(() => request(`/api/cms/portfolios/${selected}`, { method: "DELETE" }), "Portofolio dihapus."); } : undefined}>
      <LanguageHeading label="Konten bilingual" helper="Terjemahkan lalu tinjau sebelum disimpan." action={<TranslateButton busy={busy} values={[form.title, form.location, form.description]} onTranslated={([titleEn, locationEn, descriptionEn]) => setForm({ ...form, titleEn, locationEn, descriptionEn })} />} />
      <div className={styles.fieldGrid}><Field label="Judul proyek · ID" value={form.title} onChange={(title) => setForm({ ...form, title })} /><Field label="Project title · EN" value={form.titleEn} onChange={(titleEn) => setForm({ ...form, titleEn })} /><Field label="Lokasi · ID" value={form.location} onChange={(location) => setForm({ ...form, location })} /><Field label="Location · EN" value={form.locationEn} onChange={(locationEn) => setForm({ ...form, locationEn })} /><TextArea label="Deskripsi · ID" value={form.description} rows={5} onChange={(description) => setForm({ ...form, description })} /><TextArea label="Description · EN" value={form.descriptionEn} rows={5} onChange={(descriptionEn) => setForm({ ...form, descriptionEn })} /><label><span>Tanggal selesai</span><input type="date" value={form.completedAt} onChange={(event) => setForm({ ...form, completedAt: event.target.value })} /></label><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><FileUploadField label="Foto proyek (JPG, PNG, WebP · maks. 5 MB)" accept="image/jpeg,image/png,image/webp" file={file} buttonLabel="Pilih foto proyek" helper="Klik untuk memilih foto dari perangkat Anda." currentUrl={current?.imageUrl} previewAlt={current?.title || "Foto proyek"} previewClassName={styles.imagePreview} onChange={setFile} /><ToggleField label="Tampilkan di website" checked={form.isPublished} onChange={(isPublished) => setForm({ ...form, isPublished })} /></div>
    </EditorPanel></div>
  </>;
}

function PartnerEditor({ items, busy, mutate }: { items: Partner[]; busy: boolean; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState(partnerForm(current));
  const [file, setFile] = useState<File | null>(null);
  const submit = () => { const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.set(key, String(value))); if (file) body.set("logo", file); mutate(() => request(`/api/cms/partners${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", body }), selected ? "Partner atau klien berhasil diperbarui." : "Partner atau klien berhasil ditambahkan."); };
  return <>
    <SectionTitle eyebrow="PARTNER & KLIEN" title="Kelola organisasi yang tampil di landing page." description="Nama, kategori, tautan, dan logo dapat disusun ulang atau disembunyikan." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyPartner()); setFile(null); }}><Plus size={17} /> Tambah organisasi</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar organisasi">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm(partnerForm(item)); setFile(null); }}>{item.logoUrl ? <span className={`${styles.partnerListLogo} ${item.logoUrl.toLowerCase().includes("quenzo") ? styles.partnerListLogoDark : ""}`}><img src={item.logoUrl} alt="" /></span> : <span className={styles.itemIcon}><Handshake size={18} /></span>}<div><strong>{item.name}</strong><small>{item.organizationType === "partner" ? "Partner teknologi" : "Klien"} · {item.isVisible ? "Tampil" : "Tersembunyi"}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit organisasi" : "Organisasi baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus organisasi ini?")) mutate(() => request(`/api/cms/partners/${selected}`, { method: "DELETE" }), "Organisasi dihapus."); } : undefined}>
      <div className={styles.fieldGrid}><Field label="Nama organisasi" value={form.name} onChange={(name) => setForm({ ...form, name })} /><SelectField label="Jenis" value={form.organizationType} options={["partner","client"]} onChange={(organizationType) => setForm({ ...form, organizationType: organizationType as "partner" | "client" })} /><Field label="Kategori / sektor" value={form.category} onChange={(category) => setForm({ ...form, category })} placeholder="Partner Teknologi, Hospitality, Retail..." /><Field label="Website URL (opsional)" value={form.websiteUrl} onChange={(websiteUrl) => setForm({ ...form, websiteUrl })} type="url" /><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><FileUploadField label="Logo (SVG, PNG, JPG, WebP · maks. 2 MB)" accept="image/svg+xml,image/png,image/jpeg,image/webp" file={file} buttonLabel="Pilih logo organisasi" helper="Klik untuk memilih logo dari perangkat Anda." currentUrl={current?.logoUrl} previewAlt={current?.name || "Logo organisasi"} previewClassName={styles.logoPreview} onChange={setFile} /><ToggleField label="Tampilkan di website" checked={form.isVisible} onChange={(isVisible) => setForm({ ...form, isVisible })} /></div>
    </EditorPanel></div>
  </>;
}

function TestimonialEditor({ items, busy, mutate }: { items: Testimonial[]; busy: boolean; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Testimonial, "id">>(current ? { ...current } : emptyTestimonial());
  const submit = () => mutate(() => request(`/api/cms/testimonials${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "Testimoni berhasil diperbarui." : "Testimoni baru berhasil ditambahkan.");
  return <>
    <SectionTitle eyebrow="TESTIMONI" title="Kelola cerita dan kepercayaan klien." description="Nama tetap sama; ulasan memiliki versi Indonesia dan Inggris." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyTestimonial()); }}><Plus size={17} /> Testimoni baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar testimoni">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.avatar}>{item.clientName.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><div><strong>{item.clientName}</strong><small>{item.isVisible ? "Tampil" : "Disembunyikan"}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit testimoni" : "Testimoni baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus testimoni ini?")) mutate(() => request(`/api/cms/testimonials/${selected}`, { method: "DELETE" }), "Testimoni dihapus."); } : undefined}>
      <LanguageHeading label="Ulasan bilingual" helper="Gunakan terjemahan otomatis sebagai draf." action={<TranslateButton busy={busy} values={[form.review]} onTranslated={([reviewEn]) => setForm({ ...form, reviewEn })} />} />
      <div className={styles.fieldGrid}><Field label="Nama klien" value={form.clientName} onChange={(clientName) => setForm({ ...form, clientName })} /><Field label="Perusahaan" value={form.companyName} onChange={(companyName) => setForm({ ...form, companyName })} /><TextArea label="Ulasan · ID" value={form.review} rows={7} onChange={(review) => setForm({ ...form, review })} /><TextArea label="Review · EN" value={form.reviewEn} rows={7} onChange={(reviewEn) => setForm({ ...form, reviewEn })} /><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><ToggleField label="Tampilkan testimoni" checked={form.isVisible} onChange={(isVisible) => setForm({ ...form, isVisible })} /></div>
    </EditorPanel></div>
  </>;
}

function FaqEditor({ items, busy, mutate }: { items: Faq[]; busy: boolean; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Faq, "id">>(current ? { ...current } : emptyFaq());
  const submit = () => mutate(() => request(`/api/cms/faqs${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "FAQ berhasil diperbarui." : "FAQ baru berhasil ditambahkan.");
  return <>
    <SectionTitle eyebrow="FAQ" title="Jawab pertanyaan sebelum calon klien bertanya." description="Setiap pertanyaan dapat diterjemahkan, diurutkan, dan disembunyikan tanpa menghapus." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyFaq()); }}><Plus size={17} /> FAQ baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar FAQ">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.itemIcon}><CircleHelp size={18} /></span><div><strong>{item.question}</strong><small>{item.isVisible ? "Tampil" : "Disembunyikan"}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit FAQ" : "FAQ baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus FAQ ini?")) mutate(() => request(`/api/cms/faqs/${selected}`, { method: "DELETE" }), "FAQ dihapus."); } : undefined}>
      <LanguageHeading label="Konten bilingual" helper="Terjemahkan jawaban, lalu tinjau istilah layanan." action={<TranslateButton busy={busy} values={[form.question, form.answer]} onTranslated={([questionEn, answerEn]) => setForm({ ...form, questionEn, answerEn })} />} />
      <div className={styles.fieldGrid}><TextArea label="Pertanyaan · ID" value={form.question} rows={3} onChange={(question) => setForm({ ...form, question })} /><TextArea label="Question · EN" value={form.questionEn} rows={3} onChange={(questionEn) => setForm({ ...form, questionEn })} /><TextArea label="Jawaban · ID" value={form.answer} rows={7} onChange={(answer) => setForm({ ...form, answer })} /><TextArea label="Answer · EN" value={form.answerEn} rows={7} onChange={(answerEn) => setForm({ ...form, answerEn })} /><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><ToggleField label="Tampilkan di website" checked={form.isVisible} onChange={(isVisible) => setForm({ ...form, isVisible })} /></div>
    </EditorPanel></div>
  </>;
}

function PageEditor({ items, busy, mutate }: { items: Page[]; busy: boolean; mutate: Mutate }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Page, "id">>(current ? { ...current } : emptyPage());
  const submit = () => mutate(() => request(`/api/cms/pages${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "Halaman berhasil diperbarui." : "Halaman baru berhasil dibuat.");
  return <>
    <SectionTitle eyebrow="HALAMAN & LEGAL" title="Kelola halaman, syarat, dan kebijakan privasi." description="Halaman legal dapat terbit di footer tanpa harus muncul di menu header." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyPage()); }}><Plus size={17} /> Halaman baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar halaman">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.itemIcon}><Globe2 size={18} /></span><div><strong>{item.title}</strong><small>{item.isPublished ? "Terbit" : "Draf"} · /{item.slug}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit halaman" : "Halaman baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus halaman ini?")) mutate(() => request(`/api/cms/pages/${selected}`, { method: "DELETE" }), "Halaman dihapus."); } : undefined}>
      <LanguageHeading label="Konten bilingual" helper="Pisahkan paragraf dengan satu baris kosong." action={<TranslateButton busy={busy} values={[form.title, form.excerpt, form.content]} onTranslated={([titleEn, excerptEn, contentEn]) => setForm({ ...form, titleEn, excerptEn, contentEn })} />} />
      <div className={styles.fieldGrid}><Field label="Judul halaman · ID" value={form.title} onChange={(title) => setForm({ ...form, title })} /><Field label="Page title · EN" value={form.titleEn} onChange={(titleEn) => setForm({ ...form, titleEn })} /><Field label="Slug URL" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="otomatis-dari-judul" /><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><TextArea label="Ringkasan · ID" value={form.excerpt} rows={3} onChange={(excerpt) => setForm({ ...form, excerpt })} /><TextArea label="Excerpt · EN" value={form.excerptEn} rows={3} onChange={(excerptEn) => setForm({ ...form, excerptEn })} /><TextArea label="Isi halaman · ID" value={form.content} rows={12} onChange={(contentValue) => setForm({ ...form, content: contentValue })} /><TextArea label="Page content · EN" value={form.contentEn} rows={12} onChange={(contentEn) => setForm({ ...form, contentEn })} /><ToggleField label="Terbitkan halaman" checked={form.isPublished} onChange={(isPublished) => setForm({ ...form, isPublished })} /><ToggleField label="Tampilkan sebagai menu halaman" checked={form.showInNavigation} onChange={(showInNavigation) => setForm({ ...form, showInNavigation })} /></div>
    </EditorPanel></div>
  </>;
}

const leadStatuses: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost", "Spam"];

function leadDate(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    timeZone: "Asia/Makassar",
  }).format(date).replace(":", ".");
}

function LeadEditor() {
  const [items, setItems] = useState<Lead[]>([]);
  const [staff, setStaff] = useState<LeadStaff[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [selected, setSelected] = useState<LeadDetail | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const pageSize = 25;

  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (assignedTo) params.set("assignedTo", assignedTo);
    return params;
  }, [assignedTo, page, query, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<{ items: Lead[]; total: number; staff: LeadStaff[] }>(`/api/cms/leads?${filterParams}`);
      setItems(data.items);
      setTotal(data.total);
      setStaff(data.staff);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Customer leads gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, [filterParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function openLead(id: string) {
    setSaving(true);
    try {
      setSelected(await request<LeadDetail>(`/api/cms/leads/${id}`));
      setNote("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Detail lead gagal dimuat.");
    } finally {
      setSaving(false);
    }
  }

  async function updateLead(input: { status?: LeadStatus; assignedTo?: string | null; note?: string; retentionUntil?: string }) {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await request<LeadDetail>(`/api/cms/leads/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      setSelected(updated);
      setNote("");
      setNotice("Customer lead berhasil diperbarui.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Perubahan lead gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLead() {
    if (!selected || !window.confirm(`Anonimkan dan hapus data pribadi ${selected.fullName}? Tindakan ini tidak dapat dibatalkan.`)) return;
    setSaving(true);
    try {
      await request(`/api/cms/leads/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setNotice("Data pribadi lead telah dihapus.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Data lead gagal dihapus.");
    } finally {
      setSaving(false);
    }
  }

  function exportHref(format: "csv" | "xlsx" | "pdf") {
    const params = new URLSearchParams(filterParams);
    params.delete("page");
    params.delete("pageSize");
    return `/api/cms/leads/export.${format}?${params}`;
  }

  return <>
    <SectionTitle eyebrow="CUSTOMER LEADS" title="Tindak lanjuti permintaan calon klien." description="Cari, klasifikasikan, tetapkan penanggung jawab, dan ekspor data sesuai filter aktif." action={<div className={styles.actionGroup}><a className={styles.secondaryAction} href={exportHref("csv")}><Download size={16} /> CSV</a><a className={styles.secondaryAction} href={exportHref("xlsx")}><Download size={16} /> Excel</a><a className={styles.primaryAction} href={exportHref("pdf")}><Download size={16} /> PDF</a></div>} />
    {notice ? <div className={styles.inlineNotice}>{notice}<button type="button" onClick={() => setNotice("")}><X size={14} /></button></div> : null}
    <section className={styles.leadToolbar}>
      <form onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(searchInput.trim()); }}><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Cari nama, WhatsApp, perusahaan, lokasi..." /><button type="submit">Cari</button></form>
      <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Semua status</option>{leadStatuses.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={assignedTo} onChange={(event) => { setAssignedTo(event.target.value); setPage(1); }}><option value="">Semua penanggung jawab</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select>
    </section>
    <section className={styles.leadWorkspace}>
      <div className={styles.leadTableCard}>
        <div className={styles.cardHeading}><span>{total} customer lead</span><small>Urutan terbaru</small></div>
        {loading ? <div className={styles.leadEmpty}><LoaderCircle className={styles.spin} size={23} /> Memuat lead...</div> : items.length ? <div className={styles.leadTableScroll}><table className={styles.leadTable}><thead><tr><th>Masuk</th><th>Calon klien</th><th>Layanan</th><th>Status</th><th>PIC</th></tr></thead><tbody>{items.map((lead) => <tr key={lead.id} role="button" tabIndex={0} onClick={() => void openLead(lead.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openLead(lead.id); }} className={selected?.id === lead.id ? styles.leadSelected : ""}><td>{leadDate(lead.createdAt)}</td><td><strong>{lead.fullName}</strong><small>{lead.companyName || lead.whatsapp}</small></td><td><strong>{lead.serviceInterest}</strong><small>{lead.location}</small></td><td><span className={`${styles.leadStatus} ${styles[`leadStatus${lead.status}`]}`}>{lead.status}</span></td><td>{lead.assignedName || "Belum ditetapkan"}</td></tr>)}</tbody></table></div> : <div className={styles.leadEmpty}><UserRoundSearch size={28} /><strong>Tidak ada lead pada filter ini.</strong></div>}
        <div className={styles.leadPagination}><span>Halaman {page} dari {Math.max(1, Math.ceil(total / pageSize))}</span><div><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Sebelumnya</button><button disabled={page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>Berikutnya</button></div></div>
      </div>
      <aside className={styles.leadDetail}>
        {selected ? <>
          <div className={styles.leadDetailHead}><div><span>{selected.serviceInterest}</span><h3>{selected.fullName}</h3><p>{selected.companyName || "Individu"}{selected.jobTitle ? ` · ${selected.jobTitle}` : ""}</p></div><button type="button" aria-label="Tutup detail lead" onClick={() => setSelected(null)}><X size={17} /></button></div>
          <dl className={styles.leadFacts}><div><dt>WhatsApp</dt><dd><a href={`https://wa.me/${selected.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{selected.whatsapp}</a></dd></div><div><dt>Email</dt><dd>{selected.email ? <a href={`mailto:${selected.email}`}>{selected.email}</a> : "—"}</dd></div><div><dt>Lokasi</dt><dd>{selected.location}</dd></div><div><dt>Budget</dt><dd>{selected.budgetRange || "Belum ditentukan"}</dd></div><div><dt>Target</dt><dd>{selected.targetStart ? leadDate(`${selected.targetStart}T00:00:00+08:00`) : "Belum ditentukan"}</dd></div><div><dt>Sumber</dt><dd>{selected.sourcePath}</dd></div></dl>
          <div className={styles.leadMessage}><span>Kebutuhan</span><p>{selected.message}</p></div>
          <label className={styles.leadControl}><span>Status pipeline</span><select value={selected.status} disabled={saving} onChange={(event) => void updateLead({ status: event.target.value as LeadStatus })}>{leadStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className={styles.leadControl}><span>Penanggung jawab</span><select value={selected.assignedTo || ""} disabled={saving} onChange={(event) => void updateLead({ assignedTo: event.target.value || null })}><option value="">Belum ditetapkan</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label>
          <div className={styles.leadRetention}><span>Retensi data sampai</span><strong>{leadDate(selected.retentionUntil)}</strong><button type="button" disabled={saving} onClick={() => { const next = new Date(selected.retentionUntil); next.setUTCFullYear(next.getUTCFullYear() + 1); void updateLead({ retentionUntil: next.toISOString() }); }}>Perpanjang 1 tahun</button></div>
          <form className={styles.leadNoteForm} onSubmit={(event) => { event.preventDefault(); if (note.trim()) void updateLead({ note: note.trim() }); }}><label><span>Catatan follow-up</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Hasil telepon, jadwal survei, atau tindak lanjut..." /></label><button disabled={saving || !note.trim()}>{saving ? <LoaderCircle className={styles.spin} size={15} /> : <Save size={15} />} Simpan catatan</button></form>
          <div className={styles.leadHistory}><span>Riwayat</span>{selected.notes.length ? selected.notes.map((item) => <div key={item.id}><i /><p>{item.body}<small>{item.createdBy || "Sistem"} · {leadDate(item.createdAt, true)} WITA</small></p></div>) : <small>Belum ada catatan follow-up.</small>}</div>
          <button className={styles.leadPrivacyDelete} type="button" disabled={saving} onClick={() => void deleteLead()}><Trash2 size={15} /> Hapus data atas permintaan privasi</button>
        </> : <div className={styles.leadEmpty}><UserRoundSearch size={31} /><strong>Pilih lead untuk melihat detail.</strong><span>Riwayat, PIC, status, dan retensi dikelola dari panel ini.</span></div>}
      </aside>
    </section>
  </>;
}

function SettingsEditor({ settings, settingsEn, busy, mutate }: { settings: Record<string,string>; settingsEn: Record<string,string>; busy: boolean; mutate: Mutate }) {
  const [values, setValues] = useState(settings);
  const [valuesEn, setValuesEn] = useState(settingsEn);
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const setEn = (key: string, value: string) => setValuesEn((current) => ({ ...current, [key]: value }));
  const save = () => {
    const translatedKeys = ["company_name", "company_tagline", "address", "cta_text", "business_hours", "seo_title", "seo_description", "og_title", "og_description", "business_legal_name", "business_area"];
    const safeSettingsEn = Object.fromEntries(
      translatedKeys
        .map((key) => [key, valuesEn[key] || ""] as const)
        .filter(([, value]) => value.trim()),
    );
    mutate(() => request("/api/cms/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: values, settingsEn: safeSettingsEn }) }), "Pengaturan situs berhasil disimpan.");
  };
  return <>
    <SectionTitle eyebrow="PENGATURAN SITUS" title="Identitas, kontak, dan tampilan dalam satu tempat." description="Kontak bersifat universal; tagline, jam layanan, dan CTA memiliki versi Inggris." action={<button className={styles.primaryAction} disabled={busy} onClick={save}><Save size={17} /> Simpan pengaturan</button>} />
    <div className={styles.formStack}>
      <section className={styles.editorCard}><div className={styles.cardHeading}><span>Warna & tampilan publik</span><small>Kontras, animasi halaman, dan kecepatan carousel partner</small></div><div className={styles.appearanceGrid}><ColorField label="Warna teks utama di area gelap" value={values.dark_font_color || "#FFFFFF"} onChange={(value) => set("dark_font_color", value)} /><div className={styles.colorPreview} style={{ color: values.dark_font_color || "#FFFFFF" }}><span>Pratinjau kontras</span><strong>Sistem IT yang rapi, stabil, dan siap dipakai.</strong><small>Warna ini digunakan untuk judul dan teks utama pada bidang teal.</small></div></div><div className={styles.fieldGrid}><ToggleField label="Aktifkan animasi halaman" checked={values.motion_enabled !== "false"} onChange={(enabled) => set("motion_enabled", String(enabled))} /><NumberField label="Durasi carousel partner (detik)" value={Number(values.partner_carousel_speed || 28)} onChange={(value) => set("partner_carousel_speed", String(Math.min(60, Math.max(12, value))))} /></div></section>
      <section className={styles.editorCard}><div className={styles.cardHeading}><span>Identitas & kontak</span><small>Digunakan di header, footer, dan halaman kontak</small></div><div className={styles.fieldGrid}><Field label="Nama perusahaan" value={values.company_name || ""} onChange={(value) => set("company_name", value)} /><Field label="Nomor WhatsApp" value={values.whatsapp_number || ""} onChange={(value) => set("whatsapp_number", value)} placeholder="085155026889 atau 6285155026889" /><Field label="Nomor telepon tampilan" value={values.phone || ""} onChange={(value) => set("phone", value)} /><Field label="Email" value={values.email || ""} onChange={(value) => set("email", value)} type="email" /><TextArea label="Alamat" value={values.address || ""} rows={4} onChange={(value) => set("address", value)} /><Field label="Instagram URL" value={values.instagram_url || ""} onChange={(value) => set("instagram_url", value)} type="url" /><Field label="LinkedIn URL" value={values.linkedin_url || ""} onChange={(value) => set("linkedin_url", value)} type="url" /><Field label="Website utama" value={values.website_url || "https://www.perumnet.id/"} onChange={(value) => set("website_url", value)} type="url" /></div></section>
      <section className={styles.editorCard}><LanguageHeading label="Pesan bilingual" helper="Terjemahkan tagline, jam operasional, dan CTA." action={<TranslateButton busy={busy} values={[values.company_tagline || "", values.business_hours || "", values.cta_text || ""]} onTranslated={([companyTagline, businessHours, ctaText]) => setValuesEn((current) => ({ ...current, company_tagline: companyTagline, business_hours: businessHours, cta_text: ctaText }))} />} /><div className={styles.fieldGrid}><Field label="Tagline · ID" value={values.company_tagline || ""} onChange={(value) => set("company_tagline", value)} /><Field label="Tagline · EN" value={valuesEn.company_tagline || ""} onChange={(value) => setEn("company_tagline", value)} /><Field label="Jam operasional · ID" value={values.business_hours || ""} onChange={(value) => set("business_hours", value)} /><Field label="Business hours · EN" value={valuesEn.business_hours || ""} onChange={(value) => setEn("business_hours", value)} /><Field label="Teks CTA · ID" value={values.cta_text || ""} onChange={(value) => set("cta_text", value)} /><Field label="CTA text · EN" value={valuesEn.cta_text || ""} onChange={(value) => setEn("cta_text", value)} /></div></section>
      <section className={styles.editorCard}><LanguageHeading label="SEO & identitas bisnis" helper="Title dan description dipakai oleh mesin pencari; versi Inggris tampil pada /en." action={<TranslateButton busy={busy} values={[values.seo_title || "", values.seo_description || "", values.og_title || "", values.og_description || "", values.business_area || ""]} onTranslated={([seoTitle, seoDescription, ogTitle, ogDescription, businessArea]) => setValuesEn((current) => ({ ...current, seo_title: seoTitle, seo_description: seoDescription, og_title: ogTitle, og_description: ogDescription, business_area: businessArea }))} />} /><div className={styles.fieldGrid}><Field label="SEO title · ID" value={values.seo_title || ""} onChange={(value) => set("seo_title", value)} /><Field label="SEO title · EN" value={valuesEn.seo_title || ""} onChange={(value) => setEn("seo_title", value)} /><TextArea label="Meta description · ID" value={values.seo_description || ""} rows={3} onChange={(value) => set("seo_description", value)} /><TextArea label="Meta description · EN" value={valuesEn.seo_description || ""} rows={3} onChange={(value) => setEn("seo_description", value)} /><Field label="Open Graph title · ID" value={values.og_title || ""} onChange={(value) => set("og_title", value)} /><Field label="Open Graph title · EN" value={valuesEn.og_title || ""} onChange={(value) => setEn("og_title", value)} /><TextArea label="Open Graph description · ID" value={values.og_description || ""} rows={3} onChange={(value) => set("og_description", value)} /><TextArea label="Open Graph description · EN" value={valuesEn.og_description || ""} rows={3} onChange={(value) => setEn("og_description", value)} /><Field label="Nama legal bisnis" value={values.business_legal_name || values.company_name || ""} onChange={(value) => set("business_legal_name", value)} /><Field label="Area layanan · ID" value={values.business_area || ""} onChange={(value) => set("business_area", value)} /><Field label="Service area · EN" value={valuesEn.business_area || ""} onChange={(value) => setEn("business_area", value)} /><Field label="Kode negara" value={values.business_country || "ID"} onChange={(value) => set("business_country", value.toUpperCase())} /><Field label="Kode pos" value={values.postal_code || ""} onChange={(value) => set("postal_code", value)} /></div></section>
    </div>
  </>;
}

function ListPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={styles.listPanel}><div className={styles.cardHeading}><span>{title}</span></div><div>{children}</div></section>;
}
function EditorPanel({ title, children, onSave, onDelete, busy }: { title: string; children: React.ReactNode; onSave: () => void; onDelete?: () => void; busy: boolean }) {
  return <section className={styles.editorPanel}><div className={styles.editorTop}><h3>{title}</h3><div>{onDelete && <button className={styles.deleteButton} onClick={onDelete} disabled={busy}><Trash2 size={16} /> Hapus</button>}<button className={styles.primaryAction} onClick={onSave} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />} Simpan</button></div></div>{children}</section>;
}
function FileUploadField({
  label,
  accept,
  file,
  buttonLabel,
  helper,
  currentUrl,
  previewAlt,
  previewClassName,
  onChange,
}: {
  label: string;
  accept: string;
  file: File | null;
  buttonLabel: string;
  helper: string;
  currentUrl?: string;
  previewAlt: string;
  previewClassName: string;
  onChange: (file: File | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseFile = () => {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  };
  const fileSize = file
    ? `${file.name} · ${(file.size / 1024 / 1024).toLocaleString("id-ID", { maximumFractionDigits: 2 })} MB`
    : helper;

  return (
    <div className={`${styles.fullField} ${styles.uploadField}`}>
      <span>{label}</span>
      <input
        ref={inputRef}
        id={inputId}
        className={styles.fileInput}
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      <button type="button" className={styles.filePicker} aria-controls={inputId} onClick={chooseFile}>
        <span className={styles.filePickerIcon}><Upload size={19} /></span>
        <span className={styles.filePickerCopy}>
          <strong>{file ? "File siap diunggah" : buttonLabel}</strong>
          <small>{fileSize}</small>
        </span>
        <span className={styles.filePickerAction}>{file ? "Ganti file" : "Pilih file"}</span>
      </button>
      {currentUrl && !file && <img className={previewClassName} src={currentUrl} alt={previewAlt} />}
    </div>
  );
}
function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return <label className={styles.fullField}><span>{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label><span>{label}</span><input type="number" min="0" max="999" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const safeValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#FFFFFF";
  return <label className={styles.colorField}><span>{label}</span><div><input type="color" value={safeValue} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label={label} /><input value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} maxLength={7} pattern="^#[0-9A-Fa-f]{6}$" placeholder="#FFFFFF" /></div><small>Gunakan format HEX. Putih (#FFFFFF) direkomendasikan untuk kontras terbaik.</small></label>;
}
function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.toggleField}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} /><span className={styles.toggle} aria-hidden="true" /><span className={styles.toggleCopy}><strong>{label}</strong><small>{checked ? "Aktif" : "Nonaktif"}</small></span></label>;
}
