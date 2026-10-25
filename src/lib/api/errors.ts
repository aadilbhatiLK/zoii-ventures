import type { ZodError } from "zod";
import type { ApiErrorBody, ApiErrorCode } from "./contracts";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, string[]>;
  readonly requestId?: string;
  readonly status?: number;

  constructor(body: ApiErrorBody, status?: number) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
    this.status = status;
  }

  static fromZod(error: ZodError): ApiError {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (details[key] ??= []).push(issue.message);
    }
    return new ApiError(
      { code: "VALIDATION", message: "Some fields need attention.", details },
      422,
    );
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Message safe to show to a user for any thrown value. */
export function userMessage(e: unknown): string {
  if (isApiError(e)) {
    switch (e.code) {
      case "UNAUTHENTICATED":
        return "Your session has ended. Please sign in again.";
      case "FORBIDDEN":
        return "You don't have permission to do that.";
      case "NOT_FOUND":
        return "That record doesn't exist or you don't have access to it.";
      case "NETWORK":
        return "Can't reach the server. Check your connection and retry.";
      case "RATE_LIMITED":
        return "Too many attempts. Please wait a moment and try again.";
      default:
        return e.message;
    }
  }
  return "Something went wrong. Please retry.";
}
