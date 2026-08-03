import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import {
  createBankEntryFingerprint,
  inferCashCategory,
  parseBankStatementCsv,
  type ParsedBankStatement,
  type ParsedBankStatementEntry,
} from "../bank-statement";
import { getDatabase, type DatabaseClient } from "../db/client";
import { asNumber } from "../format";
import { ApiError, created, jsonBody, noContent, ok, partialPatchSchema } from "./errors";

const accountSchema = z.object({
  bankName: z.string().trim().min(2).max(80),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(4).max(40),
  currency: z.string().trim().length(3).default("IDR"),
  openingBalance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  syncMode: z.enum(["Manual", "API"]).default("Manual"),
  externalAccountId: z.string().trim().max(200).optional(),
  status: z.enum(["Aktif", "Nonaktif"]).default("Aktif"),
});

const apiEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(2).max(500),
  direction: z.enum(["credit", "debit"]),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  reference: z.string().trim().max(200).optional(),
});

const apiSyncSchema = z.object({
  balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  balanceUpdatedAt: z.string().datetime().optional(),
  entries: z.array(apiEntrySchema).max(5_000).default([]),
});

const reconciliationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("match"),
    transactionId: z.string().uuid(),
  }),
  z.object({ action: z.literal("exclude") }),
  z.object({ action: z.literal("restore") }),
]);

function bankApiConfigured() {
  return Boolean(process.env.BANK_SYNC_API_URL && process.env.BANK_SYNC_API_TOKEN);
}

function assertBankAccess(user: AuthUser, manage = false) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Saldo dan mutasi rekening hanya tersedia untuk Admin dan Finance.",
    );
  }
  if (!canAccess(user.permissions, "finance", manage ? "manage" : "view")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      manage
        ? "Akun Anda tidak memiliki izin untuk mengelola rekening."
        : "Akun Anda tidak memiliki akses ke rekening.",
    );
  }
}

function maskAccountNumber(value: string) {
  const normalized = value.replace(/\s+/g, "");
  const last4 = normalized.slice(-4);
  return `•••• ${last4}`;
}

function mapBankAccount(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    bankName: String(row.bank_name),
    accountName: String(row.account_name),
    accountNumberMasked: String(row.account_number_masked),
    currency: String(row.currency),
    openingBalance: asNumber(row.opening_balance),
    currentBalance: asNumber(row.current_balance),
    syncMode: String(row.sync_mode),
    status: String(row.status),
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : undefined,
    balanceUpdatedAt: row.balance_updated_at
      ? String(row.balance_updated_at)
      : undefined,
    entryCount: asNumber(row.entry_count),
    unmatchedCount: asNumber(row.unmatched_count),
    latestEntryDate: row.latest_entry_date
      ? String(row.latest_entry_date)
      : undefined,
    hasExternalAccountId: Boolean(row.external_account_id),
    apiConfigured: bankApiConfigured(),
  };
}

function mapBankEntry(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    bankAccountId: String(row.bank_account_id),
    date: String(row.date),
    description: String(row.description),
    type: String(row.type),
    amount: asNumber(row.amount),
    runningBalance:
      row.running_balance === null || row.running_balance === undefined
        ? undefined
        : asNumber(row.running_balance),
    reference: row.reference ? String(row.reference) : undefined,
    reconciliationStatus: String(row.reconciliation_status),
    source: String(row.source),
    transactionId: row.transaction_id
      ? String(row.transaction_id)
      : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    project: row.project_name ? String(row.project_name) : "Umum",
    category: row.category ? String(row.category) : "Lainnya",
    createdAt: String(row.created_at),
  };
}

async function findAccount(client: DatabaseClient, accountId: string) {
  const result = await client.execute({
    sql: "SELECT * FROM bank_accounts WHERE id=? LIMIT 1",
    args: [accountId],
  });
  if (!result.rows[0]) {
    throw new ApiError(404, "NOT_FOUND", "Rekening bank tidak ditemukan.");
  }
  return result.rows[0] as Record<string, unknown>;
}

async function listAccounts(client: DatabaseClient) {
  const result = await client.execute(`
    SELECT a.*,
      (SELECT COUNT(*) FROM bank_statement_entries e WHERE e.bank_account_id=a.id) AS entry_count,
      (SELECT COUNT(*) FROM bank_statement_entries e WHERE e.bank_account_id=a.id AND e.reconciliation_status='Imported') AS unmatched_count,
      (SELECT MAX(date) FROM bank_statement_entries e WHERE e.bank_account_id=a.id) AS latest_entry_date
    FROM bank_accounts a
    ORDER BY a.status,a.bank_name,a.account_name
  `);
  return result.rows.map((row) =>
    mapBankAccount(row as Record<string, unknown>),
  );
}

async function accountUsage(client: DatabaseClient, accountId: string) {
  const result = await client.execute({
    sql: `SELECT
      (SELECT COUNT(*) FROM bank_statement_entries WHERE bank_account_id=?) AS statements,
      (SELECT COUNT(*) FROM bank_statement_imports WHERE bank_account_id=?) AS imports,
      (SELECT COUNT(*) FROM invoice_payments WHERE bank_account_id=?) AS invoice_payments,
      (SELECT COUNT(*) FROM spk_payments WHERE bank_account_id=?) AS vendor_payments,
      (SELECT COUNT(*) FROM tax_settlements WHERE bank_account_id=?) AS tax_settlements`,
    args: [accountId, accountId, accountId, accountId, accountId],
  });
  const row = result.rows[0] ?? {};
  return {
    statements: asNumber(row.statements),
    imports: asNumber(row.imports),
    invoicePayments: asNumber(row.invoice_payments),
    vendorPayments: asNumber(row.vendor_payments),
    taxSettlements: asNumber(row.tax_settlements),
  };
}

function totalAccountUsage(usage: Awaited<ReturnType<typeof accountUsage>>) {
  return Object.values(usage).reduce((total, count) => total + count, 0);
}

async function refreshCalculatedBalance(
  client: DatabaseClient,
  accountId: string,
  explicitBalance?: number,
  explicitTimestamp?: string,
) {
  let balance = explicitBalance;
  if (balance === undefined) {
    const result = await client.execute({
      sql: `
        SELECT a.opening_balance
          + COALESCE(SUM(CASE WHEN e.type='Pemasukan' THEN e.amount ELSE -e.amount END),0) AS balance
        FROM bank_accounts a
        LEFT JOIN bank_statement_entries e ON e.bank_account_id=a.id
        WHERE a.id=?
        GROUP BY a.id,a.opening_balance
      `,
      args: [accountId],
    });
    balance = asNumber(result.rows[0]?.balance);
  }
  const timestamp = explicitTimestamp ?? new Date().toISOString();
  await client.execute({
    sql: "UPDATE bank_accounts SET current_balance=?,balance_updated_at=?,updated_at=? WHERE id=?",
    args: [balance, timestamp, timestamp, accountId],
  });
  return balance;
}

async function latestStoredRunningBalance(
  client: DatabaseClient,
  accountId: string,
) {
  const result = await client.execute({
    sql: `
      SELECT running_balance,date
      FROM bank_statement_entries
      WHERE bank_account_id=? AND running_balance IS NOT NULL
      ORDER BY date DESC,created_at DESC
      LIMIT 1
    `,
    args: [accountId],
  });
  const row = result.rows[0];
  return row
    ? {
        balance: asNumber(row.running_balance),
        date: String(row.date),
      }
    : undefined;
}

function dateDistanceInDays(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

async function persistEntries(
  client: DatabaseClient,
  input: {
    account: Record<string, unknown>;
    entries: ParsedBankStatementEntry[];
    importId?: string;
    source: "Manual Upload" | "API";
    userId: string;
  },
) {
  let importedCount = 0;
  let duplicateCount = 0;
  let matchedCount = 0;
  let createdCount = 0;

  for (const entry of input.entries) {
    const duplicate = await client.execute({
      sql: "SELECT id FROM bank_statement_entries WHERE bank_account_id=? AND fingerprint=? LIMIT 1",
      args: [input.account.id, entry.fingerprint],
    });
    if (duplicate.rows.length) {
      duplicateCount += 1;
      continue;
    }

    const matching = await client.execute({
      sql: `
        SELECT t.id,t.date
        FROM transactions t
        LEFT JOIN bank_statement_entries e ON e.transaction_id=t.id
        WHERE t.type=? AND t.amount=?
          AND e.id IS NULL AND t.source NOT LIKE 'Bank:%'
        ORDER BY t.created_at
        LIMIT 50
      `,
      args: [entry.type, entry.amount],
    });
    const matchingWithinSettlementWindow = matching.rows.filter(
      (candidate) =>
        dateDistanceInDays(entry.date, String(candidate.date)) <= 3,
    );
    const matchedTransactionId =
      matchingWithinSettlementWindow.length === 1
        ? String(matchingWithinSettlementWindow[0].id)
        : undefined;
    const entryId = randomUUID();
    const timestamp = new Date().toISOString();
    const transactionId = matchedTransactionId ?? randomUUID();
    const reconciliationStatus = matchedTransactionId
      ? "Matched"
      : "Imported";
    const statements = [];
    if (!matchedTransactionId) {
      statements.push({
        sql: `
          INSERT INTO transactions
            (id,project_id,date,type,description,amount,source,reference_id,category,created_by,created_at,updated_at)
          VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?)
        `,
        args: [
          transactionId,
          entry.date,
          entry.type,
          entry.description,
          entry.amount,
          `Bank: ${String(input.account.bank_name)}`,
          entryId,
          inferCashCategory(entry.description, entry.type),
          input.userId,
          timestamp,
          timestamp,
        ],
      });
    }
    statements.push({
      sql: `
        INSERT INTO bank_statement_entries
          (id,bank_account_id,import_id,transaction_id,date,description,type,amount,running_balance,reference,fingerprint,reconciliation_status,source,raw_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      args: [
        entryId,
        input.account.id,
        input.importId ?? null,
        transactionId,
        entry.date,
        entry.description,
        entry.type,
        entry.amount,
        entry.runningBalance ?? null,
        entry.reference ?? null,
        entry.fingerprint,
        reconciliationStatus,
        input.source,
        JSON.stringify(entry.raw).slice(0, 20_000),
        timestamp,
      ],
    });
    try {
      await client.batch(statements, "write");
      importedCount += 1;
      if (matchedTransactionId) matchedCount += 1;
      else createdCount += 1;
    } catch (error) {
      const racedDuplicate = await client.execute({
        sql: "SELECT id FROM bank_statement_entries WHERE bank_account_id=? AND fingerprint=? LIMIT 1",
        args: [input.account.id, entry.fingerprint],
      });
      if (racedDuplicate.rows.length) {
        duplicateCount += 1;
        continue;
      }
      throw error;
    }
  }
  return { importedCount, duplicateCount, matchedCount, createdCount };
}

async function importStatement(
  request: Request,
  user: AuthUser,
  accountId: string,
) {
  assertBankAccess(user, true);
  const { client } = await getDatabase();
  const account = await findAccount(client, accountId);
  const form = await request.formData();
  const file = form.get("file");
  const statementMonthValue = form.get("statementMonth");
  const statementMonth =
    typeof statementMonthValue === "string" &&
    /^\d{4}-\d{2}$/.test(statementMonthValue)
      ? statementMonthValue
      : undefined;
  if (!(file instanceof File)) {
    throw new ApiError(400, "FILE_REQUIRED", "Pilih file mutasi CSV atau PDF.");
  }
  const filename = file.name.toLowerCase();
  const declaredPdf = filename.endsWith(".pdf") || file.type === "application/pdf";
  const declaredCsv =
    filename.endsWith(".csv") ||
    ["text/csv", "text/plain", "application/vnd.ms-excel"].includes(file.type);
  const sizeLimit = declaredPdf ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
  if (file.size > sizeLimit) {
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      declaredPdf
        ? "Ukuran PDF mutasi maksimal 5 MB."
        : "Ukuran CSV mutasi maksimal 2 MB.",
    );
  }
  if (!declaredPdf && !declaredCsv) {
    throw new ApiError(
      400,
      "UNSUPPORTED_FILE",
      "Gunakan file CSV atau PDF e-statement dari internet banking.",
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hasPdfSignature =
    bytes.length >= 5 &&
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  if (declaredPdf && !hasPdfSignature) {
    throw new ApiError(
      400,
      "UNSUPPORTED_FILE",
      "Isi file tidak dikenali sebagai PDF yang valid.",
    );
  }
  let parsed: ParsedBankStatement;
  if (hasPdfSignature) {
    const { parseBankStatementPdf } = await import("../bank-statement-pdf");
    parsed = await parseBankStatementPdf(bytes, accountId, statementMonth);
  } else {
    parsed = parseBankStatementCsv(
      Buffer.from(bytes).toString("utf8"),
      accountId,
      statementMonth,
    );
  }
  if (
    parsed.statementMonth &&
    statementMonth &&
    parsed.statementMonth !== statementMonth
  ) {
    throw new ApiError(
      422,
      "STATEMENT_PERIOD_MISMATCH",
      `Periode di PDF adalah ${parsed.statementMonth}, bukan ${statementMonth}.`,
    );
  }
  const accountLast4 = String(account.account_number_masked)
    .replace(/\D/g, "")
    .slice(-4);
  if (
    parsed.accountNumberLast4 &&
    accountLast4 &&
    parsed.accountNumberLast4 !== accountLast4
  ) {
    throw new ApiError(
      422,
      "BANK_ACCOUNT_MISMATCH",
      "Nomor rekening di PDF tidak sesuai dengan rekening yang dipilih.",
    );
  }
  if (!parsed.entries.length) {
    throw new ApiError(
      422,
      "INVALID_STATEMENT",
      parsed.errors[0] ?? "Tidak ada mutasi valid dalam file.",
      parsed.errors,
    );
  }
  if (parsed.entries.length > 5_000) {
    throw new ApiError(
      422,
      "TOO_MANY_ROWS",
      "Satu file maksimal berisi 5.000 mutasi.",
    );
  }

  const importId = randomUUID();
  const timestamp = new Date().toISOString();
  const resolvedStatementMonth = parsed.statementMonth ?? statementMonth;
  await client.execute({
    sql: `
      INSERT INTO bank_statement_imports
        (id,bank_account_id,filename,file_hash,statement_month,row_count,imported_count,duplicate_count,error_count,imported_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `,
    args: [
      importId,
      accountId,
      file.name.slice(0, 240),
      createHash("sha256").update(bytes).digest("hex"),
      resolvedStatementMonth ?? null,
      parsed.entries.length + parsed.errors.length,
      0,
      0,
      parsed.errors.length,
      user.id,
      timestamp,
    ],
  });
  const counts = await persistEntries(client, {
    account,
    entries: parsed.entries,
    importId,
    source: "Manual Upload",
    userId: user.id,
  });
  await client.execute({
    sql: "UPDATE bank_statement_imports SET imported_count=?,duplicate_count=? WHERE id=?",
    args: [counts.importedCount, counts.duplicateCount, importId],
  });

  const latestBalance = await latestStoredRunningBalance(client, accountId);
  const currentBalance = await refreshCalculatedBalance(
    client,
    accountId,
    latestBalance?.balance,
    latestBalance ? `${latestBalance.date}T00:00:00.000Z` : undefined,
  );
  await writeAuditLog(client, request, user, "import", "bank_statement", importId, {
    accountId,
    filename: file.name,
    format: hasPdfSignature ? "PDF" : "CSV",
    statementMonth: resolvedStatementMonth,
    ...counts,
    errorCount: parsed.errors.length,
  });
  return created({
    importId,
    ...counts,
    errorCount: parsed.errors.length,
    errors: parsed.errors,
    currentBalance,
  });
}

async function syncAccount(
  request: Request,
  user: AuthUser,
  accountId: string,
) {
  assertBankAccess(user, true);
  const { client } = await getDatabase();
  const account = await findAccount(client, accountId);
  if (account.sync_mode !== "API") {
    throw new ApiError(
      409,
      "BANK_API_DISABLED",
      "Ubah metode rekening menjadi API sebelum melakukan sinkronisasi.",
    );
  }
  if (!bankApiConfigured()) {
    throw new ApiError(
      409,
      "BANK_API_NOT_CONFIGURED",
      "Kredensial konektor bank belum dikonfigurasi di server.",
    );
  }
  if (!account.external_account_id) {
    throw new ApiError(
      409,
      "BANK_ACCOUNT_NOT_LINKED",
      "Account ID dari provider bank belum diisi.",
    );
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  let response: Response;
  try {
    response = await fetch(String(process.env.BANK_SYNC_API_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BANK_SYNC_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        accountId: String(account.external_account_id),
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ApiError(
      502,
      "BANK_API_UNAVAILABLE",
      error instanceof Error
        ? `Koneksi ke provider bank gagal: ${error.message}`
        : "Koneksi ke provider bank gagal.",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      502,
      "BANK_API_ERROR",
      `Provider bank merespons ${response.status}.`,
    );
  }
  const parsed = apiSyncSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "BANK_API_INVALID_RESPONSE",
      "Format respons provider bank tidak valid.",
    );
  }

  const occurrences = new Map<string, number>();
  const entries: ParsedBankStatementEntry[] = parsed.data.entries.map((entry) => {
    const values = {
      date: entry.date,
      description: entry.description,
      type: entry.direction === "credit" ? "Pemasukan" as const : "Pengeluaran" as const,
      amount: entry.amount,
      ...(entry.balance === undefined ? {} : { runningBalance: entry.balance }),
      ...(entry.reference ? { reference: entry.reference } : {}),
    };
    const key = JSON.stringify(values);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return {
      ...values,
      fingerprint: createBankEntryFingerprint(accountId, values, occurrence),
      raw: entry,
    };
  });
  const counts = await persistEntries(client, {
    account,
    entries,
    source: "API",
    userId: user.id,
  });
  const syncedAt = new Date().toISOString();
  const fallbackBalance = await latestStoredRunningBalance(client, accountId);
  const currentBalance = await refreshCalculatedBalance(
    client,
    accountId,
    parsed.data.balance ?? fallbackBalance?.balance,
    parsed.data.balanceUpdatedAt ??
      (fallbackBalance
        ? `${fallbackBalance.date}T00:00:00.000Z`
        : syncedAt),
  );
  await client.execute({
    sql: "UPDATE bank_accounts SET last_synced_at=?,updated_at=? WHERE id=?",
    args: [syncedAt, syncedAt, accountId],
  });
  await writeAuditLog(client, request, user, "sync", "bank_account", accountId, {
    ...counts,
    balanceUpdatedAt: parsed.data.balanceUpdatedAt ?? syncedAt,
  });
  return ok({ ...counts, currentBalance, lastSyncedAt: syncedAt });
}

export async function handleBankAccounts(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertBankAccess(user, request.method !== "GET" && request.method !== "HEAD");
  const { client } = await getDatabase();
  const accountId = path[1];
  const action = path[2];
  const entryId = path[3];
  const entryAction = path[4];

  if (request.method === "GET" && !accountId) {
    return ok(await listAccounts(client));
  }

  if (request.method === "POST" && !accountId) {
    if (user.role !== "Admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya Admin yang dapat menambahkan rekening perusahaan.",
      );
    }
    const input = accountSchema.parse(await jsonBody(request));
    if (input.syncMode === "API" && !input.externalAccountId) {
      throw new ApiError(
        422,
        "BANK_ACCOUNT_NOT_LINKED",
        "Isi Account ID provider untuk metode API.",
      );
    }
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `
        INSERT INTO bank_accounts
          (id,bank_name,account_name,account_number_masked,external_account_id,currency,opening_balance,current_balance,sync_mode,status,balance_updated_at,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      args: [
        id,
        input.bankName,
        input.accountName,
        maskAccountNumber(input.accountNumber),
        input.externalAccountId || null,
        input.currency.toUpperCase(),
        input.openingBalance,
        input.openingBalance,
        input.syncMode,
        input.status,
        timestamp,
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await writeAuditLog(client, request, user, "create", "bank_account", id, {
      bankName: input.bankName,
      accountNumberMasked: maskAccountNumber(input.accountNumber),
      syncMode: input.syncMode,
    });
    return created(
      (await listAccounts(client)).find((account) => account.id === id),
    );
  }

  if (
    accountId &&
    request.method === "GET" &&
    action === "entries" &&
    entryId &&
    entryAction === "candidates"
  ) {
    await findAccount(client, accountId);
    const entry = await client.execute({
      sql: `
        SELECT *
        FROM bank_statement_entries
        WHERE id=? AND bank_account_id=?
        LIMIT 1
      `,
      args: [entryId, accountId],
    });
    if (!entry.rows[0]) {
      throw new ApiError(404, "NOT_FOUND", "Mutasi bank tidak ditemukan.");
    }
    const row = entry.rows[0];
    const result = await client.execute({
      sql: `
        SELECT t.*,p.name AS project_name
        FROM transactions t
        LEFT JOIN projects p ON p.id=t.project_id
        LEFT JOIN bank_statement_entries e ON e.transaction_id=t.id AND e.id<>?
        WHERE t.type=? AND t.amount=? AND e.id IS NULL
          AND t.source NOT LIKE 'Bank:%'
        ORDER BY t.date DESC,t.created_at DESC
        LIMIT 100
      `,
      args: [entryId, row.type, row.amount],
    });
    return ok(
      result.rows
        .filter(
          (candidate) =>
            dateDistanceInDays(String(row.date), String(candidate.date)) <= 14,
        )
        .map((candidate) => ({
          id: String(candidate.id),
          date: String(candidate.date),
          description: String(candidate.description),
          type: String(candidate.type),
          amount: asNumber(candidate.amount),
          source: String(candidate.source),
          project: candidate.project_name
            ? String(candidate.project_name)
            : "Umum",
          dayDifference: dateDistanceInDays(
            String(row.date),
            String(candidate.date),
          ),
        })),
    );
  }

  if (
    accountId &&
    request.method === "DELETE" &&
    action === "entries" &&
    entryId &&
    !entryAction
  ) {
    if (user.role !== "Admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya Admin yang dapat menghapus mutasi rekening.",
      );
    }
    await findAccount(client, accountId);
    const result = await client.execute({
      sql: `
        SELECT e.*,t.source AS transaction_source,
          t.reference_id AS transaction_reference
        FROM bank_statement_entries e
        LEFT JOIN transactions t ON t.id=e.transaction_id
        WHERE e.id=? AND e.bank_account_id=?
        LIMIT 1
      `,
      args: [entryId, accountId],
    });
    const entry = result.rows[0];
    if (!entry) {
      throw new ApiError(404, "NOT_FOUND", "Mutasi bank tidak ditemukan.");
    }
    const generatedTransaction =
      entry.transaction_id &&
      String(entry.transaction_source).startsWith("Bank:") &&
      String(entry.transaction_reference) === entryId
        ? String(entry.transaction_id)
        : undefined;
    await client.batch(
      [
        {
          sql: "DELETE FROM bank_statement_entries WHERE id=? AND bank_account_id=?",
          args: [entryId, accountId],
        },
        ...(generatedTransaction
          ? [
              {
                sql: "DELETE FROM transactions WHERE id=?",
                args: [generatedTransaction],
              },
            ]
          : []),
      ],
      "write",
    );
    const latestBalance = await latestStoredRunningBalance(client, accountId);
    await refreshCalculatedBalance(
      client,
      accountId,
      latestBalance?.balance,
      latestBalance
        ? `${latestBalance.date}T00:00:00.000Z`
        : new Date().toISOString(),
    );
    await writeAuditLog(
      client,
      request,
      user,
      "delete",
      "bank_statement_entry",
      entryId,
      {
        accountId,
        date: entry.date,
        description: entry.description,
        type: entry.type,
        amount: asNumber(entry.amount),
        reconciliationStatus: entry.reconciliation_status,
        deletedGeneratedTransactionId: generatedTransaction,
      },
    );
    return noContent();
  }

  if (
    accountId &&
    request.method === "PATCH" &&
    action === "entries" &&
    entryId &&
    entryAction === "reconcile"
  ) {
    const input = reconciliationSchema.parse(await jsonBody(request));
    await findAccount(client, accountId);
    const entryResult = await client.execute({
      sql: `
        SELECT e.*,t.source AS transaction_source,t.reference_id AS transaction_reference
        FROM bank_statement_entries e
        LEFT JOIN transactions t ON t.id=e.transaction_id
        WHERE e.id=? AND e.bank_account_id=?
        LIMIT 1
      `,
      args: [entryId, accountId],
    });
    const entry = entryResult.rows[0];
    if (!entry) {
      throw new ApiError(404, "NOT_FOUND", "Mutasi bank tidak ditemukan.");
    }
    const timestamp = new Date().toISOString();
    const currentTransactionId = entry.transaction_id
      ? String(entry.transaction_id)
      : null;
    const currentIsGeneratedBankTransaction =
      currentTransactionId &&
      String(entry.transaction_source).startsWith("Bank:") &&
      String(entry.transaction_reference) === entryId;

    if (input.action === "match") {
      const targetResult = await client.execute({
        sql: `
          SELECT t.*
          FROM transactions t
          LEFT JOIN bank_statement_entries e ON e.transaction_id=t.id AND e.id<>?
          WHERE t.id=? AND e.id IS NULL
          LIMIT 1
        `,
        args: [entryId, input.transactionId],
      });
      const target = targetResult.rows[0];
      if (
        !target ||
        String(target.source).startsWith("Bank:") ||
        String(target.type) !== String(entry.type) ||
        asNumber(target.amount) !== asNumber(entry.amount)
      ) {
        throw new ApiError(
          409,
          "INVALID_RECONCILIATION_TARGET",
          "Pilih transaksi dengan arah dan nominal yang sama serta belum direkonsiliasi.",
        );
      }
      const statements = [];
      if (currentIsGeneratedBankTransaction) {
        statements.push({
          sql: "DELETE FROM transactions WHERE id=?",
          args: [currentTransactionId],
        });
      }
      statements.push({
        sql: `
          UPDATE bank_statement_entries
          SET transaction_id=?,reconciliation_status='Matched'
          WHERE id=? AND bank_account_id=?
        `,
        args: [input.transactionId, entryId, accountId],
      });
      await client.batch(statements, "write");
    } else if (input.action === "exclude") {
      const statements = [];
      if (currentIsGeneratedBankTransaction) {
        statements.push({
          sql: "DELETE FROM transactions WHERE id=?",
          args: [currentTransactionId],
        });
      }
      statements.push({
        sql: `
          UPDATE bank_statement_entries
          SET transaction_id=NULL,reconciliation_status='Excluded'
          WHERE id=? AND bank_account_id=?
        `,
        args: [entryId, accountId],
      });
      await client.batch(statements, "write");
    } else {
      if (String(entry.reconciliation_status) !== "Excluded") {
        throw new ApiError(
          409,
          "ENTRY_NOT_EXCLUDED",
          "Hanya mutasi yang dikecualikan yang dapat dikembalikan ke pembukuan.",
        );
      }
      const transactionId = randomUUID();
      const account = await findAccount(client, accountId);
      await client.batch(
        [
          {
            sql: `
              INSERT INTO transactions
                (id,project_id,date,type,description,amount,source,reference_id,category,created_by,created_at,updated_at)
              VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?)
            `,
            args: [
              transactionId,
              entry.date,
              entry.type,
              entry.description,
              entry.amount,
              `Bank: ${String(account.bank_name)}`,
              entryId,
              inferCashCategory(String(entry.description), String(entry.type) as "Pemasukan" | "Pengeluaran"),
              user.id,
              timestamp,
              timestamp,
            ],
          },
          {
            sql: `
              UPDATE bank_statement_entries
              SET transaction_id=?,reconciliation_status='Imported'
              WHERE id=? AND bank_account_id=?
            `,
            args: [transactionId, entryId, accountId],
          },
        ],
        "write",
      );
    }
    await writeAuditLog(
      client,
      request,
      user,
      input.action,
      "bank_statement_entry",
      entryId,
      input,
    );
    return ok({ id: entryId, reconciliationStatus:
      input.action === "match"
        ? "Matched"
        : input.action === "exclude"
          ? "Excluded"
          : "Imported" });
  }

  if (
    accountId &&
    request.method === "GET" &&
    action === "entries" &&
    !entryId
  ) {
    await findAccount(client, accountId);
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 200);
    const limit = Math.min(500, Math.max(1, Math.trunc(requestedLimit) || 200));
    const result = await client.execute({
      sql: `
        SELECT e.*,t.project_id,t.category,p.name AS project_name
        FROM bank_statement_entries e
        LEFT JOIN transactions t ON t.id=e.transaction_id
        LEFT JOIN projects p ON p.id=t.project_id
        WHERE e.bank_account_id=?
        ORDER BY e.date DESC,e.created_at DESC
        LIMIT ?
      `,
      args: [accountId, limit],
    });
    return ok(
      result.rows.map((row) =>
        mapBankEntry(row as Record<string, unknown>),
      ),
    );
  }

  if (accountId && request.method === "POST" && action === "import") {
    return importStatement(request, user, accountId);
  }

  if (accountId && request.method === "POST" && action === "sync") {
    return syncAccount(request, user, accountId);
  }

  if (accountId && request.method === "PATCH" && !action) {
    if (user.role !== "Admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya Admin yang dapat mengubah konfigurasi rekening.",
      );
    }
    const current = await findAccount(client, accountId);
    const input = partialPatchSchema(accountSchema).parse(await jsonBody(request));
    const usage = await accountUsage(client, accountId);
    if (
      input.openingBalance !== undefined &&
      input.openingBalance !== asNumber(current.opening_balance) &&
      totalAccountUsage(usage) > 0
    ) {
      throw new ApiError(
        409,
        "OPENING_BALANCE_LOCKED",
        "Saldo awal tidak dapat diubah karena rekening sudah memiliki mutasi atau pembayaran.",
        usage,
      );
    }
    const syncMode = input.syncMode ?? String(current.sync_mode);
    const externalAccountId =
      input.externalAccountId === undefined
        ? current.external_account_id
        : input.externalAccountId || null;
    if (syncMode === "API" && !externalAccountId) {
      throw new ApiError(
        422,
        "BANK_ACCOUNT_NOT_LINKED",
        "Isi Account ID provider untuk metode API.",
      );
    }
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `
        UPDATE bank_accounts SET
          bank_name=?,account_name=?,account_number_masked=?,external_account_id=?,
          currency=?,opening_balance=?,sync_mode=?,status=?,updated_at=?
        WHERE id=?
      `,
      args: [
        input.bankName ?? current.bank_name,
        input.accountName ?? current.account_name,
        input.accountNumber
          ? maskAccountNumber(input.accountNumber)
          : current.account_number_masked,
        externalAccountId,
        (input.currency ?? String(current.currency)).toUpperCase(),
        input.openingBalance ?? current.opening_balance,
        syncMode,
        input.status ?? current.status,
        timestamp,
        accountId,
      ],
    });
    await refreshCalculatedBalance(client, accountId);
    await writeAuditLog(client, request, user, "update", "bank_account", accountId, {
      bankName: input.bankName,
      syncMode: input.syncMode,
      status: input.status,
    });
    return ok(
      (await listAccounts(client)).find((account) => account.id === accountId),
    );
  }

  if (accountId && request.method === "DELETE" && !action) {
    if (user.role !== "Admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya Admin yang dapat menghapus rekening perusahaan.",
      );
    }
    const current = await findAccount(client, accountId);
    const usage = await accountUsage(client, accountId);
    if (totalAccountUsage(usage) > 0) {
      throw new ApiError(
        409,
        "BANK_ACCOUNT_IN_USE",
        "Rekening pernah digunakan dan tidak dapat dihapus. Nonaktifkan rekening agar histori tetap utuh.",
        usage,
      );
    }
    await client.execute({
      sql: "DELETE FROM bank_accounts WHERE id=?",
      args: [accountId],
    });
    await writeAuditLog(client, request, user, "delete", "bank_account", accountId, {
      bankName: current.bank_name,
      accountNumberMasked: current.account_number_masked,
      usage,
    });
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint rekening bank tidak ditemukan.");
}
