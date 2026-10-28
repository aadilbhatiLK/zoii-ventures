import { AUTOMATION_TRIGGERS, AutomationRuleSchema, type AutomationRule, type AutomationRun } from "@/lib/api/modules/people";
import { OPEN_STAGES } from "@/lib/api/contracts";
import type { z } from "zod";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, need, notify, todayIst } from "../../lib/context";
import { conflict, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";
import { QuotationService } from "../sales/quotations";
import { SubscriptionService } from "../delivery/subscriptions";

type Rule = { id: string; organization_id: string; name: string; trigger: string; conditions: AutomationRule["conditions"]; actions: AutomationRule["actions"]; enabled: boolean; created_at: Date };
type Subject = { entityType: string; entityId: string | null; data: Record<string, unknown> };

/** Loads the record a rule is about, flattened for conditions and recipient resolution. */
async function loadEntity(q: Queryable, type: string, id: string | null): Promise<Record<string, unknown>> {
  if (!id) return {};
  const sql: Record<string, string> = {
    lead: `SELECT l.*, l.owner_id AS owner FROM leads l WHERE l.id = $1`,
    quotation: `SELECT q.*, q.owner_id AS owner, c.account_manager_id FROM quotations q JOIN clients c ON c.id = q.client_id WHERE q.id = $1`,
    invoice: `SELECT i.*, c.account_manager_id, c.account_manager_id AS owner, c.display_name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = $1`,
    receipt: `SELECT r.*, c.account_manager_id, c.account_manager_id AS owner FROM receipts r JOIN clients c ON c.id = r.client_id WHERE r.id = $1`,
    ticket: `SELECT t.*, t.assignee_id AS owner, c.account_manager_id FROM tickets t JOIN clients c ON c.id = t.client_id WHERE t.id = $1`,
    milestone: `SELECT m.*, p.manager_id AS owner, p.name AS project_name, c.account_manager_id FROM milestones m JOIN projects p ON p.id = m.project_id JOIN clients c ON c.id = p.client_id WHERE m.id = $1`,
    sales_order: `SELECT so.*, c.account_manager_id, c.account_manager_id AS owner FROM sales_orders so JOIN clients c ON c.id = so.client_id WHERE so.id = $1`,
  };
  if (!sql[type]) return {};
  return (await q.query<Record<string, unknown>>(sql[type], [id])).rows[0] ?? {};
}

export function matches(conds: AutomationRule["conditions"], data: Record<string, unknown>): boolean {
  return conds.every((c) => {
    const v = c.field.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), data);
    const num = (x: unknown) => (typeof x === "number" ? x : Number(x));
    switch (c.op) {
      case "eq": return String(v) === String(c.value);
      case "neq": return String(v) !== String(c.value);
      case "gte": return num(v) >= num(c.value);
      case "lte": return num(v) <= num(c.value);
      case "in": return Array.isArray(c.value) && c.value.map(String).includes(String(v));
    }
  });
}

async function recipients(q: Queryable, orgId: string, to: string, data: Record<string, unknown>): Promise<string[]> {
  if (to === "owner") return data.owner ? [String(data.owner)] : [];
  if (to === "assignee") return data.assignee_id ? [String(data.assignee_id)] : data.owner ? [String(data.owner)] : [];
  if (to === "account_manager") return data.account_manager_id ? [String(data.account_manager_id)] : [];
  if (to.startsWith("user:")) {
    const id = to.slice(5);
    return (await q.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND status = 'active'`, [id, orgId])).rows.map((r) => r.id);
  }
  if (to.startsWith("role:"))
    return (await q.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id JOIN roles r ON r.id = ura.role_id WHERE u.organization_id = $1 AND u.status = 'active' AND r.key = $2`,
      [orgId, to.slice(5)])).rows.map((r) => r.id);
  return [];
}

const render = (tpl: string, data: Record<string, unknown>) => tpl.replace(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g, (_m, k: string) => String(k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), data) ?? ""));
const HREF: Record<string, (id: string) => string> = { lead: (id) => `/leads/${id}`, quotation: (id) => `/quotations/${id}`, invoice: (id) => `/finance/invoices/${id}`, ticket: (id) => `/support/${id}`, receipt: () => `/finance/receipts`, milestone: () => `/projects`, sales_order: (id) => `/sales-orders/${id}` };

/** Runs one rule against one subject exactly once (unique rule_id + dedupe_key). */
async function fire(deps: Deps, rule: Rule, dedupeKey: string, s: Subject) {
  return deps.db.tx(async (q) => {
    const claim = await q.query(
      `INSERT INTO automation_runs (organization_id, rule_id, dedupe_key, entity_type, entity_id, status) VALUES ($1,$2,$3,$4,$5,'skipped') ON CONFLICT (rule_id, dedupe_key) DO NOTHING RETURNING id`,
      [rule.organization_id, rule.id, dedupeKey, s.entityType, s.entityId]);
    if (!claim.rows.length) return "duplicate";
    if (!matches(rule.conditions, s.data)) {
      await q.query(`UPDATE automation_runs SET detail = 'Conditions not met' WHERE rule_id = $1 AND dedupe_key = $2`, [rule.id, dedupeKey]);
      return "skipped";
    }
    const done: string[] = [];
    for (const act of rule.actions) {
      const users = await recipients(q, rule.organization_id, act.to, s.data);
      const title = render(act.title, s.data), body = render(act.body, s.data);
      for (const u of users) {
        if (act.type === "notify") await notify(q, rule.organization_id, u, { kind: "system", title, body, href: s.entityId && HREF[s.entityType] ? HREF[s.entityType](s.entityId) : "/" });
        else {
          const email = (await q.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [u])).rows[0]?.email;
          if (email) await q.query(`INSERT INTO outbox_messages (organization_id, channel, recipient, template, payload) VALUES ($1,'email',$2,'automation',$3)`, [rule.organization_id, email, JSON.stringify({ title, body })]);
        }
      }
      done.push(`${act.type}→${act.to} (${users.length})`);
    }
    await q.query(`UPDATE automation_runs SET status = 'succeeded', detail = $3, finished_at = now() WHERE rule_id = $1 AND dedupe_key = $2`, [rule.id, dedupeKey, done.join("; ")]);
    return "succeeded";
  }).catch(async (e) => {
    await deps.db.query(
      `INSERT INTO automation_runs (organization_id, rule_id, dedupe_key, entity_type, entity_id, status, detail) VALUES ($1,$2,$3,$4,$5,'failed',$6)
       ON CONFLICT (rule_id, dedupe_key) DO UPDATE SET status = 'failed', detail = EXCLUDED.detail, finished_at = now()`,
      [rule.organization_id, rule.id, dedupeKey, s.entityType, s.entityId, String((e as Error).message).slice(0, 500)]);
    return "failed";
  });
}

/** One worker pass: domain events → rules, scheduled scans, housekeeping and outbox delivery. */
export async function runWorkerOnce(deps: Deps, onlyOrgId?: string) {
  const db = deps.db;
  const today = todayIst(deps.now());
  const stats = { events: 0, fired: 0, scheduled: 0, expiredQuotes: 0, outbox: 0, purged: 0 };
  // run-now from the UI is scoped to the caller's organisation; the background worker passes no org.
  const rules = (await db.query<Rule>(`SELECT * FROM automation_rules WHERE enabled AND ($1::uuid IS NULL OR organization_id = $1)`, [onlyOrgId ?? null])).rows;
  const byTrigger = (org: string, t: string) => rules.filter((r) => r.organization_id === org && r.trigger === t);

  const events = (await db.query<{ id: string; organization_id: string; type: string; entity_type: string; entity_id: string | null; payload: Record<string, unknown>; occurred_at: Date }>(
    `SELECT * FROM domain_events WHERE processed_at IS NULL AND ($1::uuid IS NULL OR organization_id = $1) ORDER BY id LIMIT 200`, [onlyOrgId ?? null])).rows;
  for (const ev of events) {
    // A rule only reacts to events that happened after it was created (no surprise back-fill).
    for (const rule of byTrigger(ev.organization_id, ev.type).filter((r) => new Date(r.created_at) <= new Date(ev.occurred_at))) {
      const data = { ...(await loadEntity(db, ev.entity_type, ev.entity_id)), ...ev.payload, payload: ev.payload };
      if ((await fire(deps, rule, `event:${ev.id}`, { entityType: ev.entity_type, entityId: ev.entity_id, data })) === "succeeded") stats.fired++;
    }
    await db.query(`UPDATE domain_events SET processed_at = now() WHERE id = $1`, [ev.id]);
    stats.events++;
  }

  // Scheduled triggers (deduped per subject per day / per breach).
  const orgs = [...new Set(rules.map((r) => r.organization_id))];
  for (const org of orgs) {
    for (const rule of byTrigger(org, "schedule.invoice_overdue")) {
      const rows = (await db.query<{ id: string }>(`SELECT id FROM invoices WHERE organization_id = $1 AND status IN ('issued','partially_paid') AND due_date < $2::date`, [org, today])).rows;
      for (const r of rows) if ((await fire(deps, rule, `overdue:${r.id}:${today}`, { entityType: "invoice", entityId: r.id, data: { ...(await loadEntity(db, "invoice", r.id)), days_overdue: 0 } })) === "succeeded") stats.scheduled++;
    }
    for (const rule of byTrigger(org, "schedule.ticket_sla_breach")) {
      const rows = (await db.query<{ id: string; kind: string }>(
        `SELECT id, 'response' AS kind FROM tickets WHERE organization_id = $1 AND first_responded_at IS NULL AND first_response_due_at < $2 AND status NOT IN ('resolved','closed')
         UNION ALL SELECT id, 'resolution' FROM tickets WHERE organization_id = $1 AND resolved_at IS NULL AND resolution_due_at < $2 AND status NOT IN ('resolved','closed')`, [org, deps.now()])).rows;
      for (const r of rows) if ((await fire(deps, rule, `sla:${r.id}:${r.kind}`, { entityType: "ticket", entityId: r.id, data: { ...(await loadEntity(db, "ticket", r.id)), breach: r.kind } })) === "succeeded") stats.scheduled++;
    }
    for (const rule of byTrigger(org, "schedule.follow_up_overdue")) {
      const rows = (await db.query<{ id: string }>(`SELECT id FROM leads WHERE organization_id = $1 AND stage = ANY($2) AND next_follow_up_at < $3`, [org, OPEN_STAGES, new Date(`${today}T00:00:00+05:30`)])).rows;
      for (const r of rows) if ((await fire(deps, rule, `fu:${r.id}:${today}`, { entityType: "lead", entityId: r.id, data: await loadEntity(db, "lead", r.id) })) === "succeeded") stats.scheduled++;
    }
  }

  // Cross-organisation housekeeping runs only in the background worker.
  if (!onlyOrgId) {
    stats.expiredQuotes = await db.tx((q) => QuotationService.expire(q, today));
    await db.tx((q) => SubscriptionService.scan(q, today));
    stats.purged = await purgeExpired(deps);
  }

  // Outbox delivery through the configured provider; without one, messages are marked blocked (visible to admins).
  // Claim a batch atomically (lease by pushing next_attempt_at forward) so two workers — or the
  // background worker and a manual run — can never send the same message twice.
  const pending = (await db.query<{ id: string; channel: "email" | "sms"; recipient: string; template: string; payload: Record<string, unknown>; attempts: number }>(
    `UPDATE outbox_messages SET next_attempt_at = now() + interval '10 minutes'
      WHERE id IN (SELECT id FROM outbox_messages WHERE status = 'pending' AND next_attempt_at <= now() AND ($1::uuid IS NULL OR organization_id = $1)
                    ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [onlyOrgId ?? null])).rows;
  for (const m of pending) {
    try {
      const ok = await deps.messages.send({ channel: m.channel, recipient: m.recipient, template: m.template, payload: m.payload });
      await db.query(ok ? `UPDATE outbox_messages SET status = 'sent', sent_at = now(), attempts = attempts + 1, payload = '{}' WHERE id = $1`
        : `UPDATE outbox_messages SET status = 'blocked', last_error = 'No provider configured', attempts = attempts + 1 WHERE id = $1`, [m.id]);
      stats.outbox++;
    } catch (e) {
      await db.query(`UPDATE outbox_messages SET attempts = attempts + 1, last_error = $2, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
                        next_attempt_at = now() + (interval '1 minute' * power(2, attempts + 1)) WHERE id = $1`, [m.id, String((e as Error).message).slice(0, 300)]);
    }
  }
  return stats;
}

/**
 * Retention for security/plumbing rows that nothing references once they're old. Business
 * records, audit events, journals and approvals are never purged. Runs at most hourly.
 */
export const RETENTION_DAYS = { sessions: 30, authAttempts: 30, authChallenges: 7, idempotencyKeys: 30, domainEvents: 90 };
let lastPurge = 0;
export async function purgeExpired(deps: Deps, force = false): Promise<number> {
  const now = deps.now();
  if (!force && now.getTime() - lastPurge < 3_600_000) return 0;
  lastPurge = now.getTime();
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const R = RETENTION_DAYS;
  const steps: [string, Date][] = [
    // Sessions and challenges live hours at most, so expiry is a safe cut-off whether or not they were used.
    [`DELETE FROM sessions WHERE expires_at < $1`, ago(R.sessions)],
    [`DELETE FROM auth_attempts WHERE occurred_at < $1`, ago(R.authAttempts)],
    [`DELETE FROM auth_challenges WHERE expires_at < $1`, ago(R.authChallenges)],
    [`DELETE FROM idempotency_keys WHERE created_at < $1`, ago(R.idempotencyKeys)],
    [`DELETE FROM domain_events WHERE processed_at IS NOT NULL AND processed_at < $1`, ago(R.domainEvents)],
  ];
  let n = 0;
  for (const [sql, before] of steps) n += (await deps.db.query(sql, [before])).rowCount;
  return n;
}

interface RuleRow extends Rule { created_at: Date; last_run: Date | null; runs: number }
export class AutomationService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  triggers() { return Object.entries(AUTOMATION_TRIGGERS).map(([key, label]) => ({ key, label })); }

  async list(a: Actor): Promise<AutomationRule[]> {
    need(a, "automations.manage", "audit.view");
    const r = await this.db.query<RuleRow>(
      `SELECT r.*, (SELECT max(started_at) FROM automation_runs x WHERE x.rule_id = r.id) AS last_run, (SELECT count(*)::int FROM automation_runs x WHERE x.rule_id = r.id AND x.status = 'succeeded') AS runs
         FROM automation_rules r WHERE r.organization_id = $1 ORDER BY r.created_at DESC`, [a.orgId]);
    return r.rows.map((x) => ({ id: x.id, name: x.name, trigger: x.trigger as AutomationRule["trigger"], conditions: x.conditions, actions: x.actions, enabled: x.enabled, createdAt: iso(x.created_at)!, lastRunAt: iso(x.last_run), runs: x.runs }));
  }

  async save(a: Actor, body: unknown, id?: string) {
    need(a, "automations.manage");
    const d: z.output<typeof AutomationRuleSchema> = parse(AutomationRuleSchema, body);
    const rid = await this.db.tx(async (q) => {
      if (id) {
        if (!isUuid(id)) throw notFound("Rule");
        const r = await q.query(`UPDATE automation_rules SET name=$3, trigger=$4, conditions=$5, actions=$6, enabled=$7 WHERE id = $1 AND organization_id = $2 RETURNING id`,
          [id, a.orgId, d.name, d.trigger, JSON.stringify(d.conditions), JSON.stringify(d.actions), d.enabled]);
        if (!r.rows.length) throw notFound("Rule");
        await audit(q, a, "automation.update", "automation_rule", id, d);
        return id;
      }
      const r = await q.query<{ id: string }>(`INSERT INTO automation_rules (organization_id, name, trigger, conditions, actions, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [a.orgId, d.name, d.trigger, JSON.stringify(d.conditions), JSON.stringify(d.actions), d.enabled, a.userId]);
      await audit(q, a, "automation.create", "automation_rule", r.rows[0].id, d);
      return r.rows[0].id;
    });
    return (await this.list(a)).find((x) => x.id === rid)!;
  }

  async remove(a: Actor, id: string) {
    need(a, "automations.manage");
    const r = await this.db.query(`UPDATE automation_rules SET enabled = false WHERE id = $1 AND organization_id = $2 RETURNING id`, [id, a.orgId]);
    if (!r.rows.length) throw notFound("Rule");
    await audit(this.db, a, "automation.disable", "automation_rule", id);
  }

  async runs(a: Actor, ruleId?: string): Promise<AutomationRun[]> {
    need(a, "automations.manage", "audit.view");
    const r = await this.db.query<{ id: string; rule_id: string; name: string; dedupe_key: string; entity_type: string | null; entity_id: string | null; status: AutomationRun["status"]; detail: string | null; started_at: Date }>(
      `SELECT x.*, r.name FROM automation_runs x JOIN automation_rules r ON r.id = x.rule_id WHERE x.organization_id = $1 AND ($2::uuid IS NULL OR x.rule_id = $2) ORDER BY x.started_at DESC LIMIT 200`,
      [a.orgId, ruleId && isUuid(ruleId) ? ruleId : null]);
    return r.rows.map((x) => ({ id: String(x.id), ruleId: x.rule_id, ruleName: x.name, dedupeKey: x.dedupe_key, entityType: x.entity_type, entityId: x.entity_id, status: x.status, detail: x.detail, startedAt: iso(x.started_at)! }));
  }

  async runNow(a: Actor) {
    need(a, "automations.manage");
    if (!a.permissions.has("settings.manage") && !a.roles.includes("founder")) throw conflict("Only admins can trigger the worker manually.");
    return runWorkerOnce(this.deps, a.orgId);
  }
}
