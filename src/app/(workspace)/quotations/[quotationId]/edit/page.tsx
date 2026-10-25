import { Suspense } from "react";
import type { Metadata } from "next";
import { QuotationEditRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Edit quotation" };

export default function QuotationsQuotationidEditPage() {
  return (
    <Suspense>
      <QuotationEditRoute />
    </Suspense>
  );
}
