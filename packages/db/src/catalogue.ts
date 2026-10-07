import { formatQty, parseQty } from "@apotek/domain";
import type { Tx } from "./client";

/**
 * Catalogue reads and writes (US-CAT-1..7). Every function runs inside `withContext`,
 * so row-level security scopes it to the caller's tenant; ids from another tenant
 * simply aren't found.
 */

export const SALES_CLASSES = ["OTC", "OTC_LIMITED", "RX_REQUIRED"] as const;
export type SalesClass = (typeof SALES_CLASSES)[number];
export const CONTROLLED_CLASSES = ["NONE", "NARCOTIC", "PSYCHOTROPIC", "PRECURSOR"] as const;
export type ControlledClass = (typeof CONTROLLED_CLASSES)[number];

export interface UnitInput {
  name: string;
  /** Decimal string, e.g. "10" for a strip of ten tablets. */
  multiplierToBase: string;
  /** Whole rupiah; null when the unit is not sold. */
  sellPrice?: number | null;
  isDefaultSale?: boolean;
  isDefaultPurchase?: boolean;
  barcodes?: string[];
}

export interface ProductDetails {
  sku: string;
  brandName: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  route?: string | null;
  manufacturer?: string | null;
  kfaCode?: string | null;
  bpomNie?: string | null;
  coldChain?: boolean;
  category?: string | null;
  packageDescription?: string | null;
  compoundingIngredient?: boolean;
  /** Stock levels in base units, decimal strings (PRD-7). */
  minStock?: string | null;
  maxStock?: string | null;
  safetyStock?: string | null;
  reorderPoint?: string | null;
  defaultLocationId?: string | null;
}

export interface ProductInput extends ProductDetails {
  tracksBatch?: boolean;
  units: UnitInput[];
}

export interface Classification {
  salesClass: SalesClass;
  controlledClass: ControlledClass;
}

export interface ProductView extends Required<ProductDetails> {
  id: string;
  tracksBatch: boolean;
  salesClass: SalesClass;
  controlledClass: ControlledClass;
  blockedForSale: boolean;
  classifiedAt: string | null;
  classifiedBy: string | null;
  /** Classified and not blocked: the counter may sell it. */
  sellable: boolean;
  units: {
    id: string;
    name: string;
    multiplierToBase: string;
    sellPrice: number | null;
    isDefaultSale: boolean;
    isDefaultPurchase: boolean;
    barcodes: string[];
  }[];
}

/**
 * Creates the product with all its units and barcodes in the caller's transaction.
 * `classifiedBy` is set only when the creator may classify (product.classify);
 * otherwise the product stays unclassified and unsellable until a pharmacist does.
 */
export async function createProduct(
  tx: Tx,
  tenantId: string,
  input: ProductInput,
  classification: (Classification & { classifiedBy: string }) | null,
): Promise<string> {
  const [product] = await tx<{ id: string }[]>`
    insert into app.products (
      tenant_id, sku, brand_name, generic_name, strength, dosage_form, route, manufacturer,
      kfa_code, bpom_nie, cold_chain, category, package_description, compounding_ingredient, min_stock, max_stock,
      safety_stock, reorder_point, default_location_id, tracks_batch, sales_class, controlled_class, classified_at, classified_by
    ) values (
      ${tenantId}, ${input.sku.trim()}, ${input.brandName.trim()}, ${input.genericName ?? null}, ${input.strength ?? null},
      ${input.dosageForm ?? null}, ${input.route ?? null}, ${input.manufacturer ?? null}, ${input.kfaCode ?? null},
      ${input.bpomNie ?? null}, ${input.coldChain ?? false}, ${input.category ?? null}, ${input.packageDescription ?? null},
      ${input.compoundingIngredient ?? false}, ${input.minStock ?? null}, ${input.maxStock ?? null}, ${input.safetyStock ?? null},
      ${input.reorderPoint ?? null}, ${input.defaultLocationId ?? null}, ${input.tracksBatch ?? true},
      ${classification?.salesClass ?? "OTC"}, ${classification?.controlledClass ?? "NONE"},
      ${classification ? tx`now()` : null}, ${classification?.classifiedBy ?? null}
    )
    returning id
  `;
  const productId = product!.id;
  for (const unit of input.units) {
    const [row] = await tx<{ id: string }[]>`
      insert into app.product_units
        (tenant_id, product_id, name, multiplier_to_base, sell_price, is_default_sale, is_default_purchase)
      values (
        ${tenantId}, ${productId}, ${unit.name.trim()}, ${unit.multiplierToBase}, ${unit.sellPrice ?? null},
        ${unit.isDefaultSale ?? false}, ${unit.isDefaultPurchase ?? false}
      )
      returning id
    `;
    for (const code of unit.barcodes ?? []) {
      await tx`insert into app.product_barcodes (tenant_id, product_id, unit_id, code)
               values (${tenantId}, ${productId}, ${row!.id}, ${code.trim()})`;
    }
  }
  return productId;
}

type ProductRow = {
  id: string;
  sku: string;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  route: string | null;
  manufacturer: string | null;
  kfa_code: string | null;
  bpom_nie: string | null;
  cold_chain: boolean;
  category: string | null;
  package_description: string | null;
  compounding_ingredient: boolean;
  min_stock: string | null;
  max_stock: string | null;
  safety_stock: string | null;
  reorder_point: string | null;
  default_location_id: string | null;
  tracks_batch: boolean;
  sales_class: SalesClass;
  controlled_class: ControlledClass;
  blocked_for_sale: boolean;
  classified_at: Date | null;
  classified_by: string | null;
  units: {
    id: string;
    name: string;
    multiplier_to_base: string;
    sell_price: number | null;
    is_default_sale: boolean;
    is_default_purchase: boolean;
    barcodes: string[];
  }[];
};

const level = (value: string | null) => (value === null ? null : formatQty(parseQty(value)));

const toView = (row: ProductRow): ProductView => ({
  id: row.id,
  sku: row.sku,
  brandName: row.brand_name,
  genericName: row.generic_name,
  strength: row.strength,
  dosageForm: row.dosage_form,
  route: row.route,
  manufacturer: row.manufacturer,
  kfaCode: row.kfa_code,
  bpomNie: row.bpom_nie,
  coldChain: row.cold_chain,
  category: row.category,
  packageDescription: row.package_description,
  compoundingIngredient: row.compounding_ingredient,
  minStock: level(row.min_stock),
  maxStock: level(row.max_stock),
  safetyStock: level(row.safety_stock),
  reorderPoint: level(row.reorder_point),
  defaultLocationId: row.default_location_id,
  tracksBatch: row.tracks_batch,
  salesClass: row.sales_class,
  controlledClass: row.controlled_class,
  blockedForSale: row.blocked_for_sale,
  classifiedAt: row.classified_at ? row.classified_at.toISOString() : null,
  classifiedBy: row.classified_by,
  sellable: row.classified_at !== null && !row.blocked_for_sale,
  units: row.units.map((u) => ({
    id: u.id,
    name: u.name,
    // numeric(18,4) arrives as text ("10.0000"); the domain formatter gives "10".
    multiplierToBase: formatQty(parseQty(String(u.multiplier_to_base))),
    sellPrice: u.sell_price === null ? null : Number(u.sell_price),
    isDefaultSale: u.is_default_sale,
    isDefaultPurchase: u.is_default_purchase,
    barcodes: u.barcodes,
  })),
});

/** Products with units (base unit first) and barcodes. `ids` or `search` narrows. */
async function selectProducts(tx: Tx, filter: { id?: string; skus?: string[]; search?: string; limit: number }): Promise<ProductView[]> {
  const pattern = filter.search ? `%${filter.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await tx<ProductRow[]>`
    select p.id, p.sku, p.brand_name, p.generic_name, p.strength, p.dosage_form, p.route, p.manufacturer,
      p.kfa_code, p.bpom_nie, p.cold_chain, p.category, p.package_description, p.compounding_ingredient,
      p.min_stock::text as min_stock, p.max_stock::text as max_stock, p.safety_stock::text as safety_stock,
      p.reorder_point::text as reorder_point, p.default_location_id, p.tracks_batch, p.sales_class::text as sales_class,
      p.controlled_class::text as controlled_class, p.blocked_for_sale, p.classified_at, p.classified_by,
      coalesce((
        select json_agg(json_build_object(
          'id', u.id, 'name', u.name, 'multiplier_to_base', u.multiplier_to_base::text, 'sell_price', u.sell_price,
          'is_default_sale', u.is_default_sale, 'is_default_purchase', u.is_default_purchase,
          'barcodes', coalesce((select json_agg(b.code order by b.code) from app.product_barcodes b where b.unit_id = u.id), '[]')
        ) order by u.multiplier_to_base, u.name)
        from app.product_units u where u.product_id = p.id
      ), '[]') as units
    from app.products p
    where ${filter.id ? tx`p.id = ${filter.id}` : tx`true`}
      and ${filter.skus ? tx`p.sku = any(${filter.skus})` : tx`true`}
      and ${
        pattern
          ? tx`(p.sku ilike ${pattern} or p.brand_name ilike ${pattern} or p.generic_name ilike ${pattern}
                or p.kfa_code ilike ${pattern}
                or exists (select 1 from app.product_barcodes b where b.product_id = p.id and b.code = ${filter.search!.trim()}))`
          : tx`true`
      }
    order by p.brand_name, p.strength nulls first, p.sku
    limit ${filter.limit}
  `;
  return rows.map(toView);
}

export async function getProduct(tx: Tx, productId: string): Promise<ProductView | null> {
  return (await selectProducts(tx, { id: productId, limit: 1 }))[0] ?? null;
}

export function productsBySku(tx: Tx, skus: string[]): Promise<ProductView[]> {
  return skus.length === 0 ? Promise.resolve([]) : selectProducts(tx, { skus, limit: skus.length });
}

export function listProducts(tx: Tx, opts: { search?: string; limit?: number } = {}): Promise<ProductView[]> {
  return selectProducts(tx, { search: opts.search?.trim() || undefined, limit: opts.limit ?? 50 });
}

/** Descriptive fields only. Classification, prices and units have their own paths. */
export async function updateProductDetails(tx: Tx, productId: string, patch: Partial<ProductDetails>): Promise<boolean> {
  const columns: Record<string, unknown> = {};
  const map: Record<keyof ProductDetails, string> = {
    sku: "sku",
    brandName: "brand_name",
    genericName: "generic_name",
    strength: "strength",
    dosageForm: "dosage_form",
    route: "route",
    manufacturer: "manufacturer",
    kfaCode: "kfa_code",
    bpomNie: "bpom_nie",
    coldChain: "cold_chain",
    category: "category",
    packageDescription: "package_description",
    compoundingIngredient: "compounding_ingredient",
    minStock: "min_stock",
    maxStock: "max_stock",
    safetyStock: "safety_stock",
    reorderPoint: "reorder_point",
    defaultLocationId: "default_location_id",
  };
  for (const [key, column] of Object.entries(map) as [keyof ProductDetails, string][]) {
    if (patch[key] !== undefined) columns[column] = typeof patch[key] === "string" ? (patch[key] as string).trim() : patch[key];
  }
  if (Object.keys(columns).length === 0) return (await getProduct(tx, productId)) !== null;
  columns.updated_at = new Date();
  const result = await tx`update app.products set ${tx(columns)} where id = ${productId}`;
  return result.count === 1;
}

export interface Change<T> {
  before: T;
  after: T;
}

/** US-CAT-4. Returns before/after for the audit trail, or null if the product isn't there. */
export async function classifyProduct(
  tx: Tx,
  productId: string,
  next: Classification & { blockedForSale: boolean },
  staffId: string,
): Promise<Change<Classification & { blockedForSale: boolean; classified: boolean }> | null> {
  const [current] = await tx<
    { sales_class: SalesClass; controlled_class: ControlledClass; blocked_for_sale: boolean; classified_at: Date | null }[]
  >`
    select sales_class::text as sales_class, controlled_class::text as controlled_class, blocked_for_sale, classified_at
    from app.products where id = ${productId} for update
  `;
  if (!current) return null;
  await tx`
    update app.products
    set sales_class = ${next.salesClass}, controlled_class = ${next.controlledClass}, blocked_for_sale = ${next.blockedForSale},
        classified_at = now(), classified_by = ${staffId}, updated_at = now()
    where id = ${productId}
  `;
  return {
    before: {
      salesClass: current.sales_class,
      controlledClass: current.controlled_class,
      blockedForSale: current.blocked_for_sale,
      classified: current.classified_at !== null,
    },
    after: { ...next, classified: true },
  };
}

/** US-CAT-7. The audit trail is the price history. */
export async function setUnitPrice(
  tx: Tx,
  productId: string,
  unitId: string,
  sellPrice: number | null,
): Promise<Change<{ unit: string; sellPrice: number | null }> | null> {
  const [current] = await tx<{ name: string; sell_price: string | null }[]>`
    select name, sell_price from app.product_units where id = ${unitId} and product_id = ${productId} for update
  `;
  if (!current) return null;
  await tx`update app.product_units set sell_price = ${sellPrice} where id = ${unitId}`;
  const before = current.sell_price === null ? null : Number(current.sell_price);
  return { before: { unit: current.name, sellPrice: before }, after: { unit: current.name, sellPrice } };
}

export async function addBarcode(tx: Tx, tenantId: string, productId: string, unitId: string, code: string): Promise<boolean> {
  const [unit] = await tx`select 1 from app.product_units where id = ${unitId} and product_id = ${productId}`;
  if (!unit) return false;
  await tx`insert into app.product_barcodes (tenant_id, product_id, unit_id, code) values (${tenantId}, ${productId}, ${unitId}, ${code.trim()})`;
  return true;
}

export async function removeBarcode(tx: Tx, productId: string, code: string): Promise<boolean> {
  const result = await tx`delete from app.product_barcodes where product_id = ${productId} and code = ${code}`;
  return result.count > 0;
}
