import { ServerCrash } from "lucide-react";

/** Rendered instead of the app when runtime configuration is invalid. Never falls back to demo data. */
export function ConfigError({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="border-border bg-surface w-full max-w-lg rounded-xl border p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-danger-soft text-danger flex size-9 items-center justify-center rounded-lg">
            <ServerCrash className="size-5" />
          </div>
          <h1 className="text-base font-semibold">Zoii Business OS isn&apos;t configured</h1>
        </div>
        <p className="text-fg-muted mt-3 text-sm">{message}</p>
        <p className="text-fg-subtle mt-3 text-xs">
          See docs/deployment.md for the required environment variables.
        </p>
      </div>
    </main>
  );
}
