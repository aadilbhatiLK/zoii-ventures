"use client";

import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarPlus,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  Sparkles,
  UserRoundPlus,
  Users2,
  Handshake,
} from "lucide-react";
import type { Activity, ActivityType, PublicUser } from "@/lib/api/contracts";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { EmptyState } from "@/components/feedback/states";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const ICON: Record<ActivityType, { icon: React.ReactNode; tone: string }> = {
  created: { icon: <Sparkles />, tone: "bg-accent-soft text-accent" },
  note: { icon: <MessageSquareText />, tone: "bg-surface-3 text-fg-muted" },
  call: { icon: <Phone />, tone: "bg-info-soft text-info" },
  meeting: { icon: <Users2 />, tone: "bg-info-soft text-info" },
  email: { icon: <Mail />, tone: "bg-info-soft text-info" },
  stage_change: {
    icon: <ArrowRightLeft />,
    tone: "bg-warning-soft text-[oklch(0.55_0.14_60)] dark:text-warning",
  },
  assignment: { icon: <UserRoundPlus />, tone: "bg-accent-soft text-accent" },
  follow_up_scheduled: { icon: <CalendarPlus />, tone: "bg-surface-3 text-fg-muted" },
  follow_up_completed: { icon: <CalendarCheck />, tone: "bg-success-soft text-success" },
  converted: { icon: <Handshake />, tone: "bg-success-soft text-success" },
  updated: { icon: <Pencil />, tone: "bg-surface-3 text-fg-muted" },
};

export function ActivityTimeline({
  activities,
  users,
  loading,
  showEntity,
}: {
  activities: Activity[] | undefined;
  users: Map<string, PublicUser>;
  loading?: boolean;
  showEntity?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!activities?.length)
    return (
      <EmptyState
        title="No activity yet"
        description="Calls, meetings, notes and changes will appear here."
      />
    );
  return (
    <ol className="relative px-4 py-3">
      {activities.map((a, i) => {
        const meta = ICON[a.type];
        const actor = users.get(a.actorId);
        return (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-1">
            {i < activities.length - 1 && (
              <span aria-hidden className="bg-border absolute top-8 bottom-0 left-[13px] w-px" />
            )}
            <span
              className={cn(
                "ring-surface relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 [&_svg]:size-3.5",
                meta.tone,
              )}
            >
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px]">
                <span className="font-medium">{a.summary}</span>
                {showEntity && (
                  <span className="bg-surface-3 text-2xs text-fg-muted ml-1.5 rounded px-1 uppercase">
                    {a.entityType}
                  </span>
                )}
              </p>
              {a.body && (
                <p className="bg-surface-2 text-fg-muted mt-1 rounded-md px-2.5 py-1.5 text-[13px] whitespace-pre-wrap">
                  {a.body}
                </p>
              )}
              <p className="text-fg-subtle mt-0.5 text-xs" title={formatDateTime(a.occurredAt)}>
                {actor?.name ?? "System"} · {formatRelative(a.occurredAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
