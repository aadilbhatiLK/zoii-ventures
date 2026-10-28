import type { Metadata } from "next";
import { ApprovalsView } from "@/features/sales/approvals-view";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return <ApprovalsView />;
}
