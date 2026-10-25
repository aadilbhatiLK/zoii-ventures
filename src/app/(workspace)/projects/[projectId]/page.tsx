import { Suspense } from "react";
import type { Metadata } from "next";
import { ProjectRoute } from "@/features/module-routes";

export const metadata: Metadata = { title: "Project" };

export default function ProjectsProjectidPage() {
  return (
    <Suspense>
      <ProjectRoute />
    </Suspense>
  );
}
