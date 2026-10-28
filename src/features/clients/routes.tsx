"use client";

import { useParams } from "next/navigation";
import { ClientDetail } from "./client-detail";

export function ClientDetailRoute() {
  const { clientId } = useParams<{ clientId: string }>();
  return <ClientDetail clientId={decodeURIComponent(clientId)} />;
}
