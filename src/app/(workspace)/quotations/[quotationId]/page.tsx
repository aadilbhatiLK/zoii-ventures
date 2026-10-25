import { Suspense } from "react";
import type { Metadata } from "next";
import { QuotationRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Quotation" };

export default function QuotationsQuotationidPage() {
  return (
    <Suspense>
      <QuotationRoute />
    </Suspense>
  );
}
