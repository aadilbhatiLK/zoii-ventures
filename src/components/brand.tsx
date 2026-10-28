import { cn } from "@/lib/utils";

/** Zoii mark: a rounded tile with a stylised Z built from two offset strokes. */
export function ZoiiMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M10 10.5h12l-12 11h12"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23.2" cy="10.5" r="1.6" fill="var(--accent-fg)" opacity="0.55" />
    </svg>
  );
}

export function ZoiiWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <ZoiiMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[15px] font-semibold tracking-tight">Zoii Ventures</span>
        <span className="text-2xs text-fg-subtle mt-0.5">Business OS</span>
      </span>
    </span>
  );
}
