/**
 * Central permission registry. The backend must enforce the same keys; the frontend
 * only uses them to shape the UI. docs/rbac-matrix.md is generated from this file
 * (npm run docs:rbac) so the documentation cannot drift from the code.
 */
export const PERMISSIONS = {
  "dashboard.view": "View dashboards",
  "dashboard.view_company_metrics": "View company-wide revenue and pipeline metrics",
  "leads.view_all": "View every lead",
  "leads.view_team": "View leads owned by their team",
  "leads.view_own": "View leads assigned to them",
  "leads.create": "Create leads",
  "leads.update": "Edit leads they can see",
  "leads.assign": "Assign or reassign lead owners",
  "leads.convert": "Convert a qualified lead into a client",
  "leads.export": "Export lead lists",
  "clients.view": "View clients",
  "clients.create": "Create clients",
  "clients.update": "Edit clients",
  "documents.create": "Create BRD/PRD and other documents",
  "documents.submit_review": "Submit documents for review",
  "documents.approve": "Approve documents",
  "quotations.create": "Create quotations",
  "quotations.approve": "Approve quotations",
  "projects.view": "View projects",
  "projects.activate": "Activate billable projects",
  "finance.view": "View finance records",
  "finance.invoice.issue": "Issue sales invoices",
  "finance.journal.post": "Post journal entries",
  "finance.period.close": "Close financial periods",
  "hr.view": "View employee records",
  "hr.payroll.manage": "Prepare and approve payroll",
  "support.view": "View support tickets",
  "reports.view": "View reports",
  "audit.view": "View audit logs",
  "users.manage_roles": "Manage users and role assignments",
  "settings.manage": "Change system configuration",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  super_admin: "Super Admin",
  founder: "Founder / Director",
  sales_manager: "Sales Manager",
  sales_executive: "Sales Executive",
  account_manager: "Account Manager",
  business_analyst: "Business Analyst",
  technical_lead: "Technical Lead",
  project_manager: "Project Manager",
  finance_manager: "Finance Manager",
  accountant: "Accountant",
  hr_manager: "HR Manager",
  employee: "Employee",
  auditor: "Auditor (read-only)",
  client_user: "Client User",
} as const;

export type Role = keyof typeof ROLES;

const ALL = Object.keys(PERMISSIONS) as Permission[];

const READ_ONLY: Permission[] = ALL.filter(
  (p) =>
    p.endsWith(".view") ||
    p.startsWith("dashboard.") ||
    p === "leads.view_all" ||
    p === "reports.view" ||
    p === "audit.view",
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: ALL,
  founder: ALL.filter((p) => p !== "settings.manage"),
  sales_manager: [
    "dashboard.view",
    "dashboard.view_company_metrics",
    "leads.view_team",
    "leads.create",
    "leads.update",
    "leads.assign",
    "leads.convert",
    "leads.export",
    "clients.view",
    "clients.create",
    "clients.update",
    "documents.create",
    "documents.submit_review",
    "quotations.create",
    "reports.view",
  ],
  sales_executive: [
    "dashboard.view",
    "leads.view_own",
    "leads.create",
    "leads.update",
    "leads.convert",
    "clients.view",
    "clients.create",
    "documents.create",
    "documents.submit_review",
    "quotations.create",
  ],
  account_manager: [
    "dashboard.view",
    "leads.view_own",
    "leads.update",
    "clients.view",
    "clients.update",
    "documents.create",
    "documents.submit_review",
    "projects.view",
    "support.view",
  ],
  business_analyst: [
    "dashboard.view",
    "clients.view",
    "documents.create",
    "documents.submit_review",
    "projects.view",
  ],
  technical_lead: [
    "dashboard.view",
    "clients.view",
    "documents.create",
    "documents.approve",
    "projects.view",
  ],
  project_manager: [
    "dashboard.view",
    "clients.view",
    "documents.create",
    "projects.view",
    "projects.activate",
    "support.view",
  ],
  finance_manager: [
    "dashboard.view",
    "dashboard.view_company_metrics",
    "clients.view",
    "quotations.approve",
    "finance.view",
    "finance.invoice.issue",
    "finance.journal.post",
    "finance.period.close",
    "reports.view",
  ],
  accountant: [
    "dashboard.view",
    "clients.view",
    "finance.view",
    "finance.invoice.issue",
    "reports.view",
  ],
  hr_manager: ["dashboard.view", "hr.view", "hr.payroll.manage"],
  employee: ["dashboard.view"],
  auditor: READ_ONLY,
  client_user: [],
};
