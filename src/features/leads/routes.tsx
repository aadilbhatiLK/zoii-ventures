"use client";

import { useParams } from "next/navigation";
import { LeadDetail } from "./lead-detail";

export function LeadDetailRoute() {
  const { leadId } = useParams<{ leadId: string }>();
  return <LeadDetail leadId={decodeURIComponent(leadId)} />;
}
