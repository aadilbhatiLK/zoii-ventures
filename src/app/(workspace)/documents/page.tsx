import type { Metadata } from "next";
import { DocumentsView } from "@/features/sales/documents-view";

export const metadata: Metadata = { title: "BRD / PRD" };

export default function DocumentsPage() {
  return <DocumentsView />;
}
