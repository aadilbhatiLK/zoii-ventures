import { z } from "zod";
import type { Router } from "../../app";
import { type Deps, todayIst } from "../../lib/context";
import { parse } from "../../lib/errors";
import { BankingService } from "./banking";
import { InvoiceService } from "./invoices";
import { LedgerService } from "./ledger";
import { PayablesService } from "./payables";
import { ReceiptService } from "./receivables";
import { ReportService } from "./reports";
import { need } from "../../lib/context";

export function financeRoutes(r: Router, deps: Deps) {
  const ledger = new LedgerService(deps);
  const inv = new InvoiceService(deps);
  const rec = new ReceiptService(deps);
  const pay = new PayablesService(deps);
  const bank = new BankingService(deps);
  const rep = new ReportService(deps);

  r.get("/finance/accounts", async ({ actor }) => ledger.accounts(actor));
  r.post("/finance/accounts", async ({ actor, body }) => ledger.createAccount(actor, body), { status: 201 });
  r.get("/finance/accounts/:id/ledger", async ({ actor, params, query }) => ledger.ledger(actor, params.id, query.from ? String(query.from) : undefined, query.to ? String(query.to) : undefined));
  r.get("/finance/journals", async ({ actor, query }) => ledger.journals(actor, query));
  r.post("/finance/journals", async ({ actor, body }) => ledger.postManual(actor, body), { status: 201 });
  r.get("/finance/journals/:id", async ({ actor, params }) => ledger.journal(actor, params.id));
  r.post("/finance/journals/:id/reverse", async ({ actor, params, body }) => ledger.reverse(actor, params.id, (body ?? {}) as { date?: string; reason?: string }), { status: 201 });

  r.get("/invoices", async ({ actor, query }) => inv.list(actor, query));
  r.post("/invoices", async ({ actor, body }) => inv.create(actor, body), { status: 201 });
  r.post("/invoices/from-milestone/:id", async ({ actor, params }) => inv.fromMilestone(actor, params.id), { status: 201 });
  r.post("/invoices/from-sales-order/:id", async ({ actor, params }) => inv.fromSalesOrder(actor, params.id), { status: 201 });
  r.post("/invoices/run-billing", async ({ actor }) => { need(actor, "finance.invoice.issue"); return inv.runBilling(actor, todayIst(deps.now())); });
  r.get("/invoices/:id", async ({ actor, params }) => inv.get(actor, params.id));
  r.put("/invoices/:id", async ({ actor, params, body }) => inv.updateDraft(actor, params.id, body));
  r.delete("/invoices/:id", async ({ actor, params }) => inv.deleteDraft(actor, params.id));
  r.post("/invoices/:id/issue", async ({ actor, params }) => inv.issue(actor, params.id));
  r.post("/invoices/:id/credit-notes", async ({ actor, params, body }) => inv.creditNote(actor, params.id, body), { status: 201 });
  r.raw("GET", "/invoices/:id/pdf", async ({ actor, params, reply }) => {
    const { filename, body } = await inv.pdf(actor, params.id);
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(body);
  });

  r.get("/receipts", async ({ actor, query }) => rec.list(actor, query));
  r.post("/receipts", async ({ actor, body, req }) => rec.create(actor, body, req.headers["idempotency-key"] as string | undefined), { status: 201 });
  r.get("/receipts/:id", async ({ actor, params }) => rec.get(actor, params.id));
  r.post("/receipts/:id/allocate", async ({ actor, params, body }) => rec.allocateMore(actor, params.id, body));

  r.get("/vendors", async ({ actor }) => pay.vendors(actor));
  r.post("/vendors", async ({ actor, body }) => pay.createVendor(actor, body), { status: 201 });
  r.get("/bills", async ({ actor, query }) => pay.list(actor, query));
  r.post("/bills", async ({ actor, body }) => pay.create(actor, body), { status: 201 });
  r.get("/bills/:id", async ({ actor, params }) => pay.get(actor, params.id));
  r.post("/bills/:id/payments", async ({ actor, params, body, req }) => pay.pay(actor, params.id, body, req.headers["idempotency-key"] as string | undefined));

  r.post("/bank/import", async ({ actor, body }) => bank.import(actor, body), { status: 201 });
  r.get("/bank/lines", async ({ actor, query }) => bank.lines(actor, query));
  r.get("/bank/summary", async ({ actor, query }) => bank.summary(actor, String(query.bankAccountId ?? "")));
  r.post("/bank/lines/:id/match", async ({ actor, params, body }) => { await bank.match(actor, params.id, parse(z.object({ entryId: z.string() }), body).entryId); return { ok: true }; });
  r.post("/bank/lines/:id/categorize", async ({ actor, params, body }) => { await bank.categorize(actor, params.id, body); return { ok: true }; });
  r.post("/bank/lines/:id/ignore", async ({ actor, params }) => { await bank.ignore(actor, params.id); return { ok: true }; });

  r.get("/reports/trial-balance", async ({ actor, query }) => rep.trialBalance(actor, query));
  r.get("/reports/profit-and-loss", async ({ actor, query }) => rep.profitAndLoss(actor, query));
  r.get("/reports/balance-sheet", async ({ actor, query }) => rep.balanceSheet(actor, query));
  r.get("/reports/cash-flow", async ({ actor, query }) => rep.cashFlow(actor, query));
  r.get("/reports/receivables-ageing", async ({ actor, query }) => rep.receivablesAgeing(actor, query));
  r.get("/reports/payables-ageing", async ({ actor, query }) => rep.payablesAgeing(actor, query));
  r.get("/reports/gst-summary", async ({ actor, query }) => rep.gstSummary(actor, query));
  r.get("/finance/periods", async ({ actor }) => rep.periods(actor));
  r.get("/finance/periods/:month/checks", async ({ actor, params }) => { need(actor, "finance.view"); return rep.closeChecks(actor.orgId, params.month); });
  r.post("/finance/periods/:month/close", async ({ actor, params, body }) => rep.closePeriod(actor, params.month, (body ?? {}) as { force?: boolean }));
  r.post("/finance/periods/:month/reopen", async ({ actor, params, body }) => rep.reopenPeriod(actor, params.month, (body ?? {}) as { reason?: string }));
}
