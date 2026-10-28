/**
 * Regression tests for the independent security/correctness review (Sprint 1).
 * Each test names the finding it pins down.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoApiClient } from "@/lib/mock/demo-adapter";
import { createDemoAuthAdapter } from "@/lib/auth/demo-auth";
import { DEMO_OTP, DEMO_PASSWORD, DEMO_USERS } from "@/lib/mock/seed";
import { safeNextPath } from "@/features/auth/safe-next";
import { ClientInputSchema, type LeadInput, type User } from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ApiError ? e.code : `THROWN:${(e as Error).name}`),
  );
let current: User | null = null;
const as = (id: string) => (current = DEMO_USERS.find((u) => u.id === id)!);
let api: ReturnType<typeof createDemoApiClient>;
beforeEach(() => {
  api = createDemoApiClient({
    getUser: () => current,
    latencyMs: 0,
    persist: false,
    now: () => new Date("2026-10-25T10:00:00+05:30"),
  });
  current = null;
});
const input = (o: Partial<LeadInput> = {}): LeadInput => ({
  name: "Review Test",
  company: "Review Traders",
  phone: "+91 92222 33333",
  productInterest: ["pos"],
  source: "website",
  priority: "medium",
  estimatedValue: "40000",
  ownerId: current!.id,
  ...o,
});

describe("#1 MFA cannot be bypassed", () => {
  it("phone OTP for a privileged role still requires MFA", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    const c = await auth.requestPhoneOtp("90000 00001"); // founder
    const r = await auth.verifyPhoneOtp(c.challengeId, DEMO_OTP);
    expect(r.status).toBe("mfa_required");
    expect(await auth.getSession()).toBeNull();
  });
  it("non-privileged OTP sign-in completes directly", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    const c = await auth.requestPhoneOtp("90000 00004");
    expect((await auth.verifyPhoneOtp(c.challengeId, DEMO_OTP)).status).toBe("ok");
  });
});

describe("#2 open redirect", () => {
  it.each([
    "/%09/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\\evil.com",
    "//evil.com",
    "/ /../..//evil.com",
  ])("rejects %j", (raw) => {
    const out = safeNextPath(raw.includes("%") ? decodeURIComponent(raw) : raw);
    expect(new URL(out, "https://app.zoii.in").origin).toBe("https://app.zoii.in");
  });
  it("keeps normal paths with query and hash", () => {
    expect(safeNextPath("/leads/lead_001?tab=activity#x")).toBe("/leads/lead_001?tab=activity#x");
  });
});

describe("#3 won only through conversion", () => {
  it("rejects moving a lead to won directly and validates stage values", async () => {
    as("u_sales1");
    const l = await api.leads.create(input());
    expect(await codeOf(api.leads.changeStage(l.id, "won"))).toBe("CONFLICT");
    expect(await codeOf(api.leads.changeStage(l.id, "bogus" as "new"))).toBe("VALIDATION");
  });
  it("every seeded won lead has a client", async () => {
    as("u_founder");
    const won = await api.leads.list({ view: "all", stage: ["won"], pageSize: 50 });
    expect(won.items.length).toBeGreaterThan(0);
    expect(won.items.every((l) => l.clientId && l.closedAt)).toBe(true);
  });
});

describe("#4/#5 no leakage to unrelated roles", () => {
  it("duplicate check requires lead write permission", async () => {
    as("u_hr");
    expect(await codeOf(api.leads.findDuplicates({ phone: "9000000004" }))).toBe("FORBIDDEN");
  });
  it("directory exposes public profile fields only", async () => {
    as("u_hr");
    const dir = await api.users.directory();
    for (const u of dir) {
      expect(u).not.toHaveProperty("email");
      expect(u).not.toHaveProperty("phone");
      expect(u).not.toHaveProperty("mfaEnrolled");
    }
  });
});

describe("#6 closed leads and date validation", () => {
  it("completeFollowUp on a closed lead with a next date is rejected; bad dates are VALIDATION", async () => {
    as("u_sales1");
    const l = await api.leads.create(input());
    expect(await codeOf(api.leads.completeFollowUp(l.id, "Spoke", "not-a-date"))).toBe(
      "VALIDATION",
    );
    await api.leads.changeStage(l.id, "lost", { lostReason: "Budget" });
    expect(
      await codeOf(api.leads.completeFollowUp(l.id, "Spoke", "2026-11-01T10:00:00.000Z")),
    ).toBe("CONFLICT");
    expect(
      await codeOf(api.leads.update(l.id, input({ nextFollowUpAt: "2026-11-01T10:00:00.000Z" }))),
    ).toBe("CONFLICT");
  });
});

describe("#7 won/lost dates use closedAt, not updatedAt", () => {
  it("editing an old won lead does not change won-this-month", async () => {
    as("u_founder");
    const before = await api.dashboard.summary();
    const oldWon = (await api.leads.list({ view: "all", stage: ["won"], pageSize: 50 })).items.find(
      (l) => Date.parse(l.closedAt!) < Date.parse("2026-10-01T00:00:00+05:30"),
    );
    if (!oldWon) return;
    await api.leads.update(
      oldWon.id,
      input({
        name: oldWon.name,
        company: oldWon.company ?? undefined,
        phone: oldWon.phone,
        ownerId: oldWon.ownerId,
        notes: "touched",
      }),
    );
    const after = await api.dashboard.summary();
    expect(after.wonThisMonth).toEqual(before.wonThisMonth);
  });
});

describe("#8 website must be http(s)", () => {
  it("rejects javascript: and other schemes", () => {
    const base = {
      name: "Acme",
      legalName: "Acme LLP",
      industry: "Retail",
      category: "smb",
      status: "active",
      accountManagerId: "u_am",
      billingAddress: { line1: "1 Road", city: "Jaipur", state: "Rajasthan", pincode: "302001" },
      productLines: [],
      primaryContact: { name: "A B", phone: "9829012345" },
    } as const;
    expect(ClientInputSchema.safeParse({ ...base, website: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(ClientInputSchema.safeParse({ ...base, website: "ftp://x.in" }).success).toBe(false);
    expect(ClientInputSchema.safeParse({ ...base, website: "https://acme.in" }).success).toBe(true);
  });
});

describe("#9 optimistic concurrency", () => {
  it("a stale edit gets 409 instead of overwriting", async () => {
    let tick = Date.parse("2026-10-25T10:00:00+05:30");
    api = createDemoApiClient({
      getUser: () => current,
      latencyMs: 0,
      persist: false,
      now: () => new Date((tick += 1000)),
    });
    as("u_sales1");
    const l = await api.leads.create(input());
    const opened = l.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const api2 = api; // same store, second editor
    const changed = await api2.leads
      .logActivity(l.id, { type: "note", summary: "noise" })
      .then(() => api2.leads.scheduleFollowUp(l.id, "2026-11-02T10:00:00.000Z"));
    expect(changed.updatedAt).not.toBe(opened);
    expect(
      await codeOf(api.leads.update(l.id, input({ notes: "mine", expectedUpdatedAt: opened }))),
    ).toBe("CONFLICT");
  });
});

describe("#13 export is permissioned and audited", () => {
  it("requires leads.export and writes an audit event", async () => {
    as("u_sales1");
    expect(await codeOf(api.leads.export({}))).toBe("FORBIDDEN");
    as("u_founder");
    const r = await api.leads.export({ view: "all" });
    expect(r.total).toBe(r.rows.length);
    expect(r.truncated).toBe(false);
    expect(api.__audit().some((a) => a.action === "lead.export")).toBe(true);
  });
});

describe("#14 rate limits are per account", () => {
  it("one account's failures don't lock another, and another's success doesn't reset them", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    for (let i = 0; i < 5; i++)
      await codeOf(auth.signInWithPassword("kabir@demo.zoii.in", "wrong"));
    expect((await auth.signInWithPassword("neha@demo.zoii.in", DEMO_PASSWORD)).status).toBe("ok");
    expect(await codeOf(auth.signInWithPassword("kabir@demo.zoii.in", DEMO_PASSWORD))).toBe(
      "RATE_LIMITED",
    );
  });
  it("unknown numbers expire like real ones (no enumeration by error type)", async () => {
    let t = 1_000_000;
    const auth = createDemoAuthAdapter({ storage: null, now: () => t });
    const unknown = await auth.requestPhoneOtp("9999999999");
    const known = await auth.requestPhoneOtp("9000000004");
    t += 6 * 60_000;
    const a = await auth
      .verifyPhoneOtp(unknown.challengeId, DEMO_OTP)
      .catch((e: ApiError) => e.message);
    const b = await auth
      .verifyPhoneOtp(known.challengeId, DEMO_OTP)
      .catch((e: ApiError) => e.message);
    expect(a).toBe(b);
  });
});

describe("#15 notifications", () => {
  it("are read per user and only for leads the user still owns", async () => {
    as("u_salesmgr");
    const mine = (await api.leads.list({ view: "mine", pageSize: 10 })).items[0]!;
    await api.leads.assign([mine.id], "u_sales1");
    as("u_sales1");
    const n1 = await api.notifications.list();
    const asg = n1.find((n) => n.kind === "assignment" && n.href.endsWith(mine.id));
    expect(asg).toBeDefined();
    await api.notifications.markRead([asg!.id]);
    as("u_salesmgr");
    await api.leads.assign([mine.id], "u_sales2");
    as("u_sales1");
    expect((await api.notifications.list()).some((n) => n.href.endsWith(mine.id))).toBe(false);
  });
});

describe("#17 bulk stage change is all-or-nothing", () => {
  it("rejects the whole batch if one lead is converted", async () => {
    as("u_founder");
    const open = (await api.leads.list({ view: "open", pageSize: 10 })).items.slice(0, 2);
    const won = (await api.leads.list({ view: "all", stage: ["won"], pageSize: 10 })).items[0]!;
    expect(
      await codeOf(api.leads.bulkChangeStage([...open.map((l) => l.id), won.id], "qualified")),
    ).toBe("CONFLICT");
    for (const l of open) expect((await api.leads.get(l.id)).stage).toBe(l.stage);
    expect(
      await codeOf(
        api.leads.bulkChangeStage(
          open.map((l) => l.id),
          "won",
        ),
      ),
    ).toBe("VALIDATION");
    const r = await api.leads.bulkChangeStage(
      open.map((l) => l.id),
      "qualified",
    );
    expect(r.updated).toBeLessThanOrEqual(2);
  });
});

describe("#18 list carries the total value of all matches", () => {
  it("totalValue covers every matching lead, not just the page", async () => {
    as("u_founder");
    const page = await api.leads.list({ view: "all", pageSize: 10 });
    const all = await api.leads.export({ view: "all" });
    const sum = all.rows.reduce((s, l) => s + Number(l.estimatedValue), 0);
    expect(Number(page.totalValue)).toBe(Math.round(sum));
  });
});
