import { Suspense } from "react";
import type { Metadata } from "next";
import { LeadDetailRoute } from "@/features/leads/routes";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage() {
  return (
    <Suspense>
      <LeadDetailRoute />
    </Suspense>
  );
}
