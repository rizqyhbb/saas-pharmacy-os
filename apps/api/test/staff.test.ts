import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { can, ROLES } from "@apotek/domain";
import { connect } from "@apotek/db/testing";
import { call, fakeAuthAdmin, tenantWithEveryRole, testApp, type RoleTenant } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("staff management and facility profile", () => {
  const db = sql!;
  const admin = fakeAuthAdmin(db);
  const app = testApp(db, admin);
  let t: RoleTenant;
  const path = (p: string) => `/tenants/${t.tenantId}${p}`;
  const as = (role: keyof RoleTenant["staff"]) => t.staff[role].userId;
  const auditLog = async () => (await call(app, "GET", path("/audit-events?limit=500"), { userId: as("OWNER") })).body.events as Record<string, unknown>[];
  const userIdOf = async (email: string) => (await db<{ id: string }[]>`select id from auth.users where email = ${email}`)[0]!.id;

  beforeAll(async () => {
    t = await tenantWithEveryRole(app, db, "Apotek Staf");
  });

  test("inviting a new person creates their account, emails them, and gives them the role", async () => {
    const email = `kasir-${crypto.randomUUID().slice(0, 8)}@apotek.test`;
    const res = await call(app, "POST", path("/staff/invitations"), {
      userId: as("OWNER"),
      body: { email: email.toUpperCase(), displayName: "Sari", role: "CASHIER", branchIds: [t.branchId] },
    });
    expect(res).toMatchObject({ status: 201, body: { newAccount: true } });
    expect(admin.invited).toContain(email);

    const me = await call(app, "GET", "/me", { userId: await userIdOf(email) });
    expect(me.body.memberships).toEqual([
      expect.objectContaining({ tenantId: t.tenantId, role: "CASHIER", displayName: "Sari", branchIds: [t.branchId] }),
    ]);
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({ action: "staff.invite", entityId: res.body.staffId, after: expect.objectContaining({ email, role: "CASHIER" }) }),
    );
  });

  test("someone who already has an account is linked without a second invitation", async () => {
    const other = await tenantWithEveryRole(app, db, "Apotek Tetangga");
    const pharmacistId = other.staff.PHARMACIST.userId;
    const email = `${pharmacistId}@test.apotek.local`;
    const before = admin.invited.length;
    const res = await call(app, "POST", path("/staff/invitations"), {
      userId: as("OWNER"),
      body: { email, displayName: "Apt. Dewi", role: "PHARMACIST", allBranches: true },
    });
    expect(res).toMatchObject({ status: 201, body: { newAccount: false } });
    expect(admin.invited.length).toBe(before);
    const tenants = (await call(app, "GET", "/me", { userId: pharmacistId })).body.memberships.map((m: { tenantId: string }) => m.tenantId);
    expect(tenants.sort()).toEqual([other.tenantId, t.tenantId].sort());

    const again = await call(app, "POST", path("/staff/invitations"), {
      userId: as("OWNER"),
      body: { email, displayName: "Apt. Dewi", role: "PHARMACIST", allBranches: true },
    });
    expect(again).toEqual({ status: 409, body: { error: "ALREADY_MEMBER" } });
  });

  test("invitations are validated", async () => {
    const send = (body: Record<string, unknown>) => call(app, "POST", path("/staff/invitations"), { userId: as("OWNER"), body });
    const base = { email: `x-${crypto.randomUUID().slice(0, 6)}@apotek.test`, displayName: "X", role: "CASHIER", branchIds: [t.branchId] };
    expect((await send({ ...base, role: "SUPERUSER" })).body).toEqual({ error: "UNKNOWN_ROLE" });
    expect((await send({ ...base, branchIds: [] })).body).toEqual({ error: "NO_BRANCH" });
    expect((await send({ ...base, email: "not-an-email" })).status).toBe(422);
  });

  test("deactivation needs a reason, locks the person out, and is audited", async () => {
    const target = t.staff.TECHNICIAN;
    const tenantRoute = () => call(app, "GET", path("/branches"), { userId: target.userId });
    expect((await tenantRoute()).status).toBe(200);

    const noReason = await call(app, "PATCH", path(`/staff/${target.staffId}/active`), { userId: as("OWNER"), body: { active: false } });
    expect(noReason.status).toBe(422);
    const off = await call(app, "PATCH", path(`/staff/${target.staffId}/active`), {
      userId: as("OWNER"),
      body: { active: false, reason: "Kontrak selesai" },
    });
    expect(off).toEqual({ status: 200, body: { staffId: target.staffId, active: false } });
    expect((await tenantRoute()).status).toBe(404);

    await call(app, "PATCH", path(`/staff/${target.staffId}/active`), { userId: as("OWNER"), body: { active: true, reason: "Kembali bekerja" } });
    expect((await tenantRoute()).status).toBe(200);
    const actions = (await auditLog()).filter((e) => e.entityId === target.staffId).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["staff.deactivate", "staff.reactivate"]));
  });

  test("nobody deactivates themselves; a second owner can deactivate the first", async () => {
    const self = await call(app, "PATCH", path(`/staff/${t.staff.OWNER.staffId}/active`), {
      userId: as("OWNER"),
      body: { active: false, reason: "test" },
    });
    expect(self).toEqual({ status: 409, body: { error: "CANNOT_DEACTIVATE_SELF" } });

    const second = await call(app, "POST", path("/staff/invitations"), {
      userId: as("OWNER"),
      body: { email: `owner2-${crypto.randomUUID().slice(0, 6)}@apotek.test`, displayName: "Owner 2", role: "OWNER", allBranches: true },
    });
    const secondUser = (await db<{ user_id: string }[]>`select user_id from app.staff_members where id = ${second.body.staffId}`)[0]!.user_id;
    const off = await call(app, "PATCH", path(`/staff/${second.body.staffId}/active`), {
      userId: as("OWNER"),
      body: { active: false, reason: "Bukan pemilik lagi" },
    });
    expect(off.status).toBe(200);
    expect((await call(app, "GET", path("/staff"), { userId: secondUser })).status).toBe(404);
    // Through the API the last active owner is always the caller, so the database-level
    // LAST_OWNER guard is covered in packages/db.
  });

  test("branch assignments change with an audit trail", async () => {
    const target = t.staff.WAREHOUSE;
    const res = await call(app, "PUT", path(`/staff/${target.staffId}/branches`), {
      userId: as("OWNER"),
      body: { allBranches: true, branchIds: [] },
    });
    expect(res.body).toEqual({ staffId: target.staffId, allBranches: true, branchIds: [] });
    const none = await call(app, "PUT", path(`/staff/${target.staffId}/branches`), {
      userId: as("OWNER"),
      body: { allBranches: false, branchIds: [] },
    });
    expect(none).toEqual({ status: 422, body: { error: "NO_BRANCH" } });
    await call(app, "PUT", path(`/staff/${target.staffId}/branches`), { userId: as("OWNER"), body: { allBranches: false, branchIds: [t.branchId] } });
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({
        action: "staff.branches.change",
        entityId: target.staffId,
        before: { allBranches: false, branchIds: [t.branchId] },
        after: { allBranches: true, branchIds: [] },
      }),
    );
  });

  test("facility profile: anyone reads it, only the owner edits it, the APJ must be a pharmacist", async () => {
    expect((await call(app, "GET", path("/facility"), { userId: as("CASHIER") })).body.nib).toBeNull();
    expect((await call(app, "PUT", path("/facility"), { userId: as("CASHIER"), body: { nib: "123" } })).status).toBe(403);

    const notPharmacist = await call(app, "PUT", path("/facility"), { userId: as("OWNER"), body: { apjStaffId: t.staff.CASHIER.staffId } });
    expect(notPharmacist).toEqual({ status: 422, body: { error: "APJ_MUST_BE_PHARMACIST" } });

    const saved = await call(app, "PUT", path("/facility"), {
      userId: as("OWNER"),
      body: { legalName: "PT Apotek Staf", nib: "9120001234567", apjStaffId: t.staff.PHARMACIST.staffId, apjName: "apt. Rina" },
    });
    expect(saved.body).toMatchObject({ legalName: "PT Apotek Staf", nib: "9120001234567", apjStaffId: t.staff.PHARMACIST.staffId });
    const partial = await call(app, "PUT", path("/facility"), { userId: as("OWNER"), body: { phone: "0211234567" } });
    expect(partial.body).toMatchObject({ nib: "9120001234567", phone: "0211234567" });
    expect(await auditLog()).toContainEqual(
      expect.objectContaining({
        action: "tenant.facility.update",
        before: expect.objectContaining({ phone: null, nib: "9120001234567" }),
        after: expect.objectContaining({ phone: "0211234567" }),
      }),
    );
  });

  test("staff management and facility edits follow the matrix for all nine roles", async () => {
    const outcome: Record<string, boolean[]> = {};
    const expected: Record<string, boolean[]> = {};
    for (const role of ROLES) {
      const invite = await call(app, "POST", path("/staff/invitations"), {
        userId: as(role),
        body: { email: `m-${crypto.randomUUID().slice(0, 8)}@apotek.test`, displayName: "M", role: "CASHIER", branchIds: [t.branchId] },
      });
      const branches = await call(app, "PUT", path(`/staff/${t.staff.CASHIER.staffId}/branches`), {
        userId: as(role),
        body: { allBranches: false, branchIds: [t.branchId] },
      });
      const facility = await call(app, "PUT", path("/facility"), { userId: as(role), body: { operatingHours: "08.00-21.00" } });
      outcome[role] = [invite.status < 300, branches.status < 300, facility.status < 300];
      expected[role] = [can(role, "staff.manage"), can(role, "staff.manage"), can(role, "tenant.settings.update")];
    }
    expect(outcome).toEqual(expected);
  });
});
