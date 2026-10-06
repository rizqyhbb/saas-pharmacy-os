import { err, ok, type Result } from "./result";

/**
 * Status columns move only through an allowed-transition table (ARCHITECTURE.md
 * §8). The API requests a transition; it never sets a status directly.
 */
export interface StateMachine<S extends string> {
  readonly name: string;
  readonly initial: S;
  readonly transitions: Readonly<Record<S, readonly S[]>>;
}

export type IllegalTransition<S extends string = string> = {
  kind: "ILLEGAL_TRANSITION";
  machine: string;
  from: S;
  to: S;
  allowed: readonly S[];
};

export function defineStateMachine<const S extends string>(
  name: string,
  initial: NoInfer<S>,
  transitions: Record<S, readonly NoInfer<S>[]>,
): StateMachine<S> {
  return Object.freeze({ name, initial, transitions: Object.freeze(transitions) });
}

export const statesOf = <S extends string>(machine: StateMachine<S>): S[] =>
  Object.keys(machine.transitions) as S[];

export const canTransition = <S extends string>(machine: StateMachine<S>, from: S, to: S): boolean =>
  machine.transitions[from].includes(to);

export const isTerminal = <S extends string>(machine: StateMachine<S>, state: S): boolean =>
  machine.transitions[state].length === 0;

export function transition<S extends string>(
  machine: StateMachine<S>,
  from: S,
  to: S,
): Result<S, IllegalTransition<S>> {
  return canTransition(machine, from, to)
    ? ok(to)
    : err({ kind: "ILLEGAL_TRANSITION", machine: machine.name, from, to, allowed: machine.transitions[from] });
}

/**
 * DOMAIN-MODEL.md §6. Cancel is allowed until goods arrive; once anything is
 * received the PO is closed short instead, so received stock stays traceable.
 */
export const purchaseOrderMachine = defineStateMachine("purchase_order", "DRAFT", {
  DRAFT: ["APPROVED", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CLOSED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
});
export type PurchaseOrderStatus = keyof typeof purchaseOrderMachine.transitions;

export const goodsReceiptMachine = defineStateMachine("goods_receipt", "DRAFT", {
  DRAFT: ["POSTED", "REJECTED"],
  POSTED: [],
  REJECTED: [],
});
export type GoodsReceiptStatus = keyof typeof goodsReceiptMachine.transitions;

export const shiftMachine = defineStateMachine("shift", "OPEN", {
  OPEN: ["CLOSING"],
  CLOSING: ["CLOSED"],
  CLOSED: [],
});
export type ShiftStatus = keyof typeof shiftMachine.transitions;
