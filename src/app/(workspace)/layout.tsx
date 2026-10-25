import { Suspense } from "react";
import { DemoModeNotice } from "@/components/layout/demo-banner";
import { AppShell, ShellSkeleton } from "@/components/layout/app-shell";

/**
 * The workspace is client-rendered behind authentication; the shell reads the URL,
 * so it streams in after the static skeleton (Cache Components / PPR).
 */
export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <DemoModeNotice />
      <Suspense fallback={<ShellSkeleton />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </>
  );
}
