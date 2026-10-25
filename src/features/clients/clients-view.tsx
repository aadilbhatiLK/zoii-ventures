"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { BadgeCheck, Building2, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { FacetFilter, ResetFilters, SearchInput } from "@/components/data-table/toolbar";
import { PageHeader } from "@/components/layout/topbar";
import { useGlobalUi } from "@/components/layout/global-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/menu";
import { EmptyState, PermissionDenied } from "@/components/feedback/states";
import { useAuth } from "@/features/auth/auth-provider";
import { useUserDirectory } from "@/features/leads/hooks";
import { OwnerCell, ProductChips } from "@/features/leads/lead-meta";
import { CLIENT_CATEGORIES, type Client, type ClientCategory } from "@/lib/api/contracts";
import { userMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/formatting";
import { useClientList } from "./hooks";

type Status = Client["status"];
export const STATUS_TONE: Record<Status, "success" | "info" | "neutral"> = {
  active: "success",
  onboarding: "info",
  inactive: "neutral",
};
export const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  onboarding: "Onboarding",
  inactive: "Inactive",
};

export function ClientsView() {
  const router = useRouter();
  const { can } = useAuth();
  const { openSheet } = useGlobalUi();
  const directory = useUserDirectory();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status[]>([]);
  const [category, setCategory] = useState<ClientCategory[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);
  const [sorting, setSorting] = useState<SortingState>([]);
  const list = useClientList({
    search: search || undefined,
    status: status.length ? status : undefined,
    category: category.length ? category : undefined,
    page,
    pageSize,
  });
  const onSearch = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);

  const columns = useMemo<ColumnDef<Client, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Client",
        size: 280,
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <div className="min-w-0 py-1">
            <Link
              href={`/clients/${c.id}`}
              className="hover:text-accent block truncate font-medium"
            >
              {c.name}
            </Link>
            <p className="text-fg-muted truncate text-xs">
              {c.code} · {c.industry}
              {c.billingAddress.city ? ` · ${c.billingAddress.city}` : ""}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        size: 110,
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
        ),
      },
      {
        id: "category",
        header: "Category",
        size: 130,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-fg-muted">{CLIENT_CATEGORIES[row.original.category]}</span>
        ),
      },
      {
        id: "am",
        header: "Account manager",
        size: 170,
        enableSorting: false,
        cell: ({ row }) => <OwnerCell user={directory.byId.get(row.original.accountManagerId)} />,
      },
      {
        id: "products",
        header: "Products",
        size: 210,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.productLines.length ? (
            <ProductChips lines={row.original.productLines} />
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: "gstin",
        header: "GSTIN",
        size: 170,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.gstin ? (
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              <BadgeCheck className="text-success size-3.5" />
              {row.original.gstin}
            </span>
          ) : (
            <span className="text-fg-subtle text-xs">Unregistered / pending</span>
          ),
      },
      {
        id: "outstanding",
        header: "Outstanding",
        size: 110,
        enableSorting: false,
        cell: () => (
          <Tooltip content="Receivables come from the finance ledger (Sprint 5). Not estimated.">
            <span className="text-fg-subtle">—</span>
          </Tooltip>
        ),
      },
      {
        id: "createdAt",
        header: "Client since",
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular text-fg-muted">{formatDate(row.original.createdAt)}</span>
        ),
      },
    ],
    [directory.byId],
  );

  if (!can("clients.view")) return <PermissionDenied what="clients" />;
  const active = !!search || status.length > 0 || category.length > 0;

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Every customer of Zoii Ventures across product lines."
        actions={
          can("clients.create") && (
            <Button variant="primary" size="sm" onClick={() => openSheet({ kind: "client" })}>
              <Plus /> New client
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder="Search name, code, city, GSTIN, contact…"
          className="w-full sm:w-80"
        />
        <FacetFilter
          title="Status"
          options={(["onboarding", "active", "inactive"] as Status[]).map((s) => ({
            value: s,
            label: STATUS_LABEL[s],
          }))}
          selected={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <FacetFilter
          title="Category"
          options={Object.entries(CLIENT_CATEGORIES).map(([value, label]) => ({
            value: value as ClientCategory,
            label,
          }))}
          selected={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        />
        <ResetFilters
          show={active}
          onReset={() => {
            setSearch("");
            setStatus([]);
            setCategory([]);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Clients"
        columns={columns}
        data={list.data?.items ?? []}
        total={list.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        sorting={sorting}
        onSortingChange={setSorting}
        getRowId={(c) => c.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? userMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        onRowClick={(c) => router.push(`/clients/${c.id}`)}
        empty={
          <EmptyState
            icon={<Building2 />}
            title={active ? "No clients match" : "No clients yet"}
            description={
              active
                ? "Try a different search or filter."
                : "Convert a won lead or add a client directly."
            }
          />
        }
      />
    </div>
  );
}
