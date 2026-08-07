import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Building2,
  Camera,
  Check,
  Clock3,
  Code2,
  Globe2,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  Network,
  Phone,
  Quote,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { FaLinkedinIn } from "react-icons/fa6";
import { SiInstagram } from "react-icons/si";
import type {
  CmsContent,
  CmsPartner,
  CmsPortfolio,
  CmsService,
  CmsTestimonial,
} from "@/server/cms";
import type { PublicLanguage } from "@/server/public-language";
import { businessStructuredData } from "@/server/public-seo";
import { PublicLanguageSwitcher } from "./public-language-switcher";
import { PublicLeadForm } from "./public-lead-form";
import { PublicMobileMenu } from "./public-mobile-menu";
import { PublicMotionController } from "./public-motion-controller";
import { PublicPortfolioImage } from "./public-portfolio-image";
import { SiteAnalytics } from "./site-analytics";
import { measurementId } from "../analytics";
import styles from "../site.module.css";

const serviceIcons = {
  wifi: Wifi,
  camera: Camera,
  phone: Phone,
  network: Network,
  shield: ShieldCheck,
  home: Home,
  terminal: TerminalSquare,
};

function localized(indonesian: string, english: string, language: PublicLanguage) {
  return language === "en" && english.trim() ? english : indonesian;
}

function text(content: CmsContent, language: PublicLanguage, page: string, key: string, fallbackId: string, fallbackEn: string) {
  if (language === "en") return content.textMapEn[page]?.[key] || fallbackEn;
  return content.textMap[page]?.[key] || fallbackId;
}

function setting(content: CmsContent, language: PublicLanguage, key: string, fallbackId = "", fallbackEn = "") {
  if (language === "en") return content.settingsEn[key] || content.settings[key] || fallbackEn || fallbackId;
  return content.settings[key] || fallbackId;
}

function waLink(content: CmsContent, language: PublicLanguage, message?: string) {
  const rawNumber = (content.settings.whatsapp_number || "085155026889").replace(/\D/g, "");
  const number = rawNumber.startsWith("0") ? `62${rawNumber.slice(1)}` : rawNumber;
  const greeting = message || (language === "id"
    ? "Halo PerumNet Enterprise, saya ingin berkonsultasi mengenai kebutuhan IT."
    : "Hello PerumNet Enterprise, I would like to discuss my IT requirements.");
  return `https://wa.me/${number}?text=${encodeURIComponent(greeting)}`;
}

function mapsLink(content: CmsContent) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(content.settings.address || "Karangasem, Bali")}`;
}

function publicHref(language: PublicLanguage, path: string) {
  if (language === "id") return path;
  if (path === "/") return "/en";
  return `/en${path}`;
}

function Brand({ language }: { language: PublicLanguage }) {
  return (
    <Link href={publicHref(language, "/")} className={styles.brand} aria-label={`PerumNet Enterprise — ${language === "id" ? "Beranda" : "Home"}`}>
      <img src="/perumnet-mark.png" alt="" width="54" height="54" />
      <span><strong>PERUMNET ENTERPRISE</strong><small>{language === "id" ? "KONSULTAN IT" : "IT CONSULTING"}</small></span>
    </Link>
  );
}

export function PublicShell({
  content,
  language,
  active,
  children,
}: {
  content: CmsContent;
  language: PublicLanguage;
  active?: string;
  children: React.ReactNode;
}) {
  const pageNavigation = content.pages
    .filter((page) => page.showInNavigation)
    .map((page) => ({ href: publicHref(language, `/${page.slug}`), label: localized(page.title, page.titleEn, language), key: page.slug }));
  const nav = [
    { href: publicHref(language, "/"), label: language === "id" ? "Beranda" : "Home", key: "home" },
    { href: publicHref(language, "/services"), label: language === "id" ? "Layanan" : "Services", key: "services" },
    { href: publicHref(language, "/portfolio"), label: language === "id" ? "Portofolio" : "Portfolio", key: "portfolio" },
    ...pageNavigation,
    { href: publicHref(language, "/contact"), label: language === "id" ? "Kontak" : "Contact", key: "contact" },
  ];
  const configuredSurfaceColor = content.settings.dark_font_color || "#FFFFFF";
  const surfaceColor = /^#[0-9a-f]{6}$/i.test(configuredSurfaceColor) ? configuredSurfaceColor : "#FFFFFF";
  const motionEnabled = content.settings.motion_enabled !== "false";
  const gaMeasurementId = measurementId();

  return (
    <div
      className={styles.siteRoot}
      data-public-site-root
      data-motion={motionEnabled ? "enabled" : "disabled"}
      lang={language}
      style={{ "--surface-text": surfaceColor } as CSSProperties}
    >
      {/*
        Analytics hangs off the public shell rather than the root layout, which
        is shared with /admin, /panel and the BAST verification page. Placing it
        here means the console routes never render the component at all — the
        tag cannot reach staff traffic by accident, only by someone deliberately
        wrapping the ERP in PublicShell.

        The ternary rather than letting <SiteAnalytics> return null for itself:
        a rendered client component is a client boundary whether or not it draws
        anything, so its chunk is fetched and hydrated on every page. Not
        rendering it keeps it out of the flight payload entirely, which is what
        the demo build — and production until the owner pastes an ID — needs.
      */}
      {gaMeasurementId ? <SiteAnalytics measurementId={gaMeasurementId} /> : null}
      <PublicMotionController enabled={motionEnabled} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessStructuredData(content, language)).replaceAll("<", "\\u003c") }}
      />
      <header className={styles.header}>
        <div className={styles.navWrap}>
          <Brand language={language} />
          <nav className={styles.desktopNav} aria-label={language === "id" ? "Navigasi utama" : "Main navigation"}>
            {nav.map((item) => (
              <Link href={item.href} key={item.key} className={active === item.key ? styles.activeNav : undefined} aria-current={active === item.key ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <PublicLanguageSwitcher language={language} />
            <a className={styles.headerCta} href={waLink(content, language)} target="_blank" rel="noreferrer">
              <MessageCircle size={17} /> {language === "id" ? "Hubungi Kami" : "Contact Us"}
            </a>
          </div>
          <PublicMobileMenu items={nav} whatsappUrl={waLink(content, language)} language={language} />
        </div>
      </header>
      <main>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <Brand language={language} />
            <p>{setting(content, language, "company_tagline", "Konsultan IT untuk operasional yang lebih andal", "IT consulting for more reliable operations")}</p>
            <div className={styles.socials}>
              {content.settings.instagram_url && <a href={content.settings.instagram_url} aria-label="Instagram PerumNet" target="_blank" rel="noreferrer"><SiInstagram size={18} /></a>}
              {content.settings.linkedin_url && <a href={content.settings.linkedin_url} aria-label="LinkedIn PerumNet" target="_blank" rel="noreferrer"><FaLinkedinIn size={18} /></a>}
              {content.settings.website_url && <a href={content.settings.website_url} aria-label="PerumNet" target="_blank" rel="noreferrer"><Globe2 size={18} /></a>}
            </div>
          </div>
          <div>
            <h3>{language === "id" ? "Jelajahi" : "Explore"}</h3>
            <ul>{nav.slice(0, 6).map((item) => <li key={item.key}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          </div>
          <div>
            <h3>{language === "id" ? "Layanan" : "Services"}</h3>
            <ul>{content.services.map((service) => <li key={service.id}><Link href={publicHref(language, `/services#${service.slug}`)}>{localized(service.title, service.titleEn, language)}</Link></li>)}</ul>
          </div>
          <div>
            <h3>{language === "id" ? "Kontak" : "Contact"}</h3>
            <ul className={styles.contactList}>
              <li><MapPin size={17} /> <a href={mapsLink(content)} target="_blank" rel="noreferrer">{content.settings.address}</a></li>
              <li><Mail size={17} /> <a href={`mailto:${content.settings.email}`}>{content.settings.email}</a></li>
              <li><Phone size={17} /> <a href={waLink(content, language)} target="_blank" rel="noreferrer">{content.settings.phone}</a></li>
            </ul>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} PerumNet Enterprise. {language === "id" ? "Hak cipta dilindungi." : "All rights reserved."}</span>
          <nav aria-label={language === "id" ? "Informasi hukum" : "Legal information"}>
            <Link href={publicHref(language, "/syarat-ketentuan")}>{language === "id" ? "Syarat dan Ketentuan" : "Terms and Conditions"}</Link>
            <Link href={publicHref(language, "/kebijakan-privasi")}>{language === "id" ? "Kebijakan Privasi" : "Privacy Policy"}</Link>
            <Link href={publicHref(language, "/#faq")}>FAQ</Link>
          </nav>
        </div>
      </footer>
      <a className={styles.floatingWa} href={waLink(content, language)} target="_blank" rel="noreferrer" aria-label={language === "id" ? "Hubungi melalui WhatsApp" : "Contact us on WhatsApp"}>
        <MessageCircle size={24} />
      </a>
    </div>
  );
}

export function ServiceCard({ service, index = 0, language }: { service: CmsService; index?: number; language: PublicLanguage }) {
  const Icon = serviceIcons[service.icon as keyof typeof serviceIcons] || Network;
  const title = localized(service.title, service.titleEn, language);
  return (
    <Link className={styles.serviceCard} href={publicHref(language, `/services#${service.slug}`)} aria-label={`${language === "id" ? "Pelajari layanan" : "Explore service"} ${title}`}>
      <div className={styles.cardTopline}><span>{String(index + 1).padStart(2, "0")}</span><Icon size={26} /></div>
      <h3>{title}</h3>
      <p>{localized(service.summary, service.summaryEn, language)}</p>
      <span className={styles.cardLink}>{language === "id" ? "Pelajari layanan" : "Explore service"} <ArrowRight size={16} /></span>
    </Link>
  );
}

export function PortfolioCard({ item, language }: { item: CmsPortfolio; language: PublicLanguage }) {
  const title = localized(item.title, item.titleEn, language);
  return (
    <article className={styles.portfolioCard}>
      <div className={styles.portfolioImage}>
        <PublicPortfolioImage src={item.imageUrl} alt={title} />
        {item.location && <span><MapPin size={13} /> {localized(item.location, item.locationEn, language)}</span>}
      </div>
      <div className={styles.portfolioCopy}>
        <p>{item.completedAt
          ? new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", { month: "long", year: "numeric" }).format(new Date(`${item.completedAt}T00:00:00`))
          : (language === "id" ? "Proyek pilihan" : "Selected project")}</p>
        <h3>{title}</h3>
        <span>{localized(item.description, item.descriptionEn, language)}</span>
      </div>
    </article>
  );
}

export function TestimonialCard({ item, language }: { item: CmsTestimonial; language: PublicLanguage }) {
  return (
    <article className={styles.testimonialCard}>
      <Quote size={28} />
      <blockquote>“{localized(item.review, item.reviewEn, language)}”</blockquote>
      <div><strong>{item.clientName}</strong><span>{item.companyName}</span></div>
    </article>
  );
}

function LabsSection({ service, language }: { service: CmsService; language: PublicLanguage }) {
  return (
    <section className={styles.labsSection}>
      <div className={styles.labsCopy}>
        <span className={styles.eyebrowDark}><TerminalSquare size={15} /> PERUMNET LABS</span>
        <h2>{language === "id" ? "Software yang dibangun mengikuti alur bisnis Anda." : "Software built around the way your business works."}</h2>
        <p>{localized(service.description, service.descriptionEn, language)}</p>
        <Link className={styles.inlineButton} href={publicHref(language, `/services#${service.slug}`)}>{language === "id" ? "Jelajahi PerumNet Labs" : "Explore PerumNet Labs"} <ArrowRight size={17} /></Link>
      </div>
      <div className={styles.codeWindow} aria-label={language === "id" ? "Ilustrasi pengembangan perangkat lunak" : "Software development illustration"}>
        <div><span /><span /><span /><small>perumnet-labs.ts</small></div>
        <pre><code><em>const</em> solution = {'{'}{"\n"}  reliable: <strong>true</strong>,{"\n"}  scalable: <strong>true</strong>,{"\n"}  builtFor: <b>&quot;your workflow&quot;</b>{"\n"}{'}'};</code></pre>
        <ul>{(language === "en" && service.featuresEn.length ? service.featuresEn : service.features).slice(0, 4).map((feature) => <li key={feature}><Check size={15} /> {feature}</li>)}</ul>
      </div>
    </section>
  );
}

function PartnerCarouselCard({
  partner,
  duplicate = false,
}: {
  partner: CmsPartner;
  duplicate?: boolean;
}) {
  const initials = partner.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  const darkLogo = partner.logoUrl.toLowerCase().includes("quenzo");
  const className = `${styles.partnerCard} ${darkLogo ? styles.partnerCardDark : ""}`;
  const content = (
    <>
      {partner.logoUrl
        ? <img src={partner.logoUrl} alt={duplicate ? "" : partner.name} />
        : <span className={styles.partnerFallback}><strong>{initials}</strong><small>{partner.name}</small></span>}
    </>
  );

  if (!duplicate && partner.websiteUrl) {
    return <a className={className} href={partner.websiteUrl} target="_blank" rel="noreferrer" aria-label={partner.name}>{content}</a>;
  }
  return <div className={className} aria-label={duplicate ? undefined : partner.name}>{content}</div>;
}

function PartnersSection({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  const requestedDuration = Number(content.settings.partner_carousel_speed || "28");
  const duration = Number.isFinite(requestedDuration) ? Math.min(60, Math.max(12, requestedDuration)) : 28;
  return (
    <section className={styles.partnersSection} id="partners" data-reveal>
      <div className={styles.sectionHeader}>
        <div><span className={styles.eyebrowDark}>{text(content, language, "home", "partners_eyebrow", "PARTNER & KLIEN", "PARTNERS & CLIENTS")}</span><h2>{text(content, language, "home", "partners_title", "Dipercaya berbagai bisnis, diperkuat partner teknologi.", "Trusted by businesses, strengthened by technology partners.")}</h2></div>
        <p>{text(content, language, "home", "partners_description", "Kami bekerja bersama organisasi dari beragam sektor dan mitra yang mendukung kualitas implementasi.", "We work with organizations across industries and partners that support dependable implementation.")}</p>
      </div>
      <div className={styles.partnerCarousel} aria-label={language === "id" ? "Carousel partner dan klien" : "Partners and clients carousel"}>
        <div className={styles.partnerTrack} style={{ "--partner-duration": `${duration}s` } as CSSProperties}>
          <div className={styles.partnerGroup}>
            {content.partners.map((partner) => <PartnerCarouselCard key={partner.id} partner={partner} />)}
          </div>
          <div className={`${styles.partnerGroup} ${styles.partnerGroupDuplicate}`} aria-hidden="true">
            {content.partners.map((partner) => <PartnerCarouselCard key={`${partner.id}-duplicate`} partner={partner} duplicate />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqSection({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  return (
    <section className={styles.faqSection} id="faq">
      <div className={styles.faqIntro}>
        <span className={styles.eyebrowDark}>FAQ</span>
        <h2>{language === "id" ? "Pertanyaan yang sering diajukan." : "Frequently asked questions."}</h2>
        <p>{language === "id" ? "Jawaban singkat untuk membantu Anda memahami proses, dukungan, dan cara memulai proyek." : "Clear answers about our process, support, and how to start a project."}</p>
        <Link className={styles.inlineButton} href={publicHref(language, "/contact")}>{language === "id" ? "Punya pertanyaan lain?" : "Have another question?"} <ArrowRight size={17} /></Link>
      </div>
      <div className={styles.faqList}>
        {content.faqs.map((faq, index) => (
          <details key={faq.id} open={index === 0}>
            <summary><span>{localized(faq.question, faq.questionEn, language)}</span><i aria-hidden="true" /></summary>
            <p>{localized(faq.answer, faq.answerEn, language)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function HomePage({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  const labs = content.services.find((service) => service.slug === "perumnet-labs");
  const wifi = content.services.find((service) => service.slug === "managed-wifi");
  const smartHome = content.services.find((service) => service.slug === "smart-home-device");
  const cctv = content.services.find((service) => service.slug === "cctv");
  const pabx = content.services.find((service) => service.slug === "ip-pabx");
  const coreServices = content.services.filter((service) => service.slug !== "perumnet-labs").slice(0, 4);
  return (
    <PublicShell content={content} language={language} active="home">
      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy} data-reveal>
            <span className={styles.eyebrow}><Sparkles size={14} /> {text(content, language, "home", "hero_eyebrow", "SOLUSI IT TERINTEGRASI · BALI", "INTEGRATED IT SOLUTIONS · BALI")}</span>
            <h1>{text(content, language, "home", "hero_title", "Sistem IT yang rapi, stabil, dan siap dipakai.", "Well-organized IT systems, stable and ready to use.")}</h1>
            <p>{text(content, language, "home", "hero_description", "PerumNet Enterprise menangani jaringan, CCTV, Smart Home, IP PABX, dan software untuk hotel, villa, kantor, sekolah, serta area komersial di Bali.", "PerumNet Enterprise delivers networks, CCTV, Smart Home, IP PABX, and software for hotels, villas, offices, schools, and commercial sites across Bali.")}</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href={waLink(content, language)} target="_blank" rel="noreferrer">{setting(content, language, "cta_text", "Konsultasikan Kebutuhan Anda", "Discuss Your Requirements")} <ArrowRight size={18} /></a>
              <Link className={styles.secondaryButton} href={publicHref(language, "/portfolio")}>{language === "id" ? "Lihat hasil pekerjaan" : "View our work"}</Link>
            </div>
            <div className={styles.heroTrust}><span><ShieldCheck size={17} /> {language === "id" ? "Instalasi terdokumentasi" : "Documented delivery"}</span><span><Clock3 size={17} /> {language === "id" ? "Respons dukungan cepat" : "Responsive support"}</span></div>
          </div>
          <div className={styles.heroVisual} data-reveal data-reveal-delay="120" aria-label={language === "id" ? "Ilustrasi sistem terintegrasi" : "Integrated systems illustration"}>
            <div className={styles.visualGlow} /><div className={`${styles.orbit} ${styles.orbitOne}`} /><div className={`${styles.orbit} ${styles.orbitTwo}`} />
            <div className={styles.visualCenter}><img src="/perumnet-mark.png" alt="PerumNet Enterprise" /></div>
            <div className={`${styles.visualNode} ${styles.nodeWifi}`}><Wifi size={24} /><span>{wifi ? localized(wifi.title, wifi.titleEn, language) : "Managed WiFi"}</span><small>{language === "id" ? "Terpantau" : "Monitored"}</small></div>
            <div className={`${styles.visualNode} ${styles.nodeSmartHome}`}><Home size={24} /><span>{smartHome ? localized(smartHome.title, smartHome.titleEn, language) : "Smart Home"}</span><small>{language === "id" ? "Terintegrasi" : "Integrated"}</small></div>
            <div className={`${styles.visualNode} ${styles.nodeCamera}`}><Camera size={24} /><span>{cctv ? localized(cctv.title, cctv.titleEn, language) : "CCTV"}</span><small>{language === "id" ? "Terlindungi" : "Protected"}</small></div>
            <div className={`${styles.visualNode} ${styles.nodePhone}`}><Phone size={24} /><span>{pabx ? localized(pabx.title, pabx.titleEn, language) : "IP PABX"}</span><small>{language === "id" ? "Terhubung" : "Connected"}</small></div>
            <div className={`${styles.visualNode} ${styles.nodeLabs}`}><Code2 size={24} /><span>{labs ? localized(labs.title, labs.titleEn, language) : "PerumNet Labs"}</span><small>{language === "id" ? "Dikembangkan" : "Building"}</small></div>
            <div className={styles.signalCard}><span className={styles.liveDot} /> {language === "id" ? "Sistem terpantau" : "Monitored systems"} <strong>24/7</strong></div>
          </div>
        </div>
        <div className={styles.statsBar} data-reveal data-reveal-delay="180">
          <div><strong>{content.services.length}</strong><span>{language === "id" ? "Solusi inti terintegrasi" : "Integrated core solutions"}</span></div>
          <div><strong>24/7</strong><span>{language === "id" ? "Dukungan operasional" : "Operational support"}</span></div>
          <div><strong>{language === "id" ? "1 tim" : "1 team"}</strong><span>{language === "id" ? "Dari survei hingga support" : "From survey to support"}</span></div>
          <div><strong>Bali</strong><span>{language === "id" ? "Berbasis dan siap melayani" : "Based and ready to serve"}</span></div>
        </div>
      </section>

      <section className={styles.aboutSection} data-reveal>
        <div className={styles.sectionIntro}><span className={styles.eyebrowDark}>{text(content, language, "home", "about_eyebrow", "PARTNER TEKNOLOGI ANDA", "YOUR TECHNOLOGY PARTNER")}</span><h2>{text(content, language, "home", "about_title", "Satu tim untuk seluruh kebutuhan infrastruktur.", "One team for every infrastructure need.")}</h2></div>
        <div className={styles.aboutCopy}><p>{text(content, language, "home", "about_description", "Kami menggabungkan konsultasi, instalasi, dokumentasi, dan dukungan berkelanjutan dalam satu layanan.", "We combine consulting, installation, documentation, and ongoing support in one transparent service.")}</p><Link href={publicHref(language, "/tentang-kami")}>{language === "id" ? "Kenali cara kami bekerja" : "How we work"} <ArrowRight size={17} /></Link></div>
      </section>

      <section className={styles.servicesSection} data-reveal>
        <div className={styles.sectionHeader}><div><span className={styles.eyebrowDark}>{language === "id" ? "LAYANAN UTAMA" : "CORE SERVICES"}</span><h2>{text(content, language, "home", "services_title", "Solusi yang dibangun untuk kebutuhan nyata.", "Solutions built for real operational needs.")}</h2></div><p>{text(content, language, "home", "services_description", "Setiap sistem dirancang untuk stabil sejak hari pertama.", "Every system is designed to remain dependable from day one.")}</p></div>
        <div className={styles.serviceGrid}>{coreServices.map((service, index) => <ServiceCard key={service.id} service={service} index={index} language={language} />)}</div>
        <Link className={styles.inlineButton} href={publicHref(language, "/services")}>{language === "id" ? "Lihat seluruh layanan" : "View all services"} <ArrowRight size={17} /></Link>
      </section>

      {labs && <div data-reveal><LabsSection service={labs} language={language} /></div>}

      <section className={styles.processSection} data-reveal>
        <div><span className={styles.eyebrowLight}>{language === "id" ? "CARA KAMI BEKERJA" : "HOW WE WORK"}</span><h2>{language === "id" ? "Sederhana untuk Anda, terukur untuk tim kami." : "Simple for you, measurable for our team."}</h2></div>
        <ol>
          <li><span>01</span><div><strong>{language === "id" ? "Survei & pemetaan" : "Survey & discovery"}</strong><p>{language === "id" ? "Kami memahami lokasi, pengguna, risiko, dan target operasional." : "We learn your site, users, risks, and operational targets."}</p></div></li>
          <li><span>02</span><div><strong>{language === "id" ? "Desain & implementasi" : "Design & implementation"}</strong><p>{language === "id" ? "Solusi dipasang rapi, dikonfigurasi, dan diuji sesuai skenario penggunaan." : "Solutions are implemented, configured, and tested against real usage scenarios."}</p></div></li>
          <li><span>03</span><div><strong>{language === "id" ? "Serah terima & dukungan" : "Handover & support"}</strong><p>{language === "id" ? "Dokumentasi lengkap, penjelasan untuk tim, dan dukungan setelah implementasi." : "Clear documentation, team guidance, and support after implementation."}</p></div></li>
        </ol>
      </section>

      <section className={styles.portfolioSection} data-reveal>
        <div className={styles.sectionHeader}><div><span className={styles.eyebrowDark}>{language === "id" ? "PORTOFOLIO PILIHAN" : "SELECTED WORK"}</span><h2>{text(content, language, "home", "portfolio_title", "Pekerjaan rapi. Hasil yang terukur.", "Structured delivery. Measurable outcomes.")}</h2></div><Link href={publicHref(language, "/portfolio")}>{language === "id" ? "Lihat semua proyek" : "View all projects"} <ArrowRight size={17} /></Link></div>
        <div className={styles.portfolioGrid}>{content.portfolios.slice(0, 3).map((item) => <PortfolioCard key={item.id} item={item} language={language} />)}</div>
      </section>

      <PartnersSection content={content} language={language} />

      <section className={styles.testimonialSection} data-reveal>
        <div className={styles.sectionIntro}><span className={styles.eyebrowLight}>{language === "id" ? "CERITA KLIEN" : "CLIENT STORIES"}</span><h2>{text(content, language, "home", "testimonials_title", "Dipercaya untuk menjaga operasional tetap berjalan.", "Trusted to keep operations running.")}</h2></div>
        <div className={styles.testimonialGrid}>{content.testimonials.slice(0, 3).map((item) => <TestimonialCard key={item.id} item={item} language={language} />)}</div>
      </section>

      <div data-reveal><FaqSection content={content} language={language} /></div>

      <section className={styles.closingCta} data-reveal>
        <div className={styles.closingCtaCopy}><span>{language === "id" ? "KONSULTASI AWAL" : "INITIAL CONSULTATION"}</span><h2>{text(content, language, "home", "closing_title", "Mulai dari survei lokasi, kami bantu sampai sistem siap digunakan.", "From the first site survey to a system ready for daily use.")}</h2><p>{language === "id" ? "Ceritakan kebutuhan dan lokasi Anda. Tim kami akan membantu menentukan langkah pertama yang paling tepat." : "Tell us about your needs and location. Our team will recommend the most practical first step."}</p></div>
        <PublicLeadForm language={language} services={content.services} sourcePath={language === "en" ? "/en" : "/"} compact />
      </section>
    </PublicShell>
  );
}

export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className={styles.pageHero} data-reveal><span className={styles.eyebrow}>{eyebrow}</span><h1>{title}</h1><p>{description}</p><div className={styles.pageHeroMark}><img src="/perumnet-mark.png" alt="" /></div></section>;
}

export function ServicesPage({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  return <PublicShell content={content} language={language} active="services">
    <PageHero eyebrow={language === "id" ? "LAYANAN PERUMNET ENTERPRISE" : "PERUMNET ENTERPRISE SERVICES"} title={text(content, language, "services", "page_title", "Infrastruktur yang siap mengikuti ritme bisnis Anda.", "Infrastructure ready to keep pace with your business.")} description={text(content, language, "services", "page_description", "Layanan konsultasi, instalasi, integrasi, dan pemeliharaan.", "Consulting, installation, integration, and maintenance services.")} />
    <section className={styles.detailList}>{content.services.map((service, index) => {
      const Icon = serviceIcons[service.icon as keyof typeof serviceIcons] || Network;
      return <article key={service.id} id={service.slug} className={styles.serviceDetail}>
        <div className={styles.detailNumber}>{String(index + 1).padStart(2, "0")}</div><div className={styles.detailIcon}><Icon size={34} /></div>
        <div><h2>{localized(service.title, service.titleEn, language)}</h2><p className={styles.detailLead}>{localized(service.summary, service.summaryEn, language)}</p><p>{localized(service.description, service.descriptionEn, language)}</p></div>
        <ul>{(language === "en" && service.featuresEn.length ? service.featuresEn : service.features).map((feature) => <li key={feature}><Check size={16} /> {feature}</li>)}</ul>
      </article>;
    })}</section>
    <section className={styles.simpleCta}><div><h2>{language === "id" ? "Belum yakin layanan mana yang paling tepat?" : "Not sure which service fits best?"}</h2><p>{language === "id" ? "Kami dapat memulai dari survei singkat dan rekomendasi sesuai kebutuhan lokasi." : "We can start with a short discovery session and a recommendation for your site."}</p></div><a href={waLink(content, language)} target="_blank" rel="noreferrer">{language === "id" ? "Jadwalkan konsultasi" : "Schedule a consultation"} <ArrowRight size={18} /></a></section>
  </PublicShell>;
}

export function PortfolioPage({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  return <PublicShell content={content} language={language} active="portfolio">
    <PageHero eyebrow={language === "id" ? "HASIL PEKERJAAN" : "OUR WORK"} title={text(content, language, "portfolio", "page_title", "Pilihan proyek yang kami selesaikan bersama klien.", "Selected projects delivered together with our clients.")} description={text(content, language, "portfolio", "page_description", "Setiap proyek dimulai dari kebutuhan lapangan.", "Every project begins with real operational requirements.")} />
    <section className={styles.archiveSection}><div className={styles.portfolioGrid}>{content.portfolios.map((item) => <PortfolioCard key={item.id} item={item} language={language} />)}</div></section>
  </PublicShell>;
}

export function TestimonialsPage({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  return <PublicShell content={content} language={language} active="testimonials">
    <PageHero eyebrow={language === "id" ? "PENGALAMAN KLIEN" : "CLIENT EXPERIENCE"} title={text(content, language, "testimonials", "page_title", "Cerita dari bisnis yang bertumbuh bersama sistem yang lebih baik.", "Stories from businesses growing with better systems.")} description={text(content, language, "testimonials", "page_description", "Ulasan klien tentang proses kerja dan hasil implementasi.", "Client perspectives on our process and implementation outcomes.")} />
    <section className={styles.archiveSection}><div className={styles.testimonialArchive}>{content.testimonials.map((item) => <TestimonialCard key={item.id} item={item} language={language} />)}</div></section>
  </PublicShell>;
}

export function ContactPage({ content, language }: { content: CmsContent; language: PublicLanguage }) {
  return <PublicShell content={content} language={language} active="contact">
    <PageHero eyebrow={language === "id" ? "HUBUNGI KAMI" : "CONTACT US"} title={text(content, language, "contact", "page_title", "Mari bicarakan kebutuhan IT Anda.", "Let us discuss your IT requirements.")} description={text(content, language, "contact", "page_description", "Ceritakan lokasi, tantangan, dan target Anda.", "Tell us about your location, challenges, and target.")} />
    <section className={styles.contactSection}>
      <div className={styles.contactCards}>
        <a href={waLink(content, language)} target="_blank" rel="noreferrer"><MessageCircle size={24} /><div><span>WhatsApp</span><strong>{content.settings.phone}</strong><small>{language === "id" ? "Respons tercepat untuk konsultasi awal" : "Fastest response for an initial consultation"}</small></div><ArrowRight size={18} /></a>
        <a href={`mailto:${content.settings.email}`}><Mail size={24} /><div><span>Email</span><strong>{content.settings.email}</strong><small>{language === "id" ? "Untuk proposal dan dokumen" : "For proposals and documents"}</small></div><ArrowRight size={18} /></a>
        <a href={mapsLink(content)} target="_blank" rel="noreferrer"><MapPin size={24} /><div><span>{language === "id" ? "Lokasi" : "Location"}</span><strong>Karangasem, Bali</strong><small>{content.settings.address}</small></div><ArrowRight size={18} /></a>
      </div>
      <div className={styles.contactPanel}><PublicLeadForm language={language} services={content.services} sourcePath={language === "en" ? "/en/contact" : "/contact"} /></div>
    </section>
  </PublicShell>;
}

export function DynamicContentPage({ content, page, language }: { content: CmsContent; page: CmsContent["pages"][number]; language: PublicLanguage }) {
  const title = localized(page.title, page.titleEn, language);
  return <PublicShell content={content} language={language} active={page.slug}>
    <PageHero eyebrow={language === "id" ? "PERUMNET ENTERPRISE" : "PERUMNET ENTERPRISE"} title={title} description={localized(page.excerpt, page.excerptEn, language)} />
    <article className={styles.richPage}><div className={styles.richPageIcon}>{page.slug.includes("privasi") ? <ShieldCheck size={38} /> : <Building2 size={38} />}</div><div>{localized(page.content, page.contentEn, language).split(/\n\s*\n/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></article>
  </PublicShell>;
}
