import { Suspense } from "react";
import type { Metadata } from "next";
import { EmployeeRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Employee" };

export default function PeopleEmployeeidPage() {
  return (
    <Suspense>
      <EmployeeRoute />
    </Suspense>
  );
}
