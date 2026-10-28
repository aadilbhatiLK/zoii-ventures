import { ClientDecisionSchema, QuotationInputSchema, type Quotation, type QuotationLine } from "@/lib/api/modules/sales";
import { divRound, fromPaise, times, toPaise, toScaled } from "@/lib/money";
import { computeTax, supplyTypeFor, type TaxLineInput } from "@/lib/tax/gst";
import { leadScope } from "@/lib/permissions";
import type { Queryable } from "../../db";
import { type Actor, type Deps, addDays, audit, commercialScope, emit, fyCode, getSettings, need, nextNumber, todayIst } from "../../lib/context";
import { HttpError, conflict, forbidden, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";
import { clientStateCode } from "../crm/clients";
import { createSalesOrderFromQuotation } from "../delivery/orders";
import { cancelPendingApproval, recordEditor, registerApprovalHandler, requestApproval } from "./approvals";
import { requireTaxRate } from "./catalogue";
import { quotationPdf, type Party } from "./pdf";

interface QRow {
  id: string; organization_id: string; number: string; revision: number; previous_id: string | null; client_id: string; client_name: string; lead_id: string | null;
  document_id: string | null; status: Quotation["status"]; quote_date: string; valid_until: string; supplier_state: string; place_of_supply: string;
  supply_type: "intra" | "inter"; subtotal: string; discount_total: string; taxable_total: string; cgst: string; sgst: string; igst: string; grand_total: string;
  notes: string | null; terms: string | null; approval_reasons: string[]; owner_id: string; approved_by: string | null; approved_at: Date | null;
  sent_at: Date | null; decided_at: Date | null; client_decision_note: string | null; created_by: string; created_at: Date; updated_at: Date; sales_order_id: string | null;
}
interface LRow { id: string; line_no: number; product_id: string | null; description: string; hsn_sac: string; billing_cycle: QuotationLine["billingCycle"]; quantity: string; unit_price: string; list_price: string | null; discount_pct: string; tax_rate: string; gross: string; discount: string; taxable: string; cgst: string; sgst: string; igst: string; total: string }

const Q_SELECT = `SELECT q.*, c.display_name AS client_name, (SELECT so.id FROM sales_orders so WHERE so.quotation_id = q.id) AS sales_order_id
  FROM quotations q JOIN clients c ON c.id = q.client_id`;

const toLine = (l: LRow): QuotationLine => ({
  id: l.id, lineNo: l.line_no, productId: l.product_id, description: l.description, hsnSac: l.hsn_sac, billingCycle: l.billing_cycle, quantity: l.quantity,
  unitPrice: l.unit_price, listPrice: l.list_price, discountPct: l.discount_pct, taxRate: l.tax_rate, gross: l.gross, discount: l.discount, taxable: l.taxable,
  cgst: l.cgst, sgst: l.sgst, igst: l.igst, total: l.total,
});
const toQuotation = (r: QRow, lines: LRow[]): Quotation => ({
  id: r.id, number: r.number, revision: r.revision, displayNumber: r.revision > 1 ? `${r.number}-R${r.revision}` : r.number, previousId: r.previous_id,
  clientId: r.client_id, clientName: r.client_name, leadId: r.lead_id, documentId: r.document_id, status: r.status, quoteDate: r.quote_date, validUntil: r.valid_until,
  supplierState: r.supplier_state, placeOfSupply: r.place_of_supply, supplyType: r.supply_type, subtotal: r.subtotal, discountTotal: r.discount_total,
  taxableTotal: r.taxable_total, cgst: r.cgst, sgst: r.sgst, igst: r.igst, grandTotal: r.grand_total, notes: r.notes, terms: r.terms,
  approvalReasons: r.approval_reasons, ownerId: r.owner_id, approvedBy: r.approved_by, approvedAt: iso(r.approved_at), sentAt: iso(r.sent_at),
  decidedAt: iso(r.decided_at), clientDecisionNote: r.client_decision_note, salesOrderId: r.sales_order_id, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  lines: lines.map(toLine),
});

export async function supplierState(q: Queryable, orgId: string) {
  const s = (await q.query<{ state_code: string | null }>(`SELECT state_code FROM organizations WHERE id = $1`, [orgId])).rows[0]?.state_code;
  if (!s) throw new HttpError("CONFIG", "Set your organisation's GSTIN / state before creating tax documents.");
  return s;
}

/** Prices and taxes every line on the server; the client's numbers are never trusted. */
export async function priceLines(
  q: Queryable, orgId: string, lines: { productId?: string | null; description: string; hsnSac: string; billingCycle?: string; quantity: string; unitPrice: string; discountPct?: string }[],
  date: string, supplyType: "intra" | "inter",
) {
  const priced: (TaxLineInput & { productId: string | null; listPrice: string | null; floorPrice: string | null; billingCycle: string })[] = [];
  for (const [i, l] of lines.entries()) {
    let listPrice: string | null = null, floorPrice: string | null = null;
    if (l.productId) {
      const p = (await q.query<{ unit_price: string; floor_price: string | null; active: boolean }>(`SELECT unit_price, floor_price, active FROM products WHERE id = $1 AND organization_id = $2`, [l.productId, orgId])).rows[0];
      if (!p) throw invalid("Unknown product.", { [`lines.${i}.productId`]: ["Unknown product"] });
      listPrice = p.unit_price; floorPrice = p.floor_price;
    }
    const taxRate = await requireTaxRate(q, orgId, l.hsnSac, date, `lines.${i}.hsnSac`);
    priced.push({ description: l.description, hsnSac: l.hsnSac, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct ?? "0", taxRate, productId: l.productId ?? null, listPrice, floorPrice, billingCycle: l.billingCycle ?? "one_time" });
  }
  return { priced, totals: computeTax(priced, supplyType) };
}

registerApprovalHandler("quotation", async (q, a, id, approved) => {
  const r = (await q.query<QRow>(`SELECT * FROM quotations WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!r || r.status !== "pending_approval") throw conflict("This quotation is no longer awaiting approval.");
  if (r.created_by === a.userId || r.owner_id === a.userId) throw forbidden("You can't approve your own quotation.");
  if (approved) await q.query(`UPDATE quotations SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, a.userId]);
  else await q.query(`UPDATE quotations SET status = 'draft' WHERE id = $1`, [id]);
});

export class QuotationService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private today() { return todayIst(this.deps.now()); }

  private async row(q: Queryable, a: Actor, id: string, lock = false): Promise<QRow> {
    need(a, "quotations.view", "quotations.create", "quotations.approve");
    if (!isUuid(id)) throw notFound("Quotation");
    const sc = commercialScope(a, "q.owner_id", 3);
    const r = await q.query<QRow>(`${Q_SELECT} WHERE q.id = $1 AND q.organization_id = $2 AND ${sc.sql}${lock ? " FOR UPDATE OF q" : ""}`, [id, a.orgId, ...sc.params]);
    if (!r.rows[0]) throw notFound("Quotation");
    return r.rows[0];
  }

  async get(a: Actor, id: string, q: Queryable = this.db) {
    const r = await this.row(q, a, id);
    const lines = await q.query<LRow>(`SELECT * FROM quotation_lines WHERE quotation_id = $1 ORDER BY line_no`, [id]);
    return toQuotation(r, lines.rows);
  }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "quotations.view", "quotations.create", "quotations.approve");
    const params: unknown[] = [a.orgId];
    const sc = commercialScope(a, "q.owner_id", 2);
    params.push(...sc.params);
    const where = ["q.organization_id = $1", sc.sql];
    if (query.status) { params.push([query.status].flat()); where.push(`q.status = ANY($${params.length})`); }
    else where.push(`q.status <> 'superseded'`);
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`q.client_id = $${params.length}`); }
    if (query.search) { params.push(likeTerm(String(query.search).toLowerCase())); where.push(`(lower(q.number) LIKE $${params.length} OR lower(c.display_name) LIKE $${params.length})`); }
    const r = await this.db.query<QRow>(`${Q_SELECT} WHERE ${where.join(" AND ")} ORDER BY q.created_at DESC LIMIT 300`, params);
    return r.rows.map((x) => toQuotation(x, []));
  }

  private async header(q: Queryable, a: Actor, clientId: string) {
    const client = (await q.query<{ id: string }>(`SELECT id FROM clients WHERE id = $1 AND organization_id = $2`, [clientId, a.orgId])).rows[0];
    if (!client) throw invalid("Unknown client.", { clientId: ["Unknown client"] });
    const pos = await clientStateCode(q, a.orgId, clientId);
    if (!pos) throw invalid("Add the client's GSTIN or billing state first — it decides CGST/SGST vs IGST.", { clientId: ["Place of supply unknown"] });
    const sup = await supplierState(q, a.orgId);
    return { pos, sup, supplyType: supplyTypeFor(sup, pos) };
  }

  /** Linked scope document and lead must belong to this client, and the lead must be visible to the caller. */
  private async checkRefs(q: Queryable, a: Actor, d: { clientId: string; documentId?: string | null; leadId?: string | null }) {
    if (d.documentId) {
      const doc = (await q.query<{ client_id: string | null }>(`SELECT client_id FROM documents WHERE id = $1 AND organization_id = $2`, [d.documentId, a.orgId])).rows[0];
      if (!doc) throw invalid("Unknown document.", { documentId: ["Unknown"] });
      if (doc.client_id && doc.client_id !== d.clientId) throw invalid("That document belongs to another client.", { documentId: ["Different client"] });
    }
    if (d.leadId) {
      const lead = (await q.query<{ client_id: string | null; owner_id: string; owner_team: string | null }>(
        `SELECT l.client_id, l.owner_id, u.team_id AS owner_team FROM leads l JOIN users u ON u.id = l.owner_id WHERE l.id = $1 AND l.organization_id = $2`, [d.leadId, a.orgId])).rows[0];
      const scope = leadScope({ roles: a.roles });
      const visible = lead && (scope === "all" || (scope === "team" && !!a.teamId && lead.owner_team === a.teamId) || lead.owner_id === a.userId);
      if (!visible) throw invalid("Unknown lead.", { leadId: ["Unknown"] });
      if (lead.client_id && lead.client_id !== d.clientId) throw invalid("That lead converted into another client.", { leadId: ["Different client"] });
    }
  }

  private async writeLines(q: Queryable, orgId: string, quotationId: string, priced: Awaited<ReturnType<typeof priceLines>>) {
    await q.query(`DELETE FROM quotation_lines WHERE quotation_id = $1`, [quotationId]);
    for (const [i, l] of priced.totals.lines.entries()) {
      const src = priced.priced[i];
      await q.query(
        `INSERT INTO quotation_lines (organization_id, quotation_id, line_no, product_id, description, hsn_sac, billing_cycle, quantity, unit_price, list_price, discount_pct, tax_rate, gross, discount, taxable, cgst, sgst, igst, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [orgId, quotationId, i + 1, src.productId, l.description, l.hsnSac, src.billingCycle, l.quantity, l.unitPrice, src.listPrice, l.discountPct, l.taxRate, l.gross, l.discount, l.taxable, l.cgst, l.sgst, l.igst, l.total],
      );
    }
    const t = priced.totals;
    await q.query(
      `UPDATE quotations SET subtotal=$2, discount_total=$3, taxable_total=$4, cgst=$5, sgst=$6, igst=$7, grand_total=$8 WHERE id = $1`,
      [quotationId, t.subtotal, t.discountTotal, t.taxableTotal, t.cgst, t.sgst, t.igst, t.grandTotal],
    );
  }

  async create(a: Actor, body: unknown) {
    need(a, "quotations.create");
    const d = parse(QuotationInputSchema, body);
    const settings = await getSettings(this.db, a.orgId);
    const quoteDate = d.quoteDate ?? this.today();
    const validUntil = d.validUntil ?? addDays(quoteDate, settings.quotations.validityDays);
    if (validUntil < quoteDate) throw invalid("Validity must end on or after the quote date.", { validUntil: ["Before quote date"] });
    const id = await this.db.tx(async (q) => {
      const h = await this.header(q, a, d.clientId);
      await this.checkRefs(q, a, d);
      const priced = await priceLines(q, a.orgId, d.lines, quoteDate, h.supplyType);
      const n = await nextNumber(q, a.orgId, `quotation:${fyCode(quoteDate)}`);
      const number = `${settings.profile.docPrefix}/QT/${fyCode(quoteDate)}/${String(n).padStart(4, "0")}`;
      const r = await q.query<{ id: string }>(
        `INSERT INTO quotations (organization_id, number, client_id, lead_id, document_id, quote_date, valid_until, supplier_state, place_of_supply, supply_type, notes, terms, owner_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
        [a.orgId, number, d.clientId, d.leadId ?? null, d.documentId ?? null, quoteDate, validUntil, h.sup, h.pos, h.supplyType, d.notes ?? null, d.terms ?? null, a.userId],
      );
      await this.writeLines(q, a.orgId, r.rows[0].id, priced);
      await audit(q, a, "quotation.create", "quotation", r.rows[0].id, { number, grandTotal: priced.totals.grandTotal });
      return r.rows[0].id;
    });
    return this.get(a, id);
  }

  async update(a: Actor, id: string, body: unknown) {
    need(a, "quotations.create");
    const d = parse(QuotationInputSchema, body);
    await this.db.tx(async (q) => {
      const r = await this.row(q, a, id, true);
      if (r.status !== "draft") throw conflict("Only drafts can be edited. Create a revision instead.");
      if (r.owner_id !== a.userId && !a.permissions.has("quotations.approve")) throw forbidden("Only the quotation owner can edit it.");
      if (d.expectedUpdatedAt && iso(r.updated_at) !== new Date(d.expectedUpdatedAt).toISOString()) throw conflict("Someone else changed this quotation after you opened it. Reload and retry.");
      const quoteDate = d.quoteDate ?? r.quote_date;
      const validUntil = d.validUntil ?? r.valid_until;
      if (validUntil < quoteDate) throw invalid("Validity must end on or after the quote date.", { validUntil: ["Before quote date"] });
      const h = await this.header(q, a, d.clientId);
      await this.checkRefs(q, a, d);
      // An omitted leadId/documentId keeps the existing link (the editor never sends leadId); null clears it.
      const leadId = d.leadId !== undefined ? d.leadId : r.lead_id;
      const documentId = d.documentId !== undefined ? d.documentId : r.document_id;
      if (d.documentId === undefined && documentId && d.clientId !== r.client_id) await this.checkRefs(q, a, { clientId: d.clientId, documentId });
      if (d.leadId === undefined && leadId && d.clientId !== r.client_id) {
        const lead = (await q.query<{ client_id: string | null }>(`SELECT client_id FROM leads WHERE id = $1`, [leadId])).rows[0];
        if (lead?.client_id && lead.client_id !== d.clientId) throw invalid("The linked lead converted into another client.", { leadId: ["Different client"] });
      }
      const priced = await priceLines(q, a.orgId, d.lines, quoteDate, h.supplyType);
      await q.query(
        `UPDATE quotations SET client_id=$2, lead_id=$3, document_id=$4, quote_date=$5, valid_until=$6, supplier_state=$7, place_of_supply=$8, supply_type=$9, notes=$10, terms=$11, approval_reasons='{}' WHERE id = $1`,
        [id, d.clientId, leadId ?? null, documentId ?? null, quoteDate, validUntil, h.sup, h.pos, h.supplyType, d.notes ?? null, d.terms ?? null],
      );
      await this.writeLines(q, a.orgId, id, priced);
      await recordEditor(q, a, "quotation", id);
      await audit(q, a, "quotation.update", "quotation", id, { grandTotal: { from: r.grand_total, to: priced.totals.grandTotal } });
    });
    return this.get(a, id);
  }

  /** Decides whether approval is needed: discount above the limit, price below floor, or a large deal. */
  private async approvalReasons(q: Queryable, orgId: string, id: string, grandTotal: string) {
    const s = await getSettings(q, orgId);
    const lines = (await q.query<LRow & { floor_price: string | null }>(
      `SELECT l.*, coalesce(p.floor_price, (SELECT max(p2.floor_price) FROM products p2 WHERE p2.organization_id = $2 AND l.product_id IS NULL AND lower(p2.name) = lower(trim(l.description)))) AS floor_price
         FROM quotation_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.quotation_id = $1 ORDER BY l.line_no`, [id, orgId],
    )).rows;
    const reasons: string[] = [];
    for (const l of lines) {
      if (toScaled(l.discount_pct, 2) > toScaled(String(s.quotations.discountApprovalPct), 2)) reasons.push(`Line ${l.line_no}: ${l.discount_pct}% discount is above the ${s.quotations.discountApprovalPct}% limit`);
      // Compare what the client actually pays per unit (after discount) with the floor.
      if (l.floor_price && toPaise(l.taxable) < times(toPaise(l.floor_price), l.quantity))
        reasons.push(`Line ${l.line_no}: net price ${fromPaise(divRound(toPaise(l.taxable) * 1000n, toScaled(l.quantity, 3)))} per unit is below the floor ${l.floor_price}`);
    }
    if (toPaise(grandTotal) > toPaise(s.quotations.valueApprovalAbove)) reasons.push(`Total ${grandTotal} is above ${s.quotations.valueApprovalAbove}`);
    return reasons;
  }

  async submit(a: Actor, id: string) {
    need(a, "quotations.create");
    await this.db.tx(async (q) => {
      const r = await this.row(q, a, id, true);
      if (r.status !== "draft") throw conflict("Only drafts can be submitted.");
      if (r.valid_until < this.today()) throw conflict("The validity date has passed. Update it before submitting.");
      const reasons = await this.approvalReasons(q, a.orgId, id, r.grand_total);
      if (reasons.length) {
        await q.query(`UPDATE quotations SET status = 'pending_approval', approval_reasons = $2 WHERE id = $1`, [id, reasons]);
        await requestApproval(q, a, { entityType: "quotation", entityId: id, title: `Quotation ${r.revision > 1 ? `${r.number}-R${r.revision}` : r.number} — ${r.client_name}`, reason: reasons.join("; "), permission: "quotations.approve" });
      } else {
        await q.query(`UPDATE quotations SET status = 'approved', approval_reasons = '{}', approved_at = now() WHERE id = $1`, [id]);
      }
      await audit(q, a, "quotation.submit", "quotation", id, { reasons });
    });
    return this.get(a, id);
  }

  async send(a: Actor, id: string) {
    await this.db.tx(async (q) => {
      const r = await this.row(q, a, id, true);
      if (!(a.permissions.has("quotations.send") || (a.permissions.has("quotations.create") && r.owner_id === a.userId))) throw forbidden();
      if (r.status !== "approved") throw conflict(r.status === "pending_approval" ? "This quotation is waiting for approval." : "Only approved quotations can be sent.");
      if (r.valid_until < this.today()) throw conflict("The validity date has passed. Create a revision.");
      await q.query(`UPDATE quotations SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
      const contact = (await q.query<{ email: string | null }>(`SELECT email FROM client_contacts WHERE client_id = $1 AND is_primary`, [r.client_id])).rows[0];
      if (contact?.email) {
        await q.query(
          `INSERT INTO outbox_messages (organization_id, channel, recipient, template, payload) VALUES ($1,'email',$2,'quotation_sent',$3)`,
          [a.orgId, contact.email, JSON.stringify({ quotationId: id, number: r.number })],
        );
      }
      await audit(q, a, "quotation.send", "quotation", id, { emailQueued: !!contact?.email });
      await emit(q, a, "quotation.sent", "quotation", id, { clientId: r.client_id });
    });
    return this.get(a, id);
  }

  /** Records the client's answer. Acceptance creates the sales order in the same transaction. */
  async clientDecision(a: Actor, id: string, body: unknown) {
    const d = parse(ClientDecisionSchema, body);
    await this.db.tx(async (q) => {
      const r = await this.row(q, a, id, true);
      if (!(a.permissions.has("quotations.send") || (a.permissions.has("quotations.create") && r.owner_id === a.userId))) throw forbidden();
      if (r.status !== "sent") throw conflict("Only a sent quotation can be accepted or rejected.");
      if (d.decision === "accepted" && r.valid_until < this.today()) throw conflict("This quotation has expired. Create a revision for the client to accept.");
      await q.query(`UPDATE quotations SET status = $2, decided_at = now(), client_decision_note = $3 WHERE id = $1`, [id, d.decision, [d.note, d.evidence && `Evidence: ${d.evidence}`].filter(Boolean).join(" · ") || null]);
      if (d.decision === "accepted") await createSalesOrderFromQuotation(q, a, id, this.today());
      await audit(q, a, `quotation.client_${d.decision === "accepted" ? "accept" : "reject"}`, "quotation", id, { note: d.note ?? null, evidence: d.evidence ?? null });
      await emit(q, a, `quotation.${d.decision}`, "quotation", id, { clientId: r.client_id, total: r.grand_total });
    });
    return this.get(a, id);
  }

  async revise(a: Actor, id: string) {
    need(a, "quotations.create");
    const newId = await this.db.tx(async (q) => {
      const r = await this.row(q, a, id, true);
      if (["draft", "accepted", "superseded", "cancelled"].includes(r.status)) throw conflict(r.status === "draft" ? "Edit the draft directly." : "This quotation can't be revised.");
      await cancelPendingApproval(q, "quotation", id);
      await q.query(`UPDATE quotations SET status = 'superseded' WHERE id = $1`, [id]);
      const s = await getSettings(q, a.orgId);
      const quoteDate = this.today();
      const ins = await q.query<{ id: string }>(
        `INSERT INTO quotations (organization_id, number, revision, previous_id, client_id, lead_id, document_id, quote_date, valid_until, supplier_state, place_of_supply, supply_type, notes, terms, owner_id, created_by)
         SELECT organization_id, number, revision + 1, id, client_id, lead_id, document_id, $2::date, $3::date, supplier_state, place_of_supply, supply_type, notes, terms, owner_id, $4
           FROM quotations WHERE id = $1 RETURNING id`,
        [id, quoteDate, addDays(quoteDate, s.quotations.validityDays), a.userId],
      );
      const lines = (await q.query<LRow>(`SELECT * FROM quotation_lines WHERE quotation_id = $1 ORDER BY line_no`, [id])).rows;
      const h = await this.header(q, a, r.client_id);
      const priced = await priceLines(q, a.orgId, lines.map((l) => ({ productId: l.product_id, description: l.description, hsnSac: l.hsn_sac, billingCycle: l.billing_cycle, quantity: l.quantity, unitPrice: l.unit_price, discountPct: l.discount_pct })), quoteDate, h.supplyType);
      await q.query(`UPDATE quotations SET supplier_state = $2, place_of_supply = $3, supply_type = $4 WHERE id = $1`, [ins.rows[0].id, h.sup, h.pos, h.supplyType]);
      await this.writeLines(q, a.orgId, ins.rows[0].id, priced);
      await audit(q, a, "quotation.revise", "quotation", ins.rows[0].id, { previousId: id, revision: r.revision + 1 });
      return ins.rows[0].id;
    });
    return this.get(a, newId);
  }

  async cancel(a: Actor, id: string) {
    need(a, "quotations.create");
    await this.db.tx(async (q) => {
      const r = await this.row(q, a, id, true);
      if (!["draft", "pending_approval", "approved"].includes(r.status)) throw conflict("Only unsent quotations can be cancelled.");
      await cancelPendingApproval(q, "quotation", id);
      await q.query(`UPDATE quotations SET status = 'cancelled' WHERE id = $1`, [id]);
      await audit(q, a, "quotation.cancel", "quotation", id);
    });
    return this.get(a, id);
  }

  async revisions(a: Actor, id: string) {
    const r = await this.row(this.db, a, id);
    const all = await this.db.query<QRow>(`${Q_SELECT} WHERE q.organization_id = $1 AND q.number = $2 ORDER BY q.revision DESC`, [a.orgId, r.number]);
    return all.rows.map((x) => toQuotation(x, []));
  }

  async pdf(a: Actor, id: string): Promise<{ filename: string; body: Buffer }> {
    const quote = await this.get(a, id);
    const { supplier, buyer, bank } = await partiesFor(this.db, a.orgId, quote.clientId);
    const body = await quotationPdf(quote, supplier, buyer, bank);
    await audit(this.db, a, "quotation.pdf", "quotation", id);
    return { filename: `${quote.displayNumber.replace(/\//g, "-")}.pdf`, body };
  }

  /** Worker: sent/approved quotations past their validity become expired. */
  static async expire(q: Queryable, today: string) {
    const r = await q.query<{ id: string }>(`UPDATE quotations SET status = 'expired' WHERE status IN ('sent', 'approved') AND valid_until < $1 RETURNING id`, [today]);
    return r.rowCount;
  }
}

export async function partiesFor(q: Queryable, orgId: string, clientId: string): Promise<{ supplier: Party; buyer: Party; bank: { name: string; account: string; ifsc: string; branch?: string } | null }> {
  const s = await getSettings(q, orgId);
  const org = (await q.query<{ legal_name: string; gstin: string | null; state_code: string | null }>(`SELECT legal_name, gstin, state_code FROM organizations WHERE id = $1`, [orgId])).rows[0];
  const c = (await q.query<{ legal_name: string; gstin: string | null; state_code: string | null; line1: string | null; line2: string | null; city: string | null; state: string | null; pincode: string | null }>(
    `SELECT c.legal_name, t.gstin, coalesce(t.state_code, a.state_code) AS state_code, a.line1, a.line2, a.city, a.state, a.pincode
       FROM clients c LEFT JOIN client_tax_profiles t ON t.client_id = c.id
       LEFT JOIN client_addresses a ON a.client_id = c.id AND a.kind = 'billing' AND a.is_default WHERE c.id = $1`, [clientId])).rows[0];
  return {
    supplier: { legalName: org.legal_name, gstin: org.gstin, stateCode: org.state_code, address: s.profile.address, email: s.profile.email, phone: s.profile.phone },
    buyer: { legalName: c.legal_name, gstin: c.gstin, stateCode: c.state_code, address: [c.line1, c.line2, [c.city, c.state, c.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n") },
    bank: s.profile.bank,
  };
}
export { fromPaise };
