import { Suspense } from "react";
import type { Metadata } from "next";
import { PayrollRunRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Payroll run" };

export default function PeoplePayrollRunidPage() {
  return (
    <Suspense>
      <PayrollRunRoute />
    </Suspense>
  );
}
