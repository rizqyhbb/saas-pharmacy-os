import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { can, ROLES } from "@apotek/domain";
import { connect } from "@apotek/db/testing";
import { call, paracetamol, tenantWithEveryRole, testApp, token, type RoleTenant } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("counter API (POS, SHF)", () => {
  const db = sql!;
  const app = testApp(db);
  let t: RoleTenant;
  let product: { id: string; units: { id: string; name: string }[] };
  const path = (p: string) => `/tenants/${t.tenantId}${p}`;
  const as = (role: keyof RoleTenant["staff"]) => t.staff[role].userId;
  const unit = (name: string) => product.units.find((u) => u.name === name)!.id;
  const auditLog = async () => (await call(app, "GET", path("/audit-events?limit=500"), { userId: as("OWNER") })).body.events as Record<string, unknown>[];

  async function post(route: string, userId: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await app.handle(
      new Request(`http://localhost${path(route)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token(userId)}`, "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as any };
  }

  async function workstation(name = `Kasir ${crypto.randomUUID().slice(0, 4)}`) {
    return (await call(app, "POST", path(`/branches/${t.branchId}/workstations`), { userId: as("OWNER"), body: { name } })).body.workstationId as string;
  }

  async function openShift(role: keyof RoleTenant["staff"] = "CASHIER", openingFloat = 200000) {
    const workstationId = await workstation();
    const shiftId = crypto.randomUUID();
    const res = await post("/shifts", as(role), { shiftId, workstationId, openingFloat });
    return { workstationId, shiftId, res };
  }

  function sale(counter: { workstationId: string; shiftId: string }, over: Record<string, unknown> = {}) {
    const saleId = crypto.randomUUID();
    return {
      saleId,
      receiptNo: `K-${saleId.slice(0, 8)}`,
      workstationId: counter.workstationId,
      shiftId: counter.shiftId,
      locationId: t.locationId,
      lines: [{ productId: product.id, unitId: unit("strip"), qty: "2", unitPrice: 4500 }],
      payments: [{ method: "CASH", tendered: 10000 }],
      ...over,
    };
  }
  const sell = (userId: string, body: { saleId: string } & Record<string, unknown>) => post("/sales", userId, body, { "idempotency-key": body.saleId });

  beforeAll(async () => {
    t = await tenantWithEveryRole(app, db, "Apotek Kasir");
    product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
    await post(
      "/stock/opening-balances",
      as("OWNER"),
      {
        locationId: t.locationId,
        productId: product.id,
        lines: [
          { unitId: unit("tablet"), qty: "30", batchNumber: "OLD", expiryDate: "2001-01-01" },
          { unitId: unit("tablet"), qty: "14", batchNumber: "NEAR", expiryDate: "2098-01-01" },
          { unitId: unit("box"), qty: "20", batchNumber: "FAR", expiryDate: "2099-01-01" },
        ],
      },
      { "idempotency-key": crypto.randomUUID() },
    );
    await call(app, "PUT", path("/facility"), { userId: as("OWNER"), body: { legalName: "PT Apotek Kasir", address: "Jl. Uji 1" } });
  });

  test("US-SHF-1: a cashier opens a shift once per workstation; retries are safe", async () => {
    const counter = await openShift();
    expect(counter.res).toMatchObject({ status: 201, body: { status: "OPEN", openingFloat: 200000, cashierStaffId: t.staff.CASHIER.staffId } });
    expect((await post("/shifts", as("CASHIER"), { shiftId: counter.shiftId, workstationId: counter.workstationId, openingFloat: 200000 })).status).toBe(200);
    const second = await post("/shifts", as("CASHIER"), { shiftId: crypto.randomUUID(), workstationId: counter.workstationId, openingFloat: 0 });
    expect(second).toEqual({ status: 422, body: { error: "SHIFT_ALREADY_OPEN" } });
    const current = await call(app, "GET", path(`/workstations/${counter.workstationId}/shift`), { userId: as("CASHIER") });
    expect(current.body.shift.shiftId).toBe(counter.shiftId);
  });

  test("US-POS-1/6/7: a cash sale commits once, gives change, and its receipt names the batches", async () => {
    const counter = await openShift();
    const body = sale(counter);
    expect((await post("/sales", as("CASHIER"), body, { "idempotency-key": crypto.randomUUID() })).body).toEqual({ error: "IDEMPOTENCY_KEY_MUST_EQUAL_SALE_ID" });
    const res = await sell(as("CASHIER"), body);
    expect(res).toMatchObject({ status: 201, body: { total: 9000, changeDue: 1000, hasConflict: false, replayed: false } });
    expect((await sell(as("CASHIER"), body)).status).toBe(200);

    const receipt = (await call(app, "GET", path(`/sales/${body.saleId}/receipt`), { userId: as("CASHIER") })).body;
    expect(receipt).toMatchObject({
      receiptNo: body.receiptNo,
      cashier: "cashier",
      facility: { name: "PT Apotek Kasir", address: "Jl. Uji 1" },
      total: 9000,
      changeDue: 1000,
      lines: [{ product: "Paracetamol", unit: "strip", qty: "2", batches: [{ batchNumber: "NEAR", qty: "14" }, { batchNumber: "FAR", qty: "6" }] }],
    });
  });

  test("US-POS-3: prescription-only and unclassified products are refused at the counter", async () => {
    const counter = await openShift();
    const rx = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: { ...paracetamol(), brandName: "Amoxicillin", salesClass: "RX_REQUIRED" } })).body;
    const rxLine = { productId: rx.id, unitId: rx.units[1].id, qty: "1", unitPrice: 4500 };
    expect((await sell(as("CASHIER"), sale(counter, { lines: [rxLine] }))).body).toEqual({ error: "RX_REQUIRED" });

    const { salesClass: _s, controlledClass: _c, ...unclassifiedInput } = paracetamol();
    const unclassified = (await call(app, "POST", path("/products"), { userId: as("PURCHASING"), body: unclassifiedInput })).body;
    const line = { productId: unclassified.id, unitId: unclassified.units[1].id, qty: "1", unitPrice: 4500 };
    expect((await sell(as("CASHIER"), sale(counter, { lines: [line] }))).body).toEqual({ error: "PRODUCT_NOT_SELLABLE" });
  });

  test("US-POS-4: discounts need permission and stay within the role's limit", async () => {
    const counter = await openShift();
    const discounted = (discount: number) => sale(counter, { lines: [{ productId: product.id, unitId: unit("strip"), qty: "2", unitPrice: 4500, discount }] });
    expect((await sell(as("CASHIER"), discounted(900))).status).toBe(201); // 10%
    expect((await sell(as("CASHIER"), discounted(1000))).body).toEqual({ error: "DISCOUNT_ABOVE_LIMIT" });
    expect((await sell(as("PHARMACIST"), discounted(100))).body).toEqual({ error: "FORBIDDEN", permission: "sale.discount" });
    expect((await auditLog()).some((e) => e.action === "sale.discount")).toBe(true);
  });

  test("US-POS-5: split payment completes; a short payment is refused with nothing written", async () => {
    const counter = await openShift();
    const split = await sell(as("CASHIER"), sale(counter, { payments: [{ method: "QRIS", tendered: 5000, reference: "QR-77" }, { method: "CASH", tendered: 5000 }] }));
    expect(split).toMatchObject({ status: 201, body: { total: 9000, changeDue: 1000 } });
    expect((await sell(as("CASHIER"), sale(counter, { payments: [{ method: "CASH", tendered: 8000 }] }))).body).toEqual({ error: "PAYMENT_SHORT" });
  });

  test("US-SYN-3: an offline sale that finds the stock gone is kept and flagged", async () => {
    const counter = await openShift();
    const huge = sale(counter, {
      offline: true,
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      lines: [{ productId: product.id, unitId: unit("box"), qty: "30", unitPrice: 42000 }],
      payments: [{ method: "CASH", tendered: 1260000 }],
    });
    const res = await sell(as("CASHIER"), huge);
    expect(res).toMatchObject({ status: 201, body: { hasConflict: true } });
    expect(await auditLog()).toContainEqual(expect.objectContaining({ action: "sale.offline_conflict", entityId: huge.saleId }));
    expect((await sell(as("CASHIER"), { ...sale(counter), offline: true })).body).toEqual({ error: "OCCURRED_AT_REQUIRED" });
    // Put the stock back for the other tests: the manager voids it.
    expect((await post(`/sales/${huge.saleId}/void`, as("BRANCH_MANAGER"), { reason: "Data uji" })).status).toBe(200);
  });

  test("US-POS-8: void by a manager returns stock; refund keeps it; both audited", async () => {
    const counter = await openShift();
    const mistake = sale(counter);
    await sell(as("CASHIER"), mistake);
    expect((await post(`/sales/${mistake.saleId}/void`, as("CASHIER"), { reason: "Salah" })).status).toBe(403);
    expect((await post(`/sales/${mistake.saleId}/void`, as("BRANCH_MANAGER"), { reason: "Salah input" })).status).toBe(200);
    expect((await call(app, "GET", path(`/sales/${mistake.saleId}/receipt`), { userId: as("CASHIER") })).body.status).toBe("VOIDED");

    const kept = sale(counter);
    await sell(as("CASHIER"), kept);
    const refund = await post(`/sales/${kept.saleId}/refunds`, as("BRANCH_MANAGER"), { shiftId: counter.shiftId, method: "CASH", amount: 4500, reason: "Kembali 1 strip" });
    expect(refund.status).toBe(201);
    const tooMuch = await post(`/sales/${kept.saleId}/refunds`, as("BRANCH_MANAGER"), { shiftId: counter.shiftId, method: "CASH", amount: 5000, reason: "Lebih" });
    expect(tooMuch.body).toEqual({ error: "REFUND_EXCEEDS_SALE" });
    const actions = (await auditLog()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["sale.void", "sale.refund"]));
  });

  test("US-SHF-2/3/4: cash movement, blind close with a verdict, supervisor review", async () => {
    const counter = await openShift("CASHIER", 100000);
    await sell(as("CASHIER"), sale(counter)); // +9000 cash
    const moved = await post(`/shifts/${counter.shiftId}/cash-movements`, as("CASHIER"), {
      movementId: crypto.randomUUID(),
      type: "OUT",
      amount: 15000,
      reason: "Beli air minum",
    });
    expect(moved.status).toBe(201);
    const ownReport = await call(app, "GET", path(`/shifts/${counter.shiftId}/report`), { userId: as("CASHIER") });
    expect(ownReport.body).toMatchObject({ shift: { status: "OPEN", expectedCash: null }, totals: { cashSales: 9000, cashOut: 15000 } });

    // 100000 + 9000 - 15000 = 94000; the cashier counts 94000.
    const closed = await post(`/shifts/${counter.shiftId}/close`, as("CASHIER"), { countedCash: 94000 });
    expect(closed).toMatchObject({ status: 200, body: { outcome: { kind: "BALANCED" }, shift: { status: "CLOSED", expectedCash: 94000, variance: 0 } } });
    expect((await sell(as("CASHIER"), sale(counter))).body).toEqual({ error: "SHIFT_NOT_OPEN" });

    expect((await post(`/shifts/${counter.shiftId}/review`, as("CASHIER"), { note: "Oke semua" })).status).toBe(403);
    const reviewed = await post(`/shifts/${counter.shiftId}/review`, as("BRANCH_MANAGER"), { note: "Sesuai" });
    expect(reviewed).toMatchObject({ status: 200, body: { reviewedBy: t.staff.BRANCH_MANAGER.staffId, reviewNote: "Sesuai" } });
    expect((await auditLog()).map((e) => e.action)).toEqual(expect.arrayContaining(["shift.close", "shift.review", "shift.cash_movement"]));
  });

  test("selling, opening shifts, voiding and reviewing follow the matrix for all nine roles", async () => {
    const counter = await openShift("OWNER");
    const closedShift = await openShift("OWNER");
    await post(`/shifts/${closedShift.shiftId}/close`, as("OWNER"), { countedCash: 200000 });
    const outcome: Record<string, boolean[]> = {};
    const expected: Record<string, boolean[]> = {};
    for (const role of ROLES) {
      const sold = await sell(as(role), sale(counter, { lines: [{ productId: product.id, unitId: unit("tablet"), qty: "1", unitPrice: 500 }], payments: [{ method: "CASH", tendered: 500 }] }));
      const opened = await post("/shifts", as(role), { shiftId: crypto.randomUUID(), workstationId: await workstation(), openingFloat: 0 });
      const victim = sale(counter, { lines: [{ productId: product.id, unitId: unit("tablet"), qty: "1", unitPrice: 500 }], payments: [{ method: "CASH", tendered: 500 }] });
      await sell(as("OWNER"), victim);
      const voided = await post(`/sales/${victim.saleId}/void`, as(role), { reason: "matrix" });
      const reviewed = await post(`/shifts/${closedShift.shiftId}/review`, as(role), { note: "matrix" });
      outcome[role] = [sold.status < 300, opened.status < 300, voided.status < 300, reviewed.status < 300];
      expected[role] = [can(role, "sale.create"), can(role, "shift.manage"), can(role, "sale.void"), can(role, "shift.review")];
    }
    expect(outcome).toEqual(expected);
  });
});
