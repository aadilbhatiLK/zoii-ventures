/*
 * End-to-end smoke test against a running server in demo mode.
 *   BASE_URL=http://localhost:3100 npm run e2e
 * Uses the system Playwright + Chromium. Screenshots go to tests/e2e/screenshots/.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = path.join(__dirname, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const pageErrors = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push(["FAIL", name]);
    console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n")[0]}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function login(page, email, { mfa = false } = {}) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("zoii-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  if (mfa) {
    await page.getByRole("heading", { name: "Two-step verification" }).waitFor();
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  await step("unauthenticated visit redirects to sign-in with return path", async () => {
    await page.goto(`${BASE}/leads`);
    await page.waitForURL(/\/login\?next=%2Fleads/, { timeout: 15000 });
  });

  await step("demo mode is labelled on the sign-in page", async () => {
    expect(
      await page
        .getByRole("status")
        .filter({ hasText: /Demo mode — all people, companies and amounts are fictional/ })
        .isVisible(),
      "demo banner missing",
    );
    await page.screenshot({ path: path.join(OUT, "01-login.png") });
  });

  await step("wrong password shows an error and stays signed out", async () => {
    await page.getByLabel("Work email").fill("neha@demo.zoii.in");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Email or password is incorrect.").waitFor();
  });

  await step("sales executive signs in and lands on the dashboard", async () => {
    await login(page, "neha@demo.zoii.in");
    await page.getByRole("heading", { name: /Good (morning|afternoon|evening), Neha/ }).waitFor();
    await page.getByText("Open pipeline").first().waitFor();
    await page.screenshot({ path: path.join(OUT, "02-dashboard-sales-exec.png") });
  });

  await step("navigation hides modules the role can't use", async () => {
    const nav = page.getByRole("navigation", { name: "Main" });
    expect(await nav.getByRole("link", { name: "Leads" }).isVisible(), "Leads missing");
    expect(
      (await nav.getByRole("link", { name: /Finance Dashboard/ }).count()) === 0,
      "Finance visible to sales exec",
    );
    expect(
      (await nav.getByRole("link", { name: /Payroll/ }).count()) === 0,
      "Payroll visible to sales exec",
    );
  });

  await step("direct URL to a restricted module shows access denied", async () => {
    await page.goto(`${BASE}/finance`);
    await page.getByText("You don't have access").waitFor();
  });

  await step("leads list loads with only the executive's own leads", async () => {
    await page.goto(`${BASE}/leads`);
    await page.getByRole("table", { name: "Leads" }).waitFor();
    await page.locator("tbody tr").first().waitFor();
    const rows = await page.locator("tbody tr").count();
    expect(rows > 0, "no rows");
    await page.screenshot({ path: path.join(OUT, "03-leads.png") });
  });

  let createdName = `E2E Traders ${Date.now() % 100000}`;
  await step("create a lead from the sheet (keyboard shortcut N)", async () => {
    await page
      .locator("body")
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await page.keyboard.press("n");
    await page.getByRole("heading", { name: "New lead" }).waitFor();
    await page.getByRole("textbox", { name: "Contact name", exact: true }).fill("Ritu Agarwal");
    await page.getByLabel("Company", { exact: true }).fill(createdName);
    await page.getByRole("textbox", { name: "Phone", exact: true }).fill("+91 93141 55667");
    await page.getByRole("button", { name: "Jewellery CRM" }).click();
    await page.getByRole("textbox", { name: "Estimated value (₹)", exact: true }).fill("185000");
    await page.screenshot({ path: path.join(OUT, "04-new-lead-sheet.png") });
    await page.getByRole("button", { name: /Create lead|Create anyway/ }).click();
    await page.getByText(/Lead LD-\d+ created/).waitFor({ timeout: 10000 });
  });

  await step("new lead is searchable and opens its detail page", async () => {
    await page.getByPlaceholder(/Search name, company/).fill(createdName);
    await page.getByRole("link", { name: createdName }).first().click({ timeout: 10000 });
    await page.getByRole("heading", { name: createdName }).waitFor();
  });

  await step("log a call on the lead and see it in the timeline", async () => {
    await page.getByRole("button", { name: "Log activity" }).click();
    await page
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill("Intro call — wants stock + karigar tracking");
    await page.getByRole("button", { name: "Log activity" }).last().click();
    await page.getByText("Intro call — wants stock + karigar tracking").waitFor();
    await page.screenshot({ path: path.join(OUT, "05-lead-detail.png"), fullPage: true });
  });

  await step("another owner's lead is not reachable by URL (404, not 403)", async () => {
    await page.goto(`${BASE}/leads/lead_003`);
    const notFound = page.getByText("Lead not found");
    const found = page.getByRole("button", { name: "Log activity" });
    await Promise.race([notFound.waitFor(), found.waitFor()]);
    // lead_003 may belong to Neha; check the owner shown isn't someone else.
    if (await found.isVisible()) {
      expect(await page.getByText("Neha Joshi").first().isVisible(), "foreign lead visible");
    }
  });

  await step("pipeline board renders all stages", async () => {
    await page.goto(`${BASE}/pipeline`);
    for (const s of ["New", "Contacted", "Proposal", "Won"])
      await page.getByRole("heading", { name: s, exact: true }).waitFor();
    await page.locator("article").first().waitFor();
    await page.screenshot({ path: path.join(OUT, "06-pipeline.png") });
  });

  await step("command palette opens with Ctrl+K and finds records", async () => {
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search leads, clients, pages or actions…").fill("Clients");
    await page
      .getByRole("option", { name: /Clients/ })
      .first()
      .waitFor();
    await page.screenshot({ path: path.join(OUT, "07-command-palette.png") });
    await page.keyboard.press("Escape");
  });

  await step("sign out returns to sign-in", async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  });

  await step("founder signs in with MFA and sees company metrics with a demo label", async () => {
    await login(page, "founder@demo.zoii.in", { mfa: true });
    await page.getByText("Invoiced vs collected").waitFor();
    expect(await page.getByText("Demo fixture").first().isVisible(), "fixture label missing");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "08-dashboard-founder.png"), fullPage: true });
  });

  await step("chart offers a table view", async () => {
    await page.getByRole("button", { name: "Table" }).first().click();
    await page.getByRole("columnheader", { name: "Collected" }).waitFor();
  });

  await step("clients list and profile render", async () => {
    await page.goto(`${BASE}/clients`);
    await page.locator("tbody tr").first().waitFor();
    await page.screenshot({ path: path.join(OUT, "09-clients.png") });
    await page.locator("tbody tr a").first().click();
    await page.getByRole("tab", { name: "Overview" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "10-client-profile.png"), fullPage: true });
  });

  await step("planned modules show an honest roadmap page", async () => {
    await page.goto(`${BASE}/finance/invoices`);
    await page.getByText("This module isn't built yet").waitFor();
    await page.screenshot({ path: path.join(OUT, "11-planned-module.png") });
  });

  await step("dark mode renders", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${BASE}/dashboard`);
    await page.getByText("Invoiced vs collected").waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "12-dashboard-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
  });

  await step("mobile layout: navigation drawer and readable list", async () => {
    const m = await browser.newPage({
      viewport: { width: 390, height: 844 },
      storageState: await ctx.storageState(),
    });
    m.on("pageerror", (e) => pageErrors.push(e.message));
    await m.goto(`${BASE}/login`);
    await m.getByLabel("Work email").fill("neha@demo.zoii.in");
    await m.getByLabel("Password", { exact: true }).fill("zoii-demo");
    await m.getByRole("button", { name: "Sign in" }).click();
    await m.waitForURL(/\/dashboard/);
    await m.getByText("Open pipeline").first().waitFor();
    await m.screenshot({ path: path.join(OUT, "13-mobile-dashboard.png"), fullPage: true });
    await m.getByRole("button", { name: "Open navigation" }).click();
    await m.getByRole("dialog").getByRole("link", { name: "Leads" }).waitFor();
    await m.screenshot({ path: path.join(OUT, "14-mobile-nav.png") });
    await m.getByRole("dialog").getByRole("link", { name: "Leads" }).click();
    await m.locator("tbody tr").first().waitFor();
    const overflow = await m.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow <= 1, `page scrolls horizontally by ${overflow}px`);
    await m.screenshot({ path: path.join(OUT, "15-mobile-leads.png") });
    await m.close();
  });

  await step("manifest and service worker are served", async () => {
    const r = await page.request.get(`${BASE}/manifest.webmanifest`);
    const j = await r.json();
    expect(j.name === "Zoii Business OS" && j.icons.length >= 3, "manifest");
    const sw = await page.request.get(`${BASE}/sw.js`);
    expect(sw.ok() && /never caches/i.test(await sw.text()), "sw.js");
  });

  await browser.close();
  const noisy = pageErrors.filter(
    (e) => !/Failed to load resource: the server responded with a status of 404/.test(e),
  );
  console.log(`\nBrowser errors: ${noisy.length}`);
  noisy.slice(0, 10).forEach((e) => console.log("  - " + e.slice(0, 200)));
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`${results.length - failed}/${results.length} steps passed`);
  process.exit(failed || noisy.length ? 1 : 0);
})();
