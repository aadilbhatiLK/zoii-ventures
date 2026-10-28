"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown, Plus, Receipt, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, Money, NativeSelect, Section, SimpleTable, StatusBadge, Tag, today } from "@/components/module/kit";
import { ClientPicker } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { apiUrl, qs } from "@/lib/api/request";
import type { Invoice } from "@/lib/api/modules/finance";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { STATE_CODES } from "@/lib/validation/gstin";
import { RecordReceiptDialog } from "./receipts";

export function InvoicesView() {
  const router = useRouter();
  const { can } = useAuth();
  const [filter, setFilter] = useState("");
  const path = `/invoices${qs(filter === "overdue" ? { overdue: "true" } : { status: filter || undefined })}`;
  const list = useApi<Invoice[]>(["invoices", filter], path);
  const [open, setOpen] = useState(false);
  const billing = useApiMutation<undefined, { due: number; created: number; errors: string[] }>("POST", "/invoices/run-billing", { invalidate: [["invoices"], ["subscriptions"]], success: (r) => `${r.created} draft invoice(s) from ${r.due} due subscription period(s)${r.errors.length ? ` · ${r.errors.length} need attention` : ""}` });
  return (
    <ModulePage title="Sales Invoices" description="Drafts are priced on the server. Issuing assigns the next gap-free number for the financial year and posts the sales journal; issued invoices change only through credit notes."
      permissions={["finance.view"]}
      actions={<>
        <NativeSelect aria-label="Filter" className="h-8 w-36" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option><option value="draft">Drafts</option><option value="issued">Unpaid</option><option value="partially_paid">Part-paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option>
        </NativeSelect>
        {can("finance.invoice.issue") && <Button size="sm" loading={billing.isPending} onClick={() => billing.mutate(undefined)}><RotateCcw /> Run subscription billing</Button>}
        {can("finance.invoice.issue") && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> New invoice</Button>}
      </>}>
      <Section flush>
        <SimpleTable label="Invoices" rows={list.data} rowKey={(i) => i.id} href={(i) => `/finance/invoices/${i.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No invoices" description="Invoice signed-off milestones, one-time order lines or a manual draft." />}
          columns={[
            { key: "n", header: "Number", cell: (i) => <span className="font-mono text-xs">{i.number ?? "Draft"}</span> },
            { key: "c", header: "Client", cell: (i) => i.clientName },
            { key: "d", header: "Date", cell: (i) => formatDate(i.invoiceDate), hideBelow: "sm" },
            { key: "u", header: "Due", cell: (i) => { const late = ["issued", "partially_paid"].includes(i.status) && i.dueDate < today(); return <span className={late ? "text-danger font-medium" : undefined}>{formatDate(i.dueDate)}</span>; }, hideBelow: "md" },
            { key: "s", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
            { key: "t", header: "Total", align: "right", cell: (i) => <Money value={i.total} /> },
            { key: "o", header: "Outstanding", align: "right", cell: (i) => (i.status === "draft" ? "—" : <Money value={i.outstanding} muted={i.outstanding === "0.00"} />), hideBelow: "sm" },
          ]} />
      </Section>
      {open && <InvoiceDialog onClose={() => setOpen(false)} onSaved={(i) => router.push(`/finance/invoices/${i.id}`)} />}
    </ModulePage>
  );
}

interface LineV { description: string; hsnSac: string; quantity: string; unitPrice: string; discountPct: string; revenue: "services" | "subscriptions" }
export function InvoiceDialog({ invoice, onClose, onSaved }: { invoice?: Invoice; onClose: () => void; onSaved: (i: Invoice) => void }) {
  const [clientId, setClientId] = useState<string | null>(invoice?.clientId ?? null);
  const [date, setDate] = useState(invoice?.invoiceDate ?? today());
  const [due, setDue] = useState(invoice?.dueDate ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [lines, setLines] = useState<LineV[]>(invoice?.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, quantity: Number(l.quantity).toString(), unitPrice: l.unitPrice, discountPct: Number(l.discountPct).toString(), revenue: "services" })) ?? [{ description: "", hsnSac: "998314", quantity: "1", unitPrice: "", discountPct: "0", revenue: "services" }]);
  const save = useApiMutation<object, Invoice>(invoice ? "PUT" : "POST", invoice ? `/invoices/${invoice.id}` : "/invoices", { invalidate: [["invoices"], ["invoice"]], success: "Draft saved" });
  const set = (i: number, k: keyof LineV, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate({ clientId, invoiceDate: date, dueDate: due || undefined, notes, salesOrderId: invoice?.salesOrderId ?? null, lines }, { onSuccess: (i) => { onSaved(i); onClose(); } }); }}>
          <DialogHeader><DialogTitle>{invoice ? "Edit draft invoice" : "New invoice"}</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Client" htmlFor="ic" required className="sm:col-span-2"><ClientPicker id="ic" value={clientId} onChange={setClientId} /></Field>
              <Field label="Invoice date" htmlFor="id"><Input id="id" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Due date" htmlFor="du" hint="Default from settings"><Input id="du" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
                <Field label="Description" htmlFor={`ld${i}`} className="sm:col-span-5"><Input id={`ld${i}`} value={l.description} onChange={(e) => set(i, "description", e.target.value)} /></Field>
                <Field label="HSN/SAC" htmlFor={`lh${i}`} className="sm:col-span-2"><Input id={`lh${i}`} value={l.hsnSac} onChange={(e) => set(i, "hsnSac", e.target.value)} /></Field>
                <Field label="Qty" htmlFor={`lq${i}`} className="sm:col-span-1"><Input id={`lq${i}`} value={l.quantity} onChange={(e) => set(i, "quantity", e.target.value)} /></Field>
                <Field label="Rate (₹)" htmlFor={`lu${i}`} className="sm:col-span-2"><Input id={`lu${i}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, "unitPrice", e.target.value)} /></Field>
                <Field label="Disc %" htmlFor={`lx${i}`} className="sm:col-span-1"><Input id={`lx${i}`} value={l.discountPct} onChange={(e) => set(i, "discountPct", e.target.value)} /></Field>
                <div className="flex items-end sm:col-span-1"><Button type="button" variant="danger-ghost" size="icon-sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button></div>
                <Field label="Revenue account" htmlFor={`lr${i}`} className="sm:col-span-4"><NativeSelect id={`lr${i}`} value={l.revenue} onChange={(e) => set(i, "revenue", e.target.value)}><option value="services">Services & projects</option><option value="subscriptions">Subscriptions & AMC</option></NativeSelect></Field>
              </div>
            ))}
            <Button type="button" size="sm" onClick={() => setLines((ls) => [...ls, { description: "", hsnSac: "998314", quantity: "1", unitPrice: "", discountPct: "0", revenue: "services" }])}><Plus /> Line</Button>
            <Field label="Notes" htmlFor="in"><Textarea id="in" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <p className="text-fg-muted text-xs">GST is computed by the server from Tax rules on the invoice date, CGST+SGST or IGST by the client&apos;s state.</p>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={save.isPending} disabled={!clientId}>Save draft</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useAuth();
  const q = useApi<Invoice>(["invoice", id], `/invoices/${id}`);
  const inv = { invalidate: [["invoice"], ["invoices"], ["finance"]] };
  const issue = useApiMutation("POST", `/invoices/${id}/issue`, { ...inv, success: (r: unknown) => `Issued as ${(r as Invoice).number}` });
  const del = useApiMutation("DELETE", `/invoices/${id}`, { ...inv, success: "Draft deleted" });
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [edit, setEdit] = useState(false);
  const [credit, setCredit] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const x = q.data;
  if (q.error) return <ModulePage title="Invoice" permissions={[]}><EmptyState title="Invoice not found" /></ModulePage>;
  return (
    <ModulePage title={x ? x.number ?? "Draft invoice" : "Invoice"} permissions={["finance.view"]} meta={x && <StatusBadge status={x.status} />} description={<BackLink href="/finance/invoices">← All invoices</BackLink>}
      actions={x && <>
        <Button asChild size="sm"><a href={apiUrl(`/invoices/${id}/pdf`)} target="_blank" rel="noopener"><FileDown /> PDF</a></Button>
        {x.status === "draft" && can("finance.invoice.issue") && <>
          {!x.milestoneId && !x.subscriptionId && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>}
          <Button size="sm" variant="danger-ghost" loading={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: () => router.push("/finance/invoices") })}><Trash2 /> Delete</Button>
          <Button size="sm" variant="primary" onClick={() => setConfirmIssue(true)}><Send /> Issue</Button>
        </>}
        {["issued", "partially_paid"].includes(x.status) && can("finance.receipt.record") && <Button size="sm" variant="primary" onClick={() => setReceipt(true)}><Receipt /> Record payment</Button>}
        {["issued", "partially_paid"].includes(x.status) && can("finance.invoice.issue") && <Button size="sm" onClick={() => setCredit(true)}><Undo2 /> Credit note</Button>}
      </>}>
      {x && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-5">
            <Section title="Lines" flush>
              <SimpleTable label="Invoice lines" rows={x.lines} rowKey={(l) => l.id} columns={[
                { key: "d", header: "Description", cell: (l) => <div>{l.description}<div className="text-fg-subtle text-xs">SAC {l.hsnSac}{l.credited !== "0.00" ? ` · credited ${l.credited}` : ""}</div></div> },
                { key: "q", header: "Qty", align: "right", cell: (l) => Number(l.quantity) },
                { key: "t", header: "Taxable", align: "right", cell: (l) => <Money value={l.taxable} /> },
                { key: "g", header: "GST", align: "right", cell: (l) => `${Number(l.taxRate)}%`, hideBelow: "sm" },
                { key: "a", header: "Amount", align: "right", cell: (l) => <Money value={l.total} /> },
              ]} />
              <dl className="ml-auto max-w-xs space-y-1 px-4 py-3 text-[13px]">
                <Line k="Taxable value" v={x.taxableTotal} />
                {x.supplyType === "intra" ? <><Line k="CGST" v={x.cgst} /><Line k="SGST" v={x.sgst} /></> : <Line k="IGST" v={x.igst} />}
                <Line k="Total" v={x.total} strong />
                {x.status !== "draft" && <><Line k="Received (incl. TDS)" v={x.amountPaid} /><Line k="Credited" v={x.amountCredited} /><Line k="Outstanding" v={x.outstanding} strong /></>}
              </dl>
            </Section>
            {(x.allocations.length > 0 || x.creditNotes.length > 0) && (
              <Section title="Settlement" flush>
                <ul className="divide-border divide-y text-[13px]">
                  {x.allocations.map((a) => <li key={a.receiptId + a.amount} className="flex justify-between px-4 py-2"><span>Receipt <span className="font-mono text-xs">{a.receiptNumber}</span> · {formatDate(a.receiptDate)}</span><Money value={a.amount} /></li>)}
                  {x.creditNotes.map((c) => <li key={c.id} className="flex justify-between px-4 py-2"><span>Credit note <span className="font-mono text-xs">{c.number}</span> · {c.reason}</span><Money value={c.total} /></li>)}
                </ul>
              </Section>
            )}
          </div>
          <Section title="Details">
            <KeyValues cols={2} items={[
              ["Client", <Link key="c" href={`/clients/${x.clientId}`} className="hover:underline">{x.clientName}</Link>], ["Invoice date", formatDate(x.invoiceDate)], ["Due", formatDate(x.dueDate)],
              ["Supply", x.supplyType === "intra" ? "Intra-state" : "Inter-state"], ["Place of supply", `${STATE_CODES[x.placeOfSupply] ?? ""} (${x.placeOfSupply})`],
              ["Source", x.milestoneId ? "Project milestone" : x.subscriptionId ? `Subscription ${x.billingPeriod ?? ""}` : x.salesOrderId ? "Sales order" : "Manual"],
              ["Issued", x.issuedAt ? formatDateTime(x.issuedAt) : "—"], ["Journal", x.journalEntryId ? <Link key="j" href={`/finance/ledger?entry=${x.journalEntryId}`} className="text-accent hover:underline">View entry</Link> : "—"],
            ]} />
            {x.notes && <p className="text-fg-muted mt-3 text-xs whitespace-pre-wrap">{x.notes}</p>}
            {x.status === "draft" && <p className="mt-3"><Tag tone="warning">Draft — not in the ledger</Tag></p>}
          </Section>
        </div>
      )}
      <ConfirmDialog open={confirmIssue} onOpenChange={setConfirmIssue} title="Issue this invoice?" confirmLabel="Issue invoice"
        description="It gets the next invoice number, the buyer details are frozen, and the sales journal is posted. After this it can only be corrected with a credit note." onConfirm={() => issue.mutate(undefined)} />
      {edit && x && <InvoiceDialog invoice={x} onClose={() => setEdit(false)} onSaved={(i) => router.replace(`/finance/invoices/${i.id}`)} />}
      {credit && x && <CreditNoteDialog invoice={x} onClose={() => setCredit(false)} />}
      {receipt && x && <RecordReceiptDialog clientId={x.clientId} prefillInvoice={x} onClose={() => setReceipt(false)} />}
    </ModulePage>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={strong ? "border-border flex justify-between border-t pt-1.5 font-semibold" : "flex justify-between"}><dt className="text-fg-muted">{k}</dt><dd><Money value={v} /></dd></div>;
}

function CreditNoteDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // One key per open form: a double-click or retry replays instead of posting twice.
  const [idemKey] = useState(() => `cn-${crypto.randomUUID()}`);
  const m = useApiMutation("POST", `/invoices/${invoice.id}/credit-notes`, { invalidate: [["invoice"], ["invoices"]], success: "Credit note issued", headers: () => ({ "Idempotency-Key": idemKey }) });
  const lines = Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([invoiceLineId, taxable]) => ({ invoiceLineId, taxable }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ noteDate: date, reason, lines }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>Credit note against {invoice.number}</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-fg-muted text-[13px]">Enter the taxable value to credit on each line. GST reverses at that line&apos;s rate. Credits can&apos;t exceed what&apos;s outstanding.</p>
            {invoice.lines.map((l) => (
              <Field key={l.id} label={`${l.description} — up to ₹${(Number(l.taxable) - Number(l.credited)).toFixed(2)}`} htmlFor={`cn${l.id}`}>
                <Input id={`cn${l.id}`} inputMode="decimal" value={amounts[l.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [l.id]: e.target.value })} />
              </Field>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="cnd"><Input id="cnd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Reason" htmlFor="cnr" required><Input id="cnr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Scope reduced / discount agreed" /></Field>
            </div>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!lines.length || reason.length < 3}>Issue credit note</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
