"use client";

import { LeadFormSheet } from "@/features/leads/lead-form-sheet";
import { ClientFormSheet } from "@/features/clients/client-form-sheet";
import { useGlobalUi } from "./global-ui";

export function GlobalSheets() {
  const { sheet, closeSheet } = useGlobalUi();
  if (sheet?.kind === "lead")
    return <LeadFormSheet leadId={sheet.leadId} open onClose={closeSheet} />;
  if (sheet?.kind === "client")
    return <ClientFormSheet clientId={sheet.clientId} open onClose={closeSheet} />;
  return null;
}
