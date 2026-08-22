import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canAccess } from "@/shared/access";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import {
  documentEmailAudience,
  documentEmailKinds,
  documentEmailPlaceholders,
  type DocumentEmailKind,
} from "../../shared/document-email";
import { letterBodyFormats } from "../../shared/email-delivery";
import { previewBastEmailWithTemplate } from "./bast-email";
import { previewClientDocumentEmailWithTemplate } from "./client-document-email";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";
import { previewSpkEmailWithTemplate } from "./procurement-router";

/**
 * Template surat pengantar dokumen.
 *
 * Penjaganya PER JENIS DOKUMEN, bukan satu modul untuk semuanya: template SPK
 * mengikuti izin Procurement & Vendor, template Quotation dan Invoice
 * mengikuti izin Quotation & Invoice, template BAST mengikuti izin BAST
 * Digital — sama dengan yang boleh MENGIRIM dokumennya. Sampai 22 Agustus 2026
 * semuanya menuntut izin Procurement,
 * sehingga Finance yang izin Procurement-nya dicabut tidak bisa membuat
 * template invoice sekalipun ia yang menagih.
 *
 * Ini BUKAN penjaga gabungan "procurement ATAU billing" — bentuk kabur itu
 * pernah ada di modul belanja proyek dan dibuang karena tidak ada yang bisa
 * menjawab siapa sebenarnya boleh apa. Di sini pemetaannya eksplisit dan
 * satu arah: jenis dokumen → modul izinnya.
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

/** Jenis dokumen → modul izin yang menaunginya. */
const MODUL_PER_JENIS: Record<
  DocumentEmailKind,
  "procurement" | "billing" | "bast"
> = {
  spk: "procurement",
  quotation: "billing",
  invoice: "billing",
  // BAST ikut modulnya sendiri, bukan Billing. Yang menandatangani dan
  // memfinalisasi serah terima adalah orang lapangan; yang menagih adalah
  // Finance. Menaruh surat BAST di bawah Billing berarti PM yang baru saja
  // memfinalisasi dokumennya tidak bisa mengirimkannya.
  bast: "bast",
};

const LABEL_JENIS: Record<DocumentEmailKind, string> = {
  spk: "SPK/PO",
  quotation: "Quotation",
  invoice: "Invoice",
  bast: "BAST",
};

function penjaga(
  user: AuthUser,
  level: "view" | "manage",
  kind: DocumentEmailKind,
) {
  if (!canAccess(user.permissions, MODUL_PER_JENIS[kind], level)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? `Anda hanya bisa melihat template surat ${LABEL_JENIS[kind]}, tidak mengubahnya.`
        : `Peran Anda tidak memiliki akses ke template surat ${LABEL_JENIS[kind]}.`,
      { documentKind: kind, module: MODUL_PER_JENIS[kind] },
    );
  }
}

/** Jenis yang boleh dilihat/dikelola akun ini — dipakai layar untuk memilih tab. */
function jenisYangBoleh(user: AuthUser, level: "view" | "manage") {
  return documentEmailKinds.filter((kind) =>
    canAccess(user.permissions, MODUL_PER_JENIS[kind], level),
  );
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
  const bolehLihat = jenisYangBoleh(user, "view");
  // Jenis yang disebut harus boleh dilihat; tanpa penyebutan, daftarnya
  // DISARING ke yang boleh — bukan ditolak. "Kamu melihat yang kamu boleh
  // lihat" adalah jawaban yang jelas; menolak seluruh daftar karena satu
  // jenis tidak boleh akan membuat layar Quotation kosong tanpa sebab.
  if (kind && (documentEmailKinds as readonly string[]).includes(kind)) {
    penjaga(user, "view", kind as DocumentEmailKind);
  } else if (!bolehLihat.length) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Peran Anda tidak memiliki akses ke template surat dokumen.",
    );
  }
  const terpilih =
    kind && (documentEmailKinds as readonly string[]).includes(kind)
      ? [kind]
      : bolehLihat;
  const hasil = await client.execute({
    sql: `SELECT * FROM document_email_templates
      WHERE deleted_at IS NULL
        AND document_kind IN (${terpilih.map(() => "?").join(",")})
      ORDER BY document_kind, name`,
    args: terpilih,
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
      // Supaya layar tahu tab mana yang pantas ditampilkan tanpa menebak dari
      // peran: server yang menjawab, karena server pula yang menegakkannya.
      viewableKinds: bolehLihat,
      manageableKinds: jenisYangBoleh(user, "manage"),
      // Kategori penerima per jenis, supaya layar mengelompokkan tabnya
      // ("Surat ke klien" / "Surat ke vendor") tanpa memetakannya sendiri.
      audience: documentEmailAudience,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function createTemplate(request: Request, user: AuthUser) {
  const input = templateSchema.parse(await jsonBody(request));
  penjaga(user, "manage", input.documentKind);
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
  const sekarang = await loadTemplate(client, id);
  // Jenis LAMA dan jenis BARU dua-duanya dijaga: memindahkan template dari
  // SPK ke Invoice berarti menulis di dua wilayah izin sekaligus.
  penjaga(user, "manage", String(sekarang.document_kind) as DocumentEmailKind);
  if (input.documentKind) penjaga(user, "manage", input.documentKind);
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
  const sekarang = await loadTemplate(client, id);
  penjaga(user, "manage", String(sekarang.document_kind) as DocumentEmailKind);
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
  if (input.documentType === "bast") {
    return previewBastEmailWithTemplate(client, user, input.documentId, templateId);
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

  // Tidak ada penjaga tunggal di sini lagi: tiap cabang menjaga dirinya sendiri
  // sesuai jenis dokumen yang disentuhnya.
  if (!id) {
    if (request.method === "GET") return listTemplates(request, user);
    if (request.method === "POST") return createTemplate(request, user);
  }
  if (id) {
    if (request.method === "GET") {
      const { client } = await getDatabase();
      const row = await loadTemplate(client, id);
      penjaga(user, "view", String(row.document_kind) as DocumentEmailKind);
      return ok(mapTemplate(row));
    }
    if (request.method === "PATCH" || request.method === "PUT") {
      return patchTemplate(request, id, user);
    }
    if (request.method === "DELETE") return deleteTemplate(request, id, user);
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint template dokumen tidak ditemukan.");
}

export type { DocumentEmailKind };
