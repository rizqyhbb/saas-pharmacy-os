import { afterAll, describe, expect, test } from "bun:test";
import {
  classifyDbError,
  closeShift,
  getReceipt,
  recordSale,
  refundSale,
  shiftTotals,
  voidSale,
  type SaleInput,
} from "../src";
import { asTenant, connect, createProduct, createTenant, ledger, openBatch, openCounter, rejection, type TestTenant } from "./support";

/** The counter's transaction engine against the real schema (POS-8, S1-S5, SYN-4, SHF-4). */
const sql = await connect();
afterAll(() => sql?.end());

const rule = (error: Error) => {
  const f = classifyDbError(error);
  return f?.kind === "RULE" ? f.rule : f?.kind;
};

describe.skipIf(!sql)("sales and shifts", () => {
  const db = sql!;

  /** Paracetamol with an expired batch (30), a near one (14) and a far one (200). */
  async function setup() {
    const t = await createTenant(db);
    const product = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      const expired = await openBatch(tx, t, p.productId, { batchNumber: "OLD", expiryDate: "2001-01-01", qty: 30 });
      const near = await openBatch(tx, t, p.productId, { batchNumber: "NEAR", expiryDate: "2098-01-01", qty: 14 });
      const far = await openBatch(tx, t, p.productId, { batchNumber: "FAR", expiryDate: "2099-01-01", qty: 200 });
      return { ...p, expired, near, far };
    });
    const counter = await openCounter(db, t);
    return { t, product, counter };
  }

  const sale = (t: TestTenant, counter: { workstationId: string; shiftId: string }, over: Partial<SaleInput> & Pick<SaleInput, "lines">): SaleInput => ({
    saleId: crypto.randomUUID(),
    tenantId: t.tenantId,
    branchId: t.branchId,
    locationId: t.locationId,
    workstationId: counter.workstationId,
    shiftId: counter.shiftId,
    cashierStaffId: t.staffId,
    cashierRole: "OWNER",
    receiptNo: `K1-${crypto.randomUUID().slice(0, 8)}`,
    occurredAt: new Date(),
    offline: false,
    payments: [{ method: "CASH", tendered: 10000 }],
    ...over,
  });

  const balances = (t: TestTenant) =>
    asTenant(db, t, (tx) => tx<{ batch_number: string; on_hand: string }[]>`
      select b.batch_number, bal.on_hand::text from app.inventory_balances bal join app.batches b on b.id = bal.batch_id order by b.expiry_date`);

  test("2 strips: FEFO skips the expired batch, change is given, the receipt shows the batches", async () => {
    const { t, product, counter } = await setup();
    const input = sale(t, counter, { lines: [{ productId: product.productId, unitId: product.stripUnitId, qty: "2", unitPrice: 4500 }] });
    const result = await asTenant(db, t, (tx) => recordSale(tx, input));
    expect(result).toMatchObject({ replayed: false, total: 9000, changeDue: 1000, hasConflict: false });
    expect((await balances(t)).map((b) => [b.batch_number, b.on_hand])).toEqual([
      ["OLD", "30.0000"],
      ["NEAR", "0.0000"],
      ["FAR", "194.0000"],
    ]);
    const receipt = await asTenant(db, t, (tx) => getReceipt(tx, input.saleId));
    expect(receipt?.lines[0]).toMatchObject({
      unit: "strip",
      qty: "2",
      total: 9000,
      batches: [
        { batchNumber: "NEAR", qty: "14" },
        { batchNumber: "FAR", qty: "6" },
      ],
    });
    expect(receipt?.payments).toEqual([{ method: "CASH", tendered: 10000, amount: 9000, reference: null }]);

    const replay = await asTenant(db, t, (tx) => recordSale(tx, input));
    expect(replay).toMatchObject({ replayed: true, total: 9000 });
    expect((await balances(t))[2]!.on_hand).toBe("194.0000");
  });

  test("two lines of the same product draw from the batches in turn", async () => {
    const { t, product, counter } = await setup();
    const line = { productId: product.productId, unitId: product.stripUnitId, qty: "1", unitPrice: 4500 };
    await asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [line, line] })));
    expect((await balances(t)).map((b) => b.on_hand)).toEqual(["30.0000", "0.0000", "194.0000"]);
  });

  test("online: not enough stock is refused; nothing is written", async () => {
    const { t, product, counter } = await setup();
    const error = await rejection(
      asTenant(db, t, (tx) =>
        recordSale(tx, sale(t, counter, { lines: [{ productId: product.productId, unitId: product.baseUnitId, qty: "215", unitPrice: 500 }], payments: [{ method: "CASH", tendered: 200000 }] })),
      ),
    );
    expect(rule(error)).toBe("INSUFFICIENT_STOCK");
    expect((await balances(t)).map((b) => b.on_hand)).toEqual(["30.0000", "14.0000", "200.0000"]);
  });

  test("offline (SYN-4): the sale is kept, the shortfall is a flagged conflict", async () => {
    const { t, product, counter } = await setup();
    const result = await asTenant(db, t, (tx) =>
      recordSale(tx, sale(t, counter, { offline: true, lines: [{ productId: product.productId, unitId: product.baseUnitId, qty: "220", unitPrice: 500 }], payments: [{ method: "CASH", tendered: 110000 }] })),
    );
    expect(result).toMatchObject({ hasConflict: true, total: 110000 });
    expect((await balances(t)).map((b) => b.on_hand)).toEqual(["30.0000", "0.0000", "-6.0000"]);
    const [flagged] = await asTenant(db, t, (tx) => tx`select count(*)::int as n from app.inventory_ledger where conflict_negative`);
    expect(flagged!.n).toBe(1);
  });

  test("S5: a prescription-only product never goes through the counter, even by direct insert", async () => {
    const { t, product, counter } = await setup();
    await asTenant(db, t, (tx) => tx`update app.products set sales_class = 'RX_REQUIRED' where id = ${product.productId}`);
    const viaEngine = await rejection(
      asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [{ productId: product.productId, unitId: product.stripUnitId, qty: "1", unitPrice: 4500 }] }))),
    );
    expect(rule(viaEngine)).toBe("RX_REQUIRED");
    const direct = await rejection(asTenant(db, t, (tx) => ledger(tx, t, { productId: product.productId, batchId: product.far, eventType: "SALE", qty: -1 })));
    expect(rule(direct)).toBe("RX_REQUIRED");
  });

  test("S2: no sale without an open shift on that workstation", async () => {
    const { t, product, counter } = await setup();
    const other = await openCounter(db, t);
    const line = { productId: product.productId, unitId: product.stripUnitId, qty: "1", unitPrice: 4500 };
    const wrongWorkstation = await rejection(asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { workstationId: other.workstationId, lines: [line] }))));
    expect(rule(wrongWorkstation)).toBe("SHIFT_NOT_OPEN");
    await asTenant(db, t, (tx) => closeShift(tx, counter.shiftId, 200000));
    const closed = await rejection(asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [line] }))));
    expect(rule(closed)).toBe("SHIFT_NOT_OPEN");
  });

  test("S1: payments must cover the total; online prices must match", async () => {
    const { t, product, counter } = await setup();
    const line = { productId: product.productId, unitId: product.stripUnitId, qty: "2", unitPrice: 4500 };
    expect(rule(await rejection(asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [line], payments: [{ method: "CASH", tendered: 5000 }] })))))).toBe("PAYMENT_SHORT");
    expect(rule(await rejection(asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [{ ...line, unitPrice: 4000 }] })))))).toBe("PRICE_CHANGED");
    // The database's own check: a sale inserted without payments fails at commit.
    const bare = await rejection(
      asTenant(db, t, (tx) => tx`
        insert into app.sales (id, tenant_id, branch_id, location_id, workstation_id, shift_id, cashier_staff_id, receipt_no,
          subtotal, discount_total, total, occurred_at, idempotency_key)
        values (${crypto.randomUUID()}, ${t.tenantId}, ${t.branchId}, ${t.locationId}, ${counter.workstationId}, ${counter.shiftId},
          ${t.staffId}, 'BARE-1', 1000, 0, 1000, now(), ${crypto.randomUUID()})`),
    );
    expect(rule(bare)).toBe("PAYMENTS_DO_NOT_MATCH_TOTAL");
  });

  test("void returns the stock with new rows; refunds keep the stock and can't exceed the sale", async () => {
    const { t, product, counter } = await setup();
    const line = { productId: product.productId, unitId: product.stripUnitId, qty: "2", unitPrice: 4500 };
    const voided = sale(t, counter, { lines: [line] });
    await asTenant(db, t, (tx) => recordSale(tx, voided));
    await asTenant(db, t, (tx) => voidSale(tx, voided.saleId, t.staffId, "Salah input"));
    expect((await balances(t)).map((b) => b.on_hand)).toEqual(["30.0000", "14.0000", "200.0000"]);
    expect(rule(await rejection(asTenant(db, t, (tx) => voidSale(tx, voided.saleId, t.staffId, "lagi"))))).toBe("ALREADY_VOIDED");

    const kept = sale(t, counter, { lines: [line] });
    await asTenant(db, t, (tx) => recordSale(tx, kept));
    await asTenant(db, t, (tx) => refundSale(tx, { tenantId: t.tenantId, saleId: kept.saleId, shiftId: counter.shiftId, method: "CASH", amount: 4500, reason: "Pelanggan batal 1 strip", staffId: t.staffId }));
    expect((await balances(t)).map((b) => b.on_hand)).toEqual(["30.0000", "0.0000", "194.0000"]);
    const over = await rejection(asTenant(db, t, (tx) => refundSale(tx, { tenantId: t.tenantId, saleId: kept.saleId, shiftId: counter.shiftId, method: "CASH", amount: 5000, reason: "lebih", staffId: t.staffId })));
    expect(rule(over)).toBe("REFUND_EXCEEDS_SALE");
    expect(rule(await rejection(asTenant(db, t, (tx) => voidSale(tx, kept.saleId, t.staffId, "x"))))).toBe("SALE_REFUNDED");
  });

  test("blind close: expected = float + cash sales - cash refunds + in - out; variance revealed after", async () => {
    const { t, product, counter } = await setup();
    const line = { productId: product.productId, unitId: product.stripUnitId, qty: "1", unitPrice: 4500 };
    await asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [line], payments: [{ method: "CASH", tendered: 5000 }] })));
    await asTenant(db, t, (tx) => recordSale(tx, sale(t, counter, { lines: [line], payments: [{ method: "QRIS", tendered: 4500, reference: "Q-1" }] })));
    const refunded = sale(t, counter, { lines: [line] });
    await asTenant(db, t, (tx) => recordSale(tx, refunded));
    await asTenant(db, t, (tx) => refundSale(tx, { tenantId: t.tenantId, saleId: refunded.saleId, shiftId: counter.shiftId, method: "CASH", amount: 4500, reason: "Batal", staffId: t.staffId }));
    await asTenant(db, t, (tx) => tx`insert into app.cash_movements (id, tenant_id, shift_id, type, amount, reason, actor_staff_id)
      values (${crypto.randomUUID()}, ${t.tenantId}, ${counter.shiftId}, 'OUT', 20000, 'Beli galon', ${t.staffId})`);

    const totals = await asTenant(db, t, (tx) => shiftTotals(tx, counter.shiftId));
    expect(totals).toMatchObject({ salesCount: 3, byMethod: { CASH: 9000, QRIS: 4500 }, cashRefunds: 4500, cashOut: 20000 });
    // 200000 + 9000 - 4500 + 0 - 20000 = 184500
    const closed = await asTenant(db, t, (tx) => closeShift(tx, counter.shiftId, 184000));
    expect(closed?.outcome).toEqual({ kind: "SHORT", amount: 500 });
    expect(closed?.shift).toMatchObject({ status: "CLOSED", expectedCash: 184500, countedCash: 184000, variance: -500 });

    const history = await asTenant(db, t, (tx) => tx`select from_status::text, to_status::text from app.shift_status_history where shift_id = ${counter.shiftId} order by seq`);
    expect(history.map((h) => `${h.from_status}->${h.to_status}`)).toEqual(["null->OPEN", "OPEN->CLOSING", "CLOSING->CLOSED"]);
    const reopen = await rejection(asTenant(db, t, (tx) => tx`update app.shifts set status = 'OPEN' where id = ${counter.shiftId}`));
    expect(rule(reopen)).toBe("ILLEGAL_TRANSITION");
  });

  test("two counters racing for the last units: the lock lets exactly one through", async () => {
    const t = await createTenant(db);
    const product = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      await openBatch(tx, t, p.productId, { batchNumber: "LAST", expiryDate: "2099-01-01", qty: 5 });
      return p;
    });
    const [a, b] = [await openCounter(db, t), await openCounter(db, t)];
    const line = { productId: product.productId, unitId: product.baseUnitId, qty: "4", unitPrice: 500 };
    const results = await Promise.allSettled([
      asTenant(db, t, (tx) => recordSale(tx, sale(t, a, { lines: [line], payments: [{ method: "CASH", tendered: 2000 }] }))),
      asTenant(db, t, (tx) => recordSale(tx, sale(t, b, { lines: [line], payments: [{ method: "CASH", tendered: 2000 }] }))),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rule(failed.reason)).toBe("INSUFFICIENT_STOCK");
    expect((await balances(t)).map((x) => x.on_hand)).toEqual(["1.0000"]);
  });

  test("one open shift per workstation", async () => {
    const { t, counter } = await setup();
    const error = await rejection(
      asTenant(db, t, (tx) => tx`insert into app.shifts (id, tenant_id, branch_id, workstation_id, cashier_staff_id, opening_float)
        values (${crypto.randomUUID()}, ${t.tenantId}, ${t.branchId}, ${counter.workstationId}, ${t.staffId}, 0)`),
    );
    expect(error.message).toMatch(/shifts_one_open_per_workstation/);
  });
});
