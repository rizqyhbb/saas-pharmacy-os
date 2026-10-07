import { isRole, type Role } from "@apotek/domain";
import type { Sql } from "./client";
import { withContext } from "./context";

export interface Membership {
  staffId: string;
  tenantId: string;
  tenantName: string;
  displayName: string;
  role: Role;
  allBranches: boolean;
  branchIds: string[];
}

/** The tenants a signed-in user works in, with their role in each. Active rows only. */
export function membershipsForUser(sql: Sql, userId: string): Promise<Membership[]> {
  return withContext(sql, { userId }, async (tx) => {
    const rows = await tx<
      {
        staff_id: string;
        tenant_id: string;
        tenant_name: string;
        display_name: string;
        role: string;
        all_branches: boolean;
        branch_ids: string[];
      }[]
    >`
      select
        sm.id as staff_id, sm.tenant_id, t.name as tenant_name, sm.display_name, sm.role::text as role,
        sm.all_branches,
        coalesce(array_agg(sba.branch_id) filter (where sba.branch_id is not null), '{}') as branch_ids
      from app.staff_members sm
      join app.tenants t on t.id = sm.tenant_id
      left join app.staff_branch_access sba on sba.staff_member_id = sm.id
      where sm.user_id = ${userId} and sm.active
      group by sm.id, t.name
      order by t.name
    `;
    return rows.map((row) => {
      if (!isRole(row.role)) throw new Error(`Unknown role in database: ${row.role}`);
      return {
        staffId: row.staff_id,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        displayName: row.display_name,
        role: row.role,
        allBranches: row.all_branches,
        branchIds: row.branch_ids,
      };
    });
  });
}

export interface RegisterTenantInput {
  tenantName: string;
  branchName: string;
  ownerDisplayName: string;
}

export interface RegisteredTenant {
  tenantId: string;
  branchId: string;
  locationId: string;
  staffId: string;
}

/** US-FND-1: the signed-in user creates a tenant with its first branch and becomes OWNER. */
export function registerTenant(sql: Sql, userId: string, input: RegisterTenantInput): Promise<RegisteredTenant> {
  return withContext(sql, { userId }, async (tx) => {
    const [row] = await tx<{ tenant_id: string; branch_id: string; location_id: string; staff_member_id: string }[]>`
      select * from app.register_tenant(${input.tenantName}, ${input.branchName}, ${input.ownerDisplayName})
    `;
    if (!row) throw new Error("register_tenant returned nothing");
    return { tenantId: row.tenant_id, branchId: row.branch_id, locationId: row.location_id, staffId: row.staff_member_id };
  });
}
