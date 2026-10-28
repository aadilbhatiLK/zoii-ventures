import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/** Served by the service worker when a navigation fails offline. Contains no business data. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-base font-semibold">You&apos;re offline</p>
      <p className="text-fg-muted max-w-sm text-[13px]">
        Zoii Business OS needs a connection to load or save records. Nothing was saved while
        offline. Reconnect and refresh.
      </p>
    </main>
  );
}
