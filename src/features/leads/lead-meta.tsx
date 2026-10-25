"use client";

import { AlarmClock, CalendarClock, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/misc";
import {
  LEAD_STAGES,
  PRODUCT_LINES,
  PRIORITIES,
  stageMeta,
  type LeadStage,
  type Priority,
  type ProductLine,
  type PublicUser,
} from "@/lib/api/contracts";
import { dueState, formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";

const STAGE_TONE: Record<
  LeadStage,
  "neutral" | "info" | "accent" | "warning" | "success" | "danger"
> = {
  new: "neutral",
  contacted: "info",
  qualified: "info",
  discovery: "accent",
  proposal: "accent",
  negotiation: "warning",
  won: "success",
  lost: "danger",
};

export function StageBadge({ stage }: { stage: LeadStage }) {
  return (
    <Badge tone={STAGE_TONE[stage]}>
      <CircleDot /> {stageMeta(stage).label}
    </Badge>
  );
}

export const STAGE_DOT: Record<LeadStage, string> = {
  new: "bg-fg-subtle",
  contacted: "bg-info",
  qualified: "bg-info",
  discovery: "bg-accent",
  proposal: "bg-accent",
  negotiation: "bg-warning",
  won: "bg-success",
  lost: "bg-danger",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "low") return <span className="text-fg-subtle text-xs">Low</span>;
  return <Badge tone={priority === "high" ? "danger" : "neutral"}>{PRIORITIES[priority]}</Badge>;
}

export function ProductChips({ lines, max = 1 }: { lines: ProductLine[]; max?: number }) {
  const shown = lines.slice(0, max);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {shown.map((l) => (
        <Badge key={l} tone="outline" className="max-w-[180px] truncate">
          {PRODUCT_LINES[l]}
        </Badge>
      ))}
      {lines.length > max && <span className="text-fg-subtle text-xs">+{lines.length - max}</span>}
    </span>
  );
}

export function OwnerCell({ user }: { user: PublicUser | undefined }) {
  if (!user) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <UserAvatar name={user.name} hue={user.avatarHue} size={20} />
      <span className="truncate">{user.name}</span>
    </span>
  );
}

export function FollowUpCell({ at }: { at: string | null }) {
  const state = dueState(at);
  if (state === "none") return <span className="text-fg-subtle">Not scheduled</span>;
  return (
    <span
      title={formatDateTime(at)}
      className={cn(
        "inline-flex items-center gap-1.5",
        state === "overdue" && "text-danger font-medium",
        state === "today" && "dark:text-warning font-medium text-[oklch(0.55_0.14_60)]",
      )}
    >
      {state === "overdue" ? (
        <AlarmClock className="size-3.5" />
      ) : (
        <CalendarClock className="text-fg-subtle size-3.5" />
      )}
      {state === "overdue" ? `Overdue · ${formatRelative(at)}` : formatRelative(at)}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const tone = score >= 70 ? "bg-success" : score >= 45 ? "bg-warning" : "bg-fg-subtle";
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Lead score ${score} of 100`}>
      <span className="bg-surface-3 h-1.5 w-12 overflow-hidden rounded-full">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${score}%` }} />
      </span>
      <span className="tabular text-fg-muted text-xs">{score}</span>
    </span>
  );
}

export const STAGE_OPTIONS = LEAD_STAGES.map((s) => ({ value: s.key, label: s.label }));
