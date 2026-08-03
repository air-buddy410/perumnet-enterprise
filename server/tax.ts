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

function obligationDirection(tax: TaxSnapshot) {
  if (tax.accountingTreatment === "Payable") return "Payable";
  if (
    tax.accountingTreatment === "Receivable" ||
    tax.accountingTreatment === "Recoverable"
  ) {
    return "Receivable";
  }
  return undefined;
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
    const direction = obligationDirection(tax);
    if (!direction || tax.amount <= 0) continue;
    await client.execute({
      sql: `INSERT INTO tax_obligations
        (id,document_tax_id,project_id,direction,amount,settled_amount,status,
         reporting_status,tax_period,due_date,created_at,updated_at)
        VALUES (?,?,?,?,?,0,'Outstanding','Candidate',?,?,?,?)
        ON CONFLICT (document_tax_id) DO UPDATE SET
          project_id=excluded.project_id,
          direction=excluded.direction,
          amount=excluded.amount,
          tax_period=COALESCE(excluded.tax_period,tax_obligations.tax_period),
          due_date=COALESCE(excluded.due_date,tax_obligations.due_date),
          updated_at=excluded.updated_at`,
      args: [
        `tax-obligation-${randomUUID()}`,
        tax.id,
        tax.projectId ?? null,
        direction,
        tax.amount,
        dueDate?.slice(0, 7) ?? null,
        dueDate ?? null,
        timestamp,
        timestamp,
      ],
    });
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
