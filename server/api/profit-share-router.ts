import "server-only";

import { randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import {
  countsAsCashCondition,
  grossExpenseSum,
  grossIncomeSum,
  tanggalReversal,
} from "../cash-ledger";
import { getDatabase, type DatabaseClient } from "../db/client";
import { asNumber } from "../format";
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
/**
 * `recipientKind: "company"` adalah sisa laba yang tinggal di perusahaan.
 *
 * `recipientName` dan `percentage` boleh dikosongkan untuk jenis itu: namanya
 * selalu sama, dan persentasenya hampir selalu "sisanya". Membiarkan SERVER
 * menghitung sisa itu bukan kenyamanan — frontend yang menghitungnya sendiri
 * akan salah begitu ada alokasi lain masuk di antara ia membaca dan mengirim.
 */
const RECIPIENT_KINDS = ["person", "company"] as const;
const COMPANY_RECIPIENT_NAME = "Kas Perusahaan";

const allocationSchema = z.object({
  projectId: idSchema,
  recipientKind: z.enum(RECIPIENT_KINDS).default("person"),
  recipientUserId: idSchema.optional(),
  recipientName: z.string().trim().min(2).max(120).optional(),
  percentage: z.number().positive().max(100).optional(),
  notes: z.string().trim().max(500).optional().default(""),
});
// `notes` carries a `.default("")`, so a plain `.partial()` erased the stored
// note whenever the client patched only the recipient or the percentage.
// `recipientKind` sengaja tidak ikut: memindahkan alokasi orang menjadi alokasi
// perusahaan (atau sebaliknya) mengubah apa yang terjadi pada kas saat
// dieksekusi. Batalkan lalu buat yang baru.
const allocationUpdateSchema = partialPatchSchema(
  allocationSchema.omit({ projectId: true, recipientKind: true }),
);
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

// Pembagian dan pembalikannya adalah HASIL dari perhitungan ini, jadi ia tidak
// pernah masuk kembali ke dalamnya. Pemindahan ke kas perusahaan ikut di sini
// karena alasan yang sama, dan alasan kedua yang lebih tajam: kalau ia dihitung
// sebagai pengeluaran proyek, mengalokasikan sisa laba akan MENURUNKAN laba itu
// sendiri, lalu sisa berikutnya dihitung dari angka yang sudah menyusut. Umpan
// balik yang tidak pernah berhenti.
const COMPANY_TREASURY_SOURCES = [
  "Company Treasury",
  "Company Treasury In",
  "Company Treasury Reversal",
  "Company Treasury In Reversal",
] as const;

const OPERATING_SCOPE = `transactions.source NOT IN ('Profit Share','Profit Share Reversal',${COMPANY_TREASURY_SOURCES.map(
  (source) => `'${source}'`,
).join(",")})`;

export async function operatingProfit(client: DatabaseClient, projectId: string) {
  const result = await client.execute({
    // Distributions and their reversals are the output of this calculation, so
    // they never feed back into it. Every other void books a reversal that nets
    // against the entry it undoes instead of inflating the opposite side.
    sql: `
      SELECT
        ${grossIncomeSum("transactions", OPERATING_SCOPE)} AS income,
        ${grossExpenseSum("transactions", OPERATING_SCOPE)} AS expense
      FROM transactions
      WHERE project_id=? AND ${countsAsCashCondition()}
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
      COALESCE(SUM(CASE WHEN o.direction='Payable'
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
  const reimbursementPosition = await client.execute({
    sql: `SELECT COALESCE(SUM(CASE
      WHEN e.total_amount-COALESCE(s.allocated,0)-COALESCE(s.reimbursed,0)>0
      THEN e.total_amount-COALESCE(s.allocated,0)-COALESCE(s.reimbursed,0)
      ELSE 0 END),0) AS outstanding
    FROM project_expenses e
    LEFT JOIN (
      SELECT expense_id,
        SUM(CASE WHEN settlement_type='AdvanceAllocation' AND status='Posted' THEN amount ELSE 0 END) AS allocated,
        SUM(CASE WHEN settlement_type='Reimbursement' AND status='Posted' THEN amount ELSE 0 END) AS reimbursed
      FROM project_expense_settlements GROUP BY expense_id
    ) s ON s.expense_id=e.id
    WHERE e.project_id=? AND e.workflow_status='Approved'
      AND e.funding_source IN ('EmployeePaid','ProjectAdvance')`,
    args: [projectId],
  });
  const outstandingReimbursement = Math.max(
    0,
    asNumber(reimbursementPosition.rows[0]?.outstanding),
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
    outstandingReimbursement,
    recoverableTax,
    distributableProfit:
      netProfit - outstandingVendorCommitment - outstandingTaxPayable -
      outstandingReimbursement,
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
    recipientKind: String(row.recipient_kind ?? "person"),
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
    companyTransactionId: row.company_transaction_id
      ? String(row.company_transaction_id)
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
  // allocatedAmount mencampur pratinjau Draft (ikut bergerak bersama kas) dan
  // nominal yang sudah dikunci — berguna sebagai perencanaan. lockedAmount
  // hanya yang sudah tidak bisa bergerak lagi (Approved + Paid).
  const allocatedAmount = active.reduce((total, item) => total + item.amount, 0);
  const lockedAmount = active
    .filter((item) => item.status === "Approved" || item.status === "Paid")
    .reduce((total, item) => total + item.amount, 0);
  const paidAmount = active
    .filter((item) => item.status === "Paid")
    .reduce((total, item) => total + item.amount, 0);
  const allocatedPercentage = active.reduce(
    (total, item) => total + item.percentage,
    0,
  );
  return {
    project: {
      id: String(project.id),
      code: String(project.code),
      name: String(project.name),
      client: String(project.client),
    },
    ...profit,
    allocatedPercentage,
    // Dipisah supaya layar tidak menghitungnya sendiri dari 100 dikurangi
    // sesuatu, lalu keliru saat ada alokasi yang dibatalkan.
    unallocatedPercentage: Math.max(0, 100 - allocatedPercentage),
    allocatedAmount,
    lockedAmount,
    paidAmount,
    retainedProfit: profit.distributableProfit - allocatedAmount,
    companyShare:
      active.find((item) => item.recipientKind === "company") ?? null,
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

/**
 * Pos kas perusahaan: laba yang sudah dialokasikan ke perusahaan sendiri.
 *
 * Dibaca dari BUKU KAS, bukan dari tabel alokasi. Keduanya biasanya sama, tapi
 * kalau suatu hari berbeda, yang benar adalah buku kas — itulah yang dipakai
 * seluruh laporan keuangan lain, dan angka pos ini harus bisa dicocokkan
 * dengannya baris per baris.
 *
 * Baris pembalik dikurangkan, bukan disembunyikan: alokasi yang dibatalkan
 * tetap terbaca di riwayat, hanya tidak ikut menambah saldo.
 */
export async function companyTreasury(
  client: DatabaseClient,
  range: { from?: string | null; to?: string | null } = {},
) {
  const conditions = ["t.source IN ('Company Treasury In','Company Treasury In Reversal')"];
  const args: unknown[] = [];
  if (range.from) {
    conditions.push("t.date>=?");
    args.push(range.from);
  }
  if (range.to) {
    conditions.push("t.date<=?");
    args.push(range.to);
  }
  const result = await client.execute({
    sql: `SELECT t.id,t.date,t.amount,t.source,t.reference_id,t.description,
        s.project_id,p.code AS project_code,p.name AS project_name
      FROM transactions t
      LEFT JOIN project_profit_shares s
        ON s.id = replace(t.reference_id, ':void', '')
      LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.date DESC, t.created_at DESC`,
    args: args as never[],
  });
  let balance = 0;
  const entries = result.rows.map((row) => {
    const reversed = String(row.source) === "Company Treasury In Reversal";
    const amount = asNumber(row.amount);
    balance += reversed ? -amount : amount;
    return {
      id: String(row.id),
      date: String(row.date),
      amount,
      reversed,
      shareId: String(row.reference_id ?? "").replace(":void", ""),
      projectId: row.project_id ? String(row.project_id) : null,
      projectCode: row.project_code ? String(row.project_code) : null,
      projectName: row.project_name ? String(row.project_name) : null,
      description: String(row.description ?? ""),
    };
  });
  return { balance, entries };
}

export async function handleCompanyTreasury(request: Request, user: AuthUser) {
  if (request.method !== "GET") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  // Angka ini adalah angka LABA, bukan sekadar kas: ia menyebutkan berapa
  // banyak keuntungan yang ditahan perusahaan. Jadi ia mengikuti izin Laba &
  // Bagi Hasil, sama seperti Laba Bersih Dasar dan Laba Ditahan di laporan —
  // bukan izin Pembukuan, yang dipegang lebih banyak orang.
  if (!canAccess(user.permissions, "finance", "view")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Peran Anda tidak memiliki akses ke Pembukuan.",
      { module: "finance" },
    );
  }
  if (!canAccess(user.permissions, "margin", "view")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Peran Anda tidak memiliki akses ke angka laba perusahaan.",
      { module: "margin" },
    );
  }
  const { client } = await getDatabase();
  const url = new URL(request.url);
  return ok(
    await companyTreasury(client, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    }),
    200,
    { "Cache-Control": "no-store" },
  );
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
    const perusahaan = input.recipientKind === "company";
    if (perusahaan && input.recipientUserId) {
      throw new ApiError(
        422,
        "COMPANY_SHARE_HAS_NO_USER",
        "Alokasi ke kas perusahaan tidak punya penerima orang.",
      );
    }
    if (perusahaan) {
      const sudahAda = await client.execute({
        sql: `SELECT id FROM project_profit_shares
          WHERE project_id=? AND recipient_kind='company' AND status<>'Void' LIMIT 1`,
        args: [input.projectId],
      });
      if (sudahAda.rows.length) {
        throw new ApiError(
          409,
          "COMPANY_SHARE_EXISTS",
          "Proyek ini sudah punya alokasi ke kas perusahaan. Ubah atau batalkan yang ada.",
          { shareId: String(sudahAda.rows[0].id) },
        );
      }
    }
    if (!perusahaan && !input.recipientName) {
      throw new ApiError(
        422,
        "RECIPIENT_REQUIRED",
        "Nama penerima wajib diisi.",
      );
    }
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
    const sudahDialokasikan = await activePercentage(client, input.projectId);
    // Persentase yang dikosongkan berarti "sisanya" — dan sisanya dihitung DI
    // SINI, bukan di layar. Antara layar membaca dan mengirim, alokasi lain
    // bisa masuk; angka yang dihitung frontend akan melampaui 100% tanpa ada
    // yang tahu sebabnya.
    const percentageBps =
      input.percentage === undefined
        ? 10_000 - sudahDialokasikan
        : Math.round(input.percentage * 100);
    if (percentageBps <= 0) {
      throw new ApiError(
        409,
        "NOTHING_LEFT_TO_ALLOCATE",
        "Seluruh laba proyek ini sudah dialokasikan.",
        { allocatedPercentage: sudahDialokasikan / 100 },
      );
    }
    if (sudahDialokasikan + percentageBps > 10_000) {
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
          (id,project_id,recipient_kind,recipient_user_id,recipient_name,percentage_bps,amount,status,notes,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,0,'Draft',?,?,?,?)
      `,
      args: [
        id,
        input.projectId,
        input.recipientKind,
        input.recipientUserId ?? null,
        perusahaan
          ? input.recipientName || COMPANY_RECIPIENT_NAME
          : input.recipientName,
        percentageBps,
        input.notes || null,
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await writeAuditLog(client, request, user, "create", "profit_share", id, {
      projectId: input.projectId,
      percentage: percentageBps / 100,
      recipientKind: input.recipientKind,
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
    // Persentasenya dibatasi 100%, tetapi RUPIAH-nya dikunci satu per satu
    // terhadap laba yang berbeda-beda waktunya. Dua alokasi 50% yang disetujui
    // di dua waktu — yang kedua setelah laba turun — menghasilkan dua nominal
    // terkunci yang jumlahnya melampaui laba aman mana pun, dan `pay` tidak
    // pernah memeriksa ulang. Yang dijaga: Σ nominal yang sudah dikunci
    // (Approved + Paid) ditambah yang akan dikunci tidak boleh melampaui laba
    // aman SAAT INI.
    const locked = await client.execute({
      sql: `SELECT COALESCE(SUM(amount),0) AS total FROM project_profit_shares
        WHERE project_id=? AND status IN ('Approved','Paid') AND id<>?`,
      args: [current.project_id, shareId],
    });
    const lockedAmount = asNumber(locked.rows[0]?.total);
    if (lockedAmount + amount > profit.distributableProfit) {
      throw new ApiError(
        409,
        "NO_DISTRIBUTABLE_PROFIT",
        `Laba aman dibagikan saat ini ${profit.distributableProfit.toLocaleString("id-ID")}, sedangkan yang sudah dikunci untuk alokasi lain ${lockedAmount.toLocaleString("id-ID")}. Alokasi ini tidak lagi tertampung.`,
        { distributableProfit: profit.distributableProfit, lockedAmount, amount },
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
    const perusahaan = String(current.recipient_kind ?? "person") === "company";
    // Baris kas perusahaan tidak punya project_id, jadi kode proyeknya harus
    // ikut ke dalam keterangan — kalau tidak, pos kas perusahaan berisi
    // sederet baris yang tak seorang pun bisa telusuri asalnya.
    const proyek = await requireProject(client, String(current.project_id));
    const transactionId = randomUUID();
    const companyTransactionId = randomUUID();
    const timestamp = new Date().toISOString();
    // Bagian orang KELUAR dari perusahaan: satu baris, Pengeluaran, selesai.
    //
    // Bagian perusahaan TIDAK keluar. Ia berpindah dari "milik proyek ini"
    // menjadi "milik perusahaan", jadi dicatat dua kaki: Pengeluaran pada
    // proyeknya — supaya proyeknya tutup di nol dan labanya benar-benar
    // teralokasi habis — dan Pemasukan pada tingkat perusahaan, tanpa
    // project_id. Kas bersih perusahaan tidak bergerak satu rupiah pun, karena
    // memang tidak ada yang bergerak.
    //
    // Kaki masuknya memakai sumber `Company Treasury In`, yang di cash-ledger
    // terdaftar sebagai baris NETO: ia mengurangi sisi pengeluaran, bukan
    // menambah pemasukan. Kalau ia dijumlahkan sebagai kas masuk, "Kas masuk"
    // perusahaan akan naik setiap kali laba ditahan — padahal tidak sepeser pun
    // datang dari luar, dan tidak ada yang pernah menurunkannya kembali.
    await client.batch(
      [
        {
          sql: `
            INSERT INTO transactions
              (id,project_id,date,type,description,amount,source,reference_id,category,origin,created_by,created_at,updated_at)
            VALUES (?,? ,?,'Pengeluaran',?,?,?,?,'Bagi Hasil','system',?,?,?)
          `,
          args: [
            transactionId,
            current.project_id,
            input.paidDate,
            perusahaan
              ? `Alokasi laba ke kas perusahaan - ${String(current.recipient_name)}`
              : `Pembagian keuntungan - ${String(current.recipient_name)}`,
            current.amount,
            perusahaan ? "Company Treasury" : "Profit Share",
            shareId,
            user.id,
            timestamp,
            timestamp,
          ],
        },
        ...(perusahaan
          ? [
              {
                sql: `
                  INSERT INTO transactions
                    (id,project_id,date,type,description,amount,source,reference_id,category,origin,created_by,created_at,updated_at)
                  VALUES (?,NULL,?,'Pemasukan',?,?,'Company Treasury In',?,'Bagi Hasil','system',?,?,?)
                `,
                args: [
                  companyTransactionId,
                  input.paidDate,
                  `Laba ditahan dari ${String(proyek.code)} - ${String(proyek.name)}`,
                  current.amount,
                  shareId,
                  user.id,
                  timestamp,
                  timestamp,
                ],
              },
            ]
          : []),
        {
          sql: `
            UPDATE project_profit_shares
            SET status='Paid',paid_date=?,transaction_id=?,company_transaction_id=?,paid_by=?,updated_at=?
            WHERE id=?
          `,
          args: [
            input.paidDate,
            transactionId,
            perusahaan ? companyTransactionId : null,
            user.id,
            timestamp,
            shareId,
          ],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "pay", "profit_share", shareId, {
      amount: asNumber(current.amount),
      paidDate: input.paidDate,
      recipientKind: perusahaan ? "company" : "person",
      companyTransactionId: perusahaan ? companyTransactionId : null,
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
      // Sama dengan void lain di aplikasi ini: yang mengunci hanya mutasi yang
      // sudah DICOCOKKAN. Baris bank yang Excluded justru berarti "ini bukan
      // bukti kas baru", dan dulu tetap memblokir pembatalan selamanya.
      const linkedBankEntry = await client.execute({
        sql: "SELECT id FROM bank_statement_entries WHERE transaction_id=? AND reconciliation_status='Matched' LIMIT 1",
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
    // Every other void path in the app posts a contra entry instead of erasing
    // the original. Deleting the payout row removed the evidence that cash ever
    // left, so the ledger no longer matched the bank. Reverse it: the payout
    // stays, a dated reversal cancels it, and net cash returns to pre-payout.
    const reversalId = randomUUID();
    const companyReversalId = randomUUID();
    const perusahaan = String(current.recipient_kind ?? "person") === "company";
    const tanggalBalik = tanggalReversal(String(current.paid_date), timestamp);
    await client.batch(
      [
        ...(current.transaction_id
          ? [
              {
                sql: `
                  INSERT INTO transactions
                    (id,project_id,date,type,description,amount,source,reference_id,category,origin,created_by,created_at,updated_at)
                  VALUES (?,?,?,'Pemasukan',?,?,?,?,'Bagi Hasil','system',?,?,?)
                `,
                args: [
                  reversalId,
                  current.project_id,
                  tanggalBalik,
                  perusahaan
                    ? `Pembatalan alokasi ke kas perusahaan - ${String(current.recipient_name)}`
                    : `Pembatalan pembagian keuntungan - ${String(current.recipient_name)}`,
                  current.amount,
                  perusahaan ? "Company Treasury Reversal" : "Profit Share Reversal",
                  `${shareId}:void`,
                  user.id,
                  timestamp,
                  timestamp,
                ],
              },
            ]
          : []),
        // Kaki kedua dibalik juga. Tanpa baris ini, pos kas perusahaan tetap
        // memegang uang yang alasannya sudah dihapus — dan kas bersih
        // perusahaan naik sebesar alokasi yang dibatalkan, dari ketiadaan.
        ...(current.company_transaction_id
          ? [
              {
                sql: `
                  INSERT INTO transactions
                    (id,project_id,date,type,description,amount,source,reference_id,category,origin,created_by,created_at,updated_at)
                  VALUES (?,NULL,?,'Pengeluaran',?,?,'Company Treasury In Reversal',?,'Bagi Hasil','system',?,?,?)
                `,
                args: [
                  companyReversalId,
                  tanggalBalik,
                  `Pembatalan laba ditahan - ${String(current.recipient_name)}`,
                  current.amount,
                  `${shareId}:void`,
                  user.id,
                  timestamp,
                  timestamp,
                ],
              },
            ]
          : []),
        {
          sql: `
            UPDATE project_profit_shares
            SET status='Void',updated_at=?
            WHERE id=?
          `,
          args: [timestamp, shareId],
        },
      ],
      "write",
    );
    await writeAuditLog(client, request, user, "void", "profit_share", shareId, {
      previousStatus: current.status,
      reversalTransactionId: current.transaction_id ? reversalId : null,
      companyReversalTransactionId: current.company_transaction_id
        ? companyReversalId
        : null,
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
