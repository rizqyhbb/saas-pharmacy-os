import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  checkDiscountLimit,
  closeOutcome,
  expectedCash,
  lineGross,
  parseQty,
  PAYMENT_METHODS,
  saleTotals,
  settlePayments,
  type PaymentInput,
} from "../src";

describe("sale money", () => {
  test("line gross: whole units exact, fractions round half up", () => {
    expect(lineGross(4500, parseQty("2"))).toBe(9000);
    expect(lineGross(500, parseQty("0.5"))).toBe(250);
    expect(lineGross(333, parseQty("0.5"))).toBe(167); // 166.5 rounds up
    expect(lineGross(333, parseQty("0.25"))).toBe(83); // 83.25 rounds down
  });

  test("totals: subtotal minus line discounts; a discount can't exceed its line", () => {
    const totals = saleTotals([
      { unitPrice: 4500, qty: parseQty("2"), discount: 500 },
      { unitPrice: 6500, qty: parseQty("1"), discount: 0 },
    ]);
    expect(totals).toEqual({
      ok: true,
      value: {
        lines: [
          { gross: 9000, discount: 500, net: 8500 },
          { gross: 6500, discount: 0, net: 6500 },
        ],
        subtotal: 15500,
        discountTotal: 500,
        total: 15000,
      },
    });
    expect(saleTotals([{ unitPrice: 100, qty: parseQty("1"), discount: 101 }])).toEqual({
      ok: false,
      error: { kind: "DISCOUNT_EXCEEDS_LINE", line: 0 },
    });
    expect(saleTotals([])).toEqual({ ok: false, error: { kind: "EMPTY_SALE" } });
  });

  test("discount limits per role (US-POS-4)", () => {
    const totals = (discount: number) => {
      const r = saleTotals([{ unitPrice: 10000, qty: parseQty("1"), discount }]);
      if (!r.ok) throw new Error("bad");
      return r.value;
    };
    expect(checkDiscountLimit(totals(1000), "CASHIER").ok).toBe(true);
    expect(checkDiscountLimit(totals(1500), "CASHIER")).toEqual({ ok: false, error: { kind: "DISCOUNT_ABOVE_LIMIT", percent: 15, limit: 10 } });
    expect(checkDiscountLimit(totals(1500), "BRANCH_MANAGER").ok).toBe(true);
    expect(checkDiscountLimit(totals(100), "PHARMACIST").ok).toBe(false);
  });

  test("US-POS-5: cash gives change; split payments must cover the total", () => {
    expect(settlePayments(87500, [{ method: "CASH", tendered: 100000 }])).toEqual({
      ok: true,
      value: { payments: [{ method: "CASH", tendered: 100000, amount: 87500 }], changeDue: 12500 },
    });
    const split = settlePayments(87500, [
      { method: "QRIS", tendered: 50000, reference: "Q1" },
      { method: "CASH", tendered: 40000 },
    ]);
    expect(split).toEqual({
      ok: true,
      value: {
        payments: [
          { method: "QRIS", tendered: 50000, amount: 50000, reference: "Q1" },
          { method: "CASH", tendered: 40000, amount: 37500 },
        ],
        changeDue: 2500,
      },
    });
    expect(settlePayments(87500, [{ method: "CASH", tendered: 80000 }])).toEqual({ ok: false, error: { kind: "SHORT", shortfall: 7500 } });
    expect(settlePayments(87500, [{ method: "CARD", tendered: 90000 }])).toEqual({
      ok: false,
      error: { kind: "NON_CASH_OVERPAID", method: "CARD", excess: 2500 },
    });
  });

  test("property: settled amounts always sum to the total (S1), change only from cash", () => {
    const payment = fc.record({ method: fc.constantFrom(...PAYMENT_METHODS), tendered: fc.integer({ min: 0, max: 500_000 }) });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), fc.array(payment, { maxLength: 4 }), (total, payments: PaymentInput[]) => {
        const r = settlePayments(total, payments);
        if (!r.ok) return;
        expect(r.value.payments.reduce((s, p) => s + p.amount, 0)).toBe(total);
        const cashTendered = payments.filter((p) => p.method === "CASH").reduce((s, p) => s + p.tendered, 0);
        expect(r.value.changeDue).toBeLessThanOrEqual(cashTendered);
        for (const p of r.value.payments) expect(p.amount).toBeLessThanOrEqual(p.tendered);
      }),
    );
  });

  test("shift: expected cash and a blind-close verdict (SHF-4)", () => {
    const expected = expectedCash({ openingFloat: 200000, cashSales: 87500, cashRefunds: 10000, cashIn: 50000, cashOut: 20000 });
    expect(expected).toBe(307500);
    expect(closeOutcome(307500, expected)).toEqual({ kind: "BALANCED" });
    expect(closeOutcome(300000, expected)).toEqual({ kind: "SHORT", amount: 7500 });
    expect(closeOutcome(310000, expected)).toEqual({ kind: "OVER", amount: 2500 });
  });
});
