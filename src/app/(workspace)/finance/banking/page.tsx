import type { Metadata } from "next";
import { BankingView } from "@/features/finance/banking";

export const metadata: Metadata = { title: "Banking" };

export default function FinanceBankingPage() {
  return <BankingView />;
}
