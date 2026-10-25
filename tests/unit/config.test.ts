import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "@/lib/config/env";

describe("resolveAppConfig — never silently falls back to demo data", () => {
  it("defaults to demo in development", () => {
    const c = resolveAppConfig({ NODE_ENV: "development" });
    expect(c).toMatchObject({ ok: true, mode: "demo", demoInProduction: false });
  });
  it("refuses production without an explicit mode", () => {
    expect(resolveAppConfig({ NODE_ENV: "production" }).ok).toBe(false);
  });
  it("blocks demo in production unless the latch is exactly 'true'", () => {
    expect(resolveAppConfig({ NODE_ENV: "production", NEXT_PUBLIC_DATA_MODE: "demo" }).ok).toBe(
      false,
    );
    expect(
      resolveAppConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_DATA_MODE: "demo",
        NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION: "1",
      }).ok,
    ).toBe(false);
    expect(
      resolveAppConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_DATA_MODE: "demo",
        NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION: "true",
      }),
    ).toMatchObject({ ok: true, demoInProduction: true });
  });
  it("requires an https API URL in production", () => {
    expect(resolveAppConfig({ NODE_ENV: "production", NEXT_PUBLIC_DATA_MODE: "api" }).ok).toBe(
      false,
    );
    expect(
      resolveAppConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_DATA_MODE: "api",
        NEXT_PUBLIC_API_BASE_URL: "http://api.zoii.in",
      }).ok,
    ).toBe(false);
    expect(
      resolveAppConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_DATA_MODE: "api",
        NEXT_PUBLIC_API_BASE_URL: "https://api.zoii.in/",
      }),
    ).toMatchObject({ ok: true, mode: "api", apiBaseUrl: "https://api.zoii.in" });
  });
  it("rejects unknown modes and malformed URLs", () => {
    expect(resolveAppConfig({ NODE_ENV: "development", NEXT_PUBLIC_DATA_MODE: "mock" }).ok).toBe(
      false,
    );
    expect(
      resolveAppConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_DATA_MODE: "api",
        NEXT_PUBLIC_API_BASE_URL: "not a url",
      }).ok,
    ).toBe(false);
    expect(
      resolveAppConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_DATA_MODE: "api",
        NEXT_PUBLIC_API_BASE_URL: "javascript:alert(1)",
      }).ok,
    ).toBe(false);
  });
});
