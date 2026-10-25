"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatINR, formatINRCompact } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";

const AXIS = { fontSize: 11, fill: "var(--chart-axis)" };

/** Card wrapper that always offers a table view of the plotted numbers (accessibility). */
export function ChartCard({
  title,
  description,
  badge,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {badge}
          </div>
          {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="text-fg-muted hover:bg-surface-3 hover:text-fg inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs"
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? "Chart" : "Table"}
        </button>
      </CardHeader>
      <div className="min-h-0 flex-1 px-2 pb-3">
        {asTable ? (
          <div className="max-h-72 scrollbar-thin overflow-auto px-2">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-border text-fg-muted border-b text-xs">
                  {table.columns.map((c, i) => (
                    <th
                      key={c}
                      className={cn("py-1.5 font-medium", i === 0 ? "text-left" : "text-right")}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {table.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((v, i) => (
                      <td
                        key={i}
                        className={cn("tabular py-1.5", i === 0 ? "text-left" : "text-right")}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

function TooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="border-border bg-surface min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md">
      <p className="text-fg mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="text-fg-muted flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5">
            {r.color && <span className="h-0.5 w-3 rounded" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="text-fg tabular font-medium">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export interface RevenuePoint {
  month: string;
  label: string;
  invoiced: number;
  collected: number;
}

/** Two series on one axis (invoiced vs collected). Legend + end labels: identity is never colour-alone. */
export function RevenueLineChart({ data }: { data: RevenuePoint[] }) {
  const last = data[data.length - 1];
  const narrow = useMediaQuery("(max-width: 640px)");
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const endLabel = (key: "invoiced" | "collected", fill: string) =>
    function EndLabel(props: { x?: number | string; y?: number | string; index?: number }) {
      if (narrow || !last || props.index !== data.length - 1) return null;
      return (
        <text x={Number(props.x) + 8} y={Number(props.y) + 4} fontSize={11} fill={fill}>
          {formatINRCompact(last[key])}
        </text>
      );
    };
  return (
    <div className="h-64">
      <div className="text-fg-muted mb-1 flex items-center gap-4 px-2 text-xs" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[var(--chart-1)]" />
          Invoiced
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[var(--chart-2)]" />
          Collected
        </span>
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart
          data={data}
          margin={{ top: 8, right: narrow ? 12 : 56, bottom: 0, left: 0 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-grid)" }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => formatINRCompact(v)}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={String(label)}
                  rows={[
                    {
                      label: "Invoiced",
                      value: formatINR(
                        payload.find((p) => p.dataKey === "invoiced")?.value as number,
                      ),
                      color: "var(--chart-1)",
                    },
                    {
                      label: "Collected",
                      value: formatINR(
                        payload.find((p) => p.dataKey === "collected")?.value as number,
                      ),
                      color: "var(--chart-2)",
                    },
                  ]}
                />
              ) : null
            }
          />
          <Line
            type="monotone"
            dataKey="invoiced"
            isAnimationActive={!calm}
            name="Invoiced"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            label={endLabel("invoiced", "var(--fg)")}
          />
          <Line
            type="monotone"
            dataKey="collected"
            isAnimationActive={!calm}
            name="Collected"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            label={endLabel("collected", "var(--fg-muted)")}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  count: number;
}

/** Single-series horizontal bars; values labelled at the bar end, so no legend is needed. */
export function HorizontalBars({
  data,
  height,
  valueLabel = "Value",
}: {
  data: BarDatum[];
  height?: number;
  valueLabel?: string;
}) {
  const narrow = useMediaQuery("(max-width: 640px)");
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const h = height ?? Math.max(160, data.length * 34 + 16);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: narrow ? 64 : 84, bottom: 4, left: 0 }}
          barCategoryGap={8}
          accessibilityLayer
        >
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ ...AXIS, fontSize: narrow ? 10 : 11 }}
            tickLine={false}
            axisLine={false}
            width={narrow ? 92 : 140}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-3)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as BarDatum | undefined;
              return active && d ? (
                <TooltipBox
                  title={d.label}
                  rows={[
                    { label: valueLabel, value: formatINR(d.value) },
                    { label: "Leads", value: String(d.count) },
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={!calm}>
            <LabelList
              dataKey="value"
              content={({ x, y, width, height: bh, index }) => {
                const d = data[index as number];
                if (!d) return null;
                return (
                  <text
                    x={Number(x) + Number(width) + 6}
                    y={Number(y) + Number(bh) / 2 + 4}
                    fontSize={11}
                    fill="var(--fg-muted)"
                  >
                    {formatINRCompact(d.value)} · {d.count}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
