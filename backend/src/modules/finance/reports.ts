import type { AgeingRow, GstSummary, Period, ReportRow } from "@/lib/api/modules/finance";
import { fromPaise, sum, toPaise } from "@/lib/money";
import { type Actor, type Deps, audit, need, todayIst } from "../../lib/context";
import { conflict, invalid } from "../../lib/errors";
import { iso } from "../../lib/query";

const D = /^\d{4}-\d{2}-\d{2}$/;
const P = (v: string | null | undefined) => toPaise(v ?? "0");
const natural = (type: string, dr: bigint, cr: bigint) => (type === "asset" || type === "expense" ? dr - cr : cr - dr);

export class ReportService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private today() { return todayIst(this.deps.now()); }
  private date(v: unknown, fallback: string) { const s = String(v ?? ""); if (!s) return fallback; if (!D.test(s)) throw invalid("Dates are YYYY-MM-DD."); return s; }
  private fyStart(d: string) { const y = Number(d.slice(0, 4)); return Number(d.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`; }

  private async balances(orgId: string, from: string | null, to: string) {
    const r = await this.db.query<{ id: string; code: string; name: string; type: string; dr: string | null; cr: string | null }>(
      `SELECT a.id, a.code, a.name, a.type,
              (SELECT sum(l.debit) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = a.id AND e.entry_date <= $2::date AND ($3::date IS NULL OR e.entry_date >= $3::date)) AS dr,
              (SELECT sum(l.credit) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = a.id AND e.entry_date <= $2::date AND ($3::date IS NULL OR e.entry_date >= $3::date)) AS cr
         FROM accounts a WHERE a.organization_id = $1 ORDER BY a.code`, [orgId, to, from]);
    return r.rows.map((x) => ({ ...x, d: P(x.dr), c: P(x.cr) }));
  }
  private row(x: { id: string; code: string; name: string; type: string; d: bigint; c: bigint }): ReportRow {
    return { accountId: x.id, code: x.code, name: x.name, type: x.type as ReportRow["type"], debit: fromPaise(x.d), credit: fromPaise(x.c), balance: fromPaise(natural(x.type, x.d, x.c)) };
  }

  async trialBalance(a: Actor, q: Record<string, unknown>) {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const asOf = this.date(q.asOf, this.today());
    const rows = (await this.balances(a.orgId, null, asOf)).filter((x) => x.d || x.c);
    const net = rows.map((x) => ({ ...this.row(x), debit: fromPaise(x.d > x.c ? x.d - x.c : 0n), credit: fromPaise(x.c > x.d ? x.c - x.d : 0n) }));
    const td = sum(net.map((r) => P(r.debit))), tc = sum(net.map((r) => P(r.credit)));
    return { asOf, rows: net, totals: { debit: fromPaise(td), credit: fromPaise(tc), balanced: td === tc } };
  }

  async profitAndLoss(a: Actor, q: Record<string, unknown>) {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const to = this.date(q.to, this.today());
    const from = this.date(q.from, this.fyStart(to));
    const rows = await this.balances(a.orgId, from, to);
    const income = rows.filter((x) => x.type === "income" && (x.d || x.c)).map((x) => this.row(x));
    const expense = rows.filter((x) => x.type === "expense" && (x.d || x.c)).map((x) => this.row(x));
    const ti = sum(income.map((r) => P(r.balance))), te = sum(expense.map((r) => P(r.balance)));
    return { from, to, income, expense, totalIncome: fromPaise(ti), totalExpense: fromPaise(te), netProfit: fromPaise(ti - te) };
  }

  async balanceSheet(a: Actor, q: Record<string, unknown>) {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const asOf = this.date(q.asOf, this.today());
    const rows = await this.balances(a.orgId, null, asOf);
    const pick = (t: string) => rows.filter((x) => x.type === t && (x.d || x.c)).map((x) => this.row(x));
    const assets = pick("asset"), liabilities = pick("liability"), equity = pick("equity");
    // Unclosed profit (all income − expense to date) sits in equity until year-end close.
    const pl = sum(rows.filter((x) => x.type === "income").map((x) => x.c - x.d)) - sum(rows.filter((x) => x.type === "expense").map((x) => x.d - x.c));
    const ta = sum(assets.map((r) => P(r.balance))), tl = sum(liabilities.map((r) => P(r.balance))), teq = sum(equity.map((r) => P(r.balance))) + pl;
    return { asOf, assets, liabilities, equity, currentEarnings: fromPaise(pl), totalAssets: fromPaise(ta), totalLiabilities: fromPaise(tl), totalEquity: fromPaise(teq), balanced: ta === tl + teq };
  }

  /** Direct-method cash flow from bank & cash accounts, grouped by what generated each movement. */
  async cashFlow(a: Actor, q: Record<string, unknown>) {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const to = this.date(q.to, this.today());
    const from = this.date(q.from, this.fyStart(to));
    const open = (await this.db.query<{ v: string | null }>(
      `SELECT sum(l.debit - l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts ac ON ac.id = l.account_id
        WHERE ac.organization_id = $1 AND ac.is_bank AND e.entry_date < $2::date`, [a.orgId, from])).rows[0].v;
    const r = await this.db.query<{ source_type: string; inflow: string | null; outflow: string | null }>(
      `SELECT e.source_type, sum(l.debit) AS inflow, sum(l.credit) AS outflow FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts ac ON ac.id = l.account_id
        WHERE ac.organization_id = $1 AND ac.is_bank AND e.entry_date BETWEEN $2::date AND $3::date
          -- transfers between two bank/cash accounts net to zero and are excluded
          AND NOT (SELECT bool_and(a2.is_bank) FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id WHERE l2.entry_id = e.id)
        GROUP BY e.source_type ORDER BY e.source_type`, [a.orgId, from, to]);
    const labels: Record<string, string> = { receipt: "Collections from clients", bill: "Expenses paid", bill_payment: "Vendor payments", payroll: "Salaries paid", manual: "Other (manual & bank)", reversal: "Reversals", opening: "Opening balances" };
    const lines = r.rows.map((x) => ({ category: labels[x.source_type] ?? x.source_type, inflow: fromPaise(P(x.inflow)), outflow: fromPaise(P(x.outflow)), net: fromPaise(P(x.inflow) - P(x.outflow)) }));
    const net = sum(lines.map((l) => P(l.net)));
    return { from, to, opening: fromPaise(P(open)), lines, netChange: fromPaise(net), closing: fromPaise(P(open) + net) };
  }

  private bucket(days: number) { return days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus"; }
  private ageing(rows: { party_id: string; party_name: string; due_date: string; open: string }[], asOf: string): AgeingRow[] {
    type B = { current: bigint; d1_30: bigint; d31_60: bigint; d61_90: bigint; d90_plus: bigint; name: string };
    const map = new Map<string, B>();
    for (const r of rows) {
      const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / 86_400_000);
      const cur: B = map.get(r.party_id) ?? { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n, name: r.party_name };
      const k = this.bucket(days) as Exclude<keyof B, "name">;
      cur[k] += P(r.open);
      map.set(r.party_id, cur);
    }
    return [...map.entries()].map(([id, v]) => ({
      partyId: id, partyName: v.name, current: fromPaise(v.current), d1_30: fromPaise(v.d1_30), d31_60: fromPaise(v.d31_60), d61_90: fromPaise(v.d61_90), d90_plus: fromPaise(v.d90_plus),
      total: fromPaise(v.current + v.d1_30 + v.d31_60 + v.d61_90 + v.d90_plus),
    })).sort((x, y) => Number(P(y.total) - P(x.total)));
  }

  async receivablesAgeing(a: Actor, q: Record<string, unknown>) {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const asOf = this.date(q.asOf, this.today());
    // As-of: payments and credit notes dated after asOf don't reduce the balance.
    const r = await this.db.query<{ party_id: string; party_name: string; due_date: string; open: string }>(
      `SELECT i.client_id AS party_id, c.display_name AS party_name, i.due_date,
              i.total - coalesce((SELECT sum(ra.amount) FROM receipt_allocations ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.receipt_date <= $2::date), 0)
                      - coalesce((SELECT sum(cn.total) FROM credit_notes cn WHERE cn.invoice_id = i.id AND cn.note_date <= $2::date), 0) AS open
         FROM invoices i JOIN clients c ON c.id = i.client_id
        WHERE i.organization_id = $1 AND i.status NOT IN ('draft','cancelled') AND i.invoice_date <= $2::date`, [a.orgId, asOf]);
    const rows = this.ageing(r.rows.filter((x) => P(x.open) > 0n), asOf);
    return { asOf, rows, total: fromPaise(sum(rows.map((x) => P(x.total)))) };
  }

  async payablesAgeing(a: Actor, q: Record<string, unknown>) {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const asOf = this.date(q.asOf, this.today());
    const r = await this.db.query<{ party_id: string; party_name: string; due_date: string; open: string }>(
      `SELECT b.vendor_id AS party_id, v.name AS party_name, b.due_date,
              b.payable - coalesce((SELECT sum(p.amount) FROM bill_payments p WHERE p.bill_id = b.id AND p.payment_date <= $2::date), 0) AS open
         FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.organization_id = $1 AND b.kind = 'bill' AND b.bill_date <= $2::date`, [a.orgId, asOf]);
    const rows = this.ageing(r.rows.filter((x) => P(x.open) > 0n), asOf);
    return { asOf, rows, total: fromPaise(sum(rows.map((x) => P(x.total)))) };
  }

  /** Month summary to prepare GSTR-1/3B. It is a working paper, not a return. */
  async gstSummary(a: Actor, q: Record<string, unknown>): Promise<GstSummary> {
    need(a, "finance.view"); // financial statements: finance roles only (not every reports.view holder)
    const month = String(q.month ?? this.today().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid("Month is YYYY-MM.");
    const out = await this.db.query<{ rate: string; taxable: string; cgst: string; sgst: string; igst: string }>(
      `SELECT l.tax_rate AS rate, sum(l.taxable) AS taxable, sum(l.cgst) AS cgst, sum(l.sgst) AS sgst, sum(l.igst) AS igst
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE i.organization_id = $1 AND i.status NOT IN ('draft','cancelled') AND to_char(i.invoice_date, 'YYYY-MM') = $2 GROUP BY l.tax_rate ORDER BY l.tax_rate`, [a.orgId, month]);
    const cn = (await this.db.query<{ taxable: string | null; cgst: string | null; sgst: string | null; igst: string | null }>(
      `SELECT sum(taxable_total) AS taxable, sum(cgst) AS cgst, sum(sgst) AS sgst, sum(igst) AS igst FROM credit_notes WHERE organization_id = $1 AND to_char(note_date, 'YYYY-MM') = $2`, [a.orgId, month])).rows[0];
    const inp = (await this.db.query<{ taxable: string | null; cgst: string | null; sgst: string | null; igst: string | null; inel: string | null }>(
      `SELECT sum(taxable) FILTER (WHERE itc_eligible) AS taxable, sum(cgst) FILTER (WHERE itc_eligible) AS cgst, sum(sgst) FILTER (WHERE itc_eligible) AS sgst,
              sum(igst) FILTER (WHERE itc_eligible) AS igst, sum(cgst + sgst + igst) FILTER (WHERE NOT itc_eligible) AS inel
         FROM bills WHERE organization_id = $1 AND to_char(bill_date, 'YYYY-MM') = $2`, [a.orgId, month])).rows[0];
    const b2b = await this.db.query<{ client_name: string; gstin: string; n: number; taxable: string; tax: string }>(
      `SELECT i.client_snapshot->>'legalName' AS client_name, i.client_snapshot->>'gstin' AS gstin, count(*)::int AS n, sum(i.taxable_total) AS taxable, sum(i.cgst + i.sgst + i.igst) AS tax
         FROM invoices i WHERE i.organization_id = $1 AND i.status NOT IN ('draft','cancelled') AND to_char(i.invoice_date, 'YYYY-MM') = $2 AND i.client_snapshot->>'gstin' IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1`, [a.orgId, month]);
    const o = { taxable: sum(out.rows.map((r) => P(r.taxable))), cgst: sum(out.rows.map((r) => P(r.cgst))), sgst: sum(out.rows.map((r) => P(r.sgst))), igst: sum(out.rows.map((r) => P(r.igst))) };
    const c = { taxable: P(cn.taxable), cgst: P(cn.cgst), sgst: P(cn.sgst), igst: P(cn.igst) };
    const i = { taxable: P(inp.taxable), cgst: P(inp.cgst), sgst: P(inp.sgst), igst: P(inp.igst) };
    // Simplified set-off: each head nets against its own input; IGST credit isn't cross-utilised here.
    const net = { cgst: o.cgst - c.cgst - i.cgst, sgst: o.sgst - c.sgst - i.sgst, igst: o.igst - c.igst - i.igst };
    const f = (x: Record<string, bigint>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fromPaise(v)]));
    return {
      month, basis: "Invoices, credit notes and bills dated in the month. Verify against GSTR-2B and file through the GST portal or your CA.",
      output: out.rows.map((r) => ({ rate: r.rate, taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst })),
      outputTotal: f(o) as GstSummary["outputTotal"], creditNotes: f(c) as GstSummary["creditNotes"],
      input: { ...(f(i) as Omit<GstSummary["input"], "ineligible">), ineligible: fromPaise(P(inp.inel)) },
      netPayable: { cgst: fromPaise(net.cgst), sgst: fromPaise(net.sgst), igst: fromPaise(net.igst), total: fromPaise(net.cgst + net.sgst + net.igst) },
      b2b: b2b.rows.map((r) => ({ clientName: r.client_name, gstin: r.gstin, invoices: r.n, taxable: r.taxable, tax: r.tax })),
    };
  }

  // ---------- periods ----------
  async periods(a: Actor): Promise<Period[]> {
    need(a, "finance.view");
    const r = await this.db.query<{ month: string; status: Period["status"]; closed_by: string | null; closed_at: Date | null }>(
      `SELECT month, status, closed_by, closed_at FROM fiscal_periods WHERE organization_id = $1 ORDER BY month DESC LIMIT 36`, [a.orgId]);
    return r.rows.map((p) => ({ month: p.month, status: p.status, closedBy: p.closed_by, closedAt: iso(p.closed_at) }));
  }

  async closeChecks(orgId: string, month: string) {
    const drafts = (await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM invoices WHERE organization_id = $1 AND status = 'draft' AND to_char(invoice_date, 'YYYY-MM') = $2`, [orgId, month])).rows[0].n;
    const bank = (await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM bank_statement_lines WHERE organization_id = $1 AND status = 'unmatched' AND to_char(txn_date, 'YYYY-MM') = $2`, [orgId, month])).rows[0].n;
    const payroll = (await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payroll_runs WHERE organization_id = $1 AND month = $2 AND status IN ('draft','approved')`, [orgId, month])).rows[0].n;
    return [
      { label: "Draft invoices dated in the month", ok: drafts === 0, detail: drafts ? `${drafts} draft(s) — issue or delete them` : "None" },
      { label: "Unreconciled bank lines", ok: bank === 0, detail: bank ? `${bank} line(s) to match` : "All matched" },
      { label: "Payroll posted", ok: payroll === 0, detail: payroll ? "A payroll run for this month isn't posted yet" : "Nothing pending" },
    ];
  }

  async closePeriod(a: Actor, month: string, body: { force?: boolean }) {
    need(a, "finance.period.close");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid("Month is YYYY-MM.");
    if (month >= this.today().slice(0, 7)) throw conflict("Only past months can be closed.");
    const checks = await this.closeChecks(a.orgId, month);
    if (checks.some((c) => !c.ok) && !body?.force) throw conflict(`Not ready to close: ${checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}. Fix these or close anyway.`);
    await this.db.tx(async (q) => {
      await q.query(
        `INSERT INTO fiscal_periods (organization_id, month, status, closed_by, closed_at) VALUES ($1,$2,'closed',$3,now())
         ON CONFLICT (organization_id, month) DO UPDATE SET status = 'closed', closed_by = $3, closed_at = now()`, [a.orgId, month, a.userId]);
      await audit(q, a, "period.close", "fiscal_period", null, { month, checks, forced: !!body?.force });
    });
    return { month, status: "closed" as const, checks };
  }

  async reopenPeriod(a: Actor, month: string, body: { reason?: string }) {
    need(a, "finance.period.close");
    const reason = String(body?.reason ?? "").trim();
    if (reason.length < 5) throw invalid("Explain why the period is being reopened.", { reason: ["Required"] });
    await this.db.tx(async (q) => {
      const r = await q.query(`UPDATE fiscal_periods SET status = 'open', closed_by = NULL, closed_at = NULL WHERE organization_id = $1 AND month = $2 AND status = 'closed' RETURNING month`, [a.orgId, month]);
      if (!r.rows.length) throw conflict("That period isn't closed.");
      await audit(q, a, "period.reopen", "fiscal_period", null, { month, reason });
    });
    return { month, status: "open" as const };
  }
}
