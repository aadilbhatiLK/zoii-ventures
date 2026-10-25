import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold">Page not found</p>
      <p className="text-fg-muted text-[13px]">This address doesn&apos;t match any page.</p>
      <Link href="/dashboard" className="text-accent text-[13px] font-medium hover:underline">
        Go to dashboard
      </Link>
    </main>
  );
}
