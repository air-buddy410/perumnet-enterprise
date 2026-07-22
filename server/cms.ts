import "server-only";

import { getDatabase } from "./db/client";

export type CmsService = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  features: string[];
  icon: string;
  sortOrder: number;
  isPublished: boolean;
};

export type CmsPortfolio = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  location: string;
  completedAt: string;
  sortOrder: number;
  isPublished: boolean;
};

export type CmsTestimonial = {
  id: string;
  clientName: string;
  companyName: string;
  review: string;
  isVisible: boolean;
  sortOrder: number;
};

export type CmsPage = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  isPublished: boolean;
  sortOrder: number;
};

export type CmsText = {
  id: string;
  pageKey: string;
  contentKey: string;
  value: string;
};

export type CmsContent = {
  texts: CmsText[];
  textMap: Record<string, Record<string, string>>;
  settings: Record<string, string>;
  services: CmsService[];
  portfolios: CmsPortfolio[];
  testimonials: CmsTestimonial[];
  pages: CmsPage[];
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

export async function getCmsContent(includeHidden = false): Promise<CmsContent> {
  const { client } = await getDatabase();
  const [textResult, settingResult, serviceResult, portfolioResult, testimonialResult, pageResult] =
    await Promise.all([
      client.execute(
        "SELECT id,page_key,content_key,value_content FROM cms_site_texts ORDER BY page_key,content_key",
      ),
      client.execute(
        "SELECT key_name,value_content FROM cms_site_settings ORDER BY key_name",
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
    ]);

  const texts = textResult.rows.map((row) => ({
    id: String(row.id),
    pageKey: String(row.page_key),
    contentKey: String(row.content_key),
    value: String(row.value_content),
  }));
  const textMap: Record<string, Record<string, string>> = {};
  for (const text of texts) {
    textMap[text.pageKey] ??= {};
    textMap[text.pageKey][text.contentKey] = text.value;
  }

  return {
    texts,
    textMap,
    settings: Object.fromEntries(
      settingResult.rows.map((row) => [String(row.key_name), String(row.value_content)]),
    ),
    services: serviceResult.rows.map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title),
      summary: String(row.summary),
      description: String(row.description),
      features: stringArray(row.features_json),
      icon: String(row.icon),
      sortOrder: numberValue(row.sort_order),
      isPublished: booleanValue(row.is_published),
    })),
    portfolios: portfolioResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      description: String(row.description),
      imageUrl: portfolioImage(row),
      location: String(row.location ?? ""),
      completedAt: String(row.completed_at ?? ""),
      sortOrder: numberValue(row.sort_order),
      isPublished: booleanValue(row.is_published),
    })),
    testimonials: testimonialResult.rows.map((row) => ({
      id: String(row.id),
      clientName: String(row.client_name),
      companyName: String(row.company_name ?? ""),
      review: String(row.review),
      isVisible: booleanValue(row.is_visible),
      sortOrder: numberValue(row.sort_order),
    })),
    pages: pageResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      slug: String(row.slug),
      excerpt: String(row.excerpt ?? ""),
      content: String(row.content),
      isPublished: booleanValue(row.is_published),
      sortOrder: numberValue(row.sort_order),
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
    slug: String(row.slug),
    excerpt: String(row.excerpt ?? ""),
    content: String(row.content),
    isPublished: true,
    sortOrder: numberValue(row.sort_order),
  } satisfies CmsPage;
}
