import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requireUser, type AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { sendEmailDelivery } from "../email";
import {
  PROSPECT_DEFAULT_SPACING_SECONDS,
  PROSPECT_MAX_RECIPIENTS_PER_BATCH,
  PROSPECT_MAX_SPACING_SECONDS,
  PROSPECT_SOURCE_MIN_LENGTH,
  prospectPlaceholderPattern,
  prospectSegments,
  prospectStatuses,
} from "../../shared/prospects";
import { bacaWorkbookProspek } from "../prospect-import";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";

function admin(request: Request) {
  return requireUser(request, ["Admin"]);
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

/**
 * Nilai yang disisipkan ke template di-escape, bukan dipercaya. Nama dan nama
 * perusahaan bisa berasal dari berkas Excel yang diserahkan pihak lain —
 * sebuah sel berisi `<script>` yang lolos ke badan surat adalah injeksi yang
 * dikirim ke kotak surat orang lain atas nama kita.
 */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    language: String(row.language),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function listTemplates() {
  const { client } = await getDatabase();
  const hasil = await client.execute(
    "SELECT * FROM cms_prospect_templates WHERE deleted_at IS NULL ORDER BY name",
  );
  return ok({ items: hasil.rows.map(mapTemplate) }, 200, { "Cache-Control": "no-store" });
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
      (id,name,subject,body_html,language,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, input.name, input.subject, input.bodyHtml, input.language, user.id, timestamp, timestamp],
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
function renderTemplate(sumber: string, prospect: ReturnType<typeof mapProspect>) {
  const nilai: Record<string, string> = {
    nama: prospect.fullName,
    perusahaan: prospect.companyName,
    jabatan: prospect.jobTitle,
    kota: prospect.location,
    segmen: prospect.segment ?? "",
  };
  return sumber.replace(prospectPlaceholderPattern, (utuh, kunci: string) =>
    kunci in nilai ? escapeHtml(nilai[kunci]) : utuh,
  );
}

async function previewTemplate(request: Request, id: string) {
  const input = z
    .object({ prospectId: z.string().uuid() })
    .parse(await jsonBody(request));
  const { client } = await getDatabase();
  const template = await loadTemplate(client, id);
  const prospect = await loadProspect(client, input.prospectId);
  return ok({
    subject: renderTemplate(String(template.subject), prospect),
    bodyHtml: renderTemplate(String(template.body_html), prospect),
    recipient: prospect.email,
  });
}

// ── Pengiriman ───────────────────────────────────────────────────────

async function sendOutreach(request: Request, user: AuthUser) {
  const input = sendSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();

  let templateId: string | null = null;
  let templateName = "Surat langsung";
  let subjectSumber = input.subject ?? "";
  let bodySumber = input.bodyHtml ?? "";
  if (input.templateId) {
    const template = await loadTemplate(client, input.templateId);
    templateId = String(template.id);
    templateName = String(template.name);
    subjectSumber = String(template.subject);
    bodySumber = String(template.body_html);
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
  const antre: { prospectId: string; outreachId: string; status: string; scheduledFor: string }[] = [];
  for (const [urutan, p] of penerima.entries()) {
    // Pesan ke-N dijadwalkan N x jeda ke depan. Mailcow yang membawa surat ini
    // juga membawa invoice dan tautan reset kata sandi; puluhan email yang
    // tiba sekaligus membahayakan keduanya.
    const jadwal = new Date(mulai + urutan * spacing * 1_000).toISOString();
    const subject = renderTemplate(subjectSumber, p);
    const html = renderTemplate(bodySumber, p);
    const kirim = await sendEmailDelivery(client, {
      recipient: p.email,
      eventType: "prospect_outreach",
      subject,
      html,
      notBefore: jadwal,
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
         scheduled_for,failure_reason,outbox_id,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        outreachId,
        p.id,
        templateId,
        templateName,
        p.email,
        subject,
        html,
        status,
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
    dikirim: antre.length,
    dilewati: dilewati.length,
    spacingSeconds: spacing,
  });

  return ok({
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

  for (const baris of kontak) {
    if (baris.email) {
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
          code: "EMAIL_TIDAK_SAH",
          detail: `${baris.sheet} baris ${baris.row}: ${baris.email} sudah dipakai prospek lain. Baris dilewati.`,
        });
        dilewati += 1;
        continue;
      }
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
  const user = await admin(request);
  const action = path[1];

  if (!action) {
    if (request.method === "GET") return listProspects(request);
    if (request.method === "POST") return createProspect(request, user);
  }
  if (action === "outreach" && request.method === "POST") {
    return sendOutreach(request, user);
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
  const user = await admin(request);
  const id = path[1];

  if (!id) {
    if (request.method === "GET") return listTemplates();
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
