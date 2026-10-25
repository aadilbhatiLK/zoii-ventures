"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/misc";
import { ErrorState, TableSkeleton } from "@/components/feedback/states";
import { cn } from "@/lib/utils";

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: 10 | 20 | 50) => void;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: OnChangeFn<ColumnSizingState>;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  label: string;
}

/** Server-driven table: sorting, pagination and filtering happen in the API, not in memory. */
export function DataTable<T>(props: DataTableProps<T>) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 is not React-Compiler safe; the compiler is not enabled.
  const table = useReactTable({
    data: props.data,
    columns: props.columns,
    getRowId: props.getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSortingRemoval: true,
    pageCount: Math.max(1, Math.ceil(props.total / props.pageSize)),
    state: {
      sorting: props.sorting,
      rowSelection: props.rowSelection ?? {},
      columnVisibility: props.columnVisibility ?? {},
      columnSizing: props.columnSizing ?? {},
    },
    onSortingChange: props.onSortingChange,
    onRowSelectionChange: props.onRowSelectionChange,
    onColumnVisibilityChange: props.onColumnVisibilityChange,
    onColumnSizingChange: props.onColumnSizingChange,
    enableRowSelection: !!props.onRowSelectionChange,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const from = props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.total, props.page * props.pageSize);
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));

  return (
    <div className="border-border bg-surface overflow-hidden rounded-lg border shadow-xs">
      <div
        className={cn(
          "relative scrollbar-thin overflow-x-auto",
          props.isFetching && !props.isLoading && "opacity-80 transition-opacity",
        )}
      >
        <table
          className="w-full min-w-[760px] border-collapse text-[13px]"
          aria-label={props.label}
          aria-busy={props.isLoading || props.isFetching || undefined}
          style={{ tableLayout: "fixed" }}
        >
          <colgroup>
            {table.getVisibleLeafColumns().map((c) => (
              <col key={c.id} style={{ width: c.getSize() }} />
            ))}
          </colgroup>
          <thead className="bg-surface-2 sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-border border-b">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const sortable = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                      className="group text-fg-muted relative h-9 px-3 text-left text-xs font-medium whitespace-nowrap"
                    >
                      {h.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="hover:bg-surface-3 hover:text-fg -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                      {h.column.getCanResize() && (
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${String(h.column.id)} column`}
                          onMouseDown={h.getResizeHandler()}
                          onTouchStart={h.getResizeHandler()}
                          onDoubleClick={() => h.column.resetSize()}
                          className={cn(
                            "bg-border absolute top-2 right-0 h-5 w-1 cursor-col-resize rounded opacity-0 group-hover:opacity-100",
                            h.column.getIsResizing() && "bg-accent opacity-100",
                          )}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {!props.isLoading &&
              !props.error &&
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={(e) => {
                    if (!props.onRowClick) return;
                    const t = e.target as HTMLElement;
                    if (t.closest("button, a, input, [role=checkbox], [role=menuitem]")) return;
                    props.onRowClick(row.original);
                  }}
                  className={cn(
                    "border-border data-[state=selected]:bg-accent-soft/50 h-12 border-b transition-colors last:border-0",
                    props.onRowClick && "hover:bg-surface-2 cursor-pointer",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="truncate px-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {props.isLoading && <TableSkeleton />}
        {props.error && <ErrorState message={props.error} onRetry={props.onRetry} />}
        {!props.isLoading && !props.error && props.data.length === 0 && props.empty}
      </div>
      <div className="border-border bg-surface-2/50 text-fg-muted flex flex-col gap-2 border-t px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="tabular" aria-live="polite">
          {props.total === 0
            ? "No results"
            : `${from}–${to} of ${props.total.toLocaleString("en-IN")}`}
          {props.rowSelection &&
            Object.keys(props.rowSelection).length > 0 &&
            ` · ${Object.keys(props.rowSelection).length} selected`}
        </p>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">Rows</span>
          <Select
            value={String(props.pageSize)}
            onValueChange={(v) => props.onPageSizeChange(Number(v) as 10 | 20 | 50)}
          >
            <SelectTrigger className="h-7 w-[68px] text-xs" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="tabular">
            Page {props.page} / {pages}
          </span>
          <Button
            size="icon-xs"
            variant="secondary"
            onClick={() => props.onPageChange(props.page - 1)}
            disabled={props.page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-xs"
            variant="secondary"
            onClick={() => props.onPageChange(props.page + 1)}
            disabled={props.page >= pages}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
