import { z } from "zod";
import { ROLES, can, leadScope, requiresMfa, type Role } from "@/lib/permissions";
import { ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/permissions/registry";
import type { Router } from "../../app";
import { type Actor, type Deps, audit, need, notify } from "../../lib/context";
import { HttpError, conflict, forbidden, notFound, parse } from "../../lib/errors";
import { isUuid } from "../../lib/query";
import { AuthService } from "../auth/service";
import { findUsers, getUserRow, toE164, toPublicUser, toUser, type UserRow } from "./repo";

const SELLER_ROLES: Role[] = ["sales_executive", "sales_manager", "founder"];

export async function assignableUsers(deps: Deps, actor: Actor): Promise<UserRow[]> {
  const all = await findUsers(deps.db, actor.orgId, "u.status = 'active'");
  if (!can(actor, "leads.assign")) return all.filter((u) => u.id === actor.userId);
  const sellers = all.filter((u) => (u.roles ?? []).some((r) => SELLER_ROLES.includes(r)));
  if (leadScope(actor) === "all") return sellers;
  return sellers.filter((u) => u.id === actor.userId || (actor.teamId !== null && u.team_id === actor.teamId));
}

const RoleSchema = z.enum(Object.keys(ROLES) as [Role, ...Role[]]);
const UserAdminInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(20).optional().transform((v) => v || undefined),
  title: z.string().trim().max(120).optional().default(""),
  teamId: z.string().nullable().optional(),
  roles: z.array(RoleSchema).min(1, "Pick at least one role"),
});
// No default title on update: a patch that doesn't mention the title must leave it alone.
const UserPatch = UserAdminInput.omit({ email: true }).extend({ title: z.string().trim().max(120) }).partial().extend({
  status: z.enum(["active", "suspended", "deactivated"]).optional(),
});

/** Emailed reset links are short-lived; one an admin hands over in person gets a working day. */
const resetLinkMinutes = (deps: Deps) => (deps.config.emailProvider === "none" ? 24 * 60 : 60);

function toAdminUser(r: UserRow) {
  return { ...toUser(r), status: r.status, lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() };
}

export function userRoutes(r: Router, deps: Deps) {
  const db = deps.db;

  r.get("/users", async ({ actor }) => (await findUsers(db, actor.orgId, "u.status <> 'deactivated'")).map(toPublicUser));
  r.get("/users/assignable", async ({ actor }) => (await assignableUsers(deps, actor)).map(toUser));
  r.get("/teams", async ({ actor }) =>
    (await db.query(`SELECT id, name FROM teams WHERE organization_id = $1 ORDER BY name`, [actor.orgId])).rows);

  // ---------- administration (users.manage_roles) ----------
  r.get("/admin/users", async ({ actor }) => {
    need(actor, "users.manage_roles");
    return (await findUsers(db, actor.orgId)).map(toAdminUser);
  });

  r.get("/admin/roles", async ({ actor }) => {
    need(actor, "users.manage_roles", "audit.view");
    return {
      roles: (Object.keys(ROLES) as Role[]).map((k) => ({ key: k, name: ROLES[k], permissions: ROLE_PERMISSIONS[k] })),
      permissions: Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })),
    };
  });

  const guardRoleGrant = (actor: Actor, roles: Role[], target?: UserRow) => {
    const isSuper = actor.roles.includes("super_admin");
    const touchesPrivileged = (rs: Role[]) => rs.includes("super_admin") || rs.includes("founder");
    if (!isSuper && (touchesPrivileged(roles) || (target && touchesPrivileged(target.roles ?? []))))
      throw forbidden("Only a super admin can grant or change Super Admin and Founder roles.");
  };

  const setRoles = async (q: Parameters<Parameters<typeof db.tx>[0]>[0], orgId: string, userId: string, roles: Role[], by: string) => {
    await q.query(`DELETE FROM user_role_assignments WHERE user_id = $1`, [userId]);
    await q.query(
      `INSERT INTO user_role_assignments (organization_id, user_id, role_id, granted_by)
       SELECT $1, $2, id, $4 FROM roles WHERE organization_id = $1 AND key = ANY($3)`,
      [orgId, userId, roles, by],
    );
  };

  const checkTeam = async (orgId: string, teamId: string | null | undefined) => {
    if (teamId == null) return;
    if (!isUuid(teamId) || !(await db.query(`SELECT 1 FROM teams WHERE id = $1 AND organization_id = $2`, [teamId, orgId])).rows.length)
      throw new HttpError("VALIDATION", "Unknown team.", { teamId: ["Unknown team"] });
  };

  r.post("/admin/users", async ({ actor, body }) => {
    need(actor, "users.manage_roles");
    const d = parse(UserAdminInput, body);
    guardRoleGrant(actor, d.roles);
    await checkTeam(actor.orgId, d.teamId);
    const phone = d.phone ? toE164(d.phone) : null;
    if (d.phone && !phone) throw new HttpError("VALIDATION", "Enter a valid phone number.", { phone: ["Invalid phone"] });
    const id = await db.tx(async (q) => {
      const dup = await q.query(`SELECT 1 FROM users WHERE email = $1`, [d.email]);
      if (dup.rows.length) throw conflict("A user with this email already exists.");
      const u = await q.query<{ id: string }>(
        `INSERT INTO users (organization_id, team_id, email, phone_e164, full_name, title, status, avatar_hue)
         VALUES ($1,$2,$3,$4,$5,$6,'invited',$7) RETURNING id`,
        [actor.orgId, d.teamId ?? null, d.email, phone, d.name, d.title, Math.floor(Math.random() * 360)],
      );
      await setRoles(q, actor.orgId, u.rows[0].id, d.roles, actor.userId);
      await audit(q, actor, "user.invite", "user", u.rows[0].id, { email: d.email, roles: d.roles });
      return u.rows[0].id;
    });
    const link = await new AuthService(deps).sendResetLink(id, actor.orgId, d.email, "invite", 72 * 60);
    await audit(db, actor, "user.invite_link", "user", id, { delivery: link.sent ? "email" : "manual", expiresAt: link.expiresAt });
    // With no email provider the admin hands the one-time link over themselves; it isn't stored.
    return { user: toAdminUser((await getUserRow(db, id))!), inviteSent: link.sent, ...(link.link ? { manualLink: link.link, linkExpiresAt: link.expiresAt } : {}) };
  }, { status: 201 });

  r.patch("/admin/users/:id", async ({ actor, body, params }) => {
    need(actor, "users.manage_roles");
    const d = parse(UserPatch, body);
    const target = isUuid(params.id) ? await getUserRow(db, params.id) : null;
    if (!target || target.organization_id !== actor.orgId) throw notFound("User");
    // Any change to a super admin / founder (phone, status, name…) is super-admin only.
    guardRoleGrant(actor, d.roles ?? [], target);
    const phoneChanging = d.phone !== undefined && (d.phone ? toE164(d.phone) : null) !== target.phone_e164;
    // The phone is a sign-in factor; for MFA-protected accounts only a super admin may change it.
    if (phoneChanging && requiresMfa({ roles: target.roles ?? [] }) && !actor.roles.includes("super_admin"))
      throw forbidden("Only a super admin can change the phone number of an account that uses two-step verification.");
    if (target.id === actor.userId && (d.status && d.status !== "active")) throw conflict("You can't suspend your own account.");
    if (target.id === actor.userId && d.roles && actor.roles.includes("super_admin") && !d.roles.includes("super_admin"))
      throw conflict("You can't remove your own Super Admin role. Ask another super admin.");
    await checkTeam(actor.orgId, d.teamId);
    const phone = d.phone !== undefined ? (d.phone ? toE164(d.phone) : null) : undefined;
    if (d.phone && !phone) throw new HttpError("VALIDATION", "Enter a valid phone number.", { phone: ["Invalid phone"] });
    await db.tx(async (q) => {
      await q.query(
        `UPDATE users SET full_name = coalesce($2, full_name), title = coalesce($3, title),
                team_id = CASE WHEN $4::boolean THEN $5::uuid ELSE team_id END,
                phone_e164 = CASE WHEN $6::boolean THEN $7 ELSE phone_e164 END,
                status = coalesce($8, status)
          WHERE id = $1`,
        [target.id, d.name ?? null, d.title ?? null, d.teamId !== undefined, d.teamId ?? null, phone !== undefined, phone ?? null, d.status ?? null],
      );
      const rolesChanged = d.roles && JSON.stringify([...d.roles].sort()) !== JSON.stringify([...(target.roles ?? [])].sort());
      if (rolesChanged) await setRoles(q, actor.orgId, target.id, d.roles!, actor.userId);
      // Role or status changes take effect immediately: existing sessions are revoked.
      if (rolesChanged || phoneChanging || (d.status && d.status !== "active")) {
        await q.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [target.id]);
      }
      await audit(q, actor, "user.update", "user", target.id, {
        ...(rolesChanged ? { roles: { from: target.roles, to: d.roles } } : {}),
        ...(d.status ? { status: { from: target.status, to: d.status } } : {}),
        ...(d.teamId !== undefined ? { teamId: { from: target.team_id, to: d.teamId } } : {}),
        ...(phoneChanging ? { phoneChanged: true } : {}),
      });
      if (phoneChanging)
        await notify(q, actor.orgId, target.id, { kind: "system", title: "Your sign-in phone number was changed", body: "If you didn't expect this, contact your administrator immediately.", href: "/me" });
    });
    return toAdminUser((await getUserRow(db, target.id))!);
  });

  r.post("/admin/users/:id/reset-mfa", async ({ actor, params }) => {
    need(actor, "users.manage_roles");
    const target = isUuid(params.id) ? await getUserRow(db, params.id) : null;
    if (!target || target.organization_id !== actor.orgId) throw notFound("User");
    if (target.id === actor.userId) throw conflict("You can't reset your own two-step verification.");
    guardRoleGrant(actor, [], target);
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET mfa_enrolled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL WHERE id = $1`, [target.id]);
      await q.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [target.id]);
      await audit(q, actor, "user.mfa_reset", "user", target.id);
    });
    return { ok: true };
  });

  r.post("/admin/users/:id/send-reset", async ({ actor, params }) => {
    need(actor, "users.manage_roles");
    const target = isUuid(params.id) ? await getUserRow(db, params.id) : null;
    if (!target || target.organization_id !== actor.orgId) throw notFound("User");
    if (target.id === actor.userId) throw conflict("Change your own password from your profile instead.");
    // A manual link is enough to take over an account without MFA, so the same rule as role
    // changes applies: only a super admin can issue one for a super admin or founder.
    guardRoleGrant(actor, [], target);
    if (target.status !== "active" && target.status !== "invited") throw conflict("Reactivate this account before sending a link.");
    const invite = target.status === "invited";
    const link = await new AuthService(deps).sendResetLink(target.id, actor.orgId, target.email, invite ? "invite" : "password_reset", invite ? 72 * 60 : resetLinkMinutes(deps));
    await audit(db, actor, "user.reset_link", "user", target.id, { delivery: link.sent ? "email" : "manual", expiresAt: link.expiresAt });
    if (!invite)
      await notify(db, actor.orgId, target.id, { kind: "system", title: "A password reset link was issued for your account", body: "If you didn't ask for this, contact your administrator immediately.", href: "/me" });
    return { sent: link.sent, ...(link.link ? { manualLink: link.link, linkExpiresAt: link.expiresAt } : {}) };
  });

  r.post("/admin/teams", async ({ actor, body }) => {
    need(actor, "users.manage_roles");
    const d = parse(z.object({ name: z.string().trim().min(2).max(80) }), body);
    const t = await db.query<{ id: string; name: string }>(`INSERT INTO teams (organization_id, name) VALUES ($1,$2) RETURNING id, name`, [actor.orgId, d.name]);
    await audit(db, actor, "team.create", "team", t.rows[0].id, { name: d.name });
    return t.rows[0];
  }, { status: 201 });
}
