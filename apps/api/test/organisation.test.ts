import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { can, ROLES } from "@apotek/domain";
import { connect } from "@apotek/db/testing";
import { call, paracetamol, tenantWithEveryRole, testApp, token, type RoleTenant } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("organisation, batch correction and reconciliation", () => {
  const db = sql!;
  const app = testApp(db);
  let t: RoleTenant;
  const path = (p: string) => `/tenants/${t.tenantId}${p}`;
  const as = (role: keyof RoleTenant["staff"]) => t.staff[role].userId;
  const auditLog = async () => (await call(app, "GET", path("/audit-events?limit=500"), { userId: as("OWNER") })).body.events as Record<string, unknown>[];

  beforeAll(async () => {
    t = await tenantWithEveryRole(app, db, "Apotek Cabang");
  });

  test("FND-2: an owner adds a branch with its main location, then locations and workstations", async () => {
    const branch = await call(app, "POST", path("/branches"), { userId: as("OWNER"), body: { name: "Cabang Makassar", timezone: "Asia/Makassar" } });
    expect(branch.status).toBe(201);
    const { branchId } = branch.body;
    const rack = await call(app, "POST", path(`/branches/${branchId}/locations`), { userId: as("OWNER"), body: { name: "Rak depan" } });
    const counter = await call(app, "POST", path(`/branches/${branchId}/workstations`), { userId: as("OWNER"), body: { name: "Kasir 1" } });
    expect([rack.status, counter.status]).toEqual([201, 201]);

    const dup = await call(app, "POST", path(`/branches/${branchId}/workstations`), { userId: as("OWNER"), body: { name: "Kasir 1" } });
    expect(dup.status).toBe(409);
    await call(app, "PATCH", path(`/workstations/${counter.body.workstationId}`), { userId: as("OWNER"), body: { active: false } });

    const tree = (await call(app, "GET", path("/branches"), { userId: as("OWNER") })).body.branches;
    expect(tree).toContainEqual({
      branchId,
      name: "Cabang Makassar",
      timezone: "Asia/Makassar",
      locations: [expect.objectContaining({ name: "Rak depan" }), expect.objectContaining({ name: "Utama" })],
      workstations: [{ workstationId: counter.body.workstationId, name: "Kasir 1", active: false }],
    });
    const actions = (await auditLog()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["branch.create", "location.create", "workstation.create", "workstation.update"]));

    // Branch-scoped staff see only their own branch.
    const cashierTree = (await call(app, "GET", path("/branches"), { userId: as("CASHIER") })).body.branches;
    expect(cashierTree.map((b: { branchId: string }) => b.branchId)).toEqual([t.branchId]);
  });

  test("only Indonesian time zones are accepted for a branch", async () => {
    const res = await call(app, "POST", path("/branches"), { userId: as("OWNER"), body: { name: "X", timezone: "Europe/London" } });
    expect(res.status).toBe(422);
  });

  test("branch management follows the matrix for all nine roles", async () => {
    const outcome: Record<string, boolean> = {};
    const expected: Record<string, boolean> = {};
    for (const role of ROLES) {
      const res = await call(app, "POST", path(`/branches/${t.branchId}/workstations`), {
        userId: as(role),
        body: { name: `WS ${role} ${crypto.randomUUID().slice(0, 4)}` },
      });
      outcome[role] = res.status < 300;
      expected[role] = can(role, "branch.manage");
    }
    expect(outcome).toEqual(expected);
  });

  test("INV-8: only the owner corrects a batch, with a reason, and it is audited", async () => {
    const product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
    const response = await app.handle(
      new Request(`http://localhost${path("/stock/opening-balances")}`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token(as("OWNER"))}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          locationId: t.locationId,
          productId: product.id,
          lines: [{ unitId: product.units[0].id, qty: "10", batchNumber: "LOT-0O1", expiryDate: "2099-01-01" }],
        }),
      }),
    );
    expect(response.status).toBe(201);
    const batchId = (await call(app, "GET", path(`/products/${product.id}/stock`), { userId: as("OWNER") })).body.batches[0].batchId;

    const byManager = await call(app, "PUT", path(`/batches/${batchId}/correction`), {
      userId: as("BRANCH_MANAGER"),
      body: { batchNumber: "LOT-001", expiryDate: "2099-01-01", reason: "Salah ketik O dan 0" },
    });
    expect(byManager.status).toBe(403);
    const fixed = await call(app, "PUT", path(`/batches/${batchId}/correction`), {
      userId: as("OWNER"),
      body: { batchNumber: "LOT-001", expiryDate: "2099-02-01", reason: "Salah ketik O dan 0" },
    });
    expect(fixed).toEqual({ status: 200, body: { batchId, batchNumber: "LOT-001", expiryDate: "2099-02-01" } });
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({
        action: "batch.correct",
        entityId: batchId,
        before: { batchNumber: "LOT-0O1", expiryDate: "2099-01-01" },
        after: { batchNumber: "LOT-001", expiryDate: "2099-02-01" },
        reason: "Salah ketik O dan 0",
      }),
    );
  });

  test("reconciliation issues are listed and resolved with a note", async () => {
    const product = (await call(app, "POST", path("/products"), { userId: as("OWNER"), body: paracetamol() })).body;
    await db`insert into app.reconciliation_issues
      (tenant_id, location_id, product_id, ledger_on_hand, ledger_reserved, balance_on_hand, balance_reserved)
      values (${t.tenantId}, ${t.locationId}, ${product.id}, 5, 0, 4, 0)`;
    const open = (await call(app, "GET", path("/reconciliation-issues"), { userId: as("WAREHOUSE") })).body.issues;
    const issue = open.find((i: { productId: string }) => i.productId === product.id);
    expect(issue).toMatchObject({ ledger: { onHand: "5" }, balance: { onHand: "4" }, resolvedAt: null });

    expect((await call(app, "POST", path(`/reconciliation-issues/${issue.issueId}/resolution`), { userId: as("CASHIER"), body: { note: "x".repeat(5) } })).status).toBe(403);
    const resolved = await call(app, "POST", path(`/reconciliation-issues/${issue.issueId}/resolution`), {
      userId: as("WAREHOUSE"),
      body: { note: "Dihitung ulang, buku besar benar" },
    });
    expect(resolved.status).toBe(200);
    const stillOpen = (await call(app, "GET", path("/reconciliation-issues"), { userId: as("OWNER") })).body.issues;
    expect(stillOpen.find((i: { issueId: string }) => i.issueId === issue.issueId)).toBeUndefined();
  });

  test("product stock levels and default location are validated by the schema", async () => {
    const levels = await call(app, "POST", path("/products"), {
      userId: as("OWNER"),
      body: { ...paracetamol(), category: "Analgesik", minStock: "100", maxStock: "50" },
    });
    expect(levels).toMatchObject({ status: 422, body: { error: "INVALID_VALUE", constraint: "products_stock_levels" } });

    const other = await tenantWithEveryRole(app, db, "Apotek Asing");
    const foreignLocation = await call(app, "POST", path("/products"), {
      userId: as("OWNER"),
      body: { ...paracetamol(), defaultLocationId: other.locationId },
    });
    expect(foreignLocation).toMatchObject({ status: 422, body: { error: "INVALID_REFERENCE" } });

    const ok = await call(app, "POST", path("/products"), {
      userId: as("OWNER"),
      body: { ...paracetamol(), category: "Analgesik", packageDescription: "Box isi 10 strip x 10 tablet", minStock: "50", reorderPoint: "80", defaultLocationId: t.locationId },
    });
    expect(ok.body).toMatchObject({ category: "Analgesik", minStock: "50", reorderPoint: "80", maxStock: null, defaultLocationId: t.locationId });
  });
});
