"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { visibleNav, findNavItem } from "@/lib/nav";
import { useAuth } from "@/features/auth/auth-provider";
import { ZoiiMark } from "@/components/brand";
import { Tooltip } from "@/components/ui/menu";
import { NavIcon } from "./nav-icon";
import { cn } from "@/lib/utils";

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { can } = useAuth();
  const groups = visibleNav(can);
  const active = findNavItem(pathname);

  return (
    <nav aria-label="Main" className="flex-1 scrollbar-thin overflow-y-auto px-2 pb-4">
      {groups.map((group) => (
        <div key={group.title} className="mt-4 first:mt-2">
          {!collapsed ? (
            <p className="text-2xs text-fg-subtle px-2 pb-1 font-medium tracking-wider uppercase">
              {group.title}
            </p>
          ) : (
            <div className="bg-border mx-2 mb-1 h-px" aria-hidden />
          )}
          <ul className="space-y-px">
            {group.items.map((item) => {
              const isActive = active?.href === item.href;
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group focus-visible:ring-ring flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors outline-none focus-visible:ring-2",
                    isActive
                      ? "bg-surface text-fg ring-border font-medium shadow-xs ring-1"
                      : "text-fg-muted hover:bg-surface-3 hover:text-fg",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <NavIcon
                    name={item.icon}
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted",
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.title}</span>}
                  {!collapsed && item.status === "planned" && (
                    <span className="text-fg-subtle ring-border ml-auto rounded px-1 text-[10px] font-medium ring-1">
                      S{item.sprint}
                    </span>
                  )}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip
                      side="right"
                      content={`${item.title}${item.status === "planned" ? ` · planned (Sprint ${item.sprint})` : ""}`}
                    >
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        "border-border bg-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 md:flex",
        collapsed ? "w-[60px]" : "w-[244px]",
      )}
    >
      <div
        className={cn(
          "border-border flex h-14 items-center gap-2 border-b px-3",
          collapsed && "justify-center px-0",
        )}
      >
        <ZoiiMark size={26} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="font-display truncate text-[14px] font-semibold">Zoii Ventures</p>
            <p className="text-2xs text-fg-subtle truncate">Business OS</p>
          </div>
        )}
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className="border-border border-t p-2">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "text-fg-muted hover:bg-surface-3 hover:text-fg flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px]",
            collapsed && "justify-center px-0",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
