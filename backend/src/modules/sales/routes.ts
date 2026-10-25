import type { Router } from "../../app";
import type { Deps } from "../../lib/context";
import { ApprovalService } from "./approvals";
import { CatalogueService } from "./catalogue";
import { DocumentService } from "./documents";
import { QuotationService } from "./quotations";

export function salesRoutes(r: Router, deps: Deps) {
  const cat = new CatalogueService(deps);
  const docs = new DocumentService(deps);
  const quotes = new QuotationService(deps);
  const approvals = new ApprovalService(deps);

  r.get("/products", async ({ actor, query }) => cat.list(actor, query));
  r.post("/products", async ({ actor, body }) => cat.create(actor, body), { status: 201 });
  r.get("/products/:id", async ({ actor, params }) => cat.get(actor, params.id));
  r.put("/products/:id", async ({ actor, params, body }) => cat.update(actor, params.id, body));
  r.get("/products/:id/price-history", async ({ actor, params }) => cat.priceHistory(actor, params.id));
  r.get("/tax-rules", async ({ actor }) => cat.taxRules(actor));
  r.post("/tax-rules", async ({ actor, body }) => cat.addTaxRule(actor, body), { status: 201 });
  r.get("/tax-rules/lookup", async ({ actor, query }) => cat.rateLookup(actor, String(query.hsnSac ?? ""), query.date ? String(query.date) : undefined));

  r.get("/documents", async ({ actor, query }) => docs.list(actor, query));
  r.post("/documents", async ({ actor, body }) => docs.create(actor, body), { status: 201 });
  r.get("/documents/:id", async ({ actor, params }) => docs.get(actor, params.id));
  r.put("/documents/:id/draft", async ({ actor, params, body }) => docs.edit(actor, params.id, body));
  r.post("/documents/:id/versions", async ({ actor, params }) => docs.newVersion(actor, params.id));
  r.post("/documents/:id/submit", async ({ actor, params }) => docs.submit(actor, params.id));
  r.post("/documents/:id/withdraw", async ({ actor, params }) => docs.withdraw(actor, params.id));

  r.get("/approvals", async ({ actor, query }) => approvals.list(actor, query.status ? String(query.status) : undefined));
  r.post("/approvals/:id/decide", async ({ actor, params, body }) => approvals.decide(actor, params.id, body));

  r.get("/quotations", async ({ actor, query }) => quotes.list(actor, query));
  r.post("/quotations", async ({ actor, body }) => quotes.create(actor, body), { status: 201 });
  r.get("/quotations/:id", async ({ actor, params }) => quotes.get(actor, params.id));
  r.put("/quotations/:id", async ({ actor, params, body }) => quotes.update(actor, params.id, body));
  r.post("/quotations/:id/submit", async ({ actor, params }) => quotes.submit(actor, params.id));
  r.post("/quotations/:id/send", async ({ actor, params }) => quotes.send(actor, params.id));
  r.post("/quotations/:id/client-decision", async ({ actor, params, body }) => quotes.clientDecision(actor, params.id, body));
  r.post("/quotations/:id/revise", async ({ actor, params }) => quotes.revise(actor, params.id), { status: 201 });
  r.post("/quotations/:id/cancel", async ({ actor, params }) => quotes.cancel(actor, params.id));
  r.get("/quotations/:id/revisions", async ({ actor, params }) => quotes.revisions(actor, params.id));
  r.raw("GET", "/quotations/:id/pdf", async ({ actor, params, reply }) => {
    const { filename, body } = await quotes.pdf(actor, params.id);
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(body);
  });
}
