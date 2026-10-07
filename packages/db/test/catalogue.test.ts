import { afterAll, describe, expect, test } from "bun:test";
import { classifyDbError } from "../src";
import { asTenant, connect, createProduct, createTenant, ledger, openBatch, rejection } from "./support";

/** Catalogue and batch invariants enforced by the schema (DOMAIN-MODEL.md §3-4, T3, T4). */
const sql = await connect();
afterAll(() => sql?.end());

const rule = (error: Error) => {
  const failure = classifyDbError(error);
  return failure?.kind === "RULE" ? failure.rule : failure?.kind;
};

describe.skipIf(!sql)("units (U1)", () => {
  const db = sql!;

  test("a product without a base unit is refused at commit", async () => {
    const t = await createTenant(db);
    const error = await rejection(
      asTenant(db, t, async (tx) => {
        const [p] = await tx<{ id: string }[]>`
          insert into app.products (tenant_id, sku, brand_name) values (${t.tenantId}, 'NO-BASE', 'Tanpa satuan dasar') returning id`;
        await tx`insert into app.product_units (tenant_id, product_id, name, multiplier_to_base)
                 values (${t.tenantId}, ${p!.id}, 'strip', 10)`;
      }),
    );
    expect(rule(error)).toBe("BASE_UNIT_REQUIRED");
  });

  test("a second base unit is refused", async () => {
    const t = await createTenant(db);
    const error = await rejection(
      asTenant(db, t, async (tx) => {
        const p = await createProduct(tx, t);
        await tx`insert into app.product_units (tenant_id, product_id, name, multiplier_to_base)
                 values (${t.tenantId}, ${p.productId}, 'kaplet', 1)`;
      }),
    );
    expect(error.message).toMatch(/product_units_one_base_unit/);
  });

  test("the base unit cannot be deleted while the product exists", async () => {
    const t = await createTenant(db);
    const p = await asTenant(db, t, (tx) => createProduct(tx, t));
    const error = await rejection(asTenant(db, t, (tx) => tx`delete from app.product_units where id = ${p.baseUnitId}`));
    expect(rule(error)).toBe("BASE_UNIT_REQUIRED");
  });

  test("a barcode is unique within a tenant", async () => {
    const t = await createTenant(db);
    const error = await rejection(
      asTenant(db, t, async (tx) => {
        const p = await createProduct(tx, t);
        await tx`insert into app.product_barcodes (tenant_id, product_id, unit_id, code)
                 values (${t.tenantId}, ${p.productId}, ${p.baseUnitId}, '8991234567890'),
                        (${t.tenantId}, ${p.productId}, ${p.stripUnitId}, '8991234567890')`;
      }),
    );
    expect(classifyDbError(error)?.kind).toBe("UNIQUE");
  });
});

describe.skipIf(!sql)("batches (B1-B3)", () => {
  const db = sql!;

  test("B1: a batch with no opening balance or goods receipt is refused at commit", async () => {
    const t = await createTenant(db);
    const error = await rejection(
      asTenant(db, t, async (tx) => {
        const p = await createProduct(tx, t);
        await tx`insert into app.batches (tenant_id, product_id, batch_number, expiry_date)
                 values (${t.tenantId}, ${p.productId}, 'ORPHAN-1', '2099-01-01')`;
      }),
    );
    expect(rule(error)).toBe("BATCH_WITHOUT_ORIGIN");
  });

  test("B2: the same batch number and expiry cannot be created twice", async () => {
    const t = await createTenant(db);
    const error = await rejection(
      asTenant(db, t, async (tx) => {
        const p = await createProduct(tx, t);
        await openBatch(tx, t, p.productId, { batchNumber: "LOT-7", expiryDate: "2099-01-01", qty: 5 });
        await openBatch(tx, t, p.productId, { batchNumber: "LOT-7", expiryDate: "2099-01-01", qty: 5 });
      }),
    );
    expect(classifyDbError(error)?.kind).toBe("UNIQUE");
  });

  test("B3: batch number and expiry can't be edited; status can", async () => {
    const t = await createTenant(db);
    const batchId = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      return openBatch(tx, t, p.productId, { qty: 5 });
    });
    const renamed = await rejection(asTenant(db, t, (tx) => tx`update app.batches set batch_number = 'NEW' where id = ${batchId}`));
    expect(renamed.message).toMatch(/permission denied|BATCH_IDENTITY_IMMUTABLE/);
    const redated = await rejection(asTenant(db, t, (tx) => tx`update app.batches set expiry_date = '2100-01-01' where id = ${batchId}`));
    expect(redated.message).toMatch(/permission denied|BATCH_IDENTITY_IMMUTABLE/);
    // Even the owner, bypassing grants, hits the trigger.
    expect(rule(await rejection(db`update app.batches set expiry_date = '2100-01-01' where id = ${batchId}`))).toBe(
      "BATCH_IDENTITY_IMMUTABLE",
    );
    const quarantined = await asTenant(db, t, (tx) => tx`update app.batches set status = 'QUARANTINE' where id = ${batchId}`);
    expect(quarantined.count).toBe(1);
  });
});

describe.skipIf(!sql)("sellable batches (T3)", () => {
  const db = sql!;

  for (const [label, opts] of [
    ["an expired batch", { expiryDate: "2000-01-01" }],
    ["a quarantined batch", { status: "QUARANTINE" }],
    ["a recalled batch", { status: "RECALLED" }],
  ] as const) {
    test(`a sale cannot draw from ${label}, but a write-off can`, async () => {
      const t = await createTenant(db);
      const { productId, batchId } = await asTenant(db, t, async (tx) => {
        const p = await createProduct(tx, t);
        return { productId: p.productId, batchId: await openBatch(tx, t, p.productId, { qty: 30, ...opts }) };
      });
      const sale = await rejection(asTenant(db, t, (tx) => ledger(tx, t, { productId, batchId, eventType: "SALE", qty: -1 })));
      expect(rule(sale)).toBe("BATCH_BLOCKED");
      await asTenant(db, t, (tx) => ledger(tx, t, { productId, batchId, eventType: "WRITE_OFF_EXPIRED_DAMAGED", qty: -30 }));
    });
  }

  test("an unclassified or blocked product cannot be sold (US-CAT-4)", async () => {
    const t = await createTenant(db);
    const unclassified = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t, undefined, { classified: false });
      return { productId: p.productId, batchId: await openBatch(tx, t, p.productId, { qty: 10 }) };
    });
    const sale = await rejection(asTenant(db, t, (tx) => ledger(tx, t, { ...unclassified, eventType: "SALE", qty: -1 })));
    expect(rule(sale)).toBe("PRODUCT_NOT_SELLABLE");

    const blocked = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      const batchId = await openBatch(tx, t, p.productId, { qty: 10 });
      await tx`update app.products set blocked_for_sale = true where id = ${p.productId}`;
      return { productId: p.productId, batchId };
    });
    const blockedSale = await rejection(asTenant(db, t, (tx) => ledger(tx, t, { ...blocked, eventType: "SALE", qty: -1 })));
    expect(rule(blockedSale)).toBe("PRODUCT_NOT_SELLABLE");
  });

  test("a batch-tracked product needs a batch on every ledger row", async () => {
    const t = await createTenant(db);
    const error = await rejection(
      asTenant(db, t, async (tx) => {
        const p = await createProduct(tx, t);
        await ledger(tx, t, { productId: p.productId, batchId: null, eventType: "OPENING_BALANCE", qty: 5 });
      }),
    );
    expect(rule(error)).toBe("BATCH_REQUIRED");
  });
});
