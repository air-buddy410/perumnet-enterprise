import "server-only";

import { randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { asNumber } from "../format";
import {
  ApiError,
  created,
  jsonBody,
  noContent,
  ok,
} from "./errors";

const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const allocationSchema = z.object({
  projectId: idSchema,
  recipientUserId: idSchema.optional(),
  recipientName: z.string().trim().min(2).max(120),
  percentage: z.number().positive().max(100),
  notes: z.string().trim().max(500).optional().default(""),
});
const allocationUpdateSchema = allocationSchema
  .omit({ projectId: true })
  .partial();
const paymentSchema = z.object({
  paidDate: isoDateSchema,
});

function assertFinanceManager(user: AuthUser) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Pembagian keuntungan hanya dapat dikelola oleh Admin dan Finance.",
    );
  }
  if (!canAccess(user.permissions, "finance", "manage")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Akun Anda tidak memiliki izin untuk mengelola keuangan.",
    );
  }
}

async function requireProject(client: DatabaseClient, projectId: string) {
  const result = await client.execute({
    sql: "SELECT id,code,name,client FROM projects WHERE id=? LIMIT 1",
    args: [projectId],
  });
  if (!result.rows[0]) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
  return result.rows[0];
}

async function operatingProfit(client: DatabaseClient, projectId: string) {
  const result = await client.execute({
    sql: `
      SELECT
        COALESCE(SUM(CASE WHEN type='Pemasukan' THEN amount ELSE 0 END),0) AS income,
        COALESCE(SUM(CASE
          WHEN type='Pengeluaran' AND source NOT IN ('Profit Share','Profit Share Reversal')
          THEN amount ELSE 0 END),0) AS expense
      FROM transactions
      WHERE project_id=?
    `,
    args: [projectId],
  });
  const income = asNumber(result.rows[0]?.income);
  const expense = asNumber(result.rows[0]?.expense);
  const commitments = await client.execute({
    sql: `SELECT
      COALESCE(SUM(s.cost + COALESCE((
        SELECT SUM(dt.amount) FROM document_taxes dt
        WHERE dt.document_id=s.id
          AND dt.document_type=s.document_type
          AND dt.effect='Add'
      ),0)),0) AS committed,
      COALESCE(SUM((
        SELECT COALESCE(SUM(CASE WHEN pay.gross_amount>0
          THEN pay.gross_amount ELSE pay.amount END),0)
        FROM spk_payments pay
        WHERE pay.spk_id=s.id AND pay.status='Posted'
      )),0) AS paid
      FROM spks s
      WHERE s.project_id=? AND s.approval_status='Approved'
        AND s.workflow_status<>'Void'`,
    args: [projectId],
  });
  const committedVendorCost = asNumber(commitments.rows[0]?.committed);
  const paidVendorCost = asNumber(commitments.rows[0]?.paid);
  const outstandingVendorCommitment = Math.max(
    0,
    committedVendorCost - paidVendorCost,
  );
  const taxPosition = await client.execute({
    sql: `SELECT
      COALESCE(SUM(CASE WHEN o.direction='Payable' AND o.status<>'Void'
        THEN o.amount-o.settled_amount ELSE 0 END),0) AS outstanding_payable
      FROM document_taxes dt
      LEFT JOIN tax_obligations o ON o.document_tax_id=dt.id
      WHERE dt.project_id=? AND dt.locked=1`,
    args: [projectId],
  });
  const recoverableRows = await client.execute({
    sql: `SELECT s.cost,
      COALESCE((SELECT SUM(dt.amount) FROM document_taxes dt
        WHERE dt.document_id=s.id AND dt.document_type=s.document_type
          AND dt.effect='Add'),0) AS additions,
      COALESCE((SELECT SUM(dt.amount) FROM document_taxes dt
        WHERE dt.document_id=s.id AND dt.document_type=s.document_type
          AND dt.accounting_treatment='Recoverable'),0) AS recoverable,
      COALESCE((SELECT SUM(CASE WHEN pay.gross_amount>0
        THEN pay.gross_amount ELSE pay.amount END)
        FROM spk_payments pay
        WHERE pay.spk_id=s.id AND pay.status='Posted'),0) AS paid
      FROM spks s
      WHERE s.project_id=? AND s.approval_status='Approved'
        AND s.workflow_status<>'Void'`,
    args: [projectId],
  });
  const outstandingTaxPayable = asNumber(
    taxPosition.rows[0]?.outstanding_payable,
  );
  const recoverableTax = recoverableRows.rows.reduce((sum, row) => {
    const gross = asNumber(row.cost) + asNumber(row.additions);
    const ratio = gross > 0 ? Math.min(1, asNumber(row.paid) / gross) : 0;
    return sum + Math.round(asNumber(row.recoverable) * ratio);
  }, 0);
  const netProfit = income - expense + recoverableTax;
  return {
    income,
    expense,
    netProfit,
    committedVendorCost,
    paidVendorCost,
    outstandingVendorCommitment,
    outstandingTaxPayable,
    recoverableTax,
    distributableProfit:
      netProfit - outstandingVendorCommitment - outstandingTaxPayable,
  };
}

async function activePercentage(
  client: DatabaseClient,
  projectId: string,
  excludeId?: string,
) {
  const result = await client.execute({
    sql: `
      SELECT COALESCE(SUM(percentage_bps),0) AS total
      FROM project_profit_shares
      WHERE project_id=? AND status<>'Void'
        ${excludeId ? "AND id<>?" : ""}
    `,
    args: excludeId ? [projectId, excludeId] : [projectId],
  });
  return asNumber(result.rows[0]?.total);
}

function mapShare(row: Record<string, unknown>, previewNet: number) {
  const percentageBps = asNumber(row.percentage_bps);
  const status = String(row.status);
  const lockedAmount = asNumber(row.amount);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    recipientUserId: row.recipient_user_id
      ? String(row.recipient_user_id)
      : undefined,
    recipientName: String(row.recipient_name),
    percentage: percentageBps / 100,
    amount:
      status === "Draft"
        ? Math.max(0, Math.floor((previewNet * percentageBps) / 10_000))
        : lockedAmount,
    status,
    notes: row.notes ? String(row.notes) : "",
    paidDate: row.paid_date ? String(row.paid_date) : undefined,
    transactionId: row.transaction_id
      ? String(row.transaction_id)
      : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function summary(client: DatabaseClient, projectId: string) {
  const project = await requireProject(client, projectId);
  const profit = await operatingProfit(client, projectId);
  const result = await client.execute({
    sql: `
      SELECT *
      FROM project_profit_shares
      WHERE project_id=?
      ORDER BY
        CASE status WHEN 'Draft' THEN 0 WHEN 'Approved' THEN 1 WHEN 'Paid' THEN 2 ELSE 3 END,
        created_at
    `,
    args: [projectId],
  });
  const allocations = result.rows.map((row) =>
    mapShare(row as Record<string, unknown>, profit.distributableProfit),
  );
  const active = allocations.filter((item) => item.status !== "Void");
  const allocatedAmount = active.reduce((total, item) => total + item.amount, 0);
  const paidAmount = active
    .filter((item) => item.status === "Paid")
    .reduce((total, item) => total + item.amount, 0);
  return {
    project: {
      id: String(project.id),
      code: String(project.code),
      name: String(project.name),
      client: String(project.client),
    },
    ...profit,
    allocatedPercentage: active.reduce(
      (total, item) => total + item.percentage,
      0,
    ),
    allocatedAmount,
    paidAmount,
    retainedProfit: profit.distributableProfit - allocatedAmount,
    allocations,
  };
}

async function findShare(client: DatabaseClient, id: string) {
  const result = await client.execute({
    sql: "SELECT * FROM project_profit_shares WHERE id=? LIMIT 1",
    args: [id],
  });
  if (!result.rows[0]) {
    throw new ApiError(404, "NOT_FOUND", "Pembagian keuntungan tidak ditemukan.");
  }
  return result.rows[0];
}

export async function handleProfitShares(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertFinanceManager(user);
  const { client } = await getDatabase();
  const shareId = path[1];
  const action = path[2];

  if (request.method === "GET" && !shareId) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) {
      throw new ApiError(
        422,
        "PROJECT_REQUIRED",
        "Pilih proyek untuk melihat pembagian keuntungan.",
      );
    }
    return ok(await summary(client, projectId));
  }

  if (request.method === "POST" && !shareId) {
    const input = allocationSchema.parse(await jsonBody(request));
    await requireProject(client, input.projectId);
    if (input.recipientUserId) {
      const userResult = await client.execute({
        sql: "SELECT id FROM users WHERE id=? AND status='Aktif' LIMIT 1",
        args: [input.recipientUserId],
      });
      if (!userResult.rows.length) {
        throw new ApiError(
          422,
          "INVALID_RECIPIENT",
          "Pengguna penerima tidak ditemukan atau tidak aktif.",
        );
      }
    }
    const percentageBps = Math.round(input.percentage * 100);
    if (
      (await activePercentage(client, input.projectId)) + percentageBps >
      10_000
    ) {
      throw new ApiError(
        409,
        "PROFIT_SHARE_EXCEEDS_100_PERCENT",
        "Total pembagian keuntungan tidak boleh melebihi 100%.",
      );
    }
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `
        INSERT INTO project_profit_shares
          (id,project_id,recipient_user_id,recipient_name,percentage_bps,amount,status,notes,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,0,'Draft',?,?,?,?)
      `,
      args: [
        id,
        input.projectId,
        input.recipientUserId ?? null,
        input.recipientName,
        percentageBps,
        input.notes || null,
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await writeAuditLog(client, request, user, "create", "profit_share", id, {
      projectId: input.projectId,
      percentage: input.percentage,
      recipientName: input.recipientName,
    });
    const response = await summary(client, input.projectId);
    return created(
      response.allocations.find((allocation) => allocation.id === id),
    );
  }

  if (shareId && request.method === "PATCH" && !action) {
    const input = allocationUpdateSchema.parse(await jsonBody(request));
    const current = await findShare(client, shareId);
    if (String(current.status) !== "Draft") {
      throw new ApiError(
        409,
        "PROFIT_SHARE_LOCKED",
        "Pembagian yang sudah disetujui tidak dapat diedit. Batalkan lalu buat alokasi baru.",
      );
    }
    const nextPercentageBps =
      input.percentage === undefined
        ? asNumber(current.percentage_bps)
        : Math.round(input.percentage * 100);
    if (
      (await activePercentage(
        client,
        String(current.project_id),
        shareId,
      )) +
        nextPercentageBps >
      10_000
    ) {
      throw new ApiError(
        409,
        "PROFIT_SHARE_EXCEEDS_100_PERCENT",
        "Total pembagian keuntungan tidak boleh melebihi 100%.",
      );
    }
    await client.execute({
      sql: `
        UPDATE project_profit_shares
        SET recipient_user_id=?,recipient_name=?,percentage_bps=?,notes=?,updated_at=?
        WHERE id=?
      `,
      args: [
        input.recipientUserId === undefined
          ? current.recipient_user_id
          : input.recipientUserId ?? null,
        input.recipientName ?? current.recipient_name,
        nextPercentageBps,
        input.notes === undefined ? current.notes : input.notes || null,
        new Date().toISOString(),
        shareId,
      ],
    });
    await writeAuditLog(client, request, user, "update", "profit_share", shareId, input);
    const response = await summary(client, String(current.project_id));
    return ok(response.allocations.find((item) => item.id === shareId));
  }

  if (shareId && request.method === "POST" && action === "approve") {
    if (user.role !== "Admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya Admin yang dapat menyetujui pembagian keuntungan.",
      );
    }
    const current = await findShare(client, shareId);
    if (String(current.status) !== "Draft") {
      throw new ApiError(
        409,
        "INVALID_PROFIT_SHARE_STATUS",
        "Hanya alokasi Draft yang dapat disetujui.",
      );
    }
    const profit = await operatingProfit(client, String(current.project_id));
    if (profit.distributableProfit <= 0) {
      throw new ApiError(
        409,
        "NO_DISTRIBUTABLE_PROFIT",
        "Laba belum aman dibagikan setelah memperhitungkan komitmen vendor yang belum dibayar.",
      );
    }
    const amount = Math.floor(
      (profit.distributableProfit * asNumber(current.percentage_bps)) / 10_000,
    );
    if (amount <= 0) {
      throw new ApiError(
        409,
        "PROFIT_SHARE_AMOUNT_TOO_SMALL",
        "Nominal pembagian terlalu kecil untuk dicatat dalam rupiah.",
      );
    }
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `
        UPDATE project_profit_shares
        SET amount=?,status='Approved',approved_by=?,updated_at=?
        WHERE id=?
      `,
      args: [amount, user.id, timestamp, shareId],
    });
    await writeAuditLog(client, request, user, "approve", "profit_share", shareId, {
      amount,
      baseNetProfit: profit.netProfit,
      outstandingVendorCommitment: profit.outstandingVendorCommitment,
      distributableProfit: profit.distributableProfit,
    });
    const response = await summary(client, String(current.project_id));
    return ok(response.allocations.find((item) => item.id === shareId));
  }

  if (shareId && request.method === "POST" && action === "pay") {
    const input = paymentSchema.parse(await jsonBody(request));
    const current = await findShare(client, shareId);
    if (String(current.status) !== "Approved") {
      throw new ApiError(
        409,
        "PROFIT_SHARE_NOT_APPROVED",
        "Alokasi harus disetujui Admin sebelum dibayar.",
      );
    }
    const transactionId = randomUUID();
    const timestamp = new Date().toISOString();
    await client.batch(
      [
        {
          sql: `
            INSERT INTO transactions
              (id,project_id,date,type,description,amount,source,reference_id,category,created_by,created_at,updated_at)
            VALUES (?,? ,?,'Pengeluaran',?,?,'Profit Share',?,'Bagi Hasil',?,?,?)
          `,
          args: [
            transactionId,
            current.project_id,
            input.paidDate,
            `Pembagian keuntungan - ${String(current.recipient_name)}`,
            current.amount,
            shareId,
            user.id,
            timestamp,
            timestamp,
          ],
        },
        {
          sql: `
            UPDATE project_profit_shares
            SET status='Paid',paid_date=?,transaction_id=?,paid_by=?,updated_at=?
            WHERE id=?
          `,
          args: [input.paidDate, transactionId, user.id, timestamp, shareId],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "pay", "profit_share", shareId, {
      amount: asNumber(current.amount),
      paidDate: input.paidDate,
    });
    const response = await summary(client, String(current.project_id));
    return ok(response.allocations.find((item) => item.id === shareId));
  }

  if (shareId && request.method === "POST" && action === "void") {
    if (user.role !== "Admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya Admin yang dapat membatalkan pembagian keuntungan.",
      );
    }
    const current = await findShare(client, shareId);
    if (String(current.status) === "Void") {
      throw new ApiError(
        409,
        "ALREADY_VOID",
        "Pembagian keuntungan ini sudah dibatalkan.",
      );
    }
    if (current.transaction_id) {
      const linkedBankEntry = await client.execute({
        sql: "SELECT id FROM bank_statement_entries WHERE transaction_id=? LIMIT 1",
        args: [current.transaction_id],
      });
      if (linkedBankEntry.rows.length) {
        throw new ApiError(
          409,
          "PROFIT_SHARE_RECONCILED",
          "Pembayaran sudah direkonsiliasi dengan mutasi bank. Lepaskan rekonsiliasi terlebih dahulu.",
        );
      }
    }
    const timestamp = new Date().toISOString();
    await client.batch(
      [
        ...(current.transaction_id
          ? [
              {
                sql: "DELETE FROM transactions WHERE id=?",
                args: [current.transaction_id],
              },
            ]
          : []),
        {
          sql: `
            UPDATE project_profit_shares
            SET status='Void',transaction_id=NULL,updated_at=?
            WHERE id=?
          `,
          args: [timestamp, shareId],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "void", "profit_share", shareId, {
      previousStatus: current.status,
    });
    const response = await summary(client, String(current.project_id));
    return ok(response.allocations.find((item) => item.id === shareId));
  }

  if (shareId && request.method === "DELETE" && !action) {
    const current = await findShare(client, shareId);
    if (String(current.status) !== "Draft") {
      throw new ApiError(
        409,
        "PROFIT_SHARE_LOCKED",
        "Hanya alokasi Draft yang dapat dihapus.",
      );
    }
    await client.execute({
      sql: "DELETE FROM project_profit_shares WHERE id=?",
      args: [shareId],
    });
    await writeAuditLog(client, request, user, "delete", "profit_share", shareId);
    return noContent();
  }

  throw new ApiError(
    404,
    "NOT_FOUND",
    "Endpoint pembagian keuntungan tidak ditemukan.",
  );
}
