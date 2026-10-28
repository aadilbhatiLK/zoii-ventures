import { TicketCommentSchema, TicketInputSchema, TicketUpdateSchema, type Ticket } from "@/lib/api/modules/people";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, emit, need, nextNumber, notify } from "../../lib/context";
import { conflict, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";

interface TRow { id: string; organization_id: string; number: string; client_id: string; client_name: string; project_id: string | null; subscription_id: string | null; subject: string; description: string; category: string; priority: Ticket["priority"]; status: Ticket["status"]; channel: string; assignee_id: string | null; first_response_due_at: Date; resolution_due_at: Date; first_responded_at: Date | null; resolved_at: Date | null; closed_at: Date | null; created_at: Date }
const T_SELECT = `SELECT t.*, c.display_name AS client_name FROM tickets t JOIN clients c ON c.id = t.client_id`;

export function slaState(due: Date, done: Date | null, now: Date): "met" | "breached" | "pending" | "at_risk" {
  if (done) return done <= due ? "met" : "breached";
  if (now > due) return "breached";
  return due.getTime() - now.getTime() < 30 * 60_000 ? "at_risk" : "pending";
}

export class TicketService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private toTicket(r: TRow): Ticket {
    const now = this.deps.now();
    return {
      id: r.id, number: r.number, clientId: r.client_id, clientName: r.client_name, projectId: r.project_id, subscriptionId: r.subscription_id, subject: r.subject, description: r.description,
      category: r.category, priority: r.priority, status: r.status, channel: r.channel, assigneeId: r.assignee_id, firstResponseDueAt: iso(r.first_response_due_at)!, resolutionDueAt: iso(r.resolution_due_at)!,
      firstRespondedAt: iso(r.first_responded_at), resolvedAt: iso(r.resolved_at), closedAt: iso(r.closed_at), createdAt: iso(r.created_at)!,
      sla: { firstResponse: slaState(new Date(r.first_response_due_at), r.first_responded_at ? new Date(r.first_responded_at) : null, now), resolution: slaState(new Date(r.resolution_due_at), r.resolved_at ? new Date(r.resolved_at) : null, now) },
    };
  }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "support.view", "support.manage");
    const params: unknown[] = [a.orgId];
    const where = ["t.organization_id = $1"];
    if (query.status === "open") where.push(`t.status NOT IN ('resolved','closed')`);
    else if (query.status) { params.push(String(query.status)); where.push(`t.status = $${params.length}`); }
    if (query.mine === "true") { params.push(a.userId); where.push(`t.assignee_id = $${params.length}`); }
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`t.client_id = $${params.length}`); }
    if (query.search) { params.push(likeTerm(String(query.search).toLowerCase())); where.push(`(lower(t.subject) LIKE $${params.length} OR lower(t.number) LIKE $${params.length} OR lower(c.display_name) LIKE $${params.length})`); }
    const r = await this.db.query<TRow>(`${T_SELECT} WHERE ${where.join(" AND ")} ORDER BY (t.status IN ('resolved','closed')), t.resolution_due_at LIMIT 500`, params);
    return r.rows.map((x) => this.toTicket(x));
  }

  async get(a: Actor, id: string, q: Queryable = this.db) {
    need(a, "support.view", "support.manage");
    if (!isUuid(id)) throw notFound("Ticket");
    const r = (await q.query<TRow>(`${T_SELECT} WHERE t.id = $1 AND t.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Ticket");
    const c = await q.query<{ id: string; author_id: string; body: string; internal: boolean; created_at: Date }>(`SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at`, [id]);
    return { ...this.toTicket(r), comments: c.rows.map((x) => ({ id: x.id, authorId: x.author_id, body: x.body, internal: x.internal, createdAt: iso(x.created_at)! })) };
  }

  async create(a: Actor, body: unknown) {
    need(a, "support.manage");
    const d = parse(TicketInputSchema, body);
    const id = await this.db.tx(async (q) => {
      if (!(await q.query(`SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2`, [d.clientId, a.orgId])).rows.length) throw invalid("Unknown client.", { clientId: ["Unknown"] });
      if (d.projectId && !(await q.query(`SELECT 1 FROM projects WHERE id = $1 AND client_id = $2`, [d.projectId, d.clientId])).rows.length) throw invalid("That project belongs to another client.", { projectId: ["Mismatch"] });
      if (d.subscriptionId && !(await q.query(`SELECT 1 FROM subscriptions WHERE id = $1 AND client_id = $2 AND organization_id = $3`, [d.subscriptionId, d.clientId, a.orgId])).rows.length) throw invalid("That subscription belongs to another client.", { subscriptionId: ["Mismatch"] });
      const sla = (await q.query<{ first_response_minutes: number; resolution_minutes: number }>(`SELECT * FROM sla_policies WHERE organization_id = $1 AND priority = $2`, [a.orgId, d.priority])).rows[0];
      if (!sla) throw conflict("No SLA policy for this priority. Ask an admin to configure SLAs.");
      const now = this.deps.now();
      const n = await nextNumber(q, a.orgId, "ticket");
      const r = await q.query<{ id: string }>(
        `INSERT INTO tickets (organization_id, number, client_id, project_id, subscription_id, subject, description, category, priority, channel, assignee_id, first_response_due_at, resolution_due_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [a.orgId, `TKT-${String(n).padStart(5, "0")}`, d.clientId, d.projectId ?? null, d.subscriptionId ?? null, d.subject, d.description, d.category, d.priority, d.channel, d.assigneeId ?? null,
         new Date(now.getTime() + sla.first_response_minutes * 60_000), new Date(now.getTime() + sla.resolution_minutes * 60_000), a.userId, now]);
      if (d.assigneeId && d.assigneeId !== a.userId) await notify(q, a.orgId, d.assigneeId, { kind: "assignment", title: `Ticket assigned: ${d.subject}`, href: `/support/${r.rows[0].id}` });
      await audit(q, a, "ticket.create", "ticket", r.rows[0].id, { priority: d.priority, clientId: d.clientId });
      await emit(q, a, "ticket.created", "ticket", r.rows[0].id, { priority: d.priority, category: d.category });
      return r.rows[0].id;
    });
    return this.get(a, id);
  }

  async update(a: Actor, id: string, body: unknown) {
    need(a, "support.manage");
    const d = parse(TicketUpdateSchema, body);
    await this.db.tx(async (q) => {
      const t = (await q.query<TRow>(`${T_SELECT} WHERE t.id = $1 AND t.organization_id = $2 FOR UPDATE OF t`, [id, a.orgId])).rows[0];
      if (!t) throw notFound("Ticket");
      if (t.status === "closed") throw conflict("Closed tickets can't change. Open a new ticket.");
      const now = this.deps.now();
      const status = d.status ?? t.status;
      const resolved = status === "resolved" || status === "closed" ? (t.resolved_at ?? now) : null;
      // Working on a ticket counts as the first response.
      const firstResp = t.first_responded_at ?? (status !== "open" ? now : null);
      let firstDue = t.first_response_due_at, resDue = t.resolution_due_at;
      if (d.priority && d.priority !== t.priority) {
        const sla = (await q.query<{ first_response_minutes: number; resolution_minutes: number }>(`SELECT * FROM sla_policies WHERE organization_id = $1 AND priority = $2`, [a.orgId, d.priority])).rows[0];
        if (!sla) throw conflict("No SLA policy for this priority. Ask an admin to configure SLAs.");
        firstDue = new Date(new Date(t.created_at).getTime() + sla.first_response_minutes * 60_000);
        resDue = new Date(new Date(t.created_at).getTime() + sla.resolution_minutes * 60_000);
      }
      await q.query(
        `UPDATE tickets SET status = $2, assignee_id = CASE WHEN $3 THEN $4::uuid ELSE assignee_id END, priority = coalesce($5, priority), resolved_at = $6, closed_at = $7, first_responded_at = $8,
                first_response_due_at = $9, resolution_due_at = $10 WHERE id = $1`,
        [id, status, d.assigneeId !== undefined, d.assigneeId ?? null, d.priority ?? null, resolved, status === "closed" ? now : null, firstResp, firstDue, resDue]);
      if (d.assigneeId && d.assigneeId !== t.assignee_id && d.assigneeId !== a.userId) await notify(q, a.orgId, d.assigneeId, { kind: "assignment", title: `Ticket assigned: ${t.subject}`, href: `/support/${id}` });
      await audit(q, a, "ticket.update", "ticket", id, { status: d.status ? { from: t.status, to: d.status } : undefined, assigneeId: d.assigneeId, priority: d.priority });
    });
    return this.get(a, id);
  }

  async comment(a: Actor, id: string, body: unknown) {
    need(a, "support.manage");
    const d = parse(TicketCommentSchema, body);
    await this.db.tx(async (q) => {
      const t = (await q.query<TRow>(`SELECT * FROM tickets WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!t) throw notFound("Ticket");
      if (t.status === "closed") throw conflict("This ticket is closed.");
      await q.query(`INSERT INTO ticket_comments (organization_id, ticket_id, author_id, body, internal, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [a.orgId, id, a.userId, d.body, d.internal, this.deps.now()]);
      if (!d.internal && !t.first_responded_at) await q.query(`UPDATE tickets SET first_responded_at = $2 WHERE id = $1`, [id, this.deps.now()]);
    });
    return this.get(a, id);
  }

  async slaPolicies(a: Actor) {
    need(a, "support.view", "support.manage");
    return (await this.db.query(`SELECT priority, first_response_minutes AS "firstResponseMinutes", resolution_minutes AS "resolutionMinutes" FROM sla_policies WHERE organization_id = $1 ORDER BY resolution_minutes`, [a.orgId])).rows;
  }
}
