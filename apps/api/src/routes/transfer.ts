import { can, formatQty, parseQty, toBase, validateUnitSet } from "@apotek/domain";
import {
  CONTROLLED_CLASSES,
  createProduct,
  listBranches,
  listProducts,
  productsBySku,
  recordOpeningBalance,
  SALES_CLASSES,
  type ControlledClass,
  type OpeningBalanceLine,
  type ProductInput,
  type ProductView,
  type SalesClass,
  type Tx,
} from "@apotek/db";
import { CsvError, normaliseDecimal, parseCsv, toCsv, type ParsedCsv } from "../csv";
import { audit, authorize, inTenant, reply, visibleBranches, type Reply, type TenantScope } from "../scope";

/**
 * FND-7: CSV import of products and opening stock, CSV export of the main lists.
 * Imports are all-or-nothing: every row is checked first and any problem is reported
 * by line, with nothing written. `?dryRun=true` only checks. Product export uses the
 * import columns, so a file can go out, be edited in a spreadsheet, and come back.
 */

const MAX_BYTES = 2_000_000;
const MAX_ROWS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRODUCT_COLUMNS = [
  "sku",
  "brand_name",
  "generic_name",
  "strength",
  "dosage_form",
  "route",
  "manufacturer",
  "category",
  "package_description",
  "kfa_code",
  "bpom_nie",
  "tracks_batch",
  "cold_chain",
  "compounding_ingredient",
  "sales_class",
  "controlled_class",
  "unit_name",
  "multiplier_to_base",
  "sell_price",
  "barcode",
  "is_default_sale",
  "is_default_purchase",
] as const;

export const OPENING_STOCK_COLUMNS = [
  "sku",
  "branch",
  "location",
  "unit_name",
  "qty",
  "batch_number",
  "expiry_date",
  "purchase_cost_per_base",
] as const;

export interface ImportProblem {
  line: number;
  column?: string;
  code: string;
}

type Row = ParsedCsv["rows"][number];

const TRUE = new Set(["1", "true", "yes", "ya", "y"]);
const FALSE = new Set(["", "0", "false", "no", "tidak", "n"]);
function flag(row: Row, column: string, problems: ImportProblem[], fallback: boolean): boolean {
  const raw = (row.values[column] ?? "").toLowerCase();
  if (raw === "") return fallback;
  if (TRUE.has(raw)) return true;
  if (FALSE.has(raw)) return false;
  problems.push({ line: row.line, column, code: "NOT_A_YES_NO" });
  return fallback;
}

const QTY = /^\d{1,14}(\.\d{1,4})?$/;

/** YYYY-MM-DD, or DD/MM/YYYY as Indonesian spreadsheets write it. */
function parseDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const [y, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : local ? [local[3]!, local[2]!.padStart(2, "0"), local[1]!.padStart(2, "0")] : [];
  if (!y) return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}` ? null : `${y}-${m}-${d}`;
}

function readCsv(body: unknown, required: readonly string[]): { csv: ParsedCsv } | { problems: ImportProblem[] } {
  if (typeof body !== "string" || body.length === 0) return { problems: [{ line: 1, code: "EMPTY_FILE" }] };
  if (body.length > MAX_BYTES) return { problems: [{ line: 1, code: "FILE_TOO_LARGE" }] };
  try {
    const csv = parseCsv(body, { maxRows: MAX_ROWS });
    const missing = required.filter((c) => !csv.header.includes(c));
    if (missing.length > 0) return { problems: missing.map((column) => ({ line: 1, column, code: "MISSING_COLUMN" })) };
    return { csv };
  } catch (error) {
    if (error instanceof CsvError) return { problems: [{ line: error.line, code: "MALFORMED_CSV" }] };
    throw error;
  }
}

const report = (dryRun: boolean, problems: ImportProblem[], summary: Record<string, number>): Reply =>
  problems.length > 0
    ? reply(dryRun ? 200 : 422, { dryRun, valid: false, problems: problems.sort((a, b) => a.line - b.line), summary })
    : reply(dryRun ? 200 : 201, { dryRun, valid: true, problems: [], summary });

/** Rows grouped by SKU: a product, then one row per unit. */
function productsFromCsv(csv: ParsedCsv, mayClassify: boolean, problems: ImportProblem[]) {
  const groups = new Map<string, Row[]>();
  for (const row of csv.rows) {
    const sku = row.values.sku ?? "";
    if (!sku) {
      problems.push({ line: row.line, column: "sku", code: "REQUIRED" });
      continue;
    }
    groups.set(sku, [...(groups.get(sku) ?? []), row]);
  }
  const products: { line: number; input: ProductInput; classification: { salesClass: SalesClass; controlledClass: ControlledClass } | null }[] = [];
  for (const [sku, rows] of groups) {
    const first = rows[0]!;
    const value = (column: string) => rows.map((r) => r.values[column] ?? "").find((v) => v !== "") ?? "";
    const optional = (column: string, max: number) => {
      const v = value(column);
      if (v.length > max) problems.push({ line: first.line, column, code: "TOO_LONG" });
      return v === "" ? null : v;
    };
    const brandName = value("brand_name");
    if (!brandName) problems.push({ line: first.line, column: "brand_name", code: "REQUIRED" });
    if (sku.length > 64) problems.push({ line: first.line, column: "sku", code: "TOO_LONG" });

    const salesRaw = value("sales_class").toUpperCase();
    const controlledRaw = value("controlled_class").toUpperCase();
    let classification: (typeof products)[number]["classification"] = null;
    if (salesRaw || controlledRaw) {
      if (!mayClassify) problems.push({ line: first.line, column: "sales_class", code: "NEEDS_PRODUCT_CLASSIFY" });
      if (salesRaw && !(SALES_CLASSES as readonly string[]).includes(salesRaw)) problems.push({ line: first.line, column: "sales_class", code: "UNKNOWN_VALUE" });
      if (controlledRaw && !(CONTROLLED_CLASSES as readonly string[]).includes(controlledRaw)) {
        problems.push({ line: first.line, column: "controlled_class", code: "UNKNOWN_VALUE" });
      }
      classification = { salesClass: (salesRaw || "OTC") as SalesClass, controlledClass: (controlledRaw || "NONE") as ControlledClass };
    }

    const units: ProductInput["units"] = [];
    for (const row of rows) {
      const name = row.values.unit_name ?? "";
      const multiplier = normaliseDecimal(row.values.multiplier_to_base ?? "", csv.delimiter);
      // Whole rupiah: plain digits, or Indonesian thousands grouping like 4.500 or 42.000.
      const rawPrice = (row.values.sell_price ?? "").replace(/\s/g, "");
      const price = /^\d{1,3}(\.\d{3})+$/.test(rawPrice) ? rawPrice.replace(/\./g, "") : rawPrice;
      if (!name) problems.push({ line: row.line, column: "unit_name", code: "REQUIRED" });
      if (!QTY.test(multiplier)) problems.push({ line: row.line, column: "multiplier_to_base", code: "NOT_A_QUANTITY" });
      if (price !== "" && !/^\d{1,10}$/.test(price)) problems.push({ line: row.line, column: "sell_price", code: "NOT_WHOLE_RUPIAH" });
      const barcode = row.values.barcode ?? "";
      if (barcode && !/^\S{1,64}$/.test(barcode)) problems.push({ line: row.line, column: "barcode", code: "INVALID_BARCODE" });
      units.push({
        name,
        multiplierToBase: QTY.test(multiplier) ? multiplier : "0",
        sellPrice: price === "" ? null : Number(price),
        isDefaultSale: flag(row, "is_default_sale", problems, false),
        isDefaultPurchase: flag(row, "is_default_purchase", problems, false),
        barcodes: barcode ? [barcode] : [],
      });
    }
    // Only check the unit set once every multiplier parsed: one cause, one reported problem.
    if (rows.every((r) => QTY.test(normaliseDecimal(r.values.multiplier_to_base ?? "", csv.delimiter)))) {
      const unitErrors = validateUnitSet(units.map((u, i) => ({ id: String(i), name: u.name, multiplierToBase: parseQty(u.multiplierToBase) })));
      for (const e of unitErrors) problems.push({ line: first.line, column: "unit_name", code: e.kind });
    }

    products.push({
      line: first.line,
      classification,
      input: {
        sku,
        brandName,
        genericName: optional("generic_name", 160),
        strength: optional("strength", 60),
        dosageForm: optional("dosage_form", 60),
        route: optional("route", 60),
        manufacturer: optional("manufacturer", 160),
        category: optional("category", 80),
        packageDescription: optional("package_description", 160),
        kfaCode: optional("kfa_code", 64),
        bpomNie: optional("bpom_nie", 64),
        tracksBatch: flag(first, "tracks_batch", problems, true),
        coldChain: flag(first, "cold_chain", problems, false),
        compoundingIngredient: flag(first, "compounding_ingredient", problems, false),
        units,
      },
    });
  }
  return products;
}

async function checkAgainstCatalogue(tx: Tx, products: ReturnType<typeof productsFromCsv>, problems: ImportProblem[]) {
  const skus = products.map((p) => p.input.sku);
  const existing = new Set((await tx<{ sku: string }[]>`select sku from app.products where sku = any(${skus})`).map((r) => r.sku));
  const barcodeLines = new Map<string, number>();
  for (const p of products) {
    if (existing.has(p.input.sku)) problems.push({ line: p.line, column: "sku", code: "SKU_EXISTS" });
    for (const code of p.input.units.flatMap((u) => u.barcodes ?? [])) {
      if (barcodeLines.has(code)) problems.push({ line: p.line, column: "barcode", code: "DUPLICATE_IN_FILE" });
      barcodeLines.set(code, p.line);
    }
  }
  const codes = [...barcodeLines.keys()];
  if (codes.length > 0) {
    for (const r of await tx<{ code: string }[]>`select code from app.product_barcodes where code = any(${codes})`) {
      problems.push({ line: barcodeLines.get(r.code)!, column: "barcode", code: "BARCODE_EXISTS" });
    }
  }
}

export async function importProductsRoute(scope: TenantScope, body: unknown, dryRun: boolean): Promise<Reply> {
  const denied = await authorize(scope, "product.write");
  if (denied) return denied;
  const read = readCsv(body, ["sku", "brand_name", "unit_name", "multiplier_to_base"]);
  if ("problems" in read) return report(dryRun, read.problems, { products: 0, units: 0 });
  const problems: ImportProblem[] = [];
  const products = productsFromCsv(read.csv, can(scope.member.role, "product.classify"), problems);
  const summary = { products: products.length, units: products.reduce((n, p) => n + p.input.units.length, 0) };

  const outcome = await inTenant(scope, async (tx) => {
    await checkAgainstCatalogue(tx, products, problems);
    if (problems.length > 0 || dryRun) return report(dryRun, problems, summary);
    for (const p of products) {
      const classification = p.classification ? { ...p.classification, classifiedBy: scope.member.staffId } : null;
      const id = await createProduct(tx, scope.member.tenantId, p.input, classification);
      if (classification) {
        await audit(scope, tx, {
          action: "product.classify",
          entityType: "product",
          entityId: id,
          before: null,
          after: { salesClass: classification.salesClass, controlledClass: classification.controlledClass },
          reason: "Impor CSV",
        });
      }
    }
    await audit(scope, tx, { action: "import.products", entityType: "tenant", entityId: scope.member.tenantId, after: summary });
    return report(false, [], summary);
  });
  return outcome;
}

/** Opening stock for many products and locations, as one idempotent document. */
export async function importOpeningStockRoute(scope: TenantScope, body: unknown, dryRun: boolean): Promise<Reply> {
  const denied = await authorize(scope, "stock.opening_balance");
  if (denied) return denied;
  const documentId = scope.request.headers.get("idempotency-key") ?? "";
  if (!dryRun && !UUID.test(documentId)) return reply(400, { error: "IDEMPOTENCY_KEY_REQUIRED" });
  const read = readCsv(body, ["sku", "location", "unit_name", "qty"]);
  if ("problems" in read) return report(dryRun, read.problems, { lines: 0 });
  const { csv } = read;
  const problems: ImportProblem[] = [];

  return inTenant(scope, async (tx) => {
    const branches = await listBranches(tx, visibleBranches(scope.member));
    const skus = [...new Set(csv.rows.map((r) => r.values.sku ?? ""))].filter(Boolean);
    const products = new Map<string, ProductView>((await productsBySku(tx, skus)).map((p) => [p.sku, p]));

    const lines: OpeningBalanceLine[] = [];
    for (const row of csv.rows) {
      const v = row.values;
      const product = products.get(v.sku ?? "");
      if (!product) {
        problems.push({ line: row.line, column: "sku", code: v.sku ? "UNKNOWN_SKU" : "REQUIRED" });
        continue;
      }
      const candidates = branches
        .filter((b) => !v.branch || b.name.toLowerCase() === v.branch.toLowerCase())
        .flatMap((b) => b.locations.filter((l) => l.name.toLowerCase() === (v.location ?? "").toLowerCase()).map((l) => ({ branchId: b.branchId, locationId: l.locationId })));
      if (candidates.length !== 1) {
        problems.push({ line: row.line, column: "location", code: candidates.length === 0 ? "UNKNOWN_LOCATION" : "AMBIGUOUS_LOCATION" });
        continue;
      }
      const unit = product.units.find((u) => u.name.toLowerCase() === (v.unit_name ?? "").toLowerCase());
      if (!unit) {
        problems.push({ line: row.line, column: "unit_name", code: "UNKNOWN_UNIT" });
        continue;
      }
      const qtyText = normaliseDecimal(v.qty ?? "", csv.delimiter);
      if (!QTY.test(qtyText) || parseQty(qtyText) <= 0n) {
        problems.push({ line: row.line, column: "qty", code: "NOT_A_POSITIVE_QUANTITY" });
        continue;
      }
      const base = toBase(parseQty(qtyText), { id: unit.id, name: unit.name, multiplierToBase: parseQty(unit.multiplierToBase) });
      if (!base.ok) {
        problems.push({ line: row.line, column: "qty", code: "INEXACT_CONVERSION" });
        continue;
      }
      let batch: OpeningBalanceLine["batch"] = null;
      if (product.tracksBatch) {
        const expiry = parseDate(v.expiry_date ?? "");
        if (!v.batch_number) problems.push({ line: row.line, column: "batch_number", code: "REQUIRED" });
        if (!expiry) problems.push({ line: row.line, column: "expiry_date", code: v.expiry_date ? "NOT_A_DATE" : "REQUIRED" });
        const cost = normaliseDecimal(v.purchase_cost_per_base ?? "", csv.delimiter);
        if (cost && !QTY.test(cost)) problems.push({ line: row.line, column: "purchase_cost_per_base", code: "NOT_A_QUANTITY" });
        if (!v.batch_number || !expiry) continue;
        batch = { batchNumber: v.batch_number, expiryDate: expiry, purchaseCostPerBase: cost || null };
      } else if (v.batch_number || v.expiry_date) {
        problems.push({ line: row.line, column: "batch_number", code: "BATCH_NOT_TRACKED" });
        continue;
      }
      lines.push({ ...candidates[0]!, productId: product.id, batch, baseQty: base.value, unitContext: { unit: unit.name, qty: formatQty(parseQty(qtyText)) } });
    }

    const summary = { lines: lines.length, products: new Set(lines.map((l) => l.productId)).size };
    if (problems.length > 0 || dryRun) return report(dryRun, problems, summary);
    const recorded = await recordOpeningBalance(tx, { tenantId: scope.member.tenantId, documentId, actorStaffId: scope.member.staffId, lines });
    if (!recorded.replayed) {
      await audit(scope, tx, {
        action: "stock.opening_balance",
        entityType: "tenant",
        entityId: scope.member.tenantId,
        after: { documentId, source: "csv", ...summary },
      });
    }
    return reply(recorded.replayed ? 200 : 201, { dryRun: false, valid: true, problems: [], summary, documentId, replayed: recorded.replayed });
  });
}

const csvResponse = (filename: string, text: string) =>
  new Response(`﻿${text}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
  });

/** Products in the import format, one row per unit. */
export async function exportProductsRoute(scope: TenantScope): Promise<Response | Reply> {
  const denied = await authorize(scope, "product.read");
  if (denied) return denied;
  const products = await inTenant(scope, (tx) => listProducts(tx, { limit: 1_000_000 }));
  const yes = (b: boolean) => (b ? "ya" : "tidak");
  const rows = products.flatMap((p) =>
    p.units.map((u) => [
      p.sku,
      p.brandName,
      p.genericName,
      p.strength,
      p.dosageForm,
      p.route,
      p.manufacturer,
      p.category,
      p.packageDescription,
      p.kfaCode,
      p.bpomNie,
      yes(p.tracksBatch),
      yes(p.coldChain),
      yes(p.compoundingIngredient),
      p.classifiedAt ? p.salesClass : "",
      p.classifiedAt ? p.controlledClass : "",
      u.name,
      u.multiplierToBase,
      u.sellPrice,
      u.barcodes.join(" "),
      yes(u.isDefaultSale),
      yes(u.isDefaultPurchase),
    ]),
  );
  return csvResponse("produk.csv", toCsv([...PRODUCT_COLUMNS], rows));
}

/** Balances per batch and location, in base units, for the caller's branches. */
export async function exportStockRoute(scope: TenantScope): Promise<Response | Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  const branches = visibleBranches(scope.member);
  const rows = await inTenant(scope, (tx) => tx<
    {
      sku: string;
      brand_name: string;
      strength: string | null;
      branch: string;
      location: string;
      batch_number: string | null;
      expiry_date: string | null;
      status: string | null;
      on_hand: string;
      reserved: string;
      base_unit: string;
    }[]
  >`
    select p.sku, p.brand_name, p.strength, br.name as branch, l.name as location, b.batch_number,
      b.expiry_date::text as expiry_date, b.status::text as status, bal.on_hand::text as on_hand,
      bal.reserved::text as reserved,
      (select u.name from app.product_units u where u.product_id = p.id and u.multiplier_to_base = 1) as base_unit
    from app.inventory_balances bal
    join app.products p on p.id = bal.product_id
    join app.locations l on l.id = bal.location_id
    join app.branches br on br.id = bal.branch_id
    left join app.batches b on b.id = bal.batch_id
    where ${branches ? tx`bal.branch_id = any(${branches}::uuid[])` : tx`true`}
    order by p.brand_name, p.sku, br.name, l.name, b.expiry_date nulls last`);
  const header = ["sku", "brand_name", "strength", "branch", "location", "batch_number", "expiry_date", "status", "on_hand", "reserved", "base_unit"];
  return csvResponse(
    "stok.csv",
    toCsv(
      header,
      rows.map((r) => [
        r.sku,
        r.brand_name,
        r.strength,
        r.branch,
        r.location,
        r.batch_number,
        r.expiry_date,
        r.status,
        formatQty(parseQty(r.on_hand)),
        formatQty(parseQty(r.reserved)),
        r.base_unit,
      ]),
    ),
  );
}

/** Empty files with the right columns, so nobody has to guess them. */
export function templateRoute(kind: "products" | "opening-stock"): Response {
  const columns = kind === "products" ? PRODUCT_COLUMNS : OPENING_STOCK_COLUMNS;
  return csvResponse(kind === "products" ? "template-produk.csv" : "template-stok-awal.csv", toCsv([...columns], []));
}
