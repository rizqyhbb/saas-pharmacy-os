import { afterAll, describe, expect, test } from "bun:test";
import { classifyDbError, membershipsForUser, recordAudit, registerTenant, setStaffActive, withContext } from "../src";
import { asTenant, connect, createTenant, createUser, rejection } from "./support";

/** Registration (US-FND-1), memberships and the audit trail (G0-5 groundwork). */
const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("registration and memberships", () => {
  const db = sql!;

  test("registering creates tenant, branch, main location and the owner, with an audit event", async () => {
    const userId = await createUser(db);
    const t = await registerTenant(db, userId, { tenantName: " Apotek Sehat ", branchName: "Pusat", ownerDisplayName: "Bu Rina" });
    const ctx = { userId, tenantId: t.tenantId, staffId: t.staffId };
    const [row] = await withContext(db, ctx, (tx) => tx`
      select t.name as tenant, b.name as branch, l.name as location, sm.role::text as role, sm.all_branches,
        (select count(*)::int from app.audit_events a where a.action = 'tenant.register') as audits
      from app.tenants t
      join app.branches b on b.tenant_id = t.id
      join app.locations l on l.branch_id = b.id
      join app.staff_members sm on sm.tenant_id = t.id`);
    expect(row).toEqual({ tenant: "Apotek Sehat", branch: "Pusat", location: "Utama", role: "OWNER", all_branches: true, audits: 1 });
  });

  test("registration needs a signed-in user", async () => {
    const error = await rejection(db`select * from app.register_tenant('X', 'Y', 'Z')`);
    expect(error.message).toMatch(/signed-in user/);
  });

  test("a user's memberships list each tenant with the role from the database", async () => {
    const owner = await createTenant(db, "Apotek Satu");
    const other = await createTenant(db, "Apotek Dua");
    // The owner of "Apotek Satu" also works as a pharmacist at "Apotek Dua".
    await asTenant(db, other, (tx) => tx`
      insert into app.staff_members (tenant_id, user_id, display_name, role)
      values (${other.tenantId}, ${owner.userId}, 'Apoteker', 'PHARMACIST')`);
    const memberships = await membershipsForUser(db, owner.userId);
    expect(memberships.map((m) => [m.tenantName, m.role])).toEqual([
      ["Apotek Dua", "PHARMACIST"],
      ["Apotek Satu", "OWNER"],
    ]);
  });

  test("the last active owner cannot be deactivated", async () => {
    const t = await createTenant(db);
    const error = await rejection(asTenant(db, t, (tx) => setStaffActive(tx, t.staffId, false)));
    expect(classifyDbError(error)).toMatchObject({ kind: "RULE", rule: "LAST_OWNER" });
  });

  test("audit events record before and after", async () => {
    const t = await createTenant(db);
    await asTenant(db, t, (tx) =>
      recordAudit(tx, {
        tenantId: t.tenantId,
        actorUserId: t.userId,
        actorStaffId: t.staffId,
        action: "staff.role.change",
        entityType: "staff_member",
        entityId: t.staffId,
        before: { role: "CASHIER" },
        after: { role: "BRANCH_MANAGER" },
        reason: "Promosi",
      }),
    );
    const [row] = await asTenant(db, t, (tx) => tx`
      select before, after, reason from app.audit_events where action = 'staff.role.change'`);
    expect(row).toEqual({ before: { role: "CASHIER" }, after: { role: "BRANCH_MANAGER" }, reason: "Promosi" });
  });
});
