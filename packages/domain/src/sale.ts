import { multiplyExact, QTY_SCALE, type Qty } from "./quantity";
import type { Role } from "./permissions";
import { err, ok, type Result } from "./result";

/**
 * Money at the counter (DOMAIN-MODEL.md §7). Amounts are whole rupiah as safe
 * integers; quantities are domain Qty. Tax is not applied yet: whether and how PPN
 * applies to which products is [VALIDATE] (PRD POS-6, D5), so totals are tax-free.
 */

export type Rupiah = number;

export const PAYMENT_METHODS = ["CASH", "QRIS", "TRANSFER", "CARD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function assertRupiah(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative whole rupiah amount`);
}

/**
 * Price of `qty` units at `unitPrice`, rounded half up to whole rupiah. Only fractional
 * quantities (half a tablet) can produce a fraction. The rounding rule is [VALIDATE].
 */
export function lineGross(unitPrice: Rupiah, qty: Qty): Rupiah {
  assertRupiah(unitPrice, "unitPrice");
  if (qty <= 0n) throw new RangeError("qty must be positive");
  const scaled = BigInt(unitPrice) * qty; // rupiah × 10^4
  const whole = scaled / QTY_SCALE;
  const remainder = scaled % QTY_SCALE;
  return Number(remainder * 2n >= QTY_SCALE ? whole + 1n : whole);
}

export interface SaleLine {
  unitPrice: Rupiah;
  qty: Qty;
  /** Line discount in rupiah. */
  discount: Rupiah;
}

export type SaleError =
  | { kind: "EMPTY_SALE" }
  | { kind: "DISCOUNT_EXCEEDS_LINE"; line: number }
  | { kind: "DISCOUNT_ABOVE_LIMIT"; percent: number; limit: number };

export interface SaleTotals {
  lines: { gross: Rupiah; discount: Rupiah; net: Rupiah }[];
  subtotal: Rupiah;
  discountTotal: Rupiah;
  total: Rupiah;
}

export function saleTotals(lines: readonly SaleLine[]): Result<SaleTotals, SaleError> {
  if (lines.length === 0) return err({ kind: "EMPTY_SALE" });
  const out: SaleTotals["lines"] = [];
  for (const [index, line] of lines.entries()) {
    assertRupiah(line.discount, "discount");
    const gross = lineGross(line.unitPrice, line.qty);
    if (line.discount > gross) return err({ kind: "DISCOUNT_EXCEEDS_LINE", line: index });
    out.push({ gross, discount: line.discount, net: gross - line.discount });
  }
  const subtotal = out.reduce((s, l) => s + l.gross, 0);
  const discountTotal = out.reduce((s, l) => s + l.discount, 0);
  return ok({ lines: out, subtotal, discountTotal, total: subtotal - discountTotal });
}

/**
 * Highest discount, as a percent of the sale, each role may give without a manager.
 * Defaults for the design-partner pilot, configurable per tenant later [VALIDATE].
 * Roles without sale.discount give none (the API checks that permission first).
 */
export const DEFAULT_DISCOUNT_LIMIT_PERCENT: Readonly<Partial<Record<Role, number>>> = {
  CASHIER: 10,
  BRANCH_MANAGER: 100,
  OWNER: 100,
};

export function checkDiscountLimit(totals: SaleTotals, role: Role): Result<true, SaleError> {
  if (totals.discountTotal === 0) return ok(true);
  const limit = DEFAULT_DISCOUNT_LIMIT_PERCENT[role] ?? 0;
  const percent = (totals.discountTotal * 100) / totals.subtotal;
  return percent > limit ? err({ kind: "DISCOUNT_ABOVE_LIMIT", percent: Math.round(percent * 100) / 100, limit }) : ok(true);
}

export interface PaymentInput {
  method: PaymentMethod;
  /** What the customer handed over (cash may exceed the total; other methods may not). */
  tendered: Rupiah;
  reference?: string;
}

export interface SettledPayment {
  method: PaymentMethod;
  tendered: Rupiah;
  /** The part that pays the sale (S1: these sum to the total). */
  amount: Rupiah;
  reference?: string;
}

export type PaymentError =
  | { kind: "NO_PAYMENT" }
  | { kind: "SHORT"; shortfall: Rupiah }
  | { kind: "NON_CASH_OVERPAID"; method: PaymentMethod; excess: Rupiah };

/**
 * Splits payments over the total (US-POS-5). Non-cash methods are applied first and
 * may not exceed what is owed; cash covers the rest and only cash gives change.
 */
export function settlePayments(total: Rupiah, payments: readonly PaymentInput[]): Result<{ payments: SettledPayment[]; changeDue: Rupiah }, PaymentError> {
  assertRupiah(total, "total");
  if (payments.length === 0) return total === 0 ? ok({ payments: [], changeDue: 0 }) : err({ kind: "NO_PAYMENT" });
  for (const p of payments) assertRupiah(p.tendered, "tendered");

  const nonCash = payments.filter((p) => p.method !== "CASH");
  const cash = payments.filter((p) => p.method === "CASH");
  const nonCashSum = nonCash.reduce((s, p) => s + p.tendered, 0);
  if (nonCashSum > total) {
    return err({ kind: "NON_CASH_OVERPAID", method: nonCash[nonCash.length - 1]!.method, excess: nonCashSum - total });
  }
  const cashSum = cash.reduce((s, p) => s + p.tendered, 0);
  const paid = nonCashSum + cashSum;
  if (paid < total) return err({ kind: "SHORT", shortfall: total - paid });

  let cashOwed = total - nonCashSum;
  const settled: SettledPayment[] = payments.map((p) => {
    if (p.method !== "CASH") return { ...p, amount: p.tendered };
    const amount = Math.min(p.tendered, cashOwed);
    cashOwed -= amount;
    return { ...p, amount };
  });
  return ok({ payments: settled, changeDue: paid - total });
}

/** Shift cash (DOMAIN-MODEL.md §7): expected = float + cash sales − cash refunds ± movements. */
export function expectedCash(input: {
  openingFloat: Rupiah;
  cashSales: Rupiah;
  cashRefunds: Rupiah;
  cashIn: Rupiah;
  cashOut: Rupiah;
}): Rupiah {
  return input.openingFloat + input.cashSales - input.cashRefunds + input.cashIn - input.cashOut;
}

export type CloseOutcome = { kind: "BALANCED" } | { kind: "SHORT"; amount: Rupiah } | { kind: "OVER"; amount: Rupiah };

/** Blind close (SHF-4): the verdict is computed after the count is in. */
export function closeOutcome(counted: Rupiah, expected: Rupiah): CloseOutcome {
  const variance = counted - expected;
  if (variance === 0) return { kind: "BALANCED" };
  return variance < 0 ? { kind: "SHORT", amount: -variance } : { kind: "OVER", amount: variance };
}

/** Units × multiplier, exact (re-exported for line maths in one place). */
export const qtyToBase = (qty: Qty, multiplierToBase: Qty): Qty | null => multiplyExact(qty, multiplierToBase);
