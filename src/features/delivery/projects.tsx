"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ClipboardCheck, GitPullRequestArrow, Plus, Rocket, Signature, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, Money, NativeSelect, PromptDialog, Section, SimpleTable, StatusBadge, Tag } from "@/components/module/kit";
import { UserName, UserSelect } from "@/components/module/pickers";
import { NewProjectDialog } from "@/features/sales/orders";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { TASK_STATUSES, type Milestone, type Project, type ProjectDetail, type Task, type TaskStatus } from "@/lib/api/modules/delivery";
import type { Invoice } from "@/lib/api/modules/finance";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";

export function ProjectsView() {
  const router = useRouter();
  const { can, user } = useAuth();
  const list = useApi<Project[]>(["projects"], "/projects");
  const [open, setOpen] = useState(false);
  return (
    <ModulePage title="Projects" description="Billable projects run only against an accepted quotation (sales order) and, by default, an approved scope document."
      permissions={["projects.view", "projects.manage", "tasks.update_assigned"]}
      actions={can("projects.manage") && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> New project</Button>}>
      <Section flush>
        <SimpleTable label="Projects" rows={list.data} rowKey={(p) => p.id} href={(p) => `/projects/${p.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No projects yet" description="Start one from a sales order once the client accepts the quotation." />}
          columns={[
            { key: "n", header: "Project", cell: (p) => p.name },
            { key: "c", header: "Client", cell: (p) => p.clientName, hideBelow: "sm" },
            { key: "s", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { key: "m", header: "Manager", cell: (p) => <UserName id={p.managerId} />, hideBelow: "md" },
            { key: "t", header: "Tasks", cell: (p) => { const done = p.taskCounts.done ?? 0; const all = Object.values(p.taskCounts).reduce((a, b) => a + b, 0); return all ? `${done}/${all} done` : "—"; }, hideBelow: "md" },
            { key: "d", header: "Due", cell: (p) => formatDate(p.dueDate), hideBelow: "lg" },
          ]} />
      </Section>
      {open && <NewProjectDialog managerId={user?.id ?? ""} onClose={() => setOpen(false)} onCreated={(id) => router.push(`/projects/${id}`)} />}
    </ModulePage>
  );
}

export function ProjectDetailView({ id }: { id: string }) {
  const { can } = useAuth();
  const p = useApi<ProjectDetail>(["project", id], `/projects/${id}`);
  const inv = { invalidate: [["project", id], ["projects"], ["approvals"], ["tasks"]] };
  const activate = useApiMutation("POST", `/projects/${id}/activate`, { ...inv, success: "Project activated" });
  const update = useApiMutation<object>("PATCH", `/projects/${id}`, { ...inv, success: "Project updated" });
  const [tab, setTab] = useState("milestones");
  const x = p.data;
  if (p.error) return <ModulePage title="Project" permissions={[]}><EmptyState title="Project not found" /></ModulePage>;
  return (
    <ModulePage title={x?.name ?? "Project"} permissions={["projects.view", "projects.manage", "tasks.update_assigned"]} meta={x && <StatusBadge status={x.status} />}
      description={<BackLink href="/projects">← All projects</BackLink>}
      actions={x && <>
        {x.status === "planned" && can("projects.activate") && <Button size="sm" variant="primary" loading={activate.isPending} disabled={x.activation.some((c) => !c.ok)} onClick={() => activate.mutate(undefined)}><Rocket /> Activate</Button>}
        {x.status === "active" && can("projects.manage") && <Button size="sm" onClick={() => update.mutate({ status: "on_hold" })}>Put on hold</Button>}
        {x.status === "on_hold" && can("projects.manage") && <Button size="sm" onClick={() => update.mutate({ status: "active" })}>Resume</Button>}
        {x.status === "active" && can("projects.manage") && <Button size="sm" onClick={() => update.mutate({ status: "completed" })}>Complete</Button>}
      </>}>
      {x && (
        <div className="space-y-5">
          <Section>
            <KeyValues cols={4} items={[["Code", x.code], ["Client", <Link key="c" href={`/clients/${x.clientId}`} className="hover:underline">{x.clientName}</Link>], ["Sales order", x.salesOrderId ? <Link key="s" href={`/sales-orders/${x.salesOrderId}`} className="font-mono text-xs hover:underline">{x.salesOrderNumber}</Link> : "—"], ["Manager", <UserName key="m" id={x.managerId} />], ["Start", formatDate(x.startDate)], ["Due", formatDate(x.dueDate)], ["Activated", x.activatedAt ? formatDateTime(x.activatedAt) : "—"], ["Scope document", x.scopeDocumentId ? <Link key="d" href={`/documents/${x.scopeDocumentId}`} className="text-accent hover:underline">Open</Link> : "—"]]} />
          </Section>
          {x.status === "planned" && (
            <Section title="Activation checklist" description="Every check must pass. They're enforced again on the server when you activate.">
              <ul className="space-y-2 text-[13px]">
                {x.activation.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" /> : <XCircle className="text-danger mt-0.5 size-4 shrink-0" />}
                    <span><span className="font-medium">{c.label}</span> <span className="text-fg-muted">— {c.detail}</span></span>
                  </li>
                ))}
              </ul>
              {can("projects.manage") && !x.salesOrderId && <LinkOrder projectId={id} clientId={x.clientId} />}
            </Section>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="milestones">Milestones & UAT</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="changes">Change requests</TabsTrigger>
            </TabsList>
            <TabsContent value="milestones" className="pt-4"><Milestones project={x} /></TabsContent>
            <TabsContent value="tasks" className="pt-4"><TaskBoard projectId={id} project={x} /></TabsContent>
            <TabsContent value="changes" className="pt-4"><ChangeRequests project={x} /></TabsContent>
          </Tabs>
        </div>
      )}
    </ModulePage>
  );
}

function LinkOrder({ projectId, clientId }: { projectId: string; clientId: string }) {
  const orders = useApi<{ id: string; number: string; clientId: string; status: string }[]>(["sales-orders"], "/sales-orders");
  const [so, setSo] = useState("");
  const m = useApiMutation<object>("PATCH", `/projects/${projectId}`, { invalidate: [["project", projectId]], success: "Sales order linked" });
  const options = (orders.data ?? []).filter((o) => o.clientId === clientId && o.status === "open");
  return (
    <div className="mt-4 flex flex-wrap items-end gap-2">
      <Field label="Link a sales order" htmlFor="lso" className="w-64"><NativeSelect id="lso" value={so} onChange={(e) => setSo(e.target.value)}><option value="">{options.length ? "Choose…" : "No open orders for this client"}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}</NativeSelect></Field>
      <Button size="sm" disabled={!so} loading={m.isPending} onClick={() => m.mutate({ salesOrderId: so })}>Link</Button>
    </div>
  );
}

function Milestones({ project }: { project: ProjectDetail }) {
  const { can } = useAuth();
  const router = useRouter();
  const id = project.id;
  const inv = { invalidate: [["project", id]] };
  const add = useApiMutation<object>("POST", `/projects/${id}/milestones`, { ...inv, success: "Milestone added" });
  const addUat = useApiMutation<{ mid: string; title: string }>("POST", (b) => `/milestones/${b.mid}/uat`, inv);
  const result = useApiMutation<{ uid: string; status: string; testedByName?: string }>("POST", (b) => `/uat/${b.uid}/result`, inv);
  const setStatus = useApiMutation<{ mid: string; status: string }>("POST", (b) => `/milestones/${b.mid}/status`, inv);
  const invoice = useApiMutation<{ mid: string }, Invoice>("POST", (b) => `/invoices/from-milestone/${b.mid}`, { invalidate: [["project", id], ["invoices"]], success: "Draft invoice created" });
  const [newOpen, setNewOpen] = useState(false);
  const [uatFor, setUatFor] = useState<string | null>(null);
  const [signFor, setSignFor] = useState<Milestone | null>(null);
  const manage = can("projects.manage");
  const active = project.status === "active";
  return (
    <div className="space-y-4">
      {manage && project.status !== "completed" && <div className="flex justify-end"><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> Milestone</Button></div>}
      {!project.milestones.length && <Section><EmptyState title="No milestones" description="Split the work into billable milestones; each needs passing UAT and client sign-off before it can be invoiced." /></Section>}
      {project.milestones.map((m) => {
        const allPassed = m.uat.length > 0 && m.uat.every((u) => u.status === "passed");
        return (
          <Section key={m.id} title={`${m.seq}. ${m.name}`} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={m.status} />{Number(m.amount) > 0 && <Money value={m.amount} />}{m.dueDate && <span>Due {formatDate(m.dueDate)}</span>}</span>}
            actions={<>
              {manage && active && ["pending", "in_progress"].includes(m.status) && <Button size="xs" variant="ghost" onClick={() => setStatus.mutate({ mid: m.id, status: m.status === "pending" ? "in_progress" : "uat" })}>{m.status === "pending" ? "Start" : "Move to UAT"}</Button>}
              {manage && !["signed_off", "invoiced"].includes(m.status) && <Button size="xs" variant="ghost" onClick={() => setUatFor(m.id)}><ClipboardCheck /> Add UAT check</Button>}
              {manage && !["signed_off", "invoiced"].includes(m.status) && <Button size="xs" variant={allPassed ? "primary" : "secondary"} disabled={!allPassed} onClick={() => setSignFor(m)}><Signature /> Record sign-off</Button>}
              {m.status === "signed_off" && Number(m.amount) > 0 && can("finance.invoice.issue") && !m.invoiceId && <Button size="xs" variant="primary" loading={invoice.isPending} onClick={() => invoice.mutate({ mid: m.id }, { onSuccess: (i) => router.push(`/finance/invoices/${i.id}`) })}>Create invoice</Button>}
              {m.invoiceId && <Button asChild size="xs" variant="ghost"><Link href={`/finance/invoices/${m.invoiceId}`}>View invoice</Link></Button>}
            </>}>
            {m.uat.length ? (
              <ul className="divide-border divide-y text-[13px]">
                {m.uat.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
                    {u.status === "passed" ? <CheckCircle2 className="text-success size-4" /> : u.status === "failed" ? <XCircle className="text-danger size-4" /> : <Circle className="text-fg-subtle size-4" />}
                    <span className="min-w-0 flex-1">{u.title}{u.notes && <span className="text-fg-muted"> — {u.notes}</span>}{u.testedByName && <span className="text-fg-subtle text-xs"> · tested by {u.testedByName}</span>}</span>
                    {manage && !["signed_off", "invoiced"].includes(m.status) && <span className="flex gap-1"><Button size="xs" variant="ghost" onClick={() => result.mutate({ uid: u.id, status: "passed" })}>Pass</Button><Button size="xs" variant="danger-ghost" onClick={() => result.mutate({ uid: u.id, status: "failed" })}>Fail</Button></span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-fg-muted text-[13px]">No UAT checks yet.</p>}
            {m.signoff && <p className="bg-success-soft mt-3 rounded-md p-2 text-xs">Signed off by <b>{m.signoff.signedByName}</b> on {formatDateTime(m.signoff.signedAt)} via {m.signoff.method.replace("_", " ")} — {m.signoff.evidenceRef}</p>}
          </Section>
        );
      })}
      {newOpen && <MilestoneDialog busy={add.isPending} onClose={() => setNewOpen(false)} onSave={(b) => add.mutate(b, { onSuccess: () => setNewOpen(false) })} />}
      <PromptDialog open={!!uatFor} onOpenChange={(o) => !o && setUatFor(null)} title="Add UAT check" label="What will the client verify?" placeholder="Invoice PDF shows client GSTIN and place of supply" confirmLabel="Add" busy={addUat.isPending}
        onSubmit={(title) => uatFor && addUat.mutate({ mid: uatFor, title }, { onSuccess: () => setUatFor(null) })} />
      {signFor && <SignoffDialog milestone={signFor} projectId={id} onClose={() => setSignFor(null)} />}
    </div>
  );
}

function MilestoneDialog({ onClose, onSave, busy }: { onClose: () => void; onSave: (b: object) => void; busy: boolean }) {
  const [v, setV] = useState({ name: "", amount: "0", dueDate: "" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ name: v.name, amount: v.amount.trim() || "0", dueDate: v.dueDate || null }); }}>
          <DialogHeader><DialogTitle>New milestone</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="mn" required className="sm:col-span-2"><Input id="mn" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Phase 1 — billing & GST invoices" /></Field>
            <Field label="Billing amount (₹, before GST)" htmlFor="ma" hint="0 if this milestone isn't billed separately"><Input id="ma" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
            <Field label="Due" htmlFor="md"><Input id="md" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={busy} disabled={v.name.trim().length < 2}>Add milestone</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignoffDialog({ milestone, projectId, onClose }: { milestone: Milestone; projectId: string; onClose: () => void }) {
  const [v, setV] = useState({ signedByName: "", signedByEmail: "", method: "email_confirmation", evidenceRef: "", signedAt: new Date().toISOString().slice(0, 16) });
  const m = useApiMutation("POST", `/milestones/${milestone.id}/sign-off`, { invalidate: [["project", projectId]], success: "Sign-off recorded" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...v, signedAt: new Date(v.signedAt).toISOString() }, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>Client sign-off: {milestone.name}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <p className="text-fg-muted text-[13px] sm:col-span-2">E-signature isn&apos;t connected. The record is permanent (it can&apos;t be edited or deleted), so capture exactly how the client confirmed.</p>
            <Field label="Signed by" htmlFor="sn" required><Input id="sn" value={v.signedByName} onChange={(e) => setV({ ...v, signedByName: e.target.value })} /></Field>
            <Field label="Their email" htmlFor="se"><Input id="se" type="email" value={v.signedByEmail} onChange={(e) => setV({ ...v, signedByEmail: e.target.value })} /></Field>
            <Field label="How" htmlFor="sm"><NativeSelect id="sm" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}><option value="email_confirmation">Email confirmation</option><option value="signed_document">Signed document</option><option value="in_person">In person</option></NativeSelect></Field>
            <Field label="When" htmlFor="sw"><Input id="sw" type="datetime-local" value={v.signedAt} onChange={(e) => setV({ ...v, signedAt: e.target.value })} /></Field>
            <Field label="Evidence reference" htmlFor="sr" required className="sm:col-span-2" hint="Email subject + date, or the file name of the signed PDF"><Input id="sr" value={v.evidenceRef} onChange={(e) => setV({ ...v, evidenceRef: e.target.value })} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={v.signedByName.length < 2 || v.evidenceRef.length < 3}>Record sign-off</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const COLS: TaskStatus[] = ["todo", "in_progress", "review", "blocked", "done"];

function TaskBoard({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const { can, user } = useAuth();
  const tasks = useApi<Task[]>(["tasks", projectId], `/projects/${projectId}/tasks`);
  const move = useApiMutation<{ id: string; status: TaskStatus; expectedUpdatedAt: string }>("POST", (b) => `/tasks/${b.id}/move`, { invalidate: [["tasks"], ["project", projectId]] });
  const add = useApiMutation<object>("POST", `/projects/${projectId}/tasks`, { invalidate: [["tasks", projectId], ["project", projectId]], success: "Task added" });
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<Task | null>(null);
  const canMove = (t: Task) => can("projects.manage") || (can("tasks.update_assigned") && t.assigneeId === user?.id);
  return (
    <div>
      {can("projects.manage") && project.status !== "completed" && <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><Plus /> Task</Button></div>}
      <div className="scrollbar-thin grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {COLS.map((col) => {
          const items = (tasks.data ?? []).filter((t) => t.status === col);
          return (
            <div key={col} className="bg-surface-2 border-border flex min-h-48 flex-col rounded-lg border"
              onDragOver={(e) => drag && canMove(drag) && e.preventDefault()}
              onDrop={() => { if (drag && drag.status !== col && canMove(drag)) move.mutate({ id: drag.id, status: col, expectedUpdatedAt: drag.updatedAt }); setDrag(null); }}>
              <p className="text-fg-muted flex items-center justify-between px-3 py-2 text-xs font-medium">{TASK_STATUSES[col]}<span>{items.length}</span></p>
              <div className="flex-1 space-y-2 px-2 pb-2">
                {items.map((t) => (
                  <article key={t.id} draggable={canMove(t)} onDragStart={() => setDrag(t)} className={cn("border-border bg-surface rounded-md border p-2.5 text-[13px] shadow-xs", canMove(t) && "cursor-grab")}>
                    <p className="font-medium">{t.title}</p>
                    <div className="text-fg-subtle mt-1.5 flex items-center justify-between gap-2 text-xs">
                      <span><UserName id={t.assigneeId} fallback="Unassigned" /></span>
                      {t.priority !== "medium" && <Tag tone={t.priority === "urgent" || t.priority === "high" ? "danger" : "outline"}>{t.priority}</Tag>}
                    </div>
                    {canMove(t) && (
                      <NativeSelect aria-label={`Move ${t.title}`} className="mt-2 h-7 text-xs" value={t.status} onChange={(e) => move.mutate({ id: t.id, status: e.target.value as TaskStatus, expectedUpdatedAt: t.updatedAt })}>
                        {COLS.map((c) => <option key={c} value={c}>{TASK_STATUSES[c]}</option>)}
                      </NativeSelect>
                    )}
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {open && <TaskDialog project={project} onClose={() => setOpen(false)} onSave={(b) => add.mutate(b, { onSuccess: () => setOpen(false) })} busy={add.isPending} />}
    </div>
  );
}

function TaskDialog({ project, onClose, onSave, busy }: { project: ProjectDetail; onClose: () => void; onSave: (b: object) => void; busy: boolean }) {
  const [v, setV] = useState({ title: "", description: "", assigneeId: null as string | null, priority: "medium", dueDate: "", milestoneId: "" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ ...v, dueDate: v.dueDate || null, milestoneId: v.milestoneId || null }); }}>
          <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="tt" required className="sm:col-span-2"><Input id="tt" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field label="Assignee" htmlFor="ta"><UserSelect id="ta" allowEmpty value={v.assigneeId} onChange={(a) => setV({ ...v, assigneeId: a })} /></Field>
            <Field label="Priority" htmlFor="tp"><NativeSelect id="tp" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</NativeSelect></Field>
            <Field label="Milestone" htmlFor="tm"><NativeSelect id="tm" value={v.milestoneId} onChange={(e) => setV({ ...v, milestoneId: e.target.value })}><option value="">None</option>{project.milestones.map((m) => <option key={m.id} value={m.id}>{m.seq}. {m.name}</option>)}</NativeSelect></Field>
            <Field label="Due" htmlFor="td"><Input id="td" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field>
            <Field label="Description" htmlFor="tx" className="sm:col-span-2"><Textarea id="tx" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={busy} disabled={v.title.trim().length < 2}>Add task</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRequests({ project }: { project: ProjectDetail }) {
  const { can } = useAuth();
  const id = project.id;
  const add = useApiMutation<object>("POST", `/projects/${id}/change-requests`, { invalidate: [["project", id]], success: "Change request drafted" });
  const submit = useApiMutation<{ crId: string; clientEvidence: string }>("POST", (b) => `/change-requests/${b.crId}/submit`, { invalidate: [["project", id], ["approvals"]], success: "Sent for approval" });
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [v, setV] = useState({ title: "", description: "", impactAmount: "0", impactDays: "0" });
  return (
    <div className="space-y-4">
      {can("projects.manage") && ["active", "on_hold"].includes(project.status) && <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><GitPullRequestArrow /> New change request</Button></div>}
      <Section flush>
        <SimpleTable label="Change requests" rows={project.changeRequests} rowKey={(c) => c.id}
          empty={<EmptyState title="No change requests" description="Scope changes after approval are quoted here. Approved changes add a billable milestone automatically." />}
          columns={[
            { key: "n", header: "CR", cell: (c) => <div><div className="font-medium">{c.number} · {c.title}</div><div className="text-fg-muted line-clamp-2 text-xs whitespace-pre-wrap">{c.description}</div></div> },
            { key: "i", header: "Impact", cell: (c) => <span><Money value={c.impactAmount} /> · {c.impactDays}d</span>, hideBelow: "sm" },
            { key: "s", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
            { key: "a", header: "", align: "right", cell: (c) => c.status === "draft" && can("projects.manage") && <Button size="xs" variant="primary" onClick={() => setSubmitting(c.id)}>Submit</Button> },
          ]} />
      </Section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); add.mutate({ ...v, impactDays: Number(v.impactDays) || 0 }, { onSuccess: () => { setOpen(false); setV({ title: "", description: "", impactAmount: "0", impactDays: "0" }); } }); }}>
            <DialogHeader><DialogTitle>New change request</DialogTitle></DialogHeader>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="ct" required className="sm:col-span-2"><Input id="ct" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
              <Field label="What changes and why" htmlFor="cd" required className="sm:col-span-2"><Textarea id="cd" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
              <Field label="Extra charge (₹, before GST)" htmlFor="ca"><Input id="ca" inputMode="decimal" value={v.impactAmount} onChange={(e) => setV({ ...v, impactAmount: e.target.value })} /></Field>
              <Field label="Extra days" htmlFor="cy"><Input id="cy" inputMode="numeric" value={v.impactDays} onChange={(e) => setV({ ...v, impactDays: e.target.value })} /></Field>
            </DialogBody>
            <DialogFooter><Button type="button" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={add.isPending} disabled={v.title.length < 3 || v.description.length < 10}>Save draft</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <PromptDialog open={!!submitting} onOpenChange={(o) => !o && setSubmitting(null)} title="Submit for approval" description="A change can only be approved after the client agrees to it. Record how they agreed." label="Client approval evidence" placeholder="WhatsApp from owner, 24 Oct 4:10 pm" confirmLabel="Submit" busy={submit.isPending}
        onSubmit={(clientEvidence) => submitting && submit.mutate({ crId: submitting, clientEvidence, clientApproved: true } as never, { onSuccess: () => setSubmitting(null) })} />
    </div>
  );
}

export function MyTasksView() {
  const { user } = useAuth();
  const tasks = useApi<Task[]>(["tasks", "mine"], "/tasks/mine");
  const move = useApiMutation<{ id: string; status: TaskStatus; expectedUpdatedAt: string }>("POST", (b) => `/tasks/${b.id}/move`, { invalidate: [["tasks"]], success: "Task updated" });
  return (
    <ModulePage title="My Tasks" description={`Open tasks assigned to ${user?.name ?? "you"}, across projects.`} permissions={["tasks.update_assigned", "projects.manage"]}>
      <Section flush>
        <SimpleTable label="My tasks" rows={tasks.data} rowKey={(t) => t.id} loading={tasks.isLoading} error={tasks.error}
          empty={<EmptyState icon={<CheckCircle2 />} title="Nothing assigned" description="Tasks assigned to you on any project appear here." />}
          columns={[
            { key: "t", header: "Task", cell: (t) => <div><div className="font-medium">{t.title}</div><Link href={`/projects/${t.projectId}`} className="text-fg-subtle text-xs hover:underline">{t.projectName}</Link></div> },
            { key: "p", header: "Priority", cell: (t) => <Tag tone={t.priority === "urgent" || t.priority === "high" ? "danger" : "outline"}>{t.priority}</Tag>, hideBelow: "sm" },
            { key: "d", header: "Due", cell: (t) => formatDate(t.dueDate), hideBelow: "sm" },
            { key: "s", header: "Status", cell: (t) => (
              <NativeSelect aria-label={`Status of ${t.title}`} className="h-8 w-36" value={t.status} onChange={(e) => move.mutate({ id: t.id, status: e.target.value as TaskStatus, expectedUpdatedAt: t.updatedAt })}>
                {COLS.map((c) => <option key={c} value={c}>{TASK_STATUSES[c]}</option>)}
              </NativeSelect>
            ) },
          ]} />
      </Section>
    </ModulePage>
  );
}
