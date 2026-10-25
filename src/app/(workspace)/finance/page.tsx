import type { Metadata } from "next";
import { FinanceOverview } from "@/features/finance/overview";

export const metadata: Metadata = { title: "Finance Overview" };

export default function FinancePage() {
  return <FinanceOverview />;
}
