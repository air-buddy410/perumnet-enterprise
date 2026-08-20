import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requireUser, type AuthUser } from "../auth";
import { canAccess } from "../../shared/access";
import { getDatabase, type DatabaseClient } from "../db/client";
import { sendEmailDelivery } from "../email";
import {
  PROSPECT_DEFAULT_SPACING_SECONDS,
  PROSPECT_MAX_RECIPIENTS_PER_BATCH,
  PROSPECT_MAX_SPACING_SECONDS,
  PROSPECT_SOURCE_MIN_LENGTH,
  PROSPECT_DEFAULT_LETTER_FORMAT,
  PROSPECT_STARTER_TEMPLATE,
  prospectLetterFormats,
  prospectOutreachStatuses,
  prospectSegments,
  prospectStatuses,
  type ProspectLetterFormat,
} from "../../shared/prospects";
import { bacaWorkbookProspek } from "../prospect-import";
import {
  alamatBalasan,
  muatIdentitas,
  renderIsiSurat,
  renderSubjek,
  susunSurat,
  type Penandatangan,
} from "../prospect-letter";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";

/**
 * Penjaga modul, bukan penjaga peran.
 *
 * Dulu di sini `requireUser(request, ["Admin"])`. Akibatnya modul ini tidak
 * bisa diberikan kepada siapa pun tanpa mengubah kode — padahal Finance-lah
 * yang menyusun dan mengirim penawaran. Sekarang aksesnya lewat modul
 * `prospects`, yang muncul sendiri di layar Pengguna & Akses karena grid di
 * sana dibuat dari `accessModules`.
 *
 * "view" cukup untuk MELIHAT. Menyimpan, mengimpor, dan terutama MENGIRIM
 * menuntut "manage": surat yang terkirim tidak bisa ditarik kembali, jadi ia
 * tidak boleh berada di level yang sama dengan membaca daftar.
 */
async function penjaga(
  request: Request,
  level: "view" | "manage" = "view",
): Promise<AuthUser> {
  const user = await requireUser(request);
  if (!canAccess(user.permissions, "prospects", level)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? "Anda hanya bisa melihat calon klien, tidak mengubah atau mengirim."
        : "Peran Anda tidak memiliki akses ke Calon Klien.",
    );
  }
  return user;
}

const statusSchema = z.enum(prospectStatuses);
const segmentSchema = z.enum(prospectSegments);

const contactShape = {
  fullName: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(254),
  companyName: z.string().trim().max(180).optional(),
  jobTitle: z.string().trim().max(180).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  location: z.string().trim().max(240).optional(),
  industry: z.string().trim().max(180).optional(),
  segment: segmentSchema.optional(),
  serviceInterest: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(4_000).optional(),
};

const createProspectSchema = z.object({
  ...contactShape,
  source: z.string().trim().min(PROSPECT_SOURCE_MIN_LENGTH).max(240),
  status: statusSchema.optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

const patchProspectSchema = z
  .object({
    ...contactShape,
    fullName: contactShape.fullName.optional(),
    email: contactShape.email.optional(),
    source: z.string().trim().min(PROSPECT_SOURCE_MIN_LENGTH).max(240).optional(),
    status: statusSchema.optional(),
    assignedTo: z.string().uuid().nullable().optional(),
    optOut: z.boolean().optional(),
    optOutReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Tidak ada perubahan yang dikirim.");

const templateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  subject: z.string().trim().min(2).max(300),
  bodyHtml: z.string().trim().min(10).max(100_000),
  // Bawaannya teks biasa. Admin mengetik kalimat, server yang menyusun
  // suratnya — kop, tanda tangan, dan catatan kaki tidak pernah jadi tanggung
  // jawab orang yang mengisi formulir.
  bodyFormat: z.enum(prospectLetterFormats).default("text"),
  senderSignoff: z.string().trim().max(80).default(""),
  senderName: z.string().trim().max(120).default(""),
  senderEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
  senderPhone: z.string().trim().max(40).default(""),
  language: z.enum(["id", "en"]).default("id"),
});

const sendSchema = z
  .object({
    prospectIds: z
      .array(z.string().uuid())
      .min(1)
      .max(PROSPECT_MAX_RECIPIENTS_PER_BATCH),
    templateId: z.string().uuid().optional(),
    subject: z.string().trim().min(2).max(300).optional(),
    bodyHtml: z.string().trim().min(10).max(100_000).optional(),
    bodyFormat: z.enum(prospectLetterFormats).default("text"),
    language: z.enum(["id", "en"]).default("id"),
    spacingSeconds: z
      .number()
      .int()
      .min(0)
      .max(PROSPECT_MAX_SPACING_SECONDS)
      .optional(),
  })
  .refine(
    (v) => Boolean(v.templateId) || (Boolean(v.subject) && Boolean(v.bodyHtml)),
    "Pilih template, atau isi subjek dan isi surat.",
  );

function now() {
  return new Date().toISOString();
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function mapProspect(row: Record<string, unknown>) {
  const optOutAt = row.opt_out_at ? String(row.opt_out_at) : null;
  const email = text(row.email);
  return {
    id: String(row.id),
    fullName: text(row.full_name),
    email,
    companyName: text(row.company_name),
    jobTitle: text(row.job_title),
    whatsapp: text(row.whatsapp),
    location: text(row.location),
    industry: text(row.industry),
    segment: row.segment ? String(row.segment) : null,
    serviceInterest: text(row.service_interest),
    notes: text(row.notes),
    source: text(row.source),
    status: String(row.status),
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    assignedName: row.assigned_name ? String(row.assigned_name) : null,
    optOutAt,
    optOutReason: text(row.opt_out_reason),
    lastOutreachAt: row.last_outreach_at ? String(row.last_outreach_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    // Dihitung di server supaya layar tidak menghitung ulang dan berbeda
    // hasil: aturan yang menolak pengiriman ada di sini, jadi jawabannya harus
    // berasal dari sini juga.
    emailable: Boolean(email) && !optOutAt,
  };
}

function prospectWhere(url: URL) {
  const clauses = ["p.deleted_at IS NULL"];
  const args: unknown[] = [];
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    clauses.push(
      "(lower(p.full_name) LIKE ? OR lower(p.email) LIKE ? OR lower(p.company_name) LIKE ?)",
    );
    const pola = `%${q.toLowerCase()}%`;
    args.push(pola, pola, pola);
  }
  const status = url.searchParams.get("status");
  if (status) {
    clauses.push("p.status = ?");
    args.push(status);
  }
  const segment = url.searchParams.get("segment");
  if (segment) {
    clauses.push("p.segment = ?");
    args.push(segment);
  }
  if (url.searchParams.get("optOut") === "1") clauses.push("p.opt_out_at IS NOT NULL");
  if (url.searchParams.get("emailable") === "1") {
    clauses.push("p.opt_out_at IS NULL AND p.email <> ''");
  }
  return { clauses, args };
}

async function assertEmailFree(
  client: DatabaseClient,
  email: string,
  exceptId?: string,
) {
  const hasil = await client.execute({
    sql: `SELECT id FROM cms_prospects
      WHERE lower(email)=lower(?) AND deleted_at IS NULL ${exceptId ? "AND id<>?" : ""}
      LIMIT 1`,
    args: exceptId ? [email, exceptId] : [email],
  });
  const bentrok = hasil.rows[0];
  if (bentrok) {
    throw new ApiError(
      409,
      "EMAIL_ALREADY_LISTED",
      "Alamat email itu sudah terdaftar pada prospek lain.",
      { prospectId: String(bentrok.id) },
    );
  }
}

async function listProspects(request: Request) {
  const { client } = await getDatabase();
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.max(
    10,
    Math.min(100, Number(url.searchParams.get("pageSize") ?? 25) || 25),
  );
  const { clauses, args } = prospectWhere(url);
  const where = `WHERE ${clauses.join(" AND ")}`;
  const [rows, count, staff] = await Promise.all([
    client.execute({
      sql: `SELECT p.*,u.name AS assigned_name FROM cms_prospects p
        LEFT JOIN users u ON u.id=p.assigned_to ${where}
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      args: [...args, pageSize, (page - 1) * pageSize],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total FROM cms_prospects p ${where}`,
      args,
    }),
    client.execute("SELECT id,name,role FROM users WHERE status='Aktif' ORDER BY name"),
  ]);
  return ok(
    {
      items: rows.rows.map(mapProspect),
      page,
      pageSize,
      total: Number(count.rows[0]?.total ?? 0),
      staff: staff.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        role: String(row.role),
      })),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function createProspect(request: Request, user: AuthUser) {
  const input = createProspectSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  await assertEmailFree(client, input.email);
  const id = randomUUID();
  const timestamp = now();
  await client.execute({
    sql: `INSERT INTO cms_prospects
      (id,full_name,email,company_name,job_title,whatsapp,location,industry,segment,
       service_interest,notes,source,status,assigned_to,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.fullName,
      input.email.toLowerCase(),
      input.companyName ?? null,
      input.jobTitle ?? null,
      input.whatsapp ?? null,
      input.location ?? null,
      input.industry ?? null,
      input.segment ?? null,
      input.serviceInterest ?? null,
      input.notes ?? null,
      input.source,
      input.status ?? "New",
      input.assignedTo ?? null,
      user.id,
      timestamp,
      timestamp,
    ],
  });
  await writeAuditLog(client, request, user, "prospect_create", "prospect", id);
  return created(await loadProspect(client, id));
}

async function loadProspect(client: DatabaseClient, id: string) {
  const hasil = await client.execute({
    sql: `SELECT p.*,u.name AS assigned_name FROM cms_prospects p
      LEFT JOIN users u ON u.id=p.assigned_to
      WHERE p.id=? AND p.deleted_at IS NULL LIMIT 1`,
    args: [id],
  });
  const row = hasil.rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Prospek tidak ditemukan.");
  return mapProspect(row);
}

async function getProspect(id: string) {
  const { client } = await getDatabase();
  const prospect = await loadProspect(client, id);
  const riwayat = await client.execute({
    sql: `SELECT id,template_id,template_name,recipient,subject,status,scheduled_for,
        sent_at,failure_reason,created_at,
        CASE WHEN body_html IS NULL THEN 0 ELSE 1 END AS has_body
      FROM cms_prospect_outreach WHERE prospect_id=? ORDER BY created_at DESC`,
    args: [id],
  });
  return ok(
    {
      ...prospect,
      outreach: riwayat.rows.map((row) => ({
        id: String(row.id),
        templateId: row.template_id ? String(row.template_id) : null,
        templateName: String(row.template_name),
        recipient: String(row.recipient),
        subject: String(row.subject),
        status: String(row.status),
        scheduledFor: String(row.scheduled_for),
        sentAt: row.sent_at ? String(row.sent_at) : null,
        failureReason: text(row.failure_reason),
        createdAt: String(row.created_at),
        hasBody: Number(row.has_body) === 1,
      })),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

const kolomKontak: Record<string, string> = {
  fullName: "full_name",
  email: "email",
  companyName: "company_name",
  jobTitle: "job_title",
  whatsapp: "whatsapp",
  location: "location",
  industry: "industry",
  segment: "segment",
  serviceInterest: "service_interest",
  notes: "notes",
  source: "source",
  status: "status",
  assignedTo: "assigned_to",
};

async function patchProspect(request: Request, id: string, user: AuthUser) {
  const input = patchProspectSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  await loadProspect(client, id);
  if (input.email) await assertEmailFree(client, input.email, id);

  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [field, kolom] of Object.entries(kolomKontak)) {
    const nilai = (input as Record<string, unknown>)[field];
    if (nilai === undefined) continue;
    sets.push(`${kolom}=?`);
    args.push(field === "email" ? String(nilai).toLowerCase() : nilai);
  }
  if (input.optOut !== undefined) {
    sets.push("opt_out_at=?", "opt_out_reason=?");
    args.push(input.optOut ? now() : null, input.optOut ? input.optOutReason ?? null : null);
  }
  if (!sets.length) throw new ApiError(422, "VALIDATION_ERROR", "Tidak ada perubahan yang dikirim.");
  sets.push("updated_at=?");
  args.push(now(), id);
  await client.execute({
    sql: `UPDATE cms_prospects SET ${sets.join(",")} WHERE id=?`,
    args,
  });
  await writeAuditLog(client, request, user, "prospect_update", "prospect", id);
  return ok(await loadProspect(client, id));
}

async function deleteProspect(request: Request, id: string, user: AuthUser) {
  const { client } = await getDatabase();
  await loadProspect(client, id);
  await client.execute({
    sql: "UPDATE cms_prospects SET deleted_at=?,updated_at=? WHERE id=?",
    args: [now(), now(), id],
  });
  await writeAuditLog(client, request, user, "prospect_delete", "prospect", id);
  return noContent();
}

// ── Template surat ───────────────────────────────────────────────────

function mapTemplate(row: Record<string, unknown>) {
  return {
    id: String(row.id),
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

async function listTemplates(user: AuthUser) {
  const { client } = await getDatabase();
  const hasil = await client.execute(
    "SELECT * FROM cms_prospect_templates WHERE deleted_at IS NULL ORDER BY name",
  );
  return ok(
    {
      items: hasil.rows.map(mapTemplate),
      // Bekal untuk layar: naskah awal supaya kotak template tidak pernah
      // kosong, dan tanda tangan yang sudah terisi dari akun yang sedang masuk.
      // Nama dan email pegawai datang dari sesi, bukan dari kode — repositori
      // ini publik.
      defaults: {
        starter: {
          name: PROSPECT_STARTER_TEMPLATE.name,
          subject: PROSPECT_STARTER_TEMPLATE.subject,
          bodyHtml: PROSPECT_STARTER_TEMPLATE.body,
          bodyFormat: PROSPECT_DEFAULT_LETTER_FORMAT,
        },
        senderSignoff: PROSPECT_STARTER_TEMPLATE.signoff,
        senderName: user.name,
        senderEmail: user.email,
        senderPhone: "",
      },
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function loadTemplate(client: DatabaseClient, id: string) {
  const hasil = await client.execute({
    sql: "SELECT * FROM cms_prospect_templates WHERE id=? AND deleted_at IS NULL LIMIT 1",
    args: [id],
  });
  const row = hasil.rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Template tidak ditemukan.");
  return row;
}

async function createTemplate(request: Request, user: AuthUser) {
  const input = templateSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  const id = randomUUID();
  const timestamp = now();
  await client.execute({
    sql: `INSERT INTO cms_prospect_templates
      (id,name,subject,body_html,body_format,
       sender_signoff,sender_name,sender_email,sender_phone,
       language,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
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
  await writeAuditLog(client, request, user, "prospect_template_create", "prospect_template", id);
  return created(mapTemplate(await loadTemplate(client, id)));
}

async function patchTemplate(request: Request, id: string, user: AuthUser) {
  const input = templateSchema.partial().parse(await jsonBody(request));
  const { client } = await getDatabase();
  await loadTemplate(client, id);
  const peta: Record<string, string> = {
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
  if (!sets.length) throw new ApiError(422, "VALIDATION_ERROR", "Tidak ada perubahan yang dikirim.");
  sets.push("updated_at=?");
  args.push(now(), id);
  await client.execute({
    sql: `UPDATE cms_prospect_templates SET ${sets.join(",")} WHERE id=?`,
    args,
  });
  await writeAuditLog(client, request, user, "prospect_template_update", "prospect_template", id);
  return ok(mapTemplate(await loadTemplate(client, id)));
}

async function deleteTemplate(request: Request, id: string, user: AuthUser) {
  const { client } = await getDatabase();
  await loadTemplate(client, id);
  // Soft delete: baris cms_prospect_outreach menyimpan template_id, dan
  // menghapusnya keras akan memutus riwayat surat yang sudah terkirim.
  await client.execute({
    sql: "UPDATE cms_prospect_templates SET deleted_at=?,updated_at=? WHERE id=?",
    args: [now(), now(), id],
  });
  await writeAuditLog(client, request, user, "prospect_template_delete", "prospect_template", id);
  return noContent();
}

/**
 * Placeholder yang tidak dikenal DIBIARKAN apa adanya, bukan dikosongkan.
 * Salah ketik `{{prusahaan}}` yang diam-diam jadi string kosong akan terkirim
 * ke ratusan orang tanpa ada yang menyadarinya; yang tertinggal utuh terlihat
 * pada pratinjau pertama.
 */
function nilaiPlaceholder(prospect: ReturnType<typeof mapProspect>) {
  return {
    nama: prospect.fullName,
    perusahaan: prospect.companyName,
    jabatan: prospect.jobTitle,
    kota: prospect.location,
    segmen: prospect.segment ?? "",
  } satisfies Record<string, string>;
}

/**
 * Satu surat utuh, siap kirim: subjek + HTML lengkap dengan kop berlogo dan
 * tanda tangan. Pratinjau dan pengiriman sama-sama lewat sini, jadi yang
 * dilihat admin adalah yang diterima calon klien — bukan dua render yang
 * kebetulan mirip.
 */
interface SumberSurat {
  subject: string;
  body: string;
  format: ProspectLetterFormat;
  language: "id" | "en";
  penandatangan: Penandatangan;
}

function sumberDariTemplate(row: Record<string, unknown>): SumberSurat {
  return {
    subject: String(row.subject),
    body: String(row.body_html),
    // Dipetakan lewat daftar bersama, bukan lewat satu perbandingan. Versi
    // sebelumnya berbunyi `=== "html" ? "html" : "text"`, dan begitu format
    // ketiga ditambahkan ia diam-diam merender 'rich' sebagai teks biasa —
    // penandanya tampil mentah di surat, tanpa satu pun galat.
    format: (prospectLetterFormats as readonly string[]).includes(
      String(row.body_format ?? ""),
    )
      ? (String(row.body_format) as ProspectLetterFormat)
      : "text",
    language: String(row.language) === "en" ? "en" : "id",
    penandatangan: {
      signoff: String(row.sender_signoff ?? ""),
      name: String(row.sender_name ?? ""),
      email: String(row.sender_email ?? ""),
      phone: String(row.sender_phone ?? ""),
    },
  };
}

async function susunUntukProspek(
  client: DatabaseClient,
  prospect: ReturnType<typeof mapProspect>,
  sumber: SumberSurat,
) {
  const nilai = nilaiPlaceholder(prospect);
  const identitas = await muatIdentitas(client, sumber.language);
  return {
    subject: renderSubjek(sumber.subject, nilai),
    html: susunSurat({
      isiHtml: renderIsiSurat(sumber.body, sumber.format, nilai),
      identitas,
      language: sumber.language,
      penandatangan: sumber.penandatangan,
    }),
  };
}

async function previewTemplate(request: Request, id: string) {
  const input = z
    .object({ prospectId: z.string().uuid() })
    .parse(await jsonBody(request));
  const { client } = await getDatabase();
  const template = await loadTemplate(client, id);
  const prospect = await loadProspect(client, input.prospectId);
  const surat = await susunUntukProspek(
    client,
    prospect,
    sumberDariTemplate(template as unknown as Record<string, unknown>),
  );
  return ok({
    subject: surat.subject,
    bodyHtml: surat.html,
    recipient: prospect.email,
  });
}

// ── Laporan pengiriman ───────────────────────────────────────────────
//
// Sebelum ini riwayat outreach ditulis sekali saat tombol Kirim ditekan, lalu
// tidak pernah disentuh lagi — ia bilang "Queued" selamanya, bahkan setelah
// suratnya benar-benar terkirim atau gagal permanen. Layar yang membacanya
// menampilkan kabar yang salah dengan penuh percaya diri.
//
// Sekarang server/email.ts menyalin nasib tiap baris ke sini begitu final,
// dan dua endpoint di bawah membacanya: satu per-batch (satu penekanan tombol
// Kirim), satu per-penerima.

function mapOutreachLog(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    batchId: row.batch_id ? String(row.batch_id) : null,
    prospectId: String(row.prospect_id),
    prospectName: text(row.prospect_name),
    companyName: text(row.company_name),
    templateId: row.template_id ? String(row.template_id) : null,
    templateName: text(row.template_name),
    recipient: text(row.recipient),
    subject: text(row.subject),
    status: String(row.status),
    scheduledFor: String(row.scheduled_for),
    sentAt: row.sent_at ? String(row.sent_at) : null,
    failureReason: text(row.failure_reason),
    createdAt: String(row.created_at),
    // Dari email_outbox selama barisnya masih ada. Setelah 180 hari
    // pruneEmailOutbox menghapusnya dan nilai ini jadi null — statusnya
    // sendiri tetap terbaca karena disalin ke riwayat.
    attempts: row.attempt_count === null || row.attempt_count === undefined
      ? null
      : Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    hasBody: Number(row.has_body) === 1,
  };
}

function outreachWhere(url: URL) {
  const clauses: string[] = ["1=1"];
  const args: unknown[] = [];

  const q = url.searchParams.get("q")?.trim();
  if (q) {
    clauses.push(
      "(lower(o.recipient) LIKE ? OR lower(o.subject) LIKE ? OR lower(p.full_name) LIKE ? OR lower(p.company_name) LIKE ?)",
    );
    const pola = `%${q.toLowerCase()}%`;
    args.push(pola, pola, pola, pola);
  }

  const status = url.searchParams.get("status");
  if (status && (prospectOutreachStatuses as readonly string[]).includes(status)) {
    clauses.push("o.status=?");
    args.push(status);
  }

  const batchId = url.searchParams.get("batchId")?.trim();
  if (batchId) {
    clauses.push("o.batch_id=?");
    args.push(batchId);
  }

  const prospectId = url.searchParams.get("prospectId")?.trim();
  if (prospectId) {
    clauses.push("o.prospect_id=?");
    args.push(prospectId);
  }

  const from = url.searchParams.get("from")?.trim();
  if (from) {
    clauses.push("o.created_at>=?");
    args.push(from);
  }
  const to = url.searchParams.get("to")?.trim();
  if (to) {
    clauses.push("o.created_at<=?");
    args.push(to);
  }

  return { clauses, args };
}

/**
 * Hitungan per status, SELALU lengkap keempatnya.
 *
 * Status yang tidak punya baris tetap dipulangkan sebagai 0, bukan hilang dari
 * objeknya: layar yang membaca `summary.Failed` tidak boleh menampilkan
 * "kosong" hanya karena kebetulan belum ada yang gagal.
 */
function ringkasStatus(rows: Record<string, unknown>[]) {
  const hasil: Record<string, number> = Object.fromEntries(
    prospectOutreachStatuses.map((s) => [s, 0]),
  );
  let total = 0;
  for (const row of rows) {
    const status = String(row.status);
    const jumlah = Number(row.jumlah ?? 0);
    if (status in hasil) hasil[status] = jumlah;
    total += jumlah;
  }
  return { ...hasil, total };
}

async function listOutreachLog(request: Request) {
  const { client } = await getDatabase();
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.max(
    10,
    Math.min(100, Number(url.searchParams.get("pageSize") ?? 25) || 25),
  );
  const { clauses, args } = outreachWhere(url);
  const where = `WHERE ${clauses.join(" AND ")}`;

  const [rows, count, ringkas] = await Promise.all([
    client.execute({
      sql: `SELECT o.id,o.batch_id,o.prospect_id,o.template_id,o.template_name,
              o.recipient,o.subject,o.status,o.scheduled_for,o.sent_at,
              o.failure_reason,o.created_at,
              p.full_name AS prospect_name, p.company_name,
              e.attempt_count, e.next_attempt_at,
              CASE WHEN o.body_html IS NULL THEN 0 ELSE 1 END AS has_body
            FROM cms_prospect_outreach o
            JOIN cms_prospects p ON p.id=o.prospect_id
            LEFT JOIN email_outbox e ON e.id=o.outbox_id
            ${where}
            ORDER BY o.created_at DESC, o.scheduled_for DESC
            LIMIT ? OFFSET ?`,
      args: [...args, pageSize, (page - 1) * pageSize],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total FROM cms_prospect_outreach o
            JOIN cms_prospects p ON p.id=o.prospect_id ${where}`,
      args,
    }),
    client.execute({
      sql: `SELECT o.status, COUNT(*) AS jumlah FROM cms_prospect_outreach o
            JOIN cms_prospects p ON p.id=o.prospect_id ${where}
            GROUP BY o.status`,
      args,
    }),
  ]);

  return ok(
    {
      items: rows.rows.map((row) => mapOutreachLog(row as Record<string, unknown>)),
      page,
      pageSize,
      total: Number(count.rows[0]?.total ?? 0),
      summary: ringkasStatus(ringkas.rows as unknown as Record<string, unknown>[]),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

/**
 * Daftar batch: satu baris per penekanan tombol Kirim.
 *
 * SUM(CASE WHEN ...) dan bukan COUNT(*) FILTER — FILTER hanya ada di
 * PostgreSQL, sedangkan pengembangan dan tes berjalan di libsql.
 */
async function listOutreachBatches(request: Request) {
  const { client } = await getDatabase();
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 30) || 30));
  const hasil = await client.execute({
    sql: `SELECT o.batch_id,
            MIN(o.template_name) AS template_name,
            MIN(o.created_at) AS created_at,
            MIN(o.scheduled_for) AS first_scheduled_for,
            MAX(o.scheduled_for) AS last_scheduled_for,
            MAX(o.sent_at) AS last_sent_at,
            COUNT(*) AS total,
            SUM(CASE WHEN o.status='Sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN o.status='Failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN o.status='Queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN o.status='Skipped' THEN 1 ELSE 0 END) AS skipped
          FROM cms_prospect_outreach o
          WHERE o.batch_id IS NOT NULL
          GROUP BY o.batch_id
          ORDER BY MIN(o.created_at) DESC
          LIMIT ?`,
    args: [limit],
  });
  return ok(
    {
      items: hasil.rows.map((row) => {
        const r = row as unknown as Record<string, unknown>;
        const total = Number(r.total ?? 0);
        const sent = Number(r.sent ?? 0);
        const failed = Number(r.failed ?? 0);
        const queued = Number(r.queued ?? 0);
        return {
          batchId: String(r.batch_id),
          templateName: text(r.template_name),
          createdAt: String(r.created_at),
          firstScheduledFor: String(r.first_scheduled_for),
          lastScheduledFor: String(r.last_scheduled_for),
          lastSentAt: r.last_sent_at ? String(r.last_sent_at) : null,
          total,
          sent,
          failed,
          queued,
          skipped: Number(r.skipped ?? 0),
          // Dihitung di server supaya dua layar tidak menjawab berbeda untuk
          // pertanyaan yang sama.
          selesai: queued === 0,
        };
      }),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

// ── Pengiriman ───────────────────────────────────────────────────────

async function sendOutreach(request: Request, user: AuthUser) {
  const input = sendSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();

  let templateId: string | null = null;
  let templateName = "Surat langsung";
  let sumber: SumberSurat = {
    subject: input.subject ?? "",
    body: input.bodyHtml ?? "",
    format: input.bodyFormat,
    language: input.language,
    // Surat langsung ditandatangani orang yang menekan tombol kirim. Tanpa ini
    // suratnya berakhir tanpa nama, dan balasannya tidak jelas ditujukan
    // kepada siapa.
    penandatangan: {
      signoff: "",
      name: user.name,
      email: user.email,
      phone: "",
    },
  };
  if (input.templateId) {
    const template = await loadTemplate(client, input.templateId);
    templateId = String(template.id);
    templateName = String(template.name);
    sumber = sumberDariTemplate(template as unknown as Record<string, unknown>);
  }

  const spacing = input.spacingSeconds ?? PROSPECT_DEFAULT_SPACING_SECONDS;
  const hasil = await client.execute({
    sql: `SELECT p.*,u.name AS assigned_name FROM cms_prospects p
      LEFT JOIN users u ON u.id=p.assigned_to
      WHERE p.deleted_at IS NULL AND p.id IN (${input.prospectIds.map(() => "?").join(",")})`,
    args: input.prospectIds,
  });
  const prospek = hasil.rows.map(mapProspect);

  const dilewati: { prospectId: string; reason: string }[] = [];
  const ditemukan = new Set(prospek.map((p) => p.id));
  for (const id of input.prospectIds) {
    if (!ditemukan.has(id)) dilewati.push({ prospectId: id, reason: "NOT_FOUND" });
  }
  const penerima = prospek.filter((p) => {
    if (p.optOutAt) {
      dilewati.push({ prospectId: p.id, reason: "OPTED_OUT" });
      return false;
    }
    if (!p.email) {
      dilewati.push({ prospectId: p.id, reason: "NO_EMAIL" });
      return false;
    }
    return true;
  });

  if (!penerima.length) {
    throw new ApiError(
      422,
      "NO_ELIGIBLE_RECIPIENTS",
      "Tidak ada penerima yang bisa dikirimi. Periksa opt-out dan alamat email.",
      { skipped: dilewati },
    );
  }

  const mulai = Date.now();
  // Satu penekanan tombol Kirim = satu batch. Tanpa penanda ini laporannya
  // cuma daftar datar, dan pertanyaan yang sebenarnya orang punya — "kiriman
  // tadi pagi ke 21 orang itu sampai semua tidak?" — tidak bisa dijawab.
  const batchId = randomUUID();
  const antre: { prospectId: string; outreachId: string; status: string; scheduledFor: string }[] = [];
  for (const [urutan, p] of penerima.entries()) {
    // Pesan ke-N dijadwalkan N x jeda ke depan. Mailcow yang membawa surat ini
    // juga membawa invoice dan tautan reset kata sandi; puluhan email yang
    // tiba sekaligus membahayakan keduanya.
    const jadwal = new Date(mulai + urutan * spacing * 1_000).toISOString();
    // Jalur yang sama dengan pratinjau. Kalau keduanya dirender terpisah,
    // perbedaannya baru ketahuan setelah surat sampai ke calon klien.
    const { subject, html } = await susunUntukProspek(client, p, sumber);
    const kirim = await sendEmailDelivery(client, {
      recipient: p.email,
      eventType: "prospect_outreach",
      subject,
      html,
      notBefore: jadwal,
      // Balasan mengikuti tanda tangan. Tanpa ini calon klien yang menekan
      // Reply — cara paling wajar membalas — mendarat di alamat umum, dan
      // orang yang menandatangani tidak pernah tahu balasannya sudah datang.
      replyTo: alamatBalasan(sumber.penandatangan),
      // Calon klien bukan pengguna aplikasi ini, jadi preferensi notifikasi
      // per-pengguna tidak berlaku untuknya — memeriksanya berarti memeriksa
      // baris yang tidak ada.
      respectPreference: false,
    });
    const status = kirim.status === "pending" ? "Queued" : "Skipped";
    const outreachId = randomUUID();
    await client.execute({
      sql: `INSERT INTO cms_prospect_outreach
        (id,prospect_id,template_id,template_name,recipient,subject,body_html,status,
         batch_id,scheduled_for,failure_reason,outbox_id,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        outreachId,
        p.id,
        templateId,
        templateName,
        p.email,
        subject,
        html,
        status,
        batchId,
        jadwal,
        kirim.error ?? null,
        kirim.id,
        user.id,
        now(),
      ],
    });
    // Satu pernyataan untuk dua hal: catat kapan disurati, dan naikkan status
    // dari New ke Contacted. CASE, bukan dua UPDATE berurutan — yang kedua
    // menulis ulang baris yang baru saja ditulis.
    await client.execute({
      sql: `UPDATE cms_prospects
        SET last_outreach_at=?,
            status = CASE WHEN status='New' THEN 'Contacted' ELSE status END,
            updated_at=?
        WHERE id=?`,
      args: [jadwal, now(), p.id],
    });
    antre.push({ prospectId: p.id, outreachId, status, scheduledFor: jadwal });
  }

  await writeAuditLog(client, request, user, "prospect_outreach_send", "prospect", undefined, {
    templateId,
    batchId,
    dikirim: antre.length,
    dilewati: dilewati.length,
    spacingSeconds: spacing,
  });

  return ok({
    batchId,
    queued: antre.length,
    skipped: dilewati,
    spacingSeconds: spacing,
    items: antre,
  });
}

// ── Impor workbook ───────────────────────────────────────────────────

async function importProspects(request: Request, user: AuthUser) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !/\.xlsx$/i.test(file.name)) {
    throw new ApiError(422, "INVALID_FILE", "Gunakan berkas XLSX maksimal 5 MB.");
  }
  const source = z
    .string()
    .trim()
    .min(PROSPECT_SOURCE_MIN_LENGTH)
    .max(240)
    .parse(form.get("source") ?? `berkas ${file.name}`);
  const dryRun = String(form.get("dryRun") ?? "") === "1";

  const { kontak, masalah, sheets } = await bacaWorkbookProspek(
    await file.arrayBuffer(),
  );
  if (!kontak.length) {
    throw new ApiError(
      422,
      "EMPTY_WORKBOOK",
      "Tidak ada kontak yang terbaca. Pastikan baris pertama berisi judul kolom seperti Nama, Email, Perusahaan.",
      { sheets, issues: masalah },
    );
  }

  const { client } = await getDatabase();
  const issues = [...masalah];
  let disimpan = 0;
  let dilewati = 0;
  // Alamat yang sudah dipakai baris SEBELUMNYA di berkas yang sama. Tanpa ini,
  // uji kering melewatkan kembar di dalam satu berkas: ia hanya bertanya ke
  // database, dan saat kering tidak ada yang tersimpan sehingga dua baris
  // kembar tidak pernah bertemu. Laporan kering lalu menjanjikan 37 tersimpan
  // padahal yang sungguhan hanya 36 — persis jenis kejutan yang uji kering ada
  // untuk mencegahnya.
  const sudahDipakai = new Map<string, number>();
  // Kontak TANPA email tidak punya kunci unik di database, jadi ia lolos dari
  // seluruh pemeriksaan di atas. Akibatnya berkas yang sama diunggah dua kali
  // menghasilkan salinan berlipat — dan berkas kontak memang sering diunggah
  // ulang setelah diperbaiki. Kuncinya nama + perusahaan: dua baris yang sama
  // persis pada keduanya adalah orang yang sama, bukan dua orang.
  const tanpaEmailDipakai = new Map<string, number>();

  const kunciTanpaEmail = (nama: string, perusahaan: string) =>
    `${nama.trim().toLowerCase()}|${perusahaan.trim().toLowerCase()}`;

  for (const baris of kontak) {
    if (baris.email) {
      const kunci = baris.email.toLowerCase();
      const barisSebelumnya = sudahDipakai.get(kunci);
      if (barisSebelumnya !== undefined) {
        issues.push({
          sheet: baris.sheet,
          row: baris.row,
          code: "EMAIL_GANDA",
          detail: `${baris.sheet} baris ${baris.row}: ${baris.email} sudah dipakai baris ${barisSebelumnya} di berkas yang sama. Baris dilewati — dua perusahaan berbagi satu alamat hampir selalu salah tempel.`,
        });
        dilewati += 1;
        continue;
      }
      const ada = await client.execute({
        sql: "SELECT id FROM cms_prospects WHERE lower(email)=lower(?) AND deleted_at IS NULL LIMIT 1",
        args: [baris.email],
      });
      if (ada.rows[0]) {
        // Dua perusahaan berbagi satu alamat adalah salah tempel di berkas
        // sumber, bukan duplikat yang boleh digabung. Barisnya dilewati dan
        // dilaporkan dengan nomor barisnya, supaya bisa diperiksa manusia.
        issues.push({
          sheet: baris.sheet,
          row: baris.row,
          code: "EMAIL_GANDA",
          detail: `${baris.sheet} baris ${baris.row}: ${baris.email} sudah dipakai prospek lain. Baris dilewati.`,
        });
        dilewati += 1;
        continue;
      }
      sudahDipakai.set(kunci, baris.row);
    } else {
      const kunci = kunciTanpaEmail(baris.fullName, baris.companyName);
      const barisSebelumnya = tanpaEmailDipakai.get(kunci);
      if (barisSebelumnya !== undefined) {
        issues.push({
          sheet: baris.sheet,
          row: baris.row,
          code: "KONTAK_GANDA",
          detail: `${baris.sheet} baris ${baris.row}: ${baris.fullName} di ${baris.companyName || "perusahaan yang sama"} sudah ada di baris ${barisSebelumnya}. Baris dilewati — tanpa email, nama dan perusahaan yang sama persis adalah orang yang sama.`,
        });
        dilewati += 1;
        continue;
      }
      const ada = await client.execute({
        sql: `SELECT id FROM cms_prospects
          WHERE (email IS NULL OR email='')
            AND lower(trim(full_name))=lower(trim(?))
            AND lower(trim(COALESCE(company_name,'')))=lower(trim(?))
            AND deleted_at IS NULL
          LIMIT 1`,
        args: [baris.fullName, baris.companyName || ""],
      });
      if (ada.rows[0]) {
        issues.push({
          sheet: baris.sheet,
          row: baris.row,
          code: "KONTAK_GANDA",
          detail: `${baris.sheet} baris ${baris.row}: ${baris.fullName} di ${baris.companyName || "perusahaan yang sama"} sudah terdaftar tanpa email. Baris dilewati.`,
        });
        dilewati += 1;
        continue;
      }
      tanpaEmailDipakai.set(kunci, baris.row);
    }
    if (dryRun) {
      disimpan += 1;
      continue;
    }
    const timestamp = now();
    await client.execute({
      sql: `INSERT INTO cms_prospects
        (id,full_name,email,company_name,job_title,whatsapp,location,industry,
         segment,source,status,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'New',?,?,?)`,
      args: [
        randomUUID(),
        baris.fullName,
        baris.email,
        baris.companyName || null,
        baris.jobTitle || null,
        baris.whatsapp || null,
        baris.location || null,
        baris.industry || null,
        baris.segment,
        source,
        user.id,
        timestamp,
        timestamp,
      ],
    });
    disimpan += 1;
  }

  if (!dryRun) {
    await writeAuditLog(client, request, user, "prospect_import", "prospect", undefined, {
      berkas: file.name,
      disimpan,
      dilewati,
      masalah: issues.length,
    });
  }

  return ok({
    dryRun,
    sheets,
    terbaca: kontak.length,
    disimpan,
    dilewati,
    issues,
  });
}

// ── Penyalur ─────────────────────────────────────────────────────────

export async function dispatchProspectApi(request: Request, path: string[]) {
  // Membaca cukup "view"; apa pun yang mengubah data atau mengirim surat
  // menuntut "manage". Levelnya ditentukan SEBELUM rute dipilih supaya tidak
  // ada cabang yang lolos tanpa pemeriksaan.
  const user = await penjaga(request, request.method === "GET" ? "view" : "manage");
  const action = path[1];

  if (!action) {
    if (request.method === "GET") return listProspects(request);
    if (request.method === "POST") return createProspect(request, user);
  }
  if (action === "outreach") {
    if (request.method === "POST") return sendOutreach(request, user);
    if (request.method === "GET") {
      return path[2] === "batches"
        ? listOutreachBatches(request)
        : listOutreachLog(request);
    }
  }
  if (action === "import" && request.method === "POST") {
    return importProspects(request, user);
  }
  if (action) {
    if (request.method === "GET") return getProspect(action);
    if (request.method === "PATCH") return patchProspect(request, action, user);
    if (request.method === "DELETE") return deleteProspect(request, action, user);
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint prospek tidak ditemukan.");
}

export async function dispatchProspectTemplateApi(request: Request, path: string[]) {
  // Pratinjau hanya merender, tidak menyimpan apa pun — cukup "view".
  const pratinjau = path[2] === "preview";
  const user = await penjaga(
    request,
    request.method === "GET" || pratinjau ? "view" : "manage",
  );
  const id = path[1];

  if (!id) {
    if (request.method === "GET") return listTemplates(user);
    if (request.method === "POST") return createTemplate(request, user);
  }
  if (id && path[2] === "preview" && request.method === "POST") {
    return previewTemplate(request, id);
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
  throw new ApiError(404, "NOT_FOUND", "Endpoint template tidak ditemukan.");
}
