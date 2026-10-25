import type { ApiErrorCode } from "@/lib/api/contracts";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409,
  RATE_LIMITED: 429, INTERNAL: 500, NETWORK: 503, CONFIG: 503,
};

export class HttpError extends Error {
  readonly status: number;
  constructor(readonly code: ApiErrorCode, message: string, readonly details?: Record<string, string[]>) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Record") => new HttpError("NOT_FOUND", `${what} not found.`);
export const forbidden = (msg = "You don't have permission to do that.") => new HttpError("FORBIDDEN", msg);
export const conflict = (msg: string) => new HttpError("CONFLICT", msg);
export const invalid = (msg: string, details?: Record<string, string[]>) => new HttpError("VALIDATION", msg, details);

interface ZodLikeIssue { path: PropertyKey[]; message: string }
export function fromZodIssues(issues: readonly ZodLikeIssue[]): HttpError {
  const details: Record<string, string[]> = {};
  for (const i of issues) (details[i.path.map(String).join(".") || "_"] ??= []).push(i.message);
  return new HttpError("VALIDATION", "Some fields need attention.", details);
}

interface Parser<T> { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: readonly ZodLikeIssue[] } } }
/** Validates with a zod schema from either zod copy (frontend contracts or backend). */
export function parse<T>(schema: Parser<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw fromZodIssues(r.error.issues);
  return r.data;
}

/** Postgres error → API error for constraint violations the service didn't pre-check. */
export function mapPgError(e: unknown): HttpError | null {
  const code = (e as { code?: string })?.code;
  const constraint = (e as { constraint?: string })?.constraint ?? "";
  if (code === "23505") return conflict(`That value is already in use${constraint ? ` (${constraint})` : ""}.`);
  if (code === "23503") return invalid("A referenced record does not exist.");
  if (code === "23514") return invalid(`The change breaks a data rule${constraint ? ` (${constraint})` : ""}.`);
  if (code === "40001" || code === "40P01") return conflict("Another change happened at the same time. Retry.");
  if (code === "42501" || code === "P0001") return conflict((e as Error).message);
  return null;
}
