import {
  allocateFefo,
  allocateForSync,
  checkDiscountLimit,
  closeOutcome,
  expectedCash,
  formatQty,
  parseQty,
  saleTotals,
  settlePayments,
  toBase,
  type AllocationCandidate,
  type BatchStatus,
  type CloseOutcome,
  type PaymentInput,
  type Qty,
  type Role,
} from "@apotek/domain";
import type { Tx } from "./client";
import { RuleError } from "./errors";

/**
 * The counter's transaction engine (docs/ARCHITECTURE.md §7) and cashier shifts.
 * Runs inside `withContext`; the database re-checks S1, S2, S5, T3 and the stock rules.
 */

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

export interface ShiftView {
  shiftId: string;
  branchId: string;
  workstationId: string;
  cashierStaffId: string;
  status: "OPEN" | "CLOSING" | "CLOSED";
  openingFloat: number;
  openedAt: string;
  closedAt: string | null;
  /** Hidden until the shift is closed (blind close, SHF-4). */
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  reviewedBy: string | null;
  reviewNote: string | null;
}

type ShiftRow = {
  id: string;
  branch_id: string;
  workstation_id: string;
  cashier_staff_id: string;
  status: ShiftView["status"];
  opening_float: string;
  opened_at: Date;
  closed_at: Date | null;
  counted_cash: string | null;
  expected_cash: string | null;
  variance: string | null;
  reviewed_by: string | null;
  review_note: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));
const toShift = (r: ShiftRow): ShiftView => ({
  shiftId: r.id,
  branchId: r.branch_id,
  workstationId: r.workstation_id,
  cashierStaffId: r.cashier_staff_id,
  status: r.status,
  openingFloat: Number(r.opening_float),
  openedAt: r.opened_at.toISOString(),
  closedAt: r.closed_at?.toISOString() ?? null,
  countedCash: r.status === "CLOSED" ? num(r.counted_cash) : null,
  expectedCash: r.status === "CLOSED" ? num(r.expected_cash) : null,
  variance: r.status === "CLOSED" ? num(r.variance) : null,
  reviewedBy: r.reviewed_by,
  reviewNote: r.review_note,
});

const SHIFT_COLUMNS = (tx: Tx) => tx`
  id, branch_id, workstation_id, cashier_staff_id, status::text as status, opening_float, opened_at, closed_at,
  counted_cash, expected_cash, variance, reviewed_by, review_note`;

export async function getShift(tx: Tx, shiftId: string): Promise<ShiftView | null> {
  const [row] = await tx<ShiftRow[]>`select ${SHIFT_COLUMNS(tx)} from app.shifts where id = ${shiftId}`;
  return row ? toShift(row) : null;
}

/** The open (or closing) shift of a workstation, if any. */
export async function currentShift(tx: Tx, workstationId: string): Promise<ShiftView | null> {
  const [row] = await tx<ShiftRow[]>`
    select ${SHIFT_COLUMNS(tx)} from app.shifts where workstation_id = ${workstationId} and status <> 'CLOSED'`;
  return row ? toShift(row) : null;
}

/** SHF-1. Idempotent on the client's shift id. */
export async function openShift(
  tx: Tx,
  input: { shiftId: string; tenantId: string; branchId: string; workstationId: string; staffId: string; openingFloat: number },
): Promise<{ shift: ShiftView; replayed: boolean }> {
  const existing = await getShift(tx, input.shiftId);
  if (existing) return { shift: existing, replayed: true };
  const open = await currentShift(tx, input.workstationId);
  if (open) throw new RuleError("SHIFT_ALREADY_OPEN", `workstation already has shift ${open.shiftId}`);
  await tx`
    insert into app.shifts (id, tenant_id, branch_id, workstation_id, cashier_staff_id, opening_float)
    values (${input.shiftId}, ${input.tenantId}, ${input.branchId}, ${input.workstationId}, ${input.staffId}, ${input.openingFloat})`;
  return { shift: (await getShift(tx, input.shiftId))!, replayed: false };
}

/** SHF-3. Idempotent on the movement id. */
export async function addCashMovement(
  tx: Tx,
  input: { movementId: string; tenantId: string; shiftId: string; type: "IN" | "OUT"; amount: number; reason: string; staffId: string },
): Promise<{ replayed: boolean }> {
  const [existing] = await tx`select 1 from app.cash_movements where id = ${input.movementId}`;
  if (existing) return { replayed: true };
  const shift = await getShift(tx, input.shiftId);
  if (!shift || shift.status !== "OPEN") throw new RuleError("SHIFT_NOT_OPEN", "cash moves only in an open shift");
  await tx`
    insert into app.cash_movements (id, tenant_id, shift_id, type, amount, reason, actor_staff_id)
    values (${input.movementId}, ${input.tenantId}, ${input.shiftId}, ${input.type}, ${input.amount}, ${input.reason.trim()}, ${input.staffId})`;
  return { replayed: false };
}

export interface ShiftTotals {
  salesCount: number;
  voidedCount: number;
  byMethod: Record<string, number>;
  cashSales: number;
  cashRefunds: number;
  refundsTotal: number;
  cashIn: number;
  cashOut: number;
}

export async function shiftTotals(tx: Tx, shiftId: string): Promise<ShiftTotals> {
  const [row] = await tx<
    {
      sales_count: number;
      voided_count: number;
      by_method: Record<string, string> | null;
      cash_refunds: string;
      refunds_total: string;
      cash_in: string;
      cash_out: string;
    }[]
  >`
    select
      (select count(*)::int from app.sales s where s.shift_id = ${shiftId} and s.status = 'COMPLETED') as sales_count,
      (select count(*)::int from app.sales s where s.shift_id = ${shiftId} and s.status = 'VOIDED') as voided_count,
      (select json_object_agg(m.method, m.amount) from (
         select p.method::text as method, sum(p.amount)::text as amount
         from app.payments p join app.sales s on s.id = p.sale_id
         where s.shift_id = ${shiftId} and s.status = 'COMPLETED' group by p.method) m) as by_method,
      (select coalesce(sum(r.amount), 0)::text from app.refunds r where r.shift_id = ${shiftId} and r.method = 'CASH') as cash_refunds,
      (select coalesce(sum(r.amount), 0)::text from app.refunds r where r.shift_id = ${shiftId}) as refunds_total,
      (select coalesce(sum(c.amount), 0)::text from app.cash_movements c where c.shift_id = ${shiftId} and c.type = 'IN') as cash_in,
      (select coalesce(sum(c.amount), 0)::text from app.cash_movements c where c.shift_id = ${shiftId} and c.type = 'OUT') as cash_out
  `;
  const byMethod = Object.fromEntries(Object.entries(row!.by_method ?? {}).map(([k, v]) => [k, Number(v)]));
  return {
    salesCount: row!.sales_count,
    voidedCount: row!.voided_count,
    byMethod,
    cashSales: byMethod.CASH ?? 0,
    cashRefunds: Number(row!.cash_refunds),
    refundsTotal: Number(row!.refunds_total),
    cashIn: Number(row!.cash_in),
    cashOut: Number(row!.cash_out),
  };
}

/**
 * SHF-4 blind close: the cashier sends what they counted; expected cash and the
 * verdict are computed here and revealed only in the response. OPEN -> CLOSING -> CLOSED.
 */
export async function closeShift(
  tx: Tx,
  shiftId: string,
  countedCash: number,
): Promise<{ shift: ShiftView; outcome: CloseOutcome; totals: ShiftTotals } | null> {
  const [locked] = await tx<{ status: string; opening_float: string }[]>`
    select status::text as status, opening_float from app.shifts where id = ${shiftId} for update`;
  if (!locked) return null;
  if (locked.status !== "OPEN") throw new RuleError("SHIFT_NOT_OPEN", "only an open shift can be closed");
  await tx`update app.shifts set status = 'CLOSING', closing_started_at = now() where id = ${shiftId}`;
  const totals = await shiftTotals(tx, shiftId);
  const expected = expectedCash({
    openingFloat: Number(locked.opening_float),
    cashSales: totals.cashSales,
    cashRefunds: totals.cashRefunds,
    cashIn: totals.cashIn,
    cashOut: totals.cashOut,
  });
  await tx`
    update app.shifts set status = 'CLOSED', counted_cash = ${countedCash}, expected_cash = ${expected},
      variance = ${countedCash - expected}, closed_at = now()
    where id = ${shiftId}`;
  return { shift: (await getShift(tx, shiftId))!, outcome: closeOutcome(countedCash, expected), totals };
}

/** SHF-5: a supervisor signs off the variance. */
export async function reviewShift(tx: Tx, shiftId: string, staffId: string, note: string): Promise<ShiftView | null> {
  const shift = await getShift(tx, shiftId);
  if (!shift) return null;
  if (shift.status !== "CLOSED") throw new RuleError("SHIFT_NOT_CLOSED", "review happens after close");
  await tx`update app.shifts set reviewed_by = ${staffId}, reviewed_at = now(), review_note = ${note.trim()} where id = ${shiftId}`;
  return getShift(tx, shiftId);
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SaleLineInput {
  productId: string;
  unitId: string;
  /** In the chosen unit, decimal string. */
  qty: string;
  /** Whole rupiah per unit. Online it must match the current price; offline the device's price stands. */
  unitPrice: number;
  discount?: number;
  /** The batch the device's own FEFO picked, used only when an offline sale finds nothing sellable. */
  deviceBatchId?: string;
}

export interface SaleInput {
  saleId: string;
  tenantId: string;
  branchId: string;
  locationId: string;
  workstationId: string;
  shiftId: string;
  cashierStaffId: string;
  cashierRole: Role;
  receiptNo: string;
  occurredAt: Date;
  offline: boolean;
  lines: SaleLineInput[];
  payments: PaymentInput[];
}

export interface SaleResult {
  saleId: string;
  replayed: boolean;
  receiptNo: string;
  total: number;
  changeDue: number;
  hasConflict: boolean;
}

type UnitRow = {
  product_id: string;
  brand_name: string;
  sales_class: string;
  controlled_class: string;
  classified: boolean;
  blocked_for_sale: boolean;
  tracks_batch: boolean;
  unit_id: string;
  unit_name: string;
  multiplier: string;
  sell_price: string | null;
};

type LockedRow = { batch_id: string | null; expiry_date: string | null; received_at: Date | null; status: BatchStatus | null; available: string };

/** One product's balances at one location, locked for this transaction (app.lock_stock). */
async function lockStock(tx: Tx, locationId: string, productId: string): Promise<LockedRow[]> {
  return tx<LockedRow[]>`
    select batch_id, expiry_date::text as expiry_date, received_at, status::text as status, (on_hand - reserved)::text as available
    from app.lock_stock(${locationId}, ${productId})`;
}

const toCandidates = (rows: LockedRow[]): AllocationCandidate[] =>
  rows
    .filter((r) => r.batch_id !== null)
    .map((r) => ({
      batchId: r.batch_id!,
      expiryDate: r.expiry_date!,
      receivedAt: r.received_at!,
      status: r.status!,
      available: parseQty(r.available) > 0n ? parseQty(r.available) : 0n,
    }));

/**
 * Records a sale in one transaction (POS-8): validates every line against the catalogue,
 * allocates batches by FEFO (or, for an offline sale, by the sync rule that never drops
 * a sale), writes sale, lines, allocations, ledger rows and payments. A replay of the
 * same sale id returns the original result (S4, T10).
 */
export async function recordSale(tx: Tx, input: SaleInput): Promise<SaleResult> {
  const [existing] = await tx<{ id: string; receipt_no: string; total: string; change_due: string; has_conflict: boolean; lines: number }[]>`
    select s.id, s.receipt_no, s.total, s.change_due, s.has_conflict,
      (select count(*)::int from app.sale_items i where i.sale_id = s.id) as lines
    from app.sales s where s.id = ${input.saleId}`;
  if (existing) {
    if (existing.receipt_no !== input.receiptNo || existing.lines !== input.lines.length) {
      throw new RuleError("IDEMPOTENCY_KEY_REUSED", `sale ${input.saleId} was recorded with different content`);
    }
    return {
      saleId: existing.id,
      replayed: true,
      receiptNo: existing.receipt_no,
      total: Number(existing.total),
      changeDue: Number(existing.change_due),
      hasConflict: existing.has_conflict,
    };
  }

  const unitIds = input.lines.map((l) => l.unitId);
  const units = new Map(
    (
      await tx<UnitRow[]>`
        select p.id as product_id, p.brand_name, p.sales_class::text as sales_class, p.controlled_class::text as controlled_class,
          p.classified_at is not null as classified, p.blocked_for_sale, p.tracks_batch,
          u.id as unit_id, u.name as unit_name, u.multiplier_to_base::text as multiplier, u.sell_price
        from app.product_units u join app.products p on p.id = u.product_id
        where u.id = any(${unitIds}::uuid[])`
    ).map((r) => [r.unit_id, r]),
  );

  const prepared = input.lines.map((line, index) => {
    const unit = units.get(line.unitId);
    if (!unit || unit.product_id !== line.productId) throw new RuleError("UNKNOWN_UNIT", `line ${index + 1}`);
    if (unit.sales_class === "RX_REQUIRED" || unit.controlled_class !== "NONE") {
      throw new RuleError("RX_REQUIRED", `line ${index + 1}: ${unit.brand_name} needs a prescription`);
    }
    if (!unit.classified || unit.blocked_for_sale) throw new RuleError("PRODUCT_NOT_SELLABLE", `line ${index + 1}: ${unit.brand_name}`);
    if (unit.sell_price === null) throw new RuleError("UNIT_NOT_SOLD", `line ${index + 1}: ${unit.unit_name}`);
    if (!input.offline && Number(unit.sell_price) !== line.unitPrice) {
      throw new RuleError("PRICE_CHANGED", `line ${index + 1}: current price is ${unit.sell_price}`);
    }
    const qty = parseQty(line.qty);
    if (qty <= 0n) throw new RuleError("QTY_MUST_BE_POSITIVE", `line ${index + 1}`);
    const base = toBase(qty, { id: unit.unit_id, name: unit.unit_name, multiplierToBase: parseQty(unit.multiplier) });
    if (!base.ok) throw new RuleError("INEXACT_CONVERSION", `line ${index + 1}`);
    return { line, unit, qty, baseQty: base.value, lineNo: index + 1 };
  });

  const totals = saleTotals(prepared.map((p) => ({ unitPrice: p.line.unitPrice, qty: p.qty, discount: p.line.discount ?? 0 })));
  if (!totals.ok) throw new RuleError(totals.error.kind, JSON.stringify(totals.error));
  const limit = checkDiscountLimit(totals.value, input.cashierRole);
  if (!limit.ok) throw new RuleError(limit.error.kind, `discount ${limit.error.kind === "DISCOUNT_ABOVE_LIMIT" ? `${limit.error.percent}% above ${limit.error.limit}%` : ""}`);
  const settled = settlePayments(totals.value.total, input.payments);
  if (!settled.ok) throw new RuleError(`PAYMENT_${settled.error.kind}`, JSON.stringify(settled.error));

  const [branch] = await tx<{ today: string }[]>`
    select (now() at time zone timezone)::date::text as today from app.branches where id = ${input.branchId}`;
  const today = branch!.today;

  // Phase 1: allocate every line. Balances are locked; stock taken by earlier lines of
  // this same sale is tracked here, since the ledger rows aren't written yet.
  const takenByBatch = new Map<string, Qty>();
  const takenUnbatched = new Map<string, Qty>();
  const plans: { p: (typeof prepared)[number]; allocations: { batchId: string | null; qty: Qty; conflict: boolean }[] }[] = [];
  for (const p of prepared) {
    let allocations: { batchId: string | null; qty: Qty; conflict: boolean }[];
    if (p.unit.tracks_batch) {
      const candidates = toCandidates(await lockStock(tx, input.locationId, p.unit.product_id)).map((c) => {
        const left = c.available - (takenByBatch.get(c.batchId) ?? 0n);
        return { ...c, available: left > 0n ? left : 0n };
      });
      if (input.offline) {
        const r = allocateForSync(p.baseQty, candidates, today, p.line.deviceBatchId);
        if (!r.ok) throw new RuleError("NO_BATCH_AT_LOCATION", `line ${p.lineNo}`);
        allocations = r.value;
      } else {
        const r = allocateFefo(p.baseQty, candidates, today);
        if (!r.ok) throw new RuleError("INSUFFICIENT_STOCK", `line ${p.lineNo}: short ${formatQty(r.error.shortfall)}`);
        allocations = r.value.map((a) => ({ ...a, conflict: false }));
      }
      for (const a of allocations) takenByBatch.set(a.batchId!, (takenByBatch.get(a.batchId!) ?? 0n) + a.qty);
    } else {
      const bal = (await lockStock(tx, input.locationId, p.unit.product_id)).find((r) => r.batch_id === null);
      const available = (bal ? parseQty(bal.available) : 0n) - (takenUnbatched.get(p.unit.product_id) ?? 0n);
      const short = available < p.baseQty;
      if (short && !input.offline) throw new RuleError("INSUFFICIENT_STOCK", `line ${p.lineNo}`);
      takenUnbatched.set(p.unit.product_id, (takenUnbatched.get(p.unit.product_id) ?? 0n) + p.baseQty);
      allocations = [{ batchId: null, qty: p.baseQty, conflict: short }];
    }
    plans.push({ p, allocations });
  }
  const hasConflict = plans.some((plan) => plan.allocations.some((a) => a.conflict));

  // Phase 2: write. The sale first (S2 checks the shift), then lines, allocations,
  // ledger rows (the balance trigger re-checks every stock rule) and payments (S1 at commit).
  await tx`
    insert into app.sales (id, tenant_id, branch_id, location_id, workstation_id, shift_id, cashier_staff_id, receipt_no,
      subtotal, discount_total, total, change_due, occurred_at, offline, has_conflict, idempotency_key)
    values (${input.saleId}, ${input.tenantId}, ${input.branchId}, ${input.locationId}, ${input.workstationId}, ${input.shiftId},
      ${input.cashierStaffId}, ${input.receiptNo}, ${totals.value.subtotal}, ${totals.value.discountTotal}, ${totals.value.total},
      ${settled.value.changeDue}, ${input.occurredAt}, ${input.offline}, ${hasConflict}, ${input.saleId})`;

  for (const { p, allocations } of plans) {
    const lineTotals = totals.value.lines[p.lineNo - 1]!;
    const [item] = await tx<{ id: string }[]>`
      insert into app.sale_items (tenant_id, sale_id, line_no, product_id, unit_id, unit_name, qty_unit, qty_base,
        unit_price, discount, line_total)
      values (${input.tenantId}, ${input.saleId}, ${p.lineNo}, ${p.unit.product_id}, ${p.unit.unit_id}, ${p.unit.unit_name},
        ${formatQty(p.qty)}, ${formatQty(p.baseQty)}, ${p.line.unitPrice}, ${lineTotals.discount}, ${lineTotals.net})
      returning id`;
    for (const [i, a] of allocations.entries()) {
      await tx`
        insert into app.sale_item_allocations (tenant_id, sale_item_id, batch_id, qty_base, conflict)
        values (${input.tenantId}, ${item!.id}, ${a.batchId}, ${formatQty(a.qty)}, ${a.conflict})`;
      await tx`
        insert into app.inventory_ledger (tenant_id, branch_id, location_id, product_id, batch_id, qty_delta_base, unit_context,
          event_type, reference_type, reference_id, actor_staff_id, conflict_negative, idempotency_key)
        values (${input.tenantId}, ${input.branchId}, ${input.locationId}, ${p.unit.product_id}, ${a.batchId},
          ${formatQty(-a.qty)}, ${tx.json({ unit: p.unit.unit_name, qty: formatQty(p.qty) })}, 'SALE', 'sale', ${input.saleId},
          ${input.cashierStaffId}, ${a.conflict}, ${`${input.saleId}/${p.lineNo}/${i}`})`;
    }
  }

  for (const payment of settled.value.payments) {
    await tx`
      insert into app.payments (tenant_id, sale_id, method, tendered, amount, reference)
      values (${input.tenantId}, ${input.saleId}, ${payment.method}, ${payment.tendered}, ${payment.amount}, ${payment.reference ?? null})`;
  }

  return {
    saleId: input.saleId,
    replayed: false,
    receiptNo: input.receiptNo,
    total: totals.value.total,
    changeDue: settled.value.changeDue,
    hasConflict,
  };
}

/**
 * S3: a void undoes a mistaken sale. Stock comes back through new STOCK_ADJUSTMENT rows
 * (one per allocation); the sale stays, marked VOIDED. Only while its shift is open (the
 * cash is still in the drawer) and only if nothing was refunded. Policy [VALIDATE].
 */
export async function voidSale(tx: Tx, saleId: string, staffId: string, reason: string): Promise<{ receiptNo: string; total: number } | null> {
  const [sale] = await tx<{ status: string; receipt_no: string; total: string; shift_status: string; branch_id: string; location_id: string; tenant_id: string }[]>`
    select s.status::text as status, s.receipt_no, s.total, sh.status::text as shift_status, s.branch_id, s.location_id, s.tenant_id
    from app.sales s join app.shifts sh on sh.id = s.shift_id where s.id = ${saleId} for update of s`;
  if (!sale) return null;
  if (sale.status !== "COMPLETED") throw new RuleError("ALREADY_VOIDED", "the sale is already voided");
  if (sale.shift_status !== "OPEN") throw new RuleError("SHIFT_CLOSED", "a sale is voided only while its shift is open");
  const [refunded] = await tx<{ n: number }[]>`select count(*)::int as n from app.refunds where sale_id = ${saleId}`;
  if (refunded!.n > 0) throw new RuleError("SALE_REFUNDED", "a refunded sale cannot be voided");

  const rows = await tx<{ product_id: string; batch_id: string | null; qty_base: string }[]>`
    select i.product_id, a.batch_id, a.qty_base::text as qty_base
    from app.sale_item_allocations a join app.sale_items i on i.id = a.sale_item_id
    where i.sale_id = ${saleId} order by i.line_no, a.id`;
  for (const [index, row] of rows.entries()) {
    await tx`
      insert into app.inventory_ledger (tenant_id, branch_id, location_id, product_id, batch_id, qty_delta_base, event_type,
        reference_type, reference_id, reason, actor_staff_id, idempotency_key)
      values (${sale.tenant_id}, ${sale.branch_id}, ${sale.location_id}, ${row.product_id}, ${row.batch_id}, ${row.qty_base},
        'STOCK_ADJUSTMENT', 'sale_void', ${saleId}, ${reason.trim()}, ${staffId}, ${`${saleId}/void/${index}`})`;
  }
  await tx`update app.sales set status = 'VOIDED', voided_at = now(), voided_by = ${staffId}, void_reason = ${reason.trim()} where id = ${saleId}`;
  return { receiptNo: sale.receipt_no, total: Number(sale.total) };
}

/** US-POS-8: money back on a completed sale, paid from an open shift. Stock is untouched. */
export async function refundSale(
  tx: Tx,
  input: { tenantId: string; saleId: string; shiftId: string; method: PaymentInput["method"]; amount: number; reason: string; staffId: string },
): Promise<{ refundId: string } | null> {
  const [sale] = await tx`select 1 from app.sales where id = ${input.saleId}`;
  if (!sale) return null;
  const [row] = await tx<{ id: string }[]>`
    insert into app.refunds (tenant_id, sale_id, shift_id, method, amount, reason, approved_by)
    values (${input.tenantId}, ${input.saleId}, ${input.shiftId}, ${input.method}, ${input.amount}, ${input.reason.trim()}, ${input.staffId})
    returning id`;
  return { refundId: row!.id };
}

export interface Receipt {
  saleId: string;
  receiptNo: string;
  status: "COMPLETED" | "VOIDED";
  occurredAt: string;
  offline: boolean;
  hasConflict: boolean;
  cashier: string;
  branch: string;
  facility: { name: string | null; address: string | null; phone: string | null; apjName: string | null };
  lines: { lineNo: number; product: string; strength: string | null; unit: string; qty: string; unitPrice: number; discount: number; total: number; batches: { batchNumber: string | null; expiryDate: string | null; qty: string }[] }[];
  subtotal: number;
  discountTotal: number;
  total: number;
  payments: { method: string; tendered: number; amount: number; reference: string | null }[];
  changeDue: number;
  refunded: number;
}

/** US-POS-7: everything a 58/80 mm receipt or a WhatsApp text needs. */
export async function getReceipt(tx: Tx, saleId: string): Promise<Receipt | null> {
  const [s] = await tx<
    {
      id: string;
      receipt_no: string;
      status: Receipt["status"];
      occurred_at: Date;
      offline: boolean;
      has_conflict: boolean;
      cashier: string;
      branch: string;
      subtotal: string;
      discount_total: string;
      total: string;
      change_due: string;
      refunded: string;
      legal_name: string | null;
      tenant_name: string;
      address: string | null;
      phone: string | null;
      apj_name: string | null;
    }[]
  >`
    select s.id, s.receipt_no, s.status::text as status, s.occurred_at, s.offline, s.has_conflict, sm.display_name as cashier,
      b.name as branch, s.subtotal, s.discount_total, s.total, s.change_due,
      (select coalesce(sum(r.amount), 0) from app.refunds r where r.sale_id = s.id) as refunded,
      f.legal_name, t.name as tenant_name, f.address, f.phone, f.apj_name
    from app.sales s
    join app.staff_members sm on sm.id = s.cashier_staff_id
    join app.branches b on b.id = s.branch_id
    join app.tenants t on t.id = s.tenant_id
    left join app.facility_profiles f on f.tenant_id = s.tenant_id
    where s.id = ${saleId}`;
  if (!s) return null;
  const lines = await tx<
    { line_no: number; brand_name: string; strength: string | null; unit_name: string; qty_unit: string; unit_price: string; discount: string; line_total: string; batches: { batchNumber: string | null; expiryDate: string | null; qty: string }[] }[]
  >`
    select i.line_no, p.brand_name, p.strength, i.unit_name, i.qty_unit::text as qty_unit, i.unit_price, i.discount, i.line_total,
      coalesce((select json_agg(json_build_object('batchNumber', b.batch_number, 'expiryDate', b.expiry_date, 'qty', a.qty_base::text) order by b.expiry_date)
                from app.sale_item_allocations a left join app.batches b on b.id = a.batch_id where a.sale_item_id = i.id), '[]') as batches
    from app.sale_items i join app.products p on p.id = i.product_id
    where i.sale_id = ${saleId} order by i.line_no`;
  const payments = await tx<{ method: string; tendered: string; amount: string; reference: string | null }[]>`
    select method::text as method, tendered, amount, reference from app.payments where sale_id = ${saleId} order by created_at, id`;
  return {
    saleId: s.id,
    receiptNo: s.receipt_no,
    status: s.status,
    occurredAt: s.occurred_at.toISOString(),
    offline: s.offline,
    hasConflict: s.has_conflict,
    cashier: s.cashier,
    branch: s.branch,
    facility: { name: s.legal_name ?? s.tenant_name, address: s.address, phone: s.phone, apjName: s.apj_name },
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      product: l.brand_name,
      strength: l.strength,
      unit: l.unit_name,
      qty: formatQty(parseQty(l.qty_unit)),
      unitPrice: Number(l.unit_price),
      discount: Number(l.discount),
      total: Number(l.line_total),
      batches: l.batches.map((b) => ({ ...b, qty: formatQty(parseQty(b.qty)) })),
    })),
    subtotal: Number(s.subtotal),
    discountTotal: Number(s.discount_total),
    total: Number(s.total),
    payments: payments.map((p) => ({ method: p.method, tendered: Number(p.tendered), amount: Number(p.amount), reference: p.reference })),
    changeDue: Number(s.change_due),
    refunded: Number(s.refunded),
  };
}

export type { Qty };
