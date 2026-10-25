import type { Metadata } from "next";
import { QuotationEditor } from "@/features/sales/quotations";

export const metadata: Metadata = { title: "New quotation" };

export default function QuotationsNewPage() {
  return <QuotationEditor />;
}
