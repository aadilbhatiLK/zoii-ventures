import type { Metadata } from "next";
import { TicketsView } from "@/features/support/tickets";

export const metadata: Metadata = { title: "Support Tickets" };

export default function SupportPage() {
  return <TicketsView />;
}
