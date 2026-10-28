/** Frontend regression tests for the stabilization fixes (audit of 2026-10-27). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

import { APPROVAL_INVALIDATES } from "@/features/sales/approvals-view";
import { NonSalesDashboard } from "@/features/dashboard/dashboard-view";
import { AuthProvider } from "@/features/auth/auth-provider";
import { TooltipProvider } from "@/components/ui/menu";
import type { DashboardSummary } from "@/lib/api/contracts";

describe("approval decisions refresh the lists they change", () => {
  it("leave, balances, documents, projects and the ledger are invalidated", async () => {
    const qc = new QueryClient();
    // Keys exactly as the pages cache them (attendance.tsx, documents, projects, ledger).
    const pages = [["hr", "leave", "pending"], ["hr", "leave", "mine"], ["hr", "balances", "me"], ["documents"], ["document", "d1"], ["projects"], ["project", "p1"], ["finance", "journals"], ["payroll", "runs"]];
    for (const k of pages) qc.setQueryData(k, { v: 1 });
    for (const k of APPROVAL_INVALIDATES) await qc.invalidateQueries({ queryKey: k });
    for (const k of pages) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
  });
});

describe("dashboard labels", () => {
  const summary = (origin: "fixture" | "ledger") => ({
    revenueSeries: { origin, points: [{ month: "2026-09", invoiced: "100", collected: "50" }] },
  }) as unknown as DashboardSummary;
  const wrap = (ui: React.ReactNode) =>
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><TooltipProvider>{ui}</TooltipProvider></AuthProvider></QueryClientProvider>);

  it("real ledger data isn't labelled as a demo fixture", async () => {
    wrap(<NonSalesDashboard summary={summary("ledger")} />);
    expect(await screen.findByText("From the ledger")).toBeInTheDocument();
    expect(screen.queryByText("Demo fixture")).not.toBeInTheDocument();
  });
  it("fixture data still says so", async () => {
    wrap(<NonSalesDashboard summary={summary("fixture")} />);
    expect(await screen.findByText("Demo fixture")).toBeInTheDocument();
  });
  it("points at live modules instead of promising a sprint", async () => {
    wrap(<NonSalesDashboard summary={summary("ledger")} />);
    expect(screen.queryByText(/arrives in Sprint/)).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "My tasks" })).toHaveAttribute("href", "/tasks");
  });
});

describe("no stale roadmap text on built modules", () => {
  it("no screen promises a sprint", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && /(arrives (in|with)|Sprint \d)/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(join(process.cwd(), "src", "features"));
    walk(join(process.cwd(), "src", "components", "layout"));
    expect(hits).toEqual([]);
  });
});

describe("web-tier proxy for /api/v1", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.resetModules(); });
  const SECRET = "test-signing-secret-0123456789-abcdef";
  const request = async (headers: Record<string, string> = {}) => {
    const { NextRequest } = await import("next/server");
    return new NextRequest("https://zoii-business-os.vercel.app/api/v1/leads?page=2", { headers });
  };

  it("does nothing unless API_PROXY_ORIGIN is set", async () => {
    delete process.env.API_PROXY_ORIGIN;
    const { proxy } = await import("@/proxy");
    const res = proxy(await request());
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("rewrites to the API with a signed client IP the API accepts, dropping any client-sent value", async () => {
    process.env.API_PROXY_ORIGIN = "https://api.example.test";
    process.env.CLIENT_IP_SIGNING_SECRET = SECRET;
    const { proxy } = await import("@/proxy");
    const res = proxy(await request({ "x-real-ip": "203.0.113.5", "x-zoii-client-ip": "6.6.6.6;0;forged" }));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://api.example.test/api/v1/leads?page=2");
    const signed = res.headers.get("x-middleware-request-x-zoii-client-ip")!;
    expect(signed.startsWith("203.0.113.5;")).toBe(true);
    const { verifyClientIp } = await import("../../backend/src/lib/client-ip");
    expect(verifyClientIp(SECRET, signed, Math.floor(Date.now() / 1000))).toBe("203.0.113.5");
  });
});

describe("MFA policy", () => {
  it("accountants need MFA, like the rest of finance", async () => {
    const { requiresMfa } = await import("@/lib/permissions");
    expect(requiresMfa({ roles: ["accountant"] })).toBe(true);
    expect(requiresMfa({ roles: ["sales_executive"] })).toBe(false);
  });
});
