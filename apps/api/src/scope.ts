import { can, type Permission } from "@apotek/domain";
import { recordAudit, withContext, type AuditEventInput, type DbContext, type Membership, type Sql, type Tx } from "@apotek/db";
import type { AuthUser } from "./auth";

/** What a handler answers. Routes turn it into the HTTP response. */
export interface Reply {
  status: number;
  body: unknown;
}
export const reply = (status: number, body: unknown): Reply => ({ status, body });

/** One request inside one tenant: who is asking, in which role. */
export interface TenantScope {
  db: Sql;
  user: AuthUser;
  member: Membership;
  request: Request;
}

export const contextOf = (scope: Pick<TenantScope, "user" | "member">): DbContext => ({
  userId: scope.user.userId,
  tenantId: scope.member.tenantId,
  staffId: scope.member.staffId,
});

/** A transaction as this caller, under row-level security. */
export const inTenant = <T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withContext(scope.db, contextOf(scope), fn);

type AuditFields = Omit<AuditEventInput, "tenantId" | "actorUserId" | "actorStaffId" | "requestId">;

/** An audit event attributed to this caller, in the transaction of the change itself. */
export const audit = (scope: TenantScope, tx: Tx, event: AuditFields) =>
  recordAudit(tx, {
    ...event,
    tenantId: scope.member.tenantId,
    actorUserId: scope.user.userId,
    actorStaffId: scope.member.staffId,
    requestId: scope.request.headers.get("x-request-id"),
  });

const attempt = (scope: TenantScope) => ({
  method: scope.request.method,
  path: new URL(scope.request.url).pathname,
  role: scope.member.role,
});

/**
 * Null when the caller's role allows it. Otherwise records the attempt (US-FND-3)
 * and returns 403. The role comes from the database, never the client.
 */
export async function authorize(scope: TenantScope, permission: Permission): Promise<Reply | null> {
  if (can(scope.member.role, permission)) return null;
  await inTenant(scope, (tx) =>
    audit(scope, tx, { action: "permission.denied", entityType: "permission", entityId: permission, after: attempt(scope) }),
  );
  return reply(403, { error: "FORBIDDEN", permission });
}

/** Second layer (ARCHITECTURE.md §5): staff scoped to branches only act in those branches. */
export async function authorizeBranch(scope: TenantScope, branchId: string): Promise<Reply | null> {
  if (scope.member.allBranches || scope.member.branchIds.includes(branchId)) return null;
  await inTenant(scope, (tx) =>
    audit(scope, tx, { action: "branch.denied", entityType: "branch", entityId: branchId, after: attempt(scope) }),
  );
  return reply(403, { error: "BRANCH_FORBIDDEN" });
}

/** Branch filter for reads: undefined means every branch. */
export const visibleBranches = (member: Membership): string[] | undefined => (member.allBranches ? undefined : member.branchIds);
