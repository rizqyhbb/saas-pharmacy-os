/**
 * Who may do what (DOMAIN-MODEL.md §11 "Permissions", PRODUCT.md "Users").
 *
 * This is the default matrix. The API checks it on every privileged action using the
 * role stored in the database, never a role claimed by the client or the token.
 * Later, tenants may tighten or widen non-critical permissions; the CRITICAL ones
 * below stay fixed. The defaults still need review with the design-partner APJ
 * [VALIDATE].
 */

export const ROLES = [
  "OWNER",
  "BRANCH_MANAGER",
  "PHARMACIST",
  "TECHNICIAN",
  "CASHIER",
  "PURCHASING",
  "WAREHOUSE",
  "FINANCE",
  "AUDITOR",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // tenancy and people
  "tenant.settings.update",
  "branch.manage",
  "staff.read",
  "staff.manage",
  "audit.read",
  // catalogue
  "product.read",
  "product.write",
  "product.classify",
  "price.update",
  // inventory
  "stock.read",
  "stock.opening_balance",
  "stock.receive",
  "stock.count",
  "stock.adjust",
  "batch.correct",
  "batch.status.update",
  // counter
  "sale.create",
  "sale.discount",
  "sale.void",
  "sale.refund",
  "shift.manage",
  // procurement and money
  "purchase_order.create",
  "purchase_order.approve",
  "payable.pay",
  "report.financial.read",
  // clinical (v1.1)
  "prescription.approve",
  "controlled.approve",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions that are never configurable per tenant. Clinical approvals belong to
 * the pharmacist (PRODUCT.md: "the only role that can approve a prescription ...
 * or approve controlled-medicine transactions").
 */
export const CRITICAL_PERMISSIONS: readonly Permission[] = [
  "prescription.approve",
  "controlled.approve",
  "staff.manage",
  "batch.correct",
  "audit.read",
];

const READ_ONLY: readonly Permission[] = ["product.read", "stock.read"];

/** Default grants per role. Read through `can()`, not directly. */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: [
    "tenant.settings.update",
    "branch.manage",
    "staff.read",
    "staff.manage",
    "audit.read",
    ...READ_ONLY,
    "product.write",
    "product.classify",
    "price.update",
    "stock.opening_balance",
    "stock.receive",
    "stock.count",
    "stock.adjust",
    "batch.correct",
    "batch.status.update",
    "sale.create",
    "sale.discount",
    "sale.void",
    "sale.refund",
    "shift.manage",
    "purchase_order.create",
    "purchase_order.approve",
    "payable.pay",
    "report.financial.read",
  ],
  BRANCH_MANAGER: [
    "staff.read",
    ...READ_ONLY,
    "product.write",
    "price.update",
    "stock.opening_balance",
    "stock.receive",
    "stock.count",
    "stock.adjust",
    "batch.status.update",
    "sale.create",
    "sale.discount",
    "sale.void",
    "sale.refund",
    "shift.manage",
    "purchase_order.create",
    "purchase_order.approve",
    "report.financial.read",
  ],
  PHARMACIST: [
    ...READ_ONLY,
    "product.classify",
    "batch.status.update",
    "stock.receive",
    "stock.count",
    "sale.create",
    "prescription.approve",
    "controlled.approve",
  ],
  TECHNICIAN: [...READ_ONLY, "stock.receive", "stock.count", "sale.create"],
  CASHIER: [...READ_ONLY, "sale.create", "sale.discount", "shift.manage"],
  PURCHASING: [...READ_ONLY, "product.write", "stock.receive", "purchase_order.create"],
  WAREHOUSE: [...READ_ONLY, "stock.opening_balance", "stock.receive", "stock.count", "stock.adjust"],
  FINANCE: [...READ_ONLY, "payable.pay", "report.financial.read"],
  AUDITOR: [...READ_ONLY, "staff.read", "audit.read", "report.financial.read"],
};

export const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

export function can(role: Role, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role].includes(permission);
}

export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter((role) => can(role, permission));
}
