import "server-only";

import type { Metadata } from "next";
import type { CmsContent, CmsService } from "./cms";
import type { PublicLanguage } from "./public-language";

export const publicOrigin = "https://enterprise.perumnet.id";

/** The @id every page's JSON-LD points `provider` at, instead of restating the
 * company. PublicShell emits the Organization node itself on every page. */
export const organizationId = `${publicOrigin}/#organization`;

function englishPath(path: string) {
  return path === "/" ? "/en" : `/en${path}`;
}

function translatedSetting(content: CmsContent, language: PublicLanguage, key: string) {
  return language === "en"
    ? content.settingsEn[key] || content.settings[key] || ""
    : content.settings[key] || "";
}

export function publicMetadata(
  content: CmsContent,
  language: PublicLanguage,
  path: string,
  fallbackTitle: string,
  fallbackDescription: string,
): Metadata {
  const home = path === "/";
  const title = home
    ? translatedSetting(content, language, "seo_title") || fallbackTitle
    : fallbackTitle;
  const description = home
    ? translatedSetting(content, language, "seo_description") || fallbackDescription
    : fallbackDescription;
  const canonicalPath = language === "en" ? englishPath(path) : path;
  const noIndex = process.env.APP_MODE === "demo" || process.env.DEMO_MODE === "true";
  return {
    // The root layout's "%s — PerumNet Enterprise" template does not fire for
    // app/page.tsx, which sits in the same segment as the layout that defines
    // it, but it does fire for app/en/page.tsx one segment down. The two home
    // pages therefore disagreed: / rendered the brand line once at 58
    // characters, /en rendered it twice at 85. Both seo_title settings are
    // already a complete brand line, so both opt out.
    title: home ? { absolute: title } : title,
    description,
    alternates: {
      canonical: canonicalPath,
      languages: {
        "id-ID": path,
        // Plain "en" rather than "en-ID". The English pages are written for
        // the foreign owners and managers of the hotels and villas we install
        // for, and a region-qualified tag tells Google to serve them only to
        // searchers whose locale is already Indonesia.
        en: englishPath(path),
        "x-default": path,
      },
    },
    robots: noIndex ? { index: false, follow: false, nocache: true } : undefined,
    openGraph: {
      // og_title / og_description are the site-wide card, which is the home
      // page's pitch. Applied to every route they gave /services, /contact and
      // each CMS page the same WhatsApp and LinkedIn preview; off the home
      // page the page's own title and description describe what was shared.
      title: home ? translatedSetting(content, language, "og_title") || title : title,
      description: home
        ? translatedSetting(content, language, "og_description") || description
        : description,
      url: canonicalPath,
      siteName: "PerumNet Enterprise",
      locale: language === "en" ? "en_ID" : "id_ID",
      alternateLocale: language === "en" ? ["id_ID"] : ["en_ID"],
      type: "website",
      images: ["/og.png"],
    },
  };
}

export function businessStructuredData(content: CmsContent, language: PublicLanguage) {
  const settings = content.settings;
  const settingsEn = content.settingsEn;
  const translated = (key: string) =>
    language === "en" ? settingsEn[key] || settings[key] || "" : settings[key] || "";
  const rawPhone = settings.phone || settings.whatsapp_number || "";
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness", "ProfessionalService"],
    "@id": organizationId,
    name: settings.business_legal_name || settings.company_name || "PerumNet Enterprise",
    alternateName: "PerumNet Enterprise",
    url: language === "en" ? `${publicOrigin}/en` : publicOrigin,
    logo: `${publicOrigin}/perumnet-mark.png`,
    image: `${publicOrigin}/og.png`,
    description: translated("seo_description"),
    email: settings.email || "enterprise@perumnet.id",
    telephone: rawPhone || undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: settings.address || undefined,
      addressRegion: settings.business_area || "Bali",
      postalCode: settings.postal_code || undefined,
      addressCountry: settings.business_country || "ID",
    },
    areaServed: translated("business_area") || "Bali, Indonesia",
    sameAs: [settings.instagram_url, settings.linkedin_url, settings.website_url].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Per-service detail pages
// ---------------------------------------------------------------------------
//
// Everything below reads from cms_services and cms_site_settings only. A
// service page must never assert anything the owner has not typed into the
// panel — no capability, client, certification or coverage claim is synthesised
// here, and the only editorial words the code contributes are the connective
// "di"/"in" in the title and the breadcrumb labels.

export function servicePath(slug: string) {
  return `/services/${slug}`;
}

/**
 * The short place name for a title, taken from the owner's own business_area
 * setting ("Bali, Indonesia") rather than hardcoded. Only the first component
 * is used: "CCTV & Surveillance di Bali, Indonesia — PerumNet Enterprise" runs
 * well past what a result page shows.
 */
export function serviceArea(content: CmsContent, language: PublicLanguage) {
  return translatedSetting(content, language, "business_area").split(",")[0].trim();
}

/** The service's copy in the requested language, falling back to Indonesian
 *  field by field the way the rest of the public site does. */
export function serviceCopy(service: CmsService, language: PublicLanguage) {
  const pick = (indonesian: string, english: string) =>
    language === "en" && english.trim() ? english : indonesian;
  return {
    title: pick(service.title, service.titleEn),
    summary: pick(service.summary, service.summaryEn),
    description: pick(service.description, service.descriptionEn),
    features: language === "en" && service.featuresEn.length ? service.featuresEn : service.features,
  };
}

/**
 * A search result line for one service. The title is the CMS title plus the
 * configured area, which keeps every page distinct from the /services list and
 * lands the "<service> <area>" query the owner is actually chasing; the root
 * layout appends " — PerumNet Enterprise", so the CMS title carries roughly 35
 * characters before the 60-character budget is spent.
 *
 * The description prefers the CMS description and falls back to the summary
 * once the description passes 160 characters — a full body paragraph is
 * truncated mid-word by Google, and the summary is the field already written as
 * a single self-contained sentence.
 */
export function serviceMetadata(
  content: CmsContent,
  language: PublicLanguage,
  service: CmsService,
): Metadata {
  const copy = serviceCopy(service, language);
  const area = serviceArea(content, language);
  const title = area
    ? `${copy.title} ${language === "en" ? "in" : "di"} ${area}`
    : copy.title;
  const description = copy.description.length > 160 ? copy.summary : copy.description;
  return publicMetadata(
    content,
    language,
    servicePath(service.slug),
    title,
    description || copy.summary,
  );
}

/**
 * schema.org/Service for one CMS row. `provider` is a bare @id reference to the
 * Organization node PublicShell already emits on this same page, so the company
 * is described once and the service simply points at it.
 */
export function serviceStructuredData(
  content: CmsContent,
  language: PublicLanguage,
  service: CmsService,
) {
  const path = servicePath(service.slug);
  const url = `${publicOrigin}${language === "en" ? englishPath(path) : path}`;
  const copy = serviceCopy(service, language);
  const area = serviceArea(content, language);
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${url}#service`,
    name: copy.title,
    serviceType: copy.title,
    description: copy.description || copy.summary,
    url,
    inLanguage: language === "en" ? "en" : "id",
    provider: { "@id": organizationId },
    ...(area ? { areaServed: { "@type": "AdministrativeArea", name: area } } : {}),
    ...(copy.features.length
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: copy.title,
            itemListElement: copy.features.map((feature) => ({
              "@type": "Offer",
              itemOffered: { "@type": "Service", name: feature },
            })),
          },
        }
      : {}),
  };
}

/** schema.org/BreadcrumbList for the same trail the page renders visibly. */
export function breadcrumbStructuredData(
  language: PublicLanguage,
  trail: Array<{ name: string; path: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: `${publicOrigin}${language === "en" ? englishPath(step.path) : step.path}`,
    })),
  };
}
