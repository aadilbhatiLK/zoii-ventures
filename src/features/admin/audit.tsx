"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ModulePage, Section, SimpleTable, Tag } from "@/components/module/kit";
import { useApi } from "@/lib/api/hooks";
import { qs } from "@/lib/api/request";
import type { AuditEntry } from "@/lib/api/modules/people";
import { formatDateTime } from "@/lib/formatting";

export function AuditView() {
  const [f, setF] = useState({ action: "", entityType: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const q = useApi<{ items: AuditEntry[]; total: number; page: number; pageSize: number }>(["audit", f, page], `/audit${qs({ ...f, page })}`);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <ModulePage title="Audit Logs" description="Append-only: the database refuses to edit or delete these rows. Sensitive values (bank numbers, PAN, codes) are recorded as “set/changed”, never in clear." permissions={["audit.view"]}>
      <Section>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Action starts with" htmlFor="aa"><Input id="aa" placeholder="invoice. / lead. / auth." value={f.action} onChange={(e) => { setF({ ...f, action: e.target.value }); setPage(1); }} /></Field>
          <Field label="Entity type" htmlFor="ae"><Input id="ae" placeholder="invoice, lead, user…" value={f.entityType} onChange={(e) => { setF({ ...f, entityType: e.target.value }); setPage(1); }} /></Field>
          <Field label="From" htmlFor="af"><Input id="af" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To" htmlFor="at"><Input id="at" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
      </Section>
      <Section flush className="mt-4">
        <SimpleTable label="Audit events" rows={q.data?.items} rowKey={(r) => r.id} onRowClick={setOpen} loading={q.isLoading} error={q.error}
          columns={[
            { key: "t", header: "When", cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span> },
            { key: "w", header: "Who", cell: (r) => r.actorName ?? "System" },
            { key: "a", header: "Action", cell: (r) => <Tag>{r.action}</Tag> },
            { key: "e", header: "Record", cell: (r) => <span className="text-fg-muted text-xs">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</span>, hideBelow: "md" },
            { key: "i", header: "IP", cell: (r) => <span className="text-fg-subtle font-mono text-xs">{r.ip ?? ""}</span>, hideBelow: "lg" },
          ]} />
        <div className="flex items-center justify-between px-4 py-3 text-[13px]"><span className="text-fg-muted">{q.data?.total ?? 0} events</span><span className="flex gap-2"><Button size="xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page}/{pages}</span><Button size="xs" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></span></div>
      </Section>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{open.action}</DialogTitle></DialogHeader>
            <DialogBody><p className="text-fg-muted mb-2 text-xs">{formatDateTime(open.occurredAt)} · {open.actorName ?? "System"} · request {open.requestId ?? "—"}</p><pre className="bg-surface-2 max-h-[60vh] overflow-auto rounded-md p-3 text-xs">{JSON.stringify(open.changes, null, 2)}</pre></DialogBody>
          </DialogContent>
        </Dialog>
      )}
    </ModulePage>
  );
}
