import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWorkerOnce } from "../src/modules/automation/engine";
import { EMAIL, client, login, setup, type TestCtx } from "./helpers";

let t: TestCtx;
type C = ReturnType<typeof client>;
const as: Record<string, C> = {};
const ids: Record<string, string> = {};
const D = (s: string) => s; // readability

beforeAll(async () => {
  t = await setup({ now: new Date("2026-10-24T06:30:00Z") });
  for (const [k, e] of Object.entries(EMAIL)) as[k] = client(t, await login(t, e));
  ids.am = t.ids.get("u_am")!; ids.dev = t.ids.get("u_dev")!; ids.pm = t.ids.get("u_pm")!; ids.sales1 = t.ids.get("u_sales1")!;
});
afterAll(async () => { await t.app.close(); await t.db.close(); });

const clientBody = (name: string, state: string, pincode: string, gstin?: string) => ({
  name, legalName: `${name} Pvt Ltd`, industry: "Retail", category: "smb", status: "active", accountManagerId: ids.am, gstin,
  billingAddress: { line1: "1 Market Road", city: "City", state, pincode }, productLines: ["custom_software"],
  primaryContact: { name: "Owner", phone: "+91 98290 22222", email: "owner@client.example" },
});

describe("Sprint 3 — catalogue, tax, documents, quotations", () => {
  it("catalogue is managed by finance only, with price history", async () => {
    const body = { code: "WEB-BASIC", name: "Business website", productLine: "ecommerce", kind: "one_time", billingCycle: "one_time", hsnSac: "998314", unitPrice: "25000", floorPrice: "20000" };
    expect((await as.sales1.post("/products", body)).status).toBe(403);
    const p = await as.fin.post("/products", body);
    expect(p.status).toBe(201);
    expect(p.data.taxRate).toBe("18.00");
    ids.product = p.data.id;
    const amc = await as.fin.post("/products", { code: "AMC-WEB", name: "Website AMC", productLine: "ecommerce", kind: "recurring", billingCycle: "yearly", hsnSac: "998713", unitPrice: "12000" });
    expect(amc.status).toBe(201);
    const up = await as.fin.put(`/products/${ids.product}`, { ...body, unitPrice: "27000" });
    expect(up.data.unitPrice).toBe("27000.00");
    expect((await as.fin.get(`/products/${ids.product}/price-history`)).data).toHaveLength(2);
    expect((await as.fin.post("/products", body)).status).toBe(409);
  });

  it("tax rules are versioned by date and can't overlap", async () => {
    expect((await as.fin.post("/tax-rules", { hsnSac: "998314", description: "Hypothetical rate change", rate: "12", effectiveFrom: "2027-01-01" })).status).toBe(201);
    expect((await as.fin.get("/tax-rules/lookup?hsnSac=998314&date=2026-12-31")).data.rate).toBe("18.00");
    expect((await as.fin.get("/tax-rules/lookup?hsnSac=998314&date=2027-01-02")).data.rate).toBe("12.00");
    expect((await as.fin.post("/tax-rules", { hsnSac: "998314", description: "Earlier", rate: "5", effectiveFrom: "2026-11-01" })).status).toBe(409);
    expect((await as.sales1.post("/tax-rules", { hsnSac: "998314", description: "x", rate: "5", effectiveFrom: "2028-01-01" })).status).toBe(403);
    const overlap = await t.db.query(`SELECT count(*)::int AS n FROM tax_rules WHERE hsn_sac = '998314'`);
    expect((overlap.rows[0] as { n: number }).n).toBe(2);
  });

  it("creates clients in two states for intra/inter-state GST", async () => {
    const raj = await as.salesmgr.post("/clients", clientBody("Thar Retail", "Rajasthan", "334001"));
    const mh = await as.salesmgr.post("/clients", clientBody("Khandesh Agro", "Maharashtra", "425401"));
    expect(raj.status).toBe(201);
    expect(mh.status).toBe(201);
    ids.rajClient = raj.data.id; ids.mhClient = mh.data.id;
  });

  it("documents: maker-checker review, frozen approved versions", async () => {
    const d = await as.pm.post("/documents", { kind: "brd", title: "Thar Retail ERP — requirements", clientId: ids.rajClient, content: "# Scope\nInventory, billing, GST invoices, WhatsApp orders.\n" });
    expect(d.status).toBe(201);
    ids.doc = d.data.id;
    expect((await as.pm.post(`/documents/${ids.doc}/submit`)).status).toBe(200);
    expect((await as.pm.put(`/documents/${ids.doc}/draft`, { content: "changed" })).status).toBe(409);
    const inbox = (await as.founder.get("/approvals")).data.find((x: { entityType: string }) => x.entityType === "document_version");
    expect(inbox.canDecide).toBe(true);
    // The author (PM can't approve docs anyway) — check the founder decides.
    const dec = await as.founder.post(`/approvals/${inbox.id}/decide`, { decision: "approve", note: "Looks right" });
    expect(dec.status).toBe(200);
    const doc = (await as.pm.get(`/documents/${ids.doc}`)).data;
    expect(doc.approvedVersion).toBe(1);
    expect(doc.versions[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
    // Database refuses edits to approved content even if the API were bypassed.
    await expect(t.db.query(`UPDATE document_versions SET content = 'tampered' WHERE document_id = $1`, [ids.doc])).rejects.toThrow(/immutable/);
    const v2 = await as.pm.post(`/documents/${ids.doc}/versions`);
    expect(v2.data.versions[0]).toMatchObject({ version: 2, status: "draft" });
  });

  it("quotations: server-side GST, approval for big discounts, send, accept → sales order", async () => {
    const lines = [
      { productId: ids.product, description: "Business website", hsnSac: "998314", quantity: "1", unitPrice: "27000" },
      { description: "Social media setup", hsnSac: "998361", quantity: "3", unitPrice: "2000", discountPct: "15" },
    ];
    // Client-supplied totals are ignored; the server prices every line.
    const q = await as.sales1.post("/quotations", { clientId: ids.rajClient, documentId: ids.doc, lines, grandTotal: "1" });
    expect(q.status).toBe(201);
    // 27000 + (6000 − 900) = 32100 taxable; 9% + 9% = 2889 each.
    expect(q.data).toMatchObject({ supplyType: "intra", taxableTotal: "32100.00", cgst: "2889.00", sgst: "2889.00", igst: "0.00", grandTotal: "37878.00" });
    expect(q.data.number).toMatch(/^ZV\/QT\/2627\/\d{4}$/);
    ids.quote = q.data.id;
    const sub = await as.sales1.post(`/quotations/${ids.quote}/submit`);
    expect(sub.data.status).toBe("pending_approval");
    expect(sub.data.approvalReasons[0]).toMatch(/15.00% discount/);
    const ap = (await as.fin.get("/approvals")).data.find((x: { entityId: string }) => x.entityId === ids.quote);
    expect((await as.sales1.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(403);
    expect((await as.fin.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(200);
    expect((await as.sales1.get(`/quotations/${ids.quote}`)).data.status).toBe("approved");
    expect((await as.sales1.post(`/quotations/${ids.quote}/send`)).data.status).toBe("sent");
    await expect(t.db.query(`UPDATE quotations SET grand_total = 1 WHERE id = $1`, [ids.quote])).rejects.toThrow();
    const pdf = await t.app.inject({ method: "GET", url: `/api/v1/quotations/${ids.quote}/pdf`, headers: { cookie: (as.sales1 as unknown as { cookie?: string }).cookie ?? "" } });
    expect([200, 401]).toContain(pdf.statusCode);
    const acc = await as.sales1.post(`/quotations/${ids.quote}/client-decision`, { decision: "accepted", evidence: "Email from owner 24 Oct" });
    expect(acc.data.status).toBe("accepted");
    expect(acc.data.salesOrderId).toBeTruthy();
    ids.so = acc.data.salesOrderId;
    expect((await as.sales1.post(`/quotations/${ids.quote}/revise`)).status).toBe(409);
  });

  it("inter-state quotation uses IGST and revisions supersede the original", async () => {
    const q = await as.sales1.post("/quotations", { clientId: ids.mhClient, lines: [{ description: "Custom app", hsnSac: "998314", quantity: "1", unitPrice: "100000" }] });
    expect(q.data).toMatchObject({ supplyType: "inter", igst: "18000.00", cgst: "0.00", grandTotal: "118000.00" });
    await as.sales1.post(`/quotations/${q.data.id}/submit`);
    await as.sales1.post(`/quotations/${q.data.id}/send`);
    const r2 = await as.sales1.post(`/quotations/${q.data.id}/revise`);
    expect(r2.status).toBe(201);
    expect(r2.data.displayNumber).toBe(`${q.data.number}-R2`);
    expect((await as.sales1.get(`/quotations/${q.data.id}`)).data.status).toBe("superseded");
    expect((await as.sales1.get(`/quotations/${q.data.id}/revisions`)).data).toHaveLength(2);
  });

  it("renders a real PDF", async () => {
    const cookie = await login(t, EMAIL.sales1);
    const pdf = await t.app.inject({ method: "GET", url: `/api/v1/quotations/${ids.quote}/pdf`, headers: { cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("sales executives only see their own quotations", async () => {
    expect((await as.sales2.get(`/quotations/${ids.quote}`)).status).toBe(404);
    expect((await as.fin.get(`/quotations/${ids.quote}`)).status).toBe(200);
  });
});

describe("Sprint 4 — delivery", () => {
  it("project activation enforces sales order and approved scope", async () => {
    const noSo = await as.pm.post("/projects", { name: "Thar ERP", clientId: ids.rajClient, managerId: ids.pm, scopeDocumentId: ids.doc });
    expect(noSo.status).toBe(201);
    const act1 = await as.pm.post(`/projects/${noSo.data.id}/activate`);
    expect(act1.status).toBe(409);
    expect(act1.error!.message).toMatch(/sales order/i);
    const p = await as.pm.patch(`/projects/${noSo.data.id}`, { salesOrderId: ids.so, memberIds: [ids.dev] });
    expect(p.data.activation.every((c: { ok: boolean }) => c.ok)).toBe(true);
    const act = await as.pm.post(`/projects/${noSo.data.id}/activate`);
    expect(act.data.status).toBe("active");
    ids.project = act.data.id;
    expect((await as.sales1.post(`/projects/${ids.project}/activate`)).status).toBe(403);
  });

  it("tasks: assignees move their own tasks but can't edit details", async () => {
    const task = await as.pm.post(`/projects/${ids.project}/tasks`, { title: "Set up GST invoice template", assigneeId: ids.dev, priority: "high" });
    expect(task.status).toBe(201);
    expect((await as.dev.get("/tasks/mine")).data.map((x: { id: string }) => x.id)).toContain(task.data.id);
    const mv = await as.dev.post(`/tasks/${task.data.id}/move`, { status: "in_progress", expectedUpdatedAt: task.data.updatedAt });
    expect(mv.data.status).toBe("in_progress");
    expect((await as.dev.post(`/tasks/${task.data.id}/move`, { status: "done", expectedUpdatedAt: task.data.updatedAt })).status).toBe(409);
    expect((await as.dev.patch(`/tasks/${task.data.id}`, { title: "Renamed" })).status).toBe(403);
    expect((await as.dev.get(`/projects/${ids.project}`)).status).toBe(200);
  });

  it("milestones need passing UAT before sign-off; sign-off is append-only", async () => {
    const p = await as.pm.post(`/projects/${ids.project}/milestones`, { name: "Phase 1 — billing", amount: "20000" });
    const m = p.data.milestones[0];
    ids.milestone = m.id;
    expect((await as.pm.post(`/milestones/${m.id}/sign-off`, { signedByName: "Owner", method: "email_confirmation", evidenceRef: "mail", signedAt: "2026-10-24T05:00:00Z" })).status).toBe(409);
    const u = await as.pm.post(`/milestones/${m.id}/uat`, { title: "Invoice prints GSTIN" });
    const uatId = u.data.milestones[0].uat[0].id;
    await as.pm.post(`/uat/${uatId}/result`, { status: "failed", notes: "Missing state code" });
    expect((await as.pm.post(`/milestones/${m.id}/sign-off`, { signedByName: "Owner", method: "email_confirmation", evidenceRef: "mail", signedAt: "2026-10-24T05:00:00Z" })).status).toBe(409);
    await as.pm.post(`/uat/${uatId}/result`, { status: "passed", testedByName: "Owner" });
    const so = await as.pm.post(`/milestones/${m.id}/sign-off`, { signedByName: "Owner", signedByEmail: "owner@client.example", method: "email_confirmation", evidenceRef: "Email 24 Oct 10:30", signedAt: "2026-10-24T05:00:00Z" });
    expect(so.data.milestones[0].status).toBe("signed_off");
    await expect(t.db.query(`DELETE FROM signoffs WHERE milestone_id = $1`, [m.id])).rejects.toThrow(/append-only/);
  });

  it("change requests need client approval and a different approver; approval adds a billable milestone", async () => {
    const cr = await as.pm.post(`/projects/${ids.project}/change-requests`, { title: "Add Tally export", description: "Export invoices in Tally XML", impactAmount: "8000", impactDays: 5 });
    const crId = cr.data.changeRequests[0].id;
    expect((await as.pm.post(`/change-requests/${crId}/submit`, { clientApproved: false, clientEvidence: "x" })).status).toBe(422);
    await as.pm.post(`/change-requests/${crId}/submit`, { clientApproved: true, clientEvidence: "WhatsApp approval 24 Oct" });
    const ap = (await as.founder.get("/approvals")).data.find((x: { entityId: string }) => x.entityId === crId);
    expect((await as.pm.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(403);
    await as.founder.post(`/approvals/${ap.id}/decide`, { decision: "approve" });
    const p = (await as.pm.get(`/projects/${ids.project}`)).data;
    expect(p.milestones.some((m: { name: string; amount: string }) => m.name.includes("Add Tally export") && m.amount === "8000.00")).toBe(true);
  });

  it("subscriptions and AMCs", async () => {
    const s = await as.am.post("/subscriptions", { clientId: ids.rajClient, salesOrderId: ids.so, kind: "amc", description: "Website AMC", hsnSac: "998713", amount: "1000", billingCycle: "monthly", startDate: "2026-10-01" });
    expect(s.status).toBe(201);
    expect(s.data.nextBillingDate).toBe("2026-10-01");
    ids.sub = s.data.id;
    expect((await as.sales1.post("/subscriptions", { clientId: ids.rajClient, kind: "amc", description: "x", hsnSac: "998713", amount: "1", billingCycle: "monthly", startDate: "2026-10-01" })).status).toBe(403);
  });
});

describe("Sprint 5 — finance", () => {
  const sys = async (key: string) => ((await t.db.query<{ id: string }>(`SELECT id FROM accounts WHERE system_key = $1`, [key])).rows[0]).id;

  it("milestone invoice issues with a gap-free number and a balanced journal", async () => {
    const inv = await as.acct.post(`/invoices/from-milestone/${ids.milestone}`);
    expect(inv.status).toBe(201);
    expect(inv.data).toMatchObject({ status: "draft", taxableTotal: "20000.00", cgst: "1800.00", sgst: "1800.00", total: "23600.00" });
    const issued = await as.acct.post(`/invoices/${inv.data.id}/issue`);
    expect(issued.data.status).toBe("issued");
    expect(issued.data.number).toBe("ZV/INV/2627/0001");
    ids.invoice = issued.data.id;
    const je = (await as.fin.get(`/finance/journals/${issued.data.journalEntryId}`)).data;
    const dr = je.lines.reduce((s: number, l: { debit: string }) => s + Number(l.debit), 0);
    const cr = je.lines.reduce((s: number, l: { credit: string }) => s + Number(l.credit), 0);
    expect(dr).toBe(23600);
    expect(cr).toBe(23600);
    expect((await as.acct.post(`/invoices/from-milestone/${ids.milestone}`)).status).toBe(409);
    await expect(t.db.query(`UPDATE invoices SET total = 1 WHERE id = $1`, [ids.invoice])).rejects.toThrow();
  });

  it("the ledger rejects unbalanced or edited entries at the database level", async () => {
    await expect(t.db.tx(async (q) => {
      const org = (await q.query<{ id: string }>(`SELECT id FROM organizations LIMIT 1`)).rows[0].id;
      const u = t.ids.get("u_fin");
      const e = await q.query<{ id: string }>(`INSERT INTO journal_entries (organization_id, number, entry_date, source_type, memo, posted_by) VALUES ($1,'T-1','2026-10-20','manual','test',$2) RETURNING id`, [org, u]);
      await q.query(`INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, debit) VALUES ($1,$2,1,$3,100)`, [org, e.rows[0].id, await sys("bank")]);
      await q.query(`INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, credit) VALUES ($1,$2,2,$3,90)`, [org, e.rows[0].id, await sys("capital")]);
    })).rejects.toThrow(/not balanced/);
    await expect(t.db.query(`UPDATE journal_lines SET debit = debit + 1`)).rejects.toThrow(/append-only/);
    const bad = await as.fin.post("/finance/journals", { entryDate: "2026-10-20", memo: "Unbalanced", lines: [{ accountId: await sys("bank"), debit: "100" }, { accountId: await sys("capital"), credit: "90" }] });
    expect(bad.status).toBe(422);
    const ok = await as.fin.post("/finance/journals", { entryDate: "2026-10-01", memo: "Capital introduced", lines: [{ accountId: await sys("bank"), debit: "500000" }, { accountId: await sys("capital"), credit: "500000" }] });
    expect(ok.status).toBe(201);
    const rev = await as.fin.post(`/finance/journals/${ok.data.id}/reverse`, { reason: "Duplicate entry test" });
    expect(rev.status).toBe(201);
    expect((await as.fin.post(`/finance/journals/${ok.data.id}/reverse`, { reason: "again" })).status).toBe(409);
    await as.fin.post("/finance/journals", { entryDate: "2026-10-01", memo: "Capital introduced", lines: [{ accountId: await sys("bank"), debit: "500000" }, { accountId: await sys("capital"), credit: "500000" }] });
  });

  it("receipts are idempotent, honour TDS and can't over-allocate", async () => {
    const bank = await sys("bank");
    const body = { clientId: ids.rajClient, receiptDate: "2026-10-24", amount: "21600", tdsAmount: "2000", method: "bank_transfer", reference: "UTR123", depositAccountId: bank, allocations: [{ invoiceId: ids.invoice, amount: "23600" }] };
    expect((await as.acct.post("/receipts", body)).status).toBe(422); // no key
    const r1 = await as.acct.post("/receipts", body, { "idempotency-key": "rcpt-utr123-0001" });
    expect(r1.status).toBe(201);
    const r2 = await as.acct.post("/receipts", body, { "idempotency-key": "rcpt-utr123-0001" });
    expect(r2.data.id).toBe(r1.data.id);
    expect((await as.acct.post("/receipts", { ...body, amount: "1" }, { "idempotency-key": "rcpt-utr123-0001" })).status).toBe(409);
    const n = await t.db.query(`SELECT count(*)::int AS n FROM receipts`);
    expect((n.rows[0] as { n: number }).n).toBe(1);
    expect((await as.acct.get(`/invoices/${ids.invoice}`)).data).toMatchObject({ status: "paid", outstanding: "0.00" });
    const over = await as.acct.post("/receipts", { ...body, amount: "100", tdsAmount: "0", allocations: [{ invoiceId: ids.invoice, amount: "100" }] }, { "idempotency-key": "rcpt-second-0001" });
    expect(over.status).toBe(409);
    ids.receiptJe = r1.data.journalEntryId;
  });

  it("credit notes reverse tax at the line rate and cap at what's outstanding", async () => {
    const inv = await as.acct.post("/invoices", { clientId: ids.mhClient, invoiceDate: "2026-10-24", lines: [{ description: "Consulting", hsnSac: "998313", quantity: "2", unitPrice: "5000" }] });
    expect(inv.data.igst).toBe("1800.00");
    const issued = await as.acct.post(`/invoices/${inv.data.id}/issue`);
    expect(issued.data.number).toBe("ZV/INV/2627/0002");
    const cn = await as.acct.post(`/invoices/${inv.data.id}/credit-notes`, { noteDate: "2026-10-24", reason: "Half day not delivered", lines: [{ invoiceLineId: issued.data.lines[0].id, taxable: "2500" }] });
    expect(cn.status).toBe(201);
    expect(cn.data.creditNotes[0].total).toBe("2950.00");
    expect(cn.data).toMatchObject({ status: "partially_paid", outstanding: "8850.00" });
    expect((await as.acct.post(`/invoices/${inv.data.id}/credit-notes`, { noteDate: "2026-10-24", reason: "Too much", lines: [{ invoiceLineId: issued.data.lines[0].id, taxable: "9000" }] })).status).toBe(422);
    ids.invoice2 = inv.data.id;
  });

  it("bills post input GST and TDS; payments settle the payable", async () => {
    const v = await as.acct.post("/vendors", { name: "CloudHost India", gstin: "08DAFPB0613A1ZN" });
    expect(v.status).toBe(201);
    const exp = (await as.acct.get("/finance/accounts")).data.find((a: { code: string }) => a.code === "5200");
    const b = await as.acct.post("/bills", { kind: "bill", vendorId: v.data.id, vendorBillNo: "CH-991", billDate: "2026-10-10", description: "Servers October", expenseAccountId: exp.id, taxable: "10000", gstRate: "18", tdsSection: "194J", tdsAmount: "1000" });
    expect(b.data).toMatchObject({ cgst: "900.00", sgst: "900.00", total: "11800.00", payable: "10800.00", status: "unpaid" });
    expect((await as.acct.post("/bills", { kind: "bill", vendorId: v.data.id, vendorBillNo: "CH-991", billDate: "2026-10-10", description: "dup", expenseAccountId: exp.id, taxable: "1" })).status).toBe(409);
    const p = await as.acct.post(`/bills/${b.data.id}/payments`, { paymentDate: "2026-10-20", amount: "10800", paidFromAccountId: await sys("bank"), reference: "NEFT77" });
    expect(p.data.status).toBe("paid");
    ids.billPayAmount = "10800";
  });

  it("bank import de-duplicates and reconciles against ledger entries", async () => {
    const bank = await sys("bank");
    const csv = "Date,Narration,Ref,Withdrawal,Deposit,Balance\n24/10/2026,NEFT CR THAR RETAIL,UTR123,,21600.00,1011600.00\n20/10/2026,NEFT DR CLOUDHOST,NEFT77,10800.00,,1000800.00\n25/10/2026,BANK CHARGES,,59.00,,1011541.00\n";
    const i1 = await as.acct.post("/bank/import", { bankAccountId: bank, filename: "oct.csv", csv });
    expect(i1.data).toMatchObject({ rows: 3, imported: 3, duplicates: 0 });
    const i2 = await as.acct.post("/bank/import", { bankAccountId: bank, filename: "oct-again.csv", csv });
    expect(i2.data).toMatchObject({ imported: 0, duplicates: 3 });
    const lines = (await as.acct.get(`/bank/lines?bankAccountId=${bank}`)).data;
    const credit = lines.find((l: { amount: string }) => l.amount === "21600.00");
    expect(credit.suggestions[0].entryId).toBe(ids.receiptJe);
    expect((await as.acct.post(`/bank/lines/${credit.id}/match`, { entryId: credit.suggestions[0].entryId })).status).toBe(200);
    const debit = lines.find((l: { amount: string }) => l.amount === "-10800.00");
    expect((await as.acct.post(`/bank/lines/${debit.id}/match`, { entryId: ids.receiptJe })).status).toBe(409);
    await as.acct.post(`/bank/lines/${debit.id}/match`, { entryId: debit.suggestions[0].entryId });
    const charges = lines.find((l: { amount: string }) => l.amount === "-59.00");
    expect((await as.acct.post(`/bank/lines/${charges.id}/categorize`, { accountId: await sys("bank_charges"), memo: "Bank charges" })).status).toBe(403); // accountant can't post journals
    expect((await as.fin.post(`/bank/lines/${charges.id}/categorize`, { accountId: await sys("bank_charges"), memo: "Bank charges October" })).status).toBe(200);
    expect((await as.acct.get(`/bank/lines?bankAccountId=${bank}`)).data).toHaveLength(0);
  });

  it("reports tie out: trial balance, balance sheet, P&L, GST and ageing", async () => {
    const tb = (await as.fin.get("/reports/trial-balance?asOf=2026-10-31")).data;
    expect(tb.totals.balanced).toBe(true);
    const bs = (await as.fin.get("/reports/balance-sheet?asOf=2026-10-31")).data;
    expect(bs.balanced).toBe(true);
    const pl = (await as.fin.get("/reports/profit-and-loss?from=2026-10-01&to=2026-10-31")).data;
    // Revenue 20000 + 10000 − 2500 credit; expenses 10000 + 59.
    expect(pl.totalIncome).toBe("27500.00");
    expect(pl.totalExpense).toBe("10059.00");
    expect(pl.netProfit).toBe("17441.00");
    const gst = (await as.fin.get("/reports/gst-summary?month=2026-10")).data;
    expect(gst.outputTotal).toMatchObject({ taxable: "30000.00", cgst: "1800.00", sgst: "1800.00", igst: "1800.00" });
    expect(gst.creditNotes.igst).toBe("450.00");
    expect(gst.input).toMatchObject({ cgst: "900.00", sgst: "900.00" });
    expect(gst.netPayable).toMatchObject({ cgst: "900.00", sgst: "900.00", igst: "1350.00", total: "3150.00" });
    const ar = (await as.fin.get("/reports/receivables-ageing?asOf=2026-10-31")).data;
    expect(ar.total).toBe("8850.00");
    const cf = (await as.fin.get("/reports/cash-flow?from=2026-10-01&to=2026-10-31")).data;
    expect(cf.closing).toBe(String((500000 + 21600 - 10800 - 59).toFixed(2)));
    expect((await as.sales1.get("/reports/trial-balance")).status).toBe(403);
  });

  it("closed periods reject postings until reopened", async () => {
    const bank = await sys("bank"), cap = await sys("capital");
    const close = await as.fin.post("/finance/periods/2026-09/close", {});
    expect(close.status).toBe(200);
    const post = await as.fin.post("/finance/journals", { entryDate: "2026-09-15", memo: "Late entry", lines: [{ accountId: bank, debit: "1" }, { accountId: cap, credit: "1" }] });
    expect(post.status).toBe(409);
    expect((await as.fin.post("/finance/periods/2026-10/close", {})).status).toBe(409); // current month
    expect((await as.fin.post("/finance/periods/2026-09/reopen", { reason: "Late vendor bill found" })).status).toBe(200);
  });

  it("subscription billing creates one draft per period", async () => {
    const r1 = await as.acct.post("/invoices/run-billing");
    expect(r1.data.created).toBe(1);
    const r2 = await as.acct.post("/invoices/run-billing");
    expect(r2.data.created).toBe(0);
    const drafts = (await as.acct.get("/invoices?status=draft")).data.filter((i: { subscriptionId: string | null }) => i.subscriptionId === ids.sub);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].total).toBe("1180.00");
  });
});

describe("Sprint 6 — people, support, automation, audit", () => {
  it("HR onboarding, self-service attendance and leave with maker-checker approval", async () => {
    const e = await as.hr.post("/hr/employees", { fullName: "Rohan Gehlot", designation: "Software Engineer", dateOfJoining: "2026-01-05", userId: ids.dev, pan: "ABCDE1234F", bankAccount: "44307172975", bankIfsc: "SBIN0031801" });
    expect(e.status).toBe(201);
    expect(e.data.bankAccountMasked).toBe("•••• 2975");
    ids.emp = e.data.id;
    const raw = await t.db.query<{ bank_account_enc: string }>(`SELECT bank_account_enc FROM employees WHERE id = $1`, [ids.emp]);
    expect(raw.rows[0].bank_account_enc).not.toContain("44307172975");
    const sal = await as.hr.post(`/hr/employees/${ids.emp}/salary`, { effectiveFrom: "2026-01-01", components: [
      { code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", value: "20000" },
      { code: "HRA", name: "HRA", kind: "earning", calc: "percent_of_basic", value: "40" },
      { code: "SPECIAL", name: "Special allowance", kind: "earning", calc: "fixed", value: "5000" },
    ] });
    expect(sal.data[0].monthlyGross).toBe("33000.00");
    expect((await as.dev.post("/hr/attendance", { workDate: "2026-10-23", status: "present" })).status).toBe(200);
    expect((await as.dev.post("/hr/attendance", { workDate: "2026-10-30", status: "present" })).status).toBe(422);
    expect((await as.dev.post("/hr/attendance", { workDate: "2026-10-22", status: "absent" })).status).toBe(200);
    const types = (await as.dev.get("/hr/leave-types")).data;
    const cl = types.find((x: { code: string }) => x.code === "CL");
    const leave = await as.dev.post("/hr/leave", { leaveTypeId: cl.id, fromDate: "2026-10-19", toDate: "2026-10-20", reason: "Family function" });
    expect(leave.status).toBe(201);
    expect(leave.data.days).toBe("2.0");
    const ap = (await as.hr.get("/approvals")).data.find((x: { entityId: string }) => x.entityId === leave.data.id);
    expect((await as.dev.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(403);
    await as.hr.post(`/approvals/${ap.id}/decide`, { decision: "approve" });
    const bal = (await as.dev.get("/hr/leave/balances")).data.find((b: { code: string }) => b.code === "CL");
    expect(bal).toMatchObject({ used: "2.0", available: "10.0" });
    expect((await as.dev.get("/hr/employees")).status).toBe(403);
  });

  it("payroll: prepare → approve by someone else → finance posts a balanced journal", async () => {
    const run = await as.hr.post("/payroll/runs", { month: "2026-10" });
    expect(run.status).toBe(201);
    const slip = run.data.payslips.find((p: { employeeId: string }) => p.employeeId === ids.emp);
    // October 2026: 27 working days (4 Sundays); 1 absent day → 26 payable.
    expect(slip).toMatchObject({ workingDays: "27.0", payableDays: "26.0", lopDays: "1.0" });
    // Each component prorates and rounds separately: 19259.26 + 7703.70 + 4814.81.
    expect(slip.gross).toBe("31777.77");
    expect(slip.deductions.find((d: { code: string }) => d.code === "PF_EE").amount).toBe("1800.00");
    await as.hr.post(`/payroll/runs/${run.data.id}/submit`);
    const ap = (await as.founder.get("/approvals")).data.find((x: { entityId: string }) => x.entityId === run.data.id);
    expect((await as.hr.post(`/approvals/${ap.id}/decide`, { decision: "approve" })).status).toBe(403);
    await as.founder.post(`/approvals/${ap.id}/decide`, { decision: "approve" });
    expect((await as.hr.post(`/payroll/runs/${run.data.id}/post`, {})).status).toBe(403);
    const posted = await as.fin.post(`/payroll/runs/${run.data.id}/post`, {});
    expect(posted.data.status).toBe("posted");
    expect((await as.fin.get("/reports/trial-balance?asOf=2026-10-31")).data.totals.balanced).toBe(true);
    expect((await as.dev.post("/hr/attendance", { workDate: "2026-10-23", status: "absent" })).status).toBe(409);
    expect((await as.dev.get("/payroll/my-payslips")).data[0].month).toBe("2026-10");
  });

  it("tickets carry SLA deadlines by priority", async () => {
    const tk = await as.am.post("/tickets", { clientId: ids.rajClient, subject: "Invoice print misaligned", description: "Logo overlaps the GSTIN", priority: "high", assigneeId: ids.dev });
    expect(tk.status).toBe(201);
    expect(Date.parse(tk.data.firstResponseDueAt) - Date.parse(tk.data.createdAt)).toBe(120 * 60_000);
    expect(tk.data.sla.firstResponse).toBe("pending");
    ids.ticket = tk.data.id;
    const c = await as.am.post(`/tickets/${ids.ticket}/comments`, { body: "Looking into it" });
    expect(c.data.sla.firstResponse).toBe("met");
    expect((await as.dev.post("/tickets", { clientId: ids.rajClient, subject: "x y z", description: "abc", priority: "low" })).status).toBe(403);
  });

  it("automation rules run exactly once per event and on schedules", async () => {
    const rule = await as.admin.post("/automations", { name: "Tell the account manager about new invoices", trigger: "invoice.issued", conditions: [{ field: "total", op: "gte", value: 1000 }], actions: [{ type: "notify", to: "account_manager", title: "Invoice {{number}} issued", body: "Total {{total}}" }] });
    expect(rule.status).toBe(201);
    const sla = await as.admin.post("/automations", { name: "SLA breach", trigger: "schedule.ticket_sla_breach", actions: [{ type: "notify", to: "assignee", title: "SLA breached: {{subject}}" }] });
    expect(sla.status).toBe(201);
    const inv = await as.acct.post("/invoices", { clientId: ids.rajClient, invoiceDate: "2026-10-24", lines: [{ description: "Training", hsnSac: "998313", quantity: "1", unitPrice: "3000" }] });
    await as.acct.post(`/invoices/${inv.data.id}/issue`);
    await runWorkerOnce(t.app.deps);
    await runWorkerOnce(t.app.deps);
    const n = await t.db.query<{ title: string }>(`SELECT title FROM notifications WHERE user_id = $1 AND title LIKE 'Invoice ZV/INV/%issued'`, [ids.am]);
    expect(n.rows).toHaveLength(1);
    t.clock.now = new Date(t.clock.now.getTime() + 10 * 3_600_000); // resolution SLA (8h) breached
    await runWorkerOnce(t.app.deps);
    await runWorkerOnce(t.app.deps);
    t.clock.now = new Date("2026-10-24T06:30:00Z"); // sessions are 8h; come back before reading via the API
    const b = await t.db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE 'SLA breached%'`, [ids.dev]);
    expect(b.rows).toHaveLength(1);
    const runs = (await as.admin.get("/automations/runs")).data;
    expect(runs.filter((r: { status: string }) => r.status === "succeeded").length).toBeGreaterThanOrEqual(2);
  });

  it("audit log is readable by auditors, who can't change anything", async () => {
    const a = await as.auditor.get("/audit?action=invoice.");
    expect(a.status).toBe(200);
    expect(a.data.items.some((x: { action: string }) => x.action === "invoice.issue")).toBe(true);
    expect((await as.auditor.post("/finance/journals", { entryDate: "2026-10-01", memo: "nope", lines: [] })).status).toBe(403);
    expect((await as.auditor.get("/reports/trial-balance")).status).toBe(200);
    expect((await as.sales1.get("/audit")).status).toBe(403);
    await expect(t.db.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
  });

  it("settings validate the organisation GSTIN and are admin-only", async () => {
    expect((await as.fin.put("/admin/settings", { quotations: { discountApprovalPct: 5 } })).status).toBe(403);
    expect((await as.admin.put("/admin/settings", { organization: { legalName: "Zoii Ventures", gstin: "08DAFPB0613A1ZX" } })).status).toBe(422);
    const ok = await as.admin.put("/admin/settings", { profile: { address: "Bikaner, Rajasthan", bank: { name: "State Bank of India", account: "44307172975", ifsc: "SBIN0031801", branch: "Bikaner" } } });
    expect(ok.data.profile.bank.ifsc).toBe("SBIN0031801");
    void D;
  });
});
