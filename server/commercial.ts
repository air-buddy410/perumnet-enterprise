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
    roundingAdjustment = money(input.customRoundingAdjustment);
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
