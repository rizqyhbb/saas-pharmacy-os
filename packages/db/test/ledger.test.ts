import { afterAll, describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  appendEvent,
  emptyLedger,
  formatQty,
  LEDGER_EVENT_EFFECTS,
  parseQty,
  stockKey,
  type LedgerEvent,
  type LedgerEventType,
  type LedgerState,
} from "@apotek/domain";
import { classifyDbError } from "../src";
import { asTenant, connect, createProduct, createTenant, ledger, openBatch, rejection } from "./support";

/**
 * G0-2 (T1, T2, T10): the database append path must behave exactly like the domain's
 * reference model (packages/domain appendEvent). Random sequences run against both;
 * every accept/reject decision and every final balance must match, and the stored
 * projection must equal the ledger sum.
 */
const sql = await connect();
afterAll(() => sql?.end());

const EVENT_TYPES: LedgerEventType[] = [
  "PURCHASE_RECEIPT",
  "SALE",
  "STOCK_ADJUSTMENT",
  "WRITE_OFF_EXPIRED_DAMAGED",
  "CUSTOMER_RETURN",
  "RESERVATION",
  "RESERVATION_RELEASE",
];

const SHAPE_CHECKS = ["CHECK:inventory_ledger_sign", "CHECK:inventory_ledger_conflict_only_on_sale"];

const qtyArb = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 30 }).map((n) => BigInt(n) * 10_000n) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 300_000 }).map((n) => BigInt(n)) },
);

/** Mostly well-signed events; flip 9 gives the wrong sign, conflict 0 sets the offline-conflict flag, replayPrevious 0 replays the last event. */
const stepArb = fc.record({
  eventType: fc.constantFrom(...EVENT_TYPES),
  batch: fc.constantFrom(0, 1),
  qty: qtyArb,
  flip: fc.integer({ min: 0, max: 9 }),
  conflict: fc.integer({ min: 0, max: 9 }),
  replayPrevious: fc.integer({ min: 0, max: 9 }),
});

describe.skipIf(!sql)("ledger append path matches the domain model", () => {
  const db = sql!;

  test("random sequences: same decisions, same balances, projection = ledger sum", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 5, maxLength: 25 }), async (steps) => {
        const t = await createTenant(db);
        const { productId, batchIds } = await asTenant(db, t, async (tx) => {
          const p = await createProduct(tx, t);
          const first = await openBatch(tx, t, p.productId, { qty: 20 });
          const second = await openBatch(tx, t, p.productId, { qty: 20 });
          return { productId: p.productId, batchIds: [first, second] };
        });

        const toEvent = (batchId: string, eventType: LedgerEventType, qty: bigint, conflict: boolean, key: string): LedgerEvent => ({
          idempotencyKey: key,
          eventType,
          locationId: t.locationId,
          productId,
          batchId,
          qtyDeltaBase: qty,
          reference: { type: "test", id: "test" },
          conflictNegative: conflict,
        });

        let model: LedgerState = emptyLedger();
        for (const batchId of batchIds) {
          const opened = appendEvent(model, toEvent(batchId, "OPENING_BALANCE", 200_000n, false, `open-${batchId}`));
          if (!opened.ok) throw new Error("opening balance rejected by the model");
          model = opened.value.state;
        }

        const history: LedgerEvent[] = [];
        for (const step of steps) {
          let event: LedgerEvent;
          const previous = history.at(-1);
          if (step.replayPrevious === 0 && previous) {
            event = previous; // exact replay of the last event (T10)
          } else {
            const { sign } = LEDGER_EVENT_EFFECTS[step.eventType];
            let qty = sign === "NEGATIVE" ? -step.qty : sign === "POSITIVE" ? step.qty : step.flip % 2 ? -step.qty : step.qty;
            if (step.flip === 9) qty = -qty; // occasionally the wrong sign
            const conflict = step.conflict === 0;
            event = toEvent(batchIds[step.batch]!, step.eventType, qty, conflict, crypto.randomUUID());
          }

          const expected = appendEvent(model, event);
          let dbOutcome: "accepted" | string;
          try {
            await asTenant(db, t, (tx) =>
              ledger(tx, t, {
                productId: event.productId,
                batchId: event.batchId,
                eventType: event.eventType,
                qty: formatQty(event.qtyDeltaBase),
                conflictNegative: event.conflictNegative ?? false,
                key: event.idempotencyKey,
              }),
            );
            dbOutcome = "accepted";
          } catch (error) {
            const failure = classifyDbError(error);
            if (!failure) throw error;
            dbOutcome = failure.kind === "RULE" ? failure.rule : `${failure.kind}:${"constraint" in failure ? failure.constraint : ""}`;
          }

          if (expected.ok && expected.value.replayed) {
            // The model treats an identical replay as a no-op; the table refuses the duplicate key.
            expect(dbOutcome).toBe("UNIQUE:inventory_ledger_tenant_id_idempotency_key_key");
          } else if (expected.ok) {
            expect(dbOutcome).toBe("accepted");
            model = expected.value.state;
            history.push(event);
          } else {
            const kind = expected.error.kind;
            if (kind === "WRONG_SIGN" || kind === "CONFLICT_FLAG_NOT_ALLOWED") {
              // Malformed event. When it breaks both shape rules, Postgres may report
              // either check first (constraints run in name order), so accept either.
              expect(SHAPE_CHECKS).toContain(dbOutcome);
            } else {
              expect(dbOutcome).toBe(kind);
            }
          }
        }

        const stored = await asTenant(db, t, (tx) =>
          tx<{ batch_id: string; on_hand: string; reserved: string }[]>`
            select batch_id, on_hand::text, reserved::text from app.inventory_balances where product_id = ${productId}`,
        );
        for (const row of stored) {
          const key = stockKey({ locationId: t.locationId, productId, batchId: row.batch_id });
          const fromModel = model.balances.get(key);
          expect({ onHand: parseQty(row.on_hand), reserved: parseQty(row.reserved) }).toEqual(fromModel!);
        }
        expect(stored.length).toBe(batchIds.length);

        const mismatches = await db`select * from app.balance_mismatches() where tenant_id = ${t.tenantId}`;
        expect(mismatches.length).toBe(0);
      }),
      { numRuns: 12 },
    );
  }, 60_000);
});

describe.skipIf(!sql)("ledger is append-only", () => {
  const db = sql!;

  test("ledger and audit rows cannot be updated or deleted, even by the table owner", async () => {
    const t = await createTenant(db);
    await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      await openBatch(tx, t, p.productId, { qty: 5 });
    });
    for (const statement of [
      db`update app.inventory_ledger set qty_delta_base = 999 where tenant_id = ${t.tenantId}`,
      db`delete from app.inventory_ledger where tenant_id = ${t.tenantId}`,
      db`update app.audit_events set action = 'x.y' where tenant_id = ${t.tenantId}`,
      db`delete from app.audit_events where tenant_id = ${t.tenantId}`,
    ]) {
      expect((await rejection(statement)).message).toMatch(/append-only/);
    }
  });

  test("reconciliation reports a balance that no longer matches its ledger", async () => {
    const t = await createTenant(db);
    await asTenant(db, t, async (tx) => {
      const p = await createProduct(tx, t);
      await openBatch(tx, t, p.productId, { qty: 5 });
    });
    // Tamper as the owner inside a transaction that is rolled back afterwards.
    const found = await rejection(
      db.begin(async (tx) => {
        await tx`update app.inventory_balances set on_hand = on_hand + 1 where tenant_id = ${t.tenantId}`;
        const rows = await tx`select * from app.balance_mismatches() where tenant_id = ${t.tenantId}`;
        throw new Error(`mismatches:${rows.length}`);
      }),
    );
    expect(found.message).toBe("mismatches:1");
  });
});
