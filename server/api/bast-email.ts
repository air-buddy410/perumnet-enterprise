import "server-only";

import { z } from "zod";
import { canAccess } from "@/shared/access";
import { prepareUploadedAttachment, type PreparedAttachment } from "../attachments";
import type { AuthUser } from "../auth";
import type { DatabaseClient } from "../db/client";
import { kirimDokumen, susunKiriman } from "../document-delivery";
import { applicationUrl } from "../email";
import { ApiError, ok } from "./errors";

/**
 * Mengirim BAST final ke klien lewat email, sebagai BUKTI serah terima.
 *
 * Bedanya dengan quotation dan invoice bukan cuma penerima dan penandanya.
 *
 * 1. Hanya BAST yang SUDAH DITANDATANGANI dan difinalisasi yang boleh dikirim.
 *    Draft masih bisa berubah; mengirimnya berarti menaruh dokumen yang belum
 *    tentu sama dengan yang akhirnya berlaku di kotak masuk klien, dan tidak
 *    ada cara menariknya kembali. Quotation Draft justru sebaliknya — ia MEMANG
 *    dikirim untuk dibahas.
 * 2. Lampirannya arsip final, bukan render baru. Alasannya panjang dan penting;
 *    ada di `lampiranBastFinal` (`server/document-letter.ts`).
 * 3. BAST yang sudah dicabut tidak bisa dikirim. Halaman verifikasinya akan
 *    menyatakan dokumen itu tidak aktif, jadi suratnya hanya akan membingungkan
 *    penerimanya.
 */

function penjaga(user: AuthUser, level: "view" | "manage") {
  if (!canAccess(user.permissions, "bast", level)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? "Anda hanya bisa melihat BAST, tidak mengirimnya."
        : "Peran Anda tidak memiliki akses ke BAST Digital.",
      { module: "bast" },
    );
  }
}

async function muatTemplate(client: DatabaseClient, templateId: string) {
  const hasil = await client.execute({
    sql: "SELECT * FROM document_email_templates WHERE id=? AND deleted_at IS NULL LIMIT 1",
    args: [templateId],
  });
  const t = hasil.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!t) throw new ApiError(404, "NOT_FOUND", "Template surat tidak ditemukan.");
  if (String(t.document_kind) !== "bast") {
    throw new ApiError(422, "TEMPLATE_KIND_MISMATCH", "Template ini bukan untuk BAST.", {
      documentKind: String(t.document_kind),
    });
  }
  return t;
}

function alamatKlien(row: Record<string, unknown>) {
  const alamat = String(row.client_email ?? "").trim();
  if (!alamat) {
    throw new ApiError(
      409,
      "CLIENT_EMAIL_MISSING",
      `Proyek ${String(row.project_name ?? "")} belum punya alamat email klien. Isi lebih dulu di Manajemen Proyek.`,
      { projectId: String(row.project_id ?? ""), projectName: String(row.project_name ?? "") },
    );
  }
  const parsed = z.string().trim().email().max(254).safeParse(alamat);
  if (!parsed.success) {
    throw new ApiError(409, "CLIENT_EMAIL_INVALID", `Alamat email klien tidak valid: ${alamat}`, {
      projectId: String(row.project_id ?? ""),
    });
  }
  return alamat;
}

/**
 * Memuat BAST, memastikan ia boleh dikirim, dan menyusun nilai penandanya.
 *
 * Penjagaan "final dan belum dicabut" ada DI SINI dan sekali lagi di
 * `lampiranBastFinal`. Bukan kelebihan: yang di sini menghasilkan pesan yang
 * bisa dibaca orang sebelum satu byte pun dirakit, yang di sana menjaga byte
 * yang benar-benar keluar — dan hanya yang di sana yang ikut terpanggil kalau
 * suatu hari ada jalur kirim baru yang lupa memeriksa.
 */
async function siapkanBast(
  client: DatabaseClient,
  user: AuthUser,
  bastId: string,
  templateId: string,
) {
  penjaga(user, "manage");
  const hasil = await client.execute({
    sql: `SELECT b.*,p.id AS project_id,p.name AS project_name,p.client,
        p.client_email,p.client_contact_name,cp.title AS package_title
      FROM basts b JOIN projects p ON p.id=b.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=b.package_id
      WHERE b.id=? LIMIT 1`,
    args: [bastId],
  });
  const row = hasil.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "BAST tidak ditemukan.");
  if (!row.finalized_at) {
    throw new ApiError(
      409,
      "BAST_NOT_FINAL",
      "BAST ini belum difinalisasi. Lengkapi tanda tangan lalu finalisasi lebih dulu — surat ini adalah bukti bahwa dokumennya sudah sah, jadi hanya dokumen yang sudah sah yang bisa dikirim.",
      { status: String(row.status ?? "") },
    );
  }
  if (row.revoked_at) {
    throw new ApiError(
      409,
      "BAST_REVOKED",
      "BAST ini sudah dicabut. Kirim revisi terbarunya, bukan dokumen yang tidak lagi berlaku.",
      { revokedAt: String(row.revoked_at) },
    );
  }

  const template = await muatTemplate(client, templateId);
  const language = String(template.language) === "en" ? "en" : "id";
  return {
    row,
    template,
    language: language as "id" | "en",
    recipient: alamatKlien(row),
    recipientName: String(row.client_contact_name ?? row.client ?? ""),
    nilai: {
      nomor: String(row.number ?? ""),
      klien: String(row.client ?? ""),
      proyek: String(row.project_name ?? ""),
      paket: String(row.package_title ?? "Lingkup Utama"),
      tanggal_serah_terima: String(row.completion_date ?? ""),
      sidik_dokumen: String(row.pdf_hash ?? ""),
      // Tautan yang sama dengan QR di dalam PDF-nya. Klien yang mengetik ulang
      // dari QR dan yang mengeklik dari email harus mendarat di halaman yang
      // sama, atau salah satunya akan mengira dokumennya berbeda.
      tautan_verifikasi: row.verification_token
        ? applicationUrl(`/verify/bast/${String(row.verification_token)}`)
        : "",
    } as Record<string, string>,
  };
}

function bahanKiriman(
  siap: Awaited<ReturnType<typeof siapkanBast>>,
  bastId: string,
) {
  const t = siap.template;
  return {
    kind: "bast" as const,
    documentId: bastId,
    documentNumber: String(siap.row.number ?? ""),
    projectId: String(siap.row.project_id ?? "") || null,
    audience: "client" as const,
    vendorId: null,
    recipient: siap.recipient,
    recipientName: siap.recipientName,
    templateId: String(t.id),
    templateName: String(t.name),
    language: siap.language,
    subject: String(t.subject),
    body: String(t.body_html),
    format: String(t.body_format ?? "text") as "text" | "rich" | "html",
    penandatangan: {
      signoff: String(t.sender_signoff ?? ""),
      name: String(t.sender_name ?? ""),
      email: String(t.sender_email ?? ""),
      phone: String(t.sender_phone ?? ""),
    },
    nilai: siap.nilai,
  };
}

async function lampiranTambahan(form: FormData): Promise<PreparedAttachment[]> {
  const hasil: PreparedAttachment[] = [];
  for (const nilai of form.getAll("files")) {
    if (!(nilai instanceof File) || !nilai.size) continue;
    hasil.push(prepareUploadedAttachment(nilai.name, nilai.type, await nilai.arrayBuffer()));
  }
  return hasil;
}

/**
 * Inti pratinjau — menerima templateId sebagai argumen, bukan membacanya dari
 * badan permintaan. Dua jalur memakainya: dialog Kirim di layar BAST, dan layar
 * pengelola template yang menunjuk satu BAST contoh.
 */
export async function previewBastEmailWithTemplate(
  client: DatabaseClient,
  user: AuthUser,
  bastId: string,
  templateId: string,
) {
  const siap = await siapkanBast(client, user, bastId, templateId);
  const { surat, lampiran } = await susunKiriman(client, bahanKiriman(siap, bastId));
  return ok(
    {
      subject: surat.subject,
      bodyHtml: surat.html,
      recipient: siap.recipient,
      recipientName: siap.recipientName,
      attachments: lampiran.map((l) => ({
        filename: l.filename,
        byteSize: l.byteSize,
        generated: l.generated,
      })),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

export async function previewBastEmail(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  bastId: string,
) {
  const input = z
    .object({ templateId: z.string().trim().min(1) })
    .parse(await request.json());
  return previewBastEmailWithTemplate(client, user, bastId, input.templateId);
}

export async function sendBastEmail(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  bastId: string,
) {
  const form = await request.formData();
  const templateId = String(form.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new ApiError(422, "TEMPLATE_REQUIRED", "Pilih template surat lebih dulu.");
  }
  const siap = await siapkanBast(client, user, bastId, templateId);
  const tambahan = await lampiranTambahan(form);
  const hasil = await kirimDokumen(client, request, user, {
    ...bahanKiriman(siap, bastId),
    tambahan,
  });
  return ok(hasil, 200, { "Cache-Control": "no-store" });
}

export async function listBastDeliveries(
  client: DatabaseClient,
  user: AuthUser,
  bastId: string,
) {
  penjaga(user, "view");
  const hasil = await client.execute({
    sql: `SELECT d.*,u.name AS created_by_name FROM document_deliveries d
      LEFT JOIN users u ON u.id=d.created_by
      WHERE d.document_kind='bast' AND d.document_id=?
      ORDER BY d.created_at DESC`,
    args: [bastId],
  });
  const items = [];
  for (const row of hasil.rows as unknown as Record<string, unknown>[]) {
    const lampiran = await client.execute({
      sql: `SELECT filename,byte_size,kind FROM document_delivery_attachments
        WHERE delivery_id=? ORDER BY sort_order`,
      args: [String(row.id)],
    });
    items.push({
      id: String(row.id),
      recipient: String(row.recipient),
      recipientName: String(row.recipient_name ?? ""),
      subject: String(row.subject),
      status: String(row.status),
      scheduledFor: String(row.scheduled_for),
      sentAt: row.sent_at ? String(row.sent_at) : null,
      failureReason: String(row.failure_reason ?? ""),
      createdAt: String(row.created_at),
      createdByName: String(row.created_by_name ?? ""),
      attachments: (lampiran.rows as unknown as Record<string, unknown>[]).map((a) => ({
        filename: String(a.filename),
        byteSize: Number(a.byte_size ?? 0),
        generated: String(a.kind) === "document",
      })),
    });
  }
  return ok({ items }, 200, { "Cache-Control": "no-store" });
}
