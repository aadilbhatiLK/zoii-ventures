"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookCheck, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, Money, Section, SimpleTable, Stat, StatusBadge, thisMonth } from "@/components/module/kit";
import { UserName } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { Payslip, PayrollRun } from "@/lib/api/modules/people";
import { formatDateTime } from "@/lib/formatting";

export function PayrollView() {
  const router = useRouter();
  const { can } = useAuth();
  const runs = useApi<PayrollRun[]>(["payroll", "runs"], "/payroll/runs");
  const [month, setMonth] = useState(thisMonth());
  const prep = useApiMutation<{ month: string }, PayrollRun>("POST", "/payroll/runs", { invalidate: [["payroll"]], success: (r) => `Prepared ${r.month}: ${r.employeesCount} payslip(s)` });
  return (
    <ModulePage title="Payroll" description="HR prepares from attendance, leave and salary structures; a second person approves; finance posts the journal. Statutory rates come from Settings → Payroll — confirm them with your CA."
      permissions={["hr.payroll.manage", "finance.journal.post"]}
      actions={can("hr.payroll.manage") && <div className="flex items-end gap-2"><Field label="Month" htmlFor="pm"><Input id="pm" type="month" className="h-8" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Button size="sm" variant="primary" loading={prep.isPending} onClick={() => prep.mutate({ month }, { onSuccess: (r) => router.push(`/people/payroll/${r.id}`) })}><Play /> Prepare</Button></div>}>
      <Section flush>
        <SimpleTable label="Payroll runs" rows={runs.data} rowKey={(r) => r.id} href={(r) => `/people/payroll/${r.id}`} loading={runs.isLoading} error={runs.error}
          empty={<EmptyState title="No payroll runs yet" description="Prepare a month once attendance is complete." />}
          columns={[{ key: "m", header: "Month", cell: (r) => r.month }, { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> }, { key: "e", header: "Employees", align: "right", cell: (r) => r.employeesCount }, { key: "g", header: "Gross", align: "right", cell: (r) => <Money value={r.grossTotal} />, hideBelow: "sm" }, { key: "n", header: "Net pay", align: "right", cell: (r) => <Money value={r.netTotal} /> }, { key: "c", header: "Employer cost", align: "right", cell: (r) => <Money value={(Number(r.grossTotal) + Number(r.employerTotal)).toFixed(2)} muted />, hideBelow: "md" }]} />
      </Section>
    </ModulePage>
  );
}

export function PayrollRunDetail({ id }: { id: string }) {
  const { can, user } = useAuth();
  const run = useApi<PayrollRun>(["payroll", "run", id], `/payroll/runs/${id}`);
  const inv = { invalidate: [["payroll"], ["approvals"]] };
  const submit = useApiMutation("POST", `/payroll/runs/${id}/submit`, { ...inv, success: "Sent for approval" });
  const post = useApiMutation("POST", `/payroll/runs/${id}/post`, { ...inv, success: "Posted to the ledger" });
  const reprep = useApiMutation<{ month: string }>("POST", "/payroll/runs", { ...inv, success: "Recalculated" });
  const [slip, setSlip] = useState<Payslip | null>(null);
  const x = run.data;
  return (
    <ModulePage title={x ? `Payroll ${x.month}` : "Payroll run"} permissions={["hr.payroll.manage", "finance.journal.post"]} meta={x && <StatusBadge status={x.status} />} description={<BackLink href="/people/payroll">← All runs</BackLink>}
      actions={x && <>
        {x.status === "draft" && can("hr.payroll.manage") && <><Button size="sm" loading={reprep.isPending} onClick={() => reprep.mutate({ month: x.month })}>Recalculate</Button><Button size="sm" variant="primary" loading={submit.isPending} onClick={() => submit.mutate(undefined)}><Send /> Submit for approval</Button></>}
        {x.status === "approved" && can("finance.journal.post") && <Button size="sm" variant="primary" loading={post.isPending} onClick={() => post.mutate({})}><BookCheck /> Post to ledger</Button>}
      </>}>
      {x && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Gross" value={<Money value={x.grossTotal} />} /><Stat label="Deductions" value={<Money value={x.deductionsTotal} />} />
            <Stat label="Net pay" value={<Money value={x.netTotal} />} hint={`${x.employeesCount} employees`} /><Stat label="Employer contributions" value={<Money value={x.employerTotal} />} />
          </div>
          {x.warnings && x.warnings.length > 0 && <div className="border-warning/50 bg-warning-soft rounded-lg border p-3 text-[13px]"><p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4" /> Check before approving</p><ul className="text-fg-muted mt-1 list-disc pl-5">{x.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          <Section title="Approval trail"><KeyValues cols={3} items={[["Prepared", <span key="p"><UserName id={x.preparedBy} /> · {formatDateTime(x.preparedAt)}</span>], ["Approved", x.approvedBy ? <span key="a"><UserName id={x.approvedBy} /> · {formatDateTime(x.approvedAt)}</span> : x.status === "draft" ? "Not yet" : "Pending"], ["Posted", x.postedAt ? <span key="j">{formatDateTime(x.postedAt)} · <Link className="text-accent hover:underline" href={`/finance/ledger?entry=${x.journalEntryId}`}>journal</Link></span> : "—"]]} />
            {x.status === "draft" && x.preparedBy === user?.id && <p className="text-fg-muted mt-3 text-xs">You prepared this run, so someone else with payroll rights must approve it.</p>}
          </Section>
          <Section title="Payslips" flush>
            <SimpleTable label="Payslips" rows={x.payslips} rowKey={(p) => p.id} onRowClick={setSlip}
              columns={[{ key: "n", header: "Employee", cell: (p) => <div>{p.employeeName}<div className="text-fg-subtle text-xs">{p.employeeCode}</div></div> }, { key: "d", header: "Days", cell: (p) => `${Number(p.payableDays)}/${Number(p.workingDays)}${Number(p.lopDays) ? ` · LOP ${Number(p.lopDays)}` : ""}`, hideBelow: "sm" }, { key: "g", header: "Gross", align: "right", cell: (p) => <Money value={p.gross} /> }, { key: "x", header: "Deductions", align: "right", cell: (p) => <Money value={p.totalDeductions} muted />, hideBelow: "sm" }, { key: "t", header: "Net pay", align: "right", cell: (p) => <Money value={p.netPay} className="font-medium" /> }]} />
          </Section>
        </div>
      )}
      {slip && <PayslipDialog slip={slip} month={x?.month ?? ""} onClose={() => setSlip(null)} />}
    </ModulePage>
  );
}

export function PayslipDialog({ slip, month, onClose }: { slip: Pick<Payslip, "earnings" | "deductions" | "gross" | "totalDeductions" | "netPay" | "payableDays" | "workingDays"> & { employeeName?: string; employerContributions?: Payslip["employerContributions"] }; month: string; onClose: () => void }) {
  const list = (title: string, lines: { code: string; name: string; amount: string }[], total?: string) => (
    <div><p className="text-fg-muted mb-1 text-xs font-medium">{title}</p><dl className="space-y-1 text-[13px]">{lines.map((l) => <div key={l.code} className="flex justify-between"><dt>{l.name}</dt><dd><Money value={l.amount} /></dd></div>)}{total && <div className="border-border flex justify-between border-t pt-1 font-medium"><dt>Total</dt><dd><Money value={total} /></dd></div>}</dl></div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Payslip {month}{slip.employeeName ? ` — ${slip.employeeName}` : ""}</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-fg-muted text-xs">Paid days {Number(slip.payableDays)} of {Number(slip.workingDays)} working days</p>
          <div className="grid gap-5 sm:grid-cols-2">{list("Earnings", slip.earnings, slip.gross)}{list("Deductions", slip.deductions, slip.totalDeductions)}</div>
          {slip.employerContributions && slip.employerContributions.length > 0 && list("Employer contributions (not deducted)", slip.employerContributions)}
          <p className="bg-surface-2 flex justify-between rounded-md p-3 text-sm font-semibold"><span>Net pay</span><Money value={slip.netPay} /></p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
