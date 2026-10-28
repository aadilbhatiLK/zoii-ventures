"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, Money, NativeSelect, PromptDialog, Section, SimpleTable, StatusBadge, today } from "@/components/module/kit";
import { UserSelect } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { Department, Employee, SalaryComponent, SalaryStructure } from "@/lib/api/modules/people";
import { formatDate } from "@/lib/formatting";

export function EmployeesView() {
  const router = useRouter();
  const { can } = useAuth();
  const list = useApi<Employee[]>(["hr", "employees"], "/hr/employees");
  const depts = useApi<Department[]>(["hr", "departments"], "/hr/departments");
  const [open, setOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const addDept = useApiMutation<{ name: string }>("POST", "/hr/departments", { invalidate: [["hr"]], success: "Department added" });
  return (
    <ModulePage title="Employees" description="Bank account numbers are encrypted at rest; only HR payroll sees PAN and pay." permissions={["hr.view"]}
      actions={can("hr.manage") && <><Button size="sm" onClick={() => setDeptOpen(true)}><Plus /> Department</Button><Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> Employee</Button></>}>
      <div className="mb-4 flex flex-wrap gap-2">{depts.data?.map((d) => <span key={d.id} className="border-border bg-surface rounded-md border px-2.5 py-1 text-xs">{d.name} · {d.headcount}</span>)}</div>
      <Section flush>
        <SimpleTable label="Employees" rows={list.data} rowKey={(e) => e.id} href={(e) => `/people/${e.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No employees yet" description="Add your team; link each person to their login so they can mark attendance and apply for leave." />}
          columns={[
            { key: "n", header: "Name", cell: (e) => e.fullName },
            { key: "c", header: "Code", cell: (e) => <span className="text-fg-muted font-mono text-xs">{e.code}</span>, hideBelow: "sm" },
            { key: "d", header: "Designation", cell: (e) => e.designation, hideBelow: "sm" },
            { key: "p", header: "Department", cell: (e) => e.departmentName ?? "—", hideBelow: "md" },
            { key: "j", header: "Joined", cell: (e) => formatDate(e.dateOfJoining), hideBelow: "lg" },
            { key: "g", header: "Monthly gross", align: "right", cell: (e) => (e.monthlyGross ? <Money value={e.monthlyGross} /> : <span className="text-fg-subtle">—</span>), hideBelow: "md" },
            { key: "s", header: "", cell: (e) => e.status !== "active" && <StatusBadge status={e.status} /> },
          ]} />
      </Section>
      {open && <EmployeeDialog departments={depts.data ?? []} onClose={() => setOpen(false)} onSaved={(e) => router.push(`/people/${e.id}`)} />}
      <PromptDialog open={deptOpen} onOpenChange={setDeptOpen} title="New department" label="Name" confirmLabel="Add" busy={addDept.isPending} onSubmit={(name) => addDept.mutate({ name }, { onSuccess: () => setDeptOpen(false) })} />
    </ModulePage>
  );
}

function EmployeeDialog({ employee, departments, onClose, onSaved }: { employee?: Employee; departments: Department[]; onClose: () => void; onSaved: (e: Employee) => void }) {
  const [v, setV] = useState({
    fullName: employee?.fullName ?? "", workEmail: employee?.workEmail ?? "", phone: employee?.phone ?? "", departmentId: employee?.departmentId ?? "", designation: employee?.designation ?? "",
    dateOfJoining: employee?.dateOfJoining ?? today(), employmentType: employee?.employmentType ?? "full_time", workState: employee?.workState ?? "08", userId: employee?.userId ?? null as string | null,
    pan: "", uan: "", bankAccount: "", bankIfsc: employee?.bankIfsc ?? "",
  });
  const m = useApiMutation<object, Employee>(employee ? "PUT" : "POST", employee ? `/hr/employees/${employee.id}` : "/hr/employees", { invalidate: [["hr"]], success: "Saved" });
  const set = (k: string, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...v, departmentId: v.departmentId || null }, { onSuccess: (x) => { onSaved(x); onClose(); } }); }}>
          <DialogHeader><DialogTitle>{employee ? "Edit employee" : "New employee"}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Full name" htmlFor="ef" required className="sm:col-span-2"><Input id="ef" value={v.fullName} onChange={(e) => set("fullName", e.target.value)} /></Field>
            <Field label="Designation" htmlFor="eds" required><Input id="eds" value={v.designation} onChange={(e) => set("designation", e.target.value)} /></Field>
            <Field label="Department" htmlFor="edp"><NativeSelect id="edp" value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Field>
            <Field label="Date of joining" htmlFor="edj" required><Input id="edj" type="date" value={v.dateOfJoining} onChange={(e) => set("dateOfJoining", e.target.value)} /></Field>
            <Field label="Type" htmlFor="et"><NativeSelect id="et" value={v.employmentType} onChange={(e) => set("employmentType", e.target.value)}><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option><option value="intern">Intern</option></NativeSelect></Field>
            <Field label="Work email" htmlFor="ee"><Input id="ee" type="email" value={v.workEmail} onChange={(e) => set("workEmail", e.target.value)} /></Field>
            <Field label="Phone" htmlFor="ep"><Input id="ep" value={v.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Login account" htmlFor="eu" hint="Lets them use self-service"><UserSelect id="eu" allowEmpty emptyLabel="Not linked" value={v.userId} onChange={(u) => set("userId", u)} /></Field>
            <Field label="PAN" htmlFor="epan" hint={employee?.pan ? `On file: ${employee.pan}` : undefined}><Input id="epan" value={v.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
            <Field label="UAN (PF)" htmlFor="euan"><Input id="euan" inputMode="numeric" value={v.uan} onChange={(e) => set("uan", e.target.value)} /></Field>
            <Field label="Work state code" htmlFor="ews" hint="For professional tax"><Input id="ews" value={v.workState ?? ""} onChange={(e) => set("workState", e.target.value)} /></Field>
            <Field label="Bank account no." htmlFor="eba" hint={employee?.bankAccountMasked ? `On file: ${employee.bankAccountMasked}` : "Encrypted when saved"} className="sm:col-span-2"><Input id="eba" inputMode="numeric" autoComplete="off" value={v.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
            <Field label="IFSC" htmlFor="eif"><Input id="eif" value={v.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={v.fullName.length < 2 || v.designation.length < 2}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_COMPONENTS: SalaryComponent[] = [
  { code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", value: "" },
  { code: "HRA", name: "House rent allowance", kind: "earning", calc: "percent_of_basic", value: "40" },
  { code: "SPECIAL", name: "Special allowance", kind: "earning", calc: "fixed", value: "0" },
];

export function EmployeeDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const e = useApi<Employee>(["hr", "employee", id], `/hr/employees/${id}`);
  const depts = useApi<Department[]>(["hr", "departments"], "/hr/departments");
  const salary = useApi<SalaryStructure[]>(["hr", "salary", id], can("hr.payroll.manage") ? `/hr/employees/${id}/salary` : null);
  const [edit, setEdit] = useState(false);
  const [exit, setExit] = useState(false);
  const [sal, setSal] = useState(false);
  const exitM = useApiMutation<object>("POST", `/hr/employees/${id}/exit`, { invalidate: [["hr"]], success: "Exit recorded" });
  const x = e.data;
  return (
    <ModulePage title={x?.fullName ?? "Employee"} permissions={["hr.view", "hr.self_service"]} meta={x && <StatusBadge status={x.status} />} description={<BackLink href="/people">← Employees</BackLink>}
      actions={x && can("hr.manage") && x.status !== "exited" && <><Button size="sm" onClick={() => setEdit(true)}>Edit</Button><Button size="sm" variant="danger-ghost" onClick={() => setExit(true)}><UserMinus /> Record exit</Button></>}>
      {x && (
        <div className="space-y-5">
          <Section title="Profile"><KeyValues cols={4} items={[["Code", x.code], ["Designation", x.designation], ["Department", x.departmentName], ["Type", x.employmentType.replace("_", " ")], ["Joined", formatDate(x.dateOfJoining)], ["Exit", formatDate(x.dateOfExit)], ["Work email", x.workEmail], ["Phone", x.phone], ["PAN", x.pan], ["UAN", x.uan], ["Bank", x.bankAccountMasked ? `${x.bankAccountMasked} · ${x.bankIfsc ?? ""}` : "—"], ["Login linked", x.userId ? "Yes" : "No"]]} /></Section>
          {can("hr.payroll.manage") && (
            <Section title="Salary structure" description="Versions by effective date; payroll uses the one in force on the month end." actions={<Button size="sm" onClick={() => setSal(true)}><Plus /> New version</Button>} flush>
              <SimpleTable label="Salary versions" rows={salary.data} rowKey={(s) => s.id} loading={salary.isLoading} empty={<p className="text-fg-muted px-4 py-5 text-center text-[13px]">No salary structure — this person is skipped in payroll.</p>}
                columns={[{ key: "f", header: "Effective", cell: (s) => formatDate(s.effectiveFrom) }, { key: "c", header: "Components", cell: (s) => <span className="text-fg-muted text-xs">{s.components.map((c) => `${c.code} ${c.calc === "fixed" ? `₹${c.value}` : `${c.value}% of basic`}`).join(" · ")}</span> }, { key: "t", header: "TDS / month", align: "right", cell: (s) => <Money value={s.monthlyTds} muted />, hideBelow: "sm" }, { key: "g", header: "Monthly gross", align: "right", cell: (s) => <Money value={s.monthlyGross} /> }]} />
            </Section>
          )}
        </div>
      )}
      {edit && x && <EmployeeDialog employee={x} departments={depts.data ?? []} onClose={() => setEdit(false)} onSaved={() => {}} />}
      {sal && <SalaryDialog employeeId={id} current={salary.data?.[0]} onClose={() => setSal(false)} />}
      <PromptDialog open={exit} onOpenChange={setExit} title="Record exit" description="Last working day is today unless you change it after; payroll prorates the final month." label="Reason" confirmLabel="Record exit" destructive busy={exitM.isPending} onSubmit={(reason) => exitM.mutate({ reason, dateOfExit: today() }, { onSuccess: () => setExit(false) })} />
    </ModulePage>
  );
}

function SalaryDialog({ employeeId, current, onClose }: { employeeId: string; current?: SalaryStructure; onClose: () => void }) {
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [tds, setTds] = useState(current?.monthlyTds ?? "0");
  const [comps, setComps] = useState<SalaryComponent[]>(current?.components ?? DEFAULT_COMPONENTS);
  const m = useApiMutation("POST", `/hr/employees/${employeeId}/salary`, { invalidate: [["hr"]], success: "Salary structure saved" });
  const set = (i: number, k: keyof SalaryComponent, val: string) => setComps((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: val } : c)));
  const basic = Number(comps.find((c) => c.code === "BASIC")?.value || 0);
  const gross = comps.filter((c) => c.kind === "earning").reduce((s, c) => s + (c.calc === "fixed" ? Number(c.value || 0) : (basic * Number(c.value || 0)) / 100), 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ effectiveFrom: from, monthlyTds: tds || "0", components: comps }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>Salary structure</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Effective from" htmlFor="sf"><Input id="sf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Monthly TDS estimate (₹)" htmlFor="st" hint="From the employee's declared regime and investments"><Input id="st" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} /></Field>
            </div>
            {comps.map((c, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[100px_1fr_110px_150px_100px_auto]">
                <Input aria-label="Code" value={c.code} onChange={(e) => set(i, "code", e.target.value.toUpperCase())} disabled={c.code === "BASIC" && i === 0} />
                <Input aria-label="Name" value={c.name} onChange={(e) => set(i, "name", e.target.value)} />
                <NativeSelect aria-label="Kind" value={c.kind} onChange={(e) => set(i, "kind", e.target.value)}><option value="earning">Earning</option><option value="deduction">Deduction</option></NativeSelect>
                <NativeSelect aria-label="Calculation" value={c.calc} onChange={(e) => set(i, "calc", e.target.value)} disabled={c.code === "BASIC"}><option value="fixed">Fixed ₹/month</option><option value="percent_of_basic">% of basic</option></NativeSelect>
                <Input aria-label="Value" inputMode="decimal" value={c.value} onChange={(e) => set(i, "value", e.target.value)} />
                <Button type="button" size="icon-sm" variant="danger-ghost" aria-label="Remove" disabled={c.code === "BASIC"} onClick={() => setComps((cs) => cs.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button type="button" size="sm" onClick={() => setComps((cs) => [...cs, { code: "", name: "", kind: "earning", calc: "fixed", value: "0" }])}><Plus /> Component</Button>
              <p className="text-[13px]">Monthly gross ≈ <Money value={gross.toFixed(2)} className="font-semibold" /></p>
            </div>
            <p className="text-fg-muted text-xs">PF, ESI and professional tax are added by payroll from Settings → Payroll, so don&apos;t add them here.</p>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!basic}>Save version</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
