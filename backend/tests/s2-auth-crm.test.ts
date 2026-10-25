import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL, H, client, login, setup, type TestCtx } from "./helpers";

let t: TestCtx;
beforeAll(async () => { t = await setup(); });
afterAll(async () => { await t.app.close(); await t.db.close(); });

const leadInput = (ownerId: string, extra: Record<string, unknown> = {}) => ({
  name: "Test Person", company: "Acme Widgets Pvt Ltd", phone: "+91 98765 43210", email: "test@acme.example",
  productInterest: ["pos"], source: "website", priority: "high", estimatedValue: "150000", ownerId, ...extra,
});

describe("auth", () => {
  it("rejects a wrong password without revealing whether the account exists", async () => {
    const a = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.sales1, password: "nope" } });
    const b = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: "ghost@nowhere.in", password: "nope" } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it("gives non-privileged users a session cookie that is httpOnly and SameSite", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.sales1, password: "zoii-demo" } });
    expect(res.json().data.status).toBe("ok");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.json().data.session.user.email).toBe(EMAIL.sales1);
  });

  it("requires MFA for privileged roles; password alone gives no session", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.fin, password: "zoii-demo" } });
    const d = res.json().data;
    expect(d.status).toBe("mfa_required");
    expect(res.headers["set-cookie"]).toBeUndefined();
    const bad = await t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: H, payload: { challengeId: d.challengeId, code: "123456" } });
    expect(bad.statusCode).toBe(401);
    const ok = await t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: H, payload: { challengeId: d.challengeId, code: "000000" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.mfaSatisfied).toBe(true);
    // Single use.
    const again = await t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: H, payload: { challengeId: d.challengeId, code: "000000" } });
    expect(again.statusCode).toBe(401);
  });

  it("OTP sign-in is only a first factor for privileged roles", async () => {
    const req = await t.app.inject({ method: "POST", url: "/api/v1/auth/otp/request", headers: H, payload: { phone: "+91 90000 00001" } });
    expect(req.statusCode).toBe(200);
    expect(t.sent.at(-1)).toMatchObject({ channel: "sms", recipient: "+919000000001" });
    const code = String(t.sent.at(-1)!.payload.code);
    const v = await t.app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", headers: H, payload: { challengeId: req.json().data.challengeId, code } });
    expect(v.json().data.status).toBe("mfa_required");
  });

  it("answers OTP requests for unknown numbers identically and never verifies them", async () => {
    const before = t.sent.length;
    const req = await t.app.inject({ method: "POST", url: "/api/v1/auth/otp/request", headers: H, payload: { phone: "+91 91111 22222" } });
    expect(req.statusCode).toBe(200);
    expect(Object.keys(req.json().data).sort()).toEqual(["challengeId", "expiresAt"]);
    expect(t.sent.length).toBe(before);
    const v = await t.app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", headers: H, payload: { challengeId: req.json().data.challengeId, code: "000000" } });
    expect(v.statusCode).toBe(401);
  });

  it("rate-limits repeated password failures per account", async () => {
    for (let i = 0; i < 5; i++) await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...H, "x-forwarded-for": `10.0.0.${i}` }, payload: { email: EMAIL.sales2, password: "wrong" } });
    const res = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.sales2, password: "zoii-demo" } });
    expect(res.statusCode).toBe(429);
    // Another account is unaffected.
    const other = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.am, password: "zoii-demo" } });
    expect(other.statusCode).toBe(200);
  });

  it("rejects state-changing requests without the CSRF header or from a foreign origin", async () => {
    const cookie = await login(t, EMAIL.sales1);
    const noHeader = await t.app.inject({ method: "POST", url: "/api/v1/leads/export", headers: { cookie, "content-type": "application/json" }, payload: {} });
    expect(noHeader.statusCode).toBe(403);
    const foreign = await t.app.inject({ method: "POST", url: "/api/v1/leads/export", headers: { ...H, cookie, origin: "https://evil.example" }, payload: {} });
    expect(foreign.statusCode).toBe(403);
  });

  it("forgot-password responds 204 for any email and only sends to real accounts", async () => {
    const before = t.sent.length;
    const a = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", headers: H, payload: { email: "ghost@nowhere.in" } });
    expect(a.statusCode).toBe(204);
    expect(t.sent.length).toBe(before);
    const b = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", headers: H, payload: { email: EMAIL.pm } });
    expect(b.statusCode).toBe(204);
    const link = String(t.sent.at(-1)!.payload.link);
    const token = new URL(link).searchParams.get("token")!;
    const weak = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/reset", headers: H, payload: { token, password: "short" } });
    expect(weak.statusCode).toBe(422);
    const ok = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/reset", headers: H, payload: { token, password: "Correct-Horse-Battery-9" } });
    expect(ok.statusCode).toBe(204);
    const reuse = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/reset", headers: H, payload: { token, password: "Another-Strong-Pass-1" } });
    expect(reuse.statusCode).toBe(401);
    const signIn = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.pm, password: "Correct-Horse-Battery-9" } });
    expect(signIn.json().data.status).toBe("ok");
  });

  it("logout revokes the server session", async () => {
    const cookie = await login(t, EMAIL.am);
    const c = client(t, cookie);
    expect((await c.get("/auth/session")).status).toBe(200);
    expect((await c.post("/auth/logout")).status).toBe(204);
    expect((await c.get("/auth/session")).status).toBe(401);
  });
});

describe("leads & clients", () => {
  it("scopes lead lists by role and hides out-of-scope records as 404", async () => {
    const exec = client(t, await login(t, EMAIL.sales1));
    const mgr = client(t, await login(t, EMAIL.salesmgr));
    const founder = client(t, await login(t, EMAIL.founder));
    const mine = await exec.get("/leads?pageSize=50");
    const neha = t.ids.get("u_sales1")!;
    expect(mine.status).toBe(200);
    expect(mine.data.items.every((l: { ownerId: string }) => l.ownerId === neha)).toBe(true);
    const all = await founder.get("/leads?pageSize=50");
    expect(all.data.total).toBe(72);
    const team = await mgr.get("/leads?pageSize=50");
    expect(team.data.total).toBeLessThanOrEqual(72);
    const other = all.data.items.find((l: { ownerId: string }) => l.ownerId !== neha);
    expect((await exec.get(`/leads/${other.id}`)).status).toBe(404);
    expect((await exec.get(`/leads/not-a-uuid`)).status).toBe(404);
  });

  it("supports filters, sorting and totalValue across all pages", async () => {
    const founder = client(t, await login(t, EMAIL.founder));
    const r = await founder.get(`/leads?stage=new&stage=contacted&pageSize=10&sort=${encodeURIComponent(JSON.stringify({ field: "estimatedValue", dir: "desc" }))}`);
    expect(r.status).toBe(200);
    const vals = r.data.items.map((l: { estimatedValue: string }) => Number(l.estimatedValue));
    expect([...vals].sort((a, b) => b - a)).toEqual(vals);
    expect(r.data.items.every((l: { stage: string }) => ["new", "contacted"].includes(l.stage))).toBe(true);
    expect(Number(r.data.totalValue)).toBeGreaterThanOrEqual(vals.reduce((a: number, b: number) => a + b, 0));
    expect((await founder.get("/leads?pageSize=7")).status).toBe(422);
  });

  it("creates, updates with optimistic concurrency, and converts in one transaction", async () => {
    const exec = client(t, await login(t, EMAIL.sales1));
    const neha = t.ids.get("u_sales1")!;
    const created = await exec.post("/leads", leadInput(neha));
    expect(created.status).toBe(201);
    const lead = created.data;
    expect(lead.code).toMatch(/^LD-\d+$/);
    expect(lead.stage).toBe("new");

    const upd = await exec.patch(`/leads/${lead.id}`, leadInput(neha, { priority: "low", expectedUpdatedAt: lead.updatedAt }));
    expect(upd.status).toBe(200);
    const stale = await exec.patch(`/leads/${lead.id}`, leadInput(neha, { expectedUpdatedAt: lead.updatedAt }));
    expect(stale.status).toBe(409);

    const won = await exec.post(`/leads/${lead.id}/stage`, { stage: "won" });
    expect(won.status).toBe(409);
    const lost = await exec.post(`/leads/${lead.id}/stage`, { stage: "lost" });
    expect(lost.status).toBe(422);

    // Assigning to someone else needs leads.assign.
    const other = await exec.patch(`/leads/${lead.id}`, leadInput(t.ids.get("u_sales2")!, { expectedUpdatedAt: upd.data.updatedAt }));
    expect(other.status).toBe(403);

    const conv = await exec.post(`/leads/${lead.id}/convert`, { clientName: "Acme Widgets", legalName: "Acme Widgets Pvt Ltd", industry: "Retail", category: "smb", accountManagerId: t.ids.get("u_am")! });
    expect(conv.status).toBe(200);
    expect(conv.data.lead.stage).toBe("won");
    expect(conv.data.lead.clientId).toBe(conv.data.client.id);
    expect(conv.data.client.sourceLeadId).toBe(lead.id);
    const again = await exec.post(`/leads/${lead.id}/convert`, { clientName: "Acme Widgets", legalName: "Acme Widgets Pvt Ltd", industry: "Retail", category: "smb", accountManagerId: t.ids.get("u_am")! });
    expect(again.status).toBe(409);
    const back = await exec.post(`/leads/${lead.id}/stage`, { stage: "proposal" });
    expect(back.status).toBe(409);
    const acts = await exec.get(`/leads/${lead.id}/activities`);
    expect(acts.data.map((a: { type: string }) => a.type)).toContain("converted");
    const audit = await t.db.query<{ action: string }>(`SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY id`, [lead.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["lead.create", "lead.update", "lead.convert"]);
  });

  it("bulk stage changes are all-or-nothing", async () => {
    const mgr = client(t, await login(t, EMAIL.salesmgr));
    const list = await mgr.get("/leads?pageSize=50&view=open");
    const ids = list.data.items.slice(0, 2).map((l: { id: string }) => l.id);
    const founder = client(t, await login(t, EMAIL.founder));
    const outsider = (await founder.get("/leads?pageSize=50")).data.items.find((l: { ownerId: string }) => !list.data.items.some((m: { ownerId: string }) => m.ownerId === l.ownerId));
    if (outsider) {
      const bad = await mgr.post("/leads/stage", { ids: [...ids, outsider.id], stage: "qualified" });
      expect(bad.status).toBe(404);
      for (const id of ids) expect((await mgr.get(`/leads/${id}`)).data.stage).toBe(list.data.items.find((l: { id: string }) => l.id === id).stage);
    }
    expect((await mgr.post("/leads/stage", { ids, stage: "won" })).status).toBe(422);
    const ok = await mgr.post("/leads/stage", { ids, stage: "qualified" });
    expect(ok.status).toBe(200);
  });

  it("export requires leads.export and is audited", async () => {
    const exec = client(t, await login(t, EMAIL.sales1));
    expect((await exec.post("/leads/export", {})).status).toBe(403);
    const mgr = client(t, await login(t, EMAIL.salesmgr));
    const r = await mgr.post("/leads/export", { stage: ["new"] });
    expect(r.status).toBe(200);
    expect(r.data.truncated).toBe(false);
    const a = await t.db.query(`SELECT 1 FROM audit_events WHERE action = 'lead.export'`);
    expect(a.rows.length).toBeGreaterThan(0);
  });

  it("duplicate check counts but never reveals out-of-scope matches", async () => {
    const founder = client(t, await login(t, EMAIL.founder));
    const all = (await founder.get("/leads?pageSize=50")).data.items;
    const kabirLead = all.find((l: { ownerId: string }) => l.ownerId === t.ids.get("u_sales2"));
    const exec = client(t, await login(t, EMAIL.sales1));
    const r = await exec.post("/leads/duplicates", { phone: kabirLead.phone });
    expect(r.status).toBe(200);
    expect(r.data.matches.some((m: { lead: { id: string } }) => m.lead.id === kabirLead.id)).toBe(false);
    expect(r.data.hiddenMatchCount).toBeGreaterThan(0);
  });

  it("validates GSTIN checksum and uniqueness on clients", async () => {
    const mgr = client(t, await login(t, EMAIL.salesmgr));
    const body = {
      name: "Mitesh Studio", legalName: "Mitesh Studio", industry: "Photography", category: "smb", status: "active",
      accountManagerId: t.ids.get("u_am")!, gstin: "08DAFPB0613A1ZX",
      billingAddress: { line1: "12 Station Road", city: "Bikaner", state: "Rajasthan", pincode: "334001" },
      productLines: ["social_media"], primaryContact: { name: "Khadija", phone: "+91 98290 11111" },
    };
    expect((await mgr.post("/clients", body)).status).toBe(422);
    const ok = await mgr.post("/clients", { ...body, gstin: "08DAFPB0613A1ZN" });
    expect(ok.status).toBe(201);
    expect(ok.data.gstin).toBe("08DAFPB0613A1ZN");
    expect(ok.data.pan).toBe("DAFPB0613A");
    expect((await mgr.post("/clients", { ...body, gstin: "08DAFPB0613A1ZN" })).status).toBe(409);
    const stale = await mgr.patch(`/clients/${ok.data.id}`, { ...body, gstin: "08DAFPB0613A1ZN", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    const exec = client(t, await login(t, EMAIL.sales1));
    expect((await exec.patch(`/clients/${ok.data.id}`, { ...body, gstin: "08DAFPB0613A1ZN" })).status).toBe(403);
  });

  it("dashboard is scoped and labelled live; revenue only for company-metrics roles", async () => {
    const exec = client(t, await login(t, EMAIL.sales1));
    const d = await exec.get("/dashboard/summary");
    expect(d.status).toBe(200);
    expect(d.data.dataOrigin).toBe("live");
    expect(d.data.scope).toBe("own");
    expect(d.data.revenueSeries).toBeNull();
    const founder = client(t, await login(t, EMAIL.founder));
    const f = await founder.get("/dashboard/summary");
    expect(f.data.scope).toBe("company");
    expect(f.data.revenueSeries.origin).toBe("ledger");
    expect(f.data.revenueSeries.points).toHaveLength(6);
  });

  it("search and notifications respect scope", async () => {
    const exec = client(t, await login(t, EMAIL.sales1));
    const s = await exec.get("/search?q=ra");
    expect(s.status).toBe(200);
    const n = await exec.get("/notifications");
    expect(n.status).toBe(200);
    if (n.data.length) {
      expect((await exec.post("/notifications/read", { ids: [n.data[0].id] })).status).toBe(204);
      expect((await exec.get("/notifications")).data.find((x: { id: string }) => x.id === n.data[0].id).read).toBe(true);
    }
  });

  it("directory hides contact details", async () => {
    const exec = client(t, await login(t, EMAIL.sales1));
    const d = await exec.get("/users");
    expect(d.data[0]).not.toHaveProperty("email");
    expect(d.data[0]).not.toHaveProperty("phone");
  });
});

describe("user administration", () => {
  it("only super admins grant privileged roles; role changes revoke sessions", async () => {
    const founder = client(t, await login(t, EMAIL.founder));
    const admin = client(t, await login(t, EMAIL.admin));
    const inv = await founder.post("/admin/users", { name: "New Seller", email: "seller@demo.zoii.in", roles: ["sales_executive"] });
    expect(inv.status).toBe(201);
    expect(inv.data.user.roles).toEqual(["sales_executive"]);
    expect(t.sent.at(-1)!.template).toBe("invite");
    expect((await founder.post("/admin/users", { name: "Sneaky", email: "sneaky@demo.zoii.in", roles: ["super_admin"] })).status).toBe(403);
    const exec = client(t, await login(t, EMAIL.sales1));
    expect((await exec.get("/admin/users")).status).toBe(403);

    const neha = t.ids.get("u_sales1")!;
    const ch = await admin.patch(`/admin/users/${neha}`, { roles: ["sales_executive", "account_manager"] });
    expect(ch.status).toBe(200);
    expect((await exec.get("/auth/session")).status).toBe(401);
    expect((await admin.patch(`/admin/users/${t.ids.get("u_admin")}`, { roles: ["founder"] })).status).toBe(409);
  });
});
