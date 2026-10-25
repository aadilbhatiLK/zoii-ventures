import type { Metadata } from "next";
import { InvoicesView } from "@/features/finance/invoices";

export const metadata: Metadata = { title: "Sales Invoices" };

export default function FinanceInvoicesPage() {
  return <InvoicesView />;
}
