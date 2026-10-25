/**
 * Navigation registry: workflow-grouped, permission-filtered. Items marked
 * "planned" route to an honest roadmap page instead of a decorative screen.
 */
import type { Permission } from "@/lib/permissions";

export type NavStatus = "live" | "planned";

export interface NavItem {
  title: string;
  href: string;
  icon: string;
  /** Visible when the user has ANY of these. Empty = every signed-in user. */
  permissions: Permission[];
  status: NavStatus;
  sprint?: number;
  summary?: string;
  keywords?: string[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const p = (
  title: string,
  href: string,
  icon: string,
  permissions: Permission[],
  sprint: number,
  summary: string,
): NavItem => ({
  title,
  href,
  icon,
  permissions,
  status: "planned",
  sprint,
  summary,
});

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: "LayoutDashboard",
        permissions: ["dashboard.view"],
        status: "live",
        keywords: ["home", "overview", "kpi"],
      },
      {
        title: "My Workspace",
        href: "/workspace",
        icon: "Inbox",
        permissions: [],
        status: "live",
        keywords: ["tasks", "today"],
      },
      p(
        "Activity Feed",
        "/activity",
        "Activity",
        ["dashboard.view_company_metrics"],
        2,
        "Company-wide event stream from the audit and activity tables.",
      ),
    ],
  },
  {
    title: "Growth",
    items: [
      {
        title: "Leads",
        href: "/leads",
        icon: "Target",
        permissions: ["leads.view_all", "leads.view_team", "leads.view_own"],
        status: "live",
        keywords: ["prospects", "crm"],
      },
      {
        title: "Sales Pipeline",
        href: "/pipeline",
        icon: "KanbanSquare",
        permissions: ["leads.view_all", "leads.view_team", "leads.view_own"],
        status: "live",
        keywords: ["kanban", "deals", "board"],
      },
      {
        title: "Follow-ups",
        href: "/follow-ups",
        icon: "CalendarClock",
        permissions: ["leads.view_all", "leads.view_team", "leads.view_own"],
        status: "live",
        keywords: ["reminders", "due"],
      },
      {
        title: "Clients",
        href: "/clients",
        icon: "Building2",
        permissions: ["clients.view"],
        status: "live",
        keywords: ["customers", "accounts"],
      },
      p(
        "Calls & Meetings",
        "/meetings",
        "PhoneCall",
        ["leads.view_all", "leads.view_team", "leads.view_own"],
        2,
        "Calendar view of logged calls and meetings, with provider sync.",
      ),
      p(
        "Campaigns",
        "/campaigns",
        "Megaphone",
        ["leads.view_all", "leads.view_team"],
        6,
        "Campaign attribution and ROI by source.",
      ),
      p(
        "Sales Targets",
        "/targets",
        "Flag",
        ["leads.assign"],
        6,
        "Targets per executive with achievement tracking.",
      ),
    ],
  },
  {
    title: "Products & Revenue",
    items: [
      p(
        "Product Catalogue",
        "/products",
        "Package",
        ["clients.view"],
        3,
        "Products, plans, pricing rules and tax classification (SAC/HSN).",
      ),
      p(
        "Subscriptions",
        "/subscriptions",
        "Repeat",
        ["clients.view"],
        4,
        "SaaS subscriptions, renewals and licences.",
      ),
    ],
  },
  {
    title: "Sales Documents",
    items: [
      p(
        "BRD / PRD",
        "/documents",
        "FileText",
        ["documents.create"],
        3,
        "Versioned requirement documents with immutable approved snapshots.",
      ),
      p(
        "Quotations",
        "/quotations",
        "Receipt",
        ["quotations.create", "quotations.approve"],
        3,
        "Quotation drafts, revisions, approvals and PDF output.",
      ),
      p(
        "Contracts",
        "/contracts",
        "FileSignature",
        ["documents.approve"],
        4,
        "Contracts and sales orders; e-signature via a verified provider adapter.",
      ),
      p(
        "Approvals",
        "/approvals",
        "BadgeCheck",
        ["documents.approve", "quotations.approve"],
        3,
        "Approval inbox for documents and quotations.",
      ),
    ],
  },
  {
    title: "Delivery",
    items: [
      p(
        "Projects",
        "/projects",
        "FolderKanban",
        ["projects.view"],
        4,
        "Projects created from accepted sales work, with milestones and tasks.",
      ),
      p(
        "Change Requests",
        "/change-requests",
        "GitPullRequestArrow",
        ["projects.view"],
        4,
        "Scope changes against approved baselines.",
      ),
      p(
        "QA / UAT",
        "/uat",
        "ClipboardCheck",
        ["projects.view"],
        4,
        "UAT cycles, test cases and client sign-off.",
      ),
      p(
        "Warranty / AMC",
        "/amc",
        "ShieldCheck",
        ["projects.view", "support.view"],
        4,
        "Warranty and AMC contracts with renewal tracking.",
      ),
    ],
  },
  {
    title: "Finance",
    items: [
      p(
        "Finance Dashboard",
        "/finance",
        "Landmark",
        ["finance.view"],
        5,
        "Collections, receivables ageing, payables and profitability from the ledger.",
      ),
      p(
        "Sales Invoices",
        "/finance/invoices",
        "ReceiptIndianRupee",
        ["finance.view"],
        5,
        "GST invoices with CA-reviewed tax rules and numbering.",
      ),
      p(
        "Payments & Receipts",
        "/finance/payments",
        "Wallet",
        ["finance.view"],
        5,
        "Receipts, allocations and idempotent payment webhooks.",
      ),
      p(
        "Expenses & Bills",
        "/finance/expenses",
        "CreditCard",
        ["finance.view"],
        5,
        "Purchase bills, expenses and reimbursements.",
      ),
      p(
        "Banking",
        "/finance/banking",
        "Banknote",
        ["finance.view"],
        5,
        "Bank statement import and reconciliation.",
      ),
      p(
        "General Ledger",
        "/finance/ledger",
        "BookOpen",
        ["finance.view"],
        5,
        "Chart of accounts, double-entry journals and periods.",
      ),
      p(
        "GST Reports",
        "/finance/gst",
        "Percent",
        ["finance.view"],
        5,
        "GSTR-1/3B working summaries and reconciliation exports.",
      ),
      p(
        "Financial Statements",
        "/finance/statements",
        "LineChart",
        ["finance.view"],
        5,
        "P&L, balance sheet and cash flow derived from the ledger.",
      ),
    ],
  },
  {
    title: "People",
    items: [
      p(
        "Employees",
        "/people",
        "Users",
        ["hr.view"],
        6,
        "Directory, departments, reporting lines and documents.",
      ),
      p(
        "Attendance & Leave",
        "/people/attendance",
        "CalendarCheck",
        ["hr.view"],
        6,
        "Attendance records and leave requests.",
      ),
      p(
        "Payroll",
        "/people/payroll",
        "IndianRupee",
        ["hr.payroll.manage"],
        6,
        "Salary structures and payroll runs with approval.",
      ),
    ],
  },
  {
    title: "Support",
    items: [
      p(
        "Tickets",
        "/support",
        "LifeBuoy",
        ["support.view"],
        6,
        "Tickets, SLAs and customer satisfaction.",
      ),
    ],
  },
  {
    title: "Administration",
    items: [
      p(
        "Reports",
        "/reports",
        "BarChart3",
        ["reports.view"],
        5,
        "Filterable reports with CSV export.",
      ),
      p(
        "Automations",
        "/automations",
        "Workflow",
        ["settings.manage"],
        6,
        "Trigger → condition → action rules with run history.",
      ),
      p(
        "Audit Logs",
        "/audit",
        "ScrollText",
        ["audit.view"],
        2,
        "Who changed what and when, for every sensitive action.",
      ),
      p(
        "Users & Roles",
        "/settings/users",
        "UserCog",
        ["users.manage_roles"],
        2,
        "User management and role assignment with MFA policy.",
      ),
      p(
        "Settings",
        "/settings",
        "Settings",
        ["settings.manage"],
        2,
        "Organisation profile, GST registration and numbering series.",
      ),
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}

export function visibleNav(has: (p: Permission) => boolean): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.permissions.length === 0 || i.permissions.some(has)),
  })).filter((g) => g.items.length > 0);
}
