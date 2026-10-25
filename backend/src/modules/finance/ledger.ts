import { AccountInputSchema, JournalInputSchema, type Account, type JournalEntry } from "@/lib/api/modules/finance";
import { fromPaise, sum, toPaise } from "@/lib/money";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, fyCode, need, nextNumber } from "../../lib/context";
import { HttpError, conflict, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";

/** Chart of accounts for an Indian services company. System keys are what postings use. */
export const DEFAULT_CHART: { code: string; name: string; type: Account["type"]; key?: string; bank?: boolean }[] = [
  { code: "1100", name: "Bank — current account", type: "asset", key: "bank", bank: true },
  { code: "1110", name: "Cash in hand", type: "asset", key: "cash", bank: true },
  { code: "1200", name: "Trade receivables", type: "asset", key: "ar" },
  { code: "1300", name: "TDS receivable (deducted by clients)", type: "asset", key: "tds_receivable" },
  { code: "1410", name: "GST input — CGST", type: "asset", key: "gst_in_cgst" },
  { code: "1411", name: "GST input — SGST", type: "asset", key: "gst_in_sgst" },
  { code: "1412", name: "GST input — IGST", type: "asset", key: "gst_in_igst" },
  { code: "1500", name: "Prepaid expenses", type: "asset" },
  { code: "2100", name: "Trade payables", type: "liability", key: "ap" },
  { code: "2210", name: "GST output — CGST", type: "liability", key: "gst_out_cgst" },
  { code: "2211", name: "GST output — SGST", type: "liability", key: "gst_out_sgst" },
  { code: "2212", name: "GST output — IGST", type: "liability", key: "gst_out_igst" },
  { code: "2300", name: "TDS payable", type: "liability", key: "tds_payable" },
  { code: "2400", name: "Salaries payable", type: "liability", key: "salary_payable" },
  { code: "2410", name: "PF payable", type: "liability", key: "pf_payable" },
  { code: "2420", name: "ESI payable", type: "liability", key: "esi_payable" },
  { code: "2430", name: "Professional tax payable", type: "liability", key: "pt_payable" },
  { code: "2440", name: "TDS on salaries payable", type: "liability", key: "tds_salary_payable" },
  { code: "2450", name: "Other payroll deductions payable", type: "liability", key: "payroll_other" },
  { code: "3000", name: "Owner's capital", type: "equity", key: "capital" },
  { code: "3100", name: "Retained earnings", type: "equity", key: "retained" },
  { code: "4000", name: "Revenue — services & projects", type: "income", key: "rev_services" },
  { code: "4100", name: "Revenue — subscriptions & AMC", type: "income", key: "rev_subscriptions" },
  { code: "4900", name: "Other income", type: "income", key: "other_income" },
  { code: "5000", name: "Salaries & wages", type: "expense", key: "salaries" },
  { code: "5010", name: "Employer PF & ESI contributions", type: "expense", key: "employer_contrib" },
  { code: "5100", name: "Rent", type: "expense" },
  { code: "5200", name: "Software & cloud subscriptions", type: "expense" },
  { code: "5300", name: "Advertising & marketing", type: "expense" },
  { code: "5400", name: "Travel & conveyance", type: "expense" },
  { code: "5500", name: "Professional fees", type: "expense" },
  { code: "5600", name: "Telephone & internet", type: "expense" },
  { code: "5900", name: "General & office expenses", type: "expense", key: "general_expense" },
  { code: "5950", name: "Bank charges", type: "expense", key: "bank_charges" },
];

export async function seedChartOfAccounts(q: Queryable, orgId: string) {
  for (const a of DEFAULT_CHART)
    await q.query(
      `INSERT INTO accounts (organization_id, code, name, type, system_key, is_bank) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [orgId, a.code, a.name, a.type, a.key ?? null, !!a.bank],
    );
}

export async function systemAccounts(q: Queryable, orgId: string): Promise<Record<string, string>> {
  const r = await q.query<{ id: string; system_key: string }>(`SELECT id, system_key FROM accounts WHERE organization_id = $1 AND system_key IS NOT NULL`, [orgId]);
  return Object.fromEntries(r.rows.map((x) => [x.system_key, x.id]));
}

export interface PostLine { accountId: string; debit?: string; credit?: string; partyType?: "client" | "vendor" | "employee"; partyId?: string; description?: string }

/**
 * Posts a balanced journal entry. Balance is checked here (clear error) and again by the
 * database's deferred constraint trigger at commit (cannot be bypassed). Must run in a tx.
 */
export async function postJournal(
  q: Queryable, a: Pick<Actor, "orgId" | "userId" | "requestId" | "ip">,
  e: { date: string; sourceType: string; sourceId?: string | null; memo: string; reversalOf?: string; lines: PostLine[] },
): Promise<string> {
  const lines = e.lines.filter((l) => toPaise(l.debit ?? "0") !== 0n || toPaise(l.credit ?? "0") !== 0n);
  const dr = sum(lines.map((l) => toPaise(l.debit ?? "0")));
  const cr = sum(lines.map((l) => toPaise(l.credit ?? "0")));
  if (lines.length < 2 || dr !== cr || dr === 0n) throw invalid(`Journal doesn't balance (debits ${fromPaise(dr)}, credits ${fromPaise(cr)}).`);
  for (const l of lines) if (toPaise(l.debit ?? "0") < 0n || toPaise(l.credit ?? "0") < 0n) throw invalid("Amounts can't be negative.");
  const closed = await q.query(`SELECT 1 FROM fiscal_periods WHERE organization_id = $1 AND month = $2 AND status = 'closed'`, [a.orgId, e.date.slice(0, 7)]);
  if (closed.rows.length) throw conflict(`${e.date.slice(0, 7)} is closed. Post into an open period or ask finance to reopen it.`);
  const n = await nextNumber(q, a.orgId, `journal:${fyCode(e.date)}`);
  const r = await q.query<{ id: string }>(
    `INSERT INTO journal_entries (organization_id, number, entry_date, source_type, source_id, memo, reversal_of, posted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [a.orgId, `JV/${fyCode(e.date)}/${String(n).padStart(5, "0")}`, e.date, e.sourceType, e.sourceId ?? null, e.memo, e.reversalOf ?? null, a.userId],
  );
  for (const [i, l] of lines.entries()) {
    await q.query(
      `INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, debit, credit, party_type, party_id, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [a.orgId, r.rows[0].id, i + 1, l.accountId, l.debit ?? "0", l.credit ?? "0", l.partyType ?? null, l.partyId ?? null, l.description ?? null],
    );
  }
  return r.rows[0].id;
}

interface JeRow { id: string; number: string; entry_date: string; source_type: string; source_id: string | null; memo: string; reversal_of: string | null; reversed_by: string | null; posted_by: string; posted_at: Date; total: string }
const JE_SELECT = `SELECT e.*, (SELECT r.id FROM journal_entries r WHERE r.reversal_of = e.id) AS reversed_by, (SELECT sum(debit) FROM journal_lines l WHERE l.entry_id = e.id) AS total FROM journal_entries e`;

export class LedgerService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  async accounts(a: Actor): Promise<Account[]> {
    need(a, "finance.view");
    const r = await this.db.query<{ id: string; code: string; name: string; type: Account["type"]; system_key: string | null; is_bank: boolean; active: boolean; dr: string | null; cr: string | null }>(
      `SELECT a.*, (SELECT sum(debit) FROM journal_lines l WHERE l.account_id = a.id) AS dr, (SELECT sum(credit) FROM journal_lines l WHERE l.account_id = a.id) AS cr
         FROM accounts a WHERE a.organization_id = $1 ORDER BY a.code`, [a.orgId]);
    return r.rows.map((x) => {
      const net = toPaise(x.dr ?? "0") - toPaise(x.cr ?? "0");
      const natural = x.type === "asset" || x.type === "expense" ? net : -net;
      return { id: x.id, code: x.code, name: x.name, type: x.type, systemKey: x.system_key, isBank: x.is_bank, active: x.active, balance: fromPaise(natural) };
    });
  }

  async createAccount(a: Actor, body: unknown) {
    need(a, "finance.journal.post");
    const d = parse(AccountInputSchema, body);
    if (d.isBank && d.type !== "asset") throw invalid("Bank accounts are assets.", { isBank: ["Must be an asset"] });
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO accounts (organization_id, code, name, type, is_bank) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [a.orgId, d.code, d.name, d.type, d.isBank],
    ).catch((e) => { if ((e as { code?: string }).code === "23505") throw conflict("That account code is in use."); throw e; });
    await audit(this.db, a, "account.create", "account", r.rows[0].id, d);
    return (await this.accounts(a)).find((x) => x.id === r.rows[0].id)!;
  }

  async journals(a: Actor, query: Record<string, unknown>) {
    need(a, "finance.view");
    const params: unknown[] = [a.orgId];
    const where = ["e.organization_id = $1"];
    if (query.from) { params.push(String(query.from)); where.push(`e.entry_date >= $${params.length}::date`); }
    if (query.to) { params.push(String(query.to)); where.push(`e.entry_date <= $${params.length}::date`); }
    if (query.accountId && isUuid(query.accountId)) { params.push(query.accountId); where.push(`EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id = e.id AND l.account_id = $${params.length})`); }
    if (query.sourceType) { params.push(String(query.sourceType)); where.push(`e.source_type = $${params.length}`); }
    const r = await this.db.query<JeRow>(`${JE_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.entry_date DESC, e.number DESC LIMIT 500`, params);
    return r.rows.map((x) => this.toJe(x, []));
  }

  private toJe(r: JeRow, lines: JournalEntry["lines"]): JournalEntry {
    return { id: r.id, number: r.number, entryDate: r.entry_date, sourceType: r.source_type, sourceId: r.source_id, memo: r.memo, reversalOf: r.reversal_of, reversedBy: r.reversed_by, postedBy: r.posted_by, postedAt: iso(r.posted_at)!, total: r.total ?? "0.00", lines };
  }

  async journal(a: Actor, id: string, q: Queryable = this.db): Promise<JournalEntry> {
    need(a, "finance.view");
    if (!isUuid(id)) throw notFound("Journal entry");
    const r = (await q.query<JeRow>(`${JE_SELECT} WHERE e.id = $1 AND e.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Journal entry");
    const lines = await q.query<{ line_no: number; account_id: string; code: string; name: string; debit: string; credit: string; party_type: string | null; party_id: string | null; description: string | null }>(
      `SELECT l.line_no, l.account_id, ac.code, ac.name, l.debit, l.credit, l.party_type, l.party_id, l.description FROM journal_lines l JOIN accounts ac ON ac.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`, [id]);
    return this.toJe(r, lines.rows.map((l) => ({ lineNo: l.line_no, accountId: l.account_id, accountCode: l.code, accountName: l.name, debit: l.debit, credit: l.credit, partyType: l.party_type, partyId: l.party_id, description: l.description })));
  }

  async postManual(a: Actor, body: unknown) {
    need(a, "finance.journal.post");
    const d = parse(JournalInputSchema, body);
    const id = await this.db.tx(async (q) => {
      const ids = [...new Set(d.lines.map((l) => l.accountId))];
      const ok = await q.query<{ id: string; active: boolean }>(`SELECT id, active FROM accounts WHERE organization_id = $1 AND id = ANY($2)`, [a.orgId, ids]);
      if (ok.rows.length !== ids.length) throw invalid("Unknown account in the journal.");
      if (ok.rows.some((x) => !x.active)) throw invalid("An account in the journal is inactive.");
      const id = await postJournal(q, a, { date: d.entryDate, sourceType: "manual", memo: d.memo, lines: d.lines });
      await audit(q, a, "journal.post", "journal_entry", id, { memo: d.memo, lines: d.lines.length });
      return id;
    });
    return this.journal(a, id);
  }

  /** Reversal mirrors every line on a date in an open period. An entry is reversed at most once. */
  async reverse(a: Actor, id: string, body: { date?: string; reason?: string }) {
    need(a, "finance.journal.post");
    const reason = String(body?.reason ?? "").trim();
    if (reason.length < 3) throw invalid("Give a reason for the reversal.", { reason: ["Required"] });
    const newId = await this.db.tx(async (q) => {
      const je = await this.journal(a, id, q);
      if (je.reversedBy) throw conflict("This entry is already reversed.");
      if (je.sourceType === "reversal") throw conflict("Reverse the original entry instead of a reversal.");
      if (!["manual", "opening"].includes(je.sourceType)) throw conflict(`This entry belongs to a ${je.sourceType.replace("_", " ")}. Use a credit note or the document's own correction flow.`);
      const date = body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : je.entryDate;
      const rid = await postJournal(q, a, {
        date, sourceType: "reversal", reversalOf: id, memo: `Reversal of ${je.number}: ${reason}`,
        lines: je.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, partyType: (l.partyType ?? undefined) as PostLine["partyType"], partyId: l.partyId ?? undefined, description: l.description ?? undefined })),
      });
      await audit(q, a, "journal.reverse", "journal_entry", id, { reversalId: rid, reason });
      return rid;
    });
    return this.journal(a, newId);
  }

  async ledger(a: Actor, accountId: string, from?: string, to?: string) {
    need(a, "finance.view");
    if (!isUuid(accountId)) throw notFound("Account");
    const acc = (await this.db.query<{ type: Account["type"]; code: string; name: string }>(`SELECT type, code, name FROM accounts WHERE id = $1 AND organization_id = $2`, [accountId, a.orgId])).rows[0];
    if (!acc) throw notFound("Account");
    const sign = acc.type === "asset" || acc.type === "expense" ? 1n : -1n;
    const open = from ? (await this.db.query<{ v: string | null }>(
      `SELECT sum(l.debit - l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.entry_date < $2::date`, [accountId, from])).rows[0].v : "0";
    const r = await this.db.query<{ entry_id: string; number: string; entry_date: string; memo: string; debit: string; credit: string; description: string | null }>(
      `SELECT e.id AS entry_id, e.number, e.entry_date, e.memo, l.debit, l.credit, l.description FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = $1 AND ($2::date IS NULL OR e.entry_date >= $2::date) AND ($3::date IS NULL OR e.entry_date <= $3::date) ORDER BY e.entry_date, e.number, l.line_no LIMIT 5000`,
      [accountId, from ?? null, to ?? null]);
    let running = toPaise(open ?? "0") * sign;
    return {
      account: { id: accountId, ...acc }, opening: fromPaise(running),
      rows: r.rows.map((x) => {
        running += (toPaise(x.debit) - toPaise(x.credit)) * sign;
        return { entryId: x.entry_id, number: x.number, date: x.entry_date, memo: x.description ?? x.memo, debit: x.debit, credit: x.credit, balance: fromPaise(running) };
      }),
      closing: fromPaise(running),
    };
  }
}
export { HttpError };
