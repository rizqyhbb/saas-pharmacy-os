import { t, type Static } from "elysia";
import { PAYMENT_METHODS } from "@apotek/domain";
import {
  addCashMovement,
  branchOf,
  closeShift,
  currentShift,
  getReceipt,
  getShift,
  openShift,
  recordSale,
  refundSale,
  reviewShift,
  shiftTotals,
  voidSale,
} from "@apotek/db";
import { audit, authorize, authorizeBranch, inTenant, reply, type Reply, type TenantScope } from "../scope";
import { QTY_PATTERN } from "./catalogue";

/**
 * The counter (PRD POS-*, SHF-*). Every write carries a client-generated id so a device
 * can retry or sync later without doubling anything (SYN-2): shifts, cash movements and
 * sales are idempotent on that id.
 */

const rupiah = t.Integer({ minimum: 0, maximum: 10_000_000_000 });
const uuid = t.String({ format: "uuid" });
const method = t.Union(PAYMENT_METHODS.map((m) => t.Literal(m)));

export const openShiftBody = t.Object({ shiftId: uuid, workstationId: uuid, openingFloat: rupiah });
export const cashMovementBody = t.Object({
  movementId: uuid,
  type: t.Union([t.Literal("IN"), t.Literal("OUT")]),
  amount: t.Integer({ minimum: 1, maximum: 10_000_000_000 }),
  reason: t.String({ minLength: 3, maxLength: 500 }),
});
export const closeShiftBody = t.Object({ countedCash: rupiah });
export const reviewBody = t.Object({ note: t.String({ minLength: 3, maxLength: 1000 }) });

export const saleBody = t.Object({
  saleId: uuid,
  receiptNo: t.String({ pattern: "^[A-Za-z0-9-]{3,40}$" }),
  workstationId: uuid,
  shiftId: uuid,
  locationId: uuid,
  /** When the device recorded it; required for offline sales syncing later. */
  occurredAt: t.Optional(t.String({ format: "date-time" })),
  offline: t.Optional(t.Boolean()),
  lines: t.Array(
    t.Object({
      productId: uuid,
      unitId: uuid,
      qty: t.String({ pattern: QTY_PATTERN }),
      unitPrice: rupiah,
      discount: t.Optional(rupiah),
      deviceBatchId: t.Optional(uuid),
    }),
    { minItems: 1, maxItems: 100 },
  ),
  payments: t.Array(t.Object({ method, tendered: rupiah, reference: t.Optional(t.String({ maxLength: 120 })) }), { maxItems: 5 }),
});
export const voidBody = t.Object({ reason: t.String({ minLength: 3, maxLength: 500 }) });
export const refundBody = t.Object({
  shiftId: uuid,
  method,
  amount: t.Integer({ minimum: 1, maximum: 10_000_000_000 }),
  reason: t.String({ minLength: 3, maxLength: 500 }),
});

/** SHF-1: open a shift on a workstation of a branch the caller works in. */
export async function openShiftRoute(scope: TenantScope, body: Static<typeof openShiftBody>): Promise<Reply> {
  const denied = await authorize(scope, "shift.manage");
  if (denied) return denied;
  const branchId = await inTenant(scope, (tx) => branchOf(tx, "workstation", body.workstationId));
  if (!branchId) return reply(404, { error: "WORKSTATION_NOT_FOUND" });
  const outside = await authorizeBranch(scope, branchId);
  if (outside) return outside;
  const result = await inTenant(scope, async (tx) => {
    const [ws] = await tx<{ active: boolean }[]>`select active from app.workstations where id = ${body.workstationId}`;
    if (!ws?.active) return null;
    return openShift(tx, {
      shiftId: body.shiftId,
      tenantId: scope.member.tenantId,
      branchId,
      workstationId: body.workstationId,
      staffId: scope.member.staffId,
      openingFloat: body.openingFloat,
    });
  });
  if (!result) return reply(409, { error: "WORKSTATION_INACTIVE" });
  return reply(result.replayed ? 200 : 201, result.shift);
}

/** The workstation's open shift, so a device knows whether it can sell (US-SHF-1). */
export async function currentShiftRoute(scope: TenantScope, workstationId: string): Promise<Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  const shift = await inTenant(scope, (tx) => currentShift(tx, workstationId));
  return reply(200, { shift });
}

async function shiftInScope(scope: TenantScope, shiftId: string) {
  const shift = await inTenant(scope, (tx) => getShift(tx, shiftId));
  if (!shift) return { reply: reply(404, { error: "SHIFT_NOT_FOUND" }) };
  const outside = await authorizeBranch(scope, shift.branchId);
  return outside ? { reply: outside } : { shift };
}

export async function cashMovementRoute(scope: TenantScope, shiftId: string, body: Static<typeof cashMovementBody>): Promise<Reply> {
  const denied = await authorize(scope, "shift.manage");
  if (denied) return denied;
  const found = await shiftInScope(scope, shiftId);
  if ("reply" in found) return found.reply!;
  const result = await inTenant(scope, async (tx) => {
    const r = await addCashMovement(tx, { ...body, tenantId: scope.member.tenantId, shiftId, staffId: scope.member.staffId });
    if (!r.replayed) {
      await audit(scope, tx, { action: "shift.cash_movement", entityType: "shift", entityId: shiftId, branchId: found.shift.branchId, after: body, reason: body.reason });
    }
    return r;
  });
  return reply(result.replayed ? 200 : 201, { movementId: body.movementId, replayed: result.replayed });
}

/**
 * SHF-4 blind close. The request carries only the counted cash; the verdict comes back
 * in the response, never before. Unsynced offline sales must be synced first: a sale
 * can't join a closed shift (S2), which is why closing needs a connection (SYN-5).
 */
export async function closeShiftRoute(scope: TenantScope, shiftId: string, body: Static<typeof closeShiftBody>): Promise<Reply> {
  const denied = await authorize(scope, "shift.manage");
  if (denied) return denied;
  const found = await shiftInScope(scope, shiftId);
  if ("reply" in found) return found.reply!;
  const closed = await inTenant(scope, async (tx) => {
    const result = await closeShift(tx, shiftId, body.countedCash);
    if (result) {
      await audit(scope, tx, {
        action: "shift.close",
        entityType: "shift",
        entityId: shiftId,
        branchId: found.shift.branchId,
        after: { countedCash: body.countedCash, expectedCash: result.shift.expectedCash, variance: result.shift.variance, outcome: result.outcome.kind },
      });
    }
    return result;
  });
  return closed ? reply(200, closed) : reply(404, { error: "SHIFT_NOT_FOUND" });
}

/** SHF-5: a supervisor signs off a closed shift's variance. */
export async function reviewShiftRoute(scope: TenantScope, shiftId: string, body: Static<typeof reviewBody>): Promise<Reply> {
  const denied = await authorize(scope, "shift.review");
  if (denied) return denied;
  const found = await shiftInScope(scope, shiftId);
  if ("reply" in found) return found.reply!;
  const shift = await inTenant(scope, async (tx) => {
    const reviewed = await reviewShift(tx, shiftId, scope.member.staffId, body.note);
    if (reviewed) {
      await audit(scope, tx, { action: "shift.review", entityType: "shift", entityId: shiftId, branchId: reviewed.branchId, after: { variance: reviewed.variance }, reason: body.note });
    }
    return reviewed;
  });
  return shift ? reply(200, shift) : reply(404, { error: "SHIFT_NOT_FOUND" });
}

/** Shift report by payment method. The cashier sees their own; supervisors see any. */
export async function shiftReportRoute(scope: TenantScope, shiftId: string): Promise<Reply> {
  const found = await shiftInScope(scope, shiftId);
  if ("reply" in found) return found.reply!;
  if (found.shift.cashierStaffId !== scope.member.staffId) {
    const denied = await authorize(scope, "shift.review");
    if (denied) return denied;
  }
  const totals = await inTenant(scope, (tx) => shiftTotals(tx, shiftId));
  return reply(200, { shift: found.shift, totals });
}

/**
 * POS-8: one sale, one transaction. The `Idempotency-Key` header must equal the sale id;
 * a repeat returns the original result. Discounts need sale.discount and stay within the
 * role's limit.
 */
export async function saleRoute(scope: TenantScope, body: Static<typeof saleBody>): Promise<Reply> {
  const denied = await authorize(scope, "sale.create");
  if (denied) return denied;
  if (scope.request.headers.get("idempotency-key")?.toLowerCase() !== body.saleId.toLowerCase()) {
    return reply(400, { error: "IDEMPOTENCY_KEY_MUST_EQUAL_SALE_ID" });
  }
  const discounted = body.lines.some((l) => (l.discount ?? 0) > 0);
  if (discounted) {
    const noDiscount = await authorize(scope, "sale.discount");
    if (noDiscount) return noDiscount;
  }
  const branchId = await inTenant(scope, (tx) => branchOf(tx, "workstation", body.workstationId));
  if (!branchId) return reply(404, { error: "WORKSTATION_NOT_FOUND" });
  const outside = await authorizeBranch(scope, branchId);
  if (outside) return outside;
  if (body.offline && !body.occurredAt) return reply(422, { error: "OCCURRED_AT_REQUIRED" });

  const result = await inTenant(scope, async (tx) => {
    const locationBranch = await branchOf(tx, "location", body.locationId);
    if (locationBranch !== branchId) return null;
    const recorded = await recordSale(tx, {
      saleId: body.saleId,
      tenantId: scope.member.tenantId,
      branchId,
      locationId: body.locationId,
      workstationId: body.workstationId,
      shiftId: body.shiftId,
      cashierStaffId: scope.member.staffId,
      cashierRole: scope.member.role,
      receiptNo: body.receiptNo,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      offline: body.offline ?? false,
      lines: body.lines,
      payments: body.payments,
    });
    if (!recorded.replayed && discounted) {
      await audit(scope, tx, { action: "sale.discount", entityType: "sale", entityId: body.saleId, branchId, after: { receiptNo: body.receiptNo, lines: body.lines.map((l) => l.discount ?? 0) } });
    }
    if (!recorded.replayed && recorded.hasConflict) {
      await audit(scope, tx, { action: "sale.offline_conflict", entityType: "sale", entityId: body.saleId, branchId, after: { receiptNo: body.receiptNo } });
    }
    return recorded;
  });
  if (!result) return reply(422, { error: "LOCATION_NOT_IN_BRANCH" });
  return reply(result.replayed ? 200 : 201, result);
}

export async function receiptRoute(scope: TenantScope, saleId: string): Promise<Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  const receipt = await inTenant(scope, (tx) => getReceipt(tx, saleId));
  return receipt ? reply(200, receipt) : reply(404, { error: "SALE_NOT_FOUND" });
}

/** POS-10 void: a mistake undone, stock compensated, audited. */
export async function voidRoute(scope: TenantScope, saleId: string, body: Static<typeof voidBody>): Promise<Reply> {
  const denied = await authorize(scope, "sale.void");
  if (denied) return denied;
  const voided = await inTenant(scope, async (tx) => {
    const r = await voidSale(tx, saleId, scope.member.staffId, body.reason);
    if (r) await audit(scope, tx, { action: "sale.void", entityType: "sale", entityId: saleId, before: { status: "COMPLETED" }, after: { status: "VOIDED", ...r }, reason: body.reason });
    return r;
  });
  return voided ? reply(200, { saleId, status: "VOIDED" }) : reply(404, { error: "SALE_NOT_FOUND" });
}

/** POS-10 refund: money back on a completed sale, no restock, audited. */
export async function refundRoute(scope: TenantScope, saleId: string, body: Static<typeof refundBody>): Promise<Reply> {
  const denied = await authorize(scope, "sale.refund");
  if (denied) return denied;
  const refunded = await inTenant(scope, async (tx) => {
    const r = await refundSale(tx, { tenantId: scope.member.tenantId, saleId, shiftId: body.shiftId, method: body.method, amount: body.amount, reason: body.reason, staffId: scope.member.staffId });
    if (r) await audit(scope, tx, { action: "sale.refund", entityType: "sale", entityId: saleId, after: { refundId: r.refundId, method: body.method, amount: body.amount }, reason: body.reason });
    return r;
  });
  return refunded ? reply(201, { saleId, ...refunded }) : reply(404, { error: "SALE_NOT_FOUND" });
}

