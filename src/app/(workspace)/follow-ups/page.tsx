import type { Metadata } from "next";
import { FollowUpsView } from "@/features/leads/follow-ups-view";

export const metadata: Metadata = { title: "Follow-ups" };

export default function FollowUpsPage() {
  return <FollowUpsView />;
}
