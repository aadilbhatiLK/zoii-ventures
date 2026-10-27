"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, KeyRound, Plus, ShieldCheck, Target } from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";
import { useGlobalUi } from "@/components/layout/global-ui";
import { PageHeader } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PERMISSIONS, ROLES, leadScope, permissionsOf } from "@/lib/permissions";
import { formatDateTime } from "@/lib/formatting";
import { useLeadList } from "@/features/leads/hooks";
import { FollowUpCell } from "@/features/leads/lead-meta";

export function WorkspaceView() {
  const { user, session, can } = useAuth();
  const { openSheet } = useGlobalUi();
  const hasLeads = leadScope(user) !== "none";
  const overdue = useLeadList({
    view: "overdue",
    ownerId: user ? [user.id] : undefined,
    pageSize: 10,
    sort: { field: "nextFollowUpAt", dir: "asc" },
  });
  const today = useLeadList({
    view: "due_today",
    ownerId: user ? [user.id] : undefined,
    pageSize: 10,
    sort: { field: "nextFollowUpAt", dir: "asc" },
  });
  if (!user) return null;
  const perms = [...permissionsOf(user)];
  const work = hasLeads ? [...(overdue.data?.items ?? []), ...(today.data?.items ?? [])] : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My workspace"
        description={`${user.title} · ${user.roles.map((r) => ROLES[r]).join(", ")}`}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Today</CardTitle>
            {hasLeads && (
              <Button asChild size="xs" variant="ghost">
                <Link href="/follow-ups">
                  Follow-ups <ArrowRight />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!hasLeads ? (
              <p className="text-fg-muted py-6 text-center text-[13px]">
                Your tasks, leave and payslips are under My Tasks and My Profile.
              </p>
            ) : work.length === 0 ? (
              <p className="text-fg-muted py-6 text-center text-[13px]">
                {overdue.isLoading || today.isLoading
                  ? "Loading…"
                  : "Nothing due today or overdue."}
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {work.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2.5">
                    <CalendarClock className="text-fg-subtle size-4" />
                    <Link
                      href={`/leads/${l.id}`}
                      className="hover:text-accent min-w-0 flex-1 truncate text-[13px] font-medium"
                    >
                      {l.company ?? l.name}
                    </Link>
                    <span className="text-xs">
                      <FollowUpCell at={l.nextFollowUpAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {can("leads.create") && (
              <Button className="justify-start" onClick={() => openSheet({ kind: "lead" })}>
                <Plus /> New lead
              </Button>
            )}
            {can("clients.create") && (
              <Button className="justify-start" onClick={() => openSheet({ kind: "client" })}>
                <Plus /> New client
              </Button>
            )}
            {hasLeads && (
              <Button asChild className="justify-start">
                <Link href="/pipeline">
                  <Target /> Open pipeline board
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Session & security</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            <p className="flex items-center gap-2">
              <ShieldCheck className="text-fg-subtle size-4" /> MFA{" "}
              {user.mfaEnrolled ? (
                <Badge tone="success">Enrolled</Badge>
              ) : (
                <Badge tone="warning">Not enrolled</Badge>
              )}
            </p>
            <p className="flex items-center gap-2">
              <KeyRound className="text-fg-subtle size-4" /> Session expires{" "}
              {formatDateTime(session?.expiresAt)}
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>What your role can do</CardTitle>
            <span className="text-fg-subtle text-xs">{perms.length} permissions</span>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {perms.map((p) => (
              <Badge key={p} tone="outline" title={p}>
                {PERMISSIONS[p]}
              </Badge>
            ))}
            {perms.length === 0 && (
              <p className="text-fg-muted text-[13px]">No workspace permissions.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
