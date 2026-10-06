import { assertCalendarDate, type CalendarDate } from "./dates";

export const BATCH_STATUSES = ["AVAILABLE", "QUARANTINE", "RECALLED", "EXPIRED", "DESTROYED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * Invariant B4: a batch is expired once its expiry date is before today, even
 * if the nightly job has not materialised `status = EXPIRED` yet.
 */
export function isExpired(expiryDate: CalendarDate, today: CalendarDate): boolean {
  assertCalendarDate(expiryDate, "expiryDate");
  assertCalendarDate(today, "today");
  return expiryDate < today;
}

export type SaleBlockReason = Exclude<BatchStatus, "AVAILABLE">;

/** Why ordinary sale/dispense is blocked for this batch, or null if it isn't (B4, T3). */
export function saleBlockReason(
  batch: { status: BatchStatus; expiryDate: CalendarDate },
  today: CalendarDate,
): SaleBlockReason | null {
  if (batch.status !== "AVAILABLE") return batch.status;
  return isExpired(batch.expiryDate, today) ? "EXPIRED" : null;
}
