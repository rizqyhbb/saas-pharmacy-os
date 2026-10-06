import { describe, expect, test } from "bun:test";
import { parseQty } from "@apotek/domain";
import {
  cartAllocations,
  currentStep,
  demoReducer,
  initialState,
  stepActions,
  stockCard,
  TOUR,
  type DemoAction,
  type DemoState,
} from "./engine";

const TODAY = "2026-10-06";
const q = parseQty;
const run = (state: DemoState, ...actions: DemoAction[]) => actions.reduce(demoReducer, state);

describe("demo counter", () => {
  test("2 strip paracetamol skips the expired batch and spills across two batches (FEFO)", () => {
    const state = run(initialState(TODAY), { type: "SET_QTY", productId: "pct", unitId: "pct-strip", qty: q("2") });
    const [allocation] = cartAllocations(state);
    expect(allocation?.requested).toBe(q("20"));
    expect(allocation?.result).toEqual({
      ok: true,
      value: [
        { batchId: "pct-b", qty: q("14") },
        { batchId: "pct-c", qty: q("6") },
      ],
    });
  });

  test("checkout writes one SALE event per batch and updates the stock card", () => {
    const state = run(
      initialState(TODAY),
      { type: "SET_QTY", productId: "pct", unitId: "pct-strip", qty: q("2") },
      { type: "CHECKOUT" },
    );
    const sales = state.log.filter((e) => e.eventType === "SALE");
    expect(sales.map((e) => [e.batchId, e.qtyDeltaBase])).toEqual([
      ["pct-b", q("-14")],
      ["pct-c", q("-6")],
    ]);
    expect(state.notice).toEqual({ kind: "SOLD", saleNo: "TRX-0001", total: 9_000 });
    const card = stockCard(state, "pct");
    expect(card.map((row) => [row.batch.id, row.onHand, row.band, row.nextToSell])).toEqual([
      ["pct-a", q("30"), "EXPIRED", false],
      ["pct-b", 0n, "NEAR", false],
      ["pct-c", q("194"), "OK", true],
    ]);
  });

  test("a prescription-only product never reaches the cart", () => {
    const state = run(initialState(TODAY), { type: "ADD", productId: "amx", unitId: "amx-strip" });
    expect(state.cart).toEqual([]);
    expect(state.notice).toEqual({ kind: "RX_BLOCKED", productId: "amx" });
  });

  test("cannot add more than the sellable stock; the expired batch does not count", () => {
    const state = run(initialState(TODAY), { type: "SET_QTY", productId: "pct", unitId: "pct-tab", qty: q("215") });
    expect(state.cart).toEqual([]);
    expect(state.notice).toEqual({ kind: "INSUFFICIENT", productId: "pct", shortfall: q("1") });
  });

  test("offline sale queues, reconnect syncs once even when re-sent", () => {
    const offline = run(
      initialState(TODAY),
      { type: "SET_ONLINE", online: false },
      { type: "ADD", productId: "vitc", unitId: "vitc-strip" },
      { type: "CHECKOUT" },
    );
    expect(offline.outbox).toHaveLength(1);
    expect(offline.log.some((e) => e.eventType === "SALE")).toBe(false);
    expect(stockCard(offline, "vitc")[0]?.onHand).toBe(q("30"));

    const synced = run(offline, { type: "SET_ONLINE", online: true });
    expect(synced.outbox).toEqual([]);
    expect(synced.log.filter((e) => e.eventType === "SALE")).toHaveLength(1);
    expect(synced.syncLog).toEqual([
      { saleNo: "TRX-0001", attempt: 1, outcome: "ACCEPTED" },
      { saleNo: "TRX-0001", attempt: 2, outcome: "DUPLICATE_IGNORED" },
    ]);
    expect(stockCard(synced, "vitc")[0]?.onHand).toBe(q("30"));
  });
});

describe("guided tour", () => {
  test("'do it for me' on every step completes the tour", () => {
    let state = initialState(TODAY);
    for (let i = 0; i < TOUR.length; i++) {
      expect(currentStep(state)).toBe(i);
      state = run(state, ...stepActions(state, TOUR[i]!));
    }
    expect(currentStep(state)).toBe(TOUR.length);
  });

  test("steps done out of order still count", () => {
    const state = run(initialState(TODAY), { type: "ADD", productId: "amx", unitId: "amx-strip" });
    expect(state.milestones).toContain("RX_BLOCKED");
    expect(currentStep(state)).toBe(0);
  });
});
