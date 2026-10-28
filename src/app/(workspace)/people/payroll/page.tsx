import type { Metadata } from "next";
import { PayrollView } from "@/features/people/payroll";

export const metadata: Metadata = { title: "Payroll" };

export default function PeoplePayrollPage() {
  return <PayrollView />;
}
