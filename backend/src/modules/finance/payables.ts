import { BillInputSchema, BillPaymentSchema, VendorInputSchema, type Bill, type Vendor } from "@/lib/api/modules/finance";
import { validateGstin } from "@/lib/validation/gstin";
import { divRound, fromPaise, toPaise, toScaled } from "@/lib/money";
import type { Queryable } from "../../db";
import { type Actor, type Deps, addDays, audit, fyCode, need, nextNumber } from "../../lib/context";
import { conflict, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";
import { idempotent } from "../../lib/idempotency";
import { postJournal, systemAccounts } from "./ledger";

interface BRow { id: string; number: string; kind: Bill["kind"]; vendor_id: string | null; vendor_name: string | null; vendor_bill_no: string | null; bill_date: string; due_date: string; description: string; expense_account_id: string; expense_account_name: string; taxable: string; cgst: string; sgst: string; igst: string; itc_eligible: boolean; tds_section: string | null; tds_amount: string; total: string; payable: string; amount_paid: string; status: Bill["status"]; journal_entry_id: string; created_at: Date }
const B_SELECT = `SELECT b.*, v.name AS vendor_name, ac.name AS expense_account_name FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id JOIN accounts ac ON ac.id = b.expense_account_id`;
const toBill = (r: BRow): Bill => ({
  id: r.id, number: r.number, kind: r.kind, vendorId: r.vendor_id, vendorName: r.vendor_name, vendorBillNo: r.vendor_bill_no, billDate: r.bill_date, dueDate: r.due_date,
  description: r.description, expenseAccountId: r.expense_account_id, expenseAccountName: r.expense_account_name, taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst,
  itcEligible: r.itc_eligible, tdsSection: r.tds_section, tdsAmount: r.tds_amount, total: r.total, payable: r.payable, amountPaid: r.amount_paid,
  outstanding: fromPaise(toPaise(r.payable) - toPaise(r.amount_paid)), status: r.status, journalEntryId: r.journal_entry_id, createdAt: iso(r.created_at)!,
});

export class PayablesService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  async vendors(a: Actor): Promise<Vendor[]> {
    need(a, "finance.view");
    const r = await this.db.query<{ id: string; name: string; gstin: string | null; pan: string | null; state_code: string | null; email: string | null; phone: string | null; outstanding: string | null }>(
      `SELECT v.*, (SELECT sum(payable - amount_paid) FROM bills b WHERE b.vendor_id = v.id) AS outstanding FROM vendors v WHERE v.organization_id = $1 ORDER BY v.name`, [a.orgId]);
    return r.rows.map((v) => ({ id: v.id, name: v.name, gstin: v.gstin, pan: v.pan, stateCode: v.state_code, email: v.email, phone: v.phone, outstanding: fromPaise(toPaise(v.outstanding ?? "0")) }));
  }

  async createVendor(a: Actor, body: unknown) {
    need(a, "finance.bill.manage");
    const d = parse(VendorInputSchema, body);
    if (d.gstin) { const c = validateGstin(d.gstin); if (!c.valid) throw invalid(c.reason, { gstin: [c.reason] }); }
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO vendors (organization_id, name, gstin, pan, state_code, email, phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a.orgId, d.name, d.gstin ?? null, d.gstin ? d.gstin.slice(2, 12) : null, d.gstin ? d.gstin.slice(0, 2) : d.stateCode ?? null, d.email ?? null, d.phone ?? null],
    ).catch((e) => { if ((e as { code?: string }).code === "23505") throw conflict("A vendor with this GSTIN exists."); throw e; });
    await audit(this.db, a, "vendor.create", "vendor", r.rows[0].id, { name: d.name, gstin: d.gstin ?? null });
    return (await this.vendors(a)).find((v) => v.id === r.rows[0].id)!;
  }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "finance.view");
    const params: unknown[] = [a.orgId];
    const where = ["b.organization_id = $1"];
    if (query.kind) { params.push(String(query.kind)); where.push(`b.kind = $${params.length}`); }
    if (query.status) { params.push([query.status].flat()); where.push(`b.status = ANY($${params.length})`); }
    if (query.vendorId && isUuid(query.vendorId)) { params.push(query.vendorId); where.push(`b.vendor_id = $${params.length}`); }
    const r = await this.db.query<BRow>(`${B_SELECT} WHERE ${where.join(" AND ")} ORDER BY b.bill_date DESC, b.created_at DESC LIMIT 500`, params);
    return r.rows.map(toBill);
  }

  async get(a: Actor, id: string, q: Queryable = this.db) {
    need(a, "finance.view");
    if (!isUuid(id)) throw notFound("Bill");
    const r = (await q.query<BRow>(`${B_SELECT} WHERE b.id = $1 AND b.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Bill");
    return toBill(r);
  }

  /** Records a bill (owed to a vendor) or an expense (already paid) and posts it. */
  async create(a: Actor, body: unknown, idempotencyKey: string | undefined) {
    need(a, "finance.bill.manage");
    const d = parse(BillInputSchema, body);
    const id = await this.db.tx((q) => idempotent(q, a.orgId, "bill.create", idempotencyKey, d, async () => {
      const exp = (await q.query<{ type: string; active: boolean }>(`SELECT type, active FROM accounts WHERE id = $1 AND organization_id = $2`, [d.expenseAccountId, a.orgId])).rows[0];
      if (!exp || !exp.active || !["expense", "asset"].includes(exp.type)) throw invalid("Pick an expense (or asset) account.", { expenseAccountId: ["Not an expense account"] });
      let vendor: { name: string } | undefined;
      if (d.vendorId) {
        vendor = (await q.query<{ name: string }>(`SELECT name FROM vendors WHERE id = $1 AND organization_id = $2`, [d.vendorId, a.orgId])).rows[0];
        if (!vendor) throw invalid("Unknown vendor.", { vendorId: ["Unknown"] });
      }
      if (d.paidFromAccountId && !(await q.query<{ is_bank: boolean }>(`SELECT is_bank FROM accounts WHERE id = $1 AND organization_id = $2`, [d.paidFromAccountId, a.orgId])).rows[0]?.is_bank)
        throw invalid("Pay from a bank or cash account.", { paidFromAccountId: ["Not a bank account"] });
      const taxable = toPaise(d.taxable);
      const rate = toScaled(d.gstRate, 2);
      const cg = d.interState ? 0n : divRound(taxable * rate, 20_000n);
      const ig = d.interState ? divRound(taxable * rate, 10_000n) : 0n;
      const total = taxable + cg * 2n + ig;
      const tds = toPaise(d.tdsAmount);
      if (tds > total) throw invalid("TDS can't exceed the bill.", { tdsAmount: ["Too high"] });
      const payable = total - tds;
      const acc = await systemAccounts(q, a.orgId);
      const n = await nextNumber(q, a.orgId, `${d.kind}:${fyCode(d.billDate)}`);
      const number = `${d.kind === "bill" ? "BILL" : "EXP"}/${fyCode(d.billDate)}/${String(n).padStart(4, "0")}`;
      const gstTotal = cg * 2n + ig;
      const je = await postJournal(q, a, {
        date: d.billDate, sourceType: "bill", memo: `${d.kind === "bill" ? "Bill" : "Expense"} ${number}${vendor ? ` — ${vendor.name}` : ""}: ${d.description}`,
        lines: [
          { accountId: d.expenseAccountId, debit: fromPaise(taxable + (d.itcEligible ? 0n : gstTotal)) },
          ...(d.itcEligible ? [{ accountId: acc.gst_in_cgst, debit: fromPaise(cg) }, { accountId: acc.gst_in_sgst, debit: fromPaise(cg) }, { accountId: acc.gst_in_igst, debit: fromPaise(ig) }] : []),
          { accountId: acc.tds_payable, credit: fromPaise(tds) },
          d.kind === "bill"
            ? { accountId: acc.ap, credit: fromPaise(payable), partyType: "vendor" as const, partyId: d.vendorId! }
            : { accountId: d.paidFromAccountId!, credit: fromPaise(payable) },
        ],
      });
      const r = await q.query<{ id: string }>(
        `INSERT INTO bills (organization_id, number, kind, vendor_id, vendor_bill_no, bill_date, due_date, description, expense_account_id, taxable, cgst, sgst, igst, itc_eligible, tds_section, tds_amount, total, payable, amount_paid, status, journal_entry_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
        [a.orgId, number, d.kind, d.vendorId ?? null, d.vendorBillNo ?? null, d.billDate, d.dueDate ?? (d.kind === "expense" ? d.billDate : addDays(d.billDate, 30)), d.description, d.expenseAccountId,
         fromPaise(taxable), fromPaise(cg), fromPaise(cg), fromPaise(ig), d.itcEligible, d.tdsSection ?? null, fromPaise(tds), fromPaise(total), fromPaise(payable),
         d.kind === "expense" ? fromPaise(payable) : "0", d.kind === "expense" ? "paid" : "unpaid", je, a.userId],
      ).catch((e) => { if ((e as { code?: string }).code === "23505") throw conflict("This vendor bill number is already recorded."); throw e; });
      await audit(q, a, `${d.kind}.record`, "bill", r.rows[0].id, { number, total: fromPaise(total) });
      return r.rows[0].id;
    }));
    return this.get(a, id);
  }

  async pay(a: Actor, id: string, body: unknown, idempotencyKey: string | undefined) {
    need(a, "finance.bill.manage");
    const d = parse(BillPaymentSchema, body);
    // A double-click or network retry must never pay a vendor twice.
    await this.db.tx((q) => idempotent(q, a.orgId, "bill.pay", idempotencyKey, { billId: id, ...d }, async () => {
      const b = (await q.query<BRow>(`${B_SELECT} WHERE b.id = $1 AND b.organization_id = $2 FOR UPDATE OF b`, [id, a.orgId])).rows[0];
      if (!b) throw notFound("Bill");
      if (b.kind !== "bill") throw conflict("Expenses are recorded as paid.");
      if (d.paymentDate < b.bill_date) throw invalid("Payment can't predate the bill.", { paymentDate: ["Before bill"] });
      const open = toPaise(b.payable) - toPaise(b.amount_paid);
      if (toPaise(d.amount) > open) throw invalid(`Only ${fromPaise(open)} is outstanding.`, { amount: ["More than outstanding"] });
      if (!(await q.query<{ is_bank: boolean }>(`SELECT is_bank FROM accounts WHERE id = $1 AND organization_id = $2`, [d.paidFromAccountId, a.orgId])).rows[0]?.is_bank)
        throw invalid("Pay from a bank or cash account.", { paidFromAccountId: ["Not a bank account"] });
      const acc = await systemAccounts(q, a.orgId);
      const je = await postJournal(q, a, {
        date: d.paymentDate, sourceType: "bill_payment", sourceId: id, memo: `Payment for ${b.number} — ${b.vendor_name}${d.reference ? ` (${d.reference})` : ""}`,
        lines: [{ accountId: acc.ap, debit: d.amount, partyType: "vendor", partyId: b.vendor_id! }, { accountId: d.paidFromAccountId, credit: d.amount }],
      });
      await q.query(`INSERT INTO bill_payments (organization_id, bill_id, payment_date, amount, paid_from_account_id, reference, journal_entry_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [a.orgId, id, d.paymentDate, d.amount, d.paidFromAccountId, d.reference ?? null, je, a.userId]);
      const paid = toPaise(b.amount_paid) + toPaise(d.amount);
      await q.query(`UPDATE bills SET amount_paid = $2, status = $3 WHERE id = $1`, [id, fromPaise(paid), paid === toPaise(b.payable) ? "paid" : "partially_paid"]);
      await audit(q, a, "bill.pay", "bill", id, { amount: d.amount });
      return { billId: id };
    }));
    return this.get(a, id);
  }
}
