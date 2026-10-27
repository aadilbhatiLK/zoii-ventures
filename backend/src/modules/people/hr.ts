import {
  AttendanceMarkSchema, EmployeeInputSchema, LeaveRequestSchema, SalaryStructureSchema,
  type AttendanceDay, type Department, type Employee, type LeaveBalance, type LeaveRequest, type LeaveType, type SalaryStructure,
} from "@/lib/api/modules/people";
import { fromPaise, percentOf, sum, toPaise, toScaled } from "@/lib/money";
import { z } from "zod";
import type { Queryable } from "../../db";
import { type Actor, type Deps, addDays, audit, need, nextNumber, todayIst } from "../../lib/context";
import { encrypt } from "../../lib/crypto";
import { conflict, forbidden, invalid, notFound, parse } from "../../lib/errors";
import { isUuid } from "../../lib/query";
import { registerApprovalHandler, requestApproval } from "../sales/approvals";

export async function seedPeopleDefaults(q: Queryable, orgId: string) {
  const types = [["CL", "Casual leave", "12", true], ["SL", "Sick leave", "12", true], ["EL", "Earned leave", "15", true], ["LOP", "Leave without pay", "0", false]] as const;
  for (const [code, name, quota, paid] of types)
    await q.query(`INSERT INTO leave_types (organization_id, code, name, annual_quota, paid) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [orgId, code, name, quota, paid]);
  const sla = [["urgent", 30, 240], ["high", 120, 480], ["medium", 240, 1440], ["low", 480, 4320]] as const;
  for (const [p, f, r] of sla)
    await q.query(`INSERT INTO sla_policies (organization_id, priority, first_response_minutes, resolution_minutes) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [orgId, p, f, r]);
}

/** Working days between two dates (inclusive): Sundays and company holidays are off. */
export async function workingDates(q: Queryable, orgId: string, from: string, to: string): Promise<string[]> {
  const hol = new Set((await q.query<{ holiday_date: string }>(`SELECT holiday_date FROM holidays WHERE organization_id = $1 AND holiday_date BETWEEN $2::date AND $3::date`, [orgId, from, to])).rows.map((h) => h.holiday_date));
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 && !hol.has(d)) out.push(d);
  return out;
}

interface ERow { id: string; code: string; user_id: string | null; full_name: string; work_email: string | null; phone: string | null; department_id: string | null; department_name: string | null; designation: string; manager_employee_id: string | null; date_of_joining: string; date_of_exit: string | null; status: Employee["status"]; employment_type: string; work_state: string | null; pan: string | null; uan: string | null; bank_account_last4: string | null; bank_ifsc: string | null; monthly_gross: string | null }
const E_SELECT = `SELECT e.*, d.name AS department_name,
  (SELECT s.monthly_gross FROM salary_structures s WHERE s.employee_id = e.id ORDER BY s.effective_from DESC LIMIT 1) AS monthly_gross
  FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;
const toEmployee = (r: ERow, showPay: boolean): Employee => ({
  id: r.id, code: r.code, userId: r.user_id, fullName: r.full_name, workEmail: r.work_email, phone: r.phone, departmentId: r.department_id, departmentName: r.department_name,
  designation: r.designation, managerEmployeeId: r.manager_employee_id, dateOfJoining: r.date_of_joining, dateOfExit: r.date_of_exit, status: r.status,
  employmentType: r.employment_type, workState: r.work_state, pan: showPay ? r.pan : r.pan ? `${r.pan.slice(0, 2)}•••••${r.pan.slice(-2)}` : null, uan: showPay ? r.uan : null,
  bankAccountMasked: r.bank_account_last4 ? `•••• ${r.bank_account_last4}` : null, bankIfsc: showPay ? r.bank_ifsc : null, monthlyGross: showPay ? r.monthly_gross : null,
});

registerApprovalHandler("leave_request", async (q, a, id, approved, note) => {
  const l = (await q.query<{ id: string; organization_id: string; employee_id: string; from_date: string; to_date: string; half_day: boolean; status: string; requested_by: string; user_id: string | null }>(
    `SELECT lr.*, e.user_id FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = $1 FOR UPDATE OF lr`, [id])).rows[0];
  if (!l || l.status !== "pending") throw conflict("This leave request is no longer pending.");
  if (l.requested_by === a.userId || l.user_id === a.userId) throw forbidden("You can't approve your own leave.");
  if (!a.permissions.has("hr.leave.approve")) throw forbidden();
  if (approved) {
    const locked = await q.query(`SELECT 1 FROM payroll_runs WHERE organization_id = $1 AND month BETWEEN $2 AND $3 AND status IN ('approved','posted')`, [l.organization_id, l.from_date.slice(0, 7), l.to_date.slice(0, 7)]);
    if (locked.rows.length) throw conflict("Payroll covering these dates is already approved, so attendance is locked. Reject this request or reopen payroll first.");
  }
  await q.query(`UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [id, approved ? "approved" : "rejected", a.userId, note]);
  if (approved) {
    for (const d of await workingDates(q, l.organization_id, l.from_date, l.to_date))
      await q.query(
        `INSERT INTO attendance (organization_id, employee_id, work_date, status, source, note, recorded_by) VALUES ($1,$2,$3,$4,'leave',$5,$6)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, source = 'leave', note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, updated_at = now()`,
        [l.organization_id, l.employee_id, d, l.half_day ? "half_day" : "leave", `Leave ${id.slice(0, 8)}`, a.userId]);
  }
});

export class HrService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private today() { return todayIst(this.deps.now()); }

  private async myEmployee(q: Queryable, a: Actor) {
    return (await q.query<{ id: string }>(`SELECT id FROM employees WHERE organization_id = $1 AND user_id = $2 AND status <> 'exited'`, [a.orgId, a.userId])).rows[0]?.id ?? null;
  }
  /** HR sees everyone; others only their own record (via their linked employee profile). */
  private async employeeFor(q: Queryable, a: Actor, employeeId?: string) {
    const mine = await this.myEmployee(q, a);
    if (!employeeId || employeeId === mine) {
      if (!mine) throw conflict("Your account isn't linked to an employee profile yet. Ask HR.");
      return { id: mine, self: true };
    }
    if (!a.permissions.has("hr.manage") && !a.permissions.has("hr.leave.approve")) throw forbidden();
    if (!isUuid(employeeId) || !(await q.query(`SELECT 1 FROM employees WHERE id = $1 AND organization_id = $2`, [employeeId, a.orgId])).rows.length) throw notFound("Employee");
    return { id: employeeId, self: false };
  }

  async departments(a: Actor): Promise<Department[]> {
    need(a, "hr.view", "hr.self_service");
    const r = await this.db.query<{ id: string; name: string; head_user_id: string | null; n: number }>(
      `SELECT d.*, (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id AND e.status <> 'exited') AS n FROM departments d WHERE d.organization_id = $1 ORDER BY d.name`, [a.orgId]);
    return r.rows.map((d) => ({ id: d.id, name: d.name, headUserId: d.head_user_id, headcount: d.n }));
  }
  async createDepartment(a: Actor, body: unknown) {
    need(a, "hr.manage");
    const d = parse(z.object({ name: z.string().trim().min(2).max(80), headUserId: z.string().uuid().optional().nullable() }), body);
    const r = await this.db.query<{ id: string }>(`INSERT INTO departments (organization_id, name, head_user_id) VALUES ($1,$2,$3) RETURNING id`, [a.orgId, d.name, d.headUserId ?? null])
      .catch((e) => { if ((e as { code?: string }).code === "23505") throw conflict("That department exists."); throw e; });
    await audit(this.db, a, "department.create", "department", r.rows[0].id, d);
    return (await this.departments(a)).find((x) => x.id === r.rows[0].id)!;
  }

  async employees(a: Actor, query: Record<string, unknown>) {
    need(a, "hr.view");
    const params: unknown[] = [a.orgId];
    const where = ["e.organization_id = $1"];
    if (query.status !== "all") where.push(`e.status <> 'exited'`);
    if (query.departmentId && isUuid(query.departmentId)) { params.push(query.departmentId); where.push(`e.department_id = $${params.length}`); }
    const r = await this.db.query<ERow>(`${E_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.full_name`, params);
    const pay = a.permissions.has("hr.payroll.manage");
    return r.rows.map((e) => toEmployee(e, pay));
  }

  async employee(a: Actor, id: string) {
    if (!isUuid(id)) throw notFound("Employee");
    const r = (await this.db.query<ERow>(`${E_SELECT} WHERE e.id = $1 AND e.organization_id = $2`, [id, a.orgId])).rows[0];
    if (!r) throw notFound("Employee");
    const self = r.user_id === a.userId;
    if (!self) need(a, "hr.view");
    return toEmployee(r, self || a.permissions.has("hr.payroll.manage"));
  }

  async me(a: Actor) {
    need(a, "hr.self_service", "hr.view");
    const id = await this.myEmployee(this.db, a);
    return id ? this.employee(a, id) : null;
  }

  private async writeEmployee(q: Queryable, a: Actor, d: z.output<typeof EmployeeInputSchema>, id?: string) {
    if (d.userId && !(await q.query(`SELECT 1 FROM users WHERE id = $1 AND organization_id = $2`, [d.userId, a.orgId])).rows.length) throw invalid("Unknown user.", { userId: ["Unknown"] });
    const bank = d.bankAccount ? { enc: encrypt(d.bankAccount, this.deps.config.dataEncryptionKey), last4: d.bankAccount.slice(-4) } : null;
    if (!id) {
      const n = await nextNumber(q, a.orgId, "employee");
      const r = await q.query<{ id: string }>(
        `INSERT INTO employees (organization_id, code, user_id, full_name, work_email, phone, department_id, designation, manager_employee_id, date_of_joining, employment_type, work_state, pan, uan, bank_account_enc, bank_account_last4, bank_ifsc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [a.orgId, `EMP-${String(n).padStart(4, "0")}`, d.userId ?? null, d.fullName, d.workEmail ?? null, d.phone ?? null, d.departmentId ?? null, d.designation, d.managerEmployeeId ?? null,
         d.dateOfJoining, d.employmentType, d.workState ?? null, d.pan ?? null, d.uan ?? null, bank?.enc ?? null, bank?.last4 ?? null, d.bankIfsc ?? null]);
      return r.rows[0].id;
    }
    await q.query(
      `UPDATE employees SET user_id = CASE WHEN $17 THEN $2::uuid ELSE user_id END, full_name=$3, work_email=$4, phone=$5, department_id=$6, designation=$7, manager_employee_id=$8, date_of_joining=$9, employment_type=$10, work_state=$11,
              pan=coalesce($12, pan), uan=coalesce($13, uan), bank_account_enc=coalesce($14, bank_account_enc), bank_account_last4=coalesce($15, bank_account_last4), bank_ifsc=coalesce($16, bank_ifsc) WHERE id = $1`,
      [id, d.userId ?? null, d.fullName, d.workEmail ?? null, d.phone ?? null, d.departmentId ?? null, d.designation, d.managerEmployeeId ?? null, d.dateOfJoining, d.employmentType, d.workState ?? null,
       d.pan ?? null, d.uan ?? null, bank?.enc ?? null, bank?.last4 ?? null, d.bankIfsc ?? null, d.userId !== undefined]);
    return id;
  }

  async createEmployee(a: Actor, body: unknown) {
    need(a, "hr.manage");
    const d = parse(EmployeeInputSchema, body);
    const id = await this.db.tx(async (q) => {
      const id = await this.writeEmployee(q, a, d);
      // Sensitive identifiers are recorded as "changed", never their values.
      await audit(q, a, "employee.create", "employee", id, { name: d.fullName, bankAccount: d.bankAccount ? "set" : undefined, pan: d.pan ? "set" : undefined });
      return id;
    }).catch((e) => { if ((e as { code?: string }).code === "23505") throw conflict("That user is already linked to another employee."); throw e; });
    return this.employee(a, id);
  }

  async updateEmployee(a: Actor, id: string, body: unknown) {
    need(a, "hr.manage");
    const d = parse(EmployeeInputSchema, body);
    await this.db.tx(async (q) => {
      const emp = isUuid(id) ? (await q.query<{ user_id: string | null }>(`SELECT user_id FROM employees WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0] : undefined;
      if (!emp) throw notFound("Employee");
      // Salary goes to the bank account on file: nobody edits their own HR record's bank details.
      // An omitted userId keeps the link (see writeEmployee), so unlinking needs an explicit value,
      // and that is refused for one's own record: an unlinked record would escape both checks.
      if (emp.user_id === a.userId && d.userId !== undefined && d.userId !== a.userId) throw forbidden("You can't unlink your own employee record.");
      if (emp.user_id === a.userId && d.bankAccount) throw forbidden("You can't change your own bank details. Ask another HR manager.");
      await this.writeEmployee(q, a, d, id);
      await audit(q, a, "employee.update", "employee", id, { name: d.fullName, bankAccount: d.bankAccount ? "changed" : undefined });
    });
    return this.employee(a, id);
  }

  async exitEmployee(a: Actor, id: string, body: unknown) {
    need(a, "hr.manage");
    const d = parse(z.object({ dateOfExit: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(300) }), body);
    await this.db.tx(async (q) => {
      const e = (await q.query<{ date_of_joining: string; status: string }>(`SELECT date_of_joining, status FROM employees WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, a.orgId])).rows[0];
      if (!e) throw notFound("Employee");
      if (e.status === "exited") throw conflict("Already exited.");
      if (d.dateOfExit < e.date_of_joining) throw invalid("Exit is before joining.");
      await q.query(`UPDATE employees SET status = 'exited', date_of_exit = $2 WHERE id = $1`, [id, d.dateOfExit]);
      await audit(q, a, "employee.exit", "employee", id, d);
    });
    return this.employee(a, id);
  }

  // ---------- salary ----------
  async salary(a: Actor, employeeId: string): Promise<SalaryStructure[]> {
    const emp = await this.employee(a, employeeId);
    if (emp.userId !== a.userId) need(a, "hr.payroll.manage");
    const r = await this.db.query<{ id: string; effective_from: string; components: SalaryStructure["components"]; monthly_gross: string; monthly_tds: string }>(
      `SELECT * FROM salary_structures WHERE employee_id = $1 ORDER BY effective_from DESC`, [employeeId]);
    return r.rows.map((s) => ({ id: s.id, employeeId, effectiveFrom: s.effective_from, components: s.components, monthlyGross: s.monthly_gross, monthlyTds: s.monthly_tds }));
  }

  async setSalary(a: Actor, employeeId: string, body: unknown) {
    need(a, "hr.payroll.manage");
    const d = parse(SalaryStructureSchema, body);
    const basic = toPaise(d.components.find((c) => c.code === "BASIC")!.value);
    const gross = sum(d.components.filter((c) => c.kind === "earning").map((c) => c.calc === "fixed" ? toPaise(c.value) : percentOf(basic, c.value)));
    await this.db.tx(async (q) => {
      const emp = isUuid(employeeId) ? (await q.query<{ user_id: string | null }>(`SELECT user_id FROM employees WHERE id = $1 AND organization_id = $2`, [employeeId, a.orgId])).rows[0] : undefined;
      if (!emp) throw notFound("Employee");
      if (emp.user_id === a.userId) throw forbidden("You can't change your own salary. Ask another payroll manager.");
      const posted = await q.query(`SELECT 1 FROM payroll_runs r JOIN payslips p ON p.run_id = r.id WHERE p.employee_id = $1 AND r.status = 'posted' AND r.month >= $2`, [employeeId, d.effectiveFrom.slice(0, 7)]);
      if (posted.rows.length) throw conflict("Payroll is already posted for that month. Make the change effective from a later month.");
      await q.query(
        `INSERT INTO salary_structures (organization_id, employee_id, effective_from, components, monthly_gross, monthly_tds, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (employee_id, effective_from) DO UPDATE SET components = EXCLUDED.components, monthly_gross = EXCLUDED.monthly_gross, monthly_tds = EXCLUDED.monthly_tds`,
        [a.orgId, employeeId, d.effectiveFrom, JSON.stringify(d.components), fromPaise(gross), d.monthlyTds, a.userId]);
      await audit(q, a, "salary.set", "employee", employeeId, { effectiveFrom: d.effectiveFrom, monthlyGross: fromPaise(gross) });
    });
    return this.salary(a, employeeId);
  }

  // ---------- attendance ----------
  async markAttendance(a: Actor, body: unknown) {
    const d = parse(AttendanceMarkSchema, body);
    need(a, "hr.self_service", "hr.manage");
    return this.db.tx(async (q) => {
      const emp = await this.employeeFor(q, a, d.employeeId);
      if (emp.self && !a.permissions.has("hr.manage")) {
        if (d.workDate > this.today()) throw invalid("You can't mark attendance for a future date.");
        if (d.workDate < addDays(this.today(), -3)) throw invalid("Self-marking is allowed for the last 3 days. Ask HR to correct older days.");
        if (["holiday", "weekly_off"].includes(d.status)) throw forbidden("Only HR marks holidays.");
      }
      const locked = await q.query(`SELECT 1 FROM payroll_runs WHERE organization_id = $1 AND month = $2 AND status IN ('approved','posted')`, [a.orgId, d.workDate.slice(0, 7)]);
      if (locked.rows.length) throw conflict("Payroll for that month is approved; attendance is locked.");
      const prev = (await q.query<{ source: string }>(`SELECT source FROM attendance WHERE employee_id = $1 AND work_date = $2`, [emp.id, d.workDate])).rows[0];
      if (prev?.source === "leave" && emp.self) throw conflict("That day is approved leave. Cancel the leave with HR to change it.");
      const now = this.deps.now();
      await q.query(
        `INSERT INTO attendance (organization_id, employee_id, work_date, status, check_in, source, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, source = EXCLUDED.source, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, updated_at = now()`,
        [a.orgId, emp.id, d.workDate, d.status, emp.self && d.workDate === this.today() ? now : null, emp.self ? "self" : "hr", d.note ?? null, a.userId]);
      if (!emp.self) await audit(q, a, "attendance.mark", "employee", emp.id, { date: d.workDate, status: d.status });
      return { employeeId: emp.id, workDate: d.workDate, status: d.status };
    });
  }

  async attendance(a: Actor, query: Record<string, unknown>): Promise<AttendanceDay[]> {
    need(a, "hr.self_service", "hr.view");
    const month = String(query.month ?? this.today().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) throw invalid("Month is YYYY-MM.");
    const emp = query.employeeId === "all" ? null : await this.employeeFor(this.db, a, query.employeeId ? String(query.employeeId) : undefined);
    if (!emp) need(a, "hr.view");
    const r = await this.db.query<{ employee_id: string; work_date: string; status: AttendanceDay["status"]; source: string; note: string | null }>(
      `SELECT employee_id, work_date, status, source, note FROM attendance WHERE organization_id = $1 AND to_char(work_date, 'YYYY-MM') = $2 AND ($3::uuid IS NULL OR employee_id = $3) ORDER BY work_date`,
      [a.orgId, month, emp?.id ?? null]);
    return r.rows.map((x) => ({ employeeId: x.employee_id, workDate: x.work_date, status: x.status, source: x.source, note: x.note }));
  }

  async addHoliday(a: Actor, body: unknown) {
    need(a, "hr.manage");
    const d = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(2).max(80) }), body);
    await this.db.query(`INSERT INTO holidays (organization_id, holiday_date, name) VALUES ($1,$2,$3) ON CONFLICT (organization_id, holiday_date) DO UPDATE SET name = EXCLUDED.name`, [a.orgId, d.date, d.name]);
    await audit(this.db, a, "holiday.set", "holiday", null, d);
    return this.holidays(a, d.date.slice(0, 4));
  }
  async holidays(a: Actor, year: string) {
    need(a, "hr.self_service", "hr.view");
    return (await this.db.query<{ holiday_date: string; name: string }>(`SELECT holiday_date, name FROM holidays WHERE organization_id = $1 AND to_char(holiday_date, 'YYYY') = $2 ORDER BY holiday_date`, [a.orgId, year])).rows.map((h) => ({ date: h.holiday_date, name: h.name }));
  }

  // ---------- leave ----------
  async leaveTypes(a: Actor): Promise<LeaveType[]> {
    need(a, "hr.self_service", "hr.view");
    return (await this.db.query<{ id: string; code: string; name: string; annual_quota: string; paid: boolean }>(`SELECT * FROM leave_types WHERE organization_id = $1 ORDER BY code`, [a.orgId])).rows
      .map((t) => ({ id: t.id, code: t.code, name: t.name, annualQuota: t.annual_quota, paid: t.paid }));
  }

  async balances(a: Actor, employeeId: string | undefined, year = this.today().slice(0, 4), q: Queryable = this.db): Promise<LeaveBalance[]> {
    need(a, "hr.self_service", "hr.view");
    const emp = await this.employeeFor(q, a, employeeId);
    const r = await q.query<{ id: string; code: string; name: string; annual_quota: string; used: string | null; pending: string | null }>(
      `SELECT t.*, (SELECT sum(days) FROM leave_requests l WHERE l.leave_type_id = t.id AND l.employee_id = $2 AND l.status = 'approved' AND to_char(l.from_date, 'YYYY') = $3) AS used,
              (SELECT sum(days) FROM leave_requests l WHERE l.leave_type_id = t.id AND l.employee_id = $2 AND l.status = 'pending' AND to_char(l.from_date, 'YYYY') = $3) AS pending
         FROM leave_types t WHERE t.organization_id = $1 ORDER BY t.code`, [a.orgId, emp.id, year]);
    return r.rows.map((t) => {
      const quota = toScaled(t.annual_quota, 1), used = toScaled(t.used ?? "0", 1), pend = toScaled(t.pending ?? "0", 1);
      const f = (x: bigint) => `${x / 10n}.${(x < 0n ? -x : x) % 10n}`;
      return { leaveTypeId: t.id, code: t.code, name: t.name, quota: t.annual_quota, used: f(used), pending: f(pend), available: quota === 0n ? "—" : f(quota - used - pend) };
    });
  }

  async applyLeave(a: Actor, body: unknown) {
    need(a, "hr.self_service", "hr.manage");
    const d = parse(LeaveRequestSchema, body);
    const id = await this.db.tx(async (q) => {
      const emp = await this.employeeFor(q, a, d.employeeId);
      if (d.fromDate.slice(0, 4) !== d.toDate.slice(0, 4)) throw invalid("Split leave that crosses the year end into two requests.");
      const type = (await q.query<{ code: string; annual_quota: string; name: string }>(`SELECT code, annual_quota, name FROM leave_types WHERE id = $1 AND organization_id = $2`, [d.leaveTypeId, a.orgId])).rows[0];
      if (!type) throw invalid("Unknown leave type.", { leaveTypeId: ["Unknown"] });
      const dates = await workingDates(q, a.orgId, d.fromDate, d.toDate);
      if (!dates.length) throw invalid("Those dates are all Sundays or holidays.");
      const days = d.halfDay ? "0.5" : `${dates.length}.0`;
      const overlap = await q.query(`SELECT 1 FROM leave_requests WHERE employee_id = $1 AND status IN ('pending','approved') AND from_date <= $3 AND to_date >= $2`, [emp.id, d.fromDate, d.toDate]);
      if (overlap.rows.length) throw conflict("You already have leave on some of these dates.");
      if (toScaled(type.annual_quota, 1) > 0n) {
        const bal = (await this.balances(a, emp.id, d.fromDate.slice(0, 4), q)).find((b) => b.leaveTypeId === d.leaveTypeId)!;
        if (toScaled(bal.available, 1) < toScaled(days, 1)) throw conflict(`Only ${bal.available} day(s) of ${type.name} left. Apply the rest as leave without pay.`);
      }
      const r = await q.query<{ id: string }>(
        `INSERT INTO leave_requests (organization_id, employee_id, leave_type_id, from_date, to_date, half_day, days, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [a.orgId, emp.id, d.leaveTypeId, d.fromDate, d.toDate, d.halfDay, days, d.reason, a.userId]);
      const name = (await q.query<{ full_name: string }>(`SELECT full_name FROM employees WHERE id = $1`, [emp.id])).rows[0].full_name;
      await requestApproval(q, a, { entityType: "leave_request", entityId: r.rows[0].id, title: `${name}: ${type.code} ${d.fromDate}${d.toDate !== d.fromDate ? ` → ${d.toDate}` : ""}`, reason: `${days} day(s) — ${d.reason}`, permission: "hr.leave.approve" });
      return r.rows[0].id;
    });
    return (await this.leaveRequests(a, { id })).find((x) => x.id === id)!;
  }

  async leaveRequests(a: Actor, query: Record<string, unknown>): Promise<LeaveRequest[]> {
    need(a, "hr.self_service", "hr.view");
    const all = a.permissions.has("hr.leave.approve") || a.permissions.has("hr.view");
    const mine = await this.myEmployee(this.db, a);
    const params: unknown[] = [a.orgId];
    const where = ["l.organization_id = $1"];
    if (!all || query.mine === "true") { params.push(mine ?? "00000000-0000-0000-0000-000000000000"); where.push(`l.employee_id = $${params.length}`); }
    if (query.status) { params.push(String(query.status)); where.push(`l.status = $${params.length}`); }
    if (query.id && isUuid(query.id)) { params.push(query.id); where.push(`l.id = $${params.length}`); }
    const r = await this.db.query<{ id: string; employee_id: string; full_name: string; leave_type_id: string; code: string; from_date: string; to_date: string; half_day: boolean; days: string; reason: string; status: LeaveRequest["status"]; decided_by: string | null; decision_note: string | null; created_at: Date }>(
      `SELECT l.*, e.full_name, t.code FROM leave_requests l JOIN employees e ON e.id = l.employee_id JOIN leave_types t ON t.id = l.leave_type_id WHERE ${where.join(" AND ")} ORDER BY l.from_date DESC LIMIT 300`, params);
    return r.rows.map((l) => ({ id: l.id, employeeId: l.employee_id, employeeName: l.full_name, leaveTypeId: l.leave_type_id, leaveTypeCode: l.code, fromDate: l.from_date, toDate: l.to_date, halfDay: l.half_day, days: l.days, reason: l.reason, status: l.status, decidedBy: l.decided_by, decisionNote: l.decision_note, createdAt: new Date(l.created_at).toISOString() }));
  }

  async cancelLeave(a: Actor, id: string) {
    need(a, "hr.self_service", "hr.manage");
    await this.db.tx(async (q) => {
      const l = (await q.query<{ status: string; employee_id: string; from_date: string; to_date: string; user_id: string | null }>(
        `SELECT l.*, e.user_id FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1 AND l.organization_id = $2 FOR UPDATE OF l`, [id, a.orgId])).rows[0];
      if (!l) throw notFound("Leave request");
      if (l.user_id !== a.userId && !a.permissions.has("hr.manage")) throw forbidden();
      if (!["pending", "approved"].includes(l.status)) throw conflict("Nothing to cancel.");
      if (l.status === "approved" && l.from_date <= this.today() && !a.permissions.has("hr.manage")) throw conflict("Leave that has started can only be cancelled by HR.");
      const locked = await q.query(`SELECT 1 FROM payroll_runs WHERE organization_id = $1 AND month BETWEEN $2 AND $3 AND status IN ('approved','posted')`, [a.orgId, l.from_date.slice(0, 7), l.to_date.slice(0, 7)]);
      if (locked.rows.length) throw conflict("Payroll covering these dates is approved.");
      await q.query(`UPDATE leave_requests SET status = 'cancelled' WHERE id = $1`, [id]);
      await q.query(`UPDATE approval_requests SET status = 'cancelled', decided_at = now() WHERE entity_type = 'leave_request' AND entity_id = $1 AND status = 'pending'`, [id]);
      await q.query(`DELETE FROM attendance WHERE employee_id = $1 AND source = 'leave' AND work_date BETWEEN $2 AND $3`, [l.employee_id, l.from_date, l.to_date]);
      await audit(q, a, "leave.cancel", "leave_request", id);
    });
  }
}
