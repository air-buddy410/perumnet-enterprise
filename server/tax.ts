import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./db/client";

export type TaxDocumentType = "Quotation" | "Invoice" | "SPK" | "PO";
export type TaxEffect = "Add" | "Withhold";
export type TaxTreatment =
  | "Payable"
  | "Receivable"
  | "Recoverable"
  | "Expense";

export interface TaxSnapshot {
  id: string;
  documentType: TaxDocumentType;
  documentId: string;
  projectId?: string;
  ruleId?: string;
  code: string;
  name: string;
  nameEn: string;
  scope: "Client" | "Vendor" | "Both";
  effect: TaxEffect;
  accountingTreatment: TaxTreatment;
  rateBps: number;
  taxableBase: number;
  amount: number;
  locked: boolean;
}

export interface TaxTotals {
  taxAdditions: number;
  taxWithholdings: number;
  grossTotal: number;
  netCashDue: number;
}

function integer(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function calculateTaxAmount(taxableBase: number, rateBps: number) {
  return Math.round((taxableBase * rateBps) / 10_000);
}

export function calculateTaxTotals(
  baseAmount: number,
  taxes: Array<Pick<TaxSnapshot, "effect" | "amount">>,
): TaxTotals {
  const taxAdditions = taxes
    .filter((tax) => tax.effect === "Add")
    .reduce((total, tax) => total + tax.amount, 0);
  const taxWithholdings = taxes
    .filter((tax) => tax.effect === "Withhold")
    .reduce((total, tax) => total + tax.amount, 0);
  const grossTotal = baseAmount + taxAdditions;
  return {
    taxAdditions,
    taxWithholdings,
    grossTotal,
    netCashDue: Math.max(0, grossTotal - taxWithholdings),
  };
}

export function mapTaxSnapshot(row: Record<string, unknown>): TaxSnapshot {
  return {
    id: String(row.id),
    documentType: String(row.document_type) as TaxDocumentType,
    documentId: String(row.document_id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    ruleId: row.rule_id ? String(row.rule_id) : undefined,
    code: String(row.rule_code),
    name: String(row.rule_name),
    nameEn: String(row.rule_name_en),
    scope: String(row.scope) as TaxSnapshot["scope"],
    effect: String(row.effect) as TaxEffect,
    accountingTreatment: String(
      row.accounting_treatment,
    ) as TaxTreatment,
    rateBps: integer(row.rate_bps),
    taxableBase: integer(row.taxable_base),
    amount: integer(row.amount),
    locked: Number(row.locked) === 1 || row.locked === true,
  };
}

export async function getDocumentTaxes(
  client: DatabaseClient,
  documentType: TaxDocumentType,
  documentId: string,
) {
  const result = await client.execute({
    sql: `SELECT * FROM document_taxes
      WHERE document_type=? AND document_id=?
      ORDER BY created_at,id`,
    args: [documentType, documentId],
  });
  return result.rows.map((row) => mapTaxSnapshot(row));
}

/**
 * Arah kewajiban. Untuk pajak POTONG arahnya ditentukan oleh siapa yang
 * memotong — bukan oleh `accounting_treatment`: kalau KITA memotong dari vendor
 * (SPK/PO), uangnya tertahan di kita dan wajib disetor (Payable); kalau KLIEN
 * memotong dari kita (Invoice), itu piutang kredit pajak (Receivable). Dulu
 * Withhold + "Expense" menghasilkan `undefined`: uang potongannya tidak pernah
 * menjadi kewajiban siapa pun dan diam-diam terhitung laba.
 */
function obligationDirection(tax: TaxSnapshot, documentType: TaxDocumentType) {
  if (tax.effect === "Withhold") {
    return documentType === "Invoice" ? "Receivable" : "Payable";
  }
  if (tax.accountingTreatment === "Payable") return "Payable";
  if (
    tax.accountingTreatment === "Receivable" ||
    tax.accountingTreatment === "Recoverable"
  ) {
    return "Receivable";
  }
  return undefined;
}

function obligationStatusFor(amount: number, settled: number) {
  if (settled <= 0) return "Outstanding";
  if (settled >= amount) return "Settled";
  return "Partially Settled";
}

async function upsertObligation(
  client: DatabaseClient,
  tax: TaxSnapshot,
  direction: "Payable" | "Receivable",
  amount: number,
  dueDate: string | undefined,
  timestamp: string,
) {
  const existing = await client.execute({
    sql: "SELECT settled_amount FROM tax_obligations WHERE document_tax_id=? LIMIT 1",
    args: [tax.id],
  });
  const settled = Number(existing.rows[0]?.settled_amount ?? 0);
  await client.execute({
    sql: `INSERT INTO tax_obligations
      (id,document_tax_id,project_id,direction,amount,settled_amount,status,
       reporting_status,tax_period,due_date,created_at,updated_at)
      VALUES (?,?,?,?,?,0,?,'Candidate',?,?,?,?)
      ON CONFLICT (document_tax_id) DO UPDATE SET
        project_id=excluded.project_id,
        direction=excluded.direction,
        amount=excluded.amount,
        status=excluded.status,
        tax_period=COALESCE(excluded.tax_period,tax_obligations.tax_period),
        due_date=COALESCE(excluded.due_date,tax_obligations.due_date),
        updated_at=excluded.updated_at`,
    args: [
      `tax-obligation-${randomUUID()}`,
      tax.id,
      tax.projectId ?? null,
      direction,
      amount,
      obligationStatusFor(amount, settled),
      dueDate?.slice(0, 7) ?? null,
      dueDate ?? null,
      timestamp,
      timestamp,
    ],
  });
}

/**
 * Kewajiban pajak POTONG mengikuti kas yang benar-benar dipotong.
 *
 * PPh 23 terutang saat pembayaran, bukan saat dokumen disetujui. Dulu
 * `lockDocumentTaxes` mencatat kewajiban sebesar snapshot PENUH begitu SPK
 * disetujui, sementara `payOrder` memotong per pembayaran — dan tidak ada yang
 * merekonsiliasi keduanya: dokumen yang baru 50% dibayar tetap melaporkan 100%
 * PPh sebagai utang, lalu seluruhnya dikurangkan dari laba aman dibagikan.
 *
 * Dipanggil setiap pembayaran dipost atau di-void, di dalam transaksinya.
 * Beberapa aturan potong pada satu dokumen berbagi potongan secara prorata
 * snapshot-nya; tanpa potongan (dan belum ada setoran) barisnya dihapus.
 */
export async function refreshWithholdingObligations(
  client: DatabaseClient,
  documentType: TaxDocumentType,
  documentId: string,
  dueDate?: string,
) {
  const taxes = (await getDocumentTaxes(client, documentType, documentId)).filter(
    (tax) => tax.effect === "Withhold",
  );
  if (!taxes.length) return;
  const withheldResult = await client.execute(
    documentType === "Invoice"
      ? {
          sql: "SELECT COALESCE(SUM(withholding_amount),0) AS total FROM invoice_payments WHERE invoice_id=? AND status='Posted'",
          args: [documentId],
        }
      : {
          sql: "SELECT COALESCE(SUM(withholding_amount),0) AS total FROM spk_payments WHERE spk_id=? AND status='Posted'",
          args: [documentId],
        },
  );
  const withheld = Number(withheldResult.rows[0]?.total ?? 0);
  const snapshotTotal = taxes.reduce((sum, tax) => sum + tax.amount, 0);
  const timestamp = new Date().toISOString();
  let allocated = 0;
  for (const [index, tax] of taxes.entries()) {
    const last = index === taxes.length - 1;
    const share = last
      ? withheld - allocated
      : snapshotTotal > 0
        ? Math.round((withheld * tax.amount) / snapshotTotal)
        : 0;
    allocated += share;
    const direction = obligationDirection(tax, documentType);
    if (!direction) continue;
    if (share > 0) {
      await upsertObligation(client, tax, direction, share, dueDate, timestamp);
      continue;
    }
    await client.execute({
      sql: "DELETE FROM tax_obligations WHERE document_tax_id=? AND settled_amount=0",
      args: [tax.id],
    });
  }
}

export async function lockDocumentTaxes(
  client: DatabaseClient,
  documentType: TaxDocumentType,
  documentId: string,
  dueDate?: string,
) {
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `UPDATE document_taxes
      SET locked=1,locked_at=COALESCE(locked_at,?),updated_at=?
      WHERE document_type=? AND document_id=?`,
    args: [timestamp, timestamp, documentType, documentId],
  });
  const taxes = await getDocumentTaxes(client, documentType, documentId);
  if (documentType === "Quotation") return taxes;
  for (const tax of taxes) {
    // Pajak potong tidak dicatat di sini: kewajibannya lahir saat pemotongan
    // (refreshWithholdingObligations), bukan saat dokumen dikunci.
    if (tax.effect === "Withhold") continue;
    const direction = obligationDirection(tax, documentType);
    if (!direction || tax.amount <= 0) continue;
    await upsertObligation(client, tax, direction, tax.amount, dueDate, timestamp);
  }
  return taxes;
}

export async function documentTaxSummary(
  client: DatabaseClient,
  documentType: TaxDocumentType,
  documentId: string,
  baseAmount: number,
) {
  const taxes = await getDocumentTaxes(client, documentType, documentId);
  return {
    taxes,
    ...calculateTaxTotals(baseAmount, taxes),
  };
}
