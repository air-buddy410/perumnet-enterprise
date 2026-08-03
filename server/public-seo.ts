import "server-only";

import type { Metadata } from "next";
import type { CmsContent } from "./cms";
import type { PublicLanguage } from "./public-language";

export const publicOrigin = "https://enterprise.perumnet.id";

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
    title,
    description,
    alternates: {
      canonical: canonicalPath,
      languages: {
        "id-ID": path,
        "en-ID": englishPath(path),
        "x-default": path,
      },
    },
    robots: noIndex ? { index: false, follow: false, nocache: true } : undefined,
    openGraph: {
      title: translatedSetting(content, language, "og_title") || title,
      description: translatedSetting(content, language, "og_description") || description,
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
    "@id": `${publicOrigin}/#organization`,
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
