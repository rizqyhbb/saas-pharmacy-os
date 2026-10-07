import type { Sql, Tx } from "./client";

/** Who is asking. Tenant and staff are unset until the caller has picked a tenant. */
export interface DbContext {
  userId: string;
  tenantId?: string | null;
  staffId?: string | null;
}

/**
 * Runs `fn` in one transaction as role `apotek_api` with the request context set
 * (`app.user_id`, `app.tenant_id`, `app.staff_id`), so row-level security applies to
 * every statement. Settings and role are transaction-local and vanish on commit.
 * This is the only way request code should touch the database.
 */
export async function withContext<T>(sql: Sql, ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`
      select
        set_config('app.user_id', ${ctx.userId}, true),
        set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true),
        set_config('app.staff_id', ${ctx.staffId ?? ""}, true)
    `;
    await tx`set local role apotek_api`;
    return fn(tx);
  });
  return result as T;
}
