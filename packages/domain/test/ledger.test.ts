import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  appendEvent,
  availableQty,
  emptyLedger,
  LEDGER_EVENT_TYPES,
  parseQty,
  projectBalances,
  reconcileBalances,
  stockKey,
  type LedgerEvent,
  type LedgerState,
} from "../src";

const q = parseQty;
let seq = 0;

function event(eventType: LedgerEvent["eventType"], qty: string, extra: Partial<LedgerEvent> = {}): LedgerEvent {
  seq += 1;
  return {
    idempotencyKey: `key-${seq}`,
    eventType,
    locationId: "loc-1",
    productId: "paracetamol",
    batchId: "B1",
    qtyDeltaBase: q(qty),
    reference: { type: "test", id: `doc-${seq}` },
    ...extra,
  };
}

function run(events: LedgerEvent[], state: LedgerState = emptyLedger()): LedgerState {
  for (const e of events) {
    const result = appendEvent(state, e);
    if (!result.ok) throw new Error(`unexpected rejection: ${result.error.kind}`);
    state = result.value.state;
  }
  return state;
}

const KEY = stockKey({ locationId: "loc-1", productId: "paracetamol", batchId: "B1" });

describe("event shape", () => {
  test.each([
    ["PURCHASE_RECEIPT", "-1", "WRONG_SIGN"],
    ["SALE", "1", "WRONG_SIGN"],
    ["RESERVATION", "-1", "WRONG_SIGN"],
    ["STOCK_ADJUSTMENT", "0", "ZERO_QTY"],
  ] as const)("%s with %s is rejected (%s)", (type, qty, kind) => {
    const result = appendEvent(emptyLedger(), event(type, qty));
    expect(!result.ok && result.error.kind).toBe(kind);
  });

  test("L5: every event needs a reference", () => {
    const result = appendEvent(emptyLedger(), event("OPENING_BALANCE", "1", { reference: { type: "", id: "" } }));
    expect(!result.ok && result.error.kind).toBe("MISSING_REFERENCE");
  });

  test("only a sale may carry the offline-conflict flag", () => {
    const state = run([event("OPENING_BALANCE", "1")]);
    const result = appendEvent(state, event("RX_DISPENSE", "-5", { conflictNegative: true }));
    expect(!result.ok && result.error.kind).toBe("CONFLICT_FLAG_NOT_ALLOWED");
  });
});

describe("balances", () => {
  test("receive, sell, adjust", () => {
    const state = run([event("PURCHASE_RECEIPT", "500"), event("SALE", "-20"), event("STOCK_ADJUSTMENT", "-1")]);
    expect(state.balances.get(KEY)).toEqual({ onHand: q("479"), reserved: 0n });
  });

  test("L3: a sale may not take more than is available", () => {
    const state = run([event("PURCHASE_RECEIPT", "5")]);
    const result = appendEvent(state, event("SALE", "-6"));
    expect(result).toEqual({
      ok: false,
      error: { kind: "INSUFFICIENT_AVAILABLE", key: KEY, available: q("5"), requested: q("6") },
    });
  });

  test("L4: reservations move reserved, not on-hand, and protect stock from the counter", () => {
    const state = run([event("PURCHASE_RECEIPT", "10"), event("RESERVATION", "8")]);
    expect(state.balances.get(KEY)).toEqual({ onHand: q("10"), reserved: q("8") });
    expect(appendEvent(state, event("SALE", "-3")).ok).toBe(false);
    expect(appendEvent(state, event("SALE", "-2")).ok).toBe(true);
  });

  test("cannot reserve beyond available or release beyond reserved", () => {
    const state = run([event("PURCHASE_RECEIPT", "10"), event("RESERVATION", "4")]);
    expect(appendEvent(state, event("RESERVATION", "7")).ok).toBe(false);
    const release = appendEvent(state, event("RESERVATION_RELEASE", "-5"));
    expect(!release.ok && release.error.kind).toBe("RELEASE_EXCEEDS_RESERVED");
  });

  test("offline-conflict sale is accepted with a visible negative, never dropped", () => {
    const state = run([event("PURCHASE_RECEIPT", "1"), event("SALE", "-1")]);
    const result = appendEvent(state, event("SALE", "-1", { conflictNegative: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.negative).toBe(true);
    expect(result.value.state.balances.get(KEY)).toEqual({ onHand: q("-1"), reserved: 0n });
  });
});

describe("idempotency (T10)", () => {
  test("replaying the same event is a no-op", () => {
    const sale = event("SALE", "-2");
    const state = run([event("PURCHASE_RECEIPT", "10"), sale]);
    const replay = appendEvent(state, sale);
    expect(replay.ok && replay.value.replayed).toBe(true);
    expect(replay.ok && replay.value.state).toBe(state);
  });

  test("reusing a key for a different event is rejected", () => {
    const sale = event("SALE", "-2");
    const state = run([event("PURCHASE_RECEIPT", "10"), sale]);
    const result = appendEvent(state, { ...sale, qtyDeltaBase: q("-3") });
    expect(!result.ok && result.error.kind).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("reconciliation (T1)", () => {
  test("flags a stored balance that drifted from the ledger", () => {
    const events = [event("PURCHASE_RECEIPT", "10"), event("SALE", "-3")];
    const stored = new Map([[KEY, { onHand: q("8"), reserved: 0n }]]);
    expect(reconcileBalances(events, stored)).toEqual([
      { key: KEY, fromLedger: { onHand: q("7"), reserved: 0n }, stored: { onHand: q("8"), reserved: 0n } },
    ]);
  });

  test("flags a stored balance with no ledger events at all", () => {
    const stored = new Map([[KEY, { onHand: q("1"), reserved: 0n }]]);
    expect(reconcileBalances([], stored)).toHaveLength(1);
  });
});

describe("ledger properties (G0 gate)", () => {
  const eventArb = fc.record({
    idempotencyKey: fc.integer({ min: 0, max: 40 }).map((n) => `k${n}`),
    eventType: fc.constantFrom(...LEDGER_EVENT_TYPES),
    locationId: fc.constantFrom("front", "back"),
    productId: fc.constantFrom("p1", "p2"),
    batchId: fc.constantFrom("b1", "b2", null),
    qtyDeltaBase: fc.bigInt({ min: -200_000n, max: 200_000n }),
    reference: fc.constant({ type: "test", id: "doc" }),
    conflictNegative: fc.oneof({ arbitrary: fc.constant(false), weight: 9 }, { arbitrary: fc.constant(true), weight: 1 }),
  });

  test("Σ accepted events = balance, available ≥ 0 unless conflict-flagged, replay is a no-op", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 80 }), (events) => {
        let state = emptyLedger();
        const accepted: LedgerEvent[] = [];
        const conflictKeys = new Set<string>();
        for (const e of events) {
          const result = appendEvent(state, e);
          if (!result.ok) continue;
          if (!result.value.replayed) {
            accepted.push(e);
            if (e.conflictNegative) conflictKeys.add(stockKey(e));
          }
          state = result.value.state;
        }

        // T1: the balance is exactly the fold of accepted events
        expect(reconcileBalances(accepted, state.balances)).toEqual([]);

        // T2: no negative availability, except where an offline conflict sale landed
        for (const [key, balance] of state.balances) {
          expect(balance.reserved).toBeGreaterThanOrEqual(0n);
          if (!conflictKeys.has(key)) expect(availableQty(balance)).toBeGreaterThanOrEqual(0n);
        }

        // T10: replaying every accepted event changes nothing
        let replayed = state;
        for (const e of accepted) {
          const result = appendEvent(replayed, e);
          expect(result.ok && result.value.replayed).toBe(true);
          if (result.ok) replayed = result.value.state;
        }
        expect(projectBalances(accepted)).toEqual(new Map(state.balances));
        expect(replayed).toBe(state);
      }),
      { numRuns: 500 },
    );
  });
});
