"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, Money, PromptDialog, Section, SimpleTable, Stat } from "@/components/module/kit";
import { AccountSelect, useAccounts } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { BankLine } from "@/lib/api/modules/finance";
import { formatDate } from "@/lib/formatting";

export function BankingView() {
  const { can } = useAuth();
  const accounts = useAccounts();
  const banks = (accounts.data ?? []).filter((a) => a.isBank);
  const [chosen, setChosen] = useState("");
  const bank = chosen || banks[0]?.id || "";
  const [status, setStatus] = useState<"unmatched" | "matched" | "ignored">("unmatched");
  const lines = useApi<BankLine[]>(["bank", bank, status], bank ? `/bank/lines?bankAccountId=${bank}&status=${status}` : null);
  const summary = useApi<{ bookBalance: string; statementBalance: string | null; statementDate: string | null; counts: Record<string, number> }>(["bank", bank, "summary"], bank ? `/bank/summary?bankAccountId=${bank}` : null);
  const inv = { invalidate: [["bank"], ["finance"]] };
  const imp = useApiMutation<object, { rows: number; imported: number; duplicates: number }>("POST", "/bank/import", { ...inv, success: (r) => `Imported ${r.imported} of ${r.rows} lines${r.duplicates ? ` (${r.duplicates} already imported)` : ""}` });
  const match = useApiMutation<{ id: string; entryId: string }>("POST", (b) => `/bank/lines/${b.id}/match`, { ...inv, success: "Matched" });
  const ignore = useApiMutation<{ id: string }>("POST", (b) => `/bank/lines/${b.id}/ignore`, inv);
  const cat = useApiMutation<{ id: string; accountId: string; memo: string }>("POST", (b) => `/bank/lines/${b.id}/categorize`, { ...inv, success: "Posted and matched" });
  const [categorizing, setCategorizing] = useState<BankLine | null>(null);
  const [catAccount, setCatAccount] = useState("");

  const onFile = async (file: File | undefined) => {
    if (!file || !bank) return;
    if (file.size > 2_000_000) return void toast.error("Keep statements under 2 MB — split by month.");
    imp.mutate({ bankAccountId: bank, filename: file.name, csv: await file.text() });
  };
  const diff = summary.data?.statementBalance != null ? Number(summary.data.statementBalance) - Number(summary.data.bookBalance) : null;
  return (
    <ModulePage title="Banking" description="Import the bank's CSV statement, then match each line to a ledger entry. Re-importing the same file is safe."
      permissions={["finance.view"]}
      actions={<>
        <AccountSelect value={bank} onChange={setChosen} filter={(a) => a.isBank} placeholder="Bank account" />
        {can("finance.bank.reconcile") && (
          <Button asChild size="sm" variant="primary" disabled={!bank}>
            <label className="cursor-pointer"><Upload /> Import CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          </Button>
        )}
      </>}>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Book balance" value={<Money value={summary.data?.bookBalance} />} />
        <Stat label="Statement balance" value={<Money value={summary.data?.statementBalance} />} hint={summary.data?.statementDate ? `as of ${formatDate(summary.data.statementDate)}` : "Import a statement with a balance column"} />
        <Stat label="Difference" value={diff == null ? "—" : <Money value={diff.toFixed(2)} />} tone={diff ? "danger" : "success"} hint={`${summary.data?.counts.unmatched ?? 0} line(s) to reconcile`} />
      </div>
      <Section flush actions={<Segmented label="Show" value={status} onChange={setStatus} options={[{ value: "unmatched", label: "To match" }, { value: "matched", label: "Matched" }, { value: "ignored", label: "Ignored" }]} />} title="Statement lines">
        <SimpleTable label="Statement lines" rows={lines.data} rowKey={(l) => l.id} loading={lines.isLoading} error={lines.error}
          empty={<EmptyState title={status === "unmatched" ? "Nothing to reconcile" : "None"} description="CSV columns: Date, Narration/Description, Ref, Withdrawal/Debit, Deposit/Credit (or a signed Amount), Balance. Dates as DD/MM/YYYY or YYYY-MM-DD." />}
          columns={[
            { key: "d", header: "Date", cell: (l) => formatDate(l.txnDate) },
            { key: "n", header: "Narration", cell: (l) => <div className="max-w-md"><div className="truncate">{l.description}</div>{l.reference && <div className="text-fg-subtle text-xs">{l.reference}</div>}</div> },
            { key: "a", header: "Amount", align: "right", cell: (l) => <Money value={l.amount} className={Number(l.amount) < 0 ? "text-danger" : "text-success"} /> },
            { key: "s", header: status === "unmatched" ? "Suggested match" : "", cell: (l) => status !== "unmatched" ? null : l.suggestions.length ? (
              <div className="space-y-1">{l.suggestions.slice(0, 2).map((s) => <div key={s.entryId} className="flex items-center gap-2 text-xs"><span className="text-fg-muted min-w-0 flex-1 truncate">{s.number} · {formatDate(s.entryDate)} · {s.memo}</span>{can("finance.bank.reconcile") && <Button size="xs" variant="primary" onClick={() => match.mutate({ id: l.id, entryId: s.entryId })}>Match</Button>}</div>)}</div>
            ) : <span className="text-fg-subtle text-xs">No ledger entry with this amount ±5 days</span> },
            { key: "x", header: "", align: "right", cell: (l) => status === "unmatched" && can("finance.bank.reconcile") && (
              <div className="flex justify-end gap-1">{can("finance.journal.post") && <Button size="xs" variant="ghost" onClick={() => setCategorizing(l)}>Categorise</Button>}<Button size="xs" variant="ghost" onClick={() => ignore.mutate({ id: l.id })}>Ignore</Button></div>
            ) },
          ]} />
      </Section>
      <PromptDialog open={!!categorizing} onOpenChange={(o) => !o && setCategorizing(null)} title="Post this line to the ledger" description={categorizing ? `₹${categorizing.amount} on ${formatDate(categorizing.txnDate)} — ${categorizing.description}` : ""} label="Memo" placeholder="Bank charges October" confirmLabel="Post & match" busy={cat.isPending}
        onSubmit={(memo) => categorizing && cat.mutate({ id: categorizing.id, accountId: catAccount, memo }, { onSuccess: () => { setCategorizing(null); setCatAccount(""); } })}>
        <AccountSelect value={catAccount} onChange={setCatAccount} filter={(a) => !a.isBank} placeholder="Other side of the entry" />
      </PromptDialog>
    </ModulePage>
  );
}
