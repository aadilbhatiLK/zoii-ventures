import type { Metadata } from "next";
import { PipelineBoard } from "@/features/leads/pipeline-board";

export const metadata: Metadata = { title: "Sales pipeline" };

export default function PipelinePage() {
  return <PipelineBoard />;
}
