import type { Metadata } from "next";
import { MeView } from "@/features/people/me";

export const metadata: Metadata = { title: "My Profile" };

export default function MePage() {
  return <MeView />;
}
