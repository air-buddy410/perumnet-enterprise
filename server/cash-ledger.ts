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

/**
 * Voiding a posted document does not delete its cash row — it books an equal
 * entry in the opposite direction so the ledger keeps both halves of the story
 * and `netCash` returns to where it started. Those reversal rows are the only
 * rows in the table whose direction means "undo", never "money moved".
 *
 * Reading them as ordinary cash inflated *both* gross figures at once: voiding a
 * Rp 2.000.000 vendor payment left a project with zero net movement reporting
 * `income: 2.000.000, expense: 4.000.000`, and nothing ever brought those totals
 * back down. Gross income and gross expense therefore net a reversal against the
 * side it undoes instead of adding it to the other side.
 *
 * The list is the source convention already used by every void path; a reversal
 * source is never reused for an ordinary posting.
 */
export const REVERSAL_CASH_SOURCES = [
  "Invoice Payment Reversal",
  "Procurement Reversal",
  "Project Expense Reversal",
  "Project Advance Reversal",
  "Profit Share Reversal",
  "Tax Settlement Reversal",
] as const;

export function reversalCashCondition(alias = "transactions") {
  const sources = REVERSAL_CASH_SOURCES.map((source) => `'${source}'`).join(",");
  return `${alias}.source IN (${sources})`;
}

function grossCashSum(
  direction: "Pemasukan" | "Pengeluaran",
  alias: string,
  scope: string,
) {
  const opposite = direction === "Pemasukan" ? "Pengeluaran" : "Pemasukan";
  const guard = scope ? `${scope} AND ` : "";
  const reversal = reversalCashCondition(alias);
  return `COALESCE(SUM(CASE
    WHEN ${guard}NOT ${reversal} AND ${alias}.type='${direction}' THEN ${alias}.amount
    WHEN ${guard}${reversal} AND ${alias}.type='${opposite}' THEN -${alias}.amount
    ELSE 0 END),0)`;
}

/**
 * Gross reported income. `scope` is an optional extra SQL predicate the caller
 * already trusts (never user input); rows outside it contribute nothing.
 */
export function grossIncomeSum(alias = "transactions", scope = "") {
  return grossCashSum("Pemasukan", alias, scope);
}

export function grossExpenseSum(alias = "transactions", scope = "") {
  return grossCashSum("Pengeluaran", alias, scope);
}

/**
 * The same rule for aggregates assembled in JavaScript (the cash-flow PDF).
 * Returns the signed contribution of one ledger row to gross income and gross
 * expense; a reversal contributes a negative amount to the side it undoes.
 */
export function grossCashContribution(entry: {
  type: string;
  source: string;
  amount: number;
}) {
  const reversal = (REVERSAL_CASH_SOURCES as readonly string[]).includes(
    entry.source,
  );
  const inflow = entry.type === "Pemasukan";
  if (reversal) {
    return inflow
      ? { income: 0, expense: -entry.amount }
      : { income: -entry.amount, expense: 0 };
  }
  return inflow
    ? { income: entry.amount, expense: 0 }
    : { income: 0, expense: entry.amount };
}
