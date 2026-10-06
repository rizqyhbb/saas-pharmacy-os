import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { breakdown, fromBase, parseQty, QTY_SCALE, toBase, validateUnitSet, type ProductUnit } from "../src";

const tablet: ProductUnit = { id: "tablet", name: "tablet", multiplierToBase: parseQty("1") };
const strip: ProductUnit = { id: "strip", name: "strip", multiplierToBase: parseQty("10") };
const box: ProductUnit = { id: "box", name: "box", multiplierToBase: parseQty("100") };
const units = [tablet, strip, box];

describe("unit conversion (DOMAIN-MODEL.md §3 example)", () => {
  test("buy 5 box → +500 tablet; sell 2 strip → 20 tablet; dispense 6 tablet → 6", () => {
    expect(toBase(parseQty("5"), box)).toEqual({ ok: true, value: parseQty("500") });
    expect(toBase(parseQty("2"), strip)).toEqual({ ok: true, value: parseQty("20") });
    expect(toBase(parseQty("6"), tablet)).toEqual({ ok: true, value: parseQty("6") });
  });

  test("partial strip converts back exactly", () => {
    expect(fromBase(parseQty("25"), strip)).toEqual({ ok: true, value: parseQty("2.5") });
  });

  test("decimal base units (ml) work", () => {
    const ml: ProductUnit = { id: "ml", name: "ml", multiplierToBase: parseQty("1") };
    const bottle: ProductUnit = { id: "bottle", name: "botol 60 ml", multiplierToBase: parseQty("60") };
    expect(validateUnitSet([ml, bottle])).toEqual([]);
    expect(toBase(parseQty("0.25"), bottle)).toEqual({ ok: true, value: parseQty("15") });
    expect(fromBase(parseQty("2.5"), ml)).toEqual({ ok: true, value: parseQty("2.5") });
  });

  test("U2: a conversion that would need rounding is refused, not rounded", () => {
    const third: ProductUnit = { id: "pack3", name: "pack of 3", multiplierToBase: parseQty("3") };
    const result = fromBase(parseQty("1"), third);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("INEXACT_CONVERSION");
  });

  test("T5: toBase then fromBase returns the original quantity", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.integer({ min: 1, max: 1000 }),
        (unitQty, multiplier) => {
          const unit: ProductUnit = { id: "u", name: "u", multiplierToBase: BigInt(multiplier) * QTY_SCALE };
          const base = toBase(unitQty, unit);
          expect(base.ok).toBe(true);
          if (base.ok) expect(fromBase(base.value, unit)).toEqual({ ok: true, value: unitQty });
        },
      ),
    );
  });
});

describe("validateUnitSet (U1)", () => {
  test("accepts a well-formed set", () => {
    expect(validateUnitSet(units)).toEqual([]);
  });

  test("needs exactly one base unit", () => {
    expect(validateUnitSet([strip, box])).toEqual([{ kind: "NO_BASE_UNIT" }]);
    const kapsul = { ...tablet, id: "kapsul", name: "kapsul" };
    expect(validateUnitSet([tablet, kapsul])).toEqual([
      { kind: "MULTIPLE_BASE_UNITS", unitIds: ["tablet", "kapsul"] },
    ]);
  });

  test("rejects non-positive multipliers and duplicate names", () => {
    const errors = validateUnitSet([tablet, { id: "x", name: "Strip", multiplierToBase: 0n }, strip]);
    expect(errors).toContainEqual({ kind: "NON_POSITIVE_MULTIPLIER", unitId: "x" });
    expect(errors).toContainEqual({ kind: "DUPLICATE_UNIT_NAME", name: "strip" });
  });
});

describe("breakdown", () => {
  test("235 tablet → 2 box + 3 strip + 5 tablet", () => {
    expect(breakdown(parseQty("235"), units)).toEqual([
      { unitId: "box", qty: parseQty("2") },
      { unitId: "strip", qty: parseQty("3") },
      { unitId: "tablet", qty: parseQty("5") },
    ]);
  });

  test("a fractional remainder stays in the base unit", () => {
    expect(breakdown(parseQty("10.5"), units)).toEqual([
      { unitId: "strip", qty: parseQty("1") },
      { unitId: "tablet", qty: parseQty("0.5") },
    ]);
  });

  test("lines always sum back to the base quantity", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 10n }), (base) => {
        const lines = breakdown(base, units);
        const total = lines.reduce((sum, line) => {
          const converted = toBase(line.qty, units.find((u) => u.id === line.unitId)!);
          return sum + (converted.ok ? converted.value : 0n);
        }, 0n);
        expect(total).toBe(base);
      }),
    );
  });
});
