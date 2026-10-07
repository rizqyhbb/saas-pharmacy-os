import type { Change } from "./catalogue";
import type { Tx } from "./client";

/** FND-2: branch → location → workstation. Runs inside `withContext`. */

/** Indonesia's IANA zones. A branch's "today" (expiry, shifts) is its local date. */
export const BRANCH_TIMEZONES = ["Asia/Jakarta", "Asia/Pontianak", "Asia/Makassar", "Asia/Jayapura"] as const;
export type BranchTimezone = (typeof BRANCH_TIMEZONES)[number];

export interface BranchView {
  branchId: string;
  name: string;
  timezone: string;
  locations: { locationId: string; name: string }[];
  workstations: { workstationId: string; name: string; active: boolean }[];
}

export async function listBranches(tx: Tx, branchIds?: string[]): Promise<BranchView[]> {
  const rows = await tx<
    {
      id: string;
      name: string;
      timezone: string;
      locations: { locationId: string; name: string }[];
      workstations: { workstationId: string; name: string; active: boolean }[];
    }[]
  >`
    select b.id, b.name, b.timezone,
      coalesce((select json_agg(json_build_object('locationId', l.id, 'name', l.name) order by l.name)
                from app.locations l where l.branch_id = b.id), '[]') as locations,
      coalesce((select json_agg(json_build_object('workstationId', w.id, 'name', w.name, 'active', w.active) order by w.name)
                from app.workstations w where w.branch_id = b.id), '[]') as workstations
    from app.branches b
    where ${branchIds ? tx`b.id = any(${branchIds}::uuid[])` : tx`true`}
    order by b.name
  `;
  return rows.map((r) => ({ branchId: r.id, name: r.name, timezone: r.timezone, locations: r.locations, workstations: r.workstations }));
}

/** A new branch comes with its main stock location, like the first one at registration. */
export async function createBranch(tx: Tx, tenantId: string, input: { name: string; timezone: BranchTimezone }) {
  const [branch] = await tx<{ id: string }[]>`
    insert into app.branches (tenant_id, name, timezone) values (${tenantId}, ${input.name.trim()}, ${input.timezone}) returning id`;
  const [location] = await tx<{ id: string }[]>`
    insert into app.locations (tenant_id, branch_id, name) values (${tenantId}, ${branch!.id}, 'Utama') returning id`;
  return { branchId: branch!.id, locationId: location!.id };
}

export async function updateBranch(
  tx: Tx,
  branchId: string,
  patch: { name?: string; timezone?: BranchTimezone },
): Promise<Change<{ name: string; timezone: string }> | null> {
  const [current] = await tx<{ name: string; timezone: string }[]>`select name, timezone from app.branches where id = ${branchId} for update`;
  if (!current) return null;
  const after = { name: patch.name?.trim() ?? current.name, timezone: patch.timezone ?? current.timezone };
  await tx`update app.branches set name = ${after.name}, timezone = ${after.timezone} where id = ${branchId}`;
  return { before: current, after };
}

export async function createLocation(tx: Tx, tenantId: string, branchId: string, name: string): Promise<string | null> {
  const [branch] = await tx`select 1 from app.branches where id = ${branchId}`;
  if (!branch) return null;
  const [row] = await tx<{ id: string }[]>`
    insert into app.locations (tenant_id, branch_id, name) values (${tenantId}, ${branchId}, ${name.trim()}) returning id`;
  return row!.id;
}

export async function renameLocation(tx: Tx, locationId: string, name: string): Promise<Change<{ name: string }> | null> {
  const [current] = await tx<{ name: string; branch_id: string }[]>`select name, branch_id from app.locations where id = ${locationId} for update`;
  if (!current) return null;
  await tx`update app.locations set name = ${name.trim()} where id = ${locationId}`;
  return { before: { name: current.name }, after: { name: name.trim() } };
}

export async function createWorkstation(tx: Tx, tenantId: string, branchId: string, name: string): Promise<string | null> {
  const [branch] = await tx`select 1 from app.branches where id = ${branchId}`;
  if (!branch) return null;
  const [row] = await tx<{ id: string }[]>`
    insert into app.workstations (tenant_id, branch_id, name) values (${tenantId}, ${branchId}, ${name.trim()}) returning id`;
  return row!.id;
}

export async function updateWorkstation(
  tx: Tx,
  workstationId: string,
  patch: { name?: string; active?: boolean },
): Promise<(Change<{ name: string; active: boolean }> & { branchId: string }) | null> {
  const [current] = await tx<{ name: string; active: boolean; branch_id: string }[]>`
    select name, active, branch_id from app.workstations where id = ${workstationId} for update`;
  if (!current) return null;
  const after = { name: patch.name?.trim() ?? current.name, active: patch.active ?? current.active };
  await tx`update app.workstations set name = ${after.name}, active = ${after.active} where id = ${workstationId}`;
  return { before: { name: current.name, active: current.active }, after, branchId: current.branch_id };
}

/** The branch of a location or workstation, for branch-scoped permission checks. */
export async function branchOf(tx: Tx, kind: "location" | "workstation", id: string): Promise<string | null> {
  const [row] =
    kind === "location"
      ? await tx<{ branch_id: string }[]>`select branch_id from app.locations where id = ${id}`
      : await tx<{ branch_id: string }[]>`select branch_id from app.workstations where id = ${id}`;
  return row?.branch_id ?? null;
}
