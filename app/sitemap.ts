import type { MetadataRoute } from "next";
import { getCmsContent, type CmsContent } from "@/server/cms";
import { publicOrigin, servicePath } from "@/server/public-seo";

export const dynamic = "force-dynamic";

/**
 * The newest of a set of cms `updated_at` values, or null when not one of them
 * is a date.
 *
 * `updated_at` is TEXT and ISO-8601 only by convention, so an empty string, a
 * NULL left by an old migration, or a hand-edited row can all reach here. Each
 * unparseable value is dropped rather than serialised — `new Date("")` renders
 * as "Invalid Date" in the XML, which is worse than no <lastmod> at all.
 */
function newest(values: Array<string | null | undefined>): Date | null {
  let latest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) continue;
    if (latest === null || time > latest) latest = time;
  }
  return latest === null ? null : new Date(latest);
}

/** Every `updated_at` behind the cms_site_texts rows one page reads. The texts
 *  table is keyed by page, so /portfolio moves when its own heading is edited
 *  and stays put when /contact's is. */
function textTimestamps(content: CmsContent, pageKey: string) {
  return content.texts.filter((text) => text.pageKey === pageKey).map((text) => text.updatedAt);
}

function timestamps(rows: Array<{ updatedAt: string }>) {
  return rows.map((row) => row.updatedAt);
}

/**
 * One route and the moment its content last changed.
 *
 * `lastModified` used to be `new Date()` for every URL, which made it the
 * moment of the request rather than the moment of the edit: two fetches seconds
 * apart disagreed, and all 26 URLs always agreed with each other. Google drops
 * `lastmod` it can prove is unreliable, so the field was worthless — and worse,
 * editing one service description told the crawler nothing about which page to
 * recrawl.
 *
 * Each timestamp below is the newest `updated_at` among the CMS rows that
 * route's own body renders. Deliberately excluded is the shared chrome every
 * page carries — the header nav, the footer's service list and contact block,
 * the lead form's service picker. Folding those in would put the site settings
 * and the whole services table behind all 26 URLs, which is the single shared
 * timestamp this is fixing.
 */
function routeTimestamps(content: CmsContent) {
  const services = timestamps(content.services);
  const settings = Object.values(content.settingsUpdatedAt);
  return {
    // The home page renders a slice of nearly everything: hero and section copy
    // from the home texts, the service cards, three portfolio items, the
    // partner strip, three testimonials, the FAQ list, and settings through the
    // CTA and lead form.
    "": newest([
      ...textTimestamps(content, "home"),
      ...services,
      ...timestamps(content.portfolios),
      ...timestamps(content.testimonials),
      ...timestamps(content.faqs),
      ...timestamps(content.partners),
      ...settings,
    ]),
    "/services": newest([...textTimestamps(content, "services"), ...services]),
    "/portfolio": newest([
      ...textTimestamps(content, "portfolio"),
      ...timestamps(content.portfolios),
    ]),
    "/testimonials": newest([
      ...textTimestamps(content, "testimonials"),
      ...timestamps(content.testimonials),
    ]),
    // /contact renders its hero from the contact texts and everything below it
    // — WhatsApp number, email, address — from cms_site_settings. The lead
    // form's service dropdown is chrome, not the page's subject.
    "/contact": newest([...textTimestamps(content, "contact"), ...settings]),
  } as Record<string, Date | null>;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const content = await getCmsContent();
  const baseRoutes = ["", "/services", "/portfolio", "/testimonials", "/contact"];
  // getCmsContent already drops unpublished rows, so unpublishing a service in
  // the panel removes its two URLs from the sitemap in the same edit that makes
  // them 404. A sitemap entry that answers 404 is a crawl error, not a hint.
  const serviceRoutes = content.services.map((service) => servicePath(service.slug));
  const customRoutes = content.pages
    .filter((page) => page.isPublished)
    .map((page) => `/${page.slug}`);
  const routes = [...baseRoutes, ...serviceRoutes, ...customRoutes];

  const byRoute = routeTimestamps(content);
  for (const service of content.services) {
    byRoute[servicePath(service.slug)] = newest([service.updatedAt]);
  }
  for (const page of content.pages) {
    byRoute[`/${page.slug}`] = newest([page.updatedAt]);
  }
  // A route whose own rows are all unparseable falls back to the newest date
  // the CMS could offer at all — still a real edit, just a coarser one. If the
  // whole database has no usable timestamp the entry ships without <lastmod>,
  // because an absent value is honest and a wrong one is worse than none.
  const fallback = newest(Object.values(byRoute).map((date) => date?.toISOString()));

  return routes.flatMap((route) => {
    const lastModified = byRoute[route] ?? fallback;
    const modified = lastModified ? { lastModified } : {};
    return [
      {
        url: `${publicOrigin}${route || "/"}`,
        ...modified,
        changeFrequency: route ? "monthly" : "weekly",
        priority: route ? 0.8 : 1,
        alternates: {
          languages: {
            id: `${publicOrigin}${route || "/"}`,
            en: `${publicOrigin}/en${route}`,
          },
        },
      },
      {
        // The English twin renders the same rows through the same components,
        // so it carries the same timestamp. Nothing can edit one without the
        // other: title and title_en live in a single row.
        url: `${publicOrigin}/en${route}`,
        ...modified,
        changeFrequency: route ? "monthly" : "weekly",
        priority: route ? 0.75 : 0.9,
        alternates: {
          languages: {
            id: `${publicOrigin}${route || "/"}`,
            en: `${publicOrigin}/en${route}`,
          },
        },
      },
    ];
  });
}
