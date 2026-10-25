"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { Building2, Laptop, Moon, Plus, Search, Sun, Target } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { getRuntime } from "@/lib/api";
import { visibleNav } from "@/lib/nav";
import { useAuth } from "@/features/auth/auth-provider";
import { useTheme } from "@/components/theme";
import { useGlobalUi } from "./global-ui";
import { NavIcon } from "./nav-icon";
import { Kbd } from "@/components/ui/misc";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const item =
  "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg aria-selected:bg-surface-3 data-[disabled=true]:opacity-45 [&_svg]:size-4 [&_svg]:text-fg-subtle";
const heading =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle";

export function CommandPalette() {
  const router = useRouter();
  const { can } = useAuth();
  const { setPreference } = useTheme();
  const { paletteOpen, setPaletteOpen, openSheet } = useGlobalUi();
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term.trim(), 200);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (wasOpen !== paletteOpen) {
    setWasOpen(paletteOpen);
    if (!paletteOpen) setTerm("");
  }

  const records = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => getRuntime().api.search.query(debounced),
    enabled: paletteOpen && debounced.length >= 2,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };
  const groups = visibleNav(can);

  return (
    <D.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <D.Portal>
        <D.Overlay className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0 z-50" />
        <D.Content
          className="border-border bg-surface data-[state=open]:animate-scale-in fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border shadow-lg outline-none"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <Command label="Command palette" shouldFilter loop>
            <div className="border-border flex items-center gap-2 border-b px-3.5">
              <Search className="text-fg-subtle size-4" />
              <Command.Input
                value={term}
                onValueChange={setTerm}
                placeholder="Search leads, clients, pages or actions…"
                className="placeholder:text-fg-subtle h-12 w-full bg-transparent text-sm outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] scrollbar-thin overflow-y-auto p-1.5">
              <Command.Empty className="text-fg-muted px-3 py-8 text-center text-[13px]">
                {records.isFetching ? "Searching…" : "No matches."}
              </Command.Empty>

              {(records.data?.length ?? 0) > 0 && (
                <Command.Group heading="Records" className={heading}>
                  {records.data!.map((r) => (
                    <Command.Item
                      key={`${r.type}-${r.id}`}
                      value={`${r.title} ${r.subtitle} ${r.id}`}
                      onSelect={() => go(r.href)}
                      className={item}
                    >
                      {r.type === "lead" ? <Target /> : <Building2 />}
                      <span className="truncate">{r.title}</span>
                      <span className="text-fg-subtle ml-auto truncate text-xs">{r.subtitle}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Create" className={heading}>
                {can("leads.create") && (
                  <Command.Item
                    value="create new lead"
                    onSelect={() => {
                      setPaletteOpen(false);
                      openSheet({ kind: "lead" });
                    }}
                    className={item}
                  >
                    <Plus /> New lead
                  </Command.Item>
                )}
                {can("clients.create") && (
                  <Command.Item
                    value="create new client"
                    onSelect={() => {
                      setPaletteOpen(false);
                      openSheet({ kind: "client" });
                    }}
                    className={item}
                  >
                    <Plus /> New client
                  </Command.Item>
                )}
              </Command.Group>

              {groups.map((g) => (
                <Command.Group key={g.title} heading={g.title} className={heading}>
                  {g.items.map((i) => (
                    <Command.Item
                      key={i.href}
                      value={`${i.title} ${g.title} ${(i.keywords ?? []).join(" ")}`}
                      onSelect={() => go(i.href)}
                      className={item}
                    >
                      <NavIcon name={i.icon} />
                      {i.title}
                      {i.status === "planned" && (
                        <span className="text-2xs text-fg-subtle ml-auto">
                          Planned · Sprint {i.sprint}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}

              <Command.Group heading="Preferences" className={heading}>
                <Command.Item
                  value="theme light"
                  onSelect={() => setPreference("light")}
                  className={item}
                >
                  <Sun /> Light theme
                </Command.Item>
                <Command.Item
                  value="theme dark"
                  onSelect={() => setPreference("dark")}
                  className={item}
                >
                  <Moon /> Dark theme
                </Command.Item>
                <Command.Item
                  value="theme system"
                  onSelect={() => setPreference("system")}
                  className={item}
                >
                  <Laptop /> Match system theme
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
