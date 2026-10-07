import { Elysia, t } from "elysia";
import { can, isRole, type Permission } from "@apotek/domain";
import {
  classifyDbError,
  membershipsForUser,
  recordAudit,
  registerTenant,
  withContext,
  type DbContext,
  type Membership,
  type Sql,
} from "@apotek/db";
import type { AuthUser, VerifyToken } from "./auth";

export interface AppDeps {
  db: Sql;
  verifyToken: VerifyToken;
}

const bearerToken = (header: string | undefined) => header?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

const contextOf = (user: AuthUser, member: Membership): DbContext => ({
  userId: user.userId,
  tenantId: member.tenantId,
  staffId: member.staffId,
});

const name = t.String({ minLength: 1, maxLength: 120 });

/**
 * Every privileged action is checked here, on the server, against the role stored
 * in the database (CLAUDE.md "Authorization is server-side"). Tenant routes live
 * under /tenants/:tenantId; a tenant the caller doesn't belong to answers 404, so
 * its existence isn't revealed.
 *
 * Built separately from `listen()` so tests drive it through `app.handle(request)`.
 */
export const createApp = ({ db, verifyToken }: AppDeps) => {
  /** 403, plus an audit event recording the attempt (US-FND-3). */
  async function deny(user: AuthUser, member: Membership, permission: Permission, request: Request) {
    await withContext(db, contextOf(user, member), (tx) =>
      recordAudit(tx, {
        tenantId: member.tenantId,
        actorUserId: user.userId,
        actorStaffId: member.staffId,
        action: "permission.denied",
        entityType: "permission",
        entityId: permission,
        after: { method: request.method, path: new URL(request.url).pathname, role: member.role },
        requestId: request.headers.get("x-request-id"),
      }),
    );
  }

  return new Elysia()
    .onError(({ error, code, set }) => {
      if (code === "VALIDATION" || code === "NOT_FOUND" || code === "PARSE") return;
      const failure = classifyDbError(error);
      if (failure?.kind === "RULE") {
        set.status = 422;
        return { error: failure.rule };
      }
      if (failure?.kind === "UNIQUE") {
        set.status = 409;
        return { error: "ALREADY_EXISTS" };
      }
      // Never echo internals: messages can contain row data.
      console.error("[api] unhandled error", code, error instanceof Error ? error.name : typeof error);
      set.status = 500;
      return { error: "INTERNAL" };
    })
    .get("/health", () => ({ status: "ok", service: "apotek-api" }))
    .resolve(async ({ headers, status }) => {
      const token = bearerToken(headers.authorization);
      const user = token ? await verifyToken(token) : null;
      if (!user) return status(401, { error: "UNAUTHENTICATED" });
      return { user };
    })
    .get("/me", async ({ user }) => {
      const memberships = await membershipsForUser(db, user.userId);
      return {
        userId: user.userId,
        email: user.email,
        memberships: memberships.map(({ tenantId, tenantName, staffId, displayName, role, allBranches, branchIds }) => ({
          tenantId,
          tenantName,
          staffId,
          displayName,
          role,
          allBranches,
          branchIds,
        })),
      };
    })
    .post(
      "/tenants",
      async ({ user, body, status }) => {
        const registered = await registerTenant(db, user.userId, body);
        return status(201, registered);
      },
      { body: t.Object({ tenantName: name, branchName: name, ownerDisplayName: name }) },
    )
    .group("/tenants/:tenantId", (tenant) =>
      tenant
        .resolve(async ({ params, user, status }) => {
          const member = (await membershipsForUser(db, user.userId)).find((m) => m.tenantId === params.tenantId);
          if (!member) return status(404, { error: "TENANT_NOT_FOUND" });
          return { member };
        })
        .get("/staff", async ({ user, member, request, status }) => {
          if (!can(member.role, "staff.read")) {
            await deny(user, member, "staff.read", request);
            return status(403, { error: "FORBIDDEN", permission: "staff.read" });
          }
          const staff = await withContext(db, contextOf(user, member), (tx) => tx<
            { id: string; display_name: string; role: string; all_branches: boolean; active: boolean }[]
          >`
            select id, display_name, role::text as role, all_branches, active
            from app.staff_members order by display_name`);
          return {
            staff: staff.map((s) => ({ staffId: s.id, displayName: s.display_name, role: s.role, allBranches: s.all_branches, active: s.active })),
          };
        })
        .patch(
          "/staff/:staffId/role",
          async ({ user, member, params, body, request, status }) => {
            if (!can(member.role, "staff.manage")) {
              await deny(user, member, "staff.manage", request);
              return status(403, { error: "FORBIDDEN", permission: "staff.manage" });
            }
            if (!isRole(body.role)) return status(422, { error: "UNKNOWN_ROLE" });
            const role = body.role;
            const outcome = await withContext(db, contextOf(user, member), async (tx) => {
              const [current] = await tx<{ role: string }[]>`
                select role::text as role from app.staff_members where id = ${params.staffId} for update`;
              if (!current) return "NOT_FOUND" as const;
              if (current.role === "OWNER" && role !== "OWNER") {
                const [owners] = await tx<{ n: number }[]>`
                  select count(*)::int as n from app.staff_members where role = 'OWNER' and active`;
                if (owners!.n <= 1) return "LAST_OWNER" as const;
              }
              await tx`update app.staff_members set role = ${role} where id = ${params.staffId}`;
              await recordAudit(tx, {
                tenantId: member.tenantId,
                actorUserId: user.userId,
                actorStaffId: member.staffId,
                action: "staff.role.change",
                entityType: "staff_member",
                entityId: params.staffId,
                before: { role: current.role },
                after: { role },
                reason: body.reason ?? null,
                requestId: request.headers.get("x-request-id"),
              });
              return "OK" as const;
            });
            if (outcome === "NOT_FOUND") return status(404, { error: "STAFF_NOT_FOUND" });
            if (outcome === "LAST_OWNER") return status(409, { error: "LAST_OWNER" });
            return { staffId: params.staffId, role };
          },
          { body: t.Object({ role: t.String(), reason: t.Optional(t.String({ maxLength: 500 })) }) },
        )
        .get(
          "/audit-events",
          async ({ user, member, request, query, status }) => {
            if (!can(member.role, "audit.read")) {
              await deny(user, member, "audit.read", request);
              return status(403, { error: "FORBIDDEN", permission: "audit.read" });
            }
            const limit = query.limit ?? 100;
            const events = await withContext(db, contextOf(user, member), (tx) => tx<
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
              from app.audit_events order by created_at desc, id limit ${limit}`);
            return {
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
            };
          },
          { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })) }) },
        ),
    );
};
