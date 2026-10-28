import { SubscriptionInputSchema, type Subscription } from "@/lib/api/modules/delivery";
import { z } from "zod";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, commercialScope, need, nextNumber, notify, todayIst } from "../../lib/context";
import { conflict, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";
import { requireTaxRate } from "../sales/catalogue";

interface SRow { id: string; number: string; client_id: string; client_name: string; product_id: string | null; sales_order_id: string | null; kind: Subscription["kind"]; description: string; hsn_sac: string; amount: string; billing_cycle: Subscription["billingCycle"]; status: Subscription["status"]; start_date: string; end_date: string | null; next_billing_date: string | null; auto_renew: boolean; renewal_notice_days: number; owner_id: string; created_at: Date }
const toSub = (r: SRow): Subscription => ({
  id: r.id, number: r.number, clientId: r.client_id, clientName: r.client_name, productId: r.product_id, salesOrderId: r.sales_order_id, kind: r.kind, description: r.description,
  hsnSac: r.hsn_sac, amount: r.amount, billingCycle: r.billing_cycle, status: r.status, startDate: r.start_date, endDate: r.end_date, nextBillingDate: r.next_billing_date,
  autoRenew: r.auto_renew, renewalNoticeDays: r.renewal_notice_days, ownerId: r.owner_id, createdAt: iso(r.created_at)!,
});
const S_SELECT = `SELECT s.*, c.display_name AS client_name FROM subscriptions s JOIN clients c ON c.id = s.client_id`;

export const MONTHS: Record<Subscription["billingCycle"], number> = { monthly: 1, quarterly: 3, yearly: 12 };
/** Calendar-month arithmetic that clamps to month end (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export class SubscriptionService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "orders.view", "orders.manage", "finance.view");
    const sc = commercialScope(a, "s.owner_id", 2);
    const params: unknown[] = [a.orgId, ...sc.params];
    const where = ["s.organization_id = $1", sc.sql];
    if (query.kind) { params.push(String(query.kind)); where.push(`s.kind = $${params.length}`); }
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`s.client_id = $${params.length}`); }
    const r = await this.db.query<SRow>(`${S_SELECT} WHERE ${where.join(" AND ")} ORDER BY s.status, s.next_billing_date NULLS LAST LIMIT 500`, params);
    return r.rows.map(toSub);
  }

  async get(a: Actor, id: string) {
    need(a, "orders.view", "orders.manage", "finance.view");
    if (!isUuid(id)) throw notFound("Subscription");
    const sc = commercialScope(a, "s.owner_id", 3);
    const r = await this.db.query<SRow>(`${S_SELECT} WHERE s.id = $1 AND s.organization_id = $2 AND ${sc.sql}`, [id, a.orgId, ...sc.params]);
    if (!r.rows[0]) throw notFound("Subscription");
    return toSub(r.rows[0]);
  }

  async create(a: Actor, body: unknown) {
    need(a, "orders.manage");
    const d = parse(SubscriptionInputSchema, body);
    if (d.endDate && d.endDate < d.startDate) throw invalid("End date is before the start.", { endDate: ["Before start"] });
    const id = await this.db.tx(async (q) => {
      if (!(await q.query(`SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2`, [d.clientId, a.orgId])).rows.length) throw invalid("Unknown client.", { clientId: ["Unknown"] });
      if (d.salesOrderId && !(await q.query(`SELECT 1 FROM sales_orders WHERE id = $1 AND client_id = $2`, [d.salesOrderId, d.clientId])).rows.length) throw invalid("That sales order belongs to another client.", { salesOrderId: ["Mismatch"] });
      await requireTaxRate(q, a.orgId, d.hsnSac, d.startDate);
      const n = await nextNumber(q, a.orgId, `subscription:${d.kind}`);
      const r = await q.query<{ id: string }>(
        `INSERT INTO subscriptions (organization_id, number, client_id, product_id, sales_order_id, kind, description, hsn_sac, amount, billing_cycle, start_date, end_date, next_billing_date, auto_renew, renewal_notice_days, owner_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$14,$15,$16) RETURNING id`,
        [a.orgId, `${d.kind === "amc" ? "AMC" : "SUB"}-${String(n).padStart(4, "0")}`, d.clientId, d.productId ?? null, d.salesOrderId ?? null, d.kind, d.description, d.hsnSac, d.amount, d.billingCycle,
         d.startDate, d.endDate ?? null, d.autoRenew, d.renewalNoticeDays, d.ownerId ?? a.userId, a.userId],
      );
      await audit(q, a, "subscription.create", "subscription", r.rows[0].id, d);
      return r.rows[0].id;
    });
    return this.get(a, id);
  }

  async setStatus(a: Actor, id: string, body: unknown) {
    need(a, "orders.manage");
    const { status } = parse(z.object({ status: z.enum(["active", "paused", "cancelled"]) }), body);
    await this.db.tx(async (q) => {
      const s = (await q.query<SRow>(`${S_SELECT} WHERE s.id = $1 AND s.organization_id = $2 FOR UPDATE OF s`, [id, a.orgId])).rows[0];
      if (!s) throw notFound("Subscription");
      if (s.status === "cancelled" || s.status === "expired") throw conflict("This subscription has ended.");
      const today = todayIst(this.deps.now());
      const next = status === "active" ? (s.next_billing_date && s.next_billing_date >= today ? s.next_billing_date : today) : s.next_billing_date;
      await q.query(`UPDATE subscriptions SET status = $2, next_billing_date = $3 WHERE id = $1`, [id, status, status === "cancelled" ? null : next]);
      await audit(q, a, "subscription.status", "subscription", id, { from: s.status, to: status });
    });
    return this.get(a, id);
  }

  async renew(a: Actor, id: string, body: unknown) {
    need(a, "orders.manage");
    const { months } = parse(z.object({ months: z.number().int().min(1).max(60) }), body);
    await this.db.tx(async (q) => {
      const s = (await q.query<SRow>(`${S_SELECT} WHERE s.id = $1 AND s.organization_id = $2 FOR UPDATE OF s`, [id, a.orgId])).rows[0];
      if (!s) throw notFound("Subscription");
      if (s.status === "cancelled") throw conflict("Cancelled subscriptions can't be renewed; create a new one.");
      const base = s.end_date ?? todayIst(this.deps.now());
      const end = addMonths(base, months);
      await q.query(`UPDATE subscriptions SET end_date = $2, status = 'active', next_billing_date = coalesce(next_billing_date, $3) WHERE id = $1`, [id, end, base]);
      await audit(q, a, "subscription.renew", "subscription", id, { from: s.end_date, to: end });
    });
    return this.get(a, id);
  }

  /** Worker: renewal reminders and expiry (idempotent via notification dedupe keys). */
  static async scan(q: Queryable, today: string) {
    const due = await q.query<SRow & { organization_id: string }>(
      `${S_SELECT} WHERE s.status = 'active' AND s.end_date IS NOT NULL AND s.end_date - s.renewal_notice_days <= $1::date AND s.end_date >= $1::date`, [today]);
    for (const s of due.rows)
      await notify(q, s.organization_id, s.owner_id, { kind: "system", title: `Renewal due: ${s.client_name} (${s.number})`, body: `Ends ${s.end_date}${s.auto_renew ? " · auto-renew on" : ""}`, href: `/subscriptions`, dedupeKey: `renewal|${s.id}|${s.end_date}` });
    // Auto-renew rolls the term forward by one cycle; otherwise the subscription expires.
    const ended = await q.query<SRow>(`SELECT * FROM subscriptions WHERE status = 'active' AND end_date IS NOT NULL AND end_date < $1::date`, [today]);
    for (const s of ended.rows) {
      if (s.auto_renew) await q.query(`UPDATE subscriptions SET end_date = $2 WHERE id = $1`, [s.id, addMonths(s.end_date!, MONTHS[s.billing_cycle] * Math.max(1, Math.round(12 / MONTHS[s.billing_cycle])))]);
      else await q.query(`UPDATE subscriptions SET status = 'expired', next_billing_date = NULL WHERE id = $1`, [s.id]);
    }
    return { reminders: due.rows.length, ended: ended.rows.length };
  }
}
