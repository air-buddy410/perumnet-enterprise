import "server-only";

import { z } from "zod";
import { canAccess } from "@/shared/access";
import { prepareUploadedAttachment, type PreparedAttachment } from "../attachments";
import type { AuthUser } from "../auth";
import type { DatabaseClient } from "../db/client";
import { kirimDokumen, susunKiriman } from "../document-delivery";
import { tandaiQuotationTerkirim } from "./commercial-scope-router";
import { ApiError, ok } from "./errors";

/**
 * Mengirim quotation dan invoice ke klien lewat email.
 *
 * Alamat kliennya tersimpan di proyek (`projects.client_email`) — sampai
 * 20 Agustus tidak ada alamat klien di mana pun dalam skema ini.
 */

function rupiah(value: unknown, language: "id" | "en") {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(Number(value ?? 0)));
}

function penjaga(user: AuthUser, level: "view" | "manage") {
  if (!canAccess(user.permissions, "billing", level)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? "Anda hanya bisa melihat dokumen ini, tidak mengirimnya."
        : "Peran Anda tidak memiliki akses ke Quotation & Invoice.",
    );
  }
}

async function muatTemplate(
  client: DatabaseClient,
  templateId: string,
  kind: "quotation" | "invoice",
) {
  const hasil = await client.execute({
    sql: "SELECT * FROM document_email_templates WHERE id=? AND deleted_at IS NULL LIMIT 1",
    args: [templateId],
  });
  const t = hasil.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!t) throw new ApiError(404, "NOT_FOUND", "Template surat tidak ditemukan.");
  if (String(t.document_kind) !== kind) {
    throw new ApiError(
      422,
      "TEMPLATE_KIND_MISMATCH",
      `Template ini bukan untuk ${kind === "quotation" ? "Quotation" : "Invoice"}.`,
      { documentKind: String(t.document_kind) },
    );
  }
  return t;
}

function alamatKlien(project: Record<string, unknown>) {
  const alamat = String(project.client_email ?? "").trim();
  if (!alamat) {
    // Bukan galat sistem. Pesannya menyebut apa yang harus diisi DAN di mana,
    // karena kolomnya baru ada dan belum satu pun proyek lama mengisinya.
    throw new ApiError(
      409,
      "CLIENT_EMAIL_MISSING",
      `Proyek ${String(project.name ?? "")} belum punya alamat email klien. Isi lebih dulu di Manajemen Proyek.`,
      { projectId: String(project.id), projectName: String(project.name ?? "") },
    );
  }
  const parsed = z.string().trim().email().max(254).safeParse(alamat);
  if (!parsed.success) {
    throw new ApiError(
      409,
      "CLIENT_EMAIL_INVALID",
      `Alamat email klien tidak valid: ${alamat}`,
      { projectId: String(project.id) },
    );
  }
  return alamat;
}

async function siapkanQuotation(
  client: DatabaseClient,
  user: AuthUser,
  quotationId: string,
  templateId: string,
) {
  penjaga(user, "manage");
  const hasil = await client.execute({
    sql: `SELECT q.*,p.id AS project_id,p.name AS project_name,p.client,
        p.client_email,p.client_contact_name
      FROM quotations q JOIN projects p ON p.id=q.project_id
      WHERE q.id=? LIMIT 1`,
    args: [quotationId],
  });
  const row = hasil.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
  if (["Void", "Rejected", "Superseded"].includes(String(row.status))) {
    throw new ApiError(
      409,
      "QUOTATION_NOT_SENDABLE",
      `Quotation berstatus ${String(row.status)} tidak dapat dikirim.`,
      { status: String(row.status) },
    );
  }
  const template = await muatTemplate(client, templateId, "quotation");
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
      nilai: rupiah(row.grand_total ?? row.total, language as "id" | "en"),
      berlaku_sampai: String(row.valid_until ?? ""),
    } as Record<string, string>,
  };
}

async function siapkanInvoice(
  client: DatabaseClient,
  user: AuthUser,
  invoiceId: string,
  templateId: string,
) {
  penjaga(user, "manage");
  const hasil = await client.execute({
    sql: `SELECT i.*,p.id AS project_id,p.name AS project_name,p.client,
        p.client_email,p.client_contact_name
      FROM invoices i JOIN projects p ON p.id=i.project_id
      WHERE i.id=? LIMIT 1`,
    args: [invoiceId],
  });
  const row = hasil.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  const template = await muatTemplate(client, templateId, "invoice");
  const language = String(template.language) === "en" ? "en" : "id";

  // Sisa tagihan dihitung, bukan disimpan: invoices.status hanya Lunas /
  // Belum Lunas, dan yang ingin dibaca klien adalah angkanya.
  const dibayar = await client.execute({
    sql: `SELECT COALESCE(SUM(gross_amount),0) AS jumlah FROM invoice_payments
      WHERE invoice_id=? AND status='Posted'`,
    args: [invoiceId],
  });
  const sisa = Number(row.amount ?? 0) - Number(dibayar.rows[0]?.jumlah ?? 0);

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
      nilai: rupiah(row.amount, language as "id" | "en"),
      jatuh_tempo: String(row.due_date ?? ""),
      sisa: rupiah(Math.max(0, sisa), language as "id" | "en"),
    } as Record<string, string>,
  };
}

function bahanKiriman(
  kind: "quotation" | "invoice",
  siap: Awaited<ReturnType<typeof siapkanQuotation>>,
  documentId: string,
) {
  const t = siap.template;
  return {
    kind,
    documentId,
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
    hasil.push(
      prepareUploadedAttachment(nilai.name, nilai.type, await nilai.arrayBuffer()),
    );
  }
  return hasil;
}

/**
 * Inti pratinjau — menerima templateId sebagai argumen, bukan membacanya dari
 * badan permintaan.
 *
 * Dipisah karena ada DUA jalur yang meminta pratinjau yang sama: dialog Kirim
 * (memegang dokumen, memilih template) dan layar pengelola template (memegang
 * template, menunjuk dokumen contoh). Keduanya harus menyusun surat yang sama
 * persis; kalau masing-masing menyusun sendiri, keduanya bisa menyimpang tanpa
 * ada satu tes pun yang gagal.
 */
export async function previewClientDocumentEmailWithTemplate(
  client: DatabaseClient,
  user: AuthUser,
  kind: "quotation" | "invoice",
  documentId: string,
  templateId: string,
) {
  const siap =
    kind === "quotation"
      ? await siapkanQuotation(client, user, documentId, templateId)
      : await siapkanInvoice(client, user, documentId, templateId);
  const { surat, lampiran } = await susunKiriman(
    client,
    bahanKiriman(kind, siap, documentId),
  );
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

export async function previewClientDocumentEmail(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  kind: "quotation" | "invoice",
  documentId: string,
) {
  const input = z
    .object({ templateId: z.string().trim().min(1) })
    .parse(await request.json());
  return previewClientDocumentEmailWithTemplate(
    client,
    user,
    kind,
    documentId,
    input.templateId,
  );
}

export async function sendClientDocumentEmail(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  kind: "quotation" | "invoice",
  documentId: string,
) {
  const form = await request.formData();
  const templateId = String(form.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new ApiError(422, "TEMPLATE_REQUIRED", "Pilih template surat lebih dulu.");
  }

  const siap =
    kind === "quotation"
      ? await siapkanQuotation(client, user, documentId, templateId)
      : await siapkanInvoice(client, user, documentId, templateId);
  const tambahan = await lampiranTambahan(form);

  // Quotation berstatus Draft ditandai terkirim LEBIH DULU, memakai transisi
  // yang sama dengan tombol "Tandai sudah dikirim" — bukan salinannya, karena
  // transisi itu juga memeriksa aturan pajak dan MENGUNCI item BoQ.
  //
  // Urutannya juga menutup satu jebakan: merender PDF quotation berstatus
  // Draft MENULIS ke database (pdf.ts memanggil refreshQuotationCommercialSnapshot).
  // Setelah transisi, statusnya bukan Draft lagi, jadi cabang itu tidak pernah
  // tersentuh dari jalur kirim.
  if (kind === "quotation" && String(siap.row.status) === "Draft") {
    await tandaiQuotationTerkirim(client, request, user, siap.row);
  }

  const hasil = await kirimDokumen(client, request, user, {
    ...bahanKiriman(kind, siap, documentId),
    tambahan,
  });
  return ok(hasil, 200, { "Cache-Control": "no-store" });
}

export async function listClientDocumentDeliveries(
  client: DatabaseClient,
  user: AuthUser,
  kind: "quotation" | "invoice",
  documentId: string,
) {
  penjaga(user, "view");
  const hasil = await client.execute({
    sql: `SELECT d.*,u.name AS created_by_name FROM document_deliveries d
      LEFT JOIN users u ON u.id=d.created_by
      WHERE d.document_kind=? AND d.document_id=?
      ORDER BY d.created_at DESC`,
    args: [kind, documentId],
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
