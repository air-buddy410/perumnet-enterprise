import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import sharp from "sharp";
import { z } from "zod";
import {
  accessModules,
  canAccess,
  defaultPermissions,
  normalizePermissions,
  type AccessModule,
  type AccessPermissions,
} from "@/shared/access";
import { writeAuditLog } from "../audit";
import { authProviderMode, verifyMailserverPassword } from "../mail-auth";
import { mailcowConfig, setMailboxPassword } from "../mailcow";
import {
  calculateInvoiceAllocation,
  calculateQuotationCommercialTotals,
  customRoundingLimit,
} from "../commercial";
import { snapshotQuotationItems } from "../quotation-snapshot";
import {
  avatarUrlForUser,
  createEmailChangeToken,
  createPasswordResetToken,
  createSession,
  emailChangeTokenMinutes,
  getSessionUser,
  hashResetToken,
  requireUser,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
  verifyCredentials,
  withClearedSessionCookie,
  withSessionCookie,
  type AuthUser,
  type UserRole,
} from "../auth";
import {
  assertAuthRateLimit,
  clearAuthRateLimit,
  recordAuthFailure,
} from "../auth-rate-limit";
import { getDatabase, type DatabaseClient } from "../db/client";
import { claimSequence } from "../db/counters";
import { geocodeLocation } from "../geocode";
import {
  emailDeliveryConfigured,
  emailMode,
  emailProviderName,
  notifyProjectStakeholders,
  retryEmailOutbox,
  sendAccountCreatedEmail,
  sendEmailChangeConfirmationEmail,
  sendEmailChangedEmail,
  sendEmailChangeRequestedEmail,
  sendPasswordResetEmail,
  sendTestEmail,
  securityMailUndeliverable,
} from "../email";
import {
  countsAsCashCondition,
  grossExpenseSum,
  grossIncomeSum,
  unreconciledImportCondition,
} from "../cash-ledger";
import { asNumber, formatDate, initials, parseJson } from "../format";
import {
  calculateTaxAmount,
  documentTaxSummary,
  lockDocumentTaxes,
} from "../tax";
import { deleteProjectFile, readProjectFile, storeProjectFile } from "../storage";
import { csvCell } from "../spreadsheet";
import { isProductionRuntime } from "../runtime-env";
import {
  ApiError,
  assertSameOrigin,
  created,
  jsonBody,
  noContent,
  ok,
  partialPatchSchema,
} from "./errors";
import {
  renderBusinessPdf,
  renderFinancialReportPdf,
  renderValidationPdf,
} from "./pdf";
import { handleBankAccounts } from "./bank-router";
import { handleCatalog } from "./catalog-router";
import { handleCatalogAi } from "./catalog-ai-router";
import {
  handleCommercialPackages,
  resolveCommercialPackageId,
} from "./commercial-package-router";
import {
  assertBoqTotalCoversInvoices,
  resetProjectValidation,
  syncCommercialValues,
} from "./commercial-sync";
import {
  assertQuotationTransition,
  handleBoqScopes,
  handleQuotationLifecycle,
} from "./commercial-scope-router";
import {
  handleProcurementOrders,
  handleVendorCategories,
} from "./procurement-router";
import { handleProfitShares } from "./profit-share-router";
import {
  handleProjectAdvances,
  handleProjectExpenseCategories,
  handleProjectExpenses,
} from "./project-expense-router";
import { handleStandaloneBoqs } from "./standalone-boq-router";
import { renderSopPdf } from "./sop-pdf";
import {
  handleDocumentTaxes,
  handleQuotationTaxMode,
  handleTax,
} from "./tax-router";

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

// Ranges are checked by assertCoordinate below rather than by z.number().min()
// so an out-of-range pin comes back as its own refusal code with a sentence the
// operator can act on, instead of a generic VALIDATION_ERROR blob.
const coordinateSchema = z.number().finite().nullable().optional();

const projectSchema = z.object({
  name: z.string().trim().min(3).max(160),
  client: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(160).default("Bali"),
  status: z.enum(["Aktif", "Selesai", "Draft"]).default("Draft"),
  startDate: isoDateSchema.optional(),
  targetDate: isoDateSchema.optional(),
  value: nonNegativeMoney.default(0),
  managerId: idSchema.optional(),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
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
  catalogItemId: idSchema.nullable().optional(),
  catalogPriceTier: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  manualPriceOverride: z.boolean().optional().default(false),
  priceOverrideReason: z.string().trim().max(500).nullable().optional(),
});

type BoqItemInput = z.infer<typeof boqItemSchema>;

async function resolveBoqItemInput(
  client: DatabaseClient,
  user: AuthUser,
  input: BoqItemInput,
) {
  if (!input.catalogItemId) {
    return {
      ...input,
      catalogItemId: null,
      catalogPriceTier: null,
      catalogRevision: null,
      manualPriceOverride: false,
      priceOverrideReason: null,
    };
  }
  const result = await client.execute({
    sql: `SELECT i.*,c.boq_role,c.name AS category_name,b.name AS brand_name
      FROM item_catalog_items i
      JOIN item_catalog_categories c ON c.id=i.category_id
      LEFT JOIN item_catalog_brands b ON b.id=i.brand_id
      WHERE i.id=? AND i.status='Aktif' AND c.status='Aktif'
        AND (b.id IS NULL OR b.status='Aktif') LIMIT 1`,
    args: [input.catalogItemId],
  });
  const catalog = result.rows[0];
  if (!catalog) throw new ApiError(422, "CATALOG_ITEM_UNAVAILABLE", "Item katalog tidak tersedia atau sudah dinonaktifkan.");
  const tier = input.catalogPriceTier === 2 ? 2 : 1;
  const costPrice = asNumber(catalog.cost_price);
  const marginBps = asNumber(tier === 2 ? catalog.margin_2_bps : catalog.margin_1_bps);
  const calculatedSellingPrice = Math.round((costPrice * (10_000 + marginBps)) / 10_000);
  const canOverride = ["Admin", "Finance"].includes(user.role);
  if (input.manualPriceOverride && !canOverride) {
    throw new ApiError(403, "PRICE_OVERRIDE_FORBIDDEN", "Hanya Admin dan Finance yang dapat mengganti harga katalog secara manual.");
  }
  if (input.manualPriceOverride && !input.priceOverrideReason?.trim()) {
    throw new ApiError(422, "PRICE_OVERRIDE_REASON_REQUIRED", "Alasan perubahan harga wajib diisi.");
  }
  const description = [catalog.name, catalog.model].filter(Boolean).join(" — ");
  return {
    ...input,
    category: String(catalog.boq_role) as BoqItemInput["category"],
    description,
    unit: String(catalog.unit),
    costPrice,
    sellingPrice: input.manualPriceOverride ? input.sellingPrice : calculatedSellingPrice,
    catalogItemId: String(catalog.id),
    catalogPriceTier: tier,
    catalogRevision: asNumber(catalog.revision),
    manualPriceOverride: Boolean(input.manualPriceOverride),
    priceOverrideReason: input.manualPriceOverride ? input.priceOverrideReason?.trim() ?? null : null,
  };
}

const invoiceBaseSchema = z.object({
  projectId: idSchema,
  packageId: idSchema.optional(),
  quotationId: idSchema.optional(),
  type: z.string().trim().min(2).max(80),
  issueDate: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)),
  dueDate: isoDateSchema,
  calculationMode: z.enum(["Percent", "Nominal"]).optional(),
  installmentPercent: z.number().positive().max(100).optional(),
  installmentBps: z.number().int().min(1).max(10_000).optional(),
  amount: positiveMoney.optional(),
});
const invoiceSchema = invoiceBaseSchema.superRefine((input, context) => {
  const percentMode = input.calculationMode === "Percent" ||
    input.installmentPercent !== undefined || input.installmentBps !== undefined;
  if (percentMode && input.installmentPercent === undefined && input.installmentBps === undefined) {
    context.addIssue({ code: "custom", message: "Persentase termin wajib diisi." });
  }
  if (!percentMode && input.amount === undefined) {
    context.addIssue({ code: "custom", message: "Nominal invoice wajib diisi." });
  }
});
const invoicePatchSchema = invoiceBaseSchema
  .omit({ projectId: true, packageId: true, quotationId: true, issueDate: true })
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

const quotationBaseSchema = z.object({
  status: z.enum(["Draft", "Sent", "Rejected", "Void"]).default("Draft"),
  issuedAt: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)),
  validUntil: isoDateSchema.optional(),
  discountEnabled: z.boolean().default(false),
  discountType: z.enum(["Nominal", "Percent"]).default("Nominal"),
  discountValue: nonNegativeMoney.default(0),
  roundingMode: z.enum(["None", "Up", "Down", "Custom"]).default("None"),
  roundingStep: z.union([z.literal(0), z.literal(1_000), z.literal(10_000), z.literal(100_000)]).default(0),
  roundingAdjustment: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).default(0),
  // The UI clears the reason by sending null, so the field must be nullable —
  // rejecting null here made every quotation save without a custom rounding
  // reason fail with 422 VALIDATION_ERROR ("Data yang dikirim belum valid").
  roundingReason: z.string().trim().max(500).nullable().optional(),
});
const quotationRefinement = (
  input: Partial<z.infer<typeof quotationBaseSchema>>,
  context: z.RefinementCtx,
) => {
  if (input.discountType === "Percent" && (input.discountValue ?? 0) > 10_000) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Diskon persen tidak boleh melebihi 100%." });
  }
  if (input.roundingMode === "Custom" && !input.roundingReason?.trim()) {
    context.addIssue({ code: "custom", path: ["roundingReason"], message: "Alasan pembulatan khusus wajib diisi." });
  }
};
const quotationPatchSchema = partialPatchSchema(quotationBaseSchema).superRefine(quotationRefinement);

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
  packageId: idSchema.optional(),
  deliveryCycle: z.number().int().min(1).max(100).default(1),
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
const bastSealSchema = z.object({
  enabled: z.boolean(),
  signerName: z.string().trim().min(2).max(120),
  signerRole: z.string().trim().min(2).max(120),
  sealMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional().nullable(),
  sealContentBase64: z.string().max(3_000_000).optional().nullable(),
});

const accessLevelSchema = z.enum(["none", "view", "manage"]);

// Derived from `accessModules`, never typed out again. This used to be a
// hand-kept copy of the module list, and zod strips unknown keys: a module
// added to shared/access.ts was happily submitted by the Users & Access page,
// silently dropped here, and never stored — so the Admin's choice reverted to
// the role default on the next read with no error anywhere.
const permissionsSchema = z
  .object(
    Object.fromEntries(
      accessModules.map((accessModule) => [accessModule, accessLevelSchema]),
    ) as Record<AccessModule, typeof accessLevelSchema>,
  )
  .partial()
  .optional();

const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  role: z.enum(["Admin", "Project Manager", "Engineer", "Finance"]),
  status: z.enum(["Aktif", "Nonaktif"]).default("Aktif"),
  password: z.string().min(10).max(128).optional(),
  permissions: permissionsSchema,
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

function makeSequence(prefix: string, sequence: number) {
  const date = new Date();
  return `${prefix}/PN/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}/${String(sequence).padStart(3, "0")}`;
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

// Every resource dispatched below must appear here, or the generic gate in
// `dispatchApi` never runs for it and the only access check left is whatever
// the individual router happens to do. `project-expenses` and `tax` were both
// missing, which is how an Engineer reached the project-expense export and the
// per-document tax position with no module check at all.
const resourceModules: Record<string, AccessModule> = {
  projects: "projects",
  boq: "boq",
  catalog: "boq",
  invoices: "billing",
  quotations: "billing",
  vendors: "procurement",
  "vendor-categories": "procurement",
  spks: "procurement",
  "procurement-orders": "procurement",
  bast: "bast",
  "project-expenses": "expenses",
  "project-expense-categories": "expenses",
  "project-advances": "expenses",
  transactions: "finance",
  finance: "finance",
  tax: "finance",
  "bank-accounts": "finance",
  "profit-shares": "margin",
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

// Field execution on a procurement document — confirming progress on an SPK and
// receiving goods on a PO — belongs to the people who are actually on site. An
// Engineer only carries `procurement: "view"` by default, so the blanket
// "Kelola" gate below would reject exactly the role the workflow depends on.
// The procurement router enforces the real rule for these two endpoints (role
// in {Admin, Project Manager, Engineer} plus project membership); creating,
// approving, sending, completing, voiding, and paying keep the Kelola gate.
function isProcurementFieldExecution(resource: string, path: string[]) {
  return (
    resource === "procurement-orders" &&
    Boolean(path[1]) &&
    (path[2] === "verifications" || path[2] === "receipts") &&
    !path[3]
  );
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

const COORDINATE_LIMIT = { latitude: 90, longitude: 180 } as const;

function assertCoordinate(
  value: number | null | undefined,
  axis: "latitude" | "longitude",
) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT[axis]) {
    throw new ApiError(
      422,
      "INVALID_COORDINATE",
      axis === "latitude"
        ? "Lintang (latitude) harus berada di antara -90 dan 90."
        : "Bujur (longitude) harus berada di antara -180 dan 180.",
    );
  }
  return value;
}

/**
 * Works out what a write is doing to a project's pin.
 *
 * Returns `null` when the request does not mention coordinates at all — the
 * common case, and the one where the stored pin must be left exactly as it is.
 *
 * A pin is one value in two fields, so it is written whole or not at all: a
 * request carrying a latitude and no longitude is refused rather than merged
 * with whatever longitude happened to be stored. Half of a coordinate is not a
 * location, and quietly completing it from an old guess would move a pin the
 * caller never asked to move.
 */
function resolveProjectPin(input: { latitude?: number | null; longitude?: number | null }) {
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;
  if (!hasLatitude && !hasLongitude) return null;
  if (
    hasLatitude !== hasLongitude ||
    (input.latitude === null) !== (input.longitude === null)
  ) {
    throw new ApiError(
      422,
      "INCOMPLETE_COORDINATE",
      "Titik peta membutuhkan lintang dan bujur sekaligus. Isi keduanya, atau kosongkan keduanya.",
    );
  }
  return {
    latitude: assertCoordinate(input.latitude, "latitude"),
    longitude: assertCoordinate(input.longitude, "longitude"),
  };
}

/**
 * True when this project's location text is worth asking Nominatim about.
 *
 * `coordinate_source = 'manual'` is absolute: a pin somebody placed on purpose
 * is never replaced by a guess, however the location text later changes.
 * Otherwise the question is simply whether this exact text has already been
 * answered — `geocoded_query` is written only alongside a successful lookup, so
 * a text that is not recorded there has either never been tried or was tried on
 * a day the geocoder was unreachable, and both deserve one attempt.
 */
function shouldGeocodeProject(
  row: Record<string, unknown> | undefined,
  location: string,
) {
  if (!row) return false;
  if (String(row.coordinate_source ?? "") === "manual") return false;
  return String(row.geocoded_query ?? "") !== location;
}

/**
 * Attempts to place a guessed pin, after the project itself is already saved.
 *
 * Nothing in here may throw and nothing in here may be retried: the project row
 * is committed before this runs, so the worst outcome is a project that is not
 * on the map yet — which the dashboard counts out loud — rather than a save
 * that failed because a third-party service was having a bad minute.
 */
async function geocodeProjectLocation(
  client: DatabaseClient,
  projectId: string,
  location: string,
) {
  try {
    const result = await geocodeLocation(location);
    if (!result) return;
    await client.execute({
      sql: `UPDATE projects
              SET latitude=?,longitude=?,coordinate_source='geocoded',
                  geocoded_query=?,geocoded_label=?
            WHERE id=? AND (coordinate_source IS NULL OR coordinate_source <> 'manual')`,
      // The manual re-check in the WHERE closes the window between reading the
      // row and writing the answer: somebody may have dropped a real pin while
      // the lookup was in flight, and that pin wins.
      args: [
        result.latitude,
        result.longitude,
        location,
        result.label || null,
        projectId,
      ],
    });
  } catch (error) {
    console.error("Geocoding lokasi proyek gagal:", error);
  }
}

async function detachOrDeleteSystemTransaction(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  source: "Invoice" | "SPK" | "Invoice Payment" | "Invoice Payment Reversal",
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

/**
 * Whether a raw recovery token may be handed back in an HTTP response.
 *
 * A password-reset token in a JSON body is an unauthenticated account takeover:
 * ask for a reset, read the token out of the reply, reset the password, sign in
 * as Admin. It exists at all so a developer with no mail provider can finish the
 * flow locally, and it is allowed only when BOTH of those are true — the process
 * is not a production one, and no security mail could have been delivered
 * anyway. Either alone has already failed once: the old test paired NODE_ENV
 * with `RESEND_API_KEY`, which is permanently empty here because mail goes over
 * SMTP, so NODE_ENV was carrying the whole thing by itself — and NODE_ENV read
 * through the compiler-inlined `process.env.NODE_ENV` was not even reading the
 * operator's value (see server/runtime-env.ts).
 */
function developmentTokensAllowed() {
  return !isProductionRuntime() && securityMailUndeliverable();
}

async function handleAuth(request: Request, path: string[]) {
  const action = path[1];
  if (request.method === "GET" && action === "session") {
    return ok({ user: await getSessionUser(request) }, 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "POST" && action === "login") {
    const input = loginSchema.parse(await jsonBody(request));
    const { client } = await getDatabase();
    // Checked before any hashing, so a caller who is already blocked cannot
    // keep the server busy running bcrypt on their behalf.
    await assertAuthRateLimit(client, request, "login", input.email);
    let user: AuthUser;
    let jalur: "mailserver" | "lokal";
    try {
      ({ user, jalur } = await verifyCredentials(input.email, input.password));
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["INVALID_CREDENTIALS", "ACCOUNT_INACTIVE"].includes(error.code)
      ) {
        await recordAuthFailure(client, request, "login", input.email);
      }
      throw error;
    }
    await clearAuthRateLimit(client, request, "login", input.email);
    // Masuk lewat kata sandi lokal saat mode mailserver menyala berarti akun
    // darurat dipakai. Itu pintu kebakaran yang sah, tapi pemakaiannya harus
    // terlihat — bukan tersembunyi di antara login biasa.
    await writeAuditLog(client, request, user, "login", "session", user.id, {
      jalur,
    });
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
    // Recovery is throttled on its own bucket, and every request counts —
    // whether or not an account matched, so the throttle itself cannot be used
    // to tell registered addresses from unregistered ones, and so a successful
    // request cannot be repeated into a mail flood at the owner's address.
    await assertAuthRateLimit(client, request, "forgot-password", input.email);
    await recordAuthFailure(client, request, "forgot-password", input.email);
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
      // Two independent conditions, both required. The mail state is the real
      // question — a token only needs handing back when no mail can carry it —
      // and NODE_ENV is the backstop that keeps the answer from ever mattering
      // in a production process, whatever the mail configuration says.
      if (developmentTokensAllowed()) {
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
    // Throttled on the IP alone — the reset token is the only identifier the
    // caller sends, and keying on it would let an attacker who guessed one
    // token lock out nobody but themselves.
    await assertAuthRateLimit(client, request, "reset-password");
    const result = await client.execute({
      sql: "SELECT id,user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1",
      args: [hashResetToken(input.token), now()],
    });
    const reset = result.rows[0];
    if (!reset) {
      await recordAuthFailure(client, request, "reset-password");
      throw new ApiError(400, "INVALID_RESET_TOKEN", "Tautan reset tidak valid atau sudah kedaluwarsa.");
    }
    await clearAuthRateLimit(client, request, "reset-password");
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
        // Recovering the account also cancels any email change an intruder
        // asked for while they held the session.
        {
          sql: "DELETE FROM email_change_requests WHERE user_id = ?",
          args: [reset.user_id],
        },
      ],
      "write",
    );
    return ok({ success: true });
  }

  if (action === "confirm-email-change" && ["GET", "POST"].includes(request.method)) {
    const landing = (outcome: "confirmed" | "invalid") =>
      new URL(
        applicationPath(`/admin?emailChange=${outcome}`),
        new URL(request.url).origin,
      ).toString();
    const token =
      request.method === "GET"
        ? new URL(request.url).searchParams.get("token") ?? ""
        : z
            .object({ token: z.string().min(32).max(200) })
            .parse(await jsonBody(request)).token;
    // The link lands here from a mail client, so a GET has to be able to
    // complete it. The token is a single-use 32-byte secret that expires, which
    // is what carries the authority — there is no ambient session to abuse.
    if (request.method === "GET" && (token.length < 32 || token.length > 200)) {
      return Response.redirect(landing("invalid"), 302);
    }
    try {
      const result = await confirmEmailChange(token);
      if (request.method === "GET") return Response.redirect(landing("confirmed"), 302);
      return ok(result);
    } catch (error) {
      if (request.method === "GET" && error instanceof ApiError) {
        return Response.redirect(landing("invalid"), 302);
      }
      throw error;
    }
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint autentikasi tidak ditemukan.");
}

/**
 * Applies a pending email change once the confirmation link comes back from the
 * NEW address, then ends every session on the account. A session that was alive
 * before the address moved has to die with it: otherwise a stolen cookie
 * survives the very event that was supposed to expose it.
 */
async function confirmEmailChange(rawToken: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT id,user_id,current_email,new_email FROM email_change_requests
      WHERE token_hash = ? AND confirmed_at IS NULL AND expires_at > ? LIMIT 1`,
    args: [hashResetToken(rawToken), now()],
  });
  const pending = result.rows[0];
  if (!pending) {
    throw new ApiError(
      400,
      "INVALID_EMAIL_CHANGE_TOKEN",
      "Tautan konfirmasi email tidak valid atau sudah kedaluwarsa.",
    );
  }
  const userId = String(pending.user_id);
  const newEmail = String(pending.new_email);
  const duplicate = await client.execute({
    sql: "SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?",
    args: [newEmail, userId],
  });
  if (duplicate.rows.length) {
    throw new ApiError(409, "EMAIL_EXISTS", "Email sudah digunakan oleh pengguna lain.");
  }
  const account = await client.execute({
    sql: `SELECT u.email,COALESCE(p.preferred_language,'id') AS preferred_language
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=? LIMIT 1`,
    args: [userId],
  });
  const previousEmail = account.rows[0]
    ? String(account.rows[0].email)
    : String(pending.current_email);
  const timestamp = now();
  await client.batch(
    [
      {
        sql: "UPDATE users SET email=?,updated_at=? WHERE id=?",
        args: [newEmail, timestamp, userId],
      },
      {
        sql: "UPDATE email_change_requests SET confirmed_at=? WHERE id=?",
        args: [timestamp, pending.id],
      },
      {
        sql: "DELETE FROM email_change_requests WHERE user_id=? AND id<>?",
        args: [userId, pending.id],
      },
      { sql: "DELETE FROM sessions WHERE user_id=?", args: [userId] },
      // Reset links issued to the old address stop working the moment the
      // address stops belonging to the account.
      { sql: "DELETE FROM password_reset_tokens WHERE user_id=?", args: [userId] },
    ],
    "write",
  );
  await sendEmailChangedEmail(
    client,
    {
      id: userId,
      preferredLanguage:
        String(account.rows[0]?.preferred_language) === "en" ? "en" : "id",
    },
    previousEmail,
    newEmail,
  );
  return { success: true, email: newEmail };
}

/**
 * Starts a verified email change: the account keeps its current address, the
 * confirmation link goes to the new one, and the current address is told that
 * somebody asked. Returns the raw token only when `developmentTokensAllowed()`
 * agrees, mirroring how forgot-password exposes its reset token in dev.
 */
async function requestEmailChange(
  client: DatabaseClient,
  target: { id: string; email: string; preferredLanguage: AuthUser["preferredLanguage"] },
  newEmail: string,
  requestedBy: string,
) {
  const duplicate = await client.execute({
    sql: "SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?",
    args: [newEmail, target.id],
  });
  if (duplicate.rows.length) {
    throw new ApiError(409, "EMAIL_EXISTS", "Email sudah digunakan oleh pengguna lain.");
  }
  const token = await createEmailChangeToken(client, {
    userId: target.id,
    currentEmail: target.email,
    newEmail,
    requestedBy,
  });
  await sendEmailChangeConfirmationEmail(
    client,
    { id: target.id, email: target.email, preferredLanguage: target.preferredLanguage },
    newEmail,
    token,
    emailChangeTokenMinutes(),
  );
  await sendEmailChangeRequestedEmail(
    client,
    { id: target.id, email: target.email, preferredLanguage: target.preferredLanguage },
    newEmail,
  );
  return {
    pendingEmail: newEmail,
    expiresInMinutes: emailChangeTokenMinutes(),
    ...(developmentTokensAllowed() ? { confirmationToken: token } : {}),
  };
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
      // The dashboard map reads its pins from this list and from nothing else,
      // so the map inherits `projectScopeCondition` above rather than opening a
      // second, differently-scoped way to ask which projects exist.
      latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
      longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
      coordinateSource:
        row.coordinate_source === "manual" || row.coordinate_source === "geocoded"
          ? row.coordinate_source
          : null,
      geocodedLabel: row.geocoded_label ? String(row.geocoded_label) : null,
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
    const pin = resolveProjectPin(input);
    const pinnedByHand = pin !== null && pin.latitude !== null;
    const id = randomUUID();
    const sequence = await claimSequence(client, "projects", "SELECT code AS value FROM projects");
    const code = `PN-${new Date().getUTCFullYear().toString().slice(-2)}${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-${String(sequence).padStart(3, "0")}`;
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
          sql: "INSERT INTO projects (id,code,name,client,location,status,start_date,target_date,value,manager_id,created_by,latitude,longitude,coordinate_source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [id, code, input.name, input.client, input.location, input.status, input.startDate ?? null, input.targetDate ?? null, input.value, input.managerId ?? user.id, user.id, pin?.latitude ?? null, pin?.longitude ?? null, pinnedByHand ? "manual" : null, timestamp, timestamp],
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
    // The project is committed above. This can only add coordinates to it; it
    // cannot fail the creation, and it is skipped entirely when the operator
    // already supplied a pin of their own.
    if (!pinnedByHand) await geocodeProjectLocation(client, id, input.location);
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
      const input = partialPatchSchema(taskSchema).parse(await jsonBody(request));
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
    const input = partialPatchSchema(projectSchema).parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM projects WHERE id = ?", [projectId], "Proyek tidak ditemukan.");
    assertDateOrder(
      input.startDate === undefined ? current.start_date : input.startDate,
      input.targetDate === undefined ? current.target_date : input.targetDate,
    );
    // Once a quotation is accepted the project value IS the contract:
    // syncProjectCommercialValue derives it from the accepted grand total and
    // rewrites it on the next BoQ edit. Accepting a typed value here only
    // created a window in which dashboards and portfolio totals disagreed with
    // the signed documents. A project with no accepted quotation keeps the
    // manual field, because that is how a project starts.
    if (input.value !== undefined && asNumber(input.value) !== asNumber(current.value)) {
      const accepted = await client.execute({
        sql: "SELECT id FROM quotations WHERE project_id=? AND status='Accepted' LIMIT 1",
        args: [projectId],
      });
      if (accepted.rows.length) {
        throw new ApiError(
          409,
          "PROJECT_VALUE_DERIVED",
          "Nilai proyek ini mengikuti Quotation yang sudah diterima klien dan tidak dapat diketik manual. Terbitkan Addendum bila nilai kontraknya berubah.",
        );
      }
    }
    const pin = resolveProjectPin(input);
    // A request that mentions coordinates is a person moving the pin, so the
    // result is 'manual' and no later guess may replace it. Clearing both to
    // null also clears the geocoding record, which puts the project back in the
    // "ask the geocoder again" state rather than stranding it with no pin and
    // no way to get one.
    const pinnedByHand = pin !== null && pin.latitude !== null;
    const location = String(input.location ?? current.location);
    await client.execute({
      sql: "UPDATE projects SET name=?,client=?,location=?,status=?,start_date=?,target_date=?,value=?,manager_id=?,latitude=?,longitude=?,coordinate_source=?,geocoded_query=?,geocoded_label=?,updated_at=? WHERE id=?",
      args: [
        input.name ?? current.name,
        input.client ?? current.client,
        input.location ?? current.location,
        input.status ?? current.status,
        input.startDate === undefined ? current.start_date : input.startDate,
        input.targetDate === undefined ? current.target_date : input.targetDate,
        input.value ?? current.value,
        input.managerId === undefined ? current.manager_id : input.managerId,
        pin === null ? current.latitude ?? null : pin.latitude,
        pin === null ? current.longitude ?? null : pin.longitude,
        pin === null ? current.coordinate_source ?? null : pinnedByHand ? "manual" : null,
        pin === null || pinnedByHand ? current.geocoded_query ?? null : null,
        pin === null || pinnedByHand ? current.geocoded_label ?? null : null,
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
    // Same contract as on create: the row above is already saved, and this can
    // only add a guess to it. A request that mentioned coordinates at all has
    // already decided them — placing a pin, or clearing one to take the project
    // off the map — and is left alone; a cleared project is offered to the
    // geocoder again on its next save, not immediately re-guessed.
    if (pin === null && shouldGeocodeProject(current, location)) {
      await geocodeProjectLocation(client, projectId, location);
    }
    const projects = await listProjects(new URLSearchParams(), user);
    return ok(projects.find((project) => project.id === projectId));
  }

  if (projectId && !child && request.method === "DELETE") {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat menghapus proyek.");
    }
    await assertProjectAccess(user, projectId);
    // Deleting a project used to hard-wipe its cash: transactions, invoice and
    // vendor payments, expense and tax settlements all disappeared with no
    // trace beyond a bare audit line. Recorded money is never deletable — such
    // a project is closed or archived, not removed.
    const financialHistory = await client.execute({
      sql: `SELECT
        (SELECT COUNT(*) FROM invoice_payments ip
          JOIN invoices i ON i.id=ip.invoice_id
          WHERE i.project_id=? AND ip.status='Posted') AS invoice_payments,
        (SELECT COUNT(*) FROM spk_payments sp
          JOIN spks s ON s.id=sp.spk_id
          WHERE s.project_id=? AND sp.status='Posted') AS spk_payments,
        (SELECT COUNT(*) FROM project_expense_settlements
          WHERE expense_id IN (SELECT id FROM project_expenses WHERE project_id=?)
             OR advance_id IN (SELECT id FROM project_advances WHERE project_id=?)
        ) AS expense_settlements,
        (SELECT COUNT(*) FROM tax_settlements WHERE obligation_id IN (
          SELECT o.id FROM tax_obligations o
          JOIN document_taxes dt ON dt.id=o.document_tax_id
          WHERE dt.project_id=?
        )) AS tax_settlements,
        (SELECT COUNT(*) FROM transactions WHERE project_id=?) AS transactions`,
      args: [projectId, projectId, projectId, projectId, projectId, projectId],
    });
    const posted = {
      invoicePayments: asNumber(financialHistory.rows[0]?.invoice_payments),
      spkPayments: asNumber(financialHistory.rows[0]?.spk_payments),
      expenseSettlements: asNumber(financialHistory.rows[0]?.expense_settlements),
      taxSettlements: asNumber(financialHistory.rows[0]?.tax_settlements),
      transactions: asNumber(financialHistory.rows[0]?.transactions),
    };
    if (Object.values(posted).some((count) => count > 0)) {
      throw new ApiError(
        409,
        "PROJECT_HAS_FINANCIAL_HISTORY",
        "Proyek ini sudah memiliki riwayat kas yang tercatat (pembayaran, penyelesaian, atau transaksi) sehingga tidak dapat dihapus. Tutup atau arsipkan proyek agar catatan keuangannya tetap utuh.",
        posted,
      );
    }
    const documents = await client.execute({
      sql: "SELECT storage_url FROM project_documents WHERE project_id=?",
      args: [projectId],
    });
    const expenseAttachments = await client.execute({
      sql: `SELECT a.storage_url FROM project_expense_attachments a
        JOIN project_expenses e ON e.id=a.expense_id WHERE e.project_id=?`,
      args: [projectId],
    });
    // What the deletion actually removes, recorded for the audit trail — a bare
    // "delete project" line cannot be reconciled against later.
    const removedCounts = await client.execute({
      sql: `SELECT
        (SELECT COUNT(*) FROM invoices WHERE project_id=?) AS invoices,
        (SELECT COUNT(*) FROM spks WHERE project_id=?) AS spks,
        (SELECT COUNT(*) FROM basts WHERE project_id=?) AS basts,
        (SELECT COUNT(*) FROM quotations WHERE project_id=?) AS quotations,
        (SELECT COUNT(*) FROM project_validations WHERE project_id=?) AS validations,
        (SELECT COUNT(*) FROM project_expenses WHERE project_id=?) AS expenses,
        (SELECT COUNT(*) FROM project_advances WHERE project_id=?) AS advances,
        (SELECT COUNT(*) FROM project_documents WHERE project_id=?) AS documents,
        (SELECT COUNT(*) FROM project_commercial_packages WHERE project_id=?) AS packages,
        (SELECT COUNT(*) FROM document_taxes WHERE project_id=?) AS document_taxes`,
      args: Array.from({ length: 10 }, () => projectId),
    });
    await client.batch(
      [
        // bank_statement_entries.transaction_id is ON DELETE SET NULL, but the
        // reconciliation flag is not — an entry would stay 'Matched' while
        // pointing at nothing. Release it back to the unmatched pool instead.
        {
          sql: `UPDATE bank_statement_entries
            SET reconciliation_status='Imported',transaction_id=NULL
            WHERE transaction_id IN (SELECT id FROM transactions WHERE project_id=?)`,
          args: [projectId],
        },
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
        {
          sql: `DELETE FROM project_expense_settlements
            WHERE expense_id IN (SELECT id FROM project_expenses WHERE project_id=?)
              OR advance_id IN (SELECT id FROM project_advances WHERE project_id=?)`,
          args: [projectId, projectId],
        },
        { sql: "DELETE FROM project_expenses WHERE project_id=?", args: [projectId] },
        { sql: "DELETE FROM project_advances WHERE project_id=?", args: [projectId] },
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
        { sql: "DELETE FROM invoices WHERE project_id=?", args: [projectId] },
        { sql: "DELETE FROM basts WHERE project_id=?", args: [projectId] },
        {
          sql: `DELETE FROM project_validation_items WHERE validation_id IN (
            SELECT id FROM project_validations WHERE project_id=?
          )`,
          args: [projectId],
        },
        { sql: "DELETE FROM project_validations WHERE project_id=?", args: [projectId] },
        { sql: "DELETE FROM quotations WHERE project_id=?", args: [projectId] },
        {
          sql: `DELETE FROM boq_items WHERE boq_id IN (
            SELECT id FROM boqs WHERE project_id=?
          )`,
          args: [projectId],
        },
        {
          sql: `DELETE FROM boq_scopes WHERE boq_id IN (
            SELECT id FROM boqs WHERE project_id=?
          )`,
          args: [projectId],
        },
        { sql: "DELETE FROM boqs WHERE project_id=?", args: [projectId] },
        {
          sql: "DELETE FROM project_commercial_packages WHERE project_id=?",
          args: [projectId],
        },
        { sql: "DELETE FROM projects WHERE id = ?", args: [projectId] },
      ],
      "write",
    );
    await Promise.allSettled(
      [...documents.rows, ...expenseAttachments.rows].map((document) =>
        deleteProjectFile(document.storage_url ? String(document.storage_url) : null),
      ),
    );
    await writeAuditLog(client, request, user, "delete", "project", projectId, {
      removed: Object.fromEntries(
        Object.entries(removedCounts.rows[0] ?? {}).map(([key, value]) => [
          key,
          asNumber(value),
        ]),
      ),
      financialHistory: posted,
    });
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint proyek tidak ditemukan.");
}

async function getBoq(projectId: string, requestedPackageId?: string | null) {
  const { client } = await getDatabase();
  const project = await ensureExists(
    "SELECT id,name,code,client FROM projects WHERE id = ?",
    [projectId],
    "Proyek tidak ditemukan.",
  );
  const packageId = await resolveCommercialPackageId(client, projectId, requestedPackageId);
  const packageResult = await client.execute({
    sql: "SELECT id,code,title,status FROM project_commercial_packages WHERE id=? LIMIT 1",
    args: [packageId],
  });
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
      package: packageResult.rows[0],
      packageId,
      items: [],
      totals: { cost: 0, selling: 0, margin: 0, marginPercentage: 0 },
    };
  }
  const scopeResult = await client.execute({
    sql: `SELECT * FROM boq_scopes WHERE boq_id=? AND package_id=?
      AND kind='Original' AND parent_scope_id IS NULL ORDER BY sequence LIMIT 1`,
    args: [boq.id, packageId],
  });
  const scope = scopeResult.rows[0];
  const itemsResult = scope
    ? await client.execute({
        sql: "SELECT * FROM boq_items WHERE scope_id = ? ORDER BY sort_order, created_at",
        args: [scope.id],
      })
    : { rows: [] as Array<Record<string, unknown>> };
  const items = itemsResult.rows.map((row) => ({
    id: String(row.id),
    category: String(row.category),
    description: String(row.description),
    quantity: asNumber(row.quantity),
    unit: String(row.unit),
    costPrice: asNumber(row.cost_price),
    sellingPrice: asNumber(row.selling_price),
    catalogItemId: row.catalog_item_id ? String(row.catalog_item_id) : null,
    catalogPriceTier: row.catalog_price_tier ? asNumber(row.catalog_price_tier) as 1 | 2 : null,
    catalogRevision: row.catalog_revision ? asNumber(row.catalog_revision) : null,
    manualPriceOverride: Number(row.manual_price_override) === 1,
    priceOverrideReason: row.price_override_reason ? String(row.price_override_reason) : null,
  }));
  const cost = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
  const selling = items.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0);
  const margin = selling - cost;
  return {
    id: String(boq.id),
    scopeId: scope ? String(scope.id) : null,
    packageId,
    package: packageResult.rows[0]
      ? {
          id: String(packageResult.rows[0].id),
          code: String(packageResult.rows[0].code),
          title: String(packageResult.rows[0].title),
          status: String(packageResult.rows[0].status),
        }
      : null,
    project: {
      id: String(project.id),
      name: String(project.name),
      code: String(project.code),
      client: String(project.client),
    },
    status: scope ? String(scope.status) : String(boq.status),
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

async function ensureBoq(projectId: string, requestedPackageId?: string | null) {
  const { client } = await getDatabase();
  const packageId = await resolveCommercialPackageId(client, projectId, requestedPackageId);
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
    sql: `SELECT id FROM boq_scopes WHERE boq_id=? AND package_id=?
      AND kind='Original' AND parent_scope_id IS NULL ORDER BY sequence LIMIT 1`,
    args: [id, packageId],
  });
  let scopeId = scope.rows[0] ? String(scope.rows[0].id) : "";
  if (!scope.rows[0]) {
    const sequence = await client.execute({
      sql: "SELECT COALESCE(MAX(sequence),-1)+1 AS sequence FROM boq_scopes WHERE boq_id=?",
      args: [id],
    });
    const packageResult = await client.execute({
      sql: "SELECT title FROM project_commercial_packages WHERE id=? LIMIT 1",
      args: [packageId],
    });
    scopeId = randomUUID();
    await client.execute({
      sql: `INSERT INTO boq_scopes
        (id,boq_id,package_id,kind,sequence,title,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [scopeId, id, packageId, "Original", asNumber(sequence.rows[0]?.sequence),
        String(packageResult.rows[0]?.title ?? "Lingkup Utama"), "Draft", timestamp, timestamp],
    });
  }
  return { boqId: id, scopeId, packageId };
}

async function handleBoq(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
  const packageId = searchParams.get("packageId");
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
      const resolvedItems = await Promise.all(
        input.items.map((item) => resolveBoqItemInput(client, user, item)),
      );
      const id = randomUUID();
      const timestamp = now();
      const statements = [
        {
          sql: "INSERT INTO boq_templates (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)",
          args: [id, input.name, user.id, timestamp, timestamp],
        },
        ...resolvedItems.map((item, index) => ({
          sql: `INSERT INTO boq_template_items
            (id,template_id,category,description,quantity,unit,cost_price,selling_price,
             catalog_item_id,catalog_price_tier,catalog_revision,manual_price_override,
             price_override_reason,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [randomUUID(), id, item.category, item.description, item.quantity, item.unit,
            item.costPrice, item.sellingPrice, item.catalogItemId ?? null,
            item.catalogPriceTier ?? null, item.catalogRevision,
            item.manualPriceOverride ? 1 : 0,
            item.priceOverrideReason ?? null, index],
        })),
      ];
      await client.batch(statements, "write");
      await writeAuditLog(client, request, user, "create", "boq_template", id, { name: input.name, itemCount: resolvedItems.length });
      return created({ id, name: input.name, items: resolvedItems.length, lastUsed: "Baru saja" });
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
          catalogItemId: row.catalog_item_id ? String(row.catalog_item_id) : null,
          catalogPriceTier: row.catalog_price_tier ? asNumber(row.catalog_price_tier) as 1 | 2 : null,
          catalogRevision: row.catalog_revision ? asNumber(row.catalog_revision) : null,
          manualPriceOverride: Number(row.manual_price_override) === 1,
          priceOverrideReason: row.price_override_reason ? String(row.price_override_reason) : null,
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
  const selectedPackageId = await resolveCommercialPackageId(
    client,
    projectId,
    packageId,
    { requireActive: request.method !== "GET" },
  );

  if (request.method === "GET" && !child) {
    return ok(await getBoq(projectId, selectedPackageId));
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
    const resolvedItems = await Promise.all(
      input.items.map((item) => resolveBoqItemInput(client, user, item)),
    );
    const proposedTotal = resolvedItems.reduce(
      (sum, item) => sum + item.quantity * item.sellingPrice,
      0,
    );
    const ensured = await ensureBoq(projectId, selectedPackageId);
    await assertBoqTotalCoversInvoices(
      client,
      projectId,
      proposedTotal,
      ensured.packageId,
    );
    const boqId = ensured.boqId;
    const originalScope = await ensureExists(
      "SELECT id,status FROM boq_scopes WHERE id=? LIMIT 1",
      [ensured.scopeId],
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
      ...resolvedItems.map((item, index) => ({
        sql: `INSERT INTO boq_items
          (id,boq_id,scope_id,category,description,quantity,unit,cost_price,selling_price,
           catalog_item_id,catalog_price_tier,catalog_revision,manual_price_override,
           price_override_reason,sort_order,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [input.items[index]?.id ?? randomUUID(), boqId, originalScope.id,
          item.category, item.description, item.quantity, item.unit, item.costPrice,
          item.sellingPrice, item.catalogItemId, item.catalogPriceTier,
          item.catalogRevision, item.manualPriceOverride ? 1 : 0,
          item.priceOverrideReason, index, timestamp, timestamp],
      })),
    ];
    await client.batch(statements, "write");
    await syncCommercialValues(client, projectId, { request, user });
    await resetProjectValidation(client, projectId, ensured.packageId);
    await writeAuditLog(client, request, user, "replace", "boq", boqId, { projectId, itemCount: resolvedItems.length });
    return ok(await getBoq(projectId, ensured.packageId));
  }

  if (request.method === "POST" && child === "items") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menambah item BoQ.");
    const input = await resolveBoqItemInput(
      client,
      user,
      boqItemSchema.parse(await jsonBody(request)),
    );
    const ensured = await ensureBoq(projectId, selectedPackageId);
    const boqId = ensured.boqId;
    const originalScope = await ensureExists(
      "SELECT id,status FROM boq_scopes WHERE id=? LIMIT 1",
      [ensured.scopeId],
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
      sql: `INSERT INTO boq_items
        (id,boq_id,scope_id,category,description,quantity,unit,cost_price,selling_price,
         catalog_item_id,catalog_price_tier,catalog_revision,manual_price_override,
         price_override_reason,sort_order,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, boqId, originalScope.id, input.category, input.description,
        input.quantity, input.unit, input.costPrice, input.sellingPrice,
        input.catalogItemId, input.catalogPriceTier, input.catalogRevision,
        input.manualPriceOverride ? 1 : 0, input.priceOverrideReason,
        asNumber(count.rows[0]?.count), timestamp, timestamp],
    });
    await syncCommercialValues(client, projectId, { request, user });
    await resetProjectValidation(client, projectId, ensured.packageId);
    await writeAuditLog(client, request, user, "create", "boq_item", id, { projectId });
    return created({ id, ...input });
  }

  if (child === "items" && childId && request.method === "PATCH") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah item BoQ.");
    const input = partialPatchSchema(boqItemSchema).parse(await jsonBody(request));
    const current = await ensureExists(
      `SELECT i.*,s.status AS scope_status FROM boq_items i
        JOIN boqs b ON b.id=i.boq_id
        LEFT JOIN boq_scopes s ON s.id=i.scope_id
        WHERE i.id=? AND b.project_id=? AND s.package_id=?`,
      [childId, projectId, selectedPackageId],
      "Item BoQ tidak ditemukan.",
    );
    if (String(current.scope_status) === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_SCOPE_LOCKED",
        "Item yang sudah diterima klien tidak dapat diedit. Buat Addendum baru.",
      );
    }
    const resolved = await resolveBoqItemInput(client, user, {
      category: (input.category ?? current.category) as BoqItemInput["category"],
      description: String(input.description ?? current.description),
      quantity: asNumber(input.quantity ?? current.quantity),
      unit: String(input.unit ?? current.unit),
      costPrice: asNumber(input.costPrice ?? current.cost_price),
      sellingPrice: asNumber(input.sellingPrice ?? current.selling_price),
      catalogItemId: input.catalogItemId === undefined
        ? (current.catalog_item_id ? String(current.catalog_item_id) : null)
        : input.catalogItemId,
      catalogPriceTier: input.catalogPriceTier === undefined
        ? (current.catalog_price_tier ? asNumber(current.catalog_price_tier) as 1 | 2 : null)
        : input.catalogPriceTier,
      manualPriceOverride: input.manualPriceOverride ?? Number(current.manual_price_override) === 1,
      priceOverrideReason: input.priceOverrideReason === undefined
        ? (current.price_override_reason ? String(current.price_override_reason) : null)
        : input.priceOverrideReason,
    });
    const currentBoq = await getBoq(projectId, selectedPackageId);
    const proposedTotal =
      currentBoq.totals.selling -
      asNumber(current.quantity) * asNumber(current.selling_price) +
      resolved.quantity * resolved.sellingPrice;
    await assertBoqTotalCoversInvoices(
      client,
      projectId,
      proposedTotal,
      currentBoq.packageId,
    );
    await client.execute({
      sql: `UPDATE boq_items SET category=?,description=?,quantity=?,unit=?,cost_price=?,selling_price=?,
        catalog_item_id=?,catalog_price_tier=?,catalog_revision=?,manual_price_override=?,
        price_override_reason=?,updated_at=? WHERE id=?`,
      args: [
        resolved.category,
        resolved.description,
        resolved.quantity,
        resolved.unit,
        resolved.costPrice,
        resolved.sellingPrice,
        resolved.catalogItemId,
        resolved.catalogPriceTier,
        resolved.catalogRevision,
        resolved.manualPriceOverride ? 1 : 0,
        resolved.priceOverrideReason,
        now(),
        childId,
      ],
    });
    await syncCommercialValues(client, projectId, { request, user });
    await resetProjectValidation(client, projectId, currentBoq.packageId);
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
      catalogItemId: updated.catalog_item_id ? String(updated.catalog_item_id) : null,
      catalogPriceTier: updated.catalog_price_tier ? asNumber(updated.catalog_price_tier) as 1 | 2 : null,
      catalogRevision: updated.catalog_revision ? asNumber(updated.catalog_revision) : null,
      manualPriceOverride: Number(updated.manual_price_override) === 1,
      priceOverrideReason: updated.price_override_reason ? String(updated.price_override_reason) : null,
    });
  }

  if (child === "items" && childId && request.method === "DELETE") {
    if (!mutationRoles("boq").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus item BoQ.");
    const itemScope = await ensureExists(
      `SELECT i.id,s.status AS scope_status FROM boq_items i
        JOIN boqs b ON b.id=i.boq_id
        LEFT JOIN boq_scopes s ON s.id=i.scope_id
        WHERE i.id=? AND b.project_id=? AND s.package_id=?`,
      [childId, projectId, selectedPackageId],
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
    const currentBoq = await getBoq(projectId, selectedPackageId);
    await assertBoqTotalCoversInvoices(
      client,
      projectId,
      currentBoq.totals.selling -
        asNumber(item.quantity) * asNumber(item.selling_price),
      currentBoq.packageId,
    );
    await client.execute({ sql: "DELETE FROM boq_items WHERE id = ?", args: [childId] });
    await syncCommercialValues(client, projectId, { request, user });
    await resetProjectValidation(client, projectId, currentBoq.packageId);
    await writeAuditLog(client, request, user, "delete", "boq_item", childId, { projectId });
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BoQ tidak ditemukan.");
}

async function quotationResponse(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  row: Record<string, unknown>,
  language: "id" | "en" = "id",
) {
  const taxableBase = asNumber(row.taxable_base) || asNumber(row.total);
  const tax = await documentTaxSummary(client, "Quotation", String(row.id), taxableBase);
  const totals = calculateQuotationCommercialTotals({
    subtotal: asNumber(row.total),
    discountEnabled: Number(row.discount_enabled) === 1,
    discountType: String(row.discount_type) === "Percent" ? "Percent" : "Nominal",
    discountValue: asNumber(row.discount_value),
    taxAdditions: tax.taxAdditions,
    taxWithholdings: tax.taxWithholdings,
    roundingMode: ["Up", "Down", "Custom"].includes(String(row.rounding_mode))
      ? String(row.rounding_mode) as "Up" | "Down" | "Custom"
      : "None",
    roundingStep: asNumber(row.rounding_step),
    customRoundingAdjustment: asNumber(row.rounding_adjustment),
  });
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    packageId: row.package_id ? String(row.package_id) : null,
    packageTitle: row.package_title
      ? localizedPackageTitle(row.package_title, language)
      : null,
    scopeId: row.scope_id ? String(row.scope_id) : null,
    number: String(row.number),
    status: String(row.status),
    revisionNo: asNumber(row.revision_no) || 1,
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
    issuedAt: String(row.issued_at),
    validUntil: row.valid_until ? String(row.valid_until) : null,
    total: totals.subtotal,
    subtotal: totals.subtotal,
    discountEnabled: Number(row.discount_enabled) === 1,
    discountType: String(row.discount_type),
    discountValue: asNumber(row.discount_value),
    discountAmount: totals.discountAmount,
    taxableBase: totals.taxableBase,
    taxEnabled: Number(row.tax_enabled) === 1,
    taxRevision: asNumber(row.tax_revision),
    taxes: tax.taxes,
    taxAdditions: totals.taxAdditions,
    taxWithholdings: totals.taxWithholdings,
    roundingMode: String(row.rounding_mode ?? "None"),
    roundingStep: asNumber(row.rounding_step),
    roundingAdjustment: totals.roundingAdjustment,
    roundingReason: row.rounding_reason ? String(row.rounding_reason) : null,
    grandTotal: totals.grandTotal,
    grossTotal: totals.grandTotal,
    netCashDue: totals.netCashDue,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    acceptanceAttachmentName: row.acceptance_attachment_name
      ? String(row.acceptance_attachment_name)
      : null,
  };
}

async function refreshQuotationCommercialSnapshot(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  quotationId: string,
  language: "id" | "en" = "id",
) {
  const result = await client.execute({
    sql: "SELECT * FROM quotations WHERE id=? LIMIT 1",
    args: [quotationId],
  });
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
  const preliminary = calculateQuotationCommercialTotals({
    subtotal: asNumber(row.total),
    discountEnabled: Number(row.discount_enabled) === 1,
    discountType: String(row.discount_type) === "Percent" ? "Percent" : "Nominal",
    discountValue: asNumber(row.discount_value),
  });
  const taxes = await client.execute({
    sql: "SELECT id,rate_bps,locked FROM document_taxes WHERE document_type='Quotation' AND document_id=?",
    args: [quotationId],
  });
  for (const tax of taxes.rows) {
    if (Number(tax.locked) === 1) continue;
    await client.execute({
      sql: "UPDATE document_taxes SET taxable_base=?,amount=?,updated_at=? WHERE id=?",
      args: [
        preliminary.taxableBase,
        calculateTaxAmount(preliminary.taxableBase, asNumber(tax.rate_bps)),
        now(),
        tax.id,
      ],
    });
  }
  const tax = await documentTaxSummary(client, "Quotation", quotationId, preliminary.taxableBase);
  const totals = calculateQuotationCommercialTotals({
    subtotal: asNumber(row.total),
    discountEnabled: Number(row.discount_enabled) === 1,
    discountType: String(row.discount_type) === "Percent" ? "Percent" : "Nominal",
    discountValue: asNumber(row.discount_value),
    taxAdditions: tax.taxAdditions,
    taxWithholdings: tax.taxWithholdings,
    roundingMode: ["Up", "Down", "Custom"].includes(String(row.rounding_mode))
      ? String(row.rounding_mode) as "Up" | "Down" | "Custom"
      : "None",
    roundingStep: asNumber(row.rounding_step),
    customRoundingAdjustment: asNumber(row.rounding_adjustment),
  });
  await client.execute({
    sql: `UPDATE quotations SET discount_amount=?,taxable_base=?,
      tax_additions_snapshot=?,tax_withholdings_snapshot=?,rounding_adjustment=?,
      grand_total=?,updated_at=? WHERE id=?`,
    args: [
      totals.discountAmount,
      totals.taxableBase,
      totals.taxAdditions,
      totals.taxWithholdings,
      totals.roundingAdjustment,
      totals.grandTotal,
      now(),
      quotationId,
    ],
  });
  const refreshed = await client.execute({
    sql: `SELECT q.*,cp.title AS package_title FROM quotations q
      LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
      WHERE q.id=? LIMIT 1`,
    args: [quotationId],
  });
  return quotationResponse(client, refreshed.rows[0], language);
}

// Every project is seeded with one commercial package carrying this exact
// Indonesian title (server/api/commercial-package-router.ts and
// server/db/initialize.ts), and the same literal is the fallback for a project
// whose package row predates the feature. Both reached the English UI verbatim.
// A title somebody actually typed is a proper noun and is returned untouched;
// only the untouched seeded default is translated. Mirrors
// `localizedPackageTitle` in server/api/pdf.ts, which solved this for the
// printed documents.
const SEEDED_PACKAGE_TITLE = "Lingkup Utama";

function localizedPackageTitle(value: unknown, language: "id" | "en") {
  const title = String(value ?? "").trim() || SEEDED_PACKAGE_TITLE;
  return title === SEEDED_PACKAGE_TITLE && language === "en"
    ? "Main Scope"
    : title;
}

async function handleQuotations(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
  if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
  await assertProjectAccess(user, projectId);
  const packageId = await resolveCommercialPackageId(
    client,
    projectId,
    searchParams.get("packageId"),
    { requireActive: request.method !== "GET" },
  );

  if (request.method === "GET") {
    const result = await client.execute({
      sql: `SELECT q.*,cp.title AS package_title FROM quotations q
        LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
        WHERE q.project_id=? AND q.package_id=? AND q.status<>'Superseded'
        ORDER BY q.revision_no DESC,q.created_at DESC LIMIT 1`,
      args: [projectId, packageId],
    });
    if (result.rows[0]) {
      return ok(
        await quotationResponse(client, result.rows[0], user.preferredLanguage),
      );
    }
    const boq = await getBoq(projectId, packageId);
    return ok({
      id: null,
      projectId,
      packageId,
      packageTitle: localizedPackageTitle(
        boq.package?.title,
        user.preferredLanguage,
      ),
      number: null,
      status: "Draft",
      revisionNo: 1,
      issuedAt: now().slice(0, 10),
      validUntil: null,
      total: boq.totals.selling,
      subtotal: boq.totals.selling,
      discountEnabled: false,
      discountType: "Nominal",
      discountValue: 0,
      discountAmount: 0,
      taxableBase: boq.totals.selling,
      taxEnabled: false,
      taxRevision: 0,
      taxes: [],
      taxAdditions: 0,
      taxWithholdings: 0,
      roundingMode: "None",
      roundingStep: 0,
      roundingAdjustment: 0,
      grandTotal: boq.totals.selling,
      grossTotal: boq.totals.selling,
      netCashDue: boq.totals.selling,
    });
  }

  if (request.method === "PATCH") {
    assertAccess(user, "billing", "manage");
    const input = quotationPatchSchema.parse(await jsonBody(request));
    const editsCommercial = [
      "issuedAt", "validUntil", "discountEnabled", "discountType",
      "discountValue", "roundingMode", "roundingStep", "roundingAdjustment",
      "roundingReason",
    ].some((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (editsCommercial && !["Admin", "Finance"].includes(user.role)) {
      throw new ApiError(
        403,
        "QUOTATION_COMMERCIAL_FORBIDDEN",
        "Hanya Admin dan Finance yang dapat mengubah tanggal, diskon, dan pembulatan Quotation.",
      );
    }
    const boq = await getBoq(projectId, packageId);
    if (!boq.items.length || boq.totals.selling <= 0) {
      throw new ApiError(409, "EMPTY_BOQ", "Tambahkan item BoQ pada paket ini terlebih dahulu.");
    }
    const ensured = await ensureBoq(projectId, packageId);
    const scope = await ensureExists(
      "SELECT id,status FROM boq_scopes WHERE id=? LIMIT 1",
      [ensured.scopeId],
      "Scope BoQ paket tidak ditemukan.",
    );
    if (String(scope.status) === "Accepted") {
      throw new ApiError(409, "ACCEPTED_QUOTATION_LOCKED", "Quotation yang diterima klien sudah dikunci. Buat Addendum baru.");
    }
    const currentResult = await client.execute({
      sql: `SELECT * FROM quotations WHERE project_id=? AND package_id=?
        AND scope_id=? AND status<>'Superseded'
        ORDER BY revision_no DESC,created_at DESC LIMIT 1`,
      args: [projectId, packageId, ensured.scopeId],
    });
    const current = currentResult.rows[0];
    const timestamp = now();
    let quotationId = current ? String(current.id) : "";
    const makeRevision = Boolean(
      current && String(current.status) === "Sent" &&
      !["Rejected", "Void"].includes(String(input.status ?? "")),
    );
    const requestedStatus = String(input.status ?? current?.status ?? "Draft");
    // One lifecycle rule for both writers. Without it this endpoint accepted
    // any enum value behind a lone "Accepted" guard, so PATCH {status:"Sent"}
    // resurrected a Void or Rejected quotation and re-notified the client.
    assertQuotationTransition(
      current ? String(current.status) : null,
      requestedStatus,
      { allowSameStatus: true },
    );
    // rounding_adjustment is dual-purpose: it stores the computed delta for the
    // Up/Down modes and the user-supplied value for Custom. When the mode
    // transitions to Custom without an explicit adjustment in the request, the
    // stale computed delta must never be inherited as a manual adjustment.
    const currentRoundingMode = current ? String(current.rounding_mode ?? "None") : "None";
    const nextRoundingMode = input.roundingMode ?? currentRoundingMode;
    const roundingAdjustmentValue =
      input.roundingAdjustment ??
      (nextRoundingMode === "Custom" && currentRoundingMode !== "Custom"
        ? 0
        : asNumber(current?.rounding_adjustment));
    if (nextRoundingMode === "Custom") {
      // "Pembulatan" must stay a rounding. Without a cap this field was an
      // unlimited price override that flowed straight into invoice snapshots.
      const currentTax = current
        ? await documentTaxSummary(
            client,
            "Quotation",
            String(current.id),
            asNumber(current.taxable_base) || boq.totals.selling,
          )
        : { taxAdditions: 0, taxWithholdings: 0 };
      const preliminary = calculateQuotationCommercialTotals({
        subtotal: boq.totals.selling,
        discountEnabled:
          input.discountEnabled === undefined
            ? Number(current?.discount_enabled) === 1
            : input.discountEnabled,
        discountType:
          (input.discountType ?? String(current?.discount_type)) === "Percent"
            ? "Percent"
            : "Nominal",
        discountValue: input.discountValue ?? asNumber(current?.discount_value),
        taxAdditions: currentTax.taxAdditions,
        taxWithholdings: currentTax.taxWithholdings,
      });
      const limit = customRoundingLimit(preliminary.beforeRounding);
      if (Math.abs(roundingAdjustmentValue) > limit) {
        throw new ApiError(
          422,
          "ROUNDING_ADJUSTMENT_TOO_LARGE",
          `Pembulatan khusus maksimal Rp ${limit.toLocaleString("id-ID")} untuk nilai ini. Gunakan kolom diskon atau pajak untuk perubahan harga yang lebih besar.`,
          { limit, requested: roundingAdjustmentValue },
        );
      }
    }
    if (requestedStatus === "Sent" && current && Number(current.tax_enabled) === 1) {
      const selectedTaxes = await client.execute({
        sql: "SELECT 1 FROM document_taxes WHERE document_type='Quotation' AND document_id=? LIMIT 1",
        args: [current.id],
      });
      if (!selectedTaxes.rows.length) {
        throw new ApiError(409, "TAX_RULE_REQUIRED", "Pilih minimal satu aturan pajak sebelum mengirim Quotation.");
      }
    }

    if (makeRevision && current) {
      const revisionNo = asNumber(current.revision_no) + 1;
      quotationId = randomUUID();
      assertDateOrder(
        input.issuedAt ?? current.issued_at,
        input.validUntil === undefined ? current.valid_until : input.validUntil,
        "Masa berlaku Quotation tidak boleh lebih awal dari tanggal terbit.",
      );
      await snapshotQuotationItems(client, String(current.id));
      await client.transaction(async (tx) => {
        await tx.execute({
          sql: "UPDATE quotations SET status='Superseded',updated_at=? WHERE id=?",
          args: [timestamp, current.id],
        });
        await tx.execute({
          sql: `INSERT INTO quotations
            (id,project_id,package_id,scope_id,number,status,issued_at,valid_until,
             total,revision_no,supersedes_id,discount_enabled,discount_type,
             discount_value,discount_amount,taxable_base,tax_enabled,tax_revision,
             rounding_mode,rounding_step,rounding_adjustment,rounding_reason,
             grand_total,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            quotationId, projectId, packageId, ensured.scopeId,
            `${String(current.number).replace(/-R\d+$/, "")}-R${revisionNo}`,
            input.status ?? "Draft",
            input.issuedAt ?? current.issued_at,
            input.validUntil === undefined ? current.valid_until : input.validUntil,
            boq.totals.selling, revisionNo, current.id,
            input.discountEnabled === undefined ? current.discount_enabled : input.discountEnabled ? 1 : 0,
            input.discountType ?? current.discount_type,
            input.discountValue ?? current.discount_value,
            0, 0, current.tax_enabled, asNumber(current.tax_revision) + 1,
            input.roundingMode ?? current.rounding_mode,
            input.roundingStep ?? current.rounding_step,
            roundingAdjustmentValue,
            input.roundingReason === undefined ? current.rounding_reason : input.roundingReason,
            0, timestamp, timestamp,
          ],
        });
        const oldTaxes = await tx.execute({
          sql: "SELECT * FROM document_taxes WHERE document_type='Quotation' AND document_id=?",
          args: [current.id],
        });
        for (const tax of oldTaxes.rows) {
          await tx.execute({
            sql: `INSERT INTO document_taxes
              (id,document_type,document_id,project_id,rule_id,rule_code,rule_name,
               rule_name_en,scope,effect,accounting_treatment,rate_bps,taxable_base,
               amount,locked,created_by,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
            args: [
              `document-tax-${randomUUID()}`, "Quotation", quotationId, projectId,
              tax.rule_id, tax.rule_code, tax.rule_name, tax.rule_name_en, tax.scope,
              tax.effect, tax.accounting_treatment, tax.rate_bps, 0, 0, user.id,
              timestamp, timestamp,
            ],
          });
        }
      });
      await writeAuditLog(client, request, user, "revise", "quotation", quotationId, {
        supersedesId: current.id,
        revisionNo,
      });
    } else if (current) {
      if (String(current.status) === "Accepted") {
        throw new ApiError(409, "ACCEPTED_QUOTATION_LOCKED", "Quotation yang diterima klien sudah dikunci.");
      }
      assertDateOrder(
        input.issuedAt ?? current.issued_at,
        input.validUntil === undefined ? current.valid_until : input.validUntil,
        "Masa berlaku Quotation tidak boleh lebih awal dari tanggal terbit.",
      );
      await client.execute({
        sql: `UPDATE quotations SET status=?,issued_at=?,valid_until=?,total=?,
          discount_enabled=?,discount_type=?,discount_value=?,rounding_mode=?,
          rounding_step=?,rounding_adjustment=?,rounding_reason=?,updated_at=? WHERE id=?`,
        args: [
          input.status ?? current.status,
          input.issuedAt ?? current.issued_at,
          input.validUntil === undefined ? current.valid_until : input.validUntil,
          boq.totals.selling,
          input.discountEnabled === undefined ? current.discount_enabled : input.discountEnabled ? 1 : 0,
          input.discountType ?? current.discount_type,
          input.discountValue ?? current.discount_value,
          input.roundingMode ?? current.rounding_mode,
          input.roundingStep ?? current.rounding_step,
          roundingAdjustmentValue,
          input.roundingReason === undefined ? current.rounding_reason : input.roundingReason,
          timestamp,
          quotationId,
        ],
      });
      await writeAuditLog(client, request, user, "update", "quotation", quotationId, input);
    } else {
      const sequence = await claimSequence(client, "quotations", "SELECT number AS value FROM quotations");
      quotationId = randomUUID();
      const issuedAt = input.issuedAt ?? timestamp.slice(0, 10);
      const validUntil = input.validUntil ?? new Date(
        new Date(`${issuedAt}T00:00:00.000Z`).getTime() + 14 * 86_400_000,
      ).toISOString().slice(0, 10);
      assertDateOrder(issuedAt, validUntil, "Masa berlaku Quotation tidak boleh lebih awal dari tanggal terbit.");
      // Never hardcode revision_no=1: a scope can still carry Superseded
      // revisions (legacy data from the old delete path), and inserting a
      // duplicate revision number would violate
      // UNIQUE(scope_id,revision_no) and surface as a raw 500.
      const maxRevision = await client.execute({
        sql: "SELECT COALESCE(MAX(revision_no),0) AS max_revision FROM quotations WHERE scope_id=?",
        args: [ensured.scopeId],
      });
      const revisionNo = asNumber(maxRevision.rows[0]?.max_revision) + 1;
      await client.execute({
        sql: `INSERT INTO quotations
          (id,project_id,package_id,scope_id,number,status,issued_at,valid_until,
           total,revision_no,discount_enabled,discount_type,discount_value,
           discount_amount,taxable_base,rounding_mode,rounding_step,
           rounding_adjustment,rounding_reason,grand_total,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          quotationId, projectId, packageId, ensured.scopeId,
          makeSequence("QUO", sequence),
          input.status ?? "Draft", issuedAt, validUntil, boq.totals.selling, revisionNo,
          input.discountEnabled ? 1 : 0, input.discountType ?? "Nominal",
          input.discountValue ?? 0, 0, boq.totals.selling,
          input.roundingMode ?? "None", input.roundingStep ?? 0,
          input.roundingAdjustment ?? 0, input.roundingReason ?? null,
          boq.totals.selling, timestamp, timestamp,
        ],
      });
      await writeAuditLog(client, request, user, "create", "quotation", quotationId, {
        projectId,
        packageId,
      });
    }

    let response = await refreshQuotationCommercialSnapshot(
      client,
      quotationId,
      user.preferredLanguage,
    );
    if (response.status === "Sent" && response.taxEnabled && !response.taxes.length) {
      throw new ApiError(409, "TAX_RULE_REQUIRED", "Pilih minimal satu aturan pajak sebelum mengirim Quotation.");
    }
    await client.execute({
      sql: "UPDATE boq_scopes SET status=?,updated_at=? WHERE id=?",
      args: [response.status, timestamp, ensured.scopeId],
    });
    if (response.status === "Sent") {
      await snapshotQuotationItems(client, quotationId);
      const lockedTaxes = await lockDocumentTaxes(client, "Quotation", quotationId);
      // The response was assembled before the lock — reflect the real state.
      response = { ...response, taxes: lockedTaxes };
      await notifyProjectStakeholders(client, {
        projectId,
        eventType: "quotation_sent",
        subject: `Quotation ${response.number} siap dikirim`,
        message: `quotation ${response.number} sebesar Rp ${response.grandTotal.toLocaleString("id-ID")} telah ditandai terkirim.`,
        subjectEn: `Quotation ${response.number} is ready`,
        messageEn: `quotation ${response.number} for IDR ${response.grandTotal.toLocaleString("en-US")} has been marked as sent.`,
        includeFinance: true,
      });
    }
    return ok(response);
  }

  if (request.method === "DELETE") {
    assertAccess(user, "billing", "manage");
    const result = await client.execute({
      sql: `SELECT id,status,scope_id FROM quotations WHERE project_id=? AND package_id=?
        AND status<>'Superseded' ORDER BY revision_no DESC,created_at DESC LIMIT 1`,
      args: [projectId, packageId],
    });
    const currentRow = result.rows[0];
    if (!currentRow) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
    const quotationId = String(currentRow.id);
    if (String(currentRow.status) === "Accepted") {
      throw new ApiError(409, "ACCEPTED_QUOTATION_LOCKED", "Quotation yang diterima klien tidak dapat dihapus.");
    }
    const invoiceUsage = await client.execute({
      sql: "SELECT id FROM invoices WHERE quotation_id=? LIMIT 1",
      args: [quotationId],
    });
    if (invoiceUsage.rows.length) {
      throw new ApiError(409, "QUOTATION_IN_USE", "Quotation tidak dapat dihapus karena sudah memiliki Invoice.");
    }
    // SQLite does not enforce the spks/spk_items RESTRICT foreign keys here, so
    // deleting a referenced quotation would silently orphan procurement
    // documents (or crash where FKs are enforced). Refuse with a clear 409.
    const procurementUsage = await client.execute({
      sql: `SELECT id FROM spks WHERE quotation_id=?
        UNION SELECT spk_id FROM spk_items WHERE quotation_id=? LIMIT 1`,
      args: [quotationId, quotationId],
    });
    if (procurementUsage.rows.length) {
      throw new ApiError(
        409,
        "QUOTATION_IN_USE_PROCUREMENT",
        "Quotation tidak dapat dihapus karena sudah dirujuk dokumen procurement (SPK/PO). Hapus atau lepaskan dokumen tersebut terlebih dahulu.",
      );
    }
    const scopeId = currentRow.scope_id ? String(currentRow.scope_id) : null;
    const timestamp = now();
    await client.batch([
      { sql: "DELETE FROM document_taxes WHERE document_type='Quotation' AND document_id=?", args: [quotationId] },
      { sql: "DELETE FROM quotation_items WHERE quotation_id=?", args: [quotationId] },
      { sql: "DELETE FROM quotations WHERE id=?", args: [quotationId] },
    ], "write");
    let promotedId: string | null = null;
    if (scopeId) {
      // Deleting the active revision must not strand the Superseded history:
      // the previous revision becomes the active document again as an
      // editable Draft. Otherwise the next save would insert revision_no=1
      // next to the orphaned Superseded revision and explode on
      // UNIQUE(scope_id,revision_no) with a raw 500.
      const previous = await client.execute({
        sql: `SELECT id FROM quotations WHERE scope_id=? AND status='Superseded'
          ORDER BY revision_no DESC,created_at DESC LIMIT 1`,
        args: [scopeId],
      });
      if (previous.rows[0]) {
        promotedId = String(previous.rows[0].id);
        await client.batch([
          {
            sql: `UPDATE quotations SET status='Draft',accepted_at=NULL,
              acceptance_attachment_name=NULL,acceptance_attachment_mime_type=NULL,
              acceptance_attachment_content_base64=NULL,updated_at=? WHERE id=?`,
            args: [timestamp, promotedId],
          },
          {
            sql: `UPDATE document_taxes SET locked=0,locked_at=NULL,updated_at=?
              WHERE document_type='Quotation' AND document_id=?`,
            args: [timestamp, promotedId],
          },
        ], "write");
        await refreshQuotationCommercialSnapshot(client, promotedId);
      }
      await client.execute({
        sql: "UPDATE boq_scopes SET status='Draft',updated_at=? WHERE id=? AND status<>'Accepted'",
        args: [timestamp, scopeId],
      });
    }
    await syncCommercialValues(client, projectId, { request, user });
    await writeAuditLog(client, request, user, "delete", "quotation", quotationId, {
      projectId,
      packageId,
      promotedRevisionId: promotedId,
    });
    return noContent();
  }

  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

async function handleQuotationHistory(request: Request, user: AuthUser) {
  if (request.method !== "GET") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  const { client } = await getDatabase();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
  if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
  await assertProjectAccess(user, projectId);
  const packageId = await resolveCommercialPackageId(client, projectId, searchParams.get("packageId"));
  const result = await client.execute({
    sql: `SELECT id,number,revision_no,status,total,grand_total,issued_at,
      created_at,supersedes_id
      FROM quotations WHERE project_id=? AND package_id=?
      ORDER BY revision_no DESC,created_at DESC`,
    args: [projectId, packageId],
  });
  return ok(result.rows.map((row) => ({
    id: String(row.id),
    number: String(row.number),
    revisionNo: asNumber(row.revision_no) || 1,
    status: String(row.status),
    total: asNumber(row.total),
    grandTotal: asNumber(row.grand_total) || asNumber(row.total),
    issuedAt: String(row.issued_at),
    createdAt: String(row.created_at),
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
  })));
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
    packageId: row.package_id ? String(row.package_id) : null,
    packageTitle: row.package_title ? String(row.package_title) : null,
    quotationId: row.quotation_id ? String(row.quotation_id) : null,
    quotationNumber: row.quotation_number ? String(row.quotation_number) : null,
    calculationMode: String(row.calculation_mode ?? "LegacyBase"),
    installmentBps: row.installment_bps == null ? null : asNumber(row.installment_bps),
    installmentPercent: row.installment_bps == null ? null : asNumber(row.installment_bps) / 100,
    contractGrandTotal: asNumber(row.contract_grand_total),
    subtotalSnapshot: asNumber(row.subtotal_snapshot),
    discountSnapshot: asNumber(row.discount_snapshot),
    taxableBaseSnapshot: asNumber(row.taxable_base_snapshot),
    taxAdditionsSnapshot: asNumber(row.tax_additions_snapshot),
    taxWithholdingsSnapshot: asNumber(row.tax_withholdings_snapshot),
    roundingSnapshot: asNumber(row.rounding_snapshot),
    status: String(row.status),
    paidDate: row.paid_date ? formatDate(row.paid_date) : undefined,
    paidDateIso: row.paid_date ? String(row.paid_date) : undefined,
  };
}

async function getInvoice(client: Awaited<ReturnType<typeof getDatabase>>["client"], id: string) {
  const result = await client.execute({
    sql: `SELECT i.*,p.name AS project_name,cp.title AS package_title,
      q.number AS quotation_number
      FROM invoices i JOIN projects p ON p.id=i.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=i.package_id
      LEFT JOIN quotations q ON q.id=i.quotation_id
      WHERE i.id=? LIMIT 1`,
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  const row = result.rows[0] as Record<string, unknown>;
  const allocated = String(row.calculation_mode) === "Percent" &&
    asNumber(row.contract_grand_total) > 0;
  const taxBase = allocated
    ? asNumber(row.taxable_base_snapshot)
    : asNumber(row.amount);
  const [tax, payments] = await Promise.all([
    documentTaxSummary(client, "Invoice", id, taxBase),
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
      : paidGross >= (allocated ? asNumber(row.amount) : tax.grossTotal)
        ? "Lunas"
        : "Dibayar Sebagian";
  return {
    ...mapInvoice(row),
    status,
    ...tax,
    grossTotal: allocated ? asNumber(row.amount) : tax.grossTotal,
    netCashDue: allocated
      ? Math.max(0, asNumber(row.amount) - tax.taxWithholdings)
      : tax.netCashDue,
    contractValue: asNumber(row.contract_grand_total),
    prepayment: paidGross,
    balanceDue: Math.max(
      0,
      (allocated ? asNumber(row.amount) : tax.grossTotal) - paidGross,
    ),
    paidGross,
    paidCash,
    withheldTax,
    outstanding: Math.max(
      0,
      (allocated ? asNumber(row.amount) : tax.grossTotal) - paidGross,
    ),
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
    sql: `SELECT CASE WHEN grand_total>0 THEN grand_total ELSE total END AS total
      FROM quotations WHERE project_id=? AND status<>'Superseded'
      ORDER BY CASE status WHEN 'Accepted' THEN 0 ELSE 1 END,created_at DESC LIMIT 1`,
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

async function invoiceQuotationSource(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  input: { projectId: string; packageId?: string; quotationId?: string },
  requireAccepted: boolean,
) {
  const packageId = await resolveCommercialPackageId(
    client,
    input.projectId,
    input.packageId ?? null,
    { requireActive: true },
  );
  const result = await client.execute({
    sql: input.quotationId
      ? `SELECT q.*,cp.title AS package_title FROM quotations q
        LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
        WHERE q.id=? AND q.project_id=? LIMIT 1`
      : `SELECT q.*,cp.title AS package_title FROM quotations q
        LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
        WHERE q.project_id=? AND q.package_id=? AND q.status<>'Superseded'
        ORDER BY CASE q.status WHEN 'Accepted' THEN 0 WHEN 'Sent' THEN 1 ELSE 2 END,
          q.revision_no DESC,q.created_at DESC LIMIT 1`,
    args: input.quotationId
      ? [input.quotationId, input.projectId]
      : [input.projectId, packageId],
  });
  const row = result.rows[0];
  if (!row) {
    if (requireAccepted) {
      throw new ApiError(409, "ACCEPTED_QUOTATION_REQUIRED", "Terima Quotation paket terlebih dahulu sebelum membuat termin Invoice.");
    }
    return { packageId, quotation: null };
  }
  if (input.packageId && String(row.package_id) !== packageId) {
    throw new ApiError(422, "PACKAGE_QUOTATION_MISMATCH", "Quotation tidak termasuk dalam paket yang dipilih.");
  }
  if (requireAccepted && String(row.status) !== "Accepted") {
    throw new ApiError(409, "ACCEPTED_QUOTATION_REQUIRED", "Invoice termin hanya dapat dibuat dari Quotation yang sudah diterima klien.");
  }
  return { packageId: String(row.package_id ?? packageId), quotation: row };
}

async function invoiceAllocationForQuotation(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  quotation: Record<string, unknown>,
  installmentBps: number,
  excludeInvoiceId?: string,
) {
  const previousResult = await client.execute({
    sql: `SELECT COALESCE(SUM(installment_bps),0) AS installment_bps,
      COALESCE(SUM(subtotal_snapshot),0) AS subtotal,
      COALESCE(SUM(discount_snapshot),0) AS discount_amount,
      COALESCE(SUM(taxable_base_snapshot),0) AS taxable_base,
      COALESCE(SUM(tax_additions_snapshot),0) AS tax_additions,
      COALESCE(SUM(tax_withholdings_snapshot),0) AS tax_withholdings,
      COALESCE(SUM(rounding_snapshot),0) AS rounding_adjustment,
      COALESCE(SUM(amount),0) AS grand_total
      FROM invoices WHERE quotation_id=?${excludeInvoiceId ? " AND id<>?" : ""}`,
    args: excludeInvoiceId
      ? [quotation.id, excludeInvoiceId]
      : [quotation.id],
  });
  const previous = previousResult.rows[0] ?? {};
  const committedBps = asNumber(previous.installment_bps);
  if (committedBps + installmentBps > 10_000) {
    throw new ApiError(
      409,
      "INVOICE_PERCENT_EXCEEDED",
      `Akumulasi termin melebihi 100%. Sisa termin adalah ${(Math.max(0, 10_000 - committedBps) / 100).toLocaleString("id-ID")}% .`,
    );
  }
  const allocation = calculateInvoiceAllocation(
    {
      subtotal: asNumber(quotation.total),
      discountAmount: asNumber(quotation.discount_amount),
      taxableBase: asNumber(quotation.taxable_base),
      taxAdditions: asNumber(quotation.tax_additions_snapshot),
      taxWithholdings: asNumber(quotation.tax_withholdings_snapshot),
      roundingAdjustment: asNumber(quotation.rounding_adjustment),
      grandTotal: asNumber(quotation.grand_total) || asNumber(quotation.total),
    },
    installmentBps,
    {
      installmentBps: committedBps,
      subtotal: asNumber(previous.subtotal),
      discountAmount: asNumber(previous.discount_amount),
      taxableBase: asNumber(previous.taxable_base),
      taxAdditions: asNumber(previous.tax_additions),
      taxWithholdings: asNumber(previous.tax_withholdings),
      roundingAdjustment: asNumber(previous.rounding_adjustment),
      grandTotal: asNumber(previous.grand_total),
    },
  );
  return { allocation, previous };
}

async function copyQuotationTaxAllocation(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  invoiceId: string,
  projectId: string,
  quotationId: string,
  installmentBps: number,
  taxableBase: number,
  userId: string,
) {
  const quotationTaxes = await client.execute({
    sql: `SELECT dt.* FROM document_taxes dt
      WHERE dt.document_type='Quotation' AND dt.document_id=?
      ORDER BY dt.created_at,dt.id`,
    args: [quotationId],
  });
  const timestamp = now();
  for (const tax of quotationTaxes.rows) {
    const previouslyAllocated = await client.execute({
      sql: `SELECT COALESCE(SUM(dt.amount),0) AS total
        FROM document_taxes dt JOIN invoices i ON i.id=dt.document_id
        WHERE dt.document_type='Invoice' AND i.quotation_id=?
          AND dt.rule_code=? AND i.id<>?`,
      args: [quotationId, tax.rule_code, invoiceId],
    });
    const used = asNumber(previouslyAllocated.rows[0]?.total);
    const quoteAmount = asNumber(tax.amount);
    const totalBps = await client.execute({
      sql: "SELECT COALESCE(SUM(installment_bps),0) AS total FROM invoices WHERE quotation_id=? AND id<>?",
      args: [quotationId, invoiceId],
    });
    const isFinal = asNumber(totalBps.rows[0]?.total) + installmentBps === 10_000;
    const allocatedAmount = isFinal
      ? Math.max(0, quoteAmount - used)
      : Math.round((quoteAmount * installmentBps) / 10_000);
    await client.execute({
      sql: `INSERT INTO document_taxes
        (id,document_type,document_id,project_id,rule_id,rule_code,rule_name,
         rule_name_en,scope,effect,accounting_treatment,rate_bps,taxable_base,
         amount,locked,created_by,created_at,updated_at)
        VALUES (?,'Invoice',?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      args: [
        `document-tax-${randomUUID()}`, invoiceId, projectId, tax.rule_id,
        tax.rule_code, tax.rule_name, tax.rule_name_en, tax.scope, tax.effect,
        tax.accounting_treatment, tax.rate_bps, taxableBase, allocatedAmount,
        userId, timestamp, timestamp,
      ],
    });
  }
}

async function handleInvoices(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const invoiceId = path[1];
  const action = path[2];

  if (request.method === "GET" && !invoiceId) {
    const searchParams = new URL(request.url).searchParams;
    const projectId = searchParams.get("projectId");
    const packageId = searchParams.get("packageId");
    if (projectId) await assertProjectAccess(user, projectId);
    const scope = projectScopeCondition(user, "p");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      conditions.push("i.project_id=?");
      args.push(projectId);
    }
    if (packageId) {
      conditions.push("i.package_id=?");
      args.push(packageId);
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
    const percentMode = input.calculationMode === "Percent" ||
      input.installmentPercent !== undefined || input.installmentBps !== undefined;
    const source = await invoiceQuotationSource(
      client,
      input,
      percentMode || Boolean(input.quotationId),
    );
    const installmentBps = input.installmentBps ??
      (input.installmentPercent !== undefined
        ? Math.round(input.installmentPercent * 100)
        : null);
    const allocation = percentMode && source.quotation && installmentBps
      ? (await invoiceAllocationForQuotation(client, source.quotation, installmentBps)).allocation
      : null;
    const legacyAmount = input.amount ?? 0;
    if (!allocation) {
      await assertInvoiceAmountWithinQuotation(client, input.projectId, legacyAmount);
    }
    const sequence = await claimSequence(client, "invoices", "SELECT number AS value FROM invoices");
    const id = randomUUID();
    const timestamp = now();
    const number = makeSequence("INV", sequence);
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO invoices
          (id,project_id,package_id,quotation_id,number,type,issue_date,due_date,
           amount,calculation_mode,installment_bps,contract_grand_total,
           subtotal_snapshot,discount_snapshot,taxable_base_snapshot,
           tax_additions_snapshot,tax_withholdings_snapshot,rounding_snapshot,
           status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          id, input.projectId, source.packageId, source.quotation?.id ?? null,
          number, input.type, input.issueDate, input.dueDate,
          allocation?.amount ?? legacyAmount,
          allocation ? "Percent" : "LegacyBase",
          allocation?.installmentBps ?? null,
          source.quotation
            ? asNumber(source.quotation.grand_total) || asNumber(source.quotation.total)
            : 0,
          allocation?.subtotalSnapshot ?? 0,
          allocation?.discountSnapshot ?? 0,
          allocation?.taxableBaseSnapshot ?? 0,
          allocation?.taxAdditionsSnapshot ?? 0,
          allocation?.taxWithholdingsSnapshot ?? 0,
          allocation?.roundingSnapshot ?? 0,
          "Belum Lunas", timestamp, timestamp,
        ],
      });
      if (allocation && source.quotation && installmentBps) {
        await copyQuotationTaxAllocation(
          tx,
          id,
          input.projectId,
          String(source.quotation.id),
          installmentBps,
          allocation.taxableBaseSnapshot,
          user.id,
        );
      } else if (source.quotation) {
        const quotationTaxes = await tx.execute({
          sql: `SELECT dt.* FROM document_taxes dt
            WHERE dt.document_type='Quotation' AND dt.document_id=?
            ORDER BY dt.created_at`,
          args: [source.quotation.id],
        });
        for (const tax of quotationTaxes.rows) {
          const rateBps = asNumber(tax.rate_bps);
          await tx.execute({
            sql: `INSERT INTO document_taxes
              (id,document_type,document_id,project_id,rule_id,rule_code,rule_name,
               rule_name_en,scope,effect,accounting_treatment,rate_bps,taxable_base,
               amount,locked,created_by,created_at,updated_at)
              VALUES (?,'Invoice',?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
            args: [
              `document-tax-${randomUUID()}`, id, input.projectId, tax.rule_id,
              tax.rule_code, tax.rule_name, tax.rule_name_en, tax.scope, tax.effect,
              tax.accounting_treatment, rateBps, legacyAmount,
              calculateTaxAmount(legacyAmount, rateBps), user.id, timestamp, timestamp,
            ],
          });
        }
      }
    });
    if (allocation && source.quotation) {
      await lockDocumentTaxes(client, "Invoice", id, input.dueDate);
    }
    await writeAuditLog(client, request, user, "create", "invoice", id, input);
    await notifyProjectStakeholders(client, {
      projectId: input.projectId,
      eventType: "invoice_created",
      subject: `Invoice ${number} diterbitkan`,
      message: `invoice ${number} sebesar Rp ${(allocation?.amount ?? legacyAmount).toLocaleString("id-ID")} telah diterbitkan dengan jatuh tempo ${input.dueDate}.`,
      subjectEn: `Invoice ${number} issued`,
      messageEn: `invoice ${number} for IDR ${(allocation?.amount ?? legacyAmount).toLocaleString("en-US")} was issued with a due date of ${input.dueDate}.`,
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
             category,origin,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,'system',?,?,?)`,
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
    const scopeCheck = await client.execute({
      sql: `SELECT i.project_id FROM invoice_payments pay
        JOIN invoices i ON i.id=pay.invoice_id
        WHERE pay.id=? AND pay.invoice_id=? LIMIT 1`,
      args: [paymentId, invoiceId],
    });
    if (!scopeCheck.rows[0]) {
      throw new ApiError(404, "NOT_FOUND", "Pembayaran aktif tidak ditemukan.");
    }
    await assertProjectAccess(user, String(scopeCheck.rows[0].project_id));
    const timestamp = now();
    await client.transaction(async (tx) => {
      // The payment row and the reconciliation guard are read inside the write
      // transaction. Outside it, only SQLite's serialised writers stopped a
      // reconciliation committed in between from surviving the void; on
      // PostgreSQL it would leave a matched bank line on reversed cash.
      const paymentResult = await tx.execute({
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
      if (payment.transaction_id) {
        const reconciled = await tx.execute({
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
      await tx.execute({
        sql: `UPDATE invoice_payments SET status='Void',voided_by=?,voided_at=?,
          void_reason=?,updated_at=? WHERE id=?`,
        args: [user.id, timestamp, input.reason, timestamp, paymentId],
      });
      if (asNumber(payment.cash_amount) > 0) {
        await tx.execute({
          sql: `INSERT INTO transactions
            (id,project_id,date,type,description,amount,source,reference_id,
             category,origin,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,'system',?,?,?)`,
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
      const invoiceAfterVoid = await getInvoice(tx, invoiceId);
      const paidGross = asNumber(remaining.rows[0]?.total);
      await tx.execute({
        sql: "UPDATE invoices SET status=?,paid_date=?,updated_at=? WHERE id=?",
        args: [
          paidGross >= invoiceAfterVoid.grossTotal ? "Lunas" : "Belum Lunas",
          paidGross >= invoiceAfterVoid.grossTotal
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

  // The legacy singular /payment endpoint is retired.
  //
  // It marked an invoice Lunas by fabricating an `invoice_payments` row with a
  // `LEGACY-` reference and a hardcoded 27-byte `text/plain` stub as its
  // "attachment", which is exactly the evidence requirement the real endpoint
  // exists to enforce: POST /api/invoices/:id/payments demands a reference, a
  // method, an amount that fits the outstanding balance and a genuine PDF or
  // image proof, and its void counterpart books a reversal. Nothing in the app
  // called this route; the billing view has used /payments and
  // /payments/:id/void throughout. Kept reachable as a friendly 410 rather than
  // a 404 so any old client learns why, mirroring the retired /api/spks writes.
  if (
    invoiceId &&
    action === "payment" &&
    ["POST", "PATCH"].includes(request.method)
  ) {
    throw new ApiError(
      410,
      "LEGACY_INVOICE_PAYMENT_RETIRED",
      "Endpoint konfirmasi pembayaran lama sudah tidak berlaku. Catat pembayaran melalui histori pembayaran invoice agar referensi, metode, dan bukti pembayarannya lengkap.",
    );
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
    // Percent invoices lock their tax snapshot at creation, so "any locked
    // tax" used to make every freshly issued invoice uneditable. The real
    // business boundary is the same one deletion uses: payment history, or
    // tax obligations that are already settled/reported.
    //
    // Only ACTIVE (Posted) payments lock the invoice. Voiding a payment is the
    // documented way to correct a mistake — matching every payment row
    // regardless of status left the invoice permanently frozen after a void,
    // with no way back.
    const locked = await client.execute({
      sql: `SELECT
        EXISTS(SELECT 1 FROM invoice_payments WHERE invoice_id=? AND status='Posted') AS has_payment,
        EXISTS(
          SELECT 1 FROM tax_obligations o
          JOIN document_taxes dt ON dt.id=o.document_tax_id
          WHERE dt.document_type='Invoice' AND dt.document_id=?
            AND (
              o.settled_amount>0
              OR o.status<>'Outstanding'
              OR o.reporting_status NOT IN ('Candidate','Void')
              OR EXISTS(SELECT 1 FROM tax_settlements s WHERE s.obligation_id=o.id)
            )
        ) AS tax_committed`,
      args: [invoiceId, invoiceId],
    });
    if (
      Number(locked.rows[0]?.has_payment) === 1 ||
      locked.rows[0]?.has_payment === true
    ) {
      throw new ApiError(
        409,
        "INVOICE_LOCKED",
        "Invoice yang sudah memiliki histori pembayaran tidak dapat diedit. Void pembayaran terlebih dahulu.",
      );
    }
    if (
      Number(locked.rows[0]?.tax_committed) === 1 ||
      locked.rows[0]?.tax_committed === true
    ) {
      throw new ApiError(
        409,
        "INVOICE_TAX_COMMITTED",
        "Invoice dengan kewajiban pajak yang sudah disetor atau dilaporkan tidak dapat diedit.",
      );
    }
    assertDateOrder(
      input.issueDate ?? current.issue_date,
      input.dueDate ?? current.due_date,
      "Jatuh tempo Invoice tidak boleh lebih awal dari tanggal terbit.",
    );
    const percentMode = String(current.calculation_mode) === "Percent";
    const requestedBps = input.installmentBps ??
      (input.installmentPercent !== undefined
        ? Math.round(input.installmentPercent * 100)
        : asNumber(current.installment_bps));
    let allocation: Awaited<ReturnType<typeof invoiceAllocationForQuotation>>["allocation"] | null = null;
    let quotation: Record<string, unknown> | null = null;
    if (percentMode) {
      const quotationResult = await client.execute({
        sql: "SELECT * FROM quotations WHERE id=? AND project_id=? LIMIT 1",
        args: [current.quotation_id, current.project_id],
      });
      quotation = quotationResult.rows[0] ?? null;
      if (!quotation || String(quotation.status) !== "Accepted") {
        throw new ApiError(409, "ACCEPTED_QUOTATION_REQUIRED", "Quotation sumber Invoice tidak tersedia atau belum diterima.");
      }
      allocation = (await invoiceAllocationForQuotation(
        client,
        quotation,
        requestedBps,
        invoiceId,
      )).allocation;
    } else {
      await assertInvoiceAmountWithinQuotation(
        client,
        String(current.project_id),
        input.amount ?? asNumber(current.amount),
        invoiceId,
      );
    }
    const timestamp = now();
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `UPDATE invoices SET type=?,issue_date=?,due_date=?,amount=?,
          installment_bps=?,contract_grand_total=?,subtotal_snapshot=?,
          discount_snapshot=?,taxable_base_snapshot=?,tax_additions_snapshot=?,
          tax_withholdings_snapshot=?,rounding_snapshot=?,updated_at=? WHERE id=?`,
        args: [
          input.type ?? current.type,
          input.issueDate ?? current.issue_date,
          input.dueDate ?? current.due_date,
          allocation?.amount ?? input.amount ?? current.amount,
          allocation?.installmentBps ?? current.installment_bps,
          quotation
            ? asNumber(quotation.grand_total) || asNumber(quotation.total)
            : current.contract_grand_total,
          allocation?.subtotalSnapshot ?? current.subtotal_snapshot,
          allocation?.discountSnapshot ?? current.discount_snapshot,
          allocation?.taxableBaseSnapshot ?? current.taxable_base_snapshot,
          allocation?.taxAdditionsSnapshot ?? current.tax_additions_snapshot,
          allocation?.taxWithholdingsSnapshot ?? current.tax_withholdings_snapshot,
          allocation?.roundingSnapshot ?? current.rounding_snapshot,
          timestamp,
          invoiceId,
        ],
      });
      if (allocation && quotation) {
        // Rebuild the allocation from scratch: the existing rows are locked
        // copies from creation time, so a partial `locked=0` delete would
        // duplicate every tax line. Candidate obligations are recreated when
        // the refreshed snapshot is locked again below.
        await tx.execute({
          sql: `DELETE FROM tax_obligations WHERE document_tax_id IN (
            SELECT id FROM document_taxes
            WHERE document_type='Invoice' AND document_id=?)`,
          args: [invoiceId],
        });
        await tx.execute({
          sql: "DELETE FROM document_taxes WHERE document_type='Invoice' AND document_id=?",
          args: [invoiceId],
        });
        await copyQuotationTaxAllocation(
          tx,
          invoiceId,
          String(current.project_id),
          String(quotation.id),
          allocation.installmentBps,
          allocation.taxableBaseSnapshot,
          user.id,
        );
      }
    });
    if (allocation && quotation) {
      await lockDocumentTaxes(
        client,
        "Invoice",
        invoiceId,
        String(input.dueDate ?? current.due_date),
      );
    }
    await writeAuditLog(client, request, user, "update", "invoice", invoiceId, input);
    return ok(await getInvoice(client, invoiceId));
  }

  if (invoiceId && !action && request.method === "DELETE") {
    if (!mutationRoles("invoices").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus invoice.");
    const invoice = await ensureExists("SELECT project_id,status FROM invoices WHERE id=?", [invoiceId], "Invoice tidak ditemukan.");
    await assertProjectAccess(user, String(invoice.project_id));
    // Mirrors the edit guard: a voided payment is a cancelled one and must not
    // keep the invoice undeletable forever.
    const history = await client.execute({
      sql: `SELECT
        EXISTS(SELECT 1 FROM invoice_payments WHERE invoice_id=? AND status='Posted') AS has_payment,
        EXISTS(
          SELECT 1 FROM tax_obligations o
          JOIN document_taxes dt ON dt.id=o.document_tax_id
          WHERE dt.document_type='Invoice' AND dt.document_id=?
            AND (
              o.settled_amount>0
              OR o.status<>'Outstanding'
              OR o.reporting_status NOT IN ('Candidate','Void')
              OR EXISTS(SELECT 1 FROM tax_settlements s WHERE s.obligation_id=o.id)
            )
        ) AS tax_committed`,
      args: [invoiceId, invoiceId],
    });
    if (
      Number(history.rows[0]?.has_payment) === 1 ||
      history.rows[0]?.has_payment === true
    ) {
      throw new ApiError(
        409,
        "INVOICE_HISTORY_EXISTS",
        "Invoice dengan histori pembayaran tidak dapat dihapus. Gunakan void pada pembayaran.",
      );
    }
    if (
      Number(history.rows[0]?.tax_committed) === 1 ||
      history.rows[0]?.tax_committed === true
    ) {
      throw new ApiError(
        409,
        "INVOICE_TAX_COMMITTED",
        "Invoice dengan kewajiban pajak yang sudah disetor atau dilaporkan tidak dapat dihapus.",
      );
    }
    await detachOrDeleteSystemTransaction(client, "Invoice", invoiceId);
    // Only voided payments can still be attached at this point (the guard above
    // refuses while a Posted payment exists). They and their cash trail must go
    // with the invoice — invoice_payments.invoice_id is ON DELETE RESTRICT, so
    // leaving them behind would strand rows pointing at a deleted invoice.
    const voidedPayments = await client.execute({
      sql: "SELECT id FROM invoice_payments WHERE invoice_id=?",
      args: [invoiceId],
    });
    for (const row of voidedPayments.rows) {
      const paymentId = String(row.id);
      await detachOrDeleteSystemTransaction(client, "Invoice Payment", paymentId);
      await detachOrDeleteSystemTransaction(client, "Invoice Payment Reversal", paymentId);
    }
    await client.batch([
      { sql: "DELETE FROM invoice_payments WHERE invoice_id=?", args: [invoiceId] },
      {
        sql: `DELETE FROM tax_obligations WHERE document_tax_id IN (
          SELECT id FROM document_taxes
          WHERE document_type='Invoice' AND document_id=?)`,
        args: [invoiceId],
      },
      {
        sql: "DELETE FROM document_taxes WHERE document_type='Invoice' AND document_id=?",
        args: [invoiceId],
      },
      { sql: "DELETE FROM invoices WHERE id=?", args: [invoiceId] },
    ], "write");
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
    const input = partialPatchSchema(vendorSchema).parse(await jsonBody(request));
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

// The legacy /api/spks surface is read-only. Its mutation handlers used to post
// a `source='SPK'` outflow of the entire contract value whenever
// `spks.payment_status` read 'Dibayar' — a flag the modern procurement flow also
// sets once every spk_payment is posted — so marking a work order "Selesai"
// after paying it through /api/procurement-orders booked the same money twice,
// and voiding the real payment left the phantom outflow behind. Creating,
// editing, paying, and deleting a work order all live in
// /api/procurement-orders, where approval, verification, payment evidence, and
// the audit trail are complete.
async function handleSpks(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const spkId = path[1];
  const action = path[2];

  if (request.method !== "GET") {
    throw new ApiError(
      410,
      "LEGACY_ENDPOINT_READ_ONLY",
      "Endpoint SPK lama hanya dapat dibaca. Gunakan /api/procurement-orders agar approval, verifikasi, bukti pembayaran, dan audit tetap lengkap.",
    );
  }

  if (!spkId) {
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

  if (action === "pdf") {
    const spk = await ensureExists("SELECT project_id,status,number FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    await assertProjectAccess(user, String(spk.project_id));
    return renderBusinessPdf("spk", spkId, user.preferredLanguage);
  }

  if (!action) {
    const spk = await ensureExists("SELECT project_id FROM spks WHERE id=?", [spkId], "SPK tidak ditemukan.");
    await assertProjectAccess(user, String(spk.project_id));
    return ok(await getSpk(spkId));
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint SPK tidak ditemukan.");
}

type ValidationRow = Record<string, unknown>;

async function validationBoqItems(projectId: string, packageId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT i.id,i.category,i.description,i.quantity,i.unit,i.sort_order
      FROM boq_items i
      JOIN boqs b ON b.id=i.boq_id
      JOIN boq_scopes s ON s.id=i.scope_id
      WHERE b.project_id=? AND s.package_id=?
        AND i.category IN ('Perangkat','Material')
      ORDER BY i.sort_order,i.created_at
    `,
    args: [projectId, packageId],
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
    packageId: row.package_id ? String(row.package_id) : null,
    packageTitle: row.package_title ? String(row.package_title) : null,
    deliveryCycle: asNumber(row.delivery_cycle) || 1,
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

async function readValidation(projectId: string, packageId: string, deliveryCycle = 1) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT v.*,p.name AS project_name,p.client AS project_client,p.location AS project_location,
        cp.title AS package_title,
        u.name AS validator_name
      FROM project_validations v
      JOIN projects p ON p.id=v.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=v.package_id
      LEFT JOIN users u ON u.id=v.validated_by
      WHERE v.project_id=? AND v.package_id=? AND v.delivery_cycle=? LIMIT 1
    `,
    args: [projectId, packageId, deliveryCycle],
  });
  const validation = result.rows[0];
  if (!validation) {
    const project = await ensureExists(
      "SELECT id AS project_id,name AS project_name,client AS project_client,location AS project_location FROM projects WHERE id=?",
      [projectId],
      "Proyek tidak ditemukan.",
    );
    const packageRow = await ensureExists(
      "SELECT title AS package_title FROM project_commercial_packages WHERE id=? AND project_id=?",
      [packageId, projectId],
      "Paket komersial tidak ditemukan.",
    );
    const boqItems = await validationBoqItems(projectId, packageId);
    return mapValidation(
      {
        ...project,
        ...packageRow,
        package_id: packageId,
        delivery_cycle: deliveryCycle,
        id: null,
        number: null,
        status: "Draft",
        notes: "",
      },
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

async function ensureValidation(
  projectId: string,
  packageId: string,
  deliveryCycle: number,
  userId: string,
) {
  const { client } = await getDatabase();
  const boqItems = await validationBoqItems(projectId, packageId);
  if (!boqItems.length) {
    throw new ApiError(
      409,
      "VALIDATION_ITEMS_REQUIRED",
      "BoQ harus memiliki minimal satu Perangkat atau Material sebelum validasi dibuat.",
    );
  }
  const existing = await client.execute({
    sql: `SELECT id FROM project_validations
      WHERE project_id=? AND package_id=? AND delivery_cycle=? LIMIT 1`,
    args: [projectId, packageId, deliveryCycle],
  });
  const validationId = existing.rows[0]
    ? String(existing.rows[0].id)
    : randomUUID();
  const timestamp = now();
  if (!existing.rows[0]) {
    const sequence = await claimSequence(client, "validations", "SELECT number AS value FROM project_validations");
    await client.execute({
      sql: `INSERT INTO project_validations
        (id,number,project_id,package_id,delivery_cycle,status,notes,validated_by,
         completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [validationId, makeSequence("VAL", sequence), projectId, packageId, deliveryCycle, "Draft", "", userId, null, timestamp, timestamp],
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
      [
        ...missing.map((item) => ({
          sql: "INSERT INTO project_validation_items (id,validation_id,boq_item_id,category,description,quantity,unit,checked,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [randomUUID(), validationId, item.id, item.category, item.description, item.quantity, item.unit, 0, "", item.sort_order, timestamp, timestamp],
        })),
        // New rows always land unchecked. A checklist that still reported
        // 'Completed' would satisfy the BAST guard while carrying items nobody
        // ever verified, so re-syncing an already-completed checklist sends it
        // back to Draft.
        {
          sql: `UPDATE project_validations SET status='Draft',validated_by=NULL,
            completed_at=NULL,updated_at=? WHERE id=? AND status<>'Draft'`,
          args: [timestamp, validationId],
        },
      ],
      "write",
    );
  }
  return readValidation(projectId, packageId, deliveryCycle);
}

// A project is finished only when every commercial package that actually went
// into delivery — i.e. every package with an Accepted quotation — carries an
// active (finalized and not revoked) BAST. Closing the project on the first
// package's handover used to strand multi-package projects: the remaining
// packages were still running while the project reported 'Selesai'.
async function projectHandoverComplete(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  projectId: string,
) {
  const result = await client.execute({
    sql: `SELECT
      COUNT(*) AS delivering,
      COALESCE(SUM(CASE WHEN EXISTS(
        SELECT 1 FROM basts b
        WHERE b.package_id=cp.id
          AND b.finalized_at IS NOT NULL
          AND b.revoked_at IS NULL
      ) THEN 1 ELSE 0 END),0) AS handed_over
      FROM project_commercial_packages cp
      WHERE cp.project_id=?
        AND EXISTS(
          SELECT 1 FROM quotations q
          WHERE q.package_id=cp.id AND q.status='Accepted'
        )`,
    args: [projectId],
  });
  const delivering = asNumber(result.rows[0]?.delivering);
  const handedOver = asNumber(result.rows[0]?.handed_over);
  // No package in delivery (legacy/degenerate data) keeps the historic
  // behaviour: the handover closes the project.
  return delivering === 0 || handedOver >= delivering;
}

// Revoking a BAST undoes the handover that closed the project. Re-evaluate the
// same rule finalization uses and re-open the project when a package is back in
// delivery — leaving it on 'Selesai' would report work as delivered against a
// document that no longer exists.
async function reopenProjectIfHandoverIncomplete(
  client: Awaited<ReturnType<typeof getDatabase>>["client"],
  projectId: string,
  timestamp: string,
) {
  if (await projectHandoverComplete(client, projectId)) return false;
  const project = await client.execute({
    sql: "SELECT status FROM projects WHERE id=? LIMIT 1",
    args: [projectId],
  });
  if (String(project.rows[0]?.status ?? "") !== "Selesai") return false;
  await client.execute({
    sql: "UPDATE projects SET status='Aktif',updated_at=? WHERE id=?",
    args: [timestamp, projectId],
  });
  return true;
}

async function assertCompletedValidation(
  projectId: string,
  packageId: string,
  deliveryCycle: number,
) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT id FROM project_validations WHERE project_id=? AND package_id=?
      AND delivery_cycle=? AND status='Completed' LIMIT 1`,
    args: [projectId, packageId, deliveryCycle],
  });
  if (!result.rows.length) {
    throw new ApiError(
      409,
      "VALIDATION_REQUIRED",
      "Selesaikan checklist validasi Perangkat dan Material sebelum BAST diterbitkan.",
    );
  }
  // 'Completed' alone only says the checklist was signed off at some point. An
  // addendum accepted afterwards adds Perangkat/Material rows the checklist
  // never covered, so the live BoQ of the package is compared against it.
  const uncovered = await client.execute({
    sql: `SELECT COUNT(*) AS count
      FROM boq_items i
      JOIN boqs b ON b.id=i.boq_id
      JOIN boq_scopes s ON s.id=i.scope_id
      WHERE b.project_id=? AND s.package_id=?
        AND i.category IN ('Perangkat','Material')
        AND NOT EXISTS (
          SELECT 1 FROM project_validation_items vi
          WHERE vi.validation_id=? AND vi.boq_item_id=i.id AND vi.checked=1
        )`,
    args: [projectId, packageId, String(result.rows[0].id)],
  });
  if (asNumber(uncovered.rows[0]?.count) > 0) {
    throw new ApiError(
      409,
      "VALIDATION_STALE",
      "BoQ paket ini berubah setelah checklist validasi diselesaikan. Sinkronkan dan centang ulang seluruh Perangkat dan Material sebelum BAST diterbitkan.",
    );
  }
}

async function handleValidations(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const validationId = path[1];
  const action = path[2];
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
  const deliveryCycle = Math.max(1, Number(searchParams.get("deliveryCycle") ?? 1));

  if (!validationId && request.method === "GET") {
    if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    await assertProjectAccess(user, projectId);
    const packageId = await resolveCommercialPackageId(client, projectId, searchParams.get("packageId"));
    return ok(await readValidation(projectId, packageId, deliveryCycle));
  }

  if (!validationId && request.method === "POST") {
    assertAccess(user, "bast", "manage");
    if (!projectId) throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    await assertProjectAccess(user, projectId);
    const packageId = await resolveCommercialPackageId(
      client,
      projectId,
      searchParams.get("packageId"),
      { requireActive: true },
    );
    const validation = await ensureValidation(projectId, packageId, deliveryCycle, user.id);
    await writeAuditLog(client, request, user, "create_or_sync", "project_validation", String(validation.id), { projectId, packageId, deliveryCycle });
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
    // A completed checklist is the evidence a finalized BAST was issued against.
    // Reverting it to Draft — or unchecking items underneath it — used to be
    // accepted with no guard at all, which quietly withdrew the evidence for a
    // handover document that was already signed and sealed. Only a Final BAST
    // locks it: a Draft one re-runs assertCompletedValidation at finalization,
    // and a revoked one reads 'Void'. The addendum flow still demotes the
    // checklist, but through ensureValidation/resetProjectValidation when the
    // BoQ genuinely changes, not through a user edit.
    if (String(validation.status) === "Completed") {
      const issued = await client.execute({
        sql: `SELECT id FROM basts
          WHERE project_id=? AND package_id=? AND delivery_cycle=?
            AND status='Final' LIMIT 1`,
        args: [
          validation.project_id,
          validation.package_id,
          asNumber(validation.delivery_cycle) || 1,
        ],
      });
      if (issued.rows.length) {
        throw new ApiError(
          409,
          "VALIDATION_LOCKED_BY_BAST",
          "Checklist ini sudah menjadi dasar BAST yang diterbitkan, jadi tidak dapat diubah atau dikembalikan ke Draft. Void BAST tersebut terlebih dahulu.",
        );
      }
    }
    const timestamp = now();
    // Items and status move together. The completeness check used to run after
    // the item batch had already been committed, so a request that ended in 409
    // left the record inconsistent: unchecked items under a status still
    // reading 'Completed'. Inside the transaction the throw rolls both back.
    await client.transaction(async (tx) => {
      if (input.items.length) {
        await tx.batch(
          input.items.map((item) => ({
            sql: "UPDATE project_validation_items SET checked=?,notes=?,updated_at=? WHERE id=? AND validation_id=?",
            args: [item.checked ? 1 : 0, item.notes, timestamp, item.id, validationId],
          })),
          "write",
        );
      }
      if (input.status === "Completed") {
        const counts = await tx.execute({
          sql: `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN checked=0 THEN 1 ELSE 0 END),0) AS incomplete
            FROM project_validation_items WHERE validation_id=?`,
          args: [validationId],
        });
        if (!asNumber(counts.rows[0]?.total) || asNumber(counts.rows[0]?.incomplete)) {
          throw new ApiError(409, "VALIDATION_INCOMPLETE", "Centang seluruh Perangkat dan Material sebelum validasi diselesaikan.");
        }
      }
      await tx.execute({
        sql: "UPDATE project_validations SET status=?,notes=?,validated_by=?,completed_at=?,updated_at=? WHERE id=?",
        args: [input.status, input.notes ?? validation.notes ?? "", user.id, input.status === "Completed" ? timestamp : null, timestamp, validationId],
      });
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
    return ok(await readValidation(
      String(validation.project_id),
      String(validation.package_id),
      asNumber(validation.delivery_cycle) || 1,
    ));
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint validasi tidak ditemukan.");
}

function mapBast(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    number: String(row.number),
    projectId: String(row.project_id),
    packageId: row.package_id ? String(row.package_id) : null,
    packageTitle: row.package_title ? String(row.package_title) : null,
    deliveryCycle: asNumber(row.delivery_cycle) || 1,
    revisionNo: asNumber(row.revision_no) || 1,
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
    finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
    pdfHash: row.pdf_hash ? String(row.pdf_hash) : null,
    verificationToken: row.verification_token ? String(row.verification_token) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    revocationReason: row.revocation_reason ? String(row.revocation_reason) : null,
  };
}

async function getBast(id: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT b.*,p.name AS project_name,p.client AS project_client,
      p.location AS project_location,cp.title AS package_title
      FROM basts b JOIN projects p ON p.id=b.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=b.package_id
      WHERE b.id=? LIMIT 1`,
    args: [id],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "BAST tidak ditemukan.");
  return mapBast(result.rows[0] as Record<string, unknown>);
}

async function handleBast(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const bastId = path[1];
  const action = path[2];

  if (bastId === "settings" && action === "seal") {
    if (request.method === "GET") {
      assertAccess(user, "bast", "view");
      const result = await client.execute(
        "SELECT * FROM bast_seal_settings WHERE id='global' LIMIT 1",
      );
      const row = result.rows[0];
      return ok({
        enabled: Boolean(asNumber(row?.enabled)),
        signerName: String(row?.signer_name ?? "PerumNet Enterprise"),
        signerRole: String(row?.signer_role ?? "Authorized Representative"),
        hasSeal: Boolean(row?.seal_content_base64),
        sealMimeType: row?.seal_mime_type ? String(row.seal_mime_type) : null,
      });
    }
    if (request.method === "PUT") {
      if (user.role !== "Admin") {
        throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat mengubah cap perusahaan.");
      }
      const input = bastSealSchema.parse(await jsonBody(request));
      const current = await client.execute(
        "SELECT * FROM bast_seal_settings WHERE id='global' LIMIT 1",
      );
      const currentRow = current.rows[0];
      const sealContent = input.sealContentBase64 === undefined
        ? currentRow?.seal_content_base64 ?? null
        : input.sealContentBase64;
      const sealMime = input.sealMimeType === undefined
        ? currentRow?.seal_mime_type ?? null
        : input.sealMimeType;
      if (input.enabled && (!sealContent || !sealMime)) {
        throw new ApiError(422, "SEAL_IMAGE_REQUIRED", "Unggah gambar cap sebelum mengaktifkan cap digital.");
      }
      if (input.sealContentBase64) {
        let bytes: Buffer;
        try {
          bytes = Buffer.from(input.sealContentBase64, "base64");
          if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error("size");
          const metadata = await sharp(bytes).metadata();
          const detectedMime = metadata.format === "jpeg"
            ? "image/jpeg"
            : metadata.format === "png"
              ? "image/png"
              : metadata.format === "webp"
                ? "image/webp"
                : null;
          if (!detectedMime || detectedMime !== sealMime) throw new Error("mime");
          if (!metadata.width || !metadata.height || metadata.width > 4_096 || metadata.height > 4_096) {
            throw new Error("dimensions");
          }
        } catch {
          throw new ApiError(415, "INVALID_SEAL_IMAGE", "Gambar cap tidak valid, terlalu besar, atau format aslinya tidak sesuai MIME.");
        }
      }
      await client.execute({
        sql: `INSERT INTO bast_seal_settings
          (id,enabled,signer_name,signer_role,seal_mime_type,seal_content_base64,
           updated_by,updated_at) VALUES ('global',?,?,?,?,?,?,?)
          ON CONFLICT (id) DO UPDATE SET enabled=excluded.enabled,
            signer_name=excluded.signer_name,signer_role=excluded.signer_role,
            seal_mime_type=excluded.seal_mime_type,
            seal_content_base64=excluded.seal_content_base64,
            updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        args: [
          input.enabled ? 1 : 0,
          input.signerName,
          input.signerRole,
          sealMime,
          sealContent,
          user.id,
          now(),
        ],
      });
      await writeAuditLog(client, request, user, "update", "bast_seal_settings", "global", {
        enabled: input.enabled,
        signerName: input.signerName,
        signerRole: input.signerRole,
        sealUpdated: input.sealContentBase64 !== undefined,
      });
      return ok({ ...input, hasSeal: Boolean(sealContent), sealContentBase64: undefined });
    }
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }

  if (request.method === "GET" && !bastId) {
    const searchParams = new URL(request.url).searchParams;
    const projectId = searchParams.get("projectId");
    const packageId = searchParams.get("packageId");
    if (projectId) await assertProjectAccess(user, projectId);
    const scope = projectScopeCondition(user, "p");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      conditions.push("b.project_id=?");
      args.push(projectId);
    }
    if (packageId) {
      conditions.push("b.package_id=?");
      args.push(packageId);
    }
    if (scope.sql) {
      conditions.push(scope.sql);
      args.push(...scope.args);
    }
    const result = await client.execute({
      sql: `SELECT b.*,p.name AS project_name,p.client AS project_client,
        p.location AS project_location,cp.title AS package_title
        FROM basts b JOIN projects p ON p.id=b.project_id
        LEFT JOIN project_commercial_packages cp ON cp.id=b.package_id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY b.delivery_cycle DESC,b.revision_no DESC,b.created_at DESC`,
      args,
    });
    return ok(result.rows.map((row) => mapBast(row as Record<string, unknown>)));
  }

  if (request.method === "POST" && !bastId) {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat membuat BAST.");
    const input = bastSchema.parse(await jsonBody(request));
    if (input.status === "Final") {
      throw new ApiError(409, "FINALIZE_ENDPOINT_REQUIRED", "Simpan BAST sebagai Draft, lalu gunakan proses finalisasi agar cap, hash, dan QR verifikasi diterapkan.");
    }
    await assertProjectAccess(user, input.projectId);
    const packageId = await resolveCommercialPackageId(
      client,
      input.projectId,
      input.packageId ?? null,
      { requireActive: true },
    );
    await assertCompletedValidation(input.projectId, packageId, input.deliveryCycle);
    const existing = await client.execute({
      sql: `SELECT id FROM basts WHERE project_id=? AND package_id=?
        AND delivery_cycle=? AND status<>'Void' ORDER BY revision_no DESC LIMIT 1`,
      args: [input.projectId, packageId, input.deliveryCycle],
    });
    if (existing.rows.length) {
      throw new ApiError(
        409,
        "BAST_EXISTS",
        "Paket dan siklus ini sudah memiliki BAST. Buka dokumen yang ada atau buat siklus baru.",
      );
    }
    const sequence = await claimSequence(client, "basts", "SELECT number AS value FROM basts");
    const id = randomUUID();
    const number = makeSequence("BAST", sequence);
    const timestamp = now();
    // Never hardcode revision_no=1: re-issuing after a void leaves the revoked
    // document in place, so a fresh revision 1 would collide with
    // UNIQUE(package_id,delivery_cycle,revision_no) and surface as a raw 500.
    const maxRevision = await client.execute({
      sql: `SELECT COALESCE(MAX(revision_no),0) AS max_revision FROM basts
        WHERE package_id=? AND delivery_cycle=?`,
      args: [packageId, input.deliveryCycle],
    });
    const revisionNo = asNumber(maxRevision.rows[0]?.max_revision) + 1;
    await client.execute({
      sql: `INSERT INTO basts
        (id,number,project_id,package_id,delivery_cycle,revision_no,completion_date,
         notes,installed_items_json,client_name,client_role,client_signature,
         engineer_name,engineer_role,engineer_signature,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, number, input.projectId, packageId, input.deliveryCycle, revisionNo, input.completionDate, input.notes, JSON.stringify(input.installedItems), input.clientName, input.clientRole, input.clientSignature ?? null, input.engineerName, input.engineerRole ?? "Project Manager", input.engineerSignature ?? null, input.status, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "bast", id, { projectId: input.projectId, packageId, deliveryCycle: input.deliveryCycle, revisionNo, status: input.status });
    return created(await getBast(id));
  }

  if (bastId && action === "pdf" && request.method === "GET") {
    const bast = await ensureExists(
      "SELECT project_id,number,finalized_pdf_storage_url,finalized_pdf_content_base64 FROM basts WHERE id=?",
      [bastId],
      "BAST tidak ditemukan.",
    );
    await assertProjectAccess(user, String(bast.project_id));
    if (bast.finalized_pdf_storage_url || bast.finalized_pdf_content_base64) {
      const stored = bast.finalized_pdf_storage_url
        ? await readProjectFile(String(bast.finalized_pdf_storage_url))
        : null;
      const content = stored?.content ?? Buffer.from(
        String(bast.finalized_pdf_content_base64 ?? ""),
        "base64",
      );
      return new Response(content, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${String(bast.number).replaceAll("/", "-")}.pdf"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return renderBusinessPdf("bast", bastId, user.preferredLanguage);
  }

  if (bastId && action === "finalize" && request.method === "POST") {
    if (!mutationRoles("bast").includes(user.role)) {
      throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat memfinalisasi BAST.");
    }
    const bast = await ensureExists("SELECT * FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    const projectBeforeFinalization = await ensureExists(
      "SELECT status FROM projects WHERE id=?",
      [bast.project_id],
      "Proyek tidak ditemukan.",
    );
    if (bast.finalized_at) {
      throw new ApiError(409, "BAST_ALREADY_FINAL", "BAST ini sudah difinalisasi dan bersifat immutable.");
    }
    if (!bast.client_signature || !bast.engineer_signature) {
      throw new ApiError(409, "SIGNATURES_REQUIRED", "Tanda tangan klien dan PerumNet wajib lengkap sebelum finalisasi.");
    }
    await assertCompletedValidation(
      String(bast.project_id),
      String(bast.package_id),
      asNumber(bast.delivery_cycle) || 1,
    );
    const sealResult = await client.execute(
      "SELECT * FROM bast_seal_settings WHERE id='global' AND enabled=1 LIMIT 1",
    );
    const seal = sealResult.rows[0];
    if (!seal?.seal_content_base64) {
      throw new ApiError(409, "DIGITAL_SEAL_REQUIRED", "Aktifkan dan unggah cap perusahaan sebelum finalisasi BAST.");
    }
    const timestamp = now();
    const verificationToken = randomUUID().replaceAll("-", "");
    await client.execute({
      sql: `UPDATE basts SET status='Final',verification_token=?,
        seal_name_snapshot=?,seal_role_snapshot=?,updated_at=? WHERE id=?`,
      args: [verificationToken, seal.signer_name, seal.signer_role, timestamp, bastId],
    });
    let stored: Awaited<ReturnType<typeof storeProjectFile>> | null = null;
    let projectClosed = false;
    try {
      const pdfResponse = await renderBusinessPdf("bast", bastId, user.preferredLanguage);
      const pdf = await pdfResponse.arrayBuffer();
      const pdfHash = createHash("sha256").update(Buffer.from(pdf)).digest("hex");
      stored = await storeProjectFile(
        `bast-final-${bastId}-${randomUUID()}.pdf`,
        "application/pdf",
        pdf,
      );
      await client.execute({
        sql: `UPDATE basts SET finalized_pdf_storage_url=?,
          finalized_pdf_content_base64=?,pdf_hash=?,finalized_at=?,finalized_by=?,
          updated_at=? WHERE id=?`,
        args: [
          stored.storageUrl,
          stored.contentBase64,
          pdfHash,
          timestamp,
          user.id,
          timestamp,
          bastId,
        ],
      });
      // Only the last outstanding package handover closes the project.
      if (await projectHandoverComplete(client, String(bast.project_id))) {
        await client.execute({
          sql: "UPDATE projects SET status='Selesai',updated_at=? WHERE id=?",
          args: [timestamp, bast.project_id],
        });
        projectClosed = true;
      }
      await writeAuditLog(client, request, user, "finalize", "bast", bastId, {
        pdfHash,
        verificationToken,
        packageId: bast.package_id,
        deliveryCycle: bast.delivery_cycle,
        projectClosed,
      });
    } catch (error) {
      if (stored?.storageUrl) await cleanupProjectFile(stored.storageUrl, "BAST finalize rollback");
      await client.execute({
        sql: `UPDATE basts SET status=?,verification_token=NULL,
          seal_name_snapshot=NULL,seal_role_snapshot=NULL,
          finalized_pdf_storage_url=NULL,finalized_pdf_content_base64=NULL,
          pdf_hash=NULL,finalized_at=NULL,finalized_by=NULL,updated_at=? WHERE id=?`,
        args: [bast.status, now(), bastId],
      });
      // Mirror the forward path: restore the project status only if this
      // finalize is the call that changed it. Rewriting it unconditionally
      // would clobber a status another package's handover had legitimately
      // set in the meantime.
      if (projectClosed) {
        await client.execute({
          sql: "UPDATE projects SET status=?,updated_at=? WHERE id=?",
          args: [projectBeforeFinalization.status, now(), bast.project_id],
        });
      }
      throw error;
    }
    await notifyProjectStakeholders(client, {
      projectId: String(bast.project_id),
      eventType: "bast_finalized",
      subject: `BAST ${String(bast.number)} telah final`,
      message: `BAST ${String(bast.number)} sudah dikunci dengan cap, hash, dan QR verifikasi.`,
      subjectEn: `Handover ${String(bast.number)} finalized`,
      messageEn: `handover ${String(bast.number)} has been sealed with a hash and verification QR.`,
      includeFinance: true,
    }).catch(() => undefined);
    return ok(await getBast(bastId));
  }

  if (bastId && action === "void" && request.method === "POST") {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat mencabut BAST final.");
    }
    const input = z.object({ reason: z.string().trim().min(5).max(500) }).parse(await jsonBody(request));
    const bast = await ensureExists("SELECT * FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    if (!bast.finalized_at || bast.revoked_at) {
      throw new ApiError(409, "BAST_NOT_ACTIVE_FINAL", "Hanya BAST final aktif yang dapat dicabut.");
    }
    const timestamp = now();
    await client.execute({
      sql: `UPDATE basts SET status='Void',revoked_at=?,revoked_by=?,
        revocation_reason=?,updated_at=? WHERE id=?`,
      args: [timestamp, user.id, input.reason, timestamp, bastId],
    });
    const projectReopened = await reopenProjectIfHandoverIncomplete(
      client,
      String(bast.project_id),
      timestamp,
    );
    await writeAuditLog(client, request, user, "void", "bast", bastId, {
      ...input,
      projectReopened,
    });
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "GET") {
    const bast = await ensureExists("SELECT project_id FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "PATCH") {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat mengubah BAST.");
    const input = partialPatchSchema(bastSchema.omit({ projectId: true })).parse(
      await jsonBody(request),
    );
    if (input.status === "Final") {
      throw new ApiError(409, "FINALIZE_ENDPOINT_REQUIRED", "Gunakan proses finalisasi agar cap, hash, dan QR verifikasi diterapkan.");
    }
    const current = await ensureExists("SELECT * FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(current.project_id));
    if (current.finalized_at || current.revoked_at) {
      throw new ApiError(409, "BAST_IMMUTABLE", "BAST yang sudah difinalisasi atau dicabut tidak dapat diedit. Buat revisi baru.");
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
    await writeAuditLog(client, request, user, "update", "bast", bastId, { status: input.status });
    return ok(await getBast(bastId));
  }

  if (bastId && !action && request.method === "DELETE") {
    if (!mutationRoles("bast").includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Anda tidak dapat menghapus BAST.");
    const bast = await ensureExists("SELECT project_id,finalized_at,revoked_at FROM basts WHERE id=?", [bastId], "BAST tidak ditemukan.");
    await assertProjectAccess(user, String(bast.project_id));
    if (bast.finalized_at || bast.revoked_at) {
      throw new ApiError(409, "BAST_IMMUTABLE", "BAST final tidak dapat dihapus. Gunakan void untuk mencabut dokumen.");
    }
    await client.execute({ sql: "DELETE FROM basts WHERE id=?", args: [bastId] });
    await writeAuditLog(client, request, user, "delete", "bast", bastId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BAST tidak ditemukan.");
}

// A transaction is manual only when it was typed in through POST
// /api/transactions. Everything the system posts on behalf of a document carries
// origin='system' and is off limits to manual CRUD, whatever its source string
// happens to be.
function isManualTransaction(row: Record<string, unknown>) {
  return String(row.origin ?? "system") === "manual";
}

async function assertManualTransaction(
  client: DatabaseClient,
  row: Record<string, unknown>,
  systemMessage: string,
  reconciledMessage: string,
) {
  if (!isManualTransaction(row)) {
    throw new ApiError(409, "SYSTEM_TRANSACTION", systemMessage);
  }
  // Even a manual row becomes evidence once a bank mutasi points at it:
  // rewriting or deleting it silently breaks the reconciliation.
  const reconciled = await client.execute({
    sql: "SELECT id FROM bank_statement_entries WHERE transaction_id=? LIMIT 1",
    args: [String(row.id)],
  });
  if (reconciled.rows.length) {
    throw new ApiError(409, "TRANSACTION_RECONCILED", reconciledMessage);
  }
}

function mapTransaction(
  row: Record<string, unknown>,
  language: AuthUser["preferredLanguage"] = "id",
) {
  return {
    id: String(row.id),
    date: localizedApiDate(row.date, language),
    dateIso: String(row.date),
    type: String(row.type),
    projectId: row.project_id ? String(row.project_id) : undefined,
    project: row.project_name ? String(row.project_name) : "Umum",
    description: localizedTransactionDescription(row.description, language),
    amount: asNumber(row.amount),
    source: String(row.source),
    categoryKey: String(row.category ?? "Lainnya"),
    category: localizedTransactionCategory(row.category, language),
    editable: isManualTransaction(row),
    // False while an imported bank mutasi has not been reconciled yet: the row
    // is shown, but it must not be counted as cash (it usually duplicates a
    // source-document transaction that already booked the same money).
    countsAsCash: !Boolean(row.unreconciled_import),
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
      sql: `SELECT t.*,p.name AS project_name,
        CASE WHEN ${unreconciledImportCondition("t")} THEN 1 ELSE 0 END AS unreconciled_import
        FROM transactions t LEFT JOIN projects p ON p.id=t.project_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY t.date DESC,t.created_at DESC`,
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
    // Opening the cash ledger and reading the company's margin are two
    // different questions, so they are two different permissions. `finance:
    // view` answers the first: what money moved, on the projects this account
    // can already see. The blocks below answer the second — base net profit,
    // retained profit, and BoQ budget against vendor commitment — which is the
    // margin on the job and follows `margin`. Withheld exactly the way the bank
    // balances above are: the report still downloads, the section simply is not
    // in it, so a Project Manager exporting their own ledger is never met with
    // a refusal for a report they are entitled to.
    const canSeeMargin = canAccess(user.permissions, "margin", "view");
    const profitRows = canSeeMargin ? (await client.execute({
      sql: `
        SELECT p.id,p.code,p.name,
          COALESCE((
            SELECT SUM(CASE
              WHEN t.source IN ('Profit Share','Profit Share Reversal') THEN 0
              WHEN t.type='Pemasukan' THEN t.amount
              WHEN t.type='Pengeluaran' THEN -t.amount
              ELSE 0 END)
            FROM transactions t
            WHERE t.project_id=p.id AND ${countsAsCashCondition("t")}
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
          ),0) AS accepted_addenda,
          COALESCE((
            SELECT SUM(CASE
              WHEN e.total_amount-COALESCE(es.allocated,0)-COALESCE(es.reimbursed,0)>0
              THEN e.total_amount-COALESCE(es.allocated,0)-COALESCE(es.reimbursed,0)
              ELSE 0 END)
            FROM project_expenses e
            LEFT JOIN (
              SELECT expense_id,
                SUM(CASE WHEN settlement_type='AdvanceAllocation' AND status='Posted' THEN amount ELSE 0 END) AS allocated,
                SUM(CASE WHEN settlement_type='Reimbursement' AND status='Posted' THEN amount ELSE 0 END) AS reimbursed
              FROM project_expense_settlements GROUP BY expense_id
            ) es ON es.expense_id=e.id
            WHERE e.project_id=p.id AND e.workflow_status='Approved'
              AND e.funding_source IN ('EmployeePaid','ProjectAdvance')
          ),0) AS outstanding_reimbursement
        FROM projects p
        ${profitConditions.length ? `WHERE ${profitConditions.join(" AND ")}` : ""}
        ORDER BY p.code
      `,
      args: profitArgs as never[],
    })).rows
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
            asNumber(row.outstanding_reimbursement) -
            allocatedAmount,
          budgetBoq: asNumber(row.budget_boq),
          committedVendorCost: asNumber(row.committed_vendor_cost),
          procurementPaid: asNumber(row.procurement_paid),
          outstandingVendorCost: Math.max(
            0,
            asNumber(row.committed_vendor_cost) -
              asNumber(row.procurement_paid),
          ),
          outstandingReimbursement: Math.max(0, asNumber(row.outstanding_reimbursement)),
          acceptedAddenda: asNumber(row.accepted_addenda),
        };
      })
      .filter(
        (row) =>
          row.netProfit !== 0 ||
          row.allocatedAmount !== 0 ||
          row.paidAmount !== 0 ||
          row.committedVendorCost !== 0 ||
          row.outstandingReimbursement !== 0 ||
          row.acceptedAddenda !== 0,
      ) : [];
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
    const expenseReportResult = await client.execute({
      sql: `SELECT e.number,e.purchase_date,p.code,p.name,c.name AS category_name,
        c.name_en AS category_name_en,u.name AS submitter,
        COALESCE(payer.name,u.name) AS paid_by,e.payment_method,
        e.merchant,e.funding_source,
        e.workflow_status,e.settlement_status,e.total_amount,
        CASE WHEN e.workflow_status='Approved'
          AND e.funding_source IN ('EmployeePaid','ProjectAdvance')
          AND e.total_amount-COALESCE(es.allocated,0)-COALESCE(es.reimbursed,0)>0
          THEN e.total_amount-COALESCE(es.allocated,0)-COALESCE(es.reimbursed,0)
          ELSE 0 END AS reimbursement_outstanding
        FROM project_expenses e
        JOIN projects p ON p.id=e.project_id
        JOIN project_expense_categories c ON c.id=e.category_id
        JOIN users u ON u.id=e.created_by
        LEFT JOIN users payer ON payer.id=e.paid_by_user_id
        LEFT JOIN (
          SELECT expense_id,
            SUM(CASE WHEN settlement_type='AdvanceAllocation' AND status='Posted' THEN amount ELSE 0 END) AS allocated,
            SUM(CASE WHEN settlement_type='Reimbursement' AND status='Posted' THEN amount ELSE 0 END) AS reimbursed
          FROM project_expense_settlements GROUP BY expense_id
        ) es ON es.expense_id=e.id
        ${profitConditions.length ? `WHERE ${profitConditions.join(" AND ")}` : ""}
        ORDER BY e.purchase_date DESC,e.created_at DESC`,
      args: profitArgs as never[],
    });
    const expenseReportRows = expenseReportResult.rows.map((row) => ({
      number: String(row.number),
      date: String(row.purchase_date),
      project: `${String(row.code)} - ${String(row.name)}`,
      category: user.preferredLanguage === "en"
        ? String(row.category_name_en)
        : String(row.category_name),
      submitter: String(row.submitter),
      // Old rows have no paid_by_user_id, so the creditor falls back to the submitter.
      paidBy: String(row.paid_by),
      paymentMethod: String(row.payment_method ?? "Tunai"),
      merchant: String(row.merchant),
      fundingSource: String(row.funding_source),
      workflowStatus: String(row.workflow_status),
      settlementStatus: String(row.settlement_status),
      amount: asNumber(row.total_amount),
      reimbursementOutstanding: asNumber(row.reimbursement_outstanding),
    }));
    if (transactionId === "report.csv") {
      const en = user.preferredLanguage === "en";
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
            en ? "Reimbursement Payable (IDR)" : "Utang Reimbursement (IDR)",
            en ? "Allocated (IDR)" : "Dialokasikan (IDR)",
            en ? "Paid (IDR)" : "Dibayar (IDR)",
            en ? "Retained Profit (IDR)" : "Laba Ditahan (IDR)",
          ].map(csvCell).join(","),
          ...profitRows.map((row) => [
            row.project,
            row.netProfit,
            row.outstandingReimbursement,
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
      if (expenseReportRows.length) {
        lines.push(
          "",
          [en ? "PROJECT EXPENSES" : "BELANJA PROYEK"].map(csvCell).join(","),
          [
            en ? "Receipt number" : "Nomor nota",
            en ? "Purchase date" : "Tanggal belanja",
            en ? "Project" : "Proyek",
            en ? "Submitter" : "Pengaju",
            en ? "Merchant" : "Toko",
            en ? "Category" : "Kategori",
            en ? "Funding source" : "Sumber dana",
            en ? "Payment method" : "Metode pembayaran",
            en ? "Reimbursement owed to" : "Utang reimbursement kepada",
            en ? "Workflow status" : "Status pengajuan",
            en ? "Settlement status" : "Status keuangan",
            "Amount (IDR)",
            en ? "Reimbursement payable (IDR)" : "Utang reimbursement (IDR)",
          ].map(csvCell).join(","),
          ...expenseReportRows.map((row) => [
            row.number,
            row.date,
            row.project,
            row.submitter,
            row.merchant,
            row.category,
            row.fundingSource,
            row.paymentMethod,
            row.reimbursementOutstanding > 0 ? row.paidBy : "",
            row.workflowStatus,
            row.settlementStatus,
            row.amount,
            row.reimbursementOutstanding,
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
          countsAsCash: transaction.countsAsCash,
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
        expenseReportRows,
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
      input.source.toLowerCase().startsWith("project expense") ||
      input.source.toLowerCase().startsWith("project advance") ||
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
      sql: "INSERT INTO transactions (id,project_id,date,type,description,amount,source,category,origin,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'manual',?,?,?)",
      args: [id, input.projectId ?? null, input.date, input.type, input.description, input.amount, input.source, input.category, user.id, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "transaction", id, input);
    const row = await ensureExists("SELECT t.*,p.name AS project_name FROM transactions t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?", [id], "Transaksi tidak ditemukan.");
    return created(mapTransaction(row as Record<string, unknown>, user.preferredLanguage));
  }

  if (transactionId && request.method === "PATCH") {
    // A plain `.partial()` re-dated the transaction to today and reset its
    // category whenever the client patched only the description.
    const input = partialPatchSchema(transactionSchema).parse(await jsonBody(request));
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
          input.source.toLowerCase().startsWith("tax settlement") ||
          input.source.toLowerCase().startsWith("project expense") ||
          input.source.toLowerCase().startsWith("project advance"))) ||
      input.category === "Bagi Hasil"
    ) {
      throw new ApiError(
        422,
        "RESERVED_TRANSACTION_SOURCE",
        "Sumber Invoice, SPK, dan Bank hanya dibuat oleh sistem.",
      );
    }
    // Allowlist, not denylist: only a row a human typed in through this very
    // endpoint is editable. A denylist of source prefixes left every new system
    // source tamperable until somebody remembered to extend it.
    await assertManualTransaction(
      client,
      current,
      "Transaksi otomatis harus diperbarui dari dokumen asal atau rekonsiliasi bank.",
      "Transaksi ini sudah dicocokkan dengan mutasi bank. Lepaskan rekonsiliasinya terlebih dahulu.",
    );
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
    await assertManualTransaction(
      client,
      current,
      "Transaksi otomatis hanya dapat dihapus dari dokumen asal atau rekonsiliasi bank.",
      "Transaksi ini sudah dicocokkan dengan mutasi bank. Lepaskan rekonsiliasinya terlebih dahulu.",
    );
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
  // Reported cash never includes a bank line that has not been reconciled yet;
  // that figure is returned separately so it stays visible instead of hidden.
  const reportedWhere = conditions.length
    ? `WHERE ${[...conditions, countsAsCashCondition()].join(" AND ")}`
    : `WHERE ${countsAsCashCondition()}`;
  const pendingWhere = conditions.length
    ? `WHERE ${[...conditions, unreconciledImportCondition()].join(" AND ")}`
    : `WHERE ${unreconciledImportCondition()}`;
  // A void books a reversal in the opposite direction. Netting it against the
  // side it undoes keeps gross income and gross expense at their pre-void
  // figures instead of inflating both of them forever.
  const grossIncome = grossIncomeSum();
  const grossExpense = grossExpenseSum();
  const totals = await client.execute({
    sql: `SELECT ${grossIncome} AS income,${grossExpense} AS expense FROM transactions ${reportedWhere}`,
    args: args as never[],
  });
  const pending = await client.execute({
    sql: `SELECT COUNT(*) AS entries,${grossIncome} AS income,${grossExpense} AS expense FROM transactions ${pendingWhere}`,
    args: args as never[],
  });
  const monthly = await client.execute({
    sql: `SELECT substr(date,1,7) AS month,${grossIncome} AS income,${grossExpense} AS expense FROM transactions ${reportedWhere} GROUP BY substr(date,1,7) ORDER BY month`,
    args: args as never[],
  });
  const income = asNumber(totals.rows[0]?.income);
  const expense = asNumber(totals.rows[0]?.expense);
  return ok({
    income,
    expense,
    netCash: income - expense,
    cashRatio: income ? ((income - expense) / income) * 100 : 0,
    unreconciled: {
      entries: asNumber(pending.rows[0]?.entries),
      income: asNumber(pending.rows[0]?.income),
      expense: asNumber(pending.rows[0]?.expense),
    },
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
    // A plain `.partial()` here materialised every `.default()` the client did
    // not send, so renaming a user silently rewrote `status` back to "Aktif" —
    // a rename reactivated a revoked account. See partialPatchSchema().
    const input = partialPatchSchema(userSchema).parse(await jsonBody(request));
    const current = await ensureExists("SELECT * FROM users WHERE id=?", [userId], "Pengguna tidak ditemukan.");
    if (userId === user.id && input.status === "Nonaktif") throw new ApiError(409, "SELF_DEACTIVATE", "Anda tidak dapat menonaktifkan akun sendiri.");
    if (input.email) {
      const duplicate = await client.execute({
        sql: "SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?",
        args: [input.email, userId],
      });
      if (duplicate.rows.length) throw new ApiError(409, "EMAIL_EXISTS", "Email sudah digunakan oleh pengguna lain.");
    }
    // Nobody moves their own recovery address without proving they own the new
    // inbox, Admin included — otherwise this endpoint is a second, unguarded
    // door to the takeover that /api/profile just closed. An Admin editing
    // *someone else's* address still applies immediately (that is what account
    // administration is for), but it ends that person's sessions and tells
    // their old address, so a silent takeover is impossible either way.
    const selfEmailChange =
      userId === user.id &&
      Boolean(input.email) &&
      String(input.email).toLowerCase() !== String(current.email).toLowerCase();
    const adminEmailChange =
      userId !== user.id &&
      Boolean(input.email) &&
      String(input.email).toLowerCase() !== String(current.email).toLowerCase();
    const currentLanguage = await client.execute({
      sql: "SELECT preferred_language FROM user_profiles WHERE user_id=? LIMIT 1",
      args: [userId],
    });
    const targetLanguage =
      String(currentLanguage.rows[0]?.preferred_language) === "en" ? "en" : "id";
    const pendingEmailChange = selfEmailChange
      ? await requestEmailChange(
          client,
          {
            id: userId,
            email: String(current.email),
            preferredLanguage: targetLanguage,
          },
          String(input.email),
          user.id,
        )
      : undefined;
    const nextEmail = selfEmailChange
      ? String(current.email)
      : input.email ?? current.email;
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
          args: [input.name ?? current.name, nextEmail, passwordHash, nextRole, input.status ?? current.status, timestamp, userId],
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
    if (input.status === "Nonaktif" || input.password || adminEmailChange) {
      await revokeAllSessions(client, userId);
    }
    if (adminEmailChange) {
      // The person who owned the old address has to hear about it from the old
      // address, or an Admin takeover leaves no trace they can see.
      await sendEmailChangedEmail(
        client,
        { id: userId, preferredLanguage: targetLanguage },
        String(current.email),
        String(input.email),
      );
      await client.execute({
        sql: "DELETE FROM password_reset_tokens WHERE user_id=?",
        args: [userId],
      });
    }
    await writeAuditLog(client, request, user, "update", "user", userId, {
      ...input,
      password: input.password ? "[updated]" : undefined,
      ...(selfEmailChange ? { email: undefined, pendingEmail: input.email } : {}),
    });
    const updated = await ensureExists(
      "SELECT u.*,up.permissions_json,p.avatar_mime_type,p.updated_at AS profile_updated_at FROM users u LEFT JOIN user_permissions up ON up.user_id=u.id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?",
      [userId],
      "Pengguna tidak ditemukan.",
    );
    return ok({
      ...mapUser(updated as Record<string, unknown>, user.preferredLanguage),
      ...(pendingEmailChange ? { pendingEmailChange } : {}),
    });
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
    // The address stays put until the new one confirms. An unverified change
    // here was a full account takeover: whoever held the session pointed the
    // account at their own inbox, ran forgot-password, and owned it for good.
    const emailChanged = input.email.toLowerCase() !== user.email.toLowerCase();
    const pendingEmailChange = emailChanged
      ? await requestEmailChange(
          client,
          {
            id: user.id,
            email: user.email,
            preferredLanguage: user.preferredLanguage,
          },
          input.email,
          user.id,
        )
      : undefined;
    const timestamp = now();
    await client.batch(
      [
        {
          sql: "UPDATE users SET name=?,updated_at=? WHERE id=?",
          args: [input.name, timestamp, user.id],
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
    await writeAuditLog(client, request, user, "update_profile", "user", user.id, {
      name: input.name,
      ...(pendingEmailChange ? { pendingEmail: pendingEmailChange.pendingEmail } : {}),
    });
    return ok({
      ...(await getProfile(user.id)),
      ...(pendingEmailChange ? { pendingEmailChange } : {}),
    });
  }

  if (action === "password" && request.method === "PATCH") {
    const input = z.object({
      currentPassword: z.string().min(8).max(128),
      newPassword: z.string().min(10).max(128),
    }).parse(await jsonBody(request));
    const row = await ensureExists(
      "SELECT password_hash,email,allow_local_login FROM users WHERE id=?",
      [user.id],
      "Pengguna tidak ditemukan.",
    );

    // ── Kata sandi mana yang sebenarnya diganti ─────────────────────
    //
    // Di mode MAILSERVER, kata sandi lokal tidak dipakai untuk masuk. Mengganti
    // kolom `password_hash` di sini berarti form ini berpura-pura bekerja:
    // orangnya merasa sudah mengganti kata sandi, padahal yang menentukan
    // aksesnya sama sekali tidak berubah. Jadi yang diganti kata sandi
    // mailbox-nya di mailcow.
    //
    // Akun darurat dikecualikan — justru kata sandi lokalnya yang berarti,
    // karena ia jalan masuk saat mailserver mati.
    const akunDarurat = Number(row.allow_local_login ?? 0) === 1;
    if (authProviderMode() === "MAILSERVER" && !akunDarurat) {
      const cfg = mailcowConfig();
      if (!cfg) {
        throw new ApiError(
          503,
          "MAILCOW_NOT_CONFIGURED",
          "Penggantian kata sandi email belum disiapkan di server ini. Hubungi IT.",
        );
      }

      // Kata sandi LAMA diverifikasi ke mailserver lebih dulu. Tanpa itu, sesi
      // aplikasi yang dibajak cukup untuk mengambil alih kotak surat seseorang
      // — dan lewat kotak surat itu, seluruh akun lain miliknya.
      const sekarang = await verifyMailserverPassword(
        String(row.email),
        input.currentPassword,
      );
      if (!sekarang.ok) {
        if (sekarang.reason === "REJECTED") {
          throw new ApiError(400, "INVALID_PASSWORD", "Kata sandi email Anda saat ini tidak sesuai.");
        }
        throw new ApiError(
          503,
          "MAILSERVER_UNREACHABLE",
          "Mailserver sedang tidak bisa dihubungi, jadi kata sandi belum diganti. Coba lagi sebentar lagi.",
        );
      }

      try {
        // Alamatnya diambil dari baris pengguna yang sedang login, TIDAK PERNAH
        // dari input: dengan API key read-write, satu alamat yang bisa
        // dikendalikan pemanggil berarti siapa pun bisa mengganti kata sandi
        // mailbox siapa pun.
        await setMailboxPassword(cfg, String(row.email), input.newPassword);
      } catch (error) {
        // Paling sering berarti API key-nya read-only. Nilai kata sandinya —
        // lama maupun baru — tidak pernah ikut ke pesan galat.
        const pesan = error instanceof Error ? error.message : String(error);
        console.warn(`[auth] mailcow menolak ganti kata sandi: ${pesan}`);
        throw new ApiError(
          502,
          "MAILCOW_REJECTED",
          "Mailserver menolak penggantian kata sandi. Hubungi IT.",
        );
      }

      await revokeOtherSessions(client, request, user.id);
      await writeAuditLog(client, request, user, "change_mail_password", "user", user.id);
      return ok({ success: true, otherSessionsRevoked: true, target: "mailcow" });
    }

    if (!(await compare(input.currentPassword, String(row.password_hash)))) {
      throw new ApiError(400, "INVALID_PASSWORD", "Kata sandi saat ini tidak sesuai.");
    }
    await client.execute({
      sql: "UPDATE users SET password_hash=?,updated_at=? WHERE id=?",
      args: [await hash(input.newPassword, 12), now(), user.id],
    });
    // Changing your password is the first thing anyone does after suspecting a
    // compromise, so it has to evict the intruder. Everything but the session
    // making this request goes.
    await revokeOtherSessions(client, request, user.id);
    await writeAuditLog(client, request, user, "change_password", "user", user.id);
    return ok({ success: true, otherSessionsRevoked: true });
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
    if (retry === "not-found") {
      throw new ApiError(
        409,
        "EMAIL_NOT_RETRYABLE",
        "Email tidak ditemukan atau statusnya tidak dapat dicoba ulang.",
      );
    }
    if (retry === "body-purged") {
      throw new ApiError(
        409,
        "EMAIL_BODY_PURGED",
        "Isi email ini sudah dihapus setelah percobaan pengiriman habis, jadi tidak dapat dikirim ulang. Ulangi tindakan aslinya agar email baru dibuat.",
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
    if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      isProcurementFieldExecution(resource, path)
    ) {
      assertAccess(user, accessModule, "view");
    } else {
      assertMutationAccess(user, resource);
    }
  }

  if (resource === "projects" && path[2] === "packages") {
    return handleCommercialPackages(request, path, user);
  }
  if (resource === "projects") return handleProjects(request, path, user);
  if (resource === "catalog" && path[1] === "ai") return handleCatalogAi(request, path, user);
  if (resource === "catalog") return handleCatalog(request, path, user);
  if (resource === "boq" && path[1] === "standalone") {
    return handleStandaloneBoqs(request, path, user);
  }
  if (resource === "boq" && path[1] === "scopes") {
    return handleBoqScopes(request, path, user);
  }
  if (resource === "boq") return handleBoq(request, path, user);
  if (resource === "quotations" && path[1]) {
    if (path[1] === "history" && !path[2]) {
      return handleQuotationHistory(request, user);
    }
    if (path[2] === "taxes") {
      return handleDocumentTaxes(
        request,
        ["tax", "documents", "Quotation", path[1]],
        user,
      );
    }
    if (path[2] === "tax-mode") {
      return handleQuotationTaxMode(request, path[1], user);
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
  if (resource === "project-expenses") return handleProjectExpenses(request, path, user);
  if (resource === "project-expense-categories") {
    return handleProjectExpenseCategories(request, path, user);
  }
  if (resource === "project-advances") return handleProjectAdvances(request, path, user);
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
