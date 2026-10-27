/** Sprint 3 contracts: catalogue, tax rules, documents, approvals, quotations. Shared by UI and API. */
import { z } from "zod";
import { ProductLineSchema } from "../contracts";
import { DateOnly, HsnSac, Id, Money, OptDate, Pct, Qty, optText, type BillingCycle } from "./common";

export const ProductInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, "Use letters, digits and dashes"),
  name: z.string().trim().min(2).max(160),
  description: optText(2000),
  productLine: ProductLineSchema,
  kind: z.enum(["one_time", "recurring", "service"]),
  billingCycle: z.enum(["one_time", "monthly", "quarterly", "yearly"]),
  unit: z.string().trim().min(1).max(30).default("unit"),
  hsnSac: HsnSac,
  unitPrice: Money,
  floorPrice: Money.optional().nullable(),
  active: z.boolean().default(true),
}).refine((p) => (p.kind === "recurring") === (p.billingCycle !== "one_time"), { message: "Recurring products need a billing cycle; others are one-time", path: ["billingCycle"] })
  .refine((p) => !p.floorPrice || Number(p.floorPrice) <= Number(p.unitPrice), { message: "Floor price can't exceed the list price", path: ["floorPrice"] });
export type ProductInput = z.input<typeof ProductInputSchema>;

export interface Product {
  id: string; code: string; name: string; description: string | null; productLine: string; kind: "one_time" | "recurring" | "service";
  billingCycle: BillingCycle; unit: string; hsnSac: string; unitPrice: string; floorPrice: string | null; active: boolean; taxRate: string | null; updatedAt: string;
}

export const TaxRuleInputSchema = z.object({
  hsnSac: HsnSac, description: z.string().trim().min(3).max(200),
  rate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 18 or 2.5").refine((v) => Number(v) <= 40, "At most 40%"),
  effectiveFrom: DateOnly,
});
export interface TaxRule { id: string; hsnSac: string; description: string; rate: string; effectiveFrom: string; effectiveTo: string | null }

// ---------- documents ----------
export const DOCUMENT_KINDS = { brd: "BRD — business requirements", prd: "PRD — product requirements", sow: "Statement of work", other: "Other" } as const;
export const DocumentCreateSchema = z.object({
  kind: z.enum(["brd", "prd", "sow", "other"]), title: z.string().trim().min(3).max(200),
  clientId: Id.optional(), leadId: Id.optional(), content: z.string().max(200_000).default(""),
}).refine((d) => d.clientId || d.leadId, { message: "Link the document to a client or lead", path: ["clientId"] });
export const DocumentEditSchema = z.object({ content: z.string().max(200_000), changeSummary: optText(300), expectedUpdatedAt: z.string().optional() });

export type DocVersionStatus = "draft" | "in_review" | "approved" | "rejected" | "superseded";
export interface DocumentVersion {
  id: string; version: number; status: DocVersionStatus; content: string; contentSha256: string | null; changeSummary: string | null;
  authorId: string; submittedAt: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; updatedAt: string;
}
export interface DocumentSummary {
  id: string; number: string; kind: keyof typeof DOCUMENT_KINDS; title: string; clientId: string | null; clientName: string | null;
  leadId: string | null; ownerId: string; approvedVersion: number | null; latestVersion: number; latestStatus: DocVersionStatus; updatedAt: string;
}
export interface DocumentDetail extends DocumentSummary { versions: DocumentVersion[] }

// ---------- approvals ----------
export interface ApprovalRequest {
  id: string; entityType: "document_version" | "quotation" | "change_request" | "payroll_run" | "leave_request" | "journal_entry" | "period_change";
  entityId: string; title: string; reason: string; requiredPermission: string; status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; href: string;
  canDecide: boolean;
}
export const ApprovalDecisionSchema = z.object({ decision: z.enum(["approve", "reject"]), note: optText(1000) })
  .refine((d) => d.decision === "approve" || !!d.note, { message: "Say why you're rejecting", path: ["note"] });

// ---------- quotations ----------
export const QuotationLineInputSchema = z.object({
  productId: Id.optional().nullable(), description: z.string().trim().min(2).max(500), hsnSac: HsnSac,
  billingCycle: z.enum(["one_time", "monthly", "quarterly", "yearly"]).default("one_time"),
  quantity: Qty, unitPrice: Money, discountPct: Pct.default("0"),
});
export const QuotationInputSchema = z.object({
  clientId: Id, leadId: Id.optional().nullable(), documentId: Id.optional().nullable(),
  quoteDate: OptDate, validUntil: OptDate,
  notes: optText(4000), terms: optText(8000),
  lines: z.array(QuotationLineInputSchema).min(1, "Add at least one line").max(100),
  expectedUpdatedAt: z.string().optional(),
});
export type QuotationInput = z.input<typeof QuotationInputSchema>;
export type QuotationStatus = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "rejected" | "expired" | "superseded" | "cancelled";
export interface QuotationLine {
  id: string; lineNo: number; productId: string | null; description: string; hsnSac: string; billingCycle: BillingCycle; quantity: string;
  unitPrice: string; listPrice: string | null; discountPct: string; taxRate: string; gross: string; discount: string; taxable: string;
  cgst: string; sgst: string; igst: string; total: string;
}
export interface Quotation {
  id: string; number: string; revision: number; displayNumber: string; previousId: string | null; clientId: string; clientName: string;
  leadId: string | null; documentId: string | null; status: QuotationStatus; quoteDate: string; validUntil: string;
  supplierState: string; placeOfSupply: string; supplyType: "intra" | "inter";
  subtotal: string; discountTotal: string; taxableTotal: string; cgst: string; sgst: string; igst: string; grandTotal: string;
  notes: string | null; terms: string | null; approvalReasons: string[]; ownerId: string; approvedBy: string | null; approvedAt: string | null;
  sentAt: string | null; decidedAt: string | null; clientDecisionNote: string | null; salesOrderId: string | null;
  createdAt: string; updatedAt: string; lines: QuotationLine[];
}
export const ClientDecisionSchema = z.object({ decision: z.enum(["accepted", "rejected"]), note: optText(1000), evidence: optText(300) });
