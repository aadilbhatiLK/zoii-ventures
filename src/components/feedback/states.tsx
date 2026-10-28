import { AlertTriangle, FlaskConical, Lock, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}
    >
      {icon && (
        <div className="border-border bg-surface-2 text-fg-subtle mb-3 flex size-10 items-center justify-center rounded-lg border [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-fg text-sm font-semibold">{title}</p>
      {description && <p className="text-fg-muted mt-1 max-w-sm text-[13px]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}
    >
      <div className="bg-danger-soft text-danger mb-3 flex size-10 items-center justify-center rounded-lg">
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-sm font-semibold">Couldn&apos;t load this</p>
      <p className="text-fg-muted mt-1 max-w-sm text-[13px]">{message}</p>
      {onRetry && (
        <Button size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function PermissionDenied({ what = "this page" }: { what?: string }) {
  return (
    <EmptyState
      icon={<Lock />}
      title="You don't have access"
      description={`Your role doesn't include access to ${what}. Ask an administrator if you need it.`}
      className="py-20"
    />
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-border divide-y" aria-busy aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Marks numbers that come from demo fixtures rather than real records. */
export function DemoTag({
  label = "Demo data",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-warning/60 bg-warning-soft text-2xs dark:text-warning inline-flex items-center gap-1 rounded-[5px] border border-dashed px-1.5 py-0.5 font-medium text-[oklch(0.5_0.13_60)]",
        className,
      )}
      title="Fictional data from the demo adapter. Not real business records."
    >
      <FlaskConical className="size-3" /> {label}
    </span>
  );
}
