"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Landmark,
  Percent,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { getRuntime } from "@/lib/api";
import { PRODUCT_LINES, stageMeta, type DashboardSummary } from "@/lib/api/contracts";
import { userMessage } from "@/lib/api/errors";
import { leadScope } from "@/lib/permissions";
import { formatINR, formatINRCompact, formatPercent } from "@/lib/formatting";
import { PageHeader } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, UserAvatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DemoTag, EmptyState, ErrorState } from "@/components/feedback/states";
import { ChartCard, HorizontalBars, RevenueLineChart } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/auth-provider";
import { useLeadList, useUserDirectory } from "@/features/leads/hooks";
import { FollowUpCell, StageBadge } from "@/features/leads/lead-meta";
import { cn } from "@/lib/utils";

function Kpi({
  label,
  value,
  sub,
  icon,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  tone?: "danger" | "warning";
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        "border-border bg-surface flex h-full flex-col rounded-lg border p-3.5 shadow-xs transition-colors",
        href && "hover:border-border-strong",
        tone === "danger" && "border-danger/30",
      )}
    >
      <div className="text-fg-muted flex items-center justify-between gap-2 text-xs">
        <span>{label}</span>
        <span
          className={cn(
            "[&_svg]:size-3.5",
            tone === "danger"
              ? "text-danger"
              : tone === "warning"
                ? "text-warning"
                : "text-fg-subtle",
          )}
        >
          {icon}
        </span>
      </div>
      <p
        className={cn(
          "font-display tabular mt-1.5 text-[22px] leading-none font-semibold",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-fg-subtle mt-1.5 text-xs">{sub}</p>}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="focus-visible:ring-ring block rounded-lg outline-none focus-visible:ring-2"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

export function DashboardView() {
  const { user } = useAuth();
  const scope = leadScope(user);
  const summary = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => getRuntime().api.dashboard.summary(),
  });
  const directory = useUserDirectory();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.name.split(" ")[0] ?? "";

  const header = (
    <PageHeader
      title={`${greeting}, ${firstName}`}
      description={
        summary.data
          ? summary.data.scope === "company"
            ? "Company-wide view across every product line."
            : summary.data.scope === "team"
              ? "Your team's pipeline and follow-ups."
              : "Your pipeline and today's follow-ups."
          : " "
      }
      meta={summary.data?.dataOrigin === "demo" ? <DemoTag /> : undefined}
    />
  );

  if (summary.isLoading)
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  if (summary.isError || !summary.data)
    return (
      <>
        {header}
        <ErrorState message={userMessage(summary.error)} onRetry={() => void summary.refetch()} />
      </>
    );
  const s = summary.data;

  if (scope === "none")
    return (
      <>
        {header}
        <NonSalesDashboard summary={s} />
      </>
    );

  const stageData = s.pipeline.byStage
    .filter((x) => x.stage !== "won" && x.stage !== "lost")
    .map((x) => ({
      key: x.stage,
      label: stageMeta(x.stage).label,
      value: Number(x.value),
      count: x.count,
    }));
  const productData = s.pipeline.byProductLine.map((x) => ({
    key: x.productLine,
    label: PRODUCT_LINES[x.productLine],
    value: Number(x.value),
    count: x.count,
  }));

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Open pipeline"
          value={formatINRCompact(s.pipeline.openValue)}
          sub={`${s.pipeline.openCount} open leads`}
          icon={<Target />}
          href="/pipeline"
        />
        <Kpi
          label="Weighted forecast"
          value={formatINRCompact(s.pipeline.weightedValue)}
          sub="Value × stage probability"
          icon={<TrendingUp />}
        />
        <Kpi
          label="Won this month"
          value={formatINRCompact(s.wonThisMonth.value)}
          sub={`${s.wonThisMonth.count} deals`}
          icon={<Trophy />}
        />
        <Kpi
          label="Win rate (90 days)"
          value={formatPercent(s.conversion.rate, 0)}
          sub={`${s.conversion.won90d} won · ${s.conversion.lost90d} lost`}
          icon={<Percent />}
        />
        <Kpi
          label="Overdue follow-ups"
          value={String(s.followUps.overdue)}
          sub="Clear these first"
          icon={<AlarmClock />}
          tone={s.followUps.overdue > 0 ? "danger" : undefined}
          href="/follow-ups"
        />
        <Kpi
          label="Due today"
          value={String(s.followUps.dueToday)}
          sub="Follow-ups scheduled"
          icon={<CalendarClock />}
          tone={s.followUps.dueToday > 0 ? "warning" : undefined}
          href="/follow-ups"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {s.revenueSeries ? (
          <ChartCard
            className="lg:col-span-2"
            title="Invoiced vs collected"
            description={s.revenueSeries.origin === "fixture" ? "Last 12 months, before GST" : "Last 12 months · invoiced before GST, collected as received"}
            badge={
              s.revenueSeries.origin === "fixture" ? <DemoTag label="Demo fixture" /> : <Badge tone="success">From the ledger</Badge>
            }
            table={{
              columns: ["Month", "Invoiced", "Collected"],
              rows: s.revenueSeries.points.map((p) => [
                monthLabel(p.month),
                formatINR(p.invoiced),
                formatINR(p.collected),
              ]),
            }}
          >
            <RevenueLineChart
              data={s.revenueSeries.points.map((p) => ({
                month: p.month,
                label: monthLabel(p.month),
                invoiced: Number(p.invoiced),
                collected: Number(p.collected),
              }))}
            />
          </ChartCard>
        ) : (
          <ChartCard
            className="lg:col-span-2"
            title="Open pipeline by stage"
            description="Value of open leads in each stage"
            table={{
              columns: ["Stage", "Value", "Leads"],
              rows: stageData.map((d) => [d.label, formatINR(d.value), d.count]),
            }}
          >
            <HorizontalBars data={stageData} />
          </ChartCard>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{s.scope === "own" ? "My results" : "Sales leaderboard"}</CardTitle>
            <span className="text-fg-subtle text-xs">Won value</span>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1">
              {s.ownerLeaderboard.slice(0, 6).map((o, i) => {
                const u = directory.byId.get(o.ownerId);
                return (
                  <li key={o.ownerId} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                    <span className="text-fg-subtle tabular w-4 text-xs">{i + 1}</span>
                    {u && <UserAvatar name={u.name} hue={u.avatarHue} size={26} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{u?.name ?? o.ownerId}</p>
                      <p className="text-fg-subtle text-xs">
                        {o.won} won · {o.open} open
                      </p>
                    </div>
                    <span className="tabular text-[13px] font-semibold">
                      {formatINRCompact(o.wonValue)}
                    </span>
                  </li>
                );
              })}
              {s.ownerLeaderboard.length === 0 && (
                <p className="text-fg-muted py-6 text-center text-[13px]">No leads yet.</p>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {s.revenueSeries && (
          <ChartCard
            title="Open pipeline by stage"
            description="Value · lead count"
            table={{
              columns: ["Stage", "Value", "Leads"],
              rows: stageData.map((d) => [d.label, formatINR(d.value), d.count]),
            }}
          >
            <HorizontalBars data={stageData} height={330} />
          </ChartCard>
        )}
        <ChartCard
          title="Open pipeline by product line"
          description="Value · lead count · multi-product leads split evenly"
          table={{
            columns: ["Product line", "Value", "Leads"],
            rows: productData.map((d) => [d.label, formatINR(d.value), d.count]),
          }}
        >
          {productData.length ? (
            <HorizontalBars data={productData} height={330} />
          ) : (
            <EmptyState title="No open pipeline" />
          )}
        </ChartCard>
        {!s.revenueSeries && <UpcomingFollowUps />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {s.revenueSeries && <UpcomingFollowUps />}
        <Card className={s.revenueSeries ? "lg:col-span-1" : "lg:col-span-3"}>
          <CardHeader>
            <div>
              <CardTitle>On their own pages</CardTitle>
              <p className="text-fg-muted mt-0.5 text-xs">
                These modules are live, but this dashboard doesn&apos;t summarise them yet.
              </p>
            </div>
          </CardHeader>
          <CardContent
            className={cn("grid gap-2 sm:grid-cols-2", !s.revenueSeries && "lg:grid-cols-4")}
          >
            {[
              { icon: <BadgeCheck />, t: "Pending approvals", d: "Quotations, documents, payroll, leave", href: "/approvals" },
              { icon: <Users />, t: "Project delivery", d: "Projects, milestones and tasks", href: "/projects" },
              { icon: <Wallet />, t: "Receivables & collections", d: "Ageing and overdue invoices", href: "/finance" },
              { icon: <Landmark />, t: "Profit & loss", d: "Financial reports from the ledger", href: "/finance/reports" },
            ].map((x) => (
              <Link
                key={x.t}
                href={x.href}
                className="border-border hover:bg-surface-muted flex items-start gap-2.5 rounded-md border p-3"
              >
                <span className="text-fg-subtle [&_svg]:size-4">{x.icon}</span>
                <div>
                  <p className="text-[13px] font-medium">{x.t}</p>
                  <p className="text-fg-subtle text-xs">{x.d}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UpcomingFollowUps() {
  const { user } = useAuth();
  const list = useLeadList({
    view: "open",
    ownerId: user ? [user.id] : undefined,
    pageSize: 10,
    sort: { field: "nextFollowUpAt", dir: "asc" },
  });
  const rows = (list.data?.items ?? []).filter((l) => l.nextFollowUpAt).slice(0, 6);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>My next follow-ups</CardTitle>
        <Button asChild size="xs" variant="ghost">
          <Link href="/follow-ups">
            All <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-fg-muted py-6 text-center text-[13px]">Nothing scheduled for you.</p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/leads/${l.id}`}
                    className="hover:text-accent block truncate text-[13px] font-medium"
                  >
                    {l.company ?? l.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs">
                    <StageBadge stage={l.stage} />
                  </div>
                </div>
                <span className="shrink-0 text-xs">
                  <FollowUpCell at={l.nextFollowUpAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function NonSalesDashboard({ summary }: { summary: DashboardSummary }) {
  const { user } = useAuth();
  const role = user?.roles[0];
  type Ln = { label: string; href: string };
  const modules: Record<string, { title: string; links: Ln[] }> = {
    finance_manager: {
      title: "Finance workspace",
      links: [
        { label: "Receivables & payables", href: "/finance" },
        { label: "GST summary", href: "/finance/reports" },
        { label: "Bank reconciliation", href: "/finance/banking" },
        { label: "Approvals", href: "/approvals" },
      ],
    },
    accountant: {
      title: "Accounts workspace",
      links: [
        { label: "Invoices", href: "/finance/invoices" },
        { label: "Receipts", href: "/finance/receipts" },
        { label: "Bank lines", href: "/finance/banking" },
      ],
    },
    project_manager: {
      title: "Delivery workspace",
      links: [
        { label: "Projects & milestones", href: "/projects" },
        { label: "Tasks", href: "/tasks" },
        { label: "Approvals", href: "/approvals" },
      ],
    },
    hr_manager: {
      title: "People workspace",
      links: [
        { label: "Employees", href: "/people" },
        { label: "Attendance & leave", href: "/people/attendance" },
        { label: "Payroll", href: "/people/payroll" },
      ],
    },
  };
  const m = (role && modules[role]) ?? {
    title: "Your workspace",
    links: [
      { label: "My tasks", href: "/tasks" },
      { label: "My profile", href: "/me" },
    ],
  };
  return (
    <div className="space-y-4">
      {summary.revenueSeries && (
        <ChartCard
          title="Invoiced vs collected"
          description="Last 12 months, before GST"
          badge={
            summary.revenueSeries.origin === "fixture" ? <DemoTag label="Demo fixture" /> : <Badge tone="success">From the ledger</Badge>
          }
          table={{
            columns: ["Month", "Invoiced", "Collected"],
            rows: summary.revenueSeries.points.map((p) => [
              monthLabel(p.month),
              formatINR(p.invoiced),
              formatINR(p.collected),
            ]),
          }}
        >
          <RevenueLineChart
            data={summary.revenueSeries.points.map((p) => ({
              month: p.month,
              label: monthLabel(p.month),
              invoiced: Number(p.invoiced),
              collected: Number(p.collected),
            }))}
          />
        </ChartCard>
      )}
      <Card>
        <EmptyState
          icon={<CalendarClock />}
          title={m.title}
          description="This dashboard doesn't summarise your work yet. Open it where it lives:"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {m.links.map((l) => (
                <Button key={l.href} size="sm" asChild>
                  <Link href={l.href}>{l.label}</Link>
                </Button>
              ))}
            </div>
          }
        />
      </Card>
    </div>
  );
}
