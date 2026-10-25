import type { Metadata } from "next";
import { AutomationsView } from "@/features/admin/automations";

export const metadata: Metadata = { title: "Automations" };

export default function AutomationsPage() {
  return <AutomationsView />;
}
