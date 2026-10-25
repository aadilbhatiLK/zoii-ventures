import { z } from "zod";
import type { Router } from "../../app";
import type { Deps } from "../../lib/context";
import { parse } from "../../lib/errors";
import { normQuery } from "../../lib/query";
import { ClientService } from "./clients";
import { dashboardSummary, listNotifications, markNotificationsRead, search } from "./insights";
import { LeadService } from "./leads";

const LEAD_Q = { arrays: ["stage", "productLine", "ownerId", "source", "priority"], ints: ["page", "pageSize"], json: ["sort"] };

export function crmRoutes(r: Router, deps: Deps) {
  const leads = new LeadService(deps);
  const clients = new ClientService(deps.db);

  r.get("/leads", async ({ actor, query }) => leads.list(actor, normQuery(query, LEAD_Q)));
  r.post("/leads", async ({ actor, body }) => leads.create(actor, body), { status: 201 });
  r.post("/leads/assign", async ({ actor, body }) => leads.assign(actor, body));
  r.post("/leads/stage", async ({ actor, body }) => leads.bulkChangeStage(actor, body));
  r.post("/leads/export", async ({ actor, body }) => leads.export(actor, body ?? {}));
  r.post("/leads/duplicates", async ({ actor, body }) => leads.findDuplicates(actor, body), { rateLimit: { max: 60, timeWindow: "1 minute" } });
  r.get("/leads/:id", async ({ actor, params }) => leads.get(actor, params.id));
  r.patch("/leads/:id", async ({ actor, params, body }) => leads.update(actor, params.id, body));
  r.post("/leads/:id/stage", async ({ actor, params, body }) => leads.changeStage(actor, params.id, body));
  r.get("/leads/:id/activities", async ({ actor, params }) => leads.activities(actor, params.id));
  r.post("/leads/:id/activities", async ({ actor, params, body }) => leads.logActivity(actor, params.id, body), { status: 201 });
  r.post("/leads/:id/follow-ups", async ({ actor, params, body }) => leads.scheduleFollowUp(actor, params.id, body));
  r.post("/leads/:id/follow-ups/complete", async ({ actor, params, body }) => leads.completeFollowUp(actor, params.id, body));
  r.post("/leads/:id/convert", async ({ actor, params, body }) => leads.convert(actor, params.id, body));

  r.get("/clients", async ({ actor, query }) => clients.list(actor, normQuery(query, { arrays: ["status", "category"], ints: ["page", "pageSize"] })));
  r.post("/clients", async ({ actor, body }) => clients.create(actor, body), { status: 201 });
  r.get("/clients/:id", async ({ actor, params }) => clients.get(actor, params.id));
  r.patch("/clients/:id", async ({ actor, params, body }) => clients.update(actor, params.id, body));
  r.get("/clients/:id/timeline", async ({ actor, params }) => clients.timeline(actor, params.id));

  r.get("/dashboard/summary", async ({ actor }) => dashboardSummary(deps, actor));
  r.get("/search", async ({ actor, query }) => search(deps, actor, String(query.q ?? "")));
  r.get("/notifications", async ({ actor }) => listNotifications(deps, actor));
  r.post("/notifications/read", async ({ actor, body }) => {
    const b = parse(z.object({ ids: z.array(z.string().max(64)).max(200) }), body);
    await markNotificationsRead(deps, actor, b.ids);
    return undefined;
  });
}
