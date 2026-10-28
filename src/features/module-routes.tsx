"use client";

/** Thin client wrappers that read dynamic route params (kept apart so pages stay server components). */
import { useParams } from "next/navigation";
import { DocumentDetailView } from "@/features/sales/documents-view";
import { QuotationDetail, QuotationEditor } from "@/features/sales/quotations";
import { SalesOrderDetail } from "@/features/sales/orders";
import { ProjectDetailView } from "@/features/delivery/projects";
import { InvoiceDetail } from "@/features/finance/invoices";
import { EmployeeDetail } from "@/features/people/employees";
import { PayrollRunDetail } from "@/features/people/payroll";
import { TicketDetail } from "@/features/support/tickets";
import { useApi } from "@/lib/api/hooks";
import type { Quotation } from "@/lib/api/modules/sales";

function useParam(k: string) {
  return decodeURIComponent(useParams<Record<string, string>>()[k] ?? "");
}

export function DocumentRoute() {
  return <DocumentDetailView id={useParam("documentId")} />;
}
export function QuotationRoute() {
  return <QuotationDetail id={useParam("quotationId")} />;
}
export function SalesOrderRoute() {
  return <SalesOrderDetail id={useParam("orderId")} />;
}
export function ProjectRoute() {
  return <ProjectDetailView id={useParam("projectId")} />;
}
export function InvoiceRoute() {
  return <InvoiceDetail id={useParam("invoiceId")} />;
}
export function EmployeeRoute() {
  return <EmployeeDetail id={useParam("employeeId")} />;
}
export function PayrollRunRoute() {
  return <PayrollRunDetail id={useParam("runId")} />;
}
export function TicketRoute() {
  return <TicketDetail id={useParam("ticketId")} />;
}

export function QuotationEditRoute() {
  const id = useParam("quotationId");
  const q = useApi<Quotation>(["quotation", id], `/quotations/${id}`);
  return q.data ? <QuotationEditor quotation={q.data} /> : null;
}
