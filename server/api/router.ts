import "server-only";

import { randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import {
  canAccess,
  defaultPermissions,
  normalizePermissions,
  type AccessModule,
  type AccessPermissions,
} from "@/shared/access";
import { writeAuditLog } from "../audit";
import {
  createPasswordResetToken,
  createSession,
  getSessionUser,
  hashResetToken,
  requireUser,
  revokeSession,
  verifyCredentials,
  withClearedSessionCookie,
  withSessionCookie,
  type AuthUser,
  type UserRole,
} from "../auth";
import { getDatabase } from "../db/client";
import { asNumber, formatDate, initials, parseJson } from "../format";
import { readProjectFile, storeProjectFile } from "../storage";
import {
  ApiError,
  assertSameOrigin,
  created,
  jsonBody,
  noContent,
  ok,
} from "./errors";
import { renderBusinessPdf } from "./pdf";

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gunakan format tanggal YYYY-MM-DD.");
const nonNegativeMoney = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMoney = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  remember: z.boolean().default(true),
});

const projectSchema = z.object({
  name: z.string().trim().min(3).max(160),
  client: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(160).default("Bali"),
  status: z.enum(["Aktif", "Selesai", "Draft"]).default("Draft"),
  startDate: isoDateSchema.optional(),
  targetDate: isoDateSchema.optional(),
  value: nonNegativeMoney.default(0),
  managerId: idSchema.optional(),
});

const taskSchema = z.object({
  name: z.string().trim().min(2).max(200),
  ownerId: idSchema.optional(),
  owner: z.string().trim().min(2).max(120),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  status: z.enum(["Selesai", "Berjalan", "Belum Mulai"]).default("Belum Mulai"),
});

const boqItemSchema = z.object({
  category: z.enum(["Perangkat", "Material", "Jasa", "Mobilitas"]),
  description: z.string().trim().min(2).max(240),
  quantity: z.number().int().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  costPrice: nonNegativeMoney,
  sellingPrice: nonNegativeMoney,
});

const invoiceSchema = z.object({
  projectId: idSchema,
  type: z.string().trim().min(2).max(80),
  issueDate: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)),
  dueDate: isoDateSchema,
  amount: positiveMoney,
});

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(100),
  contact: z.string().trim().min(3).max(100),
  email: z.union([z.literal(""), emailSchema]).optional(),
  address: z.string().trim().max(300).optional(),
  rate: nonNegativeMoney.default(0),
  status: z.enum(["Aktif", "Nonaktif"]).default("Aktif"),
});

const spkSchema = z.object({
  vendorId: idSchema,
  projectId: idSchema,
  scope: z.string().trim().min(5).max(2_000),
  cost: positiveMoney,
  status: z.enum(["Draft", "Dikirim", "Dikerjakan", "Selesai"]).default("Draft"),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
});

const transactionSchema = z.object({
  projectId: idSchema.optional(),
  date: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)),
  type: z.enum(["Pemasukan", "Pengeluaran"]),
  description: z.string().trim().min(2).max(300),
  amount: positiveMoney,
  source: z.string().trim().min(2).max(80),
});

const bastSchema = z.object({
  projectId: idSchema,
  completionDate: isoDateSchema,
  notes: z.string().trim().min(5).max(4_000),
  installedItems: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(200),
        quantity: z.string().trim().min(1).max(80),
        status: z.string().trim().min(1).max(60),
      }),
    )
    .min(1)
    .max(200),
  clientName: z.string().trim().min(2).max(120),
  clientRole: z.string().trim().min(2).max(120),
  clientSignature: z.string().max(1_500_000).optional(),
  engineerName: z.string().trim().min(2).max(120),
  engineerSignature: z.string().max(1_500_000).optional(),
  status: z.enum(["Draft", "Final"]).default("Draft"),
});

const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  role: z.enum(["Admin", "Project Manager", "Engineer", "Finance"]),
  status: z.enum(["Aktif", "Nonaktif"]).default("Aktif"),
  password: z.string().min(10).max(128).optional(),
  permissions: z
    .object({
      dashboard: z.enum(["none", "view", "manage"]),
      projects: z.enum(["none", "view", "manage"]),
      boq: z.enum(["none", "view", "manage"]),
      billing: z.enum(["none", "view", "manage"]),
      procurement: z.enum(["none", "view", "manage"]),
      bast: z.enum(["none", "view", "manage"]),
      finance: z.enum(["none", "view", "manage"]),
      users: z.enum(["none", "view", "manage"]),
      settings: z.enum(["none", "view", "manage"]),
    })
    .partial()
    .optional(),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().max(40).optional().default(""),
  jobTitle: z.string().trim().max(120).optional().default(""),
  bio: z.string().trim().max(800).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  birthDate: z.union([z.literal(""), isoDateSchema]).optional().default(""),
});

const settingsSchema = z.object({
  preferredLanguage: z.enum(["id", "en"]),
  emailNotifications: z.boolean(),
});

function now() {
  return new Date().toISOString();
}

function applicationPath(path: string) {
  const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const basePath =
    configuredBasePath && configuredBasePath !== "/"
      ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
      : "";
  return `${basePath}${path}`;
}

function lastActive(value: unknown) {
  if (!value) return "Belum pernah";
  const elapsed = Date.now() - new Date(String(value)).getTime();
  if (elapsed < 5 * 60_000) return "Baru saja";
  if (elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} menit lalu`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / 3_600_000)} jam lalu`;
  return formatDate(value);
}

function makeSequence(prefix: string, count: number) {
  const date = new Date();
  return `${prefix}/PN/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}/${String(count + 1).padStart(3, "0")}`;
}

async function ensureExists(sql: string, args: unknown[], message: string) {
  const { client } = await getDatabase();
  const result = await client.execute({ sql, args: args as never[] });
  if (!result.rows.length) throw new ApiError(404, "NOT_FOUND", message);
  return result.rows[0];
}

function mutationRoles(resource: string): UserRole[] {
  void resource;
  return ["Admin", "Project Manager", "Engineer", "Finance"];
}

const resourceModules: Record<string, AccessModule> = {
  projects: "projects",
  boq: "boq",
  invoices: "billing",
  quotations: "billing",
  vendors: "procurement",
  spks: "procurement",
  bast: "bast",
  transactions: "finance",
  finance: "finance",
  users: "users",
  "audit-logs": "users",
  documents: "projects",
};

function assertAccess(
  user: AuthUser,
  module: AccessModule,
  level: "view" | "manage" = "view",
) {
  if (!canAccess(user.permissions, module, level)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? "Akun Anda tidak memiliki izin untuk mengelola modul ini."
        : "Akun Anda tidak memiliki akses ke modul ini.",
    );
  }
}

function assertMutationAccess(user: AuthUser, resource: string) {
  const accessModule = resourceModules[resource];
  if (accessModule) assertAccess(user, accessModule, "manage");
  if (!mutationRoles(resource).includes(user.role) && user.role !== "Admin") {
    throw new ApiError(403, "FORBIDDEN", "Peran Anda tidak dapat menjalankan tindakan ini.");
  }
}

async function sendResetEmail(email: string, token: string) {
  if (!process.env.RESEND_API_KEY) return false;
  const baseUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "PerumNet Enterprise <noreply@perumnet.id>",
      to: [email],
      subject: "Pemulihan kata sandi PerumNet Enterprise",
      html: `<p>Gunakan tautan berikut dalam 30 menit untuk mengatur ulang kata sandi:</p><p><a href="${baseUrl}/?resetToken=${encodeURIComponent(token)}">Atur ulang kata sandi</a></p>`,
    }),
  });
  if (!response.ok) console.error("Gagal mengirim email reset:", await response.text());
  return response.ok;
}

async function handleAuth(request: Request, path: string[]) {
  const action = path[1];
  if (request.method === "GET" && action === "session") {
    return ok({ user: await getSessionUser(request) }, 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "POST" && action === "login") {
    const input = loginSchema.parse(await jsonBody(request));
    const user = await verifyCredentials(input.email, input.password);
    const session = await createSession(user.id, input.remember);
    return withSessionCookie(ok({ user }), session.token, session.maxAge);
  }

  if (request.method === "POST" && action === "logout") {
    await revokeSession(request);
    return withClearedSessionCookie(ok({ success: true }));
  }

  if (request.method === "POST" && action === "forgot-password") {
    const input = z.object({ email: emailSchema }).parse(await jsonBody(request));
    const { client } = await getDatabase();
    const result = await client.execute({
      sql: "SELECT id,email FROM users WHERE lower(email) = lower(?) AND status = 'Aktif' LIMIT 1",
      args: [input.email],
    });

    let developmentToken: string | undefined;
    if (result.rows[0]) {
      const token = await createPasswordResetToken(client, String(result.rows[0].id));
      await sendResetEmail(String(result.rows[0].email), token);
      if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
        developmentToken = token;
      }
    }
    return ok({
      message: "Jika email terdaftar, tautan pemulihan telah dikirim.",
      ...(developmentToken ? { resetToken: developmentToken } : {}),
    });
  }

  if (request.method === "POST" && action === "reset-password") {
    const input = z
      .object({ token: z.string().min(32).max(200), password: z.string().min(8).max(128) })
      .parse(await jsonBody(request));
    const { client } = await getDatabase();
    const result = await client.execute({
      sql: "SELECT id,user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1",
      args: [hashResetToken(input.token), now()],
    });
    const reset = result.rows[0];
    if (!reset) throw new ApiError(400, "INVALID_RESET_TOKEN", "Tautan reset tidak valid atau sudah kedaluwarsa.");
    const passwordHash = await hash(input.password, 12);
    const timestamp = now();
    await client.batch(
      [
        {
          sql: "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
          args: [passwordHash, timestamp, reset.user_id],
        },
        {
          sql: "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?",
          args: [timestamp, reset.id],
        },
        {
          sql: "DELETE FROM sessions WHERE user_id = ?",
          args: [reset.user_id],
        },
      ],
      "write",
    );
    return ok({ success: true });
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint autentikasi tidak ditemukan.");
}

async function listProjects(searchParams: URLSearchParams) {
  const { client } = await getDatabase();
  const status = searchParams.get("status");
  const query = searchParams.get("q")?.trim();
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (status && status !== "Semua") {
    conditions.push("p.status = ?");
    args.push(status);
  }
  if (query) {
    conditions.push("(lower(p.name) LIKE ? OR lower(p.client) LIKE ? OR lower(p.code) LIKE ? OR lower(p.location) LIKE ?)");
    const pattern = `%${query.toLowerCase()}%`;
    args.push(pattern, pattern, pattern, pattern);
  }

  const result = await client.execute({
    sql: `
      SELECT p.*, manager.name AS manager_name,
        (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'Selesai') AS completed_count,
        (SELECT COALESCE(SUM(i.amount), 0) FROM invoices i WHERE i.project_id = p.id) AS invoice_total,
        (SELECT COALESCE(SUM(i.amount), 0) FROM invoices i WHERE i.project_id = p.id AND i.status = 'Lunas') AS paid_total,
        (SELECT group_concat(u.name, '|') FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = p.id) AS team_names
      FROM projects p
      LEFT JOIN users manager ON manager.id = p.manager_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY p.created_at DESC, p.code DESC
    `,
    args: args as never[],
  });

  return result.rows.map((row) => {
    const taskCount = asNumber(row.task_count);
    const completedCount = asNumber(row.completed_count);
    const invoiceTotal = asNumber(row.invoice_total);
    const paidTotal = asNumber(row.paid_total);
    const progress = taskCount
      ? Math.round((completedCount / taskCount) * 100)
      : row.status === "Selesai"
        ? 100
        : 0;
    const paidRatio = invoiceTotal ? Math.min(100, Math.round((paidTotal / invoiceTotal) * 100)) : 0;
    const payment =
      !invoiceTotal
        ? "Belum Ada Tagihan"
        : paidRatio >= 100
          ? "Lunas"
          : paidRatio > 0
            ? "Sebagian"
            : "Belum Dibayar";
    const teamNames = row.team_names ? String(row.team_names).split("|") : [];

    return {
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      client: String(row.client),
      location: String(row.location),
      status: String(row.status),
      progress,
      payment,
      paidRatio,
      startDate: formatDate(row.start_date),
      targetDate: row.target_date ? formatDate(row.target_date) : "Belum ditentukan",
      startDateIso: row.start_date,
      targetDateIso: row.target_date,
      value: asNumber(row.value),
      manager: row.manager_name ? String(row.manager_name) : "Belum ditentukan",
      managerId: row.manager_id,
      team: teamNames.map(initials),
      teamNames,
    };
  });
}

async function handleProjects(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const projectId = path[1];
  const child = path[2];
  const childId = path[3];

  if (request.method === "GET" && !projectId) {
    return ok(await listProjects(new URL(request.url).searchParams));
  }

  if (request.method === "POST" && !projectId) {
    if (!mutationRoles("projects").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Hanya Admin atau Project Manager yang dapat membuat proyek.");
    const input = projectSchema.parse(await jsonBody(request));
    const id = randomUUID();
    const count = await client.execute("SELECT COUNT(*) AS count FROM projects");
    const code = `PN-${new Date().getUTCFullYear().toString().slice(-2)}${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-${String(asNumber(count.rows[0]?.count) + 1).padStart(3, "0")}`;
    const timestamp = now();
    await client.batch(
      [
        {
          sql: "INSERT INTO projects (id,code,name,client,location,status,start_date,target_date,value,manager_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [id, code, input.name, input.client, input.location, input.status, input.startDate ?? null, input.targetDate ?? null, input.value, input.managerId ?? user.id, user.id, timestamp, timestamp],
        },
        {
          sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
          args: [id, input.managerId ?? user.id, timestamp],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "create", "project", id, input);
    const projects = await listProjects(new URLSearchParams());
    return created(projects.find((project) => project.id === id));
  }

  if (projectId && child === "tasks") {
    await ensureExists("SELECT id FROM projects WHERE id = ?", [projectId], "Proyek tidak ditemukan.");

    if (request.method === "GET" && !childId) {
      const result = await client.execute({
        sql: "SELECT * FROM project_tasks WHERE project_id = ? ORDER BY sort_order, created_at",
        args: [projectId],
      });
      const count = result.rows.length || 1;
      return ok(
        result.rows.map((row, index) => ({
          id: String(row.id),
          name: String(row.name),
          owner: String(row.owner_name),
          ownerId: row.owner_id,
          start: Math.round((index / count) * 82),
          duration: Math.max(14, Math.round(82 / count) + 4),
          startLabel: formatDate(row.start_date).replace(/\s+\d{4}$/, ""),
          endLabel: row.end_date ? formatDate(row.end_date).replace(/\s+\d{4}$/, "") : "Belum diatur",
          startDate: row.start_date,
          endDate: row.end_date,
          status: String(row.status),
        })),
      );
    }

    if (request.method === "POST" && !childId) {
      const input = taskSchema.parse(await jsonBody(request));
      const id = randomUUID();
      const count = await client.execute({
        sql: "SELECT COUNT(*) AS count FROM project_tasks WHERE project_id = ?",
        args: [projectId],
      });
      const timestamp = now();
      await client.execute({
        sql: "INSERT INTO project_tasks (id,project_id,name,owner_id,owner_name,start_date,end_date,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        args: [id, projectId, input.name, input.ownerId ?? null, input.owner, input.startDate ?? null, input.endDate ?? null, input.status, asNumber(count.rows[0]?.count), timestamp, timestamp],
      });
      await writeAuditLog(client, request, user, "create", "project_task", id, { projectId });
      return created({ id, ...input });
    }

    if (childId && request.method === "PATCH") {
      const input = taskSchema.partial().parse(await jsonBody(request));
      const current = await ensureExists(
        "SELECT * FROM project_tasks WHERE id = ? AND project_id = ?",
        [childId, projectId],
        "Tugas tidak ditemukan.",
      );
      await client.execute({
        sql: "UPDATE project_tasks SET name=?,owner_id=?,owner_name=?,start_date=?,end_date=?,status=?,updated_at=? WHERE id=? AND project_id=?",
        args: [
          input.name ?? current.name,
          input.ownerId === undefined ? current.owner_id : input.ownerId,
          input.owner ?? current.owner_name,
          input.startDate === undefined ? current.start_date : input.startDate,
          input.endDate === undefined ? current.end_date : input.endDate,
          input.status ?? current.status,
          now(),
          childId,
          projectId,
        ],
      });
      await writeAuditLog(client, request, user, "update", "project_task", childId, input);
      return ok({ id: childId, ...input });
    }

    if (childId && request.method === "DELETE") {
      await client.execute({ sql: "DELETE FROM project_tasks WHERE id = ? AND project_id = ?", args: [childId, projectId] });
      await writeAuditLog(client, request, user, "delete", "project_task", childId, { projectId });
      return noContent();
    }
  }

  if (projectId && child === "documents") {
    await ensureExists("SELECT id FROM projects WHERE id = ?", [projectId], "Proyek tidak ditemukan.");
    if (request.method === "GET") {
      const result = await client.execute({
        sql: "SELECT id,name,mime_type,size,uploader_name,created_at,storage_url FROM project_documents WHERE project_id = ? ORDER BY created_at DESC",
        args: [projectId],
      });
      return ok(result.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        type: String(row.mime_type).startsWith("image/") ? "image" : "file",
        mimeType: String(row.mime_type),
        size: asNumber(row.size),
        date: formatDate(row.created_at),
        uploader: String(row.uploader_name),
        preview:
          row.storage_url && /^https?:\/\//.test(String(row.storage_url))
            ? row.storage_url
            : applicationPath(`/api/documents/${row.id}/content`),
      })));
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(422, "FILE_REQUIRED", "Pilih file yang akan diunggah.");
      if (file.size > 5 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran file maksimal 5 MB.");
      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(file.type)) throw new ApiError(415, "UNSUPPORTED_FILE", "Format yang didukung: JPG, PNG, WebP, dan PDF.");
      const id = randomUUID();
      const stored = await storeProjectFile(id, file.type, await file.arrayBuffer());
      await client.execute({
        sql: "INSERT INTO project_documents (id,project_id,name,mime_type,size,storage_url,content_base64,uploaded_by,uploader_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [id, projectId, file.name.slice(0, 240), file.type, file.size, stored.storageUrl, stored.contentBase64, user.id, user.name, now()],
      });
      await writeAuditLog(client, request, user, "upload", "project_document", id, { projectId, name: file.name, size: file.size });
      return created({ id, name: file.name, type: file.type.startsWith("image/") ? "image" : "file", date: "Baru saja", uploader: user.name, preview: applicationPath(`/api/documents/${id}/content`) });
    }
  }

  if (projectId && child === "quotation.pdf" && request.method === "GET") {
    return renderBusinessPdf("quotation", projectId);
  }

  if (projectId && !child && request.method === "GET") {
    const projects = await listProjects(new URLSearchParams());
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
    return ok(project);
  }

  if (projectId && !child && request.method === "PATCH") {
    if (!mutationRoles("projects").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah proyek.");
    const input = projectSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM projects WHERE id = ?", [projectId], "Proyek tidak ditemukan.");
    await client.execute({
      sql: "UPDATE projects SET name=?,client=?,location=?,status=?,start_date=?,target_date=?,value=?,manager_id=?,updated_at=? WHERE id=?",
      args: [
        input.name ?? current.name,
        input.client ?? current.client,
        input.location ?? current.location,
        input.status ?? current.status,
        input.startDate === undefined ? current.start_date : input.startDate,
        input.targetDate === undefined ? current.target_date : input.targetDate,
        input.value ?? current.value,
        input.managerId === undefined ? current.manager_id : input.managerId,
        now(),
        projectId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "project", projectId, input);
    const projects = await listProjects(new URLSearchParams());
    return ok(projects.find((project) => project.id === projectId));
  }

  if (projectId && !child && request.method === "DELETE") {
    await client.execute({ sql: "DELETE FROM projects WHERE id = ?", args: [projectId] });
    await writeAuditLog(client, request, user, "delete", "project", projectId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint proyek tidak ditemukan.");
}

async function getBoq(projectId: string) {
  const { client } = await getDatabase();
  const project = await ensureExists(
    "SELECT id,name,code,client FROM projects WHERE id = ?",
    [projectId],
    "Proyek tidak ditemukan.",
  );
  const result = await client.execute({
    sql: "SELECT * FROM boqs WHERE project_id = ? LIMIT 1",
    args: [projectId],
  });
  const boq = result.rows[0];
  if (!boq) {
    return {
      id: null,
      project: {
        id: String(project.id),
        name: String(project.name),
        code: String(project.code),
        client: String(project.client),
      },
      status: "Draft",
      items: [],
      totals: { cost: 0, selling: 0, margin: 0, marginPercentage: 0 },
    };
  }
  const itemsResult = await client.execute({
    sql: "SELECT * FROM boq_items WHERE boq_id = ? ORDER BY sort_order, created_at",
    args: [boq.id],
  });
  const items = itemsResult.rows.map((row) => ({
    id: String(row.id),
    category: String(row.category),
    description: String(row.description),
    quantity: asNumber(row.quantity),
    unit: String(row.unit),
    costPrice: asNumber(row.cost_price),
    sellingPrice: asNumber(row.selling_price),
  }));
  const cost = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
  const selling = items.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0);
  const margin = selling - cost;
  return {
    id: String(boq.id),
    project: {
      id: String(project.id),
      name: String(project.name),
      code: String(project.code),
      client: String(project.client),
    },
    status: String(boq.status),
    notes: boq.notes,
    items,
    totals: {
      cost,
      selling,
      margin,
      marginPercentage: selling ? (margin / selling) * 100 : 0,
    },
  };
}

async function ensureBoq(projectId: string) {
  const { client } = await getDatabase();
  const existing = await client.execute({
    sql: "SELECT id FROM boqs WHERE project_id = ? LIMIT 1",
    args: [projectId],
  });
  if (existing.rows[0]) return String(existing.rows[0].id);
  const id = randomUUID();
  const timestamp = now();
  await client.execute({
    sql: "INSERT INTO boqs (id,project_id,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    args: [id, projectId, "Draft", "", timestamp, timestamp],
  });
  return id;
}

async function handleBoq(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId") ?? "project-1";
  const child = path[1];
  const childId = path[2];

  if (child === "templates") {
    if (request.method === "GET" && !childId) {
      const result = await client.execute(`
        SELECT t.*, COUNT(i.id) AS item_count
        FROM boq_templates t
        LEFT JOIN boq_template_items i ON i.template_id = t.id
        GROUP BY t.id
        ORDER BY t.updated_at DESC
      `);
      return ok(result.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        items: asNumber(row.item_count),
        lastUsed: lastActive(row.updated_at),
      })));
    }

    if (request.method === "POST" && !childId) {
      if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menyimpan template BoQ.");
      const input = z
        .object({
          name: z.string().trim().min(2).max(160),
          items: z.array(boqItemSchema).min(1).max(500),
        })
        .parse(await jsonBody(request));
      const id = randomUUID();
      const timestamp = now();
      const statements = [
        {
          sql: "INSERT INTO boq_templates (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)",
          args: [id, input.name, user.id, timestamp, timestamp],
        },
        ...input.items.map((item, index) => ({
          sql: "INSERT INTO boq_template_items (id,template_id,category,description,quantity,unit,cost_price,selling_price,sort_order) VALUES (?,?,?,?,?,?,?,?,?)",
          args: [randomUUID(), id, item.category, item.description, item.quantity, item.unit, item.costPrice, item.sellingPrice, index],
        })),
      ];
      await client.batch(statements, "write");
      await writeAuditLog(client, request, user, "create", "boq_template", id, { name: input.name, itemCount: input.items.length });
      return created({ id, name: input.name, items: input.items.length, lastUsed: "Baru saja" });
    }

    if (childId && request.method === "GET") {
      const template = await ensureExists(
        "SELECT * FROM boq_templates WHERE id = ?",
        [childId],
        "Template tidak ditemukan.",
      );
      const result = await client.execute({
        sql: "SELECT * FROM boq_template_items WHERE template_id = ? ORDER BY sort_order",
        args: [childId],
      });
      return ok({
        id: String(template.id),
        name: String(template.name),
        items: result.rows.map((row) => ({
          id: String(row.id),
          category: String(row.category),
          description: String(row.description),
          quantity: asNumber(row.quantity),
          unit: String(row.unit),
          costPrice: asNumber(row.cost_price),
          sellingPrice: asNumber(row.selling_price),
        })),
      });
    }

    if (childId && request.method === "DELETE") {
      if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus template.");
      await client.execute({ sql: "DELETE FROM boq_templates WHERE id = ?", args: [childId] });
      await writeAuditLog(client, request, user, "delete", "boq_template", childId);
      return noContent();
    }
  }

  await ensureExists("SELECT id FROM projects WHERE id = ?", [projectId], "Proyek tidak ditemukan.");

  if (request.method === "GET" && !child) {
    return ok(await getBoq(projectId));
  }

  if (request.method === "PUT" && !child) {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah BoQ.");
    const input = z
      .object({
        status: z.enum(["Draft", "Final"]).default("Draft"),
        notes: z.string().max(4_000).optional(),
        items: z.array(boqItemSchema.extend({ id: idSchema.optional() })).max(500),
      })
      .parse(await jsonBody(request));
    const boqId = await ensureBoq(projectId);
    const timestamp = now();
    const statements = [
      {
        sql: "UPDATE boqs SET status=?,notes=?,updated_at=? WHERE id=?",
        args: [input.status, input.notes ?? "", timestamp, boqId],
      },
      { sql: "DELETE FROM boq_items WHERE boq_id = ?", args: [boqId] },
      ...input.items.map((item, index) => ({
        sql: "INSERT INTO boq_items (id,boq_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        args: [item.id ?? randomUUID(), boqId, item.category, item.description, item.quantity, item.unit, item.costPrice, item.sellingPrice, index, timestamp, timestamp],
      })),
    ];
    await client.batch(statements, "write");
    await writeAuditLog(client, request, user, "replace", "boq", boqId, { projectId, itemCount: input.items.length });
    return ok(await getBoq(projectId));
  }

  if (request.method === "POST" && child === "items") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menambah item BoQ.");
    const input = boqItemSchema.parse(await jsonBody(request));
    const boqId = await ensureBoq(projectId);
    const count = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM boq_items WHERE boq_id = ?",
      args: [boqId],
    });
    const id = randomUUID();
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO boq_items (id,boq_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, boqId, input.category, input.description, input.quantity, input.unit, input.costPrice, input.sellingPrice, asNumber(count.rows[0]?.count), timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "boq_item", id, { projectId });
    return created({ id, ...input });
  }

  if (child === "items" && childId && request.method === "PATCH") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah item BoQ.");
    const input = boqItemSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists(
      "SELECT i.* FROM boq_items i JOIN boqs b ON b.id=i.boq_id WHERE i.id=? AND b.project_id=?",
      [childId, projectId],
      "Item BoQ tidak ditemukan.",
    );
    await client.execute({
      sql: "UPDATE boq_items SET category=?,description=?,quantity=?,unit=?,cost_price=?,selling_price=?,updated_at=? WHERE id=?",
      args: [
        input.category ?? current.category,
        input.description ?? current.description,
        input.quantity ?? current.quantity,
        input.unit ?? current.unit,
        input.costPrice ?? current.cost_price,
        input.sellingPrice ?? current.selling_price,
        now(),
        childId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "boq_item", childId, input);
    return ok({ id: childId, ...input });
  }

  if (child === "items" && childId && request.method === "DELETE") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus item BoQ.");
    await client.execute({ sql: "DELETE FROM boq_items WHERE id = ?", args: [childId] });
    await writeAuditLog(client, request, user, "delete", "boq_item", childId, { projectId });
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BoQ tidak ditemukan.");
}

async function handleQuotations(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
  await ensureExists("SELECT id FROM projects WHERE id=?", [projectId], "Proyek tidak ditemukan.");

  if (request.method === "GET") {
    const result = await client.execute({
      sql: "SELECT id,number,status,issued_at,valid_until,total FROM quotations WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
      args: [projectId],
    });
    const row = result.rows[0];
    return ok(row ? {
      id: String(row.id),
      number: String(row.number),
      status: String(row.status),
      issuedAt: String(row.issued_at),
      validUntil: row.valid_until ? String(row.valid_until) : null,
      total: asNumber(row.total),
    } : { status: "Draft" });
  }

  if (request.method === "PATCH") {
    assertAccess(user, "billing", "manage");
    const input = z.object({ status: z.enum(["Draft", "Sent"]) }).parse(await jsonBody(request));
    const current = await client.execute({
      sql: "SELECT id FROM quotations WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
      args: [projectId],
    });
    const timestamp = now();
    let quotationId = current.rows[0] ? String(current.rows[0].id) : "";
    if (quotationId) {
      await client.execute({
        sql: "UPDATE quotations SET status=?,updated_at=? WHERE id=?",
        args: [input.status, timestamp, quotationId],
      });
      await writeAuditLog(client, request, user, "update_status", "quotation", quotationId, input);
    } else {
      const boq = await getBoq(projectId);
      const count = await client.execute("SELECT COUNT(*) AS count FROM quotations");
      quotationId = randomUUID();
      await client.execute({
        sql: "INSERT INTO quotations (id,project_id,number,status,issued_at,valid_until,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        args: [
          quotationId,
          projectId,
          makeSequence("QUO", asNumber(count.rows[0]?.count)),
          input.status,
          timestamp.slice(0, 10),
          new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
          boq.totals.selling,
          timestamp,
          timestamp,
        ],
      });
      await writeAuditLog(client, request, user, "create", "quotation", quotationId, { projectId, status: input.status });
    }
    const result = await client.execute({
      sql: "SELECT id,number,status,issued_at,valid_until,total FROM quotations WHERE id=?",
      args: [quotationId],
    });
    const row = result.rows[0];
    return ok({
      id: String(row.id),
      number: String(row.number),
      status: String(row.status),
      issuedAt: String(row.issued_at),
      validUntil: row.valid_until ? String(row.valid_until) : null,
      total: asNumber(row.total),
    });
  }

  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

function mapInvoice(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    project: row.project_name ? String(row.project_name) : undefined,
    number: String(row.number),
    type: String(row.type),
    issueDate: formatDate(row.issue_date),
    dueDate: formatDate(row.due_date),
    issueDateIso: String(row.issue_date),
    dueDateIso: String(row.due_date),
    amount: asNumber(row.amount),
    status: String(row.status),
    paidDate: row.paid_date ? formatDate(row.paid_date) : undefined,
  };
}

async function getInvoice(client: Awaited<ReturnType<typeof getDatabase>>["client"], id: string) {
  const result = await client.execute({
    sql: "SELECT i.*,p.name AS project_name FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.id=? LIMIT 1",
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  return mapInvoice(result.rows[0] as Record<string, unknown>);
}

async function handleInvoices(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const invoiceId = path[1];
  const action = path[2];

  if (request.method === "GET" && !invoiceId) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const result = await client.execute({
      sql: `SELECT i.*,p.name AS project_name FROM invoices i JOIN projects p ON p.id=i.project_id ${projectId ? "WHERE i.project_id=?" : ""} ORDER BY i.issue_date DESC,i.created_at DESC`,
      args: projectId ? [projectId] : [],
    });
    return ok(result.rows.map((row) => mapInvoice(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !invoiceId) {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat invoice.");
    const input = invoiceSchema.parse(await jsonBody(request));
    await ensureExists("SELECT id FROM projects WHERE id=?", [input.projectId], "Proyek tidak ditemukan.");
    const count = await client.execute("SELECT COUNT(*) AS count FROM invoices");
    const id = randomUUID();
    const timestamp = now();
    const number = makeSequence("INV", asNumber(count.rows[0]?.count));
    await client.execute({
      sql: "INSERT INTO invoices (id,project_id,number,type,issue_date,due_date,amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [id, input.projectId, number, input.type, input.issueDate, input.dueDate, input.amount, "Belum Lunas", timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "invoice", id, input);
    return created(await getInvoice(client, id));
  }

  if (invoiceId && action === "pdf" && request.method === "GET") {
    return renderBusinessPdf("invoice", invoiceId);
  }

  if (invoiceId && action === "payment" && request.method === "POST") {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengonfirmasi pembayaran.");
    const invoice = await ensureExists(
      "SELECT * FROM invoices WHERE id=?",
      [invoiceId],
      "Invoice tidak ditemukan.",
    );
    if (invoice.status === "Lunas") return ok(await getInvoice(client, invoiceId));
    const input = z.object({ paidDate: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)) }).parse(await jsonBody(request));
    const timestamp = now();
    await client.batch(
      [
        {
          sql: "UPDATE invoices SET status='Lunas',paid_date=?,updated_at=? WHERE id=?",
          args: [input.paidDate, timestamp, invoiceId],
        },
        {
          sql: "INSERT INTO transactions (id,project_id,date,type,description,amount,source,reference_id,created_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE reference_id=?)",
          args: [randomUUID(), invoice.project_id, input.paidDate, "Pemasukan", `Pembayaran ${invoice.number}`, invoice.amount, "Invoice", invoiceId, user.id, timestamp, timestamp, invoiceId],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "confirm_payment", "invoice", invoiceId, input);
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "GET") {
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "PATCH") {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah invoice.");
    const input = invoiceSchema.omit({ projectId: true }).partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM invoices WHERE id=?", [invoiceId], "Invoice tidak ditemukan.");
    await client.execute({
      sql: "UPDATE invoices SET type=?,issue_date=?,due_date=?,amount=?,updated_at=? WHERE id=?",
      args: [input.type ?? current.type, input.issueDate ?? current.issue_date, input.dueDate ?? current.due_date, input.amount ?? current.amount, now(), invoiceId],
    });
    await writeAuditLog(client, request, user, "update", "invoice", invoiceId, input);
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "DELETE") {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus invoice.");
    await client.execute({ sql: "DELETE FROM invoices WHERE id=?", args: [invoiceId] });
    await writeAuditLog(client, request, user, "delete", "invoice", invoiceId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint invoice tidak ditemukan.");
}

function mapVendor(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    contact: String(row.contact),
    email: row.email ? String(row.email) : undefined,
    address: row.address ? String(row.address) : undefined,
    rate: asNumber(row.rate),
    status: String(row.status),
  };
}

async function handleVendors(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const vendorId = path[1];

  if (request.method === "GET" && !vendorId) {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q")?.toLowerCase().trim();
    const category = searchParams.get("category");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (query) {
      conditions.push("(lower(name) LIKE ? OR lower(category) LIKE ? OR lower(contact) LIKE ?)");
      args.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (category && category !== "Semua kategori") {
      conditions.push("category=?");
      args.push(category);
    }
    const result = await client.execute({
      sql: `SELECT * FROM vendors ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY status,name`,
      args: args as never[],
    });
    return ok(result.rows.map((row) => mapVendor(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !vendorId) {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menambah vendor.");
    const input = vendorSchema.parse(await jsonBody(request));
    const id = randomUUID();
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO vendors (id,name,category,contact,email,address,rate,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [id, input.name, input.category, input.contact, input.email || null, input.address ?? null, input.rate, input.status, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "vendor", id, input);
    return created({ id, ...input });
  }

  if (vendorId && request.method === "GET") {
    const row = await ensureExists("SELECT * FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    return ok(mapVendor(row as Record<string, unknown>));
  }

  if (vendorId && request.method === "PATCH") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah vendor.");
    const input = vendorSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    await client.execute({
      sql: "UPDATE vendors SET name=?,category=?,contact=?,email=?,address=?,rate=?,status=?,updated_at=? WHERE id=?",
      args: [
        input.name ?? current.name,
        input.category ?? current.category,
        input.contact ?? current.contact,
        input.email === undefined ? current.email : input.email || null,
        input.address === undefined ? current.address : input.address,
        input.rate ?? current.rate,
        input.status ?? current.status,
        now(),
        vendorId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "vendor", vendorId, input);
    const updated = await ensureExists("SELECT * FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    return ok(mapVendor(updated as Record<string, unknown>));
  }

  if (vendorId && request.method === "DELETE") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus vendor.");
    const usage = await client.execute({ sql: "SELECT id FROM spks WHERE vendor_id=? LIMIT 1", args: [vendorId] });
    if (usage.rows.length) throw new ApiError(409, "VENDOR_IN_USE", "Vendor masih digunakan oleh SPK dan tidak dapat dihapus.");
    await client.execute({ sql: "DELETE FROM vendors WHERE id=?", args: [vendorId] });
    await writeAuditLog(client, request, user, "delete", "vendor", vendorId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint vendor tidak ditemukan.");
}

function mapSpk(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    number: String(row.number),
    vendorId: String(row.vendor_id),
    vendor: String(row.vendor_name),
    projectId: String(row.project_id),
    project: String(row.project_name),
    scope: String(row.scope),
    cost: asNumber(row.cost),
    status: String(row.status),
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

async function getSpk(id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT s.*,v.name AS vendor_name,p.name AS project_name FROM spks s JOIN vendors v ON v.id=s.vendor_id JOIN projects p ON p.id=s.project_id WHERE s.id=? LIMIT 1",
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "SPK tidak ditemukan.");
  return mapSpk(result.rows[0] as Record<string, unknown>);
}

async function handleSpks(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const spkId = path[1];
  const action = path[2];

  if (request.method === "GET" && !spkId) {
    const result = await client.execute(`
      SELECT s.*,v.name AS vendor_name,p.name AS project_name
      FROM spks s JOIN vendors v ON v.id=s.vendor_id JOIN projects p ON p.id=s.project_id
      ORDER BY s.created_at DESC
    `);
    return ok(result.rows.map((row) => mapSpk(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !spkId) {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat SPK.");
    const input = spkSchema.parse(await jsonBody(request));
    await ensureExists("SELECT id FROM vendors WHERE id=? AND status='Aktif'", [input.vendorId], "Vendor aktif tidak ditemukan.");
    await ensureExists("SELECT id FROM projects WHERE id=?", [input.projectId], "Proyek tidak ditemukan.");
    const count = await client.execute("SELECT COUNT(*) AS count FROM spks");
    const id = randomUUID();
    const number = makeSequence("SPK", asNumber(count.rows[0]?.count));
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO spks (id,number,vendor_id,project_id,scope,cost,status,start_date,end_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, number, input.vendorId, input.projectId, input.scope, input.cost, input.status, input.startDate ?? null, input.endDate ?? null, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "spk", id, input);
    return created(await getSpk(id));
  }

  if (spkId && action === "pdf" && request.method === "GET") {
    return renderBusinessPdf("spk", spkId);
  }

  if (spkId && action === "status" && request.method === "PATCH") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah status SPK.");
    const input = z.object({ status: z.enum(["Draft", "Dikirim", "Dikerjakan", "Selesai"]) }).parse(await jsonBody(request));
    await ensureExists("SELECT id FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    await client.execute({ sql: "UPDATE spks SET status=?,updated_at=? WHERE id=?", args: [input.status, now(), spkId] });
    await writeAuditLog(client, request, user, "update_status", "spk", spkId, input);
    return ok(await getSpk(spkId));
  }

  if (spkId && !action && request.method === "GET") {
    return ok(await getSpk(spkId));
  }

  if (spkId && !action && request.method === "PATCH") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah SPK.");
    const input = spkSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    await client.execute({
      sql: "UPDATE spks SET vendor_id=?,project_id=?,scope=?,cost=?,status=?,start_date=?,end_date=?,updated_at=? WHERE id=?",
      args: [
        input.vendorId ?? current.vendor_id,
        input.projectId ?? current.project_id,
        input.scope ?? current.scope,
        input.cost ?? current.cost,
        input.status ?? current.status,
        input.startDate === undefined ? current.start_date : input.startDate,
        input.endDate === undefined ? current.end_date : input.endDate,
        now(),
        spkId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "spk", spkId, input);
    return ok(await getSpk(spkId));
  }

  if (spkId && !action && request.method === "DELETE") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus SPK.");
    await client.execute({ sql: "DELETE FROM spks WHERE id=?", args: [spkId] });
    await writeAuditLog(client, request, user, "delete", "spk", spkId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint SPK tidak ditemukan.");
}

function mapBast(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    number: String(row.number),
    projectId: String(row.project_id),
    project: row.project_name ? String(row.project_name) : undefined,
    client: row.project_client ? String(row.project_client) : undefined,
    location: row.project_location ? String(row.project_location) : undefined,
    completionDate: String(row.completion_date),
    notes: String(row.notes),
    installedItems: parseJson(row.installed_items_json, []),
    clientName: String(row.client_name),
    clientRole: String(row.client_role),
    clientSignature: row.client_signature ? String(row.client_signature) : "",
    engineerName: String(row.engineer_name),
    engineerSignature: row.engineer_signature ? String(row.engineer_signature) : "",
    status: String(row.status),
  };
}

async function getBast(id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT b.*,p.name AS project_name,p.client AS project_client,p.location AS project_location FROM basts b JOIN projects p ON p.id=b.project_id WHERE b.id=? LIMIT 1",
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "BAST tidak ditemukan.");
  return mapBast(result.rows[0] as Record<string, unknown>);
}

async function handleBast(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const bastId = path[1];
  const action = path[2];

  if (request.method === "GET" && !bastId) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const result = await client.execute({
      sql: `SELECT b.*,p.name AS project_name,p.client AS project_client,p.location AS project_location FROM basts b JOIN projects p ON p.id=b.project_id ${projectId ? "WHERE b.project_id=?" : ""} ORDER BY b.created_at DESC`,
      args: projectId ? [projectId] : [],
    });
    return ok(result.rows.map((row) => mapBast(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !bastId) {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat BAST.");
    const input = bastSchema.parse(await jsonBody(request));
    await ensureExists("SELECT id FROM projects WHERE id=?", [input.projectId], "Proyek tidak ditemukan.");
    const count = await client.execute("SELECT COUNT(*) AS count FROM basts");
    const id = randomUUID();
    const number = makeSequence("BAST", asNumber(count.rows[0]?.count));
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO basts (id,number,project_id,completion_date,notes,installed_items_json,client_name,client_role,client_signature,engineer_name,engineer_signature,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, number, input.projectId, input.completionDate, input.notes, JSON.stringify(input.installedItems), input.clientName, input.clientRole, input.clientSignature ?? null, input.engineerName, input.engineerSignature ?? null, input.status, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "bast", id, { projectId: input.projectId, status: input.status });
    return created(await getBast(id));
  }

  if (bastId && action === "pdf" && request.method === "GET") {
    return renderBusinessPdf("bast", bastId);
  }

  if (bastId && !action && request.method === "GET") {
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "PATCH") {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah BAST.");
    const input = bastSchema.omit({ projectId: true }).partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await client.execute({
      sql: "UPDATE basts SET completion_date=?,notes=?,installed_items_json=?,client_name=?,client_role=?,client_signature=?,engineer_name=?,engineer_signature=?,status=?,updated_at=? WHERE id=?",
      args: [
        input.completionDate ?? current.completion_date,
        input.notes ?? current.notes,
        input.installedItems ? JSON.stringify(input.installedItems) : current.installed_items_json,
        input.clientName ?? current.client_name,
        input.clientRole ?? current.client_role,
        input.clientSignature === undefined ? current.client_signature : input.clientSignature,
        input.engineerName ?? current.engineer_name,
        input.engineerSignature === undefined ? current.engineer_signature : input.engineerSignature,
        input.status ?? current.status,
        now(),
        bastId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "bast", bastId, { status: input.status });
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "DELETE") {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus BAST.");
    await client.execute({ sql: "DELETE FROM basts WHERE id=?", args: [bastId] });
    await writeAuditLog(client, request, user, "delete", "bast", bastId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BAST tidak ditemukan.");
}

function mapTransaction(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    date: formatDate(row.date),
    dateIso: String(row.date),
    type: String(row.type),
    projectId: row.project_id ? String(row.project_id) : undefined,
    project: row.project_name ? String(row.project_name) : "Umum",
    description: String(row.description),
    amount: asNumber(row.amount),
    source: String(row.source),
  };
}

async function handleTransactions(request: Request, path: string[], user: AuthUser) {
  assertAccess(user, "finance", request.method === "GET" ? "view" : "manage");
  const { client } = await getDatabase();
  const transactionId = path[1];

  if (request.method === "GET" && !transactionId) {
    const searchParams = new URL(request.url).searchParams;
    const projectId = searchParams.get("projectId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      conditions.push("t.project_id=?");
      args.push(projectId);
    }
    if (from) {
      conditions.push("t.date>=?");
      args.push(from);
    }
    if (to) {
      conditions.push("t.date<=?");
      args.push(to);
    }
    const result = await client.execute({
      sql: `SELECT t.*,p.name AS project_name FROM transactions t LEFT JOIN projects p ON p.id=t.project_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY t.date DESC,t.created_at DESC`,
      args: args as never[],
    });
    return ok(result.rows.map((row) => mapTransaction(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !transactionId) {
    const input = transactionSchema.parse(await jsonBody(request));
    if (input.projectId) await ensureExists("SELECT id FROM projects WHERE id=?", [input.projectId], "Proyek tidak ditemukan.");
    const id = randomUUID();
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO transactions (id,project_id,date,type,description,amount,source,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [id, input.projectId ?? null, input.date, input.type, input.description, input.amount, input.source, user.id, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "transaction", id, input);
    const row = await ensureExists("SELECT t.*,p.name AS project_name FROM transactions t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?", [id], "Transaksi tidak ditemukan.");
    return created(mapTransaction(row as Record<string, unknown>));
  }

  if (transactionId && request.method === "PATCH") {
    const input = transactionSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM transactions WHERE id=?", [transactionId], "Transaksi tidak ditemukan.");
    await client.execute({
      sql: "UPDATE transactions SET project_id=?,date=?,type=?,description=?,amount=?,source=?,updated_at=? WHERE id=?",
      args: [
        input.projectId === undefined ? current.project_id : input.projectId,
        input.date ?? current.date,
        input.type ?? current.type,
        input.description ?? current.description,
        input.amount ?? current.amount,
        input.source ?? current.source,
        now(),
        transactionId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "transaction", transactionId, input);
    const row = await ensureExists("SELECT t.*,p.name AS project_name FROM transactions t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?", [transactionId], "Transaksi tidak ditemukan.");
    return ok(mapTransaction(row as Record<string, unknown>));
  }

  if (transactionId && request.method === "DELETE") {
    await client.execute({ sql: "DELETE FROM transactions WHERE id=?", args: [transactionId] });
    await writeAuditLog(client, request, user, "delete", "transaction", transactionId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint transaksi tidak ditemukan.");
}

async function handleFinance(request: Request, user: AuthUser) {
  assertAccess(user, "finance", "view");
  if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  const { client } = await getDatabase();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (projectId) {
    conditions.push("project_id=?");
    args.push(projectId);
  }
  if (from) {
    conditions.push("date>=?");
    args.push(from);
  }
  if (to) {
    conditions.push("date<=?");
    args.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totals = await client.execute({
    sql: `SELECT COALESCE(SUM(CASE WHEN type='Pemasukan' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN type='Pengeluaran' THEN amount ELSE 0 END),0) AS expense FROM transactions ${where}`,
    args: args as never[],
  });
  const monthly = await client.execute({
    sql: `SELECT substr(date,1,7) AS month,COALESCE(SUM(CASE WHEN type='Pemasukan' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN type='Pengeluaran' THEN amount ELSE 0 END),0) AS expense FROM transactions ${where} GROUP BY substr(date,1,7) ORDER BY month`,
    args: args as never[],
  });
  const income = asNumber(totals.rows[0]?.income);
  const expense = asNumber(totals.rows[0]?.expense);
  return ok({
    income,
    expense,
    profit: income - expense,
    margin: income ? ((income - expense) / income) * 100 : 0,
    monthly: monthly.rows.map((row) => ({
      month: String(row.month),
      income: asNumber(row.income),
      expense: asNumber(row.expense),
    })),
  });
}

function mapUser(row: Record<string, unknown>) {
  const role = String(row.role) as UserRole;
  let storedPermissions: Partial<AccessPermissions> | undefined;
  try {
    storedPermissions = row.permissions_json
      ? (JSON.parse(String(row.permissions_json)) as Partial<AccessPermissions>)
      : undefined;
  } catch {
    storedPermissions = undefined;
  }
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role,
    status: String(row.status),
    lastActive: lastActive(row.last_active_at),
    permissions: normalizePermissions(role, storedPermissions),
  };
}

async function handleUsers(request: Request, path: string[], user: AuthUser) {
  assertAccess(user, "users", request.method === "GET" ? "view" : "manage");
  const { client } = await getDatabase();
  const userId = path[1];

  if (request.method === "GET" && !userId) {
    const result = await client.execute(`
      SELECT u.*,up.permissions_json
      FROM users u
      LEFT JOIN user_permissions up ON up.user_id=u.id
      ORDER BY u.status,u.name
    `);
    return ok(result.rows.map((row) => mapUser(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !userId) {
    const input = userSchema.parse(await jsonBody(request));
    if (!input.password) {
      throw new ApiError(400, "PASSWORD_REQUIRED", "Tetapkan kata sandi awal minimal 10 karakter.");
    }
    const duplicate = await client.execute({ sql: "SELECT id FROM users WHERE lower(email)=lower(?)", args: [input.email] });
    if (duplicate.rows.length) throw new ApiError(409, "EMAIL_EXISTS", "Email sudah digunakan oleh pengguna lain.");
    const id = randomUUID();
    const timestamp = now();
    const permissions = normalizePermissions(input.role, input.permissions);
    await client.batch(
      [
        {
          sql: "INSERT INTO users (id,name,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          args: [id, input.name, input.email, await hash(input.password, 12), input.role, input.status, timestamp, timestamp],
        },
        {
          sql: "INSERT INTO user_permissions (user_id,permissions_json,updated_at) VALUES (?,?,?)",
          args: [id, JSON.stringify(permissions), timestamp],
        },
        {
          sql: "INSERT INTO user_profiles (user_id,preferred_language,email_notifications,updated_at) VALUES (?,?,?,?)",
          args: [id, "id", 1, timestamp],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "create", "user", id, { name: input.name, email: input.email, role: input.role });
    return created({
      id,
      name: input.name,
      email: input.email,
      role: input.role,
      status: input.status,
      lastActive: "Belum pernah",
      permissions,
    });
  }

  if (userId && request.method === "PATCH") {
    const input = userSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM users WHERE id=?", [userId], "Pengguna tidak ditemukan.");
    if (userId === user.id && input.status === "Nonaktif") throw new ApiError(409, "SELF_DEACTIVATE", "Anda tidak dapat menonaktifkan akun sendiri.");
    if (input.email) {
      const duplicate = await client.execute({
        sql: "SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?",
        args: [input.email, userId],
      });
      if (duplicate.rows.length) throw new ApiError(409, "EMAIL_EXISTS", "Email sudah digunakan oleh pengguna lain.");
    }
    const passwordHash = input.password ? await hash(input.password, 12) : current.password_hash;
    const nextRole = (input.role ?? current.role) as UserRole;
    const currentPermissionResult = await client.execute({
      sql: "SELECT permissions_json FROM user_permissions WHERE user_id=?",
      args: [userId],
    });
    const currentPermissionRow = currentPermissionResult.rows[0];
    let currentPermissions: Partial<AccessPermissions> | undefined;
    try {
      currentPermissions = currentPermissionRow?.permissions_json
        ? JSON.parse(String(currentPermissionRow.permissions_json))
        : undefined;
    } catch {
      currentPermissions = undefined;
    }
    const permissions = normalizePermissions(
      nextRole,
      input.permissions ?? (input.role && input.role !== current.role ? defaultPermissions(nextRole) : currentPermissions),
    );
    if (userId === user.id && permissions.users !== "manage") {
      throw new ApiError(409, "SELF_LOCKOUT", "Akun sendiri harus tetap memiliki akses Kelola pada Pengguna & Akses.");
    }
    const timestamp = now();
    await client.batch(
      [
        {
          sql: "UPDATE users SET name=?,email=?,password_hash=?,role=?,status=?,updated_at=? WHERE id=?",
          args: [input.name ?? current.name, input.email ?? current.email, passwordHash, nextRole, input.status ?? current.status, timestamp, userId],
        },
        {
          sql: `
            INSERT INTO user_permissions (user_id,permissions_json,updated_at) VALUES (?,?,?)
            ON CONFLICT (user_id) DO UPDATE SET permissions_json=excluded.permissions_json,updated_at=excluded.updated_at
          `,
          args: [userId, JSON.stringify(permissions), timestamp],
        },
      ],
      "write",
    );
    if (input.status === "Nonaktif" || input.password) {
      await client.execute({ sql: "DELETE FROM sessions WHERE user_id=?", args: [userId] });
    }
    await writeAuditLog(client, request, user, "update", "user", userId, { ...input, password: input.password ? "[updated]" : undefined });
    const updated = await ensureExists(
      "SELECT u.*,up.permissions_json FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id WHERE u.id=?",
      [userId],
      "Pengguna tidak ditemukan.",
    );
    return ok(mapUser(updated as Record<string, unknown>));
  }

  if (userId && request.method === "DELETE") {
    if (userId === user.id) throw new ApiError(409, "SELF_DELETE", "Anda tidak dapat menghapus akun sendiri.");
    await client.execute({ sql: "DELETE FROM users WHERE id=?", args: [userId] });
    await writeAuditLog(client, request, user, "delete", "user", userId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint pengguna tidak ditemukan.");
}

async function getProfile(userId: string) {
  const row = await ensureExists(
    `
      SELECT u.id,u.name,u.email,u.role,p.phone,p.job_title,p.bio,p.address,p.birth_date,
        p.avatar_mime_type,p.preferred_language,p.email_notifications
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE u.id=?
    `,
    [userId],
    "Profil pengguna tidak ditemukan.",
  );
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role),
    phone: row.phone ? String(row.phone) : "",
    jobTitle: row.job_title ? String(row.job_title) : "",
    bio: row.bio ? String(row.bio) : "",
    address: row.address ? String(row.address) : "",
    birthDate: row.birth_date ? String(row.birth_date) : "",
    preferredLanguage: row.preferred_language === "en" ? "en" : "id",
    emailNotifications: row.email_notifications === null || row.email_notifications === undefined
      ? true
      : Boolean(asNumber(row.email_notifications)),
    avatarUrl: row.avatar_mime_type ? `/api/profile/avatar/${String(row.id)}` : undefined,
  };
}

function hasValidAvatarSignature(content: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") return content[0] === 0xff && content[1] === 0xd8;
  if (mimeType === "image/png") {
    return content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47;
  }
  if (mimeType === "image/webp") {
    return (
      String.fromCharCode(...content.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...content.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

async function handleProfile(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const action = path[1];

  if (action === "avatar" && request.method === "GET") {
    const targetId = path[2] ?? user.id;
    const row = await ensureExists(
      "SELECT avatar_mime_type,avatar_storage_url,avatar_content_base64 FROM user_profiles WHERE user_id=?",
      [targetId],
      "Foto profil tidak ditemukan.",
    );
    const stored = await readProjectFile(row.avatar_storage_url ? String(row.avatar_storage_url) : null);
    const content = stored?.content ??
      (row.avatar_content_base64 ? Buffer.from(String(row.avatar_content_base64), "base64") : null);
    if (!content) throw new ApiError(404, "FILE_MISSING", "Foto profil tidak tersedia.");
    return new Response(content, {
      headers: {
        "Content-Type": String(row.avatar_mime_type),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline",
      },
    });
  }

  if (action === "avatar" && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "Pilih foto profil terlebih dahulu.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new ApiError(400, "INVALID_FILE_TYPE", "Gunakan foto JPG, PNG, atau WebP.");
    }
    if (file.size > 3 * 1024 * 1024) {
      throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran foto maksimal 3 MB.");
    }
    const content = new Uint8Array(await file.arrayBuffer());
    if (!hasValidAvatarSignature(content, file.type)) {
      throw new ApiError(400, "INVALID_FILE", "Isi file tidak sesuai dengan format gambar.");
    }
    const stored = await storeProjectFile(`avatar-${user.id}`, file.type, content.buffer as ArrayBuffer);
    const timestamp = now();
    await client.execute({
      sql: `
        INSERT INTO user_profiles (user_id,avatar_mime_type,avatar_storage_url,avatar_content_base64,preferred_language,email_notifications,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT (user_id) DO UPDATE SET avatar_mime_type=excluded.avatar_mime_type,
          avatar_storage_url=excluded.avatar_storage_url,avatar_content_base64=excluded.avatar_content_base64,
          updated_at=excluded.updated_at
      `,
      args: [user.id, file.type, stored.storageUrl, stored.contentBase64, user.preferredLanguage, 1, timestamp],
    });
    await writeAuditLog(client, request, user, "update_avatar", "user", user.id);
    return ok({ avatarUrl: `/api/profile/avatar/${user.id}?v=${Date.now()}` });
  }

  if (!action && request.method === "GET") {
    return ok(await getProfile(user.id));
  }

  if (!action && request.method === "PATCH") {
    const input = profileSchema.parse(await jsonBody(request));
    const duplicate = await client.execute({
      sql: "SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?",
      args: [input.email, user.id],
    });
    if (duplicate.rows.length) throw new ApiError(409, "EMAIL_EXISTS", "Email sudah digunakan pengguna lain.");
    const timestamp = now();
    await client.batch(
      [
        {
          sql: "UPDATE users SET name=?,email=?,updated_at=? WHERE id=?",
          args: [input.name, input.email, timestamp, user.id],
        },
        {
          sql: `
            INSERT INTO user_profiles (user_id,phone,job_title,bio,address,birth_date,preferred_language,email_notifications,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT (user_id) DO UPDATE SET phone=excluded.phone,job_title=excluded.job_title,
              bio=excluded.bio,address=excluded.address,birth_date=excluded.birth_date,updated_at=excluded.updated_at
          `,
          args: [user.id, input.phone || null, input.jobTitle || null, input.bio || null, input.address || null, input.birthDate || null, user.preferredLanguage, 1, timestamp],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "update_profile", "user", user.id);
    return ok(await getProfile(user.id));
  }

  if (action === "password" && request.method === "PATCH") {
    const input = z.object({
      currentPassword: z.string().min(8).max(128),
      newPassword: z.string().min(10).max(128),
    }).parse(await jsonBody(request));
    const row = await ensureExists("SELECT password_hash FROM users WHERE id=?", [user.id], "Pengguna tidak ditemukan.");
    if (!(await compare(input.currentPassword, String(row.password_hash)))) {
      throw new ApiError(400, "INVALID_PASSWORD", "Kata sandi saat ini tidak sesuai.");
    }
    await client.execute({
      sql: "UPDATE users SET password_hash=?,updated_at=? WHERE id=?",
      args: [await hash(input.newPassword, 12), now(), user.id],
    });
    await writeAuditLog(client, request, user, "change_password", "user", user.id);
    return ok({ success: true });
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint profil tidak ditemukan.");
}

async function handleSettings(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  if (request.method === "GET") {
    const profile = await getProfile(user.id);
    return ok({
      preferredLanguage: profile.preferredLanguage,
      emailNotifications: profile.emailNotifications,
    });
  }
  if (request.method === "PATCH") {
    const input = settingsSchema.parse(await jsonBody(request));
    const timestamp = now();
    await client.execute({
      sql: `
        INSERT INTO user_profiles (user_id,preferred_language,email_notifications,updated_at) VALUES (?,?,?,?)
        ON CONFLICT (user_id) DO UPDATE SET preferred_language=excluded.preferred_language,
          email_notifications=excluded.email_notifications,updated_at=excluded.updated_at
      `,
      args: [user.id, input.preferredLanguage, input.emailNotifications ? 1 : 0, timestamp],
    });
    await writeAuditLog(client, request, user, "update_settings", "user", user.id, input);
    return ok(input);
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

async function handleDocuments(request: Request, path: string[]) {
  if (request.method !== "GET" || path[2] !== "content") throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
  const row = await ensureExists(
    "SELECT name,mime_type,storage_url,content_base64 FROM project_documents WHERE id=?",
    [path[1]],
    "Dokumen tidak ditemukan.",
  );
  if (row.storage_url && /^https?:\/\//.test(String(row.storage_url))) {
    return Response.redirect(String(row.storage_url));
  }
  const stored = await readProjectFile(row.storage_url ? String(row.storage_url) : null);
  if (stored) {
    return new Response(stored.content, {
      headers: {
        "Content-Type": stored.contentType ?? String(row.mime_type),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(row.name))}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }
  if (!row.content_base64) throw new ApiError(404, "FILE_MISSING", "Isi dokumen tidak tersedia.");
  return new Response(Buffer.from(String(row.content_base64), "base64"), {
    headers: {
      "Content-Type": String(row.mime_type),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(row.name))}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

async function handleAudit(request: Request, user: AuthUser) {
  assertAccess(user, "users", "view");
  if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  const { client } = await getDatabase();
  const result = await client.execute(`
    SELECT a.*,u.name AS user_name
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.created_at DESC LIMIT 200
  `);
  return ok(result.rows.map((row) => ({
    id: String(row.id),
    user: row.user_name ? String(row.user_name) : "Sistem",
    action: String(row.action),
    entity: String(row.entity),
    entityId: row.entity_id,
    metadata: parseJson(row.metadata_json, null),
    ipAddress: row.ip_address,
    createdAt: String(row.created_at),
  })));
}

async function handleSearch(request: Request, user: AuthUser) {
  if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase();
  if (!query || query.length < 2) return ok([]);
  const { client } = await getDatabase();
  const pattern = `%${query}%`;
  const [projectResults, invoiceResults, vendorResults] = await Promise.all([
    canAccess(user.permissions, "projects")
      ? client.execute({ sql: "SELECT id,name AS title,code AS subtitle FROM projects WHERE lower(name) LIKE ? OR lower(code) LIKE ? LIMIT 6", args: [pattern, pattern] })
      : Promise.resolve({ rows: [] }),
    canAccess(user.permissions, "billing")
      ? client.execute({ sql: "SELECT id,number AS title,type AS subtitle FROM invoices WHERE lower(number) LIKE ? OR lower(type) LIKE ? LIMIT 6", args: [pattern, pattern] })
      : Promise.resolve({ rows: [] }),
    canAccess(user.permissions, "procurement")
      ? client.execute({ sql: "SELECT id,name AS title,category AS subtitle FROM vendors WHERE lower(name) LIKE ? OR lower(category) LIKE ? LIMIT 6", args: [pattern, pattern] })
      : Promise.resolve({ rows: [] }),
  ]);
  return ok([
    ...projectResults.rows.map((row) => ({ id: row.id, type: "project", title: row.title, subtitle: row.subtitle })),
    ...invoiceResults.rows.map((row) => ({ id: row.id, type: "invoice", title: row.title, subtitle: row.subtitle })),
    ...vendorResults.rows.map((row) => ({ id: row.id, type: "vendor", title: row.title, subtitle: row.subtitle })),
  ]);
}

export async function dispatchApi(request: Request, path: string[]) {
  assertSameOrigin(request);
  const resource = path[0];

  if (resource === "health" && request.method === "GET") {
    const { client } = await getDatabase();
    await client.execute("SELECT 1");
    return ok({ status: "ok", database: "connected", timestamp: now() });
  }
  if (resource === "auth") return handleAuth(request, path);

  const user = await requireUser(request);
  const accessModule = resourceModules[resource];
  if (accessModule) {
    if (request.method === "GET" || request.method === "HEAD") {
      assertAccess(user, accessModule, "view");
    } else {
      assertMutationAccess(user, resource);
    }
  }

  if (resource === "projects") return handleProjects(request, path, user);
  if (resource === "boq") return handleBoq(request, path, user);
  if (resource === "quotations") return handleQuotations(request, user);
  if (resource === "invoices") return handleInvoices(request, path, user);
  if (resource === "vendors") return handleVendors(request, path, user);
  if (resource === "spks") return handleSpks(request, path, user);
  if (resource === "bast") return handleBast(request, path, user);
  if (resource === "transactions") return handleTransactions(request, path, user);
  if (resource === "finance" && path[1] === "summary") return handleFinance(request, user);
  if (resource === "users") return handleUsers(request, path, user);
  if (resource === "profile") return handleProfile(request, path, user);
  if (resource === "settings") return handleSettings(request, user);
  if (resource === "documents") return handleDocuments(request, path);
  if (resource === "audit-logs") return handleAudit(request, user);
  if (resource === "search") return handleSearch(request, user);

  throw new ApiError(404, "NOT_FOUND", "Endpoint API tidak ditemukan.");
}
