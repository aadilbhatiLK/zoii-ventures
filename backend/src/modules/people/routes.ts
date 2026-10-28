import type { Router } from "../../app";
import type { Deps } from "../../lib/context";
import { AutomationService } from "../automation/engine";
import { TicketService } from "../support/tickets";
import { HrService } from "./hr";
import { PayrollService } from "./payroll";

export function peopleRoutes(r: Router, deps: Deps) {
  const hr = new HrService(deps);
  const pay = new PayrollService(deps);
  const tickets = new TicketService(deps);
  const auto = new AutomationService(deps);

  r.get("/hr/departments", async ({ actor }) => hr.departments(actor));
  r.post("/hr/departments", async ({ actor, body }) => hr.createDepartment(actor, body), { status: 201 });
  r.get("/hr/employees", async ({ actor, query }) => hr.employees(actor, query));
  r.post("/hr/employees", async ({ actor, body }) => hr.createEmployee(actor, body), { status: 201 });
  r.get("/hr/me", async ({ actor }) => hr.me(actor));
  r.get("/hr/employees/:id", async ({ actor, params }) => hr.employee(actor, params.id));
  r.put("/hr/employees/:id", async ({ actor, params, body }) => hr.updateEmployee(actor, params.id, body));
  r.post("/hr/employees/:id/exit", async ({ actor, params, body }) => hr.exitEmployee(actor, params.id, body));
  r.get("/hr/employees/:id/salary", async ({ actor, params }) => hr.salary(actor, params.id));
  r.post("/hr/employees/:id/salary", async ({ actor, params, body }) => hr.setSalary(actor, params.id, body), { status: 201 });
  r.get("/hr/attendance", async ({ actor, query }) => hr.attendance(actor, query));
  r.post("/hr/attendance", async ({ actor, body }) => hr.markAttendance(actor, body));
  r.get("/hr/holidays", async ({ actor, query }) => hr.holidays(actor, String(query.year ?? new Date().getUTCFullYear())));
  r.post("/hr/holidays", async ({ actor, body }) => hr.addHoliday(actor, body));
  r.get("/hr/leave-types", async ({ actor }) => hr.leaveTypes(actor));
  r.get("/hr/leave/balances", async ({ actor, query }) => hr.balances(actor, query.employeeId ? String(query.employeeId) : undefined, query.year ? String(query.year) : undefined));
  r.get("/hr/leave", async ({ actor, query }) => hr.leaveRequests(actor, query));
  r.post("/hr/leave", async ({ actor, body }) => hr.applyLeave(actor, body), { status: 201 });
  r.post("/hr/leave/:id/cancel", async ({ actor, params }) => { await hr.cancelLeave(actor, params.id); return { ok: true }; });

  r.get("/payroll/runs", async ({ actor }) => pay.runs(actor));
  r.post("/payroll/runs", async ({ actor, body }) => pay.prepare(actor, body), { status: 201 });
  r.get("/payroll/runs/:id", async ({ actor, params }) => pay.run(actor, params.id));
  r.post("/payroll/runs/:id/submit", async ({ actor, params }) => pay.submit(actor, params.id));
  r.post("/payroll/runs/:id/post", async ({ actor, params, body }) => pay.post(actor, params.id, body));
  r.get("/payroll/my-payslips", async ({ actor }) => pay.myPayslips(actor));

  r.get("/tickets", async ({ actor, query }) => tickets.list(actor, query));
  r.post("/tickets", async ({ actor, body }) => tickets.create(actor, body), { status: 201 });
  r.get("/tickets/sla-policies", async ({ actor }) => tickets.slaPolicies(actor));
  r.get("/tickets/:id", async ({ actor, params }) => tickets.get(actor, params.id));
  r.patch("/tickets/:id", async ({ actor, params, body }) => tickets.update(actor, params.id, body));
  r.post("/tickets/:id/comments", async ({ actor, params, body }) => tickets.comment(actor, params.id, body), { status: 201 });

  r.get("/automations/triggers", async () => auto.triggers());
  r.get("/automations", async ({ actor }) => auto.list(actor));
  r.post("/automations", async ({ actor, body }) => auto.save(actor, body), { status: 201 });
  r.put("/automations/:id", async ({ actor, params, body }) => auto.save(actor, body, params.id));
  r.delete("/automations/:id", async ({ actor, params }) => auto.remove(actor, params.id));
  r.get("/automations/runs", async ({ actor, query }) => auto.runs(actor, query.ruleId ? String(query.ruleId) : undefined));
  r.post("/automations/run-now", async ({ actor }) => auto.runNow(actor));
}
