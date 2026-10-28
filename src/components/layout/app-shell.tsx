"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";
import { requiresMfa } from "@/lib/permissions";
import { Skeleton } from "@/components/ui/misc";
import { ZoiiWordmark } from "@/components/brand";
import { Sidebar, SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";
import { BreadcrumbProvider } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { GlobalUiProvider, useGlobalUi } from "./global-ui";
import { GlobalSheets } from "./global-sheets";

const COLLAPSE_KEY = "zoii.sidebar.collapsed";

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy aria-label="Loading workspace">
      <div className="border-border bg-sidebar hidden w-[244px] border-r p-3 md:block">
        <Skeleton className="h-8 w-36" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-7 w-56" />
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Hotkeys() {
  const { can } = useAuth();
  const { openSheet, sheet, paletteOpen } = useGlobalUi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || sheet || paletteOpen) return;
      if (e.key.toLowerCase() === "n" && can("leads.create")) {
        e.preventDefault();
        openSheet({ kind: "lead" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [can, openSheet, sheet, paletteOpen]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, signOut, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Safe to read storage on first render: the shell body only renders client-side after auth resolves.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setMobileOpen(false);
  }

  // Defence in depth: a privileged session that never passed MFA is not allowed in.
  const mfaMissing =
    status === "authenticated" && requiresMfa(session?.user) && !session?.mfaSatisfied;
  useEffect(() => {
    if (mfaMissing) void signOut("user");
  }, [mfaMissing, signOut]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  useEffect(() => {
    const onExpired = () => void signOut("expired");
    window.addEventListener("zoii:unauthenticated", onExpired);
    return () => window.removeEventListener("zoii:unauthenticated", onExpired);
  }, [signOut]);

  if (status !== "authenticated" || mfaMissing) return <ShellSkeleton />;

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* not persisted */
      }
      return !c;
    });
  };

  return (
    <GlobalUiProvider>
      <BreadcrumbProvider>
        <div className="flex min-h-dvh">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
          <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <D.Portal>
              <D.Overlay className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0 z-50 md:hidden" />
              <D.Content
                className="border-border bg-sidebar data-[state=open]:animate-slide-in-left fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r shadow-lg outline-none md:hidden"
                aria-describedby={undefined}
              >
                <D.Title className="sr-only">Navigation</D.Title>
                <div className="border-border flex h-14 items-center justify-between border-b px-3">
                  <ZoiiWordmark />
                  <D.Close
                    className="text-fg-subtle hover:bg-surface-3 rounded-md p-1.5"
                    aria-label="Close navigation"
                  >
                    <X className="size-4" />
                  </D.Close>
                </div>
                <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </D.Content>
            </D.Portal>
          </D.Root>
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
            <main
              id="main"
              className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6"
            >
              {children}
            </main>
          </div>
        </div>
        <CommandPalette />
        <GlobalSheets />
        <Hotkeys />
      </BreadcrumbProvider>
    </GlobalUiProvider>
  );
}
