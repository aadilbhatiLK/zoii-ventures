import { beforeEach, describe, expect, it } from "vitest";
import { createDemoApiClient } from "@/lib/mock/demo-adapter";
import { DEMO_USERS } from "@/lib/mock/seed";
import type { LeadInput, User } from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";

const user = (id: string) => DEMO_USERS.find((u) => u.id === id)!;
let current: User | null = null;
const as = (id: string | null) => (current = id ? user(id) : null);
let api: ReturnType<typeof createDemoApiClient>;

const input = (overrides: Partial<LeadInput> = {}): LeadInput => ({
  name: "Test Contact",
  company: "Unit Test Traders",
  phone: "+91 91111 22222",
  productInterest: ["pos"],
  source: "website",
  priority: "medium",
  estimatedValue: "50000",
  ownerId: current!.id,
  ...overrides,
});

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof ApiError ? e.code : "THROWN";
  }
}

beforeEach(() => {
  api = createDemoApiClient({
    getUser: () => current,
    latencyMs: 0,
    persist: false,
    now: () => new Date("2026-10-25T10:00:00+05:30"),
  });
  as(null);
});

describe("demo adapter enforces the same rules as the backend", () => {
  it("rejects unauthenticated calls", async () => {
    expect(await code(api.leads.list({}))).toBe("UNAUTHENTICATED");
  });

  it("scopes lists: executive sees only own leads, founder sees all", async () => {
    as("u_sales1");
    const mine = await api.leads.list({ view: "all", pageSize: 50 });
    expect(mine.items.every((l) => l.ownerId === "u_sales1")).toBe(true);
    as("u_founder");
    const all = await api.leads.list({ view: "all", pageSize: 50 });
    expect(all.total).toBe(72);
    expect(all.total).toBeGreaterThan(mine.total);
  });

  it("hides other owners' leads as NOT_FOUND (no existence leak)", async () => {
    as("u_founder");
    const other = (await api.leads.list({ view: "all", ownerId: ["u_sales2"], pageSize: 10 }))
      .items[0]!;
    as("u_sales1");
    expect(await code(api.leads.get(other.id))).toBe("NOT_FOUND");
    expect(await code(api.leads.changeStage(other.id, "contacted"))).toBe("NOT_FOUND");
  });

  it("finance and auditor cannot change leads; auditor can read", async () => {
    as("u_fin");
    expect(await code(api.leads.list({}))).toBe("FORBIDDEN");
    as("u_auditor");
    const lead = (await api.leads.list({ view: "all", pageSize: 10 })).items[0]!;
    expect(await code(api.leads.logActivity(lead.id, { type: "note", summary: "x y" }))).toBe(
      "FORBIDDEN",
    );
    expect(await code(api.leads.create(input({ ownerId: "u_auditor" })))).toBe("FORBIDDEN");
  });

  it("executive cannot assign a new lead to someone else", async () => {
    as("u_sales1");
    expect(await code(api.leads.create(input({ ownerId: "u_sales2" })))).toBe("FORBIDDEN");
    const ok = await api.leads.create(input());
    expect(ok.ownerId).toBe("u_sales1");
    expect(ok.stage).toBe("new");
  });

  it("validates input server-side", async () => {
    as("u_sales1");
    expect(await code(api.leads.create(input({ estimatedValue: "12.345" })))).toBe("VALIDATION");
  });

  it("requires a reason to mark a lead lost", async () => {
    as("u_sales1");
    const l = await api.leads.create(input());
    expect(await code(api.leads.changeStage(l.id, "lost"))).toBe("VALIDATION");
    const lost = await api.leads.changeStage(l.id, "lost", { lostReason: "Budget" });
    expect(lost.lostReason).toBe("Budget");
  });

  it("bulk assign is all-or-nothing and limited to the manager's team", async () => {
    as("u_salesmgr");
    const teamLeads = (await api.leads.list({ view: "all", pageSize: 10 })).items.map((l) => l.id);
    as("u_founder");
    const outsider = (await api.leads.list({ view: "all", ownerId: ["u_founder"], pageSize: 10 }))
      .items[0]!;
    as("u_salesmgr");
    const before = await Promise.all(
      teamLeads.map(async (id) => (await api.leads.get(id)).ownerId),
    );
    expect(await code(api.leads.assign([...teamLeads, outsider.id], "u_sales2"))).toBe("NOT_FOUND");
    const after = await Promise.all(teamLeads.map(async (id) => (await api.leads.get(id)).ownerId));
    expect(after).toEqual(before); // nothing changed when one id was rejected
    expect(await code(api.leads.assign(teamLeads, "u_founder"))).toBe("FORBIDDEN");
    const r = await api.leads.assign(teamLeads, "u_sales2");
    expect(r.updated).toBeGreaterThanOrEqual(0);
  });

  it("converts a lead into a client in one step and audits both", async () => {
    as("u_sales1");
    const l = await api.leads.create(input({ company: "Convert Me Pvt Ltd" }));
    const { lead, client } = await api.leads.convert(l.id, {
      clientName: "Convert Me",
      legalName: "Convert Me Pvt Ltd",
      industry: "Retail",
      category: "smb",
      accountManagerId: "u_am",
    });
    expect(lead.stage).toBe("won");
    expect(lead.clientId).toBe(client.id);
    expect(client.sourceLeadId).toBe(l.id);
    expect(
      await code(
        api.leads.convert(l.id, {
          clientName: "x y",
          legalName: "x y",
          industry: "x y",
          category: "smb",
          accountManagerId: "u_am",
        }),
      ),
    ).toBe("CONFLICT");
    const actions = api.__audit().map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["lead.create", "lead.convert", "client.create"]),
    );
    const tl = await api.clients.timeline(client.id);
    expect(tl.some((a) => a.entityType === "lead")).toBe(true);
  });

  it("duplicate check reveals visible matches and only counts hidden ones", async () => {
    as("u_founder");
    const other = (await api.leads.list({ view: "all", ownerId: ["u_sales2"], pageSize: 10 }))
      .items[0]!;
    as("u_sales1");
    const r = await api.leads.findDuplicates({ phone: other.phone });
    expect(r.matches).toHaveLength(0);
    expect(r.hiddenMatchCount).toBeGreaterThan(0);
  });

  it("rejects invalid list queries with a typed validation error", async () => {
    as("u_founder");
    expect(await code(api.leads.list({ pageSize: 7 as 10 }))).toBe("VALIDATION");
  });

  it("paginates and sorts on the server", async () => {
    as("u_founder");
    const p1 = await api.leads.list({
      view: "all",
      page: 1,
      pageSize: 10,
      sort: { field: "estimatedValue", dir: "desc" },
    });
    const p2 = await api.leads.list({
      view: "all",
      page: 2,
      pageSize: 10,
      sort: { field: "estimatedValue", dir: "desc" },
    });
    expect(p1.items).toHaveLength(10);
    expect(Number(p1.items[9]!.estimatedValue)).toBeGreaterThanOrEqual(
      Number(p2.items[0]!.estimatedValue),
    );
  });

  it("rejects duplicate client GSTINs", async () => {
    as("u_founder");
    const base = {
      name: "GST One",
      legalName: "GST One LLP",
      industry: "Retail",
      category: "smb" as const,
      status: "active" as const,
      accountManagerId: "u_am",
      gstin: "08AAOCP3812A1ZN",
      billingAddress: { line1: "1 Road", city: "Bikaner", state: "Rajasthan", pincode: "334001" },
      productLines: [],
      primaryContact: { name: "A B", phone: "9829012345" },
    };
    await api.clients.create(base);
    expect(await code(api.clients.create({ ...base, name: "GST Two" }))).toBe("CONFLICT");
  });

  it("dashboard revenue fixture is only for company-metric roles and is labelled", async () => {
    as("u_sales1");
    const own = await api.dashboard.summary();
    expect(own.scope).toBe("own");
    expect(own.revenueSeries).toBeNull();
    as("u_founder");
    const co = await api.dashboard.summary();
    expect(co.dataOrigin).toBe("demo");
    expect(co.revenueSeries?.origin).toBe("fixture");
  });
});
