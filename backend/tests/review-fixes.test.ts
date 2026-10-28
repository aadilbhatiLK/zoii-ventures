/**
 * Regression tests for the independent Sprint 2–6 review (docs/security-baseline.md, "Independent review").
 * Each test reproduces a finding that was confirmed against the previous code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL, H, client, login, setup, type TestCtx } from "./helpers";

let t: TestCtx;
type C = ReturnType<typeof client>;
const as: Record<string, C> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await setup({ now: new Date("2026-10-24T06:30:00Z") });
  for (const k of ["founder", "admin", "salesmgr", "sales1", "fin", "pm", "auditor", "acct", "dev"] as const) as[k] = client(t, await login(t, EMAIL[k]));
  const c = await as.salesmgr.post("/clients", {
    name: "Review Client", legalName: "Review Client Pvt Ltd", industry: "Retail", category: "smb", status: "active", accountManagerId: t.ids.get("u_am"),
    billingAddress: { line1: "1 Market Road", city: "Bikaner", state: "Rajasthan", pincode: "334001" }, productLines: ["custom_software"],
    primaryContact: { name: "Owner", phone: "+91 98290 33333", email: "owner@review.example" },
  });
  expect(c.status).toBe(201);
  ids.client = c.data.id;
});
afterAll(async () => { await t.app.close(); await t.db.close(); });

describe("review fixes", () => {
  it("#1 bank summary never reveals another organisation's account", async () => {
    const org = await t.db.query<{ id: string }>(`INSERT INTO organizations (name, legal_name) VALUES ('Other Org', 'Other Org Pvt Ltd') RETURNING id`);
    const acc = await t.db.query<{ id: string }>(`INSERT INTO accounts (organization_id, code, name, type, is_bank) VALUES ($1, '1100', 'Other bank', 'asset', true) RETURNING id`, [org.rows[0].id]);
    const r = await as.acct.get(`/bank/summary?bankAccountId=${acc.rows[0].id}`);
    expect(r.status).toBe(404);
  });

  it("#2 someone who edited a draft can't approve it", async () => {
    const d = await as.pm.post("/documents", { kind: "brd", title: "Review BRD", clientId: ids.client, content: "# Scope\nOriginal text by the PM.\n" });
    expect(d.status).toBe(201);
    // The founder (an approver) rewrites the PM's draft…
    expect((await as.founder.put(`/documents/${d.data.id}/draft`, { content: "# Scope\nText written by the approver.\n" })).status).toBe(200);
    expect((await as.pm.post(`/documents/${d.data.id}/submit`)).status).toBe(200);
    const ap = (await as.founder.get("/approvals")).data.find((x: { title: string }) => x.title.includes("Review BRD"));
    expect(ap.canDecide).toBe(false);
    // …so the founder can't approve it; rejecting is still allowed.
    expect((await as.founder.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(403);
    // Editors are recorded append-only.
    await expect(t.db.query(`DELETE FROM record_editors`)).rejects.toThrow();
  });

  it("#3 the floor price is checked against the price after discount", async () => {
    const p = await as.fin.post("/products", { code: "FLOOR-1", name: "Floor test product", productLine: "custom_software", kind: "one_time", billingCycle: "one_time", hsnSac: "998314", unitPrice: "100000", floorPrice: "100000" });
    expect(p.status).toBe(201);
    const line = { description: "Floor test product", hsnSac: "998314", quantity: "1", unitPrice: "100000", discountPct: "10" };
    const q1 = await as.sales1.post("/quotations", { clientId: ids.client, lines: [{ ...line, productId: p.data.id }] });
    expect(q1.status).toBe(201);
    const s1 = await as.sales1.post(`/quotations/${q1.data.id}/submit`);
    expect(s1.data.status).toBe("pending_approval");
    expect(s1.data.approvalReasons.join(" ")).toMatch(/below the floor/);
    // A free-text line named like a catalogue product is checked too.
    const q2 = await as.sales1.post("/quotations", { clientId: ids.client, lines: [line] });
    const s2 = await as.sales1.post(`/quotations/${q2.data.id}/submit`);
    expect(s2.data.status).toBe("pending_approval");
  });

  it("#4 only a super admin can change MFA-protected accounts' phone; OTP can't enrol a new authenticator", async () => {
    const users = (await as.admin.get("/admin/users")).data as { id: string; email: string }[];
    const uid = (e: string) => users.find((u) => u.email === e)!.id;
    expect((await as.founder.patch(`/admin/users/${uid(EMAIL.admin)}`, { phone: "+91 98000 00001" })).status).toBe(403);
    expect((await as.founder.patch(`/admin/users/${uid(EMAIL.admin)}`, { status: "suspended" })).status).toBe(403);
    expect((await as.founder.patch(`/admin/users/${uid(EMAIL.fin)}`, { phone: "+91 98000 00002" })).status).toBe(403);
    // After an MFA reset, an OTP to the account's phone must not be enough to enrol a new factor.
    // (HR manager, not finance: resetting MFA signs the target out, and later tests use the finance session.)
    expect((await as.admin.post(`/admin/users/${uid(EMAIL.hr)}/reset-mfa`)).status).toBe(200);
    const req = await t.app.inject({ method: "POST", url: "/api/v1/auth/otp/request", headers: H, payload: { phone: "+91 90000 00009" } });
    const ver = await t.app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", headers: H, payload: { challengeId: req.json().data.challengeId, code: "000000" } });
    expect(ver.statusCode).toBe(403);
  });

  it("#10 changing the password signs out other sessions", async () => {
    const other = client(t, await login(t, EMAIL.dev));
    expect((await other.get("/auth/session")).status).toBe(200);
    const r = await as.dev.post("/auth/password/change", { currentPassword: "zoii-demo", newPassword: "Bikaner-Ledger-2026!" });
    expect(r.status).toBe(204);
    expect((await other.get("/auth/session")).status).toBe(401);
    expect((await as.dev.get("/auth/session")).status).toBe(200);
  });

  it("#11 manual journals are idempotent", async () => {
    const accs = (await as.fin.get("/finance/accounts")).data as { id: string; systemKey: string | null; isBank: boolean; type: string }[];
    const bank = accs.find((a) => a.isBank)!.id;
    const eq = accs.find((a) => a.type === "equity")!.id;
    const body = { entryDate: "2026-10-02", memo: "Idempotency check", lines: [{ accountId: bank, debit: "10" }, { accountId: eq, credit: "10" }] };
    expect((await as.fin.post("/finance/journals", body)).status).toBe(422);
    const k = { "idempotency-key": "jv-review-0001" };
    const a = await as.fin.post("/finance/journals", body, k);
    const b = await as.fin.post("/finance/journals", body, k);
    expect(a.status).toBe(201);
    expect(b.data.id).toBe(a.data.id);
    const n = await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM journal_entries WHERE memo = 'Idempotency check'`);
    expect(n.rows[0].n).toBe(1);
  });

  it("#15 malformed ids and dates are 404/422, never 500", async () => {
    expect((await as.fin.get("/subscriptions/not-a-uuid")).status).toBe(404);
    expect((await as.fin.get("/sales-orders/not-a-uuid")).status).toBe(404);
    expect((await as.auditor.get("/audit?from=2026-13-45")).status).toBe(422);
    expect((await as.fin.get("/finance/journals?from=xx")).status).toBe(422);
  });

  it("#17 the company bank account is masked in the audit log", async () => {
    const r = await as.admin.put("/admin/settings", { profile: { bank: { name: "HDFC Bank", account: "50100123456789", ifsc: "HDFC0001234", branch: "Bikaner" } } });
    expect(r.status).toBe(200);
    const rows = await t.db.query<{ detail: unknown }>(`SELECT * FROM audit_events WHERE action = 'settings.update'`);
    expect(JSON.stringify(rows.rows)).not.toContain("50100123456789");
    expect(JSON.stringify(rows.rows)).toContain("6789");
  });

  it("#19 financial statements need finance access, not just reports access", async () => {
    expect((await as.salesmgr.get("/reports/profit-and-loss?from=2026-04-01&to=2026-10-31")).status).toBe(403);
    expect((await as.fin.get("/reports/profit-and-loss?from=2026-04-01&to=2026-10-31")).status).toBe(200);
  });
});
