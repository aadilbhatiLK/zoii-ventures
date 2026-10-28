import type { Metadata } from "next";
import { SubscriptionsView } from "@/features/sales/orders";

export const metadata: Metadata = { title: "Subscriptions & AMC" };

export default function SubscriptionsPage() {
  return <SubscriptionsView />;
}
