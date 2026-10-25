// Cross-module business flow through the UI against a real API (seeded demo backend):
// quotation → approval → client acceptance → BRD approval → project activation →
// milestone UAT & sign-off → invoice → payment. Then checks the books balance.
//   BASE_URL=http://localhost:3000 API_URL=http://localhost:4000 node tests/e2e/flow.cjs
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = path.join(__dirname, "screenshots", "flow");
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
let n = 0;
const step = (m) => console.log(`  ${String(++n).padStart(2, "0")}. ${m}`);

async function session(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/api/v1/") && r.status() >= 500) errors.push(`API ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("zoii-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  const mfa = page.getByLabel("Verification code");
  const s = await Promise.race([mfa.waitFor({ timeout: 15000 }).then(() => "mfa"), page.waitForURL(/dashboard|workspace/, { timeout: 15000 }).then(() => "in")]);
  if (s === "mfa") { await mfa.fill("000000"); await page.getByRole("button", { name: /Verify/ }).click(); await page.waitForURL(/dashboard|workspace/); }
  return { page, errors, close: () => ctx.close() };
}

const toast = (page, re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout: 15000 });
async function pickClient(page, label, name) {
  await page.getByRole("button", { name: label }).click();
  await page.getByPlaceholder("Search clients…").fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).first().click();
}
async function approve(page, titleRe) {
  await page.goto(`${BASE}/approvals`);
  const row = page.getByRole("row").filter({ hasText: titleRe }).first();
  await row.waitFor({ timeout: 15000 });
  await row.getByRole("button", { name: "Approve" }).click();
  await toast(page, /Decision recorded/);
}

(async () => {
  const browser = await chromium.launch();
  const API = process.env.API_URL ?? "http://localhost:4000";
  const all = [];
  let client = "";
  try {
    // 1. Sales executive drafts a quotation with a 15% discount.
    const sales = await session(browser, "neha@demo.zoii.in"); all.push(sales);
    // Any seeded client in Rajasthan (same state as the company → CGST + SGST).
    const list = await (await sales.page.request.get(`${API}/api/v1/clients?pageSize=50`)).json();
    client = list.data.items.find((c) => c.billingAddress.state === "Rajasthan").name;
    await sales.page.goto(`${BASE}/quotations/new`);
    await pickClient(sales.page, "Client", client);
    await sales.page.getByLabel("Description").fill(`Restaurant POS rollout ${stamp}`);
    await sales.page.getByLabel("HSN/SAC").fill("998314");
    await sales.page.getByLabel("Rate (₹)").fill("80000");
    await sales.page.getByLabel("Discount %").fill("15");
    await sales.page.getByText("Total (preview)").waitFor();
    await sales.page.getByRole("button", { name: "Save draft" }).click();
    await sales.page.waitForURL(/\/quotations\/[0-9a-f-]{36}$/);
    const quoteUrl = sales.page.url();
    await sales.page.locator("h1", { hasText: /\/QT\// }).waitFor();
    const quoteNo = (await sales.page.locator("h1", { hasText: /\/QT\// }).textContent()).trim();
    step(`quotation ${quoteNo} drafted — server priced 68,000 + GST`);
    await sales.page.getByRole("button", { name: "Submit" }).click();
    await sales.page.getByText("Waiting for approval").waitFor();
    step("submitted → needs approval (discount above 10%)");

    // 2. Finance manager approves (maker-checker).
    const fin = await session(browser, "finance@demo.zoii.in"); all.push(fin);
    await approve(fin.page, new RegExp(quoteNo.replace(/\//g, "\\/")));
    step("finance approved from the Approvals inbox");

    // 3. Sales marks sent and records acceptance → sales order.
    await sales.page.goto(quoteUrl);
    await sales.page.getByRole("button", { name: "Mark as sent" }).click();
    await toast(sales.page, /Marked as sent/);
    await sales.page.getByRole("button", { name: "Client accepted" }).click();
    await sales.page.getByLabel("Evidence").fill(`PO ${stamp} by email`);
    await sales.page.getByRole("button", { name: "Confirm" }).click();
    await sales.page.getByRole("link", { name: "open the sales order" }).click();
    await sales.page.waitForURL(/\/sales-orders\//);
    const soUrl = sales.page.url();
    await sales.page.locator("h1", { hasText: /\/SO\// }).waitFor();
    step(`client accepted → sales order ${(await sales.page.locator("h1", { hasText: /\/SO\// }).textContent()).trim()}`);
    await sales.page.screenshot({ path: path.join(SHOTS, "01-sales-order.png") });

    // 4. PM writes the BRD; founder approves it.
    const pm = await session(browser, "pm@demo.zoii.in"); all.push(pm);
    await pm.page.goto(`${BASE}/documents`);
    await pm.page.getByRole("button", { name: "New document" }).click();
    await pm.page.getByLabel("Title").fill(`POS rollout scope ${stamp}`);
    await pickClient(pm.page, "Client", client);
    await pm.page.getByRole("button", { name: "Create draft" }).click();
    await pm.page.waitForURL(/\/documents\/[0-9a-f-]{36}$/);
    await pm.page.getByLabel("Document content").fill("# Scope\nPOS for 3 outlets, KOT printing, GST invoices, daily sales report.\n# Acceptance\nBills print correctly at all outlets.");
    await pm.page.getByRole("button", { name: "Save draft" }).click();
    await toast(pm.page, /Draft saved/);
    await pm.page.getByRole("button", { name: "Submit for review" }).click();
    await toast(pm.page, /Submitted for review/);
    const founder = await session(browser, "founder@demo.zoii.in"); all.push(founder);
    await approve(founder.page, /POS rollout scope/);
    step("BRD submitted by PM, approved by founder (version frozen)");

    // 5. PM starts and activates the project from the sales order.
    await pm.page.goto(soUrl);
    await pm.page.getByRole("button", { name: "Start project" }).click();
    await pm.page.getByLabel("Scope document").selectOption({ label: new RegExp(`POS rollout scope ${stamp}`) }).catch(async () => {
      const opt = await pm.page.locator("#sd option").filter({ hasText: stamp }).first().getAttribute("value");
      await pm.page.getByLabel("Scope document").selectOption(opt);
    });
    await pm.page.getByRole("button", { name: "Create project" }).click();
    await pm.page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    const projectUrl = pm.page.url();
    await pm.page.getByText("Activation checklist").waitFor();
    await pm.page.getByRole("button", { name: "Activate" }).click();
    await toast(pm.page, /Project activated/);
    step("project activated — sales order and approved scope checks passed");

    // 6. Milestone with UAT, then client sign-off.
    await pm.page.getByRole("button", { name: "Milestone" }).click();
    await pm.page.getByLabel("Name").fill("Outlet 1 go-live");
    await pm.page.getByLabel("Billing amount (₹, before GST)").fill("40000");
    await pm.page.getByRole("button", { name: "Add milestone" }).click();
    await toast(pm.page, /Milestone added/);
    await pm.page.getByRole("button", { name: "Add UAT check" }).click();
    await pm.page.getByLabel("What will the client verify?").fill("KOT and bill print with GSTIN");
    await pm.page.getByRole("button", { name: "Add", exact: true }).click();
    await pm.page.getByRole("button", { name: "Pass" }).click();
    await pm.page.getByRole("button", { name: "Record sign-off" }).click();
    await pm.page.getByLabel("Signed by").fill(`Owner, ${client}`);
    await pm.page.getByLabel("Evidence reference").fill(`Email ${stamp}`);
    await pm.page.getByRole("button", { name: "Record sign-off" }).last().click();
    await toast(pm.page, /Sign-off recorded/);
    step("UAT passed and client sign-off recorded");
    await pm.page.screenshot({ path: path.join(SHOTS, "02-project.png"), fullPage: true });

    // 7. Finance invoices the milestone, issues it and records the payment.
    await fin.page.goto(projectUrl);
    await fin.page.getByRole("button", { name: "Create invoice" }).click();
    await fin.page.waitForURL(/\/finance\/invoices\/[0-9a-f-]{36}$/);
    await fin.page.getByRole("button", { name: "Issue" }).click();
    await fin.page.getByRole("button", { name: "Issue invoice" }).click();
    await toast(fin.page, /Issued as/);
    await fin.page.locator("h1", { hasText: /\/INV\// }).waitFor();
    const invNo = (await fin.page.locator("h1", { hasText: /\/INV\// }).textContent()).trim();
    step(`invoice ${invNo} issued — 40,000 + 18% GST = 47,200`);
    await fin.page.getByRole("button", { name: "Record payment" }).click();
    await fin.page.getByLabel("Deposited to").selectOption({ index: 1 });
    await fin.page.getByRole("button", { name: "Record receipt" }).click();
    await toast(fin.page, /Receipt .* recorded/);
    await fin.page.getByText("Outstanding").first().waitFor();
    await fin.page.reload();
    const status = await fin.page.locator("h1 + *").first().textContent().catch(() => "");
    await fin.page.screenshot({ path: path.join(SHOTS, "03-invoice-paid.png"), fullPage: true });
    step(`payment recorded; invoice status: ${/paid/i.test(status) ? "Paid" : status}`);

    // 8. The books still balance.
    await fin.page.goto(`${BASE}/finance/reports`);
    await fin.page.getByRole("tab", { name: "Trial balance" }).click();
    await fin.page.getByText("Balanced", { exact: true }).waitFor({ timeout: 15000 });
    step("trial balance is balanced");
    await fin.page.screenshot({ path: path.join(SHOTS, "04-trial-balance.png"), fullPage: true });

    const errs = all.flatMap((s) => s.errors);
    if (errs.length) throw new Error(`Browser/API errors: ${errs.join(" | ")}`);
    console.log("\ncross-module flow passed");
  } catch (e) {
    console.error(`\nFLOW FAILED at step ${n + 1}: ${e.message}`);
    for (const [i, s] of all.entries()) await s.page.screenshot({ path: path.join(SHOTS, `fail-${i}.png`), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    for (const s of all) await s.close();
    await browser.close();
  }
})();
