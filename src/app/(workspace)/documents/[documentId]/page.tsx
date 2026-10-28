import { Suspense } from "react";
import type { Metadata } from "next";
import { DocumentRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Document" };

export default function DocumentsDocumentidPage() {
  return (
    <Suspense>
      <DocumentRoute />
    </Suspense>
  );
}
