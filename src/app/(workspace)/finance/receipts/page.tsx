import type { Metadata } from "next";
import { ReceiptsView } from "@/features/finance/receipts";

export const metadata: Metadata = { title: "Receipts" };

export default function FinanceReceiptsPage() {
  return <ReceiptsView />;
}
