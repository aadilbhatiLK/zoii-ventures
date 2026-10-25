"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, NativeSelect, Section, SimpleTable, StatusBadge, Tag } from "@/components/module/kit";
import { ClientPicker, UserName, UserSelect } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { Ticket } from "@/lib/api/modules/people";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";

const SLA = ({ s, due }: { s: Ticket["sla"]["resolution"]; due: string }) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={s} label={s === "pending" ? `due ${formatRelative(due)}` : s === "at_risk" ? `at risk · ${formatRelative(due)}` : s} /></span>;

export function TicketsView() {
  const router = useRouter();
  const { can } = useAuth();
  const [view, setView] = useState<"open" | "mine" | "all">("open");
  const list = useApi<Ticket[]>(["tickets", view], view === "open" ? "/tickets?status=open" : view === "mine" ? "/tickets?mine=true&status=open" : "/tickets");
  const [open, setOpen] = useState(false);
  return (
    <ModulePage title="Support Tickets" description="Every ticket gets first-response and resolution deadlines from its priority's SLA. Breaches notify the assignee." permissions={["support.view", "support.manage"]}
      actions={<><Segmented label="View" value={view} onChange={setView} options={[{ value: "open", label: "Open" }, { value: "mine", label: "Mine" }, { value: "all", label: "All" }]} />{can("support.manage") && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> New ticket</Button>}</>}>
      <Section flush>
        <SimpleTable label="Tickets" rows={list.data} rowKey={(t) => t.id} href={(t) => `/support/${t.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState title="No tickets" />}
          columns={[
            { key: "s", header: "Ticket", cell: (t) => <div><div className="font-medium">{t.subject}</div><div className="text-fg-subtle text-xs">{t.number} · {t.clientName}</div></div> },
            { key: "p", header: "Priority", cell: (t) => <Tag tone={t.priority === "urgent" || t.priority === "high" ? "danger" : "outline"}>{t.priority}</Tag> },
            { key: "st", header: "Status", cell: (t) => <StatusBadge status={t.status} />, hideBelow: "sm" },
            { key: "a", header: "Assignee", cell: (t) => <UserName id={t.assigneeId} fallback="Unassigned" />, hideBelow: "md" },
            { key: "r", header: "Resolution SLA", cell: (t) => <SLA s={t.sla.resolution} due={t.resolutionDueAt} /> },
          ]} />
      </Section>
      {open && <TicketDialog onClose={() => setOpen(false)} onCreated={(id) => router.push(`/support/${id}`)} />}
    </ModulePage>
  );
}

function TicketDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [v, setV] = useState({ clientId: null as string | null, subject: "", description: "", priority: "medium", category: "support", channel: "phone", assigneeId: null as string | null });
  const m = useApiMutation<object, Ticket>("POST", "/tickets", { invalidate: [["tickets"]], success: (t) => `${t.number} opened` });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(v, { onSuccess: (t) => onCreated(t.id) }); }}>
          <DialogHeader><DialogTitle>New ticket</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Client" htmlFor="tc" required className="sm:col-span-3"><ClientPicker id="tc" value={v.clientId} onChange={(id) => setV({ ...v, clientId: id })} /></Field>
            <Field label="Subject" htmlFor="ts" required className="sm:col-span-3"><Input id="ts" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
            <Field label="Priority" htmlFor="tp"><NativeSelect id="tp" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="low">Low · 3 days</option><option value="medium">Medium · 1 day</option><option value="high">High · 8 hours</option><option value="urgent">Urgent · 4 hours</option></NativeSelect></Field>
            <Field label="Category" htmlFor="tcat"><NativeSelect id="tcat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{["support", "bug", "change", "billing", "other"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
            <Field label="Channel" htmlFor="tch"><NativeSelect id="tch" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>{["phone", "email", "whatsapp", "portal", "in_person"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</NativeSelect></Field>
            <Field label="Assignee" htmlFor="ta" className="sm:col-span-3"><UserSelect id="ta" allowEmpty value={v.assigneeId} onChange={(a) => setV({ ...v, assigneeId: a })} /></Field>
            <Field label="Description" htmlFor="td" required className="sm:col-span-3"><Textarea id="td" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={m.isPending} disabled={!v.clientId || v.subject.length < 3 || v.description.length < 3}>Open ticket</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TicketDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const t = useApi<Ticket>(["ticket", id], `/tickets/${id}`, { refetchInterval: 60_000 });
  const inv = { invalidate: [["ticket", id], ["tickets"]] };
  const upd = useApiMutation<object>("PATCH", `/tickets/${id}`, { ...inv, success: "Ticket updated" });
  const comment = useApiMutation<{ body: string; internal: boolean }>("POST", `/tickets/${id}/comments`, inv);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const x = t.data;
  const closed = x?.status === "closed";
  return (
    <ModulePage title={x?.subject ?? "Ticket"} permissions={["support.view", "support.manage"]} meta={x && <><StatusBadge status={x.status} /><Tag tone={x.priority === "urgent" || x.priority === "high" ? "danger" : "outline"}>{x.priority}</Tag></>} description={<BackLink href="/support">← Tickets</BackLink>}
      actions={x && can("support.manage") && !closed && <>
        {x.status !== "in_progress" && x.status !== "resolved" && <Button size="sm" onClick={() => upd.mutate({ status: "in_progress" })}>Start work</Button>}
        {x.status !== "waiting_on_client" && x.status !== "resolved" && <Button size="sm" onClick={() => upd.mutate({ status: "waiting_on_client" })}>Waiting on client</Button>}
        {x.status !== "resolved" ? <Button size="sm" variant="primary" onClick={() => upd.mutate({ status: "resolved" })}>Resolve</Button> : <><Button size="sm" onClick={() => upd.mutate({ status: "open" })}>Reopen</Button><Button size="sm" variant="primary" onClick={() => upd.mutate({ status: "closed" })}>Close</Button></>}
      </>}>
      {x && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <Section><p className="text-[13px] whitespace-pre-wrap">{x.description}</p></Section>
            <Section title="Conversation">
              <ul className="space-y-3">
                {x.comments?.map((c) => <li key={c.id} className={cn("rounded-lg p-3 text-[13px]", c.internal ? "bg-warning-soft" : "bg-surface-2")}><p className="text-fg-muted mb-1 text-xs"><UserName id={c.authorId} /> · {formatDateTime(c.createdAt)}{c.internal && " · internal note"}</p><p className="whitespace-pre-wrap">{c.body}</p></li>)}
                {!x.comments?.length && <p className="text-fg-muted text-[13px]">No replies yet. The first non-internal reply stops the first-response clock.</p>}
              </ul>
              {can("support.manage") && !closed && (
                <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); comment.mutate({ body, internal }, { onSuccess: () => setBody("") }); }}>
                  <Textarea aria-label="Reply" value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Internal note (not for the client)" : "Reply / update for the client"} />
                  <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label><Button type="submit" size="sm" variant="primary" disabled={!body.trim()} loading={comment.isPending}>Post</Button></div>
                </form>
              )}
            </Section>
          </div>
          <Section title="SLA & details">
            <KeyValues cols={2} items={[["First response", <SLA key="f" s={x.sla.firstResponse} due={x.firstResponseDueAt} />], ["Resolution", <SLA key="r" s={x.sla.resolution} due={x.resolutionDueAt} />], ["Client", x.clientName], ["Number", x.number], ["Category", x.category], ["Channel", x.channel.replace("_", " ")], ["Opened", formatDateTime(x.createdAt)], ["Resolved", formatDateTime(x.resolvedAt)]]} />
            {can("support.manage") && !closed && (
              <div className="mt-4 space-y-3">
                <Field label="Assignee" htmlFor="as"><UserSelect id="as" allowEmpty value={x.assigneeId} onChange={(a) => upd.mutate({ assigneeId: a })} /></Field>
                <Field label="Priority" htmlFor="pr" hint="Changing it recalculates the SLA from when the ticket was opened"><NativeSelect id="pr" value={x.priority} onChange={(e) => upd.mutate({ priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</NativeSelect></Field>
              </div>
            )}
          </Section>
        </div>
      )}
    </ModulePage>
  );
}
