import type { Metadata } from "next";
import { SalesOrdersView } from "@/features/sales/orders";

export const metadata: Metadata = { title: "Sales Orders" };

export default function SalesOrdersPage() {
  return <SalesOrdersView />;
}
