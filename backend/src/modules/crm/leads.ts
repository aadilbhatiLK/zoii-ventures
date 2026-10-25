import {
  ConvertLeadInputSchema, LeadInputSchema, LeadListQuerySchema, LeadStageSchema, LogActivityInputSchema,
  OPEN_STAGES, stageMeta, type Activity, type Client, type DuplicateCheckResult, type Lead, type LeadStage,
} from "@/lib/api/contracts";
import { can, leadScope } from "@/lib/permissions";
import { fromPaise, sum, toPaise } from "@/lib/money";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, emit, need, nextNumber, notify } from "../../lib/context";
import { HttpError, conflict, forbidden, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";
import { assignableUsers } from "../users/routes";
import { createClientRecord, getClient } from "./clients";

export interface LeadRow {
  id: string; code: string; contact_name: string; company: string | null; email: string | null; phone: string;
  city: string | null; source: Lead["source"]; campaign: string | null; stage: LeadStage; priority: Lead["priority"];
  score: number; estimated_value: string; owner_id: string; next_follow_up_at: Date | null; closed_at: Date | null;
  lost_reason: string | null; client_id: string | null; notes: string | null; created_at: Date; updated_at: Date;
  created_by: string | null; product_interest: Lead["productInterest"];
}

export const LEAD_SELECT = `SELECT l.*, coalesce((SELECT array_agg(p.product_line ORDER BY p.product_line) FROM lead_product_interests p WHERE p.lead_id = l.id), '{}') AS product_interest FROM leads l`;

export function toLead(r: LeadRow): Lead {
  return {
    id: r.id, code: r.code, name: r.contact_name, company: r.company, email: r.email, phone: r.phone, city: r.city,
    productInterest: r.product_interest, source: r.source, campaign: r.campaign, stage: r.stage, priority: r.priority,
    score: r.score, estimatedValue: r.estimated_value, ownerId: r.owner_id, nextFollowUpAt: iso(r.next_follow_up_at),
    closedAt: iso(r.closed_at), lostReason: r.lost_reason, clientId: r.client_id, notes: r.notes,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, createdById: r.created_by ?? r.owner_id,
  };
}

/** SQL predicate for the caller's record-level lead scope. Params start at $idx. */
export function scopeSql(a: Actor, idx: number): { sql: string; params: unknown[] } {
  switch (leadScope(a)) {
    case "all": return { sql: "TRUE", params: [] };
    case "team":
      return a.teamId
        ? { sql: `(l.owner_id = $${idx} OR l.owner_id IN (SELECT id FROM users WHERE team_id = $${idx + 1}))`, params: [a.userId, a.teamId] }
        : { sql: `l.owner_id = $${idx}`, params: [a.userId] };
    case "own": return { sql: `l.owner_id = $${idx}`, params: [a.userId] };
    default: return { sql: "FALSE", params: [] };
  }
}

/** Start of "today" in India Standard Time (UTC+05:30, no DST). */
export function istDayStart(now: Date): Date {
  const off = 330 * 60_000;
  const local = new Date(now.getTime() + off);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - off);
}

const scoreFor = (l: { priority: string; estimatedValue: string; source: string }) => {
  const base = l.priority === "high" ? 60 : l.priority === "medium" ? 40 : 22;
  const v = Number(l.estimatedValue);
  const valueBonus = v >= 5_00_000 ? 20 : v >= 1_50_000 ? 12 : v >= 50_000 ? 6 : 0;
  const sourceBonus = l.source === "referral" || l.source === "partner" ? 14 : l.source === "website" || l.source === "whatsapp" ? 7 : 0;
  return Math.min(99, base + valueBonus + sourceBonus);
};
const closedStage = (s: LeadStage) => s === "won" || s === "lost";
const normCompany = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(pvtltd|privatelimited|llp|ltd)$/, "");
const SORT_COLS: Record<string, string> = {
  createdAt: "l.created_at", estimatedValue: "l.estimated_value", score: "l.score", nextFollowUpAt: "l.next_follow_up_at", name: "lower(l.contact_name)",
};

export class LeadService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private now() { return this.deps.now(); }

  private buildFilter(a: Actor, raw: unknown) {
    if (leadScope(a) === "none") throw forbidden("You don't have access to leads.");
    const q = parse(LeadListQuerySchema, raw);
    const where: string[] = ["l.organization_id = $1"];
    const params: unknown[] = [a.orgId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const sc = scopeSql(a, params.length + 1);
    params.push(...sc.params);
    where.push(sc.sql);
    const dayStart = istDayStart(this.now());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const open = () => `l.stage = ANY(${p(OPEN_STAGES)})`;
    switch (q.view) {
      case "mine": where.push(`l.owner_id = ${p(a.userId)}`); break;
      case "open": where.push(open()); break;
      case "due_today": where.push(`l.next_follow_up_at >= ${p(dayStart)} AND l.next_follow_up_at < ${p(dayEnd)}`); break;
      case "overdue": where.push(`l.next_follow_up_at < ${p(dayStart)}`, open()); break;
      case "hot": where.push(open(), `(l.priority = 'high' OR l.score >= 70)`); break;
    }
    if (q.search) {
      const t = likeTerm(q.search.toLowerCase());
      const digits = q.search.replace(/\D/g, "");
      const tp = p(t);
      where.push(`(lower(l.contact_name) LIKE ${tp} OR lower(coalesce(l.company,'')) LIKE ${tp} OR coalesce(l.email,'') LIKE ${tp}
        OR lower(l.code) LIKE ${tp} OR lower(coalesce(l.city,'')) LIKE ${tp}
        ${digits.length >= 4 ? `OR regexp_replace(l.phone, '[^0-9]', '', 'g') LIKE ${p(`%${digits}%`)}` : ""})`);
    }
    if (q.stage?.length) where.push(`l.stage = ANY(${p(q.stage)})`);
    if (q.productLine?.length) where.push(`EXISTS (SELECT 1 FROM lead_product_interests x WHERE x.lead_id = l.id AND x.product_line = ANY(${p(q.productLine)}))`);
    if (q.ownerId?.length) where.push(`l.owner_id::text = ANY(${p(q.ownerId)})`);
    if (q.source?.length) where.push(`l.source = ANY(${p(q.source)})`);
    if (q.priority?.length) where.push(`l.priority = ANY(${p(q.priority)})`);
    const sort = q.sort ?? { field: "createdAt" as const, dir: "desc" as const };
    const order = `${SORT_COLS[sort.field]} ${sort.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, l.id`;
    return { q, where: where.join(" AND "), params, order };
  }

  async list(a: Actor, raw: unknown) {
    const { q, where, params, order } = this.buildFilter(a, raw);
    const agg = await this.db.query<{ n: string; v: string | null }>(`SELECT count(*) AS n, sum(l.estimated_value) AS v FROM leads l WHERE ${where}`, params);
    const rows = await this.db.query<LeadRow>(
      `${LEAD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`, params,
    );
    return {
      items: rows.rows.map(toLead), total: Number(agg.rows[0].n), page: q.page, pageSize: q.pageSize,
      totalValue: fromPaise(toPaise(agg.rows[0].v ?? "0")),
    };
  }

  async export(a: Actor, raw: unknown) {
    need(a, "leads.export");
    const LIMIT = 5000;
    const { where, params, order } = this.buildFilter(a, { ...(raw as object), page: 1, pageSize: 50 });
    const total = Number((await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM leads l WHERE ${where}`, params)).rows[0].n);
    const rows = await this.db.query<LeadRow>(`${LEAD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${LIMIT}`, params);
    await audit(this.db, a, "lead.export", "lead", null, { rows: rows.rows.length, filters: raw as object });
    return { rows: rows.rows.map(toLead), total, truncated: total > LIMIT };
  }

  async findRow(q: Queryable, a: Actor, id: string, lock = false): Promise<LeadRow> {
    if (!isUuid(id)) throw notFound("Lead");
    const sc = scopeSql(a, 3);
    const r = await q.query<LeadRow>(
      `${LEAD_SELECT} WHERE l.id = $1 AND l.organization_id = $2 AND ${sc.sql}${lock ? " FOR UPDATE OF l" : ""}`,
      [id, a.orgId, ...sc.params],
    );
    if (!r.rows[0]) throw notFound("Lead");
    return r.rows[0];
  }
  private async editable(q: Queryable, a: Actor, id: string) {
    const row = await this.findRow(q, a, id, true);
    if (!can(a, "leads.update")) throw forbidden("You can view this lead but not change it.");
    return row;
  }

  async get(a: Actor, id: string) { return toLead(await this.findRow(this.db, a, id)); }

  private async addActivity(q: Queryable, a: Actor, x: { leadId?: string; clientId?: string; type: Activity["type"]; summary: string; body?: string | null; meta?: Record<string, string>; occurredAt?: string }) {
    const r = await q.query<ActivityRow>(
      `INSERT INTO activities (organization_id, lead_id, client_id, type, summary, body, actor_id, occurred_at, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()),$9) RETURNING *`,
      [a.orgId, x.leadId ?? null, x.clientId ?? null, x.type, x.summary, x.body ?? null, a.userId, x.occurredAt ?? null, JSON.stringify(x.meta ?? {})],
    );
    return toActivity(r.rows[0]);
  }

  private async userName(q: Queryable, id: string) {
    return (await q.query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [id])).rows[0]?.full_name ?? "owner";
  }

  private async checkOwner(a: Actor, ownerId: string) {
    if (!(await assignableUsers(this.deps, a)).some((u) => u.id === ownerId)) throw forbidden("You can't assign leads to that person.");
  }

  private async setInterests(q: Queryable, orgId: string, leadId: string, lines: string[]) {
    await q.query(`DELETE FROM lead_product_interests WHERE lead_id = $1`, [leadId]);
    await q.query(
      `INSERT INTO lead_product_interests (organization_id, lead_id, product_line) SELECT $1, $2, unnest($3::text[])`,
      [orgId, leadId, [...new Set(lines)]],
    );
  }

  async create(a: Actor, input: unknown) {
    need(a, "leads.create");
    const d = parse(LeadInputSchema, input);
    if (d.ownerId !== a.userId) await this.checkOwner(a, d.ownerId);
    else if (!isUuid(d.ownerId)) throw forbidden("You can't assign leads to that person.");
    const id = await this.db.tx(async (q) => {
      const n = await nextNumber(q, a.orgId, "lead");
      const r = await q.query<{ id: string }>(
        `INSERT INTO leads (organization_id, code, contact_name, company, email, phone, city, source, campaign, priority, score,
                            estimated_value, owner_id, next_follow_up_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [a.orgId, `LD-${1000 + n}`, d.name, d.company ?? null, d.email ?? null, d.phone, d.city ?? null, d.source, d.campaign ?? null,
         d.priority, scoreFor(d), d.estimatedValue, d.ownerId, d.nextFollowUpAt ?? null, d.notes ?? null, a.userId],
      );
      const id = r.rows[0].id;
      await this.setInterests(q, a.orgId, id, d.productInterest);
      if (d.nextFollowUpAt) await this.openFollowUp(q, a, id, d.ownerId, d.nextFollowUpAt, null);
      await this.addActivity(q, a, { leadId: id, type: "created", summary: "Lead created" });
      if (d.ownerId !== a.userId) {
        await this.addActivity(q, a, { leadId: id, type: "assignment", summary: `Assigned to ${await this.userName(q, d.ownerId)}`, meta: { to: d.ownerId } });
        await notify(q, a.orgId, d.ownerId, { kind: "assignment", title: `New lead assigned: ${d.company ?? d.name}`, body: `Assigned by ${await this.userName(q, a.userId)}`, href: `/leads/${id}` });
      }
      await audit(q, a, "lead.create", "lead", id, { ...d, expectedUpdatedAt: undefined });
      await emit(q, a, "lead.created", "lead", id, { ownerId: d.ownerId, source: d.source });
      return id;
    });
    return this.get(a, id);
  }

  /** Keeps follow_ups (history) and leads.next_follow_up_at in step. */
  private async openFollowUp(q: Queryable, a: Actor, leadId: string, assignee: string, at: string | null, note: string | null) {
    await q.query(`UPDATE follow_ups SET completed_at = now(), outcome = 'Rescheduled' WHERE lead_id = $1 AND completed_at IS NULL`, [leadId]);
    if (at) {
      await q.query(
        `INSERT INTO follow_ups (organization_id, lead_id, assigned_to, due_at, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [a.orgId, leadId, assignee, at, note, a.userId],
      );
    }
  }

  private assertFresh(row: LeadRow, expected?: string) {
    if (expected && iso(row.updated_at) !== new Date(expected).toISOString())
      throw conflict("Someone else changed this record after you opened it. Reload to see their changes, then try again.");
  }

  async update(a: Actor, id: string, input: unknown) {
    const d = parse(LeadInputSchema, input);
    await this.db.tx(async (q) => {
      const row = await this.editable(q, a, id);
      this.assertFresh(row, d.expectedUpdatedAt);
      if (closedStage(row.stage) && d.nextFollowUpAt) throw conflict("Closed leads don't take follow-ups.");
      if (d.ownerId !== row.owner_id) {
        need(a, "leads.assign");
        await this.checkOwner(a, d.ownerId);
      }
      await q.query(
        `UPDATE leads SET contact_name=$2, company=$3, email=$4, phone=$5, city=$6, source=$7, campaign=$8, priority=$9,
                estimated_value=$10, owner_id=$11, next_follow_up_at=$12, notes=$13, score=$14 WHERE id = $1`,
        [id, d.name, d.company ?? null, d.email ?? null, d.phone, d.city ?? null, d.source, d.campaign ?? null, d.priority,
         d.estimatedValue, d.ownerId, d.nextFollowUpAt ?? null, d.notes ?? null, scoreFor(d)],
      );
      await this.setInterests(q, a.orgId, id, d.productInterest);
      const prevAt = iso(row.next_follow_up_at);
      const nextAt = d.nextFollowUpAt ? new Date(d.nextFollowUpAt).toISOString() : null;
      if (prevAt !== nextAt || d.ownerId !== row.owner_id) await this.openFollowUp(q, a, id, d.ownerId, nextAt, null);
      if (d.ownerId !== row.owner_id) {
        await this.addActivity(q, a, { leadId: id, type: "assignment", summary: `Reassigned to ${await this.userName(q, d.ownerId)}`, meta: { from: row.owner_id, to: d.ownerId } });
        if (d.ownerId !== a.userId) await notify(q, a.orgId, d.ownerId, { kind: "assignment", title: `Lead assigned: ${d.company ?? d.name}`, href: `/leads/${id}` });
      }
      await this.addActivity(q, a, { leadId: id, type: "updated", summary: "Lead details updated" });
      await audit(q, a, "lead.update", "lead", id, diff(toLead(row), { ...d, expectedUpdatedAt: undefined }));
    });
    return this.get(a, id);
  }

  async assign(a: Actor, body: unknown) {
    need(a, "leads.assign");
    const { ids, ownerId } = parse(assignSchema, body);
    await this.checkOwner(a, ownerId);
    const name = await this.userName(this.db, ownerId);
    return this.db.tx(async (q) => {
      const rows = [];
      for (const id of ids) rows.push(await this.editable(q, a, id)); // all-or-nothing
      let updated = 0;
      for (const row of rows) {
        if (row.owner_id === ownerId) continue;
        await q.query(`UPDATE leads SET owner_id = $2 WHERE id = $1`, [row.id, ownerId]);
        await q.query(`UPDATE follow_ups SET assigned_to = $2 WHERE lead_id = $1 AND completed_at IS NULL`, [row.id, ownerId]);
        await this.addActivity(q, a, { leadId: row.id, type: "assignment", summary: `Assigned to ${name}`, meta: { from: row.owner_id, to: ownerId } });
        await audit(q, a, "lead.assign", "lead", row.id, { ownerId: { from: row.owner_id, to: ownerId } });
        updated++;
      }
      if (updated && ownerId !== a.userId) await notify(q, a.orgId, ownerId, { kind: "assignment", title: `${updated} lead${updated > 1 ? "s" : ""} assigned to you`, href: "/leads?view=mine" });
      return { updated };
    });
  }

  async changeStage(a: Actor, id: string, body: unknown) {
    const b = parse(stageSchema, body);
    const stage = b.stage;
    await this.db.tx(async (q) => {
      const row = await this.editable(q, a, id);
      if (stage === "won" && !row.client_id) throw conflict("Use “Convert to client” to mark a lead as won, so the client record is created with it.");
      if (stage === "lost" && !b.lostReason?.trim()) throw invalid("A lost reason is required.", { lostReason: ["Pick a reason"] });
      if (row.client_id && stage !== "won") throw conflict("This lead is already converted to a client.");
      if (row.stage === stage) return;
      const closedAt = closedStage(stage) ? (row.closed_at && closedStage(row.stage) ? row.closed_at : this.now()) : null;
      await q.query(
        `UPDATE leads SET stage = $2, lost_reason = $3, closed_at = $4, next_follow_up_at = CASE WHEN $5 THEN NULL ELSE next_follow_up_at END WHERE id = $1`,
        [id, stage, stage === "lost" ? b.lostReason!.trim() : null, closedAt, closedStage(stage)],
      );
      if (closedStage(stage)) await this.openFollowUp(q, a, id, row.owner_id, null, null);
      await this.addActivity(q, a, {
        leadId: id, type: "stage_change", summary: `Stage moved from ${stageMeta(row.stage).label} to ${stageMeta(stage).label}`,
        body: stage === "lost" ? `Reason: ${b.lostReason!.trim()}` : null, meta: { from: row.stage, to: stage },
      });
      await audit(q, a, "lead.stage", "lead", id, { stage: { from: row.stage, to: stage } });
      await emit(q, a, "lead.stage_changed", "lead", id, { from: row.stage, to: stage });
    });
    return this.get(a, id);
  }

  async bulkChangeStage(a: Actor, body: unknown) {
    const { ids, stage } = parse(bulkStageSchema, body);
    if (closedStage(stage)) throw invalid("Won needs a conversion and Lost needs a reason, so move those one lead at a time.");
    return this.db.tx(async (q) => {
      const rows = [];
      for (const id of ids) rows.push(await this.editable(q, a, id));
      const converted = rows.filter((l) => l.client_id);
      if (converted.length) throw conflict(`${converted.map((l) => l.code).join(", ")} ${converted.length > 1 ? "are" : "is"} already converted. Deselect and retry.`);
      let updated = 0;
      for (const row of rows) {
        if (row.stage === stage) continue;
        await q.query(`UPDATE leads SET stage = $2, lost_reason = NULL, closed_at = NULL WHERE id = $1`, [row.id, stage]);
        await this.addActivity(q, a, { leadId: row.id, type: "stage_change", summary: `Stage moved from ${stageMeta(row.stage).label} to ${stageMeta(stage).label}`, meta: { from: row.stage, to: stage } });
        await audit(q, a, "lead.stage", "lead", row.id, { stage: { from: row.stage, to: stage } });
        updated++;
      }
      return { updated };
    });
  }

  async findDuplicates(a: Actor, body: unknown): Promise<DuplicateCheckResult> {
    need(a, "leads.create", "leads.update");
    const b = parse(dupSchema, body);
    const phone = b.phone ? b.phone.replace(/\D/g, "").slice(-10) : "";
    const email = b.email ? b.email.trim().toLowerCase() : "";
    const company = b.company ? normCompany(b.company) : "";
    const conds: string[] = [];
    const params: unknown[] = [a.orgId, b.excludeId && isUuid(b.excludeId) ? b.excludeId : null];
    if (phone.length === 10) { params.push(phone); conds.push(`l.phone_last10 = $${params.length}`); }
    if (email) { params.push(email); conds.push(`l.email = $${params.length}`); }
    // company_normalized keeps legal suffixes; compare on a stripped prefix and refine in code.
    if (company.length >= 4) { params.push(`${company}%`); conds.push(`l.company_normalized LIKE $${params.length}`); }
    if (!conds.length) return { matches: [], hiddenMatchCount: 0 };
    const rows = (await this.db.query<LeadRow>(
      `${LEAD_SELECT} WHERE l.organization_id = $1 AND ($2::uuid IS NULL OR l.id <> $2) AND (${conds.join(" OR ")}) LIMIT 200`, params,
    )).rows;
    const sc = scopeSql(a, 2);
    const visibleIds = new Set(rows.length ? (await this.db.query<{ id: string }>(
      `SELECT l.id FROM leads l WHERE l.id = ANY($1) AND ${sc.sql}`, [rows.map((r) => r.id), ...sc.params],
    )).rows.map((r) => r.id) : []);
    const matches = rows.map((l) => {
      const on: ("phone" | "email" | "company")[] = [];
      if (phone.length === 10 && l.phone.replace(/\D/g, "").slice(-10) === phone) on.push("phone");
      if (email && l.email === email) on.push("email");
      if (company.length >= 4 && l.company && normCompany(l.company) === company) on.push("company");
      return { l, on };
    }).filter((m) => m.on.length);
    const visible = matches.filter((m) => visibleIds.has(m.l.id));
    return {
      matches: visible.map((m) => ({
        lead: { id: m.l.id, code: m.l.code, name: m.l.contact_name, company: m.l.company, phone: m.l.phone, email: m.l.email, stage: m.l.stage },
        matchedOn: m.on,
      })),
      hiddenMatchCount: matches.length - visible.length,
    };
  }

  async activities(a: Actor, id: string) {
    await this.findRow(this.db, a, id);
    const r = await this.db.query<ActivityRow>(`SELECT * FROM activities WHERE lead_id = $1 ORDER BY occurred_at DESC, id`, [id]);
    return r.rows.map(toActivity);
  }

  async logActivity(a: Actor, id: string, body: unknown) {
    const d = parse(LogActivityInputSchema, body);
    return this.db.tx(async (q) => {
      await this.editable(q, a, id);
      return this.addActivity(q, a, { leadId: id, type: d.type, summary: d.summary, body: d.body ?? null, occurredAt: d.occurredAt });
    });
  }

  async scheduleFollowUp(a: Actor, id: string, body: unknown) {
    const b = parse(followUpSchema, body);
    await this.db.tx(async (q) => {
      const row = await this.editable(q, a, id);
      if (!OPEN_STAGES.includes(row.stage)) throw conflict("Closed leads don't take follow-ups.");
      await q.query(`UPDATE leads SET next_follow_up_at = $2 WHERE id = $1`, [id, b.at]);
      await this.openFollowUp(q, a, id, row.owner_id, b.at, b.note?.trim() || null);
      await this.addActivity(q, a, { leadId: id, type: "follow_up_scheduled", summary: "Follow-up scheduled", body: b.note?.trim() || null, meta: { at: new Date(b.at).toISOString() } });
      await audit(q, a, "lead.follow_up", "lead", id, { nextFollowUpAt: { from: iso(row.next_follow_up_at), to: b.at } });
    });
    return this.get(a, id);
  }

  async completeFollowUp(a: Actor, id: string, body: unknown) {
    const b = parse(completeSchema, body);
    await this.db.tx(async (q) => {
      const row = await this.editable(q, a, id);
      if (b.nextAt && !OPEN_STAGES.includes(row.stage)) throw conflict("Closed leads don't take follow-ups.");
      await q.query(`UPDATE follow_ups SET completed_at = now(), outcome = $2 WHERE lead_id = $1 AND completed_at IS NULL`, [id, b.outcome.trim()]);
      await q.query(`UPDATE leads SET next_follow_up_at = $2 WHERE id = $1`, [id, b.nextAt]);
      if (b.nextAt) await q.query(
        `INSERT INTO follow_ups (organization_id, lead_id, assigned_to, due_at, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [a.orgId, id, row.owner_id, b.nextAt, a.userId],
      );
      await this.addActivity(q, a, { leadId: id, type: "follow_up_completed", summary: "Follow-up completed", body: b.outcome.trim(), meta: b.nextAt ? { next: new Date(b.nextAt).toISOString() } : {} });
      await audit(q, a, "lead.follow_up_complete", "lead", id, { outcome: b.outcome.trim() });
    });
    return this.get(a, id);
  }

  async convert(a: Actor, id: string, body: unknown): Promise<{ lead: Lead; client: Client }> {
    need(a, "leads.convert");
    need(a, "clients.create");
    const d = parse(ConvertLeadInputSchema, body);
    const clientId = await this.db.tx(async (q) => {
      const row = await this.editable(q, a, id);
      if (row.client_id) throw conflict("This lead is already converted.");
      if (row.stage === "lost") throw conflict("Reopen a lost lead before converting it.");
      const cid = await createClientRecord(q, a, {
        name: d.clientName, legalName: d.legalName, industry: d.industry, category: d.category, status: "onboarding",
        accountManagerId: d.accountManagerId, productLines: row.product_interest, sourceLeadId: row.id,
        primaryContact: { name: row.contact_name, email: row.email ?? undefined, phone: row.phone },
      });
      await q.query(`UPDATE leads SET stage = 'won', client_id = $2, next_follow_up_at = NULL, closed_at = $3, lost_reason = NULL WHERE id = $1`, [id, cid, this.now()]);
      await this.openFollowUp(q, a, id, row.owner_id, null, null);
      const code = (await q.query<{ code: string }>(`SELECT code FROM clients WHERE id = $1`, [cid])).rows[0].code;
      await this.addActivity(q, a, { leadId: id, type: "converted", summary: `Converted to client ${code}`, meta: { clientId: cid } });
      await this.addActivity(q, a, { clientId: cid, type: "converted", summary: `Created from lead ${row.code}`, meta: { leadId: id } });
      await audit(q, a, "lead.convert", "lead", id, { clientId: cid });
      await emit(q, a, "lead.converted", "lead", id, { clientId: cid });
      return cid;
    });
    return { lead: await this.get(a, id), client: await getClient(this.db, a, clientId) };
  }
}

export interface ActivityRow { id: string; lead_id: string | null; client_id: string | null; type: Activity["type"]; summary: string; body: string | null; actor_id: string | null; occurred_at: Date; meta: Record<string, string> }
export function toActivity(r: ActivityRow): Activity {
  return {
    id: r.id, entityType: r.lead_id ? "lead" : "client", entityId: (r.lead_id ?? r.client_id)!, type: r.type,
    summary: r.summary, body: r.body, actorId: r.actor_id ?? "", occurredAt: iso(r.occurred_at)!, meta: r.meta ?? {},
  };
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const key: Record<string, string> = { name: "name" };
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    const prev = before[key[k] ?? k];
    if (JSON.stringify(prev ?? null) !== JSON.stringify(v ?? null)) out[k] = { from: prev ?? null, to: v };
  }
  return out;
}

import { z } from "zod";
const isoDt = z.iso.datetime({ offset: true });
const assignSchema = z.object({ ids: z.array(z.string()).min(1).max(500), ownerId: z.string().min(1) });
const stageSchema = z.object({ stage: LeadStageSchema, lostReason: z.string().max(200).optional() });
const bulkStageSchema = z.object({ ids: z.array(z.string()).min(1).max(500), stage: LeadStageSchema });
const dupSchema = z.object({ phone: z.string().max(30).optional(), email: z.string().max(200).optional(), company: z.string().max(200).optional(), excludeId: z.string().max(64).optional() });
const followUpSchema = z.object({ at: isoDt, note: z.string().max(2000).optional() });
const completeSchema = z.object({ outcome: z.string().trim().min(1, "Record the outcome.").max(2000), nextAt: isoDt.nullable() });

export const leadSum = (rows: { estimated_value: string }[]) => fromPaise(sum(rows.map((r) => toPaise(r.estimated_value))));
export { HttpError };
