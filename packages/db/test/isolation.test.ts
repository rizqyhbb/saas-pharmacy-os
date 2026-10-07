import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withContext, type Tx } from "../src";
import { asTenant, connect, createProduct, createTenant, createUser, openBatch, rejection, type TestTenant } from "./support";

/**
 * Tenant isolation (G0-1, T11): tenant A can never read or write tenant B, on any
 * table. The table list comes from the database, so a new table is covered as soon
 * as it exists.
 */
const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("tenant isolation", () => {
  const db = sql!;
  let a: TestTenant;
  let b: TestTenant;
  let bProduct: { productId: string; baseUnitId: string };
  let bBatchId: string;
  let tables: string[];

  /** Puts one row in every tenant-owned table for `t`. */
  async function populate(t: TestTenant) {
    const cashierUser = await createUser(db);
    return asTenant(db, t, async (tx) => {
      const product = await createProduct(tx, t);
      await tx`insert into app.product_barcodes (tenant_id, product_id, unit_id, code)
               values (${t.tenantId}, ${product.productId}, ${product.baseUnitId}, ${`899${crypto.randomUUID().slice(0, 8)}`})`;
      const batchId = await openBatch(tx, t, product.productId, { qty: 50 });
      const [cashier] = await tx<{ id: string }[]>`
        insert into app.staff_members (tenant_id, user_id, display_name, role)
        values (${t.tenantId}, ${cashierUser}, 'Kasir', 'CASHIER') returning id`;
      await tx`insert into app.staff_branch_access (tenant_id, staff_member_id, branch_id)
               values (${t.tenantId}, ${cashier!.id}, ${t.branchId})`;
      return { product, batchId };
    });
  }

  beforeAll(async () => {
    a = await createTenant(db, "Apotek A");
    b = await createTenant(db, "Apotek B");
    await populate(a);
    const populated = await populate(b);
    bProduct = populated.product;
    bBatchId = populated.batchId;
    tables = (
      await db<{ t: string }[]>`
        select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r' order by 1`
    ).map((r) => r.t);
  });

  const ownerColumn = (table: string) => (table === "tenants" ? "id" : "tenant_id");

  test("tenant A sees its own rows in every table", async () => {
    const empty = await asTenant(db, a, async (tx) => {
      const out: string[] = [];
      for (const table of tables) {
        const [row] = await tx.unsafe(`select count(*)::int as n from app.${table} where ${ownerColumn(table)} = $1`, [a.tenantId]);
        if (row!.n === 0) out.push(table);
      }
      return out;
    });
    expect(empty).toEqual([]);
  });

  test("tenant A sees none of tenant B's rows, in any table", async () => {
    const leaks = await asTenant(db, a, async (tx) => {
      const out: string[] = [];
      for (const table of tables) {
        const [row] = await tx.unsafe(`select count(*)::int as n from app.${table} where ${ownerColumn(table)} = $1`, [b.tenantId]);
        if (row!.n > 0) out.push(table);
      }
      return out;
    });
    expect(leaks).toEqual([]);
  });

  test("tenant A cannot fetch tenant B's rows by id", async () => {
    const found = await asTenant(db, a, (tx) => tx`
      select (select count(*) from app.products where id = ${bProduct.productId})::int as products,
             (select count(*) from app.batches where id = ${bBatchId})::int as batches,
             (select count(*) from app.inventory_ledger where batch_id = ${bBatchId})::int as ledger,
             (select count(*) from app.inventory_balances where batch_id = ${bBatchId})::int as balances,
             (select count(*) from app.staff_members where id = ${b.staffId})::int as staff,
             (select count(*) from app.branches where id = ${b.branchId})::int as branches`);
    expect(found[0]).toEqual({ products: 0, batches: 0, ledger: 0, balances: 0, staff: 0, branches: 0 });
  });

  test("tenant A cannot insert rows into tenant B", async () => {
    const attempts: Record<string, (tx: Tx) => Promise<unknown>> = {
      branches: (tx) => tx`insert into app.branches (tenant_id, name) values (${b.tenantId}, 'X')`,
      locations: (tx) => tx`insert into app.locations (tenant_id, branch_id, name) values (${b.tenantId}, ${b.branchId}, 'X')`,
      products: (tx) => tx`insert into app.products (tenant_id, sku, brand_name) values (${b.tenantId}, 'X-1', 'X')`,
      product_units: (tx) => tx`insert into app.product_units (tenant_id, product_id, name, multiplier_to_base)
                                values (${b.tenantId}, ${bProduct.productId}, 'pack', 5)`,
      audit_events: (tx) => tx`insert into app.audit_events (tenant_id, action, entity_type) values (${b.tenantId}, 'x.y', 'x')`,
      inventory_ledger: (tx) => tx`insert into app.inventory_ledger
        (tenant_id, branch_id, location_id, product_id, batch_id, qty_delta_base, event_type, reference_type, reference_id, idempotency_key)
        values (${b.tenantId}, ${b.branchId}, ${b.locationId}, ${bProduct.productId}, ${bBatchId}, -1, 'SALE', 't', 't', ${crypto.randomUUID()})`,
    };
    for (const [table, attempt] of Object.entries(attempts)) {
      const error = await rejection(asTenant(db, a, attempt));
      expect({ table, message: error.message }).toEqual({ table, message: expect.stringMatching(/row-level security/) });
    }
  });

  test("tenant A cannot change or delete tenant B's rows", async () => {
    const counts = await asTenant(db, a, async (tx) => ({
      products: (await tx`update app.products set brand_name = 'hacked' where id = ${bProduct.productId}`).count,
      batches: (await tx`update app.batches set status = 'QUARANTINE' where id = ${bBatchId}`).count,
      staff: (await tx`update app.staff_members set role = 'CASHIER' where id = ${b.staffId}`).count,
      tenants: (await tx`update app.tenants set name = 'hacked' where id = ${b.tenantId}`).count,
      units: (await tx`delete from app.product_units where product_id = ${bProduct.productId}`).count,
    }));
    expect(counts).toEqual({ products: 0, batches: 0, staff: 0, tenants: 0, units: 0 });
  });

  test("a row in tenant A cannot point at tenant B's data", async () => {
    const error = await rejection(
      asTenant(db, a, (tx) => tx`
        insert into app.product_units (tenant_id, product_id, name, multiplier_to_base)
        values (${a.tenantId}, ${bProduct.productId}, 'pack', 5)`),
    );
    expect(error.message).toMatch(/foreign key/);
  });

  test("a forged context naming tenant B opens nothing", async () => {
    // A's user and staff id with B's tenant id: what an API bug would produce.
    const forged = { userId: a.userId, staffId: a.staffId, tenantId: b.tenantId };
    const seen = await withContext(db, forged, (tx) => tx`
      select (select count(*) from app.products)::int as products,
             (select count(*) from app.inventory_ledger)::int as ledger`);
    expect(seen[0]).toEqual({ products: 0, ledger: 0 });
  });

  test("before choosing a tenant, a user sees only their own memberships", async () => {
    const seen = await withContext(db, { userId: a.userId }, (tx) => tx`
      select (select count(*) from app.products)::int as products,
             (select count(*) from app.staff_members)::int as staff,
             (select count(*) from app.tenants)::int as tenants`);
    expect(seen[0]).toEqual({ products: 0, staff: 1, tenants: 1 });
  });

  test("a deactivated staff member loses access immediately", async () => {
    const userId = await createUser(db);
    const staffId = await asTenant(db, a, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into app.staff_members (tenant_id, user_id, display_name, role)
        values (${a.tenantId}, ${userId}, 'Gudang', 'WAREHOUSE') returning id`;
      return row!.id;
    });
    const ctx = { userId, staffId, tenantId: a.tenantId };
    const before = await withContext(db, ctx, (tx) => tx`select count(*)::int as n from app.products`);
    await asTenant(db, a, (tx) => tx`update app.staff_members set active = false where id = ${staffId}`);
    const after = await withContext(db, ctx, (tx) => tx`select count(*)::int as n from app.products`);
    expect(before[0]!.n).toBeGreaterThan(0);
    expect(after[0]!.n).toBe(0);
  });
});
