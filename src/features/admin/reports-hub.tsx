"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ChartCard, HorizontalBars } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { ModulePage, Money, Section, SimpleTable, humanize } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi } from "@/lib/api/hooks";
import { LEAD_SOURCES, stageMeta, type LeadStage } from "@/lib/api/contracts";
import { formatINR } from "@/lib/formatting";

interface Sales { wonByMonth: { month: string; n: number; value: string }[]; bySource: { source: string; total: number; won: number; lost: number }[]; quotations: { status: string; n: number; value: string }[]; pipeline: { stage: LeadStage; n: number; value: string }[] }

export function ReportsHub() {
  const { can } = useAuth();
  const sales = useApi<Sales>(["reports", "sales"], "/reports/sales");
  const hr = useApi<{ month: string; headcount: { department: string | null; n: number }[]; attendance: { status: string; n: number }[]; leaveDaysThisYear: { code: string; days: string }[] }>(["reports", "hr"], can("hr.view") ? "/reports/hr" : null);
  const support = useApi<{ last90Days: { priority: string; total: number; response_met: number; resolution_met: number; open: number }[] }>(["reports", "support"], can("support.view") || can("reports.view") ? "/reports/support" : null);
  const s = sales.data;
  return (
    <ModulePage title="Reports" description="Operational reports from live records. Finance statements are under Finance → Reports." permissions={["reports.view"]}
      actions={can("finance.view") && <Button asChild size="sm"><Link href="/finance/reports">Financial reports <ArrowRight /></Link></Button>}>
      <div className="grid gap-5 lg:grid-cols-2">
        {s && (
          <ChartCard title="Open pipeline by stage" description="Value of open leads" table={{ columns: ["Stage", "Leads", "Value"], rows: s.pipeline.map((p) => [stageMeta(p.stage).label, p.n, formatINR(p.value)]) }}>
            <HorizontalBars data={s.pipeline.map((p) => ({ key: p.stage, label: stageMeta(p.stage).label, value: Number(p.value), count: p.n }))} />
          </ChartCard>
        )}
        {s && (
          <Section title="Lead sources — conversion" flush>
            <SimpleTable label="Sources" rows={s.bySource} rowKey={(r) => r.source} columns={[
              { key: "s", header: "Source", cell: (r) => LEAD_SOURCES[r.source as keyof typeof LEAD_SOURCES] ?? r.source },
              { key: "t", header: "Leads", align: "right", cell: (r) => r.total },
              { key: "w", header: "Won", align: "right", cell: (r) => r.won },
              { key: "r", header: "Win rate", align: "right", cell: (r) => (r.won + r.lost ? `${Math.round((r.won / (r.won + r.lost)) * 100)}%` : "—") },
            ]} />
          </Section>
        )}
        {s && (
          <Section title="Quotations by status" flush>
            <SimpleTable label="Quotations" rows={s.quotations} rowKey={(r) => r.status} columns={[{ key: "s", header: "Status", cell: (r) => humanize(r.status) }, { key: "n", header: "Count", align: "right", cell: (r) => r.n }, { key: "v", header: "Value", align: "right", cell: (r) => <Money value={r.value} /> }]} />
          </Section>
        )}
        {support.data && (
          <Section title="Support SLA — last 90 days" flush>
            <SimpleTable label="SLA" rows={support.data.last90Days} rowKey={(r) => r.priority} empty={<p className="text-fg-muted px-4 py-5 text-[13px]">No tickets.</p>} columns={[
              { key: "p", header: "Priority", cell: (r) => humanize(r.priority) }, { key: "t", header: "Tickets", align: "right", cell: (r) => r.total },
              { key: "f", header: "Response met", align: "right", cell: (r) => `${r.total ? Math.round((r.response_met / r.total) * 100) : 0}%` },
              { key: "r", header: "Resolution met", align: "right", cell: (r) => `${r.total ? Math.round((r.resolution_met / r.total) * 100) : 0}%` }, { key: "o", header: "Open", align: "right", cell: (r) => r.open },
            ]} />
          </Section>
        )}
        {hr.data && (
          <Section title={`People — ${hr.data.month}`}>
            <div className="grid gap-4 sm:grid-cols-2 text-[13px]">
              <div><p className="text-fg-muted mb-1 text-xs">Headcount</p>{hr.data.headcount.map((h) => <p key={h.department ?? "-"} className="flex justify-between"><span>{h.department ?? "No department"}</span><span>{h.n}</span></p>)}</div>
              <div><p className="text-fg-muted mb-1 text-xs">Attendance days this month</p>{hr.data.attendance.map((a) => <p key={a.status} className="flex justify-between"><span>{humanize(a.status)}</span><span>{a.n}</span></p>)}</div>
            </div>
          </Section>
        )}
      </div>
    </ModulePage>
  );
}
