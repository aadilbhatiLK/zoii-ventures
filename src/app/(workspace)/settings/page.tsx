import type { Metadata } from "next";
import { SettingsView } from "@/features/admin/settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsView />;
}
