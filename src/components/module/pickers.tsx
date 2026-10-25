"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Input, inputBase } from "@/components/ui/input";
import { useUserDirectory } from "@/features/leads/hooks";
import { useApi } from "@/lib/api/hooks";
import { apiFetch, qs } from "@/lib/api/request";
import type { Client, Paginated } from "@/lib/api/contracts";
import type { Account } from "@/lib/api/modules/finance";
import type { Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./kit";

/** Search-as-you-type client chooser (the clients API pages at 50, so pickers search). */
export function ClientPicker({ value, onChange, id, invalid, label }: { value: string | null; onChange: (id: string, c: Client) => void; id?: string; invalid?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const list = useQuery({
    queryKey: ["clients", "picker", term],
    queryFn: () => apiFetch<Paginated<Client>>("GET", `/clients${qs({ search: term || undefined, pageSize: 10 })}`),
    enabled: open,
  });
  const current = useQuery({
    queryKey: ["client", value],
    queryFn: () => apiFetch<Client>("GET", `/clients/${value}`),
    enabled: !!value,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id={id} type="button" aria-label={label ?? "Client"} className={cn(inputBase, "flex h-9 items-center justify-between text-left", invalid && "border-danger")}>
          <span className={cn("truncate", !value && "text-fg-subtle")}>{value ? (current.data?.name ?? "Loading…") : "Choose a client"}</span>
          <ChevronsUpDown className="text-fg-subtle size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-2" align="start">
        <Input autoFocus placeholder="Search clients…" value={term} onChange={(e) => setTerm(e.target.value)} className="mb-2 h-8" />
        <ul role="listbox" className="max-h-64 overflow-y-auto">
          {list.data?.items.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={c.id === value} onClick={() => { onChange(c.id, c); setOpen(false); }} className="hover:bg-surface-3 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px]">
                <Check className={cn("size-3.5", c.id === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-fg-subtle text-xs">{c.code} · {c.billingAddress.state || "state?"}</span>
              </button>
            </li>
          ))}
          {list.isFetched && !list.data?.items.length && <li className="text-fg-muted px-2 py-3 text-center text-xs">No clients match.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function UserSelect({ value, onChange, id, roles, allowEmpty, emptyLabel = "Unassigned" }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; roles?: Role[]; allowEmpty?: boolean; emptyLabel?: string }) {
  const dir = useUserDirectory();
  const users = (dir.data ?? []).filter((u) => !roles || u.roles.some((r) => roles.includes(r)));
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {(allowEmpty || !value) && <option value="">{allowEmpty ? emptyLabel : "Choose…"}</option>}
      {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.title}</option>)}
    </NativeSelect>
  );
}

export function UserName({ id, fallback = "—" }: { id: string | null | undefined; fallback?: string }) {
  const dir = useUserDirectory();
  if (!id) return <>{fallback}</>;
  return <>{dir.data?.find((u) => u.id === id)?.name ?? "…"}</>;
}

export function useAccounts() {
  return useApi<Account[]>(["finance", "accounts"], "/finance/accounts");
}

export function AccountSelect({ value, onChange, id, filter, placeholder = "Choose an account" }: { value: string; onChange: (v: string) => void; id?: string; filter?: (a: Account) => boolean; placeholder?: string }) {
  const acc = useAccounts();
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {(acc.data ?? []).filter((a) => a.active && (!filter || filter(a))).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
    </NativeSelect>
  );
}
