import { t, type Static } from "elysia";
import { can, parseQty, validateUnitSet } from "@apotek/domain";
import {
  addBarcode,
  classifyProduct,
  CONTROLLED_CLASSES,
  createProduct,
  getProduct,
  listProducts,
  removeBarcode,
  SALES_CLASSES,
  setUnitPrice,
  updateProductDetails,
} from "@apotek/db";
import { audit, authorize, inTenant, reply, type Reply, type TenantScope } from "../scope";

/** Decimal with up to 4 fractional digits, matching numeric(18,4). */
export const QTY_PATTERN = "^\\d{1,14}(\\.\\d{1,4})?$";
const text = (max: number) => t.String({ minLength: 1, maxLength: max });
const optionalText = (max: number) => t.Optional(t.Union([t.String({ maxLength: max }), t.Null()]));
const salesClass = t.Union(SALES_CLASSES.map((v) => t.Literal(v)));
const controlledClass = t.Union(CONTROLLED_CLASSES.map((v) => t.Literal(v)));
const barcode = t.String({ pattern: "^\\S{1,64}$" });
const price = t.Union([t.Integer({ minimum: 0, maximum: 1_000_000_000 }), t.Null()]);

const details = {
  sku: text(64),
  brandName: text(160),
  genericName: optionalText(160),
  strength: optionalText(60),
  dosageForm: optionalText(60),
  route: optionalText(60),
  manufacturer: optionalText(160),
  kfaCode: optionalText(64),
  bpomNie: optionalText(64),
  coldChain: t.Optional(t.Boolean()),
  category: optionalText(80),
  packageDescription: optionalText(160),
  compoundingIngredient: t.Optional(t.Boolean()),
  /** Stock levels in base units (PRD-7). */
  minStock: t.Optional(t.Union([t.String({ pattern: QTY_PATTERN }), t.Null()])),
  maxStock: t.Optional(t.Union([t.String({ pattern: QTY_PATTERN }), t.Null()])),
  safetyStock: t.Optional(t.Union([t.String({ pattern: QTY_PATTERN }), t.Null()])),
  reorderPoint: t.Optional(t.Union([t.String({ pattern: QTY_PATTERN }), t.Null()])),
  defaultLocationId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
};

export const productBody = t.Object({
  ...details,
  tracksBatch: t.Optional(t.Boolean()),
  /** Only honoured from staff who may classify (product.classify). */
  salesClass: t.Optional(salesClass),
  controlledClass: t.Optional(controlledClass),
  units: t.Array(
    t.Object({
      name: text(40),
      multiplierToBase: t.String({ pattern: QTY_PATTERN }),
      sellPrice: t.Optional(price),
      isDefaultSale: t.Optional(t.Boolean()),
      isDefaultPurchase: t.Optional(t.Boolean()),
      barcodes: t.Optional(t.Array(barcode, { maxItems: 20 })),
    }),
    { minItems: 1, maxItems: 10 },
  ),
});

export const productPatchBody = t.Partial(t.Object(details));
export const productQuery = t.Object({
  q: t.Optional(t.String({ maxLength: 100 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
});
export const classifyBody = t.Object({
  salesClass,
  controlledClass,
  blockedForSale: t.Optional(t.Boolean()),
  reason: t.Optional(t.String({ maxLength: 500 })),
});
export const priceBody = t.Object({ sellPrice: price, reason: t.Optional(t.String({ maxLength: 500 })) });
export const barcodeBody = t.Object({ unitId: t.String({ format: "uuid" }), code: barcode });

/** US-CAT-1/2/3/5: a product with its units and barcodes, in one transaction. */
export async function createProductRoute(scope: TenantScope, body: Static<typeof productBody>): Promise<Reply> {
  const denied = await authorize(scope, "product.write");
  if (denied) return denied;

  const unitErrors = validateUnitSet(
    body.units.map((u, i) => ({ id: String(i), name: u.name, multiplierToBase: parseQty(u.multiplierToBase) })),
  );
  if (unitErrors.length > 0) return reply(422, { error: "INVALID_UNITS", details: unitErrors });

  const wantsClass = body.salesClass !== undefined || body.controlledClass !== undefined;
  if (wantsClass) {
    const cannotClassify = await authorize(scope, "product.classify");
    if (cannotClassify) return cannotClassify;
  }
  const classification =
    wantsClass && can(scope.member.role, "product.classify")
      ? {
          salesClass: body.salesClass ?? "OTC",
          controlledClass: body.controlledClass ?? "NONE",
          classifiedBy: scope.member.staffId,
        }
      : null;

  const product = await inTenant(scope, async (tx) => {
    const id = await createProduct(tx, scope.member.tenantId, body, classification);
    await audit(scope, tx, { action: "product.create", entityType: "product", entityId: id, after: { sku: body.sku, brandName: body.brandName } });
    if (classification) {
      await audit(scope, tx, {
        action: "product.classify",
        entityType: "product",
        entityId: id,
        before: null,
        after: { salesClass: classification.salesClass, controlledClass: classification.controlledClass },
      });
    }
    return getProduct(tx, id);
  });
  return reply(201, product);
}

export async function listProductsRoute(scope: TenantScope, query: Static<typeof productQuery>): Promise<Reply> {
  const denied = await authorize(scope, "product.read");
  if (denied) return denied;
  const products = await inTenant(scope, (tx) => listProducts(tx, { search: query.q, limit: query.limit }));
  return reply(200, { products });
}

export async function getProductRoute(scope: TenantScope, productId: string): Promise<Reply> {
  const denied = await authorize(scope, "product.read");
  if (denied) return denied;
  const product = await inTenant(scope, (tx) => getProduct(tx, productId));
  return product ? reply(200, product) : reply(404, { error: "PRODUCT_NOT_FOUND" });
}

export async function updateProductRoute(scope: TenantScope, productId: string, body: Static<typeof productPatchBody>): Promise<Reply> {
  const denied = await authorize(scope, "product.write");
  if (denied) return denied;
  const product = await inTenant(scope, async (tx) => {
    if (!(await updateProductDetails(tx, productId, body))) return null;
    await audit(scope, tx, { action: "product.update", entityType: "product", entityId: productId, after: body });
    return getProduct(tx, productId);
  });
  return product ? reply(200, product) : reply(404, { error: "PRODUCT_NOT_FOUND" });
}

/** US-CAT-4: a pharmacist's call, audited with before and after. Also unblocks sale. */
export async function classifyProductRoute(scope: TenantScope, productId: string, body: Static<typeof classifyBody>): Promise<Reply> {
  const denied = await authorize(scope, "product.classify");
  if (denied) return denied;
  const product = await inTenant(scope, async (tx) => {
    const change = await classifyProduct(
      tx,
      productId,
      { salesClass: body.salesClass, controlledClass: body.controlledClass, blockedForSale: body.blockedForSale ?? false },
      scope.member.staffId,
    );
    if (!change) return null;
    await audit(scope, tx, {
      action: "product.classify",
      entityType: "product",
      entityId: productId,
      before: change.before,
      after: change.after,
      reason: body.reason ?? null,
    });
    return getProduct(tx, productId);
  });
  return product ? reply(200, product) : reply(404, { error: "PRODUCT_NOT_FOUND" });
}

/** US-CAT-7: every price change is in the audit trail, which is the price history. */
export async function setPriceRoute(scope: TenantScope, productId: string, unitId: string, body: Static<typeof priceBody>): Promise<Reply> {
  const denied = await authorize(scope, "price.update");
  if (denied) return denied;
  const product = await inTenant(scope, async (tx) => {
    const change = await setUnitPrice(tx, productId, unitId, body.sellPrice);
    if (!change) return null;
    await audit(scope, tx, {
      action: "price.update",
      entityType: "product_unit",
      entityId: unitId,
      before: change.before,
      after: change.after,
      reason: body.reason ?? null,
    });
    return getProduct(tx, productId);
  });
  return product ? reply(200, product) : reply(404, { error: "UNIT_NOT_FOUND" });
}

export async function addBarcodeRoute(scope: TenantScope, productId: string, body: Static<typeof barcodeBody>): Promise<Reply> {
  const denied = await authorize(scope, "product.write");
  if (denied) return denied;
  const product = await inTenant(scope, async (tx) => {
    if (!(await addBarcode(tx, scope.member.tenantId, productId, body.unitId, body.code))) return null;
    return getProduct(tx, productId);
  });
  return product ? reply(201, product) : reply(404, { error: "UNIT_NOT_FOUND" });
}

export async function removeBarcodeRoute(scope: TenantScope, productId: string, code: string): Promise<Reply> {
  const denied = await authorize(scope, "product.write");
  if (denied) return denied;
  const removed = await inTenant(scope, (tx) => removeBarcode(tx, productId, code));
  return removed ? reply(204, null) : reply(404, { error: "BARCODE_NOT_FOUND" });
}
