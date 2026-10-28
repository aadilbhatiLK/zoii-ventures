import type { SalesOrder } from "@/lib/api/modules/delivery";
import { fromPaise, toPaise } from "@/lib/money";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, commercialScope, emit, fyCode, getSettings, need, nextNumber } from "../../lib/context";
import { conflict, notFound } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";

/** Called inside the acceptance transaction. Unique (quotation_id) makes it race-safe. */
export async function createSalesOrderFromQuotation(q: Queryable, a: Actor, quotationId: string, orderDate: string) {
  const qt = (await q.query<{ client_id: string; taxable_total: string; grand_total: string; status: string }>(
    `SELECT client_id, taxable_total, grand_total, status FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  if (qt.status !== "accepted") throw conflict("Only accepted quotations become sales orders.");
  const s = await getSettings(q, a.orgId);
  const n = await nextNumber(q, a.orgId, `sales_order:${fyCode(orderDate)}`);
  const number = `${s.profile.docPrefix}/SO/${fyCode(orderDate)}/${String(n).padStart(4, "0")}`;
  const tax = fromPaise(toPaise(qt.grand_total) - toPaise(qt.taxable_total));
  const r = await q.query<{ id: string }>(
    `INSERT INTO sales_orders (organization_id, number, client_id, quotation_id, order_date, taxable_total, tax_total, grand_total, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [a.orgId, number, qt.client_id, quotationId, orderDate, qt.taxable_total, tax, qt.grand_total, a.userId],
  );
  await audit(q, a, "sales_order.create", "sales_order", r.rows[0].id, { quotationId, number, grandTotal: qt.grand_total });
  await emit(q, a, "sales_order.created", "sales_order", r.rows[0].id, { clientId: qt.client_id });
  return r.rows[0].id;
}

interface SoRow { id: string; number: string; client_id: string; client_name: string; quotation_id: string; quotation_number: string; status: SalesOrder["status"]; order_date: string; taxable_total: string; tax_total: string; grand_total: string; invoiced: string | null; project_ids: string[]; created_at: Date; owner_id: string }
const SO_SELECT = `
  SELECT so.*, c.display_name AS client_name, CASE WHEN qt.revision > 1 THEN qt.number || '-R' || qt.revision ELSE qt.number END AS quotation_number, qt.owner_id,
    (SELECT sum(i.total) FROM invoices i WHERE i.sales_order_id = so.id AND i.status NOT IN ('draft','cancelled')) AS invoiced,
    coalesce((SELECT array_agg(p.id) FROM projects p WHERE p.sales_order_id = so.id), '{}') AS project_ids
  FROM sales_orders so JOIN clients c ON c.id = so.client_id JOIN quotations qt ON qt.id = so.quotation_id`;
const toSo = (r: SoRow): SalesOrder => ({
  id: r.id, number: r.number, clientId: r.client_id, clientName: r.client_name, quotationId: r.quotation_id, quotationNumber: r.quotation_number, status: r.status,
  orderDate: r.order_date, taxableTotal: r.taxable_total, taxTotal: r.tax_total, grandTotal: r.grand_total, invoicedTotal: fromPaise(toPaise(r.invoiced ?? "0")),
  projectIds: r.project_ids, createdAt: iso(r.created_at)!,
});

export class OrderService {
  constructor(private deps: Deps) {}
  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "orders.view", "orders.manage", "projects.activate");
    const sc = commercialScope(a, "qt.owner_id", 2);
    const params: unknown[] = [a.orgId, ...sc.params];
    const where = ["so.organization_id = $1", sc.sql];
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`so.client_id = $${params.length}`); }
    const r = await this.deps.db.query<SoRow>(`${SO_SELECT} WHERE ${where.join(" AND ")} ORDER BY so.created_at DESC LIMIT 300`, params);
    return r.rows.map(toSo);
  }
  async get(a: Actor, id: string) {
    need(a, "orders.view", "orders.manage", "projects.activate");
    if (!isUuid(id)) throw notFound("Sales order");
    const sc = commercialScope(a, "qt.owner_id", 3);
    const r = await this.deps.db.query<SoRow>(`${SO_SELECT} WHERE so.id = $1 AND so.organization_id = $2 AND ${sc.sql}`, [id, a.orgId, ...sc.params]);
    if (!r.rows[0]) throw notFound("Sales order");
    const lines = await this.deps.db.query(`SELECT line_no, description, hsn_sac, billing_cycle, quantity, unit_price, discount_pct, tax_rate, taxable, total FROM quotation_lines WHERE quotation_id = $1 ORDER BY line_no`, [r.rows[0].quotation_id]);
    return { ...toSo(r.rows[0]), lines: lines.rows };
  }
  async setStatus(a: Actor, id: string, status: "completed" | "cancelled") {
    need(a, "orders.manage");
    await this.deps.db.tx(async (q) => {
      const r = (await q.query<{ status: string }>(`SELECT status FROM sales_orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!r) throw notFound("Sales order");
      if (r.status !== "open") throw conflict("This order is already closed.");
      if (status === "cancelled") {
        const inv = await q.query(`SELECT 1 FROM invoices WHERE sales_order_id = $1 AND status NOT IN ('draft','cancelled')`, [id]);
        if (inv.rows.length) throw conflict("Invoices were issued against this order. Raise credit notes instead of cancelling.");
        const active = await q.query(`SELECT 1 FROM projects WHERE sales_order_id = $1 AND status IN ('active','on_hold')`, [id]);
        if (active.rows.length) throw conflict("Close or cancel the active project first.");
      }
      await q.query(`UPDATE sales_orders SET status = $2 WHERE id = $1`, [id, status]);
      await audit(q, a, `sales_order.${status === "completed" ? "complete" : "cancel"}`, "sales_order", id);
    });
    return this.get(a, id);
  }
}
