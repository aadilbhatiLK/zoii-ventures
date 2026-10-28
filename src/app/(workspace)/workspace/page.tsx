import type { Metadata } from "next";
import { WorkspaceView } from "@/features/workspace/workspace-view";

export const metadata: Metadata = { title: "My Workspace" };

export default function WorkspacePage() {
  return <WorkspaceView />;
}
