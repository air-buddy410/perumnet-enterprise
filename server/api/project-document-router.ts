import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assertMagicBytes,
  inlineDisposition,
  makeThumbnail,
  prepareUploadedImage,
  safeAttachmentFilename,
} from "../attachments";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { makassarIso, normalizeTakenAt, readExifTakenAt } from "../exif";
import { asNumber } from "../format";
import {
  deleteProjectFile,
  readProjectFile,
  storeProjectFile,
  storeUploadedFile,
} from "../storage";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";

/**
 * Foto dan berkas proyek.
 *
 * Sampai 22 Agustus 2026 ini jalur unggah paling lemah di aplikasi: satu
 * berkas per permintaan, percaya tipe yang diakui peramban, tanpa pemeriksaan
 * isi, tanpa batas jumlah, tanpa dedupe, dan tanpa thumbnail — setiap petak
 * galeri memuat foto ukuran penuh. Pemilik minta unggah banyak sekaligus
 * karena foto progres memang banyak; tanpa thumbnail, itu justru membuat
 * galeri 50 foto memuat 250 MB. Keduanya dikerjakan bersama di sini.
 *
 * Tanggal foto diambil dari EXIF kamera bila ada, kalau tidak waktu unggah —
 * selalu waktu dinding Makassar beroffset, supaya riwayat tersusun menurut
 * kapan fotonya DIAMBIL, bukan kapan seseorang sempat mengunggahnya.
 */

const MAX_FILES_PER_REQUEST = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENTS_PER_PROJECT = 500;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const PAGE_SIZE_DEFAULT = 40;

// ── Cakupan ──────────────────────────────────────────────────────────────

function hasGlobalProjectScope(user: AuthUser) {
  return user.role === "Admin" || user.role === "Finance";
}

function projectScopeCondition(user: AuthUser, projectAlias = "p") {
  if (hasGlobalProjectScope(user)) return { sql: "", args: [] as unknown[] };
  return {
    sql: `EXISTS (
      SELECT 1 FROM project_members access_pm
      WHERE access_pm.project_id = ${projectAlias}.id
        AND access_pm.user_id = ?
    )`,
    args: [user.id] as unknown[],
  };
}

async function assertProjectAccess(client: DatabaseClient, user: AuthUser, projectId: string) {
  const scope = projectScopeCondition(user, "p");
  const project = await client.execute({
    sql: `SELECT p.id FROM projects p WHERE p.id=?${scope.sql ? ` AND ${scope.sql}` : ""} LIMIT 1`,
    args: [projectId, ...scope.args],
  });
  if (!project.rows.length) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
}

function applicationPath(path: string) {
  const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const basePath =
    configuredBasePath && configuredBasePath !== "/"
      ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
      : "";
  return `${basePath}${path}`;
}

function localizedApiDate(value: unknown, language: AuthUser["preferredLanguage"]) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(date);
}

// ── Bentuk dokumen ───────────────────────────────────────────────────────
//
// Kolom disebut satu per satu: tabel ini memuat dua kolom base64 (berkas dan
// thumbnail untuk instalasi tanpa UPLOAD_DIR), dan `SELECT *` pada daftar
// 40 baris berarti puluhan megabyte berpindah untuk tidak dipakai.

const DOC_COLUMNS = `d.id,d.project_id,d.name,d.mime_type,d.size,d.storage_url,d.uploader_name,
  d.created_at,d.caption,d.taken_at,d.width,d.height,p.code AS project_code,p.name AS project_name`;

function isImage(mimeType: unknown) {
  return String(mimeType ?? "").startsWith("image/");
}

function mapDocument(row: Record<string, unknown>, language: AuthUser["preferredLanguage"]) {
  const id = String(row.id);
  const image = isImage(row.mime_type);
  const takenAt = String(row.taken_at ?? row.created_at);
  const url =
    row.storage_url && /^https?:\/\//.test(String(row.storage_url))
      ? String(row.storage_url)
      : applicationPath(`/api/documents/${id}/content`);
  return {
    id,
    projectId: String(row.project_id),
    projectCode: row.project_code ? String(row.project_code) : null,
    projectName: row.project_name ? String(row.project_name) : null,
    name: String(row.name),
    type: image ? "image" : "file",
    mimeType: String(row.mime_type),
    size: asNumber(row.size),
    caption: row.caption ? String(row.caption) : null,
    takenAt,
    createdAt: String(row.created_at),
    date: localizedApiDate(takenAt, language),
    uploader: String(row.uploader_name),
    width: row.width === null || row.width === undefined ? null : asNumber(row.width),
    height: row.height === null || row.height === undefined ? null : asNumber(row.height),
    url,
    thumbUrl: image ? applicationPath(`/api/documents/${id}/content?variant=thumb`) : null,
    // Dipertahankan untuk layar yang masih membaca `preview`.
    preview: url,
  };
}

async function loadDocument(client: DatabaseClient, id: string, projectId?: string) {
  const result = await client.execute({
    sql: `SELECT ${DOC_COLUMNS} FROM project_documents d JOIN projects p ON p.id=d.project_id
      WHERE d.id=?${projectId ? " AND d.project_id=?" : ""} LIMIT 1`,
    args: projectId ? [id, projectId] : [id],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
  return row;
}

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

// ── Unggah ───────────────────────────────────────────────────────────────

interface Skipped {
  name: string;
  code: string;
  message: string;
  details?: unknown;
}

async function simpanSatu(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  projectId: string,
  file: File,
  caption: string | null,
  batchHashes: Set<string>,
) {
  const name = safeAttachmentFilename(file.name, "berkas");
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ApiError(415, "UNSUPPORTED_FILE", "Format yang didukung: JPG, PNG, WebP, dan PDF.", { filename: name });
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran file maksimal 5 MB.", { filename: name, byteSize: file.size });
  }
  const content = await file.arrayBuffer();
  const image = isImage(file.type);
  let sha256: string;
  let width: number | null = null;
  let height: number | null = null;
  let takenAt = makassarIso();
  if (image) {
    const prepared = await prepareUploadedImage(name, file.type, content);
    sha256 = prepared.sha256;
    width = prepared.width;
    height = prepared.height;
    takenAt = readExifTakenAt(prepared.exif) ?? takenAt;
  } else {
    const buffer = Buffer.from(content);
    assertMagicBytes(buffer, file.type);
    sha256 = createHash("sha256").update(buffer).digest("hex");
  }

  // Byte yang sama dua kali di proyek yang sama adalah unggahan ulang, bukan
  // foto baru — dilewati dengan menunjuk dokumen yang sudah ada.
  if (batchHashes.has(sha256)) {
    throw new ApiError(409, "DUPLICATE", `${name} sama persis dengan berkas lain di unggahan ini.`, { filename: name });
  }
  const existing = await client.execute({
    sql: "SELECT id FROM project_documents WHERE project_id=? AND sha256=? LIMIT 1",
    args: [projectId, sha256],
  });
  if (existing.rows[0]) {
    throw new ApiError(409, "DUPLICATE", `${name} sudah ada di proyek ini.`, {
      filename: name,
      documentId: String(existing.rows[0].id),
    });
  }
  batchHashes.add(sha256);

  const id = randomUUID();
  let thumb: { storageUrl: string | null; contentBase64: string | null } = { storageUrl: null, contentBase64: null };
  if (image) {
    try {
      const thumbnail = await makeThumbnail(content);
      thumb = await storeUploadedFile("project-documents", `${id}-thumb`, "image/webp", toArrayBuffer(thumbnail));
    } catch (error) {
      // Thumbnail gagal bukan alasan menolak fotonya; galeri memakai aslinya
      // untuk baris ini, dan jalur malas mencoba lagi saat diminta.
      console.error("Thumbnail gagal dibuat", id, error);
    }
  }
  const stored = await storeProjectFile(id, file.type, content);
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO project_documents
      (id,project_id,name,mime_type,size,storage_url,content_base64,uploaded_by,uploader_name,created_at,
       caption,taken_at,sha256,width,height,thumb_storage_url,thumb_content_base64)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, projectId, name, file.type, file.size, stored.storageUrl, stored.contentBase64, user.id, user.name, timestamp,
      caption, takenAt, sha256, width, height, thumb.storageUrl, thumb.contentBase64,
    ],
  });
  await writeAuditLog(client, request, user, "upload", "project_document", id, {
    projectId,
    name,
    size: file.size,
    sha256,
    takenAt,
  });
  return mapDocument(await loadDocument(client, id), user.preferredLanguage);
}

async function uploadDocuments(request: Request, user: AuthUser, client: DatabaseClient, projectId: string) {
  const form = await request.formData();
  let files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  // Jalur lama: satu `file`. Layar yang sekarang masih memakainya dan
  // mengharapkan satu objek balik — bentuk itu dipertahankan sampai T-30.
  const legacy = files.length === 0 && form.get("file") instanceof File;
  if (legacy) files = [form.get("file") as File];
  const caption = String(form.get("caption") ?? "").trim().slice(0, 500) || null;

  if (!files.length) throw new ApiError(422, "FILE_REQUIRED", "Pilih file yang akan diunggah.");
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw new ApiError(422, "TOO_MANY_FILES", `Maksimal ${MAX_FILES_PER_REQUEST} berkas per unggahan.`, {
      count: files.length,
      limit: MAX_FILES_PER_REQUEST,
    });
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    throw new ApiError(413, "BATCH_TOO_LARGE", "Jumlah ukuran berkas dalam satu unggahan maksimal 25 MB.", {
      byteSize: totalBytes,
      limit: MAX_BATCH_BYTES,
    });
  }
  const count = await client.execute({
    sql: "SELECT COUNT(*) AS total FROM project_documents WHERE project_id=?",
    args: [projectId],
  });
  if (asNumber(count.rows[0]?.total) + files.length > MAX_DOCUMENTS_PER_PROJECT) {
    throw new ApiError(409, "DOCUMENT_LIMIT", `Proyek ini sudah memuat ${MAX_DOCUMENTS_PER_PROJECT} berkas.`, {
      limit: MAX_DOCUMENTS_PER_PROJECT,
    });
  }

  // Berurutan, bukan Promise.all: sepuluh foto didekode bersamaan adalah
  // ratusan megabyte di proses yang sama yang melayani pengguna lain.
  const uploaded: ReturnType<typeof mapDocument>[] = [];
  const skipped: Skipped[] = [];
  const batchHashes = new Set<string>();
  for (const file of files) {
    try {
      uploaded.push(await simpanSatu(client, request, user, projectId, file, caption, batchHashes));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (legacy) throw error;
      skipped.push({ name: safeAttachmentFilename(file.name, "berkas"), code: error.code, message: error.message, details: error.details });
    }
  }
  if (legacy) return created(uploaded[0]);
  if (!uploaded.length) {
    throw new ApiError(422, "NO_FILE_ACCEPTED", "Tidak ada berkas yang bisa diterima.", { skipped });
  }
  return created({ uploaded, skipped });
}

const patchSchema = z.object({
  caption: z.string().trim().max(500).nullable().optional(),
  takenAt: z.string().trim().min(1).max(40).optional(),
});

// ── /api/projects/:id/documents[/:docId] ─────────────────────────────────

export async function handleProjectDocuments(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const projectId = path[1];
  const documentId = path[3];
  await assertProjectAccess(client, user, projectId);

  if (request.method === "GET" && !documentId) {
    const result = await client.execute({
      sql: `SELECT ${DOC_COLUMNS} FROM project_documents d JOIN projects p ON p.id=d.project_id
        WHERE d.project_id=? ORDER BY COALESCE(d.taken_at, d.created_at) DESC, d.created_at DESC`,
      args: [projectId],
    });
    return ok(result.rows.map((row) => mapDocument(row as Record<string, unknown>, user.preferredLanguage)));
  }
  if (request.method === "POST" && !documentId) {
    return uploadDocuments(request, user, client, projectId);
  }
  if (request.method === "PATCH" && documentId) {
    const input = patchSchema.parse(await jsonBody(request));
    await loadDocument(client, documentId, projectId);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (input.caption !== undefined) {
      sets.push("caption=?");
      args.push(input.caption || null);
    }
    if (input.takenAt !== undefined) {
      const takenAt = normalizeTakenAt(input.takenAt);
      if (!takenAt) {
        throw new ApiError(422, "INVALID_TAKEN_AT", "Tanggal foto harus YYYY-MM-DD, YYYY-MM-DDTHH:mm, atau ISO beroffset.");
      }
      sets.push("taken_at=?");
      args.push(takenAt);
    }
    if (!sets.length) throw new ApiError(422, "NO_CHANGES", "Tidak ada perubahan yang dikirim.");
    await client.execute({
      sql: `UPDATE project_documents SET ${sets.join(",")} WHERE id=? AND project_id=?`,
      args: [...args, documentId, projectId],
    });
    await writeAuditLog(client, request, user, "update", "project_document", documentId, { projectId, ...input });
    return ok(mapDocument(await loadDocument(client, documentId, projectId), user.preferredLanguage));
  }
  if (request.method === "DELETE" && documentId) {
    const row = await client.execute({
      sql: "SELECT storage_url,thumb_storage_url,name,sha256 FROM project_documents WHERE id=? AND project_id=? LIMIT 1",
      args: [documentId, projectId],
    });
    const doc = row.rows[0] as Record<string, unknown> | undefined;
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
    await client.execute({ sql: "DELETE FROM project_documents WHERE id=?", args: [documentId] });
    for (const url of [doc.storage_url, doc.thumb_storage_url]) {
      await deleteProjectFile(url ? String(url) : null).catch((error) => {
        console.error("Gagal menghapus berkas dokumen proyek", documentId, error);
      });
    }
    await writeAuditLog(client, request, user, "delete", "project_document", documentId, {
      projectId,
      name: String(doc.name),
      sha256: doc.sha256 ? String(doc.sha256) : null,
    });
    return noContent();
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint dokumen proyek tidak ditemukan.");
}

// ── /api/documents … ─────────────────────────────────────────────────────

async function readBytes(storageUrl: unknown, base64: unknown) {
  const stored = await readProjectFile(storageUrl ? String(storageUrl) : null);
  if (stored) return stored.content;
  if (!base64) return null;
  return toArrayBuffer(Buffer.from(String(base64), "base64"));
}

async function serveContent(request: Request, user: AuthUser, id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT id,project_id,name,mime_type,storage_url,content_base64,thumb_storage_url,thumb_content_base64,width,height
      FROM project_documents WHERE id=? LIMIT 1`,
    args: [id],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
  await assertProjectAccess(client, user, String(row.project_id));
  const variant = new URL(request.url).searchParams.get("variant");

  if (variant === "thumb") {
    if (!isImage(row.mime_type)) throw new ApiError(404, "NO_THUMBNAIL", "Berkas ini bukan gambar.");
    let thumb = await readBytes(row.thumb_storage_url, row.thumb_content_base64);
    if (!thumb) {
      // Baris dari sebelum thumbnail ada: dibuat sekali saat pertama diminta,
      // lalu disimpan. Dua permintaan bersamaan paling buruk membuatnya dua
      // kali; UPDATE-nya berpenjaga supaya yang kedua tidak menimpa.
      const original = await readBytes(row.storage_url, row.content_base64);
      if (!original) throw new ApiError(404, "FILE_MISSING", "Isi dokumen tidak tersedia.");
      const generated = await makeThumbnail(original).catch(() => null);
      if (!generated) throw new ApiError(404, "NO_THUMBNAIL", "Thumbnail tidak dapat dibuat.");
      thumb = toArrayBuffer(generated);
      const stored = await storeUploadedFile("project-documents", `${id}-thumb`, "image/webp", thumb);
      await client.execute({
        sql: `UPDATE project_documents SET thumb_storage_url=?,thumb_content_base64=?
          WHERE id=? AND thumb_storage_url IS NULL AND thumb_content_base64 IS NULL`,
        args: [stored.storageUrl, stored.contentBase64, id],
      });
    }
    return new Response(thumb, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": inlineDisposition(`${String(row.name).replace(/\.[^.]+$/, "")}-thumb.webp`),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (row.storage_url && /^https?:\/\//.test(String(row.storage_url))) {
    return Response.redirect(String(row.storage_url));
  }
  const bytes = await readBytes(row.storage_url, row.content_base64);
  if (!bytes) throw new ApiError(404, "FILE_MISSING", "Isi dokumen tidak tersedia.");
  return new Response(bytes, {
    headers: {
      "Content-Type": String(row.mime_type),
      "Content-Disposition": inlineDisposition(String(row.name)),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function nextDay(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function assertDateParam(value: string | null, name: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new ApiError(422, "INVALID_DATE", `${name} harus berbentuk YYYY-MM-DD.`);
  }
  return value;
}

async function libraryWhere(client: DatabaseClient, user: AuthUser, params: URLSearchParams, withFilters: boolean) {
  const conditions: string[] = [];
  const args: unknown[] = [];
  const scope = projectScopeCondition(user, "p");
  if (scope.sql) {
    conditions.push(scope.sql);
    args.push(...scope.args);
  }
  const projectId = params.get("projectId");
  if (projectId) {
    await assertProjectAccess(client, user, projectId);
    conditions.push("d.project_id=?");
    args.push(projectId);
  }
  if (withFilters) {
    const from = assertDateParam(params.get("from"), "from");
    const to = assertDateParam(params.get("to"), "to");
    if (from) {
      conditions.push("d.taken_at>=?");
      args.push(from);
    }
    if (to) {
      conditions.push("d.taken_at<?");
      args.push(nextDay(to));
    }
    const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 120);
    if (q) {
      conditions.push("(lower(d.caption) LIKE ? OR lower(d.name) LIKE ?)");
      args.push(`%${q}%`, `%${q}%`);
    }
    const type = params.get("type") ?? "all";
    if (type === "photo") conditions.push("d.mime_type LIKE 'image/%'");
    else if (type === "file") conditions.push("d.mime_type NOT LIKE 'image/%'");
    else if (type !== "all") throw new ApiError(422, "INVALID_TYPE", "type harus photo, file, atau all.");
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", args };
}

async function listLibrary(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const pageSize = Math.max(10, Math.min(100, Number(params.get("pageSize") ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT));
  const where = await libraryWhere(client, user, params, true);
  const [rows, count] = await Promise.all([
    client.execute({
      sql: `SELECT ${DOC_COLUMNS} FROM project_documents d JOIN projects p ON p.id=d.project_id ${where.sql}
        ORDER BY COALESCE(d.taken_at, d.created_at) DESC, d.created_at DESC LIMIT ? OFFSET ?`,
      args: [...where.args, pageSize, (page - 1) * pageSize],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total FROM project_documents d JOIN projects p ON p.id=d.project_id ${where.sql}`,
      args: where.args,
    }),
  ]);
  return ok(
    {
      items: rows.rows.map((row) => mapDocument(row as Record<string, unknown>, user.preferredLanguage)),
      page,
      pageSize,
      total: asNumber(count.rows[0]?.total),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function summarizeLibrary(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const params = new URL(request.url).searchParams;
  const where = await libraryWhere(client, user, params, false);
  const photos = "SUM(CASE WHEN d.mime_type LIKE 'image/%' THEN 1 ELSE 0 END)";
  const files = "SUM(CASE WHEN d.mime_type LIKE 'image/%' THEN 0 ELSE 1 END)";
  const [byMonth, byProject] = await Promise.all([
    client.execute({
      sql: `SELECT substr(COALESCE(d.taken_at, d.created_at),1,7) AS month, ${photos} AS photos, ${files} AS files
        FROM project_documents d JOIN projects p ON p.id=d.project_id ${where.sql}
        GROUP BY substr(COALESCE(d.taken_at, d.created_at),1,7) ORDER BY month DESC`,
      args: where.args,
    }),
    client.execute({
      sql: `SELECT p.id AS project_id, p.code AS project_code, p.name AS project_name,
          ${photos} AS photos, ${files} AS files, MAX(COALESCE(d.taken_at, d.created_at)) AS latest_taken_at
        FROM project_documents d JOIN projects p ON p.id=d.project_id ${where.sql}
        GROUP BY p.id, p.code, p.name ORDER BY latest_taken_at DESC`,
      args: where.args,
    }),
  ]);
  return ok(
    {
      byMonth: byMonth.rows.map((row) => ({
        month: String(row.month),
        photos: asNumber(row.photos),
        files: asNumber(row.files),
      })),
      byProject: byProject.rows.map((row) => ({
        projectId: String(row.project_id),
        projectCode: String(row.project_code),
        projectName: String(row.project_name),
        photos: asNumber(row.photos),
        files: asNumber(row.files),
        latestTakenAt: row.latest_taken_at ? String(row.latest_taken_at) : null,
      })),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

export async function handleDocumentLibrary(request: Request, path: string[], user: AuthUser) {
  // path = ["documents", id?, "content"?]
  if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  if (!path[1]) return listLibrary(request, user);
  if (path[1] === "summary" && !path[2]) return summarizeLibrary(request, user);
  if (path[2] === "content" && !path[3]) return serveContent(request, user, path[1]);
  throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
}
