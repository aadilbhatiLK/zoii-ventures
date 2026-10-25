"use client";

import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { getRuntime } from "@/lib/api";
import type {
  ConvertLeadInput,
  LeadInput,
  LeadListQuery,
  LeadStage,
  LogActivityInput,
  PublicUser,
} from "@/lib/api/contracts";

const api = () => getRuntime().api;

export const leadKeys = {
  all: ["leads"] as const,
  list: (q: LeadListQuery) => ["leads", "list", q] as const,
  detail: (id: string) => ["lead", id] as const,
  activities: (id: string) => ["lead", id, "activities"] as const,
};

export function useLeadList(query: LeadListQuery) {
  return useQuery({
    queryKey: leadKeys.list(query),
    queryFn: () => api().leads.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: leadKeys.detail(id),
    queryFn: () => api().leads.get(id),
    enabled: !!id,
  });
}

export function useLeadActivities(id: string) {
  return useQuery({
    queryKey: leadKeys.activities(id),
    queryFn: () => api().leads.activities(id),
    enabled: !!id,
  });
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ["users", "assignable"],
    queryFn: () => api().users.assignable(),
    staleTime: 5 * 60_000,
  });
}

export function useUserDirectory() {
  const q = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => api().users.directory(),
    staleTime: 5 * 60_000,
  });
  const byId = new Map<string, PublicUser>((q.data ?? []).map((u) => [u.id, u]));
  return { ...q, byId };
}

function useInvalidate() {
  const qc = useQueryClient();
  return (leadId?: string) => {
    void qc.invalidateQueries({ queryKey: leadKeys.all });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    if (leadId) void qc.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
  };
}

export function useCreateLead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: LeadInput) => api().leads.create(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateLead(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: LeadInput) => api().leads.update(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useAssignLeads() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ ids, ownerId }: { ids: string[]; ownerId: string }) =>
      api().leads.assign(ids, ownerId),
    onSuccess: (_, v) => {
      invalidate();
      v.ids.forEach((id) => invalidate(id));
    },
  });
}

export function useChangeStage() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      stage,
      lostReason,
    }: {
      id: string;
      stage: LeadStage;
      lostReason?: string;
    }) => api().leads.changeStage(id, stage, { lostReason }),
    onSuccess: (lead) => invalidate(lead.id),
  });
}

export function useBulkChangeStage() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ ids, stage }: { ids: string[]; stage: LeadStage }) =>
      api().leads.bulkChangeStage(ids, stage),
    onSuccess: (_, v) => {
      invalidate();
      v.ids.forEach((id) => invalidate(id));
    },
  });
}

export function useLogActivity(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: LogActivityInput) => api().leads.logActivity(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useScheduleFollowUp(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ at, note }: { at: string; note?: string }) =>
      api().leads.scheduleFollowUp(id, at, note),
    onSuccess: () => invalidate(id),
  });
}

export function useCompleteFollowUp() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, outcome, nextAt }: { id: string; outcome: string; nextAt: string | null }) =>
      api().leads.completeFollowUp(id, outcome, nextAt),
    onSuccess: (lead) => invalidate(lead.id),
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ConvertLeadInput) => api().leads.convert(id, input),
    onSuccess: () => {
      invalidate(id);
      void qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}
