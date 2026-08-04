import "server-only";

/**
 * Importing a bank statement posts a `Bank:` transaction for every line it could
 * not match to exactly one existing transaction. That line usually duplicates a
 * source document that already booked the same cash (an invoice payment, a
 * vendor payment, a tax settlement), so counting it would report the money
 * twice for the whole window between the import and the manual reconciliation.
 *
 * Reported cash therefore ignores those rows until somebody reconciles them.
 * They are never hidden: the ledger still lists them, the summary reports the
 * pending figure separately, and every transaction carries `countsAsCash`.
 *
 * `alias` is always a literal table alias chosen by the caller, never input.
 */
export function unreconciledImportCondition(alias = "transactions") {
  return `EXISTS (
    SELECT 1 FROM bank_statement_entries unreconciled_bse
    WHERE unreconciled_bse.transaction_id=${alias}.id
      AND unreconciled_bse.reconciliation_status='Imported'
  )`;
}

export function countsAsCashCondition(alias = "transactions") {
  return `NOT ${unreconciledImportCondition(alias)}`;
}
