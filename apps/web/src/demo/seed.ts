import { parseQty, type BatchStatus, type ProductUnit, type Qty } from "@apotek/domain";

/**
 * Sample data only. Expiry dates are offsets from "today" so the demo and the
 * hero card read the same whenever the page is opened or built. Prices are
 * illustrative, not market prices.
 */
export type SalesClass = "OTC" | "RX_REQUIRED";

export interface DemoUnit extends ProductUnit {
  /** Sell price for one of this unit, in rupiah. */
  price: number;
}

export interface DemoProduct {
  id: string;
  name: string;
  strength: string;
  salesClass: SalesClass;
  units: DemoUnit[];
  defaultUnitId: string;
}

export interface DemoBatch {
  id: string;
  productId: string;
  batchNumber: string;
  expiryOffsetDays: number;
  receivedOffsetDays: number;
  status: BatchStatus;
  openingQty: Qty;
}

export const LOCATION_ID = "rak-depan";
export const NEAR_EXPIRY_DAYS = 90;

const unit = (id: string, name: string, multiplier: string, price: number): DemoUnit => ({
  id,
  name,
  multiplierToBase: parseQty(multiplier),
  price,
});

export const PRODUCTS: DemoProduct[] = [
  {
    id: "pct",
    name: "Paracetamol",
    strength: "500 mg",
    salesClass: "OTC",
    units: [unit("pct-tab", "tablet", "1", 500), unit("pct-strip", "strip", "10", 4_500), unit("pct-box", "box", "100", 42_000)],
    defaultUnitId: "pct-strip",
  },
  {
    id: "vitc",
    name: "Vitamin C",
    strength: "500 mg",
    salesClass: "OTC",
    units: [unit("vitc-tab", "tablet", "1", 700), unit("vitc-strip", "strip", "10", 6_500), unit("vitc-box", "box", "100", 60_000)],
    defaultUnitId: "vitc-strip",
  },
  {
    id: "amx",
    name: "Amoxicillin",
    strength: "500 mg",
    salesClass: "RX_REQUIRED",
    units: [unit("amx-cap", "kapsul", "1", 900), unit("amx-strip", "strip", "10", 8_500), unit("amx-box", "box", "100", 80_000)],
    defaultUnitId: "amx-strip",
  },
];

export const BATCHES: DemoBatch[] = [
  { id: "pct-a", productId: "pct", batchNumber: "PCT-24A11", expiryOffsetDays: -6, receivedOffsetDays: -400, status: "AVAILABLE", openingQty: parseQty("30") },
  { id: "pct-b", productId: "pct", batchNumber: "PCT-25C07", expiryOffsetDays: 38, receivedOffsetDays: -210, status: "AVAILABLE", openingQty: parseQty("14") },
  { id: "pct-c", productId: "pct", batchNumber: "PCT-26F02", expiryOffsetDays: 412, receivedOffsetDays: -12, status: "AVAILABLE", openingQty: parseQty("200") },
  { id: "vitc-a", productId: "vitc", batchNumber: "VTC-25H19", expiryOffsetDays: 71, receivedOffsetDays: -150, status: "AVAILABLE", openingQty: parseQty("40") },
  { id: "vitc-b", productId: "vitc", batchNumber: "VTC-26B03", expiryOffsetDays: 530, receivedOffsetDays: -20, status: "AVAILABLE", openingQty: parseQty("300") },
  { id: "amx-a", productId: "amx", batchNumber: "AMX-26A22", expiryOffsetDays: 300, receivedOffsetDays: -30, status: "AVAILABLE", openingQty: parseQty("100") },
];

export const productById = (id: string): DemoProduct => {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`Unknown demo product ${id}`);
  return product;
};

export const unitById = (product: DemoProduct, unitId: string): DemoUnit => {
  const found = product.units.find((u) => u.id === unitId);
  if (!found) throw new Error(`Unknown unit ${unitId} for ${product.id}`);
  return found;
};

export const baseUnitOf = (product: DemoProduct): DemoUnit =>
  product.units.reduce((smallest, u) => (u.multiplierToBase < smallest.multiplierToBase ? u : smallest));
