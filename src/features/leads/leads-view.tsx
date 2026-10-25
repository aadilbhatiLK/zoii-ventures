"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ColumnDef,
  RowSelectionState,
  SortingState,
  VisibilityState,
  ColumnSizingState,
} from "@tanstack/react-table";
import {
  ArrowRightLeft,
  BookmarkPlus,
  CalendarPlus,
  Download,
  Eye,
  KanbanSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Target,
  Trash2,
  UserRoundPlus,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import {
  ColumnToggle,
  FacetFilter,
  ResetFilters,
  SearchInput,
} from "@/components/data-table/toolbar";
import { PageHeader } from "@/components/layout/topbar";
import { useGlobalUi } from "@/components/layout/global-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/misc";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { EmptyState, PermissionDenied } from "@/components/feedback/states";
import { useAuth } from "@/features/auth/auth-provider";
import { getRuntime } from "@/lib/api";
import {
  LEAD_SOURCES,
  OPEN_STAGES,
  PRIORITIES,
  PRODUCT_LINES,
  stageMeta,
  type Lead,
  type LeadListQuery,
  type LeadSortField,
  type LeadSource,
  type LeadStage,
  type Priority,
  type ProductLine,
} from "@/lib/api/contracts";
import { userMessage } from "@/lib/api/errors";
import { leadScope } from "@/lib/permissions";
import { formatDate, formatINRCompact } from "@/lib/formatting";
import { toCsv, downloadCsv } from "@/lib/csv";
import { appConfig } from "@/lib/config/env";
import { useLeadList, useUserDirectory, useChangeStage } from "./hooks";
import {
  FollowUpCell,
  OwnerCell,
  PriorityBadge,
  ProductChips,
  ScoreBar,
  StageBadge,
  STAGE_DOT,
  STAGE_OPTIONS,
} from "./lead-meta";
import { AssignDialog, ScheduleFollowUpDialog, useStageChanger } from "./lead-dialogs";
import { cn } from "@/lib/utils";

type View = NonNullable<LeadListQuery["view"]>;
const VIEWS: { id: View; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "My leads" },
  { id: "due_today", label: "Due today" },
  { id: "overdue", label: "Overdue" },
  { id: "hot", label: "Hot" },
  { id: "all", label: "All" },
];

interface Filters {
  search: string;
  stage: LeadStage[];
  productLine: ProductLine[];
  ownerId: string[];
  source: LeadSource[];
  priority: Priority[];
}
const EMPTY: Filters = {
  search: "",
  stage: [],
  productLine: [],
  ownerId: [],
  source: [],
  priority: [],
};

interface SavedView {
  id: string;
  name: string;
  view: View;
  filters: Filters;
}

const COLUMN_LABELS: { id: string; label: string }[] = [
  { id: "stage", label: "Stage" },
  { id: "estimatedValue", label: "Value" },
  { id: "product", label: "Interest" },
  { id: "owner", label: "Owner" },
  { id: "nextFollowUpAt", label: "Follow-up" },
  { id: "score", label: "Score" },
  { id: "priority", label: "Priority" },
  { id: "source", label: "Source" },
  { id: "createdAt", label: "Created" },
];

function storageKey(userId: string, k: string) {
  return `zoii.leads.${k}.${userId}`;
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* preference not persisted */
  }
}

export function LeadsView() {
  const router = useRouter();
  const { user, can } = useAuth();
  const { openSheet } = useGlobalUi();
  const directory = useUserDirectory();
  const scope = leadScope(user);

  const [view, setView] = useState<View>("open");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    user
      ? readJson(storageKey(user.id, "columns"), {
          source: false,
          priority: false,
          createdAt: false,
        })
      : { source: false, priority: false, createdAt: false },
  );
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    user ? readJson<SavedView[]>(storageKey(user.id, "views"), []) : [],
  );
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const [bulkStage, setBulkStage] = useState<LeadStage | null>(null);
  const [exporting, setExporting] = useState(false);
  const stageChanger = useStageChanger();
  const changeStage = useChangeStage();

  const query: LeadListQuery = useMemo(() => {
    const s = sorting[0];
    return {
      view,
      page,
      pageSize,
      search: filters.search || undefined,
      stage: filters.stage.length ? filters.stage : undefined,
      productLine: filters.productLine.length ? filters.productLine : undefined,
      ownerId: filters.ownerId.length ? filters.ownerId : undefined,
      source: filters.source.length ? filters.source : undefined,
      priority: filters.priority.length ? filters.priority : undefined,
      sort: s ? { field: s.id as LeadSortField, dir: s.desc ? "desc" : "asc" } : undefined,
    };
  }, [view, page, pageSize, filters, sorting]);

  const list = useLeadList(query);
  const setFilter = useCallback(<K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    setSelection({});
    setActiveSaved(null);
  }, []);
  const onSearch = useCallback((v: string) => setFilter("search", v), [setFilter]);
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY);

  const columns = useMemo<ColumnDef<Lead, unknown>[]>(
    () => [
      {
        id: "select",
        size: 40,
        enableResizing: false,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.code}`}
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
          />
        ),
      },
      {
        id: "name",
        accessorKey: "name",
        header: "Lead",
        size: 240,
        cell: ({ row }) => (
          <div className="min-w-0 py-1">
            <Link
              href={`/leads/${row.original.id}`}
              className="text-fg hover:text-accent block truncate font-medium"
            >
              {row.original.company ?? row.original.name}
            </Link>
            <p className="text-fg-muted truncate text-xs">
              {row.original.code} · {row.original.name}
              {row.original.city ? ` · ${row.original.city}` : ""}
            </p>
          </div>
        ),
      },
      {
        id: "stage",
        header: "Stage",
        size: 124,
        enableSorting: false,
        cell: ({ row }) => <StageBadge stage={row.original.stage} />,
      },
      {
        id: "estimatedValue",
        accessorKey: "estimatedValue",
        header: "Value",
        size: 88,
        cell: ({ row }) => (
          <span className="tabular font-medium">
            {formatINRCompact(row.original.estimatedValue)}
          </span>
        ),
      },
      {
        id: "product",
        header: "Interest",
        size: 184,
        enableSorting: false,
        cell: ({ row }) => <ProductChips lines={row.original.productInterest} />,
      },
      {
        id: "owner",
        header: "Owner",
        size: 150,
        enableSorting: false,
        cell: ({ row }) => <OwnerCell user={directory.byId.get(row.original.ownerId)} />,
      },
      {
        id: "nextFollowUpAt",
        accessorKey: "nextFollowUpAt",
        header: "Follow-up",
        size: 168,
        cell: ({ row }) => <FollowUpCell at={row.original.nextFollowUpAt} />,
      },
      {
        id: "score",
        accessorKey: "score",
        header: "Score",
        size: 92,
        cell: ({ row }) => <ScoreBar score={row.original.score} />,
      },
      {
        id: "priority",
        header: "Priority",
        size: 90,
        enableSorting: false,
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      {
        id: "source",
        header: "Source",
        size: 110,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-fg-muted">{LEAD_SOURCES[row.original.source]}</span>
        ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Created",
        size: 110,
        cell: ({ row }) => (
          <span className="tabular text-fg-muted">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        size: 48,
        enableResizing: false,
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const l = row.original;
          const open = OPEN_STAGES.includes(l.stage);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${l.code}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52">
                <DropdownMenuItem onSelect={() => router.push(`/leads/${l.id}`)}>
                  <Eye /> Open
                </DropdownMenuItem>
                {can("leads.update") && (
                  <DropdownMenuItem onSelect={() => openSheet({ kind: "lead", leadId: l.id })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {can("leads.assign") && (
                  <DropdownMenuItem onSelect={() => setAssignIds([l.id])}>
                    <UserRoundPlus /> Assign
                  </DropdownMenuItem>
                )}
                {can("leads.update") && open && (
                  <DropdownMenuItem onSelect={() => setFollowUpFor(l.id)}>
                    <CalendarPlus /> Schedule follow-up
                  </DropdownMenuItem>
                )}
                {can("leads.update") && !l.clientId && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRightLeft /> Move to stage
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-44">
                      {STAGE_OPTIONS.map((s) => (
                        <DropdownMenuItem
                          key={s.value}
                          disabled={s.value === l.stage}
                          onSelect={() => void stageChanger.changeStage(l, s.value)}
                        >
                          <span className={cn("size-2 rounded-full", STAGE_DOT[s.value])} />{" "}
                          {s.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {can("leads.update") && open && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={() => void stageChanger.changeStage(l, "lost")}
                    >
                      <XCircle /> Mark as lost
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [directory.byId, can, openSheet, router, stageChanger],
  );

  if (scope === "none") return <PermissionDenied what="leads" />;

  const selectedIds = Object.keys(selection);
  const ownerOptions = (directory.data ?? [])
    .filter((u) =>
      u.roles.some((r) => r === "sales_executive" || r === "sales_manager" || r === "founder"),
    )
    .map((u) => ({ value: u.id, label: u.name }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: Lead[] = [];
      for (let p = 1; p <= 40; p++) {
        const r = await getRuntime().api.leads.list({ ...query, page: p, pageSize: 50 });
        rows.push(...r.items);
        if (rows.length >= r.total) break;
      }
      const csv = toCsv(
        [
          "Code",
          "Company",
          "Contact",
          "Phone",
          "Email",
          "City",
          "Stage",
          "Value (INR)",
          "Interest",
          "Owner",
          "Source",
          "Priority",
          "Score",
          "Next follow-up",
          "Created",
        ],
        rows.map((l) => [
          l.code,
          l.company ?? "",
          l.name,
          l.phone,
          l.email ?? "",
          l.city ?? "",
          stageMeta(l.stage).label,
          l.estimatedValue,
          l.productInterest.map((p) => PRODUCT_LINES[p]).join("; "),
          directory.byId.get(l.ownerId)?.name ?? l.ownerId,
          LEAD_SOURCES[l.source],
          PRIORITIES[l.priority],
          String(l.score),
          l.nextFollowUpAt ?? "",
          l.createdAt,
        ]),
        appConfig.ok && appConfig.mode === "demo"
          ? "DEMO DATA - fictional records exported from Zoii Business OS demo mode"
          : undefined,
      );
      downloadCsv(`zoii-leads-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${rows.length} leads`);
    } catch (e) {
      toast.error(userMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const applySaved = (v: SavedView) => {
    setView(v.view);
    setFilters(v.filters);
    setPage(1);
    setSelection({});
    setActiveSaved(v.id);
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description={
          scope === "all"
            ? "Every lead across Zoii Ventures."
            : scope === "team"
              ? "Leads owned by your team."
              : "Leads assigned to you."
        }
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/pipeline">
                <KanbanSquare /> Board
              </Link>
            </Button>
            {can("leads.export") && (
              <Button variant="secondary" size="sm" onClick={exportCsv} loading={exporting}>
                <Download /> Export
              </Button>
            )}
            {can("leads.create") && (
              <Button variant="primary" size="sm" onClick={() => openSheet({ kind: "lead" })}>
                <Plus /> New lead
              </Button>
            )}
          </>
        }
      />

      <div
        className="border-border mb-3 flex scrollbar-thin items-center gap-1 overflow-x-auto border-b"
        role="tablist"
        aria-label="Lead views"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id && !activeSaved}
            onClick={() => {
              setView(v.id);
              setPage(1);
              setSelection({});
              setActiveSaved(null);
            }}
            className={cn(
              "-mb-px h-9 shrink-0 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              view === v.id && !activeSaved
                ? "border-accent text-fg"
                : "text-fg-muted hover:text-fg border-transparent",
            )}
          >
            {v.label}
          </button>
        ))}
        {savedViews.map((v) => (
          <span
            key={v.id}
            className={cn(
              "-mb-px inline-flex h-9 shrink-0 items-center border-b-2",
              activeSaved === v.id ? "border-accent" : "border-transparent",
            )}
          >
            <button
              role="tab"
              aria-selected={activeSaved === v.id}
              onClick={() => applySaved(v)}
              className={cn(
                "px-2.5 text-[13px] font-medium whitespace-nowrap",
                activeSaved === v.id ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {v.name}
            </button>
            <button
              aria-label={`Delete saved view ${v.name}`}
              className="text-fg-subtle hover:bg-surface-3 hover:text-fg mr-1 rounded p-0.5"
              onClick={() => {
                const next = savedViews.filter((x) => x.id !== v.id);
                setSavedViews(next);
                writeJson(storageKey(user!.id, "views"), next);
                if (activeSaved === v.id) setActiveSaved(null);
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button
          onClick={() => setSaveOpen(true)}
          className="text-fg-muted hover:bg-surface-3 hover:text-fg ml-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs"
        >
          <BookmarkPlus className="size-3.5" /> Save view
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.search}
          onChange={onSearch}
          placeholder="Search name, company, phone, code… ( / )"
          className="w-full sm:w-72"
        />
        <FacetFilter
          title="Stage"
          options={STAGE_OPTIONS}
          selected={filters.stage}
          onChange={(v) => setFilter("stage", v)}
        />
        <FacetFilter
          title="Interest"
          options={Object.entries(PRODUCT_LINES).map(([value, label]) => ({
            value: value as ProductLine,
            label,
          }))}
          selected={filters.productLine}
          onChange={(v) => setFilter("productLine", v)}
        />
        {scope !== "own" && (
          <FacetFilter
            title="Owner"
            options={ownerOptions}
            selected={filters.ownerId}
            onChange={(v) => setFilter("ownerId", v)}
          />
        )}
        <FacetFilter
          title="Source"
          options={Object.entries(LEAD_SOURCES).map(([value, label]) => ({
            value: value as LeadSource,
            label,
          }))}
          selected={filters.source}
          onChange={(v) => setFilter("source", v)}
        />
        <FacetFilter
          title="Priority"
          options={Object.entries(PRIORITIES).map(([value, label]) => ({
            value: value as Priority,
            label,
          }))}
          selected={filters.priority}
          onChange={(v) => setFilter("priority", v)}
        />
        <ResetFilters
          show={filtersActive}
          onReset={() => {
            setFilters(EMPTY);
            setPage(1);
            setActiveSaved(null);
          }}
        />
        <div className="ml-auto">
          <ColumnToggle
            columns={COLUMN_LABELS}
            visibility={visibility}
            onChange={(v) => {
              setVisibility(v);
              writeJson(storageKey(user!.id, "columns"), v);
            }}
          />
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="border-accent/30 bg-accent-soft/60 animate-fade-in mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <span className="text-[13px] font-medium">{selectedIds.length} selected</span>
          <span className="bg-border-strong h-4 w-px" />
          {can("leads.assign") && (
            <Button size="xs" variant="secondary" onClick={() => setAssignIds(selectedIds)}>
              <UserRoundPlus /> Assign
            </Button>
          )}
          {can("leads.update") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="secondary">
                  <ArrowRightLeft /> Move stage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Lost needs a reason — do it per lead</DropdownMenuLabel>
                {STAGE_OPTIONS.filter((s) => s.value !== "lost").map((s) => (
                  <DropdownMenuItem key={s.value} onSelect={() => setBulkStage(s.value)}>
                    <span className={cn("size-2 rounded-full", STAGE_DOT[s.value])} /> {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="xs" variant="ghost" onClick={() => setSelection({})}>
            <Trash2 /> Clear selection
          </Button>
        </div>
      )}

      <DataTable
        label="Leads"
        columns={columns}
        data={list.data?.items ?? []}
        total={list.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={(p) => {
          setPage(p);
          setSelection({});
        }}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
          setSelection({});
        }}
        sorting={sorting}
        onSortingChange={(u) => {
          setSorting(u);
          setPage(1);
        }}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        columnVisibility={visibility}
        columnSizing={sizing}
        onColumnSizingChange={setSizing}
        getRowId={(l) => l.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? userMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        onRowClick={(l) => router.push(`/leads/${l.id}`)}
        empty={
          <EmptyState
            icon={<Target />}
            title={filtersActive || view !== "all" ? "No leads match this view" : "No leads yet"}
            description={
              filtersActive
                ? "Try removing a filter or searching for something else."
                : "New leads you capture will show up here."
            }
            action={
              filtersActive ? (
                <Button size="sm" onClick={() => setFilters(EMPTY)}>
                  Clear filters
                </Button>
              ) : can("leads.create") ? (
                <Button size="sm" variant="primary" onClick={() => openSheet({ kind: "lead" })}>
                  <Plus /> New lead
                </Button>
              ) : undefined
            }
          />
        }
      />

      {assignIds && (
        <AssignDialog
          leadIds={assignIds}
          open
          onOpenChange={(o) => !o && setAssignIds(null)}
          onDone={() => setSelection({})}
        />
      )}
      {followUpFor && (
        <ScheduleFollowUpDialog
          leadId={followUpFor}
          open
          onOpenChange={(o) => !o && setFollowUpFor(null)}
        />
      )}
      {stageChanger.dialog}
      <ConfirmDialog
        open={!!bulkStage}
        onOpenChange={(o) => !o && setBulkStage(null)}
        title={`Move ${selectedIds.length} leads to ${bulkStage ? stageMeta(bulkStage).label : ""}?`}
        description="Each lead records the stage change in its history. Converted leads are skipped."
        confirmLabel="Move leads"
        onConfirm={async () => {
          const stage = bulkStage!;
          setBulkStage(null);
          const results = await Promise.allSettled(
            selectedIds.map((id) => changeStage.mutateAsync({ id, stage })),
          );
          const ok = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.length - ok;
          if (ok)
            toast.success(`${ok} lead${ok > 1 ? "s" : ""} moved to ${stageMeta(stage).label}`);
          if (failed)
            toast.error(
              `${failed} lead${failed > 1 ? "s" : ""} couldn't be moved (converted or no access).`,
            );
          setSelection({});
        }}
      />
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={(name) => {
          const v: SavedView = { id: `v_${Date.now()}`, name, view, filters };
          const next = [...savedViews, v].slice(-8);
          setSavedViews(next);
          writeJson(storageKey(user!.id, "views"), next);
          setActiveSaved(v.id);
          toast.success(`View “${name}” saved`);
        }}
      />
    </div>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setName("");
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>Saves the current tab and filters on this device.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Name" htmlFor="view-name">
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Jewellery CRM — Jodhpur"
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={() => {
              onSave(name.trim());
              onOpenChange(false);
              setName("");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
