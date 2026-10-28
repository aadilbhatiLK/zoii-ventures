"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Construction } from "lucide-react";
import { findNavItem } from "@/lib/nav";
import { useAuth } from "@/features/auth/auth-provider";
import { PageHeader } from "@/components/layout/topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PermissionDenied } from "@/components/feedback/states";

/** Honest placeholder for navigation entries whose module is scheduled for a later sprint. */
export function PlannedModuleRoute() {
  const pathname = usePathname();
  const { can } = useAuth();
  const item = findNavItem(pathname);
  if (!item || item.status !== "planned" || pathname !== item.href) {
    return (
      <EmptyState
        title="Page not found"
        description="This address doesn't match any page."
        action={
          <Button asChild size="sm">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        }
        className="py-20"
      />
    );
  }
  if (item.permissions.length && !item.permissions.some(can))
    return <PermissionDenied what={item.title} />;
  return (
    <div>
      <PageHeader
        title={item.title}
        meta={<Badge tone="outline">Planned · Sprint {item.sprint}</Badge>}
      />
      <Card>
        <EmptyState
          icon={<Construction />}
          title="This module isn't built yet"
          description={
            <>
              {item.summary} It is scheduled for Sprint {item.sprint}. Nothing on this page is
              simulated — when it ships it will read real records through the same API contracts.
            </>
          }
          action={
            <Button asChild size="sm">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          }
          className="py-16"
        />
      </Card>
    </div>
  );
}
