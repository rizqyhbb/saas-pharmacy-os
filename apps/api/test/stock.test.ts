import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { can, ROLES } from "@apotek/domain";
import { withContext } from "@apotek/db";
import { connect } from "@apotek/db/testing";
import { call, paracetamol, tenantWithEveryRole, testApp, token, type RoleTenant } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("stock API", () => {
  const db = sql!;
  const app = testApp(db);
  let t: RoleTenant;
  const path = (p: string) => `/tenants/${t.tenantId}${p}`;
  const as = (role: keyof RoleTenant["staff"]) => t.staff[role].userId;

  async function newProduct(body = paracetamol()) {
    return (await call(app, "POST", path("/products"), { userId: as("OWNER"), body })).body as {
      id: string;
      units: { id: string; name: string }[];
    };
  }
  const unit = (p: { units: { id: string; name: string }[] }, name: string) => p.units.find((u) => u.name === name)!.id;

  /** POST with an Idempotency-Key header. */
  async function opening(userId: string, key: string, body: unknown) {
    const response = await app.handle(
      new Request(`http://localhost${path("/stock/opening-balances")}`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token(userId)}`, "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    t = await tenantWithEveryRole(app, db, "Apotek Stok");
  });

  test("opening stock entered in boxes is stored in tablets, on the batch, with the document", async () => {
    const p = await newProduct();
    const key = crypto.randomUUID();
    const res = await opening(as("WAREHOUSE"), key, {
      locationId: t.locationId,
      productId: p.id,
      lines: [{ unitId: unit(p, "box"), qty: "2", batchNumber: "PCT-26F02", expiryDate: "2099-06-30" }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ documentId: key, replayed: false, lines: [{ baseQty: "200" }] });

    const card = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("CASHIER") })).body;
    expect(card.batches).toEqual([
      expect.objectContaining({ batchNumber: "PCT-26F02", expiryDate: "2099-06-30", onHand: "200", reserved: "0", sellable: true }),
    ]);
    expect(card.ledger).toEqual([
      expect.objectContaining({
        eventType: "OPENING_BALANCE",
        qtyDeltaBase: "200",
        unitContext: { unit: "box", qty: "2" },
        referenceType: "opening_balance",
        referenceId: key,
        actor: "warehouse",
      }),
    ]);
  });

  test("sending the same document twice records it once (T10)", async () => {
    const p = await newProduct();
    const key = crypto.randomUUID();
    const body = {
      locationId: t.locationId,
      productId: p.id,
      lines: [{ unitId: unit(p, "strip"), qty: "3", batchNumber: "LOT-1", expiryDate: "2099-01-31" }],
    };
    expect((await opening(as("OWNER"), key, body)).status).toBe(201);
    const again = await opening(as("OWNER"), key, body);
    expect(again).toMatchObject({ status: 200, body: { replayed: true, lines: [{ baseQty: "30" }] } });
    const card = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("OWNER") })).body;
    expect(card.batches[0].onHand).toBe("30");

    const different = await opening(as("OWNER"), key, { ...body, lines: [{ ...body.lines[0], qty: "4" }] });
    expect(different).toEqual({ status: 422, body: { error: "IDEMPOTENCY_KEY_REUSED" } });
    expect((await opening(as("OWNER"), "not-a-uuid", body)).status).toBe(400);
  });

  test("the same lot arriving in two documents adds to one batch (B2)", async () => {
    const p = await newProduct();
    const line = { unitId: unit(p, "tablet"), qty: "15", batchNumber: "LOT-B2", expiryDate: "2099-03-31" };
    await opening(as("OWNER"), crypto.randomUUID(), { locationId: t.locationId, productId: p.id, lines: [line] });
    await opening(as("OWNER"), crypto.randomUUID(), { locationId: t.locationId, productId: p.id, lines: [line] });
    const card = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("OWNER") })).body;
    expect(card.batches.map((b: { batchNumber: string; onHand: string }) => [b.batchNumber, b.onHand])).toEqual([["LOT-B2", "30"]]);
    expect(card.ledger).toHaveLength(2);
  });

  test("batch details are required, and conversions must be exact", async () => {
    const p = await newProduct();
    const noBatch = await opening(as("OWNER"), crypto.randomUUID(), {
      locationId: t.locationId,
      productId: p.id,
      lines: [{ unitId: unit(p, "box"), qty: "1" }],
    });
    expect(noBatch.body).toEqual({ error: "BATCH_REQUIRED", line: 0 });

    const syrup = await newProduct({
      ...paracetamol(),
      brandName: "Sirup contoh",
      units: [
        { name: "ml", multiplierToBase: "1", sellPrice: 100 },
        { name: "sendok", multiplierToBase: "2.5", sellPrice: 250 },
      ],
    });
    const inexact = await opening(as("OWNER"), crypto.randomUUID(), {
      locationId: t.locationId,
      productId: syrup.id,
      lines: [{ unitId: unit(syrup, "sendok"), qty: "0.0001", batchNumber: "S-1", expiryDate: "2099-01-01" }],
    });
    expect(inexact.body).toEqual({ error: "INEXACT_CONVERSION", line: 0 });
  });

  test("staff scoped to one branch can't stock another branch, and only see their own", async () => {
    const other = await withContext(db, { userId: as("OWNER"), tenantId: t.tenantId, staffId: t.staff.OWNER.staffId }, async (tx) => {
      const [branch] = await tx<{ id: string }[]>`insert into app.branches (tenant_id, name) values (${t.tenantId}, 'Cabang Timur') returning id`;
      const [location] = await tx<{ id: string }[]>`
        insert into app.locations (tenant_id, branch_id, name) values (${t.tenantId}, ${branch!.id}, 'Gudang') returning id`;
      return { branchId: branch!.id, locationId: location!.id };
    });
    const p = await newProduct();
    const line = { unitId: unit(p, "box"), qty: "1", batchNumber: "EAST-1", expiryDate: "2099-01-01" };
    const denied = await opening(as("WAREHOUSE"), crypto.randomUUID(), { locationId: other.locationId, productId: p.id, lines: [line] });
    expect(denied).toEqual({ status: 403, body: { error: "BRANCH_FORBIDDEN" } });
    const log = (await call(app, "GET", path("/audit-events"), { userId: as("AUDITOR") })).body.events;
    expect(log).toContainEqual(
      expect.objectContaining({ action: "branch.denied", entityId: other.branchId, actorStaffId: t.staff.WAREHOUSE.staffId }),
    );

    // The owner stocks both branches; the branch-scoped cashier only sees their own.
    await opening(as("OWNER"), crypto.randomUUID(), { locationId: other.locationId, productId: p.id, lines: [line] });
    await opening(as("OWNER"), crypto.randomUUID(), { locationId: t.locationId, productId: p.id, lines: [{ ...line, batchNumber: "PUSAT-1" }] });
    const cashierView = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("CASHIER") })).body;
    expect(cashierView.batches.map((b: { batchNumber: string }) => b.batchNumber)).toEqual(["PUSAT-1"]);
    const ownerView = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("OWNER") })).body;
    expect(ownerView.batches).toHaveLength(2);

    const locations = (await call(app, "GET", path("/branches"), { userId: as("WAREHOUSE") })).body.branches;
    expect(locations.map((b: { name: string }) => b.name)).toEqual(["Pusat"]);
  });

  test("quarantining a batch needs a reason, is audited, and makes it unsellable", async () => {
    const p = await newProduct();
    await opening(as("OWNER"), crypto.randomUUID(), {
      locationId: t.locationId,
      productId: p.id,
      lines: [{ unitId: unit(p, "strip"), qty: "5", batchNumber: "Q-1", expiryDate: "2099-01-01" }],
    });
    const batchId = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("OWNER") })).body.batches[0].batchId;

    const noReason = await call(app, "PUT", path(`/batches/${batchId}/status`), { userId: as("PHARMACIST"), body: { status: "QUARANTINE" } });
    expect(noReason.status).toBe(422);
    const destroyed = await call(app, "PUT", path(`/batches/${batchId}/status`), {
      userId: as("PHARMACIST"),
      body: { status: "DESTROYED", reason: "x".repeat(5) },
    });
    expect(destroyed.status).toBe(422);

    const res = await call(app, "PUT", path(`/batches/${batchId}/status`), {
      userId: as("PHARMACIST"),
      body: { status: "QUARANTINE", reason: "Kemasan rusak" },
    });
    expect(res).toEqual({ status: 200, body: { batchId, status: "QUARANTINE" } });
    const card = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("OWNER") })).body;
    expect(card.batches[0]).toMatchObject({ status: "QUARANTINE", sellable: false });
    const log = (await call(app, "GET", path("/audit-events"), { userId: as("AUDITOR") })).body.events;
    expect(log).toContainEqual(
      expect.objectContaining({
        action: "batch.status.change",
        entityId: batchId,
        before: { status: "AVAILABLE" },
        after: { status: "QUARANTINE", batchNumber: "Q-1" },
        reason: "Kemasan rusak",
      }),
    );
  });

  test("opening stock and batch status follow the permission matrix for all nine roles", async () => {
    const p = await newProduct();
    await opening(as("OWNER"), crypto.randomUUID(), {
      locationId: t.locationId,
      productId: p.id,
      lines: [{ unitId: unit(p, "box"), qty: "1", batchNumber: "M-1", expiryDate: "2099-01-01" }],
    });
    const batchId = (await call(app, "GET", path(`/products/${p.id}/stock`), { userId: as("OWNER") })).body.batches[0].batchId;
    const outcome: Record<string, [boolean, boolean]> = {};
    const expected: Record<string, [boolean, boolean]> = {};
    for (const role of ROLES) {
      const stocked = await opening(as(role), crypto.randomUUID(), {
        locationId: t.locationId,
        productId: p.id,
        lines: [{ unitId: unit(p, "tablet"), qty: "1", batchNumber: "M-1", expiryDate: "2099-01-01" }],
      });
      const status = await call(app, "PUT", path(`/batches/${batchId}/status`), {
        userId: as(role),
        body: { status: "AVAILABLE", reason: "matrix test" },
      });
      outcome[role] = [stocked.status < 300, status.status < 300];
      expected[role] = [can(role, "stock.opening_balance"), can(role, "batch.status.update")];
    }
    expect(outcome).toEqual(expected);
  });
});
