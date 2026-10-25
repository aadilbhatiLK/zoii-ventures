import type { ApiClient } from "./client";
import type { ApiErrorBody } from "./contracts";
import { ApiError } from "./errors";

/**
 * Real backend adapter. Authentication uses an httpOnly session cookie set by the
 * backend (credentials: "include"); no tokens are stored in browser storage.
 * State-changing requests send X-Requested-With for the backend's CSRF check.
 */
export function createHttpApiClient(baseUrl: string): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/v1${path}`, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(method !== "GET" ? { "X-Requested-With": "zoii-web" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError({ code: "NETWORK", message: "Network request failed." });
    }
    if (res.status === 204) return undefined as T;
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const errBody = (payload as { error?: ApiErrorBody } | null)?.error;
      throw new ApiError(
        errBody ?? {
          code: res.status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
          message: `Request failed (${res.status}).`,
        },
        res.status,
      );
    }
    return (payload as { data: T }).data;
  }

  const qs = (q: object) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)));
      else if (typeof v === "object") params.set(k, JSON.stringify(v));
      else params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  return {
    mode: "api",
    leads: {
      list: (q) => request("GET", `/leads${qs(q)}`),
      get: (id) => request("GET", `/leads/${encodeURIComponent(id)}`),
      create: (input) => request("POST", "/leads", input),
      update: (id, input) => request("PATCH", `/leads/${encodeURIComponent(id)}`, input),
      assign: (ids, ownerId) => request("POST", "/leads/assign", { ids, ownerId }),
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
