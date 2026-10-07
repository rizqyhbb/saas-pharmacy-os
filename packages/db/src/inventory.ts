import { formatQty, parseQty, type BatchStatus, type Qty } from "@apotek/domain";
import type { Tx } from "./client";
import type { Change } from "./catalogue";
import { RuleError } from "./errors";

/**
 * Inventory writes go through here and nowhere else (ARCHITECTURE.md §4: only
 * inventory/ writes the ledger). The database applies each row to its balance and
 * enforces the stock rules; these functions add idempotency and the document link.
 */

export interface OpeningBalanceLine {
  branchId: string;
  locationId: string;
  productId: string;
  /** Null only for products that don't track batches. */
  batch: { batchNumber: string; expiryDate: string; purchaseCostPerBase?: string | null } | null;
  baseQty: Qty;
  /** What the user typed, for display: { unit: "box", qty: "5" }. */
  unitContext: { unit: string; qty: string };
}

export interface OpeningBalanceInput {
  tenantId: string;
  /** The client's idempotency key; also the opening-balance document id (L5). */
  documentId: string;
  actorStaffId: string;
  /** One or many products and locations: a CSV import is one document. */
  lines: OpeningBalanceLine[];
}

export interface OpeningBalanceResult {
  replayed: boolean;
  lines: { productId: string; locationId: string; batchId: string | null; baseQty: string }[];
}

const REFERENCE_TYPE = "opening_balance";

/**
 * Records opening stock (US-INV-2, B1). The same lot (batch number + expiry) arriving
 * again adds to the existing batch (B2). Sending the same document twice returns the
 * first result without a second effect (T10); reusing its key for different content
 * fails with IDEMPOTENCY_KEY_REUSED.
 */
export async function recordOpeningBalance(tx: Tx, input: OpeningBalanceInput): Promise<OpeningBalanceResult> {
  const existing = await tx<{ batch_id: string | null; qty: string; product_id: string; location_id: string }[]>`
    select batch_id, qty_delta_base::text as qty, product_id, location_id from app.inventory_ledger
    where reference_type = ${REFERENCE_TYPE} and reference_id = ${input.documentId}
    order by idempotency_key
  `;
  if (existing.length > 0) {
    const same =
      existing.length === input.lines.length &&
      existing.every((row, i) => {
        const line = input.lines[i]!;
        return row.product_id === line.productId && row.location_id === line.locationId && parseQty(row.qty) === line.baseQty;
      });
    if (!same) throw new RuleError("IDEMPOTENCY_KEY_REUSED", `document ${input.documentId} was recorded with different lines`);
    return {
      replayed: true,
      lines: existing.map((row) => ({
        productId: row.product_id,
        locationId: row.location_id,
        batchId: row.batch_id,
        baseQty: formatQty(parseQty(row.qty)),
      })),
    };
  }

  const lines: OpeningBalanceResult["lines"] = [];
  for (const [index, line] of input.lines.entries()) {
    let batchId: string | null = null;
    if (line.batch) {
      const [created] = await tx<{ id: string }[]>`
        insert into app.batches (tenant_id, product_id, batch_number, expiry_date, purchase_cost_per_base)
        values (${input.tenantId}, ${line.productId}, ${line.batch.batchNumber.trim()}, ${line.batch.expiryDate},
                ${line.batch.purchaseCostPerBase ?? null})
        on conflict (tenant_id, product_id, batch_number, expiry_date) do nothing
        returning id
      `;
      batchId =
        created?.id ??
        (
          await tx<{ id: string }[]>`
            select id from app.batches
            where product_id = ${line.productId} and batch_number = ${line.batch.batchNumber.trim()}
              and expiry_date = ${line.batch.expiryDate}`
        )[0]!.id;
    }
    await tx`
      insert into app.inventory_ledger (
        tenant_id, branch_id, location_id, product_id, batch_id, qty_delta_base, unit_context, event_type,
        reference_type, reference_id, actor_staff_id, idempotency_key
      ) values (
        ${input.tenantId}, ${line.branchId}, ${line.locationId}, ${line.productId}, ${batchId},
        ${formatQty(line.baseQty)}, ${tx.json(line.unitContext)}, 'OPENING_BALANCE',
        ${REFERENCE_TYPE}, ${input.documentId}, ${input.actorStaffId},
        ${`${input.documentId}/${String(index).padStart(5, "0")}`}
      )
    `;
    lines.push({ productId: line.productId, locationId: line.locationId, batchId, baseQty: formatQty(line.baseQty) });
  }
  return { replayed: false, lines };
}

/** Statuses a person may set. EXPIRED is computed nightly; DESTROYED needs the destruction flow. */
export const SETTABLE_BATCH_STATUSES = ["AVAILABLE", "QUARANTINE", "RECALLED"] as const satisfies readonly BatchStatus[];
export type SettableBatchStatus = (typeof SETTABLE_BATCH_STATUSES)[number];

export async function setBatchStatus(
  tx: Tx,
  batchId: string,
  status: SettableBatchStatus,
): Promise<(Change<{ status: BatchStatus }> & { productId: string; batchNumber: string }) | null> {
  const [current] = await tx<{ status: BatchStatus; product_id: string; batch_number: string }[]>`
    select status::text as status, product_id, batch_number from app.batches where id = ${batchId} for update
  `;
  if (!current) return null;
  if (current.status === "DESTROYED") throw new RuleError("BATCH_DESTROYED", "a destroyed batch cannot change status");
  await tx`update app.batches set status = ${status} where id = ${batchId}`;
  return { before: { status: current.status }, after: { status }, productId: current.product_id, batchNumber: current.batch_number };
}

export interface StockCard {
  batches: {
    batchId: string | null;
    batchNumber: string | null;
    expiryDate: string | null;
    status: BatchStatus | null;
    locationId: string;
    locationName: string;
    branchId: string;
    onHand: string;
    reserved: string;
    /** Today on the branch's clock, compared to expiry and status (B4, T3). */
    sellable: boolean;
  }[];
  ledger: {
    id: string;
    createdAt: string;
    eventType: string;
    batchNumber: string | null;
    locationName: string;
    qtyDeltaBase: string;
    unitContext: unknown;
    referenceType: string;
    referenceId: string;
    actor: string | null;
    conflictNegative: boolean;
  }[];
}

/** US-INV-9: where every batch of a product is, and every movement that got it there. */
export async function stockCard(tx: Tx, productId: string, opts: { branchIds?: string[]; ledgerLimit?: number } = {}): Promise<StockCard> {
  const branchFilter = opts.branchIds ? tx`and bal.branch_id = any(${opts.branchIds}::uuid[])` : tx``;
  const batches = await tx<
    {
      batch_id: string | null;
      batch_number: string | null;
      expiry_date: string | null;
      status: BatchStatus | null;
      location_id: string;
      location_name: string;
      branch_id: string;
      on_hand: string;
      reserved: string;
      sellable: boolean;
    }[]
  >`
    select bal.batch_id, b.batch_number, b.expiry_date::text as expiry_date, b.status::text as status,
      bal.location_id, l.name as location_name, bal.branch_id, bal.on_hand::text as on_hand, bal.reserved::text as reserved,
      (b.id is null or (b.status = 'AVAILABLE' and b.expiry_date >= (now() at time zone br.timezone)::date)) as sellable
    from app.inventory_balances bal
    join app.locations l on l.id = bal.location_id
    join app.branches br on br.id = bal.branch_id
    left join app.batches b on b.id = bal.batch_id
    where bal.product_id = ${productId} ${branchFilter}
    order by b.expiry_date nulls last, b.batch_number, l.name
  `;
  const ledgerBranchFilter = opts.branchIds ? tx`and le.branch_id = any(${opts.branchIds}::uuid[])` : tx``;
  const ledger = await tx<
    {
      id: string;
      created_at: Date;
      event_type: string;
      batch_number: string | null;
      location_name: string;
      qty: string;
      unit_context: unknown;
      reference_type: string;
      reference_id: string;
      actor: string | null;
      conflict_negative: boolean;
    }[]
  >`
    select le.id, le.created_at, le.event_type::text as event_type, b.batch_number, l.name as location_name,
      le.qty_delta_base::text as qty, le.unit_context, le.reference_type, le.reference_id,
      sm.display_name as actor, le.conflict_negative
    from app.inventory_ledger le
    join app.locations l on l.id = le.location_id
    left join app.batches b on b.id = le.batch_id
    left join app.staff_members sm on sm.id = le.actor_staff_id
    where le.product_id = ${productId} ${ledgerBranchFilter}
    order by le.created_at desc, le.idempotency_key desc
    limit ${opts.ledgerLimit ?? 100}
  `;
  return {
    batches: batches.map((row) => ({
      batchId: row.batch_id,
      batchNumber: row.batch_number,
      expiryDate: row.expiry_date,
      status: row.status,
      locationId: row.location_id,
      locationName: row.location_name,
      branchId: row.branch_id,
      onHand: formatQty(parseQty(row.on_hand)),
      reserved: formatQty(parseQty(row.reserved)),
      sellable: row.sellable,
    })),
    ledger: ledger.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      eventType: row.event_type,
      batchNumber: row.batch_number,
      locationName: row.location_name,
      qtyDeltaBase: formatQty(parseQty(row.qty)),
      unitContext: row.unit_context,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      actor: row.actor,
      conflictNegative: row.conflict_negative,
    })),
  };
}

/** The branch a location belongs to, or null when it isn't in the caller's tenant. */
export async function branchOfLocation(tx: Tx, locationId: string): Promise<string | null> {
  const [row] = await tx<{ branch_id: string }[]>`select branch_id from app.locations where id = ${locationId}`;
  return row?.branch_id ?? null;
}

/**
 * INV-8: fixes a mistyped batch number or expiry. Only through the database function,
 * which the API calls after checking batch.correct; the caller writes the audit event.
 */
export async function correctBatch(
  tx: Tx,
  batchId: string,
  next: { batchNumber: string; expiryDate: string },
): Promise<Change<{ batchNumber: string; expiryDate: string }> | null> {
  const [row] = await tx<{ old_batch_number: string; old_expiry_date: string }[]>`
    select old_batch_number, old_expiry_date::text as old_expiry_date
    from app.correct_batch(${batchId}, ${next.batchNumber}, ${next.expiryDate})`;
  if (!row) return null;
  return {
    before: { batchNumber: row.old_batch_number, expiryDate: row.old_expiry_date },
    after: { batchNumber: next.batchNumber.trim(), expiryDate: next.expiryDate },
  };
}
