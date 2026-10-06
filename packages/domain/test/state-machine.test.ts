import { describe, expect, test } from "bun:test";
import {
  canTransition,
  goodsReceiptMachine,
  isTerminal,
  purchaseOrderMachine,
  shiftMachine,
  statesOf,
  transition,
  type StateMachine,
} from "../src";

const machines: StateMachine<string>[] = [purchaseOrderMachine, goodsReceiptMachine, shiftMachine];

describe.each(machines.map((m) => [m.name, m] as const))("%s machine", (_, machine) => {
  test("every target is a declared state and the initial state exists", () => {
    const states = new Set(statesOf(machine));
    expect(states.has(machine.initial)).toBe(true);
    for (const targets of Object.values(machine.transitions)) {
      for (const target of targets) expect(states.has(target)).toBe(true);
    }
  });

  test("every state is reachable from the initial state", () => {
    const reached = new Set([machine.initial]);
    const queue = [machine.initial];
    while (queue.length > 0) {
      for (const next of machine.transitions[queue.shift()!] ?? []) {
        if (!reached.has(next)) reached.add(next), queue.push(next);
      }
    }
    expect([...reached].sort()).toEqual(statesOf(machine).sort());
  });

  test("terminal states have no way out", () => {
    for (const state of statesOf(machine).filter((s) => isTerminal(machine, s))) {
      for (const target of statesOf(machine)) expect(canTransition(machine, state, target)).toBe(false);
    }
  });
});

describe("purchase order", () => {
  test("happy path", () => {
    const path = ["DRAFT", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] as const;
    for (let i = 1; i < path.length; i++) {
      expect(transition(purchaseOrderMachine, path[i - 1]!, path[i]!).ok).toBe(true);
    }
  });

  test("cannot skip approval or cancel after goods arrived", () => {
    expect(transition(purchaseOrderMachine, "DRAFT", "SENT")).toEqual({
      ok: false,
      error: {
        kind: "ILLEGAL_TRANSITION",
        machine: "purchase_order",
        from: "DRAFT",
        to: "SENT",
        allowed: ["APPROVED", "CANCELLED"],
      },
    });
    expect(canTransition(purchaseOrderMachine, "PARTIALLY_RECEIVED", "CANCELLED")).toBe(false);
  });
});

describe("shift", () => {
  test("a closed shift cannot reopen", () => {
    expect(canTransition(shiftMachine, "CLOSED", "OPEN")).toBe(false);
  });
});
