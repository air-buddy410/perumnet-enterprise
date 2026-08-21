import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canAccess } from "@/shared/access";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import {
  documentEmailKinds,
  documentEmailPlaceholders,
  type DocumentEmailKind,
} from "../../shared/document-email";
import { letterBodyFormats } from "../../shared/email-delivery";
import { previewClientDocumentEmailWithTemplate } from "./client-document-email";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";
import { previewSpkEmailWithTemplate } from "./procurement-router";

/**
 * Template surat pengantar dokumen.
 *
 * Fase ini hanya melayani SPK/PO, jadi penjaganya modul `procurement` — sama
 * dengan yang boleh mengirimnya. Saat quotation dan invoice ikut, penjaganya
 * menjadi per-jenis-dokumen (`billing` untuk keduanya).
 *
 * Sengaja BUKAN penjaga gabungan "procurement ATAU billing": bentuk seperti itu
 * pernah ada di modul belanja proyek dan dibuang, karena tidak ada yang bisa
 * menjawab dengan pasti siapa yang sebenarnya boleh apa.
 */

const templateSchema = z.object({
  documentKind: z.enum(documentEmailKinds),
  name: z.string().trim().min(2).max(180),
  subject: z.string().trim().min(2).max(300),
  bodyHtml: z.string().trim().min(10).max(100_000),
  bodyFormat: z.enum(letterBodyFormats).default("text"),
  senderSignoff: z.string().trim().max(80).default(""),
  senderName: z.string().trim().max(120).default(""),
  senderEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
  senderPhone: z.string().trim().max(40).default(""),
  language: z.enum(["id", "en"]).default("id"),
});

/**
 * Pratinjau dari sisi template: yang dipegang pemanggil adalah templatenya,
 * dan dokumen contoh yang ditunjuk. Kebalikan dari `send-email-preview` per
 * dokumen, yang memegang dokumen dan memilih templatenya.
 */
const previewSchema = z.object({
  documentType: z.enum(documentEmailKinds),
  documentId: z.string().trim().min(1).max(120),
});

function penjaga(user: AuthUser, level: "view" | "manage") {
  if (!canAccess(user.permissions, "procurement", level)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? "Anda hanya bisa melihat template surat, tidak mengubahnya."
        : "Peran Anda tidak memiliki akses ke template surat dokumen.",
    );
  }
}

function mapTemplate(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    documentKind: String(row.document_kind),
    name: String(row.name),
    subject: String(row.subject),
    bodyHtml: String(row.body_html),
    bodyFormat: String(row.body_format ?? "text"),
    senderSignoff: String(row.sender_signoff ?? ""),
    senderName: String(row.sender_name ?? ""),
    senderEmail: String(row.sender_email ?? ""),
    senderPhone: String(row.sender_phone ?? ""),
    language: String(row.language),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function loadTemplate(client: DatabaseClient, id: string) {
  const hasil = await client.execute({
    sql: "SELECT * FROM document_email_templates WHERE id=? AND deleted_at IS NULL LIMIT 1",
    args: [id],
  });
  const row = hasil.rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Template tidak ditemukan.");
  return row as unknown as Record<string, unknown>;
}

async function listTemplates(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const url = new URL(request.url);
  const kind = url.searchParams.get("documentType");
  const clauses = ["deleted_at IS NULL"];
  const args: unknown[] = [];
  if (kind && (documentEmailKinds as readonly string[]).includes(kind)) {
    clauses.push("document_kind=?");
    args.push(kind);
  }
  const hasil = await client.execute({
    sql: `SELECT * FROM document_email_templates
      WHERE ${clauses.join(" AND ")} ORDER BY document_kind, name`,
    args,
  });
  return ok(
    {
      items: hasil.rows.map((row) => mapTemplate(row as unknown as Record<string, unknown>)),
      // Tanda tangan terisi dari akun yang sedang masuk. Nama dan email pegawai
      // TIDAK pernah ditulis di kode — repositori ini publik.
      defaults: {
        senderSignoff: "Hormat kami,",
        senderName: user.name,
        senderEmail: user.email,
        senderPhone: "",
      },
      placeholders: documentEmailPlaceholders,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function createTemplate(request: Request, user: AuthUser) {
  const input = templateSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO document_email_templates
      (id,document_kind,name,subject,body_html,body_format,
       sender_signoff,sender_name,sender_email,sender_phone,
       language,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.documentKind,
      input.name,
      input.subject,
      input.bodyHtml,
      input.bodyFormat,
      input.senderSignoff,
      input.senderName,
      input.senderEmail,
      input.senderPhone,
      input.language,
      user.id,
      timestamp,
      timestamp,
    ],
  });
  await writeAuditLog(client, request, user, "create", "document_email_template", id);
  return created(mapTemplate(await loadTemplate(client, id)));
}

async function patchTemplate(request: Request, id: string, user: AuthUser) {
  const input = templateSchema.partial().parse(await jsonBody(request));
  const { client } = await getDatabase();
  await loadTemplate(client, id);
  const peta: Record<string, string> = {
    documentKind: "document_kind",
    name: "name",
    subject: "subject",
    bodyHtml: "body_html",
    bodyFormat: "body_format",
    senderSignoff: "sender_signoff",
    senderName: "sender_name",
    senderEmail: "sender_email",
    senderPhone: "sender_phone",
    language: "language",
  };
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [field, kolom] of Object.entries(peta)) {
    const nilai = (input as Record<string, unknown>)[field];
    if (nilai === undefined) continue;
    sets.push(`${kolom}=?`);
    args.push(nilai);
  }
  if (!sets.length) {
    throw new ApiError(422, "NO_CHANGES", "Tidak ada perubahan yang dikirim.");
  }
  const timestamp = new Date().toISOString();
  sets.push("updated_at=?");
  args.push(timestamp, id);
  await client.execute({
    sql: `UPDATE document_email_templates SET ${sets.join(",")} WHERE id=?`,
    args,
  });
  await writeAuditLog(client, request, user, "update", "document_email_template", id);
  return ok(mapTemplate(await loadTemplate(client, id)));
}

async function deleteTemplate(request: Request, id: string, user: AuthUser) {
  const { client } = await getDatabase();
  await loadTemplate(client, id);
  // Soft delete: riwayat pengiriman menunjuk ke template ini lewat template_id,
  // dan menghapusnya keras membuat catatan lama kehilangan nama suratnya.
  await client.execute({
    sql: "UPDATE document_email_templates SET deleted_at=?,updated_at=? WHERE id=?",
    args: [new Date().toISOString(), new Date().toISOString(), id],
  });
  await writeAuditLog(client, request, user, "delete", "document_email_template", id);
  return noContent();
}

/**
 * Pratinjau surat lengkap untuk satu template terhadap satu dokumen sungguhan.
 *
 * TIDAK menyusun suratnya sendiri. Ia memanggil inti yang sama dengan tombol
 * pratinjau di dialog Kirim, supaya apa yang dilihat pengelola template persis
 * apa yang nanti diterima penerima. Placeholder, identitas perusahaan, tanda
 * tangan, dan PDF dokumen semuanya datang dari sana.
 *
 * Penjaganya PER JENIS DOKUMEN, bukan penjaga `procurement` di bawah: yang
 * boleh melihat pratinjau surat invoice adalah yang boleh mengirim invoice.
 * Keduanya sudah ditegakkan di dalam `siapkan*` yang dipanggil di bawah,
 * sebelum satu baris data pun dibaca — jadi jangan menambahkan penjaga
 * gabungan di sini. Bentuk itu pernah ada di modul belanja proyek dan dibuang
 * karena tidak ada yang bisa menjawab siapa sebenarnya boleh apa.
 *
 * Ketidakcocokan jenis (`TEMPLATE_KIND_MISMATCH`) juga ditegakkan di sana,
 * lewat pemuat template yang sama dengan jalur kirim.
 */
async function previewTemplate(request: Request, templateId: string, user: AuthUser) {
  const input = previewSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  if (input.documentType === "spk") {
    return previewSpkEmailWithTemplate(client, user, input.documentId, templateId);
  }
  return previewClientDocumentEmailWithTemplate(
    client,
    user,
    input.documentType,
    input.documentId,
    templateId,
  );
}

export async function dispatchDocumentEmailTemplateApi(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const id = path[1];
  const action = path[2];

  // Sebelum penjaga procurement di bawah: pratinjau memakai penjaga per jenis
  // dokumen. Lihat catatan di previewTemplate.
  if (id && action === "preview") {
    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "Pratinjau template memakai POST.");
    }
    return previewTemplate(request, id, user);
  }
  if (action) {
    throw new ApiError(404, "NOT_FOUND", "Endpoint template dokumen tidak ditemukan.");
  }

  penjaga(user, request.method === "GET" ? "view" : "manage");

  if (!id) {
    if (request.method === "GET") return listTemplates(request, user);
    if (request.method === "POST") return createTemplate(request, user);
  }
  if (id) {
    if (request.method === "GET") {
      const { client } = await getDatabase();
      return ok(mapTemplate(await loadTemplate(client, id)));
    }
    if (request.method === "PATCH" || request.method === "PUT") {
      return patchTemplate(request, id, user);
    }
    if (request.method === "DELETE") return deleteTemplate(request, id, user);
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint template dokumen tidak ditemukan.");
}

export type { DocumentEmailKind };
