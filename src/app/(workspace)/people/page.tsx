import type { Metadata } from "next";
import { EmployeesView } from "@/features/people/employees";

export const metadata: Metadata = { title: "Employees" };

export default function PeoplePage() {
  return <EmployeesView />;
}
