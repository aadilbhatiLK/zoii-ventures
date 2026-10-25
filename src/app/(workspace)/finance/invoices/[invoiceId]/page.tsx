import { Suspense } from "react";
import type { Metadata } from "next";
import { InvoiceRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Invoice" };

export default function FinanceInvoicesInvoiceidPage() {
  return (
    <Suspense>
      <InvoiceRoute />
    </Suspense>
  );
}
