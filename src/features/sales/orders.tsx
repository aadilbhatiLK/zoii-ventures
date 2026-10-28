"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus, ReceiptIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, Money, NativeSelect, PromptDialog, Section, SimpleTable, StatusBadge, today } from "@/components/module/kit";
import { ClientPicker, UserName } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { SalesOrder, Subscription } from "@/lib/api/modules/delivery";
import type { Invoice } from "@/lib/api/modules/finance";
import { formatDate } from "@/lib/formatting";

export function SalesOrdersView() {
  const list = useApi<SalesOrder[]>(["sales-orders"], "/sales-orders");
  return (
    <ModulePage title="Sales Orders" description="Created automatically when a client accepts a quotation. Projects and invoices are raised against them." permissions={["orders.view", "orders.manage"]}>
      <Section flush>
        <SimpleTable label="Sales orders" rows={list.data} rowKey={(s) => s.id} href={(s) => `/sales-orders/${s.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No sales orders yet" description="Record a client's acceptance on a sent quotation to create one." />}
          columns={[
            { key: "n", header: "Order", cell: (s) => <span className="font-mono text-xs">{s.number}</span> },
            { key: "c", header: "Client", cell: (s) => s.clientName },
            { key: "q", header: "Quotation", cell: (s) => <span className="text-fg-muted font-mono text-xs">{s.quotationNumber}</span>, hideBelow: "md" },
            { key: "d", header: "Date", cell: (s) => formatDate(s.orderDate), hideBelow: "sm" },
            { key: "s", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            { key: "i", header: "Invoiced", align: "right", cell: (s) => <Money value={s.invoicedTotal} muted />, hideBelow: "lg" },
            { key: "t", header: "Order value", align: "right", cell: (s) => <Money value={s.grandTotal} /> },
          ]} />
      </Section>
    </ModulePage>
  );
}

export function SalesOrderDetail({ id }: { id: string }) {
  const router = useRouter();
  const { can, user } = useAuth();
  const so = useApi<SalesOrder & { lines: { line_no: number; description: string; hsn_sac: string; billing_cycle: string; quantity: string; unit_price: string; taxable: string; total: string }[] }>(["sales-order", id], `/sales-orders/${id}`);
  const [projectOpen, setProjectOpen] = useState(false);
  const [closing, setClosing] = useState<"completed" | "cancelled" | null>(null);
  const bill = useApiMutation<undefined, Invoice>("POST", `/invoices/from-sales-order/${id}`, { invalidate: [["invoices"], ["sales-order", id]], success: "Draft invoice created" });
  const status = useApiMutation<{ status: string }>("POST", `/sales-orders/${id}/status`, { invalidate: [["sales-order", id], ["sales-orders"]], success: "Order updated" });
  const x = so.data;
  return (
    <ModulePage title={x?.number ?? "Sales order"} permissions={["orders.view", "orders.manage"]} meta={x && <StatusBadge status={x.status} />} description={<BackLink href="/sales-orders">← All orders</BackLink>}
      actions={x && x.status === "open" && <>
        {(can("projects.manage") || can("projects.activate")) && <Button size="sm" variant="primary" onClick={() => setProjectOpen(true)}><FolderKanban /> Start project</Button>}
        {can("finance.invoice.issue") && <Button size="sm" loading={bill.isPending} onClick={() => bill.mutate(undefined, { onSuccess: (inv) => router.push(`/finance/invoices/${inv.id}`) })}><ReceiptIndianRupee /> Invoice one-time lines</Button>}
        {can("orders.manage") && <><Button size="sm" onClick={() => setClosing("completed")}>Complete</Button><Button size="sm" variant="danger-ghost" onClick={() => setClosing("cancelled")}>Cancel</Button></>}
      </>}>
      {x && (
        <div className="space-y-5">
          <Section title="Summary">
            <KeyValues cols={4} items={[["Client", <Link key="c" className="hover:underline" href={`/clients/${x.clientId}`}>{x.clientName}</Link>], ["Quotation", <Link key="q" className="font-mono text-xs hover:underline" href={`/quotations/${x.quotationId}`}>{x.quotationNumber}</Link>], ["Order date", formatDate(x.orderDate)], ["Order value", <Money key="v" value={x.grandTotal} />], ["Taxable", <Money key="t" value={x.taxableTotal} />], ["GST", <Money key="g" value={x.taxTotal} />], ["Invoiced so far", <Money key="i" value={x.invoicedTotal} />], ["Projects", x.projectIds.length ? x.projectIds.map((p, i) => <Link key={p} href={`/projects/${p}`} className="text-accent mr-2 hover:underline">#{i + 1}</Link>) : "None"]]} />
          </Section>
          <Section title="Ordered lines" flush>
            <SimpleTable label="Order lines" rows={x.lines} rowKey={(l) => String(l.line_no)} columns={[
              { key: "d", header: "Description", cell: (l) => l.description },
              { key: "c", header: "Billing", cell: (l) => l.billing_cycle.replace("_", " "), hideBelow: "sm" },
              { key: "q", header: "Qty", align: "right", cell: (l) => Number(l.quantity) },
              { key: "t", header: "Taxable", align: "right", cell: (l) => <Money value={l.taxable} /> },
              { key: "a", header: "Amount", align: "right", cell: (l) => <Money value={l.total} /> },
            ]} />
          </Section>
        </div>
      )}
      {projectOpen && x && <NewProjectDialog clientId={x.clientId} salesOrderId={id} defaultName={`${x.clientName} — ${x.number}`} managerId={user?.id ?? ""} onClose={() => setProjectOpen(false)} onCreated={(pid) => router.push(`/projects/${pid}`)} />}
      <PromptDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)} title={closing === "cancelled" ? "Cancel this order?" : "Mark order complete?"} description={closing === "cancelled" ? "Only possible before any invoice is issued against it." : "Use when all work and billing is done."} confirmLabel="Confirm" destructive={closing === "cancelled"} busy={status.isPending} onSubmit={() => closing && status.mutate({ status: closing }, { onSuccess: () => setClosing(null) })} />
    </ModulePage>
  );
}

export function NewProjectDialog({ clientId, salesOrderId, defaultName, managerId, onClose, onCreated }: { clientId?: string; salesOrderId?: string; defaultName?: string; managerId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(defaultName ?? "");
  const [client, setClient] = useState<string | null>(clientId ?? null);
  const [docId, setDocId] = useState("");
  const [due, setDue] = useState("");
  const docs = useApi<{ id: string; number: string; title: string; clientId: string | null; approvedVersion: number | null }[]>(["documents"], "/documents");
  const create = useApiMutation<object, { id: string }>("POST", "/projects", { invalidate: [["projects"], ["sales-order"]], success: "Project created (planned)" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ name, clientId: client, salesOrderId: salesOrderId ?? null, scopeDocumentId: docId || null, managerId, dueDate: due || null, billable: true }, { onSuccess: (p) => onCreated(p.id) }); }}>
          <DialogHeader><DialogTitle>Start a project</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Project name" htmlFor="pn" required><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            {!clientId && <Field label="Client" htmlFor="pc" required><ClientPicker id="pc" value={client} onChange={setClient} /></Field>}
            <Field label="Scope document" htmlFor="sd" hint="Activation needs an approved BRD/PRD (configurable in Settings)">
              <NativeSelect id="sd" value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">Choose later</option>
                {docs.data?.filter((d) => !client || d.clientId === client).map((d) => <option key={d.id} value={d.id}>{d.number} — {d.title}{d.approvedVersion ? ` (v${d.approvedVersion} approved)` : " (not approved)"}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Target date" htmlFor="dd"><Input id="dd" type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <p className="text-fg-muted text-xs">You&apos;ll be the project manager. The project starts as planned; activation checks the sales order, scope and any advance rule.</p>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" disabled={name.trim().length < 3 || !client} loading={create.isPending}>Create project</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionsView() {
  const { can } = useAuth();
  const list = useApi<Subscription[]>(["subscriptions"], "/subscriptions");
  const [open, setOpen] = useState(false);
  const [renewing, setRenewing] = useState<Subscription | null>(null);
  const setStatus = useApiMutation<{ id: string; status: string }>("POST", (b) => `/subscriptions/${b.id}/status`, { invalidate: [["subscriptions"]], success: "Updated" });
  const renew = useApiMutation<{ id: string; months: number }>("POST", (b) => `/subscriptions/${b.id}/renew`, { invalidate: [["subscriptions"]], success: "Renewed" });
  return (
    <ModulePage title="Subscriptions & AMC" description="Recurring billing. Finance's billing run turns due periods into draft invoices (once per period); renewal reminders go to the owner." permissions={["orders.view", "orders.manage"]}
      actions={can("orders.manage") && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> New subscription / AMC</Button>}>
      <Section flush>
        <SimpleTable label="Subscriptions" rows={list.data} rowKey={(s) => s.id} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No subscriptions" description="Add SaaS plans and AMCs so renewals and billing aren't missed." />}
          columns={[
            { key: "n", header: "Subscription", cell: (s) => <div><div className="font-medium">{s.description}</div><div className="text-fg-subtle text-xs">{s.number} · {s.clientName}</div></div> },
            { key: "k", header: "Type", cell: (s) => (s.kind === "amc" ? "AMC" : "Subscription"), hideBelow: "md" },
            { key: "a", header: "Amount", align: "right", cell: (s) => <span><Money value={s.amount} /> <span className="text-fg-subtle text-xs">/{s.billingCycle.replace("ly", "")}</span></span> },
            { key: "b", header: "Next bill", cell: (s) => formatDate(s.nextBillingDate), hideBelow: "sm" },
            { key: "e", header: "Ends", cell: (s) => (s.endDate ? formatDate(s.endDate) : "Open-ended"), hideBelow: "lg" },
            { key: "o", header: "Owner", cell: (s) => <UserName id={s.ownerId} />, hideBelow: "lg" },
            { key: "s", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            { key: "x", header: "", align: "right", cell: (s) => can("orders.manage") && s.status !== "cancelled" && s.status !== "expired" && (
              <div className="flex justify-end gap-1">
                {s.status === "active" ? <Button size="xs" variant="ghost" onClick={() => setStatus.mutate({ id: s.id, status: "paused" })}>Pause</Button> : <Button size="xs" variant="ghost" onClick={() => setStatus.mutate({ id: s.id, status: "active" })}>Resume</Button>}
                <Button size="xs" variant="ghost" onClick={() => setRenewing(s)}>Renew</Button>
              </div>
            ) },
          ]} />
      </Section>
      {open && <SubscriptionDialog onClose={() => setOpen(false)} />}
      <PromptDialog open={!!renewing} onOpenChange={(o) => !o && setRenewing(null)} title={`Renew ${renewing?.number ?? ""}`} label="Extend by months" placeholder="12" confirmLabel="Renew" required={false} busy={renew.isPending}
        onSubmit={(v) => renewing && renew.mutate({ id: renewing.id, months: Number(v) || 12 }, { onSuccess: () => setRenewing(null) })} />
    </ModulePage>
  );
}

function SubscriptionDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ clientId: null as string | null, kind: "amc", description: "", hsnSac: "998713", amount: "", billingCycle: "yearly", startDate: today(), endDate: "", autoRenew: true });
  const m = useApiMutation("POST", "/subscriptions", { invalidate: [["subscriptions"]], success: "Created" });
  const set = (k: string, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...v, endDate: v.endDate || null }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>New subscription / AMC</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="sc" required className="sm:col-span-2"><ClientPicker id="sc" value={v.clientId} onChange={(id) => set("clientId", id)} /></Field>
            <Field label="Type" htmlFor="sk"><NativeSelect id="sk" value={v.kind} onChange={(e) => { set("kind", e.target.value); set("hsnSac", e.target.value === "amc" ? "998713" : "997331"); }}><option value="amc">AMC</option><option value="subscription">Subscription</option></NativeSelect></Field>
            <Field label="HSN/SAC" htmlFor="sh" required><Input id="sh" value={v.hsnSac} onChange={(e) => set("hsnSac", e.target.value)} /></Field>
            <Field label="Description" htmlFor="sd" required className="sm:col-span-2"><Input id="sd" value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="Website AMC — hosting, backups, 10 changes/month" /></Field>
            <Field label="Amount per cycle (₹, before GST)" htmlFor="sa" required><Input id="sa" inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label="Cycle" htmlFor="sy"><NativeSelect id="sy" value={v.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></NativeSelect></Field>
            <Field label="Start (first bill)" htmlFor="ss" required><Input id="ss" type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
            <Field label="End" htmlFor="se" hint="Blank = open-ended"><Input id="se" type="date" value={v.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={v.autoRenew} onChange={(e) => set("autoRenew", e.target.checked)} /> Auto-renew at the end of the term</label>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!v.clientId || !v.amount || v.description.length < 3}>Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
