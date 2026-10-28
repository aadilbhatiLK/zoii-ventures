/** Sprint 6 contracts: HR, payroll, support, automations, audit. */
import { z } from "zod";
import { DateOnly, Id, Money, optText } from "./common";

export const EmployeeInputSchema = z.object({
  fullName: z.string().trim().min(2).max(120), workEmail: z.union([z.literal(""), z.email()]).optional().transform((v) => v || undefined),
  phone: optText(20), departmentId: Id.optional().nullable(), designation: z.string().trim().min(2).max(120), managerEmployeeId: Id.optional().nullable(),
  dateOfJoining: DateOnly, employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
  workState: z.string().regex(/^\d{2}$/).optional().nullable(), userId: Id.optional().nullable(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F").optional().or(z.literal("")).transform((v) => v || undefined),
  uan: z.string().trim().regex(/^[0-9]{12}$/, "UAN is 12 digits").optional().or(z.literal("")).transform((v) => v || undefined),
  bankAccount: z.string().trim().regex(/^[0-9]{9,18}$/, "9–18 digits").optional().or(z.literal("")).transform((v) => v || undefined),
  bankIfsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like SBIN0031801").optional().or(z.literal("")).transform((v) => v || undefined),
});
export interface Employee {
  id: string; code: string; userId: string | null; fullName: string; workEmail: string | null; phone: string | null; departmentId: string | null; departmentName: string | null;
  designation: string; managerEmployeeId: string | null; dateOfJoining: string; dateOfExit: string | null; status: "active" | "notice" | "exited";
  employmentType: string; workState: string | null; pan: string | null; uan: string | null; bankAccountMasked: string | null; bankIfsc: string | null; monthlyGross: string | null;
}
export interface Department { id: string; name: string; headUserId: string | null; headcount: number }

export const ATTENDANCE_STATUSES = { present: "Present", wfh: "Work from home", half_day: "Half day", absent: "Absent", leave: "On leave", holiday: "Holiday", weekly_off: "Weekly off" } as const;
export const AttendanceMarkSchema = z.object({
  employeeId: Id.optional(), workDate: DateOnly, status: z.enum(["present", "wfh", "half_day", "absent", "holiday", "weekly_off"]), note: optText(300),
});
export interface AttendanceDay { employeeId: string; workDate: string; status: keyof typeof ATTENDANCE_STATUSES; source: string; note: string | null }

export interface LeaveType { id: string; code: string; name: string; annualQuota: string; paid: boolean }
export const LeaveRequestSchema = z.object({
  employeeId: Id.optional(), leaveTypeId: Id, fromDate: DateOnly, toDate: DateOnly, halfDay: z.boolean().default(false), reason: z.string().trim().min(3).max(500),
}).refine((l) => l.toDate >= l.fromDate, { message: "End date is before the start", path: ["toDate"] }).refine((l) => !l.halfDay || l.fromDate === l.toDate, { message: "Half day is a single date", path: ["halfDay"] });
export interface LeaveRequest {
  id: string; employeeId: string; employeeName: string; leaveTypeId: string; leaveTypeCode: string; fromDate: string; toDate: string; halfDay: boolean; days: string;
  reason: string; status: "pending" | "approved" | "rejected" | "cancelled"; decidedBy: string | null; decisionNote: string | null; createdAt: string;
}
export interface LeaveBalance { leaveTypeId: string; code: string; name: string; quota: string; used: string; pending: string; available: string }

export const SalaryComponentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,15}$/), name: z.string().trim().min(2).max(60),
  kind: z.enum(["earning", "deduction"]), calc: z.enum(["fixed", "percent_of_basic"]), value: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
});
export const SalaryStructureSchema = z.object({
  effectiveFrom: DateOnly, monthlyTds: Money.default("0"),
  components: z.array(SalaryComponentSchema).min(1).max(30),
}).refine((s) => s.components.some((c) => c.code === "BASIC" && c.kind === "earning" && c.calc === "fixed"), { message: "Include a fixed BASIC earning", path: ["components"] })
  .refine((s) => new Set(s.components.map((c) => c.code)).size === s.components.length, { message: "Component codes must be unique", path: ["components"] });
export type SalaryComponent = z.infer<typeof SalaryComponentSchema>;
export interface SalaryStructure { id: string; employeeId: string; effectiveFrom: string; components: SalaryComponent[]; monthlyGross: string; monthlyTds: string }

export interface PayslipLine { code: string; name: string; amount: string }
export interface Payslip {
  id: string; employeeId: string; employeeName: string; employeeCode: string; workingDays: string; payableDays: string; lopDays: string;
  earnings: PayslipLine[]; deductions: PayslipLine[]; employerContributions: PayslipLine[]; gross: string; totalDeductions: string; netPay: string; employerCost: string;
}
export interface PayrollRun {
  id: string; month: string; status: "draft" | "approved" | "posted" | "cancelled"; employeesCount: number; grossTotal: string; deductionsTotal: string; netTotal: string; employerTotal: string;
  preparedBy: string; preparedAt: string; approvedBy: string | null; approvedAt: string | null; journalEntryId: string | null; postedAt: string | null; payslips?: Payslip[]; warnings?: string[];
}

export const TicketInputSchema = z.object({
  clientId: Id, projectId: Id.optional().nullable(), subscriptionId: Id.optional().nullable(), subject: z.string().trim().min(3).max(200), description: z.string().trim().min(3).max(8000),
  category: z.enum(["support", "bug", "change", "billing", "other"]).default("support"), priority: z.enum(["low", "medium", "high", "urgent"]),
  channel: z.enum(["phone", "email", "whatsapp", "portal", "in_person"]).default("phone"), assigneeId: Id.optional().nullable(),
});
export type TicketStatus = "open" | "in_progress" | "waiting_on_client" | "resolved" | "closed";
export interface Ticket {
  id: string; number: string; clientId: string; clientName: string; projectId: string | null; subscriptionId: string | null; subject: string; description: string;
  category: string; priority: "low" | "medium" | "high" | "urgent"; status: TicketStatus; channel: string; assigneeId: string | null;
  firstResponseDueAt: string; resolutionDueAt: string; firstRespondedAt: string | null; resolvedAt: string | null; closedAt: string | null; createdAt: string;
  sla: { firstResponse: "met" | "breached" | "pending" | "at_risk"; resolution: "met" | "breached" | "pending" | "at_risk" };
  comments?: { id: string; authorId: string; body: string; internal: boolean; createdAt: string }[];
}
export const TicketUpdateSchema = z.object({ status: z.enum(["open", "in_progress", "waiting_on_client", "resolved", "closed"]).optional(), assigneeId: Id.optional().nullable(), priority: z.enum(["low", "medium", "high", "urgent"]).optional() });
export const TicketCommentSchema = z.object({ body: z.string().trim().min(1).max(8000), internal: z.boolean().default(false) });

export const AUTOMATION_TRIGGERS = {
  "lead.created": "A lead is created",
  "lead.stage_changed": "A lead changes stage",
  "lead.converted": "A lead is converted to a client",
  "quotation.accepted": "A client accepts a quotation",
  "invoice.issued": "An invoice is issued",
  "receipt.recorded": "A payment is recorded",
  "milestone.signed_off": "A milestone is signed off",
  "ticket.created": "A support ticket is opened",
  "schedule.invoice_overdue": "Daily: an invoice is overdue",
  "schedule.ticket_sla_breach": "Every run: a ticket breaches its SLA",
  "schedule.follow_up_overdue": "Daily: a lead follow-up is overdue",
} as const;
export type AutomationTrigger = keyof typeof AUTOMATION_TRIGGERS;
export const AutomationConditionSchema = z.object({ field: z.string().regex(/^[a-zA-Z_.]{1,60}$/), op: z.enum(["eq", "neq", "gte", "lte", "in"]), value: z.union([z.string().max(200), z.number(), z.array(z.string().max(100)).max(20)]) });
export const AutomationActionSchema = z.object({
  type: z.enum(["notify", "email"]),
  to: z.string().regex(/^(owner|assignee|account_manager|role:[a-z_]+|user:[0-9a-f-]{36})$/, "owner, assignee, account_manager, role:<key> or user:<id>"),
  title: z.string().trim().min(3).max(140), body: z.string().max(1000).default(""),
});
export const AutomationRuleSchema = z.object({
  name: z.string().trim().min(3).max(120), trigger: z.enum(Object.keys(AUTOMATION_TRIGGERS) as [AutomationTrigger, ...AutomationTrigger[]]),
  conditions: z.array(AutomationConditionSchema).max(10).default([]), actions: z.array(AutomationActionSchema).min(1).max(5), enabled: z.boolean().default(true),
});
export interface AutomationRule { id: string; name: string; trigger: AutomationTrigger; conditions: z.infer<typeof AutomationConditionSchema>[]; actions: z.infer<typeof AutomationActionSchema>[]; enabled: boolean; createdAt: string; lastRunAt: string | null; runs: number }
export interface AutomationRun { id: string; ruleId: string; ruleName: string; dedupeKey: string; entityType: string | null; entityId: string | null; status: "succeeded" | "failed" | "skipped"; detail: string | null; startedAt: string }

export interface AuditEntry { id: string; occurredAt: string; actorId: string | null; actorName: string | null; action: string; entityType: string; entityId: string | null; changes: Record<string, unknown>; requestId: string | null; ip: string | null }
