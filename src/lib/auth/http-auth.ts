import type { Session } from "@/lib/api/contracts";
import type { ApiErrorBody } from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";
import type { AuthAdapter } from "./adapter";

/** Production auth adapter: the backend sets/clears an httpOnly, Secure, SameSite cookie. */
export function createHttpAuthAdapter(baseUrl: string): AuthAdapter {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/v1/auth${path}`, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "zoii-web",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError({ code: "NETWORK", message: "Network request failed." });
    }
    if (res.status === 204) return undefined as T;
    const payload = (await res.json().catch(() => null)) as {
      data?: T;
      error?: ApiErrorBody;
    } | null;
    if (!res.ok)
      throw new ApiError(
        payload?.error ?? { code: "INTERNAL", message: `Request failed (${res.status}).` },
        res.status,
      );
    return payload?.data as T;
  }

  return {
    mode: "api",
    async getSession() {
      try {
        return await call<Session>("GET", "/session");
      } catch (e) {
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED") return null;
        throw e;
      }
    },
    signInWithPassword: (email, password) => call("POST", "/login", { email, password }),
    verifyMfa: (challengeId, code) => call("POST", "/mfa/verify", { challengeId, code }),
    requestPhoneOtp: (phone) => call("POST", "/otp/request", { phone }),
    verifyPhoneOtp: (challengeId, code) => call("POST", "/otp/verify", { challengeId, code }),
    requestPasswordReset: (email) => call("POST", "/password/forgot", { email }),
    signOut: () => call("POST", "/logout"),
  };
}
