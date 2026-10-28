"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Copy, FileDown, Pencil, Plus, Send, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, Money, NativeSelect, Section, SimpleTable, StatusBadge, Tag } from "@/components/module/kit";
import { ClientPicker, UserName } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { apiFetch, apiUrl, qs } from "@/lib/api/request";
import type { Client } from "@/lib/api/contracts";
import { BILLING_CYCLES } from "@/lib/api/modules/common";
import { QuotationInputSchema, type Product, type Quotation, type QuotationInput } from "@/lib/api/modules/sales";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { computeTax, supplyTypeFor } from "@/lib/tax/gst";
import { STATE_CODES } from "@/lib/validation/gstin";
import { stateCodeOf } from "./state-code";

interface OrgProfile { legalName: string; gstin: string | null; stateCode: string | null; docPrefix: string; quotationDiscountApprovalPct: number }
export const useOrgProfile = () => useApi<OrgProfile>(["org", "profile"], "/org/profile");

const DEFAULT_TERMS = "1. Prices are exclusive of GST; GST is charged as applicable on the invoice date.\n2. 50% advance with the purchase order, balance on milestone sign-off.\n3. Scope as per the approved BRD/PRD; changes are quoted separately through a change request.\n4. This quotation is valid until the date shown.";

export function QuotationsView() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const list = useApi<Quotation[]>(["quotations", status], `/quotations${qs({ status: status || undefined })}`);
  return (
    <ModulePage title="Quotations" description="Every line is priced and taxed on the server. Discounts above the limit, prices below floor and large deals go for approval."
      permissions={["quotations.view", "quotations.create", "quotations.approve"]}
      actions={<>
        <NativeSelect aria-label="Status" className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All live</option>
          {["draft", "pending_approval", "approved", "sent", "accepted", "rejected", "expired", "cancelled", "superseded"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </NativeSelect>
        {can("quotations.create") && <Button asChild variant="primary" size="sm"><Link href="/quotations/new"><Plus /> New quotation</Link></Button>}
      </>}>
      <Section flush>
        <SimpleTable label="Quotations" rows={list.data} rowKey={(q) => q.id} href={(q) => `/quotations/${q.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No quotations" description="Create one from a client; it can link to the approved BRD." />}
          columns={[
            { key: "n", header: "Number", cell: (q) => <span className="font-mono text-xs">{q.displayNumber}</span> },
            { key: "c", header: "Client", cell: (q) => q.clientName },
            { key: "d", header: "Date", cell: (q) => formatDate(q.quoteDate), hideBelow: "md" },
            { key: "v", header: "Valid until", cell: (q) => formatDate(q.validUntil), hideBelow: "lg" },
            { key: "s", header: "Status", cell: (q) => <StatusBadge status={q.status} /> },
            { key: "o", header: "Owner", cell: (q) => <UserName id={q.ownerId} />, hideBelow: "lg" },
            { key: "t", header: "Total", align: "right", cell: (q) => <Money value={q.grandTotal} /> },
          ]} />
      </Section>
    </ModulePage>
  );
}

type FormV = QuotationInput & { lines: (QuotationInput["lines"][number] & { productId?: string | null })[] };

export function QuotationEditor({ quotation }: { quotation?: Quotation }) {
  const router = useRouter();
  const org = useOrgProfile();
  const products = useApi<Product[]>(["products", "active"], "/products");
  const [client, setClient] = useState<Client | null>(null);
  const f = useForm<FormV>({
    resolver: zodResolver(QuotationInputSchema) as never,
    defaultValues: quotation
      ? { clientId: quotation.clientId, documentId: quotation.documentId, quoteDate: quotation.quoteDate, validUntil: quotation.validUntil, notes: quotation.notes ?? "", terms: quotation.terms ?? "",
          lines: quotation.lines.map((l) => ({ productId: l.productId, description: l.description, hsnSac: l.hsnSac, billingCycle: l.billingCycle, quantity: Number(l.quantity).toString(), unitPrice: l.unitPrice, discountPct: Number(l.discountPct).toString() })) }
      : { clientId: "", terms: DEFAULT_TERMS, lines: [{ description: "", hsnSac: "998314", billingCycle: "one_time", quantity: "1", unitPrice: "", discountPct: "0" }] },
  });
  const lines = useFieldArray({ control: f.control, name: "lines" });
  const watched = useWatch({ control: f.control, name: "lines" });
  const clientId = useWatch({ control: f.control, name: "clientId" });
  const date = useWatch({ control: f.control, name: "quoteDate" }) || new Date().toISOString().slice(0, 10);
  const existingClient = useApi<Client>(["client", clientId], clientId && !client ? `/clients/${clientId}` : null);
  const c = client ?? existingClient.data ?? null;
  const hsns = [...new Set((watched ?? []).map((l) => l.hsnSac).filter((h) => /^\d{4,8}$/.test(h ?? "")))];
  const rates = useQueries({ queries: hsns.map((h) => ({ queryKey: ["tax-rate", h, date], queryFn: () => apiFetch<{ rate: string | null }>("GET", `/tax-rules/lookup${qs({ hsnSac: h, date })}`) })) });
  const rateOf = Object.fromEntries(hsns.map((h, i) => [h, rates[i]?.data?.rate ?? null]));
  const pos = c ? stateCodeOf(c) : null;
  const supplierStateCode = org.data?.stateCode;
  const preview = (() => {
    if (!supplierStateCode || !pos) return null;
    try {
      const ls = (watched ?? []).filter((l) => l.unitPrice && l.quantity && rateOf[l.hsnSac]);
      if (ls.length !== (watched ?? []).length) return null;
      return computeTax(ls.map((l) => ({ description: l.description, hsnSac: l.hsnSac, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct || "0", taxRate: rateOf[l.hsnSac]! })), supplyTypeFor(supplierStateCode, pos));
    } catch { return null; }
  })();
  const save = useApiMutation<FormV, Quotation>(quotation ? "PUT" : "POST", quotation ? `/quotations/${quotation.id}` : "/quotations", { invalidate: [["quotations"], ["quotation"]], success: quotation ? "Draft updated" : "Draft created" });
  const e = f.formState.errors;

  return (
    <ModulePage title={quotation ? `Edit ${quotation.displayNumber}` : "New quotation"} permissions={["quotations.create"]} description={<BackLink href={quotation ? `/quotations/${quotation.id}` : "/quotations"}>← Back</BackLink>}>
      <form onSubmit={f.handleSubmit((v) => save.mutate({ ...v, expectedUpdatedAt: quotation?.updatedAt }, { onSuccess: (q) => router.push(`/quotations/${q.id}`) }))} noValidate className="space-y-5">
        <Section title="Client & validity">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Client" htmlFor="client" required error={e.clientId?.message} className="sm:col-span-2" hint={c ? `Place of supply: ${pos ? `${STATE_CODES[pos]} (${pos})` : "unknown — add the client's state or GSTIN"}` : undefined}>
              <ClientPicker id="client" value={clientId || null} invalid={!!e.clientId} onChange={(id, cl) => { f.setValue("clientId", id, { shouldValidate: true }); setClient(cl); }} />
            </Field>
            <Field label="Quote date" htmlFor="qd"><Input id="qd" type="date" {...f.register("quoteDate")} /></Field>
            <Field label="Valid until" htmlFor="vu" hint="Default: org validity days" error={e.validUntil?.message}><Input id="vu" type="date" {...f.register("validUntil")} /></Field>
          </div>
        </Section>
        <Section title="Lines" description={`GST rates come from Tax rules for the quote date. Discounts above ${org.data?.quotationDiscountApprovalPct ?? "—"}% need approval.`}
          actions={<Button type="button" size="sm" onClick={() => lines.append({ description: "", hsnSac: "998314", billingCycle: "one_time", quantity: "1", unitPrice: "", discountPct: "0" })}><Plus /> Add line</Button>}>
          <div className="space-y-3">
            {lines.fields.map((fl, i) => {
              const l = watched?.[i];
              const pl = preview?.lines[i];
              return (
                <div key={fl.id} className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
                  <Field label="Product" htmlFor={`p${i}`} className="sm:col-span-3">
                    <NativeSelect id={`p${i}`} value={l?.productId ?? ""} onChange={(ev) => {
                      const p = products.data?.find((x) => x.id === ev.target.value);
                      f.setValue(`lines.${i}.productId`, p?.id ?? null);
                      if (p) { f.setValue(`lines.${i}.description`, p.name); f.setValue(`lines.${i}.hsnSac`, p.hsnSac); f.setValue(`lines.${i}.unitPrice`, p.unitPrice); f.setValue(`lines.${i}.billingCycle`, p.billingCycle); }
                    }}>
                      <option value="">Custom line</option>
                      {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field label="Description" htmlFor={`d${i}`} className="sm:col-span-5" error={e.lines?.[i]?.description?.message}><Input id={`d${i}`} {...f.register(`lines.${i}.description`)} /></Field>
                  <Field label="HSN/SAC" htmlFor={`h${i}`} className="sm:col-span-2" error={e.lines?.[i]?.hsnSac?.message} hint={l?.hsnSac && rateOf[l.hsnSac] ? `GST ${Number(rateOf[l.hsnSac])}%` : l?.hsnSac ? "No rule" : undefined}><Input id={`h${i}`} inputMode="numeric" {...f.register(`lines.${i}.hsnSac`)} /></Field>
                  <Field label="Billing" htmlFor={`b${i}`} className="sm:col-span-2"><NativeSelect id={`b${i}`} {...f.register(`lines.${i}.billingCycle`)}>{Object.entries(BILLING_CYCLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
                  <Field label="Qty" htmlFor={`q${i}`} className="sm:col-span-2" error={e.lines?.[i]?.quantity?.message}><Input id={`q${i}`} inputMode="decimal" {...f.register(`lines.${i}.quantity`)} /></Field>
                  <Field label="Rate (₹)" htmlFor={`u${i}`} className="sm:col-span-3" error={e.lines?.[i]?.unitPrice?.message}><Input id={`u${i}`} inputMode="decimal" {...f.register(`lines.${i}.unitPrice`)} /></Field>
                  <Field label="Discount %" htmlFor={`x${i}`} className="sm:col-span-2" error={e.lines?.[i]?.discountPct?.message}><Input id={`x${i}`} inputMode="decimal" {...f.register(`lines.${i}.discountPct`)} /></Field>
                  <div className="flex items-end justify-between gap-2 sm:col-span-5">
                    <div className="text-[13px]"><span className="text-fg-muted">Line total </span>{pl ? <Money value={pl.total} className="font-medium" /> : "—"}</div>
                    <Button type="button" size="icon-sm" variant="danger-ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}><Trash2 /></Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-1 text-[13px]">
              {preview ? (
                <>
                  <Row k="Taxable value" v={preview.taxableTotal} />
                  {preview.supplyType === "intra" ? <><Row k="CGST" v={preview.cgst} /><Row k="SGST" v={preview.sgst} /></> : <Row k="IGST" v={preview.igst} />}
                  <Row k="Total (preview)" v={preview.grandTotal} strong />
                  <p className="text-fg-subtle pt-1 text-right text-xs">The server recomputes these when you save.</p>
                </>
              ) : <p className="text-fg-muted text-right text-xs">Totals appear when every line has a rate, quantity and a GST rule, and the client&apos;s state is known.</p>}
            </dl>
          </div>
        </Section>
        <Section title="Notes & terms">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Notes for the client" htmlFor="notes"><Textarea id="notes" {...f.register("notes")} /></Field>
            <Field label="Terms & conditions" htmlFor="terms"><Textarea id="terms" className="min-h-32" {...f.register("terms")} /></Field>
          </div>
        </Section>
        <div className="flex justify-end gap-2">
          <Button asChild size="sm"><Link href={quotation ? `/quotations/${quotation.id}` : "/quotations"}>Cancel</Link></Button>
          <Button type="submit" size="sm" variant="primary" loading={save.isPending}>Save draft</Button>
        </div>
      </form>
    </ModulePage>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={strong ? "border-border flex justify-between border-t pt-1.5 text-sm font-semibold" : "flex justify-between"}><dt className="text-fg-muted">{k}</dt><dd><Money value={v} /></dd></div>;
}

export function QuotationDetail({ id }: { id: string }) {
  const router = useRouter();
  const { can, user } = useAuth();
  const q = useApi<Quotation>(["quotation", id], `/quotations/${id}`);
  const revs = useApi<Quotation[]>(["quotation", id, "revisions"], `/quotations/${id}/revisions`);
  const [deciding, setDeciding] = useState<"accepted" | "rejected" | null>(null);
  const inv = { invalidate: [["quotation"], ["quotations"], ["approvals"], ["sales-orders"]] };
  const submit = useApiMutation("POST", `/quotations/${id}/submit`, { ...inv, success: (r: unknown) => ((r as Quotation).status === "approved" ? "Approved — within limits" : "Sent for approval") });
  const send = useApiMutation("POST", `/quotations/${id}/send`, { ...inv, success: "Marked as sent" });
  const revise = useApiMutation<undefined, Quotation>("POST", `/quotations/${id}/revise`, { ...inv, success: (r) => `Revision ${r.displayNumber} created` });
  const cancel = useApiMutation("POST", `/quotations/${id}/cancel`, { ...inv, success: "Cancelled" });
  const x = q.data;
  const mine = x?.ownerId === user?.id;
  const canSend = can("quotations.send") || (can("quotations.create") && mine);
  if (q.error) return <ModulePage title="Quotation" permissions={[]}><EmptyState title="Quotation not found" description="It doesn't exist or isn't in your scope." /></ModulePage>;
  return (
    <ModulePage title={x?.displayNumber ?? "Quotation"} permissions={["quotations.view", "quotations.create", "quotations.approve"]}
      meta={x && <StatusBadge status={x.status} />} description={<BackLink href="/quotations">← All quotations</BackLink>}
      actions={x && <>
        <Button asChild size="sm"><a href={apiUrl(`/quotations/${id}/pdf`)} target="_blank" rel="noopener"><FileDown /> PDF</a></Button>
        {x.status === "draft" && can("quotations.create") && <Button asChild size="sm"><Link href={`/quotations/${id}/edit`}><Pencil /> Edit</Link></Button>}
        {x.status === "draft" && can("quotations.create") && <Button size="sm" variant="primary" loading={submit.isPending} onClick={() => submit.mutate(undefined)}>Submit</Button>}
        {x.status === "approved" && canSend && <Button size="sm" variant="primary" loading={send.isPending} onClick={() => send.mutate(undefined)}><Send /> Mark as sent</Button>}
        {x.status === "sent" && canSend && <><Button size="sm" onClick={() => setDeciding("rejected")}><XCircle /> Client rejected</Button><Button size="sm" variant="primary" onClick={() => setDeciding("accepted")}><CheckCircle2 /> Client accepted</Button></>}
        {["pending_approval", "approved", "sent", "rejected", "expired"].includes(x.status) && can("quotations.create") && <Button size="sm" loading={revise.isPending} onClick={() => revise.mutate(undefined, { onSuccess: (r) => router.push(`/quotations/${r.id}`) })}><Copy /> Revise</Button>}
        {["draft", "pending_approval", "approved"].includes(x.status) && can("quotations.create") && <Button size="sm" variant="danger-ghost" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>Cancel</Button>}
      </>}>
      {x && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-5">
            {x.status === "pending_approval" && <div className="border-warning/50 bg-warning-soft rounded-lg border p-3 text-[13px]"><p className="font-medium">Waiting for approval</p><ul className="text-fg-muted mt-1 list-disc pl-5">{x.approvalReasons.map((r) => <li key={r}>{r}</li>)}</ul></div>}
            {x.salesOrderId && <div className="border-success/40 bg-success-soft rounded-lg border p-3 text-[13px]">Accepted — {can("orders.view") || can("orders.manage") ? <><Link href={`/sales-orders/${x.salesOrderId}`} className="font-medium underline">open the sales order</Link> to start the project.</> : "a sales order was created for delivery and finance."}</div>}
            <Section title="Lines" flush>
              <SimpleTable label="Quotation lines" rows={x.lines} rowKey={(l) => l.id}
                columns={[
                  { key: "d", header: "Description", cell: (l) => <div>{l.description}<div className="text-fg-subtle text-xs">SAC {l.hsnSac} · {BILLING_CYCLES[l.billingCycle]}{l.listPrice && l.listPrice !== l.unitPrice ? ` · list ${l.listPrice}` : ""}</div></div> },
                  { key: "q", header: "Qty", align: "right", cell: (l) => Number(l.quantity) },
                  { key: "r", header: "Rate", align: "right", cell: (l) => <Money value={l.unitPrice} />, hideBelow: "sm" },
                  { key: "x", header: "Disc", align: "right", cell: (l) => (Number(l.discountPct) ? `${Number(l.discountPct)}%` : "—"), hideBelow: "md" },
                  { key: "t", header: "Taxable", align: "right", cell: (l) => <Money value={l.taxable} />, hideBelow: "sm" },
                  { key: "g", header: "GST", align: "right", cell: (l) => `${Number(l.taxRate)}%`, hideBelow: "md" },
                  { key: "a", header: "Amount", align: "right", cell: (l) => <Money value={l.total} /> },
                ]} />
              <div className="flex justify-end px-4 py-3">
                <dl className="w-full max-w-xs space-y-1 text-[13px]">
                  {x.discountTotal !== "0.00" && <><Row k="Gross" v={x.subtotal} /><Row k="Discount" v={`-${x.discountTotal}`} /></>}
                  <Row k="Taxable value" v={x.taxableTotal} />
                  {x.supplyType === "intra" ? <><Row k="CGST" v={x.cgst} /><Row k="SGST" v={x.sgst} /></> : <Row k="IGST" v={x.igst} />}
                  <Row k="Total" v={x.grandTotal} strong />
                </dl>
              </div>
            </Section>
            {(x.notes || x.terms) && <Section title="Notes & terms"><div className="space-y-3 text-[13px] whitespace-pre-wrap">{x.notes && <p>{x.notes}</p>}{x.terms && <p className="text-fg-muted">{x.terms}</p>}</div></Section>}
          </div>
          <div className="space-y-5">
            <Section title="Details">
              <KeyValues cols={2} items={[
                ["Client", <Link key="c" href={`/clients/${x.clientId}`} className="hover:underline">{x.clientName}</Link>], ["Owner", <UserName key="o" id={x.ownerId} />],
                ["Quote date", formatDate(x.quoteDate)], ["Valid until", formatDate(x.validUntil)],
                ["Supply", x.supplyType === "intra" ? `Intra-state (${x.placeOfSupply})` : `Inter-state → ${x.placeOfSupply}`], ["Approved by", x.approvedBy ? <UserName key="a" id={x.approvedBy} /> : x.approvedAt ? "Auto (within limits)" : "—"],
                ["Sent", x.sentAt ? formatDateTime(x.sentAt) : "—"], ["Client decision", x.decidedAt ? formatDateTime(x.decidedAt) : "—"],
              ]} />
              {x.clientDecisionNote && <p className="text-fg-muted mt-3 text-xs">{x.clientDecisionNote}</p>}
              {x.documentId && <p className="mt-3 text-[13px]"><Link href={`/documents/${x.documentId}`} className="text-accent hover:underline">Linked BRD/PRD →</Link></p>}
            </Section>
            {revs.data && revs.data.length > 1 && (
              <Section title="Revisions" flush>
                <ul className="divide-border divide-y text-[13px]">{revs.data.map((r) => <li key={r.id}><Link href={`/quotations/${r.id}`} className="hover:bg-surface-2 flex items-center justify-between px-4 py-2"><span className="font-mono text-xs">{r.displayNumber}</span><span className="flex items-center gap-2"><Money value={r.grandTotal} muted /><StatusBadge status={r.status} /></span></Link></li>)}</ul>
              </Section>
            )}
            {x.status === "sent" && <Tag tone="info">Valid till {formatDate(x.validUntil)}</Tag>}
          </div>
        </div>
      )}
      {deciding && <ClientDecisionDialog id={id} decision={deciding} onClose={() => setDeciding(null)} />}
    </ModulePage>
  );
}

function ClientDecisionDialog({ id, decision, onClose }: { id: string; decision: "accepted" | "rejected"; onClose: () => void }) {
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const m = useApiMutation("POST", `/quotations/${id}/client-decision`, { invalidate: [["quotation"], ["quotations"], ["sales-orders"]], success: decision === "accepted" ? "Accepted — sales order created" : "Recorded as rejected" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ decision, evidence, note }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>{decision === "accepted" ? "Record client acceptance" : "Record client rejection"}</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            {decision === "accepted" && <p className="text-fg-muted text-[13px]">Acceptance creates the sales order in the same step. E-signature isn&apos;t connected, so record how the client accepted.</p>}
            <Field label="Evidence" htmlFor="ev" required={decision === "accepted"} hint="e.g. “PO 4512 dated 24 Oct” or “Email from owner, 24 Oct 10:30”"><Input id="ev" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
            <Field label="Note" htmlFor="nt"><Textarea id="nt" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant={decision === "accepted" ? "primary" : "danger"} loading={m.isPending} disabled={decision === "accepted" && evidence.trim().length < 3}>Confirm</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
