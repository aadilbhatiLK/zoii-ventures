"use client";

import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ModulePage, PromptDialog, Section, SimpleTable, StatusBadge, thisMonth } from "@/components/module/kit";
import { UserName } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { Period } from "@/lib/api/modules/finance";
import { formatDateTime } from "@/lib/formatting";

const prevMonth = () => { const [y, m] = thisMonth().split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

export function PeriodsView() {
  const { can } = useAuth();
  const periods = useApi<Period[]>(["finance", "periods"], "/finance/periods");
  const [month, setMonth] = useState(prevMonth());
  const checks = useApi<{ label: string; ok: boolean; detail: string }[]>(["finance", "checks", month], `/finance/periods/${month}/checks`);
  const close = useApiMutation<{ force?: boolean }>("POST", `/finance/periods/${month}/close`, { invalidate: [["finance"], ["approvals"]], success: `Close of ${month} sent for approval` });
  const [reopen, setReopen] = useState<string | null>(null);
  const reopenM = useApiMutation<{ month: string; reason: string }>("POST", (b) => `/finance/periods/${b.month}/reopen`, { invalidate: [["finance"], ["approvals"]], success: "Reopen sent for approval" });
  const blocked = checks.data?.some((c) => !c.ok);
  const selected = periods.data?.find((p) => p.month === month);
  const waiting = !!selected?.pending || selected?.status === "closed";
  return (
    <ModulePage title="Periods" description="Closing a month locks it: nothing can be posted with a date inside it — invoices, receipts, bills, payroll or journals. Closing and reopening each need a second person's approval (in Approvals); reopening also needs a reason."
      permissions={["finance.view"]}>
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Section title="Close a month">
          <Field label="Month" htmlFor="pm"><Input id="pm" type="month" value={month} max={prevMonth()} onChange={(e) => setMonth(e.target.value)} /></Field>
          <ul className="mt-4 space-y-2 text-[13px]">{checks.data?.map((c) => <li key={c.label} className="flex items-start gap-2"><StatusBadge status={c.ok ? "passed" : "pending"} label={c.ok ? "OK" : "Check"} /><span><span className="font-medium">{c.label}</span><span className="text-fg-muted"> — {c.detail}</span></span></li>)}</ul>
          {can("finance.period.close") && (
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="primary" disabled={blocked || waiting} loading={close.isPending} onClick={() => close.mutate({})}><Lock /> Request close of {month}</Button>
              {blocked && !waiting && <Button size="sm" variant="danger-ghost" loading={close.isPending} onClick={() => close.mutate({ force: true })}>Request close anyway</Button>}
            </div>
          )}
        </Section>
        <Section title="Periods" flush>
          <SimpleTable label="Periods" rows={periods.data} rowKey={(p) => p.month} loading={periods.isLoading}
            columns={[
              { key: "m", header: "Month", cell: (p) => p.month },
              { key: "s", header: "Status", cell: (p) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={p.status === "open" ? "active" : "closed"} label={p.status === "open" ? "Open" : "Closed"} />{p.pending && <StatusBadge status="pending" label={`${p.pending.action === "close" ? "Close" : "Reopen"} awaiting approval`} />}</div> },
              { key: "b", header: "Closed by", cell: (p) => (p.closedBy ? <><UserName id={p.closedBy} /> · {formatDateTime(p.closedAt)}</> : "—"), hideBelow: "sm" },
              { key: "x", header: "", align: "right", cell: (p) => p.status === "closed" && !p.pending && can("finance.period.close") && <Button size="xs" variant="ghost" onClick={() => setReopen(p.month)}><LockOpen /> Reopen</Button> },
            ]} />
        </Section>
      </div>
      <PromptDialog open={!!reopen} onOpenChange={(o) => !o && setReopen(null)} title={`Request reopening ${reopen}`} description="Someone else with period-close rights approves it in Approvals." label="Reason" placeholder="Vendor bill for October received late" confirmLabel="Request reopen" destructive busy={reopenM.isPending}
        onSubmit={(reason) => reopen && reopenM.mutate({ month: reopen, reason }, { onSuccess: () => setReopen(null) })} />
    </ModulePage>
  );
}
