"use client";

import { ServerOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/feedback/states";
import { Money, Section, SimpleTable, StatusBadge, humanize } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi } from "@/lib/api/hooks";
import { apiBase } from "@/lib/api/request";
import type { Project } from "@/lib/api/modules/delivery";
import type { Subscription } from "@/lib/api/modules/delivery";
import type { Invoice } from "@/lib/api/modules/finance";
import type { Ticket } from "@/lib/api/modules/people";
import type { Quotation } from "@/lib/api/modules/sales";
import type { Permission } from "@/lib/permissions";
import { formatDate } from "@/lib/formatting";

/** Records linked to a client, read from the same list endpoints the modules use (filtered by clientId). */
function Gate({ perms, what, children }: { perms: Permission[]; what: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!apiBase())
    return <Card><EmptyState icon={<ServerOff />} title={`${what} need the backend`} description="The in-browser demo only covers leads and clients." /></Card>;
  if (!perms.some(can)) return <Card><EmptyState title={`You don't have access to ${what.toLowerCase()}`} /></Card>;
  return <>{children}</>;
}

export function ClientCommercial({ clientId }: { clientId: string }) {
  const q = `clientId=${encodeURIComponent(clientId)}`;
  const { can } = useAuth();
  const quotes = useApi<Quotation[]>(["quotations", "client", clientId], can("quotations.view") || can("quotations.create") || can("quotations.approve") ? `/quotations?${q}` : null);
  const invoices = useApi<Invoice[]>(["invoices", "client", clientId], can("finance.view") ? `/invoices?${q}` : null);
  const subs = useApi<Subscription[]>(["subscriptions", "client", clientId], can("orders.view") || can("orders.manage") || can("finance.view") ? `/subscriptions?${q}` : null);
  return (
    <div className="grid gap-4">
      <Gate perms={["quotations.view", "quotations.create", "quotations.approve"]} what="Quotations">
        <Section title="Quotations" flush>
          <SimpleTable label="Client quotations" rows={quotes.data} rowKey={(x) => x.id} href={(x) => `/quotations/${x.id}`} loading={quotes.isLoading} error={quotes.error}
            empty={<EmptyState title="No quotations for this client" />}
            columns={[
              { key: "n", header: "Number", cell: (x) => <span className="font-mono text-xs">{x.displayNumber}</span> },
              { key: "d", header: "Date", cell: (x) => formatDate(x.quoteDate), hideBelow: "sm" },
              { key: "s", header: "Status", cell: (x) => <StatusBadge status={x.status} /> },
              { key: "t", header: "Total", align: "right", cell: (x) => <Money value={x.grandTotal} /> },
            ]} />
        </Section>
      </Gate>
      <Gate perms={["finance.view"]} what="Invoices">
        <Section title="Invoices" flush>
          <SimpleTable label="Client invoices" rows={invoices.data} rowKey={(x) => x.id} href={(x) => `/finance/invoices/${x.id}`} loading={invoices.isLoading} error={invoices.error}
            empty={<EmptyState title="No invoices for this client" />}
            columns={[
              { key: "n", header: "Number", cell: (x) => <span className="font-mono text-xs">{x.number ?? "Draft"}</span> },
              { key: "d", header: "Date", cell: (x) => formatDate(x.invoiceDate), hideBelow: "sm" },
              { key: "s", header: "Status", cell: (x) => <StatusBadge status={x.status} /> },
              { key: "t", header: "Total", align: "right", cell: (x) => <Money value={x.total} /> },
              { key: "o", header: "Outstanding", align: "right", cell: (x) => <Money value={x.outstanding} muted />, hideBelow: "md" },
            ]} />
        </Section>
      </Gate>
      <Gate perms={["orders.view", "orders.manage", "finance.view"]} what="Subscriptions">
        <Section title="Subscriptions & AMC" flush>
          <SimpleTable label="Client subscriptions" rows={subs.data} rowKey={(x) => x.id} loading={subs.isLoading} error={subs.error}
            empty={<EmptyState title="No subscriptions for this client" />}
            columns={[
              { key: "n", header: "Number", cell: (x) => <span className="font-mono text-xs">{x.number}</span> },
              { key: "k", header: "Plan", cell: (x) => <div><div>{x.description}</div><div className="text-fg-subtle text-xs">{humanize(x.kind)} · {x.billingCycle}</div></div> },
              { key: "s", header: "Status", cell: (x) => <StatusBadge status={x.status} /> },
              { key: "a", header: "Amount", align: "right", cell: (x) => <Money value={x.amount} /> },
            ]} />
        </Section>
      </Gate>
    </div>
  );
}

export function ClientProjects({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const projects = useApi<Project[]>(["projects", "client", clientId], can("projects.view") ? `/projects?clientId=${encodeURIComponent(clientId)}` : null);
  return (
    <Gate perms={["projects.view"]} what="Projects">
      <Section title="Projects" flush>
        <SimpleTable label="Client projects" rows={projects.data} rowKey={(x) => x.id} href={(x) => `/projects/${x.id}`} loading={projects.isLoading} error={projects.error}
          empty={<EmptyState title="No projects for this client" />}
          columns={[
            { key: "c", header: "Code", cell: (x) => <span className="font-mono text-xs">{x.code}</span> },
            { key: "n", header: "Project", cell: (x) => x.name },
            { key: "s", header: "Status", cell: (x) => <StatusBadge status={x.status} /> },
            { key: "d", header: "Due", cell: (x) => formatDate(x.dueDate), hideBelow: "sm" },
          ]} />
      </Section>
    </Gate>
  );
}

export function ClientSupport({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const tickets = useApi<Ticket[]>(["tickets", "client", clientId], can("support.view") || can("support.manage") ? `/tickets?clientId=${encodeURIComponent(clientId)}` : null);
  return (
    <Gate perms={["support.view", "support.manage"]} what="Support tickets">
      <Section title="Support tickets" flush>
        <SimpleTable label="Client tickets" rows={tickets.data} rowKey={(x) => x.id} href={(x) => `/support/${x.id}`} loading={tickets.isLoading} error={tickets.error}
          empty={<EmptyState title="No tickets for this client" />}
          columns={[
            { key: "n", header: "Number", cell: (x) => <span className="font-mono text-xs">{x.number}</span> },
            { key: "s", header: "Subject", cell: (x) => x.subject },
            { key: "p", header: "Priority", cell: (x) => humanize(x.priority), hideBelow: "sm" },
            { key: "st", header: "Status", cell: (x) => <StatusBadge status={x.status} /> },
          ]} />
      </Section>
    </Gate>
  );
}
