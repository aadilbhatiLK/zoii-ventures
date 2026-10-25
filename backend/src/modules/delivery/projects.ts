import {
  ChangeRequestInputSchema, CrSubmitSchema, MilestoneInputSchema, ProjectCreateSchema, SignoffInputSchema, TaskInputSchema, TaskMoveSchema,
  UatInputSchema, UatResultSchema, type ActivationCheck, type ChangeRequest, type Milestone, type Project, type ProjectDetail, type Task,
} from "@/lib/api/modules/delivery";
import { fromPaise, percentOf, toPaise } from "@/lib/money";
import { z } from "zod";
import type { Queryable } from "../../db";
import { type Actor, type Deps, addDays, audit, emit, getSettings, need, nextNumber, notify } from "../../lib/context";
import { conflict, forbidden, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";
import { registerApprovalHandler, requestApproval } from "../sales/approvals";

interface PRow { id: string; code: string; name: string; client_id: string; client_name: string; sales_order_id: string | null; so_number: string | null; scope_document_id: string | null; billable: boolean; status: Project["status"]; manager_id: string; start_date: string | null; due_date: string | null; activated_at: Date | null; completed_at: Date | null; created_at: Date; member_ids: string[]; task_counts: Record<string, number> | null; milestone_count: number }
const P_SELECT = `
  SELECT p.*, c.display_name AS client_name, so.number AS so_number,
    coalesce((SELECT array_agg(m.user_id) FROM project_members m WHERE m.project_id = p.id), '{}') AS member_ids,
    (SELECT json_object_agg(status, n) FROM (SELECT status, count(*)::int AS n FROM tasks t WHERE t.project_id = p.id GROUP BY status) x) AS task_counts,
    (SELECT count(*)::int FROM milestones ms WHERE ms.project_id = p.id) AS milestone_count
  FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN sales_orders so ON so.id = p.sales_order_id`;
const toProject = (r: PRow): Project => ({
  id: r.id, code: r.code, name: r.name, clientId: r.client_id, clientName: r.client_name, salesOrderId: r.sales_order_id, salesOrderNumber: r.so_number,
  scopeDocumentId: r.scope_document_id, billable: r.billable, status: r.status, managerId: r.manager_id, startDate: r.start_date, dueDate: r.due_date,
  activatedAt: iso(r.activated_at), completedAt: iso(r.completed_at), memberIds: r.member_ids, taskCounts: r.task_counts ?? {}, milestoneCount: r.milestone_count, createdAt: iso(r.created_at)!,
});
interface TRow { id: string; project_id: string; project_name: string; milestone_id: string | null; title: string; description: string | null; status: Task["status"]; priority: Task["priority"]; assignee_id: string | null; due_date: string | null; estimate_hours: string | null; sort: number; updated_at: Date }
const toTask = (r: TRow): Task => ({
  id: r.id, projectId: r.project_id, projectName: r.project_name, milestoneId: r.milestone_id, title: r.title, description: r.description, status: r.status,
  priority: r.priority, assigneeId: r.assignee_id, dueDate: r.due_date, estimateHours: r.estimate_hours, sort: r.sort, updatedAt: iso(r.updated_at)!,
});
const T_SELECT = `SELECT t.*, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id`;
interface CrRow { id: string; number: string; project_id: string; title: string; description: string; impact_amount: string; impact_days: number; status: ChangeRequest["status"]; client_approved: boolean; requested_by: string; decided_by: string | null; decided_at: Date | null; decision_note: string | null; created_at: Date }
const toCr = (r: CrRow): ChangeRequest => ({
  id: r.id, number: r.number, projectId: r.project_id, title: r.title, description: r.description, impactAmount: r.impact_amount, impactDays: r.impact_days, status: r.status,
  clientApproved: r.client_approved, requestedBy: r.requested_by, decidedBy: r.decided_by, decidedAt: iso(r.decided_at), decisionNote: r.decision_note, createdAt: iso(r.created_at)!,
});

/** Approved CR: extra billable milestone for the impact amount, schedule pushed by impact days. */
registerApprovalHandler("change_request", async (q, a, id, approved, note) => {
  const cr = (await q.query<CrRow & { organization_id: string }>(`SELECT * FROM change_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!cr || cr.status !== "submitted") throw conflict("This change request is no longer pending.");
  if (cr.requested_by === a.userId) throw forbidden("You can't approve your own change request.");
  await q.query(`UPDATE change_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [id, approved ? "approved" : "rejected", a.userId, note]);
  if (!approved) return;
  if (toPaise(cr.impact_amount) > 0n) {
    const seq = (await q.query<{ n: number }>(`SELECT coalesce(max(seq), 0) + 1 AS n FROM milestones WHERE project_id = $1`, [cr.project_id])).rows[0].n;
    await q.query(`INSERT INTO milestones (organization_id, project_id, seq, name, amount) VALUES ($1,$2,$3,$4,$5)`, [cr.organization_id, cr.project_id, seq, `${cr.number}: ${cr.title}`, cr.impact_amount]);
  }
  if (cr.impact_days > 0) await q.query(`UPDATE projects SET due_date = due_date + $2::int WHERE id = $1 AND due_date IS NOT NULL`, [cr.project_id, cr.impact_days]);
  await emit(q, a, "change_request.approved", "change_request", id, { projectId: cr.project_id, amount: cr.impact_amount });
});

export class ProjectService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  /** Members, the manager and task assignees may see a project; projects.view sees all. */
  private visibility(a: Actor, idx: number) {
    if (a.permissions.has("projects.view") || a.permissions.has("projects.activate")) return { sql: "TRUE", params: [] as unknown[] };
    return { sql: `(p.manager_id = $${idx} OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $${idx}) OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.assignee_id = $${idx}))`, params: [a.userId] as unknown[] };
  }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "projects.view", "projects.manage", "tasks.update_assigned");
    const v = this.visibility(a, 2);
    const params: unknown[] = [a.orgId, ...v.params];
    const where = ["p.organization_id = $1", v.sql];
    if (query.status) { params.push([query.status].flat()); where.push(`p.status = ANY($${params.length})`); }
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`p.client_id = $${params.length}`); }
    const r = await this.db.query<PRow>(`${P_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT 300`, params);
    return r.rows.map(toProject);
  }

  private async prow(q: Queryable, a: Actor, id: string, lock = false) {
    need(a, "projects.view", "projects.manage", "tasks.update_assigned");
    if (!isUuid(id)) throw notFound("Project");
    const v = this.visibility(a, 3);
    const r = await q.query<PRow>(`${P_SELECT} WHERE p.id = $1 AND p.organization_id = $2 AND ${v.sql}${lock ? " FOR UPDATE OF p" : ""}`, [id, a.orgId, ...v.params]);
    if (!r.rows[0]) throw notFound("Project");
    return r.rows[0];
  }

  async activationChecks(q: Queryable, orgId: string, p: PRow): Promise<ActivationCheck[]> {
    const s = await getSettings(q, orgId);
    const checks: ActivationCheck[] = [];
    if (p.billable) {
      const so = p.sales_order_id ? (await q.query<{ status: string; grand_total: string; number: string }>(`SELECT status, grand_total, number FROM sales_orders WHERE id = $1`, [p.sales_order_id])).rows[0] : null;
      checks.push({ key: "sales_order", label: "Accepted quotation / sales order", ok: !!so && so.status === "open", detail: so ? `${so.number} (${so.status})` : "Link the sales order created when the client accepted the quotation." });
      if (s.projects.requireAdvancePct > 0 && so) {
        const paid = (await q.query<{ v: string | null }>(
          `SELECT sum(ra.amount) AS v FROM receipt_allocations ra JOIN invoices i ON i.id = ra.invoice_id WHERE i.sales_order_id = $1`, [p.sales_order_id])).rows[0].v ?? "0";
        const need = percentOf(toPaise(so.grand_total), String(s.projects.requireAdvancePct));
        checks.push({ key: "advance", label: `Advance of ${s.projects.requireAdvancePct}% received`, ok: toPaise(paid) >= need, detail: `Received ${fromPaise(toPaise(paid))} of ${fromPaise(need)} required.` });
      }
    }
    if (s.projects.requireApprovedScope) {
      const doc = p.scope_document_id ? (await q.query<{ approved_version: number | null; number: string }>(`SELECT approved_version, number FROM documents WHERE id = $1`, [p.scope_document_id])).rows[0] : null;
      checks.push({ key: "scope", label: "Approved BRD/PRD scope", ok: !!doc?.approved_version, detail: doc ? (doc.approved_version ? `${doc.number} v${doc.approved_version} approved` : `${doc.number} is not approved yet`) : "Link the approved scope document." });
    }
    const mgr = (await q.query(`SELECT 1 FROM users WHERE id = $1 AND status = 'active'`, [p.manager_id])).rows.length > 0;
    checks.push({ key: "manager", label: "Active project manager", ok: mgr, detail: mgr ? "Assigned" : "The manager's account is not active." });
    return checks;
  }

  async get(a: Actor, id: string): Promise<ProjectDetail> {
    const p = await this.prow(this.db, a, id);
    const ms = await this.db.query<{ id: string; seq: number; name: string; due_date: string | null; amount: string; status: Milestone["status"]; signed_off_at: Date | null; invoice_id: string | null }>(
      `SELECT m.*, (SELECT i.id FROM invoices i WHERE i.milestone_id = m.id AND i.status <> 'cancelled') AS invoice_id FROM milestones m WHERE m.project_id = $1 ORDER BY m.seq`, [id]);
    const uat = await this.db.query<{ id: string; milestone_id: string; title: string; expected_result: string | null; status: "pending" | "passed" | "failed"; tested_by_name: string | null; notes: string | null; updated_at: Date }>(`SELECT * FROM uat_items WHERE project_id = $1 ORDER BY created_at`, [id]);
    const so = await this.db.query<{ id: string; milestone_id: string; signed_by_name: string; signed_by_email: string | null; method: "email_confirmation"; evidence_ref: string; signed_at: Date; recorded_by: string }>(`SELECT * FROM signoffs WHERE project_id = $1`, [id]);
    const crs = await this.db.query<CrRow>(`SELECT * FROM change_requests WHERE project_id = $1 ORDER BY created_at DESC`, [id]);
    return {
      ...toProject(p),
      activation: p.status === "planned" ? await this.activationChecks(this.db, a.orgId, p) : [],
      milestones: ms.rows.map((m) => ({
        id: m.id, seq: m.seq, name: m.name, dueDate: m.due_date, amount: m.amount, status: m.status, signedOffAt: iso(m.signed_off_at), invoiceId: m.invoice_id,
        uat: uat.rows.filter((u) => u.milestone_id === m.id).map((u) => ({ id: u.id, title: u.title, expectedResult: u.expected_result, status: u.status, testedByName: u.tested_by_name, notes: u.notes, updatedAt: iso(u.updated_at)! })),
        signoff: so.rows.filter((s) => s.milestone_id === m.id).map((s) => ({ id: "", signedByName: s.signed_by_name, signedByEmail: s.signed_by_email, method: s.method, evidenceRef: s.evidence_ref, signedAt: iso(s.signed_at)!, recordedBy: s.recorded_by }))[0] ?? null,
      })),
      changeRequests: crs.rows.map(toCr),
    };
  }

  /** A project's sales order and scope document must belong to the project's client. */
  private async checkLinks(q: Queryable, a: Actor, clientId: string, salesOrderId: string | null | undefined, scopeDocumentId: string | null | undefined) {
    const d = { clientId, salesOrderId, scopeDocumentId };
    if (d.salesOrderId) {
      const so = (await q.query<{ client_id: string }>(`SELECT client_id FROM sales_orders WHERE id = $1 AND organization_id = $2`, [d.salesOrderId, a.orgId])).rows[0];
      if (!so) throw invalid("Unknown sales order.", { salesOrderId: ["Unknown"] });
      if (so.client_id !== d.clientId) throw invalid("The sales order belongs to another client.", { salesOrderId: ["Different client"] });
    }
    if (d.scopeDocumentId) {
      const doc = (await q.query<{ client_id: string | null }>(`SELECT client_id FROM documents WHERE id = $1 AND organization_id = $2`, [d.scopeDocumentId, a.orgId])).rows[0];
      if (!doc) throw invalid("Unknown document.", { scopeDocumentId: ["Unknown"] });
      if (doc.client_id && doc.client_id !== d.clientId) throw invalid("The scope document belongs to another client.", { scopeDocumentId: ["Different client"] });
    }
  }

  async create(a: Actor, body: unknown) {
    need(a, "projects.manage", "projects.activate");
    const d = parse(ProjectCreateSchema, body);
    const id = await this.db.tx(async (q) => {
      if (!(await q.query(`SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2`, [d.clientId, a.orgId])).rows.length) throw invalid("Unknown client.", { clientId: ["Unknown"] });
      await this.checkLinks(q, a, d.clientId, d.salesOrderId, d.scopeDocumentId);
      const n = await nextNumber(q, a.orgId, "project");
      const r = await q.query<{ id: string }>(
        `INSERT INTO projects (organization_id, code, name, client_id, sales_order_id, scope_document_id, billable, manager_id, start_date, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [a.orgId, `PRJ-${String(n).padStart(4, "0")}`, d.name, d.clientId, d.salesOrderId ?? null, d.scopeDocumentId ?? null, d.billable, d.managerId, d.startDate ?? null, d.dueDate ?? null, a.userId],
      );
      for (const m of new Set([...d.memberIds, d.managerId]))
        await q.query(`INSERT INTO project_members (organization_id, project_id, user_id, role) VALUES ($1,$2,$3,$4)`, [a.orgId, r.rows[0].id, m, m === d.managerId ? "lead" : "member"]);
      await audit(q, a, "project.create", "project", r.rows[0].id, { name: d.name, salesOrderId: d.salesOrderId ?? null });
      return r.rows[0].id;
    });
    return this.get(a, id);
  }

  async update(a: Actor, id: string, body: unknown) {
    need(a, "projects.manage", "projects.activate");
    const d = parse(ProjectCreateSchema.partial().extend({ status: z.enum(["on_hold", "active", "completed", "cancelled"]).optional() }), body);
    await this.db.tx(async (q) => {
      const p = await this.prow(q, a, id, true);
      if (d.status) {
        const allowed: Record<string, string[]> = { planned: ["cancelled"], active: ["on_hold", "completed", "cancelled"], on_hold: ["active", "cancelled"], completed: [], cancelled: [] };
        if (!allowed[p.status].includes(d.status)) throw conflict(p.status === "planned" && d.status === "active" ? "Use Activate — it checks the activation rules." : `Can't move a ${p.status} project to ${d.status}.`);
        if (d.status === "completed") {
          const open = await q.query(`SELECT 1 FROM milestones WHERE project_id = $1 AND status NOT IN ('signed_off','invoiced')`, [id]);
          if (open.rows.length) throw conflict("Every milestone needs client sign-off before the project can be completed.");
        }
      }
      if (d.salesOrderId !== undefined && p.status !== "planned") throw conflict("The sales order can only change before activation.");
      // Activation was checked against the approved scope; it can't be swapped afterwards.
      if (d.scopeDocumentId !== undefined && p.status !== "planned") throw conflict("The scope document can only change before activation. Use a change request.");
      if (d.salesOrderId !== undefined || d.scopeDocumentId !== undefined)
        await this.checkLinks(q, a, p.client_id, d.salesOrderId !== undefined ? d.salesOrderId : null, d.scopeDocumentId !== undefined ? d.scopeDocumentId : null);
      await q.query(
        `UPDATE projects SET name = coalesce($2, name), manager_id = coalesce($3, manager_id), start_date = CASE WHEN $4 THEN $5::date ELSE start_date END,
                due_date = CASE WHEN $6 THEN $7::date ELSE due_date END, status = coalesce($8, status),
                completed_at = CASE WHEN $8 = 'completed' THEN now() ELSE completed_at END,
                sales_order_id = CASE WHEN $9 THEN $10::uuid ELSE sales_order_id END, scope_document_id = CASE WHEN $11 THEN $12::uuid ELSE scope_document_id END
          WHERE id = $1`,
        [id, d.name ?? null, d.managerId ?? null, d.startDate !== undefined, d.startDate ?? null, d.dueDate !== undefined, d.dueDate ?? null, d.status ?? null,
         d.salesOrderId !== undefined, d.salesOrderId ?? null, d.scopeDocumentId !== undefined, d.scopeDocumentId ?? null],
      );
      if (d.memberIds) {
        await q.query(`DELETE FROM project_members WHERE project_id = $1`, [id]);
        const mgr = d.managerId ?? p.manager_id;
        for (const m of new Set([...d.memberIds, mgr])) await q.query(`INSERT INTO project_members (organization_id, project_id, user_id, role) VALUES ($1,$2,$3,$4)`, [a.orgId, id, m, m === mgr ? "lead" : "member"]);
      }
      await audit(q, a, "project.update", "project", id, { status: d.status ? { from: p.status, to: d.status } : undefined });
    });
    return this.get(a, id);
  }

  async activate(a: Actor, id: string) {
    need(a, "projects.activate");
    await this.db.tx(async (q) => {
      const p = await this.prow(q, a, id, true);
      if (p.status !== "planned") throw conflict("Only planned projects can be activated.");
      const checks = await this.activationChecks(q, a.orgId, p);
      const failed = checks.filter((c) => !c.ok);
      if (failed.length) throw conflict(`Can't activate yet: ${failed.map((c) => `${c.label} — ${c.detail}`).join("; ")}`);
      await q.query(`UPDATE projects SET status = 'active', activated_at = now(), activated_by = $2, start_date = coalesce(start_date, $3::date) WHERE id = $1`, [id, a.userId, new Date(this.deps.now().getTime() + 330 * 60_000).toISOString().slice(0, 10)]);
      await audit(q, a, "project.activate", "project", id, { checks });
      await emit(q, a, "project.activated", "project", id, {});
      await notify(q, a.orgId, p.manager_id, { kind: "system", title: `Project activated: ${p.name}`, href: `/projects/${id}` });
    });
    return this.get(a, id);
  }

  // ---------- milestones ----------
  async addMilestone(a: Actor, projectId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(MilestoneInputSchema, body);
    await this.db.tx(async (q) => {
      const p = await this.prow(q, a, projectId, true);
      if (["completed", "cancelled"].includes(p.status)) throw conflict("This project is closed.");
      const seq = (await q.query<{ n: number }>(`SELECT coalesce(max(seq), 0) + 1 AS n FROM milestones WHERE project_id = $1`, [projectId])).rows[0].n;
      const r = await q.query<{ id: string }>(`INSERT INTO milestones (organization_id, project_id, seq, name, due_date, amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [a.orgId, projectId, seq, d.name, d.dueDate ?? null, d.amount]);
      await audit(q, a, "milestone.create", "milestone", r.rows[0].id, d);
    });
    return this.get(a, projectId);
  }

  private async milestone(q: Queryable, a: Actor, id: string) {
    if (!isUuid(id)) throw notFound("Milestone");
    const m = (await q.query<{ id: string; project_id: string; status: Milestone["status"]; name: string; amount: string }>(`SELECT id, project_id, status, name, amount FROM milestones WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
    if (!m) throw notFound("Milestone");
    const p = await this.prow(q, a, m.project_id);
    return { ...m, project_status: p.status };
  }

  async setMilestoneStatus(a: Actor, id: string, body: unknown) {
    need(a, "projects.manage");
    const { status } = parse(z.object({ status: z.enum(["pending", "in_progress", "uat"]) }), body);
    const pid = await this.db.tx(async (q) => {
      const m = await this.milestone(q, a, id);
      const p = await this.prow(q, a, m.project_id);
      if (p.status !== "active") throw conflict("Activate the project before working on milestones.");
      if (["signed_off", "invoiced"].includes(m.status)) throw conflict("This milestone is signed off.");
      await q.query(`UPDATE milestones SET status = $2 WHERE id = $1`, [id, status]);
      await audit(q, a, "milestone.status", "milestone", id, { from: m.status, to: status });
      return m.project_id;
    });
    return this.get(a, pid);
  }

  async addUat(a: Actor, milestoneId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(UatInputSchema, body);
    const pid = await this.db.tx(async (q) => {
      const m = await this.milestone(q, a, milestoneId);
      if (!["active", "on_hold"].includes(m.project_status)) throw conflict(`UAT can't be added to a ${m.project_status} project.`);
      if (["signed_off", "invoiced"].includes(m.status)) throw conflict("This milestone is signed off.");
      await q.query(`INSERT INTO uat_items (organization_id, project_id, milestone_id, title, expected_result, updated_by) VALUES ($1,$2,$3,$4,$5,$6)`, [a.orgId, m.project_id, milestoneId, d.title, d.expectedResult ?? null, a.userId]);
      return m.project_id;
    });
    return this.get(a, pid);
  }

  async recordUat(a: Actor, uatId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(UatResultSchema, body);
    if (!isUuid(uatId)) throw notFound("UAT item");
    const pid = await this.db.tx(async (q) => {
      const u = (await q.query<{ milestone_id: string }>(`SELECT milestone_id FROM uat_items WHERE id = $1 AND organization_id = $2`, [uatId, a.orgId])).rows[0];
      if (!u) throw notFound("UAT item");
      const m = await this.milestone(q, a, u.milestone_id);
      if (["signed_off", "invoiced"].includes(m.status)) throw conflict("This milestone is signed off; UAT results are locked.");
      await q.query(`UPDATE uat_items SET status = $2, tested_by_name = $3, notes = $4, updated_by = $5, updated_at = now() WHERE id = $1`, [uatId, d.status, d.testedByName ?? null, d.notes ?? null, a.userId]);
      if (m.status === "pending" || m.status === "in_progress") await q.query(`UPDATE milestones SET status = 'uat' WHERE id = $1`, [m.id]);
      await audit(q, a, "uat.result", "uat_item", uatId, d);
      return m.project_id;
    });
    return this.get(a, pid);
  }

  /** Sign-off needs every UAT item passed; the record is append-only evidence. */
  async signOff(a: Actor, milestoneId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(SignoffInputSchema, body);
    const pid = await this.db.tx(async (q) => {
      const m = await this.milestone(q, a, milestoneId);
      if (!["active", "on_hold"].includes(m.project_status)) throw conflict(`Milestones of a ${m.project_status} project can't be signed off.`);
      if (["signed_off", "invoiced"].includes(m.status)) throw conflict("Already signed off.");
      const uat = (await q.query<{ status: string }>(`SELECT status FROM uat_items WHERE milestone_id = $1`, [milestoneId])).rows;
      if (!uat.length) throw conflict("Add UAT checks and record their results before sign-off.");
      if (uat.some((u) => u.status !== "passed")) throw conflict("Every UAT check must pass before the client signs off.");
      if (Date.parse(d.signedAt) > this.deps.now().getTime() + 5 * 60_000) throw invalid("Sign-off can't be in the future.", { signedAt: ["In the future"] });
      await q.query(
        `INSERT INTO signoffs (organization_id, project_id, milestone_id, signed_by_name, signed_by_email, method, evidence_ref, signed_at, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [a.orgId, m.project_id, milestoneId, d.signedByName, d.signedByEmail ?? null, d.method, d.evidenceRef, d.signedAt, a.userId],
      );
      await q.query(`UPDATE milestones SET status = 'signed_off', signed_off_at = $2 WHERE id = $1`, [milestoneId, d.signedAt]);
      await audit(q, a, "milestone.sign_off", "milestone", milestoneId, d);
      await emit(q, a, "milestone.signed_off", "milestone", milestoneId, { projectId: m.project_id, amount: m.amount });
      return m.project_id;
    });
    return this.get(a, pid);
  }

  // ---------- tasks ----------
  async tasks(a: Actor, projectId: string) {
    await this.prow(this.db, a, projectId);
    const r = await this.db.query<TRow>(`${T_SELECT} WHERE t.project_id = $1 ORDER BY t.status, t.sort, t.created_at`, [projectId]);
    return r.rows.map(toTask);
  }

  async myTasks(a: Actor) {
    need(a, "tasks.update_assigned", "projects.manage", "projects.view");
    const r = await this.db.query<TRow>(`${T_SELECT} WHERE t.organization_id = $1 AND t.assignee_id = $2 AND t.status <> 'done' ORDER BY t.due_date NULLS LAST, t.sort`, [a.orgId, a.userId]);
    return r.rows.map(toTask);
  }

  async addTask(a: Actor, projectId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(TaskInputSchema, body);
    const id = await this.db.tx(async (q) => {
      const p = await this.prow(q, a, projectId);
      if (["completed", "cancelled"].includes(p.status)) throw conflict("This project is closed.");
      if (d.milestoneId && !(await q.query(`SELECT 1 FROM milestones WHERE id = $1 AND project_id = $2`, [d.milestoneId, projectId])).rows.length) throw invalid("That milestone belongs to another project.", { milestoneId: ["Wrong project"] });
      const sort = (await q.query<{ n: number }>(`SELECT coalesce(max(sort), 0) + 1000 AS n FROM tasks WHERE project_id = $1 AND status = 'todo'`, [projectId])).rows[0].n;
      const r = await q.query<{ id: string }>(
        `INSERT INTO tasks (organization_id, project_id, milestone_id, title, description, priority, assignee_id, due_date, estimate_hours, sort, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [a.orgId, projectId, d.milestoneId ?? null, d.title, d.description ?? null, d.priority, d.assigneeId ?? null, d.dueDate ?? null, d.estimateHours ?? null, sort, a.userId],
      );
      if (d.assigneeId && d.assigneeId !== a.userId) {
        await q.query(`INSERT INTO project_members (organization_id, project_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [a.orgId, projectId, d.assigneeId]);
        await notify(q, a.orgId, d.assigneeId, { kind: "assignment", title: `Task assigned: ${d.title}`, body: p.name, href: `/projects/${projectId}` });
      }
      await audit(q, a, "task.create", "task", r.rows[0].id, { title: d.title, assigneeId: d.assigneeId ?? null });
      return r.rows[0].id;
    });
    return toTask((await this.db.query<TRow>(`${T_SELECT} WHERE t.id = $1`, [id])).rows[0]);
  }

  private async taskRow(q: Queryable, a: Actor, id: string) {
    if (!isUuid(id)) throw notFound("Task");
    const t = (await q.query<TRow>(`${T_SELECT} WHERE t.id = $1 AND t.organization_id = $2 FOR UPDATE OF t`, [id, a.orgId])).rows[0];
    if (!t) throw notFound("Task");
    const manage = a.permissions.has("projects.manage");
    if (!manage && !(a.permissions.has("tasks.update_assigned") && t.assignee_id === a.userId)) {
      if (a.permissions.has("projects.view")) throw forbidden("You can view this task but not change it.");
      throw notFound("Task");
    }
    return { t, manage };
  }

  async updateTask(a: Actor, id: string, body: unknown) {
    const d = parse(TaskInputSchema.partial(), body);
    await this.db.tx(async (q) => {
      const { manage } = await this.taskRow(q, a, id);
      if (!manage) throw forbidden("Only project managers can edit task details. You can move your tasks on the board.");
      await q.query(
        `UPDATE tasks SET title = coalesce($2, title), description = CASE WHEN $3 THEN $4 ELSE description END, priority = coalesce($5, priority),
                assignee_id = CASE WHEN $6 THEN $7::uuid ELSE assignee_id END, due_date = CASE WHEN $8 THEN $9::date ELSE due_date END WHERE id = $1`,
        [id, d.title ?? null, d.description !== undefined, d.description ?? null, d.priority ?? null, d.assigneeId !== undefined, d.assigneeId ?? null, d.dueDate !== undefined, d.dueDate ?? null],
      );
      await audit(q, a, "task.update", "task", id, d);
    });
    return toTask((await this.db.query<TRow>(`${T_SELECT} WHERE t.id = $1`, [id])).rows[0]);
  }

  async moveTask(a: Actor, id: string, body: unknown) {
    const d = parse(TaskMoveSchema, body);
    await this.db.tx(async (q) => {
      const { t } = await this.taskRow(q, a, id);
      if (d.expectedUpdatedAt && iso(t.updated_at) !== new Date(d.expectedUpdatedAt).toISOString()) throw conflict("This task changed since you loaded the board. Refresh and retry.");
      await q.query(`UPDATE tasks SET status = $2, sort = coalesce($3, sort), completed_at = CASE WHEN $2 = 'done' THEN coalesce(completed_at, now()) ELSE NULL END WHERE id = $1`, [id, d.status, d.sort ?? null]);
      if (t.status !== d.status) await audit(q, a, "task.move", "task", id, { from: t.status, to: d.status });
    });
    return toTask((await this.db.query<TRow>(`${T_SELECT} WHERE t.id = $1`, [id])).rows[0]);
  }

  // ---------- change requests ----------
  async addChangeRequest(a: Actor, projectId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(ChangeRequestInputSchema, body);
    await this.db.tx(async (q) => {
      const p = await this.prow(q, a, projectId);
      if (!["active", "on_hold"].includes(p.status)) throw conflict("Change requests apply to active projects.");
      const n = await nextNumber(q, a.orgId, "change_request");
      const r = await q.query<{ id: string }>(
        `INSERT INTO change_requests (organization_id, project_id, number, title, description, impact_amount, impact_days, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [a.orgId, projectId, `CR-${String(n).padStart(4, "0")}`, d.title, d.description, d.impactAmount, d.impactDays, a.userId],
      );
      await audit(q, a, "change_request.create", "change_request", r.rows[0].id, d);
    });
    return this.get(a, projectId);
  }

  async submitChangeRequest(a: Actor, crId: string, body: unknown) {
    need(a, "projects.manage");
    const d = parse(CrSubmitSchema, body);
    if (!isUuid(crId)) throw notFound("Change request");
    const pid = await this.db.tx(async (q) => {
      const cr = (await q.query<CrRow>(`SELECT * FROM change_requests WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [crId, a.orgId])).rows[0];
      if (!cr) throw notFound("Change request");
      await this.prow(q, a, cr.project_id);
      if (cr.status !== "draft") throw conflict("Only drafts can be submitted.");
      await q.query(`UPDATE change_requests SET status = 'submitted', client_approved = true, description = description || E'\n\nClient approval: ' || $2 WHERE id = $1`, [crId, d.clientEvidence]);
      await requestApproval(q, a, { entityType: "change_request", entityId: crId, title: `${cr.number} — ${cr.title}`, reason: `Impact: ₹${cr.impact_amount}, ${cr.impact_days} day(s)`, permission: "projects.activate" });
      await audit(q, a, "change_request.submit", "change_request", crId, { clientEvidence: d.clientEvidence });
      return cr.project_id;
    });
    return this.get(a, pid);
  }
}
export { addDays };
