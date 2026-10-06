import { divideExact, multiplyExact, QTY_SCALE, type Qty } from "./quantity";
import { err, ok, type Result } from "./result";

/**
 * A sellable/purchasable packaging of a product, expressed against its base
 * unit. Base `tablet`, `strip` = 10, `box` = 100 (DOMAIN-MODEL.md §3).
 */
export interface ProductUnit {
  id: string;
  name: string;
  multiplierToBase: Qty;
}

export type UnitSetError =
  | { kind: "NO_BASE_UNIT" }
  | { kind: "MULTIPLE_BASE_UNITS"; unitIds: string[] }
  | { kind: "NON_POSITIVE_MULTIPLIER"; unitId: string }
  | { kind: "DUPLICATE_UNIT_NAME"; name: string };

export type ConversionError = {
  kind: "INEXACT_CONVERSION";
  qty: Qty;
  unitId: string;
  direction: "TO_BASE" | "FROM_BASE";
};

/** Invariant U1: exactly one unit has multiplier 1; all multipliers positive; names unique. */
export function validateUnitSet(units: readonly ProductUnit[]): UnitSetError[] {
  const errors: UnitSetError[] = [];
  const baseUnits = units.filter((unit) => unit.multiplierToBase === QTY_SCALE);
  if (baseUnits.length === 0) errors.push({ kind: "NO_BASE_UNIT" });
  if (baseUnits.length > 1) {
    errors.push({ kind: "MULTIPLE_BASE_UNITS", unitIds: baseUnits.map((unit) => unit.id) });
  }
  const seen = new Set<string>();
  for (const unit of units) {
    if (unit.multiplierToBase <= 0n) {
      errors.push({ kind: "NON_POSITIVE_MULTIPLIER", unitId: unit.id });
    }
    const name = unit.name.trim().toLowerCase();
    if (seen.has(name)) errors.push({ kind: "DUPLICATE_UNIT_NAME", name: unit.name });
    seen.add(name);
  }
  return errors;
}

/** Invariant U2: `base = unitQty × multiplier`, exactly — never rounded. */
export function toBase(unitQty: Qty, unit: ProductUnit): Result<Qty, ConversionError> {
  const base = multiplyExact(unitQty, unit.multiplierToBase);
  return base === null
    ? err({ kind: "INEXACT_CONVERSION", qty: unitQty, unitId: unit.id, direction: "TO_BASE" })
    : ok(base);
}

export function fromBase(baseQty: Qty, unit: ProductUnit): Result<Qty, ConversionError> {
  const unitQty = divideExact(baseQty, unit.multiplierToBase);
  return unitQty === null
    ? err({ kind: "INEXACT_CONVERSION", qty: baseQty, unitId: unit.id, direction: "FROM_BASE" })
    : ok(unitQty);
}

export interface UnitBreakdownLine {
  unitId: string;
  qty: Qty;
}

/**
 * Splits a non-negative base quantity into whole packs, largest first, with the
 * remainder in the base unit: 235 tablet → 2 box + 3 strip + 5 tablet. Used for
 * display and stock counts; the stored quantity is always the base quantity.
 */
export function breakdown(baseQty: Qty, units: readonly ProductUnit[]): UnitBreakdownLine[] {
  if (baseQty < 0n) throw new RangeError("breakdown() expects a non-negative base quantity");
  const errors = validateUnitSet(units);
  if (errors.length > 0) throw new RangeError(`Invalid unit set: ${errors[0]?.kind}`);

  const sorted = [...units].sort((a, b) =>
    a.multiplierToBase === b.multiplierToBase ? 0 : a.multiplierToBase > b.multiplierToBase ? -1 : 1,
  );
  const lines: UnitBreakdownLine[] = [];
  let remaining = baseQty;
  for (const unit of sorted) {
    if (unit.multiplierToBase === QTY_SCALE) {
      if (remaining > 0n) lines.push({ unitId: unit.id, qty: remaining });
      remaining = 0n;
      break;
    }
    const wholePacks = remaining / unit.multiplierToBase;
    if (wholePacks > 0n) {
      lines.push({ unitId: unit.id, qty: wholePacks * QTY_SCALE });
      remaining -= wholePacks * unit.multiplierToBase;
    }
  }
  return lines;
}
