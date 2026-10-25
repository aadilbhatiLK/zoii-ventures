"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronsUpDown,
  FileText,
  Laptop,
  LogOut,
  Menu,
  Moon,
  Plus,
  Receipt,
  Search,
  Sun,
  Target,
  UserRoundCog,
} from "lucide-react";
import { getRuntime } from "@/lib/api";
import { useAuth } from "@/features/auth/auth-provider";
import { useTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/menu";
import { Kbd, UserAvatar } from "@/components/ui/misc";
import { ROLES } from "@/lib/permissions";
import { formatRelative } from "@/lib/formatting";
import { appConfig } from "@/lib/config/env";
import { Breadcrumbs } from "./breadcrumbs";
import { useGlobalUi } from "./global-ui";
import { cn } from "@/lib/utils";

function CreateMenu() {
  const { can } = useAuth();
  const { openSheet } = useGlobalUi();
  if (!can("leads.create") && !can("clients.create")) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="sm" aria-label="Create">
          <Plus /> <span className="hidden sm:inline">Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        {can("leads.create") && (
          <DropdownMenuItem onSelect={() => openSheet({ kind: "lead" })}>
            <Target /> Lead <Kbd className="ml-auto">N</Kbd>
          </DropdownMenuItem>
        )}
        {can("clients.create") && (
          <DropdownMenuItem onSelect={() => openSheet({ kind: "client" })}>
            <Building2 /> Client
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Receipt /> Quotation <span className="text-2xs ml-auto">Sprint 3</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <FileText /> BRD / PRD <span className="text-2xs ml-auto">Sprint 3</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Notifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getRuntime().api.notifications.list(),
    refetchInterval: 60_000,
  });
  const mark = useMutation({
    mutationFn: (ids: string[]) => getRuntime().api.notifications.markRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = (data ?? []).filter((n) => !n.read);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`}
          className="relative"
        >
          <Bell />
          {unread.length > 0 && (
            <span className="bg-danger absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-1rem)]">
        <div className="border-border flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          <Button
            variant="ghost"
            size="xs"
            disabled={!unread.length || mark.isPending}
            onClick={() => mark.mutate(unread.map((n) => n.id))}
          >
            <Check /> Mark all read
          </Button>
        </div>
        <div className="max-h-96 scrollbar-thin overflow-y-auto">
          {isLoading && <p className="text-fg-muted p-4 text-[13px]">Loading…</p>}
          {isError && (
            <p className="text-danger p-4 text-[13px]">Couldn&apos;t load notifications.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-fg-muted p-6 text-center text-[13px]">You&apos;re all caught up.</p>
          )}
          {data?.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.read) mark.mutate([n.id]);
                router.push(n.href);
              }}
              className={cn(
                "border-border hover:bg-surface-2 flex w-full gap-3 border-b px-3 py-2.5 text-left last:border-0",
                n.read && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5",
                  n.kind === "follow_up_overdue"
                    ? "bg-danger-soft text-danger"
                    : n.kind === "assignment"
                      ? "bg-accent-soft text-accent"
                      : "bg-warning-soft text-warning",
                )}
              >
                {n.kind === "assignment" ? <Target /> : <CalendarClock />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{n.title}</span>
                <span className="text-fg-muted block truncate text-xs">{n.body}</span>
              </span>
              <span className="text-2xs text-fg-subtle shrink-0">
                {formatRelative(n.createdAt)}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { user, signOut, personas, switchPersona } = useAuth();
  const { preference, setPreference } = useTheme();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-surface-3 focus-visible:ring-ring flex h-8 items-center gap-2 rounded-md px-1.5 outline-none focus-visible:ring-2"
          aria-label="Account menu"
        >
          <UserAvatar name={user.name} hue={user.avatarHue} size={26} />
          <span className="hidden max-w-32 truncate text-[13px] font-medium lg:inline">
            {user.name}
          </span>
          <ChevronsUpDown className="text-fg-subtle hidden size-3.5 lg:inline" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <UserAvatar name={user.name} hue={user.avatarHue} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{user.name}</p>
            <p className="text-fg-muted truncate text-xs">
              {user.roles.map((r) => ROLES[r]).join(", ")}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {preference === "dark" ? <Moon /> : preference === "light" ? <Sun /> : <Laptop />} Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(["light", "dark", "system"] as const).map((p) => (
              <DropdownMenuItem key={p} onSelect={() => setPreference(p)}>
                {p === "light" ? <Sun /> : p === "dark" ? <Moon /> : <Laptop />}
                <span className="capitalize">{p}</span>
                {preference === p && <Check className="!text-accent ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {personas && switchPersona && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRoundCog /> Switch demo persona
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuLabel>Demo only — tests role-based access</DropdownMenuLabel>
              {personas.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void switchPersona(p.id)}>
                  <UserAvatar name={p.name} hue={p.avatarHue} size={20} />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  {p.id === user.id && <Check className="!text-accent" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut("user")}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { setPaletteOpen } = useGlobalUi();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="border-border bg-bg/85 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur-md sm:px-5">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="border-border bg-surface text-fg-subtle hover:border-border-strong hidden h-8 w-64 items-center gap-2 rounded-md border px-2.5 text-[13px] shadow-xs transition-colors md:flex"
        aria-label="Search or run a command"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search"
      >
        <Search />
      </Button>
      <CreateMenu />
      <Notifications />
      {appConfig.ok && appConfig.mode === "demo" && <span className="sr-only">Demo mode</span>}
      <UserMenu />
    </header>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-[22px] leading-tight font-semibold">{title}</h1>
          {meta}
        </div>
        {description && <p className="text-fg-muted mt-1 text-[13px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-fg-muted hover:text-fg text-[13px]">
      {children}
    </Link>
  );
}
