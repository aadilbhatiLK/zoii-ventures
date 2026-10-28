"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Crown,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Target,
} from "lucide-react";
import { useRecordBreadcrumb } from "@/components/layout/breadcrumbs";
import { useGlobalUi } from "@/components/layout/global-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { ActivityTimeline } from "@/features/shared/timeline";
import { useAuth } from "@/features/auth/auth-provider";
import { useUserDirectory } from "@/features/leads/hooks";
import { OwnerCell } from "@/features/leads/lead-meta";
import { CLIENT_CATEGORIES, PRODUCT_LINES } from "@/lib/api/contracts";
import { isApiError, userMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/formatting";
import { validateGstin } from "@/lib/validation/gstin";
import { ClientCommercial, ClientProjects, ClientSupport } from "./client-records";
import { useClient, useClientTimeline } from "./hooks";
import { STATUS_LABEL, STATUS_TONE } from "./clients-view";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-3 py-2 text-[13px]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ClientDetail({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const { openSheet } = useGlobalUi();
  const client = useClient(clientId);
  const timeline = useClientTimeline(clientId);
  const directory = useUserDirectory();
  useRecordBreadcrumb(client.data?.name);

  if (client.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  if (client.isError || !client.data) {
    return isApiError(client.error) && client.error.code === "NOT_FOUND" ? (
      <EmptyState
        title="Client not found"
        action={
          <Button asChild size="sm">
            <Link href="/clients">Back to clients</Link>
          </Button>
        }
        className="py-20"
      />
    ) : (
      <ErrorState message={userMessage(client.error)} onRetry={() => void client.refetch()} />
    );
  }
  const c = client.data;
  const gst = c.gstin ? validateGstin(c.gstin) : null;
  const addressIncomplete =
    !c.billingAddress.line1 ||
    c.billingAddress.line1 === "To be confirmed" ||
    !c.billingAddress.pincode;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/clients"
          className="text-fg-muted hover:text-fg mb-3 inline-flex items-center gap-1 text-[13px]"
        >
          <ArrowLeft className="size-4" /> Clients
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold">{c.name}</h1>
              <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              <Badge tone="outline">{CLIENT_CATEGORIES[c.category]}</Badge>
            </div>
            <p className="text-fg-muted mt-1 text-[13px]">
              {c.code} · {c.industry} · client since {formatDate(c.createdAt)}
            </p>
          </div>
          {can("clients.update") && (
            <Button size="sm" onClick={() => openSheet({ kind: "client", clientId: c.id })}>
              <Pencil /> Edit client
            </Button>
          )}
        </div>
      </div>

      {addressIncomplete && (
        <div className="border-warning/50 bg-warning-soft rounded-lg border px-4 py-3 text-[13px]">
          Billing address is incomplete. Complete it (and GSTIN, if registered) before the first
          invoice.
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="scrollbar-thin overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="contacts">
            Contacts <span className="text-fg-subtle text-xs">{c.contacts.length}</span>
          </TabsTrigger>
          <TabsTrigger value="commercial">Commercial</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-0">
                <CardTitle>Company & tax profile</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-border divide-y">
                  <Row label="Legal name">{c.legalName}</Row>
                  <Row label="GSTIN">
                    {c.gstin ? (
                      <span className="inline-flex flex-wrap items-center gap-2 font-mono text-xs">
                        {c.gstin}
                        {gst?.valid && (
                          <Badge tone="success">
                            <BadgeCheck /> Valid · {gst.stateName}
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-fg-muted">Not registered / not provided</span>
                    )}
                  </Row>
                  <Row label="PAN">
                    <span className="font-mono text-xs">{c.pan ?? "—"}</span>
                  </Row>
                  <Row label="Billing address">
                    <span className="flex items-start gap-1.5">
                      <MapPin className="text-fg-subtle mt-0.5 size-3.5 shrink-0" />
                      {[
                        c.billingAddress.line1,
                        c.billingAddress.line2,
                        c.billingAddress.city,
                        c.billingAddress.state,
                        c.billingAddress.pincode,
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </span>
                  </Row>
                  <Row label="Account manager">
                    <OwnerCell user={directory.byId.get(c.accountManagerId)} />
                  </Row>
                  <Row label="Website">
                    {c.website ? (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent inline-flex items-center gap-1 hover:underline"
                      >
                        <Globe className="size-3.5" />
                        {c.website}
                      </a>
                    ) : (
                      "—"
                    )}
                  </Row>
                  <Row label="Products in use">
                    {c.productLines.length
                      ? c.productLines.map((p) => PRODUCT_LINES[p]).join(", ")
                      : "—"}
                  </Row>
                  {c.sourceLeadId && (
                    <Row label="Source lead">
                      <Link
                        href={`/leads/${c.sourceLeadId}`}
                        className="text-accent inline-flex items-center gap-1 hover:underline"
                      >
                        <Target className="size-3.5" /> View original lead
                      </Link>
                    </Row>
                  )}
                </dl>
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle>Commercial value</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-[13px]">
                  <p className="text-fg-muted">
                    Lifetime value isn&apos;t totalled on this page yet. The Commercial tab lists
                    this client&apos;s quotations, invoices (with outstanding amounts) and
                    subscriptions from the live records.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle>Recent activity</CardTitle>
                </CardHeader>
                <ActivityTimeline
                  activities={timeline.data?.slice(0, 4)}
                  users={directory.byId}
                  loading={timeline.isLoading}
                />
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="pt-4">
          <Card>
            <CardHeader className="border-border border-b pb-3">
              <CardTitle>Unified timeline</CardTitle>
              <span className="text-fg-subtle text-xs">Client and its originating lead</span>
            </CardHeader>
            {timeline.isError ? (
              <ErrorState
                message={userMessage(timeline.error)}
                onRetry={() => void timeline.refetch()}
              />
            ) : (
              <ActivityTimeline
                activities={timeline.data}
                users={directory.byId}
                loading={timeline.isLoading}
                showEntity
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="pt-4">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="bg-surface-2 text-fg-muted text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Name</th>
                    <th className="px-4 py-2 text-left font-medium">Designation</th>
                    <th className="px-4 py-2 text-left font-medium">Phone</th>
                    <th className="px-4 py-2 text-left font-medium">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {c.contacts.map((ct) => (
                    <tr key={ct.id}>
                      <td className="px-4 py-2.5 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {ct.name}
                          {ct.isPrimary && <Badge tone="accent">Primary</Badge>}
                          {ct.isDecisionMaker && (
                            <Crown className="text-warning size-3.5" aria-label="Decision maker" />
                          )}
                        </span>
                      </td>
                      <td className="text-fg-muted px-4 py-2.5">{ct.designation ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {ct.phone ? (
                          <a
                            href={`tel:${ct.phone.replace(/\s/g, "")}`}
                            className="hover:text-accent inline-flex items-center gap-1"
                          >
                            <Phone className="size-3.5" />
                            {ct.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {ct.email ? (
                          <a
                            href={`mailto:${ct.email}`}
                            className="hover:text-accent inline-flex items-center gap-1"
                          >
                            <Mail className="size-3.5" />
                            {ct.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="commercial" className="pt-4">
          <ClientCommercial clientId={c.id} />
        </TabsContent>
        <TabsContent value="projects" className="pt-4">
          <ClientProjects clientId={c.id} />
        </TabsContent>
        <TabsContent value="support" className="pt-4">
          <ClientSupport clientId={c.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
