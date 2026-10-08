import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  allocateForSync,
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

describe("allocateForSync (offline sales, SYN-4)", () => {
  const at = (batchId: string, expiryDate: string, available: bigint, status: "AVAILABLE" | "QUARANTINE" = "AVAILABLE") => ({
    batchId,
    expiryDate,
    receivedAt: new Date("2026-01-01"),
    status,
    available,
  });
  const today = "2026-10-08";

  test("enough stock: plain FEFO, no conflict", () => {
    const r = allocateForSync(15n, [at("b2", "2027-06-01", 100n), at("b1", "2026-12-01", 10n)], today);
    expect(r).toEqual({ ok: true, value: [{ batchId: "b1", qty: 10n, conflict: false }, { batchId: "b2", qty: 5n, conflict: false }] });
  });

  test("short: takes what is there, books the rest on the latest-expiring sellable batch as conflict", () => {
    const r = allocateForSync(15n, [at("b1", "2026-12-01", 4n), at("b2", "2027-06-01", 6n), at("old", "2026-01-01", 50n)], today);
    expect(r).toEqual({
      ok: true,
      value: [
        { batchId: "b1", qty: 4n, conflict: false },
        { batchId: "b2", qty: 6n, conflict: false },
        { batchId: "b2", qty: 5n, conflict: true },
      ],
    });
  });

  test("nothing sellable: the device's own batch, else the latest batch of any status", () => {
    const blocked = [at("q", "2027-01-01", 9n, "QUARANTINE"), at("old", "2026-01-01", 3n)];
    expect(allocateForSync(2n, blocked, today, "old")).toEqual({ ok: true, value: [{ batchId: "old", qty: 2n, conflict: true }] });
    expect(allocateForSync(2n, blocked, today)).toEqual({ ok: true, value: [{ batchId: "q", qty: 2n, conflict: true }] });
    expect(allocateForSync(2n, [], today)).toEqual({ ok: false, error: { kind: "NO_BATCH_AT_LOCATION" } });
  });

  test("property: always books exactly the requested quantity, conflict only when short", () => {
    const candidate = fc.record({
      batchId: fc.constantFrom("a", "b", "c", "d"),
      expiryDate: fc.constantFrom("2025-01-01", "2026-12-01", "2027-06-01"),
      receivedAt: fc.constant(new Date("2026-01-01")),
      status: fc.constantFrom("AVAILABLE" as const, "QUARANTINE" as const),
      available: fc.bigInt({ min: 0n, max: 50n }),
    });
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 120n }), fc.uniqueArray(candidate, { selector: (c) => c.batchId, minLength: 1 }), (requested, candidates) => {
        const r = allocateForSync(requested, candidates, today);
        if (!r.ok) throw new Error("candidates exist, must allocate");
        expect(r.value.reduce((s, a) => s + a.qty, 0n)).toBe(requested);
        const plain = allocateFefo(requested, candidates, today);
        expect(r.value.some((a) => a.conflict)).toBe(!plain.ok);
      }),
    );
  });
});
