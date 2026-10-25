/**
 * Runtime configuration guard.
 *
 * The app can talk to the in-browser demo adapter ("demo") or a real backend ("api").
 * Rules (see docs/deployment.md):
 *  - development: defaults to demo when unset.
 *  - production: the mode MUST be set explicitly; demo additionally requires
 *    NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION === "true". Anything else is a hard
 *    configuration error — the app never silently falls back to demo data.
 *  - api mode requires an absolute URL, https in production.
 */
export type DataMode = "demo" | "api";

export type AppConfig =
  | {
      ok: true;
      mode: DataMode;
      apiBaseUrl: string | null;
      isProduction: boolean;
      /** True when demo data is being served by a production build (preview/review). */
      demoInProduction: boolean;
    }
  | { ok: false; error: string };

export interface RawEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_DATA_MODE?: string;
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION?: string;
}

export function resolveAppConfig(env: RawEnv): AppConfig {
  const isProduction = env.NODE_ENV === "production";
  const rawMode = (env.NEXT_PUBLIC_DATA_MODE ?? "").trim();

  let mode: DataMode;
  if (rawMode === "") {
    if (isProduction) {
      return {
        ok: false,
        error:
          "NEXT_PUBLIC_DATA_MODE is not set. Production builds must declare 'api' (or 'demo' with NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true).",
      };
    }
    mode = "demo";
  } else if (rawMode === "demo" || rawMode === "api") {
    mode = rawMode;
  } else {
    return {
      ok: false,
      error: `NEXT_PUBLIC_DATA_MODE has an invalid value "${rawMode}". Use "demo" or "api".`,
    };
  }

  if (mode === "demo") {
    if (isProduction && env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION !== "true") {
      return {
        ok: false,
        error:
          "Demo mode is blocked in production. Set NEXT_PUBLIC_DATA_MODE=api, or set NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true for a labelled review build.",
      };
    }
    return { ok: true, mode, apiBaseUrl: null, isProduction, demoInProduction: isProduction };
  }

  const rawUrl = (env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
  if (!rawUrl) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_API_BASE_URL is required when NEXT_PUBLIC_DATA_MODE=api.",
    };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "NEXT_PUBLIC_API_BASE_URL is not a valid absolute URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "NEXT_PUBLIC_API_BASE_URL must use http(s)." };
  }
  if (isProduction && url.protocol !== "https:") {
    return { ok: false, error: "NEXT_PUBLIC_API_BASE_URL must use https in production." };
  }
  return {
    ok: true,
    mode,
    apiBaseUrl: url.origin + url.pathname.replace(/\/+$/, ""),
    isProduction,
    demoInProduction: false,
  };
}

// NEXT_PUBLIC_* must be referenced literally so Next.js can inline them at build time.
export const appConfig: AppConfig = resolveAppConfig({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_DATA_MODE: process.env.NEXT_PUBLIC_DATA_MODE,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION: process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION,
});
