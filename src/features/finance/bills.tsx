"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, Money, NativeSelect, PromptDialog, Section, SimpleTable, StatusBadge, today } from "@/components/module/kit";
import { AccountSelect } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { Bill, Vendor } from "@/lib/api/modules/finance";
import { formatDate } from "@/lib/formatting";

export function BillsView() {
  const { can } = useAuth();
  const [tab, setTab] = useState("bills");
  const bills = useApi<Bill[]>(["bills"], "/bills");
  const vendors = useApi<Vendor[]>(["vendors"], "/vendors");
  const [open, setOpen] = useState<"bill" | "expense" | null>(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [paying, setPaying] = useState<Bill | null>(null);
  return (
    <ModulePage title="Bills & Expenses" description="Vendor bills post input GST (when claimable) and TDS withheld; expenses are recorded as already paid."
      permissions={["finance.view"]}
      actions={can("finance.bill.manage") && <>
        <Button size="sm" onClick={() => setVendorOpen(true)}><Plus /> Vendor</Button>
        <Button size="sm" onClick={() => setOpen("expense")}><Plus /> Expense</Button>
        <Button size="sm" variant="primary" onClick={() => setOpen("bill")}><Plus /> Vendor bill</Button>
      </>}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="bills">Bills & expenses</TabsTrigger><TabsTrigger value="vendors">Vendors</TabsTrigger></TabsList>
        <TabsContent value="bills" className="pt-4">
          <Section flush>
            <SimpleTable label="Bills" rows={bills.data} rowKey={(b) => b.id} loading={bills.isLoading} error={bills.error}
              empty={<EmptyState title="No bills yet" />}
              columns={[
                { key: "n", header: "Bill", cell: (b) => <div><div className="font-medium">{b.description}</div><div className="text-fg-subtle text-xs">{b.number}{b.vendorBillNo ? ` · ${b.vendorBillNo}` : ""} · {b.expenseAccountName}</div></div> },
                { key: "v", header: "Vendor", cell: (b) => b.vendorName ?? (b.kind === "expense" ? "Expense" : "—"), hideBelow: "sm" },
                { key: "d", header: "Date", cell: (b) => formatDate(b.billDate), hideBelow: "md" },
                { key: "g", header: "GST", align: "right", cell: (b) => <Money value={(Number(b.cgst) + Number(b.sgst) + Number(b.igst)).toFixed(2)} muted />, hideBelow: "lg" },
                { key: "t", header: "TDS", align: "right", cell: (b) => <Money value={b.tdsAmount} muted />, hideBelow: "lg" },
                { key: "p", header: "Payable", align: "right", cell: (b) => <Money value={b.payable} /> },
                { key: "s", header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
                { key: "x", header: "", align: "right", cell: (b) => b.kind === "bill" && b.status !== "paid" && can("finance.bill.manage") && <Button size="xs" variant="ghost" onClick={() => setPaying(b)}>Pay</Button> },
              ]} />
          </Section>
        </TabsContent>
        <TabsContent value="vendors" className="pt-4">
          <Section flush>
            <SimpleTable label="Vendors" rows={vendors.data} rowKey={(v) => v.id} loading={vendors.isLoading}
              empty={<EmptyState title="No vendors yet" />}
              columns={[
                { key: "n", header: "Vendor", cell: (v) => v.name },
                { key: "g", header: "GSTIN", cell: (v) => <span className="font-mono text-xs">{v.gstin ?? "Unregistered"}</span> },
                { key: "o", header: "Outstanding", align: "right", cell: (v) => <Money value={v.outstanding} /> },
              ]} />
          </Section>
        </TabsContent>
      </Tabs>
      {open && <BillDialog kind={open} vendors={vendors.data ?? []} onClose={() => setOpen(null)} />}
      {vendorOpen && <VendorDialog onClose={() => setVendorOpen(false)} />}
      {paying && <PayDialog bill={paying} onClose={() => setPaying(null)} />}
    </ModulePage>
  );
}

function BillDialog({ kind, vendors, onClose }: { kind: "bill" | "expense"; vendors: Vendor[]; onClose: () => void }) {
  const [v, setV] = useState({ vendorId: "", vendorBillNo: "", billDate: today(), dueDate: "", description: "", expenseAccountId: "", taxable: "", gstRate: "18", interState: false, itcEligible: true, tdsSection: "", tdsAmount: "0", paidFromAccountId: "" });
  // One key per open form: a double-click or retry replays instead of posting twice.
  const [idemKey] = useState(() => `bill-${crypto.randomUUID()}`);
  const m = useApiMutation("POST", "/bills", { invalidate: [["bills"], ["vendors"], ["finance"]], success: kind === "bill" ? "Bill recorded" : "Expense recorded", headers: () => ({ "Idempotency-Key": idemKey }) });
  const set = (k: string, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  const gst = (Number(v.taxable) || 0) * (Number(v.gstRate) || 0) / 100;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...v, kind, vendorId: v.vendorId || null, dueDate: v.dueDate || undefined, paidFromAccountId: v.paidFromAccountId || undefined }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>{kind === "bill" ? "Record vendor bill" : "Record expense"}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-3">
            {kind === "bill" && <Field label="Vendor" htmlFor="bv" required className="sm:col-span-2"><NativeSelect id="bv" value={v.vendorId} onChange={(e) => set("vendorId", e.target.value)}><option value="">Choose…</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>}
            {kind === "bill" && <Field label="Vendor's bill no." htmlFor="bn"><Input id="bn" value={v.vendorBillNo} onChange={(e) => set("vendorBillNo", e.target.value)} /></Field>}
            <Field label="Description" htmlFor="bd" required className="sm:col-span-2"><Input id="bd" value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <Field label="Date" htmlFor="bdt"><Input id="bdt" type="date" value={v.billDate} onChange={(e) => set("billDate", e.target.value)} /></Field>
            <Field label="Expense account" htmlFor="ba" required className="sm:col-span-2"><AccountSelect id="ba" value={v.expenseAccountId} onChange={(id) => set("expenseAccountId", id)} filter={(a) => a.type === "expense" || (a.type === "asset" && !a.isBank && !a.systemKey)} /></Field>
            {kind === "bill" ? <Field label="Due" htmlFor="bdu" hint="Default 30 days"><Input id="bdu" type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
              : <Field label="Paid from" htmlFor="bp" required><AccountSelect id="bp" value={v.paidFromAccountId} onChange={(id) => set("paidFromAccountId", id)} filter={(a) => a.isBank} /></Field>}
            <Field label="Taxable value (₹)" htmlFor="bt" required><Input id="bt" inputMode="decimal" value={v.taxable} onChange={(e) => set("taxable", e.target.value)} /></Field>
            <Field label="GST rate %" htmlFor="bg" hint={`GST ≈ ₹${gst.toFixed(2)}`}><Input id="bg" inputMode="decimal" value={v.gstRate} onChange={(e) => set("gstRate", e.target.value)} /></Field>
            <Field label="TDS withheld (₹)" htmlFor="btd" hint="e.g. 194J professional fees"><Input id="btd" inputMode="decimal" value={v.tdsAmount} onChange={(e) => set("tdsAmount", e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.interState} onChange={(e) => set("interState", e.target.checked)} /> Inter-state (IGST)</label>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={v.itcEligible} onChange={(e) => set("itcEligible", e.target.checked)} /> Input tax credit claimable (vendor is GST-registered and the bill is in GSTR-2B)</label>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!v.expenseAccountId || !v.taxable || (kind === "bill" && !v.vendorId)}>Record</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VendorDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ name: "", gstin: "", email: "", phone: "" });
  const m = useApiMutation("POST", "/vendors", { invalidate: [["vendors"]], success: "Vendor added" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(v, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>New vendor</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="vn" required className="sm:col-span-2"><Input id="vn" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="GSTIN" htmlFor="vg" hint="Checksum is verified"><Input id="vg" value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="Phone" htmlFor="vp"><Input id="vp" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
            <Field label="Email" htmlFor="ve" className="sm:col-span-2"><Input id="ve" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={v.name.length < 2}>Add vendor</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [account, setAccount] = useState("");
  // One key per dialog: a double-click or retry replays instead of paying twice.
  const [key] = useState(() => `bill-pay-${crypto.randomUUID()}`);
  const m = useApiMutation<object>("POST", `/bills/${bill.id}/payments`, { invalidate: [["bills"], ["vendors"], ["finance"]], success: "Payment recorded", headers: () => ({ "Idempotency-Key": key }) });
  return (
    <PromptDialog open onOpenChange={(o) => !o && onClose()} title={`Pay ${bill.vendorName}`} description={`Outstanding ₹${bill.outstanding}. TDS of ₹${bill.tdsAmount} stays payable to the government.`} label="Amount (₹)" placeholder={bill.outstanding} confirmLabel="Record payment" required={false} busy={m.isPending}
      onSubmit={(amount) => m.mutate({ paymentDate: today(), amount: amount || bill.outstanding, paidFromAccountId: account }, { onSuccess: onClose })}>
      <Field label="Paid from" htmlFor="pf" required><AccountSelect id="pf" value={account} onChange={setAccount} filter={(a) => a.isBank} /></Field>
    </PromptDialog>
  );
}
