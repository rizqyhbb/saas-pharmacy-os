import { t, type Static } from "elysia";
import { isRole } from "@apotek/domain";
import { audit, authorize, inTenant, reply, visibleBranches, type Reply, type TenantScope } from "../scope";

export const roleChangeBody = t.Object({ role: t.String(), reason: t.Optional(t.String({ maxLength: 500 })) });
export const auditQuery = t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })) });

export async function listStaff(scope: TenantScope): Promise<Reply> {
  const denied = await authorize(scope, "staff.read");
  if (denied) return denied;
  const staff = await inTenant(scope, (tx) => tx<
    { id: string; display_name: string; role: string; all_branches: boolean; active: boolean }[]
  >`select id, display_name, role::text as role, all_branches, active from app.staff_members order by display_name`);
  return reply(200, {
    staff: staff.map((s) => ({ staffId: s.id, displayName: s.display_name, role: s.role, allBranches: s.all_branches, active: s.active })),
  });
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
