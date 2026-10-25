"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Lock, Plus, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/feedback/states";
import { BackLink } from "@/components/layout/topbar";
import { KeyValues, ModulePage, NativeSelect, Section, SimpleTable, StatusBadge } from "@/components/module/kit";
import { ClientPicker, UserName } from "@/components/module/pickers";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { DOCUMENT_KINDS, type DocumentDetail, type DocumentSummary } from "@/lib/api/modules/sales";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";

const TEMPLATE = `# Background\n\n# Goals\n\n# Scope\n## In scope\n- \n\n## Out of scope\n- \n\n# Users & roles\n\n# Functional requirements\n1. \n\n# Non-functional requirements\n- Performance:\n- Security:\n\n# Acceptance criteria\n- \n\n# Timeline & milestones\n`;

export function DocumentsView() {
  const router = useRouter();
  const { can } = useAuth();
  const list = useApi<DocumentSummary[]>(["documents"], "/documents");
  const [open, setOpen] = useState(false);
  return (
    <ModulePage title="BRD / PRD" description="Requirement documents. Every approval freezes that version (SHA-256 recorded); changes start a new version."
      permissions={["documents.view", "documents.create"]}
      actions={can("documents.create") && <Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus /> New document</Button>}>
      <Section flush>
        <SimpleTable label="Documents" rows={list.data} rowKey={(d) => d.id} href={(d) => `/documents/${d.id}`} loading={list.isLoading} error={list.error}
          empty={<EmptyState icon={<FileText />} title="No documents yet" description="Write the BRD before quoting, so the scope the client accepts is on record." />}
          columns={[
            { key: "t", header: "Document", cell: (d) => d.title },
            { key: "n", header: "No.", cell: (d) => <span className="text-fg-muted font-mono text-xs">{d.number}</span>, hideBelow: "md" },
            { key: "c", header: "Client", cell: (d) => d.clientName ?? "—", hideBelow: "sm" },
            { key: "v", header: "Latest", cell: (d) => <span className="flex items-center gap-1.5">v{d.latestVersion} <StatusBadge status={d.latestStatus} /></span> },
            { key: "a", header: "Approved", cell: (d) => (d.approvedVersion ? `v${d.approvedVersion}` : "—"), hideBelow: "sm" },
            { key: "u", header: "Updated", cell: (d) => <span className="text-fg-muted">{formatRelative(d.updatedAt)}</span>, hideBelow: "lg" },
          ]} />
      </Section>
      {open && <NewDocumentDialog onClose={() => setOpen(false)} onCreated={(id) => router.push(`/documents/${id}`)} />}
    </ModulePage>
  );
}

function NewDocumentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<keyof typeof DOCUMENT_KINDS>("brd");
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const create = useApiMutation<object, DocumentDetail>("POST", "/documents", { invalidate: [["documents"]], success: "Draft created" });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate({ kind, title, clientId, content: TEMPLATE }, { onSuccess: (d) => onCreated(d.id) }); }}>
          <DialogHeader><DialogTitle>New document</DialogTitle></DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Type" htmlFor="k"><NativeSelect id="k" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{Object.entries(DOCUMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
            <Field label="Title" htmlFor="t" required><Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thar Retail ERP — requirements" /></Field>
            <Field label="Client" htmlFor="c" required><ClientPicker id="c" value={clientId} onChange={setClientId} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" disabled={title.trim().length < 3 || !clientId} loading={create.isPending}>Create draft</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentDetailView({ id }: { id: string }) {
  const { can, user } = useAuth();
  const doc = useApi<DocumentDetail>(["document", id], `/documents/${id}`);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const inv = { invalidate: [["document", id], ["documents"], ["approvals"]] };
  const save = useApiMutation<{ content: string; expectedUpdatedAt: string }>("PUT", `/documents/${id}/draft`, { ...inv, success: "Draft saved" });
  const submit = useApiMutation("POST", `/documents/${id}/submit`, { ...inv, success: "Submitted for review" });
  const withdraw = useApiMutation("POST", `/documents/${id}/withdraw`, { ...inv, success: "Withdrawn to draft" });
  const newVersion = useApiMutation("POST", `/documents/${id}/versions`, { ...inv, success: "New draft version started" });
  const d = doc.data;
  const latest = d?.versions[0];
  const shown = d?.versions.find((v) => v.version === (selected ?? latest?.version)) ?? latest;
  const editable = !!shown && shown.status === "draft" && shown.version === latest?.version && can("documents.create");
  const text = editable ? (draft ?? shown!.content) : shown?.content ?? "";
  const dirty = editable && draft !== null && draft !== shown!.content;

  return (
    <ModulePage title={d?.title ?? "Document"} permissions={["documents.view", "documents.create"]}
      meta={d && <StatusBadge status={latest!.status} label={`v${latest!.version} · ${latest!.status.replace("_", " ")}`} />}
      description={<BackLink href="/documents">← All documents</BackLink>}
      actions={d && (
        <>
          {editable && <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ content: text, expectedUpdatedAt: shown!.updatedAt }, { onSuccess: () => setDraft(null) })}>Save draft</Button>}
          {editable && can("documents.submit_review") && <Button size="sm" variant="primary" disabled={dirty} loading={submit.isPending} onClick={() => submit.mutate(undefined)}><Send /> Submit for review</Button>}
          {latest?.status === "in_review" && (latest.authorId === user?.id || can("documents.approve")) && <Button size="sm" loading={withdraw.isPending} onClick={() => withdraw.mutate(undefined)}><Undo2 /> Withdraw</Button>}
          {(latest?.status === "approved" || latest?.status === "rejected") && can("documents.create") && <Button size="sm" variant="primary" loading={newVersion.isPending} onClick={() => newVersion.mutate(undefined, { onSuccess: () => { setSelected(null); setDraft(null); } })}><Plus /> New version</Button>}
        </>
      )}>
      {d && shown && (
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <Section title={`Version ${shown.version}`} description={shown.status === "approved" ? <span className="inline-flex items-center gap-1"><Lock className="size-3" /> Frozen · SHA-256 {shown.contentSha256?.slice(0, 16)}…</span> : editable ? "Draft — only drafts can be edited" : "Read-only"}>
            {editable ? (
              <Textarea aria-label="Document content" className="min-h-[60vh] font-mono text-[13px]" value={text} onChange={(e) => setDraft(e.target.value)} />
            ) : (
              <pre className="bg-surface-2 min-h-[40vh] rounded-md p-4 font-sans text-[13px] leading-relaxed whitespace-pre-wrap">{text}</pre>
            )}
            {shown.decisionNote && <p className="text-fg-muted mt-3 text-xs">Reviewer note: “{shown.decisionNote}”</p>}
          </Section>
          <div className="space-y-5">
            <Section title="Details">
              <KeyValues cols={2} items={[["Number", d.number], ["Client", d.clientName], ["Owner", <UserName key="o" id={d.ownerId} />], ["Approved", d.approvedVersion ? `v${d.approvedVersion}` : "Not yet"]]} />
            </Section>
            <Section title="Versions" flush>
              <ul className="divide-border divide-y">
                {d.versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => { setSelected(v.version); setDraft(null); }} className={cn("hover:bg-surface-2 flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[13px]", v.version === shown.version && "bg-surface-2")}>
                      <span><span className="font-medium">v{v.version}</span> <span className="text-fg-subtle text-xs">{formatDateTime(v.decidedAt ?? v.updatedAt)}</span></span>
                      <StatusBadge status={v.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      )}
      {doc.error ? <EmptyState title="Document not found" /> : null}
    </ModulePage>
  );
}
