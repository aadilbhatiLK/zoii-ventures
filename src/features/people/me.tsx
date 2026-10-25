"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyValues, ModulePage, Money, Section, SimpleTable } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { ROLES } from "@/lib/permissions";
import { requiresMfa } from "@/lib/permissions";
import type { Employee, PayslipLine } from "@/lib/api/modules/people";
import { formatDate } from "@/lib/formatting";
import { PayslipDialog } from "./payroll";

type MySlip = { id: string; month: string; gross: string; netPay: string; totalDeductions: string; earnings: PayslipLine[]; deductions: PayslipLine[]; payableDays: string; workingDays: string };

export function MeView() {
  const { user } = useAuth();
  const emp = useApi<Employee | null>(["hr", "me"], "/hr/me");
  const slips = useApi<MySlip[]>(["payroll", "mine"], "/payroll/my-payslips");
  const [slip, setSlip] = useState<MySlip | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const change = useApiMutation<object>("POST", "/auth/password/change", { success: "Password changed" });
  return (
    <ModulePage title="My Profile" permissions={[]}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={user?.name ?? "Me"} description={user?.email}>
          <KeyValues cols={2} items={[["Roles", user?.roles.map((r) => ROLES[r]).join(", ")], ["Two-step verification", user?.mfaEnrolled ? <Badge key="m" tone="success"><ShieldCheck /> Enrolled</Badge> : requiresMfa(user) ? "Required — set up at next sign-in" : "Not required for your role"], ["Employee code", emp.data?.code], ["Designation", emp.data?.designation], ["Joined", formatDate(emp.data?.dateOfJoining)], ["Bank", emp.data?.bankAccountMasked]]} />
          <p className="mt-4 text-[13px]"><Link href="/people/attendance" className="text-accent hover:underline">Attendance & leave →</Link></p>
        </Section>
        <Section title="Change password">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (pw.newPassword !== pw.repeat) return; change.mutate({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }, { onSuccess: () => setPw({ currentPassword: "", newPassword: "", repeat: "" }) }); }}>
            <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password" htmlFor="np" hint="At least 10 characters"><Input id="np" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <Field label="Repeat" htmlFor="rp" error={pw.repeat && pw.repeat !== pw.newPassword ? "Doesn't match" : undefined}><Input id="rp" type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
            <Button type="submit" size="sm" variant="primary" loading={change.isPending} disabled={pw.newPassword.length < 10 || pw.newPassword !== pw.repeat}><KeyRound /> Update password</Button>
          </form>
        </Section>
      </div>
      <Section title="Payslips" flush className="mt-5">
        <SimpleTable label="My payslips" rows={slips.data} rowKey={(s) => s.id} onRowClick={setSlip} loading={slips.isLoading} empty={<p className="text-fg-muted px-4 py-5 text-center text-[13px]">Payslips appear after payroll is posted.</p>}
          columns={[{ key: "m", header: "Month", cell: (s) => s.month }, { key: "g", header: "Gross", align: "right", cell: (s) => <Money value={s.gross} /> }, { key: "d", header: "Deductions", align: "right", cell: (s) => <Money value={s.totalDeductions} muted /> }, { key: "n", header: "Net pay", align: "right", cell: (s) => <Money value={s.netPay} className="font-medium" /> }]} />
      </Section>
      {slip && <PayslipDialog slip={slip} month={slip.month} onClose={() => setSlip(null)} />}
    </ModulePage>
  );
}
