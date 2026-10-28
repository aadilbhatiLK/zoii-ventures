"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Phone,
} from "lucide-react";
import { PageHeader } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented, Skeleton, UserAvatar } from "@/components/ui/misc";
import { ErrorState, PermissionDenied } from "@/components/feedback/states";
import { useAuth } from "@/features/auth/auth-provider";
import type { Lead, LeadListQuery } from "@/lib/api/contracts";
import { userMessage } from "@/lib/api/errors";
import { leadScope } from "@/lib/permissions";
import { formatDateTime, formatINRCompact, formatRelative } from "@/lib/formatting";
import { useLeadList, useUserDirectory } from "./hooks";
import { StageBadge } from "./lead-meta";
import { CompleteFollowUpDialog, ScheduleFollowUpDialog } from "./lead-dialogs";
import { cn } from "@/lib/utils";

function Section({
  title,
  icon,
  tone,
  query,
  filter,
  onComplete,
  onReschedule,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  tone: string;
  query: LeadListQuery;
  filter?: (l: Lead) => boolean;
  onComplete: (l: Lead) => void;
  onReschedule: (l: Lead) => void;
  emptyText: string;
}) {
  const { can } = useAuth();
  const directory = useUserDirectory();
  const list = useLeadList(query);
  const rows = (list.data?.items ?? []).filter(filter ?? (() => true));
  return (
    <Card>
      <header className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5",
            tone,
          )}
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="bg-surface-3 text-2xs text-fg-muted tabular rounded px-1.5 font-medium">
          {list.isLoading ? "…" : rows.length}
        </span>
      </header>
      {list.isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState message={userMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-fg-muted px-4 py-6 text-center text-[13px]">{emptyText}</p>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((l) => {
            const owner = directory.byId.get(l.ownerId);
            return (
              <li
                key={l.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/leads/${l.id}`}
                      className="hover:text-accent truncate text-[13px] font-medium"
                    >
                      {l.company ?? l.name}
                    </Link>
                    <StageBadge stage={l.stage} />
                    <span className="text-fg-subtle tabular text-xs">
                      {formatINRCompact(l.estimatedValue)}
                    </span>
                  </div>
                  <p className="text-fg-muted mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span>{l.name}</span>
                    <a
                      href={`tel:${l.phone.replace(/\s/g, "")}`}
                      className="hover:text-accent inline-flex items-center gap-1"
                    >
                      <Phone className="size-3" />
                      {l.phone}
                    </a>
                    {owner && (
                      <span className="inline-flex items-center gap-1">
                        <UserAvatar name={owner.name} hue={owner.avatarHue} size={14} />
                        {owner.name}
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className="text-fg-muted text-xs sm:w-40 sm:text-right"
                  title={formatDateTime(l.nextFollowUpAt)}
                >
                  {formatRelative(l.nextFollowUpAt)} ·{" "}
                  {l.nextFollowUpAt
                    ? new Date(l.nextFollowUpAt).toLocaleTimeString("en-IN", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : ""}
                </span>
                {can("leads.update") && (
                  <div className="flex gap-1.5">
                    <Button size="xs" onClick={() => onReschedule(l)}>
                      <CalendarPlus /> Reschedule
                    </Button>
                    <Button size="xs" variant="primary" onClick={() => onComplete(l)}>
                      <CalendarCheck /> Done
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function FollowUpsView() {
  const { user } = useAuth();
  const scope = leadScope(user);
  const [who, setWho] = useState<"mine" | "all">("mine");
  const [completeFor, setCompleteFor] = useState<Lead | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<Lead | null>(null);
  const [now] = useState(() => Date.now());
  if (scope === "none") return <PermissionDenied what="follow-ups" />;
  const owner = who === "mine" ? [user!.id] : undefined;
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Every open lead should have a dated next action. Clear overdue ones first."
        actions={
          scope !== "own" ? (
            <Segmented
              label="Whose follow-ups"
              value={who}
              onChange={setWho}
              options={[
                { value: "mine", label: "Mine" },
                { value: "all", label: scope === "all" ? "Everyone" : "My team" },
              ]}
            />
          ) : undefined
        }
      />
      <div className="space-y-4">
        <Section
          title="Overdue"
          icon={<AlarmClock />}
          tone="bg-danger-soft text-danger"
          query={{
            view: "overdue",
            ownerId: owner,
            pageSize: 50,
            sort: { field: "nextFollowUpAt", dir: "asc" },
          }}
          onComplete={setCompleteFor}
          onReschedule={setRescheduleFor}
          emptyText="Nothing overdue. Nice."
        />
        <Section
          title="Due today"
          icon={<CalendarClock />}
          tone="bg-warning-soft text-[oklch(0.55_0.14_60)] dark:text-warning"
          query={{
            view: "due_today",
            ownerId: owner,
            pageSize: 50,
            sort: { field: "nextFollowUpAt", dir: "asc" },
          }}
          onComplete={setCompleteFor}
          onReschedule={setRescheduleFor}
          emptyText="No follow-ups due today."
        />
        <Section
          title="Upcoming"
          icon={<CalendarDays />}
          tone="bg-surface-3 text-fg-muted"
          query={{
            view: "open",
            ownerId: owner,
            pageSize: 50,
            sort: { field: "nextFollowUpAt", dir: "asc" },
          }}
          filter={(l) =>
            !!l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) > Math.max(now, dayEnd.getTime())
          }
          onComplete={setCompleteFor}
          onReschedule={setRescheduleFor}
          emptyText="Nothing scheduled beyond today."
        />
      </div>
      {completeFor && (
        <CompleteFollowUpDialog
          lead={completeFor}
          open
          onOpenChange={(o) => !o && setCompleteFor(null)}
        />
      )}
      {rescheduleFor && (
        <ScheduleFollowUpDialog
          leadId={rescheduleFor.id}
          open
          onOpenChange={(o) => !o && setRescheduleFor(null)}
        />
      )}
    </div>
  );
}
