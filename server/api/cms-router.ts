import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requireUser, type AuthUser } from "../auth";
import { getCmsContent } from "../cms";
import { translateMany } from "../cms-translation";
import { getDatabase, rowLock } from "../db/client";
import { deleteProjectFile, readProjectFile, storeProjectFile } from "../storage";
import {
  ApiError,
  assertSameOrigin,
  created,
  jsonBody,
  noContent,
  ok,
} from "./errors";
import { dispatchLeadApi } from "./lead-router";
import {
  dispatchProspectApi,
  dispatchProspectTemplateApi,
} from "./prospect-router";
import { dispatchMailLoginApi } from "./mail-login-router";

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
  motion_enabled: z.enum(["true", "false"]),
  partner_carousel_speed: z.string().trim().regex(/^(1[2-9]|[2-5]\d|60)$/, "Durasi carousel harus antara 12 dan 60 detik."),
  cta_text: z.string().trim().min(1).max(180),
  business_hours: z.string().trim().min(1).max(180),
  seo_title: z.string().trim().min(10).max(70),
  seo_description: z.string().trim().min(30).max(180),
  og_title: z.string().trim().min(10).max(100),
  og_description: z.string().trim().min(30).max(240),
  business_legal_name: z.string().trim().min(2).max(180),
  business_area: z.string().trim().min(2).max(300),
  business_country: z.string().trim().length(2),
  postal_code: z.string().trim().max(12),
}).partial().strict();

const serviceSchema = z.object({
  slug: z.string().trim().min(2).max(100).optional(),
  title: shortText,
  titleEn: z.string().trim().max(180).optional().default(""),
  summary: z.string().trim().min(4).max(400),
  summaryEn: z.string().trim().max(400).optional().default(""),
  description: longText,
  descriptionEn: z.string().trim().max(8_000).optional().default(""),
  features: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  featuresEn: z.array(z.string().trim().max(160)).max(12).default([]),
  icon: z.enum(["wifi", "cctv", "camera", "phone", "network", "shield", "home", "terminal"]).default("network"),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isPublished: z.boolean().default(true),
});

const testimonialSchema = z.object({
  clientName: shortText,
  companyName: z.string().trim().max(180).optional().default(""),
  review: z.string().trim().min(8).max(2_000),
  reviewEn: z.string().trim().max(2_000).optional().default(""),
  isVisible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const pageSchema = z.object({
  title: shortText,
  titleEn: z.string().trim().max(180).optional().default(""),
  slug: z.string().trim().min(2).max(120).optional(),
  excerpt: optionalText,
  excerptEn: optionalText,
  content: longText,
  contentEn: z.string().trim().max(8_000).optional().default(""),
  isPublished: z.boolean().default(false),
  showInNavigation: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const faqSchema = z.object({
  question: shortText,
  questionEn: z.string().trim().max(180).optional().default(""),
  answer: z.string().trim().min(4).max(4_000),
  answerEn: z.string().trim().max(4_000).optional().default(""),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isVisible: z.boolean().default(true),
});

const partnerSchema = z.object({
  name: shortText,
  organizationType: z.enum(["partner", "client"]).default("partner"),
  category: z.string().trim().max(180).optional().default(""),
  websiteUrl: externalUrl,
  sortOrder: z.number().int().min(0).max(999).default(0),
  isVisible: z.boolean().default(true),
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

async function portfolioGalleryMediaResponse(request: Request, id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT media.storage_url,media.mime_type,portfolio.is_published
          FROM cms_portfolio_media media
          INNER JOIN cms_portfolios portfolio ON portfolio.id=media.portfolio_id
          WHERE media.id=? LIMIT 1`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row?.storage_url) throw new ApiError(404, "NOT_FOUND", "Gambar galeri tidak ditemukan.");
  if (!row.is_published) await admin(request);
  const file = await readProjectFile(String(row.storage_url));
  if (!file) throw new ApiError(404, "NOT_FOUND", "Gambar galeri tidak ditemukan.");
  return new Response(file.content, {
    headers: {
      "Content-Type": String(row.mime_type ?? file.contentType ?? "application/octet-stream"),
      "Cache-Control": "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Everything this endpoint is allowed to hand back as an image. An SVG is a
// document, not a picture: it carries <script>, and served as image/svg+xml
// from this origin that script runs here, next to a SameSite=Lax session
// cookie, and can call the app's own API as the logged-in administrator.
const PARTNER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_PARTNER_LOGO_SIZE = 2 * 1024 * 1024;
const MAX_PARTNER_LOGO_DIMENSION = 4096;
const SHARP_FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function partnerMediaResponse(request: Request, id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT logo_storage_url,logo_mime_type,is_visible FROM cms_partners WHERE id=? LIMIT 1",
    args: [id],
  });
  const row = result.rows[0];
  if (!row?.logo_storage_url) throw new ApiError(404, "NOT_FOUND", "Logo tidak ditemukan.");
  if (!row.is_visible) await admin(request);
  const file = await readProjectFile(String(row.logo_storage_url));
  if (!file) throw new ApiError(404, "NOT_FOUND", "Logo tidak ditemukan.");
  const storedType = String(row.logo_mime_type ?? file.contentType ?? "");
  const displayable = (PARTNER_IMAGE_TYPES as readonly string[]).includes(storedType);
  // New uploads are rasterised, so `displayable` is true for everything stored
  // from here on. Rows written before that — an SVG partner logo that arrived
  // by email and was uploaded as received — must never execute: they leave as
  // an opaque download inside a CSP that permits nothing at all.
  return new Response(file.content, {
    headers: displayable
      ? {
          "Content-Type": storedType,
          "Cache-Control": "public, max-age=300, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        }
      : {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="partner-logo-${id}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
  });
}

/**
 * Turns whatever an administrator uploaded into bytes this system is willing to
 * serve back as an image.
 *
 * The declared multipart content type is caller input and is never believed on
 * its own — sharp reads the actual bytes and the two have to agree. An SVG is
 * accepted for convenience (partner logos genuinely arrive that way) but never
 * stored: it is rasterised to PNG, which drops any script, external reference
 * or embedded entity along with it.
 */
async function preparePartnerLogo(file: File) {
  if (file.size > MAX_PARTNER_LOGO_SIZE) {
    throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran logo maksimal 2 MB.");
  }
  const declared = file.type;
  if (!["image/svg+xml", ...PARTNER_IMAGE_TYPES].includes(declared)) {
    throw new ApiError(415, "UNSUPPORTED_FILE", "Gunakan logo SVG, PNG, JPG, atau WebP.");
  }
  const source = Buffer.from(await file.arrayBuffer());
  let metadata;
  try {
    metadata = await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_PARTNER_LOGO_DIMENSION * MAX_PARTNER_LOGO_DIMENSION,
    }).metadata();
  } catch {
    throw new ApiError(415, "INVALID_IMAGE", "Isi file bukan gambar yang valid.");
  }
  const detected = metadata.format ?? "";
  if (
    metadata.width &&
    metadata.height &&
    (metadata.width > MAX_PARTNER_LOGO_DIMENSION || metadata.height > MAX_PARTNER_LOGO_DIMENSION)
  ) {
    throw new ApiError(422, "IMAGE_DIMENSIONS", "Dimensi logo maksimal 4096 × 4096 piksel.");
  }
  if (declared === "image/svg+xml" || detected === "svg") {
    // A raster type over SVG bytes, or an SVG type over anything else: the two
    // have to agree before the file is stored under a type this app will later
    // hand back to a browser.
    if (detected !== "svg" || declared !== "image/svg+xml") {
      throw new ApiError(415, "IMAGE_TYPE_MISMATCH", "Tipe file tidak sesuai dengan isi gambarnya.");
    }
    try {
      const raster = await sharp(source, { failOn: "error", density: 192 })
        .resize({ width: 1200, height: 600, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return { content: raster, mimeType: "image/png" };
    } catch {
      throw new ApiError(422, "IMAGE_PROCESSING_FAILED", "Logo SVG tidak dapat diproses menjadi gambar.");
    }
  }
  if (SHARP_FORMAT_MIME[detected] !== declared) {
    throw new ApiError(415, "IMAGE_TYPE_MISMATCH", "Tipe file tidak sesuai dengan isi gambarnya.");
  }
  return { content: source, mimeType: declared };
}

const PORTFOLIO_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_PORTFOLIO_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_PORTFOLIO_IMAGE_DIMENSION = 4096;

/**
 * Same rule as `preparePartnerLogo`, applied to portfolio photographs: the
 * declared multipart type is caller input, so sharp reads the bytes and the two
 * have to agree before anything is stored under a type this app will later hand
 * back to a browser.
 *
 * The whitelist here is raster-only and the media route already answers with
 * `nosniff`, so nothing executes today even without the check. That is the
 * reason this was a gap rather than a hole — and exactly why it should be
 * closed while it is still cheap: the stored mime type is what the response
 * Content-Type is built from, and the next person to widen this list (SVG for
 * a client logo, PDF for a case study) would inherit a route that trusts the
 * uploader about what the bytes are.
 */
async function preparePortfolioImage(file: File) {
  if (file.size > MAX_PORTFOLIO_IMAGE_SIZE) {
    throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran gambar maksimal 5 MB.");
  }
  const declared = file.type;
  if (!(PORTFOLIO_IMAGE_TYPES as readonly string[]).includes(declared)) {
    throw new ApiError(415, "UNSUPPORTED_FILE", "Gunakan gambar JPG, PNG, atau WebP.");
  }
  const source = Buffer.from(await file.arrayBuffer());
  let metadata;
  try {
    metadata = await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_PORTFOLIO_IMAGE_DIMENSION * MAX_PORTFOLIO_IMAGE_DIMENSION,
    }).metadata();
  } catch {
    throw new ApiError(415, "INVALID_IMAGE", "Isi file bukan gambar yang valid.");
  }
  if (
    metadata.width &&
    metadata.height &&
    (metadata.width > MAX_PORTFOLIO_IMAGE_DIMENSION ||
      metadata.height > MAX_PORTFOLIO_IMAGE_DIMENSION)
  ) {
    throw new ApiError(422, "IMAGE_DIMENSIONS", "Dimensi gambar maksimal 4096 × 4096 piksel.");
  }
  if (SHARP_FORMAT_MIME[metadata.format ?? ""] !== declared) {
    throw new ApiError(415, "IMAGE_TYPE_MISMATCH", "Tipe file tidak sesuai dengan isi gambarnya.");
  }
  return { content: source, mimeType: declared };
}

async function updateTexts(request: Request, user: AuthUser) {
  const input = z.object({
    items: z.array(z.object({
      pageKey: z.string().trim().min(1).max(80),
      contentKey: z.string().trim().min(1).max(100),
      value: z.string().trim().max(8_000),
      valueEn: z.string().trim().max(8_000).optional().default(""),
    })).min(1).max(100),
  }).parse(await jsonBody(request));
  const { client } = await getDatabase();
  const timestamp = new Date().toISOString();
  await client.batch(input.items.map((item) => ({
    sql: `INSERT INTO cms_site_texts (id,page_key,content_key,value_content,value_content_en,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (page_key,content_key) DO UPDATE SET
      value_content=excluded.value_content,value_content_en=excluded.value_content_en,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    args: [randomUUID(), item.pageKey, item.contentKey, item.value, item.valueEn, user.id, timestamp],
  })), "write");
  await writeAuditLog(client, request, user, "update", "cms_site_texts", undefined, {
    keys: input.items.map((item) => `${item.pageKey}.${item.contentKey}`),
  });
  return ok({ success: true });
}

async function updateSettings(request: Request, user: AuthUser) {
  const input = z.object({
    settings: siteSettingsSchema,
    settingsEn: siteSettingsSchema.omit({
      whatsapp_number: true,
      email: true,
      phone: true,
      instagram_url: true,
      linkedin_url: true,
      website_url: true,
      dark_font_color: true,
      motion_enabled: true,
      partner_carousel_speed: true,
      business_country: true,
      postal_code: true,
    }).partial().optional().default({}),
  }).parse(await jsonBody(request));
  const { client } = await getDatabase();
  const timestamp = new Date().toISOString();
  await client.batch(Object.entries(input.settings).map(([key, value]) => ({
    sql: `INSERT INTO cms_site_settings (id,key_name,value_content,value_content_en,updated_by,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT (key_name) DO UPDATE SET
      value_content=excluded.value_content,
      value_content_en=COALESCE(NULLIF(excluded.value_content_en,''),cms_site_settings.value_content_en),
      updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    args: [randomUUID(), key, value, input.settingsEn[key as keyof typeof input.settingsEn] ?? "", user.id, timestamp],
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
      sql: `INSERT INTO cms_services
        (id,slug,title,title_en,summary,summary_en,description,description_en,features_json,features_json_en,icon,sort_order,is_published,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [serviceId, slug, input.title, input.titleEn, input.summary, input.summaryEn, input.description, input.descriptionEn, JSON.stringify(input.features), JSON.stringify(input.featuresEn), input.icon, input.sortOrder, input.isPublished ? 1 : 0, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_service", serviceId, input);
    return created({ id: serviceId });
  }
  if (id && request.method === "PATCH") {
    const input = serviceSchema.parse(await jsonBody(request));
    const slug = slugify(input.slug || input.title);
    await client.execute({
      sql: "UPDATE cms_services SET slug=?,title=?,title_en=?,summary=?,summary_en=?,description=?,description_en=?,features_json=?,features_json_en=?,icon=?,sort_order=?,is_published=?,updated_at=? WHERE id=?",
      args: [slug, input.title, input.titleEn, input.summary, input.summaryEn, input.description, input.descriptionEn, JSON.stringify(input.features), JSON.stringify(input.featuresEn), input.icon, input.sortOrder, input.isPublished ? 1 : 0, new Date().toISOString(), id],
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
    titleEn: z.string().trim().max(180).parse(form.get("titleEn") ?? ""),
    description: z.string().trim().min(4).max(3_000).parse(form.get("description")),
    descriptionEn: z.string().trim().max(3_000).parse(form.get("descriptionEn") ?? ""),
    location: z.string().trim().max(180).parse(form.get("location") ?? ""),
    locationEn: z.string().trim().max(180).parse(form.get("locationEn") ?? ""),
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
      const image = await preparePortfolioImage(file);
      const stored = await storeProjectFile(
        `cms-${portfolioId}`,
        image.mimeType,
        image.content.buffer.slice(
          image.content.byteOffset,
          image.content.byteOffset + image.content.byteLength,
        ) as ArrayBuffer,
      );
      storageUrl = stored.storageUrl;
      mimeType = image.mimeType;
    }
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO cms_portfolios (id,title,title_en,description,description_en,image_url,image_storage_url,image_mime_type,location,location_en,completed_at,sort_order,is_published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [portfolioId, input.title, input.titleEn, input.description, input.descriptionEn, "", storageUrl, mimeType, input.location, input.locationEn, input.completedAt || null, input.sortOrder, input.isPublished ? 1 : 0, timestamp, timestamp],
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
      const image = await preparePortfolioImage(file);
      if (storageUrl) await deleteProjectFile(storageUrl);
      const stored = await storeProjectFile(
        `cms-${randomUUID()}`,
        image.mimeType,
        image.content.buffer.slice(
          image.content.byteOffset,
          image.content.byteOffset + image.content.byteLength,
        ) as ArrayBuffer,
      );
      storageUrl = stored.storageUrl;
      mimeType = image.mimeType;
      imageUrl = "";
    }
    await client.execute({
      sql: "UPDATE cms_portfolios SET title=?,title_en=?,description=?,description_en=?,image_url=?,image_storage_url=?,image_mime_type=?,location=?,location_en=?,completed_at=?,sort_order=?,is_published=?,updated_at=? WHERE id=?",
      args: [input.title, input.titleEn, input.description, input.descriptionEn, imageUrl, storageUrl, mimeType, input.location, input.locationEn, input.completedAt || null, input.sortOrder, input.isPublished ? 1 : 0, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_portfolio", id, { title: input.title });
    return ok({ id });
  }
  if (id && request.method === "DELETE") {
    const [current, gallery] = await Promise.all([
      client.execute({ sql: "SELECT image_storage_url FROM cms_portfolios WHERE id=? LIMIT 1", args: [id] }),
      client.execute({ sql: "SELECT storage_url FROM cms_portfolio_media WHERE portfolio_id=?", args: [id] }),
    ]);
    const storageUrl = current.rows[0]?.image_storage_url;
    if (storageUrl) await deleteProjectFile(String(storageUrl));
    await Promise.all(gallery.rows.map((item) => deleteProjectFile(String(item.storage_url))));
    await client.execute({ sql: "DELETE FROM cms_portfolios WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_portfolio", id);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi portofolio tidak didukung.");
}

const galleryMoveSchema = z.object({ direction: z.enum(["up", "down"]) });
const MAX_PORTFOLIO_GALLERY_IMAGES = 20;

async function handlePortfolioGallery(
  request: Request,
  portfolioId: string,
  mediaId: string | undefined,
  user: AuthUser,
) {
  const { client } = await getDatabase();

  if (request.method === "POST" && !mediaId) {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Pilih satu gambar untuk galeri.");
    }
    const image = await preparePortfolioImage(file);
    const galleryId = randomUUID();
    let storageUrl: string | null = null;
    try {
      await client.transaction(async (transaction) => {
        const portfolio = await transaction.execute({
          sql: `SELECT id FROM cms_portfolios WHERE id=?${rowLock(transaction)}`,
          args: [portfolioId],
        });
        if (!portfolio.rows[0]) throw new ApiError(404, "NOT_FOUND", "Portofolio tidak ditemukan.");
        const media = await transaction.execute({
          sql: "SELECT id FROM cms_portfolio_media WHERE portfolio_id=? ORDER BY sort_order,created_at",
          args: [portfolioId],
        });
        if (media.rows.length >= MAX_PORTFOLIO_GALLERY_IMAGES) {
          throw new ApiError(422, "GALLERY_LIMIT", `Maksimal ${MAX_PORTFOLIO_GALLERY_IMAGES} foto tambahan per portofolio.`);
        }
        const stored = await storeProjectFile(
          `cms-portfolio-gallery-${galleryId}`,
          image.mimeType,
          image.content.buffer.slice(
            image.content.byteOffset,
            image.content.byteOffset + image.content.byteLength,
          ) as ArrayBuffer,
        );
        storageUrl = stored.storageUrl;
        const timestamp = new Date().toISOString();
        await transaction.execute({
          sql: "INSERT INTO cms_portfolio_media (id,portfolio_id,storage_url,mime_type,sort_order,created_at) VALUES (?,?,?,?,?,?)",
          args: [galleryId, portfolioId, stored.storageUrl, image.mimeType, media.rows.length, timestamp],
        });
        await transaction.execute({
          sql: "UPDATE cms_portfolios SET updated_at=? WHERE id=?",
          args: [timestamp, portfolioId],
        });
      });
    } catch (error) {
      if (storageUrl) await deleteProjectFile(storageUrl).catch(() => undefined);
      throw error;
    }
    await writeAuditLog(client, request, user, "create", "cms_portfolio_media", galleryId, { portfolioId });
    return created({ id: galleryId });
  }

  if (request.method === "PATCH" && mediaId) {
    const { direction } = galleryMoveSchema.parse(await jsonBody(request));
    let moved = false;
    await client.transaction(async (transaction) => {
      const portfolio = await transaction.execute({
        sql: `SELECT id FROM cms_portfolios WHERE id=?${rowLock(transaction)}`,
        args: [portfolioId],
      });
      if (!portfolio.rows[0]) throw new ApiError(404, "NOT_FOUND", "Portofolio tidak ditemukan.");
      const media = await transaction.execute({
        sql: "SELECT id,sort_order FROM cms_portfolio_media WHERE portfolio_id=? ORDER BY sort_order,created_at",
        args: [portfolioId],
      });
      const index = media.rows.findIndex((item) => String(item.id) === mediaId);
      if (index < 0) throw new ApiError(404, "NOT_FOUND", "Gambar galeri tidak ditemukan.");
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= media.rows.length) return;
      const current = media.rows[index];
      const target = media.rows[targetIndex];
      await transaction.batch([
        { sql: "UPDATE cms_portfolio_media SET sort_order=? WHERE id=?", args: [target.sort_order, current.id] },
        { sql: "UPDATE cms_portfolio_media SET sort_order=? WHERE id=?", args: [current.sort_order, target.id] },
        { sql: "UPDATE cms_portfolios SET updated_at=? WHERE id=?", args: [new Date().toISOString(), portfolioId] },
      ], "write");
      moved = true;
    });
    if (moved) await writeAuditLog(client, request, user, "update", "cms_portfolio_media", mediaId, { portfolioId, direction });
    return ok({ id: mediaId, moved });
  }

  if (request.method === "DELETE" && mediaId) {
    await client.transaction(async (transaction) => {
      const portfolio = await transaction.execute({
        sql: `SELECT id FROM cms_portfolios WHERE id=?${rowLock(transaction)}`,
        args: [portfolioId],
      });
      if (!portfolio.rows[0]) throw new ApiError(404, "NOT_FOUND", "Portofolio tidak ditemukan.");
      const media = await transaction.execute({
        sql: "SELECT storage_url FROM cms_portfolio_media WHERE id=? AND portfolio_id=? LIMIT 1",
        args: [mediaId, portfolioId],
      });
      const storageUrl = media.rows[0]?.storage_url;
      if (!storageUrl) throw new ApiError(404, "NOT_FOUND", "Gambar galeri tidak ditemukan.");
      await deleteProjectFile(String(storageUrl));
      await transaction.execute({ sql: "DELETE FROM cms_portfolio_media WHERE id=?", args: [mediaId] });
      await transaction.execute({ sql: "UPDATE cms_portfolios SET updated_at=? WHERE id=?", args: [new Date().toISOString(), portfolioId] });
    });
    await writeAuditLog(client, request, user, "delete", "cms_portfolio_media", mediaId, { portfolioId });
    return noContent();
  }

  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi galeri portofolio tidak didukung.");
}

async function handleTestimonials(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  const input = request.method === "DELETE" ? null : testimonialSchema.parse(await jsonBody(request));
  if (request.method === "POST" && !id && input) {
    const testimonialId = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO cms_testimonials (id,client_name,company_name,review,review_en,is_visible,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      args: [testimonialId, input.clientName, input.companyName, input.review, input.reviewEn, input.isVisible ? 1 : 0, input.sortOrder, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_testimonial", testimonialId, input);
    return created({ id: testimonialId });
  }
  if (id && request.method === "PATCH" && input) {
    await client.execute({
      sql: "UPDATE cms_testimonials SET client_name=?,company_name=?,review=?,review_en=?,is_visible=?,sort_order=?,updated_at=? WHERE id=?",
      args: [input.clientName, input.companyName, input.review, input.reviewEn, input.isVisible ? 1 : 0, input.sortOrder, new Date().toISOString(), id],
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
      sql: "INSERT INTO cms_pages (id,title,title_en,slug,excerpt,excerpt_en,content,content_en,is_published,show_in_navigation,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [pageId, input.title, input.titleEn, slug, input.excerpt, input.excerptEn, input.content, input.contentEn, input.isPublished ? 1 : 0, input.showInNavigation ? 1 : 0, input.sortOrder, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_page", pageId, input);
    return created({ id: pageId });
  }
  if (id && request.method === "PATCH" && input) {
    const slug = slugify(input.slug || input.title);
    await client.execute({
      sql: "UPDATE cms_pages SET title=?,title_en=?,slug=?,excerpt=?,excerpt_en=?,content=?,content_en=?,is_published=?,show_in_navigation=?,sort_order=?,updated_at=? WHERE id=?",
      args: [input.title, input.titleEn, slug, input.excerpt, input.excerptEn, input.content, input.contentEn, input.isPublished ? 1 : 0, input.showInNavigation ? 1 : 0, input.sortOrder, new Date().toISOString(), id],
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

async function handleFaqs(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  const input = request.method === "DELETE" ? null : faqSchema.parse(await jsonBody(request));
  if (request.method === "POST" && !id && input) {
    const faqId = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO cms_faqs (id,question,question_en,answer,answer_en,sort_order,is_visible,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      args: [faqId, input.question, input.questionEn, input.answer, input.answerEn, input.sortOrder, input.isVisible ? 1 : 0, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_faq", faqId, input);
    return created({ id: faqId });
  }
  if (id && request.method === "PATCH" && input) {
    await client.execute({
      sql: "UPDATE cms_faqs SET question=?,question_en=?,answer=?,answer_en=?,sort_order=?,is_visible=?,updated_at=? WHERE id=?",
      args: [input.question, input.questionEn, input.answer, input.answerEn, input.sortOrder, input.isVisible ? 1 : 0, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_faq", id, input);
    return ok({ id });
  }
  if (id && request.method === "DELETE") {
    await client.execute({ sql: "DELETE FROM cms_faqs WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_faq", id);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi FAQ tidak didukung.");
}

async function partnerInput(request: Request) {
  const form = await request.formData();
  return {
    form,
    ...partnerSchema.parse({
      name: form.get("name"),
      organizationType: form.get("organizationType"),
      category: form.get("category") ?? "",
      websiteUrl: form.get("websiteUrl") ?? "",
      sortOrder: asNumber(form.get("sortOrder")),
      isVisible: asBoolean(form.get("isVisible")),
    }),
  };
}

async function handlePartners(request: Request, id: string | undefined, user: AuthUser) {
  const { client } = await getDatabase();
  if (request.method === "DELETE" && id) {
    const current = await client.execute({ sql: "SELECT logo_storage_url FROM cms_partners WHERE id=? LIMIT 1", args: [id] });
    if (current.rows[0]?.logo_storage_url) await deleteProjectFile(String(current.rows[0].logo_storage_url));
    await client.execute({ sql: "DELETE FROM cms_partners WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "cms_partner", id);
    return noContent();
  }
  const input = await partnerInput(request);
  const file = input.form.get("logo");
  const logo =
    file instanceof File && file.size > 0 ? await preparePartnerLogo(file) : null;

  if (request.method === "POST" && !id) {
    const partnerId = randomUUID();
    let storageUrl: string | null = null;
    let mimeType: string | null = null;
    if (logo) {
      const stored = await storeProjectFile(
        `cms-partner-${partnerId}`,
        logo.mimeType,
        logo.content.buffer.slice(
          logo.content.byteOffset,
          logo.content.byteOffset + logo.content.byteLength,
        ) as ArrayBuffer,
      );
      storageUrl = stored.storageUrl;
      mimeType = logo.mimeType;
    }
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO cms_partners (id,name,organization_type,category,website_url,logo_url,logo_storage_url,logo_mime_type,sort_order,is_visible,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [partnerId, input.name, input.organizationType, input.category, input.websiteUrl, "", storageUrl, mimeType, input.sortOrder, input.isVisible ? 1 : 0, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "cms_partner", partnerId, { name: input.name });
    return created({ id: partnerId });
  }

  if (request.method === "PATCH" && id) {
    const current = await client.execute({
      sql: "SELECT logo_storage_url,logo_mime_type,logo_url FROM cms_partners WHERE id=? LIMIT 1",
      args: [id],
    });
    if (!current.rows[0]) throw new ApiError(404, "NOT_FOUND", "Partner atau klien tidak ditemukan.");
    let storageUrl = current.rows[0].logo_storage_url ? String(current.rows[0].logo_storage_url) : null;
    let mimeType = current.rows[0].logo_mime_type ? String(current.rows[0].logo_mime_type) : null;
    let logoUrl = String(current.rows[0].logo_url ?? "");
    if (logo) {
      if (storageUrl) await deleteProjectFile(storageUrl);
      const stored = await storeProjectFile(
        `cms-partner-${randomUUID()}`,
        logo.mimeType,
        logo.content.buffer.slice(
          logo.content.byteOffset,
          logo.content.byteOffset + logo.content.byteLength,
        ) as ArrayBuffer,
      );
      storageUrl = stored.storageUrl;
      mimeType = logo.mimeType;
      logoUrl = "";
    }
    await client.execute({
      sql: "UPDATE cms_partners SET name=?,organization_type=?,category=?,website_url=?,logo_url=?,logo_storage_url=?,logo_mime_type=?,sort_order=?,is_visible=?,updated_at=? WHERE id=?",
      args: [input.name, input.organizationType, input.category, input.websiteUrl, logoUrl, storageUrl, mimeType, input.sortOrder, input.isVisible ? 1 : 0, new Date().toISOString(), id],
    });
    await writeAuditLog(client, request, user, "update", "cms_partner", id, { name: input.name });
    return ok({ id });
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi partner atau klien tidak didukung.");
}

async function handleTranslation(request: Request) {
  const input = z.object({
    texts: z.array(z.string().max(8_000)).min(1).max(20),
  }).parse(await jsonBody(request));
  try {
    return ok({ translations: await translateMany(input.texts) });
  } catch {
    throw new ApiError(502, "TRANSLATION_UNAVAILABLE", "Terjemahan otomatis sedang tidak tersedia. Coba lagi atau isi konten Inggris secara manual.");
  }
}

export async function dispatchCmsApi(request: Request, path: string[]) {
  assertSameOrigin(request);
  const resource = path[0];
  const id = path[1];

  if (resource === "media" && id && request.method === "GET") return mediaResponse(request, id);
  if (resource === "portfolio-gallery-media" && id && request.method === "GET") return portfolioGalleryMediaResponse(request, id);
  if (resource === "partner-media" && id && request.method === "GET") return partnerMediaResponse(request, id);
  if (resource === "leads") return dispatchLeadApi(request, path);
  if (resource === "prospects") return dispatchProspectApi(request, path);
  if (resource === "prospect-templates") {
    return dispatchProspectTemplateApi(request, path);
  }

  const user = await admin(request);
  if (resource === "mail-login") return dispatchMailLoginApi(request, path, user);
  if (resource === "bootstrap" && request.method === "GET") {
    return ok({ content: await getCmsContent(true), user }, 200, { "Cache-Control": "no-store" });
  }
  if (resource === "texts" && request.method === "PUT") return updateTexts(request, user);
  if (resource === "settings" && request.method === "PUT") return updateSettings(request, user);
  if (resource === "services") return handleServices(request, id, user);
  if (resource === "portfolios" && id && path[2] === "gallery") return handlePortfolioGallery(request, id, path[3], user);
  if (resource === "portfolios") return handlePortfolios(request, id, user);
  if (resource === "testimonials") return handleTestimonials(request, id, user);
  if (resource === "pages") return handlePages(request, id, user);
  if (resource === "faqs") return handleFaqs(request, id, user);
  if (resource === "partners") return handlePartners(request, id, user);
  if (resource === "translate" && request.method === "POST") return handleTranslation(request);

  throw new ApiError(404, "NOT_FOUND", "Endpoint CMS tidak ditemukan.");
}
