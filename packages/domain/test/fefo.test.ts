import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  allocateFefo,
  BATCH_STATUSES,
  parseQty,
  validateManualAllocation,
  type AllocationCandidate,
} from "../src";

const TODAY = "2026-10-06";
const q = parseQty;

function batch(batchId: string, expiryDate: string, available: string, extra: Partial<AllocationCandidate> = {}) {
  return {
    batchId,
    expiryDate,
    available: q(available),
    status: "AVAILABLE",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    ...extra,
  } satisfies AllocationCandidate;
}

describe("allocateFefo", () => {
  test("takes earliest expiry first and spills into the next batch", () => {
    const result = allocateFefo(q("15"), [batch("late", "2027-06-30", "50"), batch("early", "2026-12-31", "10")], TODAY);
    expect(result).toEqual({
      ok: true,
      value: [
        { batchId: "early", qty: q("10") },
        { batchId: "late", qty: q("5") },
      ],
    });
  });

  test("same expiry: received first goes first", () => {
    const result = allocateFefo(
      q("1"),
      [
        batch("newer", "2027-01-31", "5", { receivedAt: new Date("2026-05-01T00:00:00Z") }),
        batch("older", "2027-01-31", "5", { receivedAt: new Date("2026-02-01T00:00:00Z") }),
      ],
      TODAY,
    );
    expect(result.ok && result.value).toEqual([{ batchId: "older", qty: q("1") }]);
  });

  test("T3: skips expired, quarantined, recalled, destroyed and empty batches", () => {
    const result = allocateFefo(
      q("3"),
      [
        batch("expired-by-date", "2026-10-05", "10"),
        batch("quarantine", "2026-11-01", "10", { status: "QUARANTINE" }),
        batch("recalled", "2026-11-01", "10", { status: "RECALLED" }),
        batch("destroyed", "2026-11-01", "10", { status: "DESTROYED" }),
        batch("empty", "2026-11-01", "0"),
        batch("good", "2027-03-01", "10"),
      ],
      TODAY,
    );
    expect(result.ok && result.value).toEqual([{ batchId: "good", qty: q("3") }]);
  });

  test("a batch expiring today is still sellable today", () => {
    const result = allocateFefo(q("1"), [batch("today", TODAY, "1")], TODAY);
    expect(result.ok).toBe(true);
  });

  test("insufficient stock reports the shortfall and allocates nothing", () => {
    const result = allocateFefo(q("12"), [batch("a", "2027-01-01", "4"), batch("b", "2027-02-01", "5.5")], TODAY);
    expect(result).toEqual({
      ok: false,
      error: { kind: "INSUFFICIENT_STOCK", requested: q("12"), allocatable: q("9.5"), shortfall: q("2.5") },
    });
  });

  test("partial strip: allocates fractional base quantities", () => {
    const result = allocateFefo(q("0.5"), [batch("a", "2027-01-01", "0.25"), batch("b", "2027-02-01", "1")], TODAY);
    expect(result.ok && result.value).toEqual([
      { batchId: "a", qty: q("0.25") },
      { batchId: "b", qty: q("0.25") },
    ]);
  });

  test("rejects a non-positive request", () => {
    expect(() => allocateFefo(0n, [], TODAY)).toThrow(RangeError);
  });

  test("T6 property: earliest-expiry first, never above available, sums to request", () => {
    const candidateArb = fc.record({
      batchId: fc.uuid(),
      expiryDate: fc
        .date({ min: new Date("2026-01-01"), max: new Date("2028-12-31"), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10)),
      receivedAt: fc.date({ min: new Date("2025-01-01"), max: new Date("2026-10-01"), noInvalidDate: true }),
      status: fc.constantFrom(...BATCH_STATUSES),
      available: fc.bigInt({ min: 0n, max: 1_000_000n }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(candidateArb, { selector: (c) => c.batchId, maxLength: 12 }),
        fc.bigInt({ min: 1n, max: 3_000_000n }),
        (candidates, requested) => {
          const result = allocateFefo(requested, candidates, TODAY);
          const eligible = candidates.filter(
            (c) => c.status === "AVAILABLE" && c.expiryDate >= TODAY && c.available > 0n,
          );
          const allocatable = eligible.reduce((sum, c) => sum + c.available, 0n);
          if (!result.ok) {
            expect(allocatable).toBeLessThan(requested);
            return;
          }
          const byId = new Map(candidates.map((c) => [c.batchId, c]));
          const chosen = result.value.map((a) => byId.get(a.batchId)!);
          expect(result.value.reduce((sum, a) => sum + a.qty, 0n)).toBe(requested);
          for (const [i, allocation] of result.value.entries()) {
            const candidate = chosen[i]!;
            expect(eligible).toContain(candidate);
            expect(allocation.qty).toBeGreaterThan(0n);
            expect(allocation.qty).toBeLessThanOrEqual(candidate.available);
            // every batch before the last one is drained completely
            if (i < result.value.length - 1) expect(allocation.qty).toBe(candidate.available);
          }
          // no unused eligible batch expires earlier than one that was used
          const lastExpiry = chosen.at(-1)!.expiryDate;
          const used = new Set(chosen);
          for (const c of eligible) if (!used.has(c)) expect(c.expiryDate >= lastExpiry).toBe(true);
        },
      ),
    );
  });
});

describe("validateManualAllocation", () => {
  const candidates = [
    batch("a", "2027-01-01", "10"),
    batch("b", "2027-06-01", "10"),
    batch("q", "2027-06-01", "10", { status: "QUARANTINE" }),
    batch("old", "2026-09-30", "10"),
  ];

  test("accepts a valid non-FEFO choice", () => {
    const choice = [{ batchId: "b", qty: q("4") }];
    expect(validateManualAllocation(q("4"), choice, candidates, TODAY)).toEqual({ ok: true, value: choice });
  });

  test("reports every problem at once", () => {
    const result = validateManualAllocation(
      q("30"),
      [
        { batchId: "q", qty: q("1") },
        { batchId: "old", qty: q("1") },
        { batchId: "a", qty: q("11") },
        { batchId: "a", qty: q("1") },
        { batchId: "ghost", qty: q("1") },
        { batchId: "b", qty: 0n },
      ],
      candidates,
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((e): string => e.kind).sort()).toEqual(
      [
        "BATCH_BLOCKED",
        "BATCH_BLOCKED",
        "DUPLICATE_BATCH",
        "EXCEEDS_AVAILABLE",
        "NON_POSITIVE_QTY",
        "TOTAL_MISMATCH",
        "UNKNOWN_BATCH",
      ].sort(),
    );
    expect(result.error).toContainEqual({ kind: "BATCH_BLOCKED", batchId: "old", reason: "EXPIRED" });
  });
});
