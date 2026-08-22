// Kontrak arsip bukti keuangan — dipakai server DAN layar.
//
// Satu baris arsip = satu baris buku kas (`transactions`), ditambah dua jenis
// bukti kontrak yang tidak menggerakkan uang tetapi diperiksa Finance: tanda
// terima quotation dan BAST final. Yang menyatukan semuanya bukan tabelnya —
// tiap jenis hidup di tabelnya sendiri — melainkan pertanyaan yang sama:
// "uang ini bergerak kapan, berapa, ke siapa, dan mana buktinya?"

import type { AccessModule } from "./access";

export const financeEvidenceKinds = [
  "invoice-payment",
  "spk-payment",
  "tax-settlement",
  "expense-settlement",
  "advance",
  "profit-share",
  "bank-line",
  "manual",
  "other",
  "quotation-acceptance",
  "bast",
] as const;
export type FinanceEvidenceKind = (typeof financeEvidenceKinds)[number];

export function isFinanceEvidenceKind(value: string): value is FinanceEvidenceKind {
  return (financeEvidenceKinds as readonly string[]).includes(value);
}

/**
 * Jenis → modul izin yang menaunginya. Sama dengan izin yang dibutuhkan
 * untuk MEMBUAT catatannya: yang boleh mencatat pembayaran invoice boleh
 * melihat buktinya, dan sebaliknya. Arsip tidak membuka pintu baru.
 */
export const financeEvidenceModule: Record<FinanceEvidenceKind, AccessModule> = {
  "invoice-payment": "billing",
  "quotation-acceptance": "billing",
  "spk-payment": "procurement",
  "tax-settlement": "finance",
  "bank-line": "finance",
  manual: "finance",
  other: "finance",
  "expense-settlement": "expenses",
  advance: "expenses",
  "profit-share": "margin",
  bast: "bast",
};

export const financeEvidenceKindLabels: Record<
  FinanceEvidenceKind,
  { id: string; en: string }
> = {
  "invoice-payment": { id: "Pembayaran invoice", en: "Invoice payment" },
  "spk-payment": { id: "Pembayaran vendor", en: "Vendor payment" },
  "tax-settlement": { id: "Setoran pajak", en: "Tax settlement" },
  "expense-settlement": { id: "Belanja & reimburse", en: "Expense & reimbursement" },
  advance: { id: "Uang muka proyek", en: "Project advance" },
  "profit-share": { id: "Bagi hasil", en: "Profit share" },
  "bank-line": { id: "Mutasi bank", en: "Bank statement line" },
  manual: { id: "Transaksi manual", en: "Manual transaction" },
  other: { id: "Catatan kas lain", en: "Other cash entry" },
  "quotation-acceptance": { id: "Tanda terima quotation", en: "Quotation acceptance" },
  bast: { id: "BAST final", en: "Final handover" },
};

/**
 * Jenis yang buktinya tersimpan di dalam baris catatan itu sendiri (base64 di
 * kolom `attachment_*`, diunggah bersama catatannya). Hanya ini yang punya
 * rute `/file`; yang lain buktinya lampiran arsip atau rute yang sudah ada.
 */
export const legacyProofKinds = [
  "invoice-payment",
  "spk-payment",
  "tax-settlement",
  "quotation-acceptance",
] as const;

/** Lampiran per permintaan unggah. */
export const EVIDENCE_ATTACHMENT_MAX_COUNT = 5;
/** Lampiran arsip per baris bukti. Bukti legacy tidak dihitung. */
export const EVIDENCE_ATTACHMENT_LIMIT = 10;

export const financeEvidenceDirections = ["Pemasukan", "Pengeluaran"] as const;
