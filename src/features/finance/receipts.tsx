"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, Money, NativeSelect, Section, SimpleTable, Tag, today } from "@/components/module/kit";
import { AccountSelect, ClientPicker } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { qs } from "@/lib/api/request";
import type { Invoice, Receipt } from "@/lib/api/modules/finance";
import { formatDate } from "@/lib/formatting";
import { fromPaise, sum, toPaise } from "@/lib/money";

export function ReceiptsView() {
  const { can } = useAuth();
  const list = useApi<Receipt[]>(["receipts"], "/receipts");
  const [open, setOpen] = useState(false);
  return (
    <ModulePage title="Receipts" description="Money received, including income-tax TDS the client deducted. Each receipt posts to the bank and clears receivables; retries can't double-record it."
      permissions={["finance.view"]} actions={can("finance.receipt.record") && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> Record receipt</Button>}>
      <Section flush>
        <SimpleTable label="Receipts" rows={list.data} rowKey={(r) => r.id} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No receipts yet" />}
          columns={[
            { key: "n", header: "Receipt", cell: (r) => <div><div className="font-mono text-xs">{r.number}</div><div className="text-fg-subtle text-xs">{r.method.replace("_", " ")}{r.reference ? ` · ${r.reference}` : ""}</div></div> },
            { key: "c", header: "Client", cell: (r) => r.clientName },
            { key: "d", header: "Date", cell: (r) => formatDate(r.receiptDate), hideBelow: "sm" },
            { key: "a", header: "Received", align: "right", cell: (r) => <Money value={r.amount} /> },
            { key: "t", header: "TDS", align: "right", cell: (r) => <Money value={r.tdsAmount} muted />, hideBelow: "md" },
            { key: "u", header: "Unallocated", align: "right", cell: (r) => (r.unallocated === "0.00" ? <span className="text-fg-subtle">—</span> : <Tag tone="warning">₹{r.unallocated} on account</Tag>), hideBelow: "sm" },
          ]} />
      </Section>
      {open && <RecordReceiptDialog onClose={() => setOpen(false)} />}
    </ModulePage>
  );
}

/** One key per dialog session: a double-click or network retry replays the same request safely. */
const newKey = () => `rcpt-${crypto.randomUUID()}`;

export function RecordReceiptDialog({ clientId: initialClient, prefillInvoice, onClose }: { clientId?: string; prefillInvoice?: Invoice; onClose: () => void }) {
  const [key] = useState(newKey);
  const [clientId, setClientId] = useState<string | null>(initialClient ?? null);
  const [v, setV] = useState({ receiptDate: today(), amount: prefillInvoice?.outstanding ?? "", tdsAmount: "0", method: "bank_transfer", reference: "", depositAccountId: "" });
  const open = useApi<Invoice[]>(["invoices", "open", clientId], clientId ? `/invoices${qs({ clientId, status: ["issued", "partially_paid"] })}` : null);
  const [alloc, setAlloc] = useState<Record<string, string>>(prefillInvoice ? { [prefillInvoice.id]: prefillInvoice.outstanding } : {});
  const m = useApiMutation<object, Receipt>("POST", "/receipts", { invalidate: [["receipts"], ["invoices"], ["invoice"], ["finance"]], success: (r) => `Receipt ${r.number} recorded`, headers: () => ({ "Idempotency-Key": key }) });
  const safe = (f: () => bigint) => { try { return f(); } catch { return 0n; } };
  const gross = safe(() => toPaise(v.amount || "0") + toPaise(v.tdsAmount || "0"));
  const allocations = Object.entries(alloc).filter(([, a]) => Number(a) > 0).map(([invoiceId, amount]) => ({ invoiceId, amount }));
  const allocated = safe(() => sum(allocations.map((a) => toPaise(a.amount))));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...v, clientId, allocations }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>Record receipt</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Client" htmlFor="rc" required className="sm:col-span-2"><ClientPicker id="rc" value={clientId} onChange={(id) => { setClientId(id); setAlloc({}); }} /></Field>
              <Field label="Date" htmlFor="rd"><Input id="rd" type="date" max={today()} value={v.receiptDate} onChange={(e) => setV({ ...v, receiptDate: e.target.value })} /></Field>
              <Field label="Amount received (₹)" htmlFor="ra" required><Input id="ra" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
              <Field label="TDS deducted by client" htmlFor="rt" hint="Shows in their Form 26AS / TDS certificate"><Input id="rt" inputMode="decimal" value={v.tdsAmount} onChange={(e) => setV({ ...v, tdsAmount: e.target.value })} /></Field>
              <Field label="Method" htmlFor="rm"><NativeSelect id="rm" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></NativeSelect></Field>
              <Field label="Deposited to" htmlFor="rb" required><AccountSelect id="rb" value={v.depositAccountId} onChange={(id) => setV({ ...v, depositAccountId: id })} filter={(a) => a.isBank} /></Field>
              <Field label="Reference (UTR / cheque no.)" htmlFor="rr" className="sm:col-span-2"><Input id="rr" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
            </div>
            {clientId && (
              <div>
                <p className="mb-2 text-[13px] font-medium">Allocate to invoices</p>
                {open.data?.length ? (
                  <ul className="divide-border border-border divide-y rounded-md border text-[13px]">
                    {open.data.map((i) => (
                      <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1"><span className="font-mono text-xs">{i.number}</span> · due {formatDate(i.dueDate)} · open <Money value={i.outstanding} /></span>
                        <Input aria-label={`Allocate to ${i.number}`} className="h-8 w-32" inputMode="decimal" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} />
                        <Button type="button" size="xs" variant="ghost" onClick={() => setAlloc({ ...alloc, [i.id]: i.outstanding })}>Full</Button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-fg-muted text-xs">No open invoices — the receipt stays on account as an advance.</p>}
                <p className="text-fg-muted mt-2 text-xs">Allocated ₹{fromPaise(allocated)} of ₹{fromPaise(gross)} (amount + TDS).{allocated > gross && <span className="text-danger"> That&apos;s more than the receipt.</span>}</p>
              </div>
            )}
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!clientId || !v.depositAccountId || gross <= 0n || allocated > gross}>Record receipt</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
