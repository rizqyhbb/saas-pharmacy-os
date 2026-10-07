import { describe, expect, test } from "bun:test";
import { can, CRITICAL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, rolesWith } from "../src/permissions";

describe("default permission matrix", () => {
  test("only the pharmacist approves prescriptions and controlled medicine", () => {
    expect(rolesWith("prescription.approve")).toEqual(["PHARMACIST"]);
    expect(rolesWith("controlled.approve")).toEqual(["PHARMACIST"]);
  });

  test("the auditor mutates nothing", () => {
    const writes = DEFAULT_ROLE_PERMISSIONS.AUDITOR.filter((p) => !p.endsWith(".read"));
    expect(writes).toEqual([]);
  });

  test("only the owner manages staff and corrects batch identity", () => {
    expect(rolesWith("staff.manage")).toEqual(["OWNER"]);
    expect(rolesWith("batch.correct")).toEqual(["OWNER"]);
  });

  test("a cashier cannot adjust stock, void, refund or see the audit log", () => {
    for (const p of ["stock.adjust", "sale.void", "sale.refund", "audit.read", "price.update"] as const) {
      expect(can("CASHIER", p)).toBe(false);
    }
  });

  test("every permission is granted to someone, every role can read stock", () => {
    for (const p of PERMISSIONS) expect(rolesWith(p).length).toBeGreaterThan(0);
    for (const r of ROLES) expect(can(r, "stock.read")).toBe(true);
  });

  test("grants only name known permissions, without duplicates", () => {
    for (const r of ROLES) {
      const grants = DEFAULT_ROLE_PERMISSIONS[r];
      expect(new Set(grants).size).toBe(grants.length);
      for (const p of grants) expect(PERMISSIONS).toContain(p);
    }
    for (const p of CRITICAL_PERMISSIONS) expect(PERMISSIONS).toContain(p);
  });
});
