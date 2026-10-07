import { afterAll, describe, expect, test } from "bun:test";
import { classifyDbError, correctBatch, listReconciliationIssues, resolveReconciliationIssue } from "../src";
import { asTenant, connect, createProduct, createTenant, openBatch, rejection } from "./support";

/** Nightly jobs (B4 expiry, ARCHITECTURE.md §6 reconciliation), rebuild (INV-2) and INV-8. */
const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("nightly jobs and recovery", () => {
  const db = sql!;

  test("expiry: past-dated AVAILABLE batches become EXPIRED, audited as a system action", async () => {
    const t = await createTenant(db);
    const ids = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      return {
        expired: await openBatch(tx, t, p.productId, { qty: 5, expiryDate: "2001-01-01" }),
        quarantined: await openBatch(tx, t, p.productId, { qty: 5, expiryDate: "2001-01-01", status: "QUARANTINE" }),
        fresh: await openBatch(tx, t, p.productId, { qty: 5, expiryDate: "2099-01-01" }),
      };
    });
    await db`select app.run_nightly()`;
    const statuses = await asTenant(db, t, (tx) => tx<{ id: string; status: string }[]>`select id, status::text from app.batches`);
    const byId = Object.fromEntries(statuses.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ [ids.expired]: "EXPIRED", [ids.quarantined]: "QUARANTINE", [ids.fresh]: "AVAILABLE" });
    const [audit] = await asTenant(db, t, (tx) => tx`
      select actor_staff_id, before, after, reason from app.audit_events where entity_id = ${ids.expired}`);
    expect(audit).toMatchObject({ actor_staff_id: null, before: { status: "AVAILABLE" }, after: { status: "EXPIRED" } });
  });

  test("reconciliation raises one issue per broken balance; rebuild repairs it", async () => {
    const t = await createTenant(db);
    await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      await openBatch(tx, t, p.productId, { qty: 12 });
    });
    // Simulate corruption the way only a bug or a manual edit could: as the table owner.
    await db`update app.inventory_balances set on_hand = on_hand - 2 where tenant_id = ${t.tenantId}`;
    await db`select app.run_nightly()`;
    await db`select app.run_nightly()`;
    const issues = await asTenant(db, t, (tx) => listReconciliationIssues(tx, { openOnly: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ledger: { onHand: "12" }, balance: { onHand: "10" } });

    await db`select app.rebuild_balances(${t.tenantId})`;
    expect((await db`select * from app.balance_mismatches() where tenant_id = ${t.tenantId}`).length).toBe(0);
    const resolved = await asTenant(db, t, (tx) => resolveReconciliationIssue(tx, issues[0]!.issueId, t.staffId, "Dibangun ulang dari buku besar"));
    expect(resolved).toBe(true);
    expect(await asTenant(db, t, (tx) => listReconciliationIssues(tx, { openOnly: true }))).toEqual([]);
  });

  test("request code cannot run the system jobs", async () => {
    const t = await createTenant(db);
    for (const call of ["select app.run_nightly()", `select app.rebuild_balances('${t.tenantId}')`, "select app.expire_batches()"]) {
      const error = await rejection(asTenant(db, t, (tx) => tx.unsafe(call)));
      expect(error.message).toMatch(/permission denied/);
    }
  });

  test("INV-8: a batch correction changes number and expiry, only within the tenant", async () => {
    const t = await createTenant(db);
    const other = await createTenant(db);
    const batchId = await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      return openBatch(tx, t, p.productId, { qty: 3, batchNumber: "LOT-TYPO", expiryDate: "2099-01-01" });
    });
    const change = await asTenant(db, t, (tx) => correctBatch(tx, batchId, { batchNumber: "LOT-FIXED", expiryDate: "2098-12-31" }));
    expect(change).toEqual({
      before: { batchNumber: "LOT-TYPO", expiryDate: "2099-01-01" },
      after: { batchNumber: "LOT-FIXED", expiryDate: "2098-12-31" },
    });
    expect(await asTenant(db, other, (tx) => correctBatch(tx, batchId, { batchNumber: "X", expiryDate: "2099-01-01" }))).toBeNull();
    // The bypass is local to the function: a plain update right after still fails.
    const plain = await rejection(db`update app.batches set batch_number = 'AGAIN' where id = ${batchId}`);
    expect(classifyDbError(plain)).toMatchObject({ rule: "BATCH_IDENTITY_IMMUTABLE" });
  });
});
