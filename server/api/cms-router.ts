import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requireUser, type AuthUser } from "../auth";
import { getCmsContent } from "../cms";
import { getDatabase } from "../db/client";
import { deleteProjectFile, readProjectFile, storeProjectFile } from "../storage";
import {
  ApiError,
  assertSameOrigin,
  created,
  jsonBody,
  noContent,
  ok,
} from "./errors";

const shortText = z.string().trim().min(1).max(180);
const longText = z.string().trim().min(1).max(8_000);
const optionalText = z.string().trim().max(1_000).optional().default("");
const externalUrl = z.string().trim().max(500).refine((value) => {
  if (!value) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "URL harus menggunakan http atau https.");

const siteSettingsSchema = z.object({
  company_name: z.string().trim().min(1).max(180),
  company_tagline: z.string().trim().min(1).max(300),
  whatsapp_number: z.string().trim().regex(/^(?:0|62)\d{9,14}$/, "Nomor WhatsApp belum valid."),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(50),
  address: z.string().trim().min(4).max(1_000),
  instagram_url: externalUrl,
  linkedin_url: externalUrl,
  website_url: externalUrl,
  dark_font_color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Warna teks harus menggunakan format HEX, misalnya #FFFFFF."),
  footer_copyright: z.string().trim().min(1).max(240),
  cta_text: z.string().trim().min(1).max(180),
  business_hours: z.string().trim().min(1).max(180),
}).partial().strict();

const serviceSchema = z.object({
  slug: z.string().trim().min(2).max(100).optional(),
  title: shortText,
  summary: z.string().trim().min(4).max(400),
  description: longText,
  features: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  icon: z.enum(["wifi", "camera", "phone", "network", "shield", "home"]).default("network"),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isPublished: z.boolean().default(true),
});

const testimonialSchema = z.object({
  clientName: shortText,
  companyName: z.string().trim().max(180).optional().default(""),
  review: z.string().trim().min(8).max(2_000),
  isVisible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const pageSchema = z.object({
  title: shortText,
  slug: z.string().trim().min(2).max(120).optional(),
  excerpt: optionalText,
  content: longText,
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function asBoolean(value: FormDataEntryValue | null, fallback = true) {
  if (value === null) return fallback;
  return ["1", "true", "on", "yes"].includes(String(value).toLowerCase());
}

function asNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(999, Math.trunc(parsed))) : fallback;
}

async function admin(request: Request) {
  return requireUser(request, ["Admin"]);
}

async function mediaResponse(request: Request, id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT image_storage_url,image_mime_type,is_published FROM cms_portfolios WHERE id=? LIMIT 1",
    args: [id],
  });
  const row = result.rows[0];
  if (!row?.image_storage_url) throw new ApiError(404, "NOT_FOUND", "Gambar tidak ditemukan.");
  if (!row.is_published) await admin(request);
  const file = await readProjectFile(String(row.image_storage_url));
  if (!file) throw new ApiError(404, "NOT_FOUND", "Gambar tidak ditemukan.");
  return new Response(file.content, {
    headers: {
      "Content-Type": String(row.image_mime_type ?? file.contentType ?? "application/octet-stream"),
      "Cache-Control": "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function updateTexts(request: Request, user: AuthUser) {
  const input = z.object({
    items: z.array(z.object({
      pageKey: z.string().trim().min(1).max(80),
      contentKey: z.string().trim().min(1).max(100),
      value: z.string().trim().max(8_000),
    })).min(1).max(100),
  }).parse(await jsonBody(request));
  const { client } = await getDatabase();
  const timestamp = new Date().toISOString();
  await client.batch(input.items.map((item) => ({
    sql: `INSERT INTO cms_site_texts (id,page_key,content_key,value_content,updated_by,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT (page_key,content_key) DO UPDATE SET
      value_content=excluded.value_content,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    args: [randomUUID(), item.pageKey, item.contentKey, item.value, user.id, timestamp],
  })), "write");
  await writeAuditLog(client, request, user, "update", "cms_site_texts", undefined, {
    keys: input.items.map((item) => `${item.pageKey}.${item.contentKey}`),
  });
  return ok({ success: true });
}

async function updateSettings(request: Request, user: AuthUser) {
  const input = z.object({
    settings: siteSettingsSchema,
  }).parse(await jsonBody(request));
  const { client } = await getDatabase();
  const timestamp = new Date().toISOString();
  await client.batch(Object.entries(input.settings).map(([key, value]) => ({
    sql: `INSERT INTO cms_site_settings (id,key_name,value_content,updated_by,updated_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT (key_name) DO UPDATE SET
      value_content=excluded.value_content,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    args: [randomUUID(), key, value, user.id, timestamp],
  })), "write");
  await writeAuditLog(client, request, user, "update", "cms_site_settings", undefined, {
    keys: Object.keys(input.settings),
  });
  return ok({ success: true });
}

async function handleServices(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  if (request.method === "POST" && !id) {
    const input = serviceSchema.parse(await jsonBody(request));
    const serviceId = randomUUID();
    const timestamp = new Date().toISOString();
    const slug = slugify(input.slug || input.title);
    if (!slug) throw new ApiError(422, "INVALID_SLUG", "Slug layanan belum valid.");
    await client.execute({
      sql: "INSERT INTO cms_services (id,slug,title,summary,description,features_json,icon,sort_order,is_published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args: [serviceId, slug, input.title, input.summary, input.description, JSON.stringify(input.features), input.icon, input.sortOrder, input.isPublished ? 1 : 0, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_service", serviceId, input);
    return created({ id: serviceId });
  }
  if (id && request.method === "PATCH") {
    const input = serviceSchema.parse(await jsonBody(request));
    const slug = slugify(input.slug || input.title);
    await client.execute({
      sql: "UPDATE cms_services SET slug=?,title=?,summary=?,description=?,features_json=?,icon=?,sort_order=?,is_published=?,updated_at=? WHERE id=?",
      args: [slug, input.title, input.summary, input.description, JSON.stringify(input.features), input.icon, input.sortOrder, input.isPublished ? 1 : 0, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_service", id, input);
    return ok({ id });
  }
  if (id && request.method === "DELETE") {
    await client.execute({ sql: "DELETE FROM cms_services WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_service", id);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi layanan tidak didukung.");
}

async function portfolioInput(request: Request) {
  const form = await request.formData();
  return {
    form,
    title: shortText.parse(form.get("title")),
    description: z.string().trim().min(4).max(3_000).parse(form.get("description")),
    location: z.string().trim().max(180).parse(form.get("location") ?? ""),
    completedAt: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).parse(form.get("completedAt") ?? ""),
    sortOrder: asNumber(form.get("sortOrder")),
    isPublished: asBoolean(form.get("isPublished")),
  };
}

async function handlePortfolios(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  if (request.method === "POST" && !id) {
    const input = await portfolioInput(request);
    const portfolioId = randomUUID();
    const file = input.form.get("image");
    let storageUrl: string | null = null;
    let mimeType: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran gambar maksimal 5 MB.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(415, "UNSUPPORTED_FILE", "Gunakan gambar JPG, PNG, atau WebP.");
      const stored = await storeProjectFile(`cms-${portfolioId}`, file.type, await file.arrayBuffer());
      storageUrl = stored.storageUrl;
      mimeType = file.type;
    }
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO cms_portfolios (id,title,description,image_url,image_storage_url,image_mime_type,location,completed_at,sort_order,is_published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [portfolioId, input.title, input.description, "", storageUrl, mimeType, input.location, input.completedAt || null, input.sortOrder, input.isPublished ? 1 : 0, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_portfolio", portfolioId, { title: input.title });
    return created({ id: portfolioId });
  }
  if (id && request.method === "PATCH") {
    const input = await portfolioInput(request);
    const current = await client.execute({
      sql: "SELECT image_storage_url,image_mime_type,image_url FROM cms_portfolios WHERE id=? LIMIT 1",
      args: [id],
    });
    if (!current.rows[0]) throw new ApiError(404, "NOT_FOUND", "Portofolio tidak ditemukan.");
    let storageUrl = current.rows[0].image_storage_url ? String(current.rows[0].image_storage_url) : null;
    let mimeType = current.rows[0].image_mime_type ? String(current.rows[0].image_mime_type) : null;
    let imageUrl = String(current.rows[0].image_url ?? "");
    const file = input.form.get("image");
    if (file instanceof File && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran gambar maksimal 5 MB.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(415, "UNSUPPORTED_FILE", "Gunakan gambar JPG, PNG, atau WebP.");
      if (storageUrl) await deleteProjectFile(storageUrl);
      const stored = await storeProjectFile(`cms-${randomUUID()}`, file.type, await file.arrayBuffer());
      storageUrl = stored.storageUrl;
      mimeType = file.type;
      imageUrl = "";
    }
    await client.execute({
      sql: "UPDATE cms_portfolios SET title=?,description=?,image_url=?,image_storage_url=?,image_mime_type=?,location=?,completed_at=?,sort_order=?,is_published=?,updated_at=? WHERE id=?",
      args: [input.title, input.description, imageUrl, storageUrl, mimeType, input.location, input.completedAt || null, input.sortOrder, input.isPublished ? 1 : 0, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_portfolio", id, { title: input.title });
    return ok({ id });
  }
  if (id && request.method === "DELETE") {
    const current = await client.execute({ sql: "SELECT image_storage_url FROM cms_portfolios WHERE id=? LIMIT 1", args: [id] });
    const storageUrl = current.rows[0]?.image_storage_url;
    if (storageUrl) await deleteProjectFile(String(storageUrl));
    await client.execute({ sql: "DELETE FROM cms_portfolios WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_portfolio", id);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi portofolio tidak didukung.");
}

async function handleTestimonials(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  const input = request.method === "DELETE" ? null : testimonialSchema.parse(await jsonBody(request));
  if (request.method === "POST" && !id && input) {
    const testimonialId = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO cms_testimonials (id,client_name,company_name,review,is_visible,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      args: [testimonialId, input.clientName, input.companyName, input.review, input.isVisible ? 1 : 0, input.sortOrder, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_testimonial", testimonialId, input);
    return created({ id: testimonialId });
  }
  if (id && request.method === "PATCH" && input) {
    await client.execute({
      sql: "UPDATE cms_testimonials SET client_name=?,company_name=?,review=?,is_visible=?,sort_order=?,updated_at=? WHERE id=?",
      args: [input.clientName, input.companyName, input.review, input.isVisible ? 1 : 0, input.sortOrder, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_testimonial", id, input);
    return ok({ id });
  }
  if (id && request.method === "DELETE") {
    await client.execute({ sql: "DELETE FROM cms_testimonials WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_testimonial", id);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi testimoni tidak didukung.");
}

async function handlePages(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  const input = request.method === "DELETE" ? null : pageSchema.parse(await jsonBody(request));
  if (request.method === "POST" && !id && input) {
    const pageId = randomUUID();
    const timestamp = new Date().toISOString();
    const slug = slugify(input.slug || input.title);
    if (!slug) throw new ApiError(422, "INVALID_SLUG", "Slug halaman belum valid.");
    await client.execute({
      sql: "INSERT INTO cms_pages (id,title,slug,excerpt,content,is_published,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      args: [pageId, input.title, slug, input.excerpt, input.content, input.isPublished ? 1 : 0, input.sortOrder, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_page", pageId, input);
    return created({ id: pageId });
  }
  if (id && request.method === "PATCH" && input) {
    const slug = slugify(input.slug || input.title);
    await client.execute({
      sql: "UPDATE cms_pages SET title=?,slug=?,excerpt=?,content=?,is_published=?,sort_order=?,updated_at=? WHERE id=?",
      args: [input.title, slug, input.excerpt, input.content, input.isPublished ? 1 : 0, input.sortOrder, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_page", id, input);
    return ok({ id });
  }
  if (id && request.method === "DELETE") {
    await client.execute({ sql: "DELETE FROM cms_pages WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_page", id);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi halaman tidak didukung.");
}

export async function dispatchCmsApi(request: Request, path: string[]) {
  assertSameOrigin(request);
  const resource = path[0];
  const id = path[1];

  if (resource === "media" && id && request.method === "GET") return mediaResponse(request, id);

  const user = await admin(request);
  if (resource === "bootstrap" && request.method === "GET") {
    return ok({ content: await getCmsContent(true), user }, 200, { "Cache-Control": "no-store" });
  }
  if (resource === "texts" && request.method === "PUT") return updateTexts(request, user);
  if (resource === "settings" && request.method === "PUT") return updateSettings(request, user);
  if (resource === "services") return handleServices(request, id, user);
  if (resource === "portfolios") return handlePortfolios(request, id, user);
  if (resource === "testimonials") return handleTestimonials(request, id, user);
  if (resource === "pages") return handlePages(request, id, user);

  throw new ApiError(404, "NOT_FOUND", "Endpoint CMS tidak ditemukan.");
}
