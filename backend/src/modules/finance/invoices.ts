import { CreditNoteInputSchema, InvoiceInputSchema, type Invoice, type InvoiceLine } from "@/lib/api/modules/finance";
import { divRound, fromPaise, sum, toPaise, toScaled } from "@/lib/money";
import { supplyTypeFor } from "@/lib/tax/gst";
import type { Queryable } from "../../db";
import { type Actor, type Deps, addDays, audit, emit, fyCode, getSettings, need, nextNumber, todayIst } from "../../lib/context";
import { conflict, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";
import { idempotent } from "../../lib/idempotency";
import { clientStateCode } from "../crm/clients";
import { MONTHS, addMonths } from "../delivery/subscriptions";
import { renderCommercialPdf } from "../sales/pdf";
import { partiesFor, priceLines, supplierState } from "../sales/quotations";
import { postJournal, systemAccounts } from "./ledger";

interface IRow {
  id: string; number: string | null; client_id: string; client_name: string; sales_order_id: string | null; project_id: string | null; milestone_id: string | null; subscription_id: string | null;
  billing_period: string | null; status: Invoice["status"]; invoice_date: string; due_date: string; supplier_state: string; place_of_supply: string; supply_type: "intra" | "inter";
  client_snapshot: Record<string, string | null>; subtotal: string; discount_total: string; taxable_total: string; cgst: string; sgst: string; igst: string; total: string;
  amount_paid: string; amount_credited: string; notes: string | null; journal_entry_id: string | null; issued_at: Date | null; created_at: Date;
}
type LRow = Omit<InvoiceLine, "lineNo" | "hsnSac" | "unitPrice" | "discountPct" | "taxRate"> & { line_no: number; hsn_sac: string; unit_price: string; discount_pct: string; tax_rate: string; revenue_account_id: string };
const I_SELECT = `SELECT i.*, c.display_name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id`;
const outstanding = (r: IRow) => fromPaise(toPaise(r.total) - toPaise(r.amount_paid) - toPaise(r.amount_credited));
const summary = (r: IRow): Invoice => ({
  id: r.id, number: r.number, clientId: r.client_id, clientName: r.client_name, salesOrderId: r.sales_order_id, projectId: r.project_id, milestoneId: r.milestone_id,
  subscriptionId: r.subscription_id, billingPeriod: r.billing_period, status: r.status, invoiceDate: r.invoice_date, dueDate: r.due_date, supplierState: r.supplier_state,
  placeOfSupply: r.place_of_supply, supplyType: r.supply_type, subtotal: r.subtotal, discountTotal: r.discount_total, taxableTotal: r.taxable_total, cgst: r.cgst, sgst: r.sgst, igst: r.igst,
  total: r.total, amountPaid: r.amount_paid, amountCredited: r.amount_credited, outstanding: outstanding(r), notes: r.notes, journalEntryId: r.journal_entry_id,
  issuedAt: iso(r.issued_at), createdAt: iso(r.created_at)!, lines: [], creditNotes: [], allocations: [],
});

export interface DraftLine { description: string; hsnSac: string; quantity: string; unitPrice: string; discountPct?: string; revenue?: "services" | "subscriptions" }

/** Recomputes paid/credited state from the source rows (never trusts a running counter alone). */
export async function refreshInvoiceStatus(q: Queryable, invoiceId: string) {
  await q.query(
    `UPDATE invoices i SET amount_paid = x.paid, amount_credited = x.credited,
            status = CASE WHEN x.paid + x.credited >= i.total THEN 'paid' WHEN x.paid + x.credited > 0 THEN 'partially_paid' ELSE 'issued' END
       FROM (SELECT coalesce((SELECT sum(amount) FROM receipt_allocations WHERE invoice_id = $1), 0) AS paid,
                    coalesce((SELECT sum(total) FROM credit_notes WHERE invoice_id = $1), 0) AS credited) x
      WHERE i.id = $1 AND i.status <> 'draft'`,
    [invoiceId],
  );
}

export class InvoiceService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private today() { return todayIst(this.deps.now()); }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "finance.view");
    const params: unknown[] = [a.orgId];
    const where = ["i.organization_id = $1"];
    if (query.status) { params.push([query.status].flat()); where.push(`i.status = ANY($${params.length})`); }
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`i.client_id = $${params.length}`); }
    if (query.overdue === "true") { params.push(this.today()); where.push(`i.status IN ('issued','partially_paid') AND i.due_date < $${params.length}::date`); }
    if (query.search) { params.push(likeTerm(String(query.search).toLowerCase())); where.push(`(lower(coalesce(i.number,'')) LIKE $${params.length} OR lower(c.display_name) LIKE $${params.length})`); }
    const r = await this.db.query<IRow>(`${I_SELECT} WHERE ${where.join(" AND ")} ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT 500`, params);
    return r.rows.map(summary);
  }

  async get(a: Actor, id: string, q: Queryable = this.db): Promise<Invoice> {
    need(a, "finance.view");
    if (!isUuid(id)) throw notFound("Invoice");
    const r = (await q.query<IRow>(`${I_SELECT} WHERE i.id = $1 AND i.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Invoice");
    const lines = await q.query<LRow & { credited: string | null }>(
      `SELECT l.*, (SELECT sum(cl.taxable) FROM credit_note_lines cl WHERE cl.invoice_line_id = l.id) AS credited FROM invoice_lines l WHERE l.invoice_id = $1 ORDER BY l.line_no`, [id]);
    const cns = await q.query<{ id: string; number: string; note_date: string; reason: string; total: string }>(`SELECT id, number, note_date, reason, total FROM credit_notes WHERE invoice_id = $1 ORDER BY created_at`, [id]);
    const al = await q.query<{ receipt_id: string; number: string; receipt_date: string; amount: string }>(
      `SELECT ra.receipt_id, r.number, r.receipt_date, ra.amount FROM receipt_allocations ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = $1 ORDER BY ra.created_at`, [id]);
    return {
      ...summary(r),
      lines: lines.rows.map((l) => ({ id: l.id, lineNo: l.line_no, description: l.description, hsnSac: l.hsn_sac, quantity: l.quantity, unitPrice: l.unit_price, discountPct: l.discount_pct, taxRate: l.tax_rate, gross: l.gross, discount: l.discount, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst, total: l.total, credited: fromPaise(toPaise(l.credited ?? "0")) })),
      creditNotes: cns.rows.map((c) => ({ id: c.id, number: c.number, noteDate: c.note_date, reason: c.reason, total: c.total })),
      allocations: al.rows.map((x) => ({ receiptId: x.receipt_id, receiptNumber: x.number, receiptDate: x.receipt_date, amount: x.amount })),
    };
  }

  /** Creates a draft with server-priced lines. Used by manual entry, milestones, orders and subscription billing. */
  async createDraft(
    q: Queryable, a: Pick<Actor, "orgId" | "userId" | "requestId" | "ip">,
    d: { clientId: string; salesOrderId?: string | null; projectId?: string | null; milestoneId?: string | null; subscriptionId?: string | null; billingPeriod?: string | null; invoiceDate: string; dueDate?: string; notes?: string | null; lines: DraftLine[] },
  ) {
    const pos = await clientStateCode(q, a.orgId, d.clientId);
    if (!pos) throw invalid("Add the client's GSTIN or billing state first — it decides CGST/SGST vs IGST.", { clientId: ["Place of supply unknown"] });
    const sup = await supplierState(q, a.orgId);
    const st = supplyTypeFor(sup, pos);
    const settings = await getSettings(q, a.orgId);
    const due = d.dueDate ?? addDays(d.invoiceDate, settings.finance.invoiceDueDays);
    if (due < d.invoiceDate) throw invalid("Due date is before the invoice date.", { dueDate: ["Before invoice date"] });
    const priced = await priceLines(q, a.orgId, d.lines.map((l) => ({ ...l, productId: null })), d.invoiceDate, st);
    const acc = await systemAccounts(q, a.orgId);
    const r = await q.query<{ id: string }>(
      `INSERT INTO invoices (organization_id, client_id, sales_order_id, project_id, milestone_id, subscription_id, billing_period, invoice_date, due_date, supplier_state, place_of_supply, supply_type,
                             subtotal, discount_total, taxable_total, cgst, sgst, igst, total, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [a.orgId, d.clientId, d.salesOrderId ?? null, d.projectId ?? null, d.milestoneId ?? null, d.subscriptionId ?? null, d.billingPeriod ?? null, d.invoiceDate, due, sup, pos, st,
       priced.totals.subtotal, priced.totals.discountTotal, priced.totals.taxableTotal, priced.totals.cgst, priced.totals.sgst, priced.totals.igst, priced.totals.grandTotal, d.notes ?? null, a.userId],
    );
    for (const [i, l] of priced.totals.lines.entries()) {
      await q.query(
        `INSERT INTO invoice_lines (organization_id, invoice_id, line_no, description, hsn_sac, quantity, unit_price, discount_pct, tax_rate, gross, discount, taxable, cgst, sgst, igst, total, revenue_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [a.orgId, r.rows[0].id, i + 1, l.description, l.hsnSac, l.quantity, l.unitPrice, l.discountPct, l.taxRate, l.gross, l.discount, l.taxable, l.cgst, l.sgst, l.igst, l.total,
         d.lines[i].revenue === "subscriptions" ? acc.rev_subscriptions : acc.rev_services],
      );
    }
    await audit(q, a, "invoice.draft", "invoice", r.rows[0].id, { total: priced.totals.grandTotal, source: d.milestoneId ? "milestone" : d.subscriptionId ? "subscription" : d.salesOrderId ? "sales_order" : "manual" });
    return r.rows[0].id;
  }

  /** The client must be ours, and a sales order must be this client's (same checks on create and edit). */
  private async checkRefs(q: Queryable, a: Actor, d: { clientId: string; salesOrderId?: string | null }) {
    if (!(await q.query(`SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2`, [d.clientId, a.orgId])).rows.length) throw invalid("Unknown client.", { clientId: ["Unknown"] });
    if (d.salesOrderId && !(await q.query(`SELECT 1 FROM sales_orders WHERE id = $1 AND client_id = $2 AND organization_id = $3`, [d.salesOrderId, d.clientId, a.orgId])).rows.length)
      throw invalid("That sales order belongs to another client.", { salesOrderId: ["Different client"] });
  }

  /**
   * Billing cap per sales order, compared pre-tax (tax follows from taxable value):
   * taxable billed on the order ≤ the order's taxable value + approved change requests.
   */
  private async checkOrderCap(q: Queryable, orgId: string, salesOrderId: string, invoiceId: string) {
    const so = (await q.query<{ taxable_total: string; status: string; billed: string | null; extra: string | null; this_taxable: string }>(
      `SELECT so.taxable_total, so.status,
              (SELECT sum(taxable_total) FROM invoices i WHERE i.sales_order_id = so.id AND i.status <> 'cancelled' AND i.id <> $2) AS billed,
              (SELECT sum(cr.impact_amount) FROM change_requests cr JOIN projects p ON p.id = cr.project_id
                WHERE p.sales_order_id = so.id AND cr.status = 'approved') AS extra,
              (SELECT taxable_total FROM invoices WHERE id = $2) AS this_taxable
         FROM sales_orders so WHERE so.id = $1 AND so.organization_id = $3 FOR UPDATE`, [salesOrderId, invoiceId, orgId])).rows[0];
    if (!so) throw invalid("Unknown sales order.");
    if (so.status === "cancelled") throw conflict("This sales order is cancelled.");
    const cap = toPaise(so.taxable_total) + toPaise(so.extra ?? "0");
    const after = toPaise(so.billed ?? "0") + toPaise(so.this_taxable);
    if (after > cap)
      throw conflict(`This would bill ${fromPaise(after)} (before tax) against ${fromPaise(cap)} agreed on the order and approved change requests. Approve a change request for extra work first.`);
  }

  async create(a: Actor, body: unknown) {
    need(a, "finance.invoice.issue");
    const d = parse(InvoiceInputSchema, body);
    const id = await this.db.tx(async (q) => {
      await this.checkRefs(q, a, d);
      const id = await this.createDraft(q, a, d);
      if (d.salesOrderId) await this.checkOrderCap(q, a.orgId, d.salesOrderId, id);
      return id;
    });
    return this.get(a, id);
  }

  async fromMilestone(a: Actor, milestoneId: string) {
    need(a, "finance.invoice.issue");
    if (!isUuid(milestoneId)) throw notFound("Milestone");
    const id = await this.db.tx(async (q) => {
      const m = (await q.query<{ id: string; name: string; seq: number; amount: string; status: string; project_id: string; client_id: string; sales_order_id: string | null; code: string; billable: boolean; project_status: string }>(
        `SELECT m.*, p.client_id, p.sales_order_id, p.code, p.billable, p.status AS project_status FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = $1 AND m.organization_id = $2 FOR UPDATE OF m`, [milestoneId, a.orgId])).rows[0];
      if (!m) throw notFound("Milestone");
      if (!m.billable) throw conflict("This project is not billable.");
      if (!["active", "on_hold", "completed"].includes(m.project_status)) throw conflict(`Milestones of a ${m.project_status} project can't be invoiced.`);
      if (m.status !== "signed_off") throw conflict(m.status === "invoiced" ? "This milestone is already invoiced." : "Invoice a milestone after the client signs it off.");
      if (toPaise(m.amount) <= 0n) throw conflict("This milestone has no billing amount.");
      const existing = await q.query(`SELECT 1 FROM invoices WHERE milestone_id = $1 AND status <> 'cancelled'`, [milestoneId]);
      if (existing.rows.length) throw conflict("A draft invoice already exists for this milestone.");
      const hsn = m.sales_order_id ? (await q.query<{ hsn_sac: string }>(`SELECT l.hsn_sac FROM sales_orders so JOIN quotation_lines l ON l.quotation_id = so.quotation_id WHERE so.id = $1 ORDER BY l.line_no LIMIT 1`, [m.sales_order_id])).rows[0]?.hsn_sac : undefined;
      const id = await this.createDraft(q, a, {
        clientId: m.client_id, salesOrderId: m.sales_order_id, projectId: m.project_id, milestoneId, invoiceDate: this.today(),
        lines: [{ description: `${m.code} · Milestone ${m.seq}: ${m.name}`, hsnSac: hsn ?? "998314", quantity: "1", unitPrice: m.amount }],
      });
      return id;
    });
    return this.get(a, id);
  }

  async fromSalesOrder(a: Actor, salesOrderId: string) {
    need(a, "finance.invoice.issue");
    if (!isUuid(salesOrderId)) throw notFound("Sales order");
    const id = await this.db.tx(async (q) => {
      const so = (await q.query<{ client_id: string; quotation_id: string; number: string }>(`SELECT client_id, quotation_id, number FROM sales_orders WHERE id = $1 AND organization_id = $2`, [salesOrderId, a.orgId])).rows[0];
      if (!so) throw notFound("Sales order");
      const lines = (await q.query<{ description: string; hsn_sac: string; quantity: string; unit_price: string; discount_pct: string; billing_cycle: string }>(
        `SELECT description, hsn_sac, quantity, unit_price, discount_pct, billing_cycle FROM quotation_lines WHERE quotation_id = $1 AND billing_cycle = 'one_time' ORDER BY line_no`, [so.quotation_id])).rows;
      if (!lines.length) throw conflict("This order has only recurring lines; bill them through subscriptions.");
      const id = await this.createDraft(q, a, {
        clientId: so.client_id, salesOrderId, invoiceDate: this.today(), notes: `Against sales order ${so.number}`,
        lines: lines.map((l) => ({ description: l.description, hsnSac: l.hsn_sac, quantity: l.quantity, unitPrice: l.unit_price, discountPct: l.discount_pct })),
      });
      await this.checkOrderCap(q, a.orgId, salesOrderId, id);
      return id;
    });
    return this.get(a, id);
  }

  /** Drafts are cheap: an edit replaces the draft (new id) so lines and totals are always server-priced together. */
  async updateDraft(a: Actor, id: string, body: unknown) {
    need(a, "finance.invoice.issue");
    const d = parse(InvoiceInputSchema, body);
    const newId = await this.db.tx(async (q) => {
      const cur = (await q.query<IRow>(`SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!cur) throw notFound("Invoice");
      if (cur.status !== "draft") throw conflict("Issued invoices can't be edited. Raise a credit note.");
      if (cur.milestone_id || cur.subscription_id) throw conflict("This draft comes from a milestone or subscription. Delete it and regenerate instead.");
      await this.checkRefs(q, a, d);
      await q.query(`DELETE FROM invoices WHERE id = $1`, [id]);
      const nid = await this.createDraft(q, a, d);
      if (d.salesOrderId) await this.checkOrderCap(q, a.orgId, d.salesOrderId, nid);
      return nid;
    });
    return this.get(a, newId);
  }

  async deleteDraft(a: Actor, id: string) {
    need(a, "finance.invoice.issue");
    await this.db.tx(async (q) => {
      const cur = (await q.query<IRow>(`SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!cur) throw notFound("Invoice");
      if (cur.status !== "draft") throw conflict("Only drafts can be deleted.");
      await q.query(`DELETE FROM invoices WHERE id = $1`, [id]);
      // Give the period back to the subscription so the next billing run drafts it again —
      // only when it was the latest billed period (otherwise later periods would be re-billed).
      if (cur.subscription_id && cur.billing_period)
        await q.query(
          `UPDATE subscriptions s SET next_billing_date = $2::date
            WHERE s.id = $1 AND s.next_billing_date > $2::date
              AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status <> 'cancelled' AND i.billing_period::date > $2::date)`,
          [cur.subscription_id, cur.billing_period]);
      await audit(q, a, "invoice.delete_draft", "invoice", id);
    });
  }

  /** Issue: re-price, assign the gap-free number, snapshot the buyer and post the sales journal — one transaction. */
  async issue(a: Actor, id: string) {
    need(a, "finance.invoice.issue");
    await this.db.tx(async (q) => {
      const cur = (await q.query<IRow>(`${I_SELECT} WHERE i.id = $1 AND i.organization_id = $2 FOR UPDATE OF i`, [id, a.orgId])).rows[0];
      if (!cur) throw notFound("Invoice");
      if (cur.status !== "draft") throw conflict("This invoice is already issued.");
      if (cur.invoice_date > addDays(this.today(), 0)) throw conflict("Invoices can't be issued with a future date.");
      const lines = (await q.query<LRow>(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_no`, [id])).rows;
      // The buyer snapshot below uses the client's current GSTIN/state, so the tax split must too.
      const posNow = await clientStateCode(q, a.orgId, cur.client_id);
      const supNow = await supplierState(q, a.orgId);
      if (!posNow || posNow !== cur.place_of_supply || supNow !== cur.supplier_state)
        throw conflict(`The place of supply changed since this draft was made (now ${posNow ?? "unknown"}, draft ${cur.place_of_supply}). Delete and recreate the draft so CGST/SGST vs IGST is correct.`);
      // Re-price with the rules in force on the invoice date; drafts may predate a rate change.
      const priced = await priceLines(q, a.orgId, lines.map((l) => ({ description: l.description, hsnSac: l.hsn_sac, quantity: l.quantity, unitPrice: l.unit_price, discountPct: l.discount_pct })), cur.invoice_date, cur.supply_type);
      if (priced.totals.grandTotal !== cur.total) throw conflict(`GST rates changed since this draft was made (total would be ${priced.totals.grandTotal}). Recreate the draft.`);
      if (cur.sales_order_id) await this.checkOrderCap(q, a.orgId, cur.sales_order_id, id);
      const s = await getSettings(q, a.orgId);
      const n = await nextNumber(q, a.orgId, `invoice:${fyCode(cur.invoice_date)}`);
      const number = `${s.profile.docPrefix}/INV/${fyCode(cur.invoice_date)}/${String(n).padStart(4, "0")}`;
      const { buyer } = await partiesFor(q, a.orgId, cur.client_id);
      const acc = await systemAccounts(q, a.orgId);
      const byRevenue = new Map<string, bigint>();
      for (const l of lines) byRevenue.set(l.revenue_account_id, (byRevenue.get(l.revenue_account_id) ?? 0n) + toPaise(l.taxable));
      const je = await postJournal(q, a, {
        date: cur.invoice_date, sourceType: "invoice", sourceId: id, memo: `Sales invoice ${number} — ${cur.client_name}`,
        lines: [
          { accountId: acc.ar, debit: cur.total, partyType: "client", partyId: cur.client_id },
          ...[...byRevenue.entries()].map(([accountId, v]) => ({ accountId, credit: fromPaise(v) })),
          { accountId: acc.gst_out_cgst, credit: cur.cgst }, { accountId: acc.gst_out_sgst, credit: cur.sgst }, { accountId: acc.gst_out_igst, credit: cur.igst },
        ],
      });
      await q.query(
        `UPDATE invoices SET status = 'issued', number = $2, journal_entry_id = $3, issued_by = $4, issued_at = now(), client_snapshot = $5 WHERE id = $1`,
        [id, number, je, a.userId, JSON.stringify({ legalName: buyer.legalName, gstin: buyer.gstin, address: buyer.address, stateCode: buyer.stateCode })],
      );
      if (cur.milestone_id) await q.query(`UPDATE milestones SET status = 'invoiced' WHERE id = $1`, [cur.milestone_id]);
      await audit(q, a, "invoice.issue", "invoice", id, { number, total: cur.total });
      await emit(q, a, "invoice.issued", "invoice", id, { clientId: cur.client_id, total: cur.total, dueDate: cur.due_date });
    });
    return this.get(a, id);
  }

  /** Credit note against specific invoice lines; tax reverses at each line's own rate. */
  async creditNote(a: Actor, invoiceId: string, body: unknown, idempotencyKey: string | undefined) {
    need(a, "finance.invoice.issue");
    const d = parse(CreditNoteInputSchema, body);
    await this.db.tx((q) => idempotent(q, a.orgId, "credit_note.create", idempotencyKey, { invoiceId, ...d }, async () => {
      const inv = (await q.query<IRow>(`${I_SELECT} WHERE i.id = $1 AND i.organization_id = $2 FOR UPDATE OF i`, [invoiceId, a.orgId])).rows[0];
      if (!inv) throw notFound("Invoice");
      if (inv.status === "draft" || inv.status === "cancelled") throw conflict("Credit notes apply to issued invoices.");
      if (d.noteDate < inv.invoice_date) throw invalid("The credit note can't predate the invoice.", { noteDate: ["Before invoice"] });
      const lines = new Map((await q.query<LRow & { credited: string | null }>(
        `SELECT l.*, (SELECT sum(cl.taxable) FROM credit_note_lines cl WHERE cl.invoice_line_id = l.id) AS credited FROM invoice_lines l WHERE l.invoice_id = $1`, [invoiceId])).rows.map((l) => [l.id, l]));
      const out: { lineId: string; taxable: bigint; cgst: bigint; sgst: bigint; igst: bigint; revenue: string }[] = [];
      for (const [i, cl] of d.lines.entries()) {
        const l = lines.get(cl.invoiceLineId);
        if (!l) throw invalid("That line isn't on this invoice.", { [`lines.${i}.invoiceLineId`]: ["Not on invoice"] });
        const t = toPaise(cl.taxable);
        if (t > toPaise(l.taxable) - toPaise(l.credited ?? "0")) throw invalid(`Line ${l.line_no}: can credit at most ${fromPaise(toPaise(l.taxable) - toPaise(l.credited ?? "0"))}.`, { [`lines.${i}.taxable`]: ["Too much"] });
        const rate = toScaled(l.tax_rate, 2);
        const cg = inv.supply_type === "intra" ? divRound(t * rate, 20_000n) : 0n;
        const ig = inv.supply_type === "inter" ? divRound(t * rate, 10_000n) : 0n;
        out.push({ lineId: l.id, taxable: t, cgst: cg, sgst: cg, igst: ig, revenue: l.revenue_account_id });
      }
      const tot = { taxable: sum(out.map((x) => x.taxable)), cgst: sum(out.map((x) => x.cgst)), sgst: sum(out.map((x) => x.sgst)), igst: sum(out.map((x) => x.igst)) };
      const total = tot.taxable + tot.cgst + tot.sgst + tot.igst;
      if (total > toPaise(outstanding(inv))) throw conflict(`The credit (${fromPaise(total)}) is more than what's outstanding (${outstanding(inv)}). Refund the paid part separately.`);
      const s = await getSettings(q, a.orgId);
      const n = await nextNumber(q, a.orgId, `credit_note:${fyCode(d.noteDate)}`);
      const number = `${s.profile.docPrefix}/CN/${fyCode(d.noteDate)}/${String(n).padStart(4, "0")}`;
      const acc = await systemAccounts(q, a.orgId);
      const byRev = new Map<string, bigint>();
      for (const x of out) byRev.set(x.revenue, (byRev.get(x.revenue) ?? 0n) + x.taxable);
      const je = await postJournal(q, a, {
        date: d.noteDate, sourceType: "credit_note", memo: `Credit note ${number} against ${inv.number}: ${d.reason}`,
        lines: [
          ...[...byRev.entries()].map(([accountId, v]) => ({ accountId, debit: fromPaise(v) })),
          { accountId: acc.gst_out_cgst, debit: fromPaise(tot.cgst) }, { accountId: acc.gst_out_sgst, debit: fromPaise(tot.sgst) }, { accountId: acc.gst_out_igst, debit: fromPaise(tot.igst) },
          { accountId: acc.ar, credit: fromPaise(total), partyType: "client", partyId: inv.client_id },
        ],
      });
      const cn = await q.query<{ id: string }>(
        `INSERT INTO credit_notes (organization_id, number, invoice_id, note_date, reason, taxable_total, cgst, sgst, igst, total, journal_entry_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [a.orgId, number, invoiceId, d.noteDate, d.reason, fromPaise(tot.taxable), fromPaise(tot.cgst), fromPaise(tot.sgst), fromPaise(tot.igst), fromPaise(total), je, a.userId],
      );
      for (const x of out) await q.query(
        `INSERT INTO credit_note_lines (organization_id, credit_note_id, invoice_line_id, taxable, cgst, sgst, igst) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.orgId, cn.rows[0].id, x.lineId, fromPaise(x.taxable), fromPaise(x.cgst), fromPaise(x.sgst), fromPaise(x.igst)]);
      await refreshInvoiceStatus(q, invoiceId);
      await audit(q, a, "credit_note.issue", "invoice", invoiceId, { number, total: fromPaise(total), reason: d.reason });
      return { creditNoteId: cn.rows[0].id };
    }));
    return this.get(a, invoiceId);
  }

  async pdf(a: Actor, id: string) {
    const inv = await this.get(a, id);
    const { supplier, buyer, bank } = await partiesFor(this.db, a.orgId, inv.clientId);
    const snap = inv.status === "draft" ? null : (await this.db.query<{ client_snapshot: { legalName: string; gstin: string | null; address: string; stateCode: string | null } }>(`SELECT client_snapshot FROM invoices WHERE id = $1`, [id])).rows[0].client_snapshot;
    const body = await renderCommercialPdf({
      supplier, buyer: snap ? { legalName: snap.legalName, gstin: snap.gstin, address: snap.address, stateCode: snap.stateCode } : buyer, bank,
      meta: { title: "Tax Invoice", number: inv.number ?? "DRAFT", date: inv.invoiceDate, extra: [["Due date", inv.dueDate], ["Reverse charge", "No"]] },
      lines: inv.lines, totals: { ...inv, grandTotal: inv.total }, notes: inv.notes, watermark: inv.status === "draft" ? "DRAFT" : null,
      footer: "This is a computer-generated tax invoice. E-invoice IRN is not generated by this system.",
    });
    await audit(this.db, a, "invoice.pdf", "invoice", id);
    return { filename: `${(inv.number ?? "draft").replace(/\//g, "-")}.pdf`, body };
  }

  /** Subscription billing run: one draft per active subscription per due period (unique index makes it idempotent). */
  async runBilling(a: Pick<Actor, "orgId" | "userId" | "requestId" | "ip">, today: string) {
    const due = (await this.db.query<{ id: string; client_id: string; sales_order_id: string | null; description: string; hsn_sac: string; amount: string; billing_cycle: "monthly" | "quarterly" | "yearly"; next_billing_date: string; end_date: string | null; number: string }>(
      `SELECT * FROM subscriptions WHERE organization_id = $1 AND status = 'active' AND next_billing_date <= $2::date AND (end_date IS NULL OR next_billing_date <= end_date) ORDER BY next_billing_date`, [a.orgId, today])).rows;
    let created = 0;
    const errors: string[] = [];
    for (const s of due) {
      try {
        await this.db.tx(async (q) => {
          const periodEnd = addDays(addMonths(s.next_billing_date, MONTHS[s.billing_cycle]), -1);
          await this.createDraft(q, a, {
            clientId: s.client_id, salesOrderId: null, subscriptionId: s.id, billingPeriod: s.next_billing_date, invoiceDate: today,
            notes: `${s.number}: service period ${s.next_billing_date} to ${periodEnd}`,
            lines: [{ description: `${s.description} (${s.next_billing_date} – ${periodEnd})`, hsnSac: s.hsn_sac, quantity: "1", unitPrice: s.amount, revenue: "subscriptions" }],
          });
          const next = addMonths(s.next_billing_date, MONTHS[s.billing_cycle]);
          await q.query(`UPDATE subscriptions SET next_billing_date = $2 WHERE id = $1`, [s.id, next]);
          created++;
        });
      } catch (e) {
        errors.push(`${s.number}: ${(e as Error).message}`);
      }
    }
    return { due: due.length, created, errors };
  }
}
