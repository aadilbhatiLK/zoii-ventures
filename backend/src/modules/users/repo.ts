import type { PublicUser, User } from "@/lib/api/contracts";
import type { Role } from "@/lib/permissions";
import type { Queryable } from "../../db";

export interface UserRow {
  id: string; organization_id: string; full_name: string; email: string; phone_e164: string | null;
  title: string | null; team_id: string | null; avatar_hue: number; mfa_enrolled: boolean; status: string;
  roles: Role[] | null; last_login_at: Date | null; created_at: Date;
}

export const USER_SELECT = `
  SELECT u.id, u.organization_id, u.full_name, u.email, u.phone_e164, u.title, u.team_id, u.avatar_hue,
         u.mfa_enrolled, u.status, u.last_login_at, u.created_at,
         coalesce(array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
    FROM users u
    LEFT JOIN user_role_assignments ura ON ura.user_id = u.id
    LEFT JOIN roles r ON r.id = ura.role_id`;

export function formatPhone(e164: string | null): string | null {
  if (!e164) return null;
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** "+91 90000 00001", "9000000001", "09000000001" → "+919000000001". Non-Indian numbers need a + prefix. */
export function toE164(phone: string): string | null {
  const t = phone.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    name: r.full_name,
    email: r.email,
    phone: formatPhone(r.phone_e164),
    title: r.title ?? "",
    roles: (r.roles ?? []).length ? r.roles! : ["employee"],
    teamId: r.team_id,
    avatarHue: r.avatar_hue,
    mfaEnrolled: r.mfa_enrolled,
  };
}

export const toPublicUser = (r: UserRow): PublicUser => {
  const u = toUser(r);
  return { id: u.id, name: u.name, title: u.title, roles: u.roles, teamId: u.teamId, avatarHue: u.avatarHue };
};

export async function findUsers(q: Queryable, orgId: string, where = "TRUE", params: unknown[] = []): Promise<UserRow[]> {
  const r = await q.query<UserRow>(
    `${USER_SELECT} WHERE u.organization_id = $1 AND (${where}) GROUP BY u.id ORDER BY u.full_name`,
    [orgId, ...params],
  );
  return r.rows;
}

export async function getUserRow(q: Queryable, userId: string): Promise<UserRow | null> {
  const r = await q.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [userId]);
  return r.rows[0] ?? null;
}

export async function teamOfMap(q: Queryable, orgId: string): Promise<Map<string, string | null>> {
  const r = await q.query<{ id: string; team_id: string | null }>(`SELECT id, team_id FROM users WHERE organization_id = $1`, [orgId]);
  return new Map(r.rows.map((x) => [x.id, x.team_id]));
}
