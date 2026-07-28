import "server-only";

import { getDatabase } from "./db/client";

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
};

export type CmsTestimonial = {
  id: string;
  clientName: string;
  companyName: string;
  review: string;
  reviewEn: string;
  isVisible: boolean;
  sortOrder: number;
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
};

export type CmsText = {
  id: string;
  pageKey: string;
  contentKey: string;
  value: string;
  valueEn: string;
};

export type CmsFaq = {
  id: string;
  question: string;
  questionEn: string;
  answer: string;
  answerEn: string;
  sortOrder: number;
  isVisible: boolean;
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
};

export type CmsContent = {
  texts: CmsText[];
  textMap: Record<string, Record<string, string>>;
  textMapEn: Record<string, Record<string, string>>;
  settings: Record<string, string>;
  settingsEn: Record<string, string>;
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

function stringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
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
        "SELECT id,page_key,content_key,value_content,value_content_en FROM cms_site_texts ORDER BY page_key,content_key",
      ),
      client.execute(
        "SELECT key_name,value_content,value_content_en FROM cms_site_settings ORDER BY key_name",
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
    services: serviceResult.rows.map((row) => ({
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
    })),
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
    })),
    testimonials: testimonialResult.rows.map((row) => ({
      id: String(row.id),
      clientName: String(row.client_name),
      companyName: String(row.company_name ?? ""),
      review: String(row.review),
      reviewEn: String(row.review_en ?? ""),
      isVisible: booleanValue(row.is_visible),
      sortOrder: numberValue(row.sort_order),
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
    })),
    faqs: faqResult.rows.map((row) => ({
      id: String(row.id),
      question: String(row.question),
      questionEn: String(row.question_en ?? ""),
      answer: String(row.answer),
      answerEn: String(row.answer_en ?? ""),
      sortOrder: numberValue(row.sort_order),
      isVisible: booleanValue(row.is_visible),
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
    })),
  };
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
  } satisfies CmsPage;
}
