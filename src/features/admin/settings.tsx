"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ModulePage, Section, SimpleTable, StatusBadge } from "@/components/module/kit";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/formatting";

interface S {
  organization: { name: string; legalName: string; gstin: string | null; stateCode: string | null };
  profile: { address: string; email: string; phone: string; docPrefix: string; bank: { name: string; account: string; ifsc: string; branch: string } | null };
  quotations: { discountApprovalPct: number; valueApprovalAbove: string; validityDays: number };
  projects: { requireApprovedScope: boolean; requireAdvancePct: number };
  finance: { invoiceDueDays: number };
  payroll: { pf: { enabled: boolean; employeeRate: string; employerRate: string; wageCap: string }; esi: { enabled: boolean; employeeRate: string; employerRate: string; grossLimit: string }; professionalTax: { enabled: boolean; monthlyAmount: string; grossAbove: string } };
}

export function SettingsView() {
  const s = useApi<S>(["admin", "settings"], "/admin/settings");
  const outbox = useApi<{ id: string; channel: string; recipient: string; template: string; status: string; lastError: string | null; createdAt: string }[]>(["admin", "outbox"], "/admin/outbox");
  return (
    <ModulePage title="Settings" description="Organisation profile used on quotations and invoices, approval thresholds, activation rules and payroll statutory rates. Every change is audited." permissions={["settings.manage"]}>
      {s.data && <SettingsForm initial={s.data} />}
      <Section title="Message delivery" description="Email and SMS go through a provider. Without one, messages are marked blocked here instead of silently disappearing." flush className="mt-5">
        <SimpleTable label="Outbox" rows={outbox.data} rowKey={(m) => m.id} loading={outbox.isLoading} empty={<p className="text-fg-muted px-4 py-5 text-center text-[13px]">No messages yet.</p>}
          columns={[{ key: "t", header: "When", cell: (m) => formatDateTime(m.createdAt) }, { key: "c", header: "Channel", cell: (m) => m.channel }, { key: "r", header: "To", cell: (m) => m.recipient }, { key: "p", header: "Template", cell: (m) => m.template, hideBelow: "md" }, { key: "s", header: "Status", cell: (m) => <StatusBadge status={m.status === "sent" ? "succeeded" : m.status} label={m.status} /> }, { key: "e", header: "", cell: (m) => <span className="text-fg-subtle text-xs">{m.lastError}</span>, hideBelow: "lg" }]} />
      </Section>
    </ModulePage>
  );
}

function SettingsForm({ initial }: { initial: S }) {
  const [v, setV] = useState(initial);
  const save = useApiMutation<object>("PUT", "/admin/settings", { invalidate: [["admin"], ["org"]], success: "Settings saved" });
  const set = <K extends keyof S>(k: K, patch: Partial<S[K]>) => setV((s) => ({ ...s, [k]: { ...(s[k] as object), ...patch } }));
  const pr = v.payroll;
  const bank = v.profile.bank ?? { name: "", account: "", ifsc: "", branch: "" };
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate({ organization: { legalName: v.organization.legalName, gstin: v.organization.gstin || null }, profile: { ...v.profile, bank: bank.account ? bank : null }, quotations: v.quotations, projects: v.projects, finance: v.finance, payroll: v.payroll }); }}>
      <Section title="Organisation">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Legal name" htmlFor="ol" required><Input id="ol" value={v.organization.legalName} onChange={(e) => set("organization", { legalName: e.target.value })} /></Field>
          <Field label="GSTIN" htmlFor="og" hint="Its state decides CGST/SGST vs IGST on every document"><Input id="og" value={v.organization.gstin ?? ""} onChange={(e) => set("organization", { gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Document prefix" htmlFor="op" hint="ZV → ZV/INV/2627/0001"><Input id="op" value={v.profile.docPrefix} onChange={(e) => set("profile", { docPrefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="Address (printed on documents)" htmlFor="oa" className="sm:col-span-3"><Textarea id="oa" value={v.profile.address} onChange={(e) => set("profile", { address: e.target.value })} /></Field>
          <Field label="Email" htmlFor="oe"><Input id="oe" value={v.profile.email} onChange={(e) => set("profile", { email: e.target.value })} /></Field>
          <Field label="Phone" htmlFor="oph"><Input id="oph" value={v.profile.phone} onChange={(e) => set("profile", { phone: e.target.value })} /></Field>
        </div>
      </Section>
      <Section title="Bank details (printed on quotations & invoices)">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Bank" htmlFor="bn"><Input id="bn" value={bank.name} onChange={(e) => set("profile", { bank: { ...bank, name: e.target.value } })} /></Field>
          <Field label="Account no." htmlFor="ba"><Input id="ba" value={bank.account} onChange={(e) => set("profile", { bank: { ...bank, account: e.target.value } })} /></Field>
          <Field label="IFSC" htmlFor="bi"><Input id="bi" value={bank.ifsc} onChange={(e) => set("profile", { bank: { ...bank, ifsc: e.target.value.toUpperCase() } })} /></Field>
          <Field label="Branch" htmlFor="bb"><Input id="bb" value={bank.branch} onChange={(e) => set("profile", { bank: { ...bank, branch: e.target.value } })} /></Field>
        </div>
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Quotation approvals">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Discount above %" htmlFor="qd"><Input id="qd" inputMode="decimal" value={v.quotations.discountApprovalPct} onChange={(e) => set("quotations", { discountApprovalPct: Number(e.target.value) || 0 })} /></Field>
            <Field label="Total above ₹" htmlFor="qv"><Input id="qv" value={v.quotations.valueApprovalAbove} onChange={(e) => set("quotations", { valueApprovalAbove: e.target.value })} /></Field>
            <Field label="Validity days" htmlFor="qn"><Input id="qn" inputMode="numeric" value={v.quotations.validityDays} onChange={(e) => set("quotations", { validityDays: Number(e.target.value) || 15 })} /></Field>
          </div>
        </Section>
        <Section title="Projects & invoicing">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={v.projects.requireApprovedScope} onChange={(e) => set("projects", { requireApprovedScope: e.target.checked })} /> Activation needs an approved BRD/PRD</label>
            <Field label="Advance required before activation %" htmlFor="pa"><Input id="pa" inputMode="decimal" value={v.projects.requireAdvancePct} onChange={(e) => set("projects", { requireAdvancePct: Number(e.target.value) || 0 })} /></Field>
            <Field label="Invoice due in days" htmlFor="fd"><Input id="fd" inputMode="numeric" value={v.finance.invoiceDueDays} onChange={(e) => set("finance", { invoiceDueDays: Number(e.target.value) || 0 })} /></Field>
          </div>
        </Section>
      </div>
      <Section title="Payroll statutory settings" description="Defaults reflect common rules (PF 12% on basic up to ₹15,000; ESI 0.75%/3.25% up to ₹21,000 gross). Professional tax differs by state. Confirm with your CA before the first run.">
        <div className="grid gap-4 sm:grid-cols-3">
          <fieldset className="space-y-2"><legend className="text-[13px] font-medium"><label className="flex items-center gap-2"><input type="checkbox" checked={pr.pf.enabled} onChange={(e) => setV({ ...v, payroll: { ...pr, pf: { ...pr.pf, enabled: e.target.checked } } })} /> Provident fund</label></legend>
            <Field label="Employee %" htmlFor="pfe"><Input id="pfe" value={pr.pf.employeeRate} onChange={(e) => setV({ ...v, payroll: { ...pr, pf: { ...pr.pf, employeeRate: e.target.value } } })} /></Field>
            <Field label="Employer %" htmlFor="pfr"><Input id="pfr" value={pr.pf.employerRate} onChange={(e) => setV({ ...v, payroll: { ...pr, pf: { ...pr.pf, employerRate: e.target.value } } })} /></Field>
            <Field label="Basic wage cap ₹" htmlFor="pfc"><Input id="pfc" value={pr.pf.wageCap} onChange={(e) => setV({ ...v, payroll: { ...pr, pf: { ...pr.pf, wageCap: e.target.value } } })} /></Field>
          </fieldset>
          <fieldset className="space-y-2"><legend className="text-[13px] font-medium"><label className="flex items-center gap-2"><input type="checkbox" checked={pr.esi.enabled} onChange={(e) => setV({ ...v, payroll: { ...pr, esi: { ...pr.esi, enabled: e.target.checked } } })} /> ESI</label></legend>
            <Field label="Employee %" htmlFor="ese"><Input id="ese" value={pr.esi.employeeRate} onChange={(e) => setV({ ...v, payroll: { ...pr, esi: { ...pr.esi, employeeRate: e.target.value } } })} /></Field>
            <Field label="Employer %" htmlFor="esr"><Input id="esr" value={pr.esi.employerRate} onChange={(e) => setV({ ...v, payroll: { ...pr, esi: { ...pr.esi, employerRate: e.target.value } } })} /></Field>
            <Field label="Gross limit ₹" htmlFor="esl"><Input id="esl" value={pr.esi.grossLimit} onChange={(e) => setV({ ...v, payroll: { ...pr, esi: { ...pr.esi, grossLimit: e.target.value } } })} /></Field>
          </fieldset>
          <fieldset className="space-y-2"><legend className="text-[13px] font-medium"><label className="flex items-center gap-2"><input type="checkbox" checked={pr.professionalTax.enabled} onChange={(e) => setV({ ...v, payroll: { ...pr, professionalTax: { ...pr.professionalTax, enabled: e.target.checked } } })} /> Professional tax</label></legend>
            <Field label="Monthly amount ₹" htmlFor="pta"><Input id="pta" value={pr.professionalTax.monthlyAmount} onChange={(e) => setV({ ...v, payroll: { ...pr, professionalTax: { ...pr.professionalTax, monthlyAmount: e.target.value } } })} /></Field>
            <Field label="When gross above ₹" htmlFor="ptg"><Input id="ptg" value={pr.professionalTax.grossAbove} onChange={(e) => setV({ ...v, payroll: { ...pr, professionalTax: { ...pr.professionalTax, grossAbove: e.target.value } } })} /></Field>
          </fieldset>
        </div>
      </Section>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={save.isPending}>Save settings</Button></div>
    </form>
  );
}
