import type { Metadata } from "next";
import { ClientsView } from "@/features/clients/clients-view";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return <ClientsView />;
}
