import { z } from "zod";
import type { AuditEntry } from "@/lib/api/modules/people";
import { OPEN_STAGES } from "@/lib/api/contracts";
import type { Router } from "../../app";
import { type Deps, DEFAULT_SETTINGS, audit, getSettings, need, todayIst } from "../../lib/context";
import { invalid, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";
import { validateGstin } from "@/lib/validation/gstin";

const pct = z.number().min(0).max(100);
const money = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);
const SettingsSchema = z.object({
  organization: z.object({ legalName: z.string().trim().min(2).max(200), gstin: z.string().trim().toUpperCase().optional().nullable() }).optional(),
  profile: z.object({
    address: z.string().max(500), email: z.string().max(200), phone: z.string().max(40), docPrefix: z.string().regex(/^[A-Z]{1,6}$/),
    bank: z.object({ name: z.string().max(120), account: z.string().regex(/^\d{6,20}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), branch: z.string().max(120) }).nullable(),
  }).partial().optional(),
  quotations: z.object({ discountApprovalPct: pct, valueApprovalAbove: money, validityDays: z.number().int().min(1).max(180) }).partial().optional(),
  projects: z.object({ requireApprovedScope: z.boolean(), requireAdvancePct: pct }).partial().optional(),
  finance: z.object({ invoiceDueDays: z.number().int().min(0).max(180) }).partial().optional(),
  payroll: z.object({
    pf: z.object({ enabled: z.boolean(), employeeRate: money, employerRate: money, wageCap: money }).partial(),
    esi: z.object({ enabled: z.boolean(), employeeRate: money, employerRate: money, grossLimit: money }).partial(),
    professionalTax: z.object({ enabled: z.boolean(), monthlyAmount: money, grossAbove: money }).partial(),
  }).partial().optional(),
});

export function adminRoutes(r: Router, deps: Deps) {
  const db = deps.db;

  r.get("/admin/settings", async ({ actor }) => {
    need(actor, "settings.manage", "finance.view", "hr.payroll.manage");
    const org = (await db.query<{ name: string; legal_name: string; gstin: string | null; state_code: string | null }>(`SELECT name, legal_name, gstin, state_code FROM organizations WHERE id = $1`, [actor.orgId])).rows[0];
    return { organization: { name: org.name, legalName: org.legal_name, gstin: org.gstin, stateCode: org.state_code }, ...(await getSettings(db, actor.orgId)), defaults: DEFAULT_SETTINGS };
  });

  // Minimal organisation facts every signed-in user may see (tax previews, document headers).
  r.get("/org/profile", async ({ actor }) => {
    const org = (await db.query<{ legal_name: string; gstin: string | null; state_code: string | null }>(`SELECT legal_name, gstin, state_code FROM organizations WHERE id = $1`, [actor.orgId])).rows[0];
    const s = await getSettings(db, actor.orgId);
    return { legalName: org.legal_name, gstin: org.gstin, stateCode: org.state_code, docPrefix: s.profile.docPrefix, quotationDiscountApprovalPct: s.quotations.discountApprovalPct };
  });

  r.put("/admin/settings", async ({ actor, body }) => {
    need(actor, "settings.manage");
    const d = parse(SettingsSchema, body);
    await db.tx(async (q) => {
      if (d.organization) {
        if (d.organization.gstin) { const c = validateGstin(d.organization.gstin); if (!c.valid) throw invalid(c.reason, { "organization.gstin": [c.reason] }); }
        await q.query(`UPDATE organizations SET legal_name = $2, gstin = $3, state_code = coalesce($4, state_code) WHERE id = $1`, [actor.orgId, d.organization.legalName, d.organization.gstin ?? null, d.organization.gstin?.slice(0, 2) ?? null]);
      }
      const cur = (await q.query<{ settings: Record<string, unknown> }>(`SELECT settings FROM organization_settings WHERE organization_id = $1 FOR UPDATE`, [actor.orgId])).rows[0]?.settings ?? {};
      const merged = { ...cur } as Record<string, unknown>;
      for (const k of ["profile", "quotations", "projects", "finance"] as const) if (d[k]) merged[k] = { ...(cur[k] as object ?? {}), ...d[k] };
      if (d.payroll) {
        const p = { ...((cur.payroll as Record<string, object>) ?? {}) };
        for (const k of ["pf", "esi", "professionalTax"] as const) if (d.payroll[k]) p[k] = { ...(p[k] ?? {}), ...d.payroll[k] };
        merged.payroll = p;
      }
      await q.query(`INSERT INTO organization_settings (organization_id, settings) VALUES ($1,$2) ON CONFLICT (organization_id) DO UPDATE SET settings = $2, updated_at = now()`, [actor.orgId, JSON.stringify(merged)]);
      // The audit log is readable by auditors: never copy the full company bank account into it.
      const bank = (d as { profile?: { bank?: { account?: string } | null } }).profile?.bank;
      const redacted = bank?.account
        ? { ...d, profile: { ...(d as { profile: object }).profile, bank: { ...bank, account: `••••${bank.account.slice(-4)}` } } }
        : d;
      await audit(q, actor, "settings.update", "organization", actor.orgId, redacted);
    });
    return getSettings(db, actor.orgId);
  });

  r.get("/admin/outbox", async ({ actor }) => {
    need(actor, "settings.manage", "audit.view");
    // Delivery status only; message bodies may hold links or codes and are never shown.
    return (await db.query(`SELECT id, channel, recipient, template, status, attempts, last_error AS "lastError", created_at AS "createdAt", sent_at AS "sentAt" FROM outbox_messages WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200`, [actor.orgId])).rows;
  });

  r.get("/audit", async ({ actor, query }) => {
    need(actor, "audit.view");
    const params: unknown[] = [actor.orgId];
    const where = ["e.organization_id = $1"];
    if (query.entityType) { params.push(String(query.entityType)); where.push(`e.entity_type = $${params.length}`); }
    if (query.entityId && isUuid(query.entityId)) { params.push(query.entityId); where.push(`e.entity_id = $${params.length}`); }
    if (query.actorId && isUuid(query.actorId)) { params.push(query.actorId); where.push(`e.actor_user_id = $${params.length}`); }
    if (query.action) { params.push(`${String(query.action)}%`); where.push(`e.action LIKE $${params.length}`); }
    if (query.from) { params.push(String(query.from)); where.push(`e.occurred_at >= $${params.length}::date`); }
    if (query.to) { params.push(String(query.to)); where.push(`e.occurred_at < ($${params.length}::date + 1)`); }
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM audit_events e WHERE ${where.join(" AND ")}`, params)).rows[0].n);
    const rows = await db.query<{ id: string; occurred_at: Date; actor_user_id: string | null; full_name: string | null; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown>; request_id: string | null; ip: string | null }>(
      `SELECT e.*, u.full_name FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE ${where.join(" AND ")} ORDER BY e.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, params);
    const items: AuditEntry[] = rows.rows.map((x) => ({ id: String(x.id), occurredAt: iso(x.occurred_at)!, actorId: x.actor_user_id, actorName: x.full_name, action: x.action, entityType: x.entity_type, entityId: x.entity_id, changes: x.changes, requestId: x.request_id, ip: x.ip }));
    return { items, total, page, pageSize: 50 };
  });

  // ---------- operational reports ----------
  r.get("/reports/sales", async ({ actor }) => {
    need(actor, "reports.view");
    const won = await db.query<{ month: string; n: number; value: string }>(
      `SELECT to_char(closed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month, count(*)::int AS n, sum(estimated_value) AS value FROM leads
        WHERE organization_id = $1 AND stage = 'won' AND closed_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`, [actor.orgId]);
    const bySource = await db.query<{ source: string; total: number; won: number; lost: number }>(
      `SELECT source, count(*)::int AS total, count(*) FILTER (WHERE stage = 'won')::int AS won, count(*) FILTER (WHERE stage = 'lost')::int AS lost FROM leads WHERE organization_id = $1 GROUP BY source ORDER BY total DESC`, [actor.orgId]);
    const quotes = await db.query<{ status: string; n: number; value: string }>(
      `SELECT status, count(*)::int AS n, sum(grand_total) AS value FROM quotations WHERE organization_id = $1 AND status <> 'superseded' GROUP BY status`, [actor.orgId]);
    const pipeline = await db.query<{ stage: string; n: number; value: string }>(
      `SELECT stage, count(*)::int AS n, sum(estimated_value) AS value FROM leads WHERE organization_id = $1 AND stage = ANY($2) GROUP BY stage`, [actor.orgId, OPEN_STAGES]);
    return { wonByMonth: won.rows, bySource: bySource.rows, quotations: quotes.rows, pipeline: pipeline.rows };
  });

  r.get("/reports/hr", async ({ actor, query }) => {
    need(actor, "hr.view");
    const month = String(query.month ?? todayIst(deps.now()).slice(0, 7));
    const head = await db.query<{ department: string | null; n: number }>(
      `SELECT d.name AS department, count(*)::int AS n FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.organization_id = $1 AND e.status <> 'exited' GROUP BY d.name ORDER BY n DESC`, [actor.orgId]);
    const att = await db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM attendance WHERE organization_id = $1 AND to_char(work_date, 'YYYY-MM') = $2 GROUP BY status`, [actor.orgId, month]);
    const leave = await db.query<{ code: string; days: string }>(
      `SELECT t.code, sum(l.days) AS days FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.organization_id = $1 AND l.status = 'approved' AND to_char(l.from_date, 'YYYY') = $2 GROUP BY t.code`, [actor.orgId, month.slice(0, 4)]);
    return { month, headcount: head.rows, attendance: att.rows, leaveDaysThisYear: leave.rows };
  });

  r.get("/reports/support", async ({ actor }) => {
    need(actor, "support.view", "reports.view");
    const r1 = await db.query<{ priority: string; total: number; response_met: number; resolution_met: number; open: number }>(
      `SELECT priority, count(*)::int AS total,
              count(*) FILTER (WHERE first_responded_at IS NOT NULL AND first_responded_at <= first_response_due_at)::int AS response_met,
              count(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= resolution_due_at)::int AS resolution_met,
              count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open
         FROM tickets WHERE organization_id = $1 AND created_at > now() - interval '90 days' GROUP BY priority`, [actor.orgId]);
    return { last90Days: r1.rows };
  });
}
