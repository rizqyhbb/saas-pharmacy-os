import { formatQty, type Qty } from "./quantity";
import { err, ok, type Result } from "./result";

export const LEDGER_EVENT_TYPES = [
  "OPENING_BALANCE",
  "PURCHASE_RECEIPT",
  "SALE",
  "RX_DISPENSE",
  "COMPOUND_CONSUMPTION",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "CUSTOMER_RETURN",
  "SUPPLIER_RETURN",
  "STOCK_ADJUSTMENT",
  "WRITE_OFF_EXPIRED_DAMAGED",
  "DESTRUCTION",
  "RECALL_QUARANTINE",
  "RESERVATION",
  "RESERVATION_RELEASE",
  "REPACK_CONVERSION",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

type Effect = { field: "onHand" | "reserved"; sign: "POSITIVE" | "NEGATIVE" | "EITHER" };

/**
 * Which balance column each event moves and in which direction. Reservations
 * move `reserved`, never `on_hand` (L4). Corrections, including a void's
 * reversal (S3), are STOCK_ADJUSTMENT rows of either sign.
 */
export const LEDGER_EVENT_EFFECTS: Readonly<Record<LedgerEventType, Effect>> = {
  OPENING_BALANCE: { field: "onHand", sign: "POSITIVE" },
  PURCHASE_RECEIPT: { field: "onHand", sign: "POSITIVE" },
  TRANSFER_IN: { field: "onHand", sign: "POSITIVE" },
  CUSTOMER_RETURN: { field: "onHand", sign: "POSITIVE" },
  SALE: { field: "onHand", sign: "NEGATIVE" },
  RX_DISPENSE: { field: "onHand", sign: "NEGATIVE" },
  COMPOUND_CONSUMPTION: { field: "onHand", sign: "NEGATIVE" },
  TRANSFER_OUT: { field: "onHand", sign: "NEGATIVE" },
  SUPPLIER_RETURN: { field: "onHand", sign: "NEGATIVE" },
  WRITE_OFF_EXPIRED_DAMAGED: { field: "onHand", sign: "NEGATIVE" },
  DESTRUCTION: { field: "onHand", sign: "NEGATIVE" },
  STOCK_ADJUSTMENT: { field: "onHand", sign: "EITHER" },
  RECALL_QUARANTINE: { field: "onHand", sign: "EITHER" },
  REPACK_CONVERSION: { field: "onHand", sign: "EITHER" },
  RESERVATION: { field: "reserved", sign: "POSITIVE" },
  RESERVATION_RELEASE: { field: "reserved", sign: "NEGATIVE" },
};

/**
 * The domain view of one `inventory_ledger` row. `batchId` is null only for
 * products that don't track batches.
 */
export interface LedgerEvent {
  idempotencyKey: string;
  eventType: LedgerEventType;
  locationId: string;
  productId: string;
  batchId: string | null;
  qtyDeltaBase: Qty;
  /** L5: the business document that caused this movement. */
  reference: { type: string; id: string };
  /**
   * Offline sale whose stock was gone by the time it synced (ARCHITECTURE.md
   * §9). The sale is accepted with a visible negative balance instead of being
   * dropped, and must raise a Critical Action Center item.
   */
  conflictNegative?: boolean;
}

export interface Balance {
  onHand: Qty;
  reserved: Qty;
}

export const ZERO_BALANCE: Balance = Object.freeze({ onHand: 0n, reserved: 0n });

export const availableQty = (balance: Balance): Qty => balance.onHand - balance.reserved;

export type StockKey = string;

/** L2 granularity: one balance per (location, product, batch). */
export function stockKey(event: Pick<LedgerEvent, "locationId" | "productId" | "batchId">): StockKey {
  return `${event.locationId}|${event.productId}|${event.batchId ?? "-"}`;
}

export type LedgerError =
  | { kind: "ZERO_QTY" }
  | { kind: "WRONG_SIGN"; eventType: LedgerEventType; expected: "POSITIVE" | "NEGATIVE" }
  | { kind: "MISSING_REFERENCE" }
  | { kind: "MISSING_IDEMPOTENCY_KEY" }
  | { kind: "CONFLICT_FLAG_NOT_ALLOWED"; eventType: LedgerEventType }
  | { kind: "INSUFFICIENT_AVAILABLE"; key: StockKey; available: Qty; requested: Qty }
  | { kind: "RELEASE_EXCEEDS_RESERVED"; key: StockKey; reserved: Qty; requested: Qty }
  | { kind: "IDEMPOTENCY_KEY_REUSED"; idempotencyKey: string };

/** Shape rules that don't depend on current stock. */
export function validateLedgerEvent(event: LedgerEvent): LedgerError | null {
  if (!event.idempotencyKey.trim()) return { kind: "MISSING_IDEMPOTENCY_KEY" };
  if (!event.reference.type.trim() || !event.reference.id.trim()) return { kind: "MISSING_REFERENCE" };
  if (event.qtyDeltaBase === 0n) return { kind: "ZERO_QTY" };
  const { sign } = LEDGER_EVENT_EFFECTS[event.eventType];
  if (sign === "POSITIVE" && event.qtyDeltaBase < 0n) {
    return { kind: "WRONG_SIGN", eventType: event.eventType, expected: "POSITIVE" };
  }
  if (sign === "NEGATIVE" && event.qtyDeltaBase > 0n) {
    return { kind: "WRONG_SIGN", eventType: event.eventType, expected: "NEGATIVE" };
  }
  if (event.conflictNegative && event.eventType !== "SALE") {
    return { kind: "CONFLICT_FLAG_NOT_ALLOWED", eventType: event.eventType };
  }
  return null;
}

/**
 * Applies one event to its balance, enforcing L3/L4: available stock
 * (`on_hand − reserved`) may not go below zero, and a release may not exceed
 * what is reserved. Only a flagged offline-conflict sale may go negative (T2).
 */
export function applyToBalance(balance: Balance, event: LedgerEvent): Result<Balance, LedgerError> {
  const invalid = validateLedgerEvent(event);
  if (invalid) return err(invalid);

  const delta = event.qtyDeltaBase;
  const key = stockKey(event);
  if (LEDGER_EVENT_EFFECTS[event.eventType].field === "reserved") {
    const reserved = balance.reserved + delta;
    if (reserved < 0n) {
      return err({ kind: "RELEASE_EXCEEDS_RESERVED", key, reserved: balance.reserved, requested: -delta });
    }
    if (reserved > balance.onHand) {
      return err({ kind: "INSUFFICIENT_AVAILABLE", key, available: availableQty(balance), requested: delta });
    }
    return ok({ onHand: balance.onHand, reserved });
  }

  const next = { onHand: balance.onHand + delta, reserved: balance.reserved };
  if (delta < 0n && availableQty(next) < 0n && !event.conflictNegative) {
    return err({ kind: "INSUFFICIENT_AVAILABLE", key, available: availableQty(balance), requested: -delta });
  }
  return ok(next);
}

/**
 * Rebuild-from-ledger (ARCHITECTURE.md §6): folds already-accepted events into
 * balances without re-validating them. The nightly reconciliation compares this
 * against the stored `inventory_balance` projection.
 */
export function projectBalances(events: Iterable<LedgerEvent>): Map<StockKey, Balance> {
  const balances = new Map<StockKey, Balance>();
  for (const event of events) {
    const key = stockKey(event);
    const current = balances.get(key) ?? ZERO_BALANCE;
    const field = LEDGER_EVENT_EFFECTS[event.eventType].field;
    balances.set(key, { ...current, [field]: current[field] + event.qtyDeltaBase });
  }
  return balances;
}

export interface BalanceMismatch {
  key: StockKey;
  fromLedger: Balance;
  stored: Balance;
}

/** T1: every stored balance must equal the sum of its ledger events. */
export function reconcileBalances(
  events: Iterable<LedgerEvent>,
  stored: ReadonlyMap<StockKey, Balance>,
): BalanceMismatch[] {
  const fromLedger = projectBalances(events);
  const keys = new Set([...fromLedger.keys(), ...stored.keys()]);
  const mismatches: BalanceMismatch[] = [];
  for (const key of keys) {
    const expected = fromLedger.get(key) ?? ZERO_BALANCE;
    const actual = stored.get(key) ?? ZERO_BALANCE;
    if (expected.onHand !== actual.onHand || expected.reserved !== actual.reserved) {
      mismatches.push({ key, fromLedger: expected, stored: actual });
    }
  }
  return mismatches;
}

/**
 * Reference model of the append path: validation, balance rules and
 * idempotency together. The Postgres implementation must behave identically;
 * its tests should replay the same sequences against both.
 */
export interface LedgerState {
  readonly balances: ReadonlyMap<StockKey, Balance>;
  /** idempotency key → fingerprint of the event first accepted under it. */
  readonly accepted: ReadonlyMap<string, string>;
}

export const emptyLedger = (): LedgerState => ({ balances: new Map(), accepted: new Map() });

export type AppendOutcome = {
  state: LedgerState;
  /** True when this key was already applied; the state is unchanged (T10). */
  replayed: boolean;
  /** True when the balance went below zero under the offline-conflict flag. */
  negative: boolean;
};

function fingerprint(event: LedgerEvent): string {
  return JSON.stringify([
    event.eventType,
    event.locationId,
    event.productId,
    event.batchId,
    formatQty(event.qtyDeltaBase),
    event.reference.type,
    event.reference.id,
    event.conflictNegative ?? false,
  ]);
}

export function appendEvent(state: LedgerState, event: LedgerEvent): Result<AppendOutcome, LedgerError> {
  const previous = state.accepted.get(event.idempotencyKey);
  if (previous !== undefined) {
    return previous === fingerprint(event)
      ? ok({ state, replayed: true, negative: false })
      : err({ kind: "IDEMPOTENCY_KEY_REUSED", idempotencyKey: event.idempotencyKey });
  }

  const key = stockKey(event);
  const applied = applyToBalance(state.balances.get(key) ?? ZERO_BALANCE, event);
  if (!applied.ok) return applied;

  const balances = new Map(state.balances).set(key, applied.value);
  const accepted = new Map(state.accepted).set(event.idempotencyKey, fingerprint(event));
  return ok({ state: { balances, accepted }, replayed: false, negative: availableQty(applied.value) < 0n });
}
