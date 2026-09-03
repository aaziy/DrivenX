/**
 * The permission catalogue.
 *
 * SOW §2 requires role permissions to be "configurable by the Super Admin", so roles
 * are rows in the database, not constants in the code. This file is only the seed
 * catalogue and the *default* grants — once seeded, the client edits them at runtime
 * and this file stops being the source of truth for who can do what.
 *
 * Checks are always `can(user, "contract.approve")`, never `user.role === "admin"`.
 * A role-name check would have to be found and edited in every call site the first
 * time the client reorganises their team.
 */

export const PERMISSION_GROUPS = {
  DASHBOARD: "Dashboard",
  CUSTOMERS: "Customers",
  SUPPLIERS: "Suppliers",
  FLEET: "Fleet",
  DOCUMENTS: "Documents",
  SALES: "Sales",
  CONTRACTS: "Contracts",
  PAYMENTS: "Payments",
  INSURANCE: "Insurance",
  OPERATIONS: "Operations",
  EXPENSES: "Expenses",
  REPORTS: "Reports",
  ADMIN: "Administration",
} as const;

export interface PermissionDefinition {
  key: string;
  group: string;
  description: string;
  /** The SOW milestone that first uses this permission. Seeded from the start so
   *  the client can configure roles once rather than after every release. */
  phase: "0" | "1" | "2" | "3";
}

export const PERMISSIONS = [
  // -- Dashboard (SOW §3) --
  { key: "dashboard.view", group: PERMISSION_GROUPS.DASHBOARD, description: "View the dashboard and KPIs", phase: "1" },

  // -- Customers (SOW §6) --
  { key: "customer.view", group: PERMISSION_GROUPS.CUSTOMERS, description: "View customers", phase: "1" },
  { key: "customer.create", group: PERMISSION_GROUPS.CUSTOMERS, description: "Create customers", phase: "1" },
  { key: "customer.update", group: PERMISSION_GROUPS.CUSTOMERS, description: "Edit customers", phase: "1" },
  { key: "customer.delete", group: PERMISSION_GROUPS.CUSTOMERS, description: "Delete customers", phase: "1" },

  // -- Suppliers (SOW §5) --
  { key: "supplier.view", group: PERMISSION_GROUPS.SUPPLIERS, description: "View suppliers", phase: "1" },
  { key: "supplier.create", group: PERMISSION_GROUPS.SUPPLIERS, description: "Create suppliers", phase: "1" },
  { key: "supplier.update", group: PERMISSION_GROUPS.SUPPLIERS, description: "Edit suppliers", phase: "1" },
  { key: "supplier.delete", group: PERMISSION_GROUPS.SUPPLIERS, description: "Delete suppliers", phase: "1" },
  { key: "supplier_invoice.view", group: PERMISSION_GROUPS.SUPPLIERS, description: "View supplier payables", phase: "1" },
  { key: "supplier_invoice.manage", group: PERMISSION_GROUPS.SUPPLIERS, description: "Record supplier payments", phase: "1" },

  // -- Fleet (SOW §4) --
  { key: "vehicle.view", group: PERMISSION_GROUPS.FLEET, description: "View vehicles", phase: "1" },
  { key: "vehicle.create", group: PERMISSION_GROUPS.FLEET, description: "Add vehicles", phase: "1" },
  { key: "vehicle.update", group: PERMISSION_GROUPS.FLEET, description: "Edit vehicles", phase: "1" },
  { key: "vehicle.delete", group: PERMISSION_GROUPS.FLEET, description: "Delete vehicles", phase: "1" },
  { key: "vehicle.transition", group: PERMISSION_GROUPS.FLEET, description: "Change vehicle status", phase: "1" },

  // -- Documents (SOW §6, §16) --
  { key: "document.view", group: PERMISSION_GROUPS.DOCUMENTS, description: "View and download documents", phase: "1" },
  { key: "document.upload", group: PERMISSION_GROUPS.DOCUMENTS, description: "Upload documents", phase: "1" },
  { key: "document.delete", group: PERMISSION_GROUPS.DOCUMENTS, description: "Delete documents", phase: "1" },

  // -- Sales (SOW §7, §8) --
  { key: "lead.view", group: PERMISSION_GROUPS.SALES, description: "View own leads", phase: "1" },
  { key: "lead.view_all", group: PERMISSION_GROUPS.SALES, description: "View all salespeople's leads", phase: "1" },
  { key: "lead.create", group: PERMISSION_GROUPS.SALES, description: "Create leads", phase: "1" },
  { key: "lead.update", group: PERMISSION_GROUPS.SALES, description: "Edit leads", phase: "1" },
  { key: "lead.delete", group: PERMISSION_GROUPS.SALES, description: "Delete leads", phase: "1" },
  { key: "lead.convert", group: PERMISSION_GROUPS.SALES, description: "Convert a lead into a contract", phase: "1" },
  { key: "deal.calculate", group: PERMISSION_GROUPS.SALES, description: "Use the deal calculator", phase: "1" },

  // -- Contracts (SOW §9) --
  { key: "contract.view", group: PERMISSION_GROUPS.CONTRACTS, description: "View contracts", phase: "1" },
  { key: "contract.create", group: PERMISSION_GROUPS.CONTRACTS, description: "Draft contracts", phase: "1" },
  { key: "contract.update", group: PERMISSION_GROUPS.CONTRACTS, description: "Edit contracts", phase: "1" },
  { key: "contract.activate", group: PERMISSION_GROUPS.CONTRACTS, description: "Activate a contract and generate its payment schedule", phase: "1" },
  { key: "contract.cancel", group: PERMISSION_GROUPS.CONTRACTS, description: "Cancel a contract", phase: "1" },
  { key: "contract.delete", group: PERMISSION_GROUPS.CONTRACTS, description: "Delete draft contracts", phase: "1" },

  // -- Payments (SOW §10) --
  { key: "payment.view", group: PERMISSION_GROUPS.PAYMENTS, description: "View payments and schedules", phase: "1" },
  { key: "payment.record", group: PERMISSION_GROUPS.PAYMENTS, description: "Record customer payments", phase: "1" },
  { key: "payment.waive", group: PERMISSION_GROUPS.PAYMENTS, description: "Waive an instalment", phase: "1" },
  { key: "payment.delete", group: PERMISSION_GROUPS.PAYMENTS, description: "Reverse a recorded payment", phase: "1" },

  // -- Insurance (SOW §11) --
  { key: "insurance.view", group: PERMISSION_GROUPS.INSURANCE, description: "View insurance policies", phase: "1" },
  { key: "insurance.manage", group: PERMISSION_GROUPS.INSURANCE, description: "Create and renew insurance policies", phase: "1" },

  // -- Operations (SOW §12, §13) --
  { key: "handover.view", group: PERMISSION_GROUPS.OPERATIONS, description: "View handover and return records", phase: "2" },
  { key: "handover.manage", group: PERMISSION_GROUPS.OPERATIONS, description: "Record vehicle handover and return", phase: "2" },
  { key: "maintenance.view", group: PERMISSION_GROUPS.OPERATIONS, description: "View maintenance records", phase: "2" },
  { key: "maintenance.manage", group: PERMISSION_GROUPS.OPERATIONS, description: "Record maintenance", phase: "2" },
  { key: "fine.view", group: PERMISSION_GROUPS.OPERATIONS, description: "View traffic fines", phase: "2" },
  { key: "fine.manage", group: PERMISSION_GROUPS.OPERATIONS, description: "Record and recover fines", phase: "2" },
  { key: "accident.view", group: PERMISSION_GROUPS.OPERATIONS, description: "View accidents", phase: "2" },
  { key: "accident.manage", group: PERMISSION_GROUPS.OPERATIONS, description: "Record accidents and claims", phase: "2" },

  // -- Expenses (SOW §13, §14) --
  { key: "expense.view", group: PERMISSION_GROUPS.EXPENSES, description: "View expenses", phase: "2" },
  { key: "expense.manage", group: PERMISSION_GROUPS.EXPENSES, description: "Record expenses", phase: "2" },

  // -- Reports (SOW §14, §15) --
  { key: "report.view", group: PERMISSION_GROUPS.REPORTS, description: "View operational reports", phase: "1" },
  { key: "report.financial", group: PERMISSION_GROUPS.REPORTS, description: "View profit and financial reports", phase: "1" },
  { key: "report.export", group: PERMISSION_GROUPS.REPORTS, description: "Export reports to Excel and PDF", phase: "1" },

  // -- Administration (SOW §17) --
  { key: "user.view", group: PERMISSION_GROUPS.ADMIN, description: "View users", phase: "0" },
  { key: "user.manage", group: PERMISSION_GROUPS.ADMIN, description: "Create, edit and deactivate users", phase: "0" },
  { key: "role.view", group: PERMISSION_GROUPS.ADMIN, description: "View roles and permissions", phase: "0" },
  { key: "role.manage", group: PERMISSION_GROUPS.ADMIN, description: "Create roles and change their permissions", phase: "0" },
  { key: "settings.manage", group: PERMISSION_GROUPS.ADMIN, description: "Manage categories, notification and company settings", phase: "0" },
  { key: "audit.view", group: PERMISSION_GROUPS.ADMIN, description: "View the audit log", phase: "0" },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

// ---------------------------------------------------------------------------
// Default roles — SOW §2. Seeded once; editable by the Super Admin thereafter.
// ---------------------------------------------------------------------------

export interface RoleDefinition {
  key: string;
  name: string;
  description: string;
  /** `"*"` means every permission, including ones added by later phases. */
  permissions: readonly PermissionKey[] | "*";
}

export const DEFAULT_ROLES = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Full access to every part of the system, including user and role management.",
    permissions: "*",
  },
  {
    key: "admin",
    name: "Admin / Management",
    description:
      "Customers, vehicles, suppliers, contracts, payments, reports and profitability. Cannot manage users or roles.",
    permissions: [
      "dashboard.view",
      "customer.view", "customer.create", "customer.update", "customer.delete",
      "supplier.view", "supplier.create", "supplier.update", "supplier.delete",
      "supplier_invoice.view", "supplier_invoice.manage",
      "vehicle.view", "vehicle.create", "vehicle.update", "vehicle.delete", "vehicle.transition",
      "document.view", "document.upload", "document.delete",
      "lead.view", "lead.view_all", "lead.create", "lead.update", "lead.delete", "lead.convert",
      "deal.calculate",
      "contract.view", "contract.create", "contract.update", "contract.activate", "contract.cancel",
      "payment.view", "payment.record", "payment.waive",
      "insurance.view", "insurance.manage",
      "handover.view", "handover.manage",
      "maintenance.view", "maintenance.manage",
      "fine.view", "fine.manage",
      "accident.view", "accident.manage",
      "expense.view", "expense.manage",
      "report.view", "report.financial", "report.export",
      "audit.view",
    ],
  },
  {
    key: "sales",
    name: "Sales Staff",
    description:
      "Leads, deals, customer information, documents and the deal calculator. Sees only their own leads.",
    permissions: [
      "dashboard.view",
      "customer.view", "customer.create", "customer.update",
      "vehicle.view",
      "document.view", "document.upload",
      // Deliberately excludes lead.view_all — P1F-05 scopes Sales Staff to their own
      // pipeline. Granting lead.view_all is a one-click change if the client disagrees.
      "lead.view", "lead.create", "lead.update", "lead.convert",
      "deal.calculate",
      "contract.view", "contract.create",
      "report.view",
    ],
  },
  {
    key: "finance",
    name: "Accounts / Finance",
    description: "Payments, receivables, supplier payments, expenses and financial reports.",
    permissions: [
      "dashboard.view",
      "customer.view",
      "supplier.view",
      "supplier_invoice.view", "supplier_invoice.manage",
      "vehicle.view",
      "document.view", "document.upload",
      "contract.view",
      "payment.view", "payment.record", "payment.waive", "payment.delete",
      "insurance.view", "insurance.manage",
      "expense.view", "expense.manage",
      "fine.view",
      "report.view", "report.financial", "report.export",
    ],
  },
  {
    key: "operations",
    name: "Operations",
    description:
      "Vehicles, maintenance, insurance, registration, accidents, fines and handover/return.",
    permissions: [
      "dashboard.view",
      "customer.view",
      "supplier.view",
      "vehicle.view", "vehicle.create", "vehicle.update", "vehicle.transition",
      "document.view", "document.upload",
      "contract.view",
      "insurance.view", "insurance.manage",
      "handover.view", "handover.manage",
      "maintenance.view", "maintenance.manage",
      "fine.view", "fine.manage",
      "accident.view", "accident.manage",
      "expense.view", "expense.manage",
      "report.view",
    ],
  },
] as const satisfies readonly RoleDefinition[];

export type RoleKey = (typeof DEFAULT_ROLES)[number]["key"];

/** Resolve a role definition's permission list, expanding `"*"`. */
export function resolveRolePermissions(role: RoleDefinition): readonly PermissionKey[] {
  return role.permissions === "*" ? ALL_PERMISSION_KEYS : role.permissions;
}
