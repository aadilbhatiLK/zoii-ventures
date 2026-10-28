import type { Metadata } from "next";
import { MyTasksView } from "@/features/delivery/projects";

export const metadata: Metadata = { title: "My Tasks" };

export default function TasksPage() {
  return <MyTasksView />;
}
