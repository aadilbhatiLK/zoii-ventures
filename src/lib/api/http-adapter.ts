import type { ApiClient } from "./client";
import { apiFetch, qs as buildQs } from "./request";

/**
 * Real backend adapter. Authentication uses an httpOnly session cookie set by the
 * backend (credentials: "include"); no tokens are stored in browser storage.
 * State-changing requests send X-Requested-With for the backend's CSRF check.
 */
export function createHttpApiClient(baseUrl: string): ApiClient {
  const request = <T,>(method: string, path: string, body?: unknown) => apiFetch<T>(method, path, body, {}, baseUrl);
  const qs = (q: object) => buildQs(q as Record<string, unknown>);

  return {
    mode: "api",
    leads: {
      list: (q) => request("GET", `/leads${qs(q)}`),
      get: (id) => request("GET", `/leads/${encodeURIComponent(id)}`),
      create: (input) => request("POST", "/leads", input),
      update: (id, input) => request("PATCH", `/leads/${encodeURIComponent(id)}`, input),
      assign: (ids, ownerId) => request("POST", "/leads/assign", { ids, ownerId }),
      bulkChangeStage: (ids, stage) => request("POST", "/leads/stage", { ids, stage }),
      export: (q) => request("POST", "/leads/export", q),
      changeStage: (id, stage, opts) =>
        request("POST", `/leads/${encodeURIComponent(id)}/stage`, { stage, ...opts }),
      findDuplicates: (input, excludeId) =>
        request("POST", "/leads/duplicates", { ...input, excludeId }),
      activities: (id) => request("GET", `/leads/${encodeURIComponent(id)}/activities`),
      logActivity: (id, input) =>
        request("POST", `/leads/${encodeURIComponent(id)}/activities`, input),
      scheduleFollowUp: (id, at, note) =>
        request("POST", `/leads/${encodeURIComponent(id)}/follow-ups`, { at, note }),
      completeFollowUp: (id, outcome, nextAt) =>
        request("POST", `/leads/${encodeURIComponent(id)}/follow-ups/complete`, {
          outcome,
          nextAt,
        }),
      convert: (id, input) => request("POST", `/leads/${encodeURIComponent(id)}/convert`, input),
    },
    clients: {
      list: (q) => request("GET", `/clients${qs(q)}`),
      get: (id) => request("GET", `/clients/${encodeURIComponent(id)}`),
      create: (input) => request("POST", "/clients", input),
      update: (id, input) => request("PATCH", `/clients/${encodeURIComponent(id)}`, input),
      timeline: (id) => request("GET", `/clients/${encodeURIComponent(id)}/timeline`),
    },
    users: {
      assignable: () => request("GET", "/users/assignable"),
      directory: () => request("GET", "/users"),
    },
    dashboard: { summary: () => request("GET", "/dashboard/summary") },
    search: { query: (term) => request("GET", `/search${qs({ q: term })}`) },
    notifications: {
      list: () => request("GET", "/notifications"),
      markRead: (ids) => request("POST", "/notifications/read", { ids }),
    },
  };
}
