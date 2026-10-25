"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  CalendarPlus,
  Check,
  Handshake,
  Mail,
  MapPin,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Phone,
  UserRoundPlus,
  XCircle,
} from "lucide-react";
import { useRecordBreadcrumb } from "@/components/layout/breadcrumbs";
import { useGlobalUi } from "@/components/layout/global-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/misc";
import { ErrorState, EmptyState } from "@/components/feedback/states";
import { ActivityTimeline } from "@/features/shared/timeline";
import { useAuth } from "@/features/auth/auth-provider";
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  OPEN_STAGES,
  PRODUCT_LINES,
  type Lead,
} from "@/lib/api/contracts";
import { isApiError, userMessage } from "@/lib/api/errors";
import { dueState, formatDate, formatDateTime, formatINR, formatRelative } from "@/lib/formatting";
import { useLead, useLeadActivities, useUserDirectory } from "./hooks";
import { OwnerCell, PriorityBadge, ScoreBar, StageBadge } from "./lead-meta";
import {
  AssignDialog,
  CompleteFollowUpDialog,
  ConvertDialog,
  LogActivityDialog,
  ScheduleFollowUpDialog,
  useStageChanger,
} from "./lead-dialogs";
import { cn } from "@/lib/utils";

function StageStepper({
  lead,
  editable,
  onMove,
}: {
  lead: Lead;
  editable: boolean;
  onMove: (s: Lead["stage"]) => void;
}) {
  const steps = LEAD_STAGES.filter((s) => s.key !== "lost");
  const currentIdx = steps.findIndex((s) => s.key === lead.stage);
  const lost = lead.stage === "lost";
  return (
    <ol
      className="border-border bg-surface flex w-full scrollbar-thin overflow-x-auto rounded-lg border"
      aria-label="Lead stage"
    >
      {steps.map((s, i) => {
        const done = !lost && i < currentIdx;
        const current = !lost && i === currentIdx;
        const clickable = editable && !lead.clientId && !current;
        return (
          <li key={s.key} className="min-w-[96px] flex-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onMove(s.key)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "border-border flex h-10 w-full items-center justify-center gap-1.5 border-r px-2 text-xs font-medium transition-colors last:border-r-0",
                current && (s.key === "won" ? "bg-success text-white" : "bg-accent text-accent-fg"),
                done && "bg-accent-soft text-accent-soft-fg",
                !current && !done && "text-fg-muted",
                clickable && "hover:bg-surface-3 hover:text-fg",
                lost && "text-fg-subtle",
              )}
            >
              {done && <Check className="size-3.5" />}
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3 py-2 text-[13px]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function LeadDetail({ leadId }: { leadId: string }) {
  const { can } = useAuth();
  const { openSheet } = useGlobalUi();
  const lead = useLead(leadId);
  const activities = useLeadActivities(leadId);
  const directory = useUserDirectory();
  const stageChanger = useStageChanger();
  const [dialog, setDialog] = useState<
    null | "log" | "schedule" | "complete" | "assign" | "convert"
  >(null);
  useRecordBreadcrumb(lead.data ? (lead.data.company ?? lead.data.name) : null);

  if (lead.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }
  if (lead.isError || !lead.data) {
    const notFound = isApiError(lead.error) && lead.error.code === "NOT_FOUND";
    return notFound ? (
      <EmptyState
        title="Lead not found"
        description="It may have been removed, or it belongs to a team you can't see."
        action={
          <Button asChild size="sm">
            <Link href="/leads">Back to leads</Link>
          </Button>
        }
        className="py-20"
      />
    ) : (
      <ErrorState message={userMessage(lead.error)} onRetry={() => void lead.refetch()} />
    );
  }

  const l = lead.data;
  const open = OPEN_STAGES.includes(l.stage);
  const editable = can("leads.update");
  const due = dueState(l.nextFollowUpAt);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/leads"
          className="text-fg-muted hover:text-fg mb-3 inline-flex items-center gap-1 text-[13px]"
        >
          <ArrowLeft className="size-4" /> Leads
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold">{l.company ?? l.name}</h1>
              <StageBadge stage={l.stage} />
              <PriorityBadge priority={l.priority} />
            </div>
            <p className="text-fg-muted mt-1 text-[13px]">
              {l.code} · {l.name} · {formatINR(l.estimatedValue)} estimated · created{" "}
              {formatDate(l.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button size="sm" onClick={() => setDialog("log")}>
                <MessageSquarePlus /> Log activity
              </Button>
            )}
            {editable && open && (
              <Button
                size="sm"
                onClick={() => setDialog(l.nextFollowUpAt ? "complete" : "schedule")}
              >
                {l.nextFollowUpAt ? <CalendarCheck /> : <CalendarPlus />}{" "}
                {l.nextFollowUpAt ? "Complete follow-up" : "Schedule follow-up"}
              </Button>
            )}
            {can("leads.convert") &&
              can("clients.create") &&
              !l.clientId &&
              l.stage !== "lost" &&
              editable && (
                <Button size="sm" variant="primary" onClick={() => setDialog("convert")}>
                  <Handshake /> Convert to client
                </Button>
              )}
            {(editable || can("leads.assign")) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {editable && (
                    <DropdownMenuItem onSelect={() => openSheet({ kind: "lead", leadId: l.id })}>
                      <Pencil /> Edit details
                    </DropdownMenuItem>
                  )}
                  {can("leads.assign") && (
                    <DropdownMenuItem onSelect={() => setDialog("assign")}>
                      <UserRoundPlus /> Reassign
                    </DropdownMenuItem>
                  )}
                  {editable && open && l.nextFollowUpAt && (
                    <DropdownMenuItem onSelect={() => setDialog("schedule")}>
                      <CalendarPlus /> Reschedule follow-up
                    </DropdownMenuItem>
                  )}
                  {editable && open && (
                    <DropdownMenuItem
                      destructive
                      onSelect={() => void stageChanger.changeStage(l, "lost")}
                    >
                      <XCircle /> Mark as lost
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      <StageStepper
        lead={l}
        editable={editable}
        onMove={(s) => void stageChanger.changeStage(l, s)}
      />

      {l.clientId && (
        <div className="border-success/30 bg-success-soft flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]">
          <Building2 className="text-success size-4" />
          <span>Converted to a client.</span>
          <Link href={`/clients/${l.clientId}`} className="text-accent font-medium hover:underline">
            Open client profile
          </Link>
        </div>
      )}
      {l.stage === "lost" && (
        <div className="border-danger/30 bg-danger-soft text-danger rounded-lg border px-4 py-3 text-[13px]">
          Lost — {l.lostReason}. {editable && "Move it to any open stage to reopen."}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {open && (
            <Card
              className={cn(
                due === "overdue" && "border-danger/40",
                due === "today" && "border-warning/50",
              )}
            >
              <CardHeader className="pb-3">
                <div>
                  <CardTitle>Next step</CardTitle>
                  <p
                    className={cn(
                      "mt-1 text-[13px]",
                      due === "overdue" ? "text-danger font-medium" : "text-fg-muted",
                    )}
                  >
                    {l.nextFollowUpAt
                      ? `Follow-up ${due === "overdue" ? "was due" : "due"} ${formatRelative(l.nextFollowUpAt).toLowerCase()} · ${formatDateTime(l.nextFollowUpAt)}`
                      : "No follow-up scheduled. Every open lead should have a next action."}
                  </p>
                </div>
                {editable && (
                  <Button
                    size="sm"
                    variant={l.nextFollowUpAt ? "secondary" : "primary"}
                    onClick={() => setDialog(l.nextFollowUpAt ? "complete" : "schedule")}
                  >
                    {l.nextFollowUpAt ? "Complete" : "Schedule"}
                  </Button>
                )}
              </CardHeader>
            </Card>
          )}
          <Card>
            <CardHeader className="border-border border-b pb-3">
              <CardTitle>Activity</CardTitle>
              <span className="text-fg-subtle text-xs">{activities.data?.length ?? 0} events</span>
            </CardHeader>
            {activities.isError ? (
              <ErrorState
                message={userMessage(activities.error)}
                onRetry={() => void activities.refetch()}
              />
            ) : (
              <ActivityTimeline
                activities={activities.data}
                users={directory.byId}
                loading={activities.isLoading}
              />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[13px]">
              <p className="font-medium">{l.name}</p>
              <a
                href={`tel:${l.phone.replace(/\s/g, "")}`}
                className="text-fg-muted hover:text-accent flex items-center gap-2"
              >
                <Phone className="size-3.5" /> {l.phone}
              </a>
              {l.email && (
                <a
                  href={`mailto:${l.email}`}
                  className="text-fg-muted hover:text-accent flex items-center gap-2"
                >
                  <Mail className="size-3.5" /> {l.email}
                </a>
              )}
              {l.city && (
                <p className="text-fg-muted flex items-center gap-2">
                  <MapPin className="size-3.5" /> {l.city}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-0">
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-border divide-y">
                <Detail label="Owner">
                  <OwnerCell user={directory.byId.get(l.ownerId)} />
                </Detail>
                <Detail label="Interest">
                  {l.productInterest.map((p) => PRODUCT_LINES[p]).join(", ")}
                </Detail>
                <Detail label="Value">
                  <span className="tabular font-medium">{formatINR(l.estimatedValue)}</span>{" "}
                  <span className="text-fg-subtle text-xs">before GST</span>
                </Detail>
                <Detail label="Score">
                  <ScoreBar score={l.score} />
                </Detail>
                <Detail label="Source">
                  {LEAD_SOURCES[l.source]}
                  {l.campaign ? ` · ${l.campaign}` : ""}
                </Detail>
                <Detail label="Updated">{formatDateTime(l.updatedAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
          {l.notes && (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-fg-muted text-[13px] whitespace-pre-wrap">{l.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {dialog === "log" && (
        <LogActivityDialog leadId={l.id} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {dialog === "schedule" && (
        <ScheduleFollowUpDialog leadId={l.id} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {dialog === "complete" && (
        <CompleteFollowUpDialog lead={l} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {dialog === "assign" && (
        <AssignDialog leadIds={[l.id]} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {dialog === "convert" && (
        <ConvertDialog lead={l} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {stageChanger.dialog}
    </div>
  );
}
