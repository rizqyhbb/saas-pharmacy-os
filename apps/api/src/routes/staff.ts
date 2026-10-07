import { t, type Static } from "elysia";
import { isRole } from "@apotek/domain";
import {
  addStaffMember,
  findAuthUserByEmail,
  getFacility,
  isMember,
  listStaffMembers,
  setStaffActive,
  setStaffBranches,
  updateFacility,
} from "@apotek/db";
import type { AuthAdmin } from "../auth-admin";
import { audit, authorize, inTenant, reply, visibleBranches, type Reply, type TenantScope } from "../scope";

export const roleChangeBody = t.Object({ role: t.String(), reason: t.Optional(t.String({ maxLength: 500 })) });
export const auditQuery = t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })) });

export async function listStaff(scope: TenantScope): Promise<Reply> {
  const denied = await authorize(scope, "staff.read");
  if (denied) return denied;
  const staff = await inTenant(scope, (tx) => listStaffMembers(tx));
  return reply(200, { staff: staff.map(({ userId: _userId, ...member }) => member) });
}

const branchScope = {
  allBranches: t.Optional(t.Boolean()),
  branchIds: t.Optional(t.Array(t.String({ format: "uuid" }), { maxItems: 50 })),
};
export const invitationBody = t.Object({
  email: t.String({ format: "email", maxLength: 254 }),
  displayName: t.String({ minLength: 1, maxLength: 120 }),
  role: t.String(),
  ...branchScope,
});
export const activeBody = t.Object({ active: t.Boolean(), reason: t.String({ minLength: 3, maxLength: 500 }) });
export const branchesBody = t.Object({ allBranches: t.Boolean(), branchIds: t.Array(t.String({ format: "uuid" }), { maxItems: 50 }) });

/**
 * US-FND-3: add a person to this pharmacy. Someone who already has an account (a
 * pharmacist working at two apotek) is linked directly; anyone else gets a Supabase
 * invitation email. Their role and branches come from here, never from the token.
 */
export async function inviteStaff(scope: TenantScope, admin: AuthAdmin, body: Static<typeof invitationBody>): Promise<Reply> {
  const denied = await authorize(scope, "staff.manage");
  if (denied) return denied;
  const role = body.role;
  if (!isRole(role)) return reply(422, { error: "UNKNOWN_ROLE" });
  const allBranches = body.allBranches ?? false;
  const branchIds = body.branchIds ?? [];
  if (!allBranches && branchIds.length === 0) return reply(422, { error: "NO_BRANCH" });

  const email = body.email.trim().toLowerCase();
  const existing = await inTenant(scope, async (tx) => {
    const userId = await findAuthUserByEmail(tx, email);
    return { userId, member: userId ? await isMember(tx, userId) : false };
  });
  if (existing.member) return reply(409, { error: "ALREADY_MEMBER" });
  const userId = existing.userId ?? (await admin.inviteUser(email)).userId;

  const staffId = await inTenant(scope, async (tx) => {
    const id = await addStaffMember(tx, scope.member.tenantId, {
      userId,
      displayName: body.displayName,
      role,
      allBranches,
      branchIds,
    });
    await audit(scope, tx, {
      action: "staff.invite",
      entityType: "staff_member",
      entityId: id,
      after: { email, displayName: body.displayName, role, allBranches, branchIds, newAccount: existing.userId === null },
    });
    return id;
  });
  return reply(201, { staffId, newAccount: existing.userId === null });
}

/** Deactivating locks someone out on their next request; nobody deactivates themselves. */
export async function setActive(scope: TenantScope, staffId: string, body: Static<typeof activeBody>): Promise<Reply> {
  const denied = await authorize(scope, "staff.manage");
  if (denied) return denied;
  if (staffId === scope.member.staffId && !body.active) return reply(409, { error: "CANNOT_DEACTIVATE_SELF" });
  const change = await inTenant(scope, async (tx) => {
    const changed = await setStaffActive(tx, staffId, body.active);
    if (changed) {
      await audit(scope, tx, {
        action: body.active ? "staff.reactivate" : "staff.deactivate",
        entityType: "staff_member",
        entityId: staffId,
        before: changed.before,
        after: changed.after,
        reason: body.reason,
      });
    }
    return changed;
  });
  return change ? reply(200, { staffId, active: body.active }) : reply(404, { error: "STAFF_NOT_FOUND" });
}

export async function setBranches(scope: TenantScope, staffId: string, body: Static<typeof branchesBody>): Promise<Reply> {
  const denied = await authorize(scope, "staff.manage");
  if (denied) return denied;
  const change = await inTenant(scope, async (tx) => {
    const changed = await setStaffBranches(tx, scope.member.tenantId, staffId, body);
    if (changed) {
      await audit(scope, tx, {
        action: "staff.branches.change",
        entityType: "staff_member",
        entityId: staffId,
        before: changed.before,
        after: changed.after,
      });
    }
    return changed;
  });
  return change ? reply(200, { staffId, ...change.after }) : reply(404, { error: "STAFF_NOT_FOUND" });
}

const optional = (max: number) => t.Optional(t.Union([t.String({ maxLength: max }), t.Null()]));
const optionalDate = t.Optional(t.Union([t.String({ format: "date" }), t.Null()]));
export const facilityBody = t.Object({
  legalName: optional(160),
  nib: optional(32),
  pharmacyPermitNumber: optional(64),
  pharmacyPermitValidUntil: optionalDate,
  apjStaffId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  apjName: optional(120),
  apjRegistrationNumber: optional(64),
  apjPracticePermitNumber: optional(64),
  apjPracticePermitValidUntil: optionalDate,
  address: optional(500),
  phone: optional(32),
  operatingHours: optional(500),
});

/** Any member may read the facility profile: it prints on receipts and labels. */
export async function readFacility(scope: TenantScope): Promise<Reply> {
  return reply(200, await inTenant(scope, (tx) => getFacility(tx)));
}

/** US-FND-2: facility identity and the responsible pharmacist, audited. */
export async function writeFacility(scope: TenantScope, body: Static<typeof facilityBody>): Promise<Reply> {
  const denied = await authorize(scope, "tenant.settings.update");
  if (denied) return denied;
  const facility = await inTenant(scope, async (tx) => {
    const change = await updateFacility(tx, scope.member.tenantId, body, scope.member.staffId);
    await audit(scope, tx, {
      action: "tenant.facility.update",
      entityType: "tenant",
      entityId: scope.member.tenantId,
      before: change.before,
      after: change.after,
    });
    return change.after;
  });
  return reply(200, facility);
}

export async function changeRole(scope: TenantScope, staffId: string, body: Static<typeof roleChangeBody>): Promise<Reply> {
  const denied = await authorize(scope, "staff.manage");
  if (denied) return denied;
  if (!isRole(body.role)) return reply(422, { error: "UNKNOWN_ROLE" });
  const role = body.role;
  const outcome = await inTenant(scope, async (tx) => {
    const [current] = await tx<{ role: string }[]>`
      select role::text as role from app.staff_members where id = ${staffId} for update`;
    if (!current) return "NOT_FOUND" as const;
    if (current.role === "OWNER" && role !== "OWNER") {
      const [owners] = await tx<{ n: number }[]>`select count(*)::int as n from app.staff_members where role = 'OWNER' and active`;
      if (owners!.n <= 1) return "LAST_OWNER" as const;
    }
    await tx`update app.staff_members set role = ${role} where id = ${staffId}`;
    await audit(scope, tx, {
      action: "staff.role.change",
      entityType: "staff_member",
      entityId: staffId,
      before: { role: current.role },
      after: { role },
      reason: body.reason ?? null,
    });
    return "OK" as const;
  });
  if (outcome === "NOT_FOUND") return reply(404, { error: "STAFF_NOT_FOUND" });
  if (outcome === "LAST_OWNER") return reply(409, { error: "LAST_OWNER" });
  return reply(200, { staffId, role });
}

export async function listAuditEvents(scope: TenantScope, query: Static<typeof auditQuery>): Promise<Reply> {
  const denied = await authorize(scope, "audit.read");
  if (denied) return denied;
  const events = await inTenant(scope, (tx) => tx<
    {
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      actor_staff_id: string | null;
      before: unknown;
      after: unknown;
      reason: string | null;
      created_at: Date;
    }[]
  >`
    select id, action, entity_type, entity_id, actor_staff_id, before, after, reason, created_at
    from app.audit_events order by created_at desc, id limit ${query.limit ?? 100}`);
  return reply(200, {
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entity_type,
      entityId: e.entity_id,
      actorStaffId: e.actor_staff_id,
      before: e.before,
      after: e.after,
      reason: e.reason,
      createdAt: e.created_at.toISOString(),
    })),
  });
}

/** Branches and their stock locations the caller may work in. */
export async function listLocations(scope: TenantScope): Promise<Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  const branches = visibleBranches(scope.member);
  const rows = await inTenant(scope, (tx) => tx<
    { branch_id: string; branch_name: string; timezone: string; location_id: string; location_name: string }[]
  >`
    select b.id as branch_id, b.name as branch_name, b.timezone, l.id as location_id, l.name as location_name
    from app.branches b join app.locations l on l.branch_id = b.id
    where ${branches ? tx`b.id = any(${branches}::uuid[])` : tx`true`}
    order by b.name, l.name`);
  const byBranch = new Map<string, { branchId: string; name: string; timezone: string; locations: { locationId: string; name: string }[] }>();
  for (const row of rows) {
    const branch = byBranch.get(row.branch_id) ?? { branchId: row.branch_id, name: row.branch_name, timezone: row.timezone, locations: [] };
    branch.locations.push({ locationId: row.location_id, name: row.location_name });
    byBranch.set(row.branch_id, branch);
  }
  return reply(200, { branches: [...byBranch.values()] });
}
