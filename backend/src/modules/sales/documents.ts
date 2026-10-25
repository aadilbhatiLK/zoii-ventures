import { createHash } from "node:crypto";
import { DocumentCreateSchema, DocumentEditSchema, type DocumentDetail, type DocumentSummary, type DocumentVersion } from "@/lib/api/modules/sales";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, emit, fyCode, need, nextNumber } from "../../lib/context";
import { conflict, forbidden, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";
import { cancelPendingApproval, recordEditor, registerApprovalHandler, requestApproval } from "./approvals";

interface DocRow { id: string; number: string; kind: DocumentSummary["kind"]; title: string; client_id: string | null; client_name: string | null; lead_id: string | null; owner_id: string; approved_version: number | null; latest_version: number; latest_status: DocumentVersion["status"]; updated_at: Date }
interface VerRow { id: string; document_id: string; version: number; status: DocumentVersion["status"]; content: string; content_sha256: string | null; change_summary: string | null; author_id: string; submitted_at: Date | null; decided_by: string | null; decided_at: Date | null; decision_note: string | null; updated_at: Date }

const DOC_SELECT = `
  SELECT d.*, c.display_name AS client_name, v.version AS latest_version, v.status AS latest_status
    FROM documents d
    LEFT JOIN clients c ON c.id = d.client_id
    JOIN LATERAL (SELECT version, status FROM document_versions WHERE document_id = d.id ORDER BY version DESC LIMIT 1) v ON TRUE`;
const toSummary = (r: DocRow): DocumentSummary => ({
  id: r.id, number: r.number, kind: r.kind, title: r.title, clientId: r.client_id, clientName: r.client_name, leadId: r.lead_id,
  ownerId: r.owner_id, approvedVersion: r.approved_version, latestVersion: r.latest_version, latestStatus: r.latest_status, updatedAt: iso(r.updated_at)!,
});
const toVersion = (r: VerRow): DocumentVersion => ({
  id: r.id, version: r.version, status: r.status, content: r.content, contentSha256: r.content_sha256, changeSummary: r.change_summary,
  authorId: r.author_id, submittedAt: iso(r.submitted_at), decidedBy: r.decided_by, decidedAt: iso(r.decided_at), decisionNote: r.decision_note, updatedAt: iso(r.updated_at)!,
});
const canView = (a: Actor) => need(a, "documents.view", "documents.create", "documents.approve", "projects.view");

/** Approval of a version: freeze it (hash), supersede the previous approved version. */
registerApprovalHandler("document_version", async (q, a, versionId, approved, note) => {
  const v = (await q.query<VerRow & { organization_id: string }>(`SELECT * FROM document_versions WHERE id = $1 FOR UPDATE`, [versionId])).rows[0];
  if (!v || v.status !== "in_review") throw conflict("This version is no longer in review.");
  if (v.author_id === a.userId) throw forbidden("Authors can't approve their own document.");
  if (!a.permissions.has("documents.approve")) throw forbidden();
  if (approved) {
    await q.query(`UPDATE document_versions SET status = 'superseded' WHERE document_id = $1 AND status = 'approved'`, [v.document_id]);
    const sha = createHash("sha256").update(v.content).digest("hex");
    await q.query(`UPDATE document_versions SET status = 'approved', content_sha256 = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [versionId, sha, a.userId, note]);
    await q.query(`UPDATE documents SET approved_version = $2 WHERE id = $1`, [v.document_id, v.version]);
    await emit(q, a, "document.approved", "document", v.document_id, { version: v.version });
  } else {
    await q.query(`UPDATE document_versions SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`, [versionId, a.userId, note]);
  }
});

export class DocumentService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  async list(a: Actor, query: Record<string, unknown>) {
    canView(a);
    const params: unknown[] = [a.orgId];
    const where = ["d.organization_id = $1"];
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`d.client_id = $${params.length}`); }
    if (query.kind) { params.push(String(query.kind)); where.push(`d.kind = $${params.length}`); }
    if (query.search) { params.push(likeTerm(String(query.search).toLowerCase())); where.push(`(lower(d.title) LIKE $${params.length} OR lower(d.number) LIKE $${params.length})`); }
    const r = await this.db.query<DocRow>(`${DOC_SELECT} WHERE ${where.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 200`, params);
    return r.rows.map(toSummary);
  }

  async get(a: Actor, id: string, q: Queryable = this.db): Promise<DocumentDetail> {
    canView(a);
    if (!isUuid(id)) throw notFound("Document");
    const d = (await q.query<DocRow>(`${DOC_SELECT} WHERE d.id = $1 AND d.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!d) throw notFound("Document");
    const v = await q.query<VerRow>(`SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version DESC`, [id]);
    return { ...toSummary(d), versions: v.rows.map(toVersion) };
  }

  async create(a: Actor, body: unknown) {
    need(a, "documents.create");
    const d = parse(DocumentCreateSchema, body);
    const id = await this.db.tx(async (q) => {
      if (d.clientId && !(await q.query(`SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2`, [d.clientId, a.orgId])).rows.length) throw invalid("Unknown client.", { clientId: ["Unknown client"] });
      if (d.leadId && !(await q.query(`SELECT 1 FROM leads WHERE id = $1 AND organization_id = $2`, [d.leadId, a.orgId])).rows.length) throw invalid("Unknown lead.", { leadId: ["Unknown lead"] });
      const n = await nextNumber(q, a.orgId, `doc:${d.kind}`);
      const r = await q.query<{ id: string }>(
        `INSERT INTO documents (organization_id, number, kind, title, client_id, lead_id, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [a.orgId, `${d.kind.toUpperCase()}-${fyCode(this.deps.now())}-${String(n).padStart(3, "0")}`, d.kind, d.title, d.clientId ?? null, d.leadId ?? null, a.userId],
      );
      await q.query(`INSERT INTO document_versions (organization_id, document_id, version, content, author_id) VALUES ($1,$2,1,$3,$4)`, [a.orgId, r.rows[0].id, d.content, a.userId]);
      await audit(q, a, "document.create", "document", r.rows[0].id, { kind: d.kind, title: d.title });
      return r.rows[0].id;
    });
    return this.get(a, id);
  }

  private async openVersion(q: Queryable, a: Actor, docId: string) {
    const v = (await q.query<VerRow>(`SELECT * FROM document_versions WHERE document_id = $1 AND organization_id = $2 ORDER BY version DESC LIMIT 1 FOR UPDATE`, [docId, a.orgId])).rows[0];
    if (!v) throw notFound("Document");
    return v;
  }

  async edit(a: Actor, id: string, body: unknown) {
    need(a, "documents.create");
    const d = parse(DocumentEditSchema, body);
    await this.db.tx(async (q) => {
      await this.get(a, id, q);
      const v = await this.openVersion(q, a, id);
      if (v.status !== "draft") throw conflict(v.status === "in_review" ? "This version is in review. Withdraw it to edit." : "Start a new version to make changes.");
      if (d.expectedUpdatedAt && iso(v.updated_at) !== new Date(d.expectedUpdatedAt).toISOString()) throw conflict("Someone else saved this draft after you opened it. Reload and retry.");
      await q.query(`UPDATE document_versions SET content = $2, change_summary = coalesce($3, change_summary) WHERE id = $1`, [v.id, d.content, d.changeSummary ?? null]);
      await recordEditor(q, a, "document_version", v.id);
      await q.query(`UPDATE documents SET updated_at = now() WHERE id = $1`, [id]);
    });
    return this.get(a, id);
  }

  async newVersion(a: Actor, id: string) {
    need(a, "documents.create");
    await this.db.tx(async (q) => {
      await this.get(a, id, q);
      const v = await this.openVersion(q, a, id);
      if (v.status === "draft" || v.status === "in_review") throw conflict("There's already an open version.");
      await q.query(`INSERT INTO document_versions (organization_id, document_id, version, content, author_id) VALUES ($1,$2,$3,$4,$5)`, [a.orgId, id, v.version + 1, v.content, a.userId]);
      await audit(q, a, "document.new_version", "document", id, { version: v.version + 1 });
    });
    return this.get(a, id);
  }

  async submit(a: Actor, id: string) {
    need(a, "documents.submit_review");
    await this.db.tx(async (q) => {
      const doc = await this.get(a, id, q);
      const v = await this.openVersion(q, a, id);
      if (v.status !== "draft") throw conflict("Only a draft can be submitted.");
      if (v.content.trim().length < 20) throw invalid("Write the document before submitting it for review.");
      await q.query(`UPDATE document_versions SET status = 'in_review', submitted_at = now() WHERE id = $1`, [v.id]);
      await requestApproval(q, a, {
        entityType: "document_version", entityId: v.id, title: `${doc.number} v${v.version} — ${doc.title}`,
        reason: `${doc.kind.toUpperCase()} review${doc.clientName ? ` for ${doc.clientName}` : ""}`, permission: "documents.approve",
      });
      await audit(q, a, "document.submit", "document", id, { version: v.version });
    });
    return this.get(a, id);
  }

  async withdraw(a: Actor, id: string) {
    need(a, "documents.create");
    await this.db.tx(async (q) => {
      const v = await this.openVersion(q, a, id);
      if (v.status !== "in_review") throw conflict("Nothing to withdraw.");
      if (v.author_id !== a.userId && !a.permissions.has("documents.approve")) throw forbidden();
      await q.query(`UPDATE document_versions SET status = 'draft', submitted_at = NULL WHERE id = $1`, [v.id]);
      await cancelPendingApproval(q, "document_version", v.id);
      await audit(q, a, "document.withdraw", "document", id, { version: v.version });
    });
    return this.get(a, id);
  }
}
