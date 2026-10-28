/**
 * Regression tests for the Phase 1 stabilization fixes (audit of 2026-10-27).
 * Each test reproduces a finding that was confirmed against the previous code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { decrypt, totp } from "../src/lib/crypto";
import { EMAIL, H, client, login, setup, type TestCtx } from "./helpers";

type C = ReturnType<typeof client>;
const userId = async (t: TestCtx, email: string) =>
  (await t.db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;

describe("partial updates keep fields the caller didn't send", () => {
  let t: TestCtx;
  const as: Record<string, C> = {};
  let clientId: string;

  beforeAll(async () => {
    t = await setup();
    for (const k of ["admin", "salesmgr", "sales1", "pm", "hr"] as const) as[k] = client(t, await login(t, EMAIL[k]));
    const c = await as.salesmgr.post("/clients", {
      name: "Stability Client", legalName: "Stability Client Pvt Ltd", industry: "Retail", category: "smb", status: "active", accountManagerId: t.ids.get("u_am"),
      billingAddress: { line1: "1 Market Road", city: "Bikaner", state: "Rajasthan", pincode: "334001" }, productLines: ["custom_software"],
      primaryContact: { name: "Owner", phone: "+91 98290 44444", email: "owner@stability.example" },
    });
    expect(c.status).toBe(201);
    clientId = c.data.id;
  });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("updating a project without memberIds keeps its team", async () => {
    const pm = await userId(t, EMAIL.pm);
    const dev = await userId(t, EMAIL.dev);
    const p = await as.pm.post("/projects", { name: "Team Keeper", clientId, managerId: pm, memberIds: [dev] });
    expect(p.status).toBe(201);
    expect(p.data.memberIds).toContain(dev);
    const u = await as.pm.patch(`/projects/${p.data.id}`, { name: "Team Keeper Renamed" });
    expect(u.status).toBe(200);
    expect(u.data.name).toBe("Team Keeper Renamed");
    expect(u.data.memberIds).toContain(dev);
    // An explicit list still replaces the team (the manager always stays).
    const cleared = await as.pm.patch(`/projects/${p.data.id}`, { memberIds: [] });
    expect(cleared.data.memberIds).not.toContain(dev);
    expect(cleared.data.memberIds).toContain(pm);
  });

  it("updating a task without priority keeps its priority", async () => {
    const pm = await userId(t, EMAIL.pm);
    const p = await as.pm.post("/projects", { name: "Task Keeper", clientId, managerId: pm });
    const task = await as.pm.post(`/projects/${p.data.id}/tasks`, { title: "Urgent thing", priority: "high" });
    expect(task.status).toBe(201);
    const u = await as.pm.patch(`/tasks/${task.data.id}`, { title: "Urgent thing, renamed" });
    expect(u.status).toBe(200);
    expect(u.data.title).toBe("Urgent thing, renamed");
    expect(u.data.priority).toBe("high");
  });

  it("updating a user without a title keeps the title", async () => {
    const c = await as.admin.post("/admin/users", { name: "Title Keeper", email: "title.keeper@demo.zoii.in", title: "Operations Lead", roles: ["employee"] });
    expect(c.status).toBe(201);
    const u = await as.admin.patch(`/admin/users/${c.data.user?.id ?? c.data.id}`, { status: "suspended" });
    expect(u.status).toBe(200);
    const row = (await t.db.query<{ title: string; status: string }>(`SELECT title, status FROM users WHERE email = 'title.keeper@demo.zoii.in'`)).rows[0];
    expect(row).toEqual({ title: "Operations Lead", status: "suspended" });
  });

  it("editing a quotation without leadId keeps the lead link", async () => {
    const leads = await as.sales1.get("/leads?pageSize=50");
    const lead = leads.data.items.find((l: { clientId: string | null }) => !l.clientId);
    expect(lead).toBeTruthy();
    const line = { description: "Custom app", hsnSac: "998314", quantity: "1", unitPrice: "50000" };
    const q = await as.sales1.post("/quotations", { clientId, leadId: lead.id, lines: [line] });
    expect(q.status).toBe(201);
    expect(q.data.leadId).toBe(lead.id);
    // The editor sends the full form but never the lead.
    const u = await as.sales1.put(`/quotations/${q.data.id}`, { clientId, notes: "Revised scope", lines: [{ ...line, unitPrice: "55000" }] });
    expect(u.status).toBe(200);
    expect(u.data.leadId).toBe(lead.id);
    // Sending null on purpose still unlinks it.
    const cleared = await as.sales1.put(`/quotations/${q.data.id}`, { clientId, leadId: null, lines: [line] });
    expect(cleared.data.leadId).toBeNull();
  });

  it("an HR manager can't unlink their own employee record, then change its bank details or salary", async () => {
    const hr = await userId(t, EMAIL.hr);
    const dev = await userId(t, EMAIL.dev);
    const base = { designation: "HR Manager", dateOfJoining: "2025-04-01" };
    const own = await as.hr.post("/hr/employees", { ...base, fullName: "HR Self", userId: hr, bankAccount: "111122223333", bankIfsc: "SBIN0031801" });
    expect(own.status).toBe(201);
    const ownId = own.data.id;
    const linked = async () => (await t.db.query<{ user_id: string | null; bank_account_last4: string }>(`SELECT user_id, bank_account_last4 FROM employees WHERE id = $1`, [ownId])).rows[0];

    // Step 1 of the old bypass: omitting userId used to unlink the record. Now it keeps the link.
    expect((await as.hr.put(`/hr/employees/${ownId}`, { ...base, fullName: "HR Self" })).status).toBe(200);
    expect((await linked()).user_id).toBe(hr);
    // Unlinking on purpose is refused.
    expect((await as.hr.put(`/hr/employees/${ownId}`, { ...base, fullName: "HR Self", userId: null })).status).toBe(403);
    expect((await linked()).user_id).toBe(hr);
    // Bank details can't change, whether or not userId is sent.
    expect((await as.hr.put(`/hr/employees/${ownId}`, { ...base, fullName: "HR Self", bankAccount: "999988887777" })).status).toBe(403);
    expect((await as.hr.put(`/hr/employees/${ownId}`, { ...base, fullName: "HR Self", userId: hr, bankAccount: "999988887777" })).status).toBe(403);
    expect((await linked()).bank_account_last4).toBe("3333");
    // Salary stays out of reach.
    const salary = await as.hr.post(`/hr/employees/${ownId}/salary`, { effectiveFrom: "2026-01-01", components: [{ code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", value: "900000" }] });
    expect(salary.status).toBe(403);
    // Non-sensitive edits to their own record still work.
    expect((await as.hr.put(`/hr/employees/${ownId}`, { ...base, fullName: "HR Self Renamed", userId: hr })).status).toBe(200);
    expect((await linked()).user_id).toBe(hr);

    // For other employees, omitting userId keeps the existing link.
    const other = await as.hr.post("/hr/employees", { ...base, designation: "Engineer", fullName: "Dev Person", userId: dev });
    expect(other.status).toBe(201);
    expect((await as.hr.put(`/hr/employees/${other.data.id}`, { ...base, designation: "Senior Engineer", fullName: "Dev Person" })).status).toBe(200);
    expect((await t.db.query(`SELECT user_id FROM employees WHERE id = $1`, [other.data.id])).rows[0]).toEqual({ user_id: dev });
  });
});

describe("client IP behind the reverse proxy", () => {
  const failLogin = (t: TestCtx, remoteAddress: string, xff?: string) =>
    t.app.inject({
      method: "POST", url: "/api/v1/auth/login", remoteAddress,
      headers: { ...H, ...(xff ? { "x-forwarded-for": xff } : {}) },
      payload: { email: `nobody-${Math.random()}@demo.zoii.in`, password: "wrong-password" },
    });
  const lastIp = async (t: TestCtx) =>
    (await t.db.query<{ ip: string }>(`SELECT host(ip) AS ip FROM auth_attempts WHERE key LIKE 'ip:%' ORDER BY id DESC LIMIT 1`)).rows[0].ip;

  it("trusts only the configured proxy hop and ignores spoofed X-Forwarded-For entries", async () => {
    const t = await setup({ seed: false, env: { TRUST_PROXY: "127.0.0.1" } });
    try {
      // nginx on loopback appends the address that connected to it; earlier entries are client-supplied.
      await failLogin(t, "127.0.0.1", "6.6.6.6, 203.0.113.9");
      expect(await lastIp(t)).toBe("203.0.113.9");
      // A request that didn't come through the trusted proxy keeps its socket address.
      await failLogin(t, "198.51.100.7", "6.6.6.6");
      expect(await lastIp(t)).toBe("198.51.100.7");
    } finally { await t.app.close(); await t.db.close(); }
  });

  it("without a trusted proxy the header is ignored", async () => {
    const t = await setup({ seed: false });
    try {
      await failLogin(t, "198.51.100.8", "6.6.6.6");
      expect(await lastIp(t)).toBe("198.51.100.8");
    } finally { await t.app.close(); await t.db.close(); }
  });
});

describe("MFA: account-wide attempt limit, expiry and replay protection", () => {
  let t: TestCtx;
  let secret: string;
  const signIn = async () => {
    const r = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.founder, password: "zoii-demo" } });
    expect(r.json().data.status).toBe("mfa_required");
    return r.json().data.challengeId as string;
  };
  const verify = (challengeId: string, code: string) =>
    t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: H, payload: { challengeId, code } });
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  beforeAll(async () => {
    t = await setup({ env: { AUTH_DEV_STATIC_CODES: "false" } });
    const row = (await t.db.query<{ mfa_secret_enc: string }>(`SELECT mfa_secret_enc FROM users WHERE email = $1`, [EMAIL.founder])).rows[0];
    secret = decrypt(row.mfa_secret_enc, t.app.deps.config.dataEncryptionKey);
  });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("a code can't be used twice, and an older code can't follow a newer one", async () => {
    const code = totp(secret, t.clock.now.getTime());
    expect((await verify(await signIn(), code)).statusCode).toBe(200);
    // Same code, fresh challenge, same 30-second step: rejected.
    expect((await verify(await signIn(), code)).statusCode).toBe(401);
    // Next step's code works…
    t.clock.now = new Date(t.clock.now.getTime() + 30_000);
    expect((await verify(await signIn(), totp(secret, t.clock.now.getTime()))).statusCode).toBe(200);
    // …and the previous step's code, though still inside the drift window, is now stale.
    expect((await verify(await signIn(), totp(secret, t.clock.now.getTime() - 30_000))).statusCode).toBe(401);
  });

  it("an expired challenge is refused even with the right code", async () => {
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    const c = await signIn();
    t.clock.now = new Date(t.clock.now.getTime() + 6 * 60_000);
    const r = await verify(c, totp(secret, t.clock.now.getTime()));
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toMatch(/expired/);
  });

  it("wrong codes count across challenges, so new challenges don't reset the limit", async () => {
    // Start past the window so the replay rejections above don't count toward this limit.
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    const good = () => totp(secret, t.clock.now.getTime());
    // Three wrong codes on one challenge, two on the next: no single challenge reaches its own cap of 5.
    const c1 = await signIn();
    for (let i = 0; i < 3; i++) expect((await verify(c1, wrong(good()))).statusCode).toBe(401);
    const c2 = await signIn();
    for (let i = 0; i < 2; i++) expect((await verify(c2, wrong(good()))).statusCode).toBe(401);
    // The account is now locked for the window, even with the right code on a brand-new challenge.
    const locked = await verify(await signIn(), good());
    expect(locked.statusCode).toBe(429);
    // The lock lifts once the window has passed.
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    expect((await verify(await signIn(), good())).statusCode).toBe(200);
  });
});

describe("production configuration is validated at startup", () => {
  const prod = {
    NODE_ENV: "production", DATABASE_URL: "postgres://app@db.internal/zoii", DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CORS_ORIGINS: "https://app.zoii.example", APP_BASE_URL: "https://app.zoii.example", TRUST_PROXY: "127.0.0.1",
  };
  const load = (over: Record<string, string | undefined>) => () => loadConfig({ ...prod, ...over } as NodeJS.ProcessEnv);

  it("accepts a complete production configuration", () => {
    const c = load({})();
    expect(c.env).toBe("production");
    expect(c.cookieSecure).toBe(true);
    expect(c.trustProxy).toBe("127.0.0.1");
  });
  it("requires an https APP_BASE_URL", () => {
    expect(load({ APP_BASE_URL: undefined })).toThrow(/APP_BASE_URL/);
    expect(load({ APP_BASE_URL: "http://app.zoii.example" })).toThrow(/APP_BASE_URL/);
  });
  it("refuses insecure cookies, open proxy trust and demo data", () => {
    expect(load({ COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
    expect(load({ TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
    expect(load({ SEED_DEMO: "true" })).toThrow(/SEED_DEMO/);
  });
  it("rejects malformed values instead of guessing", () => {
    expect(load({ TRUST_PROXY: "nginx" })).toThrow(/TRUST_PROXY/);
    expect(load({ PORT: "http" })).toThrow(/PORT/);
    expect(load({ SESSION_HOURS: "0" })).toThrow(/SESSION_HOURS/);
    expect(load({ DATA_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/DATA_ENCRYPTION_KEY/);
  });
  it("an unrecognised NODE_ENV is an error, not silently development", () => {
    expect(load({ NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
  });
  it("a real database never uses the built-in development key", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://app@db.internal/zoii" } as NodeJS.ProcessEnv)).toThrow(/DATA_ENCRYPTION_KEY/);
    // Embedded PGlite for local development still works without one.
    expect(loadConfig({} as NodeJS.ProcessEnv).env).toBe("development");
  });
});
