import { Suspense } from "react";
import type { Metadata } from "next";
import { PlannedModuleRoute } from "@/features/workspace/planned-module";

export const metadata: Metadata = { title: "Planned module" };

export default function PlannedPage() {
  return (
    <Suspense>
      <PlannedModuleRoute />
    </Suspense>
  );
}
