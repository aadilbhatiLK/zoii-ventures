"use client";

import { useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, NativeSelect, Section, SimpleTable, StatusBadge, Tag } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { AUTOMATION_TRIGGERS, type AutomationRule, type AutomationRun, type AutomationTrigger } from "@/lib/api/modules/people";
import { ROLES } from "@/lib/permissions";
import { formatDateTime } from "@/lib/formatting";

export function AutomationsView() {
  const { can } = useAuth();
  const rules = useApi<AutomationRule[]>(["automations"], "/automations");
  const runs = useApi<AutomationRun[]>(["automations", "runs"], "/automations/runs");
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const toggle = useApiMutation<AutomationRule>("PUT", (r) => `/automations/${r.id}`, { invalidate: [["automations"]], success: "Rule updated" });
  const runNow = useApiMutation<undefined, { events: number; fired: number; scheduled: number }>("POST", "/automations/run-now", { invalidate: [["automations"]], success: (r) => `Processed ${r.events} event(s); ${r.fired + r.scheduled} action run(s)` });
  return (
    <ModulePage title="Automations" description="When something happens (or on a schedule), if conditions match, notify people or queue an email. Each rule runs at most once per event or subject, and only for events after it was created."
      permissions={["automations.manage"]}
      actions={<>{(can("settings.manage")) && <Button size="sm" loading={runNow.isPending} onClick={() => runNow.mutate(undefined)}><Play /> Run worker now</Button>}<Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus /> New rule</Button></>}>
      <div className="space-y-5">
        <Section flush title="Rules">
          <SimpleTable label="Rules" rows={rules.data} rowKey={(r) => r.id} onRowClick={setEditing} loading={rules.isLoading} error={rules.error}
            empty={<EmptyState title="No rules yet" description="Example: when an invoice is issued above ₹50,000, notify the account manager." />}
            columns={[
              { key: "n", header: "Rule", cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-fg-subtle text-xs">{AUTOMATION_TRIGGERS[r.trigger]}</div></div> },
              { key: "a", header: "Actions", cell: (r) => <span className="text-fg-muted text-xs">{r.actions.map((a) => `${a.type} → ${a.to}`).join(", ")}</span>, hideBelow: "md" },
              { key: "r", header: "Runs", align: "right", cell: (r) => r.runs, hideBelow: "sm" },
              { key: "l", header: "Last run", cell: (r) => (r.lastRunAt ? formatDateTime(r.lastRunAt) : "—"), hideBelow: "lg" },
              { key: "e", header: "", align: "right", cell: (r) => <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); toggle.mutate({ ...r, enabled: !r.enabled }); }}>{r.enabled ? <Tag tone="success">On</Tag> : <Tag>Off</Tag>}</Button> },
            ]} />
        </Section>
        <Section flush title="Recent runs">
          <SimpleTable label="Runs" rows={runs.data} rowKey={(r) => r.id} loading={runs.isLoading} empty={<p className="text-fg-muted px-4 py-5 text-center text-[13px]">The worker runs every minute; results appear here.</p>}
            columns={[{ key: "t", header: "When", cell: (r) => formatDateTime(r.startedAt) }, { key: "r", header: "Rule", cell: (r) => r.ruleName }, { key: "s", header: "Result", cell: (r) => <StatusBadge status={r.status} /> }, { key: "d", header: "Detail", cell: (r) => <span className="text-fg-muted text-xs">{r.detail}</span>, hideBelow: "md" }]} />
        </Section>
      </div>
      {editing && <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </ModulePage>
  );
}

type Cond = AutomationRule["conditions"][number];
type Act = AutomationRule["actions"][number];
function RuleDialog({ rule, onClose }: { rule: AutomationRule | null; onClose: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(rule?.trigger ?? "invoice.issued");
  const [conds, setConds] = useState<Cond[]>(rule?.conditions ?? []);
  const [acts, setActs] = useState<Act[]>(rule?.actions ?? [{ type: "notify", to: "owner", title: "", body: "" }]);
  const save = useApiMutation<object>(rule ? "PUT" : "POST", rule ? `/automations/${rule.id}` : "/automations", { invalidate: [["automations"]], success: "Rule saved" });
  const del = useApiMutation("DELETE", `/automations/${rule?.id}`, { invalidate: [["automations"]], success: "Rule disabled" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate({ name, trigger, conditions: conds.map((c) => ({ ...c, value: c.op === "in" ? String(c.value).split(",").map((s) => s.trim()) : c.op === "gte" || c.op === "lte" ? Number(c.value) : c.value })), actions: acts, enabled: rule?.enabled ?? true }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>{rule ? "Edit rule" : "New automation rule"}</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="rn" required><Input id="rn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="When" htmlFor="rt"><NativeSelect id="rt" value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}>{Object.entries(AUTOMATION_TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Only if (all must match)</p>
              {conds.map((c, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_90px_1fr_auto] gap-2">
                  <Input aria-label="Field" placeholder="total / priority / stage" value={c.field} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} />
                  <NativeSelect aria-label="Operator" value={c.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value as Cond["op"] } : x)))}><option value="eq">=</option><option value="neq">≠</option><option value="gte">≥</option><option value="lte">≤</option><option value="in">in</option></NativeSelect>
                  <Input aria-label="Value" value={String(c.value)} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <Button type="button" size="icon-sm" variant="danger-ghost" aria-label="Remove" onClick={() => setConds(conds.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" size="xs" onClick={() => setConds([...conds, { field: "", op: "eq", value: "" }])}><Plus /> Condition</Button>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Then</p>
              {acts.map((a, i) => (
                <div key={i} className="border-border mb-2 grid gap-2 rounded-md border p-2 sm:grid-cols-2">
                  <NativeSelect aria-label="Action" value={a.type} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, type: e.target.value as Act["type"] } : x)))}><option value="notify">In-app notification</option><option value="email">Email (via outbox)</option></NativeSelect>
                  <NativeSelect aria-label="To" value={a.to} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}>
                    <option value="owner">Record owner</option><option value="assignee">Assignee</option><option value="account_manager">Client&apos;s account manager</option>
                    {Object.entries(ROLES).map(([k, v]) => <option key={k} value={`role:${k}`}>Everyone with role: {v}</option>)}
                  </NativeSelect>
                  <Input aria-label="Title" className="sm:col-span-2" placeholder="Invoice {{number}} issued to {{client_name}}" value={a.title} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <Textarea aria-label="Body" className="sm:col-span-2" placeholder="Total {{total}}, due {{due_date}}" value={a.body} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
                </div>
              ))}
              <p className="text-fg-muted text-xs">Use {"{{field}}"} to insert values from the record, e.g. {"{{number}}"}, {"{{total}}"}, {"{{subject}}"}.</p>
            </div>
          </DialogBody>
          <DialogFooter>
            {rule && <Button type="button" size="sm" variant="danger-ghost" className="mr-auto" loading={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: onClose })}>Disable</Button>}
            <Button type="button" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" variant="primary" loading={save.isPending} disabled={name.length < 3 || acts.some((a) => a.title.length < 3)}>Save rule</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
