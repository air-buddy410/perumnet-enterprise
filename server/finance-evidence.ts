import "server-only";

import type { FinanceEvidenceKind } from "../shared/finance-evidence";

/**
 * Peta `transactions.source` → jenis bukti.
 *
 * Satu sumber hanya punya satu jenis, dan setiap sumber yang pernah ditulis
 * aplikasi ini ada di sini. Sumber yang TIDAK ada di sini bukan berarti tak
 * bernilai: baris `'SPK'`/`'Invoice'` warisan masih dihitung buku kas, jadi
 * arsip memberinya jenis `other` — kalau dijatuhkan diam-diam, total arsip
 * tidak akan pernah cocok dengan total buku kas, dan tidak ada yang tahu
 * kenapa.
 */
export const LEDGER_SOURCE_KIND: Record<string, FinanceEvidenceKind> = {
  "Invoice Payment": "invoice-payment",
  "Invoice Payment Reversal": "invoice-payment",
  "Procurement Payment": "spk-payment",
  "Procurement Reversal": "spk-payment",
  "Tax Settlement": "tax-settlement",
  "Tax Settlement Reversal": "tax-settlement",
  "Project Expense": "expense-settlement",
  "Project Expense Reimbursement": "expense-settlement",
  "Project Advance Return": "expense-settlement",
  "Project Expense Reversal": "expense-settlement",
  "Project Advance": "advance",
  "Project Advance Reversal": "advance",
  "Profit Share": "profit-share",
  "Company Treasury": "profit-share",
  "Company Treasury In": "profit-share",
  "Profit Share Reversal": "profit-share",
  "Company Treasury Reversal": "profit-share",
  "Company Treasury In Reversal": "profit-share",
};

export function ledgerSourcesOf(kind: FinanceEvidenceKind) {
  return Object.entries(LEDGER_SOURCE_KIND)
    .filter(([, k]) => k === kind)
    .map(([source]) => source);
}

/** Seluruh sumber bernama — cabang `other` adalah komplemen dari daftar ini. */
export const KNOWN_LEDGER_SOURCES = Object.keys(LEDGER_SOURCE_KIND);

/**
 * Jenis + id bukti untuk satu baris buku kas, dipakai `mapTransaction` supaya
 * layar buku kas bisa melompat ke arsip.
 *
 * `:void` dibuang: reversal SPK dan bagi hasil memakai `${id}:void`, sedangkan
 * invoice dan pajak memakai id telanjang. Reversal belanja dan uang muka
 * menunjuk baris settlement BARU bertipe Reversal — id itu tetap sah sebagai
 * kunci bukti (arsip memetakannya ke belanja/uang muka asal lewat
 * `expense_id`/`advance_id`).
 */
export function ledgerEvidenceKey(row: {
  id: unknown;
  source: unknown;
  reference_id?: unknown;
  origin?: unknown;
}): { kind: FinanceEvidenceKind; evidenceId: string } {
  const id = String(row.id);
  const source = String(row.source ?? "");
  const reference = row.reference_id ? String(row.reference_id) : null;
  if (String(row.origin ?? "system") === "manual") return { kind: "manual", evidenceId: id };
  if (source.startsWith("Bank:")) return { kind: "bank-line", evidenceId: reference ?? id };
  const kind = LEDGER_SOURCE_KIND[source];
  if (!kind || !reference) return { kind: "other", evidenceId: id };
  return { kind, evidenceId: reference.replace(/:void$/, "") };
}
