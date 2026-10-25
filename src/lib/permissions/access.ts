import { ROLE_PERMISSIONS, type Permission, type Role } from "./registry";

/** Minimal shape needed for authorization decisions (shared by UI and demo adapter). */
export interface Principal {
  id: string;
  roles: readonly Role[];
  teamId: string | null;
}

export function permissionsOf(principal: Pick<Principal, "roles">): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of principal.roles) for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  return set;
}

export function can(
  principal: Pick<Principal, "roles"> | null | undefined,
  permission: Permission,
): boolean {
  if (!principal) return false;
  return permissionsOf(principal).has(permission);
}

export function canAny(
  principal: Pick<Principal, "roles"> | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => can(principal, p));
}

export type LeadScope = "all" | "team" | "own" | "none";

export function leadScope(principal: Pick<Principal, "roles"> | null | undefined): LeadScope {
  if (can(principal, "leads.view_all")) return "all";
  if (can(principal, "leads.view_team")) return "team";
  if (can(principal, "leads.view_own")) return "own";
  return "none";
}

interface OwnedRecord {
  ownerId: string;
}

/**
 * Record-level visibility. `ownerTeamOf` resolves an owner's team so team scope
 * can be evaluated without coupling this module to a user store.
 */
export function canViewLead(
  principal: Principal | null | undefined,
  lead: OwnedRecord,
  ownerTeamOf: (userId: string) => string | null,
): boolean {
  if (!principal) return false;
  switch (leadScope(principal)) {
    case "all":
      return true;
    case "team":
      return (
        lead.ownerId === principal.id ||
        (principal.teamId !== null && ownerTeamOf(lead.ownerId) === principal.teamId)
      );
    case "own":
      return lead.ownerId === principal.id;
    default:
      return false;
  }
}

export function canEditLead(
  principal: Principal | null | undefined,
  lead: OwnedRecord,
  ownerTeamOf: (userId: string) => string | null,
): boolean {
  return can(principal, "leads.update") && canViewLead(principal, lead, ownerTeamOf);
}

/** Roles whose sessions must be MFA-verified (policy shared by auth adapters and the app shell). */
export const MFA_REQUIRED_ROLES: readonly Role[] = [
  "super_admin",
  "founder",
  "finance_manager",
  "hr_manager",
  "auditor",
];

export function requiresMfa(principal: Pick<Principal, "roles"> | null | undefined): boolean {
  return !!principal && principal.roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}
