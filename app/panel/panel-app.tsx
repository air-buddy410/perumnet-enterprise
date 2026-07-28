"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Camera,
  Check,
  ChevronRight,
  Eye,
  FileText,
  Globe2,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareQuote,
  MonitorUp,
  Network,
  Phone,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import styles from "./panel.module.css";

type User = { id: string; name: string; email: string; role: string };
type Service = { id: string; slug: string; title: string; summary: string; description: string; features: string[]; icon: string; sortOrder: number; isPublished: boolean };
type Portfolio = { id: string; title: string; description: string; imageUrl: string; location: string; completedAt: string; sortOrder: number; isPublished: boolean };
type Testimonial = { id: string; clientName: string; companyName: string; review: string; isVisible: boolean; sortOrder: number };
type Page = { id: string; title: string; slug: string; excerpt: string; content: string; isPublished: boolean; sortOrder: number };
type CmsContent = {
  texts: Array<{ id: string; pageKey: string; contentKey: string; value: string }>;
  textMap: Record<string, Record<string, string>>;
  settings: Record<string, string>;
  services: Service[];
  portfolios: Portfolio[];
  testimonials: Testimonial[];
  pages: Page[];
};

type Section = "overview" | "texts" | "services" | "portfolios" | "testimonials" | "pages" | "settings";

const navItems: Array<{ id: Section; label: string; icon: typeof Home }> = [
  { id: "overview", label: "Ringkasan", icon: LayoutDashboard },
  { id: "texts", label: "Teks Situs", icon: FileText },
  { id: "services", label: "Layanan", icon: Wifi },
  { id: "portfolios", label: "Portofolio", icon: ImageIcon },
  { id: "testimonials", label: "Testimoni", icon: MessageSquareQuote },
  { id: "pages", label: "Halaman", icon: Globe2 },
  { id: "settings", label: "Pengaturan Situs", icon: Settings },
];

const cmsServiceIcons: Record<string, typeof Home> = {
  wifi: Wifi,
  camera: Camera,
  phone: Phone,
  network: Network,
  shield: ShieldCheck,
  home: Home,
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

function emptyService(): Omit<Service, "id"> {
  return { slug: "", title: "", summary: "", description: "", features: [], icon: "network", sortOrder: 0, isPublished: true };
}

function emptyPortfolio(): Omit<Portfolio, "id" | "imageUrl"> {
  return { title: "", description: "", location: "", completedAt: "", sortOrder: 0, isPublished: true };
}

function portfolioForm(item?: Portfolio): Omit<Portfolio, "id" | "imageUrl"> {
  if (!item) return emptyPortfolio();
  return {
    title: item.title,
    description: item.description,
    location: item.location,
    completedAt: item.completedAt,
    sortOrder: item.sortOrder,
    isPublished: item.isPublished,
  };
}

function emptyTestimonial(): Omit<Testimonial, "id"> {
  return { clientName: "", companyName: "", review: "", isVisible: true, sortOrder: 0 };
}

function emptyPage(): Omit<Page, "id"> {
  return { title: "", slug: "", excerpt: "", content: "", isPublished: false, sortOrder: 0 };
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
    window.setTimeout(() => setNotice(""), 2800);
  };

  const mutate = async (job: () => Promise<unknown>, success: string) => {
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
          <Link href="/" target="_blank" rel="noreferrer"><MonitorUp size={17} /><span>Lihat website</span><ArrowRight size={14} /></Link>
          <Link href="/admin"><BriefcaseBusiness size={17} /><span>Buka ERP</span><ArrowRight size={14} /></Link>
          <div className={styles.userChip}><span>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{user.name}</strong><small>Administrator</small></div><button onClick={logout} aria-label="Keluar"><LogOut size={17} /></button></div>
        </div>
      </aside>
      {sidebarOpen && <button className={styles.backdrop} onClick={() => setSidebarOpen(false)} aria-label="Tutup menu" />}
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <button className={styles.menuButton} onClick={() => setSidebarOpen(true)} aria-label="Buka menu"><Menu size={21} /></button>
          <div><span>Panel CMS</span><h1>{current.label}</h1></div>
          <Link href="/" target="_blank" rel="noreferrer"><Eye size={17} /> Pratinjau situs</Link>
        </header>
        <main className={styles.mainContent}>
          {section === "overview" && <Overview content={content} user={user} onNavigate={setSection} />}
          {section === "texts" && <TextEditor key={JSON.stringify(content.texts)} content={content} busy={busy} save={(items) => mutate(() => request("/api/cms/texts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }), "Teks situs berhasil diperbarui.")} />}
          {section === "services" && <ServiceEditor key={JSON.stringify(content.services)} items={content.services} busy={busy} mutate={mutate} />}
          {section === "portfolios" && <PortfolioEditor key={JSON.stringify(content.portfolios)} items={content.portfolios} busy={busy} mutate={mutate} />}
          {section === "testimonials" && <TestimonialEditor key={JSON.stringify(content.testimonials)} items={content.testimonials} busy={busy} mutate={mutate} />}
          {section === "pages" && <PageEditor key={JSON.stringify(content.pages)} items={content.pages} busy={busy} mutate={mutate} />}
          {section === "settings" && <SettingsEditor key={JSON.stringify(content.settings)} settings={content.settings} busy={busy} save={(settings) => mutate(() => request("/api/cms/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) }), "Pengaturan situs berhasil disimpan.")} />}
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { user } = await request<{ user: User }>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, remember: false }) });
      if (user.role !== "Admin") throw new Error("Akun ini tidak memiliki akses Administrator.");
      await onSuccess();
    } catch (error) { setError(error instanceof Error ? error.message : "Email atau kata sandi salah."); }
    finally { setBusy(false); }
  };
  return <main className={styles.loginRoot}>
    <section className={styles.loginVisual}>
      <div className={styles.loginBrand}><img src="/perumnet-mark.png" alt="" /><strong>PERUMNET ENTERPRISE</strong></div>
      <div className={styles.loginCopy}><span>CONTENT MANAGEMENT SYSTEM</span><h1>Kelola website<br /><em>tanpa menyentuh kode.</em></h1><p>Perbarui layanan, portofolio, testimoni, halaman, dan informasi kontak dari satu ruang kerja.</p><div><LockKeyhole size={20} /><span><strong>Akses aman Administrator</strong><small>Sesi terlindungi dan tercatat</small></span></div></div>
      <div className={styles.loginStatus}><span /> Sistem pengelolaan konten siap digunakan</div>
    </section>
    <section className={styles.loginFormWrap}>
      <form onSubmit={submit} className={styles.loginForm}>
        <div className={styles.portalLabel}><span /> Portal pengelolaan PerumNet</div>
        <span className={styles.formEyebrow}>AKSES ADMIN</span><h2>Selamat datang kembali.</h2><p>Masuk dengan akun Administrator PerumNet Enterprise.</p>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@perumnet.id" required autoComplete="email" /></label>
        <label>Kata sandi<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan kata sandi" required minLength={8} autoComplete="current-password" /></label>
        {error && <div className={styles.formError}>{error}</div>}
        <button type="submit" disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={19} /> : <>Masuk ke Panel <ArrowRight size={18} /></>}</button>
        <small>© {new Date().getFullYear()} PerumNet Enterprise · Konsultan IT</small>
      </form>
    </section>
  </main>;
}

function DeniedScreen({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  return <main className={styles.denied}><LockKeyhole size={34} /><h1>Akses panel dibatasi.</h1><p>Akun {user?.email} bukan Administrator. Silakan masuk dengan akun yang memiliki izin pengelolaan website.</p><button onClick={onLogout}>Keluar dan ganti akun</button></main>;
}

function Overview({ content, user, onNavigate }: { content: CmsContent; user: User; onNavigate: (section: Section) => void }) {
  const visible = content.testimonials.filter((item) => item.isVisible).length;
  const published = content.pages.filter((item) => item.isPublished).length;
  return <>
    <section className={styles.welcome}><div><span><Sparkles size={14} /> KONTEN WEBSITE</span><h2>Selamat bekerja, {user.name.split(" ")[0]}.</h2><p>Semua perubahan yang Anda simpan akan langsung digunakan oleh website publik.</p></div><a href="/" target="_blank" rel="noreferrer">Buka website <ArrowRight size={17} /></a></section>
    <section className={styles.metrics}>
      <div><span><Wifi size={19} /></span><strong>{content.services.length}</strong><small>Layanan</small></div>
      <div><span><ImageIcon size={19} /></span><strong>{content.portfolios.length}</strong><small>Proyek portofolio</small></div>
      <div><span><MessageSquareQuote size={19} /></span><strong>{visible}</strong><small>Testimoni tampil</small></div>
      <div><span><Globe2 size={19} /></span><strong>{published}</strong><small>Halaman terbit</small></div>
    </section>
    <section className={styles.overviewGrid}>
      <div className={styles.quickPanel}><div className={styles.panelHeading}><div><span>AKSES CEPAT</span><h3>Kelola konten utama</h3></div></div><div className={styles.quickGrid}>{navItems.slice(1).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => onNavigate(id)}><Icon size={20} /><span>{label}</span><ChevronRight size={16} /></button>)}</div></div>
      <div className={styles.siteStatus}><span>SITUS PUBLIK</span><h3>Website aktif dan terhubung.</h3><p>Konten dibaca langsung dari database. Anda tidak perlu melakukan proses deploy setelah mengedit teks atau data.</p><div><span /><strong>Online</strong><small>enterprise.perumnet.com · enterprise.perumnet.id</small></div></div>
    </section>
  </>;
}

function SectionTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className={styles.sectionTitle}><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function TextEditor({ content, busy, save }: { content: CmsContent; busy: boolean; save: (items: Array<{ pageKey: string; contentKey: string; value: string }>) => void }) {
  const initial = useMemo(() => Object.fromEntries(content.texts.map((item) => [`${item.pageKey}.${item.contentKey}`, item.value])), [content]);
  const [values, setValues] = useState(initial);
  return <>
    <SectionTitle eyebrow="EDIT TEKS SITUS" title="Perbarui pesan di setiap halaman." description="Teks disimpan ke database dan langsung digunakan pada kunjungan berikutnya." action={<button className={styles.primaryAction} disabled={busy} onClick={() => save(Object.entries(values).map(([key, value]) => { const [pageKey, ...rest] = key.split("."); return { pageKey, contentKey: rest.join("."), value }; }))}><Save size={17} /> Simpan semua</button>} />
    <div className={styles.formStack}>{Object.entries(textLabels).map(([pageKey, fields]) => <section className={styles.editorCard} key={pageKey}><div className={styles.cardHeading}><span>{pageKey === "home" ? "Beranda" : pageKey[0].toUpperCase() + pageKey.slice(1)}</span><small>{Object.keys(fields).length} bidang teks</small></div><div className={styles.fieldGrid}>{Object.entries(fields).map(([contentKey, label]) => { const id = `${pageKey}.${contentKey}`; const long = contentKey.includes("description") || contentKey.includes("title"); return <label className={long ? styles.fullField : ""} key={id}><span>{label}</span>{long ? <textarea rows={contentKey.includes("description") ? 4 : 2} value={values[id] || ""} onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))} /> : <input value={values[id] || ""} onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))} />}</label>; })}</div></section>)}</div>
  </>;
}

function ServiceEditor({ items, busy, mutate }: { items: Service[]; busy: boolean; mutate: (job: () => Promise<unknown>, success: string) => void }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Service, "id">>(current ? { ...current } : emptyService());
  const submit = () => mutate(() => request(`/api/cms/services${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "Layanan berhasil diperbarui." : "Layanan baru berhasil ditambahkan.");
  return <>
    <SectionTitle eyebrow="LAYANAN" title="Kelola solusi yang Anda tawarkan." description="Atur deskripsi, fitur, urutan, dan status tayang setiap layanan." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyService()); }}><Plus size={17} /> Layanan baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar layanan">{items.map((item) => { const Icon = cmsServiceIcons[item.icon] || Network; return <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.itemIcon}><Icon size={18} /></span><div><strong>{item.title}</strong><small>{item.isPublished ? "Tayang" : "Disembunyikan"}</small></div><ChevronRight size={16} /></button>; })}</ListPanel><EditorPanel title={selected ? "Edit layanan" : "Layanan baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus layanan ini?")) mutate(() => request(`/api/cms/services/${selected}`, { method: "DELETE" }), "Layanan dihapus."); } : undefined}>
      <div className={styles.fieldGrid}><Field label="Nama layanan" value={form.title} onChange={(title) => setForm({ ...form, title })} /><Field label="Slug URL" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="otomatis-dari-judul" /><label className={styles.fullField}><span>Ringkasan</span><textarea rows={3} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label><label className={styles.fullField}><span>Deskripsi lengkap</span><textarea rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label className={styles.fullField}><span>Fitur (satu per baris)</span><textarea rows={5} value={form.features.join("\n")} onChange={(event) => setForm({ ...form, features: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} /></label><SelectField label="Ikon" value={form.icon} options={["wifi","camera","phone","network","shield","home"]} onChange={(icon) => setForm({ ...form, icon })} /><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><ToggleField label="Tampilkan di website" checked={form.isPublished} onChange={(isPublished) => setForm({ ...form, isPublished })} /></div>
    </EditorPanel></div>
  </>;
}

function PortfolioEditor({ items, busy, mutate }: { items: Portfolio[]; busy: boolean; mutate: (job: () => Promise<unknown>, success: string) => void }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState(portfolioForm(current));
  const [file, setFile] = useState<File | null>(null);
  const submit = () => { const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.set(key, String(value))); if (file) body.set("image", file); mutate(() => request(`/api/cms/portfolios${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", body }), selected ? "Portofolio berhasil diperbarui." : "Proyek baru berhasil ditambahkan."); };
  return <>
    <SectionTitle eyebrow="PORTOFOLIO" title="Tampilkan bukti kerja terbaik Anda." description="Unggah foto proyek, tambahkan lokasi, dan atur proyek yang tampil di website." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyPortfolio()); setFile(null); }}><Plus size={17} /> Proyek baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar proyek">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm(portfolioForm(item)); setFile(null); }}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className={styles.itemIcon}><Camera size={18} /></span>}<div><strong>{item.title}</strong><small>{item.location || "Tanpa lokasi"}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit portofolio" : "Proyek baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus proyek portofolio ini?")) mutate(() => request(`/api/cms/portfolios/${selected}`, { method: "DELETE" }), "Portofolio dihapus."); } : undefined}>
      <div className={styles.fieldGrid}><Field label="Judul proyek" value={form.title} onChange={(title) => setForm({ ...form, title })} /><Field label="Lokasi" value={form.location} onChange={(location) => setForm({ ...form, location })} /><label className={styles.fullField}><span>Deskripsi</span><textarea rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label><span>Tanggal selesai</span><input type="date" value={form.completedAt} onChange={(event) => setForm({ ...form, completedAt: event.target.value })} /></label><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><label className={styles.fullField}><span>Foto proyek (JPG, PNG, WebP · maks. 5 MB)</span><input className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />{current?.imageUrl && !file && <img className={styles.imagePreview} src={current.imageUrl} alt={current.title} />}</label><ToggleField label="Tampilkan di website" checked={form.isPublished} onChange={(isPublished) => setForm({ ...form, isPublished })} /></div>
    </EditorPanel></div>
  </>;
}

function TestimonialEditor({ items, busy, mutate }: { items: Testimonial[]; busy: boolean; mutate: (job: () => Promise<unknown>, success: string) => void }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Testimonial, "id">>(current ? { ...current } : emptyTestimonial());
  const submit = () => mutate(() => request(`/api/cms/testimonials${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "Testimoni berhasil diperbarui." : "Testimoni baru berhasil ditambahkan.");
  return <>
    <SectionTitle eyebrow="TESTIMONI" title="Kelola cerita dan kepercayaan klien." description="Edit ulasan atau sembunyikan testimoni tanpa harus menghapusnya." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyTestimonial()); }}><Plus size={17} /> Testimoni baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar testimoni">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.avatar}>{item.clientName.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><div><strong>{item.clientName}</strong><small>{item.isVisible ? "Tampil" : "Disembunyikan"}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit testimoni" : "Testimoni baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus testimoni ini?")) mutate(() => request(`/api/cms/testimonials/${selected}`, { method: "DELETE" }), "Testimoni dihapus."); } : undefined}>
      <div className={styles.fieldGrid}><Field label="Nama klien" value={form.clientName} onChange={(clientName) => setForm({ ...form, clientName })} /><Field label="Perusahaan" value={form.companyName} onChange={(companyName) => setForm({ ...form, companyName })} /><label className={styles.fullField}><span>Ulasan</span><textarea rows={7} value={form.review} onChange={(event) => setForm({ ...form, review: event.target.value })} /></label><NumberField label="Urutan" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><ToggleField label="Tampilkan testimoni" checked={form.isVisible} onChange={(isVisible) => setForm({ ...form, isVisible })} /></div>
    </EditorPanel></div>
  </>;
}

function PageEditor({ items, busy, mutate }: { items: Page[]; busy: boolean; mutate: (job: () => Promise<unknown>, success: string) => void }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id || null);
  const current = items.find((item) => item.id === selected);
  const [form, setForm] = useState<Omit<Page, "id">>(current ? { ...current } : emptyPage());
  const submit = () => mutate(() => request(`/api/cms/pages${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }), selected ? "Halaman berhasil diperbarui." : "Halaman baru berhasil dibuat.");
  return <>
    <SectionTitle eyebrow="HALAMAN DINAMIS" title="Buat halaman baru tanpa coding." description="Halaman yang diterbitkan otomatis muncul di navigasi publik sesuai urutannya." action={<button className={styles.secondaryAction} onClick={() => { setSelected(null); setForm(emptyPage()); }}><Plus size={17} /> Halaman baru</button>} />
    <div className={styles.splitEditor}><ListPanel title="Daftar halaman">{items.map((item) => <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => { setSelected(item.id); setForm({ ...item }); }}><span className={styles.itemIcon}><Globe2 size={18} /></span><div><strong>{item.title}</strong><small>{item.isPublished ? "Terbit" : "Draf"} · /{item.slug}</small></div><ChevronRight size={16} /></button>)}</ListPanel><EditorPanel title={selected ? "Edit halaman" : "Halaman baru"} onSave={submit} busy={busy} onDelete={selected ? () => { if (window.confirm("Hapus halaman ini?")) mutate(() => request(`/api/cms/pages/${selected}`, { method: "DELETE" }), "Halaman dihapus."); } : undefined}>
      <div className={styles.fieldGrid}><Field label="Judul halaman" value={form.title} onChange={(title) => setForm({ ...form, title })} /><Field label="Slug URL" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} placeholder="otomatis-dari-judul" /><label className={styles.fullField}><span>Ringkasan</span><textarea rows={3} value={form.excerpt} onChange={(event) => setForm({ ...form, excerpt: event.target.value })} /></label><label className={styles.fullField}><span>Isi halaman</span><textarea rows={12} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="Pisahkan paragraf dengan satu baris kosong." /></label><NumberField label="Urutan menu" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} /><ToggleField label="Terbitkan halaman" checked={form.isPublished} onChange={(isPublished) => setForm({ ...form, isPublished })} /></div>
    </EditorPanel></div>
  </>;
}

function SettingsEditor({ settings, busy, save }: { settings: Record<string,string>; busy: boolean; save: (settings: Record<string,string>) => void }) {
  const [values, setValues] = useState(settings);
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  return <>
    <SectionTitle eyebrow="PENGATURAN SITUS" title="Identitas, kontak, dan tampilan dalam satu tempat." description="Perubahan berikut langsung digunakan pada seluruh halaman website publik." action={<button className={styles.primaryAction} disabled={busy} onClick={() => save(values)}><Save size={17} /> Simpan pengaturan</button>} />
    <div className={styles.formStack}>
      <section className={styles.editorCard}>
        <div className={styles.cardHeading}><span>Warna & tampilan publik</span><small>Kontras teks pada area teal dan gelap</small></div>
        <div className={styles.appearanceGrid}>
          <ColorField label="Warna teks utama di area gelap" value={values.dark_font_color || "#FFFFFF"} onChange={(value) => set("dark_font_color", value)} />
          <div className={styles.colorPreview} style={{ color: values.dark_font_color || "#FFFFFF" }}>
            <span>Pratinjau kontras</span>
            <strong>Infrastruktur IT yang bekerja tanpa hambatan.</strong>
            <small>Warna ini digunakan untuk judul dan teks utama pada bidang teal atau gelap.</small>
          </div>
        </div>
      </section>
      <section className={styles.editorCard}><div className={styles.cardHeading}><span>Identitas & kontak</span><small>Digunakan di header, footer, dan halaman kontak</small></div><div className={styles.fieldGrid}><Field label="Nama perusahaan" value={values.company_name || ""} onChange={(value) => set("company_name", value)} /><Field label="Tagline" value={values.company_tagline || ""} onChange={(value) => set("company_tagline", value)} /><Field label="Nomor WhatsApp" value={values.whatsapp_number || ""} onChange={(value) => set("whatsapp_number", value)} placeholder="085155026889 atau 6285155026889" /><Field label="Nomor telepon tampilan" value={values.phone || ""} onChange={(value) => set("phone", value)} /><Field label="Email" value={values.email || ""} onChange={(value) => set("email", value)} type="email" /><Field label="Jam operasional" value={values.business_hours || ""} onChange={(value) => set("business_hours", value)} /><label className={styles.fullField}><span>Alamat</span><textarea rows={4} value={values.address || ""} onChange={(event) => set("address", event.target.value)} /></label><Field label="Instagram URL" value={values.instagram_url || ""} onChange={(value) => set("instagram_url", value)} type="url" /><Field label="LinkedIn URL" value={values.linkedin_url || ""} onChange={(value) => set("linkedin_url", value)} type="url" /><Field label="Website utama" value={values.website_url || "https://www.perumnet.id/"} onChange={(value) => set("website_url", value)} type="url" /><label className={styles.fullField}><span>Teks tombol CTA utama</span><input value={values.cta_text || ""} onChange={(event) => set("cta_text", event.target.value)} /></label></div></section>
    </div>
  </>;
}

function ListPanel({ title, children }: { title: string; children: React.ReactNode }) { return <section className={styles.listPanel}><div className={styles.cardHeading}><span>{title}</span></div><div>{children}</div></section>; }

function EditorPanel({ title, children, onSave, onDelete, busy }: { title: string; children: React.ReactNode; onSave: () => void; onDelete?: () => void; busy: boolean }) {
  return <section className={styles.editorPanel}><div className={styles.editorTop}><h3>{title}</h3><div>{onDelete && <button className={styles.deleteButton} onClick={onDelete} disabled={busy}><Trash2 size={16} /> Hapus</button>}<button className={styles.primaryAction} onClick={onSave} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />} Simpan</button></div></div>{children}</section>;
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { return <label><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label><span>{label}</span><input type="number" min="0" max="999" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const safeValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#FFFFFF";
  return <label className={styles.colorField}><span>{label}</span><div><input type="color" value={safeValue} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label={label} /><input value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} maxLength={7} pattern="^#[0-9A-Fa-f]{6}$" placeholder="#FFFFFF" /></div><small>Gunakan format HEX. Putih (#FFFFFF) direkomendasikan untuk kontras terbaik.</small></label>;
}
function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.toggleField}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} /><span className={styles.toggle} aria-hidden="true" /><span className={styles.toggleCopy}><strong>{label}</strong><small>{checked ? "Aktif" : "Nonaktif"}</small></span></label>;
}
