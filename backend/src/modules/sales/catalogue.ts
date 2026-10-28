import { ProductInputSchema, TaxRuleInputSchema, type Product, type TaxRule } from "@/lib/api/modules/sales";
import type { Queryable } from "../../db";
import { type Actor, type Deps, addDays, audit, need, todayIst } from "../../lib/context";
import { HttpError, conflict, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";

/** GST rate in force for an HSN/SAC on a date (longest matching prefix wins). */
export async function taxRateFor(q: Queryable, orgId: string, hsnSac: string, date: string): Promise<string | null> {
  const r = await q.query<{ rate: string }>(
    `SELECT rate FROM tax_rules WHERE organization_id = $1 AND $2 LIKE hsn_sac || '%'
        AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)
      ORDER BY length(hsn_sac) DESC, effective_from DESC LIMIT 1`,
    [orgId, hsnSac, date],
  );
  return r.rows[0]?.rate ?? null;
}

export async function requireTaxRate(q: Queryable, orgId: string, hsnSac: string, date: string, field = "hsnSac") {
  const rate = await taxRateFor(q, orgId, hsnSac, date);
  if (rate === null) throw invalid(`No GST rule covers HSN/SAC ${hsnSac} on ${date}. Ask finance to add one in Tax rules.`, { [field]: ["No tax rule"] });
  return rate;
}

/**
 * Default rules for the services Zoii sells (SAC chapter 99, 18% since 1 July 2017).
 * Finance must review these; goods rates are deliberately not pre-filled.
 */
export const DEFAULT_TAX_RULES = [
  { hsnSac: "998313", description: "IT consulting and support services", rate: "18.00" },
  { hsnSac: "998314", description: "IT design and development services", rate: "18.00" },
  { hsnSac: "998315", description: "Hosting and IT infrastructure services", rate: "18.00" },
  { hsnSac: "998361", description: "Advertising services", rate: "18.00" },
  { hsnSac: "998365", description: "Sale of internet advertising space", rate: "18.00" },
  { hsnSac: "998713", description: "Maintenance and repair of computers (AMC)", rate: "18.00" },
  { hsnSac: "997331", description: "Licensing services for the right to use computer software", rate: "18.00" },
];

export async function seedDefaultTaxRules(q: Queryable, orgId: string) {
  for (const t of DEFAULT_TAX_RULES)
    await q.query(
      `INSERT INTO tax_rules (organization_id, hsn_sac, description, rate, effective_from) VALUES ($1,$2,$3,$4,'2017-07-01') ON CONFLICT DO NOTHING`,
      [orgId, t.hsnSac, t.description, t.rate],
    );
}

interface ProductRow { id: string; code: string; name: string; description: string | null; product_line: string; kind: Product["kind"]; billing_cycle: Product["billingCycle"]; unit: string; hsn_sac: string; unit_price: string; floor_price: string | null; active: boolean; updated_at: Date; tax_rate: string | null }
const toProduct = (r: ProductRow): Product => ({
  id: r.id, code: r.code, name: r.name, description: r.description, productLine: r.product_line, kind: r.kind, billingCycle: r.billing_cycle,
  unit: r.unit, hsnSac: r.hsn_sac, unitPrice: r.unit_price, floorPrice: r.floor_price, active: r.active, taxRate: r.tax_rate, updatedAt: iso(r.updated_at)!,
});

export class CatalogueService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "catalogue.view", "catalogue.manage", "quotations.create");
    const today = todayIst(this.deps.now());
    const params: unknown[] = [a.orgId, today];
    const where = ["p.organization_id = $1"];
    if (query.search) { params.push(likeTerm(String(query.search).toLowerCase())); where.push(`(lower(p.name) LIKE $${params.length} OR lower(p.code) LIKE $${params.length})`); }
    if (query.active !== "all") where.push("p.active");
    const r = await this.db.query<ProductRow>(
      `SELECT p.*, (SELECT t.rate FROM tax_rules t WHERE t.organization_id = p.organization_id AND p.hsn_sac LIKE t.hsn_sac || '%'
                     AND t.effective_from <= $2::date AND (t.effective_to IS NULL OR t.effective_to >= $2::date)
                     ORDER BY length(t.hsn_sac) DESC LIMIT 1) AS tax_rate
         FROM products p WHERE ${where.join(" AND ")} ORDER BY p.product_line, p.name`,
      params,
    );
    return r.rows.map(toProduct);
  }

  async get(a: Actor, id: string) {
    need(a, "catalogue.view", "catalogue.manage", "quotations.create");
    const all = await this.list(a, { active: "all" });
    const p = all.find((x) => x.id === id);
    if (!p) throw notFound("Product");
    return p;
  }

  async create(a: Actor, body: unknown) {
    need(a, "catalogue.manage");
    const d = parse(ProductInputSchema, body);
    const id = await this.db.tx(async (q) => {
      const r = await q.query<{ id: string }>(
        `INSERT INTO products (organization_id, code, name, description, product_line, kind, billing_cycle, unit, hsn_sac, unit_price, floor_price, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [a.orgId, d.code, d.name, d.description ?? null, d.productLine, d.kind, d.billingCycle, d.unit, d.hsnSac, d.unitPrice, d.floorPrice ?? null, d.active],
      );
      await q.query(`INSERT INTO product_price_history (organization_id, product_id, unit_price, floor_price, changed_by) VALUES ($1,$2,$3,$4,$5)`, [a.orgId, r.rows[0].id, d.unitPrice, d.floorPrice ?? null, a.userId]);
      await audit(q, a, "product.create", "product", r.rows[0].id, { code: d.code, unitPrice: d.unitPrice });
      return r.rows[0].id;
    }).catch((e) => { if ((e as { code?: string }).code === "23505") throw conflict("A product with this code already exists."); throw e; });
    return this.get(a, id);
  }

  async update(a: Actor, id: string, body: unknown) {
    need(a, "catalogue.manage");
    const d = parse(ProductInputSchema, body);
    if (!isUuid(id)) throw notFound("Product");
    await this.db.tx(async (q) => {
      const before = (await q.query<ProductRow>(`SELECT * FROM products WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!before) throw notFound("Product");
      await q.query(
        `UPDATE products SET code=$2, name=$3, description=$4, product_line=$5, kind=$6, billing_cycle=$7, unit=$8, hsn_sac=$9, unit_price=$10, floor_price=$11, active=$12 WHERE id = $1`,
        [id, d.code, d.name, d.description ?? null, d.productLine, d.kind, d.billingCycle, d.unit, d.hsnSac, d.unitPrice, d.floorPrice ?? null, d.active],
      );
      if (before.unit_price !== Number(d.unitPrice).toFixed(2) || (before.floor_price ?? null) !== (d.floorPrice ? Number(d.floorPrice).toFixed(2) : null)) {
        await q.query(`INSERT INTO product_price_history (organization_id, product_id, unit_price, floor_price, changed_by) VALUES ($1,$2,$3,$4,$5)`, [a.orgId, id, d.unitPrice, d.floorPrice ?? null, a.userId]);
      }
      await audit(q, a, "product.update", "product", id, { unitPrice: { from: before.unit_price, to: d.unitPrice }, active: { from: before.active, to: d.active } });
    });
    return this.get(a, id);
  }

  async priceHistory(a: Actor, id: string) {
    need(a, "catalogue.view", "catalogue.manage");
    const r = await this.db.query<{ unit_price: string; floor_price: string | null; changed_by: string | null; changed_at: Date }>(
      `SELECT h.unit_price, h.floor_price, h.changed_by, h.changed_at FROM product_price_history h WHERE h.product_id = $1 AND h.organization_id = $2 ORDER BY h.changed_at DESC`,
      [id, a.orgId],
    );
    return r.rows.map((x) => ({ unitPrice: x.unit_price, floorPrice: x.floor_price, changedBy: x.changed_by, changedAt: iso(x.changed_at) }));
  }

  // ---------- tax rules ----------
  async taxRules(a: Actor): Promise<TaxRule[]> {
    need(a, "catalogue.view", "tax.manage", "finance.view", "quotations.create");
    const r = await this.db.query<{ id: string; hsn_sac: string; description: string; rate: string; effective_from: string; effective_to: string | null }>(
      `SELECT id, hsn_sac, description, rate, effective_from, effective_to FROM tax_rules WHERE organization_id = $1 ORDER BY hsn_sac, effective_from DESC`, [a.orgId],
    );
    return r.rows.map((x) => ({ id: x.id, hsnSac: x.hsn_sac, description: x.description, rate: x.rate, effectiveFrom: x.effective_from, effectiveTo: x.effective_to }));
  }

  /** Adds a rate version. The open-ended previous version is closed the day before. */
  async addTaxRule(a: Actor, body: unknown) {
    need(a, "tax.manage");
    const d = parse(TaxRuleInputSchema, body);
    await this.db.tx(async (q) => {
      const later = await q.query(`SELECT 1 FROM tax_rules WHERE organization_id = $1 AND hsn_sac = $2 AND effective_from >= $3`, [a.orgId, d.hsnSac, d.effectiveFrom]);
      if (later.rows.length) throw conflict("A rule for this HSN/SAC already starts on or after that date.");
      await q.query(
        `UPDATE tax_rules SET effective_to = $3::date - 1 WHERE organization_id = $1 AND hsn_sac = $2 AND effective_from < $3 AND (effective_to IS NULL OR effective_to >= $3)`,
        [a.orgId, d.hsnSac, d.effectiveFrom],
      );
      const r = await q.query<{ id: string }>(
        `INSERT INTO tax_rules (organization_id, hsn_sac, description, rate, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [a.orgId, d.hsnSac, d.description, d.rate, d.effectiveFrom, a.userId],
      );
      await audit(q, a, "tax_rule.create", "tax_rule", r.rows[0].id, d);
    });
    return this.taxRules(a);
  }

  /** Preview helper for the UI: the rate that would apply today and on a given date. */
  async rateLookup(a: Actor, hsnSac: string, date?: string) {
    need(a, "catalogue.view", "quotations.create", "finance.view");
    if (!/^[0-9]{4,8}$/.test(hsnSac)) throw new HttpError("VALIDATION", "HSN/SAC is 4–8 digits");
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIst(this.deps.now());
    return { hsnSac, date: d, rate: await taxRateFor(this.db, a.orgId, hsnSac, d) };
  }
}
export { addDays };
