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
  statementMonth?: string;
  accountNumberLast4?: string;
  closingBalance?: number;
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

const STATEMENT_MONTHS: Record<string, string> = {
  JANUARI: "01",
  JANUARY: "01",
  FEBRUARI: "02",
  FEBRUARY: "02",
  MARET: "03",
  MARCH: "03",
  APRIL: "04",
  MEI: "05",
  MAY: "05",
  JUNI: "06",
  JUNE: "06",
  JULI: "07",
  JULY: "07",
  AGUSTUS: "08",
  AUGUST: "08",
  SEPTEMBER: "09",
  OKTOBER: "10",
  OCTOBER: "10",
  NOVEMBER: "11",
  DESEMBER: "12",
  DECEMBER: "12",
};

interface PdfStatementGroup {
  dateText: string;
  lines: string[];
}

interface MoneyMatch {
  value: string;
  index: number;
}

function statementMonthFromPdf(lines: string[]) {
  for (const line of lines) {
    const normalized = line
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const matched = normalized.match(
      /\b(?:PERIODE|PERIOD)\s*:?\s*([A-Z]+)\s+(\d{4})\b/,
    );
    if (!matched) continue;
    const month = STATEMENT_MONTHS[matched[1]];
    if (month) return `${matched[2]}-${month}`;
  }
  return undefined;
}

function moneyMatches(value: string): MoneyMatch[] {
  const matches: MoneyMatch[] = [];
  const pattern = /(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g;
  for (const match of value.matchAll(pattern)) {
    matches.push({
      value: match[0],
      index: match.index ?? 0,
    });
  }
  return matches;
}

function ledgerAmounts(lines: string[]) {
  const headerMatches = moneyMatches(lines[0] ?? "");
  if (headerMatches.length) {
    return {
      amount: parseMoney(headerMatches[0].value),
      runningBalance:
        headerMatches.length > 1
          ? parseMoney(headerMatches[1].value)
          : null,
    };
  }

  const candidates = lines
    .slice(1)
    .map((line) => ({ line, matches: moneyMatches(line) }))
    .filter((candidate) => candidate.matches.length);
  if (!candidates.length) {
    return { amount: null, runningBalance: null };
  }

  const ledgerCandidate =
    [...candidates]
      .reverse()
      .find(
        ({ line, matches }) =>
          matches.length > 1 ||
          /(?:,|\bDB\b|\bCR\b)/i.test(line) ||
          !/^\d+\.\d{2}$/.test(line),
      ) ?? candidates.at(-1)!;
  return {
    amount: parseMoney(ledgerCandidate.matches[0].value),
    runningBalance:
      ledgerCandidate.matches.length > 1
        ? parseMoney(ledgerCandidate.matches[1].value)
        : null,
  };
}

function pdfDescription(lines: string[]) {
  const parts = lines
    .map((line, index) => {
      if (index > 0 && /^\d[\d.,]*(?:\s+(?:DB|CR))?(?:\s+\d[\d.,]*)?$/i.test(line)) {
        return "";
      }
      const firstAmount = moneyMatches(line)[0];
      const withoutLedger = firstAmount ? line.slice(0, firstAmount.index) : line;
      return withoutLedger.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
  return [...new Set(parts)].join(" · ").slice(0, 500);
}

function pdfReference(description: string) {
  return (
    description.match(
      /\b\d{4}\/[A-Z0-9]{3,}\/[A-Z0-9][A-Z0-9/-]{2,}\b/i,
    )?.[0] ?? undefined
  );
}

/**
 * Parses searchable bank-statement text extracted from PDF. BCA e-statements
 * use a dated primary row followed by zero or more transfer-detail rows. The
 * amount/balance row can appear after those details, so rows are grouped by
 * transaction date before their ledger values are interpreted.
 */
export function parseBankStatementPdfText(
  input: string,
  accountId: string,
  selectedStatementMonth?: string,
): ParsedBankStatement {
  const lines = input
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.normalize("NFKC").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const detectedStatementMonth = statementMonthFromPdf(lines);
  const effectiveStatementMonth =
    detectedStatementMonth ?? selectedStatementMonth;
  const accountNumber = input
    .replace(/\s+/g, " ")
    .match(/NO\.?\s*REKENING\s*:\s*([0-9][0-9 .-]{5,})/i)?.[1]
    ?.replace(/\D/g, "");
  const accountNumberLast4 =
    accountNumber && accountNumber.length >= 4
      ? accountNumber.slice(-4)
      : undefined;
  const closingBalanceMatch = input.match(
    /SALDO\s+AKHIR\s*:\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i,
  );
  const closingBalance = closingBalanceMatch
    ? parseMoney(closingBalanceMatch[1]) ?? undefined
    : undefined;

  const groups: PdfStatementGroup[] = [];
  let current: PdfStatementGroup | null = null;
  let insideTable = false;
  const flush = () => {
    if (current) groups.push(current);
    current = null;
  };

  for (const line of lines) {
    if (/\bTANGGAL\b.*\bKETERANGAN\b.*\bMUTASI\b/i.test(line)) {
      flush();
      insideTable = true;
      continue;
    }
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) {
      flush();
      insideTable = false;
      continue;
    }
    if (/^SALDO\s+AWAL\s*:/i.test(line)) {
      flush();
      insideTable = false;
      continue;
    }
    if (!insideTable) continue;

    const dated = line.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)$/);
    if (dated) {
      flush();
      current = { dateText: dated[1], lines: [dated[2]] };
      continue;
    }
    if (current && !/^\d+\s*\/\s*\d+$/.test(line)) {
      current.lines.push(line);
    }
  }
  flush();

  const entries: ParsedBankStatementEntry[] = [];
  const errors: string[] = [];
  const occurrences = new Map<string, number>();

  for (const group of groups) {
    const date = parseDate(group.dateText, effectiveStatementMonth);
    const description = pdfDescription(group.lines);
    if (/saldo\s+awal|opening\s+balance/i.test(description)) continue;
    const { amount, runningBalance } = ledgerAmounts(group.lines);
    const type: BankEntryType = /\b(?:DB|DR|DEBIT|DEBET)\b/i.test(
      group.lines.join(" "),
    )
      ? "Pengeluaran"
      : "Pemasukan";
    if (!date || !description || !amount) {
      errors.push(
        `Mutasi ${group.dateText} dilewati karena tanggal, deskripsi, atau nominal tidak valid.`,
      );
      continue;
    }

    const reference = pdfReference(description);
    const values = {
      date,
      description,
      type,
      amount,
      ...(runningBalance === null || runningBalance === undefined
        ? {}
        : { runningBalance }),
      ...(reference ? { reference } : {}),
    };
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
    entries.push({
      ...values,
      fingerprint: createBankEntryFingerprint(accountId, values, occurrence),
      raw: {
        format: "PDF",
        lines: group.lines,
      },
    });
  }

  if (entries.length && closingBalance !== undefined) {
    const last = entries.at(-1)!;
    if (last.runningBalance === undefined) {
      last.runningBalance = closingBalance;
    }
  }

  if (!groups.length) {
    errors.push(
      "Tabel mutasi tidak ditemukan. Gunakan PDF e-statement yang teksnya dapat dipilih, bukan hasil scan/foto.",
    );
  }

  return {
    entries,
    errors: errors.slice(0, 50),
    ...(detectedStatementMonth
      ? { statementMonth: detectedStatementMonth }
      : {}),
    ...(accountNumberLast4 ? { accountNumberLast4 } : {}),
    ...(closingBalance === undefined ? {} : { closingBalance }),
  };
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
