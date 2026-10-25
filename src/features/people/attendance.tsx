"use client";

import { useState } from "react";
import { CalendarPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, NativeSelect, PromptDialog, Section, SimpleTable, Stat, StatusBadge, thisMonth, today } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { ATTENDANCE_STATUSES, type AttendanceDay, type Employee, type LeaveBalance, type LeaveRequest, type LeaveType } from "@/lib/api/modules/people";
import { formatDate } from "@/lib/formatting";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = { present: "bg-success/80", wfh: "bg-info/70", half_day: "bg-warning/70", absent: "bg-danger/80", leave: "bg-accent/70", holiday: "bg-fg-subtle/40", weekly_off: "bg-fg-subtle/20" };
const daysOf = (month: string) => { const [y, m] = month.split("-").map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`); };
const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

export function AttendanceView() {
  const { can } = useAuth();
  const me = useApi<Employee | null>(["hr", "me"], "/hr/me");
  const hr = can("hr.view");
  const [tab, setTab] = useState(hr ? "team" : "mine");
  return (
    <ModulePage title="Attendance & Leave" description="Mark today's attendance, apply for leave and see balances. Approved leave fills attendance automatically; months with approved payroll are locked."
      permissions={["hr.self_service", "hr.view"]}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>{me.data && <TabsTrigger value="mine">Mine</TabsTrigger>}{hr && <TabsTrigger value="team">Team</TabsTrigger>}{(hr || can("hr.leave.approve")) && <TabsTrigger value="requests">Leave requests</TabsTrigger>}</TabsList>
        <TabsContent value="mine" className="pt-4">{me.data ? <Mine employee={me.data} /> : <EmptyState title="No employee profile" description="Ask HR to link your login to your employee record." />}</TabsContent>
        <TabsContent value="team" className="pt-4"><Team /></TabsContent>
        <TabsContent value="requests" className="pt-4"><Requests /></TabsContent>
      </Tabs>
    </ModulePage>
  );
}

function Mine({ employee }: { employee: Employee }) {
  const [month, setMonth] = useState(thisMonth());
  const days = useApi<AttendanceDay[]>(["hr", "attendance", "me", month], `/hr/attendance?month=${month}`);
  const bal = useApi<LeaveBalance[]>(["hr", "balances", "me"], "/hr/leave/balances");
  const reqs = useApi<LeaveRequest[]>(["hr", "leave", "mine"], "/hr/leave?mine=true");
  const mark = useApiMutation<{ workDate: string; status: string }>("POST", "/hr/attendance", { invalidate: [["hr"]], success: "Attendance marked" });
  const cancel = useApiMutation<{ id: string }>("POST", (b) => `/hr/leave/${b.id}/cancel`, { invalidate: [["hr"], ["approvals"]], success: "Leave cancelled" });
  const [apply, setApply] = useState(false);
  const byDate = new Map((days.data ?? []).map((d) => [d.workDate, d]));
  const t = byDate.get(today());
  return (
    <div className="space-y-5">
      <Section title={`Today · ${formatDate(today())}`} description={t ? `Marked: ${ATTENDANCE_STATUSES[t.status]}` : "Not marked yet"}
        actions={<><Button size="sm" variant="primary" loading={mark.isPending} onClick={() => mark.mutate({ workDate: today(), status: "present" })}>Present</Button><Button size="sm" onClick={() => mark.mutate({ workDate: today(), status: "wfh" })}>Work from home</Button><Button size="sm" onClick={() => mark.mutate({ workDate: today(), status: "half_day" })}>Half day</Button><Button size="sm" onClick={() => setApply(true)}><CalendarPlus /> Apply leave</Button></>}>
        <p className="text-fg-muted text-xs">You can correct the last 3 days yourself; older corrections go through HR.</p>
      </Section>
      <div className="grid gap-3 sm:grid-cols-4">{bal.data?.filter((b) => b.quota !== "0.0" && b.quota !== "0").map((b) => <Stat key={b.leaveTypeId} label={b.name} value={b.available} hint={`${b.used} used · ${b.pending} pending of ${b.quota}`} />)}</div>
      <Section title="Month" actions={<Input type="month" aria-label="Month" className="h-8 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />}>
        <div className="grid grid-cols-7 gap-1.5 text-center text-xs sm:max-w-md">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="text-fg-subtle">{d}</div>)}
          {Array.from({ length: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 }).map((_, i) => <div key={`b${i}`} />)}
          {daysOf(month).map((d) => {
            const a = byDate.get(d);
            return (
              <Tooltip key={d} content={a ? `${ATTENDANCE_STATUSES[a.status]}${a.note ? ` — ${a.note}` : ""}` : isSunday(d) ? "Sunday" : d > today() ? "Upcoming" : "Not marked"}>
                <div className={cn("flex aspect-square items-center justify-center rounded-md border border-transparent", a ? `${COLOR[a.status]} text-white` : isSunday(d) ? "bg-surface-3 text-fg-subtle" : "border-border text-fg-muted")}>{Number(d.slice(8))}</div>
              </Tooltip>
            );
          })}
        </div>
        <Legend />
      </Section>
      <Section title="My leave requests" flush>
        <SimpleTable label="My leave" rows={reqs.data} rowKey={(r) => r.id} loading={reqs.isLoading} empty={<p className="text-fg-muted px-4 py-5 text-center text-[13px]">No leave requests.</p>}
          columns={[{ key: "t", header: "Type", cell: (r) => r.leaveTypeCode }, { key: "d", header: "Dates", cell: (r) => `${formatDate(r.fromDate)}${r.toDate !== r.fromDate ? ` – ${formatDate(r.toDate)}` : ""}` }, { key: "n", header: "Days", align: "right", cell: (r) => r.days }, { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> }, { key: "x", header: "", align: "right", cell: (r) => ["pending", "approved"].includes(r.status) && r.fromDate > today() && <Button size="xs" variant="ghost" onClick={() => cancel.mutate({ id: r.id })}>Cancel</Button> }]} />
      </Section>
      {apply && <LeaveDialog onClose={() => setApply(false)} employeeId={employee.id} />}
    </div>
  );
}

function Legend() {
  return <div className="text-fg-muted mt-3 flex flex-wrap gap-3 text-xs">{Object.entries(ATTENDANCE_STATUSES).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", COLOR[k])} />{v}</span>)}</div>;
}

function LeaveDialog({ onClose, employeeId }: { onClose: () => void; employeeId?: string }) {
  const types = useApi<LeaveType[]>(["hr", "leave-types"], "/hr/leave-types");
  const [v, setV] = useState({ leaveTypeId: "", fromDate: today(), toDate: today(), halfDay: false, reason: "" });
  const m = useApiMutation("POST", "/hr/leave", { invalidate: [["hr"], ["approvals"]], success: "Leave requested — waiting for approval" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...v, employeeId }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>Apply for leave</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Leave type" htmlFor="lt" required className="sm:col-span-2"><NativeSelect id="lt" value={v.leaveTypeId} onChange={(e) => setV({ ...v, leaveTypeId: e.target.value })}><option value="">Choose…</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unpaid)"}</option>)}</NativeSelect></Field>
            <Field label="From" htmlFor="lf"><Input id="lf" type="date" value={v.fromDate} onChange={(e) => setV({ ...v, fromDate: e.target.value, toDate: e.target.value > v.toDate ? e.target.value : v.toDate })} /></Field>
            <Field label="To" htmlFor="lto"><Input id="lto" type="date" min={v.fromDate} value={v.toDate} onChange={(e) => setV({ ...v, toDate: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" disabled={v.fromDate !== v.toDate} checked={v.halfDay} onChange={(e) => setV({ ...v, halfDay: e.target.checked })} /> Half day</label>
            <Field label="Reason" htmlFor="lr" required className="sm:col-span-2"><Input id="lr" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
            <p className="text-fg-muted text-xs sm:col-span-2">Sundays and company holidays aren&apos;t counted.</p>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!v.leaveTypeId || v.reason.length < 3}>Request leave</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Team() {
  const { can } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const emps = useApi<Employee[]>(["hr", "employees"], "/hr/employees");
  const days = useApi<AttendanceDay[]>(["hr", "attendance", "all", month], `/hr/attendance?month=${month}&employeeId=all`);
  const holidays = useApi<{ date: string; name: string }[]>(["hr", "holidays", month.slice(0, 4)], `/hr/holidays?year=${month.slice(0, 4)}`);
  const mark = useApiMutation<{ employeeId: string; workDate: string; status: string }>("POST", "/hr/attendance", { invalidate: [["hr"]] });
  const addHoliday = useApiMutation<{ date: string; name: string }>("POST", "/hr/holidays", { invalidate: [["hr"]], success: "Holiday saved" });
  const [hol, setHol] = useState(false);
  const [holDate, setHolDate] = useState(today());
  const map = new Map((days.data ?? []).map((d) => [`${d.employeeId}|${d.workDate}`, d]));
  const dates = daysOf(month);
  const cycle = ["present", "wfh", "half_day", "absent", "holiday", "weekly_off"];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input type="month" aria-label="Month" className="h-8 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
        {can("hr.manage") && <Button size="sm" onClick={() => setHol(true)}><Plus /> Holiday</Button>}
      </div>
      <Section flush description={can("hr.manage") ? "Click a cell to cycle its status (HR corrections are audited)." : undefined}>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="text-2xs w-full border-separate border-spacing-0.5">
            <thead><tr><th className="bg-surface sticky left-0 min-w-36 px-2 text-left text-xs">Employee</th>{dates.map((d) => <th key={d} className={cn("w-6 text-center font-normal", isSunday(d) ? "text-fg-subtle" : "text-fg-muted")}>{Number(d.slice(8))}</th>)}</tr></thead>
            <tbody>
              {emps.data?.map((e) => (
                <tr key={e.id}>
                  <td className="bg-surface sticky left-0 truncate px-2 text-xs">{e.fullName}</td>
                  {dates.map((d) => {
                    const a = map.get(`${e.id}|${d}`);
                    return (
                      <td key={d} className="p-0">
                        <button type="button" disabled={!can("hr.manage") || a?.source === "leave"} title={a ? ATTENDANCE_STATUSES[a.status] : d}
                          onClick={() => mark.mutate({ employeeId: e.id, workDate: d, status: cycle[(cycle.indexOf(a?.status ?? "") + 1) % cycle.length] })}
                          className={cn("block size-6 rounded-sm", a ? COLOR[a.status] : isSunday(d) ? "bg-surface-3" : "border-border border")} aria-label={`${e.fullName} ${d}: ${a ? ATTENDANCE_STATUSES[a.status] : "not marked"}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-3"><Legend /></div>
      </Section>
      {holidays.data && holidays.data.length > 0 && <Section title={`Holidays ${month.slice(0, 4)}`}><ul className="grid gap-1 text-[13px] sm:grid-cols-3">{holidays.data.map((h) => <li key={h.date}><span className="text-fg-muted">{formatDate(h.date)}</span> · {h.name}</li>)}</ul></Section>}
      <PromptDialog open={hol} onOpenChange={setHol} title="Add company holiday" label="Name" placeholder="Diwali" confirmLabel="Save" busy={addHoliday.isPending} onSubmit={(name) => addHoliday.mutate({ date: holDate, name }, { onSuccess: () => setHol(false) })}>
        <Field label="Date" htmlFor="hd"><Input id="hd" type="date" value={holDate} onChange={(e) => setHolDate(e.target.value)} /></Field>
      </PromptDialog>
    </div>
  );
}

function Requests() {
  const [status, setStatus] = useState("pending");
  const reqs = useApi<LeaveRequest[]>(["hr", "leave", status], `/hr/leave?status=${status}`);
  return (
    <Section flush title="Leave requests" description="Approve or reject from the Approvals inbox — the requester can never approve their own." actions={<NativeSelect aria-label="Status" className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value)}>{["pending", "approved", "rejected", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>}>
      <SimpleTable label="Leave requests" rows={reqs.data} rowKey={(r) => r.id} loading={reqs.isLoading} empty={<p className="text-fg-muted px-4 py-5 text-center text-[13px]">None.</p>}
        columns={[{ key: "e", header: "Employee", cell: (r) => r.employeeName }, { key: "t", header: "Type", cell: (r) => r.leaveTypeCode }, { key: "d", header: "Dates", cell: (r) => `${formatDate(r.fromDate)}${r.toDate !== r.fromDate ? ` – ${formatDate(r.toDate)}` : ""}` }, { key: "n", header: "Days", align: "right", cell: (r) => r.days }, { key: "r", header: "Reason", cell: (r) => <span className="text-fg-muted">{r.reason}</span>, hideBelow: "md" }, { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> }]} />
    </Section>
  );
}
