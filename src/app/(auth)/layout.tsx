import { ZoiiWordmark } from "@/components/brand";
import { DemoModeNotice } from "@/components/layout/demo-banner";
import { CheckCircle2 } from "lucide-react";

const POINTS = [
  "Leads, pipeline and client history in one place",
  "Quotations, projects and delivery linked to the same client",
  "GST-ready finance built on a double-entry ledger",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoModeNotice />
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <aside className="border-border bg-sidebar relative hidden overflow-hidden border-r lg:flex lg:flex-col lg:justify-between lg:p-10">
          <ZoiiWordmark />
          <div className="relative z-10 max-w-md">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
              Run every Zoii business line from one operating system.
            </h1>
            <ul className="mt-6 space-y-3">
              {POINTS.map((p) => (
                <li key={p} className="text-fg-muted flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="text-accent mt-0.5 size-4 shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-fg-subtle text-xs">© Zoii Ventures · Bikaner, Rajasthan</p>
          <div
            aria-hidden
            className="border-border pointer-events-none absolute -right-24 -bottom-24 size-[420px] rounded-full border opacity-70"
          />
          <div
            aria-hidden
            className="border-border pointer-events-none absolute -right-8 -bottom-8 size-[260px] rounded-full border opacity-70"
          />
        </aside>
        <main className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[400px]">
            <div className="mb-8 lg:hidden">
              <ZoiiWordmark />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
