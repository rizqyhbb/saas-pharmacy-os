import type { Role } from "@apotek/domain";
import type { Change } from "./catalogue";
import type { Tx } from "./client";
import { RuleError } from "./errors";

/** Staff membership and the facility profile (US-FND-2, US-FND-3). Runs inside `withContext`. */

export interface BranchScope {
  allBranches: boolean;
  branchIds: string[];
}

export interface StaffView extends BranchScope {
  staffId: string;
  userId: string;
  displayName: string;
  role: Role;
  active: boolean;
}

/** An existing Supabase Auth account with this email, if any. */
export async function findAuthUserByEmail(tx: Tx, email: string): Promise<string | null> {
  const [row] = await tx<{ id: string | null }[]>`select app.auth_user_id_by_email(${email}) as id`;
  return row?.id ?? null;
}

export async function listStaffMembers(tx: Tx): Promise<StaffView[]> {
  const rows = await tx<
    { id: string; user_id: string; display_name: string; role: Role; active: boolean; all_branches: boolean; branch_ids: string[] }[]
  >`
    select sm.id, sm.user_id, sm.display_name, sm.role::text as role, sm.active, sm.all_branches,
      coalesce(array_agg(sba.branch_id order by sba.branch_id) filter (where sba.branch_id is not null), '{}') as branch_ids
    from app.staff_members sm
    left join app.staff_branch_access sba on sba.staff_member_id = sm.id
    group by sm.id
    order by sm.active desc, sm.display_name
  `;
  return rows.map((r) => ({
    staffId: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    role: r.role,
    active: r.active,
    allBranches: r.all_branches,
    branchIds: r.branch_ids,
  }));
}

export async function isMember(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx<{ n: number }[]>`select count(*)::int as n from app.staff_members where user_id = ${userId}`;
  return row!.n > 0;
}

export async function addStaffMember(
  tx: Tx,
  tenantId: string,
  input: { userId: string; displayName: string; role: Role } & BranchScope,
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into app.staff_members (tenant_id, user_id, display_name, role, all_branches)
    values (${tenantId}, ${input.userId}, ${input.displayName.trim()}, ${input.role}, ${input.allBranches})
    returning id
  `;
  await replaceBranchAccess(tx, tenantId, row!.id, input.allBranches ? [] : input.branchIds);
  return row!.id;
}

async function replaceBranchAccess(tx: Tx, tenantId: string, staffId: string, branchIds: string[]) {
  await tx`delete from app.staff_branch_access where staff_member_id = ${staffId}`;
  for (const branchId of new Set(branchIds)) {
    await tx`insert into app.staff_branch_access (tenant_id, staff_member_id, branch_id) values (${tenantId}, ${staffId}, ${branchId})`;
  }
}

async function activeOwnerCount(tx: Tx): Promise<number> {
  const [row] = await tx<{ n: number }[]>`select count(*)::int as n from app.staff_members where role = 'OWNER' and active`;
  return row!.n;
}

/** Deactivating locks the person out on their next request. The last active owner stays. */
export async function setStaffActive(tx: Tx, staffId: string, active: boolean): Promise<Change<{ active: boolean }> | null> {
  const [current] = await tx<{ active: boolean; role: Role }[]>`
    select active, role::text as role from app.staff_members where id = ${staffId} for update`;
  if (!current) return null;
  if (!active && current.active && current.role === "OWNER" && (await activeOwnerCount(tx)) <= 1) {
    throw new RuleError("LAST_OWNER", "the last active owner cannot be deactivated");
  }
  await tx`update app.staff_members set active = ${active} where id = ${staffId}`;
  return { before: { active: current.active }, after: { active } };
}

export async function setStaffBranches(tx: Tx, tenantId: string, staffId: string, scope: BranchScope): Promise<Change<BranchScope> | null> {
  const [current] = (await listStaffMembers(tx)).filter((s) => s.staffId === staffId);
  if (!current) return null;
  if (!scope.allBranches && scope.branchIds.length === 0) {
    throw new RuleError("NO_BRANCH", "a staff member needs at least one branch, or all branches");
  }
  await tx`update app.staff_members set all_branches = ${scope.allBranches} where id = ${staffId}`;
  await replaceBranchAccess(tx, tenantId, staffId, scope.allBranches ? [] : scope.branchIds);
  return {
    before: { allBranches: current.allBranches, branchIds: current.branchIds },
    after: { allBranches: scope.allBranches, branchIds: scope.allBranches ? [] : [...new Set(scope.branchIds)].sort() },
  };
}

export interface FacilityProfile {
  legalName: string | null;
  nib: string | null;
  pharmacyPermitNumber: string | null;
  pharmacyPermitValidUntil: string | null;
  apjStaffId: string | null;
  apjName: string | null;
  apjRegistrationNumber: string | null;
  apjPracticePermitNumber: string | null;
  apjPracticePermitValidUntil: string | null;
  address: string | null;
  phone: string | null;
  operatingHours: string | null;
}

const FACILITY_COLUMNS: Record<keyof FacilityProfile, string> = {
  legalName: "legal_name",
  nib: "nib",
  pharmacyPermitNumber: "pharmacy_permit_number",
  pharmacyPermitValidUntil: "pharmacy_permit_valid_until",
  apjStaffId: "apj_staff_id",
  apjName: "apj_name",
  apjRegistrationNumber: "apj_registration_number",
  apjPracticePermitNumber: "apj_practice_permit_number",
  apjPracticePermitValidUntil: "apj_practice_permit_valid_until",
  address: "address",
  phone: "phone",
  operatingHours: "operating_hours",
};

const EMPTY_FACILITY: FacilityProfile = Object.fromEntries(Object.keys(FACILITY_COLUMNS).map((k) => [k, null])) as unknown as FacilityProfile;

export async function getFacility(tx: Tx): Promise<FacilityProfile> {
  const [row] = await tx<Record<string, unknown>[]>`
    select legal_name, nib, pharmacy_permit_number, pharmacy_permit_valid_until::text, apj_staff_id, apj_name,
      apj_registration_number, apj_practice_permit_number, apj_practice_permit_valid_until::text, address, phone, operating_hours
    from app.facility_profiles
  `;
  if (!row) return { ...EMPTY_FACILITY };
  return Object.fromEntries(
    (Object.entries(FACILITY_COLUMNS) as [keyof FacilityProfile, string][]).map(([key, column]) => [
      key,
      (row[column] ?? null) as string | null,
    ]),
  ) as unknown as FacilityProfile;
}

/** Applies the given fields; the rest keep their value. Returns before/after for the audit. */
export async function updateFacility(
  tx: Tx,
  tenantId: string,
  patch: Partial<FacilityProfile>,
  staffId: string,
): Promise<Change<FacilityProfile>> {
  if (patch.apjStaffId) {
    const [apj] = await tx<{ role: Role; active: boolean }[]>`
      select role::text as role, active from app.staff_members where id = ${patch.apjStaffId}`;
    if (!apj || !apj.active || apj.role !== "PHARMACIST") {
      throw new RuleError("APJ_MUST_BE_PHARMACIST", "the APJ must be an active staff member with the pharmacist role");
    }
  }
  const before = await getFacility(tx);
  const a = { ...before, ...patch };
  await tx`
    insert into app.facility_profiles (
      tenant_id, legal_name, nib, pharmacy_permit_number, pharmacy_permit_valid_until, apj_staff_id, apj_name,
      apj_registration_number, apj_practice_permit_number, apj_practice_permit_valid_until, address, phone,
      operating_hours, updated_at, updated_by
    ) values (
      ${tenantId}, ${a.legalName}, ${a.nib}, ${a.pharmacyPermitNumber}, ${a.pharmacyPermitValidUntil}, ${a.apjStaffId},
      ${a.apjName}, ${a.apjRegistrationNumber}, ${a.apjPracticePermitNumber}, ${a.apjPracticePermitValidUntil},
      ${a.address}, ${a.phone}, ${a.operatingHours}, now(), ${staffId}
    )
    on conflict (tenant_id) do update set
      legal_name = excluded.legal_name, nib = excluded.nib, pharmacy_permit_number = excluded.pharmacy_permit_number,
      pharmacy_permit_valid_until = excluded.pharmacy_permit_valid_until, apj_staff_id = excluded.apj_staff_id,
      apj_name = excluded.apj_name, apj_registration_number = excluded.apj_registration_number,
      apj_practice_permit_number = excluded.apj_practice_permit_number,
      apj_practice_permit_valid_until = excluded.apj_practice_permit_valid_until, address = excluded.address,
      phone = excluded.phone, operating_hours = excluded.operating_hours, updated_at = now(), updated_by = excluded.updated_by
  `;
  const after = await getFacility(tx);
  return { before, after };
}
