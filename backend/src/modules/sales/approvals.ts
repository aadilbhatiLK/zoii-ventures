import type { ApprovalRequest } from "@/lib/api/modules/sales";
import { ApprovalDecisionSchema } from "@/lib/api/modules/sales";
import type { Permission } from "@/lib/permissions";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, notify } from "../../lib/context";
import { conflict, forbidden, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";

type EntityType = ApprovalRequest["entityType"];
type Handler = (q: Queryable, a: Actor, entityId: string, approved: boolean, note: string | null) => Promise<void>;
const handlers = new Map<EntityType, Handler>();
const hrefs: Record<EntityType, (id: string) => string> = {
  document_version: (id) => `/documents?version=${id}`,
  quotation: (id) => `/quotations/${id}`,
  change_request: (id) => `/projects?cr=${id}`,
  payroll_run: (id) => `/payroll/${id}`,
  leave_request: () => `/leave`,
  journal_entry: () => `/finance/journals`,
};

export function registerApprovalHandler(type: EntityType, h: Handler) { handlers.set(type, h); }

export async function requestApproval(
  q: Queryable, a: Actor,
  r: { entityType: EntityType; entityId: string; title: string; reason: string; permission: Permission; href?: string },
) {
  const res = await q.query<{ id: string }>(
    `INSERT INTO approval_requests (organization_id, entity_type, entity_id, title, reason, required_permission, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [a.orgId, r.entityType, r.entityId, r.title, r.reason, r.permission, a.userId],
  );
  // Notify everyone who can decide (except the requester).
  const approvers = await q.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ura.role_id
      WHERE u.organization_id = $1 AND u.status = 'active' AND rp.permission_key = $2 AND u.id <> $3`,
    [a.orgId, r.permission, a.userId],
  );
  for (const u of approvers.rows)
    await notify(q, a.orgId, u.id, { kind: "system", title: `Approval needed: ${r.title}`, body: r.reason, href: "/approvals" });
  return res.rows[0].id;
}

/** Records that `a` changed this record; editors may not approve it later. */
export async function recordEditor(q: Queryable, a: Actor, entityType: EntityType, entityId: string) {
  await q.query(
    `INSERT INTO record_editors (organization_id, entity_type, entity_id, user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [a.orgId, entityType, entityId, a.userId],
  );
}

async function isEditor(q: Queryable, a: Actor, entityType: EntityType, entityId: string) {
  return (await q.query(`SELECT 1 FROM record_editors WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND user_id = $4`, [a.orgId, entityType, entityId, a.userId])).rows.length > 0;
}

export async function cancelPendingApproval(q: Queryable, entityType: EntityType, entityId: string) {
  await q.query(`UPDATE approval_requests SET status = 'cancelled', decided_at = now() WHERE entity_type = $1 AND entity_id = $2 AND status = 'pending'`, [entityType, entityId]);
}

interface Row { id: string; entity_type: EntityType; entity_id: string; title: string; reason: string; required_permission: string; status: ApprovalRequest["status"]; requested_by: string; requested_at: Date; decided_by: string | null; decided_at: Date | null; decision_note: string | null; edited_by_me?: boolean }

const toApproval = (a: Actor) => (r: Row): ApprovalRequest => ({
  id: r.id, entityType: r.entity_type, entityId: r.entity_id, title: r.title, reason: r.reason, requiredPermission: r.required_permission,
  status: r.status, requestedBy: r.requested_by, requestedAt: iso(r.requested_at)!, decidedBy: r.decided_by, decidedAt: iso(r.decided_at),
  decisionNote: r.decision_note, href: hrefs[r.entity_type](r.entity_id),
  canDecide: r.status === "pending" && r.requested_by !== a.userId && !r.edited_by_me && a.permissions.has(r.required_permission as Permission),
});

export class ApprovalService {
  constructor(private deps: Deps) {}

  async list(a: Actor, status: string | undefined) {
    const perms = [...a.permissions];
    const st = status === "decided" ? ["approved", "rejected", "cancelled"] : ["pending"];
    const r = await this.deps.db.query<Row>(
      `SELECT ar.*, EXISTS (SELECT 1 FROM record_editors re WHERE re.organization_id = ar.organization_id AND re.entity_type = ar.entity_type
                AND re.entity_id = ar.entity_id AND re.user_id = $4) AS edited_by_me
         FROM approval_requests ar WHERE ar.organization_id = $1 AND ar.status = ANY($2)
         AND (ar.required_permission = ANY($3) OR ar.requested_by = $4)
       ORDER BY ar.requested_at DESC LIMIT 200`,
      [a.orgId, st, perms, a.userId],
    );
    return r.rows.map(toApproval(a));
  }

  async decide(a: Actor, id: string, body: unknown) {
    const d = parse(ApprovalDecisionSchema, body);
    if (!isUuid(id)) throw notFound("Approval");
    return this.deps.db.tx(async (q) => {
      const r = (await q.query<Row>(`SELECT * FROM approval_requests WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!r) throw notFound("Approval");
      if (!a.permissions.has(r.required_permission as Permission)) throw forbidden();
      if (r.status !== "pending") throw conflict("This approval was already decided.");
      if (r.requested_by === a.userId) throw forbidden("You can't approve your own request.");
      if (d.decision === "approve" && (await isEditor(q, a, r.entity_type, r.entity_id)))
        throw forbidden("You edited this, so someone else has to approve it.");
      const approved = d.decision === "approve";
      await q.query(
        `UPDATE approval_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
        [id, approved ? "approved" : "rejected", a.userId, d.note ?? null],
      );
      const h = handlers.get(r.entity_type);
      if (!h) throw conflict(`No handler for ${r.entity_type}`);
      await h(q, a, r.entity_id, approved, d.note ?? null);
      await audit(q, a, approved ? "approval.approve" : "approval.reject", r.entity_type, r.entity_id, { approvalId: id, note: d.note ?? null });
      await notify(q, a.orgId, r.requested_by, { kind: "system", title: `${approved ? "Approved" : "Rejected"}: ${r.title}`, body: d.note ?? "", href: hrefs[r.entity_type](r.entity_id) });
      return toApproval(a)({ ...r, status: approved ? "approved" : "rejected", decided_by: a.userId, decided_at: new Date(), decision_note: d.note ?? null });
    });
  }
}
