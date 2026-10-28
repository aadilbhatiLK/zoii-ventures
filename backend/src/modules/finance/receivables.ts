import { AllocateSchema, ReceiptInputSchema, type Receipt } from "@/lib/api/modules/finance";
import { fromPaise, sum, toPaise } from "@/lib/money";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, emit, fyCode, getSettings, need, nextNumber } from "../../lib/context";
import { conflict, invalid, notFound, parse } from "../../lib/errors";
import { idempotent } from "../../lib/idempotency";
import { iso, isUuid } from "../../lib/query";
import { refreshInvoiceStatus } from "./invoices";
import { postJournal, systemAccounts } from "./ledger";

interface RRow { id: string; number: string; client_id: string; client_name: string; receipt_date: string; amount: string; tds_amount: string; method: string; reference: string | null; deposit_account_id: string; journal_entry_id: string; created_at: Date; allocated: string | null }
const R_SELECT = `SELECT r.*, c.display_name AS client_name, (SELECT sum(amount) FROM receipt_allocations ra WHERE ra.receipt_id = r.id) AS allocated FROM receipts r JOIN clients c ON c.id = r.client_id`;

export class ReceiptService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  private toReceipt(r: RRow, allocations: Receipt["allocations"]): Receipt {
    const gross = toPaise(r.amount) + toPaise(r.tds_amount);
    const alloc = toPaise(r.allocated ?? "0");
    return {
      id: r.id, number: r.number, clientId: r.client_id, clientName: r.client_name, receiptDate: r.receipt_date, amount: r.amount, tdsAmount: r.tds_amount, method: r.method,
      reference: r.reference, depositAccountId: r.deposit_account_id, allocated: fromPaise(alloc), unallocated: fromPaise(gross - alloc), journalEntryId: r.journal_entry_id,
      createdAt: iso(r.created_at)!, allocations,
    };
  }

  async list(a: Actor, query: Record<string, unknown>) {
    need(a, "finance.view");
    const params: unknown[] = [a.orgId];
    const where = ["r.organization_id = $1"];
    if (query.clientId && isUuid(query.clientId)) { params.push(query.clientId); where.push(`r.client_id = $${params.length}`); }
    if (query.unallocated === "true") where.push(`r.amount + r.tds_amount > coalesce((SELECT sum(amount) FROM receipt_allocations ra WHERE ra.receipt_id = r.id), 0)`);
    const r = await this.db.query<RRow>(`${R_SELECT} WHERE ${where.join(" AND ")} ORDER BY r.receipt_date DESC, r.created_at DESC LIMIT 500`, params);
    return r.rows.map((x) => this.toReceipt(x, []));
  }

  async get(a: Actor, id: string, q: Queryable = this.db) {
    need(a, "finance.view");
    if (!isUuid(id)) throw notFound("Receipt");
    const r = (await q.query<RRow>(`${R_SELECT} WHERE r.id = $1 AND r.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Receipt");
    const al = await q.query<{ invoice_id: string; number: string; amount: string }>(`SELECT ra.invoice_id, i.number, ra.amount FROM receipt_allocations ra JOIN invoices i ON i.id = ra.invoice_id WHERE ra.receipt_id = $1 ORDER BY ra.created_at`, [id]);
    return this.toReceipt(r, al.rows.map((x) => ({ invoiceId: x.invoice_id, invoiceNumber: x.number, amount: x.amount })));
  }

  /** Allocations are checked against each invoice's outstanding balance under a row lock. */
  private async allocate(q: Queryable, a: Actor, receiptId: string, clientId: string, cap: bigint, allocations: { invoiceId: string; amount: string }[]) {
    const already = toPaise((await q.query<{ v: string | null }>(`SELECT sum(amount) AS v FROM receipt_allocations WHERE receipt_id = $1`, [receiptId])).rows[0].v ?? "0");
    const want = sum(allocations.map((x) => toPaise(x.amount)));
    if (already + want > cap) throw invalid(`You're allocating ${fromPaise(already + want)} but the receipt is ${fromPaise(cap)} (including TDS).`, { allocations: ["Over-allocated"] });
    const seen = new Set<string>();
    for (const [i, al] of allocations.entries()) {
      if (seen.has(al.invoiceId)) throw invalid("Each invoice can appear once.", { [`allocations.${i}.invoiceId`]: ["Duplicate"] });
      seen.add(al.invoiceId);
      const inv = (await q.query<{ client_id: string; status: string; total: string; amount_paid: string; amount_credited: string; number: string }>(
        `SELECT client_id, status, total, amount_paid, amount_credited, number FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [al.invoiceId, a.orgId])).rows[0];
      if (!inv) throw invalid("Unknown invoice.", { [`allocations.${i}.invoiceId`]: ["Unknown"] });
      if (inv.client_id !== clientId) throw invalid(`${inv.number} belongs to another client.`, { [`allocations.${i}.invoiceId`]: ["Other client"] });
      if (!["issued", "partially_paid"].includes(inv.status)) throw conflict(`${inv.number ?? "That invoice"} is ${inv.status === "paid" ? "already paid" : "not issued"}.`);
      const open = toPaise(inv.total) - toPaise(inv.amount_paid) - toPaise(inv.amount_credited);
      if (toPaise(al.amount) > open) throw invalid(`${inv.number} has only ${fromPaise(open)} outstanding.`, { [`allocations.${i}.amount`]: ["More than outstanding"] });
      await q.query(`INSERT INTO receipt_allocations (organization_id, receipt_id, invoice_id, amount) VALUES ($1,$2,$3,$4)`, [a.orgId, receiptId, al.invoiceId, al.amount]);
      await refreshInvoiceStatus(q, al.invoiceId);
    }
  }

  async create(a: Actor, body: unknown, idempotencyKey: string | undefined) {
    need(a, "finance.receipt.record");
    const d = parse(ReceiptInputSchema, body);
    const out = await this.db.tx((q) => idempotent(q, a.orgId, "receipt.create", idempotencyKey, d, async () => {
      if (!(await q.query(`SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2`, [d.clientId, a.orgId])).rows.length) throw invalid("Unknown client.", { clientId: ["Unknown"] });
      const dep = (await q.query<{ is_bank: boolean }>(`SELECT is_bank FROM accounts WHERE id = $1 AND organization_id = $2 AND active`, [d.depositAccountId, a.orgId])).rows[0];
      if (!dep?.is_bank) throw invalid("Deposit into a bank or cash account.", { depositAccountId: ["Not a bank/cash account"] });
      const acc = await systemAccounts(q, a.orgId);
      const s = await getSettings(q, a.orgId);
      const n = await nextNumber(q, a.orgId, `receipt:${fyCode(d.receiptDate)}`);
      const number = `${s.profile.docPrefix}/RCT/${fyCode(d.receiptDate)}/${String(n).padStart(4, "0")}`;
      const gross = fromPaise(toPaise(d.amount) + toPaise(d.tdsAmount));
      const client = (await q.query<{ display_name: string }>(`SELECT display_name FROM clients WHERE id = $1`, [d.clientId])).rows[0];
      const je = await postJournal(q, a, {
        date: d.receiptDate, sourceType: "receipt", memo: `Receipt ${number} from ${client.display_name}${d.reference ? ` (${d.reference})` : ""}`,
        lines: [
          { accountId: d.depositAccountId, debit: d.amount },
          { accountId: acc.tds_receivable, debit: d.tdsAmount },
          { accountId: acc.ar, credit: gross, partyType: "client", partyId: d.clientId },
        ],
      });
      const r = await q.query<{ id: string }>(
        `INSERT INTO receipts (organization_id, number, client_id, receipt_date, amount, tds_amount, method, reference, deposit_account_id, journal_entry_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [a.orgId, number, d.clientId, d.receiptDate, d.amount, d.tdsAmount, d.method, d.reference ?? null, d.depositAccountId, je, a.userId],
      );
      await this.allocate(q, a, r.rows[0].id, d.clientId, toPaise(gross), d.allocations);
      await audit(q, a, "receipt.record", "receipt", r.rows[0].id, { number, amount: d.amount, tds: d.tdsAmount, allocations: d.allocations.length });
      await emit(q, a, "receipt.recorded", "receipt", r.rows[0].id, { clientId: d.clientId, amount: d.amount });
      return { id: r.rows[0].id };
    }));
    return this.get(a, out.id);
  }

  async allocateMore(a: Actor, id: string, body: unknown) {
    need(a, "finance.receipt.record");
    const d = parse(AllocateSchema, body);
    await this.db.tx(async (q) => {
      const r = (await q.query<RRow>(`SELECT * FROM receipts WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!r) throw notFound("Receipt");
      await this.allocate(q, a, id, r.client_id, toPaise(r.amount) + toPaise(r.tds_amount), d.allocations);
      await audit(q, a, "receipt.allocate", "receipt", id, { allocations: d.allocations });
    });
    return this.get(a, id);
  }
}
