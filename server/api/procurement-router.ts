import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canAccess } from "@/shared/access";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";
import { renderBusinessPdf } from "./pdf";

const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneySchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(240),
  mimeType: z
    .string()
    .trim()
    .regex(/^(application\/pdf|image\/(png|jpeg|webp))$/),
  contentBase64: z.string().min(4).max(8_500_000),
});

const vendorCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().max(100).default(""),
  vendorType: z.enum(["Supplier", "Jasa", "Hybrid"]),
  status: z.enum(["Aktif", "Nonaktif"]).default("Aktif"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

const orderSchema = z.object({
  documentType: z.enum(["SPK", "PO"]),
  vendorId: idSchema,
  projectId: idSchema,
  quotationId: idSchema,
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  items: z
    .array(
      z.object({
        boqItemId: idSchema,
        quantity: z.number().int().positive().max(1_000_000),
        agreedUnitCost: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .max(500),
  terms: z
    .array(
      z
        .object({
          label: z.string().trim().min(2).max(120),
          type: z.enum(["DP", "Progress", "Final", "Custom"]),
          percentage: z.number().positive().max(100).optional(),
          amount: moneySchema.optional(),
        })
        .refine((term) => term.percentage !== undefined || term.amount !== undefined, {
          message: "Isi persentase atau nominal termin.",
        }),
    )
    .min(1)
    .max(20),
});

const verificationSchema = z.object({
  termId: idSchema,
  verifiedAmount: moneySchema,
  progressPercentage: z.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(2_000).optional(),
  attachment: attachmentSchema.optional(),
});

const receiptSchema = z.object({
  receiptNumber: z.string().trim().max(120).optional(),
  receivedAt: isoDateSchema,
  notes: z.string().trim().max(2_000).optional(),
  attachment: attachmentSchema.optional(),
  items: z
    .array(
      z.object({
        spkItemId: idSchema,
        quantity: z.number().int().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(500),
});

const paymentSchema = z.object({
  termId: idSchema.optional(),
  amount: moneySchema,
  paidDate: isoDateSchema,
  vendorInvoiceNumber: z.string().trim().min(1).max(160),
  paymentReference: z.string().trim().min(1).max(160),
  paymentMethod: z.enum(["Transfer Bank", "Tunai", "Kartu", "Lainnya"]),
  bankAccountId: idSchema.optional(),
  attachment: attachmentSchema,
});

function now() {
  return new Date().toISOString();
}

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function assertManage(user: AuthUser, module: "procurement" | "boq" | "billing" | "finance") {
  if (!canAccess(user.permissions, module, "manage")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Akun Anda tidak memiliki izin untuk menjalankan tindakan ini.",
    );
  }
}

async function assertProjectAccess(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string,
) {
  const global = user.role === "Admin" || user.role === "Finance";
  const result = await client.execute({
    sql: `SELECT p.id FROM projects p WHERE p.id=?${
      global
        ? ""
        : ` AND EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id=p.id AND pm.user_id=?
        )`
    } LIMIT 1`,
    args: global ? [projectId] : [projectId, user.id],
  });
  if (!result.rows.length) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
}

function orderNumber(type: "SPK" | "PO", count: number) {
  const date = new Date();
  return `${type}/PN/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}/${String(count + 1).padStart(3, "0")}`;
}

function paymentState(contract: number, paid: number) {
  if (paid <= 0) return "Belum Dibayar";
  if (paid >= contract) return "Lunas";
  return "Dibayar Sebagian";
}

async function updateOrderPaymentCompatibility(
  client: DatabaseClient,
  orderId: string,
) {
  const totals = await client.execute({
    sql: `SELECT s.cost,
      COALESCE((SELECT SUM(p.amount) FROM spk_payments p
        WHERE p.spk_id=s.id AND p.status='Posted'),0) AS paid
      FROM spks s WHERE s.id=?`,
    args: [orderId],
  });
  if (!totals.rows[0]) return;
  const cost = numberValue(totals.rows[0].cost);
  const paid = numberValue(totals.rows[0].paid);
  await client.execute({
    sql: "UPDATE spks SET payment_status=?,paid_date=?,updated_at=? WHERE id=?",
    args: [
      paid >= cost && cost > 0 ? "Dibayar" : "Belum Dibayar",
      paid >= cost && cost > 0 ? now().slice(0, 10) : null,
      now(),
      orderId,
    ],
  });
}

function mapCategory(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    nameEn: String(row.name_en ?? ""),
    vendorType: String(row.vendor_type),
    status: String(row.status),
    sortOrder: numberValue(row.sort_order),
    vendorCount: numberValue(row.vendor_count),
  };
}

export async function handleVendorCategories(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const categoryId = path[1];

  if (request.method === "GET" && !categoryId) {
    const result = await client.execute(`
      SELECT c.*,COUNT(a.vendor_id) AS vendor_count
      FROM vendor_categories c
      LEFT JOIN vendor_category_assignments a ON a.category_id=c.id
      GROUP BY c.id
      ORDER BY c.status,c.sort_order,c.name
    `);
    return ok(result.rows.map((row) => mapCategory(row)));
  }

  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Hanya Admin dan Finance yang dapat mengelola kategori vendor.",
    );
  }
  assertManage(user, "procurement");

  if (request.method === "POST" && !categoryId) {
    const input = vendorCategorySchema.parse(await jsonBody(request));
    const id = randomUUID();
    const timestamp = now();
    try {
      await client.execute({
        sql: `INSERT INTO vendor_categories
          (id,name,name_en,vendor_type,status,sort_order,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          id,
          input.name,
          input.nameEn,
          input.vendorType,
          input.status,
          input.sortOrder,
          user.id,
          timestamp,
          timestamp,
        ],
      });
    } catch {
      throw new ApiError(409, "CATEGORY_EXISTS", "Nama kategori vendor sudah digunakan.");
    }
    await writeAuditLog(client, request, user, "create", "vendor_category", id, input);
    return created({ id, ...input, vendorCount: 0 });
  }

  const currentResult = await client.execute({
    sql: `SELECT c.*,COUNT(a.vendor_id) AS vendor_count
      FROM vendor_categories c
      LEFT JOIN vendor_category_assignments a ON a.category_id=c.id
      WHERE c.id=? GROUP BY c.id LIMIT 1`,
    args: [categoryId],
  });
  const current = currentResult.rows[0];
  if (!current) {
    throw new ApiError(404, "NOT_FOUND", "Kategori vendor tidak ditemukan.");
  }

  if (request.method === "PATCH") {
    const input = vendorCategorySchema.partial().parse(await jsonBody(request));
    try {
      await client.execute({
        sql: `UPDATE vendor_categories SET name=?,name_en=?,vendor_type=?,
          status=?,sort_order=?,updated_at=? WHERE id=?`,
        args: [
          input.name ?? current.name,
          input.nameEn ?? current.name_en,
          input.vendorType ?? current.vendor_type,
          input.status ?? current.status,
          input.sortOrder ?? current.sort_order,
          now(),
          categoryId,
        ],
      });
    } catch {
      throw new ApiError(409, "CATEGORY_EXISTS", "Nama kategori vendor sudah digunakan.");
    }
    await writeAuditLog(client, request, user, "update", "vendor_category", categoryId, input);
    const updated = await client.execute({
      sql: `SELECT c.*,COUNT(a.vendor_id) AS vendor_count
        FROM vendor_categories c
        LEFT JOIN vendor_category_assignments a ON a.category_id=c.id
        WHERE c.id=? GROUP BY c.id LIMIT 1`,
      args: [categoryId],
    });
    return ok(mapCategory(updated.rows[0]));
  }

  if (request.method === "DELETE") {
    if (numberValue(current.vendor_count) > 0) {
      throw new ApiError(
        409,
        "CATEGORY_IN_USE",
        "Kategori sudah digunakan vendor. Nonaktifkan kategori agar histori tetap utuh.",
      );
    }
    await client.execute({
      sql: "DELETE FROM vendor_categories WHERE id=?",
      args: [categoryId],
    });
    await writeAuditLog(client, request, user, "delete", "vendor_category", categoryId);
    return noContent();
  }

  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

type OrderRow = Record<string, unknown>;

async function orderReleaseSummary(client: DatabaseClient, order: OrderRow) {
  const [paidResult, dpResult, verifiedResult, receivedResult] = await Promise.all([
    client.execute({
      sql: "SELECT COALESCE(SUM(amount),0) AS total FROM spk_payments WHERE spk_id=? AND status='Posted'",
      args: [order.id],
    }),
    client.execute({
      sql: "SELECT COALESCE(SUM(planned_amount),0) AS total FROM spk_payment_terms WHERE spk_id=? AND term_type='DP'",
      args: [order.id],
    }),
    client.execute({
      sql: "SELECT COALESCE(SUM(verified_amount),0) AS total FROM spk_verifications WHERE spk_id=?",
      args: [order.id],
    }),
    client.execute({
      sql: `SELECT COALESCE(SUM(ri.quantity*i.agreed_unit_cost),0) AS total
        FROM po_receipt_items ri
        JOIN po_receipts r ON r.id=ri.receipt_id
        JOIN spk_items i ON i.id=ri.spk_item_id
        WHERE r.spk_id=?`,
      args: [order.id],
    }),
  ]);
  const contract = numberValue(order.cost);
  const paid = numberValue(paidResult.rows[0]?.total);
  const dp = numberValue(dpResult.rows[0]?.total);
  const earned =
    String(order.document_type) === "PO"
      ? numberValue(receivedResult.rows[0]?.total)
      : numberValue(verifiedResult.rows[0]?.total);
  // Goods received already represent the earned portion of the full PO value,
  // so an advance is credited against (not added on top of) that earned value.
  // SPK verifications, by contrast, are recorded against non-DP terms only.
  const verifiedPayable =
    String(order.document_type) === "PO"
      ? Math.min(contract, Math.max(dp, earned))
      : Math.min(contract, dp + earned);
  return {
    paid,
    verifiedPayable,
    outstanding: Math.max(0, contract - paid),
    availableToPay: Math.max(0, verifiedPayable - paid),
    paymentStatus: paymentState(contract, paid),
  };
}

async function getOrder(client: DatabaseClient, orderId: string) {
  const result = await client.execute({
    sql: `SELECT s.*,v.name AS vendor_name,v.vendor_type,p.name AS project_name,
      p.code AS project_code,q.number AS quotation_number,bs.kind AS scope_kind,
      bs.title AS scope_title
      FROM spks s
      JOIN vendors v ON v.id=s.vendor_id
      JOIN projects p ON p.id=s.project_id
      LEFT JOIN quotations q ON q.id=s.quotation_id
      LEFT JOIN boq_scopes bs ON bs.id=q.scope_id
      WHERE s.id=? LIMIT 1`,
    args: [orderId],
  });
  const order = result.rows[0];
  if (!order) {
    throw new ApiError(404, "NOT_FOUND", "Dokumen procurement tidak ditemukan.");
  }
  const [items, terms, verifications, receipts, receiptItems, payments] =
    await Promise.all([
      client.execute({
        sql: "SELECT * FROM spk_items WHERE spk_id=? ORDER BY sort_order,created_at",
        args: [orderId],
      }),
      client.execute({
        sql: "SELECT * FROM spk_payment_terms WHERE spk_id=? ORDER BY sort_order,created_at",
        args: [orderId],
      }),
      client.execute({
        sql: `SELECT v.*,u.name AS verified_by_name
          FROM spk_verifications v
          LEFT JOIN users u ON u.id=v.verified_by
          WHERE v.spk_id=? ORDER BY v.verified_at`,
        args: [orderId],
      }),
      client.execute({
        sql: `SELECT r.*,u.name AS received_by_name
          FROM po_receipts r
          LEFT JOIN users u ON u.id=r.received_by
          WHERE r.spk_id=? ORDER BY r.received_at`,
        args: [orderId],
      }),
      client.execute({
        sql: `SELECT ri.*,r.spk_id
          FROM po_receipt_items ri
          JOIN po_receipts r ON r.id=ri.receipt_id
          WHERE r.spk_id=?`,
        args: [orderId],
      }),
      client.execute({
        sql: `SELECT pay.*,u.name AS created_by_name,a.bank_name,a.account_number_masked
          FROM spk_payments pay
          LEFT JOIN users u ON u.id=pay.created_by
          LEFT JOIN bank_accounts a ON a.id=pay.bank_account_id
          WHERE pay.spk_id=? ORDER BY pay.paid_date,pay.created_at`,
        args: [orderId],
      }),
    ]);
  const release = await orderReleaseSummary(client, order);
  return {
    id: String(order.id),
    number: String(order.number),
    documentType: String(order.document_type ?? "SPK"),
    vendorId: String(order.vendor_id),
    vendor: String(order.vendor_name),
    vendorType: String(order.vendor_type),
    projectId: String(order.project_id),
    project: String(order.project_name),
    projectCode: String(order.project_code),
    quotationId: order.quotation_id ? String(order.quotation_id) : null,
    quotationNumber: order.quotation_number ? String(order.quotation_number) : null,
    scopeKind: order.scope_kind ? String(order.scope_kind) : null,
    scopeTitle: order.scope_title ? String(order.scope_title) : null,
    scope: String(order.scope),
    cost: numberValue(order.cost),
    budgetCost: items.rows.reduce(
      (sum, item) =>
        sum + numberValue(item.quantity) * numberValue(item.budget_unit_cost),
      0,
    ),
    workflowStatus: String(order.workflow_status ?? order.status),
    approvalStatus: String(order.approval_status ?? "Draft"),
    startDate: order.start_date ? String(order.start_date) : null,
    endDate: order.end_date ? String(order.end_date) : null,
    legacy: numberValue(order.legacy_imported) === 1,
    createdBy: order.created_by ? String(order.created_by) : null,
    submittedBy: order.submitted_by ? String(order.submitted_by) : null,
    approvedBy: order.approved_by ? String(order.approved_by) : null,
    approvedAt: order.approved_at ? String(order.approved_at) : null,
    overrideReason: order.override_reason ? String(order.override_reason) : null,
    ...release,
    items: items.rows.map((item) => ({
      id: String(item.id),
      boqItemId: item.boq_item_id ? String(item.boq_item_id) : null,
      quotationId: item.quotation_id ? String(item.quotation_id) : null,
      description: String(item.description_snapshot),
      category: String(item.category_snapshot),
      quantity: numberValue(item.quantity),
      unit: String(item.unit),
      budgetUnitCost: numberValue(item.budget_unit_cost),
      agreedUnitCost: numberValue(item.agreed_unit_cost),
      total: numberValue(item.line_total),
      legacy: numberValue(item.legacy_item) === 1,
    })),
    terms: terms.rows.map((term) => ({
      id: String(term.id),
      label: String(term.label),
      type: String(term.term_type),
      percentage:
        term.percentage_bps === null || term.percentage_bps === undefined
          ? null
          : numberValue(term.percentage_bps) / 100,
      plannedAmount: numberValue(term.planned_amount),
      requiresVerification: numberValue(term.requires_verification) === 1,
      status: String(term.status),
    })),
    verifications: verifications.rows.map((verification) => ({
      id: String(verification.id),
      termId: verification.term_id ? String(verification.term_id) : null,
      verifiedAmount: numberValue(verification.verified_amount),
      progressPercentage:
        verification.progress_percentage === null
          ? null
          : numberValue(verification.progress_percentage),
      notes: verification.notes ? String(verification.notes) : "",
      verifiedBy: verification.verified_by_name
        ? String(verification.verified_by_name)
        : null,
      verifiedAt: String(verification.verified_at),
      attachmentName: verification.attachment_name
        ? String(verification.attachment_name)
        : null,
    })),
    receipts: receipts.rows.map((receipt) => ({
      id: String(receipt.id),
      receiptNumber: receipt.receipt_number
        ? String(receipt.receipt_number)
        : null,
      receivedAt: String(receipt.received_at),
      notes: receipt.notes ? String(receipt.notes) : "",
      receivedBy: receipt.received_by_name
        ? String(receipt.received_by_name)
        : null,
      attachmentName: receipt.attachment_name
        ? String(receipt.attachment_name)
        : null,
      items: receiptItems.rows
        .filter((item) => String(item.receipt_id) === String(receipt.id))
        .map((item) => ({
          spkItemId: String(item.spk_item_id),
          quantity: numberValue(item.quantity),
        })),
    })),
    payments: payments.rows.map((payment) => ({
      id: String(payment.id),
      termId: payment.term_id ? String(payment.term_id) : null,
      amount: numberValue(payment.amount),
      paidDate: String(payment.paid_date),
      vendorInvoiceNumber: String(payment.vendor_invoice_number),
      paymentReference: String(payment.payment_reference),
      paymentMethod: String(payment.payment_method),
      bankAccountId: payment.bank_account_id
        ? String(payment.bank_account_id)
        : null,
      bankAccount: payment.bank_name
        ? `${String(payment.bank_name)} ${String(payment.account_number_masked ?? "")}`.trim()
        : null,
      attachmentName: String(payment.attachment_name),
      status: String(payment.status),
      createdBy: payment.created_by_name
        ? String(payment.created_by_name)
        : null,
      voidReason: payment.void_reason ? String(payment.void_reason) : null,
    })),
  };
}

async function acceptedLine(
  client: DatabaseClient,
  quotationId: string,
  boqItemId: string,
) {
  const result = await client.execute({
    sql: `SELECT i.*,q.id AS quotation_id,q.project_id,q.status AS quotation_status,
      q.accepted_at,q.acceptance_attachment_name,s.kind AS scope_kind
      FROM boq_items i
      JOIN boq_scopes s ON s.id=i.scope_id
      JOIN quotations q ON q.scope_id=s.id
      WHERE q.id=? AND i.id=? LIMIT 1`,
    args: [quotationId, boqItemId],
  });
  const row = result.rows[0];
  if (
    !row ||
    String(row.quotation_status) !== "Accepted" ||
    !row.accepted_at ||
    !row.acceptance_attachment_name
  ) {
    throw new ApiError(
      409,
      "QUOTATION_NOT_ACCEPTED",
      "SPK/PO hanya dapat memakai item dari Quotation yang sudah diterima beserta bukti persetujuannya.",
    );
  }
  return row;
}

function termRows(
  orderId: string,
  cost: number,
  terms: z.infer<typeof orderSchema>["terms"],
  timestamp: string,
) {
  const normalized = terms.map((term, index) => {
    const bps =
      term.percentage === undefined ? null : Math.round(term.percentage * 100);
    const amount =
      term.amount ?? Math.round((cost * numberValue(bps)) / 10_000);
    return {
      id: randomUUID(),
      label: term.label,
      type: term.type,
      percentageBps: bps,
      amount,
      index,
    };
  });
  const total = normalized.reduce((sum, term) => sum + term.amount, 0);
  if (total !== cost) {
    throw new ApiError(
      422,
      "INVALID_TERM_TOTAL",
      `Total termin harus sama dengan nilai kontrak (${cost}). Nilai termin saat ini ${total}.`,
    );
  }
  return normalized.map((term) => ({
    sql: `INSERT INTO spk_payment_terms
      (id,spk_id,label,term_type,percentage_bps,planned_amount,
       requires_verification,sort_order,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      term.id,
      orderId,
      term.label,
      term.type,
      term.percentageBps,
      term.amount,
      term.type === "DP" ? 0 : 1,
      term.index,
      "Pending",
      timestamp,
      timestamp,
    ],
  }));
}

async function createOrder(
  request: Request,
  user: AuthUser,
  input: z.infer<typeof orderSchema>,
) {
  const { client } = await getDatabase();
  assertManage(user, "procurement");
  await assertProjectAccess(client, user, input.projectId);
  if (
    input.startDate &&
    input.endDate &&
    input.endDate < input.startDate
  ) {
    throw new ApiError(
      422,
      "INVALID_DATE_RANGE",
      "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.",
    );
  }
  const vendorResult = await client.execute({
    sql: "SELECT id,name,vendor_type,status FROM vendors WHERE id=? LIMIT 1",
    args: [input.vendorId],
  });
  const vendor = vendorResult.rows[0];
  if (!vendor || String(vendor.status) !== "Aktif") {
    throw new ApiError(404, "NOT_FOUND", "Vendor aktif tidak ditemukan.");
  }
  const vendorType = String(vendor.vendor_type);
  if (
    (input.documentType === "SPK" &&
      !["Jasa", "Hybrid"].includes(vendorType)) ||
    (input.documentType === "PO" &&
      !["Supplier", "Hybrid"].includes(vendorType))
  ) {
    throw new ApiError(
      409,
      "VENDOR_TYPE_MISMATCH",
      input.documentType === "SPK"
        ? "SPK memerlukan vendor bertipe Jasa atau Hybrid."
        : "PO memerlukan vendor bertipe Supplier atau Hybrid.",
    );
  }

  const uniqueItems = new Set(input.items.map((item) => item.boqItemId));
  if (uniqueItems.size !== input.items.length) {
    throw new ApiError(422, "DUPLICATE_ITEM", "Item BoQ tidak boleh dipilih dua kali.");
  }
  const sourceLines: Array<{
    input: (typeof input.items)[number];
    row: Record<string, unknown>;
  }> = [];
  for (const item of input.items) {
    const row = await acceptedLine(client, input.quotationId, item.boqItemId);
    if (String(row.project_id) !== input.projectId) {
      throw new ApiError(409, "PROJECT_MISMATCH", "Quotation tidak berasal dari proyek terpilih.");
    }
    const allowed =
      input.documentType === "SPK"
        ? ["Jasa", "Mobilitas"]
        : ["Perangkat", "Material"];
    if (!allowed.includes(String(row.category))) {
      throw new ApiError(
        409,
        "ITEM_TYPE_MISMATCH",
        input.documentType === "SPK"
          ? "SPK hanya dapat memakai item Jasa atau Mobilitas."
          : "PO hanya dapat memakai item Perangkat atau Material.",
      );
    }
    sourceLines.push({ input: item, row });
  }

  const cost = sourceLines.reduce(
    (sum, line) => sum + line.input.quantity * line.input.agreedUnitCost,
    0,
  );
  if (cost <= 0) {
    throw new ApiError(422, "INVALID_COMMITMENT", "Nilai komitmen vendor harus lebih dari nol.");
  }
  const timestamp = now();
  const id = randomUUID();
  const terms = termRows(id, cost, input.terms, timestamp);
  const createdOrder = await client.transaction(async (tx) => {
    await tx.execute({
      sql: "UPDATE quotations SET updated_at=updated_at WHERE id=?",
      args: [input.quotationId],
    });
    const accepted = await tx.execute({
      sql: `SELECT status,accepted_at,acceptance_attachment_name
        FROM quotations WHERE id=? LIMIT 1`,
      args: [input.quotationId],
    });
    if (
      String(accepted.rows[0]?.status) !== "Accepted" ||
      !accepted.rows[0]?.accepted_at ||
      !accepted.rows[0]?.acceptance_attachment_name
    ) {
      throw new ApiError(
        409,
        "QUOTATION_NOT_ACCEPTED",
        "Quotation tidak lagi berstatus Accepted atau bukti persetujuannya tidak lengkap.",
      );
    }
    for (const line of sourceLines) {
      // Portable no-op update acquires a write/row lock in libSQL and
      // PostgreSQL so two concurrent drafts cannot allocate the same balance.
      await tx.execute({
        sql: "UPDATE boq_items SET updated_at=updated_at WHERE id=?",
        args: [line.input.boqItemId],
      });
      const allocated = await tx.execute({
        sql: `SELECT COALESCE(SUM(i.quantity),0) AS total
          FROM spk_items i
          JOIN spks s ON s.id=i.spk_id
          WHERE i.boq_item_id=? AND s.workflow_status<>'Void'`,
        args: [line.input.boqItemId],
      });
      const available =
        numberValue(line.row.quantity) - numberValue(allocated.rows[0]?.total);
      if (line.input.quantity > available) {
        throw new ApiError(
          409,
          "BOQ_QUANTITY_EXCEEDED",
          `Alokasi ${String(line.row.description)} melebihi sisa kuantitas ${available}.`,
        );
      }
    }
    const count = await tx.execute({
      sql: "SELECT COUNT(*) AS count FROM spks WHERE document_type=?",
      args: [input.documentType],
    });
    const number = orderNumber(
      input.documentType,
      numberValue(count.rows[0]?.count),
    );
    await tx.execute({
      sql: `INSERT INTO spks
        (id,number,vendor_id,project_id,scope,cost,status,document_type,
         workflow_status,approval_status,quotation_id,created_by,
         payment_status,start_date,end_date,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id,
        number,
        input.vendorId,
        input.projectId,
        sourceLines.map((line) => String(line.row.description)).join("; "),
        cost,
        "Draft",
        input.documentType,
        "Draft",
        "Draft",
        input.quotationId,
        user.id,
        "Belum Dibayar",
        input.startDate ?? null,
        input.endDate ?? null,
        timestamp,
        timestamp,
      ],
    });
    await tx.batch(
      [
        ...sourceLines.map((line, index) => ({
          sql: `INSERT INTO spk_items
            (id,spk_id,boq_item_id,quotation_id,description_snapshot,
             category_snapshot,quantity,unit,budget_unit_cost,agreed_unit_cost,
             line_total,sort_order,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            randomUUID(),
            id,
            line.input.boqItemId,
            input.quotationId,
            line.row.description,
            line.row.category,
            line.input.quantity,
            line.row.unit,
            line.row.cost_price,
            line.input.agreedUnitCost,
            line.input.quantity * line.input.agreedUnitCost,
            index,
            timestamp,
            timestamp,
          ],
        })),
        ...terms,
      ],
      "write",
    );
    return { id, number };
  });
  await writeAuditLog(
    client,
    request,
    user,
    "create",
    "procurement_order",
    id,
    {
      ...input,
      cost,
      number: createdOrder.number,
    },
  );
  return getOrder(client, id);
}

async function updateDraftOrder(
  request: Request,
  user: AuthUser,
  orderId: string,
  input: z.infer<typeof orderSchema>,
) {
  const { client } = await getDatabase();
  assertManage(user, "procurement");
  const current = await getOrder(client, orderId);
  await assertProjectAccess(client, user, current.projectId);
  if (current.workflowStatus !== "Draft" || current.approvalStatus === "Approved") {
    throw new ApiError(409, "ORDER_LOCKED", "Hanya draft yang belum disetujui yang dapat diubah.");
  }
  if (current.projectId !== input.projectId) {
    throw new ApiError(409, "PROJECT_LOCKED", "Proyek sumber draft tidak dapat diubah.");
  }
  if (current.documentType !== input.documentType) {
    throw new ApiError(
      409,
      "DOCUMENT_TYPE_LOCKED",
      "Jenis dokumen dan nomor SPK/PO tidak dapat diubah. Hapus draft lalu buat dokumen baru.",
    );
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new ApiError(422, "INVALID_DATE_RANGE", "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.");
  }
  const vendorResult = await client.execute({
    sql: "SELECT id,name,vendor_type,status FROM vendors WHERE id=? LIMIT 1",
    args: [input.vendorId],
  });
  const vendor = vendorResult.rows[0];
  if (!vendor || String(vendor.status) !== "Aktif") {
    throw new ApiError(404, "NOT_FOUND", "Vendor aktif tidak ditemukan.");
  }
  const vendorType = String(vendor.vendor_type);
  if (
    (input.documentType === "SPK" && !["Jasa", "Hybrid"].includes(vendorType)) ||
    (input.documentType === "PO" && !["Supplier", "Hybrid"].includes(vendorType))
  ) {
    throw new ApiError(
      409,
      "VENDOR_TYPE_MISMATCH",
      input.documentType === "SPK"
        ? "SPK memerlukan vendor bertipe Jasa atau Hybrid."
        : "PO memerlukan vendor bertipe Supplier atau Hybrid.",
    );
  }
  const uniqueItems = new Set(input.items.map((item) => item.boqItemId));
  if (uniqueItems.size !== input.items.length) {
    throw new ApiError(422, "DUPLICATE_ITEM", "Item BoQ tidak boleh dipilih dua kali.");
  }
  const sourceLines: Array<{
    input: (typeof input.items)[number];
    row: Record<string, unknown>;
  }> = [];
  for (const item of input.items) {
    const row = await acceptedLine(client, input.quotationId, item.boqItemId);
    if (String(row.project_id) !== input.projectId) {
      throw new ApiError(409, "PROJECT_MISMATCH", "Quotation tidak berasal dari proyek terpilih.");
    }
    const allowed =
      input.documentType === "SPK"
        ? ["Jasa", "Mobilitas"]
        : ["Perangkat", "Material"];
    if (!allowed.includes(String(row.category))) {
      throw new ApiError(
        409,
        "ITEM_TYPE_MISMATCH",
        input.documentType === "SPK"
          ? "SPK hanya dapat memakai item Jasa atau Mobilitas."
          : "PO hanya dapat memakai item Perangkat atau Material.",
      );
    }
    sourceLines.push({ input: item, row });
  }
  const cost = sourceLines.reduce(
    (sum, line) => sum + line.input.quantity * line.input.agreedUnitCost,
    0,
  );
  if (cost <= 0) {
    throw new ApiError(422, "INVALID_COMMITMENT", "Nilai komitmen vendor harus lebih dari nol.");
  }
  const timestamp = now();
  const terms = termRows(orderId, cost, input.terms, timestamp);
  await client.transaction(async (tx) => {
    await tx.execute({
      sql: "UPDATE quotations SET updated_at=updated_at WHERE id=?",
      args: [input.quotationId],
    });
    const accepted = await tx.execute({
      sql: `SELECT status,accepted_at,acceptance_attachment_name
        FROM quotations WHERE id=? LIMIT 1`,
      args: [input.quotationId],
    });
    if (
      String(accepted.rows[0]?.status) !== "Accepted" ||
      !accepted.rows[0]?.accepted_at ||
      !accepted.rows[0]?.acceptance_attachment_name
    ) {
      throw new ApiError(
        409,
        "QUOTATION_NOT_ACCEPTED",
        "Quotation tidak lagi berstatus Accepted atau bukti persetujuannya tidak lengkap.",
      );
    }
    for (const line of sourceLines) {
      await tx.execute({
        sql: "UPDATE boq_items SET updated_at=updated_at WHERE id=?",
        args: [line.input.boqItemId],
      });
      const allocated = await tx.execute({
        sql: `SELECT COALESCE(SUM(i.quantity),0) AS total
          FROM spk_items i
          JOIN spks s ON s.id=i.spk_id
          WHERE i.boq_item_id=? AND s.id<>? AND s.workflow_status<>'Void'`,
        args: [line.input.boqItemId, orderId],
      });
      const available =
        numberValue(line.row.quantity) - numberValue(allocated.rows[0]?.total);
      if (line.input.quantity > available) {
        throw new ApiError(
          409,
          "BOQ_QUANTITY_EXCEEDED",
          `Alokasi ${String(line.row.description)} melebihi sisa kuantitas ${available}.`,
        );
      }
    }
    await tx.batch(
      [
        { sql: "DELETE FROM spk_payment_terms WHERE spk_id=?", args: [orderId] },
        { sql: "DELETE FROM spk_items WHERE spk_id=?", args: [orderId] },
        {
          sql: `UPDATE spks SET vendor_id=?,document_type=?,quotation_id=?,
            scope=?,cost=?,status='Draft',approval_status='Draft',
            start_date=?,end_date=?,updated_at=? WHERE id=?`,
          args: [
            input.vendorId,
            input.documentType,
            input.quotationId,
            sourceLines.map((line) => String(line.row.description)).join("; "),
            cost,
            input.startDate ?? null,
            input.endDate ?? null,
            timestamp,
            orderId,
          ],
        },
        ...sourceLines.map((line, index) => ({
          sql: `INSERT INTO spk_items
            (id,spk_id,boq_item_id,quotation_id,description_snapshot,
             category_snapshot,quantity,unit,budget_unit_cost,agreed_unit_cost,
             line_total,sort_order,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            randomUUID(),
            orderId,
            line.input.boqItemId,
            input.quotationId,
            line.row.description,
            line.row.category,
            line.input.quantity,
            line.row.unit,
            line.row.cost_price,
            line.input.agreedUnitCost,
            line.input.quantity * line.input.agreedUnitCost,
            index,
            timestamp,
            timestamp,
          ],
        })),
        ...terms,
      ],
      "write",
    );
  });
  await writeAuditLog(client, request, user, "update", "procurement_order", orderId, {
    ...input,
    cost,
  });
  return getOrder(client, orderId);
}

async function listOrders(
  client: DatabaseClient,
  user: AuthUser,
  projectId?: string | null,
) {
  if (projectId) await assertProjectAccess(client, user, projectId);
  const global = user.role === "Admin" || user.role === "Finance";
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (projectId) {
    conditions.push("s.project_id=?");
    args.push(projectId);
  }
  if (!global) {
    conditions.push(`EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id=s.project_id AND pm.user_id=?
    )`);
    args.push(user.id);
  }
  const result = await client.execute({
    sql: `SELECT s.id FROM spks s
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY s.created_at DESC`,
    args,
  });
  return Promise.all(result.rows.map((row) => getOrder(client, String(row.id))));
}

async function projectProcurementSummary(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string,
) {
  await assertProjectAccess(client, user, projectId);
  const result = await client.execute({
    sql: `SELECT
      COALESCE((SELECT SUM(i.quantity*i.cost_price)
        FROM boq_items i JOIN boqs b ON b.id=i.boq_id
        WHERE b.project_id=?),0) AS budget_boq,
      COALESCE((SELECT SUM(s.cost) FROM spks s
        WHERE s.project_id=? AND s.approval_status='Approved'
          AND s.workflow_status<>'Void'),0) AS committed,
      COALESCE((SELECT SUM(p.amount) FROM spk_payments p
        JOIN spks s ON s.id=p.spk_id
        WHERE s.project_id=? AND p.status='Posted'),0) AS paid`,
    args: [projectId, projectId, projectId],
  });
  const orders = await listOrders(client, user, projectId);
  const budget = numberValue(result.rows[0]?.budget_boq);
  const committed = numberValue(result.rows[0]?.committed);
  const paid = numberValue(result.rows[0]?.paid);
  const verified = orders
    .filter((order) => order.approvalStatus === "Approved" && order.workflowStatus !== "Void")
    .reduce((sum, order) => sum + order.verifiedPayable, 0);
  return {
    projectId,
    budgetBoq: budget,
    committedVendorCost: committed,
    verifiedPayable: verified,
    paid,
    outstanding: Math.max(0, committed - paid),
    variance: budget - committed,
  };
}

async function submitOrder(
  request: Request,
  user: AuthUser,
  orderId: string,
) {
  const { client } = await getDatabase();
  assertManage(user, "procurement");
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (order.workflowStatus !== "Draft") {
    throw new ApiError(409, "ORDER_LOCKED", "Hanya draft yang dapat dikirim untuk persetujuan.");
  }
  await client.execute({
    sql: `UPDATE spks SET workflow_status='Menunggu Persetujuan',
      approval_status='Pending',submitted_by=?,submitted_at=?,updated_at=? WHERE id=?`,
    args: [user.id, now(), now(), orderId],
  });
  await writeAuditLog(client, request, user, "submit", "procurement_order", orderId);
  return getOrder(client, orderId);
}

async function approveOrder(
  request: Request,
  user: AuthUser,
  orderId: string,
) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin atau Finance yang dapat menyetujui komitmen.");
  }
  assertManage(user, "procurement");
  const input = z
    .object({ overrideReason: z.string().trim().min(5).max(1_000).optional() })
    .parse(await jsonBody(request));
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (order.approvalStatus !== "Pending") {
    throw new ApiError(409, "INVALID_STATUS", "Dokumen belum menunggu persetujuan.");
  }
  const selfAuthored = order.createdBy === user.id || order.submittedBy === user.id;
  if (selfAuthored && user.role === "Finance") {
    throw new ApiError(
      409,
      "SELF_APPROVAL_FORBIDDEN",
      "Finance tidak boleh menyetujui draft yang dibuat atau diajukannya sendiri.",
    );
  }
  if (selfAuthored && user.role === "Admin" && !input.overrideReason) {
    throw new ApiError(
      422,
      "OVERRIDE_REASON_REQUIRED",
      "Admin wajib mengisi alasan saat menyetujui pengajuannya sendiri.",
    );
  }
  const timestamp = now();
  await client.execute({
    sql: `UPDATE spks SET workflow_status='Disetujui',approval_status='Approved',
      approved_by=?,approved_at=?,override_reason=?,updated_at=? WHERE id=?`,
    args: [
      user.id,
      timestamp,
      input.overrideReason ?? null,
      timestamp,
      orderId,
    ],
  });
  await writeAuditLog(client, request, user, "approve", "procurement_order", orderId, input);
  return getOrder(client, orderId);
}

async function sendOrder(request: Request, user: AuthUser, orderId: string) {
  const { client } = await getDatabase();
  assertManage(user, "procurement");
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (
    order.approvalStatus !== "Approved" ||
    order.workflowStatus !== "Disetujui"
  ) {
    throw new ApiError(
      409,
      "INVALID_STATUS",
      "Hanya dokumen Disetujui yang dapat dikirim.",
    );
  }
  await client.execute({
    sql: "UPDATE spks SET workflow_status='Dikirim',status='Dikirim',updated_at=? WHERE id=?",
    args: [now(), orderId],
  });
  await writeAuditLog(client, request, user, "send", "procurement_order", orderId);
  return getOrder(client, orderId);
}

async function rejectOrder(request: Request, user: AuthUser, orderId: string) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin atau Finance yang dapat menolak komitmen.");
  }
  assertManage(user, "procurement");
  const input = z
    .object({ reason: z.string().trim().min(5).max(1_000) })
    .parse(await jsonBody(request));
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (order.approvalStatus !== "Pending") {
    throw new ApiError(409, "INVALID_STATUS", "Dokumen belum menunggu persetujuan.");
  }
  await client.execute({
    sql: `UPDATE spks SET workflow_status='Draft',approval_status='Rejected',
      override_reason=?,updated_at=? WHERE id=?`,
    args: [input.reason, now(), orderId],
  });
  await writeAuditLog(client, request, user, "reject", "procurement_order", orderId, input);
  return getOrder(client, orderId);
}

async function completeOrder(request: Request, user: AuthUser, orderId: string) {
  assertManage(user, "procurement");
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (order.approvalStatus !== "Approved" || order.workflowStatus === "Void") {
    throw new ApiError(409, "INVALID_STATUS", "Dokumen aktif harus disetujui sebelum diselesaikan.");
  }
  if (order.documentType === "PO") {
    const complete = order.items.every((item) => {
      const received = order.receipts
        .flatMap((receipt) => receipt.items)
        .filter((receiptItem) => receiptItem.spkItemId === item.id)
        .reduce((sum, receiptItem) => sum + receiptItem.quantity, 0);
      return received >= item.quantity;
    });
    if (!complete) {
      throw new ApiError(409, "RECEIPT_INCOMPLETE", "Seluruh kuantitas PO harus diterima sebelum dokumen diselesaikan.");
    }
  } else {
    const nonDpTerms = order.terms.filter((term) => term.type !== "DP");
    const verified = nonDpTerms.every((term) => {
      const total = order.verifications
        .filter((item) => item.termId === term.id)
        .reduce((sum, item) => sum + item.verifiedAmount, 0);
      return total >= term.plannedAmount;
    });
    if (!verified) {
      throw new ApiError(409, "VERIFICATION_INCOMPLETE", "Seluruh termin non-DP harus diverifikasi sebelum SPK diselesaikan.");
    }
  }
  await client.execute({
    sql: "UPDATE spks SET workflow_status='Selesai',status='Selesai',updated_at=? WHERE id=?",
    args: [now(), orderId],
  });
  await writeAuditLog(client, request, user, "complete", "procurement_order", orderId);
  return getOrder(client, orderId);
}

async function voidOrder(request: Request, user: AuthUser, orderId: string) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin atau Finance yang dapat melakukan void dokumen.");
  }
  assertManage(user, "procurement");
  const input = z
    .object({ reason: z.string().trim().min(5).max(1_000) })
    .parse(await jsonBody(request));
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (order.workflowStatus === "Void") {
    throw new ApiError(409, "ALREADY_VOID", "Dokumen sudah berstatus Void.");
  }
  if (order.payments.some((payment) => payment.status === "Posted")) {
    throw new ApiError(
      409,
      "ACTIVE_PAYMENT_EXISTS",
      "Void seluruh pembayaran aktif terlebih dahulu sebelum melakukan void dokumen.",
    );
  }
  await client.execute({
    sql: `UPDATE spks SET workflow_status='Void',approval_status='Void',
      status='Void',override_reason=?,updated_at=? WHERE id=?`,
    args: [input.reason, now(), orderId],
  });
  await writeAuditLog(client, request, user, "void", "procurement_order", orderId, input);
  return getOrder(client, orderId);
}

async function verifyOrder(
  request: Request,
  user: AuthUser,
  orderId: string,
) {
  if (!["Project Manager", "Engineer"].includes(user.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Verifikasi progres wajib dilakukan Project Manager atau Engineer.",
    );
  }
  assertManage(user, "procurement");
  const input = verificationSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (
    order.documentType !== "SPK" ||
    order.approvalStatus !== "Approved" ||
    !["Dikirim", "Dikerjakan"].includes(order.workflowStatus)
  ) {
    throw new ApiError(409, "INVALID_ORDER", "Verifikasi progres hanya berlaku untuk SPK yang sudah dikirim.");
  }
  const term = order.terms.find((item) => item.id === input.termId);
  if (!term || term.type === "DP") {
    throw new ApiError(409, "INVALID_TERM", "Pilih termin jasa non-DP yang valid.");
  }
  const verified = order.verifications
    .filter((item) => item.termId === input.termId)
    .reduce((sum, item) => sum + item.verifiedAmount, 0);
  if (verified + input.verifiedAmount > term.plannedAmount) {
    throw new ApiError(409, "VERIFICATION_EXCEEDS_TERM", "Nilai verifikasi melebihi nilai termin.");
  }
  const id = randomUUID();
  const timestamp = now();
  await client.execute({
    sql: `INSERT INTO spk_verifications
      (id,spk_id,term_id,verified_amount,progress_percentage,notes,
       attachment_name,attachment_mime_type,attachment_content_base64,
       verified_by,verified_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      orderId,
      input.termId,
      input.verifiedAmount,
      input.progressPercentage ?? null,
      input.notes ?? null,
      input.attachment?.name ?? null,
      input.attachment?.mimeType ?? null,
      input.attachment?.contentBase64 ?? null,
      user.id,
      timestamp,
      timestamp,
    ],
  });
  await client.execute({
    sql: "UPDATE spks SET workflow_status='Dikerjakan',status='Dikerjakan',updated_at=? WHERE id=?",
    args: [timestamp, orderId],
  });
  await writeAuditLog(client, request, user, "verify_progress", "procurement_order", orderId, {
    verificationId: id,
    ...input,
    attachment: input.attachment ? { ...input.attachment, contentBase64: "[redacted]" } : undefined,
  });
  return getOrder(client, orderId);
}

async function receiveOrder(
  request: Request,
  user: AuthUser,
  orderId: string,
) {
  if (!["Project Manager", "Engineer"].includes(user.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Penerimaan barang wajib dilakukan Project Manager atau Engineer.",
    );
  }
  assertManage(user, "procurement");
  const input = receiptSchema.parse(await jsonBody(request));
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (
    order.documentType !== "PO" ||
    order.approvalStatus !== "Approved" ||
    !["Dikirim", "Diterima Sebagian"].includes(order.workflowStatus)
  ) {
    throw new ApiError(409, "INVALID_ORDER", "Penerimaan barang hanya berlaku untuk PO yang sudah dikirim.");
  }
  const unique = new Set(input.items.map((item) => item.spkItemId));
  if (unique.size !== input.items.length) {
    throw new ApiError(422, "DUPLICATE_ITEM", "Item penerimaan tidak boleh duplikat.");
  }
  const timestamp = now();
  const receiptId = randomUUID();
  await client.transaction(async (tx) => {
    for (const item of input.items) {
      await tx.execute({
        sql: "UPDATE spk_items SET updated_at=updated_at WHERE id=?",
        args: [item.spkItemId],
      });
      const orderItem = order.items.find((candidate) => candidate.id === item.spkItemId);
      if (!orderItem) {
        throw new ApiError(404, "NOT_FOUND", "Item PO tidak ditemukan.");
      }
      const previous = await tx.execute({
        sql: `SELECT COALESCE(SUM(ri.quantity),0) AS total
          FROM po_receipt_items ri
          JOIN po_receipts r ON r.id=ri.receipt_id
          WHERE r.spk_id=? AND ri.spk_item_id=?`,
        args: [orderId, item.spkItemId],
      });
      if (numberValue(previous.rows[0]?.total) + item.quantity > orderItem.quantity) {
        throw new ApiError(
          409,
          "RECEIPT_QUANTITY_EXCEEDED",
          `Penerimaan ${orderItem.description} melebihi kuantitas PO.`,
        );
      }
    }
    await tx.execute({
      sql: `INSERT INTO po_receipts
        (id,spk_id,receipt_number,received_at,notes,attachment_name,
         attachment_mime_type,attachment_content_base64,received_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        receiptId,
        orderId,
        input.receiptNumber ?? null,
        input.receivedAt,
        input.notes ?? null,
        input.attachment?.name ?? null,
        input.attachment?.mimeType ?? null,
        input.attachment?.contentBase64 ?? null,
        user.id,
        timestamp,
      ],
    });
    await tx.batch(
      input.items.map((item) => ({
        sql: "INSERT INTO po_receipt_items (id,receipt_id,spk_item_id,quantity,created_at) VALUES (?,?,?,?,?)",
        args: [randomUUID(), receiptId, item.spkItemId, item.quantity, timestamp],
      })),
      "write",
    );
  });
  const updated = await getOrder(client, orderId);
  const fullyReceived = updated.items.every((item) => {
    const received = updated.receipts
      .flatMap((receipt) => receipt.items)
      .filter((receiptItem) => receiptItem.spkItemId === item.id)
      .reduce((sum, receiptItem) => sum + receiptItem.quantity, 0);
    return received >= item.quantity;
  });
  await client.execute({
    sql: "UPDATE spks SET workflow_status=?,updated_at=? WHERE id=?",
    args: [fullyReceived ? "Diterima" : "Diterima Sebagian", now(), orderId],
  });
  await writeAuditLog(client, request, user, "receive_goods", "procurement_order", orderId, {
    receiptId,
    ...input,
    attachment: input.attachment ? { ...input.attachment, contentBase64: "[redacted]" } : undefined,
  });
  return getOrder(client, orderId);
}

async function payOrder(
  request: Request,
  user: AuthUser,
  orderId: string,
) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Pembayaran vendor hanya dapat dicatat Admin atau Finance.");
  }
  assertManage(user, "finance");
  const input = paymentSchema.parse(await jsonBody(request));
  if (input.paymentMethod === "Transfer Bank" && !input.bankAccountId) {
    throw new ApiError(
      422,
      "BANK_ACCOUNT_REQUIRED",
      "Pilih rekening perusahaan untuk pembayaran transfer bank.",
    );
  }
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  if (order.approvalStatus !== "Approved" || order.workflowStatus === "Void") {
    throw new ApiError(409, "APPROVAL_REQUIRED", "Dokumen harus aktif dan disetujui sebelum dibayar.");
  }
  if (input.termId && !order.terms.some((term) => term.id === input.termId)) {
    throw new ApiError(404, "NOT_FOUND", "Termin pembayaran tidak ditemukan.");
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
  const paymentId = randomUUID();
  const transactionId = randomUUID();
  const timestamp = now();
  await client.transaction(async (tx) => {
    await tx.execute({
      sql: "UPDATE spks SET updated_at=updated_at WHERE id=?",
      args: [orderId],
    });
    const current = await getOrder(tx, orderId);
    if (current.paid + input.amount > current.cost) {
      throw new ApiError(409, "OVERPAYMENT", "Pembayaran melebihi nilai kontrak vendor.");
    }
    if (current.paid + input.amount > current.verifiedPayable) {
      throw new ApiError(
        409,
        "PAYMENT_NOT_EARNED",
        "Nominal melebihi nilai yang sudah berhak dibayar. Verifikasi progres atau penerimaan barang terlebih dahulu.",
      );
    }
    await tx.execute({
      sql: `INSERT INTO transactions
        (id,project_id,date,type,description,amount,source,reference_id,category,
         created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        transactionId,
        current.projectId,
        input.paidDate,
        "Pengeluaran",
        `Pembayaran ${current.documentType} ${current.number} - ${current.vendor}`,
        input.amount,
        "Procurement Payment",
        paymentId,
        "Vendor",
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await tx.execute({
      sql: `INSERT INTO spk_payments
        (id,spk_id,term_id,amount,paid_date,vendor_invoice_number,
         payment_reference,payment_method,bank_account_id,attachment_name,
         attachment_mime_type,attachment_content_base64,status,transaction_id,
         created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        paymentId,
        orderId,
        input.termId ?? null,
        input.amount,
        input.paidDate,
        input.vendorInvoiceNumber,
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
  });
  await updateOrderPaymentCompatibility(client, orderId);
  await writeAuditLog(client, request, user, "pay", "procurement_order", orderId, {
    paymentId,
    ...input,
    attachment: { ...input.attachment, contentBase64: "[redacted]" },
  });
  return getOrder(client, orderId);
}

async function voidPayment(
  request: Request,
  user: AuthUser,
  orderId: string,
  paymentId: string,
) {
  if (user.role !== "Admin") {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat membatalkan pembayaran.");
  }
  assertManage(user, "finance");
  const input = z
    .object({ reason: z.string().trim().min(5).max(1_000) })
    .parse(await jsonBody(request));
  const { client } = await getDatabase();
  const order = await getOrder(client, orderId);
  await assertProjectAccess(client, user, order.projectId);
  const paymentResult = await client.execute({
    sql: "SELECT * FROM spk_payments WHERE id=? AND spk_id=? AND status='Posted' LIMIT 1",
    args: [paymentId, orderId],
  });
  const payment = paymentResult.rows[0];
  if (!payment) {
    throw new ApiError(404, "NOT_FOUND", "Pembayaran aktif tidak ditemukan.");
  }
  const reconciliation = await client.execute({
    sql: `SELECT id FROM bank_statement_entries
      WHERE transaction_id=? AND reconciliation_status='Matched' LIMIT 1`,
    args: [payment.transaction_id],
  });
  if (reconciliation.rows.length) {
    throw new ApiError(
      409,
      "PAYMENT_RECONCILED",
      "Lepaskan rekonsiliasi mutasi bank sebelum membatalkan pembayaran.",
    );
  }
  const timestamp = now();
  await client.transaction(async (tx) => {
    await tx.execute({
      sql: `UPDATE spk_payments SET status='Void',voided_by=?,voided_at=?,
        void_reason=?,updated_at=? WHERE id=?`,
      args: [user.id, timestamp, input.reason, timestamp, paymentId],
    });
    await tx.execute({
      sql: `INSERT INTO transactions
        (id,project_id,date,type,description,amount,source,reference_id,category,
         created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        randomUUID(),
        order.projectId,
        timestamp.slice(0, 10),
        "Pemasukan",
        `Reversal pembayaran ${order.documentType} ${order.number}`,
        payment.amount,
        "Procurement Reversal",
        `${paymentId}:void`,
        "Vendor",
        user.id,
        timestamp,
        timestamp,
      ],
    });
  });
  await updateOrderPaymentCompatibility(client, orderId);
  await writeAuditLog(client, request, user, "void_payment", "procurement_order", orderId, {
    paymentId,
    reason: input.reason,
  });
  return getOrder(client, orderId);
}

export async function handleProcurementOrders(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const orderId = path[1];
  const action = path[2];
  const childId = path[3];
  const childAction = path[4];
  const { client } = await getDatabase();

  if (request.method === "GET" && !orderId) {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (url.searchParams.get("summary") === "1") {
      if (!projectId) {
        throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
      }
      return ok(await projectProcurementSummary(client, user, projectId));
    }
    return ok(await listOrders(client, user, projectId));
  }

  if (request.method === "POST" && !orderId) {
    return created(
      await createOrder(request, user, orderSchema.parse(await jsonBody(request))),
    );
  }

  if (request.method === "PATCH" && orderId && !action) {
    return ok(
      await updateDraftOrder(
        request,
        user,
        orderId,
        orderSchema.parse(await jsonBody(request)),
      ),
    );
  }

  if (request.method === "GET" && orderId && !action) {
    const order = await getOrder(client, orderId);
    await assertProjectAccess(client, user, order.projectId);
    return ok(order);
  }

  if (request.method === "GET" && orderId && action === "pdf") {
    const order = await getOrder(client, orderId);
    await assertProjectAccess(client, user, order.projectId);
    return renderBusinessPdf("spk", orderId, user.preferredLanguage);
  }

  if (request.method === "POST" && orderId && action === "submit") {
    return ok(await submitOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "approve") {
    return ok(await approveOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "reject") {
    return ok(await rejectOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "send") {
    return ok(await sendOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "complete") {
    return ok(await completeOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "void") {
    return ok(await voidOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "verifications") {
    return created(await verifyOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "receipts") {
    return created(await receiveOrder(request, user, orderId));
  }
  if (request.method === "POST" && orderId && action === "payments" && !childId) {
    return created(await payOrder(request, user, orderId));
  }
  if (
    request.method === "POST" &&
    orderId &&
    action === "payments" &&
    childId &&
    childAction === "void"
  ) {
    return ok(await voidPayment(request, user, orderId, childId));
  }
  if (request.method === "DELETE" && orderId && !action) {
    assertManage(user, "procurement");
    const order = await getOrder(client, orderId);
    await assertProjectAccess(client, user, order.projectId);
    if (order.workflowStatus !== "Draft" || order.payments.length > 0) {
      throw new ApiError(409, "ORDER_LOCKED", "Hanya draft tanpa pembayaran yang dapat dihapus.");
    }
    await client.execute({ sql: "DELETE FROM spks WHERE id=?", args: [orderId] });
    await writeAuditLog(client, request, user, "delete", "procurement_order", orderId);
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint procurement tidak ditemukan.");
}
