import { t, type Static } from "elysia";
import {
  BRANCH_TIMEZONES,
  branchOf,
  createBranch,
  createLocation,
  createWorkstation,
  listBranches,
  listReconciliationIssues,
  renameLocation,
  resolveReconciliationIssue,
  updateBranch,
  updateWorkstation,
} from "@apotek/db";
import { audit, authorize, inTenant, reply, visibleBranches, type Reply, type TenantScope } from "../scope";

const name = (max: number) => t.String({ minLength: 1, maxLength: max });
const timezone = t.Union(BRANCH_TIMEZONES.map((z) => t.Literal(z)));

export const branchBody = t.Object({ name: name(120), timezone: t.Optional(timezone) });
export const branchPatchBody = t.Object({ name: t.Optional(name(120)), timezone: t.Optional(timezone) });
export const nameBody = t.Object({ name: name(120) });
export const workstationPatchBody = t.Object({ name: t.Optional(name(80)), active: t.Optional(t.Boolean()) });
export const issuesQuery = t.Object({ open: t.Optional(t.BooleanString()) });
export const resolveBody = t.Object({ note: t.String({ minLength: 3, maxLength: 1000 }) });

/** FND-2: the branches the caller works in, with their locations and workstations. */
export async function listBranchesRoute(scope: TenantScope): Promise<Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  return reply(200, { branches: await inTenant(scope, (tx) => listBranches(tx, visibleBranches(scope.member))) });
}

export async function createBranchRoute(scope: TenantScope, body: Static<typeof branchBody>): Promise<Reply> {
  const denied = await authorize(scope, "branch.manage");
  if (denied) return denied;
  const created = await inTenant(scope, async (tx) => {
    const ids = await createBranch(tx, scope.member.tenantId, { name: body.name, timezone: body.timezone ?? "Asia/Jakarta" });
    await audit(scope, tx, { action: "branch.create", entityType: "branch", entityId: ids.branchId, branchId: ids.branchId, after: body });
    return ids;
  });
  return reply(201, created);
}

export async function updateBranchRoute(scope: TenantScope, branchId: string, body: Static<typeof branchPatchBody>): Promise<Reply> {
  const denied = await authorize(scope, "branch.manage");
  if (denied) return denied;
  const change = await inTenant(scope, async (tx) => {
    const changed = await updateBranch(tx, branchId, body);
    if (changed) await audit(scope, tx, { action: "branch.update", entityType: "branch", entityId: branchId, branchId, ...changed });
    return changed;
  });
  return change ? reply(200, { branchId, ...change.after }) : reply(404, { error: "BRANCH_NOT_FOUND" });
}

export async function createLocationRoute(scope: TenantScope, branchId: string, body: Static<typeof nameBody>): Promise<Reply> {
  const denied = await authorize(scope, "branch.manage");
  if (denied) return denied;
  const locationId = await inTenant(scope, async (tx) => {
    const id = await createLocation(tx, scope.member.tenantId, branchId, body.name);
    if (id) await audit(scope, tx, { action: "location.create", entityType: "location", entityId: id, branchId, after: body });
    return id;
  });
  return locationId ? reply(201, { locationId }) : reply(404, { error: "BRANCH_NOT_FOUND" });
}

export async function renameLocationRoute(scope: TenantScope, locationId: string, body: Static<typeof nameBody>): Promise<Reply> {
  const denied = await authorize(scope, "branch.manage");
  if (denied) return denied;
  const change = await inTenant(scope, async (tx) => {
    const changed = await renameLocation(tx, locationId, body.name);
    if (changed) await audit(scope, tx, { action: "location.update", entityType: "location", entityId: locationId, ...changed });
    return changed;
  });
  return change ? reply(200, { locationId, ...change.after }) : reply(404, { error: "LOCATION_NOT_FOUND" });
}

export async function createWorkstationRoute(scope: TenantScope, branchId: string, body: Static<typeof nameBody>): Promise<Reply> {
  const denied = await authorize(scope, "branch.manage");
  if (denied) return denied;
  const workstationId = await inTenant(scope, async (tx) => {
    const id = await createWorkstation(tx, scope.member.tenantId, branchId, body.name);
    if (id) await audit(scope, tx, { action: "workstation.create", entityType: "workstation", entityId: id, branchId, after: body });
    return id;
  });
  return workstationId ? reply(201, { workstationId }) : reply(404, { error: "BRANCH_NOT_FOUND" });
}

export async function updateWorkstationRoute(scope: TenantScope, workstationId: string, body: Static<typeof workstationPatchBody>): Promise<Reply> {
  const denied = await authorize(scope, "branch.manage");
  if (denied) return denied;
  const change = await inTenant(scope, async (tx) => {
    const changed = await updateWorkstation(tx, workstationId, body);
    if (changed) {
      await audit(scope, tx, {
        action: "workstation.update",
        entityType: "workstation",
        entityId: workstationId,
        branchId: changed.branchId,
        before: changed.before,
        after: changed.after,
      });
    }
    return changed;
  });
  return change ? reply(200, { workstationId, ...change.after }) : reply(404, { error: "WORKSTATION_NOT_FOUND" });
}

/** Nightly reconciliation findings. Read with stock.read; resolving needs stock.adjust. */
export async function listIssuesRoute(scope: TenantScope, query: Static<typeof issuesQuery>): Promise<Reply> {
  const denied = await authorize(scope, "stock.read");
  if (denied) return denied;
  const issues = await inTenant(scope, async (tx) => {
    const all = await listReconciliationIssues(tx, { openOnly: query.open ?? true });
    const branches = visibleBranches(scope.member);
    if (!branches) return all;
    const visible: typeof all = [];
    for (const issue of all) {
      const branchId = await branchOf(tx, "location", issue.locationId);
      if (branchId && branches.includes(branchId)) visible.push(issue);
    }
    return visible;
  });
  return reply(200, { issues });
}

export async function resolveIssueRoute(scope: TenantScope, issueId: string, body: Static<typeof resolveBody>): Promise<Reply> {
  const denied = await authorize(scope, "stock.adjust");
  if (denied) return denied;
  const resolved = await inTenant(scope, async (tx) => {
    const ok = await resolveReconciliationIssue(tx, issueId, scope.member.staffId, body.note);
    if (ok) await audit(scope, tx, { action: "reconciliation.resolve", entityType: "reconciliation_issue", entityId: issueId, reason: body.note });
    return ok;
  });
  return resolved ? reply(200, { issueId, resolved: true }) : reply(404, { error: "ISSUE_NOT_FOUND" });
}

