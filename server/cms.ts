import "server-only";

import { getDatabase } from "./db/client";

/**
 * Every CMS row carries the `updated_at` its panel form last wrote, and every
 * mapped shape below carries it through as `updatedAt`. The sitemap is what
 * needs it: `<lastmod>` is only worth emitting if it is the moment the content
 * changed, and the only place that moment is recorded is this column.
 *
 * The column is TEXT and ISO-8601 only by convention, so the value is passed
 * through exactly as stored. Deciding what an empty or unparseable value means
 * belongs to the consumer, not here — see app/sitemap.ts.
 */
export type CmsService = {
  id: string;
  slug: string;
  title: string;
  titleEn: string;
  summary: string;
  summaryEn: string;
  description: string;
  descriptionEn: string;
  features: string[];
  featuresEn: string[];
  icon: string;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
};

export type CmsPortfolio = {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  imageUrl: string;
  location: string;
  locationEn: string;
  completedAt: string;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
};

export type CmsTestimonial = {
  id: string;
  clientName: string;
  companyName: string;
  review: string;
  reviewEn: string;
  isVisible: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type CmsPage = {
  id: string;
  title: string;
  titleEn: string;
  slug: string;
  excerpt: string;
  excerptEn: string;
  content: string;
  contentEn: string;
  isPublished: boolean;
  showInNavigation: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type CmsText = {
  id: string;
  pageKey: string;
  contentKey: string;
  value: string;
  valueEn: string;
  updatedAt: string;
};

export type CmsFaq = {
  id: string;
  question: string;
  questionEn: string;
  answer: string;
  answerEn: string;
  sortOrder: number;
  isVisible: boolean;
  updatedAt: string;
};

export type CmsPartner = {
  id: string;
  name: string;
  organizationType: "partner" | "client";
  category: string;
  websiteUrl: string;
  logoUrl: string;
  sortOrder: number;
  isVisible: boolean;
  updatedAt: string;
};

export type CmsContent = {
  texts: CmsText[];
  textMap: Record<string, Record<string, string>>;
  textMapEn: Record<string, Record<string, string>>;
  settings: Record<string, string>;
  settingsEn: Record<string, string>;
  /** key_name -> that setting row's `updated_at`, the timestamp counterpart of
   *  `settings`. A flat record has nowhere to hang a per-row field, so it gets
   *  a record of its own rather than losing the granularity. */
  settingsUpdatedAt: Record<string, string>;
  services: CmsService[];
  portfolios: CmsPortfolio[];
  testimonials: CmsTestimonial[];
  pages: CmsPage[];
  faqs: CmsFaq[];
  partners: CmsPartner[];
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "1";
}

/** `updated_at` verbatim. Anything that is not text — a NULL left by an old
 *  migration, say — becomes "" so no consumer has to guess at "null". */
function timestampValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * One row of cms_services in the shape the public site consumes. Shared by the
 * list query in getCmsContent and the single-slug lookup behind
 * /services/[slug] so a detail page can never disagree with the list.
 */
function mapService(row: Record<string, unknown>): CmsService {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    titleEn: String(row.title_en ?? ""),
    summary: String(row.summary),
    summaryEn: String(row.summary_en ?? ""),
    description: String(row.description),
    descriptionEn: String(row.description_en ?? ""),
    features: stringArray(row.features_json),
    featuresEn: stringArray(row.features_json_en),
    icon: String(row.icon),
    sortOrder: numberValue(row.sort_order),
    isPublished: booleanValue(row.is_published),
    updatedAt: timestampValue(row.updated_at),
  };
}

function portfolioImage(row: Record<string, unknown>) {
  if (row.image_storage_url) return `/api/cms/media/${String(row.id)}`;
  return String(row.image_url ?? "");
}

function partnerLogo(row: Record<string, unknown>) {
  if (row.logo_storage_url) return `/api/cms/partner-media/${String(row.id)}`;
  return String(row.logo_url ?? "");
}

export async function getCmsContent(includeHidden = false): Promise<CmsContent> {
  const { client } = await getDatabase();
  const [textResult, settingResult, serviceResult, portfolioResult, testimonialResult, pageResult, faqResult, partnerResult] =
    await Promise.all([
      client.execute(
        "SELECT id,page_key,content_key,value_content,value_content_en,updated_at FROM cms_site_texts ORDER BY page_key,content_key",
      ),
      client.execute(
        "SELECT key_name,value_content,value_content_en,updated_at FROM cms_site_settings ORDER BY key_name",
      ),
      client.execute(
        `SELECT * FROM cms_services${includeHidden ? "" : " WHERE is_published=1"} ORDER BY sort_order,title`,
      ),
      client.execute(
        `SELECT * FROM cms_portfolios${includeHidden ? "" : " WHERE is_published=1"} ORDER BY sort_order,completed_at DESC`,
      ),
      client.execute(
        `SELECT * FROM cms_testimonials${includeHidden ? "" : " WHERE is_visible=1"} ORDER BY sort_order,created_at`,
      ),
      client.execute(
        `SELECT * FROM cms_pages${includeHidden ? "" : " WHERE is_published=1"} ORDER BY sort_order,title`,
      ),
      client.execute(
        `SELECT * FROM cms_faqs${includeHidden ? "" : " WHERE is_visible=1"} ORDER BY sort_order,question`,
      ),
      client.execute(
        `SELECT * FROM cms_partners${includeHidden ? "" : " WHERE is_visible=1"} ORDER BY sort_order,name`,
      ),
    ]);

  const texts = textResult.rows.map((row) => ({
    id: String(row.id),
    pageKey: String(row.page_key),
    contentKey: String(row.content_key),
    value: String(row.value_content),
    valueEn: String(row.value_content_en ?? ""),
    updatedAt: timestampValue(row.updated_at),
  }));
  const textMap: Record<string, Record<string, string>> = {};
  const textMapEn: Record<string, Record<string, string>> = {};
  for (const text of texts) {
    textMap[text.pageKey] ??= {};
    textMap[text.pageKey][text.contentKey] = text.value;
    textMapEn[text.pageKey] ??= {};
    textMapEn[text.pageKey][text.contentKey] = text.valueEn;
  }

  return {
    texts,
    textMap,
    textMapEn,
    settings: Object.fromEntries(
      settingResult.rows.map((row) => [String(row.key_name), String(row.value_content)]),
    ),
    settingsEn: Object.fromEntries(
      settingResult.rows.map((row) => [String(row.key_name), String(row.value_content_en ?? "")]),
    ),
    settingsUpdatedAt: Object.fromEntries(
      settingResult.rows.map((row) => [String(row.key_name), timestampValue(row.updated_at)]),
    ),
    services: serviceResult.rows.map(mapService),
    portfolios: portfolioResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      titleEn: String(row.title_en ?? ""),
      description: String(row.description),
      descriptionEn: String(row.description_en ?? ""),
      imageUrl: portfolioImage(row),
      location: String(row.location ?? ""),
      locationEn: String(row.location_en ?? ""),
      completedAt: String(row.completed_at ?? ""),
      sortOrder: numberValue(row.sort_order),
      isPublished: booleanValue(row.is_published),
      updatedAt: timestampValue(row.updated_at),
    })),
    testimonials: testimonialResult.rows.map((row) => ({
      id: String(row.id),
      clientName: String(row.client_name),
      companyName: String(row.company_name ?? ""),
      review: String(row.review),
      reviewEn: String(row.review_en ?? ""),
      isVisible: booleanValue(row.is_visible),
      sortOrder: numberValue(row.sort_order),
      updatedAt: timestampValue(row.updated_at),
    })),
    pages: pageResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      titleEn: String(row.title_en ?? ""),
      slug: String(row.slug),
      excerpt: String(row.excerpt ?? ""),
      excerptEn: String(row.excerpt_en ?? ""),
      content: String(row.content),
      contentEn: String(row.content_en ?? ""),
      isPublished: booleanValue(row.is_published),
      showInNavigation: booleanValue(row.show_in_navigation),
      sortOrder: numberValue(row.sort_order),
      updatedAt: timestampValue(row.updated_at),
    })),
    faqs: faqResult.rows.map((row) => ({
      id: String(row.id),
      question: String(row.question),
      questionEn: String(row.question_en ?? ""),
      answer: String(row.answer),
      answerEn: String(row.answer_en ?? ""),
      sortOrder: numberValue(row.sort_order),
      isVisible: booleanValue(row.is_visible),
      updatedAt: timestampValue(row.updated_at),
    })),
    partners: partnerResult.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      organizationType: row.organization_type === "client" ? "client" : "partner",
      category: String(row.category ?? ""),
      websiteUrl: String(row.website_url ?? ""),
      logoUrl: partnerLogo(row),
      sortOrder: numberValue(row.sort_order),
      isVisible: booleanValue(row.is_visible),
      updatedAt: timestampValue(row.updated_at),
    })),
  };
}

/**
 * The single service behind /services/[slug]. Unpublished rows are filtered in
 * SQL exactly like getCmsPageBySlug, so unpublishing a service in the panel
 * turns its detail page into a 404 rather than leaving it quietly reachable.
 */
export async function getCmsServiceBySlug(slug: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT * FROM cms_services WHERE slug=? AND is_published=1 LIMIT 1",
    args: [slug],
  });
  const row = result.rows[0];
  if (!row) return null;
  return mapService(row);
}

export async function getCmsPageBySlug(slug: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT * FROM cms_pages WHERE slug=? AND is_published=1 LIMIT 1",
    args: [slug],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    titleEn: String(row.title_en ?? ""),
    slug: String(row.slug),
    excerpt: String(row.excerpt ?? ""),
    excerptEn: String(row.excerpt_en ?? ""),
    content: String(row.content),
    contentEn: String(row.content_en ?? ""),
    isPublished: true,
    showInNavigation: booleanValue(row.show_in_navigation),
    sortOrder: numberValue(row.sort_order),
    updatedAt: timestampValue(row.updated_at),
  } satisfies CmsPage;
}
