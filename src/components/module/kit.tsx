"use client";

/**
 * Building blocks shared by every Sprint 3–6 module screen: backend gate, tables,
 * status badges, money, key–value grids, section cards and a prompt dialog.
 */
import { useState } from "react";
import Link from "next/link";
import { ServerOff } from "lucide-react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PermissionDenied, TableSkeleton } from "@/components/feedback/states";
import { PageHeader } from "@/components/layout/topbar";
import { useAuth } from "@/features/auth/auth-provider";
import { apiBase } from "@/lib/api/request";
import { userMessage } from "@/lib/api/errors";
import { formatINR } from "@/lib/formatting";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

/** Sprint 3+ modules read only real records; in demo mode they say so instead of faking data. */
export function ModulePage({ title, description, permissions, actions, meta, children }: {
  title: string; description?: React.ReactNode; permissions: Permission[]; actions?: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode;
}) {
  const { can } = useAuth();
  if (permissions.length && !permissions.some(can)) return <PermissionDenied what={title} />;
  if (!apiBase()) {
    return (
      <div>
        <PageHeader title={title} description={description} />
        <Card>
          <EmptyState
            icon={<ServerOff />}
            title="This module needs the backend"
            description="The in-browser demo only covers leads, pipeline and clients. Quotations, delivery, finance and people read real records from the API — start the backend (npm run api:dev) and set NEXT_PUBLIC_DATA_MODE=api."
            className="py-16"
          />
        </Card>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} meta={meta} />
      {children}
    </div>
  );
}

export function Section({ title, description, actions, children, className, flush }: {
  title?: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <CardHeader>
          <div>
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(flush && "px-0 pb-0")}>{children}</CardContent>
    </Card>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
}

export function SimpleTable<T>({ columns, rows, rowKey, href, onRowClick, loading, error, onRetry, empty, label, footer }: {
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (r: T) => string; href?: (r: T) => string; onRowClick?: (r: T) => void;
  loading?: boolean; error?: unknown; onRetry?: () => void; empty?: React.ReactNode; label: string; footer?: React.ReactNode;
}) {
  if (loading) return <TableSkeleton rows={5} />;
  if (error) return <ErrorState message={userMessage(error)} onRetry={onRetry} />;
  if (!rows?.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full text-[13px]" aria-label={label}>
        <thead>
          <tr className="border-border text-fg-muted border-b text-left text-xs">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-4 py-2 font-medium whitespace-nowrap", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideBelow && hide[c.hideBelow])}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((r) => {
            const to = href?.(r);
            return (
              <tr key={rowKey(r)} className={cn((to || onRowClick) && "hover:bg-surface-2 cursor-pointer")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-4 py-2.5 align-middle", c.align === "right" && "text-right tabular-nums", c.align === "center" && "text-center", c.hideBelow && hide[c.hideBelow], c.className)}>
                    {to && i === 0 ? <Link href={to} className="text-fg font-medium hover:underline">{c.cell(r)}</Link> : c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot className="border-border border-t font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}

const TONES: Record<string, Tone> = {
  draft: "neutral", pending: "warning", pending_approval: "warning", in_review: "warning", submitted: "warning", planned: "neutral", open: "info", unmatched: "warning",
  approved: "success", accepted: "success", active: "success", paid: "success", posted: "success", passed: "success", done: "success", signed_off: "success", met: "success", matched: "success", succeeded: "success", resolved: "success", completed: "success", issued: "info", sent: "info", in_progress: "info", uat: "info", review: "info", invoiced: "accent",
  rejected: "danger", failed: "danger", breached: "danger", cancelled: "neutral", superseded: "neutral", expired: "neutral", closed: "neutral", ignored: "neutral", exited: "neutral", on_hold: "warning", paused: "warning", blocked: "danger",
  partially_paid: "warning", unpaid: "warning", at_risk: "warning", waiting_on_client: "warning", notice: "warning", todo: "neutral", skipped: "neutral",
};
export const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{label ?? humanize(status)}</Badge>;
}

export function Money({ value, className, muted }: { value: string | number | null | undefined; className?: string; muted?: boolean }) {
  return <span className={cn("tabular-nums", muted && "text-fg-muted", className)}>{value == null ? "—" : formatINR(value)}</span>;
}

export function KeyValues({ items, cols = 3 }: { items: [string, React.ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-[13px]", cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-fg-muted text-xs">{k}</dt>
          <dd className="text-fg mt-0.5 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "success" }) {
  return (
    <Card className="p-4">
      <p className="text-fg-muted text-xs">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="text-fg-subtle mt-0.5 text-xs">{hint}</p>}
    </Card>
  );
}

/** Small dialog that asks for text (a reason, a note) before running an action. */
export function PromptDialog({ open, onOpenChange, title, description, label, placeholder, confirmLabel, required = true, multiline, onSubmit, busy, children, destructive }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; label?: string; placeholder?: string; confirmLabel: string;
  required?: boolean; multiline?: boolean; onSubmit: (v: string) => void; busy?: boolean; children?: React.ReactNode; destructive?: boolean;
}) {
  const [v, setV] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setV(""); }}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(v.trim()); }}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogBody className="space-y-4">
            {children}
            {label && (
              <Field label={label} htmlFor="prompt-v" required={required}>
                {multiline ? <Textarea id="prompt-v" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus />
                  : <Input id="prompt-v" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus />}
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" variant={destructive ? "danger" : "primary"} loading={busy} disabled={!!label && required && v.trim().length < 3}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Tag({ children, tone = "outline" }: { children: React.ReactNode; tone?: Tone }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/** Native select styled like inputs (forms with many selects stay light and accessible). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn("border-border bg-surface text-fg hover:border-border-strong focus:border-accent focus:ring-ring/30 h-9 w-full rounded-md border px-2.5 text-sm shadow-xs focus:ring-3 focus:outline-none", className)} {...props} />;
}

export const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const thisMonth = () => today().slice(0, 7);
