import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { can, ROLES, type Permission, type Role } from "@apotek/domain";
import { withContext } from "@apotek/db";
import { connect, createUser } from "@apotek/db/testing";
import { call, testApp } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("tenants, staff and permissions", () => {
  const db = sql!;
  const app = testApp(db);
  let ownerId: string;
  let tenantId: string;
  /** One staff member per role, in the same tenant. */
  const staff = {} as Record<Role, { userId: string; staffId: string }>;

  beforeAll(async () => {
    ownerId = await createUser(db);
    const created = await call(app, "POST", "/tenants", {
      userId: ownerId,
      body: { tenantName: "Apotek Sentosa", branchName: "Pusat", ownerDisplayName: "Pak Budi" },
    });
    expect(created.status).toBe(201);
    tenantId = created.body.tenantId;
    staff.OWNER = { userId: ownerId, staffId: created.body.staffId };
    const ctx = { userId: ownerId, tenantId, staffId: created.body.staffId };
    for (const role of ROLES.filter((r) => r !== "OWNER")) {
      const userId = await createUser(db);
      const [row] = await withContext(db, ctx, (tx) => tx<{ id: string }[]>`
        insert into app.staff_members (tenant_id, user_id, display_name, role)
        values (${tenantId}, ${userId}, ${role.toLowerCase()}, ${role}) returning id`);
      staff[role] = { userId, staffId: row!.id };
    }
  });

  test("registration makes the caller OWNER of the new tenant", async () => {
    const me = await call(app, "GET", "/me", { userId: ownerId });
    expect(me.body.memberships).toEqual([
      expect.objectContaining({ tenantId, tenantName: "Apotek Sentosa", role: "OWNER", allBranches: true }),
    ]);
  });

  test("registration validates input", async () => {
    const res = await call(app, "POST", "/tenants", {
      userId: await createUser(db),
      body: { tenantName: "", branchName: "Pusat", ownerDisplayName: "X" },
    });
    expect(res.status).toBe(422);
  });

  test("a tenant the caller doesn't belong to is 404, not 403", async () => {
    const outsider = await createUser(db);
    expect((await call(app, "GET", `/tenants/${tenantId}/staff`, { userId: outsider })).status).toBe(404);
    expect((await call(app, "GET", `/tenants/${crypto.randomUUID()}/staff`, { userId: ownerId })).status).toBe(404);
  });

  // G0-4: every role, every privileged route, decided by the server-side matrix.
  const routes: { permission: Permission; method: string; path: () => string; body?: () => unknown }[] = [
    { permission: "staff.read", method: "GET", path: () => `/tenants/${tenantId}/staff` },
    { permission: "audit.read", method: "GET", path: () => `/tenants/${tenantId}/audit-events` },
    {
      permission: "staff.manage",
      method: "PATCH",
      path: () => `/tenants/${tenantId}/staff/${staff.CASHIER.staffId}/role`,
      body: () => ({ role: "CASHIER", reason: "matrix test" }),
    },
  ];

  for (const route of routes) {
    test(`${route.permission}: allowed exactly for the roles the matrix grants`, async () => {
      const outcome: Record<string, number> = {};
      const expected: Record<string, number> = {};
      for (const role of ROLES) {
        const res = await call(app, route.method, route.path(), { userId: staff[role].userId, body: route.body?.() });
        outcome[role] = res.status;
        expected[role] = can(role, route.permission) ? 200 : 403;
      }
      expect(outcome).toEqual(expected);
    });
  }

  test("a denied attempt is recorded in the audit log", async () => {
    await call(app, "GET", `/tenants/${tenantId}/audit-events`, { userId: staff.CASHIER.userId });
    const log = await call(app, "GET", `/tenants/${tenantId}/audit-events`, { userId: staff.AUDITOR.userId });
    expect(log.body.events).toContainEqual(
      expect.objectContaining({
        action: "permission.denied",
        entityId: "audit.read",
        actorStaffId: staff.CASHIER.staffId,
        after: expect.objectContaining({ method: "GET", role: "CASHIER" }),
      }),
    );
  });

  test("a role change is audited with before and after", async () => {
    const res = await call(app, "PATCH", `/tenants/${tenantId}/staff/${staff.TECHNICIAN.staffId}/role`, {
      userId: ownerId,
      body: { role: "WAREHOUSE", reason: "Pindah ke gudang" },
    });
    expect(res).toEqual({ status: 200, body: { staffId: staff.TECHNICIAN.staffId, role: "WAREHOUSE" } });
    const log = await call(app, "GET", `/tenants/${tenantId}/audit-events`, { userId: ownerId });
    expect(log.body.events).toContainEqual(
      expect.objectContaining({
        action: "staff.role.change",
        entityId: staff.TECHNICIAN.staffId,
        before: { role: "TECHNICIAN" },
        after: { role: "WAREHOUSE" },
        reason: "Pindah ke gudang",
      }),
    );
    await call(app, "PATCH", `/tenants/${tenantId}/staff/${staff.TECHNICIAN.staffId}/role`, {
      userId: ownerId,
      body: { role: "TECHNICIAN" },
    });
  });

  test("the last owner cannot be demoted, and unknown roles are refused", async () => {
    const demote = await call(app, "PATCH", `/tenants/${tenantId}/staff/${staff.OWNER.staffId}/role`, {
      userId: ownerId,
      body: { role: "CASHIER" },
    });
    expect(demote).toEqual({ status: 409, body: { error: "LAST_OWNER" } });
    const unknown = await call(app, "PATCH", `/tenants/${tenantId}/staff/${staff.CASHIER.staffId}/role`, {
      userId: ownerId,
      body: { role: "SUPERUSER" },
    });
    expect(unknown.status).toBe(422);
  });

  test("a deactivated staff member is locked out on their next request", async () => {
    const userId = staff.FINANCE.userId;
    expect((await call(app, "GET", `/tenants/${tenantId}/staff`, { userId })).status).toBe(403);
    await db`update app.staff_members set active = false where id = ${staff.FINANCE.staffId}`;
    expect((await call(app, "GET", `/tenants/${tenantId}/staff`, { userId })).status).toBe(404);
    await db`update app.staff_members set active = true where id = ${staff.FINANCE.staffId}`;
  });
});
