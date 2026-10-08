import { saleBlockReason, type BatchStatus, type SaleBlockReason } from "./batch";
import type { CalendarDate } from "./dates";
import { sumQty, type Qty } from "./quantity";
import { err, ok, type Result } from "./result";

export interface AllocationCandidate {
  batchId: string;
  expiryDate: CalendarDate;
  receivedAt: Date;
  status: BatchStatus;
  /** on_hand − reserved for this batch at the selling location, in base units. */
  available: Qty;
}

export interface Allocation {
  batchId: string;
  qty: Qty;
}

export type InsufficientStock = {
  kind: "INSUFFICIENT_STOCK";
  requested: Qty;
  allocatable: Qty;
  shortfall: Qty;
};

function assertPositive(requested: Qty): void {
  if (requested <= 0n) throw new RangeError("Requested quantity must be positive");
}

function isAllocatable(candidate: AllocationCandidate, today: CalendarDate): boolean {
  return candidate.available > 0n && saleBlockReason(candidate, today) === null;
}

/**
 * First Expired, First Out (DOMAIN-MODEL.md §5). Takes from the earliest-expiring
 * sellable batch first; ties go to the batch received first, then batch id so the
 * result is deterministic. Never takes more than a batch has (T6) and never
 * touches an expired, quarantined, recalled or destroyed batch (T3).
 */
export function allocateFefo(
  requested: Qty,
  candidates: readonly AllocationCandidate[],
  today: CalendarDate,
): Result<Allocation[], InsufficientStock> {
  assertPositive(requested);
  const eligible = candidates
    .filter((candidate) => isAllocatable(candidate, today))
    .sort(
      (a, b) =>
        a.expiryDate.localeCompare(b.expiryDate) ||
        a.receivedAt.getTime() - b.receivedAt.getTime() ||
        a.batchId.localeCompare(b.batchId),
    );

  const allocatable = sumQty(eligible.map((candidate) => candidate.available));
  if (allocatable < requested) {
    return err({ kind: "INSUFFICIENT_STOCK", requested, allocatable, shortfall: requested - allocatable });
  }

  const allocations: Allocation[] = [];
  let remaining = requested;
  for (const candidate of eligible) {
    if (remaining === 0n) break;
    const take = candidate.available < remaining ? candidate.available : remaining;
    allocations.push({ batchId: candidate.batchId, qty: take });
    remaining -= take;
  }
  return ok(allocations);
}

export type ManualAllocationError =
  | { kind: "NON_POSITIVE_QTY"; batchId: string }
  | { kind: "DUPLICATE_BATCH"; batchId: string }
  | { kind: "UNKNOWN_BATCH"; batchId: string }
  | { kind: "BATCH_BLOCKED"; batchId: string; reason: SaleBlockReason }
  | { kind: "EXCEEDS_AVAILABLE"; batchId: string; requested: Qty; available: Qty }
  | { kind: "TOTAL_MISMATCH"; requested: Qty; allocated: Qty };

/**
 * Checks a pharmacist/manager's explicit batch choice. The override still may
 * not pick a blocked batch or exceed what a batch holds. Permission, reason and
 * the audit event are the API's job.
 */
export function validateManualAllocation(
  requested: Qty,
  allocations: readonly Allocation[],
  candidates: readonly AllocationCandidate[],
  today: CalendarDate,
): Result<Allocation[], ManualAllocationError[]> {
  assertPositive(requested);
  const byId = new Map(candidates.map((candidate) => [candidate.batchId, candidate]));
  const seen = new Set<string>();
  const errors: ManualAllocationError[] = [];

  for (const { batchId, qty } of allocations) {
    if (qty <= 0n) errors.push({ kind: "NON_POSITIVE_QTY", batchId });
    if (seen.has(batchId)) errors.push({ kind: "DUPLICATE_BATCH", batchId });
    seen.add(batchId);

    const candidate = byId.get(batchId);
    if (!candidate) {
      errors.push({ kind: "UNKNOWN_BATCH", batchId });
      continue;
    }
    const blocked = saleBlockReason(candidate, today);
    if (blocked) errors.push({ kind: "BATCH_BLOCKED", batchId, reason: blocked });
    if (qty > candidate.available) {
      errors.push({ kind: "EXCEEDS_AVAILABLE", batchId, requested: qty, available: candidate.available });
    }
  }

  const allocated = sumQty(allocations.map((allocation) => allocation.qty));
  if (allocated !== requested) errors.push({ kind: "TOTAL_MISMATCH", requested, allocated });

  return errors.length > 0 ? err(errors) : ok([...allocations]);
}

export interface SyncAllocation extends Allocation {
  /** True for the part that drove the balance negative: an offline-conflict row (ARCHITECTURE.md §9). */
  conflict: boolean;
}

export type SyncAllocationError = { kind: "NO_BATCH_AT_LOCATION" };

/**
 * Allocation for an offline sale arriving at the server (SYN-4). The goods already
 * left the shelf and the customer already paid, so the sale is never refused:
 * whatever sellable stock remains is taken by FEFO, and any shortfall is booked
 * against one batch as a flagged conflict for a person to reconcile. That batch is
 * the latest-expiring sellable one, else the batch the device itself recorded,
 * else the latest-expiring batch of any status.
 */
export function allocateForSync(
  requested: Qty,
  candidates: readonly AllocationCandidate[],
  today: CalendarDate,
  deviceBatchId?: string,
): Result<SyncAllocation[], SyncAllocationError> {
  assertPositive(requested);
  const full = allocateFefo(requested, candidates, today);
  if (full.ok) return ok(full.value.map((a) => ({ ...a, conflict: false })));

  const eligible = candidates
    .filter((candidate) => isAllocatable(candidate, today))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.batchId.localeCompare(b.batchId));
  const taken: SyncAllocation[] = eligible.map((c) => ({ batchId: c.batchId, qty: c.available, conflict: false }));
  const shortfall = requested - sumQty(taken.map((t) => t.qty));

  const latest = (list: readonly AllocationCandidate[]) =>
    [...list].sort((a, b) => b.expiryDate.localeCompare(a.expiryDate) || a.batchId.localeCompare(b.batchId))[0];
  const sellable = candidates.filter((c) => saleBlockReason(c, today) === null);
  const target =
    latest(sellable)?.batchId ??
    (deviceBatchId && candidates.some((c) => c.batchId === deviceBatchId) ? deviceBatchId : undefined) ??
    latest(candidates)?.batchId;
  if (!target) return err({ kind: "NO_BATCH_AT_LOCATION" });

  return ok([...taken, { batchId: target, qty: shortfall, conflict: true }]);
}
