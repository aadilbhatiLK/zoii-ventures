// Visits every module screen as the roles that use it, against a real API (api mode).
// Fails on page errors, console errors, or any API 5xx. Usage:
//   BASE_URL=http://localhost:3000 API_URL=http://localhost:4000 node tests/e2e/modules.cjs
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = path.join(__dirname, "screenshots", "modules");
fs.mkdirSync(SHOTS, { recursive: true });

const ROLES = {
  founder: ["founder@demo.zoii.in", ["/dashboard", "/approvals", "/catalogue", "/documents", "/quotations", "/quotations/new", "/sales-orders", "/subscriptions", "/projects", "/finance", "/finance/invoices", "/finance/receipts", "/finance/bills", "/finance/banking", "/finance/ledger", "/finance/reports", "/finance/periods", "/people", "/people/attendance", "/people/payroll", "/support", "/automations", "/audit", "/reports", "/settings/users"]],
  admin: ["admin@demo.zoii.in", ["/settings", "/automations"]],
  sales1: ["neha@demo.zoii.in", ["/quotations", "/catalogue", "/documents", "/approvals"]],
  dev: ["dev@demo.zoii.in", ["/tasks", "/me", "/people/attendance"]],
};

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const ok = (m) => console.log(`  PASS  ${m}`);

(async () => {
  const browser = await chromium.launch();
  for (const [role, [email, pages]] of Object.entries(ROLES)) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409|422)/.test(m.text())) errors.push(`console: ${m.text()}`); });
    page.on("response", (r) => { if (r.url().includes("/api/v1/") && r.status() >= 500) errors.push(`API ${r.status()} ${r.url()}`); });
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("zoii-demo");
    await page.getByRole("button", { name: "Sign in" }).click();
    const mfa = page.getByLabel("Verification code");
    const step = await Promise.race([
      mfa.waitFor({ timeout: 15000 }).then(() => "mfa"),
      page.waitForURL(/\/dashboard|\/workspace/, { timeout: 15000 }).then(() => "in"),
    ]).catch(() => "timeout");
    if (step === "mfa") { await mfa.fill("000000"); await page.getByRole("button", { name: /Verify/ }).click(); }
    await page.waitForURL(/\/dashboard|\/workspace/, { timeout: 20000 }).catch(() => fail(`${role}: sign-in`));
    for (const p of pages) {
      const before = errors.length;
      await page.goto(`${BASE}${p}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);
      const h1 = await page.locator("h1").first().textContent({ timeout: 8000 }).catch(() => null);
      const denied = await page.getByText("You don't have access").isVisible().catch(() => false);
      const needsBackend = await page.getByText("This module needs the backend").isVisible().catch(() => false);
      if (needsBackend) fail(`${role} ${p}: rendered demo gate in api mode`);
      else if (errors.length > before) fail(`${role} ${p}: ${errors.slice(before).join(" | ")}`);
      else if (!h1 && !denied) fail(`${role} ${p}: no heading`);
      else ok(`${role} ${p} — ${denied ? "access denied" : h1.trim()}`);
      await page.screenshot({ path: path.join(SHOTS, `${role}${p.replace(/\//g, "_")}.png`), fullPage: false });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : "\nall module pages rendered cleanly");
  process.exit(failures ? 1 : 0);
})();
