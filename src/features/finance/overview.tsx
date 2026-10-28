"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ChartCard, RevenueLineChart } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModulePage, Money, Section, SimpleTable, Stat, StatusBadge, today } from "@/components/module/kit";
import { useAccounts } from "@/components/module/pickers";
import { useApi } from "@/lib/api/hooks";
import type { DashboardSummary } from "@/lib/api/contracts";
import type { AgeingRow, Invoice } from "@/lib/api/modules/finance";
import { formatDate, formatINR } from "@/lib/formatting";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export function FinanceOverview() {
  const ar = useApi<{ rows: AgeingRow[]; total: string }>(["report", "receivables", today()], `/reports/receivables-ageing`);
  const ap = useApi<{ rows: AgeingRow[]; total: string }>(["report", "payables", today()], `/reports/payables-ageing`);
  const overdue = useApi<Invoice[]>(["invoices", "overdue"], "/invoices?overdue=true");
  const accounts = useAccounts();
  const dash = useApi<DashboardSummary>(["dashboard", "finance"], "/dashboard/summary");
  const cash = (accounts.data ?? []).filter((a) => a.isBank).reduce((s, a) => s + Number(a.balance), 0);
  const overdueTotal = (overdue.data ?? []).reduce((s, i) => s + Number(i.outstanding), 0);
  const series = dash.data?.revenueSeries;
  return (
    <ModulePage title="Finance Overview" description="Live from the ledger." permissions={["finance.view"]}
      actions={<Button asChild size="sm"><Link href="/finance/reports">Reports <ArrowRight /></Link></Button>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cash & bank" value={<Money value={cash.toFixed(2)} />} hint="Book balance across bank/cash accounts" />
          <Stat label="Receivables" value={<Money value={ar.data?.total} />} hint={`${ar.data?.rows.length ?? 0} client(s)`} />
          <Stat label="Overdue" value={<Money value={overdueTotal.toFixed(2)} />} tone={overdueTotal > 0 ? "danger" : undefined} hint={`${overdue.data?.length ?? 0} invoice(s) past due`} />
          <Stat label="Payables" value={<Money value={ap.data?.total} />} hint="Owed to vendors (after TDS)" />
        </div>
        {series && (
          <ChartCard title="Invoiced vs collected" description="Last 12 months · invoiced before GST, collected as received" badge={<Badge tone="success">From the ledger</Badge>}
            table={{ columns: ["Month", "Invoiced", "Collected"], rows: series.points.map((p) => [monthLabel(p.month), formatINR(p.invoiced), formatINR(p.collected)]) }}>
            <RevenueLineChart data={series.points.map((p) => ({ month: p.month, label: monthLabel(p.month), invoiced: Number(p.invoiced), collected: Number(p.collected) }))} />
          </ChartCard>
        )}
        <Section title="Overdue invoices" flush actions={<Button asChild size="xs" variant="ghost"><Link href="/finance/invoices">All invoices</Link></Button>}>
          <SimpleTable label="Overdue invoices" rows={overdue.data} rowKey={(i) => i.id} href={(i) => `/finance/invoices/${i.id}`} loading={overdue.isLoading}
            empty={<p className="text-fg-muted px-4 py-6 text-center text-[13px]">Nothing overdue.</p>}
            columns={[{ key: "n", header: "Invoice", cell: (i) => <span className="font-mono text-xs">{i.number}</span> }, { key: "c", header: "Client", cell: (i) => i.clientName }, { key: "d", header: "Due", cell: (i) => <span className="text-danger">{formatDate(i.dueDate)}</span> }, { key: "s", header: "Status", cell: (i) => <StatusBadge status={i.status} />, hideBelow: "sm" }, { key: "o", header: "Outstanding", align: "right", cell: (i) => <Money value={i.outstanding} /> }]} />
        </Section>
      </div>
    </ModulePage>
  );
}
