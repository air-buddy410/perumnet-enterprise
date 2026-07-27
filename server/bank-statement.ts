import "server-only";

import { createHash } from "node:crypto";

export type BankEntryType = "Pemasukan" | "Pengeluaran";

export interface ParsedBankStatementEntry {
  date: string;
  description: string;
  type: BankEntryType;
  amount: number;
  runningBalance?: number;
  reference?: string;
  fingerprint: string;
  raw: Record<string, unknown>;
}

export interface ParsedBankStatement {
  entries: ParsedBankStatementEntry[];
  errors: string[];
}

const HEADER_ALIASES = {
  date: ["tanggal", "date", "transactiondate", "bookingdate", "valuedate", "tgl"],
  description: [
    "keterangan",
    "transaksi",
    "description",
    "narrative",
    "remarks",
    "uraian",
    "detailtransaksi",
  ],
  debit: ["debit", "debet", "withdrawal", "penarikan", "keluar"],
  credit: ["credit", "kredit", "deposit", "setoran", "masuk"],
  amount: ["mutasi", "jumlah", "amount", "nominal", "transactionamount"],
  balance: ["saldo", "balance", "runningbalance", "accountbalance"],
  reference: [
    "referensi",
    "reference",
    "referenceno",
    "nomorreferensi",
    "noreferensi",
    "ref",
  ],
} as const;

function normalizedHeader(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseDelimitedRows(input: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function delimiterScore(input: string, delimiter: string) {
  const rows = parseDelimitedRows(input, delimiter).slice(0, 8);
  if (!rows.length) return 0;
  const widths = rows.map((row) => row.length);
  const widest = Math.max(...widths);
  const consistent = widths.filter((width) => width === widest).length;
  return widest * consistent;
}

function detectDelimiter(input: string) {
  return [",", ";", "\t"].sort(
    (left, right) => delimiterScore(input, right) - delimiterScore(input, left),
  )[0];
}

function headerIndex(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseDate(value: string, statementMonth?: string) {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return validIsoDate(Number(year), Number(month), Number(day));
  }

  const local = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/);
  if (!local) return null;
  const [, day, month, rawYear] = local;
  const fallbackYear = statementMonth?.match(/^(\d{4})-\d{2}$/)?.[1];
  let year = rawYear ?? fallbackYear;
  if (!year) return null;
  if (year.length === 2) year = `20${year}`;
  return validIsoDate(Number(year), Number(month), Number(day));
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMoney(value: string) {
  const cleaned = value
    .replace(/\b(?:IDR|RP)\b/gi, "")
    .replace(/\b(?:CR|CREDIT|KREDIT|DB|DR|DEBIT|DEBET)\b/gi, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (comma >= 0 && dot >= 0) {
    const decimal = Math.max(comma, dot);
    normalized = `${cleaned.slice(0, decimal).replace(/[.,]/g, "")}.${cleaned.slice(decimal + 1)}`;
  } else {
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : "";
    if (separator) {
      const pieces = cleaned.split(separator);
      const last = pieces.at(-1) ?? "";
      normalized =
        last.length === 2 && pieces.length === 2
          ? `${pieces[0]}.${last}`
          : pieces.join("");
    }
  }
  const amount = Math.round(Math.abs(Number(normalized)));
  return Number.isSafeInteger(amount) ? amount : null;
}

function directionFromAmount(value: string) {
  if (/\b(?:CR|CREDIT|KREDIT)\b/i.test(value)) return "Pemasukan" as const;
  if (/\b(?:DB|DR|DEBIT|DEBET)\b/i.test(value)) return "Pengeluaran" as const;
  if (/^\s*-/.test(value) || /^\s*\(.*\)\s*$/.test(value)) {
    return "Pengeluaran" as const;
  }
  return null;
}

export function createBankEntryFingerprint(
  accountId: string,
  values: Omit<ParsedBankStatementEntry, "fingerprint" | "raw">,
  occurrence: number,
) {
  const normalizedDescription = values.description
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return createHash("sha256")
    .update(
      [
        accountId,
        values.date,
        values.type,
        values.amount,
        normalizedDescription,
        values.reference ?? "",
        values.runningBalance ?? "",
        occurrence,
      ].join("|"),
    )
    .digest("hex");
}

export function parseBankStatementCsv(
  input: string,
  accountId: string,
  statementMonth?: string,
): ParsedBankStatement {
  const normalizedInput = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalizedInput);
  const rows = parseDelimitedRows(normalizedInput, delimiter);
  if (rows.length < 2) {
    return {
      entries: [],
      errors: ["File tidak memiliki header dan baris mutasi."],
    };
  }

  const headerRowIndex = rows.slice(0, 20).findIndex((row) => {
    const candidate = row.map(normalizedHeader);
    const hasDate = headerIndex(candidate, HEADER_ALIASES.date) >= 0;
    const hasDescription =
      headerIndex(candidate, HEADER_ALIASES.description) >= 0;
    const hasAmount =
      headerIndex(candidate, HEADER_ALIASES.amount) >= 0 ||
      headerIndex(candidate, HEADER_ALIASES.debit) >= 0 ||
      headerIndex(candidate, HEADER_ALIASES.credit) >= 0;
    return hasDate && hasDescription && hasAmount;
  });
  if (headerRowIndex < 0) {
    return {
      entries: [],
      errors: [
        "Header mutasi tidak ditemukan. Gunakan CSV dengan kolom Tanggal, Keterangan/Transaksi, dan Mutasi atau Debit/Kredit.",
      ],
    };
  }

  const headers = rows[headerRowIndex].map(normalizedHeader);
  const indexes = {
    date: headerIndex(headers, HEADER_ALIASES.date),
    description: headerIndex(headers, HEADER_ALIASES.description),
    debit: headerIndex(headers, HEADER_ALIASES.debit),
    credit: headerIndex(headers, HEADER_ALIASES.credit),
    amount: headerIndex(headers, HEADER_ALIASES.amount),
    balance: headerIndex(headers, HEADER_ALIASES.balance),
    reference: headerIndex(headers, HEADER_ALIASES.reference),
  };
  if (indexes.date < 0 || indexes.description < 0) {
    return {
      entries: [],
      errors: [
        "Header tanggal atau keterangan tidak ditemukan. Gunakan CSV dengan kolom Tanggal dan Keterangan/Transaksi.",
      ],
    };
  }
  if (indexes.amount < 0 && indexes.debit < 0 && indexes.credit < 0) {
    return {
      entries: [],
      errors: [
        "Kolom nominal tidak ditemukan. Gunakan Mutasi/Jumlah atau kolom Debit dan Kredit.",
      ],
    };
  }

  const errors: string[] = [];
  const entries: ParsedBankStatementEntry[] = [];
  const occurrences = new Map<string, number>();

  rows.slice(headerRowIndex + 1).forEach((row, rowOffset) => {
    const line = headerRowIndex + rowOffset + 2;
    const date = parseDate(row[indexes.date] ?? "", statementMonth);
    const description = (row[indexes.description] ?? "").trim();
    const debitValue = indexes.debit >= 0 ? row[indexes.debit] ?? "" : "";
    const creditValue = indexes.credit >= 0 ? row[indexes.credit] ?? "" : "";
    const amountValue = indexes.amount >= 0 ? row[indexes.amount] ?? "" : "";
    const debit = parseMoney(debitValue);
    const credit = parseMoney(creditValue);
    const amount = credit || debit || parseMoney(amountValue);
    const type =
      credit && credit > 0
        ? "Pemasukan"
        : debit && debit > 0
          ? "Pengeluaran"
          : directionFromAmount(amountValue);

    if (!date || !description || !amount || !type) {
      if (
        description &&
        !/saldo\s+awal|opening\s+balance|saldo\s+akhir|closing\s+balance/i.test(
          description,
        )
      ) {
        errors.push(`Baris ${line} dilewati karena tanggal, deskripsi, arah, atau nominal tidak valid.`);
      }
      return;
    }

    const runningBalance =
      indexes.balance >= 0
        ? parseMoney(row[indexes.balance] ?? "") ?? undefined
        : undefined;
    const reference =
      indexes.reference >= 0
        ? (row[indexes.reference] ?? "").trim() || undefined
        : undefined;
    const raw = Object.fromEntries(
      headers.map((header, index) => [header || `column${index + 1}`, row[index] ?? ""]),
    );
    const fingerprintBase = [
      date,
      type,
      amount,
      description.trim().replace(/\s+/g, " ").toLowerCase(),
      reference ?? "",
      runningBalance ?? "",
    ].join("|");
    const occurrence = (occurrences.get(fingerprintBase) ?? 0) + 1;
    occurrences.set(fingerprintBase, occurrence);
    const values = {
      date,
      description,
      type,
      amount,
      ...(runningBalance === undefined ? {} : { runningBalance }),
      ...(reference ? { reference } : {}),
    };
    entries.push({
      ...values,
      fingerprint: createBankEntryFingerprint(accountId, values, occurrence),
      raw,
    });
  });

  return { entries, errors: errors.slice(0, 50) };
}

export function inferCashCategory(
  description: string,
  type: BankEntryType,
) {
  const normalized = description.toLowerCase();
  if (/pajak|tax|ppn|pph/.test(normalized)) return "Pajak";
  if (/gaji|payroll|salary|upah/.test(normalized)) return "Gaji";
  if (/vendor|supplier|spk|material|perangkat/.test(normalized)) return "Vendor";
  if (/invoice|pelunasan|pembayaran|transfer masuk/.test(normalized)) {
    return type === "Pemasukan" ? "Penjualan" : "Operasional";
  }
  if (/modal|setoran pemilik|owner/.test(normalized)) return "Modal";
  if (/biaya|admin|fee|operasional|transport|listrik|internet/.test(normalized)) {
    return "Operasional";
  }
  return "Lainnya";
}
