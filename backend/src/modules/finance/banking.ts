import { createHash } from "node:crypto";
import { BankCategorizeSchema, BankImportSchema, type BankLine } from "@/lib/api/modules/finance";
import { fromPaise, toPaise } from "@/lib/money";
import { type Actor, type Deps, addDays, audit, need } from "../../lib/context";
import { conflict, invalid, notFound, parse } from "../../lib/errors";
import { isUuid } from "../../lib/query";
import { postJournal } from "./ledger";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t); // Indian banks: DD/MM/YYYY
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
  }
  return null;
}
const amt = (s: string | undefined) => {
  const t = (s ?? "").replace(/[,\s₹]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!t) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) throw new Error(`Not an amount: ${s}`);
  return t;
};

export class BankingService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  /**
   * CSV columns (header row, case-insensitive): date, description, reference?, and either
   * amount (signed) or debit/credit (withdrawal/deposit), optional balance. Re-importing the
   * same statement is safe: each row's hash is unique per bank account.
   */
  async import(a: Actor, body: unknown) {
    need(a, "finance.bank.reconcile");
    const d = parse(BankImportSchema, body);
    const acc = (await this.db.query<{ is_bank: boolean }>(`SELECT is_bank FROM accounts WHERE id = $1 AND organization_id = $2`, [d.bankAccountId, a.orgId])).rows[0];
    if (!acc?.is_bank) throw invalid("Pick a bank account.", { bankAccountId: ["Not a bank account"] });
    const rows = parseCsv(d.csv);
    if (rows.length < 2) throw invalid("The file has no transactions.");
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const iDate = col("date", "txn date", "value date"), iDesc = col("description", "narration", "particulars"), iRef = col("reference", "ref", "cheque");
    const iAmt = head.findIndex((h) => h === "amount"), iDr = col("debit", "withdrawal"), iCr = col("credit", "deposit"), iBal = col("balance");
    if (iDate < 0 || iDesc < 0 || (iAmt < 0 && (iDr < 0 || iCr < 0))) throw invalid("Columns needed: date, description, and amount (or debit and credit).");
    const parsed: { date: string; desc: string; ref: string | null; amount: string; balance: string | null }[] = [];
    const errors: string[] = [];
    rows.slice(1).forEach((r, i) => {
      try {
        const date = parseDate(r[iDate] ?? "");
        if (!date) throw new Error(`bad date "${r[iDate]}"`);
        let amount: string | null;
        if (iAmt >= 0) amount = amt(r[iAmt]);
        else {
          const dr = amt(r[iDr]), cr = amt(r[iCr]);
          amount = cr && toPaise(cr) !== 0n ? cr : dr ? fromPaise(-toPaise(dr)) : null;
        }
        if (!amount || toPaise(amount) === 0n) throw new Error("no amount");
        parsed.push({ date, desc: (r[iDesc] ?? "").trim().slice(0, 500) || "(no description)", ref: iRef >= 0 ? (r[iRef] ?? "").trim() || null : null, amount: fromPaise(toPaise(amount)), balance: iBal >= 0 ? amt(r[iBal]) : null });
      } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
    });
    if (errors.length) throw invalid(`Fix these rows and re-import: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
    return this.db.tx(async (q) => {
      const imp = await q.query<{ id: string }>(
        `INSERT INTO bank_imports (organization_id, bank_account_id, filename, rows_total, rows_imported, rows_duplicate, imported_by) VALUES ($1,$2,$3,$4,0,0,$5) RETURNING id`,
        [a.orgId, d.bankAccountId, d.filename, parsed.length, a.userId]);
      let imported = 0;
      const seen = new Map<string, number>();
      for (const p of parsed) {
        // Identical rows within one statement are legitimate (two equal UPI payments); number them.
        const base = `${p.date}|${p.amount}|${p.desc}|${p.ref ?? ""}|${p.balance ?? ""}`;
        const k = (seen.get(base) ?? 0) + 1;
        seen.set(base, k);
        const hash = createHash("sha256").update(`${base}|${k}`).digest("hex");
        const r = await q.query(
          `INSERT INTO bank_statement_lines (organization_id, bank_account_id, import_id, txn_date, description, reference, amount, balance, dedupe_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (bank_account_id, dedupe_hash) DO NOTHING RETURNING id`,
          [a.orgId, d.bankAccountId, imp.rows[0].id, p.date, p.desc, p.ref, p.amount, p.balance, hash]);
        imported += r.rows.length;
      }
      await q.query(`UPDATE bank_imports SET rows_imported = $2, rows_duplicate = $3 WHERE id = $1`, [imp.rows[0].id, imported, parsed.length - imported]);
      await audit(q, a, "bank.import", "bank_import", imp.rows[0].id, { filename: d.filename, rows: parsed.length, imported });
      return { importId: imp.rows[0].id, rows: parsed.length, imported, duplicates: parsed.length - imported };
    });
  }

  async lines(a: Actor, query: Record<string, unknown>): Promise<BankLine[]> {
    need(a, "finance.view");
    const bankId = String(query.bankAccountId ?? "");
    if (!isUuid(bankId)) throw invalid("Pick a bank account.");
    const status = ["unmatched", "matched", "ignored"].includes(String(query.status)) ? String(query.status) : "unmatched";
    const r = await this.db.query<{ id: string; txn_date: string; description: string; reference: string | null; amount: string; balance: string | null; status: BankLine["status"]; matched_entry_id: string | null }>(
      `SELECT * FROM bank_statement_lines WHERE organization_id = $1 AND bank_account_id = $2 AND status = $3 ORDER BY txn_date DESC LIMIT 500`, [a.orgId, bankId, status]);
    const out: BankLine[] = [];
    for (const l of r.rows) {
      let suggestions: BankLine["suggestions"] = [];
      if (l.status === "unmatched") {
        const pos = toPaise(l.amount) > 0n;
        // Same bank account, same amount on the matching side, ±5 days, not already reconciled.
        const s = await this.db.query<{ id: string; number: string; entry_date: string; memo: string; v: string }>(
          `SELECT e.id, e.number, e.entry_date, e.memo, ${pos ? "jl.debit" : "jl.credit"} AS v FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
            WHERE jl.organization_id = $1 AND jl.account_id = $2 AND ${pos ? "jl.debit" : "jl.credit"} = $3
              AND e.entry_date BETWEEN $4::date AND $5::date
              AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.matched_entry_id = e.id)
            ORDER BY abs(e.entry_date - $6::date) LIMIT 5`,
          [a.orgId, bankId, fromPaise(pos ? toPaise(l.amount) : -toPaise(l.amount)), addDays(l.txn_date, -5), addDays(l.txn_date, 5), l.txn_date]);
        suggestions = s.rows.map((x) => ({ entryId: x.id, number: x.number, entryDate: x.entry_date, memo: x.memo, amount: x.v }));
      }
      out.push({ id: l.id, txnDate: l.txn_date, description: l.description, reference: l.reference, amount: l.amount, balance: l.balance, status: l.status, matchedEntryId: l.matched_entry_id, suggestions });
    }
    return out;
  }

  private async lockLine(q: import("../../db").Queryable, a: Actor, id: string) {
    if (!isUuid(id)) throw notFound("Statement line");
    const l = (await q.query<{ id: string; bank_account_id: string; amount: string; status: string; txn_date: string; description: string }>(`SELECT * FROM bank_statement_lines WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
    if (!l) throw notFound("Statement line");
    if (l.status !== "unmatched") throw conflict("This line is already reconciled.");
    return l;
  }

  async match(a: Actor, id: string, entryId: string) {
    need(a, "finance.bank.reconcile");
    if (!isUuid(entryId)) throw invalid("Pick a ledger entry.");
    await this.db.tx(async (q) => {
      const l = await this.lockLine(q, a, id);
      const pos = toPaise(l.amount) > 0n;
      const hit = await q.query(
        `SELECT 1 FROM journal_lines WHERE entry_id = $1 AND organization_id = $2 AND account_id = $3 AND ${pos ? "debit" : "credit"} = $4`,
        [entryId, a.orgId, l.bank_account_id, fromPaise(pos ? toPaise(l.amount) : -toPaise(l.amount))]);
      if (!hit.rows.length) throw conflict("That entry doesn't move this bank account by the same amount.");
      await q.query(`UPDATE bank_statement_lines SET status = 'matched', matched_entry_id = $2, matched_by = $3, matched_at = now() WHERE id = $1`, [id, entryId, a.userId]);
      await audit(q, a, "bank.match", "bank_line", id, { entryId });
    });
  }

  /** For lines with no ledger entry yet (bank charges, interest): post and match in one step. */
  async categorize(a: Actor, id: string, body: unknown) {
    need(a, "finance.bank.reconcile");
    need(a, "finance.journal.post");
    const d = parse(BankCategorizeSchema, body);
    await this.db.tx(async (q) => {
      const l = await this.lockLine(q, a, id);
      const acc = (await q.query<{ id: string }>(`SELECT id FROM accounts WHERE id = $1 AND organization_id = $2 AND active`, [d.accountId, a.orgId])).rows[0];
      if (!acc) throw invalid("Unknown account.", { accountId: ["Unknown"] });
      if (d.accountId === l.bank_account_id) throw invalid("Pick the other side of the transaction, not the bank account itself.");
      const v = fromPaise(toPaise(l.amount) > 0n ? toPaise(l.amount) : -toPaise(l.amount));
      const pos = toPaise(l.amount) > 0n;
      const party = d.partyType && d.partyId ? { partyType: d.partyType, partyId: d.partyId } : {};
      const je = await postJournal(q, a, {
        date: l.txn_date, sourceType: "manual", memo: `${d.memo} (bank: ${l.description})`,
        lines: pos ? [{ accountId: l.bank_account_id, debit: v }, { accountId: d.accountId, credit: v, ...party }] : [{ accountId: d.accountId, debit: v, ...party }, { accountId: l.bank_account_id, credit: v }],
      });
      await q.query(`UPDATE bank_statement_lines SET status = 'matched', matched_entry_id = $2, matched_by = $3, matched_at = now() WHERE id = $1`, [id, je, a.userId]);
      await audit(q, a, "bank.categorize", "bank_line", id, { entryId: je, accountId: d.accountId });
    });
  }

  async ignore(a: Actor, id: string) {
    need(a, "finance.bank.reconcile");
    await this.db.tx(async (q) => {
      await this.lockLine(q, a, id);
      await q.query(`UPDATE bank_statement_lines SET status = 'ignored', matched_by = $2, matched_at = now() WHERE id = $1`, [id, a.userId]);
      await audit(q, a, "bank.ignore", "bank_line", id);
    });
  }

  /** Book balance vs. statement balance for a bank account. */
  async summary(a: Actor, bankAccountId: string) {
    need(a, "finance.view");
    if (!isUuid(bankAccountId)) throw invalid("Pick a bank account.");
    // Every query must be org-scoped: an id from another organisation must reveal nothing.
    const owns = (await this.db.query(`SELECT 1 FROM accounts WHERE id = $1 AND organization_id = $2 AND is_bank`, [bankAccountId, a.orgId])).rows.length;
    if (!owns) throw notFound("Bank account");
    const book = (await this.db.query<{ v: string | null }>(`SELECT sum(debit - credit) AS v FROM journal_lines WHERE account_id = $1 AND organization_id = $2`, [bankAccountId, a.orgId])).rows[0].v ?? "0";
    const last = (await this.db.query<{ balance: string | null; txn_date: string }>(`SELECT balance, txn_date FROM bank_statement_lines WHERE bank_account_id = $1 AND organization_id = $2 AND balance IS NOT NULL ORDER BY txn_date DESC, id DESC LIMIT 1`, [bankAccountId, a.orgId])).rows[0];
    const counts = (await this.db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM bank_statement_lines WHERE bank_account_id = $1 AND organization_id = $2 GROUP BY status`, [bankAccountId, a.orgId])).rows;
    return { bookBalance: fromPaise(toPaise(book)), statementBalance: last?.balance ?? null, statementDate: last?.txn_date ?? null, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  }
}
