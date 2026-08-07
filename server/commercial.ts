export type DiscountType = "Nominal" | "Percent";
export type RoundingMode = "None" | "Up" | "Down" | "Custom";

export interface QuotationCommercialInput {
  subtotal: number;
  discountEnabled?: boolean;
  discountType?: DiscountType;
  discountValue?: number;
  taxAdditions?: number;
  taxWithholdings?: number;
  roundingMode?: RoundingMode;
  roundingStep?: number;
  customRoundingAdjustment?: number;
}

export interface QuotationCommercialTotals {
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  taxAdditions: number;
  taxWithholdings: number;
  beforeRounding: number;
  roundingAdjustment: number;
  grandTotal: number;
  netCashDue: number;
}

function money(value: unknown) {
  const result = Math.round(Number(value ?? 0));
  return Number.isFinite(result) ? result : 0;
}

/** The coarsest automatic rounding the UI offers. */
export const MAX_ROUNDING_STEP = 100_000;

/**
 * How far a *rounding* adjustment may move the grand total.
 *
 * The field is labelled "pembulatan" and its value flows straight into the
 * invoice snapshots, but it used to be validated only against
 * `Number.MAX_SAFE_INTEGER` — so `roundingAdjustment: 500.000.000` on a
 * Rp 10.000.000 quotation produced a Rp 510.000.000 grand total. A required
 * reason is not a cap: an unbounded field labelled "rounding" is an unlogged
 * price override that bypasses the discount and tax fields entirely.
 *
 * The bound is the larger of the coarsest automatic step (Rp 100.000 — so every
 * adjustment the Up/Down modes can ever produce is legal by construction) and
 * 1% of the pre-rounding total, which keeps "round this Rp 480.000.000 contract
 * to the nearest million" workable without opening the door to a second
 * discount. Anything beyond that is a price change and belongs in the discount
 * or tax fields, where it is named for what it is.
 */
export function customRoundingLimit(beforeRounding: number) {
  return Math.max(
    MAX_ROUNDING_STEP,
    Math.ceil(Math.abs(money(beforeRounding)) / 100),
  );
}

export function calculateQuotationCommercialTotals(
  input: QuotationCommercialInput,
): QuotationCommercialTotals {
  const subtotal = Math.max(0, money(input.subtotal));
  const discountValue = Math.max(0, money(input.discountValue));
  const discountAmount = input.discountEnabled
    ? Math.min(
        subtotal,
        input.discountType === "Percent"
          ? Math.round((subtotal * Math.min(10_000, discountValue)) / 10_000)
          : discountValue,
      )
    : 0;
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxAdditions = Math.max(0, money(input.taxAdditions));
  const taxWithholdings = Math.max(0, money(input.taxWithholdings));
  const beforeRounding = taxableBase + taxAdditions;
  const mode = input.roundingMode ?? "None";
  const step = [1_000, 10_000, 100_000].includes(money(input.roundingStep))
    ? money(input.roundingStep)
    : 0;
  let roundingAdjustment = 0;
  if (mode === "Custom") {
    // Clamped rather than trusted: the write endpoint refuses an out-of-range
    // value with a friendly message, and this keeps every other consumer
    // (recomputes, revision copies, invoice snapshots, the catalog writer)
    // inside the bound even for a row stored before the cap existed.
    const limit = customRoundingLimit(beforeRounding);
    roundingAdjustment = Math.max(
      -limit,
      Math.min(limit, money(input.customRoundingAdjustment)),
    );
  } else if (step > 0 && mode === "Up") {
    roundingAdjustment = Math.ceil(beforeRounding / step) * step - beforeRounding;
  } else if (step > 0 && mode === "Down") {
    roundingAdjustment = Math.floor(beforeRounding / step) * step - beforeRounding;
  }
  if (beforeRounding + roundingAdjustment < 0) {
    roundingAdjustment = -beforeRounding;
  }
  const grandTotal = beforeRounding + roundingAdjustment;
  return {
    subtotal,
    discountAmount,
    taxableBase,
    taxAdditions,
    taxWithholdings,
    beforeRounding,
    roundingAdjustment,
    grandTotal,
    netCashDue: Math.max(0, grandTotal - taxWithholdings),
  };
}

export interface InvoiceAllocationSource {
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  taxAdditions: number;
  taxWithholdings: number;
  roundingAdjustment: number;
  grandTotal: number;
}

export interface InvoiceAllocation {
  installmentBps: number;
  amount: number;
  subtotalSnapshot: number;
  discountSnapshot: number;
  taxableBaseSnapshot: number;
  taxAdditionsSnapshot: number;
  taxWithholdingsSnapshot: number;
  roundingSnapshot: number;
}

export function calculateInvoiceAllocation(
  source: InvoiceAllocationSource,
  installmentBps: number,
  previous: Partial<InvoiceAllocationSource> & { installmentBps?: number } = {},
): InvoiceAllocation {
  const bps = Math.max(1, Math.min(10_000, money(installmentBps)));
  const finalAllocation = bps === 10_000 - money(previous.installmentBps);
  const allocate = (total: number, used: number | undefined) =>
    finalAllocation
      ? Math.max(0, money(total) - money(used))
      : Math.round((money(total) * bps) / 10_000);
  const subtotalSnapshot = allocate(source.subtotal, previous.subtotal);
  const discountSnapshot = allocate(source.discountAmount, previous.discountAmount);
  const taxableBaseSnapshot = allocate(source.taxableBase, previous.taxableBase);
  const taxAdditionsSnapshot = allocate(source.taxAdditions, previous.taxAdditions);
  const taxWithholdingsSnapshot = allocate(source.taxWithholdings, previous.taxWithholdings);
  const amount = allocate(source.grandTotal, previous.grandTotal);
  const roundingSnapshot =
    amount - taxableBaseSnapshot - taxAdditionsSnapshot;
  return {
    installmentBps: bps,
    amount,
    subtotalSnapshot,
    discountSnapshot,
    taxableBaseSnapshot,
    taxAdditionsSnapshot,
    taxWithholdingsSnapshot,
    roundingSnapshot,
  };
}
