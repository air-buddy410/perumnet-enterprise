import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Camera,
  Check,
  Clock3,
  Mail,
  MapPin,
  MessageCircle,
  Network,
  Phone,
  Quote,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import type {
  CmsContent,
  CmsPortfolio,
  CmsService,
  CmsTestimonial,
} from "@/server/cms";
import styles from "../site.module.css";

const serviceIcons = {
  wifi: Wifi,
  camera: Camera,
  phone: Phone,
  network: Network,
  shield: ShieldCheck,
};

function text(content: CmsContent, page: string, key: string, fallback: string) {
  return content.textMap[page]?.[key] || fallback;
}

function waLink(content: CmsContent, message?: string) {
  const number = (content.settings.whatsapp_number || "6285333521369").replace(/\D/g, "");
  const greeting = message || "Halo PerumNet Enterprise, saya ingin berkonsultasi mengenai kebutuhan IT.";
  return `https://wa.me/${number}?text=${encodeURIComponent(greeting)}`;
}

function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="PerumNet Enterprise — Beranda">
      <img src="/perumnet-mark.png" alt="" width="46" height="46" />
      <span>
        <strong>PERUMNET ENTERPRISE</strong>
        <small>KONSULTAN IT</small>
      </span>
    </Link>
  );
}

export function PublicShell({
  content,
  active,
  children,
}: {
  content: CmsContent;
  active?: string;
  children: React.ReactNode;
}) {
  const nav = [
    { href: "/", label: "Beranda", key: "home" },
    { href: "/services", label: "Layanan", key: "services" },
    { href: "/portfolio", label: "Portofolio", key: "portfolio" },
    { href: "/testimonials", label: "Testimoni", key: "testimonials" },
    ...content.pages.map((page) => ({ href: `/${page.slug}`, label: page.title, key: page.slug })),
    { href: "/contact", label: "Kontak", key: "contact" },
  ];
  return (
    <div className={styles.siteRoot}>
      <header className={styles.header}>
        <div className={styles.navWrap}>
          <Brand />
          <nav className={styles.desktopNav} aria-label="Navigasi utama">
            {nav.map((item) => (
              <Link
                href={item.href}
                key={item.key}
                className={active === item.key ? styles.activeNav : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <a className={styles.headerCta} href={waLink(content)} target="_blank" rel="noreferrer">
            <MessageCircle size={17} /> Hubungi Kami
          </a>
          <details className={styles.mobileMenu}>
            <summary aria-label="Buka menu"><span /><span /><span /></summary>
            <nav aria-label="Navigasi seluler">
              {nav.map((item) => <Link href={item.href} key={item.key}>{item.label}</Link>)}
              <a href={waLink(content)} target="_blank" rel="noreferrer">WhatsApp <ArrowRight size={16} /></a>
            </nav>
          </details>
        </div>
      </header>
      <main>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <Brand />
            <p>{content.settings.company_tagline || "Konsultan IT untuk operasional yang lebih andal"}</p>
            <div className={styles.socials}>
              {content.settings.instagram_url && <a href={content.settings.instagram_url} aria-label="Instagram" target="_blank" rel="noreferrer"><span aria-hidden="true">IG</span></a>}
              {content.settings.linkedin_url && <a href={content.settings.linkedin_url} aria-label="LinkedIn" target="_blank" rel="noreferrer"><span aria-hidden="true">in</span></a>}
            </div>
          </div>
          <div>
            <h3>Jelajahi</h3>
            <ul>{nav.slice(0, 5).map((item) => <li key={item.key}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          </div>
          <div>
            <h3>Layanan</h3>
            <ul>{content.services.map((service) => <li key={service.id}><Link href="/services">{service.title}</Link></li>)}</ul>
          </div>
          <div>
            <h3>Kontak</h3>
            <ul className={styles.contactList}>
              <li><MapPin size={17} /> <span>{content.settings.address}</span></li>
              <li><Mail size={17} /> <a href={`mailto:${content.settings.email}`}>{content.settings.email}</a></li>
              <li><Phone size={17} /> <span>{content.settings.phone}</span></li>
            </ul>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} PerumNet Enterprise</span>
          <span>Dirancang untuk koneksi yang lebih baik.</span>
          <Link href="/panel">Panel CMS</Link>
        </div>
      </footer>
      <a className={styles.floatingWa} href={waLink(content)} target="_blank" rel="noreferrer" aria-label="Hubungi PerumNet Enterprise via WhatsApp">
        <MessageCircle size={24} />
      </a>
    </div>
  );
}

export function ServiceCard({ service, index = 0 }: { service: CmsService; index?: number }) {
  const Icon = serviceIcons[service.icon as keyof typeof serviceIcons] || Network;
  return (
    <article className={styles.serviceCard}>
      <div className={styles.cardTopline}><span>0{index + 1}</span><Icon size={26} /></div>
      <h3>{service.title}</h3>
      <p>{service.summary}</p>
      <span className={styles.cardLink}>Pelajari layanan <ArrowRight size={16} /></span>
    </article>
  );
}

export function PortfolioCard({ item }: { item: CmsPortfolio }) {
  return (
    <article className={styles.portfolioCard}>
      <div className={styles.portfolioImage}>
        {item.imageUrl ? <img src={item.imageUrl} alt={item.title} loading="lazy" /> : <div className={styles.imageFallback}><Network size={42} /></div>}
        {item.location && <span><MapPin size={13} /> {item.location}</span>}
      </div>
      <div className={styles.portfolioCopy}>
        <p>{item.completedAt ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${item.completedAt}T00:00:00`)) : "Proyek pilihan"}</p>
        <h3>{item.title}</h3>
        <span>{item.description}</span>
      </div>
    </article>
  );
}

export function TestimonialCard({ item }: { item: CmsTestimonial }) {
  return (
    <article className={styles.testimonialCard}>
      <Quote size={28} />
      <blockquote>“{item.review}”</blockquote>
      <div><strong>{item.clientName}</strong><span>{item.companyName}</span></div>
    </article>
  );
}

export function HomePage({ content }: { content: CmsContent }) {
  return (
    <PublicShell content={content} active="home">
      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}><Sparkles size={14} /> {text(content, "home", "hero_eyebrow", "SOLUSI IT TERINTEGRASI · BALI")}</span>
            <h1>{text(content, "home", "hero_title", "Infrastruktur IT yang bekerja tanpa hambatan.")}</h1>
            <p>{text(content, "home", "hero_description", "Solusi jaringan, keamanan, dan komunikasi yang dirancang untuk operasional bisnis modern.")}</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href={waLink(content)} target="_blank" rel="noreferrer">{content.settings.cta_text || "Konsultasikan Kebutuhan Anda"} <ArrowRight size={18} /></a>
              <Link className={styles.secondaryButton} href="/portfolio">Lihat hasil pekerjaan</Link>
            </div>
            <div className={styles.heroTrust}><span><ShieldCheck size={17} /> Instalasi terdokumentasi</span><span><Clock3 size={17} /> Respons dukungan cepat</span></div>
          </div>
          <div className={styles.heroVisual} aria-label="Ilustrasi sistem jaringan terintegrasi">
            <div className={styles.visualGlow} />
            <div className={`${styles.orbit} ${styles.orbitOne}`} />
            <div className={`${styles.orbit} ${styles.orbitTwo}`} />
            <div className={styles.visualCenter}><img src="/perumnet-mark.png" alt="PerumNet Enterprise" /></div>
            <div className={`${styles.visualNode} ${styles.nodeWifi}`}><Wifi size={24} /><span>Managed WiFi</span><small>Online</small></div>
            <div className={`${styles.visualNode} ${styles.nodeCamera}`}><Camera size={24} /><span>CCTV</span><small>Protected</small></div>
            <div className={`${styles.visualNode} ${styles.nodePhone}`}><Phone size={24} /><span>IP PABX</span><small>Connected</small></div>
            <div className={styles.signalCard}><span className={styles.liveDot} /> Sistem terpantau <strong>24/7</strong></div>
          </div>
        </div>
        <div className={styles.statsBar}>
          <div><strong>3</strong><span>Solusi inti terintegrasi</span></div>
          <div><strong>24/7</strong><span>Dukungan operasional</span></div>
          <div><strong>1 tim</strong><span>Dari survei hingga support</span></div>
          <div><strong>Bali</strong><span>Berbasis dan siap melayani</span></div>
        </div>
      </section>

      <section className={styles.aboutSection}>
        <div className={styles.sectionIntro}>
          <span className={styles.eyebrowDark}>{text(content, "home", "about_eyebrow", "PARTNER TEKNOLOGI ANDA")}</span>
          <h2>{text(content, "home", "about_title", "Satu tim untuk seluruh kebutuhan infrastruktur.")}</h2>
        </div>
        <div className={styles.aboutCopy}>
          <p>{text(content, "home", "about_description", "Kami menggabungkan konsultasi, instalasi, dokumentasi, dan dukungan berkelanjutan dalam satu layanan.")}</p>
          <Link href="/tentang-kami">Kenali cara kami bekerja <ArrowRight size={17} /></Link>
        </div>
      </section>

      <section className={styles.servicesSection}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.eyebrowDark}>LAYANAN UTAMA</span><h2>{text(content, "home", "services_title", "Solusi yang dibangun untuk kebutuhan nyata.")}</h2></div>
          <p>{text(content, "home", "services_description", "Setiap sistem dirancang untuk stabil sejak hari pertama.")}</p>
        </div>
        <div className={styles.serviceGrid}>{content.services.slice(0, 3).map((service, index) => <ServiceCard key={service.id} service={service} index={index} />)}</div>
        <Link className={styles.inlineButton} href="/services">Lihat seluruh layanan <ArrowRight size={17} /></Link>
      </section>

      <section className={styles.processSection}>
        <div><span className={styles.eyebrowLight}>CARA KAMI BEKERJA</span><h2>Sederhana untuk Anda, terukur untuk tim kami.</h2></div>
        <ol>
          <li><span>01</span><div><strong>Survei & pemetaan</strong><p>Kami memahami lokasi, pengguna, risiko, dan target operasional.</p></div></li>
          <li><span>02</span><div><strong>Desain & implementasi</strong><p>Solusi dipasang rapi, dikonfigurasi, dan diuji sesuai skenario penggunaan.</p></div></li>
          <li><span>03</span><div><strong>Serah terima & dukungan</strong><p>Dokumentasi lengkap, penjelasan untuk tim, dan dukungan setelah implementasi.</p></div></li>
        </ol>
      </section>

      <section className={styles.portfolioSection}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.eyebrowDark}>PORTOFOLIO PILIHAN</span><h2>{text(content, "home", "portfolio_title", "Pekerjaan rapi. Hasil yang terukur.")}</h2></div>
          <Link href="/portfolio">Lihat semua proyek <ArrowRight size={17} /></Link>
        </div>
        <div className={styles.portfolioGrid}>{content.portfolios.slice(0, 3).map((item) => <PortfolioCard key={item.id} item={item} />)}</div>
      </section>

      <section className={styles.testimonialSection}>
        <div className={styles.sectionIntro}><span className={styles.eyebrowLight}>CERITA KLIEN</span><h2>{text(content, "home", "testimonials_title", "Dipercaya untuk menjaga operasional tetap berjalan.")}</h2></div>
        <div className={styles.testimonialGrid}>{content.testimonials.slice(0, 3).map((item) => <TestimonialCard key={item.id} item={item} />)}</div>
      </section>

      <section className={styles.closingCta}>
        <div><span className={styles.eyebrowLight}>SIAP MEMULAI?</span><h2>{text(content, "home", "closing_title", "Mulai dari survei lokasi, kami bantu sampai sistem siap digunakan.")}</h2></div>
        <a href={waLink(content)} target="_blank" rel="noreferrer">{content.settings.cta_text || "Konsultasikan Kebutuhan Anda"} <ArrowRight size={18} /></a>
      </section>
    </PublicShell>
  );
}

export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className={styles.pageHero}><span className={styles.eyebrow}>{eyebrow}</span><h1>{title}</h1><p>{description}</p><div className={styles.pageHeroMark}><img src="/perumnet-mark.png" alt="" /></div></section>;
}

export function ServicesPage({ content }: { content: CmsContent }) {
  return <PublicShell content={content} active="services">
    <PageHero eyebrow="LAYANAN PERUMNET ENTERPRISE" title={text(content, "services", "page_title", "Infrastruktur yang siap mengikuti ritme bisnis Anda.")} description={text(content, "services", "page_description", "Layanan konsultasi, instalasi, integrasi, dan pemeliharaan.")} />
    <section className={styles.detailList}>{content.services.map((service, index) => {
      const Icon = serviceIcons[service.icon as keyof typeof serviceIcons] || Network;
      return <article key={service.id} className={styles.serviceDetail}>
        <div className={styles.detailNumber}>0{index + 1}</div>
        <div className={styles.detailIcon}><Icon size={34} /></div>
        <div><h2>{service.title}</h2><p className={styles.detailLead}>{service.summary}</p><p>{service.description}</p></div>
        <ul>{service.features.map((feature) => <li key={feature}><Check size={16} /> {feature}</li>)}</ul>
      </article>;
    })}</section>
    <section className={styles.simpleCta}><div><h2>Belum yakin layanan mana yang paling tepat?</h2><p>Kami dapat memulai dari survei singkat dan rekomendasi yang sesuai kebutuhan lokasi.</p></div><a href={waLink(content)} target="_blank" rel="noreferrer">Jadwalkan konsultasi <ArrowRight size={18} /></a></section>
  </PublicShell>;
}

export function PortfolioPage({ content }: { content: CmsContent }) {
  return <PublicShell content={content} active="portfolio">
    <PageHero eyebrow="HASIL PEKERJAAN" title={text(content, "portfolio", "page_title", "Pilihan proyek yang kami selesaikan bersama klien.")} description={text(content, "portfolio", "page_description", "Setiap proyek dimulai dari kebutuhan lapangan.")} />
    <section className={styles.archiveSection}><div className={styles.portfolioGrid}>{content.portfolios.map((item) => <PortfolioCard key={item.id} item={item} />)}</div></section>
  </PublicShell>;
}

export function TestimonialsPage({ content }: { content: CmsContent }) {
  return <PublicShell content={content} active="testimonials">
    <PageHero eyebrow="PENGALAMAN KLIEN" title={text(content, "testimonials", "page_title", "Cerita dari bisnis yang bertumbuh bersama sistem yang lebih baik.")} description={text(content, "testimonials", "page_description", "Ulasan klien tentang proses kerja dan hasil implementasi.")} />
    <section className={styles.archiveSection}><div className={styles.testimonialArchive}>{content.testimonials.map((item) => <TestimonialCard key={item.id} item={item} />)}</div></section>
  </PublicShell>;
}

export function ContactPage({ content }: { content: CmsContent }) {
  return <PublicShell content={content} active="contact">
    <PageHero eyebrow="HUBUNGI KAMI" title={text(content, "contact", "page_title", "Mari bicarakan kebutuhan IT Anda.")} description={text(content, "contact", "page_description", "Ceritakan lokasi, tantangan, dan target Anda.")} />
    <section className={styles.contactSection}>
      <div className={styles.contactCards}>
        <a href={waLink(content)} target="_blank" rel="noreferrer"><MessageCircle size={24} /><div><span>WhatsApp</span><strong>{content.settings.phone}</strong><small>Respons tercepat untuk konsultasi awal</small></div><ArrowRight size={18} /></a>
        <a href={`mailto:${content.settings.email}`}><Mail size={24} /><div><span>Email</span><strong>{content.settings.email}</strong><small>Untuk kebutuhan proposal dan dokumen</small></div><ArrowRight size={18} /></a>
        <div><MapPin size={24} /><div><span>Lokasi</span><strong>Karangasem, Bali</strong><small>{content.settings.address}</small></div></div>
        <div><Clock3 size={24} /><div><span>Jam operasional</span><strong>{content.settings.business_hours}</strong><small>Dukungan disesuaikan dengan layanan</small></div></div>
      </div>
      <div className={styles.contactPanel}>
        <span className={styles.eyebrowLight}>LANGKAH PERTAMA</span><h2>Beritahu kami gambaran kebutuhan Anda.</h2><p>Klik WhatsApp untuk mengirim pesan. Sertakan lokasi, jenis layanan, dan waktu yang nyaman untuk dihubungi.</p>
        <a href={waLink(content, "Halo PerumNet Enterprise, saya ingin berkonsultasi. Lokasi saya: ... Kebutuhan saya: ...")} target="_blank" rel="noreferrer">Mulai percakapan <MessageCircle size={18} /></a>
        <div className={styles.contactAssurance}><ShieldCheck size={20} /><span>Informasi Anda hanya digunakan untuk menindaklanjuti konsultasi.</span></div>
      </div>
    </section>
  </PublicShell>;
}

export function DynamicContentPage({ content, page }: { content: CmsContent; page: CmsContent["pages"][number] }) {
  return <PublicShell content={content} active={page.slug}>
    <PageHero eyebrow="PERUMNET ENTERPRISE" title={page.title} description={page.excerpt || "Informasi PerumNet Enterprise"} />
    <article className={styles.richPage}>
      <div className={styles.richPageIcon}><Building2 size={32} /></div>
      <div>{page.content.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </article>
  </PublicShell>;
}
