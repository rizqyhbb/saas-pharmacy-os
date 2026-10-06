/**
 * Quantities are fixed-point decimals with 4 fractional digits, matching the
 * `numeric(18,4)` columns the ledger will use (ARCHITECTURE.md §16 A2). They are
 * held as a bigint count of ten-thousandths so arithmetic is exact: 0.5 tablet,
 * 2.5 ml and 0.0125 g never drift the way floats do.
 */
export type Qty = bigint;

export const QTY_DECIMALS = 4;
export const QTY_SCALE = 10_000n;
/** Largest magnitude a numeric(18,4) column holds. */
export const QTY_MAX: Qty = 10n ** 18n - 1n;

const QTY_PATTERN = /^(-)?(\d+)(?:\.(\d{1,4}))?$/;

export function parseQty(input: string): Qty {
  const match = QTY_PATTERN.exec(input.trim());
  if (!match) {
    throw new RangeError(
      `Invalid quantity "${input}": expected a decimal with at most ${QTY_DECIMALS} fractional digits`,
    );
  }
  const [, sign, whole = "0", frac = ""] = match;
  const scaled = BigInt(whole) * QTY_SCALE + BigInt(frac.padEnd(QTY_DECIMALS, "0"));
  if (scaled > QTY_MAX) throw new RangeError(`Quantity "${input}" exceeds numeric(18,4)`);
  return sign ? -scaled : scaled;
}

export function formatQty(qty: Qty): string {
  const negative = qty < 0n;
  const abs = negative ? -qty : qty;
  const whole = abs / QTY_SCALE;
  const frac = abs % QTY_SCALE;
  const fracText =
    frac === 0n ? "" : `.${frac.toString().padStart(QTY_DECIMALS, "0").replace(/0+$/, "")}`;
  return `${negative ? "-" : ""}${whole}${fracText}`;
}

/** `a × b`, or null when the exact product needs more than 4 decimals. */
export function multiplyExact(a: Qty, b: Qty): Qty | null {
  const product = a * b;
  return product % QTY_SCALE === 0n ? product / QTY_SCALE : null;
}

/** `a ÷ b`, or null when the exact quotient needs more than 4 decimals. */
export function divideExact(a: Qty, b: Qty): Qty | null {
  if (b === 0n) throw new RangeError("Division by zero quantity");
  const numerator = a * QTY_SCALE;
  return numerator % b === 0n ? numerator / b : null;
}

export const sumQty = (values: Iterable<Qty>): Qty => {
  let total = 0n;
  for (const value of values) total += value;
  return total;
};
