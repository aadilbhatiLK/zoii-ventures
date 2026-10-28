import { Suspense } from "react";
import type { Metadata } from "next";
import { LedgerView } from "@/features/finance/ledger";

export const metadata: Metadata = { title: "General Ledger" };

export default function FinanceLedgerPage() {
  return (
    <Suspense>
      <LedgerView />
    </Suspense>
  );
}
