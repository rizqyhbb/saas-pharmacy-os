/**
 * Database access for the API. Schema, row-level security and integrity rules live
 * in supabase/migrations; this package runs queries inside them.
 */
export { recordAudit, type AuditEventInput } from "./audit";
export { createDb, type Sql, type Tx } from "./client";
export { withContext, type DbContext } from "./context";
export { classifyDbError, RuleError, type DbFailure } from "./errors";
export {
  membershipsForUser,
  registerTenant,
  type Membership,
  type RegisteredTenant,
  type RegisterTenantInput,
} from "./identity";
export {
  addBarcode,
  classifyProduct,
  CONTROLLED_CLASSES,
  createProduct,
  getProduct,
  listProducts,
  productsBySku,
  removeBarcode,
  SALES_CLASSES,
  setUnitPrice,
  updateProductDetails,
  type Change,
  type Classification,
  type ControlledClass,
  type ProductDetails,
  type ProductInput,
  type ProductView,
  type SalesClass,
  type UnitInput,
} from "./catalogue";
export {
  branchOfLocation,
  correctBatch,
  recordOpeningBalance,
  setBatchStatus,
  SETTABLE_BATCH_STATUSES,
  stockCard,
  type OpeningBalanceInput,
  type OpeningBalanceLine,
  type OpeningBalanceResult,
  type SettableBatchStatus,
  type StockCard,
} from "./inventory";
export {
  addStaffMember,
  findAuthUserByEmail,
  getFacility,
  isMember,
  listStaffMembers,
  setStaffActive,
  setStaffBranches,
  updateFacility,
  type BranchScope,
  type FacilityProfile,
  type StaffView,
} from "./staff";
export {
  BRANCH_TIMEZONES,
  branchOf,
  createBranch,
  createLocation,
  createWorkstation,
  listBranches,
  renameLocation,
  updateBranch,
  updateWorkstation,
  type BranchTimezone,
  type BranchView,
} from "./organisation";
export { listReconciliationIssues, resolveReconciliationIssue, type ReconciliationIssue } from "./reconciliation";
