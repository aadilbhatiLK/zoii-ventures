import type { Metadata } from "next";
import { AuditView } from "@/features/admin/audit";

export const metadata: Metadata = { title: "Audit Logs" };

export default function AuditPage() {
  return <AuditView />;
}
