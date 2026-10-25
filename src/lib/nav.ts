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
      { title: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", permissions: ["dashboard.view"], status: "live", keywords: ["home", "overview", "kpi"] },
      { title: "My Workspace", href: "/workspace", icon: "Inbox", permissions: [], status: "live", keywords: ["today"] },
      { title: "Approvals", href: "/approvals", icon: "BadgeCheck", permissions: ["documents.approve", "quotations.approve", "projects.activate", "hr.leave.approve", "hr.payroll.manage", "documents.submit_review", "quotations.create"], status: "live", keywords: ["inbox", "maker checker"] },
      { title: "My Tasks", href: "/tasks", icon: "ListTodo", permissions: ["tasks.update_assigned", "projects.manage"], status: "live", keywords: ["todo", "assigned"] },
    ],
  },
  {
    title: "Growth",
    items: [
      { title: "Leads", href: "/leads", icon: "Target", permissions: ["leads.view_all", "leads.view_team", "leads.view_own"], status: "live", keywords: ["prospects", "crm"] },
      { title: "Sales Pipeline", href: "/pipeline", icon: "KanbanSquare", permissions: ["leads.view_all", "leads.view_team", "leads.view_own"], status: "live", keywords: ["kanban", "deals", "board"] },
      { title: "Follow-ups", href: "/follow-ups", icon: "CalendarClock", permissions: ["leads.view_all", "leads.view_team", "leads.view_own"], status: "live", keywords: ["reminders", "due"] },
      { title: "Clients", href: "/clients", icon: "Building2", permissions: ["clients.view"], status: "live", keywords: ["customers", "accounts"] },
      p("Calls & Meetings", "/meetings", "PhoneCall", ["leads.view_all", "leads.view_team", "leads.view_own"], 7, "Calendar sync of calls and meetings needs a Google/Microsoft calendar connection."),
      p("Campaigns", "/campaigns", "Megaphone", ["leads.view_all", "leads.view_team"], 7, "Campaign spend and ROI need ad-platform connections (Meta, Google Ads)."),
    ],
  },
  {
    title: "Sales",
    items: [
      { title: "Product Catalogue", href: "/catalogue", icon: "Package", permissions: ["catalogue.view", "catalogue.manage", "quotations.create"], status: "live", keywords: ["products", "pricing", "hsn", "sac", "gst rules"] },
      { title: "BRD / PRD", href: "/documents", icon: "FileText", permissions: ["documents.view", "documents.create"], status: "live", keywords: ["requirements", "scope"] },
      { title: "Quotations", href: "/quotations", icon: "Receipt", permissions: ["quotations.view", "quotations.create", "quotations.approve"], status: "live", keywords: ["estimate", "proposal"] },
      { title: "Sales Orders", href: "/sales-orders", icon: "FileSignature", permissions: ["orders.view", "orders.manage"], status: "live", keywords: ["contracts", "orders"] },
      { title: "Subscriptions & AMC", href: "/subscriptions", icon: "Repeat", permissions: ["orders.view", "orders.manage"], status: "live", keywords: ["renewals", "amc", "saas"] },
    ],
  },
  {
    title: "Delivery",
    items: [
      { title: "Projects", href: "/projects", icon: "FolderKanban", permissions: ["projects.view", "projects.manage", "tasks.update_assigned"], status: "live", keywords: ["milestones", "uat", "change requests"] },
    ],
  },
  {
    title: "Finance",
    items: [
      { title: "Finance Overview", href: "/finance", icon: "Landmark", permissions: ["finance.view"], status: "live", keywords: ["receivables", "cash"] },
      { title: "Sales Invoices", href: "/finance/invoices", icon: "ReceiptIndianRupee", permissions: ["finance.view"], status: "live", keywords: ["gst invoice", "credit note"] },
      { title: "Receipts", href: "/finance/receipts", icon: "Wallet", permissions: ["finance.view"], status: "live", keywords: ["payments", "collections", "tds"] },
      { title: "Bills & Expenses", href: "/finance/bills", icon: "CreditCard", permissions: ["finance.view"], status: "live", keywords: ["vendors", "purchase"] },
      { title: "Banking", href: "/finance/banking", icon: "Banknote", permissions: ["finance.view"], status: "live", keywords: ["reconciliation", "statement"] },
      { title: "General Ledger", href: "/finance/ledger", icon: "BookOpen", permissions: ["finance.view"], status: "live", keywords: ["journal", "accounts", "coa"] },
      { title: "Financial Reports", href: "/finance/reports", icon: "LineChart", permissions: ["finance.view"], status: "live", keywords: ["p&l", "balance sheet", "trial balance", "gst", "ageing"] },
      { title: "Periods", href: "/finance/periods", icon: "Lock", permissions: ["finance.view"], status: "live", keywords: ["close", "lock"] },
    ],
  },
  {
    title: "People",
    items: [
      { title: "Employees", href: "/people", icon: "Users", permissions: ["hr.view"], status: "live", keywords: ["staff", "directory"] },
      { title: "Attendance & Leave", href: "/people/attendance", icon: "CalendarCheck", permissions: ["hr.self_service", "hr.view"], status: "live", keywords: ["leave", "holidays"] },
      { title: "Payroll", href: "/people/payroll", icon: "IndianRupee", permissions: ["hr.payroll.manage", "finance.journal.post"], status: "live", keywords: ["salary", "payslips"] },
      { title: "My Profile", href: "/me", icon: "CircleUser", permissions: ["hr.self_service"], status: "live", keywords: ["payslip", "password", "leave balance"] },
    ],
  },
  {
    title: "Support",
    items: [
      { title: "Tickets", href: "/support", icon: "LifeBuoy", permissions: ["support.view", "support.manage"], status: "live", keywords: ["sla", "helpdesk"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { title: "Reports", href: "/reports", icon: "BarChart3", permissions: ["reports.view"], status: "live", keywords: ["analytics"] },
      { title: "Automations", href: "/automations", icon: "Workflow", permissions: ["automations.manage"], status: "live", keywords: ["rules", "workflow"] },
      { title: "Audit Logs", href: "/audit", icon: "ScrollText", permissions: ["audit.view"], status: "live", keywords: ["history", "who changed"] },
      { title: "Users & Roles", href: "/settings/users", icon: "UserCog", permissions: ["users.manage_roles"], status: "live", keywords: ["team", "invite", "mfa"] },
      { title: "Settings", href: "/settings", icon: "Settings", permissions: ["settings.manage"], status: "live", keywords: ["organisation", "gstin", "bank", "thresholds"] },
      p("Client Portal", "/portal", "Globe", ["settings.manage"], 7, "Client logins for quotations, invoices, tickets and UAT sign-off."),
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
