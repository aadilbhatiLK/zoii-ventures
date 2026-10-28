import type { Metadata } from "next";
import { PeriodsView } from "@/features/finance/periods";

export const metadata: Metadata = { title: "Periods" };

export default function FinancePeriodsPage() {
  return <PeriodsView />;
}
