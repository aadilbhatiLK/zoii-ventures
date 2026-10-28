"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, PromptDialog, Section, SimpleTable, StatusBadge, humanize } from "@/components/module/kit";
import { UserName } from "@/components/module/pickers";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { ApprovalRequest } from "@/lib/api/modules/sales";
import { formatRelative } from "@/lib/formatting";

/** Every list an approval can change (prefix match): leave lives under ["hr", …]. */
export const APPROVAL_INVALIDATES = [["approvals"], ["quotation"], ["quotations"], ["document"], ["documents"], ["project"], ["projects"], ["payroll"], ["hr", "leave"], ["hr", "balances"], ["finance"], ["notifications"]];

export function ApprovalsView() {
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const q = useApi<ApprovalRequest[]>(["approvals", tab], `/approvals?status=${tab}`);
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);
  const decide = useApiMutation<{ id: string; decision: "approve" | "reject"; note?: string }>("POST", (b) => `/approvals/${b.id}/decide`, {
    invalidate: APPROVAL_INVALIDATES,
    success: "Decision recorded",
  });
  const mine = (q.data ?? []).filter((x) => !x.canDecide);
  const toDecide = (q.data ?? []).filter((x) => x.canDecide);
  return (
    <ModulePage title="Approvals" description="Maker-checker inbox. You never approve your own request; every decision is audited." permissions={[]}
      actions={<Segmented label="Show" value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "pending", label: "Pending" }, { value: "decided", label: "Decided" }]} />}>
      <div className="space-y-5">
        {tab === "pending" && (
          <Section title="Waiting for you" flush>
            <SimpleTable
              label="Approvals waiting for you" rows={toDecide} rowKey={(r) => r.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
              empty={<EmptyState icon={<CheckCircle2 />} title="All caught up" description="Nothing needs your decision." />}
              columns={[
                { key: "t", header: "Request", cell: (r) => <Link href={r.href} className="font-medium hover:underline">{r.title}</Link> },
                { key: "k", header: "Type", cell: (r) => humanize(r.entityType), hideBelow: "md" },
                { key: "r", header: "Why", cell: (r) => <span className="text-fg-muted">{r.reason}</span>, hideBelow: "lg" },
                { key: "by", header: "Requested", cell: (r) => <span className="text-fg-muted"><UserName id={r.requestedBy} /> · {formatRelative(r.requestedAt)}</span>, hideBelow: "sm" },
                { key: "a", header: "", align: "right", cell: (r) => (
                  <div className="flex justify-end gap-1.5">
                    <Button size="xs" variant="danger-ghost" onClick={() => setRejecting(r)}>Reject</Button>
                    <Button size="xs" variant="primary" loading={decide.isPending && decide.variables?.id === r.id} onClick={() => decide.mutate({ id: r.id, decision: "approve" })}>Approve</Button>
                  </div>
                ) },
              ]}
            />
          </Section>
        )}
        <Section title={tab === "pending" ? "Your requests awaiting others" : "Decided"} flush>
          <SimpleTable
            label="Requests" rows={tab === "pending" ? mine : q.data} rowKey={(r) => r.id} loading={q.isLoading}
            empty={<EmptyState title={tab === "pending" ? "Nothing pending from you" : "No decisions yet"} />}
            columns={[
              { key: "t", header: "Request", cell: (r) => <Link href={r.href} className="hover:underline">{r.title}</Link> },
              { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
              { key: "d", header: tab === "pending" ? "Requested" : "Decided by", cell: (r) => <span className="text-fg-muted">{tab === "pending" ? formatRelative(r.requestedAt) : <><UserName id={r.decidedBy} />{r.decisionNote ? ` — “${r.decisionNote}”` : ""}</>}</span> },
            ]}
          />
        </Section>
      </div>
      <PromptDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title={`Reject: ${rejecting?.title ?? ""}`} label="Reason" multiline confirmLabel="Reject" destructive busy={decide.isPending}
        onSubmit={(note) => rejecting && decide.mutate({ id: rejecting.id, decision: "reject", note }, { onSuccess: () => setRejecting(null) })} />
    </ModulePage>
  );
}
