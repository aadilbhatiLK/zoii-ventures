"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { ModulePage, Money, Section, SimpleTable, Stat, Tag, thisMonth, today } from "@/components/module/kit";
import { useApi } from "@/lib/api/hooks";
import type { AgeingRow, GstSummary, ReportRow } from "@/lib/api/modules/finance";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/formatting";

const fyStart = () => { const d = today(); const y = Number(d.slice(0, 4)); return Number(d.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`; };

function Csv({ name, header, rows }: { name: string; header: string[]; rows: string[][] }) {
  return <Button size="sm" variant="ghost" onClick={() => downloadCsv(`${name}.csv`, toCsv(header, rows, `Zoii Business OS · ${name} · generated ${new Date().toLocaleString("en-IN")}`))}><Download /> CSV</Button>;
}

export function FinanceReportsView() {
  const [tab, setTab] = useState("pl");
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(today());
  return (
    <ModulePage title="Financial Reports" description="Every figure is computed from posted journal lines; drafts never appear. GST figures are working papers for your CA, not a return."
      permissions={["finance.view", "reports.view"]}
      actions={<div className="flex items-end gap-2"><Field label="From" htmlFor="rf"><Input id="rf" type="date" className="h-8" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To / as of" htmlFor="rt"><Input id="rt" type="date" className="h-8" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pl">Profit & loss</TabsTrigger><TabsTrigger value="bs">Balance sheet</TabsTrigger><TabsTrigger value="cf">Cash flow</TabsTrigger>
          <TabsTrigger value="tb">Trial balance</TabsTrigger><TabsTrigger value="ar">Receivables ageing</TabsTrigger><TabsTrigger value="ap">Payables ageing</TabsTrigger><TabsTrigger value="gst">GST summary</TabsTrigger>
        </TabsList>
        <TabsContent value="pl" className="pt-4"><ProfitLoss from={from} to={to} /></TabsContent>
        <TabsContent value="bs" className="pt-4"><BalanceSheet asOf={to} /></TabsContent>
        <TabsContent value="cf" className="pt-4"><CashFlow from={from} to={to} /></TabsContent>
        <TabsContent value="tb" className="pt-4"><TrialBalance asOf={to} /></TabsContent>
        <TabsContent value="ar" className="pt-4"><Ageing kind="receivables" asOf={to} /></TabsContent>
        <TabsContent value="ap" className="pt-4"><Ageing kind="payables" asOf={to} /></TabsContent>
        <TabsContent value="gst" className="pt-4"><Gst /></TabsContent>
      </Tabs>
    </ModulePage>
  );
}

const rowsTable = (label: string, rows: ReportRow[] | undefined) => (
  <SimpleTable label={label} rows={rows} rowKey={(r) => r.accountId} empty={<p className="text-fg-muted px-4 py-3 text-[13px]">No postings.</p>}
    columns={[{ key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> }, { key: "n", header: "Account", cell: (r) => r.name }, { key: "b", header: "Amount", align: "right", cell: (r) => <Money value={r.balance} /> }]} />
);

function ProfitLoss({ from, to }: { from: string; to: string }) {
  const q = useApi<{ income: ReportRow[]; expense: ReportRow[]; totalIncome: string; totalExpense: string; netProfit: string }>(["report", "pl", from, to], `/reports/profit-and-loss?from=${from}&to=${to}`);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Income" value={<Money value={d?.totalIncome} />} /><Stat label="Expenses" value={<Money value={d?.totalExpense} />} />
        <Stat label={Number(d?.netProfit) < 0 ? "Net loss" : "Net profit"} value={<Money value={d?.netProfit} />} tone={Number(d?.netProfit) < 0 ? "danger" : "success"} hint={`${formatDate(from)} – ${formatDate(to)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Income" flush actions={d && <Csv name={`P&L ${from} to ${to}`} header={["Section", "Code", "Account", "Amount"]} rows={[...d.income.map((r) => ["Income", r.code, r.name, r.balance]), ...d.expense.map((r) => ["Expense", r.code, r.name, r.balance]), ["", "", "Net profit", d.netProfit]]} />}>{rowsTable("Income", d?.income)}</Section>
        <Section title="Expenses" flush>{rowsTable("Expenses", d?.expense)}</Section>
      </div>
    </div>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const q = useApi<{ assets: ReportRow[]; liabilities: ReportRow[]; equity: ReportRow[]; currentEarnings: string; totalAssets: string; totalLiabilities: string; totalEquity: string; balanced: boolean }>(["report", "bs", asOf], `/reports/balance-sheet?asOf=${asOf}`);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Assets" value={<Money value={d?.totalAssets} />} /><Stat label="Liabilities" value={<Money value={d?.totalLiabilities} />} />
        <Stat label="Equity (incl. current earnings)" value={<Money value={d?.totalEquity} />} hint={d ? (d.balanced ? "Balances ✓" : "Does not balance — investigate") : undefined} tone={d && !d.balanced ? "danger" : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Assets" flush>{rowsTable("Assets", d?.assets)}</Section>
        <div className="space-y-4">
          <Section title="Liabilities" flush>{rowsTable("Liabilities", d?.liabilities)}</Section>
          <Section title="Equity" flush>{rowsTable("Equity", d?.equity)}<p className="flex justify-between px-4 py-2 text-[13px]"><span className="text-fg-muted">Current period earnings (not yet closed to retained earnings)</span><Money value={d?.currentEarnings} /></p></Section>
        </div>
      </div>
    </div>
  );
}

function CashFlow({ from, to }: { from: string; to: string }) {
  const q = useApi<{ opening: string; lines: { category: string; inflow: string; outflow: string; net: string }[]; netChange: string; closing: string }>(["report", "cf", from, to], `/reports/cash-flow?from=${from}&to=${to}`);
  const d = q.data;
  return (
    <Section title="Cash flow (direct method, bank & cash accounts)" flush description="Transfers between your own bank and cash accounts are excluded.">
      <SimpleTable label="Cash flow" rows={d?.lines} rowKey={(l) => l.category} loading={q.isLoading}
        columns={[{ key: "c", header: "Category", cell: (l) => l.category }, { key: "i", header: "In", align: "right", cell: (l) => <Money value={l.inflow} /> }, { key: "o", header: "Out", align: "right", cell: (l) => <Money value={l.outflow} /> }, { key: "n", header: "Net", align: "right", cell: (l) => <Money value={l.net} /> }]} />
      {d && <dl className="ml-auto max-w-xs space-y-1 px-4 py-3 text-[13px]"><div className="flex justify-between"><dt className="text-fg-muted">Opening</dt><dd><Money value={d.opening} /></dd></div><div className="flex justify-between"><dt className="text-fg-muted">Net change</dt><dd><Money value={d.netChange} /></dd></div><div className="border-border flex justify-between border-t pt-1 font-semibold"><dt>Closing</dt><dd><Money value={d.closing} /></dd></div></dl>}
    </Section>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const q = useApi<{ rows: ReportRow[]; totals: { debit: string; credit: string; balanced: boolean } }>(["report", "tb", asOf], `/reports/trial-balance?asOf=${asOf}`);
  const d = q.data;
  return (
    <Section title={`Trial balance as of ${formatDate(asOf)}`} flush actions={d && <><Tag tone={d.totals.balanced ? "success" : "danger"}>{d.totals.balanced ? "Balanced" : "Out of balance"}</Tag><Csv name={`Trial balance ${asOf}`} header={["Code", "Account", "Debit", "Credit"]} rows={d.rows.map((r) => [r.code, r.name, r.debit, r.credit])} /></>}>
      <SimpleTable label="Trial balance" rows={d?.rows} rowKey={(r) => r.accountId} loading={q.isLoading}
        columns={[{ key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> }, { key: "n", header: "Account", cell: (r) => r.name }, { key: "d", header: "Debit", align: "right", cell: (r) => (r.debit !== "0.00" ? <Money value={r.debit} /> : "") }, { key: "k", header: "Credit", align: "right", cell: (r) => (r.credit !== "0.00" ? <Money value={r.credit} /> : "") }]}
        footer={d && <tr><td className="px-4 py-2" colSpan={2}>Total</td><td className="px-4 py-2 text-right"><Money value={d.totals.debit} /></td><td className="px-4 py-2 text-right"><Money value={d.totals.credit} /></td></tr>} />
    </Section>
  );
}

function Ageing({ kind, asOf }: { kind: "receivables" | "payables"; asOf: string }) {
  const q = useApi<{ rows: AgeingRow[]; total: string }>(["report", kind, asOf], `/reports/${kind}-ageing?asOf=${asOf}`);
  const d = q.data;
  const cols = [["current", "Not due"], ["d1_30", "1–30"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"]] as const;
  return (
    <Section title={`${kind === "receivables" ? "Receivables" : "Payables"} ageing as of ${formatDate(asOf)}`} description="Days past due date. Payments and credit notes dated after the as-of date are ignored." flush
      actions={d && <Csv name={`${kind} ageing ${asOf}`} header={["Party", ...cols.map((c) => c[1]), "Total"]} rows={d.rows.map((r) => [r.partyName, ...cols.map((c) => r[c[0]]), r.total])} />}>
      <SimpleTable label="Ageing" rows={d?.rows} rowKey={(r) => r.partyId} loading={q.isLoading} empty={<p className="text-fg-muted px-4 py-6 text-center text-[13px]">Nothing outstanding.</p>}
        columns={[{ key: "p", header: kind === "receivables" ? "Client" : "Vendor", cell: (r) => r.partyName }, ...cols.map(([k, h]) => ({ key: k, header: h, align: "right" as const, cell: (r: AgeingRow) => (r[k] !== "0.00" ? <Money value={r[k]} className={k === "d90_plus" ? "text-danger" : undefined} /> : <span className="text-fg-subtle">—</span>) })), { key: "t", header: "Total", align: "right", cell: (r) => <Money value={r.total} className="font-medium" /> }]} />
      {d && <p className="px-4 py-3 text-right text-[13px] font-semibold">Total <Money value={d.total} /></p>}
    </Section>
  );
}

function Gst() {
  const [month, setMonth] = useState(thisMonth());
  const q = useApi<GstSummary>(["report", "gst", month], `/reports/gst-summary?month=${month}`);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Month" htmlFor="gm"><Input id="gm" type="month" className="h-8 w-44" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        {d && <p className="text-fg-muted max-w-xl text-xs">{d.basis}</p>}
      </div>
      {d && <>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Output tax" value={<Money value={(Number(d.outputTotal.cgst) + Number(d.outputTotal.sgst) + Number(d.outputTotal.igst)).toFixed(2)} />} hint={`on ₹${d.outputTotal.taxable} taxable`} />
          <Stat label="Credit notes" value={<Money value={(Number(d.creditNotes.cgst) + Number(d.creditNotes.sgst) + Number(d.creditNotes.igst)).toFixed(2)} />} />
          <Stat label="Input tax credit" value={<Money value={(Number(d.input.cgst) + Number(d.input.sgst) + Number(d.input.igst)).toFixed(2)} />} hint={Number(d.input.ineligible) ? `₹${d.input.ineligible} not claimable` : undefined} />
          <Stat label="Net payable (estimate)" value={<Money value={d.netPayable.total} />} hint={`CGST ${d.netPayable.cgst} · SGST ${d.netPayable.sgst} · IGST ${d.netPayable.igst}`} />
        </div>
        <Section title="Outward supplies by rate" flush actions={<Csv name={`GST ${month}`} header={["Rate", "Taxable", "CGST", "SGST", "IGST"]} rows={d.output.map((r) => [r.rate, r.taxable, r.cgst, r.sgst, r.igst])} />}>
          <SimpleTable label="Output by rate" rows={d.output} rowKey={(r) => r.rate} empty={<p className="text-fg-muted px-4 py-4 text-[13px]">No invoices issued in this month.</p>}
            columns={[{ key: "r", header: "Rate", cell: (r) => `${Number(r.rate)}%` }, { key: "t", header: "Taxable", align: "right", cell: (r) => <Money value={r.taxable} /> }, { key: "c", header: "CGST", align: "right", cell: (r) => <Money value={r.cgst} /> }, { key: "s", header: "SGST", align: "right", cell: (r) => <Money value={r.sgst} /> }, { key: "i", header: "IGST", align: "right", cell: (r) => <Money value={r.igst} /> }]} />
        </Section>
        <Section title="B2B (registered buyers) — for GSTR-1" flush>
          <SimpleTable label="B2B" rows={d.b2b} rowKey={(r) => r.gstin} empty={<p className="text-fg-muted px-4 py-4 text-[13px]">No invoices to GST-registered clients this month.</p>}
            columns={[{ key: "n", header: "Client", cell: (r) => r.clientName }, { key: "g", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin}</span> }, { key: "i", header: "Invoices", align: "right", cell: (r) => r.invoices }, { key: "t", header: "Taxable", align: "right", cell: (r) => <Money value={r.taxable} /> }, { key: "x", header: "Tax", align: "right", cell: (r) => <Money value={r.tax} /> }]} />
        </Section>
      </>}
    </div>
  );
}
