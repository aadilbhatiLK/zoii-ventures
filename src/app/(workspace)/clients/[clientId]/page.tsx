import { Suspense } from "react";
import type { Metadata } from "next";
import { ClientDetailRoute } from "@/features/clients/routes";

export const metadata: Metadata = { title: "Client" };

export default function ClientPage() {
  return (
    <Suspense>
      <ClientDetailRoute />
    </Suspense>
  );
}
