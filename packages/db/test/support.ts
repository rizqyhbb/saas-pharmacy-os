import { createDb, registerTenant, withContext, type DbContext, type Sql, type Tx } from "../src";

/**
 * Integration tests run against the local Supabase database (`supabase start`).
 * Locally they skip with a warning when it isn't running; in CI they fail.
 */
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

export async function connect(): Promise<Sql | null> {
  const sql = createDb(DATABASE_URL, { max: 4 });
  try {
    await sql`select 1`;
    return sql;
  } catch (error) {
    await sql.end({ timeout: 1 });
    if (process.env.CI) throw new Error(`Database not reachable at ${DATABASE_URL}: ${String(error)}`);
    console.warn(`[db tests] skipped: no database at ${DATABASE_URL}. Run \`supabase start\`.`);
    return null;
  }
}

/** A Supabase Auth user, inserted directly (tests only). */
export async function createUser(sql: Sql): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into auth.users (id, email, aud, role)
    values (${id}, ${`${id}@test.apotek.local`}, 'authenticated', 'authenticated')
  `;
  return id;
}

export interface TestTenant {
  userId: string;
  tenantId: string;
  branchId: string;
  locationId: string;
  staffId: string;
  ctx: DbContext;
}

export async function createTenant(sql: Sql, name = "Apotek Uji"): Promise<TestTenant> {
  const userId = await createUser(sql);
  const t = await registerTenant(sql, userId, { tenantName: name, branchName: "Cabang Pusat", ownerDisplayName: "Pemilik" });
  return { userId, ...t, ctx: { userId, tenantId: t.tenantId, staffId: t.staffId } };
}

export interface TestProduct {
  productId: string;
  baseUnitId: string;
  stripUnitId: string;
}

/** Paracetamol-style product, classified OTC by the owner: tablet (base), strip = 10, box = 100. */
export async function createProduct(
  tx: Tx,
  tenant: TestTenant,
  sku = `PCT-${crypto.randomUUID().slice(0, 8)}`,
  opts: { classified?: boolean } = {},
): Promise<TestProduct> {
  const classified = opts.classified ?? true;
  const [product] = await tx<{ id: string }[]>`
    insert into app.products (tenant_id, sku, brand_name, generic_name, strength, classified_at, classified_by)
    values (
      ${tenant.tenantId}, ${sku}, 'Paracetamol', 'paracetamol', '500 mg',
      ${classified ? new Date() : null}, ${classified ? tenant.staffId : null}
    )
    returning id
  `;
  const productId = product!.id;
  const units = await tx<{ id: string; name: string }[]>`
    insert into app.product_units (tenant_id, product_id, name, multiplier_to_base, sell_price)
    values
      (${tenant.tenantId}, ${productId}, 'tablet', 1, 500),
      (${tenant.tenantId}, ${productId}, 'strip', 10, 4500),
      (${tenant.tenantId}, ${productId}, 'box', 100, 42000)
    returning id, name
  `;
  return {
    productId,
    baseUnitId: units.find((u) => u.name === "tablet")!.id,
    stripUnitId: units.find((u) => u.name === "strip")!.id,
  };
}

/** A batch arriving with its opening balance (B1), in the caller's transaction. */
export async function openBatch(
  tx: Tx,
  tenant: TestTenant,
  productId: string,
  opts: { batchNumber?: string; expiryDate?: string; qty: number; status?: string },
): Promise<string> {
  const [batch] = await tx<{ id: string }[]>`
    insert into app.batches (tenant_id, product_id, batch_number, expiry_date, status)
    values (
      ${tenant.tenantId}, ${productId}, ${opts.batchNumber ?? `B-${crypto.randomUUID().slice(0, 8)}`},
      ${opts.expiryDate ?? "2099-12-31"}, ${opts.status ?? "AVAILABLE"}
    )
    returning id
  `;
  await ledger(tx, tenant, { productId, batchId: batch!.id, eventType: "OPENING_BALANCE", qty: opts.qty });
  return batch!.id;
}

export async function ledger(
  tx: Tx,
  tenant: TestTenant,
  e: { productId: string; batchId: string | null; eventType: string; qty: number | string; conflictNegative?: boolean; key?: string },
): Promise<void> {
  await tx`
    insert into app.inventory_ledger
      (tenant_id, branch_id, location_id, product_id, batch_id, qty_delta_base, event_type,
       reference_type, reference_id, idempotency_key, conflict_negative, actor_staff_id)
    values (
      ${tenant.tenantId}, ${tenant.branchId}, ${tenant.locationId}, ${e.productId}, ${e.batchId}, ${e.qty},
      ${e.eventType}, 'test', 'test', ${e.key ?? crypto.randomUUID()}, ${e.conflictNegative ?? false}, ${tenant.staffId}
    )
  `;
}

export const asTenant = <T>(sql: Sql, tenant: TestTenant, fn: (tx: Tx) => Promise<T>) => withContext(sql, tenant.ctx, fn);

/** Resolves to the error a promise rejected with (fails the test if it resolved). */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to fail, but it succeeded");
}
