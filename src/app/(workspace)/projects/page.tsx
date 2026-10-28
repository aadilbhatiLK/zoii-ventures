import type { Metadata } from "next";
import { ProjectsView } from "@/features/delivery/projects";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectsView />;
}
