import { FlaskConical } from "lucide-react";
import { appConfig } from "@/lib/config/env";

/** Persistent, non-dismissable label whenever the demo adapter is serving data. */
export function DemoModeNotice() {
  if (!appConfig.ok || appConfig.mode !== "demo") return null;
  return (
    <div
      role="status"
      className="border-warning/50 bg-warning-soft dark:text-warning flex items-center justify-center gap-2 border-b border-dashed px-3 py-1 text-center text-xs font-medium text-[oklch(0.45_0.12_60)]"
    >
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        Demo mode — all people, companies and amounts are fictional
        {appConfig.demoInProduction ? " (review build)" : ""}. Not connected to a real backend.
      </span>
    </div>
  );
}
