import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { can, ROLES, type Permission } from "@apotek/domain";
import { connect } from "@apotek/db/testing";
import { call, paracetamol, tenantWithEveryRole, testApp, type RoleTenant } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("catalogue API", () => {
  const db = sql!;
  const app = testApp(db);
  let t: RoleTenant;
  const path = (p: string) => `/tenants/${t.tenantId}${p}`;
  const as = (role: keyof RoleTenant["staff"]) => t.staff[role].userId;
  const auditLog = async () => (await call(app, "GET", path("/audit-events"), { userId: as("OWNER") })).body.events as Record<string, unknown>[];

  beforeAll(async () => {
    t = await tenantWithEveryRole(app, db, "Apotek Katalog");
  });

  test("an owner creates a classified, sellable product with units and barcodes", async () => {
    const input = paracetamol();
    const res = await call(app, "POST", path("/products"), { userId: as("OWNER"), body: input });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sku: input.sku,
      brandName: "Paracetamol",
      salesClass: "OTC",
      controlledClass: "NONE",
      sellable: true,
      classifiedBy: t.staff.OWNER.staffId,
    });
    expect(res.body.units.map((u: { name: string; multiplierToBase: string }) => [u.name, u.multiplierToBase])).toEqual([
      ["tablet", "1"],
      ["strip", "10"],
      ["box", "100"],
    ]);
    expect(res.body.units[1].barcodes).toEqual(input.units[1]!.barcodes);
    const actions = (await auditLog()).filter((e) => e.entityId === res.body.id).map((e) => e.action);
    expect(actions.sort()).toEqual(["product.classify", "product.create"]);
  });

  test("a product from staff who can't classify starts unclassified and unsellable", async () => {
    const { salesClass: _s, controlledClass: _c, ...unclassified } = paracetamol();
    const res = await call(app, "POST", path("/products"), { userId: as("PURCHASING"), body: unclassified });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sellable: false, classifiedAt: null, salesClass: "OTC" });

    const withClass = await call(app, "POST", path("/products"), { userId: as("PURCHASING"), body: paracetamol() });
    expect(withClass).toEqual({ status: 403, body: { error: "FORBIDDEN", permission: "product.classify" } });
  });

  test("a pharmacist classifies it; the change is audited and the product becomes sellable", async () => {
    const { salesClass: _s, controlledClass: _c, ...input } = { ...paracetamol(), brandName: "Amoxicillin", strength: "500 mg" };
    const created = await call(app, "POST", path("/products"), { userId: as("PURCHASING"), body: input });
    const id = created.body.id;
    const classified = await call(app, "PUT", path(`/products/${id}/classification`), {
      userId: as("PHARMACIST"),
      body: { salesClass: "RX_REQUIRED", controlledClass: "NONE", reason: "Antibiotik, wajib resep" },
    });
    expect(classified.status).toBe(200);
    expect(classified.body).toMatchObject({ salesClass: "RX_REQUIRED", sellable: true, classifiedBy: t.staff.PHARMACIST.staffId });
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({
        action: "product.classify",
        entityId: id,
        before: { salesClass: "OTC", controlledClass: "NONE", blockedForSale: false, classified: false },
        after: { salesClass: "RX_REQUIRED", controlledClass: "NONE", blockedForSale: false, classified: true },
        reason: "Antibiotik, wajib resep",
      }),
    );
  });

  test("unit sets are validated by the domain rules", async () => {
    const noBase = { ...paracetamol(), units: [{ name: "strip", multiplierToBase: "10" }] };
    const dupNames = { ...paracetamol(), units: [{ name: "tablet", multiplierToBase: "1" }, { name: "Tablet", multiplierToBase: "10" }] };
    const zero = { ...paracetamol(), units: [{ name: "tablet", multiplierToBase: "1" }, { name: "strip", multiplierToBase: "0" }] };
    for (const body of [noBase, dupNames, zero]) {
      const res = await call(app, "POST", path("/products"), { userId: as("OWNER"), body });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("INVALID_UNITS");
    }
  });

  test("SKU and barcode are unique within the tenant", async () => {
    const first = paracetamol();
    await call(app, "POST", path("/products"), { userId: as("OWNER"), body: first });
    const sameSku = await call(app, "POST", path("/products"), { userId: as("OWNER"), body: { ...paracetamol(), sku: first.sku } });
    expect(sameSku.status).toBe(409);
    const sameBarcode = paracetamol();
    sameBarcode.units[1]!.barcodes = first.units[1]!.barcodes;
    expect((await call(app, "POST", path("/products"), { userId: as("OWNER"), body: sameBarcode })).status).toBe(409);
  });

  test("a price change keeps the old price in the audit trail", async () => {
    const product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
    const strip = product.units.find((u: { name: string }) => u.name === "strip");
    const res = await call(app, "PUT", path(`/products/${product.id}/units/${strip.id}/price`), {
      userId: as("BRANCH_MANAGER"),
      body: { sellPrice: 5000, reason: "Harga pemasok naik" },
    });
    expect(res.status).toBe(200);
    expect(res.body.units.find((u: { id: string }) => u.id === strip.id).sellPrice).toBe(5000);
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({
        action: "price.update",
        entityId: strip.id,
        before: { unit: "strip", sellPrice: 4500 },
        after: { unit: "strip", sellPrice: 5000 },
        actorStaffId: t.staff.BRANCH_MANAGER.staffId,
      }),
    );
  });

  test("search finds by brand, generic name, SKU and exact barcode", async () => {
    const input = { ...paracetamol(), brandName: "Sanmol", genericName: "paracetamol" };
    const product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: input })).body;
    const find = async (q: string) =>
      ((await call(app, "GET", path(`/products?q=${encodeURIComponent(q)}`), { userId: as("CASHIER") })).body.products as { id: string }[]).map(
        (p) => p.id,
      );
    expect(await find("sanmol")).toContain(product.id);
    expect(await find("PARACETAMOL")).toContain(product.id);
    expect(await find(input.sku)).toContain(product.id);
    expect(await find(input.units[1]!.barcodes![0]!)).toEqual([product.id]);
    // LIKE wildcards in the query are matched literally, not as "match everything".
    expect(await find("%")).toEqual([]);
  });

  test("details can be edited; unknown products are 404", async () => {
    const product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
    const res = await call(app, "PATCH", path(`/products/${product.id}`), {
      userId: as("PURCHASING"),
      body: { manufacturer: "PT Contoh Farma", kfaCode: "93000001" },
    });
    expect(res.body).toMatchObject({ manufacturer: "PT Contoh Farma", kfaCode: "93000001", sku: product.sku });
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({
        action: "product.update",
        entityId: product.id,
        after: { manufacturer: "PT Contoh Farma", kfaCode: "93000001" },
        actorStaffId: t.staff.PURCHASING.staffId,
      }),
    );
    expect((await call(app, "GET", path(`/products/${crypto.randomUUID()}`), { userId: as("OWNER") })).status).toBe(404);
  });

  test("another tenant's product is invisible (404)", async () => {
    const other = await tenantWithEveryRole(app, db, "Apotek Lain");
    const theirs = (await call(app, "POST", `/tenants/${other.tenantId}/products`, { userId: other.staff.OWNER.userId, body: paracetamol() })).body;
    expect((await call(app, "GET", path(`/products/${theirs.id}`), { userId: as("OWNER") })).status).toBe(404);
    const patch = await call(app, "PATCH", path(`/products/${theirs.id}`), { userId: as("OWNER"), body: { brandName: "Diretas" } });
    expect(patch.status).toBe(404);
  });

  test("barcodes can be added and removed", async () => {
    const product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
    const box = product.units.find((u: { name: string }) => u.name === "box");
    const code = `899${crypto.randomUUID().slice(0, 9)}`;
    const added = await call(app, "POST", path(`/products/${product.id}/barcodes`), { userId: as("OWNER"), body: { unitId: box.id, code } });
    expect(added.body.units.find((u: { id: string }) => u.id === box.id).barcodes).toEqual([code]);
    const removed = await call(app, "DELETE", path(`/products/${product.id}/barcodes/${code}`), { userId: as("OWNER") });
    expect(removed.status).toBe(204);
  });

  // G0-4 for the catalogue: every role, decided by the server-side matrix.
  const writes: { permission: Permission; run: (userId: string) => Promise<{ status: number }> }[] = [
    { permission: "product.write", run: (userId) => call(app, "POST", path("/products"), { userId, body: (({ salesClass, controlledClass, ...p }) => p)(paracetamol()) }) },
    {
      permission: "price.update",
      run: async (userId) => {
        const p = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
        return call(app, "PUT", path(`/products/${p.id}/units/${p.units[0].id}/price`), { userId, body: { sellPrice: 600 } });
      },
    },
    {
      permission: "product.classify",
      run: async (userId) => {
        const p = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
        return call(app, "PUT", path(`/products/${p.id}/classification`), { userId, body: { salesClass: "OTC", controlledClass: "NONE" } });
      },
    },
  ];
  for (const { permission, run } of writes) {
    test(`${permission}: allowed exactly for the roles the matrix grants`, async () => {
      const outcome: Record<string, boolean> = {};
      const expected: Record<string, boolean> = {};
      for (const role of ROLES) {
        const res = await run(t.staff[role].userId);
        outcome[role] = res.status < 300;
        expected[role] = can(role, permission);
      }
      expect(outcome).toEqual(expected);
    });
  }
});
