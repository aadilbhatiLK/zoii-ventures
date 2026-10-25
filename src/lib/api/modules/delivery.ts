/** Sprint 4 contracts: sales orders, projects, milestones, tasks, change requests, UAT, sign-off, subscriptions. */
import { z } from "zod";
import { DateOnly, HsnSac, Id, Money, NullableDate, optText } from "./common";

export interface SalesOrder {
  id: string; number: string; clientId: string; clientName: string; quotationId: string; quotationNumber: string; status: "open" | "completed" | "cancelled";
  orderDate: string; taxableTotal: string; taxTotal: string; grandTotal: string; invoicedTotal: string; projectIds: string[]; createdAt: string;
}

export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(3).max(160), clientId: Id, salesOrderId: Id.optional().nullable(), scopeDocumentId: Id.optional().nullable(),
  billable: z.boolean().default(true), managerId: Id, startDate: NullableDate, dueDate: NullableDate,
  memberIds: z.array(Id).max(50).default([]),
});
export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";
export interface ActivationCheck { key: string; label: string; ok: boolean; detail: string }
export interface Project {
  id: string; code: string; name: string; clientId: string; clientName: string; salesOrderId: string | null; salesOrderNumber: string | null;
  scopeDocumentId: string | null; billable: boolean; status: ProjectStatus; managerId: string; startDate: string | null; dueDate: string | null;
  activatedAt: string | null; completedAt: string | null; memberIds: string[]; taskCounts: Record<string, number>; milestoneCount: number; createdAt: string;
}
export interface ProjectDetail extends Project { milestones: Milestone[]; activation: ActivationCheck[]; changeRequests: ChangeRequest[] }

export const MilestoneInputSchema = z.object({ name: z.string().trim().min(2).max(160), dueDate: NullableDate, amount: Money.default("0") });
export type MilestoneStatus = "pending" | "in_progress" | "uat" | "signed_off" | "invoiced";
export interface Milestone {
  id: string; seq: number; name: string; dueDate: string | null; amount: string; status: MilestoneStatus; signedOffAt: string | null;
  uat: UatItem[]; signoff: Signoff | null; invoiceId: string | null;
}

export const TaskInputSchema = z.object({
  title: z.string().trim().min(2).max(200), description: optText(4000), milestoneId: Id.optional().nullable(), assigneeId: Id.optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), dueDate: NullableDate,
  estimateHours: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/).optional().nullable(),
});
export const TASK_STATUSES = { todo: "To do", in_progress: "In progress", review: "In review", blocked: "Blocked", done: "Done" } as const;
export type TaskStatus = keyof typeof TASK_STATUSES;
export interface Task {
  id: string; projectId: string; projectName: string; milestoneId: string | null; title: string; description: string | null; status: TaskStatus;
  priority: "low" | "medium" | "high" | "urgent"; assigneeId: string | null; dueDate: string | null; estimateHours: string | null; sort: number; updatedAt: string;
}
export const TaskMoveSchema = z.object({ status: z.enum(["todo", "in_progress", "review", "blocked", "done"]), sort: z.number().int().min(0).max(1_000_000).optional(), expectedUpdatedAt: z.string().optional() });

export const ChangeRequestInputSchema = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(8000),
  impactAmount: Money.default("0"), impactDays: z.number().int().min(0).max(3650).default(0),
});
export interface ChangeRequest {
  id: string; number: string; projectId: string; title: string; description: string; impactAmount: string; impactDays: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "cancelled"; clientApproved: boolean; requestedBy: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string;
}
export const CrSubmitSchema = z.object({ clientApproved: z.literal(true, { error: "Record the client's approval of this change first" }), clientEvidence: z.string().trim().min(3).max(300) });

export interface UatItem { id: string; title: string; expectedResult: string | null; status: "pending" | "passed" | "failed"; testedByName: string | null; notes: string | null; updatedAt: string }
export const UatInputSchema = z.object({ title: z.string().trim().min(3).max(300), expectedResult: optText(2000) });
export const UatResultSchema = z.object({ status: z.enum(["pending", "passed", "failed"]), testedByName: optText(120), notes: optText(2000) });
export interface Signoff { id: string; signedByName: string; signedByEmail: string | null; method: "email_confirmation" | "signed_document" | "in_person"; evidenceRef: string; signedAt: string; recordedBy: string }
export const SignoffInputSchema = z.object({
  signedByName: z.string().trim().min(2).max(120), signedByEmail: z.union([z.literal(""), z.email()]).optional().transform((v) => v || undefined),
  method: z.enum(["email_confirmation", "signed_document", "in_person"]), evidenceRef: z.string().trim().min(3).max(300),
  signedAt: z.iso.datetime({ offset: true }),
});

export const SubscriptionInputSchema = z.object({
  clientId: Id, productId: Id.optional().nullable(), salesOrderId: Id.optional().nullable(), kind: z.enum(["subscription", "amc"]),
  description: z.string().trim().min(3).max(300), hsnSac: HsnSac, amount: Money.refine((v) => Number(v) > 0, "Amount must be more than 0"),
  billingCycle: z.enum(["monthly", "quarterly", "yearly"]), startDate: DateOnly, endDate: NullableDate,
  autoRenew: z.boolean().default(true), renewalNoticeDays: z.number().int().min(0).max(180).default(30), ownerId: Id.optional(),
});
export interface Subscription {
  id: string; number: string; clientId: string; clientName: string; productId: string | null; salesOrderId: string | null; kind: "subscription" | "amc";
  description: string; hsnSac: string; amount: string; billingCycle: "monthly" | "quarterly" | "yearly"; status: "active" | "paused" | "cancelled" | "expired";
  startDate: string; endDate: string | null; nextBillingDate: string | null; autoRenew: boolean; renewalNoticeDays: number; ownerId: string; createdAt: string;
}
