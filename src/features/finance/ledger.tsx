"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, Money, NativeSelect, PromptDialog, Section, SimpleTable, StatusBadge, Tag, humanize, today } from "@/components/module/kit";
import { AccountSelect, UserName, useAccounts } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { Account, JournalEntry } from "@/lib/api/modules/finance";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { fromPaise, sum, toPaise } from "@/lib/money";

export function LedgerView() {
  const { can } = useAuth();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get("entry") ? "journals" : "accounts");
  const accounts = useAccounts();
  const journals = useApi<JournalEntry[]>(["finance", "journals"], "/finance/journals");
  const [entry, setEntry] = useState<string | null>(sp.get("entry"));
  const [account, setAccount] = useState<Account | null>(null);
  const [jeOpen, setJeOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  return (
    <ModulePage title="General Ledger" description="Double-entry and append-only: the database rejects any entry that doesn't balance, edits to posted lines, and postings into closed periods."
      permissions={["finance.view"]}
      actions={can("finance.journal.post") && <><Button size="sm" onClick={() => setAccOpen(true)}><Plus /> Account</Button><Button size="sm" variant="primary" onClick={() => setJeOpen(true)}><Plus /> Journal entry</Button></>}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="accounts">Chart of accounts</TabsTrigger><TabsTrigger value="journals">Journal</TabsTrigger></TabsList>
        <TabsContent value="accounts" className="pt-4">
          <Section flush>
            <SimpleTable label="Accounts" rows={accounts.data} rowKey={(a) => a.id} loading={accounts.isLoading} error={accounts.error} onRowClick={setAccount}
              columns={[
                { key: "c", header: "Code", cell: (a) => <span className="font-mono text-xs">{a.code}</span> },
                { key: "n", header: "Account", cell: (a) => <span className="flex items-center gap-2">{a.name}{a.isBank && <Tag>Bank</Tag>}</span> },
                { key: "t", header: "Type", cell: (a) => humanize(a.type), hideBelow: "sm" },
                { key: "b", header: "Balance", align: "right", cell: (a) => <Money value={a.balance} muted={a.balance === "0.00"} /> },
              ]} />
          </Section>
        </TabsContent>
        <TabsContent value="journals" className="pt-4">
          <Section flush>
            <SimpleTable label="Journal entries" rows={journals.data} rowKey={(j) => j.id} loading={journals.isLoading} error={journals.error} onRowClick={(j) => setEntry(j.id)}
              empty={<EmptyState title="No entries yet" />}
              columns={[
                { key: "n", header: "Entry", cell: (j) => <span className="font-mono text-xs">{j.number}</span> },
                { key: "d", header: "Date", cell: (j) => formatDate(j.entryDate) },
                { key: "m", header: "Memo", cell: (j) => <span className="line-clamp-1">{j.memo}</span> },
                { key: "s", header: "Source", cell: (j) => <span className="flex gap-1"><Tag>{humanize(j.sourceType)}</Tag>{j.reversedBy && <StatusBadge status="cancelled" label="Reversed" />}</span>, hideBelow: "md" },
                { key: "t", header: "Amount", align: "right", cell: (j) => <Money value={j.total} /> },
              ]} />
          </Section>
        </TabsContent>
      </Tabs>
      {entry && <EntryDialog id={entry} onClose={() => setEntry(null)} />}
      {account && <AccountLedgerDialog account={account} onClose={() => setAccount(null)} />}
      {jeOpen && <JournalDialog onClose={() => setJeOpen(false)} />}
      {accOpen && <AccountDialog onClose={() => setAccOpen(false)} />}
    </ModulePage>
  );
}

function EntryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const je = useApi<JournalEntry>(["finance", "journal", id], `/finance/journals/${id}`);
  const [reversing, setReversing] = useState(false);
  const rev = useApiMutation<{ reason: string; date: string }>("POST", `/finance/journals/${id}/reverse`, { invalidate: [["finance"]], success: "Reversal posted" });
  const x = je.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{x?.number ?? "Journal entry"}</DialogTitle></DialogHeader>
        <DialogBody>
          {x && <>
            <p className="text-[13px]">{x.memo}</p>
            <p className="text-fg-muted mt-1 text-xs">{formatDate(x.entryDate)} · {humanize(x.sourceType)} · posted by <UserName id={x.postedBy} /> {formatDateTime(x.postedAt)}</p>
            <table className="mt-4 w-full text-[13px]">
              <thead><tr className="text-fg-muted border-border border-b text-left text-xs"><th className="py-1.5">Account</th><th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th></tr></thead>
              <tbody className="divide-border divide-y">{x.lines.map((l) => <tr key={l.lineNo}><td className="py-1.5">{l.accountCode} · {l.accountName}{l.description && <div className="text-fg-subtle text-xs">{l.description}</div>}</td><td className="py-1.5 text-right tabular-nums">{l.debit !== "0.00" ? <Money value={l.debit} /> : ""}</td><td className="py-1.5 text-right tabular-nums">{l.credit !== "0.00" ? <Money value={l.credit} /> : ""}</td></tr>)}</tbody>
              <tfoot><tr className="border-border border-t font-medium"><td className="py-1.5">Total</td><td className="py-1.5 text-right"><Money value={x.total} /></td><td className="py-1.5 text-right"><Money value={x.total} /></td></tr></tfoot>
            </table>
          </>}
        </DialogBody>
        <DialogFooter>
          {x && can("finance.journal.post") && !x.reversedBy && ["manual", "opening"].includes(x.sourceType) && <Button size="sm" variant="danger-ghost" onClick={() => setReversing(true)}><Undo2 /> Reverse</Button>}
          <Button size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
      <PromptDialog open={reversing} onOpenChange={setReversing} title="Reverse this entry" description="A mirror entry is posted today; the original stays on record." label="Reason" confirmLabel="Post reversal" destructive busy={rev.isPending}
        onSubmit={(reason) => rev.mutate({ reason, date: today() }, { onSuccess: () => { setReversing(false); onClose(); } })} />
    </Dialog>
  );
}

function AccountLedgerDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const l = useApi<{ opening: string; closing: string; rows: { entryId: string; number: string; date: string; memo: string; debit: string; credit: string; balance: string }[] }>(["finance", "ledger", account.id], `/finance/accounts/${account.id}/ledger`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{account.code} · {account.name}</DialogTitle></DialogHeader>
        <DialogBody>
          <SimpleTable label="Account ledger" rows={l.data?.rows} rowKey={(r) => r.entryId + r.debit + r.credit} loading={l.isLoading} empty={<EmptyState title="No postings" />}
            columns={[
              { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
              { key: "m", header: "Entry", cell: (r) => <div><span className="font-mono text-xs">{r.number}</span><div className="text-fg-muted line-clamp-1 text-xs">{r.memo}</div></div> },
              { key: "dr", header: "Debit", align: "right", cell: (r) => (r.debit !== "0.00" ? <Money value={r.debit} /> : "") },
              { key: "cr", header: "Credit", align: "right", cell: (r) => (r.credit !== "0.00" ? <Money value={r.credit} /> : "") },
              { key: "b", header: "Balance", align: "right", cell: (r) => <Money value={r.balance} /> },
            ]} />
          {l.data && <p className="mt-3 text-right text-[13px] font-medium">Closing balance <Money value={l.data.closing} /></p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function JournalDialog({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  // One key per open form: a double-click or retry replays instead of posting twice.
  const [idemKey] = useState(() => `jv-${crypto.randomUUID()}`);
  const m = useApiMutation("POST", "/finance/journals", { invalidate: [["finance"]], success: "Entry posted", headers: () => ({ "Idempotency-Key": idemKey }) });
  const tot = (k: "debit" | "credit") => { try { return sum(lines.map((l) => toPaise(l[k] || "0"))); } catch { return -1n; } };
  const dr = tot("debit"), cr = tot("credit");
  const set = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ entryDate: date, memo, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: l.debit || "0", credit: l.credit || "0" })) }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>Manual journal entry</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date" htmlFor="jd"><Input id="jd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Memo" htmlFor="jm" required className="sm:col-span-2"><Input id="jm" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opening balance / depreciation / adjustment" /></Field>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_110px_auto] items-end gap-2">
                <AccountSelect value={l.accountId} onChange={(v) => set(i, "accountId", v)} />
                <Input aria-label="Debit" placeholder="Debit" inputMode="decimal" value={l.debit} onChange={(e) => set(i, "debit", e.target.value)} />
                <Input aria-label="Credit" placeholder="Credit" inputMode="decimal" value={l.credit} onChange={(e) => set(i, "credit", e.target.value)} />
                <Button type="button" size="icon-sm" variant="danger-ghost" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button type="button" size="sm" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "" }])}><Plus /> Line</Button>
              <p className={`text-[13px] ${dr === cr && dr > 0n ? "text-success" : "text-danger"}`}>Debits ₹{dr >= 0n ? fromPaise(dr) : "?"} · Credits ₹{cr >= 0n ? fromPaise(cr) : "?"}{dr !== cr && " — must balance"}</p>
            </div>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={dr !== cr || dr <= 0n || memo.length < 3}>Post entry</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ code: "", name: "", type: "expense", isBank: false });
  const m = useApiMutation("POST", "/finance/accounts", { invalidate: [["finance"]], success: "Account added" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(v, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>New account</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="ac" required hint="1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx expenses"><Input id="ac" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
            <Field label="Type" htmlFor="at"><NativeSelect id="at" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{["asset", "liability", "equity", "income", "expense"].map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
            <Field label="Name" htmlFor="an" required className="sm:col-span-2"><Input id="an" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            {v.type === "asset" && <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={v.isBank} onChange={(e) => setV({ ...v, isBank: e.target.checked })} /> Bank or cash account (receipts and payments use it)</label>}
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending}>Add</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
