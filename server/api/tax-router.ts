import "server-only";

import { randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { calculateQuotationCommercialTotals } from "../commercial";
import { getDatabase, type DatabaseClient } from "../db/client";
import { csvCell } from "../spreadsheet";
import {
  calculateTaxAmount,
  documentTaxSummary,
  getDocumentTaxes,
  type TaxDocumentType,
} from "../tax";
import { ApiError, created, jsonBody, ok, partialPatchSchema } from "./errors";
import { renderTaxReportPdf, type TaxReportRow } from "./tax-pdf";

const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(240),
  mimeType: z
    .string()
    .trim()
    .regex(/^(application\/pdf|image\/(png|jpeg|webp))$/),
  contentBase64: z.string().min(4).max(8_500_000),
});
const settingsSchema = z.object({ enabled: z.boolean() });
const ruleSchema = z.object({
  code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  scope: z.enum(["Client", "Vendor", "Both"]),
  effect: z.enum(["Add", "Withhold"]),
  rateBps: z.number().int().min(0).max(10_000),
  accountingTreatment: z.enum([
    "Payable",
    "Receivable",
    "Recoverable",
    "Expense",
  ]),
  status: z.enum(["Active", "Inactive"]).default("Inactive"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
const rulePatchSchema = partialPatchSchema(ruleSchema);
const documentTaxSchema = z.object({
  ruleIds: z.array(idSchema).max(20),
});
const quotationTaxModeSchema = z.object({ enabled: z.boolean() });
const settlementSchema = z.object({
  obligationId: idSchema,
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  settlementDate: isoDateSchema,
  paymentReference: z.string().trim().min(1).max(160),
  paymentMethod: z.enum(["Transfer Bank", "Tunai", "Kartu", "Lainnya"]),
  bankAccountId: idSchema.optional(),
  attachment: attachmentSchema,
});
const voidSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
const reportingSchema = z.object({
  reportingStatus: z.enum(["Candidate", "Ready", "Reported", "Settled", "Void"]),
  taxPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().nullable(),
  taxInvoiceNumber: z.string().trim().max(120).optional().nullable(),
  taxInvoiceDate: isoDateSchema.optional().nullable(),
  returnReference: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(1_000).optional().nullable(),
  overrideReason: z.string().trim().min(10).max(500).optional(),
});

// The invoice edit and delete locks read `reporting_status NOT IN
// ('Candidate','Void')`, so a downgrade is a way to unlock an invoice whose VAT
// was already filed with DJP. Reporting therefore only moves forward on its own;
// walking it back is an Admin action that has to state a reason, and the
// evidence of the filing (`reported_at` / `reported_by`) is never erased.
const REPORTING_ORDER = ["Candidate", "Ready", "Reported", "Settled"] as const;

function assertReportingTransition(
  user: AuthUser,
  currentStatus: string,
  nextStatus: string,
  overrideReason?: string,
) {
  if (currentStatus === nextStatus) return false;
  const currentIndex = REPORTING_ORDER.indexOf(
    currentStatus as (typeof REPORTING_ORDER)[number],
  );
  const nextIndex = REPORTING_ORDER.indexOf(
    nextStatus as (typeof REPORTING_ORDER)[number],
  );
  const forward =
    currentIndex >= 0 && nextIndex >= 0 && nextIndex > currentIndex;
  // Voiding is only free while nothing has been filed yet.
  const voidBeforeFiling =
    nextStatus === "Void" && currentIndex >= 0 && currentIndex <= 1;
  if (forward || voidBeforeFiling) return false;
  if (user.role !== "Admin") {
    throw new ApiError(
      403,
      "REPORTING_DOWNGRADE_FORBIDDEN",
      `Status pelaporan hanya dapat maju (${REPORTING_ORDER.join(" → ")}). Hanya Admin yang dapat menurunkan status pajak yang sudah dilaporkan, dengan alasan tercatat.`,
    );
  }
  if (!overrideReason?.trim()) {
    throw new ApiError(
      422,
      "REPORTING_REASON_REQUIRED",
      "Isi alasan penurunan status pelaporan pajak agar tercatat di jejak audit.",
    );
  }
  return true;
}

function now() {
  return new Date().toISOString();
}

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function boolValue(value: unknown) {
  return value === true || Number(value) === 1;
}

function assertFinanceView(user: AuthUser) {
  if (!canAccess(user.permissions, "finance", "view")) {
    throw new ApiError(403, "FORBIDDEN", "Akun tidak memiliki akses pajak.");
  }
}

function assertFinanceManage(user: AuthUser) {
  if (
    !["Admin", "Finance"].includes(user.role) ||
    !canAccess(user.permissions, "finance", "manage")
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Hanya Admin atau Finance berizin yang dapat mengelola pajak.",
    );
  }
}

function assertAdmin(user: AuthUser) {
  if (user.role !== "Admin" || !canAccess(user.permissions, "settings", "manage")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Hanya Admin yang dapat mengubah pengaturan dan master pajak.",
    );
  }
}

async function assertProjectAccess(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string,
) {
  if (user.role === "Admin" || user.role === "Finance") return;
  const result = await client.execute({
    sql: `SELECT 1 FROM project_members
      WHERE project_id=? AND user_id=? LIMIT 1`,
    args: [projectId, user.id],
  });
  if (!result.rows.length) {
    throw new ApiError(404, "NOT_FOUND", "Dokumen tidak ditemukan.");
  }
}

async function documentDescriptor(
  client: DatabaseClient,
  documentType: TaxDocumentType,
  documentId: string,
) {
  if (documentType === "Quotation") {
    const result = await client.execute({
      sql: `SELECT id,project_id,
        CASE WHEN taxable_base>0 OR discount_enabled=1 THEN taxable_base ELSE total END AS base_amount,
        status,tax_enabled,tax_revision FROM quotations WHERE id=? LIMIT 1`,
      args: [documentId],
    });
    if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
    return {
      projectId: String(result.rows[0].project_id),
      baseAmount: numberValue(result.rows[0].base_amount),
      locked: String(result.rows[0].status) === "Accepted",
      scope: "Client" as const,
      taxEnabled: boolValue(result.rows[0].tax_enabled),
      taxRevision: numberValue(result.rows[0].tax_revision),
      status: String(result.rows[0].status),
    };
  }
  if (documentType === "Invoice") {
    const result = await client.execute({
      sql: `SELECT i.id,i.project_id,i.calculation_mode,
        CASE WHEN i.calculation_mode='Percent' OR i.taxable_base_snapshot>0
          THEN i.taxable_base_snapshot ELSE i.amount END AS base_amount,
        EXISTS(SELECT 1 FROM invoice_payments p
          WHERE p.invoice_id=i.id AND p.status='Posted') AS has_payment
        FROM invoices i WHERE i.id=? LIMIT 1`,
      args: [documentId],
    });
    if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
    return {
      projectId: String(result.rows[0].project_id),
      baseAmount: numberValue(result.rows[0].base_amount),
      locked: boolValue(result.rows[0].has_payment) ||
        String(result.rows[0].calculation_mode) === "Percent",
      scope: "Client" as const,
      taxEnabled: true,
      taxRevision: 0,
      status: boolValue(result.rows[0].has_payment) ? "Locked" : "Draft",
    };
  }
  const result = await client.execute({
    sql: `SELECT id,project_id,cost AS base_amount,document_type,
      approval_status FROM spks WHERE id=? LIMIT 1`,
    args: [documentId],
  });
  if (!result.rows[0]) {
    throw new ApiError(404, "NOT_FOUND", "Dokumen procurement tidak ditemukan.");
  }
  const storedType = String(result.rows[0].document_type);
  if (storedType !== documentType) {
    throw new ApiError(422, "DOCUMENT_TYPE_MISMATCH", "Jenis dokumen tidak sesuai.");
  }
  return {
    projectId: String(result.rows[0].project_id),
    baseAmount: numberValue(result.rows[0].base_amount),
    locked: String(result.rows[0].approval_status) === "Approved",
    scope: "Vendor" as const,
    taxEnabled: true,
    taxRevision: 0,
    status: String(result.rows[0].approval_status),
  };
}

export async function refreshQuotationCommercialSnapshot(
  client: DatabaseClient,
  quotationId: string,
) {
  const result = await client.execute({
    sql: "SELECT * FROM quotations WHERE id=? LIMIT 1",
    args: [quotationId],
  });
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
  const preliminary = calculateQuotationCommercialTotals({
    subtotal: numberValue(row.total),
    discountEnabled: boolValue(row.discount_enabled),
    discountType: String(row.discount_type) === "Percent" ? "Percent" : "Nominal",
    discountValue: numberValue(row.discount_value),
  });
  const taxes = await client.execute({
    sql: `SELECT id,rate_bps,locked FROM document_taxes
      WHERE document_type='Quotation' AND document_id=?`,
    args: [quotationId],
  });
  for (const tax of taxes.rows) {
    if (boolValue(tax.locked)) continue;
    await client.execute({
      sql: "UPDATE document_taxes SET taxable_base=?,amount=?,updated_at=? WHERE id=?",
      args: [
        preliminary.taxableBase,
        calculateTaxAmount(preliminary.taxableBase, numberValue(tax.rate_bps)),
        now(),
        tax.id,
      ],
    });
  }
  const tax = await documentTaxSummary(
    client,
    "Quotation",
    quotationId,
    preliminary.taxableBase,
  );
  const totals = calculateQuotationCommercialTotals({
    subtotal: numberValue(row.total),
    discountEnabled: boolValue(row.discount_enabled),
    discountType: String(row.discount_type) === "Percent" ? "Percent" : "Nominal",
    discountValue: numberValue(row.discount_value),
    taxAdditions: tax.taxAdditions,
    taxWithholdings: tax.taxWithholdings,
    roundingMode: ["Up", "Down", "Custom"].includes(String(row.rounding_mode))
      ? (String(row.rounding_mode) as "Up" | "Down" | "Custom")
      : "None",
    roundingStep: numberValue(row.rounding_step),
    customRoundingAdjustment: numberValue(row.rounding_adjustment),
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
  return totals;
}

async function globalTaxEnabled(client: DatabaseClient) {
  const result = await client.execute(
    "SELECT enabled FROM tax_settings WHERE id='global' LIMIT 1",
  );
  return boolValue(result.rows[0]?.enabled);
}

function mapRule(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    nameEn: String(row.name_en),
    scope: String(row.scope),
    effect: String(row.effect),
    rateBps: numberValue(row.rate_bps),
    ratePercent: numberValue(row.rate_bps) / 100,
    accountingTreatment: String(row.accounting_treatment),
    status: String(row.status),
    sortOrder: numberValue(row.sort_order),
  };
}

export async function handleTaxSettings(
  request: Request,
  user: AuthUser,
) {
  const { client } = await getDatabase();
  if (request.method === "GET") {
    assertFinanceView(user);
    const result = await client.execute(
      "SELECT enabled,updated_by,updated_at FROM tax_settings WHERE id='global'",
    );
    return ok({
      enabled: boolValue(result.rows[0]?.enabled),
      updatedBy: result.rows[0]?.updated_by
        ? String(result.rows[0].updated_by)
        : undefined,
      updatedAt: String(result.rows[0]?.updated_at ?? ""),
    });
  }
  if (request.method === "PATCH") {
    assertAdmin(user);
    const input = settingsSchema.parse(await jsonBody(request));
    await client.execute({
      sql: "UPDATE tax_settings SET enabled=?,updated_by=?,updated_at=? WHERE id='global'",
      args: [input.enabled ? 1 : 0, user.id, now()],
    });
    await writeAuditLog(client, request, user, "update", "tax_settings", "global", input);
    return ok({ enabled: input.enabled });
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

export async function handleTaxRules(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const ruleId = path[2];
  if (request.method === "GET" && !ruleId) {
    assertFinanceView(user);
    const result = await client.execute(
      "SELECT * FROM tax_rules ORDER BY status,sort_order,code",
    );
    return ok(result.rows.map((row) => mapRule(row)));
  }
  assertAdmin(user);
  if (request.method === "POST" && !ruleId) {
    const input = ruleSchema.parse(await jsonBody(request));
    const id = `tax-rule-${randomUUID()}`;
    const timestamp = now();
    await client.execute({
      sql: `INSERT INTO tax_rules
        (id,code,name,name_en,scope,effect,rate_bps,accounting_treatment,status,
         sort_order,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id,
        input.code,
        input.name,
        input.nameEn,
        input.scope,
        input.effect,
        input.rateBps,
        input.accountingTreatment,
        input.status,
        input.sortOrder,
        user.id,
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await writeAuditLog(client, request, user, "create", "tax_rule", id, input);
    return created({ id, ...input, ratePercent: input.rateBps / 100 });
  }
  if (request.method === "PATCH" && ruleId) {
    const current = await client.execute({
      sql: "SELECT * FROM tax_rules WHERE id=? LIMIT 1",
      args: [ruleId],
    });
    if (!current.rows[0]) throw new ApiError(404, "NOT_FOUND", "Aturan pajak tidak ditemukan.");
    const input = rulePatchSchema.parse(await jsonBody(request));
    const merged = ruleSchema.parse({
      code: input.code ?? current.rows[0].code,
      name: input.name ?? current.rows[0].name,
      nameEn: input.nameEn ?? current.rows[0].name_en,
      scope: input.scope ?? current.rows[0].scope,
      effect: input.effect ?? current.rows[0].effect,
      rateBps: input.rateBps ?? numberValue(current.rows[0].rate_bps),
      accountingTreatment:
        input.accountingTreatment ?? current.rows[0].accounting_treatment,
      status: input.status ?? current.rows[0].status,
      sortOrder: input.sortOrder ?? numberValue(current.rows[0].sort_order),
    });
    await client.execute({
      sql: `UPDATE tax_rules SET code=?,name=?,name_en=?,scope=?,effect=?,
        rate_bps=?,accounting_treatment=?,status=?,sort_order=?,updated_by=?,
        updated_at=? WHERE id=?`,
      args: [
        merged.code,
        merged.name,
        merged.nameEn,
        merged.scope,
        merged.effect,
        merged.rateBps,
        merged.accountingTreatment,
        merged.status,
        merged.sortOrder,
        user.id,
        now(),
        ruleId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "tax_rule", ruleId, input);
    return ok({ id: ruleId, ...merged, ratePercent: merged.rateBps / 100 });
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

export async function handleDocumentTaxes(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const rawType = path[2];
  const documentId = path[3];
  if (!["Quotation", "Invoice", "SPK", "PO"].includes(rawType) || !documentId) {
    throw new ApiError(404, "NOT_FOUND", "Dokumen pajak tidak valid.");
  }
  const documentType = rawType as TaxDocumentType;
  const document = await documentDescriptor(client, documentType, documentId);
  await assertProjectAccess(client, user, document.projectId);
  if (request.method === "GET") {
    return ok({
      enabled: await globalTaxEnabled(client),
      documentType,
      documentId,
      baseAmount: document.baseAmount,
      locked: document.locked,
      taxEnabled: documentType === "Quotation" ? document.taxEnabled : undefined,
      taxRevision: documentType === "Quotation" ? document.taxRevision : undefined,
      ...(await documentTaxSummary(
        client,
        documentType,
        documentId,
        document.baseAmount,
      )),
    });
  }
  assertFinanceManage(user);
  if (!(await globalTaxEnabled(client))) {
    throw new ApiError(
      409,
      "TAX_DISABLED",
      "Aktifkan modul pajak global sebelum menerapkan pajak baru.",
    );
  }
  if (document.locked) {
    throw new ApiError(
      409,
      "TAX_SNAPSHOT_LOCKED",
      "Snapshot pajak dokumen sudah dikunci dan tidak dapat dihitung ulang.",
    );
  }
  if (documentType === "Quotation" && document.status !== "Draft") {
    throw new ApiError(
      409,
      "QUOTATION_NOT_DRAFT",
      "Pajak hanya dapat diubah saat Quotation masih Draft.",
    );
  }
  if (request.method === "PUT") {
    const input = documentTaxSchema.parse(await jsonBody(request));
    const existing = await getDocumentTaxes(client, documentType, documentId);
    if (existing.some((tax) => tax.locked)) {
      throw new ApiError(409, "TAX_SNAPSHOT_LOCKED", "Snapshot pajak sudah dikunci.");
    }
    const rules = input.ruleIds.length
      ? await client.execute({
          sql: `SELECT * FROM tax_rules WHERE id IN (${input.ruleIds
            .map(() => "?")
            .join(",")})`,
          args: input.ruleIds,
        })
      : { rows: [] };
    if (rules.rows.length !== input.ruleIds.length) {
      throw new ApiError(422, "INVALID_TAX_RULE", "Sebagian aturan pajak tidak ditemukan.");
    }
    for (const rule of rules.rows) {
      if (String(rule.status) !== "Active" || numberValue(rule.rate_bps) <= 0) {
        throw new ApiError(
          422,
          "INACTIVE_TAX_RULE",
          `Aturan ${String(rule.code)} belum aktif atau tarifnya nol.`,
        );
      }
      if (![document.scope, "Both"].includes(String(rule.scope))) {
        throw new ApiError(
          422,
          "TAX_SCOPE_MISMATCH",
          `Aturan ${String(rule.code)} tidak berlaku untuk dokumen ini.`,
        );
      }
    }
    const timestamp = now();
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: "DELETE FROM document_taxes WHERE document_type=? AND document_id=? AND locked=0",
        args: [documentType, documentId],
      });
      for (const rule of rules.rows) {
        const rateBps = numberValue(rule.rate_bps);
        await tx.execute({
          sql: `INSERT INTO document_taxes
            (id,document_type,document_id,project_id,rule_id,rule_code,rule_name,
             rule_name_en,scope,effect,accounting_treatment,rate_bps,taxable_base,
             amount,locked,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
          args: [
            `document-tax-${randomUUID()}`,
            documentType,
            documentId,
            document.projectId,
            rule.id,
            rule.code,
            rule.name,
            rule.name_en,
            rule.scope,
            rule.effect,
            rule.accounting_treatment,
            rateBps,
            document.baseAmount,
            calculateTaxAmount(document.baseAmount, rateBps),
            user.id,
            timestamp,
            timestamp,
          ],
        });
      }
      if (documentType === "Quotation") {
        await tx.execute({
          sql: "UPDATE quotations SET tax_enabled=?,tax_revision=tax_revision+1,updated_at=? WHERE id=?",
          args: [input.ruleIds.length ? 1 : 0, timestamp, documentId],
        });
      }
    });
    await writeAuditLog(
      client,
      request,
      user,
      "replace",
      "document_tax",
      `${documentType}:${documentId}`,
      input,
    );
    const refreshed = documentType === "Quotation"
      ? await refreshQuotationCommercialSnapshot(client, documentId)
      : undefined;
    return ok({
      enabled: true,
      documentType,
      documentId,
      baseAmount: document.baseAmount,
      locked: false,
      taxEnabled: documentType === "Quotation" ? input.ruleIds.length > 0 : undefined,
      ...(await documentTaxSummary(
        client,
        documentType,
        documentId,
        refreshed?.taxableBase ?? document.baseAmount,
      )),
      ...(refreshed
        ? {
            subtotal: refreshed.subtotal,
            discountAmount: refreshed.discountAmount,
            taxableBase: refreshed.taxableBase,
            roundingAdjustment: refreshed.roundingAdjustment,
            grandTotal: refreshed.grandTotal,
            netCashDue: refreshed.netCashDue,
          }
        : {}),
    });
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

export async function handleQuotationTaxMode(
  request: Request,
  quotationId: string,
  user: AuthUser,
) {
  if (request.method !== "PATCH") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  assertFinanceManage(user);
  const { client } = await getDatabase();
  const quotation = await client.execute({
    sql: "SELECT id,project_id,total,taxable_base,status,tax_enabled,tax_revision FROM quotations WHERE id=? LIMIT 1",
    args: [quotationId],
  });
  const row = quotation.rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
  await assertProjectAccess(client, user, String(row.project_id));
  if (String(row.status) !== "Draft") {
    throw new ApiError(409, "QUOTATION_NOT_DRAFT", "Switch pajak hanya dapat diubah saat Quotation masih Draft.");
  }
  const input = quotationTaxModeSchema.parse(await jsonBody(request));
  if (input.enabled && !(await globalTaxEnabled(client))) {
    throw new ApiError(409, "TAX_DISABLED", "Aktifkan modul pajak global terlebih dahulu.");
  }
  await client.transaction(async (tx) => {
    if (!input.enabled) {
      const locked = await tx.execute({
        sql: "SELECT id FROM document_taxes WHERE document_type='Quotation' AND document_id=? AND locked=1 LIMIT 1",
        args: [quotationId],
      });
      if (locked.rows.length) {
        throw new ApiError(409, "TAX_SNAPSHOT_LOCKED", "Snapshot pajak sudah dikunci.");
      }
      await tx.execute({
        sql: "DELETE FROM document_taxes WHERE document_type='Quotation' AND document_id=? AND locked=0",
        args: [quotationId],
      });
    }
    await tx.execute({
      sql: `UPDATE quotations SET tax_enabled=?,tax_revision=tax_revision+1,
        updated_at=? WHERE id=?`,
      args: [input.enabled ? 1 : 0, now(), quotationId],
    });
  });
  await writeAuditLog(client, request, user, "tax_mode", "quotation", quotationId, {
    enabled: input.enabled,
    previousRevision: numberValue(row.tax_revision),
  });
  const refreshed = await refreshQuotationCommercialSnapshot(client, quotationId);
  return ok({
    enabled: input.enabled,
    taxEnabled: input.enabled,
    revision: numberValue(row.tax_revision) + 1,
    ...(await documentTaxSummary(client, "Quotation", quotationId, refreshed.taxableBase)),
    subtotal: refreshed.subtotal,
    discountAmount: refreshed.discountAmount,
    taxableBase: refreshed.taxableBase,
    roundingAdjustment: refreshed.roundingAdjustment,
    grandTotal: refreshed.grandTotal,
    netCashDue: refreshed.netCashDue,
  });
}

function obligationStatus(amount: number, settled: number) {
  if (settled <= 0) return "Outstanding";
  if (settled >= amount) return "Settled";
  return "Partially Settled";
}

export async function handleTaxObligations(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const obligationId = path[2];
  const action = path[3];
  if (request.method === "PATCH" && obligationId && action === "reporting") {
    assertFinanceManage(user);
    const { client } = await getDatabase();
    const input = reportingSchema.parse(await jsonBody(request));
    const current = await client.execute({
      sql: "SELECT * FROM tax_obligations WHERE id=? LIMIT 1",
      args: [obligationId],
    });
    const row = current.rows[0];
    if (!row) throw new ApiError(404, "NOT_FOUND", "Kewajiban pajak tidak ditemukan.");
    await assertProjectAccess(client, user, String(row.project_id ?? ""));
    if (input.reportingStatus === "Reported" && !input.returnReference?.trim()) {
      throw new ApiError(422, "REPORT_REFERENCE_REQUIRED", "Referensi pelaporan pajak wajib diisi.");
    }
    const currentStatus = String(row.reporting_status ?? "Candidate");
    const downgraded = assertReportingTransition(
      user,
      currentStatus,
      input.reportingStatus,
      input.overrideReason,
    );
    const timestamp = now();
    const filing = ["Reported", "Settled"].includes(input.reportingStatus);
    await client.execute({
      sql: `UPDATE tax_obligations SET reporting_status=?,tax_period=?,
        tax_invoice_number=?,tax_invoice_date=?,return_reference=?,
        reporting_notes=?,reported_at=?,reported_by=?,updated_at=? WHERE id=?`,
      args: [
        input.reportingStatus,
        input.taxPeriod ?? row.tax_period,
        input.taxInvoiceNumber ?? row.tax_invoice_number,
        input.taxInvoiceDate ?? row.tax_invoice_date,
        input.returnReference ?? row.return_reference,
        input.notes ?? row.reporting_notes,
        row.reported_at ?? (filing ? timestamp : null),
        row.reported_by ?? (filing ? user.id : null),
        timestamp,
        obligationId,
      ],
    });
    await writeAuditLog(client, request, user, "reporting", "tax_obligation", obligationId, {
      ...input,
      previousReportingStatus: currentStatus,
      downgraded,
    });
    return ok({ id: obligationId, ...input });
  }
  if (request.method !== "GET" || obligationId) {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  assertFinanceView(user);
  const { client } = await getDatabase();
  const scoped = user.role !== "Admin" && user.role !== "Finance";
  const result = await client.execute({
    sql: `
    SELECT o.*,dt.document_type,dt.document_id,dt.rule_code,dt.rule_name,
      dt.rule_name_en,dt.effect,dt.accounting_treatment,p.code AS project_code,
      p.name AS project_name
    FROM tax_obligations o
    JOIN document_taxes dt ON dt.id=o.document_tax_id
    LEFT JOIN projects p ON p.id=o.project_id
    ${scoped ? `WHERE EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id=o.project_id AND pm.user_id=?
    )` : ""}
    ORDER BY CASE o.status WHEN 'Outstanding' THEN 0
      WHEN 'Partially Settled' THEN 1 WHEN 'Settled' THEN 2 ELSE 3 END,
      COALESCE(o.due_date,o.created_at),o.created_at
  `,
    args: scoped ? [user.id] : [],
  });
  return ok(
    result.rows.map((row) => ({
      id: String(row.id),
      projectId: row.project_id ? String(row.project_id) : undefined,
      projectCode: row.project_code ? String(row.project_code) : undefined,
      projectName: row.project_name ? String(row.project_name) : undefined,
      documentType: String(row.document_type),
      documentId: String(row.document_id),
      ruleCode: String(row.rule_code),
      ruleName: String(row.rule_name),
      ruleNameEn: String(row.rule_name_en),
      direction: String(row.direction),
      amount: numberValue(row.amount),
      settledAmount: numberValue(row.settled_amount),
      outstandingAmount: Math.max(
        0,
        numberValue(row.amount) - numberValue(row.settled_amount),
      ),
      status: String(row.status),
      reportingStatus: String(row.reporting_status ?? "Candidate"),
      taxPeriod: row.tax_period ? String(row.tax_period) : undefined,
      taxInvoiceNumber: row.tax_invoice_number ? String(row.tax_invoice_number) : undefined,
      taxInvoiceDate: row.tax_invoice_date ? String(row.tax_invoice_date) : undefined,
      returnReference: row.return_reference ? String(row.return_reference) : undefined,
      reportedAt: row.reported_at ? String(row.reported_at) : undefined,
      reportingNotes: row.reporting_notes ? String(row.reporting_notes) : undefined,
      dueDate: row.due_date ? String(row.due_date) : undefined,
    })),
  );
}

export async function handleTaxSettlements(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const settlementId = path[2];
  const action = path[3];
  if (request.method === "GET" && !settlementId) {
    assertFinanceView(user);
    const scoped = user.role !== "Admin" && user.role !== "Finance";
    const result = await client.execute({
      sql: `
      SELECT s.*,o.direction,dt.rule_code,dt.document_type,dt.document_id
      FROM tax_settlements s
      JOIN tax_obligations o ON o.id=s.obligation_id
      JOIN document_taxes dt ON dt.id=o.document_tax_id
      ${scoped ? `WHERE EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id=o.project_id AND pm.user_id=?
      )` : ""}
      ORDER BY s.settlement_date DESC,s.created_at DESC
    `,
      args: scoped ? [user.id] : [],
    });
    return ok(
      result.rows.map((row) => ({
        id: String(row.id),
        obligationId: String(row.obligation_id),
        direction: String(row.direction),
        ruleCode: String(row.rule_code),
        documentType: String(row.document_type),
        documentId: String(row.document_id),
        amount: numberValue(row.amount),
        settlementDate: String(row.settlement_date),
        paymentReference: String(row.payment_reference),
        paymentMethod: String(row.payment_method),
        bankAccountId: row.bank_account_id
          ? String(row.bank_account_id)
          : undefined,
        attachmentName: row.attachment_name
          ? String(row.attachment_name)
          : undefined,
        status: String(row.status),
      })),
    );
  }
  assertFinanceManage(user);
  if (request.method === "POST" && !settlementId) {
    const input = settlementSchema.parse(await jsonBody(request));
    // `tax_obligations.status` is derived from settled_amount by
    // obligationStatus() and only ever reads 'Outstanding', 'Partially Settled'
    // or 'Settled'. The old `status<>'Void'` filter tested a value nothing has
    // ever written: cancelling a filing is `reporting_status='Void'`, which the
    // reporting endpoint writes under its own transition guard, and cancelling
    // the liability itself means deleting the source document. See the same
    // removal in profit-share-router.ts and the invoice edit/delete locks.
    const obligationResult = await client.execute({
      sql: "SELECT * FROM tax_obligations WHERE id=? LIMIT 1",
      args: [input.obligationId],
    });
    const obligation = obligationResult.rows[0];
    if (!obligation) throw new ApiError(404, "NOT_FOUND", "Posisi pajak tidak ditemukan.");
    const outstanding =
      numberValue(obligation.amount) - numberValue(obligation.settled_amount);
    if (input.amount > outstanding) {
      throw new ApiError(
        422,
        "OVER_SETTLEMENT",
        "Nominal settlement melebihi posisi pajak yang belum diselesaikan.",
      );
    }
    if (input.paymentMethod === "Transfer Bank" && !input.bankAccountId) {
      throw new ApiError(422, "BANK_ACCOUNT_REQUIRED", "Pilih rekening perusahaan.");
    }
    const id = `tax-settlement-${randomUUID()}`;
    const transactionId = `transaction-${randomUUID()}`;
    const timestamp = now();
    const direction = String(obligation.direction);
    const settled = numberValue(obligation.settled_amount) + input.amount;
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO transactions
          (id,project_id,date,type,description,amount,source,reference_id,category,
           origin,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'system',?,?,?)`,
        args: [
          transactionId,
          obligation.project_id ?? null,
          input.settlementDate,
          direction === "Payable" ? "Pengeluaran" : "Pemasukan",
          `Settlement pajak ${input.paymentReference}`,
          input.amount,
          "Tax Settlement",
          id,
          "Pajak",
          user.id,
          timestamp,
          timestamp,
        ],
      });
      await tx.execute({
        sql: `INSERT INTO tax_settlements
          (id,obligation_id,amount,settlement_date,payment_reference,
           payment_method,bank_account_id,attachment_name,attachment_mime_type,
           attachment_content_base64,status,transaction_id,created_by,created_at,
           updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,'Posted',?,?,?,?)`,
        args: [
          id,
          input.obligationId,
          input.amount,
          input.settlementDate,
          input.paymentReference,
          input.paymentMethod,
          input.bankAccountId ?? null,
          input.attachment.name,
          input.attachment.mimeType,
          input.attachment.contentBase64,
          transactionId,
          user.id,
          timestamp,
          timestamp,
        ],
      });
      await tx.execute({
        sql: "UPDATE tax_obligations SET settled_amount=?,status=?,updated_at=? WHERE id=?",
        args: [
          settled,
          obligationStatus(numberValue(obligation.amount), settled),
          timestamp,
          input.obligationId,
        ],
      });
    });
    await writeAuditLog(client, request, user, "settle", "tax_obligation", input.obligationId, {
      settlementId: id,
      amount: input.amount,
      reference: input.paymentReference,
    });
    return created({ id, transactionId, status: "Posted" });
  }
  if (request.method === "POST" && settlementId && action === "void") {
    if (user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat membatalkan settlement.");
    }
    const input = voidSchema.parse(await jsonBody(request));
    const timestamp = now();
    const reversalId = `transaction-${randomUUID()}`;
    await client.transaction(async (tx) => {
      // Settlement row and reconciliation guard both read inside the write
      // transaction: SQLite serialises writers, PostgreSQL does not, and a
      // reconciliation committed between the guard and the void would leave a
      // matched bank line pointing at money that was just reversed.
      const result = await tx.execute({
        sql: `SELECT s.*,o.amount AS obligation_amount,o.settled_amount,
          o.direction,o.project_id FROM tax_settlements s
          JOIN tax_obligations o ON o.id=s.obligation_id
          WHERE s.id=? AND s.status='Posted' LIMIT 1`,
        args: [settlementId],
      });
      const settlement = result.rows[0];
      if (!settlement) throw new ApiError(404, "NOT_FOUND", "Settlement aktif tidak ditemukan.");
      if (settlement.transaction_id) {
        const reconciled = await tx.execute({
          sql: `SELECT 1 FROM bank_statement_entries
            WHERE transaction_id=? AND reconciliation_status='Matched' LIMIT 1`,
          args: [settlement.transaction_id],
        });
        if (reconciled.rows.length) {
          throw new ApiError(
            409,
            "RECONCILIATION_LOCKED",
            "Lepaskan rekonsiliasi bank sebelum membatalkan settlement.",
          );
        }
      }
      const newSettled = Math.max(
        0,
        numberValue(settlement.settled_amount) - numberValue(settlement.amount),
      );
      await tx.execute({
        sql: `INSERT INTO transactions
          (id,project_id,date,type,description,amount,source,reference_id,category,
           origin,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'system',?,?,?)`,
        args: [
          reversalId,
          settlement.project_id ?? null,
          timestamp.slice(0, 10),
          String(settlement.direction) === "Payable" ? "Pemasukan" : "Pengeluaran",
          `Reversal settlement pajak ${String(settlement.payment_reference)}`,
          settlement.amount,
          "Tax Settlement Reversal",
          settlementId,
          "Pajak",
          user.id,
          timestamp,
          timestamp,
        ],
      });
      await tx.execute({
        sql: `UPDATE tax_settlements SET status='Void',voided_by=?,voided_at=?,
          void_reason=?,updated_at=? WHERE id=?`,
        args: [user.id, timestamp, input.reason, timestamp, settlementId],
      });
      await tx.execute({
        sql: "UPDATE tax_obligations SET settled_amount=?,status=?,updated_at=? WHERE id=?",
        args: [
          newSettled,
          obligationStatus(numberValue(settlement.obligation_amount), newSettled),
          timestamp,
          settlement.obligation_id,
        ],
      });
    });
    await writeAuditLog(client, request, user, "void", "tax_settlement", settlementId, {
      reason: input.reason,
      reversalTransactionId: reversalId,
    });
    return ok({ id: settlementId, status: "Void", reversalTransactionId: reversalId });
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

async function handleTaxReport(request: Request, section: string, user: AuthUser) {
  if (request.method !== "GET") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  assertFinanceView(user);
  const { client } = await getDatabase();
  const scoped = user.role !== "Admin" && user.role !== "Finance";
  const result = await client.execute({
    sql: `SELECT o.*,dt.document_type,dt.document_id,dt.rule_code,
      dt.rule_name,dt.rule_name_en,p.code AS project_code,p.name AS project_name
      FROM tax_obligations o
      JOIN document_taxes dt ON dt.id=o.document_tax_id
      LEFT JOIN projects p ON p.id=o.project_id
      ${scoped ? `WHERE EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id=o.project_id AND pm.user_id=?
      )` : ""}
      ORDER BY o.direction,o.status,COALESCE(o.due_date,o.created_at)`,
    args: scoped ? [user.id] : [],
  });
  const language = user.preferredLanguage === "en" ? "en" : "id";
  const rows: TaxReportRow[] = result.rows.map((row) => ({
    project: row.project_code
      ? `${String(row.project_code)} - ${String(row.project_name ?? "")}`
      : "-",
    document: `${String(row.document_type)} ${String(row.document_id)}`,
    rule:
      language === "en"
        ? String(row.rule_name_en)
        : String(row.rule_name),
    direction: String(row.direction),
    amount: numberValue(row.amount),
    settled: numberValue(row.settled_amount),
    outstanding: Math.max(
      0,
      numberValue(row.amount) - numberValue(row.settled_amount),
    ),
    status: String(row.status),
    reportingStatus: String(row.reporting_status ?? "Candidate"),
    taxPeriod: row.tax_period ? String(row.tax_period) : undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
  }));
  if (section === "report.pdf") {
    return renderTaxReportPdf(rows, language);
  }
  const en = language === "en";
  const lines = [
    [
      en ? "Project" : "Proyek",
      en ? "Document" : "Dokumen",
      en ? "Tax rule" : "Aturan pajak",
      en ? "Position" : "Posisi",
      en ? "Amount (IDR)" : "Nilai (IDR)",
      en ? "Settled (IDR)" : "Diselesaikan (IDR)",
      en ? "Outstanding (IDR)" : "Outstanding (IDR)",
      en ? "Due date" : "Jatuh tempo",
      "Status",
      en ? "Reporting status" : "Status pelaporan",
      en ? "Tax period" : "Masa pajak",
    ].map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.project,
        row.document,
        row.rule,
        row.direction === "Payable"
          ? en
            ? "Payable"
            : "Utang"
          : en
            ? "Receivable"
            : "Piutang",
        row.amount,
        row.settled,
        row.outstanding,
        row.dueDate ?? "",
        row.status,
        row.reportingStatus,
        row.taxPeriod ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${en ? "PerumNet-Tax-Report" : "Laporan-Pajak-PerumNet"}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function handleTax(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const section = path[1];
  if (section === "report.pdf" || section === "report.csv") {
    return handleTaxReport(request, section, user);
  }
  if (section === "settings") return handleTaxSettings(request, user);
  if (section === "rules") return handleTaxRules(request, path, user);
  if (section === "documents") return handleDocumentTaxes(request, path, user);
  if (section === "obligations") return handleTaxObligations(request, path, user);
  if (section === "settlements") return handleTaxSettlements(request, path, user);
  throw new ApiError(404, "NOT_FOUND", "Endpoint pajak tidak ditemukan.");
}
