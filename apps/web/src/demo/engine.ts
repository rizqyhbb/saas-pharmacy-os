import {
  allocateFefo,
  appendEvent,
  availableQty,
  emptyLedger,
  QTY_SCALE,
  saleBlockReason,
  stockKey,
  sumQty,
  toBase,
  ZERO_BALANCE,
  type Allocation,
  type AllocationCandidate,
  type CalendarDate,
  type InsufficientStock,
  type LedgerEvent,
  type LedgerState,
  type Qty,
  type Result,
} from "@apotek/domain";
import { addDays, daysBetween } from "./dates";
import { BATCHES, LOCATION_ID, NEAR_EXPIRY_DAYS, PRODUCTS, productById, unitById, type DemoBatch } from "./seed";

/**
 * The demo counter. Every stock decision goes through the real domain package:
 * unit conversion, FEFO allocation and the ledger append rules. The "server" is
 * an in-memory ledger; offline sales wait in an outbox until reconnect.
 */

export type Milestone = "ADDED_PCT_STRIPS" | "SEEN_FEFO" | "SOLD_PCT" | "RX_BLOCKED" | "QUEUED_OFFLINE" | "SYNCED";

export type Notice =
  | { kind: "RX_BLOCKED"; productId: string }
  | { kind: "INSUFFICIENT"; productId: string; shortfall: Qty }
  | { kind: "SOLD"; saleNo: string; total: number }
  | { kind: "QUEUED"; saleNo: string; total: number }
  | { kind: "SYNCED"; sales: number };

export interface CartLine {
  productId: string;
  unitId: string;
  qty: Qty;
}

export interface PendingSale {
  saleNo: string;
  events: LedgerEvent[];
  total: number;
}

export interface SyncEntry {
  saleNo: string;
  attempt: number;
  outcome: "ACCEPTED" | "DUPLICATE_IGNORED" | "CONFLICT";
}

export interface DemoState {
  today: CalendarDate;
  server: LedgerState;
  /** Events the server accepted, oldest first. */
  log: LedgerEvent[];
  outbox: PendingSale[];
  online: boolean;
  cart: CartLine[];
  saleSeq: number;
  notice: Notice | null;
  syncLog: SyncEntry[];
  milestones: Milestone[];
}

export type DemoAction =
  | { type: "ADD"; productId: string; unitId: string; qty?: Qty }
  | { type: "SET_QTY"; productId: string; unitId: string; qty: Qty }
  | { type: "CHECKOUT" }
  | { type: "SET_ONLINE"; online: boolean }
  | { type: "ACK"; milestone: Milestone }
  | { type: "DISMISS_NOTICE" }
  | { type: "RESET"; today: CalendarDate };

const ONE: Qty = QTY_SCALE;

export function batchExpiry(batch: DemoBatch, today: CalendarDate): CalendarDate {
  return addDays(today, batch.expiryOffsetDays);
}

export function initialState(today: CalendarDate): DemoState {
  let server = emptyLedger();
  const log: LedgerEvent[] = [];
  for (const batch of BATCHES) {
    const event: LedgerEvent = {
      idempotencyKey: `OB/${batch.id}`,
      eventType: "OPENING_BALANCE",
      locationId: LOCATION_ID,
      productId: batch.productId,
      batchId: batch.id,
      qtyDeltaBase: batch.openingQty,
      reference: { type: "opening", id: "SA-0001" },
    };
    const result = appendEvent(server, event);
    if (!result.ok) throw new Error(`Seed rejected: ${result.error.kind}`);
    server = result.value.state;
    log.push(event);
  }
  return {
    today,
    server,
    log,
    outbox: [],
    online: true,
    cart: [],
    saleSeq: 0,
    notice: null,
    syncLog: [],
    milestones: [],
  };
}

/** What the counter sees: the server ledger plus sales still waiting to sync. */
export function localLedger(state: DemoState): LedgerState {
  let ledger = state.server;
  for (const sale of state.outbox) {
    for (const event of sale.events) {
      const result = appendEvent(ledger, { ...event, conflictNegative: true });
      if (result.ok) ledger = result.value.state;
    }
  }
  return ledger;
}

const balanceOf = (ledger: LedgerState, batch: DemoBatch) =>
  ledger.balances.get(stockKey({ locationId: LOCATION_ID, productId: batch.productId, batchId: batch.id })) ??
  ZERO_BALANCE;

function candidatesFor(state: DemoState, ledger: LedgerState, productId: string): AllocationCandidate[] {
  return BATCHES.filter((batch) => batch.productId === productId).map((batch) => ({
    batchId: batch.id,
    expiryDate: batchExpiry(batch, state.today),
    receivedAt: new Date(`${addDays(state.today, batch.receivedOffsetDays)}T08:00:00Z`),
    status: batch.status,
    available: availableQty(balanceOf(ledger, batch)),
  }));
}

function lineBase(line: CartLine): Qty {
  const result = toBase(line.qty, unitById(productById(line.productId), line.unitId));
  if (!result.ok) throw new Error("Demo units are whole numbers; conversion is always exact");
  return result.value;
}

function baseByProduct(cart: readonly CartLine[]): Map<string, Qty> {
  const totals = new Map<string, Qty>();
  for (const line of cart) totals.set(line.productId, (totals.get(line.productId) ?? 0n) + lineBase(line));
  return totals;
}

export type CartAllocation = { productId: string; requested: Qty; result: Result<Allocation[], InsufficientStock> };

/** FEFO preview for every product in the cart, against the counter's local view. */
export function cartAllocations(state: DemoState, cart: readonly CartLine[] = state.cart): CartAllocation[] {
  const ledger = localLedger(state);
  return [...baseByProduct(cart)].map(([productId, requested]) => ({
    productId,
    requested,
    result: allocateFefo(requested, candidatesFor(state, ledger, productId), state.today),
  }));
}

export const linePrice = (line: CartLine): number =>
  Number((BigInt(unitById(productById(line.productId), line.unitId).price) * line.qty) / QTY_SCALE);

export const cartTotal = (cart: readonly CartLine[]): number => cart.reduce((sum, line) => sum + linePrice(line), 0);

export interface StockCardRow {
  batch: DemoBatch;
  expiryDate: CalendarDate;
  daysToExpiry: number;
  onHand: Qty;
  band: "EXPIRED" | "NEAR" | "OK";
  blocked: boolean;
  nextToSell: boolean;
}

export function stockCard(state: DemoState, productId: string): StockCardRow[] {
  const ledger = localLedger(state);
  const rows = BATCHES.filter((batch) => batch.productId === productId)
    .map((batch): StockCardRow => {
      const expiryDate = batchExpiry(batch, state.today);
      const daysToExpiry = daysBetween(state.today, expiryDate);
      const blocked = saleBlockReason({ status: batch.status, expiryDate }, state.today) !== null;
      return {
        batch,
        expiryDate,
        daysToExpiry,
        onHand: balanceOf(ledger, batch).onHand,
        band: blocked ? "EXPIRED" : daysToExpiry <= NEAR_EXPIRY_DAYS ? "NEAR" : "OK",
        blocked,
        nextToSell: false,
      };
    })
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const next = rows.find((row) => !row.blocked && row.onHand > 0n);
  if (next) next.nextToSell = true;
  return rows;
}

export const sellableTotal = (rows: readonly StockCardRow[]): Qty =>
  sumQty(rows.filter((row) => !row.blocked).map((row) => row.onHand));

const withMilestone = (milestones: Milestone[], milestone: Milestone | false): Milestone[] =>
  milestone && !milestones.includes(milestone) ? [...milestones, milestone] : milestones;

function setLine(state: DemoState, productId: string, unitId: string, qty: Qty): DemoState {
  const product = productById(productId);
  if (product.salesClass === "RX_REQUIRED") {
    return {
      ...state,
      notice: { kind: "RX_BLOCKED", productId },
      milestones: withMilestone(state.milestones, "RX_BLOCKED"),
    };
  }

  const others = state.cart.filter((line) => !(line.productId === productId && line.unitId === unitId));
  const existingIndex = state.cart.findIndex((line) => line.productId === productId && line.unitId === unitId);
  const cart =
    qty <= 0n
      ? others
      : existingIndex >= 0
        ? state.cart.map((line, i) => (i === existingIndex ? { ...line, qty } : line))
        : [...state.cart, { productId, unitId, qty }];

  const shortage = cartAllocations(state, cart).find((allocation) => !allocation.result.ok);
  if (shortage && !shortage.result.ok) {
    return { ...state, notice: { kind: "INSUFFICIENT", productId, shortfall: shortage.result.error.shortfall } };
  }

  const pctStrips = cart.find((line) => line.unitId === "pct-strip");
  return {
    ...state,
    cart,
    notice: null,
    milestones: withMilestone(state.milestones, pctStrips !== undefined && pctStrips.qty >= 2n * ONE && "ADDED_PCT_STRIPS"),
  };
}

/** Applies all events or none, like the sale transaction on the server. */
function applyAll(ledger: LedgerState, events: readonly LedgerEvent[]): LedgerState | null {
  let next = ledger;
  for (const event of events) {
    const result = appendEvent(next, event);
    if (!result.ok) return null;
    next = result.value.state;
  }
  return next;
}

function checkout(state: DemoState): DemoState {
  if (state.cart.length === 0) return state;
  const allocations = cartAllocations(state);
  const shortage = allocations.find((allocation) => !allocation.result.ok);
  if (shortage && !shortage.result.ok) {
    return { ...state, notice: { kind: "INSUFFICIENT", productId: shortage.productId, shortfall: shortage.result.error.shortfall } };
  }

  const saleSeq = state.saleSeq + 1;
  const saleNo = `TRX-${String(saleSeq).padStart(4, "0")}`;
  const events: LedgerEvent[] = allocations.flatMap(({ productId, result }) =>
    result.ok
      ? result.value.map((allocation) => ({
          idempotencyKey: `${saleNo}/${productId}/${allocation.batchId}`,
          eventType: "SALE" as const,
          locationId: LOCATION_ID,
          productId,
          batchId: allocation.batchId,
          qtyDeltaBase: -allocation.qty,
          reference: { type: "sale", id: saleNo },
        }))
      : [],
  );
  const total = cartTotal(state.cart);
  const soldPct = state.cart.some((line) => line.productId === "pct");

  if (!state.online) {
    return {
      ...state,
      saleSeq,
      cart: [],
      outbox: [...state.outbox, { saleNo, events, total }],
      notice: { kind: "QUEUED", saleNo, total },
      milestones: withMilestone(withMilestone(state.milestones, "QUEUED_OFFLINE"), soldPct && "SOLD_PCT"),
    };
  }

  const server = applyAll(state.server, events);
  if (!server) return state;
  return {
    ...state,
    saleSeq,
    server,
    log: [...state.log, ...events],
    cart: [],
    notice: { kind: "SOLD", saleNo, total },
    milestones: withMilestone(state.milestones, soldPct && "SOLD_PCT"),
  };
}

/**
 * Reconnect: each queued sale is sent with its idempotency keys. The demo then
 * re-sends it, as a client would after a dropped acknowledgement, to show the
 * server records it once.
 */
function sync(state: DemoState): DemoState {
  let server = state.server;
  const log = [...state.log];
  const syncLog = [...state.syncLog];
  for (const sale of state.outbox) {
    const accepted = applyAll(server, sale.events);
    const events = accepted ? sale.events : sale.events.map((event) => ({ ...event, conflictNegative: true }));
    server = accepted ?? applyAll(server, events) ?? server;
    log.push(...events);
    syncLog.push({ saleNo: sale.saleNo, attempt: 1, outcome: accepted ? "ACCEPTED" : "CONFLICT" });

    const resend = events.map((event) => appendEvent(server, event));
    if (resend.every((result) => result.ok && result.value.replayed)) {
      syncLog.push({ saleNo: sale.saleNo, attempt: 2, outcome: "DUPLICATE_IGNORED" });
    }
  }
  return {
    ...state,
    online: true,
    server,
    log,
    outbox: [],
    syncLog,
    notice: { kind: "SYNCED", sales: state.outbox.length },
    milestones: withMilestone(state.milestones, "SYNCED"),
  };
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "ADD": {
      const existing = state.cart.find((line) => line.productId === action.productId && line.unitId === action.unitId);
      return setLine(state, action.productId, action.unitId, (existing?.qty ?? 0n) + (action.qty ?? ONE));
    }
    case "SET_QTY":
      return setLine(state, action.productId, action.unitId, action.qty);
    case "CHECKOUT":
      return checkout(state);
    case "SET_ONLINE":
      if (action.online === state.online) return state;
      return action.online
        ? state.outbox.length > 0
          ? sync(state)
          : { ...state, online: true, notice: null }
        : { ...state, online: false, notice: null };
    case "ACK":
      return { ...state, milestones: withMilestone(state.milestones, action.milestone) };
    case "DISMISS_NOTICE":
      return { ...state, notice: null };
    case "RESET":
      return initialState(action.today);
  }
}

export const TOUR: readonly Milestone[] = [
  "ADDED_PCT_STRIPS",
  "SEEN_FEFO",
  "SOLD_PCT",
  "RX_BLOCKED",
  "QUEUED_OFFLINE",
  "SYNCED",
];

/** Index of the first tour step not done yet, or TOUR.length when finished. */
export const currentStep = (state: DemoState): number => {
  const index = TOUR.findIndex((milestone) => !state.milestones.includes(milestone));
  return index === -1 ? TOUR.length : index;
};

/** The actions behind "Do it for me" on each tour step. */
export function stepActions(state: DemoState, step: Milestone): DemoAction[] {
  const pctStrips = state.cart.find((line) => line.unitId === "pct-strip")?.qty ?? 0n;
  switch (step) {
    case "ADDED_PCT_STRIPS":
      return [{ type: "SET_QTY", productId: "pct", unitId: "pct-strip", qty: pctStrips > 2n * ONE ? pctStrips : 2n * ONE }];
    case "SEEN_FEFO":
      return [{ type: "ACK", milestone: "SEEN_FEFO" }];
    case "SOLD_PCT":
      return [
        ...(state.cart.some((line) => line.productId === "pct")
          ? []
          : [{ type: "SET_QTY", productId: "pct", unitId: "pct-strip", qty: 2n * ONE } as const]),
        { type: "SET_ONLINE", online: true },
        { type: "CHECKOUT" },
      ];
    case "RX_BLOCKED":
      return [{ type: "ADD", productId: "amx", unitId: "amx-strip" }];
    case "QUEUED_OFFLINE":
      return [
        { type: "SET_ONLINE", online: false },
        { type: "ADD", productId: "vitc", unitId: "vitc-strip" },
        { type: "CHECKOUT" },
      ];
    case "SYNCED":
      return [{ type: "SET_ONLINE", online: true }];
  }
}

export { PRODUCTS };
