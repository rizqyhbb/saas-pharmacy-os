import { formatQty, parseQty } from "@apotek/domain";
import type { Tx } from "./client";

/** Balances that disagreed with their ledger at the nightly check (ARCHITECTURE.md §6). */
export interface ReconciliationIssue {
  issueId: string;
  locationId: string;
  productId: string;
  batchId: string | null;
  ledger: { onHand: string; reserved: string };
  balance: { onHand: string; reserved: string };
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

const q = (text: string) => formatQty(parseQty(text));

export async function listReconciliationIssues(tx: Tx, opts: { openOnly?: boolean } = {}): Promise<ReconciliationIssue[]> {
  const rows = await tx<
    {
      id: string;
      location_id: string;
      product_id: string;
      batch_id: string | null;
      ledger_on_hand: string;
      ledger_reserved: string;
      balance_on_hand: string;
      balance_reserved: string;
      detected_at: Date;
      resolved_at: Date | null;
      resolved_by: string | null;
      resolution_note: string | null;
    }[]
  >`
    select id, location_id, product_id, batch_id, ledger_on_hand::text, ledger_reserved::text, balance_on_hand::text,
      balance_reserved::text, detected_at, resolved_at, resolved_by, resolution_note
    from app.reconciliation_issues
    where ${opts.openOnly ? tx`resolved_at is null` : tx`true`}
    order by detected_at desc
    limit 200
  `;
  return rows.map((r) => ({
    issueId: r.id,
    locationId: r.location_id,
    productId: r.product_id,
    batchId: r.batch_id,
    ledger: { onHand: q(r.ledger_on_hand), reserved: q(r.ledger_reserved) },
    balance: { onHand: q(r.balance_on_hand), reserved: q(r.balance_reserved) },
    detectedAt: r.detected_at.toISOString(),
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    resolvedBy: r.resolved_by,
    resolutionNote: r.resolution_note,
  }));
}

/** Records who looked into an issue and what they found. Returns false if absent or already resolved. */
export async function resolveReconciliationIssue(tx: Tx, issueId: string, staffId: string, note: string): Promise<boolean> {
  const result = await tx`
    update app.reconciliation_issues set resolved_at = now(), resolved_by = ${staffId}, resolution_note = ${note.trim()}
    where id = ${issueId} and resolved_at is null`;
  return result.count === 1;
}
