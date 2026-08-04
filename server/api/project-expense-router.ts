import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { jsPDF } from "jspdf";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { claimSequence } from "../db/counters";
import { asNumber } from "../format";
import {
  deleteStoredFile,
  readStoredFile,
  storeUploadedFile,
} from "../storage";
import {
  ApiError,
  created,
  jsonBody,
  noContent,
  ok,
  partialPatchSchema,
} from "./errors";

const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneySchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const itemSchema = z.object({
  description: z.string().trim().min(2).max(240),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  unitPrice: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const paymentMethodSchema = z.enum(["Tunai", "QRIS", "Transfer Bank"]);
const expenseSchema = z.object({
  projectId: idSchema,
  purchaseDate: isoDateSchema,
  merchant: z.string().trim().min(2).max(180),
  categoryId: idSchema,
  totalAmount: moneySchema,
  fundingSource: z.enum(["CompanyAccount", "ProjectAdvance", "EmployeePaid"]),
  paymentMethod: paymentMethodSchema.optional().default("Tunai"),
  bankAccountId: idSchema.optional(),
  advanceId: idSchema.optional(),
  paidByUserId: idSchema.optional(),
  notes: z.string().trim().max(1_000).optional().default(""),
  itemDetails: z.array(itemSchema).max(100).optional().default([]),
});
const expensePatchSchema = partialPatchSchema(expenseSchema);
const submitSchema = z.object({ duplicateAcknowledged: z.boolean().default(false) });
const approvalSchema = z.object({
  settlementDate: isoDateSchema,
  bankAccountId: idSchema.optional(),
  advanceId: idSchema.optional(),
  paymentReference: z.string().trim().max(160).optional().default(""),
  duplicateAcknowledged: z.boolean().default(false),
  selfApprovalReason: z.string().trim().max(500).optional().default(""),
});
const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const voidSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const reimbursementSchema = z.object({
  amount: moneySchema,
  settlementDate: isoDateSchema,
  bankAccountId: idSchema,
  paymentReference: z.string().trim().min(2).max(160),
});
const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  status: z.enum(["Aktif", "Nonaktif"]).default("Aktif"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
const advanceSchema = z.object({
  projectId: idSchema,
  recipientUserId: idSchema,
  amount: moneySchema,
  disbursedDate: isoDateSchema,
  bankAccountId: idSchema,
  paymentReference: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(500).optional().default(""),
});
const advanceReturnSchema = z.object({
  amount: moneySchema,
  returnDate: isoDateSchema,
  bankAccountId: idSchema,
  paymentReference: z.string().trim().min(2).max(160),
});

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function now() {
  return new Date().toISOString();
}

function bool(value: unknown) {
  return value === true || Number(value) === 1;
}

function assertExpenseView(user: AuthUser) {
  if (
    !canAccess(user.permissions, "projects", "view") &&
    !canAccess(user.permissions, "finance", "view")
  ) {
    throw new ApiError(403, "FORBIDDEN", "Akun tidak memiliki akses belanja proyek.");
  }
}

function assertExpenseCreate(user: AuthUser) {
  if (
    !canAccess(user.permissions, "projects", "manage") &&
    !canAccess(user.permissions, "finance", "manage")
  ) {
    throw new ApiError(403, "FORBIDDEN", "Akun tidak dapat mencatat belanja proyek.");
  }
}

function assertFinanceManage(user: AuthUser) {
  if (
    !["Admin", "Finance"].includes(user.role) ||
    !canAccess(user.permissions, "finance", "manage")
  ) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin atau Finance berizin yang dapat memverifikasi belanja.");
  }
}

async function assertProjectAccess(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string,
) {
  if (["Admin", "Finance"].includes(user.role)) {
    const project = await client.execute({
      sql: "SELECT id FROM projects WHERE id=? LIMIT 1",
      args: [projectId],
    });
    if (project.rows.length) return;
  } else {
    const project = await client.execute({
      sql: `SELECT p.id FROM projects p
        WHERE p.id=? AND EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id=p.id AND pm.user_id=?
        ) LIMIT 1`,
      args: [projectId, user.id],
    });
    if (project.rows.length) return;
  }
  throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
}

function projectScope(user: AuthUser, alias = "p") {
  if (["Admin", "Finance"].includes(user.role)) {
    return { sql: "", args: [] as unknown[] };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM project_members pm_scope
      WHERE pm_scope.project_id=${alias}.id AND pm_scope.user_id=?)`,
    args: [user.id] as unknown[],
  };
}

async function requireExpense(
  client: DatabaseClient,
  user: AuthUser,
  expenseId: string,
) {
  const scope = projectScope(user, "p");
  const result = await client.execute({
    sql: `SELECT e.*,p.code AS project_code,p.name AS project_name,
      c.name AS category_name,c.name_en AS category_name_en,
      creator.name AS creator_name,approver.name AS approver_name,
      payer.name AS paid_by_name,
      ba.bank_name,ba.account_name,ba.account_number_masked,
      a.number AS advance_number
      FROM project_expenses e
      JOIN projects p ON p.id=e.project_id
      JOIN project_expense_categories c ON c.id=e.category_id
      JOIN users creator ON creator.id=e.created_by
      LEFT JOIN users approver ON approver.id=e.approved_by
      LEFT JOIN users payer ON payer.id=e.paid_by_user_id
      LEFT JOIN bank_accounts ba ON ba.id=e.bank_account_id
      LEFT JOIN project_advances a ON a.id=e.advance_id
      WHERE e.id=? ${scope.sql ? `AND ${scope.sql}` : ""} LIMIT 1`,
    args: [expenseId, ...scope.args],
  });
  if (!result.rows[0]) {
    throw new ApiError(404, "NOT_FOUND", "Pengajuan belanja tidak ditemukan.");
  }
  return result.rows[0];
}

async function attachmentsFor(client: DatabaseClient, expenseId: string) {
  const result = await client.execute({
    sql: `SELECT id,kind,name,mime_type,size,sha256,created_at
      FROM project_expense_attachments WHERE expense_id=? ORDER BY created_at`,
    args: [expenseId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    name: String(row.name),
    mimeType: String(row.mime_type),
    size: asNumber(row.size),
    sha256: String(row.sha256),
    createdAt: String(row.created_at),
    url: `/api/project-expenses/${expenseId}/attachments/${String(row.id)}`,
  }));
}

async function settlementsFor(client: DatabaseClient, expenseId: string) {
  const result = await client.execute({
    sql: `SELECT s.*,ba.bank_name,ba.account_name,ba.account_number_masked
      FROM project_expense_settlements s
      LEFT JOIN bank_accounts ba ON ba.id=s.bank_account_id
      WHERE s.expense_id=? ORDER BY s.settlement_date,s.created_at`,
    args: [expenseId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    type: String(row.settlement_type),
    amount: asNumber(row.amount),
    settlementDate: String(row.settlement_date),
    paymentReference: String(row.payment_reference),
    status: String(row.status),
    bankAccountId: row.bank_account_id ? String(row.bank_account_id) : undefined,
    bankAccount: row.bank_name
      ? `${String(row.bank_name)} · ${String(row.account_name)} ${String(row.account_number_masked ?? "")}`
      : undefined,
    transactionId: row.transaction_id ? String(row.transaction_id) : undefined,
  }));
}

async function eventsFor(client: DatabaseClient, expenseId: string) {
  const result = await client.execute({
    sql: `SELECT ev.*,u.name AS actor_name FROM project_expense_events ev
      LEFT JOIN users u ON u.id=ev.actor_id
      WHERE ev.expense_id=? ORDER BY ev.created_at`,
    args: [expenseId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    type: String(row.event_type),
    note: row.note ? String(row.note) : "",
    actor: row.actor_name ? String(row.actor_name) : "Sistem",
    createdAt: String(row.created_at),
  }));
}

async function mapExpense(
  client: DatabaseClient,
  row: Record<string, unknown>,
  detailed = false,
) {
  const expenseId = String(row.id);
  const settlements = await settlementsFor(client, expenseId);
  const reimbursed = settlements
    .filter((item) => item.type === "Reimbursement" && item.status === "Posted")
    .reduce((total, item) => total + item.amount, 0);
  const allocatedFromAdvance = settlements
    .filter((item) => item.type === "AdvanceAllocation" && item.status === "Posted")
    .reduce((total, item) => total + item.amount, 0);
  const approvedPayable =
    String(row.workflow_status) === "Approved" &&
    ["EmployeePaid", "ProjectAdvance"].includes(String(row.funding_source))
      ? Math.max(0, asNumber(row.total_amount) - allocatedFromAdvance)
      : 0;
  return {
    id: expenseId,
    number: String(row.number),
    projectId: String(row.project_id),
    projectCode: String(row.project_code),
    projectName: String(row.project_name),
    purchaseDate: String(row.purchase_date),
    merchant: String(row.merchant),
    categoryId: String(row.category_id),
    category: String(row.category_name),
    categoryEn: String(row.category_name_en),
    totalAmount: asNumber(row.total_amount),
    currency: String(row.currency),
    fundingSource: String(row.funding_source),
    paymentMethod: String(row.payment_method ?? "Tunai"),
    bankAccountId: row.bank_account_id ? String(row.bank_account_id) : undefined,
    bankAccount: row.bank_name
      ? `${String(row.bank_name)} · ${String(row.account_name)} ${String(row.account_number_masked ?? "")}`
      : undefined,
    advanceId: row.advance_id ? String(row.advance_id) : undefined,
    advanceNumber: row.advance_number ? String(row.advance_number) : undefined,
    notes: row.notes ? String(row.notes) : "",
    itemDetails: JSON.parse(String(row.item_details_json ?? "[]")),
    workflowStatus: String(row.workflow_status),
    settlementStatus: String(row.settlement_status),
    duplicateAcknowledged: bool(row.duplicate_acknowledged),
    reviewReason: row.review_reason ? String(row.review_reason) : "",
    selfApprovalReason: row.self_approval_reason
      ? String(row.self_approval_reason)
      : "",
    createdBy: String(row.created_by),
    creatorName: String(row.creator_name),
    submittedBy: row.submitted_by ? String(row.submitted_by) : undefined,
    // Old rows predate paid_by_user_id, so the submitter remains the creditor.
    paidByUserId: String(row.paid_by_user_id ?? row.created_by),
    paidByName: String(row.paid_by_name ?? row.creator_name),
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    approverName: row.approver_name ? String(row.approver_name) : undefined,
    reimbursedAmount: reimbursed,
    advanceAllocatedAmount: allocatedFromAdvance,
    reimbursementOutstanding: Math.max(0, approvedPayable - reimbursed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    attachments: detailed ? await attachmentsFor(client, expenseId) : undefined,
    settlements: detailed ? settlements : undefined,
    events: detailed ? await eventsFor(client, expenseId) : undefined,
  };
}

async function addEvent(
  client: DatabaseClient,
  expenseId: string,
  user: AuthUser,
  eventType: string,
  note?: string,
  metadata?: unknown,
) {
  await client.execute({
    sql: `INSERT INTO project_expense_events
      (id,expense_id,event_type,note,metadata_json,actor_id,created_at)
      VALUES (?,?,?,?,?,?,?)`,
    args: [
      randomUUID(),
      expenseId,
      eventType,
      note || null,
      metadata === undefined ? null : JSON.stringify(metadata),
      user.id,
      now(),
    ],
  });
}

async function duplicateWarnings(
  client: DatabaseClient,
  expense: Record<string, unknown>,
) {
  const similar = await client.execute({
    sql: `SELECT id,number FROM project_expenses
      WHERE id<>? AND project_id=? AND purchase_date=?
        AND lower(trim(merchant))=lower(trim(?)) AND total_amount=?
        AND workflow_status<>'Void' LIMIT 10`,
    args: [
      expense.id,
      expense.project_id,
      expense.purchase_date,
      expense.merchant,
      expense.total_amount,
    ],
  });
  const procurement = await client.execute({
    sql: `SELECT pay.id,o.number,v.name
      FROM spk_payments pay
      JOIN spks o ON o.id=pay.spk_id
      JOIN vendors v ON v.id=o.vendor_id
      WHERE o.project_id=? AND pay.paid_date=? AND pay.status='Posted'
        AND (pay.amount=? OR pay.gross_amount=?) LIMIT 10`,
    args: [
      expense.project_id,
      expense.purchase_date,
      expense.total_amount,
      expense.total_amount,
    ],
  });
  return [
    ...similar.rows.map((row) => ({
      type: "SimilarExpense",
      reference: String(row.number),
      message: `Nominal, tanggal, dan toko sama dengan ${String(row.number)}.`,
    })),
    ...procurement.rows.map((row) => ({
      type: "ProcurementPayment",
      reference: String(row.number),
      message: `Nominal dan tanggal sama dengan pembayaran ${String(row.number)} · ${String(row.name)}.`,
    })),
  ];
}

function assertMagicBytes(buffer: Buffer, mimeType: string) {
  const valid =
    (mimeType === "application/pdf" && buffer.subarray(0, 4).toString() === "%PDF") ||
    (mimeType === "image/png" && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") ||
    (mimeType === "image/jpeg" && buffer.subarray(0, 3).toString("hex") === "ffd8ff") ||
    (mimeType === "image/webp" && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP");
  if (!valid) {
    throw new ApiError(415, "INVALID_FILE_CONTENT", "Isi file tidak sesuai dengan tipe dokumen.");
  }
}

async function activeBankAccount(client: DatabaseClient, id?: string) {
  if (!id) {
    throw new ApiError(422, "BANK_ACCOUNT_REQUIRED", "Pilih rekening perusahaan.");
  }
  const result = await client.execute({
    sql: "SELECT id FROM bank_accounts WHERE id=? AND status='Aktif' LIMIT 1",
    args: [id],
  });
  if (!result.rows.length) {
    throw new ApiError(422, "BANK_ACCOUNT_REQUIRED", "Rekening perusahaan aktif tidak ditemukan.");
  }
  return id;
}

const advanceUnavailableMessage =
  "Belum ada uang muka aktif untuk proyek ini. Cairkan uang muka melalui menu Uang Muka terlebih dahulu.";

// Mirrors mapAdvance(): an advance is still usable while its disbursed amount
// exceeds everything already allocated to receipts or returned to the company.
async function outstandingAdvanceTotal(
  client: DatabaseClient,
  projectId: string,
) {
  const result = await client.execute({
    sql: `SELECT COALESCE(SUM(CASE
        WHEN a.amount - COALESCE(used.total,0) > 0
        THEN a.amount - COALESCE(used.total,0) ELSE 0 END),0) AS outstanding
      FROM project_advances a
      LEFT JOIN (
        SELECT advance_id,SUM(amount) AS total
        FROM project_expense_settlements
        WHERE status='Posted'
          AND settlement_type IN ('AdvanceAllocation','AdvanceReturn')
        GROUP BY advance_id
      ) used ON used.advance_id=a.id
      WHERE a.project_id=? AND a.status='Open'`,
    args: [projectId],
  });
  return asNumber(result.rows[0]?.outstanding);
}

// Decision context for the disbursement modal only — never a gate.
async function invoiceCashReceived(client: DatabaseClient, projectId: string) {
  const result = await client.execute({
    sql: `SELECT COALESCE(SUM(pay.cash_amount),0) AS total
      FROM invoice_payments pay
      JOIN invoices i ON i.id=pay.invoice_id
      WHERE i.project_id=? AND pay.status='Posted'`,
    args: [projectId],
  });
  return asNumber(result.rows[0]?.total);
}

async function assertFundingRules(
  client: DatabaseClient,
  input: {
    projectId: string;
    fundingSource: string;
    paymentMethod: string;
    bankAccountId?: string | null;
    submitterId: string;
    paidByUserId?: string | null;
  },
) {
  if (
    input.fundingSource === "CompanyAccount" &&
    input.paymentMethod === "Transfer Bank"
  ) {
    if (!input.bankAccountId) {
      throw new ApiError(
        422,
        "EXPENSE_BANK_ACCOUNT_REQUIRED",
        "Pilih rekening perusahaan untuk belanja yang dibayar lewat transfer bank.",
      );
    }
    const account = await client.execute({
      sql: "SELECT id FROM bank_accounts WHERE id=? AND status='Aktif' LIMIT 1",
      args: [input.bankAccountId],
    });
    if (!account.rows.length) {
      throw new ApiError(
        422,
        "EXPENSE_BANK_ACCOUNT_REQUIRED",
        "Rekening perusahaan aktif tidak ditemukan.",
      );
    }
  }
  if (input.fundingSource === "ProjectAdvance") {
    if ((await outstandingAdvanceTotal(client, input.projectId)) <= 0) {
      throw new ApiError(422, "ADVANCE_UNAVAILABLE", advanceUnavailableMessage);
    }
  }
  if (
    input.fundingSource === "EmployeePaid" &&
    input.paidByUserId &&
    input.paidByUserId !== input.submitterId
  ) {
    const member = await client.execute({
      sql: `SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
        WHERE pm.project_id=? AND pm.user_id=? AND u.status='Aktif' LIMIT 1`,
      args: [input.projectId, input.paidByUserId],
    });
    if (!member.rows.length) {
      throw new ApiError(
        422,
        "INVALID_EXPENSE_PAYER",
        "Pemilik dana pribadi harus pengaju sendiri atau anggota proyek yang aktif.",
      );
    }
  }
}

async function createSettlement(
  client: DatabaseClient,
  user: AuthUser,
  input: {
    expenseId?: string;
    advanceId?: string;
    type: "CompanyPayment" | "AdvanceAllocation" | "Reimbursement" | "AdvanceReturn" | "Reversal";
    amount: number;
    date: string;
    bankAccountId?: string;
    reference: string;
    projectId: string;
    description: string;
    transactionType?: "Pemasukan" | "Pengeluaran";
    createTransaction?: boolean;
  },
) {
  const settlementId = randomUUID();
  let transactionId: string | null = null;
  if (input.createTransaction) {
    transactionId = randomUUID();
    await client.execute({
      sql: `INSERT INTO transactions
        (id,project_id,date,type,description,amount,source,reference_id,category,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        transactionId,
        input.projectId,
        input.date,
        input.transactionType ?? "Pengeluaran",
        input.description,
        input.amount,
        input.type === "Reimbursement"
          ? "Project Expense Reimbursement"
          : input.type === "AdvanceReturn"
            ? "Project Advance Return"
            : input.type === "Reversal"
              ? "Project Expense Reversal"
              : "Project Expense",
        settlementId,
        "Operasional",
        user.id,
        now(),
        now(),
      ],
    });
  }
  await client.execute({
    sql: `INSERT INTO project_expense_settlements
      (id,expense_id,advance_id,settlement_type,amount,settlement_date,
       bank_account_id,payment_reference,transaction_id,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'Posted',?,?,?)`,
    args: [
      settlementId,
      input.expenseId ?? null,
      input.advanceId ?? null,
      input.type,
      input.amount,
      input.date,
      input.bankAccountId ?? null,
      input.reference,
      transactionId,
      user.id,
      now(),
      now(),
    ],
  });
  return { settlementId, transactionId };
}

async function handleAttachment(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const expenseId = path[1];
  const attachmentId = path[3];
  const expense = await requireExpense(client, user, expenseId);
  if (request.method === "GET" && attachmentId) {
    const result = await client.execute({
      sql: `SELECT * FROM project_expense_attachments
        WHERE id=? AND expense_id=? LIMIT 1`,
      args: [attachmentId, expenseId],
    });
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "NOT_FOUND", "Lampiran tidak ditemukan.");
    let content: ArrayBuffer;
    if (row.storage_url) {
      const stored = await readStoredFile(String(row.storage_url));
      if (!stored) throw new ApiError(404, "NOT_FOUND", "File tidak ditemukan pada storage.");
      content = stored.content;
    } else {
      const buffer = Buffer.from(String(row.content_base64 ?? ""), "base64");
      content = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    return new Response(content, {
      headers: {
        "Content-Type": String(row.mime_type),
        "Content-Disposition": `inline; filename="${String(row.name).replaceAll('"', "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (request.method === "POST" && !attachmentId) {
    assertExpenseCreate(user);
    if (!["Draft", "Rejected"].includes(String(expense.workflow_status))) {
      throw new ApiError(409, "EXPENSE_LOCKED", "Lampiran hanya dapat ditambah pada Draft atau pengajuan Ditolak.");
    }
    if (String(expense.created_by) !== user.id && !["Admin", "Finance"].includes(user.role)) {
      throw new ApiError(403, "FORBIDDEN", "Hanya pengaju yang dapat menambah lampiran.");
    }
    const count = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM project_expense_attachments WHERE expense_id=?",
      args: [expenseId],
    });
    if (asNumber(count.rows[0]?.count) >= 5) {
      throw new ApiError(409, "ATTACHMENT_LIMIT", "Maksimal lima bukti untuk satu pengajuan.");
    }
    const form = await request.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "Receipt");
    if (!(file instanceof File)) {
      throw new ApiError(422, "FILE_REQUIRED", "Pilih file bukti belanja.");
    }
    if (!allowedMimeTypes.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new ApiError(415, "INVALID_FILE", "Gunakan JPG, PNG, WebP, atau PDF maksimal 10 MB.");
    }
    if (!["Receipt", "Invoice", "PaymentProof", "Other"].includes(kind)) {
      throw new ApiError(422, "INVALID_ATTACHMENT_KIND", "Jenis lampiran tidak valid.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    assertMagicBytes(buffer, file.type);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicate = await client.execute({
      sql: `SELECT e.number FROM project_expense_attachments a
        JOIN project_expenses e ON e.id=a.expense_id
        WHERE a.sha256=? AND a.expense_id<>? AND e.workflow_status<>'Void' LIMIT 1`,
      args: [sha256, expenseId],
    });
    if (duplicate.rows[0]) {
      throw new ApiError(409, "DUPLICATE_RECEIPT", `File yang sama sudah digunakan pada ${String(duplicate.rows[0].number)}.`);
    }
    const attachmentIdNew = randomUUID();
    const stored = await storeUploadedFile(
      "project-expenses",
      attachmentIdNew,
      file.type,
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    await client.execute({
      sql: `INSERT INTO project_expense_attachments
        (id,expense_id,kind,name,mime_type,size,sha256,storage_url,content_base64,uploaded_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        attachmentIdNew,
        expenseId,
        kind,
        file.name.slice(0, 240),
        file.type,
        file.size,
        sha256,
        stored.storageUrl,
        stored.contentBase64,
        user.id,
        now(),
      ],
    });
    await addEvent(client, expenseId, user, "AttachmentAdded", file.name);
    await writeAuditLog(client, request, user, "upload", "project_expense_attachment", attachmentIdNew, {
      expenseId,
      kind,
      mimeType: file.type,
      size: file.size,
      sha256,
    });
    return created((await attachmentsFor(client, expenseId)).find((item) => item.id === attachmentIdNew));
  }
  if (request.method === "DELETE" && attachmentId) {
    assertExpenseCreate(user);
    if (!["Draft", "Rejected"].includes(String(expense.workflow_status))) {
      throw new ApiError(409, "EXPENSE_LOCKED", "Lampiran pengajuan yang sudah diproses tidak dapat dihapus.");
    }
    const result = await client.execute({
      sql: "SELECT storage_url FROM project_expense_attachments WHERE id=? AND expense_id=? LIMIT 1",
      args: [attachmentId, expenseId],
    });
    if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Lampiran tidak ditemukan.");
    await client.execute({
      sql: "DELETE FROM project_expense_attachments WHERE id=? AND expense_id=?",
      args: [attachmentId, expenseId],
    });
    await deleteStoredFile(result.rows[0].storage_url ? String(result.rows[0].storage_url) : null);
    await addEvent(client, expenseId, user, "AttachmentDeleted");
    await writeAuditLog(client, request, user, "delete", "project_expense_attachment", attachmentId, { expenseId });
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode lampiran tidak didukung.");
}

async function listRows(client: DatabaseClient, user: AuthUser, request: Request) {
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId");
  const status = params.get("status");
  const query = params.get("q")?.trim().toLowerCase();
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (projectId) {
    await assertProjectAccess(client, user, projectId);
    conditions.push("e.project_id=?");
    args.push(projectId);
  }
  if (status) {
    conditions.push("e.workflow_status=?");
    args.push(status);
  }
  if (query) {
    conditions.push("(lower(e.number) LIKE ? OR lower(e.merchant) LIKE ? OR lower(p.name) LIKE ? OR lower(creator.name) LIKE ?)");
    args.push(...Array(4).fill(`%${query}%`));
  }
  const scope = projectScope(user, "p");
  if (scope.sql) {
    conditions.push(scope.sql);
    args.push(...scope.args);
  }
  const result = await client.execute({
    sql: `SELECT e.*,p.code AS project_code,p.name AS project_name,
      c.name AS category_name,c.name_en AS category_name_en,
      creator.name AS creator_name,approver.name AS approver_name,
      payer.name AS paid_by_name,
      ba.bank_name,ba.account_name,ba.account_number_masked,
      a.number AS advance_number
      FROM project_expenses e
      JOIN projects p ON p.id=e.project_id
      JOIN project_expense_categories c ON c.id=e.category_id
      JOIN users creator ON creator.id=e.created_by
      LEFT JOIN users approver ON approver.id=e.approved_by
      LEFT JOIN users payer ON payer.id=e.paid_by_user_id
      LEFT JOIN bank_accounts ba ON ba.id=e.bank_account_id
      LEFT JOIN project_advances a ON a.id=e.advance_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY CASE e.workflow_status WHEN 'Submitted' THEN 0 WHEN 'Rejected' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END,
        e.purchase_date DESC,e.created_at DESC`,
    args,
  });
  return Promise.all(result.rows.map((row) => mapExpense(client, row)));
}

async function expenseReports(
  request: Request,
  user: AuthUser,
  format: "csv" | "pdf",
) {
  const { client } = await getDatabase();
  const rows = await listRows(client, user, request);
  const english = user.preferredLanguage === "en";
  if (format === "csv") {
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [
      [
        english ? "Number" : "Nomor",
        english ? "Purchase date" : "Tanggal belanja",
        english ? "Project" : "Proyek",
        english ? "Submitter" : "Pengaju",
        english ? "Merchant" : "Toko",
        english ? "Category" : "Kategori",
        english ? "Funding source" : "Sumber dana",
        english ? "Payment method" : "Metode pembayaran",
        english ? "Company account" : "Rekening perusahaan",
        english ? "Personal funds owner" : "Dana pribadi milik",
        english ? "Workflow status" : "Status pengajuan",
        english ? "Settlement status" : "Status penyelesaian",
        "Amount (IDR)",
        english ? "Reimbursement payable (IDR)" : "Utang reimbursement (IDR)",
      ].map(cell).join(","),
      ...rows.map((row) => [
        row.number,
        row.purchaseDate,
        `${row.projectCode} - ${row.projectName}`,
        row.creatorName,
        row.merchant,
        english ? row.categoryEn : row.category,
        row.fundingSource,
        row.paymentMethod,
        row.bankAccount ?? "",
        row.fundingSource === "EmployeePaid" ? row.paidByName : "",
        row.workflowStatus,
        row.settlementStatus,
        row.totalAmount,
        row.reimbursementOutstanding,
      ].map(cell).join(",")),
    ];
    return new Response(`\uFEFF${lines.join("\r\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${english ? "Project-Expenses" : "Belanja-Proyek"}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  pdf.setTextColor(12, 52, 65);
  pdf.text(english ? "Project Expense Report" : "Laporan Belanja Proyek", 14, 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(90, 112, 120);
  pdf.text(english ? "Audit history of field purchases" : "Riwayat audit pembelian lapangan", 14, 22);
  let y = 31;
  const headers = english
    ? ["Date", "Number", "Project", "Merchant", "Category", "Source / Method", "Funded by", "Status", "Amount"]
    : ["Tanggal", "Nomor", "Proyek", "Toko", "Kategori", "Sumber / Metode", "Dana milik", "Status", "Nominal"];
  const widths = [21, 30, 42, 36, 26, 36, 30, 30, 26];
  const drawRow = (values: string[], header = false) => {
    let x = 14;
    pdf.setFillColor(header ? 8 : 248, header ? 169 : 251, header ? 162 : 252);
    pdf.rect(14, y - 4, widths.reduce((a, b) => a + b, 0), 8, "F");
    pdf.setTextColor(header ? 255 : 25, header ? 255 : 55, header ? 255 : 66);
    pdf.setFont("helvetica", header ? "bold" : "normal");
    values.forEach((value, index) => {
      pdf.text(value.slice(0, index === 2 || index === 3 ? 28 : 20), x + 1.5, y, {
        align: index === values.length - 1 ? "right" : "left",
        maxWidth: widths[index] - 3,
      });
      x += widths[index];
    });
    y += 8;
  };
  drawRow(headers, true);
  for (const row of rows) {
    if (y > 190) {
      pdf.addPage("a4", "landscape");
      y = 18;
      drawRow(headers, true);
    }
    drawRow([
      row.purchaseDate,
      row.number,
      `${row.projectCode} - ${row.projectName}`,
      row.merchant,
      english ? row.categoryEn : row.category,
      `${row.fundingSource} / ${row.paymentMethod}`,
      row.fundingSource === "EmployeePaid" ? row.paidByName : "-",
      `${row.workflowStatus} / ${row.settlementStatus}`,
      new Intl.NumberFormat("id-ID").format(row.totalAmount),
    ]);
  }
  const body = pdf.output("arraybuffer");
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${english ? "Project-Expenses" : "Belanja-Proyek"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function handleProjectExpenses(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertExpenseView(user);
  const expenseId = path[1];
  const action = path[2];
  if (expenseId === "report.csv") return expenseReports(request, user, "csv");
  if (expenseId === "report.pdf") return expenseReports(request, user, "pdf");
  if (expenseId && action === "attachments") {
    return handleAttachment(request, path, user);
  }
  const { client } = await getDatabase();

  if (request.method === "GET" && !expenseId) {
    return ok(await listRows(client, user, request));
  }
  // Candidate owners of the personal funds behind an EmployeePaid receipt.
  // Reachable by anyone who may record an expense, unlike /access (Admin only)
  // and /project-advances/eligible-users (Finance only).
  if (request.method === "GET" && expenseId === "payers") {
    const payerProjectId = new URL(request.url).searchParams.get("projectId");
    if (!payerProjectId) {
      throw new ApiError(422, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    }
    await assertProjectAccess(client, user, payerProjectId);
    const members = await client.execute({
      sql: `SELECT DISTINCT u.id,u.name,u.role FROM users u
        WHERE u.status='Aktif' AND (
          u.id=? OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id=? AND pm.user_id=u.id
          )
        )
        ORDER BY u.name`,
      args: [user.id, payerProjectId],
    });
    return ok(members.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
    })));
  }
  if (request.method === "GET" && expenseId) {
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  if (request.method === "POST" && !expenseId) {
    assertExpenseCreate(user);
    const input = expenseSchema.parse(await jsonBody(request));
    await assertProjectAccess(client, user, input.projectId);
    const category = await client.execute({
      sql: "SELECT id FROM project_expense_categories WHERE id=? AND status='Aktif' LIMIT 1",
      args: [input.categoryId],
    });
    if (!category.rows.length) {
      throw new ApiError(422, "CATEGORY_REQUIRED", "Kategori biaya aktif tidak ditemukan.");
    }
    const paidByUserId =
      input.fundingSource === "EmployeePaid"
        ? input.paidByUserId ?? user.id
        : null;
    await assertFundingRules(client, {
      projectId: input.projectId,
      fundingSource: input.fundingSource,
      paymentMethod: input.paymentMethod,
      bankAccountId: input.bankAccountId,
      submitterId: user.id,
      paidByUserId,
    });
    const sequence = await claimSequence(client, "project_expenses", "SELECT number AS value FROM project_expenses");
    const id = randomUUID();
    const number = `BLJ-${input.purchaseDate.slice(0, 7).replace("-", "")}-${String(sequence).padStart(4, "0")}`;
    const timestamp = now();
    await client.execute({
      sql: `INSERT INTO project_expenses
        (id,number,project_id,purchase_date,merchant,category_id,total_amount,currency,
         funding_source,payment_method,bank_account_id,advance_id,paid_by_user_id,notes,
         item_details_json,workflow_status,settlement_status,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'IDR',?,?,?,?,?,?,?,'Draft','Unposted',?,?,?)`,
      args: [
        id,
        number,
        input.projectId,
        input.purchaseDate,
        input.merchant,
        input.categoryId,
        input.totalAmount,
        input.fundingSource,
        input.paymentMethod,
        input.bankAccountId ?? null,
        input.advanceId ?? null,
        paidByUserId,
        input.notes || null,
        JSON.stringify(input.itemDetails),
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await addEvent(client, id, user, "Created");
    await writeAuditLog(client, request, user, "create", "project_expense", id, {
      ...input,
      itemDetails: input.itemDetails.length,
    });
    return created(await mapExpense(client, await requireExpense(client, user, id), true));
  }
  if (!expenseId) throw new ApiError(404, "NOT_FOUND", "Endpoint belanja tidak ditemukan.");
  const expense = await requireExpense(client, user, expenseId);

  if (request.method === "PATCH" && !action) {
    assertExpenseCreate(user);
    if (!["Draft", "Rejected"].includes(String(expense.workflow_status))) {
      throw new ApiError(409, "EXPENSE_LOCKED", "Pengajuan yang sudah diproses tidak dapat diubah.");
    }
    if (String(expense.created_by) !== user.id && !["Admin", "Finance"].includes(user.role)) {
      throw new ApiError(403, "FORBIDDEN", "Hanya pengaju yang dapat mengubah data ini.");
    }
    const input = expensePatchSchema.parse(await jsonBody(request));
    if (input.projectId) await assertProjectAccess(client, user, input.projectId);
    if (input.categoryId) {
      const category = await client.execute({
        sql: "SELECT id FROM project_expense_categories WHERE id=? AND status='Aktif' LIMIT 1",
        args: [input.categoryId],
      });
      if (!category.rows.length) throw new ApiError(422, "CATEGORY_REQUIRED", "Kategori aktif tidak ditemukan.");
    }
    const projectIdNext = String(input.projectId ?? expense.project_id);
    const fundingSourceNext = String(input.fundingSource ?? expense.funding_source);
    const paymentMethodNext = String(
      input.paymentMethod ?? expense.payment_method ?? "Tunai",
    );
    const bankAccountIdNext =
      input.bankAccountId === undefined
        ? expense.bank_account_id
          ? String(expense.bank_account_id)
          : null
        : input.bankAccountId ?? null;
    const submitterId = String(expense.created_by);
    const paidByUserIdNext =
      fundingSourceNext === "EmployeePaid"
        ? input.paidByUserId ??
          (expense.paid_by_user_id ? String(expense.paid_by_user_id) : submitterId)
        : null;
    await assertFundingRules(client, {
      projectId: projectIdNext,
      fundingSource: fundingSourceNext,
      paymentMethod: paymentMethodNext,
      bankAccountId: bankAccountIdNext,
      submitterId,
      paidByUserId: paidByUserIdNext,
    });
    await client.execute({
      sql: `UPDATE project_expenses SET project_id=?,purchase_date=?,merchant=?,category_id=?,
        total_amount=?,funding_source=?,payment_method=?,bank_account_id=?,advance_id=?,
        paid_by_user_id=?,notes=?,item_details_json=?,
        workflow_status='Draft',review_reason=NULL,duplicate_acknowledged=0,updated_at=? WHERE id=?`,
      args: [
        projectIdNext,
        input.purchaseDate ?? expense.purchase_date,
        input.merchant ?? expense.merchant,
        input.categoryId ?? expense.category_id,
        input.totalAmount ?? expense.total_amount,
        fundingSourceNext,
        paymentMethodNext,
        bankAccountIdNext,
        input.advanceId === undefined ? expense.advance_id : input.advanceId ?? null,
        paidByUserIdNext,
        input.notes === undefined ? expense.notes : input.notes || null,
        input.itemDetails === undefined ? expense.item_details_json : JSON.stringify(input.itemDetails),
        now(),
        expenseId,
      ],
    });
    await addEvent(client, expenseId, user, "Updated");
    await writeAuditLog(client, request, user, "update", "project_expense", expenseId, input);
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  if (request.method === "DELETE" && !action) {
    assertExpenseCreate(user);
    if (!["Draft", "Rejected"].includes(String(expense.workflow_status))) {
      throw new ApiError(409, "EXPENSE_LOCKED", "Hanya Draft atau pengajuan Ditolak yang dapat dihapus.");
    }
    if (String(expense.created_by) !== user.id && user.role !== "Admin") {
      throw new ApiError(403, "FORBIDDEN", "Hanya pengaju atau Admin yang dapat menghapus Draft.");
    }
    const attachments = await client.execute({
      sql: "SELECT storage_url FROM project_expense_attachments WHERE expense_id=?",
      args: [expenseId],
    });
    await client.execute({ sql: "DELETE FROM project_expenses WHERE id=?", args: [expenseId] });
    await Promise.all(attachments.rows.map((row) => deleteStoredFile(row.storage_url ? String(row.storage_url) : null)));
    await writeAuditLog(client, request, user, "delete", "project_expense", expenseId, { number: expense.number });
    return noContent();
  }
  if (request.method === "POST" && action === "submit") {
    assertExpenseCreate(user);
    if (!["Draft", "Rejected"].includes(String(expense.workflow_status))) {
      throw new ApiError(409, "INVALID_STATUS", "Hanya Draft atau pengajuan Ditolak yang dapat diajukan.");
    }
    if (String(expense.created_by) !== user.id && !["Admin", "Finance"].includes(user.role)) {
      throw new ApiError(403, "FORBIDDEN", "Hanya pengaju yang dapat mengirim pengajuan.");
    }
    const input = submitSchema.parse(await jsonBody(request));
    await assertFundingRules(client, {
      projectId: String(expense.project_id),
      fundingSource: String(expense.funding_source),
      paymentMethod: String(expense.payment_method ?? "Tunai"),
      bankAccountId: expense.bank_account_id ? String(expense.bank_account_id) : null,
      submitterId: String(expense.created_by),
    });
    const attachmentCount = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM project_expense_attachments WHERE expense_id=?",
      args: [expenseId],
    });
    if (!asNumber(attachmentCount.rows[0]?.count)) {
      throw new ApiError(422, "RECEIPT_REQUIRED", "Unggah minimal satu nota atau invoice sebelum mengajukan.");
    }
    const warnings = await duplicateWarnings(client, expense);
    if (warnings.length && !input.duplicateAcknowledged) {
      throw new ApiError(409, "POSSIBLE_DUPLICATE", "Ditemukan kemungkinan pencatatan ganda.", { warnings });
    }
    await client.execute({
      sql: `UPDATE project_expenses SET workflow_status='Submitted',duplicate_acknowledged=?,
        submitted_by=?,submitted_at=?,review_reason=NULL,updated_at=? WHERE id=?`,
      args: [input.duplicateAcknowledged ? 1 : 0, user.id, now(), now(), expenseId],
    });
    await addEvent(client, expenseId, user, "Submitted", undefined, { warningCount: warnings.length });
    await writeAuditLog(client, request, user, "submit", "project_expense", expenseId, { warningCount: warnings.length });
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  if (request.method === "POST" && action === "reject") {
    assertFinanceManage(user);
    if (String(expense.workflow_status) !== "Submitted") {
      throw new ApiError(409, "INVALID_STATUS", "Hanya pengajuan Menunggu Verifikasi yang dapat ditolak.");
    }
    const input = rejectSchema.parse(await jsonBody(request));
    await client.execute({
      sql: `UPDATE project_expenses SET workflow_status='Rejected',review_reason=?,
        rejected_by=?,rejected_at=?,updated_at=? WHERE id=?`,
      args: [input.reason, user.id, now(), now(), expenseId],
    });
    await addEvent(client, expenseId, user, "Rejected", input.reason);
    await writeAuditLog(client, request, user, "reject", "project_expense", expenseId, input);
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  if (request.method === "POST" && action === "approve") {
    assertFinanceManage(user);
    if (String(expense.workflow_status) !== "Submitted") {
      throw new ApiError(409, "INVALID_STATUS", "Hanya pengajuan Menunggu Verifikasi yang dapat disetujui.");
    }
    const input = approvalSchema.parse(await jsonBody(request));
    // "Finance hanya approve, bukan berarti dia yang belanja": the approver may
    // never be the person who recorded, submitted, or fronted the money for the
    // expense. Same rule and same shape as procurement approvals — Finance is
    // blocked outright, Admin may override but must say why, in the audit log.
    const selfAuthored =
      String(expense.created_by) === user.id ||
      (expense.submitted_by ? String(expense.submitted_by) === user.id : false) ||
      String(expense.paid_by_user_id ?? expense.created_by) === user.id;
    if (selfAuthored && user.role === "Finance") {
      throw new ApiError(
        409,
        "SELF_APPROVAL_FORBIDDEN",
        "Finance tidak boleh menyetujui belanja yang dibuat, diajukan, atau ditalanginya sendiri.",
      );
    }
    if (selfAuthored && user.role === "Admin" && input.selfApprovalReason.trim().length < 5) {
      throw new ApiError(
        422,
        "OVERRIDE_REASON_REQUIRED",
        "Admin wajib mengisi alasan saat menyetujui pengajuannya sendiri.",
      );
    }
    const warnings = await duplicateWarnings(client, expense);
    if (warnings.length && !input.duplicateAcknowledged && !bool(expense.duplicate_acknowledged)) {
      throw new ApiError(409, "POSSIBLE_DUPLICATE", "Konfirmasi peringatan duplikasi sebelum menyetujui.", { warnings });
    }
    let settlementStatus = "Unposted";
    let bankAccountId: string | null = null;
    let advanceId: string | null = null;
    await client.transaction(async (tx) => {
      if (String(expense.funding_source) === "CompanyAccount") {
        // The account picked while capturing the receipt is the one the money
        // actually left, so it wins unless Finance overrides it on approval.
        bankAccountId = await activeBankAccount(
          tx,
          input.bankAccountId ??
            (expense.bank_account_id ? String(expense.bank_account_id) : undefined),
        );
        if (!input.paymentReference) throw new ApiError(422, "PAYMENT_REFERENCE_REQUIRED", "Isi referensi pembayaran perusahaan.");
        await createSettlement(tx, user, {
          expenseId,
          type: "CompanyPayment",
          amount: asNumber(expense.total_amount),
          date: input.settlementDate,
          bankAccountId,
          reference: input.paymentReference,
          projectId: String(expense.project_id),
          description: `Belanja proyek ${String(expense.number)} · ${String(expense.merchant)}`,
          createTransaction: true,
        });
        settlementStatus = "Posted";
      } else if (String(expense.funding_source) === "ProjectAdvance") {
        advanceId = input.advanceId ?? (expense.advance_id ? String(expense.advance_id) : null);
        if (!advanceId) throw new ApiError(422, "ADVANCE_REQUIRED", "Pilih uang muka proyek.");
        const advance = await tx.execute({
          sql: `SELECT a.*,
            COALESCE((SELECT SUM(s.amount) FROM project_expense_settlements s
              WHERE s.advance_id=a.id AND s.status='Posted'
                AND s.settlement_type IN ('AdvanceAllocation','AdvanceReturn')),0) AS used
            FROM project_advances a WHERE a.id=? AND a.project_id=? AND a.status='Open' LIMIT 1`,
          args: [advanceId, expense.project_id],
        });
        if (!advance.rows[0]) throw new ApiError(422, "ADVANCE_REQUIRED", "Uang muka aktif tidak ditemukan untuk proyek ini.");
        const available = asNumber(advance.rows[0].amount) - asNumber(advance.rows[0].used);
        const allocated = Math.min(asNumber(expense.total_amount), available);
        const reimbursementPayable = Math.max(0, asNumber(expense.total_amount) - allocated);
        if (allocated > 0) {
          await createSettlement(tx, user, {
            expenseId,
            advanceId,
            type: "AdvanceAllocation",
            amount: allocated,
            date: input.settlementDate,
            reference: input.paymentReference || String(advance.rows[0].number),
            projectId: String(expense.project_id),
            description: `Pertanggungjawaban ${String(expense.number)}`,
          });
        }
        if (allocated >= available) {
          await tx.execute({
            sql: "UPDATE project_advances SET status='Settled',updated_at=? WHERE id=?",
            args: [now(), advanceId],
          });
        }
        settlementStatus = reimbursementPayable > 0
          ? "AwaitingReimbursement"
          : "AdvanceSettled";
      } else {
        settlementStatus = "AwaitingReimbursement";
      }
      await tx.execute({
        sql: `UPDATE project_expenses SET workflow_status='Approved',settlement_status=?,
          bank_account_id=?,advance_id=?,duplicate_acknowledged=?,self_approval_reason=?,
          approved_by=?,approved_at=?,review_reason=NULL,updated_at=? WHERE id=?`,
        args: [
          settlementStatus,
          bankAccountId,
          advanceId,
          input.duplicateAcknowledged || bool(expense.duplicate_acknowledged) ? 1 : 0,
          input.selfApprovalReason || null,
          user.id,
          now(),
          now(),
          expenseId,
        ],
      });
      await addEvent(tx, expenseId, user, "Approved", input.selfApprovalReason || undefined, {
        settlementStatus,
        warningCount: warnings.length,
      });
    });
    await writeAuditLog(client, request, user, "approve", "project_expense", expenseId, {
      settlementStatus,
      warningCount: warnings.length,
      selfApproval: selfAuthored,
      overrideReason: selfAuthored ? input.selfApprovalReason.trim() : undefined,
    });
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  if (request.method === "POST" && action === "reimburse") {
    assertFinanceManage(user);
    if (
      String(expense.workflow_status) !== "Approved" ||
      !["EmployeePaid", "ProjectAdvance"].includes(String(expense.funding_source))
    ) {
      throw new ApiError(409, "INVALID_STATUS", "Hanya belanja talangan atau kelebihan uang muka yang dapat direimburse.");
    }
    const input = reimbursementSchema.parse(await jsonBody(request));
    await activeBankAccount(client, input.bankAccountId);
    const settlements = await settlementsFor(client, expenseId);
    const paid = settlements
      .filter((item) => item.type === "Reimbursement" && item.status === "Posted")
      .reduce((sum, item) => sum + item.amount, 0);
    const allocated = settlements
      .filter((item) => item.type === "AdvanceAllocation" && item.status === "Posted")
      .reduce((sum, item) => sum + item.amount, 0);
    const reimbursementPayable = Math.max(0, asNumber(expense.total_amount) - allocated);
    if (paid + input.amount > reimbursementPayable) {
      throw new ApiError(409, "OVERPAYMENT", "Reimbursement melebihi nilai belanja.", {
        outstanding: Math.max(0, reimbursementPayable - paid),
      });
    }
    await client.transaction(async (tx) => {
      await createSettlement(tx, user, {
        expenseId,
        type: "Reimbursement",
        amount: input.amount,
        date: input.settlementDate,
        bankAccountId: input.bankAccountId,
        reference: input.paymentReference,
        projectId: String(expense.project_id),
        description: `Reimbursement ${String(expense.number)} · ${String(
          expense.paid_by_name ?? expense.creator_name,
        )}`,
        createTransaction: true,
      });
      const nextPaid = paid + input.amount;
      await tx.execute({
        sql: "UPDATE project_expenses SET settlement_status=?,bank_account_id=?,updated_at=? WHERE id=?",
        args: [
          nextPaid >= reimbursementPayable ? "Reimbursed" : "PartiallyReimbursed",
          input.bankAccountId,
          now(),
          expenseId,
        ],
      });
      await addEvent(tx, expenseId, user, "Reimbursed", undefined, {
        amount: input.amount,
        reference: input.paymentReference,
      });
    });
    await writeAuditLog(client, request, user, "reimburse", "project_expense", expenseId, input);
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  if (request.method === "POST" && action === "void") {
    if (user.role !== "Admin" || !canAccess(user.permissions, "finance", "manage")) {
      throw new ApiError(403, "FORBIDDEN", "Hanya Admin yang dapat membatalkan belanja yang sudah disetujui.");
    }
    if (String(expense.workflow_status) !== "Approved") {
      throw new ApiError(409, "INVALID_STATUS", "Hanya belanja Disetujui yang dapat di-void.");
    }
    const input = voidSchema.parse(await jsonBody(request));
    const settlements = await client.execute({
      sql: `SELECT * FROM project_expense_settlements
        WHERE expense_id=? AND status='Posted' ORDER BY created_at`,
      args: [expenseId],
    });
    const transactionIds = settlements.rows
      .map((row) => row.transaction_id)
      .filter(Boolean);
    if (transactionIds.length) {
      const reconciled = await client.execute({
        sql: `SELECT id FROM bank_statement_entries
          WHERE transaction_id IN (${transactionIds.map(() => "?").join(",")})
            AND reconciliation_status='Matched' LIMIT 1`,
        args: transactionIds,
      });
      if (reconciled.rows.length) {
        throw new ApiError(409, "RECONCILIATION_LOCKED", "Lepaskan rekonsiliasi bank sebelum melakukan void.");
      }
    }
    await client.transaction(async (tx) => {
      for (const settlement of settlements.rows) {
        if (settlement.transaction_id) {
          const transaction = await tx.execute({
            sql: "SELECT * FROM transactions WHERE id=? LIMIT 1",
            args: [settlement.transaction_id],
          });
          if (transaction.rows[0]) {
            const original = transaction.rows[0];
            await createSettlement(tx, user, {
              expenseId,
              advanceId: settlement.advance_id ? String(settlement.advance_id) : undefined,
              type: "Reversal",
              amount: asNumber(original.amount),
              date: new Date().toISOString().slice(0, 10),
              bankAccountId: settlement.bank_account_id ? String(settlement.bank_account_id) : undefined,
              reference: `VOID-${String(expense.number)}`,
              projectId: String(expense.project_id),
              description: `Reversal ${String(expense.number)} · ${input.reason}`,
              transactionType: String(original.type) === "Pengeluaran" ? "Pemasukan" : "Pengeluaran",
              createTransaction: true,
            });
          }
        }
        await tx.execute({
          sql: "UPDATE project_expense_settlements SET status='Void',updated_at=? WHERE id=?",
          args: [now(), settlement.id],
        });
      }
      await tx.execute({
        sql: `UPDATE project_expenses SET workflow_status='Void',settlement_status='Void',
          voided_by=?,voided_at=?,void_reason=?,updated_at=? WHERE id=?`,
        args: [user.id, now(), input.reason, now(), expenseId],
      });
      await addEvent(tx, expenseId, user, "Void", input.reason);
    });
    await writeAuditLog(client, request, user, "void", "project_expense", expenseId, input);
    return ok(await mapExpense(client, await requireExpense(client, user, expenseId), true));
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint belanja proyek tidak ditemukan.");
}

export async function handleProjectExpenseCategories(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertExpenseView(user);
  const { client } = await getDatabase();
  const categoryId = path[1];
  if (request.method === "GET" && !categoryId) {
    const result = await client.execute(`SELECT c.*,
      (SELECT COUNT(*) FROM project_expenses e WHERE e.category_id=c.id) AS usage_count
      FROM project_expense_categories c ORDER BY c.status,c.sort_order,c.name`);
    return ok(result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      nameEn: String(row.name_en),
      status: String(row.status),
      sortOrder: asNumber(row.sort_order),
      usageCount: asNumber(row.usage_count),
    })));
  }
  assertFinanceManage(user);
  if (request.method === "POST" && !categoryId) {
    const input = categorySchema.parse(await jsonBody(request));
    const id = randomUUID();
    await client.execute({
      sql: `INSERT INTO project_expense_categories
        (id,name,name_en,status,sort_order,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      args: [id, input.name, input.nameEn, input.status, input.sortOrder, user.id, now(), now()],
    });
    await writeAuditLog(client, request, user, "create", "project_expense_category", id, input);
    return created({ id, ...input, usageCount: 0 });
  }
  if (!categoryId) throw new ApiError(404, "NOT_FOUND", "Kategori tidak ditemukan.");
  const current = await client.execute({
    sql: "SELECT * FROM project_expense_categories WHERE id=? LIMIT 1",
    args: [categoryId],
  });
  if (!current.rows[0]) throw new ApiError(404, "NOT_FOUND", "Kategori tidak ditemukan.");
  if (request.method === "PATCH") {
    // A plain `.partial()` re-applied the "Aktif" default, so renaming a
    // retired expense category quietly brought it back into circulation.
    const input = partialPatchSchema(categorySchema).parse(await jsonBody(request));
    await client.execute({
      sql: "UPDATE project_expense_categories SET name=?,name_en=?,status=?,sort_order=?,updated_at=? WHERE id=?",
      args: [
        input.name ?? current.rows[0].name,
        input.nameEn ?? current.rows[0].name_en,
        input.status ?? current.rows[0].status,
        input.sortOrder ?? current.rows[0].sort_order,
        now(),
        categoryId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "project_expense_category", categoryId, input);
    return ok({ id: categoryId });
  }
  if (request.method === "DELETE") {
    const usage = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM project_expenses WHERE category_id=?",
      args: [categoryId],
    });
    if (asNumber(usage.rows[0]?.count)) {
      throw new ApiError(409, "CATEGORY_IN_USE", "Kategori sudah digunakan dan hanya dapat dinonaktifkan.");
    }
    await client.execute({ sql: "DELETE FROM project_expense_categories WHERE id=?", args: [categoryId] });
    await writeAuditLog(client, request, user, "delete", "project_expense_category", categoryId);
    return noContent();
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode kategori tidak didukung.");
}

async function mapAdvance(client: DatabaseClient, row: Record<string, unknown>) {
  const totals = await client.execute({
    sql: `SELECT
      COALESCE(SUM(CASE WHEN settlement_type='AdvanceAllocation' AND status='Posted' THEN amount ELSE 0 END),0) AS allocated,
      COALESCE(SUM(CASE WHEN settlement_type='AdvanceReturn' AND status='Posted' THEN amount ELSE 0 END),0) AS returned
      FROM project_expense_settlements WHERE advance_id=?`,
    args: [row.id],
  });
  const allocated = asNumber(totals.rows[0]?.allocated);
  const returned = asNumber(totals.rows[0]?.returned);
  return {
    id: String(row.id),
    number: String(row.number),
    projectId: String(row.project_id),
    project: String(row.project_name),
    recipientUserId: String(row.recipient_user_id),
    recipient: String(row.recipient_name),
    amount: asNumber(row.amount),
    allocated,
    returned,
    outstanding: Math.max(0, asNumber(row.amount) - allocated - returned),
    disbursedDate: String(row.disbursed_date),
    bankAccountId: row.bank_account_id ? String(row.bank_account_id) : undefined,
    paymentReference: String(row.payment_reference),
    notes: row.notes ? String(row.notes) : "",
    status: String(row.status),
  };
}

export async function handleProjectAdvances(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertExpenseView(user);
  const { client } = await getDatabase();
  const advanceId = path[1];
  const action = path[2];
  if (request.method === "GET" && advanceId === "eligible-users") {
    assertFinanceManage(user);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) {
      throw new ApiError(422, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    }
    await assertProjectAccess(client, user, projectId);
    const result = await client.execute({
      sql: `SELECT DISTINCT u.id,u.name,u.email,u.role
        FROM project_members pm JOIN users u ON u.id=pm.user_id
        WHERE pm.project_id=? AND u.status='Aktif'
          AND u.role IN ('Project Manager','Engineer')
        ORDER BY u.name`,
      args: [projectId],
    });
    return ok({
      users: result.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        role: String(row.role),
      })),
      // Decision context for the disbursement modal. Informational only.
      invoiceCashReceived: await invoiceCashReceived(client, projectId),
      outstandingAdvance: await outstandingAdvanceTotal(client, projectId),
    });
  }
  if (request.method === "GET" && !advanceId) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (projectId) {
      await assertProjectAccess(client, user, projectId);
      conditions.push("a.project_id=?");
      args.push(projectId);
    }
    const scope = projectScope(user, "p");
    if (scope.sql) {
      conditions.push(scope.sql);
      args.push(...scope.args);
    }
    const result = await client.execute({
      sql: `SELECT a.*,p.name AS project_name,u.name AS recipient_name
        FROM project_advances a JOIN projects p ON p.id=a.project_id
        JOIN users u ON u.id=a.recipient_user_id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY a.disbursed_date DESC,a.created_at DESC`,
      args,
    });
    return ok(await Promise.all(result.rows.map((row) => mapAdvance(client, row))));
  }
  assertFinanceManage(user);
  if (request.method === "POST" && !advanceId) {
    const input = advanceSchema.parse(await jsonBody(request));
    await assertProjectAccess(client, user, input.projectId);
    await activeBankAccount(client, input.bankAccountId);
    const member = await client.execute({
      sql: "SELECT 1 FROM project_members WHERE project_id=? AND user_id=? LIMIT 1",
      args: [input.projectId, input.recipientUserId],
    });
    if (!member.rows.length) throw new ApiError(422, "INVALID_RECIPIENT", "Penerima uang muka bukan anggota proyek.");
    const sequence = await claimSequence(client, "project_advances", "SELECT number AS value FROM project_advances");
    const id = randomUUID();
    const transactionId = randomUUID();
    const number = `UM-${input.disbursedDate.slice(0, 7).replace("-", "")}-${String(sequence).padStart(4, "0")}`;
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO transactions
          (id,project_id,date,type,description,amount,source,reference_id,category,created_by,created_at,updated_at)
          VALUES (?,? ,?,'Pengeluaran',?,?,'Project Advance',?,'Operasional',?,?,?)`,
        args: [transactionId, input.projectId, input.disbursedDate, `Uang muka proyek ${number}`, input.amount, id, user.id, now(), now()],
      });
      await tx.execute({
        sql: `INSERT INTO project_advances
          (id,number,project_id,recipient_user_id,amount,disbursed_date,bank_account_id,
           payment_reference,notes,status,transaction_id,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'Open',?,?,?,?)`,
        args: [id, number, input.projectId, input.recipientUserId, input.amount, input.disbursedDate,
          input.bankAccountId, input.paymentReference, input.notes || null, transactionId, user.id, now(), now()],
      });
    });
    await writeAuditLog(client, request, user, "create", "project_advance", id, input);
    const row = await client.execute({
      sql: `SELECT a.*,p.name AS project_name,u.name AS recipient_name
        FROM project_advances a JOIN projects p ON p.id=a.project_id
        JOIN users u ON u.id=a.recipient_user_id WHERE a.id=?`,
      args: [id],
    });
    return created(await mapAdvance(client, row.rows[0]));
  }
  if (!advanceId) throw new ApiError(404, "NOT_FOUND", "Uang muka tidak ditemukan.");
  const result = await client.execute({
    sql: `SELECT a.*,p.name AS project_name,u.name AS recipient_name
      FROM project_advances a JOIN projects p ON p.id=a.project_id
      JOIN users u ON u.id=a.recipient_user_id WHERE a.id=? LIMIT 1`,
    args: [advanceId],
  });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Uang muka tidak ditemukan.");
  const advance = await mapAdvance(client, result.rows[0]);
  if (request.method === "POST" && action === "return") {
    if (advance.status !== "Open") throw new ApiError(409, "INVALID_STATUS", "Uang muka sudah ditutup.");
    const input = advanceReturnSchema.parse(await jsonBody(request));
    if (input.amount > advance.outstanding) {
      throw new ApiError(409, "ADVANCE_RETURN_EXCEEDED", "Pengembalian melebihi saldo uang muka.", { outstanding: advance.outstanding });
    }
    await activeBankAccount(client, input.bankAccountId);
    await client.transaction(async (tx) => {
      await createSettlement(tx, user, {
        advanceId,
        type: "AdvanceReturn",
        amount: input.amount,
        date: input.returnDate,
        bankAccountId: input.bankAccountId,
        reference: input.paymentReference,
        projectId: advance.projectId,
        description: `Pengembalian uang muka ${advance.number}`,
        transactionType: "Pemasukan",
        createTransaction: true,
      });
      if (input.amount >= advance.outstanding) {
        await tx.execute({
          sql: "UPDATE project_advances SET status='Settled',updated_at=? WHERE id=?",
          args: [now(), advanceId],
        });
      }
    });
    await writeAuditLog(client, request, user, "return", "project_advance", advanceId, input);
    const updated = await client.execute({
      sql: `SELECT a.*,p.name AS project_name,u.name AS recipient_name
        FROM project_advances a JOIN projects p ON p.id=a.project_id
        JOIN users u ON u.id=a.recipient_user_id WHERE a.id=?`,
      args: [advanceId],
    });
    return ok(await mapAdvance(client, updated.rows[0]));
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint uang muka tidak ditemukan.");
}
