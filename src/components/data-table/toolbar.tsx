"use client";

import { useEffect, useRef, useState } from "react";
import type { Table, VisibilityState } from "@tanstack/react-table";
import { Check, Columns3, PlusCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/menu";
import { inputBase } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const [synced, setSynced] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  // Adopt external resets (e.g. "Reset filters") without an effect.
  if (value !== synced) {
    setSynced(value);
    setLocal(value);
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 250);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={cn("relative", className)}>
      <Search
        className="text-fg-subtle pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(inputBase, "h-8 pl-8 text-[13px]")}
      />
    </div>
  );
}

export interface FacetOption<V extends string> {
  value: V;
  label: string;
  icon?: React.ReactNode;
}

export function FacetFilter<V extends string>({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FacetOption<V>[];
  selected: V[];
  onChange: (v: V[]) => void;
}) {
  const toggle = (v: V) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn("border-dashed", selected.length > 0 && "border-solid")}
        >
          <PlusCircle className="!size-3.5" />
          {title}
          {selected.length > 0 && (
            <>
              <span className="bg-border mx-0.5 h-4 w-px" />
              <Badge tone="accent">
                {selected.length === 1
                  ? options.find((o) => o.value === selected[0])?.label
                  : `${selected.length} selected`}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1">
        <div
          role="listbox"
          aria-multiselectable
          aria-label={title}
          className="max-h-72 scrollbar-thin overflow-y-auto"
        >
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="hover:bg-surface-3 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]"
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-[4px] border",
                    on ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                {o.icon}
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="border-border border-t p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="hover:bg-surface-3 h-8 w-full rounded-md text-center text-[13px]"
            >
              Clear filter
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ResetFilters({ show, onReset }: { show: boolean; onReset: () => void }) {
  if (!show) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onReset}>
      Reset <X />
    </Button>
  );
}

export function ColumnToggle({
  columns,
  visibility,
  onChange,
}: {
  columns: { id: string; label: string }[];
  visibility: VisibilityState;
  onChange: (v: VisibilityState) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label="Choose columns">
          <Columns3 /> <span className="hidden lg:inline">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={visibility[c.id] !== false}
            onCheckedChange={(v) => onChange({ ...visibility, [c.id]: !!v })}
            onSelect={(e) => e.preventDefault()}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { Table };
