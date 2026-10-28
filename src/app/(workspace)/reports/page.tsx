import type { Metadata } from "next";
import { ReportsHub } from "@/features/admin/reports-hub";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsHub />;
}
