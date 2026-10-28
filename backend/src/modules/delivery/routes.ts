import { z } from "zod";
import type { Router } from "../../app";
import type { Deps } from "../../lib/context";
import { parse } from "../../lib/errors";
import { OrderService } from "./orders";
import { ProjectService } from "./projects";
import { SubscriptionService } from "./subscriptions";

export function deliveryRoutes(r: Router, deps: Deps) {
  const orders = new OrderService(deps);
  const projects = new ProjectService(deps);
  const subs = new SubscriptionService(deps);

  r.get("/sales-orders", async ({ actor, query }) => orders.list(actor, query));
  r.get("/sales-orders/:id", async ({ actor, params }) => orders.get(actor, params.id));
  r.post("/sales-orders/:id/status", async ({ actor, params, body }) => orders.setStatus(actor, params.id, parse(z.object({ status: z.enum(["completed", "cancelled"]) }), body).status));

  r.get("/projects", async ({ actor, query }) => projects.list(actor, query));
  r.post("/projects", async ({ actor, body }) => projects.create(actor, body), { status: 201 });
  r.get("/projects/:id", async ({ actor, params }) => projects.get(actor, params.id));
  r.patch("/projects/:id", async ({ actor, params, body }) => projects.update(actor, params.id, body));
  r.post("/projects/:id/activate", async ({ actor, params }) => projects.activate(actor, params.id));
  r.post("/projects/:id/milestones", async ({ actor, params, body }) => projects.addMilestone(actor, params.id, body), { status: 201 });
  r.post("/milestones/:id/status", async ({ actor, params, body }) => projects.setMilestoneStatus(actor, params.id, body));
  r.post("/milestones/:id/uat", async ({ actor, params, body }) => projects.addUat(actor, params.id, body), { status: 201 });
  r.post("/uat/:id/result", async ({ actor, params, body }) => projects.recordUat(actor, params.id, body));
  r.post("/milestones/:id/sign-off", async ({ actor, params, body }) => projects.signOff(actor, params.id, body));
  r.get("/projects/:id/tasks", async ({ actor, params }) => projects.tasks(actor, params.id));
  r.post("/projects/:id/tasks", async ({ actor, params, body }) => projects.addTask(actor, params.id, body), { status: 201 });
  r.get("/tasks/mine", async ({ actor }) => projects.myTasks(actor));
  r.patch("/tasks/:id", async ({ actor, params, body }) => projects.updateTask(actor, params.id, body));
  r.post("/tasks/:id/move", async ({ actor, params, body }) => projects.moveTask(actor, params.id, body));
  r.post("/projects/:id/change-requests", async ({ actor, params, body }) => projects.addChangeRequest(actor, params.id, body), { status: 201 });
  r.post("/change-requests/:id/submit", async ({ actor, params, body }) => projects.submitChangeRequest(actor, params.id, body));

  r.get("/subscriptions", async ({ actor, query }) => subs.list(actor, query));
  r.post("/subscriptions", async ({ actor, body }) => subs.create(actor, body), { status: 201 });
  r.get("/subscriptions/:id", async ({ actor, params }) => subs.get(actor, params.id));
  r.post("/subscriptions/:id/status", async ({ actor, params, body }) => subs.setStatus(actor, params.id, body));
  r.post("/subscriptions/:id/renew", async ({ actor, params, body }) => subs.renew(actor, params.id, body));
}
