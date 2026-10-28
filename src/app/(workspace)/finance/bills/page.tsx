import type { Metadata } from "next";
import { BillsView } from "@/features/finance/bills";

export const metadata: Metadata = { title: "Bills & Expenses" };

export default function FinanceBillsPage() {
  return <BillsView />;
}
