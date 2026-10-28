/** Sprint 5 contracts: ledger, invoices, credit notes, receipts, bills, banking, reports. */
import { z } from "zod";
import { DateOnly, HsnSac, Id, Money, OptDate, Pct, Qty, optText } from "./common";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export interface Account { id: string; code: string; name: string; type: AccountType; systemKey: string | null; isBank: boolean; active: boolean; balance: string }
export const AccountInputSchema = z.object({
  code: z.string().regex(/^[0-9]{4,6}$/, "4–6 digit code"), name: z.string().trim().min(2).max(120),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]), isBank: z.boolean().default(false),
});

export const JournalLineInputSchema = z.object({
  accountId: Id, debit: Money.default("0"), credit: Money.default("0"), description: optText(300),
  partyType: z.enum(["client", "vendor", "employee"]).optional(), partyId: Id.optional(),
}).refine((l) => (Number(l.debit) > 0) !== (Number(l.credit) > 0), { message: "Each line is either a debit or a credit", path: ["debit"] });
export const JournalInputSchema = z.object({
  entryDate: DateOnly, memo: z.string().trim().min(3).max(500), lines: z.array(JournalLineInputSchema).min(2).max(100),
});
export interface JournalEntry {
  id: string; number: string; entryDate: string; sourceType: string; sourceId: string | null; memo: string; reversalOf: string | null; reversedBy: string | null;
  postedBy: string; postedAt: string; total: string;
  lines: { lineNo: number; accountId: string; accountCode: string; accountName: string; debit: string; credit: string; partyType: string | null; partyId: string | null; description: string | null }[];
}

export const InvoiceLineInputSchema = z.object({
  description: z.string().trim().min(2).max(500), hsnSac: HsnSac, quantity: Qty, unitPrice: Money, discountPct: Pct.default("0"),
  revenue: z.enum(["services", "subscriptions"]).default("services"),
});
export const InvoiceInputSchema = z.object({
  clientId: Id, salesOrderId: Id.optional().nullable(), invoiceDate: DateOnly, dueDate: OptDate, notes: optText(2000),
  lines: z.array(InvoiceLineInputSchema).min(1).max(100),
});
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";
export interface InvoiceLine { id: string; lineNo: number; description: string; hsnSac: string; quantity: string; unitPrice: string; discountPct: string; taxRate: string; gross: string; discount: string; taxable: string; cgst: string; sgst: string; igst: string; total: string; credited: string }
export interface Invoice {
  id: string; number: string | null; clientId: string; clientName: string; salesOrderId: string | null; projectId: string | null; milestoneId: string | null; subscriptionId: string | null;
  billingPeriod: string | null; status: InvoiceStatus; invoiceDate: string; dueDate: string; supplierState: string; placeOfSupply: string; supplyType: "intra" | "inter";
  subtotal: string; discountTotal: string; taxableTotal: string; cgst: string; sgst: string; igst: string; total: string; amountPaid: string; amountCredited: string; outstanding: string;
  notes: string | null; journalEntryId: string | null; issuedAt: string | null; createdAt: string; lines: InvoiceLine[];
  creditNotes: { id: string; number: string; noteDate: string; reason: string; total: string }[];
  allocations: { receiptId: string; receiptNumber: string; receiptDate: string; amount: string }[];
}
export const CreditNoteInputSchema = z.object({
  noteDate: DateOnly, reason: z.string().trim().min(3).max(500),
  lines: z.array(z.object({ invoiceLineId: Id, taxable: Money.refine((v) => Number(v) > 0, "Must be more than 0") })).min(1),
});

export const ReceiptInputSchema = z.object({
  clientId: Id, receiptDate: DateOnly, amount: Money, tdsAmount: Money.default("0"),
  method: z.enum(["bank_transfer", "upi", "cash", "cheque", "card", "other"]), reference: optText(120), depositAccountId: Id,
  allocations: z.array(z.object({ invoiceId: Id, amount: Money.refine((v) => Number(v) > 0, "Must be more than 0") })).max(100).default([]),
}).refine((r) => Number(r.amount) + Number(r.tdsAmount) > 0, { message: "Enter the amount received", path: ["amount"] });
export interface Receipt {
  id: string; number: string; clientId: string; clientName: string; receiptDate: string; amount: string; tdsAmount: string; method: string; reference: string | null;
  depositAccountId: string; allocated: string; unallocated: string; journalEntryId: string; createdAt: string;
  allocations: { invoiceId: string; invoiceNumber: string; amount: string }[];
}
export const AllocateSchema = z.object({ allocations: z.array(z.object({ invoiceId: Id, amount: Money })).min(1).max(100) });

export const VendorInputSchema = z.object({
  name: z.string().trim().min(2).max(160), gstin: z.string().trim().toUpperCase().optional().transform((v) => v || undefined),
  stateCode: z.string().regex(/^\d{2}$/).optional(), email: optText(200), phone: optText(30),
});
export interface Vendor { id: string; name: string; gstin: string | null; pan: string | null; stateCode: string | null; email: string | null; phone: string | null; outstanding: string }
export const BillInputSchema = z.object({
  kind: z.enum(["bill", "expense"]), vendorId: Id.optional().nullable(), vendorBillNo: optText(60), billDate: DateOnly, dueDate: OptDate,
  description: z.string().trim().min(3).max(300), expenseAccountId: Id, taxable: Money.refine((v) => Number(v) > 0, "Must be more than 0"),
  gstRate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).default("0"), interState: z.boolean().default(false), itcEligible: z.boolean().default(true),
  tdsSection: optText(20), tdsAmount: Money.default("0"), paidFromAccountId: Id.optional(),
}).refine((b) => b.kind === "expense" || !!b.vendorId, { message: "Pick the vendor", path: ["vendorId"] })
  .refine((b) => b.kind === "bill" || !!b.paidFromAccountId, { message: "Pick the account it was paid from", path: ["paidFromAccountId"] });
export interface Bill {
  id: string; number: string; kind: "bill" | "expense"; vendorId: string | null; vendorName: string | null; vendorBillNo: string | null; billDate: string; dueDate: string;
  description: string; expenseAccountId: string; expenseAccountName: string; taxable: string; cgst: string; sgst: string; igst: string; itcEligible: boolean;
  tdsSection: string | null; tdsAmount: string; total: string; payable: string; amountPaid: string; outstanding: string; status: "unpaid" | "partially_paid" | "paid"; journalEntryId: string; createdAt: string;
}
export const BillPaymentSchema = z.object({ paymentDate: DateOnly, amount: Money, paidFromAccountId: Id, reference: optText(120) });

export const BankImportSchema = z.object({ bankAccountId: Id, filename: z.string().trim().min(1).max(200), csv: z.string().min(10).max(2_000_000) });
export interface BankLine {
  id: string; txnDate: string; description: string; reference: string | null; amount: string; balance: string | null; status: "unmatched" | "matched" | "ignored";
  matchedEntryId: string | null; suggestions: { entryId: string; number: string; entryDate: string; memo: string; amount: string }[];
}
export const BankCategorizeSchema = z.object({ accountId: Id, memo: z.string().trim().min(3).max(300), partyType: z.enum(["client", "vendor", "employee"]).optional(), partyId: Id.optional() });

export interface ReportRow { accountId: string; code: string; name: string; type: AccountType; debit: string; credit: string; balance: string }
export interface AgeingRow { partyId: string; partyName: string; current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; total: string }
export interface GstSummary {
  month: string; basis: string;
  output: { rate: string; taxable: string; cgst: string; sgst: string; igst: string }[];
  outputTotal: { taxable: string; cgst: string; sgst: string; igst: string };
  creditNotes: { taxable: string; cgst: string; sgst: string; igst: string };
  input: { taxable: string; cgst: string; sgst: string; igst: string; ineligible: string };
  netPayable: { cgst: string; sgst: string; igst: string; total: string };
  b2b: { clientName: string; gstin: string; invoices: number; taxable: string; tax: string }[];
}
export interface Period {
  month: string; status: "open" | "closed"; closedBy: string | null; closedAt: string | null; checks?: { label: string; ok: boolean; detail: string }[];
  /** A close/reopen waiting for a second person's approval (maker-checker). */
  pending: { action: "close" | "reopen"; requestedBy: string; requestedAt: string } | null;
}
