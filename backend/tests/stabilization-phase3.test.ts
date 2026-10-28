/**
 * Regression tests for the follow-up hardening (2026-10-27): MFA for accountants,
 * maker-checker period close/reopen, and retention purges.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeExpired } from "../src/modules/automation/engine";
import { EMAIL, H, client, login, setup, type TestCtx } from "./helpers";

type C = ReturnType<typeof client>;

describe("accountants sign in with MFA", () => {
  let t: TestCtx;
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("a password alone doesn't open an accountant session", async () => {
    const r = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: EMAIL.acct, password: "zoii-demo" } });
    expect(r.json().data.status).toBe("mfa_required");
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("an existing session without MFA stops working once the role requires it", async () => {
    const uid = (await t.db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [EMAIL.acct])).rows[0].id;
    const svc = new (await import("../src/modules/auth/service")).AuthService(t.app.deps);
    const user = (await (await import("../src/modules/users/repo")).getUserRow(t.db, uid))!;
    const { token } = await svc.createSession(t.db, user, false, { ip: null });
    const r = await t.app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { cookie: `zoii_session=${token}` } });
    expect(r.statusCode).toBe(401);
  });
});

describe("closing and reopening a period needs a second person", () => {
  let t: TestCtx;
  const as: Record<string, C> = {};
  const accounts: Record<string, string> = {};
  const approval = async (title: string) => (await as.founder.get("/approvals")).data.find((x: { title: string }) => x.title === title);
  const journal = (date: string) => as.fin.postKeyed("/finance/journals", { entryDate: date, memo: "Period test", lines: [{ accountId: accounts.bank, debit: "1" }, { accountId: accounts.cap, credit: "1" }] });

  beforeAll(async () => {
    t = await setup({ now: new Date("2026-10-24T06:30:00Z") });
    for (const k of ["founder", "fin", "acct"] as const) as[k] = client(t, await login(t, EMAIL[k]));
    const list = (await as.fin.get("/finance/accounts")).data as { id: string; type: string; isBank?: boolean; name: string }[];
    accounts.bank = list.find((x) => x.type === "asset")!.id;
    accounts.cap = list.find((x) => x.type === "equity")!.id;
  });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("a close request changes nothing until someone else approves it", async () => {
    const r = await as.fin.post("/finance/periods/2026-08/close", {});
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("pending_approval");
    // Still open: postings go through, and the list shows the pending request.
    expect((await journal("2026-08-10")).status).toBe(201);
    const p = (await as.fin.get("/finance/periods")).data.find((x: { month: string }) => x.month === "2026-08");
    expect(p).toMatchObject({ status: "open", pending: { action: "close" } });
    // A second request for the same month is refused while one is waiting.
    expect((await as.fin.post("/finance/periods/2026-08/close", {})).status).toBe(409);
    const ap = await approval("Close 2026-08");
    expect(ap.href).toBe("/finance/periods");
    // The requester can't approve their own request.
    expect((await as.fin.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(403);
    expect((await as.founder.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(200);
    expect((await journal("2026-08-11")).status).toBe(409);
    const closed = (await as.fin.get("/finance/periods")).data.find((x: { month: string }) => x.month === "2026-08");
    expect(closed).toMatchObject({ status: "closed", pending: null });
  });

  it("reopening also needs approval, and a rejection leaves the period closed", async () => {
    expect((await as.fin.post("/finance/periods/2026-08/reopen", { reason: "no" })).status).toBe(422);
    expect((await as.fin.post("/finance/periods/2026-08/reopen", { reason: "Late vendor bill found" })).status).toBe(200);
    const ap = await approval("Reopen 2026-08");
    expect((await as.founder.post(`/approvals/${ap.id}/decide`, { decision: "reject", note: "Post it in September" })).status).toBe(200);
    expect((await journal("2026-08-12")).status).toBe(409);
    expect((await as.fin.post("/finance/periods/2026-08/reopen", { reason: "Auditor asked for an adjustment" })).status).toBe(200);
    expect((await as.founder.post(`/approvals/${(await approval("Reopen 2026-08")).id}/decide`, { decision: "approve" })).status).toBe(200);
    expect((await journal("2026-08-12")).status).toBe(201);
    const audit = await t.db.query<{ action: string }>(`SELECT action FROM audit_events WHERE entity_type = 'fiscal_period' ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(["period.close_requested", "period.close", "period.reopen_requested", "period.reopen_requested", "period.reopen"]);
  });

  it("checks run again at approval: a month that stopped being ready isn't closed", async () => {
    expect((await as.fin.post("/finance/periods/2026-07/close", {})).status).toBe(200);
    const clientId = (await t.db.query<{ id: string }>(`SELECT id FROM clients LIMIT 1`)).rows[0].id;
    const draft = await as.fin.post("/invoices", { clientId, invoiceDate: "2026-07-20", lines: [{ description: "Late draft", hsnSac: "998314", quantity: "1", unitPrice: "1000" }] });
    expect(draft.status).toBe(201);
    const ap = await approval("Close 2026-07");
    expect((await as.founder.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(409);
    expect((await journal("2026-07-21")).status).toBe(201);
  });
});

describe("retention purge", () => {
  let t: TestCtx;
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("removes only old security and plumbing rows, never audit or business records", async () => {
    const old = new Date(Date.now() - 120 * 86_400_000);
    const uid = (await t.db.query<{ id: string; organization_id: string }>(`SELECT id, organization_id FROM users WHERE email = $1`, [EMAIL.sales1])).rows[0];
    const count = async (sql: string) => Number((await t.db.query<{ n: string }>(sql)).rows[0].n);
    await t.db.query(`INSERT INTO sessions (user_id, token_hash, mfa_satisfied, created_at, expires_at) VALUES ($1, $2, false, $3, $4)`, [uid.id, Buffer.alloc(32, 1), old, new Date(old.getTime() + 3_600_000)]);
    await t.db.query(`INSERT INTO auth_attempts (key, succeeded, occurred_at) VALUES ('ip:old', false, $1), ('ip:new', false, now())`, [old]);
    await t.db.query(`INSERT INTO auth_challenges (user_id, organization_id, kind, code_hash, expires_at, created_at) VALUES ($1, $2, 'mfa', $3, $4, $5)`, [uid.id, uid.organization_id, Buffer.alloc(32, 2), new Date(old.getTime() + 300_000), old]);
    await t.db.query(`INSERT INTO domain_events (organization_id, type, entity_type, occurred_at, processed_at) VALUES ($1, 'test.old', 'test', $2, $2), ($1, 'test.unprocessed', 'test', $2, NULL)`, [uid.organization_id, old]);
    await t.db.query(`INSERT INTO audit_events (organization_id, action, entity_type, occurred_at) VALUES ($1, 'test.old_audit', 'test', $2)`, [uid.organization_id, old]);
    const sessionsBefore = await count(`SELECT count(*) AS n FROM sessions`);

    const n = await purgeExpired(t.app.deps, true);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(await count(`SELECT count(*) AS n FROM sessions`)).toBe(sessionsBefore - 1);
    expect(await count(`SELECT count(*) AS n FROM auth_attempts WHERE key = 'ip:old'`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM auth_attempts WHERE key = 'ip:new'`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM auth_challenges WHERE code_hash = '\\x${"02".repeat(32)}'`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM domain_events WHERE type = 'test.old'`)).toBe(0);
    // Unprocessed events and audit history stay.
    expect(await count(`SELECT count(*) AS n FROM domain_events WHERE type = 'test.unprocessed'`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'test.old_audit'`)).toBe(1);
    // Hourly at most unless forced.
    expect(await purgeExpired(t.app.deps)).toBe(0);
  });
});
