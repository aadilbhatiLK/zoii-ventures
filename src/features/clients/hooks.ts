"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRuntime } from "@/lib/api";
import type { ClientInput, ClientListQuery } from "@/lib/api/contracts";

const api = () => getRuntime().api;

export function useClientList(q: ClientListQuery) {
  return useQuery({
    queryKey: ["clients", "list", q],
    queryFn: () => api().clients.list(q),
    placeholderData: keepPreviousData,
  });
}
export function useClient(id: string) {
  return useQuery({
    queryKey: ["client", id],
    queryFn: () => api().clients.get(id),
    enabled: !!id,
  });
}
export function useClientTimeline(id: string) {
  return useQuery({
    queryKey: ["client", id, "timeline"],
    queryFn: () => api().clients.timeline(id),
    enabled: !!id,
  });
}
export function useSaveClient(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientInput) =>
      id ? api().clients.update(id, input) : api().clients.create(input),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["client", c.id] });
    },
  });
}
