import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-xs leading-4 font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-fg-muted",
        accent: "bg-accent-soft text-accent-soft-fg",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-[oklch(0.5_0.13_60)] dark:text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
        outline: "border border-border text-fg-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Dot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-block size-1.5 rounded-full bg-current", className)} />
  );
}
