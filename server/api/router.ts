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
  avatarUrlForUser,
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
import {
  emailDeliveryConfigured,
  emailMode,
  emailProviderName,
  notifyProjectStakeholders,
  retryEmailOutbox,
  sendAccountCreatedEmail,
  sendPasswordResetEmail,
  sendTestEmail,
} from "../email";
import { asNumber, formatDate, initials, parseJson } from "../format";
import { documentTaxSummary, lockDocumentTaxes } from "../tax";
import { deleteProjectFile, readProjectFile, storeProjectFile } from "../storage";
import {
  ApiError,
  assertSameOrigin,
  created,
  jsonBody,
  noContent,
  ok,
} from "./errors";
import {
  renderBusinessPdf,
  renderFinancialReportPdf,
  renderValidationPdf,
} from "./pdf";
import { handleBankAccounts } from "./bank-router";
import {
  handleBoqScopes,
  handleQuotationLifecycle,
} from "./commercial-scope-router";
import {
  handleProcurementOrders,
  handleVendorCategories,
} from "./procurement-router";
import { handleProfitShares } from "./profit-share-router";
import { handleStandaloneBoqs } from "./standalone-boq-router";
import { renderSopPdf } from "./sop-pdf";
import { handleDocumentTaxes, handleTax } from "./tax-router";

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gunakan format tanggal YYYY-MM-DD.");
const nonNegativeMoney = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMoney = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  remember: z.boolean().default(false),
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
const invoicePatchSchema = invoiceSchema
  .omit({ projectId: true, issueDate: true })
  .partial()
  .extend({ issueDate: isoDateSchema.optional() });
const invoicePaymentSchema = z
  .object({
    grossAmount: positiveMoney,
    cashAmount: nonNegativeMoney,
    withholdingAmount: nonNegativeMoney.default(0),
    paidDate: isoDateSchema,
    paymentReference: z.string().trim().min(1).max(160),
    paymentMethod: z.enum(["Transfer Bank", "Tunai", "Kartu", "Lainnya"]),
    bankAccountId: idSchema.optional(),
    attachment: z.object({
      name: z.string().trim().min(1).max(240),
      mimeType: z
        .string()
        .trim()
        .regex(/^(application\/pdf|image\/(png|jpeg|webp))$/),
      contentBase64: z.string().min(4).max(8_500_000),
    }),
  })
  .superRefine((input, context) => {
    if (input.grossAmount !== input.cashAmount + input.withholdingAmount) {
      context.addIssue({
        code: "custom",
        message: "Nilai bruto harus sama dengan kas ditambah pajak potong.",
      });
    }
  });

const quotationSchema = z.object({
  status: z.enum(["Draft", "Sent", "Rejected", "Void"]).default("Draft"),
  issuedAt: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)),
  validUntil: isoDateSchema.optional(),
});

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  vendorType: z.enum(["Supplier", "Jasa", "Hybrid"]).optional(),
  categoryIds: z.array(idSchema).min(1).max(20).optional(),
  category: z.string().trim().min(2).max(100).optional(),
  contact: z.string().trim().min(3).max(100),
  email: z.union([z.literal(""), emailSchema]).optional(),
  address: z.string().trim().max(300).optional(),
  rate: nonNegativeMoney.optional(),
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
  category: z
    .enum([
      "Penjualan",
      "Operasional",
      "Vendor",
      "Pajak",
      "Gaji",
      "Modal",
      "Bonus Pegawai",
      "Fee Pemberi Kerja",
      "Bagi Hasil",
      "Lainnya",
    ])
    .default("Lainnya"),
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
  engineerRole: z.string().trim().min(2).max(120).optional(),
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

const projectAccessSchema = z.object({
  userIds: z.array(idSchema).max(250),
});

const validationUpdateSchema = z.object({
  notes: z.string().trim().max(4_000).optional(),
  status: z.enum(["Draft", "Completed"]).default("Draft"),
  items: z
    .array(
      z.object({
        id: idSchema,
        checked: z.boolean(),
        notes: z.string().trim().max(500).optional().default(""),
      }),
    )
    .max(500),
});

function now() {
  return new Date().toISOString();
}

function makassarToday(value = now()) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Makassar",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function assertDateOrder(
  start: unknown,
  end: unknown,
  message = "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.",
) {
  if (start && end && String(end) < String(start)) {
    throw new ApiError(422, "INVALID_DATE_RANGE", message);
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

function lastActive(value: unknown, language: AuthUser["preferredLanguage"]) {
  if (!value) return language === "en" ? "Never" : "Belum pernah";
  const elapsed = Date.now() - new Date(String(value)).getTime();
  if (elapsed < 5 * 60_000) return language === "en" ? "Just now" : "Baru saja";
  if (elapsed < 60 * 60_000) {
    const minutes = Math.max(1, Math.floor(elapsed / 60_000));
    return language === "en" ? `${minutes} minutes ago` : `${minutes} menit lalu`;
  }
  if (elapsed < 24 * 60 * 60_000) {
    const hours = Math.floor(elapsed / 3_600_000);
    return language === "en" ? `${hours} hours ago` : `${hours} jam lalu`;
  }
  return localizedApiDate(value, language);
}

function localizedTransactionDescription(
  value: unknown,
  language: AuthUser["preferredLanguage"],
) {
  const description = String(value ?? "");
  if (language !== "en") return description;
  return description
    .replace(/^Pembayaran\s+/i, "Payment for ")
    .replace(/^Pembelian\s+/i, "Purchase of ")
    .replace(/^Termin awal\s+/i, "Initial installment for ")
    .replace(/^Biaya\s+/i, "Cost of ");
}

function localizedTransactionCategory(
  value: unknown,
  language: AuthUser["preferredLanguage"],
) {
  const category = String(value ?? "Lainnya");
  if (language !== "en") return category;
  const categories: Record<string, string> = {
    Penjualan: "Sales",
    Operasional: "Operations",
    Vendor: "Vendor",
    Pajak: "Tax",
    Gaji: "Payroll",
    Modal: "Capital",
    "Bonus Pegawai": "Employee Bonus",
    "Fee Pemberi Kerja": "Referral Fee",
    "Bagi Hasil": "Profit Share",
    Lainnya: "Other",
  };
  return categories[category] ?? category;
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
  "vendor-categories": "procurement",
  spks: "procurement",
  "procurement-orders": "procurement",
  bast: "bast",
  transactions: "finance",
  finance: "finance",
  "bank-accounts": "finance",
  "profit-shares": "finance",
  users: "users",
  "audit-logs": "users",
  notifications: "settings",
  documents: "projects",
  validations: "bast",
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

async function resetProjectValidation(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  projectId: string,
) {
  const timestamp = now();
  await client.batch(
    [
      {
        sql: "DELETE FROM project_validation_items WHERE validation_id IN (SELECT id FROM project_validations WHERE project_id=?)",
        args: [projectId],
      },
      {
        sql: "UPDATE project_validations SET status='Draft',validated_by=NULL,completed_at=NULL,updated_at=? WHERE project_id=?",
        args: [timestamp, projectId],
      },
    ],
    "write",
  );
}

async function assertProjectAccess(user: AuthUser, projectId: string) {
  const { client } = await getDatabase();
  const scope = projectScopeCondition(user, "p");
  const result = await client.execute({
    sql: `SELECT p.id FROM projects p WHERE p.id = ?${scope.sql ? ` AND ${scope.sql}` : ""} LIMIT 1`,
    args: [projectId, ...scope.args],
  });
  if (!result.rows.length) {
    // Return the same response for a missing and an inaccessible project so an
    // account cannot enumerate project IDs that belong to another team.
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
}

async function syncCommercialValues(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  projectId: string,
) {
  const totalResult = await client.execute({
    sql: `
      SELECT
        COALESCE(SUM(i.quantity * i.selling_price), 0) AS boq_total,
        COALESCE((
          SELECT SUM(q.total) FROM quotations q
          WHERE q.project_id=? AND q.status='Accepted'
        ),0) AS accepted_total
      FROM boq_items i
      JOIN boqs b ON b.id = i.boq_id
      WHERE b.project_id = ?
    `,
    args: [projectId, projectId],
  });
  const acceptedTotal = asNumber(totalResult.rows[0]?.accepted_total);
  const total =
    acceptedTotal > 0
      ? acceptedTotal
      : asNumber(totalResult.rows[0]?.boq_total);
  const timestamp = now();
  await client.batch(
    [
      {
        sql: "UPDATE projects SET value=?,updated_at=? WHERE id=?",
        args: [total, timestamp, projectId],
      },
      {
        sql: `UPDATE quotations SET total=COALESCE((
          SELECT SUM(i.quantity*i.selling_price)
          FROM boq_items i WHERE i.scope_id=quotations.scope_id
        ),0),status='Draft',updated_at=? WHERE project_id=? AND status<>'Accepted'`,
        args: [timestamp, projectId],
      },
      {
        sql: `UPDATE boq_scopes SET status='Draft',updated_at=?
          WHERE id IN (
            SELECT q.scope_id FROM quotations q
            WHERE q.project_id=? AND q.status='Draft'
          )`,
        args: [timestamp, projectId],
      },
    ],
    "write",
  );
  return total;
}

async function assertBoqTotalCoversInvoices(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  projectId: string,
  proposedTotal: number,
) {
  const result = await client.execute({
    sql: "SELECT COALESCE(SUM(amount),0) AS total FROM invoices WHERE project_id=?",
    args: [projectId],
  });
  const invoicedTotal = asNumber(result.rows[0]?.total);
  if (proposedTotal < invoicedTotal) {
    throw new ApiError(
      409,
      "BOQ_BELOW_INVOICED_TOTAL",
      `Nilai BoQ tidak boleh lebih kecil dari total Invoice yang sudah diterbitkan (${invoicedTotal}). Edit atau hapus Invoice terlebih dahulu.`,
    );
  }
}

async function detachOrDeleteSystemTransaction(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  source: "Invoice" | "SPK",
  referenceId: string,
) {
  const result = await client.execute({
    sql: `
      SELECT t.id,e.id AS entry_id,e.date AS entry_date,
        e.description AS entry_description,e.type AS entry_type,
        e.amount AS entry_amount,a.bank_name
      FROM transactions t
      LEFT JOIN bank_statement_entries e ON e.transaction_id=t.id
      LEFT JOIN bank_accounts a ON a.id=e.bank_account_id
      WHERE t.source=? AND t.reference_id=?
      LIMIT 1
    `,
    args: [source, referenceId],
  });
  const transaction = result.rows[0];
  if (!transaction) return;
  if (!transaction.entry_id) {
    await client.execute({
      sql: "DELETE FROM transactions WHERE id=?",
      args: [transaction.id],
    });
    return;
  }
  await client.batch(
    [
      {
        sql: `
          UPDATE transactions SET
            date=?,type=?,description=?,amount=?,source=?,reference_id=?,updated_at=?
          WHERE id=?
        `,
        args: [
          transaction.entry_date,
          transaction.entry_type,
          transaction.entry_description,
          transaction.entry_amount,
          `Bank: ${String(transaction.bank_name)}`,
          transaction.entry_id,
          now(),
          transaction.id,
        ],
      },
      {
        sql: `
          UPDATE bank_statement_entries
          SET reconciliation_status='Imported'
          WHERE transaction_id=?
        `,
        args: [transaction.id],
      },
    ],
    "write",
  );
}

async function reattachImportedBankTransaction(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  input: {
    projectId: string;
    date: string;
    type: "Pemasukan" | "Pengeluaran";
    amount: number;
    source: "Invoice" | "SPK";
    referenceId: string;
    description: string;
    category: string;
  },
) {
  const result = await client.execute({
    sql: `
      SELECT t.id,e.id AS entry_id,e.date AS entry_date
      FROM transactions t
      JOIN bank_statement_entries e ON e.transaction_id=t.id
      WHERE t.project_id=? AND t.type=? AND t.amount=?
        AND t.source LIKE 'Bank:%'
        AND e.reconciliation_status='Imported'
      ORDER BY e.date DESC,e.created_at DESC
      LIMIT 50
    `,
    args: [input.projectId, input.type, input.amount],
  });
  const candidates = result.rows.filter((candidate) => {
    const left = Date.parse(`${input.date}T00:00:00.000Z`);
    const right = Date.parse(`${String(candidate.entry_date)}T00:00:00.000Z`);
    return Math.abs(left - right) / 86_400_000 <= 14;
  });
  if (candidates.length !== 1) return false;
  const candidate = candidates[0];
  await client.batch(
    [
      {
        sql: `
          UPDATE transactions SET
            project_id=?,date=?,type=?,description=?,amount=?,source=?,
            reference_id=?,category=?,updated_at=?
          WHERE id=?
        `,
        args: [
          input.projectId,
          input.date,
          input.type,
          input.description,
          input.amount,
          input.source,
          input.referenceId,
          input.category,
          now(),
          candidate.id,
        ],
      },
      {
        sql: `
          UPDATE bank_statement_entries
          SET reconciliation_status='Matched'
          WHERE id=?
        `,
        args: [candidate.entry_id],
      },
    ],
    "write",
  );
  return true;
}

async function syncSpkTransaction(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  spkId: string,
  userId: string,
) {
  const spk = await ensureExists(
    "SELECT * FROM spks WHERE id=?",
    [spkId],
    "SPK tidak ditemukan.",
  );
  if (spk.payment_status !== "Dibayar") {
    await detachOrDeleteSystemTransaction(client, "SPK", spkId);
    return;
  }
  const timestamp = now();
  const transactionDate = spk.paid_date ?? timestamp.slice(0, 10);
  const existing = await client.execute({
    sql: "SELECT id FROM transactions WHERE source='SPK' AND reference_id=? LIMIT 1",
    args: [spkId],
  });
  if (existing.rows[0]) {
    await client.execute({
      sql: "UPDATE transactions SET project_id=?,date=?,type='Pengeluaran',description=?,amount=?,category='Vendor',updated_at=? WHERE id=?",
      args: [
        spk.project_id,
        transactionDate,
        `Pembayaran vendor ${spk.number}`,
        spk.cost,
        timestamp,
        existing.rows[0].id,
      ],
    });
    return;
  }
  if (
    await reattachImportedBankTransaction(client, {
      projectId: String(spk.project_id),
      date: String(transactionDate),
      type: "Pengeluaran",
      amount: asNumber(spk.cost),
      source: "SPK",
      referenceId: spkId,
      description: `Pembayaran vendor ${String(spk.number)}`,
      category: "Vendor",
    })
  ) {
    return;
  }
  await client.execute({
    sql: "INSERT INTO transactions (id,project_id,date,type,description,amount,source,reference_id,category,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [
      randomUUID(),
      spk.project_id,
      transactionDate,
      "Pengeluaran",
      `Pembayaran vendor ${spk.number}`,
      spk.cost,
      "SPK",
      spkId,
      "Vendor",
      userId,
      timestamp,
      timestamp,
    ],
  });
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
    const input = z.object({
      email: emailSchema,
      surface: z.enum(["admin", "panel"]).optional().default("admin"),
    }).parse(await jsonBody(request));
    const { client } = await getDatabase();
    const result = await client.execute({
      sql: `
        SELECT u.id,u.email,u.role,
          COALESCE(up.preferred_language,'id') AS preferred_language
        FROM users u
        LEFT JOIN user_profiles up ON up.user_id=u.id
        WHERE lower(u.email) = lower(?) AND u.status = 'Aktif'
        LIMIT 1
      `,
      args: [input.email],
    });

    let developmentToken: string | undefined;
    const eligibleUser =
      result.rows[0] &&
      (input.surface !== "panel" || String(result.rows[0].role) === "Admin")
        ? result.rows[0]
        : undefined;
    if (eligibleUser) {
      const token = await createPasswordResetToken(client, String(eligibleUser.id));
      await sendPasswordResetEmail(
        client,
        {
          id: String(eligibleUser.id),
          email: String(eligibleUser.email),
          preferredLanguage:
            String(eligibleUser.preferred_language) === "en" ? "en" : "id",
        },
        token,
        input.surface,
      );
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

async function listProjects(searchParams: URLSearchParams, user: AuthUser) {
  const { client } = await getDatabase();
  const status = searchParams.get("status");
  const query = searchParams.get("q")?.trim();
  const conditions: string[] = [];
  const args: unknown[] = [];
  const scope = projectScopeCondition(user, "p");
  if (scope.sql) {
    conditions.push(scope.sql);
    args.push(...scope.args);
  }
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
        (SELECT COALESCE(SUM(i.amount + COALESCE((
          SELECT SUM(dt.amount) FROM document_taxes dt
          WHERE dt.document_type='Invoice' AND dt.document_id=i.id
            AND dt.effect='Add'
        ),0)), 0) FROM invoices i WHERE i.project_id = p.id) AS invoice_total,
        (SELECT COALESCE(SUM(pay.gross_amount), 0)
          FROM invoice_payments pay
          JOIN invoices i ON i.id=pay.invoice_id
          WHERE i.project_id=p.id AND pay.status='Posted') AS paid_total,
        (SELECT group_concat(u.name, '|') FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = p.id) AS team_names
      FROM projects p
      LEFT JOIN users manager ON manager.id = p.manager_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY p.created_at DESC, p.code DESC
    `,
    args: args as never[],
  });
  const canViewCommercial =
    canAccess(user.permissions, "billing") ||
    canAccess(user.permissions, "finance");

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
      payment: canViewCommercial ? payment : "Tidak Diizinkan",
      paidRatio: canViewCommercial ? paidRatio : 0,
      startDate: localizedApiDate(row.start_date, user.preferredLanguage),
      targetDate: row.target_date
        ? localizedApiDate(row.target_date, user.preferredLanguage)
        : user.preferredLanguage === "en" ? "Not specified" : "Belum ditentukan",
      startDateIso: row.start_date,
      targetDateIso: row.target_date,
      value: canViewCommercial ? asNumber(row.value) : 0,
      manager: row.manager_name
        ? String(row.manager_name)
        : user.preferredLanguage === "en" ? "Not specified" : "Belum ditentukan",
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
    return ok(await listProjects(new URL(request.url).searchParams, user));
  }

  if (request.method === "POST" && !projectId) {
    if (!mutationRoles("projects").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Peran Anda tidak dapat membuat proyek.");
    const input = projectSchema.parse(await jsonBody(request));
    assertDateOrder(input.startDate, input.targetDate);
    const id = randomUUID();
    const count = await client.execute("SELECT COUNT(*) AS count FROM projects");
    const code = `PN-${new Date().getUTCFullYear().toString().slice(-2)}${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-${String(asNumber(count.rows[0]?.count) + 1).padStart(3, "0")}`;
    const timestamp = now();
    if (input.managerId) {
      await ensureExists(
        "SELECT id FROM users WHERE id=? AND status='Aktif'",
        [input.managerId],
        "Project Manager aktif tidak ditemukan.",
      );
    }
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
        {
          sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
          args: [id, user.id, timestamp],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "create", "project", id, input);
    await notifyProjectStakeholders(client, {
      projectId: id,
      eventType: "project_created",
      subject: `Proyek baru: ${input.name}`,
      message: `proyek ${input.name} untuk ${input.client} telah dibuat dan tersedia sesuai akses Anda.`,
      subjectEn: `New project: ${input.name}`,
      messageEn: `project ${input.name} for ${input.client} has been created and is available according to your access.`,
    });
    const projects = await listProjects(new URLSearchParams(), user);
    return created(projects.find((project) => project.id === id));
  }

  if (projectId && child === "access") {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat mengatur akses proyek.");
    }
    await assertProjectAccess(user, projectId);

    if (request.method === "GET") {
      const result = await client.execute({
        sql: `
          SELECT u.id,u.name,u.email,u.role,u.status,
            CASE WHEN pm.user_id IS NULL THEN 0 ELSE 1 END AS assigned,
            CASE WHEN p.manager_id=u.id THEN 1 ELSE 0 END AS is_manager,
            CASE WHEN p.created_by=u.id THEN 1 ELSE 0 END AS is_creator
          FROM users u
          CROSS JOIN projects p
          LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=u.id
          WHERE p.id=? AND u.role IN ('Project Manager','Engineer')
          ORDER BY CASE u.role WHEN 'Project Manager' THEN 0 ELSE 1 END,u.name
        `,
        args: [projectId],
      });
      return ok(result.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        role: String(row.role),
        status: String(row.status),
        assigned: Boolean(asNumber(row.assigned)),
        isManager: Boolean(asNumber(row.is_manager)),
        isCreator: Boolean(asNumber(row.is_creator)),
      })));
    }

    if (request.method === "PUT") {
      const input = projectAccessSchema.parse(await jsonBody(request));
      const project = await ensureExists(
        "SELECT p.name FROM projects p WHERE p.id=?",
        [projectId],
        "Proyek tidak ditemukan.",
      );
      const uniqueIds = Array.from(new Set(input.userIds));
      if (uniqueIds.length) {
        const placeholders = uniqueIds.map(() => "?").join(",");
        const eligible = await client.execute({
          sql: `SELECT id FROM users WHERE id IN (${placeholders}) AND role IN ('Project Manager','Engineer') AND status='Aktif'`,
          args: uniqueIds,
        });
        if (eligible.rows.length !== uniqueIds.length) {
          throw new ApiError(422, "INVALID_PROJECT_MEMBER", "Pilih Project Manager atau Engineer yang aktif.");
        }
      }
      const timestamp = now();
      await client.batch(
        [
          {
            sql: "DELETE FROM project_members WHERE project_id=? AND user_id IN (SELECT id FROM users WHERE role IN ('Project Manager','Engineer'))",
            args: [projectId],
          },
          ...uniqueIds.map((userId) => ({
            sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
            args: [projectId, userId, timestamp],
          })),
        ],
        "write",
      );
      await writeAuditLog(client, request, user, "update_access", "project", projectId, {
        userIds: uniqueIds,
      });
      await notifyProjectStakeholders(client, {
        projectId,
        eventType: "project_access_updated",
        subject: `Akses proyek ${String(project.name)} diperbarui`,
        message: `akses tim untuk proyek ${String(project.name)} telah diperbarui oleh Administrator.`,
        subjectEn: `Project access updated for ${String(project.name)}`,
        messageEn: `team access for project ${String(project.name)} was updated by an Administrator.`,
      });
      return ok({ projectId, userIds: uniqueIds });
    }
  }

  if (projectId && child === "tasks") {
    await assertProjectAccess(user, projectId);

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
          startLabel: localizedApiDate(row.start_date, user.preferredLanguage).replace(/,?\s+\d{4}$/, ""),
          endLabel: row.end_date
            ? localizedApiDate(row.end_date, user.preferredLanguage).replace(/,?\s+\d{4}$/, "")
            : user.preferredLanguage === "en" ? "Not set" : "Belum diatur",
          startDate: row.start_date,
          endDate: row.end_date,
          status: String(row.status),
        })),
      );
    }

    if (request.method === "POST" && !childId) {
      const input = taskSchema.parse(await jsonBody(request));
      assertDateOrder(input.startDate, input.endDate);
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
      if (input.ownerId) {
        await client.execute({
          sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
          args: [projectId, input.ownerId, timestamp],
        });
      }
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
      assertDateOrder(
        input.startDate === undefined ? current.start_date : input.startDate,
        input.endDate === undefined ? current.end_date : input.endDate,
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
    await assertProjectAccess(user, projectId);
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
        date: localizedApiDate(row.created_at, user.preferredLanguage),
        createdAt: String(row.created_at),
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
    assertAccess(user, "billing", "view");
    await assertProjectAccess(user, projectId);
    return renderBusinessPdf("quotation", projectId, user.preferredLanguage);
  }

  if (projectId && !child && request.method === "GET") {
    await assertProjectAccess(user, projectId);
    const projects = await listProjects(new URLSearchParams(), user);
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
    return ok(project);
  }

  if (projectId && !child && request.method === "PATCH") {
    if (!mutationRoles("projects").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah proyek.");
    await assertProjectAccess(user, projectId);
    const input = projectSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM projects WHERE id = ?", [projectId], "Proyek tidak ditemukan.");
    assertDateOrder(
      input.startDate === undefined ? current.start_date : input.startDate,
      input.targetDate === undefined ? current.target_date : input.targetDate,
    );
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
    if (input.managerId) {
      await client.execute({
        sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
        args: [projectId, input.managerId, now()],
      });
    }
    await writeAuditLog(client, request, user, "update", "project", projectId, input);
    const projects = await listProjects(new URLSearchParams(), user);
    return ok(projects.find((project) => project.id === projectId));
  }

  if (projectId && !child && request.method === "DELETE") {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat menghapus proyek.");
    }
    await assertProjectAccess(user, projectId);
    const documents = await client.execute({
      sql: "SELECT storage_url FROM project_documents WHERE project_id=?",
      args: [projectId],
    });
    await client.batch(
      [
        {
          sql: `DELETE FROM tax_settlements WHERE obligation_id IN (
            SELECT o.id FROM tax_obligations o
            JOIN document_taxes dt ON dt.id=o.document_tax_id
            WHERE dt.project_id=?
          )`,
          args: [projectId],
        },
        {
          sql: `DELETE FROM tax_obligations WHERE document_tax_id IN (
            SELECT id FROM document_taxes WHERE project_id=?
          )`,
          args: [projectId],
        },
        {
          sql: "DELETE FROM document_taxes WHERE project_id=?",
          args: [projectId],
        },
        {
          sql: `DELETE FROM invoice_payments WHERE invoice_id IN (
            SELECT id FROM invoices WHERE project_id=?
          )`,
          args: [projectId],
        },
        {
          sql: `DELETE FROM po_receipt_items WHERE receipt_id IN (
            SELECT r.id FROM po_receipts r
            JOIN spks s ON s.id=r.spk_id
            WHERE s.project_id=?
          )`,
          args: [projectId],
        },
        {
          sql: "DELETE FROM po_receipts WHERE spk_id IN (SELECT id FROM spks WHERE project_id=?)",
          args: [projectId],
        },
        {
          sql: "DELETE FROM spk_verifications WHERE spk_id IN (SELECT id FROM spks WHERE project_id=?)",
          args: [projectId],
        },
        { sql: "DELETE FROM transactions WHERE project_id=?", args: [projectId] },
        {
          sql: "DELETE FROM spk_payments WHERE spk_id IN (SELECT id FROM spks WHERE project_id=?)",
          args: [projectId],
        },
        {
          sql: "DELETE FROM spk_payment_terms WHERE spk_id IN (SELECT id FROM spks WHERE project_id=?)",
          args: [projectId],
        },
        {
          sql: "DELETE FROM spk_items WHERE spk_id IN (SELECT id FROM spks WHERE project_id=?)",
          args: [projectId],
        },
        {
          sql: "DELETE FROM spks WHERE project_id=?",
          args: [projectId],
        },
        { sql: "DELETE FROM projects WHERE id = ?", args: [projectId] },
      ],
      "write",
    );
    await Promise.allSettled(
      documents.rows.map((document) =>
        deleteProjectFile(document.storage_url ? String(document.storage_url) : null),
      ),
    );
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
  const id = existing.rows[0] ? String(existing.rows[0].id) : randomUUID();
  const timestamp = now();
  if (!existing.rows[0]) {
    await client.execute({
      sql: "INSERT INTO boqs (id,project_id,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      args: [id, projectId, "Draft", "", timestamp, timestamp],
    });
  }
  const scope = await client.execute({
    sql: "SELECT id FROM boq_scopes WHERE boq_id=? AND sequence=0 LIMIT 1",
    args: [id],
  });
  if (!scope.rows[0]) {
    await client.execute({
      sql: `INSERT INTO boq_scopes
        (id,boq_id,kind,sequence,title,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      args: [randomUUID(), id, "Original", 0, "BoQ Original", "Draft", timestamp, timestamp],
    });
  }
  return id;
}

async function handleBoq(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
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
        lastUsed: lastActive(row.updated_at, user.preferredLanguage),
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
      const template = await ensureExists(
        "SELECT id,name FROM boq_templates WHERE id = ?",
        [childId],
        "Template tidak ditemukan.",
      );
      await client.execute({ sql: "DELETE FROM boq_templates WHERE id = ?", args: [childId] });
      await writeAuditLog(client, request, user, "delete", "boq_template", childId, {
        name: template.name,
      });
      return noContent();
    }
  }

  if (!projectId) {
    throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
  }
  await assertProjectAccess(user, projectId);

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
    const proposedTotal = input.items.reduce(
      (sum, item) => sum + item.quantity * item.sellingPrice,
      0,
    );
    await assertBoqTotalCoversInvoices(client, projectId, proposedTotal);
    const boqId = await ensureBoq(projectId);
    const originalScope = await ensureExists(
      "SELECT id,status FROM boq_scopes WHERE boq_id=? AND sequence=0 LIMIT 1",
      [boqId],
      "Scope BoQ Original tidak ditemukan.",
    );
    if (String(originalScope.status) === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_SCOPE_LOCKED",
        "BoQ Original sudah diterima klien dan tidak dapat diubah. Buat Addendum baru.",
      );
    }
    const timestamp = now();
    const statements = [
      {
        sql: "UPDATE boqs SET status=?,notes=?,updated_at=? WHERE id=?",
        args: [input.status, input.notes ?? "", timestamp, boqId],
      },
      { sql: "DELETE FROM boq_items WHERE scope_id = ?", args: [originalScope.id] },
      ...input.items.map((item, index) => ({
        sql: "INSERT INTO boq_items (id,boq_id,scope_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [item.id ?? randomUUID(), boqId, originalScope.id, item.category, item.description, item.quantity, item.unit, item.costPrice, item.sellingPrice, index, timestamp, timestamp],
      })),
    ];
    await client.batch(statements, "write");
    await syncCommercialValues(client, projectId);
    await resetProjectValidation(client, projectId);
    await writeAuditLog(client, request, user, "replace", "boq", boqId, { projectId, itemCount: input.items.length });
    return ok(await getBoq(projectId));
  }

  if (request.method === "POST" && child === "items") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menambah item BoQ.");
    const input = boqItemSchema.parse(await jsonBody(request));
    const boqId = await ensureBoq(projectId);
    const originalScope = await ensureExists(
      "SELECT id,status FROM boq_scopes WHERE boq_id=? AND sequence=0 LIMIT 1",
      [boqId],
      "Scope BoQ Original tidak ditemukan.",
    );
    if (String(originalScope.status) === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_SCOPE_LOCKED",
        "BoQ Original sudah diterima klien. Tambahkan pekerjaan melalui Addendum.",
      );
    }
    const count = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM boq_items WHERE boq_id = ?",
      args: [boqId],
    });
    const id = randomUUID();
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO boq_items (id,boq_id,scope_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, boqId, originalScope.id, input.category, input.description, input.quantity, input.unit, input.costPrice, input.sellingPrice, asNumber(count.rows[0]?.count), timestamp, timestamp],
    });
    await syncCommercialValues(client, projectId);
    await resetProjectValidation(client, projectId);
    await writeAuditLog(client, request, user, "create", "boq_item", id, { projectId });
    return created({ id, ...input });
  }

  if (child === "items" && childId && request.method === "PATCH") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah item BoQ.");
    const input = boqItemSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists(
      `SELECT i.*,s.status AS scope_status FROM boq_items i
        JOIN boqs b ON b.id=i.boq_id
        LEFT JOIN boq_scopes s ON s.id=i.scope_id
        WHERE i.id=? AND b.project_id=?`,
      [childId, projectId],
      "Item BoQ tidak ditemukan.",
    );
    if (String(current.scope_status) === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_SCOPE_LOCKED",
        "Item yang sudah diterima klien tidak dapat diedit. Buat Addendum baru.",
      );
    }
    const currentBoq = await getBoq(projectId);
    const proposedTotal =
      currentBoq.totals.selling -
      asNumber(current.quantity) * asNumber(current.selling_price) +
      (input.quantity ?? asNumber(current.quantity)) *
        (input.sellingPrice ?? asNumber(current.selling_price));
    await assertBoqTotalCoversInvoices(client, projectId, proposedTotal);
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
    await syncCommercialValues(client, projectId);
    await resetProjectValidation(client, projectId);
    await writeAuditLog(client, request, user, "update", "boq_item", childId, input);
    const updated = await ensureExists(
      "SELECT * FROM boq_items WHERE id=?",
      [childId],
      "Item BoQ tidak ditemukan.",
    );
    return ok({
      id: String(updated.id),
      category: String(updated.category),
      description: String(updated.description),
      quantity: asNumber(updated.quantity),
      unit: String(updated.unit),
      costPrice: asNumber(updated.cost_price),
      sellingPrice: asNumber(updated.selling_price),
    });
  }

  if (child === "items" && childId && request.method === "DELETE") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus item BoQ.");
    const itemScope = await ensureExists(
      `SELECT i.id,s.status AS scope_status FROM boq_items i
        JOIN boqs b ON b.id=i.boq_id
        LEFT JOIN boq_scopes s ON s.id=i.scope_id
        WHERE i.id=? AND b.project_id=?`,
      [childId, projectId],
      "Item BoQ tidak ditemukan.",
    );
    if (String(itemScope.scope_status) === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_SCOPE_LOCKED",
        "Item yang sudah diterima klien tidak dapat dihapus. Buat Addendum baru.",
      );
    }
    const item = await ensureExists(
      "SELECT quantity,selling_price FROM boq_items WHERE id=?",
      [childId],
      "Item BoQ tidak ditemukan.",
    );
    const currentBoq = await getBoq(projectId);
    await assertBoqTotalCoversInvoices(
      client,
      projectId,
      currentBoq.totals.selling -
        asNumber(item.quantity) * asNumber(item.selling_price),
    );
    await client.execute({ sql: "DELETE FROM boq_items WHERE id = ?", args: [childId] });
    await syncCommercialValues(client, projectId);
    await resetProjectValidation(client, projectId);
    await writeAuditLog(client, request, user, "delete", "boq_item", childId, { projectId });
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BoQ tidak ditemukan.");
}

async function handleQuotations(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
  await assertProjectAccess(user, projectId);

  if (request.method === "GET") {
    const result = await client.execute({
      sql: `SELECT q.id,q.number,q.status,q.issued_at,q.valid_until,q.total,
        q.accepted_at,q.acceptance_attachment_name
        FROM quotations q
        LEFT JOIN boq_scopes s ON s.id=q.scope_id
        WHERE q.project_id=? AND (s.sequence=0 OR q.scope_id IS NULL)
        ORDER BY q.created_at DESC LIMIT 1`,
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
      acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
      acceptanceAttachmentName: row.acceptance_attachment_name
        ? String(row.acceptance_attachment_name)
        : null,
    } : {
      id: null,
      number: null,
      status: "Draft",
      issuedAt: new Date().toISOString().slice(0, 10),
      validUntil: null,
      total: (await getBoq(projectId)).totals.selling,
    });
  }

  if (request.method === "PATCH") {
    assertAccess(user, "billing", "manage");
    const input = quotationSchema.partial().parse(await jsonBody(request));
    if (
      (input.issuedAt !== undefined || input.validUntil !== undefined) &&
      !["Admin", "Finance"].includes(user.role)
    ) {
      throw new ApiError(
        403,
        "QUOTATION_VALIDITY_FORBIDDEN",
        "Hanya Admin dan Finance yang dapat mengubah tanggal dan masa berlaku Quotation.",
      );
    }
    const boq = await getBoq(projectId);
    if (!boq.items.length || boq.totals.selling <= 0) {
      throw new ApiError(
        409,
        "EMPTY_BOQ",
        "Tambahkan item BoQ terlebih dahulu sebelum membuat Quotation.",
      );
    }
    const boqId = await ensureBoq(projectId);
    const originalScope = await ensureExists(
      "SELECT id,status FROM boq_scopes WHERE boq_id=? AND sequence=0 LIMIT 1",
      [boqId],
      "Scope BoQ Original tidak ditemukan.",
    );
    if (String(originalScope.status) === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_QUOTATION_LOCKED",
        "Quotation yang diterima klien sudah dikunci.",
      );
    }
    const originalTotalResult = await client.execute({
      sql: "SELECT COALESCE(SUM(quantity*selling_price),0) AS total FROM boq_items WHERE scope_id=?",
      args: [originalScope.id],
    });
    const originalTotal = asNumber(originalTotalResult.rows[0]?.total);
    const current = await client.execute({
      sql: `SELECT q.* FROM quotations q
        LEFT JOIN boq_scopes s ON s.id=q.scope_id
        WHERE q.project_id=? AND (s.sequence=0 OR q.scope_id IS NULL)
        ORDER BY q.created_at DESC LIMIT 1`,
      args: [projectId],
    });
    const wasSent = String(current.rows[0]?.status ?? "") === "Sent";
    const timestamp = now();
    let quotationId = current.rows[0] ? String(current.rows[0].id) : "";
    if (quotationId) {
      const quotation = current.rows[0];
      assertDateOrder(
        input.issuedAt ?? quotation.issued_at,
        input.validUntil === undefined ? quotation.valid_until : input.validUntil,
        "Masa berlaku Quotation tidak boleh lebih awal dari tanggal terbit.",
      );
      await client.execute({
        sql: "UPDATE quotations SET status=?,issued_at=?,valid_until=?,total=?,updated_at=? WHERE id=?",
        args: [
          input.status ?? quotation.status,
          input.issuedAt ?? quotation.issued_at,
          input.validUntil === undefined ? quotation.valid_until : input.validUntil,
          originalTotal,
          timestamp,
          quotationId,
        ],
      });
      await writeAuditLog(client, request, user, "update", "quotation", quotationId, input);
      if (input.status) {
        await client.execute({
          sql: "UPDATE boq_scopes SET status=?,updated_at=? WHERE id=?",
          args: [input.status, timestamp, originalScope.id],
        });
      }
    } else {
      const count = await client.execute("SELECT COUNT(*) AS count FROM quotations");
      quotationId = randomUUID();
      const issuedAt = input.issuedAt ?? timestamp.slice(0, 10);
      const validUntil =
        input.validUntil ??
        new Date(new Date(`${issuedAt}T00:00:00.000Z`).getTime() + 14 * 86_400_000)
          .toISOString()
          .slice(0, 10);
      assertDateOrder(
        issuedAt,
        validUntil,
        "Masa berlaku Quotation tidak boleh lebih awal dari tanggal terbit.",
      );
      await client.execute({
        sql: "INSERT INTO quotations (id,project_id,scope_id,number,status,issued_at,valid_until,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          quotationId,
          projectId,
          originalScope.id,
          makeSequence("QUO", asNumber(count.rows[0]?.count)),
          input.status ?? "Draft",
          issuedAt,
          validUntil,
          originalTotal,
          timestamp,
          timestamp,
        ],
      });
      await client.execute({
        sql: "UPDATE boq_scopes SET status=?,updated_at=? WHERE id=?",
        args: [input.status ?? "Draft", timestamp, originalScope.id],
      });
      await writeAuditLog(client, request, user, "create", "quotation", quotationId, { projectId, status: input.status });
    }
    const result = await client.execute({
      sql: "SELECT id,number,status,issued_at,valid_until,total FROM quotations WHERE id=?",
      args: [quotationId],
    });
    const row = result.rows[0];
    if (String(row.status) === "Sent" && !wasSent) {
      await notifyProjectStakeholders(client, {
        projectId,
        eventType: "quotation_sent",
        subject: `Quotation ${String(row.number)} siap dikirim`,
        message: `quotation ${String(row.number)} sebesar Rp ${asNumber(row.total).toLocaleString("id-ID")} telah ditandai terkirim.`,
        subjectEn: `Quotation ${String(row.number)} is ready`,
        messageEn: `quotation ${String(row.number)} for IDR ${asNumber(row.total).toLocaleString("en-US")} has been marked as sent.`,
        includeFinance: true,
      });
    }
    return ok({
      id: String(row.id),
      number: String(row.number),
      status: String(row.status),
      issuedAt: String(row.issued_at),
      validUntil: row.valid_until ? String(row.valid_until) : null,
      total: asNumber(row.total),
    });
  }

  if (request.method === "DELETE") {
    assertAccess(user, "billing", "manage");
    const result = await client.execute({
      sql: `SELECT q.id FROM quotations q
        LEFT JOIN boq_scopes s ON s.id=q.scope_id
        WHERE q.project_id=? AND (s.sequence=0 OR q.scope_id IS NULL)
        ORDER BY q.created_at DESC LIMIT 1`,
      args: [projectId],
    });
    const quotationId = result.rows[0]?.id;
    if (!quotationId) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
    const invoiceUsage = await client.execute({
      sql: "SELECT id FROM invoices WHERE project_id=? LIMIT 1",
      args: [projectId],
    });
    if (invoiceUsage.rows.length) {
      throw new ApiError(
        409,
        "QUOTATION_IN_USE",
        "Quotation tidak dapat dihapus karena sudah memiliki Invoice.",
      );
    }
    await client.execute({ sql: "DELETE FROM quotations WHERE id=?", args: [quotationId] });
    await writeAuditLog(client, request, user, "delete", "quotation", String(quotationId), {
      projectId,
    });
    return noContent();
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
    paidDateIso: row.paid_date ? String(row.paid_date) : undefined,
  };
}

async function getInvoice(client: Awaited<ReturnType<typeof getDatabase>>["client"], id: string) {
  const result = await client.execute({
    sql: "SELECT i.*,p.name AS project_name FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.id=? LIMIT 1",
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  const row = result.rows[0] as Record<string, unknown>;
  const [tax, payments] = await Promise.all([
    documentTaxSummary(client, "Invoice", id, asNumber(row.amount)),
    client.execute({
      sql: `SELECT pay.*,u.name AS created_by_name,a.bank_name,
        a.account_number_masked
        FROM invoice_payments pay
        LEFT JOIN users u ON u.id=pay.created_by
        LEFT JOIN bank_accounts a ON a.id=pay.bank_account_id
        WHERE pay.invoice_id=?
        ORDER BY pay.paid_date,pay.created_at`,
      args: [id],
    }),
  ]);
  const posted = payments.rows.filter((payment) => String(payment.status) === "Posted");
  const paidGross = posted.reduce(
    (sum, payment) => sum + asNumber(payment.gross_amount),
    0,
  );
  const paidCash = posted.reduce(
    (sum, payment) => sum + asNumber(payment.cash_amount),
    0,
  );
  const withheldTax = posted.reduce(
    (sum, payment) => sum + asNumber(payment.withholding_amount),
    0,
  );
  const status =
    paidGross <= 0
      ? "Belum Lunas"
      : paidGross >= tax.grossTotal
        ? "Lunas"
        : "Dibayar Sebagian";
  return {
    ...mapInvoice(row),
    status,
    ...tax,
    paidGross,
    paidCash,
    withheldTax,
    outstanding: Math.max(0, tax.grossTotal - paidGross),
    payments: payments.rows.map((payment) => ({
      id: String(payment.id),
      grossAmount: asNumber(payment.gross_amount),
      cashAmount: asNumber(payment.cash_amount),
      withholdingAmount: asNumber(payment.withholding_amount),
      paidDate: String(payment.paid_date),
      paymentReference: String(payment.payment_reference),
      paymentMethod: String(payment.payment_method),
      bankAccountId: payment.bank_account_id
        ? String(payment.bank_account_id)
        : undefined,
      bankAccount: payment.bank_name
        ? `${String(payment.bank_name)} ${String(payment.account_number_masked ?? "")}`.trim()
        : undefined,
      attachmentName: payment.attachment_name
        ? String(payment.attachment_name)
        : undefined,
      status: String(payment.status),
      createdBy: payment.created_by_name
        ? String(payment.created_by_name)
        : undefined,
      voidReason: payment.void_reason
        ? String(payment.void_reason)
        : undefined,
    })),
  };
}

async function assertInvoiceAmountWithinQuotation(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  projectId: string,
  amount: number,
  excludeInvoiceId?: string,
) {
  const boq = await getBoq(projectId);
  const quotation = await client.execute({
    sql: "SELECT total FROM quotations WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
    args: [projectId],
  });
  const commercialTotal = quotation.rows[0]
    ? asNumber(quotation.rows[0].total)
    : boq.totals.selling;
  if (commercialTotal <= 0) {
    throw new ApiError(
      409,
      "QUOTATION_REQUIRED",
      "BoQ atau Quotation proyek belum memiliki nilai yang dapat ditagihkan.",
    );
  }
  const existing = await client.execute({
    sql: `SELECT COALESCE(SUM(amount),0) AS total FROM invoices WHERE project_id=?${excludeInvoiceId ? " AND id<>?" : ""}`,
    args: excludeInvoiceId ? [projectId, excludeInvoiceId] : [projectId],
  });
  const committed = asNumber(existing.rows[0]?.total);
  if (committed + amount > commercialTotal) {
    throw new ApiError(
      409,
      "INVOICE_EXCEEDS_QUOTATION",
      `Total Invoice melebihi nilai Quotation. Sisa yang dapat ditagihkan adalah ${Math.max(0, commercialTotal - committed)}.`,
    );
  }
}

async function handleInvoices(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const invoiceId = path[1];
  const action = path[2];

  if (request.method === "GET" && !invoiceId) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (projectId) await assertProjectAccess(user, projectId);
    const scope = projectScopeCondition(user, "p");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      conditions.push("i.project_id=?");
      args.push(projectId);
    }
    if (scope.sql) {
      conditions.push(scope.sql);
      args.push(...scope.args);
    }
    const result = await client.execute({
      sql: `SELECT i.*,p.name AS project_name FROM invoices i JOIN projects p ON p.id=i.project_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY i.issue_date DESC,i.created_at DESC`,
      args,
    });
    return ok(
      await Promise.all(
        result.rows.map((row) => getInvoice(client, String(row.id))),
      ),
    );
  }

  if (request.method === "POST" && !invoiceId) {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat invoice.");
    const input = invoiceSchema.parse(await jsonBody(request));
    assertDateOrder(
      input.issueDate,
      input.dueDate,
      "Jatuh tempo Invoice tidak boleh lebih awal dari tanggal terbit.",
    );
    await assertProjectAccess(user, input.projectId);
    await assertInvoiceAmountWithinQuotation(client, input.projectId, input.amount);
    const count = await client.execute("SELECT COUNT(*) AS count FROM invoices");
    const id = randomUUID();
    const timestamp = now();
    const number = makeSequence("INV", asNumber(count.rows[0]?.count));
    await client.execute({
      sql: "INSERT INTO invoices (id,project_id,number,type,issue_date,due_date,amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [id, input.projectId, number, input.type, input.issueDate, input.dueDate, input.amount, "Belum Lunas", timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "invoice", id, input);
    await notifyProjectStakeholders(client, {
      projectId: input.projectId,
      eventType: "invoice_created",
      subject: `Invoice ${number} diterbitkan`,
      message: `invoice ${number} sebesar Rp ${input.amount.toLocaleString("id-ID")} telah diterbitkan dengan jatuh tempo ${input.dueDate}.`,
      subjectEn: `Invoice ${number} issued`,
      messageEn: `invoice ${number} for IDR ${input.amount.toLocaleString("en-US")} was issued with a due date of ${input.dueDate}.`,
      includeFinance: true,
    });
    return created(await getInvoice(client, id));
  }

  if (invoiceId && action === "pdf" && request.method === "GET") {
    const invoice = await ensureExists("SELECT project_id FROM invoices WHERE id=?", [invoiceId], "Invoice tidak ditemukan.");
    await assertProjectAccess(user, String(invoice.project_id));
    return renderBusinessPdf("invoice", invoiceId, user.preferredLanguage);
  }

  if (invoiceId && action === "payments" && request.method === "GET" && !path[3]) {
    const invoice = await ensureExists(
      "SELECT project_id FROM invoices WHERE id=?",
      [invoiceId],
      "Invoice tidak ditemukan.",
    );
    await assertProjectAccess(user, String(invoice.project_id));
    return ok((await getInvoice(client, invoiceId)).payments);
  }

  if (invoiceId && action === "payments" && request.method === "POST" && !path[3]) {
    if (!mutationRoles("invoices").includes(user.role)) {
      throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mencatat pembayaran invoice.");
    }
    assertAccess(user, "finance", "manage");
    const input = invoicePaymentSchema.parse(await jsonBody(request));
    const invoice = await ensureExists(
      "SELECT * FROM invoices WHERE id=?",
      [invoiceId],
      "Invoice tidak ditemukan.",
    );
    await assertProjectAccess(user, String(invoice.project_id));
    if (input.paymentMethod === "Transfer Bank" && !input.bankAccountId) {
      throw new ApiError(422, "BANK_ACCOUNT_REQUIRED", "Pilih rekening perusahaan.");
    }
    if (input.bankAccountId) {
      const bank = await client.execute({
        sql: "SELECT id FROM bank_accounts WHERE id=? AND status='Aktif' LIMIT 1",
        args: [input.bankAccountId],
      });
      if (!bank.rows.length) {
        throw new ApiError(404, "NOT_FOUND", "Rekening perusahaan aktif tidak ditemukan.");
      }
    }
    const paymentId = `invoice-payment-${randomUUID()}`;
    const transactionId = input.cashAmount > 0 ? randomUUID() : null;
    const timestamp = now();
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: "UPDATE invoices SET updated_at=updated_at WHERE id=?",
        args: [invoiceId],
      });
      const current = await getInvoice(tx, invoiceId);
      if (current.paidGross + input.grossAmount > current.grossTotal) {
        throw new ApiError(
          409,
          "OVERPAYMENT",
          "Pembayaran melebihi nilai bruto invoice.",
        );
      }
      if (
        current.withheldTax + input.withholdingAmount >
        current.taxWithholdings
      ) {
        throw new ApiError(
          409,
          "WITHHOLDING_EXCEEDED",
          "Pajak yang dipotong klien melebihi snapshot pajak invoice.",
        );
      }
      await lockDocumentTaxes(
        tx,
        "Invoice",
        invoiceId,
        String(invoice.due_date),
      );
      if (transactionId) {
        await tx.execute({
          sql: `INSERT INTO transactions
            (id,project_id,date,type,description,amount,source,reference_id,
             category,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            transactionId,
            invoice.project_id,
            input.paidDate,
            "Pemasukan",
            `Pembayaran ${String(invoice.number)} - ${input.paymentReference}`,
            input.cashAmount,
            "Invoice Payment",
            paymentId,
            "Penjualan",
            user.id,
            timestamp,
            timestamp,
          ],
        });
      }
      await tx.execute({
        sql: `INSERT INTO invoice_payments
          (id,invoice_id,gross_amount,cash_amount,withholding_amount,paid_date,
           payment_reference,payment_method,bank_account_id,attachment_name,
           attachment_mime_type,attachment_content_base64,status,transaction_id,
           created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          paymentId,
          invoiceId,
          input.grossAmount,
          input.cashAmount,
          input.withholdingAmount,
          input.paidDate,
          input.paymentReference,
          input.paymentMethod,
          input.bankAccountId ?? null,
          input.attachment.name,
          input.attachment.mimeType,
          input.attachment.contentBase64,
          "Posted",
          transactionId,
          user.id,
          timestamp,
          timestamp,
        ],
      });
      const paidGross = current.paidGross + input.grossAmount;
      await tx.execute({
        sql: "UPDATE invoices SET status=?,paid_date=?,updated_at=? WHERE id=?",
        args: [
          paidGross >= current.grossTotal ? "Lunas" : "Belum Lunas",
          paidGross >= current.grossTotal ? input.paidDate : null,
          timestamp,
          invoiceId,
        ],
      });
    });
    await writeAuditLog(client, request, user, "pay", "invoice", invoiceId, {
      paymentId,
      grossAmount: input.grossAmount,
      cashAmount: input.cashAmount,
      withholdingAmount: input.withholdingAmount,
      paymentReference: input.paymentReference,
    });
    const updated = await getInvoice(client, invoiceId);
    await notifyProjectStakeholders(client, {
      projectId: String(invoice.project_id),
      eventType: "invoice_paid",
      subject: `Pembayaran ${String(invoice.number)} diterima`,
      message: `pembayaran invoice ${String(invoice.number)} sebesar Rp ${input.grossAmount.toLocaleString("id-ID")} telah dicatat.`,
      subjectEn: `Payment for ${String(invoice.number)} received`,
      messageEn: `an invoice payment of IDR ${input.grossAmount.toLocaleString("en-US")} for ${String(invoice.number)} was recorded.`,
      includeFinance: true,
    });
    return created(updated);
  }

  if (
    invoiceId &&
    action === "payments" &&
    path[3] &&
    path[4] === "void" &&
    request.method === "POST"
  ) {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat membatalkan pembayaran.");
    }
    assertAccess(user, "finance", "manage");
    const input = z
      .object({ reason: z.string().trim().min(5).max(500) })
      .parse(await jsonBody(request));
    const paymentId = path[3];
    const paymentResult = await client.execute({
      sql: `SELECT pay.*,i.project_id,i.number,i.amount AS invoice_amount
        FROM invoice_payments pay
        JOIN invoices i ON i.id=pay.invoice_id
        WHERE pay.id=? AND pay.invoice_id=? AND pay.status='Posted' LIMIT 1`,
      args: [paymentId, invoiceId],
    });
    const payment = paymentResult.rows[0];
    if (!payment) {
      throw new ApiError(404, "NOT_FOUND", "Pembayaran aktif tidak ditemukan.");
    }
    await assertProjectAccess(user, String(payment.project_id));
    if (payment.transaction_id) {
      const reconciled = await client.execute({
        sql: `SELECT 1 FROM bank_statement_entries
          WHERE transaction_id=? AND reconciliation_status='Matched' LIMIT 1`,
        args: [payment.transaction_id],
      });
      if (reconciled.rows.length) {
        throw new ApiError(
          409,
          "PAYMENT_RECONCILED",
          "Lepaskan rekonsiliasi bank sebelum membatalkan pembayaran.",
        );
      }
    }
    const timestamp = now();
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `UPDATE invoice_payments SET status='Void',voided_by=?,voided_at=?,
          void_reason=?,updated_at=? WHERE id=?`,
        args: [user.id, timestamp, input.reason, timestamp, paymentId],
      });
      if (asNumber(payment.cash_amount) > 0) {
        await tx.execute({
          sql: `INSERT INTO transactions
            (id,project_id,date,type,description,amount,source,reference_id,
             category,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            randomUUID(),
            payment.project_id,
            timestamp.slice(0, 10),
            "Pengeluaran",
            `Reversal pembayaran ${String(payment.number)}`,
            payment.cash_amount,
            "Invoice Payment Reversal",
            paymentId,
            "Penjualan",
            user.id,
            timestamp,
            timestamp,
          ],
        });
      }
      const remaining = await tx.execute({
        sql: `SELECT COALESCE(SUM(gross_amount),0) AS total,
          MAX(paid_date) AS last_paid
          FROM invoice_payments WHERE invoice_id=? AND status='Posted'`,
        args: [invoiceId],
      });
      const tax = await documentTaxSummary(
        tx,
        "Invoice",
        invoiceId,
        asNumber(payment.invoice_amount),
      );
      const paidGross = asNumber(remaining.rows[0]?.total);
      await tx.execute({
        sql: "UPDATE invoices SET status=?,paid_date=?,updated_at=? WHERE id=?",
        args: [
          paidGross >= tax.grossTotal ? "Lunas" : "Belum Lunas",
          paidGross >= tax.grossTotal
            ? remaining.rows[0]?.last_paid ?? null
            : null,
          timestamp,
          invoiceId,
        ],
      });
    });
    await writeAuditLog(client, request, user, "void_payment", "invoice", invoiceId, {
      paymentId,
      reason: input.reason,
    });
    return ok(await getInvoice(client, invoiceId));
  }

  if (
    invoiceId &&
    action === "payment" &&
    ["POST", "PATCH"].includes(request.method)
  ) {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengonfirmasi pembayaran.");
    assertAccess(user, "finance", "manage");
    const invoice = await ensureExists(
      "SELECT * FROM invoices WHERE id=?",
      [invoiceId],
      "Invoice tidak ditemukan.",
    );
    await assertProjectAccess(user, String(invoice.project_id));
    const input = z
      .object({
        status: z.enum(["Belum Lunas", "Lunas"]).default("Lunas"),
        paidDate: isoDateSchema.optional(),
      })
      .parse(await jsonBody(request));
    const paidDate =
      input.paidDate ?? invoice.paid_date ?? now().slice(0, 10);
    const timestamp = now();
    const current = await getInvoice(client, invoiceId);
    if (input.status === "Belum Lunas") {
      if (current.payments.some((payment) => payment.status === "Posted")) {
        throw new ApiError(
          409,
          "PAYMENT_VOID_REQUIRED",
          "Batalkan setiap pembayaran aktif melalui histori pembayaran.",
        );
      }
      await detachOrDeleteSystemTransaction(client, "Invoice", invoiceId);
      await client.execute({
        sql: "UPDATE invoices SET status='Belum Lunas',paid_date=NULL,updated_at=? WHERE id=?",
        args: [timestamp, invoiceId],
      });
    } else if (current.outstanding > 0) {
      const withholdingAmount = Math.min(
        current.outstanding,
        Math.max(0, current.taxWithholdings - current.withheldTax),
      );
      const cashAmount = current.outstanding - withholdingAmount;
      const paymentId = `invoice-payment-${randomUUID()}`;
      const transactionId = cashAmount > 0 ? randomUUID() : null;
      await client.transaction(async (tx) => {
        await lockDocumentTaxes(
          tx,
          "Invoice",
          invoiceId,
          String(invoice.due_date),
        );
        if (transactionId) {
          await tx.execute({
            sql: `INSERT INTO transactions
              (id,project_id,date,type,description,amount,source,reference_id,
               category,created_by,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [
              transactionId,
              invoice.project_id,
              paidDate,
              "Pemasukan",
              `Pembayaran ${String(invoice.number)}`,
              cashAmount,
              "Invoice Payment",
              paymentId,
              "Penjualan",
              user.id,
              timestamp,
              timestamp,
            ],
          });
        }
        await tx.execute({
          sql: `INSERT INTO invoice_payments
            (id,invoice_id,gross_amount,cash_amount,withholding_amount,paid_date,
             payment_reference,payment_method,attachment_name,
             attachment_mime_type,attachment_content_base64,status,
             transaction_id,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,'Posted',?,?,?,?)`,
          args: [
            paymentId,
            invoiceId,
            current.outstanding,
            cashAmount,
            withholdingAmount,
            paidDate,
            `LEGACY-${String(invoice.number)}`,
            "Lainnya",
            "Konfirmasi pembayaran kompatibilitas",
            "text/plain",
            "S29uZmlybWFzaSBwZW1iYXlhcmFu",
            transactionId,
            user.id,
            timestamp,
            timestamp,
          ],
        });
        await tx.execute({
          sql: "UPDATE invoices SET status='Lunas',paid_date=?,updated_at=? WHERE id=?",
          args: [paidDate, timestamp, invoiceId],
        });
      });
    }
    await writeAuditLog(
      client,
      request,
      user,
      input.status === "Lunas" ? "confirm_payment" : "cancel_payment",
      "invoice",
      invoiceId,
      { status: input.status, paidDate },
    );
    if (input.status === "Lunas" && invoice.status !== "Lunas") {
      await notifyProjectStakeholders(client, {
        projectId: String(invoice.project_id),
        eventType: "invoice_paid",
        subject: `Pembayaran ${String(invoice.number)} diterima`,
        message: `pembayaran invoice ${String(invoice.number)} sebesar Rp ${asNumber(invoice.amount).toLocaleString("id-ID")} telah dikonfirmasi.`,
        subjectEn: `Payment for ${String(invoice.number)} received`,
        messageEn: `invoice ${String(invoice.number)} payment of IDR ${asNumber(invoice.amount).toLocaleString("en-US")} has been confirmed.`,
        includeFinance: true,
      });
    }
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "GET") {
    const invoice = await ensureExists("SELECT project_id FROM invoices WHERE id=?", [invoiceId], "Invoice tidak ditemukan.");
    await assertProjectAccess(user, String(invoice.project_id));
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "PATCH") {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah invoice.");
    const input = invoicePatchSchema.parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM invoices WHERE id=?", [invoiceId], "Invoice tidak ditemukan.");
    await assertProjectAccess(user, String(current.project_id));
    const locked = await client.execute({
      sql: `SELECT
        EXISTS(SELECT 1 FROM invoice_payments WHERE invoice_id=?) AS has_payment,
        EXISTS(SELECT 1 FROM document_taxes
          WHERE document_type='Invoice' AND document_id=? AND locked=1) AS tax_locked`,
      args: [invoiceId, invoiceId],
    });
    if (
      Number(locked.rows[0]?.has_payment) === 1 ||
      locked.rows[0]?.has_payment === true ||
      Number(locked.rows[0]?.tax_locked) === 1 ||
      locked.rows[0]?.tax_locked === true
    ) {
      throw new ApiError(
        409,
        "INVOICE_LOCKED",
        "Invoice yang sudah memiliki histori pembayaran atau snapshot pajak terkunci tidak dapat diedit.",
      );
    }
    assertDateOrder(
      input.issueDate ?? current.issue_date,
      input.dueDate ?? current.due_date,
      "Jatuh tempo Invoice tidak boleh lebih awal dari tanggal terbit.",
    );
    await assertInvoiceAmountWithinQuotation(
      client,
      String(current.project_id),
      input.amount ?? asNumber(current.amount),
      invoiceId,
    );
    await client.execute({
      sql: "UPDATE invoices SET type=?,issue_date=?,due_date=?,amount=?,updated_at=? WHERE id=?",
      args: [input.type ?? current.type, input.issueDate ?? current.issue_date, input.dueDate ?? current.due_date, input.amount ?? current.amount, now(), invoiceId],
    });
    await writeAuditLog(client, request, user, "update", "invoice", invoiceId, input);
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "DELETE") {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus invoice.");
    const invoice = await ensureExists("SELECT project_id,status FROM invoices WHERE id=?", [invoiceId], "Invoice tidak ditemukan.");
    await assertProjectAccess(user, String(invoice.project_id));
    const history = await client.execute({
      sql: `SELECT
        EXISTS(SELECT 1 FROM invoice_payments WHERE invoice_id=?) AS has_payment,
        EXISTS(SELECT 1 FROM document_taxes
          WHERE document_type='Invoice' AND document_id=?) AS has_tax`,
      args: [invoiceId, invoiceId],
    });
    if (
      Number(history.rows[0]?.has_payment) === 1 ||
      history.rows[0]?.has_payment === true ||
      Number(history.rows[0]?.has_tax) === 1 ||
      history.rows[0]?.has_tax === true
    ) {
      throw new ApiError(
        409,
        "INVOICE_HISTORY_EXISTS",
        "Invoice dengan histori pembayaran atau pajak tidak dapat dihapus. Gunakan void pada pembayaran.",
      );
    }
    await detachOrDeleteSystemTransaction(client, "Invoice", invoiceId);
    await client.execute({
      sql: "DELETE FROM invoices WHERE id=?",
      args: [invoiceId],
    });
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
    vendorType: String(row.vendor_type ?? "Jasa"),
    categoryIds: parseJson<string[]>(row.category_ids_json, []),
    categories: parseJson<Array<{ id: string; name: string; nameEn: string }>>(
      row.categories_json,
      [],
    ),
    rate: asNumber(row.rate),
    status: String(row.status),
  };
}

async function vendorRowsWithCategories(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  rows: Array<Record<string, unknown>>,
) {
  if (!rows.length) return rows;
  const assignments = await client.execute({
    sql: `SELECT a.vendor_id,c.id,c.name,c.name_en
      FROM vendor_category_assignments a
      JOIN vendor_categories c ON c.id=a.category_id
      WHERE a.vendor_id IN (${rows.map(() => "?").join(",")})
      ORDER BY c.sort_order,c.name`,
    args: rows.map((row) => row.id),
  });
  return rows.map((row) => {
    const categories = assignments.rows
      .filter((assignment) => String(assignment.vendor_id) === String(row.id))
      .map((assignment) => ({
        id: String(assignment.id),
        name: String(assignment.name),
        nameEn: String(assignment.name_en ?? ""),
      }));
    return {
      ...row,
      category_ids_json: JSON.stringify(categories.map((category) => category.id)),
      categories_json: JSON.stringify(categories),
    };
  });
}

async function validateVendorCategories(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  categoryIds: string[],
  vendorType: "Supplier" | "Jasa" | "Hybrid",
) {
  if (!categoryIds.length) {
    throw new ApiError(422, "CATEGORY_REQUIRED", "Pilih minimal satu kategori vendor.");
  }
  const uniqueIds = [...new Set(categoryIds)];
  const result = await client.execute({
    sql: `SELECT id,vendor_type FROM vendor_categories
      WHERE id IN (${uniqueIds.map(() => "?").join(",")}) AND status='Aktif'`,
    args: uniqueIds,
  });
  if (result.rows.length !== uniqueIds.length) {
    throw new ApiError(422, "INVALID_CATEGORY", "Salah satu kategori vendor tidak aktif atau tidak ditemukan.");
  }
  if (
    vendorType !== "Hybrid" &&
    result.rows.some(
      (row) =>
        ![vendorType, "Hybrid"].includes(String(row.vendor_type)),
    )
  ) {
    throw new ApiError(
      422,
      "CATEGORY_TYPE_MISMATCH",
      "Tipe kategori tidak sesuai dengan tipe vendor.",
    );
  }
  return uniqueIds;
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
    const rows = await vendorRowsWithCategories(
      client,
      result.rows as Array<Record<string, unknown>>,
    );
    return ok(rows.map((row) => mapVendor(row)));
  }

  if (request.method === "POST" && !vendorId) {
    if (!["Admin", "Finance"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Hanya Admin dan Finance yang dapat menambah vendor.");
    const input = vendorSchema.parse(await jsonBody(request));
    let categoryIds = input.categoryIds ?? [];
    if (!categoryIds.length && input.category) {
      const legacyCategory = await client.execute({
        sql: "SELECT id FROM vendor_categories WHERE name=? AND status='Aktif' LIMIT 1",
        args: [input.category],
      });
      if (legacyCategory.rows[0]) {
        categoryIds = [String(legacyCategory.rows[0].id)];
      } else {
        const categoryId = randomUUID();
        const inferredType = input.category.toLowerCase().includes("supplier")
          ? "Supplier"
          : "Jasa";
        await client.execute({
          sql: `INSERT INTO vendor_categories
            (id,name,name_en,vendor_type,status,sort_order,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [
            categoryId,
            input.category,
            input.category,
            inferredType,
            "Aktif",
            999,
            user.id,
            now(),
            now(),
          ],
        });
        categoryIds = [categoryId];
      }
    }
    if (!categoryIds.length) {
      throw new ApiError(422, "CATEGORY_REQUIRED", "Pilih minimal satu kategori vendor.");
    }
    const primaryCategory = await client.execute({
      sql: "SELECT name,vendor_type FROM vendor_categories WHERE id=?",
      args: [categoryIds[0]],
    });
    const vendorType =
      input.vendorType ??
      (String(primaryCategory.rows[0]?.vendor_type ?? "Jasa") as
        | "Supplier"
        | "Jasa"
        | "Hybrid");
    categoryIds = await validateVendorCategories(client, categoryIds, vendorType);
    const id = randomUUID();
    const timestamp = now();
    await client.batch([
      {
        sql: "INSERT INTO vendors (id,name,category,vendor_type,contact,email,address,rate,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        args: [id, input.name, primaryCategory.rows[0]?.name, vendorType, input.contact, input.email || null, input.address ?? null, input.rate ?? 0, input.status, timestamp, timestamp],
      },
      ...categoryIds.map((categoryId) => ({
        sql: "INSERT INTO vendor_category_assignments (vendor_id,category_id,created_at) VALUES (?,?,?)",
        args: [id, categoryId, timestamp],
      })),
    ], "write");
    await writeAuditLog(client, request, user, "create", "vendor", id, input);
    const createdRows = await vendorRowsWithCategories(client, [
      (await ensureExists("SELECT * FROM vendors WHERE id=?", [id], "Vendor tidak ditemukan.")) as Record<string, unknown>,
    ]);
    return created(mapVendor(createdRows[0]));
  }

  if (vendorId && request.method === "GET") {
    const row = await ensureExists("SELECT * FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    const rows = await vendorRowsWithCategories(client, [row as Record<string, unknown>]);
    return ok(mapVendor(rows[0]));
  }

  if (vendorId && request.method === "PATCH") {
    if (!["Admin", "Finance"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Hanya Admin dan Finance yang dapat mengubah vendor.");
    const input = vendorSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    const vendorType = input.vendorType ?? String(current.vendor_type ?? "Jasa") as "Supplier" | "Jasa" | "Hybrid";
    let categoryIds = input.categoryIds;
    if (!categoryIds && input.category) {
      const legacyCategory = await client.execute({
        sql: "SELECT id FROM vendor_categories WHERE name=? AND status='Aktif' LIMIT 1",
        args: [input.category],
      });
      categoryIds = legacyCategory.rows[0] ? [String(legacyCategory.rows[0].id)] : [];
    }
    if (categoryIds) {
      categoryIds = await validateVendorCategories(client, categoryIds, vendorType);
    }
    const primaryCategory = categoryIds?.length
      ? await client.execute({
          sql: "SELECT name FROM vendor_categories WHERE id=?",
          args: [categoryIds[0]],
        })
      : null;
    await client.batch([
      {
        sql: "UPDATE vendors SET name=?,category=?,vendor_type=?,contact=?,email=?,address=?,rate=?,status=?,updated_at=? WHERE id=?",
        args: [
          input.name ?? current.name,
          primaryCategory?.rows[0]?.name ?? input.category ?? current.category,
          vendorType,
          input.contact ?? current.contact,
          input.email === undefined ? current.email : input.email || null,
          input.address === undefined ? current.address : input.address,
          input.rate ?? current.rate,
          input.status ?? current.status,
          now(),
          vendorId,
        ],
      },
      ...(categoryIds
        ? [
            { sql: "DELETE FROM vendor_category_assignments WHERE vendor_id=?", args: [vendorId] },
            ...categoryIds.map((categoryId) => ({
              sql: "INSERT INTO vendor_category_assignments (vendor_id,category_id,created_at) VALUES (?,?,?)",
              args: [vendorId, categoryId, now()],
            })),
          ]
        : []),
    ], "write");
    await writeAuditLog(client, request, user, "update", "vendor", vendorId, input);
    const updated = await ensureExists("SELECT * FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    const updatedRows = await vendorRowsWithCategories(client, [updated as Record<string, unknown>]);
    return ok(mapVendor(updatedRows[0]));
  }

  if (vendorId && request.method === "DELETE") {
    if (!["Admin", "Finance"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Hanya Admin dan Finance yang dapat menghapus vendor.");
    const vendor = await ensureExists("SELECT id,name,status FROM vendors WHERE id=?", [vendorId], "Vendor tidak ditemukan.");
    const usage = await client.execute({
      sql: `SELECT number,document_type,workflow_status,approval_status
        FROM spks WHERE vendor_id=? ORDER BY created_at DESC LIMIT 25`,
      args: [vendorId],
    });
    if (usage.rows.length) {
      const documents = usage.rows.map((row) => ({
        number: String(row.number),
        type: String(row.document_type ?? "SPK"),
        workflowStatus: String(row.workflow_status ?? "Draft"),
        approvalStatus: String(row.approval_status ?? "Draft"),
      }));
      const active = documents.filter((document) => !["Selesai", "Void"].includes(document.workflowStatus));
      throw new ApiError(
        409,
        active.length ? "VENDOR_HAS_ACTIVE_CONTRACT" : "VENDOR_HAS_HISTORY",
        active.length
          ? `Vendor masih terikat ${active.length} kontrak aktif dan tidak dapat dihapus. Selesaikan kontrak atau nonaktifkan vendor.`
          : "Vendor memiliki histori SPK/PO dan tidak dapat dihapus. Nonaktifkan vendor agar histori tetap utuh.",
        { vendorName: vendor.name, activeCount: active.length, documents },
      );
    }
    await client.execute({ sql: "DELETE FROM vendors WHERE id=?", args: [vendorId] });
    await writeAuditLog(client, request, user, "delete", "vendor", vendorId, {
      vendorName: vendor.name,
      status: vendor.status,
      contractCount: 0,
    });
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
    paymentStatus: String(row.payment_status ?? "Belum Dibayar"),
    paidDate: row.paid_date ? String(row.paid_date) : undefined,
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

  if (
    request.method !== "GET" &&
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_LEGACY_SPK_MUTATIONS !== "true"
  ) {
    throw new ApiError(
      410,
      "LEGACY_ENDPOINT_READ_ONLY",
      "Endpoint SPK lama hanya dapat dibaca. Gunakan /api/procurement-orders agar approval, verifikasi, bukti pembayaran, dan audit tetap lengkap.",
    );
  }

  if (request.method === "GET" && !spkId) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (projectId) await assertProjectAccess(user, projectId);
    const scope = projectScopeCondition(user, "p");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      conditions.push("s.project_id=?");
      args.push(projectId);
    }
    if (scope.sql) {
      conditions.push(scope.sql);
      args.push(...scope.args);
    }
    const result = await client.execute({
      sql: `
      SELECT s.*,v.name AS vendor_name,p.name AS project_name
      FROM spks s JOIN vendors v ON v.id=s.vendor_id JOIN projects p ON p.id=s.project_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY s.created_at DESC
    `,
      args,
    });
    return ok(result.rows.map((row) => mapSpk(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !spkId) {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat SPK.");
    const input = spkSchema.parse(await jsonBody(request));
    assertDateOrder(input.startDate, input.endDate);
    await ensureExists("SELECT id FROM vendors WHERE id=? AND status='Aktif'", [input.vendorId], "Vendor aktif tidak ditemukan.");
    await assertProjectAccess(user, input.projectId);
    const count = await client.execute("SELECT COUNT(*) AS count FROM spks");
    const id = randomUUID();
    const number = makeSequence("SPK", asNumber(count.rows[0]?.count));
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO spks (id,number,vendor_id,project_id,scope,cost,status,start_date,end_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, number, input.vendorId, input.projectId, input.scope, input.cost, input.status, input.startDate ?? null, input.endDate ?? null, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "spk", id, input);
    await notifyProjectStakeholders(client, {
      projectId: input.projectId,
      eventType: "spk_created",
      subject: `SPK ${number} dibuat`,
      message: `SPK ${number} untuk vendor telah dibuat dengan nilai Rp ${input.cost.toLocaleString("id-ID")}.`,
      subjectEn: `Work Order ${number} created`,
      messageEn: `Work Order ${number} was created for a vendor with a value of IDR ${input.cost.toLocaleString("en-US")}.`,
      includeFinance: true,
    });
    return created(await getSpk(id));
  }

  if (spkId && action === "pdf" && request.method === "GET") {
    const spk = await ensureExists("SELECT project_id,status,number FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    await assertProjectAccess(user, String(spk.project_id));
    return renderBusinessPdf("spk", spkId, user.preferredLanguage);
  }

  if (spkId && action === "payment" && request.method === "PATCH") {
    if (!mutationRoles("procurement").includes(user.role)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Anda tidak dapat mengubah status pembayaran SPK.",
      );
    }
    assertAccess(user, "finance", "manage");
    const input = z
      .object({
        status: z.enum(["Belum Dibayar", "Dibayar"]),
        paidDate: isoDateSchema.optional(),
      })
      .parse(await jsonBody(request));
    const spk = await ensureExists(
      "SELECT project_id,number,cost,payment_status FROM spks WHERE id=?",
      [spkId],
      "SPK tidak ditemukan.",
    );
    await assertProjectAccess(user, String(spk.project_id));
    const paidDate =
      input.status === "Dibayar"
        ? input.paidDate ?? now().slice(0, 10)
        : null;
    await client.execute({
      sql: "UPDATE spks SET payment_status=?,paid_date=?,updated_at=? WHERE id=?",
      args: [input.status, paidDate, now(), spkId],
    });
    await syncSpkTransaction(client, spkId, user.id);
    await writeAuditLog(
      client,
      request,
      user,
      input.status === "Dibayar" ? "confirm_payment" : "cancel_payment",
      "spk",
      spkId,
      { status: input.status, paidDate },
    );
    if (
      input.status === "Dibayar" &&
      String(spk.payment_status) !== "Dibayar"
    ) {
      await notifyProjectStakeholders(client, {
        projectId: String(spk.project_id),
        eventType: "spk_paid",
        subject: `Pembayaran SPK ${String(spk.number)} dikonfirmasi`,
        message: `pembayaran vendor sebesar Rp ${asNumber(spk.cost).toLocaleString("id-ID")} untuk SPK ${String(spk.number)} telah dicatat.`,
        subjectEn: `Work Order ${String(spk.number)} payment confirmed`,
        messageEn: `vendor payment of IDR ${asNumber(spk.cost).toLocaleString("en-US")} for Work Order ${String(spk.number)} was recorded.`,
        includeFinance: true,
      });
    }
    return ok(await getSpk(spkId));
  }

  if (spkId && action === "status" && request.method === "PATCH") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah status SPK.");
    const input = z.object({ status: z.enum(["Draft", "Dikirim", "Dikerjakan", "Selesai"]) }).parse(await jsonBody(request));
    const spk = await ensureExists(
      "SELECT project_id,status,number FROM spks WHERE id=?",
      [spkId],
      "SPK tidak ditemukan.",
    );
    await assertProjectAccess(user, String(spk.project_id));
    await client.execute({ sql: "UPDATE spks SET status=?,updated_at=? WHERE id=?", args: [input.status, now(), spkId] });
    await syncSpkTransaction(client, spkId, user.id);
    await writeAuditLog(client, request, user, "update_status", "spk", spkId, input);
    if (
      input.status !== String(spk.status) &&
      ["Dikirim", "Selesai"].includes(input.status)
    ) {
      await notifyProjectStakeholders(client, {
        projectId: String(spk.project_id),
        eventType: input.status === "Selesai" ? "spk_completed" : "spk_sent",
        subject:
          input.status === "Selesai"
            ? `SPK ${String(spk.number)} selesai`
            : `SPK ${String(spk.number)} dikirim`,
        message:
          input.status === "Selesai"
            ? `pekerjaan pada SPK ${String(spk.number)} telah ditandai selesai.`
            : `SPK ${String(spk.number)} telah dikirim untuk pelaksanaan.`,
        subjectEn:
          input.status === "Selesai"
            ? `Work Order ${String(spk.number)} completed`
            : `Work Order ${String(spk.number)} sent`,
        messageEn:
          input.status === "Selesai"
            ? `the work in Work Order ${String(spk.number)} has been marked completed.`
            : `Work Order ${String(spk.number)} has been sent for execution.`,
        includeFinance: true,
      });
    }
    return ok(await getSpk(spkId));
  }

  if (spkId && !action && request.method === "GET") {
    const spk = await ensureExists("SELECT project_id FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    await assertProjectAccess(user, String(spk.project_id));
    return ok(await getSpk(spkId));
  }

  if (spkId && !action && request.method === "PATCH") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah SPK.");
    const input = spkSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    if (current.payment_status === "Dibayar") {
      assertAccess(user, "finance", "manage");
    }
    await assertProjectAccess(user, String(current.project_id));
    assertDateOrder(
      input.startDate === undefined ? current.start_date : input.startDate,
      input.endDate === undefined ? current.end_date : input.endDate,
    );
    if (input.projectId && input.projectId !== current.project_id) {
      await assertProjectAccess(user, input.projectId);
    }
    if (input.vendorId) {
      await ensureExists(
        "SELECT id FROM vendors WHERE id=? AND status='Aktif'",
        [input.vendorId],
        "Vendor aktif tidak ditemukan.",
      );
    }
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
    await syncSpkTransaction(client, spkId, user.id);
    await writeAuditLog(client, request, user, "update", "spk", spkId, input);
    return ok(await getSpk(spkId));
  }

  if (spkId && !action && request.method === "DELETE") {
    if (!mutationRoles("procurement").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus SPK.");
    const spk = await ensureExists("SELECT project_id,payment_status FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    if (spk.payment_status === "Dibayar") {
      assertAccess(user, "finance", "manage");
    }
    await assertProjectAccess(user, String(spk.project_id));
    await detachOrDeleteSystemTransaction(client, "SPK", spkId);
    await client.execute({
      sql: "DELETE FROM spks WHERE id=?",
      args: [spkId],
    });
    await writeAuditLog(client, request, user, "delete", "spk", spkId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint SPK tidak ditemukan.");
}

type ValidationRow = Record<string, unknown>;

async function validationBoqItems(projectId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT i.id,i.category,i.description,i.quantity,i.unit,i.sort_order
      FROM boq_items i
      JOIN boqs b ON b.id=i.boq_id
      WHERE b.project_id=? AND i.category IN ('Perangkat','Material')
      ORDER BY i.sort_order,i.created_at
    `,
    args: [projectId],
  });
  return result.rows;
}

function mapValidation(row: ValidationRow, items: ValidationRow[]) {
  const mappedItems = items.map((item) => ({
    id: String(item.id),
    boqItemId: item.boq_item_id ? String(item.boq_item_id) : undefined,
    category: String(item.category),
    description: String(item.description),
    quantity: asNumber(item.quantity),
    unit: String(item.unit),
    checked: Boolean(asNumber(item.checked)),
    notes: item.notes ? String(item.notes) : "",
  }));
  return {
    id: row.id ? String(row.id) : null,
    number: row.number ? String(row.number) : null,
    projectId: String(row.project_id),
    project: row.project_name ? String(row.project_name) : undefined,
    client: row.project_client ? String(row.project_client) : undefined,
    location: row.project_location ? String(row.project_location) : undefined,
    status: row.status ? String(row.status) : "Draft",
    notes: row.notes ? String(row.notes) : "",
    validatedBy: row.validator_name ? String(row.validator_name) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    items: mappedItems,
    checkedCount: mappedItems.filter((item) => item.checked).length,
    totalCount: mappedItems.length,
  };
}

async function readValidation(projectId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT v.*,p.name AS project_name,p.client AS project_client,p.location AS project_location,
        u.name AS validator_name
      FROM project_validations v
      JOIN projects p ON p.id=v.project_id
      LEFT JOIN users u ON u.id=v.validated_by
      WHERE v.project_id=? LIMIT 1
    `,
    args: [projectId],
  });
  const validation = result.rows[0];
  if (!validation) {
    const project = await ensureExists(
      "SELECT id AS project_id,name AS project_name,client AS project_client,location AS project_location FROM projects WHERE id=?",
      [projectId],
      "Proyek tidak ditemukan.",
    );
    const boqItems = await validationBoqItems(projectId);
    return mapValidation(
      { ...project, id: null, number: null, status: "Draft", notes: "" },
      boqItems.map((item) => ({
        ...item,
        id: String(item.id),
        boq_item_id: item.id,
        checked: 0,
        notes: "",
      })),
    );
  }
  const items = await client.execute({
    sql: "SELECT * FROM project_validation_items WHERE validation_id=? ORDER BY sort_order,created_at",
    args: [validation.id],
  });
  return mapValidation(validation as ValidationRow, items.rows as ValidationRow[]);
}

async function ensureValidation(projectId: string, userId: string) {
  const { client } = await getDatabase();
  const boqItems = await validationBoqItems(projectId);
  if (!boqItems.length) {
    throw new ApiError(
      409,
      "VALIDATION_ITEMS_REQUIRED",
      "BoQ harus memiliki minimal satu Perangkat atau Material sebelum validasi dibuat.",
    );
  }
  const existing = await client.execute({
    sql: "SELECT id FROM project_validations WHERE project_id=? LIMIT 1",
    args: [projectId],
  });
  const validationId = existing.rows[0]
    ? String(existing.rows[0].id)
    : randomUUID();
  const timestamp = now();
  if (!existing.rows[0]) {
    const count = await client.execute("SELECT COUNT(*) AS count FROM project_validations");
    await client.execute({
      sql: "INSERT INTO project_validations (id,number,project_id,status,notes,validated_by,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      args: [validationId, makeSequence("VAL", asNumber(count.rows[0]?.count)), projectId, "Draft", "", userId, null, timestamp, timestamp],
    });
  }
  const existingItems = await client.execute({
    sql: "SELECT boq_item_id FROM project_validation_items WHERE validation_id=?",
    args: [validationId],
  });
  const known = new Set(existingItems.rows.map((item) => String(item.boq_item_id)));
  const missing = boqItems.filter((item) => !known.has(String(item.id)));
  if (missing.length) {
    await client.batch(
      missing.map((item) => ({
        sql: "INSERT INTO project_validation_items (id,validation_id,boq_item_id,category,description,quantity,unit,checked,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [randomUUID(), validationId, item.id, item.category, item.description, item.quantity, item.unit, 0, "", item.sort_order, timestamp, timestamp],
      })),
      "write",
    );
  }
  return readValidation(projectId);
}

async function assertCompletedValidation(projectId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT id FROM project_validations WHERE project_id=? AND status='Completed' LIMIT 1",
    args: [projectId],
  });
  if (!result.rows.length) {
    throw new ApiError(
      409,
      "VALIDATION_REQUIRED",
      "Selesaikan checklist validasi Perangkat dan Material sebelum BAST diterbitkan.",
    );
  }
}

async function handleValidations(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const validationId = path[1];
  const action = path[2];
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!validationId && request.method === "GET") {
    if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    await assertProjectAccess(user, projectId);
    return ok(await readValidation(projectId));
  }

  if (!validationId && request.method === "POST") {
    assertAccess(user, "bast", "manage");
    if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    await assertProjectAccess(user, projectId);
    const validation = await ensureValidation(projectId, user.id);
    await writeAuditLog(client, request, user, "create_or_sync", "project_validation", String(validation.id), { projectId });
    return created(validation);
  }

  const validation = await ensureExists(
    "SELECT * FROM project_validations WHERE id=?",
    [validationId],
    "Form validasi tidak ditemukan.",
  );
  await assertProjectAccess(user, String(validation.project_id));

  if (validationId && action === "pdf" && request.method === "GET") {
    return renderValidationPdf(validationId, user.preferredLanguage);
  }

  if (validationId && !action && request.method === "PATCH") {
    assertAccess(user, "bast", "manage");
    const input = validationUpdateSchema.parse(await jsonBody(request));
    const rows = await client.execute({
      sql: "SELECT id FROM project_validation_items WHERE validation_id=?",
      args: [validationId],
    });
    const allowed = new Set(rows.rows.map((row) => String(row.id)));
    if (input.items.some((item) => !allowed.has(item.id))) {
      throw new ApiError(422, "INVALID_VALIDATION_ITEM", "Item validasi tidak sesuai dengan BoQ proyek.");
    }
    const timestamp = now();
    await client.batch(
      input.items.map((item) => ({
        sql: "UPDATE project_validation_items SET checked=?,notes=?,updated_at=? WHERE id=? AND validation_id=?",
        args: [item.checked ? 1 : 0, item.notes, timestamp, item.id, validationId],
      })),
      "write",
    );
    if (input.status === "Completed") {
      const incomplete = await client.execute({
        sql: "SELECT COUNT(*) AS count FROM project_validation_items WHERE validation_id=? AND checked=0",
        args: [validationId],
      });
      const total = await client.execute({
        sql: "SELECT COUNT(*) AS count FROM project_validation_items WHERE validation_id=?",
        args: [validationId],
      });
      if (!asNumber(total.rows[0]?.count) || asNumber(incomplete.rows[0]?.count)) {
        throw new ApiError(409, "VALIDATION_INCOMPLETE", "Centang seluruh Perangkat dan Material sebelum validasi diselesaikan.");
      }
    }
    await client.execute({
      sql: "UPDATE project_validations SET status=?,notes=?,validated_by=?,completed_at=?,updated_at=? WHERE id=?",
      args: [input.status, input.notes ?? validation.notes ?? "", user.id, input.status === "Completed" ? timestamp : null, timestamp, validationId],
    });
    await writeAuditLog(client, request, user, input.status === "Completed" ? "complete" : "update", "project_validation", validationId, {
      checked: input.items.filter((item) => item.checked).length,
      total: rows.rows.length,
    });
    if (input.status === "Completed" && validation.status !== "Completed") {
      await notifyProjectStakeholders(client, {
        projectId: String(validation.project_id),
        eventType: "validation_completed",
        subject: "Validasi perangkat dan material selesai",
        message: "seluruh item perangkat dan material sudah divalidasi. BAST kini dapat diterbitkan.",
        subjectEn: "Device and material validation completed",
        messageEn: "all device and material items have been validated. The handover document can now be issued.",
      });
    }
    return ok(await readValidation(String(validation.project_id)));
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint validasi tidak ditemukan.");
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
    engineerRole: row.engineer_role
      ? String(row.engineer_role)
      : "Project Manager",
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
    if (projectId) await assertProjectAccess(user, projectId);
    const scope = projectScopeCondition(user, "p");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      conditions.push("b.project_id=?");
      args.push(projectId);
    }
    if (scope.sql) {
      conditions.push(scope.sql);
      args.push(...scope.args);
    }
    const result = await client.execute({
      sql: `SELECT b.*,p.name AS project_name,p.client AS project_client,p.location AS project_location FROM basts b JOIN projects p ON p.id=b.project_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY b.created_at DESC`,
      args,
    });
    return ok(result.rows.map((row) => mapBast(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !bastId) {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat BAST.");
    const input = bastSchema.parse(await jsonBody(request));
    await assertProjectAccess(user, input.projectId);
    await assertCompletedValidation(input.projectId);
    const existing = await client.execute({
      sql: "SELECT id FROM basts WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
      args: [input.projectId],
    });
    if (existing.rows.length) {
      throw new ApiError(
        409,
        "BAST_EXISTS",
        "Proyek ini sudah memiliki BAST. Buka dan edit dokumen yang sudah ada.",
      );
    }
    if (
      input.status === "Final" &&
      (!input.clientSignature || !input.engineerSignature)
    ) {
      throw new ApiError(
        409,
        "SIGNATURES_REQUIRED",
        "Tanda tangan klien dan PerumNet wajib lengkap sebelum BAST difinalkan.",
      );
    }
    const count = await client.execute("SELECT COUNT(*) AS count FROM basts");
    const id = randomUUID();
    const number = makeSequence("BAST", asNumber(count.rows[0]?.count));
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO basts (id,number,project_id,completion_date,notes,installed_items_json,client_name,client_role,client_signature,engineer_name,engineer_role,engineer_signature,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, number, input.projectId, input.completionDate, input.notes, JSON.stringify(input.installedItems), input.clientName, input.clientRole, input.clientSignature ?? null, input.engineerName, input.engineerRole ?? "Project Manager", input.engineerSignature ?? null, input.status, timestamp, timestamp],
    });
    if (input.status === "Final") {
      await client.execute({
        sql: "UPDATE projects SET status='Selesai',updated_at=? WHERE id=?",
        args: [timestamp, input.projectId],
      });
    }
    await writeAuditLog(client, request, user, "create", "bast", id, { projectId: input.projectId, status: input.status });
    if (input.status === "Final") {
      await notifyProjectStakeholders(client, {
        projectId: input.projectId,
        eventType: "bast_finalized",
        subject: `BAST ${number} telah final`,
        message: `BAST ${number} sudah ditandatangani dan proyek ditandai selesai.`,
        subjectEn: `Handover ${number} finalized`,
        messageEn: `handover ${number} has been signed and the project is marked completed.`,
        includeFinance: true,
      });
    }
    return created(await getBast(id));
  }

  if (bastId && action === "pdf" && request.method === "GET") {
    const bast = await ensureExists("SELECT project_id FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    return renderBusinessPdf("bast", bastId, user.preferredLanguage);
  }

  if (bastId && !action && request.method === "GET") {
    const bast = await ensureExists("SELECT project_id FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "PATCH") {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah BAST.");
    const input = bastSchema.omit({ projectId: true }).partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(current.project_id));
    if (input.status === "Final") await assertCompletedValidation(String(current.project_id));
    const nextClientSignature =
      input.clientSignature === undefined ? current.client_signature : input.clientSignature;
    const nextEngineerSignature =
      input.engineerSignature === undefined
        ? current.engineer_signature
        : input.engineerSignature;
    if (
      input.status === "Final" &&
      (!nextClientSignature || !nextEngineerSignature)
    ) {
      throw new ApiError(
        409,
        "SIGNATURES_REQUIRED",
        "Tanda tangan klien dan PerumNet wajib lengkap sebelum BAST difinalkan.",
      );
    }
    await client.execute({
      sql: "UPDATE basts SET completion_date=?,notes=?,installed_items_json=?,client_name=?,client_role=?,client_signature=?,engineer_name=?,engineer_role=?,engineer_signature=?,status=?,updated_at=? WHERE id=?",
      args: [
        input.completionDate ?? current.completion_date,
        input.notes ?? current.notes,
        input.installedItems ? JSON.stringify(input.installedItems) : current.installed_items_json,
        input.clientName ?? current.client_name,
        input.clientRole ?? current.client_role,
        input.clientSignature === undefined ? current.client_signature : input.clientSignature,
        input.engineerName ?? current.engineer_name,
        input.engineerRole ?? current.engineer_role,
        input.engineerSignature === undefined ? current.engineer_signature : input.engineerSignature,
        input.status ?? current.status,
        now(),
        bastId,
      ],
    });
    if (input.status === "Final") {
      await client.execute({
        sql: "UPDATE projects SET status='Selesai',updated_at=? WHERE id=?",
        args: [now(), current.project_id],
      });
    }
    await writeAuditLog(client, request, user, "update", "bast", bastId, { status: input.status });
    if (input.status === "Final" && current.status !== "Final") {
      await notifyProjectStakeholders(client, {
        projectId: String(current.project_id),
        eventType: "bast_finalized",
        subject: `BAST ${String(current.number)} telah final`,
        message: `BAST ${String(current.number)} sudah ditandatangani dan proyek ditandai selesai.`,
        subjectEn: `Handover ${String(current.number)} finalized`,
        messageEn: `handover ${String(current.number)} has been signed and the project is marked completed.`,
        includeFinance: true,
      });
    }
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "DELETE") {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus BAST.");
    const bast = await ensureExists("SELECT project_id FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    await client.execute({ sql: "DELETE FROM basts WHERE id=?", args: [bastId] });
    await writeAuditLog(client, request, user, "delete", "bast", bastId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BAST tidak ditemukan.");
}

function mapTransaction(
  row: Record<string, unknown>,
  language: AuthUser["preferredLanguage"] = "id",
) {
  const source = String(row.source);
  const isSystemTransaction =
    source.startsWith("Bank:") ||
    source === "Profit Share" ||
    source === "Profit Share Reversal" ||
    source === "Procurement Payment" ||
    source === "Procurement Reversal" ||
    source === "Invoice Payment" ||
    source === "Invoice Payment Reversal" ||
    source === "Tax Settlement" ||
    source === "Tax Settlement Reversal" ||
    (Boolean(row.reference_id) &&
      (source === "Invoice" || source === "SPK"));
  return {
    id: String(row.id),
    date: localizedApiDate(row.date, language),
    dateIso: String(row.date),
    type: String(row.type),
    projectId: row.project_id ? String(row.project_id) : undefined,
    project: row.project_name ? String(row.project_name) : "Umum",
    description: localizedTransactionDescription(row.description, language),
    amount: asNumber(row.amount),
    source,
    categoryKey: String(row.category ?? "Lainnya"),
    category: localizedTransactionCategory(row.category, language),
    editable: !isSystemTransaction,
  };
}

async function handleTransactions(request: Request, path: string[], user: AuthUser) {
  assertAccess(user, "finance", request.method === "GET" ? "view" : "manage");
  const { client } = await getDatabase();
  const transactionId = path[1];

  if (
    request.method === "GET" &&
    (!transactionId || transactionId === "report.pdf" || transactionId === "report.csv")
  ) {
    const searchParams = new URL(request.url).searchParams;
    const projectId = searchParams.get("projectId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      await assertProjectAccess(user, projectId);
      conditions.push("t.project_id=?");
      args.push(projectId);
    }
    const scope = projectScopeCondition(user, "p");
    if (scope.sql) {
      conditions.push(
        `EXISTS (SELECT 1 FROM projects p WHERE p.id=t.project_id AND ${scope.sql})`,
      );
      args.push(...scope.args);
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
    const transactions = result.rows.map((row) =>
      mapTransaction(row as Record<string, unknown>, user.preferredLanguage),
    );
    const bankAccounts = ["Admin", "Finance"].includes(user.role)
      ? (
          await client.execute(`
            SELECT bank_name,account_name,account_number_masked,
              opening_balance,current_balance,balance_updated_at,sync_mode
            FROM bank_accounts
            WHERE status='Aktif'
            ORDER BY bank_name,account_name
          `)
        ).rows.map((row) => ({
          bankName: String(row.bank_name),
          accountName: String(row.account_name),
          accountNumberMasked: String(row.account_number_masked),
          openingBalance: asNumber(row.opening_balance),
          currentBalance: asNumber(row.current_balance),
          balanceUpdatedAt: row.balance_updated_at
            ? String(row.balance_updated_at)
            : undefined,
          syncMode: String(row.sync_mode),
        }))
      : [];
    const profitScope = projectScopeCondition(user, "p");
    const profitConditions: string[] = [];
    const profitArgs: unknown[] = [];
    if (projectId) {
      profitConditions.push("p.id=?");
      profitArgs.push(projectId);
    }
    if (profitScope.sql) {
      profitConditions.push(profitScope.sql);
      profitArgs.push(...profitScope.args);
    }
    const profitResult = await client.execute({
      sql: `
        SELECT p.id,p.code,p.name,
          COALESCE((
            SELECT SUM(CASE
              WHEN t.type='Pemasukan' THEN t.amount
              WHEN t.type='Pengeluaran' AND t.source NOT IN ('Profit Share','Profit Share Reversal') THEN -t.amount
              ELSE 0 END)
            FROM transactions t
            WHERE t.project_id=p.id
          ),0) AS net_profit,
          COALESCE((
            SELECT SUM(s.amount)
            FROM project_profit_shares s
            WHERE s.project_id=p.id AND s.status<>'Void'
          ),0) AS allocated_amount,
          COALESCE((
            SELECT SUM(s.amount)
            FROM project_profit_shares s
            WHERE s.project_id=p.id AND s.status='Paid'
          ),0) AS paid_amount,
          COALESCE((
            SELECT SUM(i.quantity*i.cost_price)
            FROM boq_items i JOIN boqs b ON b.id=i.boq_id
            WHERE b.project_id=p.id
          ),0) AS budget_boq,
          COALESCE((
            SELECT SUM(o.cost + COALESCE((
              SELECT SUM(dt.amount) FROM document_taxes dt
              WHERE dt.document_id=o.id
                AND dt.document_type=o.document_type
                AND dt.effect='Add'
            ),0)) FROM spks o
            WHERE o.project_id=p.id AND o.approval_status='Approved'
              AND o.workflow_status<>'Void'
          ),0) AS committed_vendor_cost,
          COALESCE((
            SELECT SUM(CASE WHEN pay.gross_amount>0
              THEN pay.gross_amount ELSE pay.amount END)
            FROM spk_payments pay JOIN spks o ON o.id=pay.spk_id
            WHERE o.project_id=p.id AND pay.status='Posted'
          ),0) AS procurement_paid,
          COALESCE((
            SELECT COUNT(*) FROM boq_scopes scope
            JOIN boqs b ON b.id=scope.boq_id
            WHERE b.project_id=p.id AND scope.kind='Addendum'
              AND scope.status='Accepted'
          ),0) AS accepted_addenda
        FROM projects p
        ${profitConditions.length ? `WHERE ${profitConditions.join(" AND ")}` : ""}
        ORDER BY p.code
      `,
      args: profitArgs as never[],
    });
    const profitRows = profitResult.rows
      .map((row) => {
        const netProfit = asNumber(row.net_profit);
        const allocatedAmount = asNumber(row.allocated_amount);
        return {
          project: `${String(row.code)} - ${String(row.name)}`,
          netProfit,
          allocatedAmount,
          paidAmount: asNumber(row.paid_amount),
          retainedProfit:
            netProfit -
            Math.max(
              0,
              asNumber(row.committed_vendor_cost) -
                asNumber(row.procurement_paid),
            ) -
            allocatedAmount,
          budgetBoq: asNumber(row.budget_boq),
          committedVendorCost: asNumber(row.committed_vendor_cost),
          procurementPaid: asNumber(row.procurement_paid),
          outstandingVendorCost: Math.max(
            0,
            asNumber(row.committed_vendor_cost) -
              asNumber(row.procurement_paid),
          ),
          acceptedAddenda: asNumber(row.accepted_addenda),
        };
      })
      .filter(
        (row) =>
          row.netProfit !== 0 ||
          row.allocatedAmount !== 0 ||
          row.paidAmount !== 0 ||
          row.committedVendorCost !== 0 ||
          row.acceptedAddenda !== 0,
      );
    const taxResult = await client.execute({
      sql: `SELECT p.code,p.name,dt.rule_name,dt.rule_name_en,o.direction,
        o.amount,o.settled_amount,o.status
        FROM tax_obligations o
        JOIN document_taxes dt ON dt.id=o.document_tax_id
        LEFT JOIN projects p ON p.id=o.project_id
        ${profitConditions.length ? `WHERE ${profitConditions.join(" AND ")}` : ""}
        ORDER BY p.code,o.direction,dt.rule_code`,
      args: profitArgs as never[],
    });
    const taxRows = taxResult.rows.map((row) => ({
      project: row.code
        ? `${String(row.code)} - ${String(row.name ?? "")}`
        : user.preferredLanguage === "en"
          ? "General"
          : "Umum",
      rule:
        user.preferredLanguage === "en"
          ? String(row.rule_name_en)
          : String(row.rule_name),
      direction: String(row.direction),
      amount: asNumber(row.amount),
      settled: asNumber(row.settled_amount),
      outstanding: Math.max(
        0,
        asNumber(row.amount) - asNumber(row.settled_amount),
      ),
      status: String(row.status),
    }));
    if (transactionId === "report.csv") {
      const en = user.preferredLanguage === "en";
      const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const headers = en
        ? ["Date", "Type", "Project", "Category", "Description", "Source", "Amount (IDR)"]
        : ["Tanggal", "Jenis", "Proyek", "Kategori", "Deskripsi", "Sumber", "Nominal (IDR)"];
      const lines = [
        headers.map(csvCell).join(","),
        ...transactions.map((transaction) => [
          transaction.dateIso,
          en
            ? transaction.type === "Pemasukan" ? "Income" : "Expense"
            : transaction.type,
          en && transaction.project === "Umum" ? "General" : transaction.project,
          transaction.category,
          transaction.description,
          transaction.source,
          transaction.amount,
        ].map(csvCell).join(",")),
      ];
      if (bankAccounts.length) {
        lines.push(
          "",
          [en ? "COMPANY BANK POSITION" : "POSISI REKENING PERUSAHAAN"].map(csvCell).join(","),
          [
            en ? "Bank" : "Bank",
            en ? "Account" : "Rekening",
            en ? "Opening Balance (IDR)" : "Saldo Awal (IDR)",
            en ? "Current Balance (IDR)" : "Saldo Terkini (IDR)",
            en ? "Method" : "Metode",
          ].map(csvCell).join(","),
          ...bankAccounts.map((account) => [
            account.bankName,
            `${account.accountName} ${account.accountNumberMasked}`,
            account.openingBalance,
            account.currentBalance,
            account.syncMode,
          ].map(csvCell).join(",")),
        );
      }
      if (profitRows.length) {
        lines.push(
          "",
          [en ? "VENDOR COMMITMENTS" : "KOMITMEN VENDOR"].map(csvCell).join(","),
          [
            en ? "Project" : "Proyek",
            en ? "BoQ Budget (IDR)" : "Budget BoQ (IDR)",
            en ? "Committed (IDR)" : "Komitmen (IDR)",
            en ? "Paid by Terms (IDR)" : "Dibayar per Termin (IDR)",
            en ? "Outstanding (IDR)" : "Belum Dibayar (IDR)",
            en ? "Accepted Addenda" : "Addendum Diterima",
          ].map(csvCell).join(","),
          ...profitRows.map((row) => [
            row.project,
            row.budgetBoq,
            row.committedVendorCost,
            row.procurementPaid,
            row.outstandingVendorCost,
            row.acceptedAddenda,
          ].map(csvCell).join(",")),
        );
        lines.push(
          "",
          [en ? "PROJECT PROFIT DISTRIBUTION - LIFETIME" : "DISTRIBUSI LABA PROYEK - SEPANJANG PROYEK"].map(csvCell).join(","),
          [
            en ? "Project" : "Proyek",
            en ? "Base Net Profit (IDR)" : "Laba Bersih Dasar (IDR)",
            en ? "Allocated (IDR)" : "Dialokasikan (IDR)",
            en ? "Paid (IDR)" : "Dibayar (IDR)",
            en ? "Retained Profit (IDR)" : "Laba Ditahan (IDR)",
          ].map(csvCell).join(","),
          ...profitRows.map((row) => [
            row.project,
            row.netProfit,
            row.allocatedAmount,
            row.paidAmount,
            row.retainedProfit,
          ].map(csvCell).join(",")),
        );
      }
      if (taxRows.length) {
        lines.push(
          "",
          [en ? "TAX POSITION" : "POSISI PAJAK"].map(csvCell).join(","),
          [
            en ? "Project" : "Proyek",
            en ? "Tax rule" : "Aturan Pajak",
            en ? "Position" : "Posisi",
            en ? "Amount (IDR)" : "Nilai (IDR)",
            en ? "Settled (IDR)" : "Settlement (IDR)",
            "Outstanding (IDR)",
            "Status",
          ].map(csvCell).join(","),
          ...taxRows.map((row) => [
            row.project,
            row.rule,
            row.direction === "Payable"
              ? en ? "Payable" : "Utang"
              : en ? "Receivable" : "Piutang",
            row.amount,
            row.settled,
            row.outstanding,
            row.status,
          ].map(csvCell).join(",")),
        );
      }
      const reportDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Makassar",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      return new Response(`\uFEFF${lines.join("\r\n")}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${en ? "PerumNet-Financial-Report" : "Laporan-Keuangan-PerumNet"}-${reportDate}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (transactionId === "report.pdf") {
      let scopeLabel = user.preferredLanguage === "en"
        ? "All accessible projects"
        : "Seluruh proyek yang dapat diakses";
      if (projectId) {
        const project = await ensureExists(
          "SELECT code,name FROM projects WHERE id=?",
          [projectId],
          "Proyek tidak ditemukan.",
        );
        scopeLabel = `${String(project.code)} - ${String(project.name)}`;
      }
      return renderFinancialReportPdf(
        transactions.map((transaction) => ({
          date: transaction.date,
          dateIso: transaction.dateIso,
          type: transaction.type,
          project: transaction.project,
          description: transaction.description,
          amount: transaction.amount,
          source: transaction.source,
          category: transaction.category,
        })),
        scopeLabel,
        user.preferredLanguage,
        bankAccounts,
        profitRows,
        profitRows.map((row) => ({
          project: row.project,
          budgetBoq: row.budgetBoq,
          committedVendorCost: row.committedVendorCost,
          paid: row.procurementPaid,
          outstanding: row.outstandingVendorCost,
          acceptedAddenda: row.acceptedAddenda,
        })),
        taxRows,
      );
    }
    return ok(transactions);
  }

  if (request.method === "POST" && !transactionId) {
    const input = transactionSchema.parse(await jsonBody(request));
    if (
      ["invoice", "spk"].includes(input.source.toLowerCase()) ||
      input.source.toLowerCase().startsWith("bank:") ||
      input.source.toLowerCase().startsWith("profit share") ||
      input.source.toLowerCase().startsWith("procurement ") ||
      input.source.toLowerCase().startsWith("invoice payment") ||
      input.source.toLowerCase().startsWith("tax settlement") ||
      input.category === "Bagi Hasil"
    ) {
      throw new ApiError(
        422,
        "RESERVED_TRANSACTION_SOURCE",
        "Sumber Invoice, SPK, dan Bank hanya dibuat oleh sistem.",
      );
    }
    if (input.projectId) await assertProjectAccess(user, input.projectId);
    if (!input.projectId && !hasGlobalProjectScope(user)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Akun Anda hanya dapat mencatat transaksi untuk proyek yang ditugaskan.",
      );
    }
    const id = randomUUID();
    const timestamp = now();
    await client.execute({
      sql: "INSERT INTO transactions (id,project_id,date,type,description,amount,source,category,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, input.projectId ?? null, input.date, input.type, input.description, input.amount, input.source, input.category, user.id, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "transaction", id, input);
    const row = await ensureExists("SELECT t.*,p.name AS project_name FROM transactions t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?", [id], "Transaksi tidak ditemukan.");
    return created(mapTransaction(row as Record<string, unknown>, user.preferredLanguage));
  }

  if (transactionId && request.method === "PATCH") {
    const input = transactionSchema.partial().parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM transactions WHERE id=?", [transactionId], "Transaksi tidak ditemukan.");
    if (current.project_id) await assertProjectAccess(user, String(current.project_id));
    if (!current.project_id && !hasGlobalProjectScope(user)) {
      throw new ApiError(404, "NOT_FOUND", "Transaksi tidak ditemukan.");
    }
    if (
      (input.source &&
        (["invoice", "spk"].includes(input.source.toLowerCase()) ||
          input.source.toLowerCase().startsWith("bank:") ||
          input.source.toLowerCase().startsWith("profit share") ||
          input.source.toLowerCase().startsWith("procurement ") ||
          input.source.toLowerCase().startsWith("invoice payment") ||
          input.source.toLowerCase().startsWith("tax settlement"))) ||
      input.category === "Bagi Hasil"
    ) {
      throw new ApiError(
        422,
        "RESERVED_TRANSACTION_SOURCE",
        "Sumber Invoice, SPK, dan Bank hanya dibuat oleh sistem.",
      );
    }
    if (
      (current.reference_id &&
        (current.source === "Invoice" || current.source === "SPK")) ||
      String(current.source).startsWith("Bank:") ||
      String(current.source).startsWith("Profit Share") ||
      String(current.source).startsWith("Procurement ") ||
      String(current.source).startsWith("Invoice Payment") ||
      String(current.source).startsWith("Tax Settlement")
    ) {
      throw new ApiError(
        409,
        "SYSTEM_TRANSACTION",
        "Transaksi otomatis harus diperbarui dari dokumen asal atau rekonsiliasi bank.",
      );
    }
    if (input.projectId) await assertProjectAccess(user, input.projectId);
    await client.execute({
      sql: "UPDATE transactions SET project_id=?,date=?,type=?,description=?,amount=?,source=?,category=?,updated_at=? WHERE id=?",
      args: [
        input.projectId === undefined ? current.project_id : input.projectId,
        input.date ?? current.date,
        input.type ?? current.type,
        input.description ?? current.description,
        input.amount ?? current.amount,
        input.source ?? current.source,
        input.category ?? current.category,
        now(),
        transactionId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "transaction", transactionId, input);
    const row = await ensureExists("SELECT t.*,p.name AS project_name FROM transactions t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?", [transactionId], "Transaksi tidak ditemukan.");
    return ok(mapTransaction(row as Record<string, unknown>, user.preferredLanguage));
  }

  if (transactionId && request.method === "DELETE") {
    const current = await ensureExists("SELECT * FROM transactions WHERE id=?", [transactionId], "Transaksi tidak ditemukan.");
    if (current.project_id) await assertProjectAccess(user, String(current.project_id));
    if (!current.project_id && !hasGlobalProjectScope(user)) {
      throw new ApiError(404, "NOT_FOUND", "Transaksi tidak ditemukan.");
    }
    if (
      (current.reference_id &&
        (current.source === "Invoice" || current.source === "SPK")) ||
      String(current.source).startsWith("Bank:") ||
      String(current.source).startsWith("Profit Share") ||
      String(current.source).startsWith("Procurement ") ||
      String(current.source).startsWith("Invoice Payment") ||
      String(current.source).startsWith("Tax Settlement")
    ) {
      throw new ApiError(
        409,
        "SYSTEM_TRANSACTION",
        "Transaksi otomatis hanya dapat dihapus dari dokumen asal atau rekonsiliasi bank.",
      );
    }
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
    await assertProjectAccess(user, projectId);
    conditions.push("project_id=?");
    args.push(projectId);
  }
  const scope = projectScopeCondition(user, "p");
  if (scope.sql) {
    conditions.push(
      `EXISTS (SELECT 1 FROM projects p WHERE p.id=transactions.project_id AND ${scope.sql})`,
    );
    args.push(...scope.args);
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
    netCash: income - expense,
    cashRatio: income ? ((income - expense) / income) * 100 : 0,
    monthly: monthly.rows.map((row) => ({
      month: String(row.month),
      income: asNumber(row.income),
      expense: asNumber(row.expense),
    })),
  });
}

function mapUser(
  row: Record<string, unknown>,
  language: AuthUser["preferredLanguage"] = "id",
) {
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
    lastActive: lastActive(row.last_active_at, language),
    permissions: normalizePermissions(role, storedPermissions),
    ...(row.avatar_mime_type
      ? {
          avatarUrl: avatarUrlForUser(
            row.id,
            row.profile_updated_at ?? row.updated_at,
          ),
        }
      : {}),
  };
}

async function handleUsers(request: Request, path: string[], user: AuthUser) {
  assertAccess(user, "users", request.method === "GET" ? "view" : "manage");
  if (request.method !== "GET" && user.role !== "Admin") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Hanya Admin yang dapat membuat atau mengubah akun dan hak akses.",
    );
  }
  const { client } = await getDatabase();
  const userId = path[1];

  if (request.method === "GET" && !userId) {
    const result = await client.execute(`
      SELECT u.*,up.permissions_json,p.avatar_mime_type,
        p.updated_at AS profile_updated_at
      FROM users u
      LEFT JOIN user_permissions up ON up.user_id=u.id
      LEFT JOIN user_profiles p ON p.user_id=u.id
      ORDER BY u.status,u.name
    `);
    return ok(result.rows.map((row) => mapUser(row as Record<string, unknown>, user.preferredLanguage)));
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
    await sendAccountCreatedEmail(client, {
      id,
      name: input.name,
      email: input.email,
    });
    return created({
      id,
      name: input.name,
      email: input.email,
      role: input.role,
      status: input.status,
      lastActive: user.preferredLanguage === "en" ? "Never" : "Belum pernah",
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
      "SELECT u.*,up.permissions_json,p.avatar_mime_type,p.updated_at AS profile_updated_at FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?",
      [userId],
      "Pengguna tidak ditemukan.",
    );
    return ok(mapUser(updated as Record<string, unknown>, user.preferredLanguage));
  }

  if (userId && request.method === "DELETE") {
    if (userId === user.id) throw new ApiError(409, "SELF_DELETE", "Anda tidak dapat menghapus akun sendiri.");
    const profile = await client.execute({
      sql: "SELECT avatar_storage_url FROM user_profiles WHERE user_id=? LIMIT 1",
      args: [userId],
    });
    const avatarStorageUrl = profile.rows[0]?.avatar_storage_url
      ? String(profile.rows[0].avatar_storage_url)
      : null;
    await client.execute({ sql: "DELETE FROM users WHERE id=?", args: [userId] });
    await cleanupProjectFile(avatarStorageUrl, "deleted user avatar");
    await writeAuditLog(client, request, user, "delete", "user", userId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint pengguna tidak ditemukan.");
}

async function getProfile(userId: string) {
  const row = await ensureExists(
    `
      SELECT u.id,u.name,u.email,u.role,p.phone,p.job_title,p.bio,p.address,p.birth_date,
        p.avatar_mime_type,p.preferred_language,p.email_notifications,
        p.updated_at AS profile_updated_at
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
    avatarUrl: row.avatar_mime_type
      ? avatarUrlForUser(row.id, row.profile_updated_at)
      : undefined,
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

async function cleanupProjectFile(storageUrl: string | null, context: string) {
  if (!storageUrl) return;
  try {
    await deleteProjectFile(storageUrl);
  } catch (error) {
    console.error("Stored file cleanup failed.", {
      context,
      error: error instanceof Error ? error.message : "Unknown storage error",
    });
  }
}

async function handleProfile(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const action = path[1];

  if (action === "avatar" && request.method === "GET") {
    const targetId = path[2] ?? user.id;
    if (targetId !== user.id) assertAccess(user, "users", "view");
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
        "Cache-Control": "private, max-age=3600, immutable",
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
    const current = await client.execute({
      sql: "SELECT avatar_storage_url FROM user_profiles WHERE user_id=? LIMIT 1",
      args: [user.id],
    });
    const previousStorageUrl = current.rows[0]?.avatar_storage_url
      ? String(current.rows[0].avatar_storage_url)
      : null;
    const stored = await storeProjectFile(
      `avatar-${user.id}-${randomUUID()}`,
      file.type,
      content.buffer as ArrayBuffer,
    );
    const timestamp = now();
    try {
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
    } catch (error) {
      await cleanupProjectFile(stored.storageUrl, "avatar upload rollback");
      throw error;
    }
    if (previousStorageUrl && previousStorageUrl !== stored.storageUrl) {
      await cleanupProjectFile(previousStorageUrl, "replaced user avatar");
    }
    await writeAuditLog(client, request, user, "update_avatar", "user", user.id);
    return ok({ avatarUrl: avatarUrlForUser(user.id, timestamp) });
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
  assertAccess(user, "settings", "view");
  const { client } = await getDatabase();
  if (request.method === "GET") {
    const profile = await getProfile(user.id);
    return ok({
      preferredLanguage: profile.preferredLanguage,
      emailNotifications: profile.emailNotifications,
      emailDeliveryConfigured: emailDeliveryConfigured(),
      emailMode: emailMode(),
      emailProvider: emailProviderName(),
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
    return ok({
      ...input,
      emailDeliveryConfigured: emailDeliveryConfigured(),
      emailMode: emailMode(),
      emailProvider: emailProviderName(),
    });
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

async function handleNotifications(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertAccess(
    user,
    "settings",
    request.method === "GET" || path[2] === "test" ? "view" : "manage",
  );
  if (path[1] !== "email") {
    throw new ApiError(404, "NOT_FOUND", "Endpoint notifikasi tidak ditemukan.");
  }
  const { client } = await getDatabase();

  if (request.method === "GET" && !path[2]) {
    const result = await client.execute({
      sql: `
        SELECT * FROM (
          SELECT id,user_id,event_type,recipient,subject,lower(status) AS status,
            sender_profile,last_error AS error_message,provider,provider_id,attempt_count,
            next_attempt_at,created_at
          FROM email_outbox
          UNION ALL
          SELECT d.id,d.user_id,d.event_type,d.recipient,d.subject,d.status,
            d.sender_profile,d.error_message,NULL AS provider,d.provider_id,0 AS attempt_count,
            d.created_at AS next_attempt_at,d.created_at
          FROM email_deliveries d
          WHERE NOT EXISTS (SELECT 1 FROM email_outbox o WHERE o.id=d.id)
        ) history
        ${user.role === "Admin" ? "" : "WHERE user_id=?"}
        ORDER BY created_at DESC
        LIMIT 25
      `,
      args: user.role === "Admin" ? [] : [user.id],
    });
    return ok(
      result.rows.map((row) => ({
        id: String(row.id),
        userId: row.user_id ? String(row.user_id) : undefined,
        eventType: String(row.event_type),
        senderProfile: String(row.sender_profile ?? "operational"),
        recipient: String(row.recipient),
        subject: String(row.subject),
        status: String(row.status),
        error: row.error_message ? String(row.error_message) : undefined,
        provider: row.provider ? String(row.provider) : undefined,
        providerId: row.provider_id ? String(row.provider_id) : undefined,
        attemptCount: asNumber(row.attempt_count),
        nextAttemptAt: row.next_attempt_at
          ? String(row.next_attempt_at)
          : undefined,
        createdAt: String(row.created_at),
      })),
    );
  }

  if (request.method === "POST" && path[2] === "test") {
    const result = await sendTestEmail(client, user);
    await writeAuditLog(
      client,
      request,
      user,
      "test_email",
      "email_delivery",
      result.id,
      { status: result.status },
    );
    return ok(result);
  }

  if (
    request.method === "POST" &&
    path[2] &&
    path[3] === "retry"
  ) {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat mencoba ulang email.");
    }
    const retry = await retryEmailOutbox(client, path[2]);
    if (!retry) {
      throw new ApiError(
        409,
        "EMAIL_NOT_RETRYABLE",
        "Email tidak ditemukan atau statusnya tidak dapat dicoba ulang.",
      );
    }
    await writeAuditLog(
      client,
      request,
      user,
      "retry",
      "email_outbox",
      path[2],
    );
    return ok({ id: path[2], status: "pending" });
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint notifikasi tidak ditemukan.");
}

async function handleDocuments(request: Request, path: string[], user: AuthUser) {
  if (request.method !== "GET" || path[2] !== "content") throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
  const row = await ensureExists(
    "SELECT project_id,name,mime_type,storage_url,content_base64 FROM project_documents WHERE id=?",
    [path[1]],
    "Dokumen tidak ditemukan.",
  );
  await assertProjectAccess(user, String(row.project_id));
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
  const scope = projectScopeCondition(user, "p");
  const [projectResults, invoiceResults, vendorResults] = await Promise.all([
    canAccess(user.permissions, "projects")
      ? client.execute({
          sql: `SELECT p.id,p.name AS title,p.code AS subtitle FROM projects p WHERE (lower(p.name) LIKE ? OR lower(p.code) LIKE ?)${scope.sql ? ` AND ${scope.sql}` : ""} LIMIT 6`,
          args: [pattern, pattern, ...scope.args],
        })
      : Promise.resolve({ rows: [] }),
    canAccess(user.permissions, "billing")
      ? client.execute({
          sql: `SELECT i.id,i.number AS title,i.type AS subtitle FROM invoices i JOIN projects p ON p.id=i.project_id WHERE (lower(i.number) LIKE ? OR lower(i.type) LIKE ?)${scope.sql ? ` AND ${scope.sql}` : ""} LIMIT 6`,
          args: [pattern, pattern, ...scope.args],
        })
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
  if (resource === "system" && path[1] === "time" && request.method === "GET") {
    const serverNow = now();
    return ok(
      {
        now: serverNow,
        today: makassarToday(serverNow),
        timeZone: "Asia/Makassar",
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }
  const accessModule = resourceModules[resource];
  if (accessModule) {
    if (request.method === "GET" || request.method === "HEAD") {
      assertAccess(user, accessModule, "view");
    } else {
      assertMutationAccess(user, resource);
    }
  }

  if (resource === "projects") return handleProjects(request, path, user);
  if (resource === "boq" && path[1] === "standalone") {
    return handleStandaloneBoqs(request, path, user);
  }
  if (resource === "boq" && path[1] === "scopes") {
    return handleBoqScopes(request, path, user);
  }
  if (resource === "boq") return handleBoq(request, path, user);
  if (resource === "quotations" && path[1]) {
    if (path[2] === "taxes") {
      return handleDocumentTaxes(
        request,
        ["tax", "documents", "Quotation", path[1]],
        user,
      );
    }
    return handleQuotationLifecycle(request, path, user);
  }
  if (resource === "quotations") return handleQuotations(request, user);
  if (resource === "invoices" && path[1] && path[2] === "taxes") {
    return handleDocumentTaxes(
      request,
      ["tax", "documents", "Invoice", path[1]],
      user,
    );
  }
  if (resource === "invoices") return handleInvoices(request, path, user);
  if (resource === "vendors") return handleVendors(request, path, user);
  if (resource === "vendor-categories") {
    return handleVendorCategories(request, path, user);
  }
  if (resource === "procurement-orders") {
    if (path[1] && path[2] === "taxes") {
      const typeResult = await (await getDatabase()).client.execute({
        sql: "SELECT document_type FROM spks WHERE id=? LIMIT 1",
        args: [path[1]],
      });
      const documentType =
        String(typeResult.rows[0]?.document_type) === "PO" ? "PO" : "SPK";
      return handleDocumentTaxes(
        request,
        ["tax", "documents", documentType, path[1]],
        user,
      );
    }
    return handleProcurementOrders(request, path, user);
  }
  if (resource === "spks") return handleSpks(request, path, user);
  if (resource === "bast") return handleBast(request, path, user);
  if (resource === "validations") return handleValidations(request, path, user);
  if (resource === "transactions") return handleTransactions(request, path, user);
  if (resource === "finance" && path[1] === "summary") return handleFinance(request, user);
  if (resource === "bank-accounts") return handleBankAccounts(request, path, user);
  if (resource === "profit-shares") return handleProfitShares(request, path, user);
  if (resource === "tax") return handleTax(request, path, user);
  if (resource === "users") return handleUsers(request, path, user);
  if (resource === "profile") return handleProfile(request, path, user);
  if (resource === "settings") return handleSettings(request, user);
  if (resource === "notifications") return handleNotifications(request, path, user);
  if (resource === "documents") return handleDocuments(request, path, user);
  if (resource === "audit-logs") return handleAudit(request, user);
  if (resource === "search") return handleSearch(request, user);
  if (resource === "help" && path[1] === "sop.pdf") {
    return renderSopPdf(request, user);
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint API tidak ditemukan.");
}
