"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiBase, apiFetch } from "./request";
import { isApiError, userMessage } from "./errors";

/** GET a backend resource. Disabled automatically in demo mode (modules render RequiresBackend). */
export function useApi<T>(key: QueryKey, path: string | null, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: key,
    queryFn: () => apiFetch<T>("GET", path!),
    enabled: !!path && !!apiBase() && opts.enabled !== false,
    refetchInterval: opts.refetchInterval,
  });
}

export function errorText(e: unknown): string {
  if (isApiError(e) && e.code === "VALIDATION" && e.details) {
    const first = Object.entries(e.details)[0];
    return first ? `${e.message} ${first[0] !== "_" ? `${first[0]}: ` : ""}${first[1][0]}` : e.message;
  }
  return isApiError(e) && ["CONFLICT", "VALIDATION", "CONFIG", "FORBIDDEN"].includes(e.code) ? e.message : userMessage(e);
}

/**
 * A write to the backend. On success, invalidates the given query-key prefixes and toasts;
 * on failure, toasts the server's message (conflicts and rule violations are written for users).
 */
export function useApiMutation<TBody = unknown, TRes = unknown>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string | ((body: TBody) => string),
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TRes) => string); headers?: (body: TBody) => Record<string, string>; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => apiFetch<TRes>(method, typeof path === "function" ? path(body) : path, method === "DELETE" ? undefined : (body ?? {}), opts.headers?.(body)),
    onSuccess: (r) => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(errorText(e));
    },
  });
}
