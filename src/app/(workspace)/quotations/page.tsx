import type { Metadata } from "next";
import { QuotationsView } from "@/features/sales/quotations";

export const metadata: Metadata = { title: "Quotations" };

export default function QuotationsPage() {
  return <QuotationsView />;
}
