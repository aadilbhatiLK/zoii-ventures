"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GripVertical, List, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/topbar";
import { useGlobalUi } from "@/components/layout/global-ui";
import { Button } from "@/components/ui/button";
import { Segmented, Skeleton, UserAvatar } from "@/components/ui/misc";
import { SearchInput } from "@/components/data-table/toolbar";
import { ErrorState, PermissionDenied } from "@/components/feedback/states";
import { Tooltip } from "@/components/ui/menu";
import { useAuth } from "@/features/auth/auth-provider";
import { getRuntime } from "@/lib/api";
import { LEAD_STAGES, type Lead, type LeadStage } from "@/lib/api/contracts";
import { userMessage } from "@/lib/api/errors";
import { leadScope } from "@/lib/permissions";
import { formatINRCompact } from "@/lib/formatting";
import { leadKeys, useUserDirectory } from "./hooks";
import { FollowUpCell, STAGE_DOT } from "./lead-meta";
import { useStageChanger } from "./lead-dialogs";
import { cn } from "@/lib/utils";

const BOARD_STAGES = LEAD_STAGES.map((s) => s.key);

export function PipelineBoard() {
  const { user, can } = useAuth();
  const { openSheet } = useGlobalUi();
  const directory = useUserDirectory();
  const [search, setSearch] = useState("");
  const [who, setWho] = useState<"all" | "mine">("all");
  const [dragOver, setDragOver] = useState<LeadStage | null>(null);
  const stageChanger = useStageChanger();
  const scope = leadScope(user);

  const queries = useQueries({
    queries: BOARD_STAGES.map((stage) => {
      const q = {
        stage: [stage],
        page: 1,
        pageSize: 50 as const,
        search: search || undefined,
        view: who === "mine" ? ("mine" as const) : undefined,
        sort: { field: "estimatedValue" as const, dir: "desc" as const },
      };
      return { queryKey: leadKeys.list(q), queryFn: () => getRuntime().api.leads.list(q) };
    }),
  });

  const columns = useMemo(
    () =>
      BOARD_STAGES.map((stage, i) => {
        const r = queries[i]!;
        const items = r.data?.items ?? [];
        return {
          stage,
          meta: LEAD_STAGES[i]!,
          items,
          total: r.data?.total ?? 0,
          value: items.reduce((s, l) => s + Number(l.estimatedValue), 0),
          loading: r.isLoading,
          error: r.error,
        };
      }),
    [queries],
  );

  if (scope === "none") return <PermissionDenied what="the pipeline" />;
  const firstError = columns.find((c) => c.error)?.error;
  const editable = can("leads.update");

  const move = (lead: Lead, dir: -1 | 1) => {
    const idx = BOARD_STAGES.indexOf(lead.stage);
    const next = BOARD_STAGES[idx + dir];
    if (next) void stageChanger.changeStage(lead, next);
  };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col">
      <PageHeader
        title="Sales pipeline"
        description="Drag a card to another stage, or use the arrows. Moving to Lost asks for a reason."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/leads">
                <List /> List
              </Link>
            </Button>
            {can("leads.create") && (
              <Button variant="primary" size="sm" onClick={() => openSheet({ kind: "lead" })}>
                <Plus /> New lead
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter cards…"
          className="w-full sm:w-64"
        />
        {scope !== "own" && (
          <Segmented
            label="Whose leads"
            value={who}
            onChange={setWho}
            options={[
              { value: "all", label: scope === "all" ? "Everyone" : "My team" },
              { value: "mine", label: "Mine" },
            ]}
          />
        )}
      </div>
      {firstError ? (
        <ErrorState
          message={userMessage(firstError)}
          onRetry={() => queries.forEach((q) => void q.refetch())}
        />
      ) : (
        <div
          className="-mx-4 flex min-h-0 flex-1 scrollbar-thin gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6"
          role="list"
          aria-label="Pipeline stages"
        >
          {columns.map((col) => (
            <section
              key={col.stage}
              role="listitem"
              aria-label={`${col.meta.label}, ${col.total} leads`}
              onDragOver={(e) => {
                if (!editable) return;
                e.preventDefault();
                setDragOver(col.stage);
              }}
              onDragLeave={() => setDragOver((s) => (s === col.stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                try {
                  const lead = JSON.parse(
                    e.dataTransfer.getData("application/x-zoii-lead"),
                  ) as Lead;
                  void stageChanger.changeStage(lead, col.stage);
                } catch {
                  /* not a lead card */
                }
              }}
              className={cn(
                "border-border bg-surface-2/70 flex w-[272px] shrink-0 flex-col rounded-lg border transition-colors",
                dragOver === col.stage && "border-accent bg-accent-soft/50",
              )}
            >
              <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", STAGE_DOT[col.stage])} />
                  <h2 className="text-[13px] font-semibold">{col.meta.label}</h2>
                  <span className="bg-surface-3 text-2xs text-fg-muted tabular rounded px-1.5 font-medium">
                    {col.total}
                  </span>
                </div>
                <Tooltip
                  content={
                    col.total > col.items.length
                      ? `Sum of the ${col.items.length} largest shown`
                      : `Probability ${col.meta.probability}%`
                  }
                >
                  <span className="text-fg-muted tabular text-xs font-medium">
                    {formatINRCompact(col.value)}
                  </span>
                </Tooltip>
              </header>
              <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-2 overflow-y-auto px-2 pb-2">
                {col.loading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-[92px] w-full rounded-md" />
                  ))}
                {!col.loading && col.items.length === 0 && (
                  <p className="text-fg-subtle px-2 py-6 text-center text-xs">No leads</p>
                )}
                {col.items.map((lead) => {
                  const owner = directory.byId.get(lead.ownerId);
                  const idx = BOARD_STAGES.indexOf(lead.stage);
                  const locked = !!lead.clientId;
                  return (
                    <article
                      key={lead.id}
                      draggable={editable && !locked}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application/x-zoii-lead",
                          JSON.stringify({ id: lead.id, code: lead.code, stage: lead.stage }),
                        );
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="group border-border bg-surface hover:border-border-strong rounded-md border p-2.5 shadow-xs transition-shadow hover:shadow-sm"
                    >
                      <div className="flex items-start gap-1.5">
                        {editable && !locked && (
                          <GripVertical
                            className="text-fg-subtle mt-0.5 size-3.5 shrink-0 cursor-grab opacity-0 group-hover:opacity-100"
                            aria-hidden
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="hover:text-accent block truncate text-[13px] font-medium"
                          >
                            {lead.company ?? lead.name}
                          </Link>
                          <p className="text-fg-muted truncate text-xs">
                            {lead.name} · {lead.code}
                          </p>
                        </div>
                        <span className="tabular text-[13px] font-semibold">
                          {formatINRCompact(lead.estimatedValue)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">
                          {OPEN(lead.stage) ? (
                            <FollowUpCell at={lead.nextFollowUpAt} />
                          ) : (
                            <span className="text-fg-subtle">
                              {lead.stage === "lost"
                                ? lead.lostReason
                                : locked
                                  ? "Converted to client"
                                  : "Closed"}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-0.5">
                          {editable && !locked && (
                            <>
                              <button
                                type="button"
                                aria-label={`Move ${lead.code} back`}
                                disabled={idx === 0}
                                onClick={() => move(lead, -1)}
                                className="text-fg-subtle hover:bg-surface-3 hover:text-fg rounded p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden"
                              >
                                <ChevronLeft className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${lead.code} forward`}
                                disabled={idx === BOARD_STAGES.length - 1}
                                onClick={() => move(lead, 1)}
                                className="text-fg-subtle hover:bg-surface-3 hover:text-fg rounded p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden"
                              >
                                <ChevronRight className="size-3.5" />
                              </button>
                            </>
                          )}
                          {owner && (
                            <UserAvatar name={owner.name} hue={owner.avatarHue} size={18} />
                          )}
                        </span>
                      </div>
                    </article>
                  );
                })}
                {col.total > col.items.length && (
                  <Link
                    href="/leads"
                    className="text-accent py-1 text-center text-xs font-medium hover:underline"
                  >
                    +{col.total - col.items.length} more in list view
                  </Link>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {stageChanger.dialog}
    </div>
  );
}

function OPEN(stage: LeadStage) {
  return stage !== "won" && stage !== "lost";
}
