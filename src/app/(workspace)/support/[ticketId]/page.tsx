import { Suspense } from "react";
import type { Metadata } from "next";
import { TicketRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Ticket" };

export default function SupportTicketidPage() {
  return (
    <Suspense>
      <TicketRoute />
    </Suspense>
  );
}
