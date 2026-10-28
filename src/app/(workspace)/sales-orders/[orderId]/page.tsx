import { Suspense } from "react";
import type { Metadata } from "next";
import { SalesOrderRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Sales order" };

export default function SalesOrdersOrderidPage() {
  return (
    <Suspense>
      <SalesOrderRoute />
    </Suspense>
  );
}
