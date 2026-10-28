import type { ApiErrorBody } from "./contracts";
import { ApiError } from "./errors";
import { appConfig } from "@/lib/config/env";

/** Base URL of the backend, or null in demo mode. */
export const apiBase = (): string | null => (appConfig.ok && appConfig.mode === "api" ? appConfig.apiBaseUrl : null);

/** Absolute URL for links the browser opens directly (PDFs). The session cookie authenticates them. */
export function apiUrl(path: string): string {
  const base = apiBase();
  if (!base) throw new ApiError({ code: "CONFIG", message: "This needs the backend (NEXT_PUBLIC_DATA_MODE=api)." });
  return `${base}/api/v1${path}`;
}

/**
 * The one HTTP path to the backend. httpOnly session cookie (credentials: include), JSON
 * envelopes ({ data } / { error }), and the X-Requested-With header the API's CSRF check needs.
 */
export async function apiFetch<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, base = apiBase()): Promise<T> {
  if (!base) throw new ApiError({ code: "CONFIG", message: "This module needs the backend. Run with NEXT_PUBLIC_DATA_MODE=api." });
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-Requested-With": "zoii-web" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({ code: "NETWORK", message: "Network request failed." });
  }
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: ApiErrorBody } | null;
  if (!res.ok) {
    throw new ApiError(
      payload?.error ?? { code: res.status === 401 ? "UNAUTHENTICATED" : "INTERNAL", message: `Request failed (${res.status}).` },
      res.status,
    );
  }
  return payload?.data as T;
}

export function qs(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else if (typeof v === "object") p.set(k, JSON.stringify(v));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
