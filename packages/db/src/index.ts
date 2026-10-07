/**
 * Database access for the API. Schema, row-level security and integrity rules live
 * in supabase/migrations; this package runs queries inside them.
 */
export { recordAudit, type AuditEventInput } from "./audit";
export { createDb, type Sql, type Tx } from "./client";
export { withContext, type DbContext } from "./context";
export { classifyDbError, type DbFailure } from "./errors";
export {
  membershipsForUser,
  registerTenant,
  type Membership,
  type RegisteredTenant,
  type RegisterTenantInput,
} from "./identity";
