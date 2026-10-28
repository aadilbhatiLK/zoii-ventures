import type { Payslip, PayslipLine, PayrollRun, SalaryComponent } from "@/lib/api/modules/people";
import { divRound, fromPaise, percentOf, sum, toPaise } from "@/lib/money";
import { z } from "zod";
import type { Queryable } from "../../db";
import { type Actor, type Deps, audit, getSettings, need, type OrgSettings } from "../../lib/context";
import { conflict, forbidden, invalid, notFound, parse } from "../../lib/errors";
import { iso, isUuid } from "../../lib/query";
import { postJournal, systemAccounts } from "../finance/ledger";
import { registerApprovalHandler, requestApproval } from "../sales/approvals";
import { workingDates } from "./hr";

export const lastDayOf = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

export interface SlipCalc { earnings: PayslipLine[]; deductions: PayslipLine[]; employer: PayslipLine[]; gross: bigint; ded: bigint; net: bigint; employerCost: bigint }

/**
 * Pure payroll maths for one employee-month (exported for unit tests).
 * Earnings prorate by payable/working days. Statutory rules come from org settings:
 * PF on earned basic up to the wage cap; ESI when monthly gross is within the limit;
 * professional tax as a flat monthly amount above a threshold; TDS is the HR-entered
 * monthly estimate. This prepares payroll — rates must be confirmed with the CA.
 */
export function computeSlip(components: SalaryComponent[], monthlyTds: string, working: number, payable: number, s: OrgSettings["payroll"]): SlipCalc {
  const ratio = (v: bigint) => (working === 0 ? 0n : divRound(v * BigInt(Math.round(payable * 10)), BigInt(working * 10)));
  const basicFull = toPaise(components.find((c) => c.code === "BASIC")!.value);
  const full = (c: SalaryComponent) => (c.calc === "fixed" ? toPaise(c.value) : percentOf(basicFull, c.value));
  const earnings = components.filter((c) => c.kind === "earning").map((c) => ({ code: c.code, name: c.name, v: ratio(full(c)) }));
  const fullGross = sum(components.filter((c) => c.kind === "earning").map(full));
  const gross = sum(earnings.map((e) => e.v));
  const basicEarned = earnings.find((e) => e.code === "BASIC")!.v;
  const deductions: { code: string; name: string; v: bigint }[] = [];
  const employer: { code: string; name: string; v: bigint }[] = [];
  if (s.pf.enabled) {
    const wage = basicEarned < toPaise(s.pf.wageCap) ? basicEarned : toPaise(s.pf.wageCap);
    deductions.push({ code: "PF_EE", name: "Provident fund (employee)", v: percentOf(wage, s.pf.employeeRate) });
    employer.push({ code: "PF_ER", name: "Provident fund (employer)", v: percentOf(wage, s.pf.employerRate) });
  }
  if (s.esi.enabled && fullGross <= toPaise(s.esi.grossLimit)) {
    deductions.push({ code: "ESI_EE", name: "ESI (employee)", v: percentOf(gross, s.esi.employeeRate) });
    employer.push({ code: "ESI_ER", name: "ESI (employer)", v: percentOf(gross, s.esi.employerRate) });
  }
  if (s.professionalTax.enabled && gross > toPaise(s.professionalTax.grossAbove)) deductions.push({ code: "PT", name: "Professional tax", v: toPaise(s.professionalTax.monthlyAmount) });
  if (toPaise(monthlyTds) > 0n) deductions.push({ code: "TDS", name: "Income tax (TDS)", v: toPaise(monthlyTds) });
  for (const c of components.filter((x) => x.kind === "deduction")) deductions.push({ code: c.code, name: c.name, v: ratio(full(c)) });
  const ded = sum(deductions.map((d) => d.v));
  const f = (xs: { code: string; name: string; v: bigint }[]) => xs.filter((x) => x.v !== 0n).map((x) => ({ code: x.code, name: x.name, amount: fromPaise(x.v) }));
  return { earnings: f(earnings), deductions: f(deductions), employer: f(employer), gross, ded, net: gross - ded, employerCost: gross + sum(employer.map((e) => e.v)) };
}

registerApprovalHandler("payroll_run", async (q, a, id, approved) => {
  const r = (await q.query<{ status: string; prepared_by: string }>(`SELECT status, prepared_by FROM payroll_runs WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!r || r.status !== "draft") throw conflict("This payroll run is no longer a draft.");
  if (r.prepared_by === a.userId) throw forbidden("The preparer can't approve their own payroll.");
  if (approved) await q.query(`UPDATE payroll_runs SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, a.userId]);
});

interface RunRow { id: string; month: string; status: PayrollRun["status"]; employees_count: number; gross_total: string; deductions_total: string; net_total: string; employer_total: string; prepared_by: string; prepared_at: Date; approved_by: string | null; approved_at: Date | null; journal_entry_id: string | null; posted_at: Date | null; settings_snapshot: { warnings?: string[] } }
const toRun = (r: RunRow): PayrollRun => ({
  id: r.id, month: r.month, status: r.status, employeesCount: r.employees_count, grossTotal: r.gross_total, deductionsTotal: r.deductions_total, netTotal: r.net_total,
  employerTotal: r.employer_total, preparedBy: r.prepared_by, preparedAt: iso(r.prepared_at)!, approvedBy: r.approved_by, approvedAt: iso(r.approved_at), journalEntryId: r.journal_entry_id,
  postedAt: iso(r.posted_at), warnings: r.settings_snapshot?.warnings ?? [],
});

export class PayrollService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }

  async runs(a: Actor) {
    need(a, "hr.payroll.manage", "finance.journal.post");
    return (await this.db.query<RunRow>(`SELECT * FROM payroll_runs WHERE organization_id = $1 ORDER BY month DESC, prepared_at DESC LIMIT 60`, [a.orgId])).rows.map(toRun);
  }

  async run(a: Actor, id: string, q: Queryable = this.db): Promise<PayrollRun> {
    need(a, "hr.payroll.manage", "finance.journal.post");
    if (!isUuid(id)) throw notFound("Payroll run");
    const r = (await q.query<RunRow>(`SELECT * FROM payroll_runs WHERE id = $1 AND organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Payroll run");
    const slips = await q.query<{ id: string; employee_id: string; full_name: string; code: string; working_days: string; payable_days: string; lop_days: string; earnings: PayslipLine[]; deductions: PayslipLine[]; employer_contributions: PayslipLine[]; gross: string; total_deductions: string; net_pay: string; employer_cost: string }>(
      `SELECT p.*, e.full_name, e.code FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = $1 ORDER BY e.full_name`, [id]);
    return { ...toRun(r), payslips: slips.rows.map((p): Payslip => ({ id: p.id, employeeId: p.employee_id, employeeName: p.full_name, employeeCode: p.code, workingDays: p.working_days, payableDays: p.payable_days, lopDays: p.lop_days, earnings: p.earnings, deductions: p.deductions, employerContributions: p.employer_contributions, gross: p.gross, totalDeductions: p.total_deductions, netPay: p.net_pay, employerCost: p.employer_cost })) };
  }

  /** Prepares (or re-prepares) the draft run for a month from attendance, leave and salary structures. */
  async prepare(a: Actor, body: unknown) {
    need(a, "hr.payroll.manage");
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }), body);
    const id = await this.db.tx(async (q) => {
      const existing = (await q.query<{ id: string; status: string }>(`SELECT id, status FROM payroll_runs WHERE organization_id = $1 AND month = $2 AND status <> 'cancelled' FOR UPDATE`, [a.orgId, month])).rows[0];
      if (existing && existing.status !== "draft") throw conflict(`Payroll for ${month} is already ${existing.status}.`);
      if (existing) {
        await q.query(`UPDATE approval_requests SET status = 'cancelled', decided_at = now() WHERE entity_type = 'payroll_run' AND entity_id = $1 AND status = 'pending'`, [existing.id]);
        await q.query(`DELETE FROM payroll_runs WHERE id = $1`, [existing.id]);
      }
      const settings = (await getSettings(q, a.orgId)).payroll;
      const start = `${month}-01`, end = lastDayOf(month);
      const allWorking = await workingDates(q, a.orgId, start, end);
      const emps = (await q.query<{ id: string; full_name: string; date_of_joining: string; date_of_exit: string | null; components: SalaryComponent[] | null; monthly_tds: string | null }>(
        `SELECT e.id, e.full_name, e.date_of_joining, e.date_of_exit,
                (SELECT s.components FROM salary_structures s WHERE s.employee_id = e.id AND s.effective_from <= $3::date ORDER BY s.effective_from DESC LIMIT 1) AS components,
                (SELECT s.monthly_tds FROM salary_structures s WHERE s.employee_id = e.id AND s.effective_from <= $3::date ORDER BY s.effective_from DESC LIMIT 1) AS monthly_tds
           FROM employees e WHERE e.organization_id = $1 AND e.date_of_joining <= $3::date AND (e.date_of_exit IS NULL OR e.date_of_exit >= $2::date)`, [a.orgId, start, end])).rows;
      const warnings: string[] = [];
      const run = await q.query<{ id: string }>(`INSERT INTO payroll_runs (organization_id, month, prepared_by) VALUES ($1,$2,$3) RETURNING id`, [a.orgId, month, a.userId]);
      const rid = run.rows[0].id;
      let n = 0, G = 0n, Dd = 0n, E = 0n;
      for (const e of emps) {
        if (!e.components) { warnings.push(`${e.full_name}: no salary structure — skipped`); continue; }
        const att = (await q.query<{ work_date: string; status: string; unpaid: boolean | null }>(
          `SELECT a.work_date, a.status, (SELECT NOT t.paid FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.employee_id = a.employee_id AND l.status = 'approved' AND a.work_date BETWEEN l.from_date AND l.to_date LIMIT 1) AS unpaid
             FROM attendance a WHERE a.employee_id = $1 AND a.work_date BETWEEN $2::date AND $3::date`, [e.id, start, end])).rows;
        const byDate = new Map(att.map((x) => [x.work_date, x]));
        const employed = allWorking.filter((d) => d >= e.date_of_joining && (!e.date_of_exit || d <= e.date_of_exit));
        let lop = 0, unmarked = 0;
        for (const d of employed) {
          const x = byDate.get(d);
          if (!x) { unmarked++; continue; }
          if (x.status === "absent") lop += 1;
          else if (x.status === "half_day") lop += x.unpaid ? 0.5 : 0; // half-day attendance without leave counts as paid half
          else if (x.status === "leave" && x.unpaid) lop += 1;
        }
        if (unmarked) warnings.push(`${e.full_name}: ${unmarked} working day(s) without attendance were treated as present`);
        const working = allWorking.length;
        const payable = Math.max(0, employed.length - lop);
        const c = computeSlip(e.components, e.monthly_tds ?? "0", working, payable, settings);
        if (c.net < 0n) { warnings.push(`${e.full_name}: deductions exceed earnings — skipped, review the structure`); continue; }
        const employerTotal = c.employerCost - c.gross;
        await q.query(
          `INSERT INTO payslips (organization_id, run_id, employee_id, working_days, payable_days, lop_days, earnings, deductions, employer_contributions, gross, total_deductions, net_pay, employer_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [a.orgId, rid, e.id, working, payable, working - payable, JSON.stringify(c.earnings), JSON.stringify(c.deductions), JSON.stringify(c.employer), fromPaise(c.gross), fromPaise(c.ded), fromPaise(c.net), fromPaise(c.employerCost)]);
        n++; G += c.gross; Dd += c.ded; E += employerTotal;
      }
      await q.query(`UPDATE payroll_runs SET employees_count = $2, gross_total = $3, deductions_total = $4, net_total = $5, employer_total = $6, settings_snapshot = $7 WHERE id = $1`,
        [rid, n, fromPaise(G), fromPaise(Dd), fromPaise(G - Dd), fromPaise(E), JSON.stringify({ ...settings, warnings })]);
      await audit(q, a, "payroll.prepare", "payroll_run", rid, { month, employees: n, gross: fromPaise(G) });
      return rid;
    });
    return this.run(a, id);
  }

  async submit(a: Actor, id: string) {
    need(a, "hr.payroll.manage");
    await this.db.tx(async (q) => {
      const r = await this.run(a, id, q);
      if (r.status !== "draft") throw conflict("Only a draft can be submitted.");
      if (!r.employeesCount) throw conflict("This run has no payslips.");
      await requestApproval(q, a, { entityType: "payroll_run", entityId: id, title: `Payroll ${r.month}`, reason: `${r.employeesCount} employees · net ₹${r.netTotal}`, permission: "hr.payroll.manage" });
      await audit(q, a, "payroll.submit", "payroll_run", id);
    });
    return this.run(a, id);
  }

  /** Finance posts an approved run: Dr salaries & employer cost; Cr net pay and each statutory liability. */
  async post(a: Actor, id: string, body: unknown) {
    need(a, "finance.journal.post");
    const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), body ?? {});
    await this.db.tx(async (q) => {
      const r = (await q.query<RunRow>(`SELECT * FROM payroll_runs WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!r) throw notFound("Payroll run");
      if (r.status !== "approved") throw conflict(r.status === "posted" ? "Already posted." : "Payroll must be approved before posting.");
      const slips = (await q.query<{ deductions: PayslipLine[]; employer_contributions: PayslipLine[] }>(`SELECT deductions, employer_contributions FROM payslips WHERE run_id = $1`, [id])).rows;
      const by = (code: string, list: "d" | "e") => sum(slips.flatMap((s) => (list === "d" ? s.deductions : s.employer_contributions)).filter((x) => x.code === code).map((x) => toPaise(x.amount)));
      const known = ["PF_EE", "ESI_EE", "PT", "TDS"];
      const other = sum(slips.flatMap((s) => s.deductions).filter((x) => !known.includes(x.code)).map((x) => toPaise(x.amount)));
      const acc = await systemAccounts(q, a.orgId);
      const postDate = date ?? lastDayOf(r.month);
      if (postDate.slice(0, 7) !== r.month) throw invalid("Post payroll inside its own month.");
      const je = await postJournal(q, a, {
        date: postDate, sourceType: "payroll", sourceId: id, memo: `Payroll ${r.month} (${r.employees_count} employees)`,
        lines: [
          { accountId: acc.salaries, debit: r.gross_total },
          { accountId: acc.employer_contrib, debit: r.employer_total },
          { accountId: acc.salary_payable, credit: r.net_total },
          { accountId: acc.pf_payable, credit: fromPaise(by("PF_EE", "d") + by("PF_ER", "e")) },
          { accountId: acc.esi_payable, credit: fromPaise(by("ESI_EE", "d") + by("ESI_ER", "e")) },
          { accountId: acc.pt_payable, credit: fromPaise(by("PT", "d")) },
          { accountId: acc.tds_salary_payable, credit: fromPaise(by("TDS", "d")) },
          { accountId: acc.payroll_other, credit: fromPaise(other) },
        ],
      });
      await q.query(`UPDATE payroll_runs SET status = 'posted', journal_entry_id = $2, posted_at = now() WHERE id = $1`, [id, je]);
      await audit(q, a, "payroll.post", "payroll_run", id, { journalEntryId: je });
    });
    return this.run(a, id);
  }

  async myPayslips(a: Actor) {
    need(a, "hr.self_service");
    const r = await this.db.query<{ id: string; month: string; gross: string; net_pay: string; total_deductions: string; earnings: PayslipLine[]; deductions: PayslipLine[]; payable_days: string; working_days: string }>(
      `SELECT p.id, r.month, p.gross, p.net_pay, p.total_deductions, p.earnings, p.deductions, p.payable_days, p.working_days FROM payslips p
         JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
        WHERE e.user_id = $1 AND r.status = 'posted' ORDER BY r.month DESC LIMIT 24`, [a.userId]);
    return r.rows.map((p) => ({ id: p.id, month: p.month, gross: p.gross, netPay: p.net_pay, totalDeductions: p.total_deductions, earnings: p.earnings, deductions: p.deductions, payableDays: p.payable_days, workingDays: p.working_days }));
  }
}
