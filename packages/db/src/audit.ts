import type { Tx } from "./client";

/**
 * One row of the append-only audit trail (DOMAIN-MODEL.md §11). Write it in the same
 * transaction as the change it describes, so the two commit or fail together.
 */
export interface AuditEventInput {
  tenantId: string;
  branchId?: string | null;
  actorUserId: string | null;
  actorStaffId: string | null;
  /** Dotted, lowercase: `staff.role.change`, `permission.denied`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
}

type Json = Parameters<Tx["json"]>[0];

export async function recordAudit(tx: Tx, event: AuditEventInput): Promise<string> {
  const json = (value: unknown) => (value === undefined || value === null ? null : tx.json(value as Json));
  const [row] = await tx<{ id: string }[]>`
    insert into app.audit_events
      (tenant_id, branch_id, actor_user_id, actor_staff_id, action, entity_type, entity_id, before, after, reason, request_id)
    values (
      ${event.tenantId}, ${event.branchId ?? null}, ${event.actorUserId}, ${event.actorStaffId}, ${event.action},
      ${event.entityType}, ${event.entityId ?? null}, ${json(event.before)}, ${json(event.after)},
      ${event.reason ?? null}, ${event.requestId ?? null}
    )
    returning id
  `;
  return row!.id;
}
