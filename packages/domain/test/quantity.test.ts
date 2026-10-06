import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { divideExact, formatQty, multiplyExact, parseQty, QTY_MAX } from "../src";

describe("parseQty / formatQty", () => {
  test("parses whole and fractional quantities exactly", () => {
    expect(parseQty("1")).toBe(10_000n);
    expect(parseQty("0.5")).toBe(5_000n);
    expect(parseQty("2.0125")).toBe(20_125n);
    expect(parseQty("-3.25")).toBe(-32_500n);
  });

  test("rejects more than 4 decimals, junk and overflow", () => {
    expect(() => parseQty("0.00001")).toThrow(RangeError);
    expect(() => parseQty("1,5")).toThrow(RangeError);
    expect(() => parseQty("")).toThrow(RangeError);
    expect(() => parseQty("100000000000000")).toThrow(RangeError);
  });

  test("formats without trailing zeros", () => {
    expect(formatQty(parseQty("2.5000"))).toBe("2.5");
    expect(formatQty(parseQty("10"))).toBe("10");
    expect(formatQty(parseQty("-0.0001"))).toBe("-0.0001");
  });

  test("round-trips any numeric(18,4) value", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -QTY_MAX, max: QTY_MAX }), (qty) => {
        expect(parseQty(formatQty(qty))).toBe(qty);
      }),
    );
  });
});

describe("exact arithmetic", () => {
  test("multiplies when the result fits 4 decimals, otherwise refuses", () => {
    expect(multiplyExact(parseQty("2"), parseQty("10"))).toBe(parseQty("20"));
    expect(multiplyExact(parseQty("0.5"), parseQty("0.5"))).toBe(parseQty("0.25"));
    expect(multiplyExact(parseQty("0.0001"), parseQty("0.5"))).toBeNull();
  });

  test("divides when the result fits 4 decimals, otherwise refuses", () => {
    expect(divideExact(parseQty("25"), parseQty("10"))).toBe(parseQty("2.5"));
    expect(divideExact(parseQty("1"), parseQty("3"))).toBeNull();
    expect(() => divideExact(parseQty("1"), 0n)).toThrow(RangeError);
  });
});
