import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requireUser, type AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { sendEmailDelivery } from "../email";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";

const statuses = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost", "Spam"] as const;
const statusSchema = z.enum(statuses);

const publicLeadSchema = z.object({
  fullName: z.string().trim().min(2).max(180),
  whatsapp: z.string().trim().regex(/^\+?[0-9 ()-]{9,24}$/),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  companyName: z.string().trim().max(180).optional().default(""),
  jobTitle: z.string().trim().max(180).optional().default(""),
  location: z.string().trim().min(2).max(240),
  serviceInterest: z.string().trim().min(2).max(180),
  budgetRange: z.string().trim().max(100).optional().default(""),
  targetStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  message: z.string().trim().min(8).max(4_000),
  privacyConsent: z.literal(true),
  sourcePath: z.string().trim().max(240).default("/"),
  language: z.enum(["id", "en"]).default("id"),
  turnstileToken: z.string().trim().max(2_048).optional().default(""),
  website: z.string().max(180).optional().default(""),
});

const patchLeadSchema = z.object({
  status: statusSchema.optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(2).max(4_000).optional(),
  retentionUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}T/).optional(),
}).refine((value) => Object.keys(value).length > 0, "Tidak ada perubahan yang dikirim.");

function admin(request: Request) {
  return requireUser(request, ["Admin"]);
}

function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function fingerprint(request: Request) {
  const secret =
    process.env.LEAD_FINGERPRINT_SECRET ??
    process.env.SESSION_SECRET ??
    process.env.SEED_ADMIN_PASSWORD ??
    "perumnet-local-lead-rate-limit";
  const input = `${clientIp(request)}|${request.headers.get("user-agent") ?? "unknown"}`;
  return createHmac("sha256", secret).update(input).digest("hex");
}

async function enforceRateLimit(client: DatabaseClient, request: Request) {
  const hash = fingerprint(request);
  const routeKey = "cms-lead-submit";
  const now = new Date();
  const current = await client.execute({
    sql: "SELECT * FROM public_form_rate_limits WHERE fingerprint_hash=? AND route_key=? LIMIT 1",
    args: [hash, routeKey],
  });
  const row = current.rows[0];
  if (row?.blocked_until && new Date(String(row.blocked_until)) > now) {
    throw new ApiError(429, "RATE_LIMITED", "Terlalu banyak permintaan. Silakan coba lagi nanti.");
  }
  const windowStart = row?.window_started_at ? new Date(String(row.window_started_at)) : now;
  const withinWindow = now.getTime() - windowStart.getTime() < 15 * 60_000;
  const nextCount = withinWindow ? Number(row?.request_count ?? 0) + 1 : 1;
  const blockedUntil = nextCount > 5 ? new Date(now.getTime() + 30 * 60_000).toISOString() : null;
  await client.execute({
    sql: `INSERT INTO public_form_rate_limits
      (fingerprint_hash,route_key,window_started_at,request_count,blocked_until,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT (fingerprint_hash,route_key) DO UPDATE SET
        window_started_at=excluded.window_started_at,
        request_count=excluded.request_count,
        blocked_until=excluded.blocked_until,
        updated_at=excluded.updated_at`,
    args: [
      hash,
      routeKey,
      withinWindow ? windowStart.toISOString() : now.toISOString(),
      nextCount,
      blockedUntil,
      now.toISOString(),
    ],
  });
  if (blockedUntil) {
    throw new ApiError(429, "RATE_LIMITED", "Terlalu banyak permintaan. Silakan coba lagi dalam 30 menit.");
  }
}

async function verifyTurnstile(request: Request, token: string, idempotencyKey: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return;
  if (!token) throw new ApiError(422, "TURNSTILE_REQUIRED", "Selesaikan verifikasi keamanan terlebih dahulu.");
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  form.set("remoteip", clientIp(request));
  form.set("idempotency_key", idempotencyKey);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null) as
    | { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] }
    | null;
  if (!response.ok || !result?.success) {
    throw new ApiError(422, "TURNSTILE_FAILED", "Verifikasi keamanan gagal atau sudah kedaluwarsa. Silakan coba lagi.");
  }
  const allowedHosts = (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "enterprise.perumnet.id,demo-enterprise.perumnet.com,localhost")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (result.hostname && !allowedHosts.includes(result.hostname)) {
    throw new ApiError(422, "TURNSTILE_HOST_MISMATCH", "Verifikasi keamanan tidak sesuai dengan situs ini.");
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function submitLead(request: Request) {
  const idempotencyKey =
    request.headers.get("idempotency-key")?.trim() ??
    "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Kunci idempotensi form belum valid.");
  }
  const input = publicLeadSchema.parse(await jsonBody(request));
  if (input.website) return created({ received: true });
  const { client } = await getDatabase();
  const existing = await client.execute({
    sql: "SELECT id,created_at FROM cms_leads WHERE idempotency_key=? LIMIT 1",
    args: [idempotencyKey],
  });
  if (existing.rows[0]) {
    return ok({ id: existing.rows[0].id, received: true, duplicate: true });
  }
  await enforceRateLimit(client, request);
  await verifyTurnstile(request, input.turnstileToken, idempotencyKey);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const retentionUntil = new Date(Date.now() + 730 * 86_400_000).toISOString();
  try {
    await client.execute({
      sql: `INSERT INTO cms_leads
        (id,idempotency_key,full_name,whatsapp,email,company_name,job_title,location,
         service_interest,budget_range,target_start,message,privacy_consent_at,source_path,
         language,status,retention_until,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id,
        idempotencyKey,
        input.fullName,
        input.whatsapp,
        input.email || null,
        input.companyName || null,
        input.jobTitle || null,
        input.location,
        input.serviceInterest,
        input.budgetRange || null,
        input.targetStart || null,
        input.message,
        timestamp,
        input.sourcePath,
        input.language,
        "New",
        retentionUntil,
        timestamp,
        timestamp,
      ],
    });
  } catch (error) {
    const duplicate = await client.execute({
      sql: "SELECT id FROM cms_leads WHERE idempotency_key=? LIMIT 1",
      args: [idempotencyKey],
    });
    if (duplicate.rows[0]) {
      return ok({ id: duplicate.rows[0].id, received: true, duplicate: true });
    }
    throw error;
  }
  await sendEmailDelivery(client, {
    recipient: "enterprise@perumnet.id",
    eventType: "cms.lead.created",
    subject: `Lead baru: ${input.fullName} — ${input.serviceInterest}`,
    respectPreference: false,
    html: `<div style="font-family:Arial,sans-serif;color:#203f4d">
      <h2>Customer lead baru</h2>
      <p><strong>${escapeHtml(input.fullName)}</strong> dari ${escapeHtml(input.location)} tertarik pada ${escapeHtml(input.serviceInterest)}.</p>
      <p>${escapeHtml(input.message).replaceAll("\n", "<br />")}</p>
      <p>WhatsApp: ${escapeHtml(input.whatsapp)}${input.email ? `<br />Email: ${escapeHtml(input.email)}` : ""}</p>
      <p><a href="${escapeHtml(new URL("/panel", process.env.APP_URL ?? "http://localhost:3000").toString())}">Buka Customer Leads</a></p>
    </div>`,
  });
  return created({ id, received: true });
}

export async function anonymizeExpiredLeads(client: DatabaseClient) {
  const timestamp = new Date().toISOString();
  const expired = await client.execute({
    sql: `SELECT id FROM cms_leads
      WHERE anonymized_at IS NULL AND deleted_at IS NULL AND retention_until<?`,
    args: [timestamp],
  });
  if (!expired.rows.length) return 0;
  await client.execute({
    sql: `UPDATE cms_leads SET
      full_name='Data dianonimkan',whatsapp='',email=NULL,company_name=NULL,job_title=NULL,
      location='',message='',budget_range=NULL,target_start=NULL,assigned_to=NULL,
      anonymized_at=?,updated_at=?
      WHERE anonymized_at IS NULL AND deleted_at IS NULL AND retention_until<?`,
    args: [timestamp, timestamp, timestamp],
  });
  await client.batch(expired.rows.map((row) => ({
    sql: `INSERT INTO audit_logs
      (id,user_id,action,entity,entity_id,metadata_json,ip_address,created_at)
      VALUES (?,NULL,'retention_anonymize','cms_lead',?,?,NULL,?)`,
    args: [
      randomUUID(),
      row.id,
      JSON.stringify({ reason: "retention_expired", piiRemoved: true }),
      timestamp,
    ],
  })), "write");
  return expired.rows.length;
}

function leadWhere(url: URL) {
  const clauses = ["l.deleted_at IS NULL"];
  const args: unknown[] = [];
  const status = url.searchParams.get("status");
  if (status && statuses.includes(status as (typeof statuses)[number])) {
    clauses.push("l.status=?");
    args.push(status);
  }
  const assignedTo = url.searchParams.get("assignedTo");
  if (assignedTo) {
    clauses.push("l.assigned_to=?");
    args.push(assignedTo);
  }
  const query = url.searchParams.get("q")?.trim().toLowerCase();
  if (query) {
    clauses.push(`(
      lower(l.full_name) LIKE ? OR lower(COALESCE(l.company_name,'')) LIKE ? OR
      lower(l.whatsapp) LIKE ? OR lower(COALESCE(l.email,'')) LIKE ? OR
      lower(l.service_interest) LIKE ? OR lower(l.location) LIKE ?
    )`);
    const pattern = `%${query.slice(0, 120)}%`;
    args.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    clauses.push("l.created_at>=?");
    args.push(`${from}T00:00:00.000Z`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    clauses.push("l.created_at<?");
    args.push(`${to}T23:59:59.999Z`);
  }
  return { clauses, args };
}

function mapLead(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    whatsapp: String(row.whatsapp ?? ""),
    email: row.email ? String(row.email) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    jobTitle: row.job_title ? String(row.job_title) : null,
    location: String(row.location ?? ""),
    serviceInterest: String(row.service_interest),
    budgetRange: row.budget_range ? String(row.budget_range) : null,
    targetStart: row.target_start ? String(row.target_start) : null,
    message: String(row.message ?? ""),
    sourcePath: String(row.source_path),
    language: String(row.language),
    status: String(row.status),
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    assignedName: row.assigned_name ? String(row.assigned_name) : null,
    retentionUntil: String(row.retention_until),
    anonymizedAt: row.anonymized_at ? String(row.anonymized_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function listLeads(request: Request) {
  const { client } = await getDatabase();
  await anonymizeExpiredLeads(client);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get("pageSize") ?? 25) || 25));
  const { clauses, args } = leadWhere(url);
  const where = `WHERE ${clauses.join(" AND ")}`;
  const [rows, count, staff] = await Promise.all([
    client.execute({
      sql: `SELECT l.*,u.name AS assigned_name FROM cms_leads l
        LEFT JOIN users u ON u.id=l.assigned_to ${where}
        ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      args: [...args, pageSize, (page - 1) * pageSize],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total FROM cms_leads l ${where}`,
      args,
    }),
    client.execute("SELECT id,name,role FROM users WHERE status='Aktif' ORDER BY name"),
  ]);
  return ok({
    items: rows.rows.map(mapLead),
    page,
    pageSize,
    total: Number(count.rows[0]?.total ?? 0),
    staff: staff.rows.map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.role) })),
  }, 200, { "Cache-Control": "no-store" });
}

async function getLead(id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT l.*,u.name AS assigned_name FROM cms_leads l
      LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=? AND l.deleted_at IS NULL LIMIT 1`,
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Customer lead tidak ditemukan.");
  const notes = await client.execute({
    sql: `SELECT n.*,u.name AS created_by_name FROM cms_lead_notes n
      LEFT JOIN users u ON u.id=n.created_by WHERE n.lead_id=? ORDER BY n.created_at DESC`,
    args: [id],
  });
  return ok({
    ...mapLead(result.rows[0]),
    notes: notes.rows.map((row) => ({
      id: String(row.id),
      type: String(row.note_type),
      body: String(row.body),
      fromStatus: row.from_status ? String(row.from_status) : null,
      toStatus: row.to_status ? String(row.to_status) : null,
      createdBy: row.created_by_name ? String(row.created_by_name) : null,
      createdAt: String(row.created_at),
    })),
  });
}

async function patchLead(request: Request, id: string, user: AuthUser) {
  const input = patchLeadSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  const currentResult = await client.execute({
    sql: "SELECT * FROM cms_leads WHERE id=? AND deleted_at IS NULL LIMIT 1",
    args: [id],
  });
  const current = currentResult.rows[0];
  if (!current) throw new ApiError(404, "NOT_FOUND", "Customer lead tidak ditemukan.");
  if (input.assignedTo) {
    const assignee = await client.execute({
      sql: "SELECT id FROM users WHERE id=? AND status='Aktif' LIMIT 1",
      args: [input.assignedTo],
    });
    if (!assignee.rows[0]) throw new ApiError(422, "INVALID_ASSIGNEE", "Penanggung jawab tidak aktif atau tidak ditemukan.");
  }
  const timestamp = new Date().toISOString();
  const retentionExtended = input.retentionUntil && input.retentionUntil > String(current.retention_until);
  await client.execute({
    sql: `UPDATE cms_leads SET status=?,assigned_to=?,retention_until=?,
      retention_extended_at=?,retention_extended_by=?,updated_at=? WHERE id=?`,
    args: [
      input.status ?? current.status,
      input.assignedTo === undefined ? current.assigned_to : input.assignedTo,
      input.retentionUntil ?? current.retention_until,
      retentionExtended ? timestamp : current.retention_extended_at,
      retentionExtended ? user.id : current.retention_extended_by,
      timestamp,
      id,
    ],
  });
  const notes: Array<{ type: string; body: string; from?: string; to?: string }> = [];
  if (input.status && input.status !== current.status) {
    notes.push({ type: "status", body: `Status diubah dari ${current.status} menjadi ${input.status}.`, from: String(current.status), to: input.status });
  }
  if (input.assignedTo !== undefined && input.assignedTo !== current.assigned_to) {
    notes.push({ type: "assignment", body: input.assignedTo ? "Penanggung jawab lead diperbarui." : "Penanggung jawab lead dilepas." });
  }
  if (retentionExtended) {
    notes.push({ type: "retention", body: `Retensi diperpanjang sampai ${input.retentionUntil}.` });
  }
  if (input.note) notes.push({ type: "note", body: input.note });
  if (notes.length) {
    await client.batch(notes.map((note) => ({
      sql: `INSERT INTO cms_lead_notes
        (id,lead_id,note_type,body,from_status,to_status,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      args: [randomUUID(), id, note.type, note.body, note.from ?? null, note.to ?? null, user.id, timestamp],
    })), "write");
  }
  await writeAuditLog(client, request, user, "update", "cms_lead", id, {
    status: input.status,
    assignedTo: input.assignedTo,
    retentionExtended,
    noteAdded: Boolean(input.note),
  });
  return getLead(id);
}

async function deleteLead(request: Request, id: string, user: AuthUser) {
  const { client } = await getDatabase();
  const timestamp = new Date().toISOString();
  const current = await client.execute({
    sql: "SELECT id FROM cms_leads WHERE id=? AND deleted_at IS NULL LIMIT 1",
    args: [id],
  });
  if (!current.rows[0]) throw new ApiError(404, "NOT_FOUND", "Customer lead tidak ditemukan.");
  await client.execute({
    sql: `UPDATE cms_leads SET
      full_name='Data dihapus atas permintaan',whatsapp='',email=NULL,company_name=NULL,
      job_title=NULL,location='',message='',budget_range=NULL,target_start=NULL,
      assigned_to=NULL,anonymized_at=?,deleted_at=?,updated_at=? WHERE id=?`,
    args: [timestamp, timestamp, timestamp, id],
  });
  await writeAuditLog(client, request, user, "privacy_delete", "cms_lead", id, {
    piiRemoved: true,
  });
  return noContent();
}

function safeSpreadsheetText(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown) {
  const safe = safeSpreadsheetText(value).replaceAll('"', '""');
  return `"${safe}"`;
}

async function exportRows(url: URL) {
  const { client } = await getDatabase();
  await anonymizeExpiredLeads(client);
  const { clauses, args } = leadWhere(url);
  const result = await client.execute({
    sql: `SELECT l.*,u.name AS assigned_name FROM cms_leads l
      LEFT JOIN users u ON u.id=l.assigned_to
      WHERE ${clauses.join(" AND ")} ORDER BY l.created_at DESC LIMIT 10000`,
    args,
  });
  return { client, rows: result.rows.map(mapLead) };
}

const exportHeaders = [
  "Tanggal", "Nama", "WhatsApp", "Email", "Perusahaan", "Jabatan", "Lokasi",
  "Layanan", "Budget", "Target Mulai", "Status", "Penanggung Jawab", "Sumber", "Kebutuhan",
] as const;

function exportValues(lead: ReturnType<typeof mapLead>) {
  return [
    lead.createdAt.slice(0, 10),
    lead.fullName,
    lead.whatsapp,
    lead.email,
    lead.companyName,
    lead.jobTitle,
    lead.location,
    lead.serviceInterest,
    lead.budgetRange,
    lead.targetStart,
    lead.status,
    lead.assignedName,
    lead.sourcePath,
    lead.message,
  ];
}

async function exportLeads(request: Request, format: "csv" | "xlsx" | "pdf", user: AuthUser) {
  const url = new URL(request.url);
  const { client, rows } = await exportRows(url);
  const timestamp = new Date().toISOString();
  await writeAuditLog(client, request, user, "export", "cms_leads", undefined, {
    format,
    rowCount: rows.length,
    filters: {
      status: url.searchParams.get("status"),
      assignedTo: url.searchParams.get("assignedTo"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      hasSearch: Boolean(url.searchParams.get("q")),
    },
  });
  const fileDate = timestamp.slice(0, 10);
  if (format === "csv") {
    const body = [
      exportHeaders.map(csvCell).join(","),
      ...rows.map((lead) => exportValues(lead).map(csvCell).join(",")),
    ].join("\r\n");
    return new Response(`\uFEFF${body}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-leads-${fileDate}.csv"`,
      },
    });
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PerumNet Enterprise";
    const sheet = workbook.addWorksheet("Customer Leads", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = exportHeaders.map((header, index) => ({
      header,
      key: `c${index}`,
      width: index === 13 ? 48 : Math.max(14, Math.min(28, header.length + 8)),
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF078E87" } };
    for (const lead of rows) {
      const values = exportValues(lead).map(safeSpreadsheetText);
      values[0] = lead.createdAt ? new Date(lead.createdAt) as unknown as string : "";
      values[9] = lead.targetStart ? new Date(`${lead.targetStart}T00:00:00.000Z`) as unknown as string : "";
      sheet.addRow(values);
    }
    sheet.getColumn(1).numFmt = "yyyy-mm-dd";
    sheet.getColumn(10).numFmt = "yyyy-mm-dd";
    sheet.autoFilter = { from: "A1", to: "N1" };
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="customer-leads-${fileDate}.xlsx"`,
      },
    });
  }
  const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  document.setFillColor(7, 142, 135);
  document.rect(0, 0, 297, 24, "F");
  document.setTextColor(255, 255, 255);
  document.setFontSize(16);
  document.text("PerumNet Enterprise — Customer Leads", 12, 15);
  document.setTextColor(32, 63, 77);
  document.setFontSize(8);
  const widths = [25, 34, 28, 35, 38, 35, 32, 28];
  const headers = ["Tanggal", "Nama", "WhatsApp", "Email", "Lokasi", "Layanan", "Status", "PIC"];
  let y = 32;
  const drawHeader = () => {
    document.setFillColor(231, 246, 245);
    document.rect(10, y - 5, 277, 8, "F");
    let x = 11;
    headers.forEach((header, index) => {
      document.setFont("helvetica", "bold");
      document.text(header, x, y);
      x += widths[index];
    });
    document.setFont("helvetica", "normal");
    y += 7;
  };
  drawHeader();
  for (const lead of rows) {
    if (y > 195) {
      document.addPage();
      y = 18;
      drawHeader();
    }
    let x = 11;
    const values = [
      lead.createdAt.slice(0, 10), lead.fullName, lead.whatsapp, lead.email ?? "",
      lead.location, lead.serviceInterest, lead.status, lead.assignedName ?? "",
    ];
    values.forEach((value, index) => {
      document.text(document.splitTextToSize(String(value), widths[index] - 3).slice(0, 2), x, y);
      x += widths[index];
    });
    y += 9;
    document.setDrawColor(226, 235, 235);
    document.line(10, y - 4, 287, y - 4);
  }
  return new Response(document.output("arraybuffer"), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="customer-leads-${fileDate}.pdf"`,
    },
  });
}

export async function dispatchLeadApi(request: Request, path: string[]) {
  if (path.length === 1 && request.method === "POST") return submitLead(request);
  const user = await admin(request);
  if (path.length === 1 && request.method === "GET") return listLeads(request);
  const action = path[1];
  if (action === "export.csv" && request.method === "GET") return exportLeads(request, "csv", user);
  if (action === "export.xlsx" && request.method === "GET") return exportLeads(request, "xlsx", user);
  if (action === "export.pdf" && request.method === "GET") return exportLeads(request, "pdf", user);
  if (!action) throw new ApiError(404, "NOT_FOUND", "Customer lead tidak ditemukan.");
  if (request.method === "GET") return getLead(action);
  if (request.method === "PATCH") return patchLead(request, action, user);
  if (request.method === "DELETE") return deleteLead(request, action, user);
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Aksi customer lead tidak didukung.");
}
