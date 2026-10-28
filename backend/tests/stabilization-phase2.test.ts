/**
 * Regression tests for the Phase 2 stabilization fixes (audit of 2026-10-27, follow-ups to Phase 1).
 * Each test reproduces a finding that was confirmed against the previous code.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decrypt, totp } from "../src/lib/crypto";
import { signClientIp } from "../src/lib/client-ip";
import { EMAIL, H, client, login, setup, type TestCtx } from "./helpers";

type C = ReturnType<typeof client>;
const userId = async (t: TestCtx, email: string) =>
  (await t.db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;
const clientBody = (name: string, phone: string) => ({
  name, legalName: `${name} Pvt Ltd`, industry: "Retail", category: "smb", status: "active",
  billingAddress: { line1: "1 Market Road", city: "Bikaner", state: "Rajasthan", pincode: "334001" }, productLines: ["custom_software"],
  primaryContact: { name: "Owner", phone, email: `owner@${name.toLowerCase().replace(/\W/g, "")}.example` },
});
const line = { description: "Custom app", hsnSac: "998314", quantity: "1", unitPrice: "50000" };

describe("sign-in lockout can't be used against someone from another address", () => {
  let t: TestCtx;
  const signIn = (ip: string, password: string, email = EMAIL.sales1) =>
    t.app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: ip, headers: H, payload: { email, password } });
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("five wrong passwords lock that address, not the account", async () => {
    for (let i = 0; i < 5; i++) expect((await signIn("203.0.113.10", "wrong-password")).statusCode).toBe(401);
    expect((await signIn("203.0.113.10", "zoii-demo")).statusCode).toBe(429);
    // The real user, elsewhere, still gets in.
    expect((await signIn("198.51.100.20", "zoii-demo")).statusCode).toBe(200);
  });

  it("a distributed attack still locks the account once the account-wide limit is reached", async () => {
    for (let i = 0; i < 25; i++) await signIn(`203.0.113.${100 + i}`, "wrong-password", EMAIL.sales2);
    expect((await signIn("198.51.100.21", "zoii-demo", EMAIL.sales2)).statusCode).toBe(429);
  });

  it("forgot-password is throttled per address too", async () => {
    const forgot = (email: string) => t.app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", remoteAddress: "203.0.113.50", headers: H, payload: { email } });
    for (let i = 0; i < 20; i++) expect((await forgot(`nobody${i}@demo.zoii.in`)).statusCode).toBe(204);
    expect((await forgot("nobody-else@demo.zoii.in")).statusCode).toBe(429);
  });
});

describe("MFA lockout is per account and address, with an account-wide ceiling", () => {
  let t: TestCtx;
  let secret: string;
  const signIn = async (ip: string) => {
    const r = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: ip, headers: H, payload: { email: EMAIL.founder, password: "zoii-demo" } });
    return r.json().data.challengeId as string;
  };
  const verify = async (ip: string, code: string) =>
    t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", remoteAddress: ip, headers: H, payload: { challengeId: await signIn(ip), code } });
  const good = () => totp(secret, t.clock.now.getTime());
  const bad = () => String((Number(good()) + 1) % 1_000_000).padStart(6, "0");

  beforeAll(async () => {
    t = await setup({ env: { AUTH_DEV_STATIC_CODES: "false" } });
    const row = (await t.db.query<{ mfa_secret_enc: string }>(`SELECT mfa_secret_enc FROM users WHERE email = $1`, [EMAIL.founder])).rows[0];
    secret = decrypt(row.mfa_secret_enc, t.app.deps.config.dataEncryptionKey);
  });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("an attacker with the password can't lock the owner out of MFA from another address", async () => {
    for (let i = 0; i < 5; i++) expect((await verify("203.0.113.30", bad())).statusCode).toBe(401);
    expect((await verify("203.0.113.30", good())).statusCode).toBe(429);
    expect((await verify("198.51.100.30", good())).statusCode).toBe(200);
  });

  it("guesses spread across addresses stop at the account-wide limit", async () => {
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    for (let i = 0; i < 10; i++) expect((await verify(`203.0.113.${60 + i}`, bad())).statusCode).toBe(401);
    expect((await verify("198.51.100.31", good())).statusCode).toBe(429);
  });

  it("simultaneous guesses can't exceed the limit", async () => {
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    const challenges = await Promise.all(Array.from({ length: 3 }, () => signIn("203.0.113.90")));
    const results = await Promise.all(challenges.flatMap((c) => Array.from({ length: 4 }, () =>
      t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", remoteAddress: "203.0.113.90", headers: H, payload: { challengeId: c, code: bad() } }))));
    expect(results.filter((r) => r.statusCode === 401).length).toBeLessThanOrEqual(5);
    const failures = await t.db.query<{ n: string }>(`SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'mfa-ip:%|203.0.113.90' AND NOT succeeded`);
    expect(Number(failures.rows[0].n)).toBeLessThanOrEqual(5);
  });
});

describe("signed client IP from the web tier", () => {
  const SECRET = "test-signing-secret-0123456789-abcdef";
  const failLogin = (t: TestCtx, headers: Record<string, string>) =>
    t.app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: "127.0.0.1", headers: { ...H, ...headers }, payload: { email: `x${Math.random()}@demo.zoii.in`, password: "wrong-password" } });
  const lastIp = async (t: TestCtx) => (await t.db.query<{ ip: string }>(`SELECT host(ip) AS ip FROM auth_attempts WHERE key LIKE 'ip:%' ORDER BY id DESC LIMIT 1`)).rows[0].ip;

  it("uses a valid signed IP and ignores forged, stale or unsigned ones", async () => {
    const t = await setup({ seed: false, env: { CLIENT_IP_SIGNING_SECRET: SECRET, TRUST_PROXY: "127.0.0.1" } });
    try {
      const now = Math.floor(t.clock.now.getTime() / 1000);
      await failLogin(t, { "x-zoii-client-ip": signClientIp(SECRET, "203.0.113.7", now), "x-forwarded-for": "198.51.100.1" });
      expect(await lastIp(t)).toBe("203.0.113.7");
      await failLogin(t, { "x-zoii-client-ip": signClientIp("some-other-secret-0123456789-abcdefgh", "203.0.113.8", now), "x-forwarded-for": "198.51.100.2" });
      expect(await lastIp(t)).toBe("198.51.100.2");
      await failLogin(t, { "x-zoii-client-ip": signClientIp(SECRET, "203.0.113.9", now - 600), "x-forwarded-for": "198.51.100.3" });
      expect(await lastIp(t)).toBe("198.51.100.3");
      await failLogin(t, { "x-zoii-client-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.4" });
      expect(await lastIp(t)).toBe("198.51.100.4");
    } finally { await t.app.close(); await t.db.close(); }
  });

  it("is ignored when no secret is configured", async () => {
    const t = await setup({ seed: false });
    try {
      await failLogin(t, { "x-zoii-client-ip": signClientIp(SECRET, "203.0.113.7", Math.floor(Date.now() / 1000)) });
      expect(await lastIp(t)).toBe("127.0.0.1");
    } finally { await t.app.close(); await t.db.close(); }
  });
});

describe("records, links and organisation boundaries", () => {
  let t: TestCtx;
  const as: Record<string, C> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await setup();
    for (const k of ["founder", "admin", "salesmgr", "sales1", "fin", "pm", "hr"] as const) as[k] = client(t, await login(t, EMAIL[k]));
    const a = await as.salesmgr.post("/clients", { ...clientBody("Phase Two A", "+91 98290 55551"), accountManagerId: t.ids.get("u_am") });
    const b = await as.salesmgr.post("/clients", { ...clientBody("Phase Two B", "+91 98290 55552"), accountManagerId: t.ids.get("u_am") });
    expect([a.status, b.status]).toEqual([201, 201]);
    ids.clientA = a.data.id;
    ids.clientB = b.data.id;
  });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("editing a quotation without documentId keeps the BRD link", async () => {
    const doc = await as.pm.post("/documents", { kind: "brd", title: "Phase Two BRD", clientId: ids.clientA, content: "# Scope\n" });
    expect(doc.status).toBe(201);
    const q = await as.sales1.post("/quotations", { clientId: ids.clientA, documentId: doc.data.id, lines: [line] });
    expect(q.data.documentId).toBe(doc.data.id);
    const u = await as.sales1.put(`/quotations/${q.data.id}`, { clientId: ids.clientA, lines: [line] });
    expect(u.status).toBe(200);
    expect(u.data.documentId).toBe(doc.data.id);
  });

  it("approval links point at pages that exist", async () => {
    const doc = await as.pm.post("/documents", { kind: "brd", title: "Linked BRD", clientId: ids.clientA, content: "# Scope\nEnough written scope to submit for review.\n" });
    expect((await as.pm.post(`/documents/${doc.data.id}/submit`)).status).toBe(200);
    // The other kinds are inserted directly: only the link is under test here.
    const org = (await t.db.query<{ organization_id: string }>(`SELECT organization_id FROM users WHERE email = $1`, [EMAIL.pm])).rows[0].organization_id;
    const requester = await userId(t, EMAIL.pm);
    const fake = { payroll_run: "11111111-1111-4111-8111-111111111111", leave_request: "22222222-2222-4222-8222-222222222222", journal_entry: "33333333-3333-4333-8333-333333333333", change_request: "44444444-4444-4444-8444-444444444444" };
    for (const [type, id] of Object.entries(fake))
      await t.db.query(`INSERT INTO approval_requests (organization_id, entity_type, entity_id, title, reason, required_permission, requested_by) VALUES ($1,$2,$3,$4,'test','documents.approve',$5)`, [org, type, id, `Link test ${type}`, requester]);
    const list = (await as.founder.get("/approvals")).data as { entityType: string; entityId: string; href: string; title: string }[];
    const href = (type: string) => list.find((x) => x.entityType === type && (type === "document_version" ? x.title.includes("Linked BRD") : x.title.startsWith("Link test")))!.href;
    expect(href("document_version")).toBe(`/documents/${doc.data.id}`);
    expect(href("payroll_run")).toBe(`/people/payroll/${fake.payroll_run}`);
    expect(href("leave_request")).toBe("/people/attendance");
    expect(href("journal_entry")).toBe(`/finance/ledger?entry=${fake.journal_entry}`);
    expect(href("change_request")).toBe("/projects"); // parent gone → list page
    // Every link resolves to a real Next.js route.
    const app = join(__dirname, "..", "..", "src", "app", "(workspace)");
    for (const page of ["documents/[documentId]", "people/payroll/[runId]", "people/attendance", "finance/ledger", "projects/[projectId]", "projects"])
      expect(existsSync(join(app, page, "page.tsx")), page).toBe(true);
  });

  it("an invoice draft can't be moved onto another client's sales order", async () => {
    const q = await as.sales1.post("/quotations", { clientId: ids.clientB, lines: [line] });
    expect((await as.sales1.post(`/quotations/${q.data.id}/submit`)).data.status).toBe("approved");
    expect((await as.sales1.post(`/quotations/${q.data.id}/send`)).data.status).toBe("sent");
    const acc = await as.sales1.post(`/quotations/${q.data.id}/client-decision`, { decision: "accepted", evidence: "Signed PO" });
    const soB = acc.data.salesOrderId;
    expect(soB).toBeTruthy();
    const draft = await as.fin.post("/invoices", { clientId: ids.clientA, invoiceDate: "2026-10-27", lines: [line] });
    expect(draft.status).toBe(201);
    // Create already refused this; the edit path didn't check.
    expect((await as.fin.post("/invoices", { clientId: ids.clientA, salesOrderId: soB, invoiceDate: "2026-10-27", lines: [line] })).status).toBe(422);
    const moved = await as.fin.put(`/invoices/${draft.data.id}`, { clientId: ids.clientA, salesOrderId: soB, invoiceDate: "2026-10-27", lines: [line] });
    expect(moved.status).toBe(422);
  });

  it("only the owner, the author or an approver can edit a document draft, and edits are audited", async () => {
    const doc = await as.pm.post("/documents", { kind: "brd", title: "Owned BRD", clientId: ids.clientA, content: "# Scope\nPM text\n" });
    expect((await as.sales1.put(`/documents/${doc.data.id}/draft`, { content: "# Scope\nSomeone else's text\n" })).status).toBe(403);
    expect((await as.pm.put(`/documents/${doc.data.id}/draft`, { content: "# Scope\nPM text, revised\n" })).status).toBe(200);
    const ev = await t.db.query(`SELECT 1 FROM audit_events WHERE action = 'document.edit' AND entity_id = $1`, [doc.data.id]);
    expect(ev.rows.length).toBe(1);
  });

  it("project team changes are audited", async () => {
    const pm = await userId(t, EMAIL.pm);
    const dev = await userId(t, EMAIL.dev);
    const p = await as.pm.post("/projects", { name: "Audited Team", clientId: ids.clientA, managerId: pm });
    await as.pm.patch(`/projects/${p.data.id}`, { memberIds: [dev] });
    const ev = (await t.db.query<{ changes: { memberIds?: string[] } }>(`SELECT changes FROM audit_events WHERE action = 'project.update' AND entity_id = $1`, [p.data.id])).rows[0];
    expect(ev.changes.memberIds).toEqual([dev]);
  });

  it("journal lines can't name a party from another organisation", async () => {
    const other = await t.db.query<{ id: string }>(`INSERT INTO organizations (name, legal_name) VALUES ('Other Org 2', 'Other Org 2 Pvt Ltd') RETURNING id`);
    const foreign = await t.db.query<{ id: string }>(`INSERT INTO vendors (organization_id, name) VALUES ($1, 'Foreign Vendor') RETURNING id`, [other.rows[0].id]);
    const ours = (await t.db.query<{ id: string }>(`INSERT INTO vendors (organization_id, name) SELECT organization_id, 'Our Vendor' FROM users WHERE email = $1 RETURNING id`, [EMAIL.fin])).rows[0].id;
    const accounts = (await as.fin.get("/finance/accounts")).data as { id: string; code: string; type: string }[];
    const [dr, cr] = [accounts.find((x) => x.type === "expense")!, accounts.find((x) => x.type === "asset")!];
    const body = (partyId: string) => ({ entryDate: "2026-10-27", memo: "Party check", lines: [{ accountId: dr.id, debit: "100", partyType: "vendor", partyId }, { accountId: cr.id, credit: "100" }] });
    expect((await as.fin.postKeyed("/finance/journals", body(foreign.rows[0].id))).status).toBe(422);
    expect((await as.fin.postKeyed("/finance/journals", body(ours))).status).toBe(201);
  });

  it("audit paging rejects nonsense instead of failing", async () => {
    for (const p of ["Infinity", "-5", "1e400", "abc"]) expect((await as.founder.get(`/audit?page=${p}`)).status).toBe(200);
  });
});

describe("admin-issued links when no email provider is configured", () => {
  let t: TestCtx;
  const as: Record<string, C> = {};
  beforeAll(async () => {
    t = await setup({ deliver: false });
    for (const k of ["founder", "admin"] as const) as[k] = client(t, await login(t, EMAIL[k]));
  });
  afterAll(async () => { await t.app.close(); await t.db.close(); });

  it("a new user gets a one-time invite link the admin can hand over, and it activates the account", async () => {
    const c = await as.admin.post("/admin/users", { name: "Onboard Person", email: "onboard.person@demo.zoii.in", roles: ["employee"] });
    expect(c.status).toBe(201);
    expect(c.data.inviteSent).toBe(false);
    expect(c.data.manualLink).toMatch(/\/reset-password\?token=/);
    // Only the hash is stored.
    const token = decodeURIComponent(new URL(c.data.manualLink).searchParams.get("token")!);
    expect((await t.db.query(`SELECT 1 FROM auth_challenges WHERE code_hash::text LIKE $1`, [`%${token}%`])).rows.length).toBe(0);
    const reset = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/reset", headers: H, payload: { token, password: "a-long-new-passphrase" } });
    expect(reset.statusCode).toBe(204);
    const signIn = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email: "onboard.person@demo.zoii.in", password: "a-long-new-passphrase" } });
    expect(signIn.json().data.status).toBe("ok");
    // Single use.
    expect((await t.app.inject({ method: "POST", url: "/api/v1/auth/password/reset", headers: H, payload: { token, password: "another-long-passphrase" } })).statusCode).toBe(401);
  });

  it("reset links are guarded like role changes, notify the owner, and never leak from the public endpoint", async () => {
    const admin = await userId(t, EMAIL.admin);
    const founder = await userId(t, EMAIL.founder);
    const emp = (await as.admin.post("/admin/users", { name: "Reset Target", email: "reset.target@demo.zoii.in", roles: ["employee"] })).data.user.id;
    // Founder (not a super admin) can't issue one for the super admin; nobody issues one for themselves.
    expect((await as.founder.post(`/admin/users/${admin}/send-reset`)).status).toBe(403);
    expect((await as.admin.post(`/admin/users/${admin}/send-reset`)).status).toBe(409);
    // The super admin can, for the founder.
    expect((await as.admin.post(`/admin/users/${founder}/send-reset`)).data.manualLink).toMatch(/token=/);
    const r = await as.admin.post(`/admin/users/${emp}/send-reset`);
    expect(r.data).toMatchObject({ sent: false });
    expect(r.data.manualLink).toBeTruthy();
    const audit = await t.db.query<{ changes: { delivery: string } }>(`SELECT changes FROM audit_events WHERE action = 'user.reset_link' AND entity_id = $1`, [founder]);
    expect(audit.rows[0].changes.delivery).toBe("manual");
    const note = await t.db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE 'A password reset link%'`, [founder]);
    expect(note.rows.length).toBe(1);
    const pub = await t.app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", headers: H, payload: { email: EMAIL.founder } });
    expect(pub.statusCode).toBe(204);
    expect(pub.body).not.toMatch(/token|reset-password/);
  });
});
