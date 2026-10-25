import type { Permission, Role } from "@/lib/permissions";
import { permissionsOf } from "@/lib/permissions";
import type { Config } from "../config";
import type { Db, Queryable } from "../db";
import { forbidden } from "./errors";

export interface Actor {
  userId: string;
  orgId: string;
  roles: Role[];
  teamId: string | null;
  permissions: Set<Permission>;
  sessionId: string;
  mfaSatisfied: boolean;
  requestId: string;
  ip: string | null;
}

export interface Deps {
  db: Db;
  config: Config;
  now: () => Date;
  messages: MessageSender;
}

export interface MessageSender {
  /** Delivers immediately (dev console) or returns false when no provider is configured. */
  send(msg: { channel: "email" | "sms"; recipient: string; template: string; payload: Record<string, unknown> }): Promise<boolean>;
}

export function makeActor(row: { user_id: string; organization_id: string; roles: Role[]; team_id: string | null; session_id: string; mfa_satisfied: boolean }, requestId: string, ip: string | null): Actor {
  return {
    userId: row.user_id,
    orgId: row.organization_id,
    roles: row.roles,
    teamId: row.team_id,
    permissions: permissionsOf({ roles: row.roles }),
    sessionId: row.session_id,
    mfaSatisfied: row.mfa_satisfied,
    requestId,
    ip,
  };
}

export const has = (a: Actor, p: Permission) => a.permissions.has(p);
export function need(a: Actor, ...anyOf: Permission[]) {
  if (!anyOf.some((p) => a.permissions.has(p))) throw forbidden();
}

export async function audit(
  q: Queryable, a: Pick<Actor, "orgId" | "userId" | "requestId" | "ip">, action: string, entityType: string,
  entityId: string | null, changes: Record<string, unknown> = {},
) {
  await q.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes, request_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a.orgId, a.userId, action, entityType, entityId, JSON.stringify(changes), a.requestId, a.ip],
  );
}

export async function emit(
  q: Queryable, a: Pick<Actor, "orgId" | "userId">, type: string, entityType: string, entityId: string | null,
  payload: Record<string, unknown> = {},
) {
  await q.query(
    `INSERT INTO domain_events (organization_id, type, entity_type, entity_id, actor_user_id, payload) VALUES ($1,$2,$3,$4,$5,$6)`,
    [a.orgId, type, entityType, entityId, a.userId, JSON.stringify(payload)],
  );
}

/** Gap-free counter; the increment rolls back with the surrounding transaction. */
export async function nextNumber(q: Queryable, orgId: string, key: string): Promise<number> {
  const r = await q.query<{ v: string }>(
    `INSERT INTO number_sequences (organization_id, key, next_value) VALUES ($1, $2, 2)
     ON CONFLICT (organization_id, key) DO UPDATE SET next_value = number_sequences.next_value + 1
     RETURNING next_value - 1 AS v`,
    [orgId, key],
  );
  return Number(r.rows[0].v);
}

/** Indian financial year code for a date: 2026-10-24 → "2627". */
export function fyCode(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;
  const y = dt.getUTCFullYear();
  const start = dt.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

export async function notify(
  q: Queryable, orgId: string, userId: string,
  n: { kind: string; title: string; body?: string; href?: string; dedupeKey?: string },
) {
  await q.query(
    `INSERT INTO notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [orgId, userId, n.kind, n.title, n.body ?? "", n.href ?? "/", n.dedupeKey ?? null],
  );
}

export async function getSettings(q: Queryable, orgId: string): Promise<OrgSettings> {
  const r = await q.query<{ settings: Partial<OrgSettings> }>(`SELECT settings FROM organization_settings WHERE organization_id = $1`, [orgId]);
  return deepMerge(DEFAULT_SETTINGS, r.rows[0]?.settings ?? {});
}

export interface OrgSettings {
  profile: { address: string; email: string; phone: string; docPrefix: string; bank: { name: string; account: string; ifsc: string; branch: string } | null };
  quotations: { discountApprovalPct: number; valueApprovalAbove: string; validityDays: number };
  projects: { requireApprovedScope: boolean; requireAdvancePct: number };
  finance: { invoiceDueDays: number };
  payroll: {
    pf: { enabled: boolean; employeeRate: string; employerRate: string; wageCap: string };
    esi: { enabled: boolean; employeeRate: string; employerRate: string; grossLimit: string };
    professionalTax: { enabled: boolean; monthlyAmount: string; grossAbove: string };
  };
}

export const DEFAULT_SETTINGS: OrgSettings = {
  profile: { address: "", email: "", phone: "", docPrefix: "ZV", bank: null },
  quotations: { discountApprovalPct: 10, valueApprovalAbove: "500000.00", validityDays: 15 },
  projects: { requireApprovedScope: true, requireAdvancePct: 0 },
  finance: { invoiceDueDays: 15 },
  payroll: {
    pf: { enabled: true, employeeRate: "12.00", employerRate: "12.00", wageCap: "15000.00" },
    esi: { enabled: true, employeeRate: "0.75", employerRate: "3.25", grossLimit: "21000.00" },
    professionalTax: { enabled: false, monthlyAmount: "200.00", grossAbove: "10000.00" },
  },
};

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== "object" || base === null || typeof over !== "object" || over === null) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out as T;
}

/**
 * Commercial record scope (quotations, orders, subscriptions): everything for roles that
 * oversee money, the team for team-scoped sellers, otherwise records they own.
 */
export function commercialScope(a: Actor, ownerCol: string, idx: number): { sql: string; params: unknown[] } {
  const all: Permission[] = ["leads.view_all", "quotations.approve", "finance.view", "orders.manage", "projects.activate"];
  if (all.some((p) => a.permissions.has(p))) return { sql: "TRUE", params: [] };
  if (a.permissions.has("leads.view_team") && a.teamId)
    return { sql: `(${ownerCol} = $${idx} OR ${ownerCol} IN (SELECT id FROM users WHERE team_id = $${idx + 1}))`, params: [a.userId, a.teamId] };
  return { sql: `${ownerCol} = $${idx}`, params: [a.userId] };
}

export const todayIst = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
