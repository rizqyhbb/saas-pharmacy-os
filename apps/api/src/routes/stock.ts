import { t, type Static } from "elysia";
import { formatQty, parseQty, toBase } from "@apotek/domain";
import {
  branchOfLocation,
  getProduct,
  recordOpeningBalance,
  setBatchStatus,
  SETTABLE_BATCH_STATUSES,
  stockCard,
  withContext,
  type OpeningBalanceLine,
} from "@apotek/db";
import { audit, authorize, authorizeBranch, contextOf, inTenant, reply, visibleBranches, type Reply, type TenantScope } from "../scope";
import { QTY_PATTERN } from "./catalogue";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const openingBalanceBody = t.Object({
  locationId: t.String({ format: "uuid" }),
  productId: t.String({ format: "uuid" }),
  lines: t.Array(
    t.Object({
      unitId: t.String({ format: "uuid" }),
      /** In the chosen unit: "5" box. */
      qty: t.String({ pattern: QTY_PATTERN }),
      batchNumber: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
      expiryDate: t.Optional(t.String({ format: "date" })),
      purchaseCostPerBase: t.Optional(t.String({ pattern: QTY_PATTERN })),
    }),
    { minItems: 1, maxItems: 50 },
  ),
});

export const batchStatusBody = t.Object({
  status: t.Union(SETTABLE_BATCH_STATUSES.map((v) => t.Literal(v))),
  reason: t.String({ minLength: 3, maxLength: 500 }),
});

/**
 * Opening stock for one product at one location (US-INV-2). Requires an
 * `Idempotency-Key` header (a UUID that also names the document): sending the same
 * request twice records it once (T10). Quantities are entered in any unit and stored
 * in the base unit, exactly (U2).
 */
export async function openingBalanceRoute(scope: TenantScope, body: Static<typeof openingBalanceBody>): Promise<Reply> {
  const denied = await authorize(scope, "stock.opening_balance");
  if (denied) return denied;
  const documentId = scope.request.headers.get("idempotency-key") ?? "";
  if (!UUID.test(documentId)) return reply(400, { error: "IDEMPOTENCY_KEY_REQUIRED" });

  const branchId = await withContext(scope.db, contextOf(scope), (tx) => branchOfLocation(tx, body.locationId));
  if (!branchId) return reply(404, { error: "LOCATION_NOT_FOUND" });
  const outsideBranch = await authorizeBranch(scope, branchId);
  if (outsideBranch) return outsideBranch;

  const product = await inTenant(scope, (tx) => getProduct(tx, body.productId));
  if (!product) return reply(404, { error: "PRODUCT_NOT_FOUND" });

  const lines: OpeningBalanceLine[] = [];
  for (const [index, line] of body.lines.entries()) {
    const unit = product.units.find((u) => u.id === line.unitId);
    if (!unit) return reply(422, { error: "UNKNOWN_UNIT", line: index });
    const unitQty = parseQty(line.qty);
    if (unitQty <= 0n) return reply(422, { error: "QTY_MUST_BE_POSITIVE", line: index });
    const base = toBase(unitQty, { id: unit.id, name: unit.name, multiplierToBase: parseQty(unit.multiplierToBase) });
    if (!base.ok) return reply(422, { error: "INEXACT_CONVERSION", line: index });
    const hasBatch = line.batchNumber !== undefined || line.expiryDate !== undefined;
    if (product.tracksBatch && (!line.batchNumber || !line.expiryDate)) return reply(422, { error: "BATCH_REQUIRED", line: index });
    if (!product.tracksBatch && hasBatch) return reply(422, { error: "BATCH_NOT_TRACKED", line: index });
    lines.push({
      batch: product.tracksBatch
        ? { batchNumber: line.batchNumber!, expiryDate: line.expiryDate!, purchaseCostPerBase: line.purchaseCostPerBase ?? null }
        : null,
      baseQty: base.value,
      unitContext: { unit: unit.name, qty: formatQty(unitQty) },
    });
  }

  const result = await inTenant(scope, async (tx) => {
    const recorded = await recordOpeningBalance(tx, {
      tenantId: scope.member.tenantId,
      branchId,
      locationId: body.locationId,
      productId: body.productId,
      documentId,
      actorStaffId: scope.member.staffId,
      lines,
    });
    if (!recorded.replayed) {
      await audit(scope, tx, {
        action: "stock.opening_balance",
        entityType: "product",
        entityId: body.productId,
        branchId,
        after: { documentId, locationId: body.locationId, lines: recorded.lines },
      });
    }
    return recorded;
  });
  return reply(result.replayed ? 200 : 201, { documentId, ...result });
}

/** Quarantine, recall or release a batch. A reason is required and audited. */
export async function batchStatusRoute(scope: TenantScope, batchId: string, body: Static<typeof batchStatusBody>): Promise<Reply> {
  const denied = await authorize(scope, "batch.status.update");
  if (denied) return denied;
  const change = await inTenant(scope, async (tx) => {
    const changed = await setBatchStatus(tx, batchId, body.status);
    if (!changed) return null;
    await audit(scope, tx, {
      action: "batch.status.change",
      entityType: "batch",
      entityId: batchId,
      before: changed.before,
      after: { ...changed.after, batchNumber: changed.batchNumber },
      reason: body.reason,
    });
    return changed;
  });
  return change ? reply(200, { batchId, status: change.after.status }) : reply(404, { error: "BATCH_NOT_FOUND" });
}

/** US-INV-9: balances per batch and location, plus the movements behind them. */
export async function stockCardRoute(scope: TenantScope, productId: string): Promise<Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  const card = await inTenant(scope, async (tx) => {
    if (!(await getProduct(tx, productId))) return null;
    return stockCard(tx, productId, { branchIds: visibleBranches(scope.member) });
  });
  return card ? reply(200, { productId, ...card }) : reply(404, { error: "PRODUCT_NOT_FOUND" });
}
