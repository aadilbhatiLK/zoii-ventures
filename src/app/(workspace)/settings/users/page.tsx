import type { Metadata } from "next";
import { UsersAdminView } from "@/features/admin/users";

export const metadata: Metadata = { title: "Users & Roles" };

export default function SettingsUsersPage() {
  return <UsersAdminView />;
}
