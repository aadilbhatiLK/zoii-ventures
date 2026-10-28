import type { Metadata } from "next";
import { FinanceReportsView } from "@/features/finance/reports";

export const metadata: Metadata = { title: "Financial Reports" };

export default function FinanceReportsPage() {
  return <FinanceReportsView />;
}
