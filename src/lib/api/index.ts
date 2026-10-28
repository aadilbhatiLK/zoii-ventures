import { appConfig } from "@/lib/config/env";
import type { User } from "./contracts";
import type { ApiClient } from "./client";
import type { AuthAdapter } from "@/lib/auth/adapter";
import { createHttpApiClient } from "./http-adapter";
import { createHttpAuthAdapter } from "@/lib/auth/http-auth";
import { createDemoApiClient } from "@/lib/mock/demo-adapter";
import { createDemoAuthAdapter } from "@/lib/auth/demo-auth";

export interface Runtime {
  api: ApiClient;
  auth: AuthAdapter;
  /** Lets the auth layer tell the demo adapter who is calling. No-op in api mode. */
  setPrincipal(user: User | null): void;
}

let runtime: Runtime | null = null;

/**
 * Builds the runtime for the configured mode. Throws when configuration is invalid —
 * the root ConfigGate renders that error instead of the app (never a silent fallback).
 */
export function getRuntime(): Runtime {
  if (runtime) return runtime;
  if (!appConfig.ok) throw new Error(appConfig.error);
  if (appConfig.mode === "api") {
    const base = appConfig.apiBaseUrl!;
    runtime = {
      api: createHttpApiClient(base),
      auth: createHttpAuthAdapter(base),
      setPrincipal: () => {},
    };
  } else {
    let principal: User | null = null;
    runtime = {
      api: createDemoApiClient({ getUser: () => principal }),
      auth: createDemoAuthAdapter(),
      setPrincipal: (u) => {
        principal = u;
      },
    };
  }
  return runtime;
}
