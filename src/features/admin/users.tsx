"use client";

import { useState } from "react";
import { MailPlus, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ModulePage, NativeSelect, Section, SimpleTable, StatusBadge } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import type { User } from "@/lib/api/contracts";
import { MFA_REQUIRED_ROLES, ROLES, type Permission, type Role } from "@/lib/permissions";
import { formatRelative } from "@/lib/formatting";

type AdminUser = User & { status: string; lastLoginAt: string | null; createdAt: string };

export function UsersAdminView() {
  const { user: me } = useAuth();
  const users = useApi<AdminUser[]>(["admin", "users"], "/admin/users");
  const teams = useApi<{ id: string; name: string }[]>(["teams"], "/teams");
  const roles = useApi<{ roles: { key: Role; name: string; permissions: Permission[] }[]; permissions: { key: Permission; description: string }[] }>(["admin", "roles"], "/admin/roles");
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);
  const [resetMfa, setResetMfa] = useState<AdminUser | null>(null);
  const mfa = useApiMutation<{ id: string }>("POST", (b) => `/admin/users/${b.id}/reset-mfa`, { invalidate: [["admin"]], success: "Two-step verification reset; they'll enrol again at next sign-in" });
  const reset = useApiMutation<{ id: string }, { sent: boolean }>("POST", (b) => `/admin/users/${b.id}/send-reset`, { success: (r) => (r.sent ? "Link sent" : "No email provider configured — the link wasn't sent") });
  return (
    <ModulePage title="Users & Roles" description="Role changes and suspensions sign the person out everywhere immediately. Only super admins can grant Super Admin or Founder." permissions={["users.manage_roles"]}
      actions={<Button size="sm" variant="primary" onClick={() => setEditing("new")}><MailPlus /> Invite user</Button>}>
      <Tabs defaultValue="users">
        <TabsList><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="matrix">Role matrix</TabsTrigger></TabsList>
        <TabsContent value="users" className="pt-4">
          <Section flush>
            <SimpleTable label="Users" rows={users.data} rowKey={(u) => u.id} onRowClick={setEditing} loading={users.isLoading} error={users.error}
              columns={[
                { key: "n", header: "User", cell: (u) => <div><div className="font-medium">{u.name}{u.id === me?.id && <span className="text-fg-subtle"> (you)</span>}</div><div className="text-fg-subtle text-xs">{u.email}</div></div> },
                { key: "r", header: "Roles", cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="outline">{ROLES[r]}</Badge>)}</div> },
                { key: "m", header: "MFA", cell: (u) => (u.mfaEnrolled ? <Badge tone="success">On</Badge> : u.roles.some((r) => MFA_REQUIRED_ROLES.includes(r)) ? <Badge tone="warning">Pending</Badge> : <span className="text-fg-subtle">—</span>), hideBelow: "sm" },
                { key: "s", header: "Status", cell: (u) => <StatusBadge status={u.status === "invited" ? "pending" : u.status} label={u.status} /> },
                { key: "l", header: "Last sign-in", cell: (u) => (u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"), hideBelow: "md" },
                { key: "x", header: "", align: "right", cell: (u) => u.id !== me?.id && (
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="xs" variant="ghost" onClick={() => reset.mutate({ id: u.id })}>{u.status === "invited" ? "Resend invite" : "Reset link"}</Button>
                    {u.mfaEnrolled && <Button size="xs" variant="ghost" onClick={() => setResetMfa(u)}><ShieldOff /> Reset MFA</Button>}
                  </div>
                ) },
              ]} />
          </Section>
        </TabsContent>
        <TabsContent value="matrix" className="pt-4">
          <Section flush description="Generated from the permission registry the API enforces. Custom roles aren't supported yet.">
            {roles.data && (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="text-2xs w-full">
                  <thead><tr><th className="bg-surface sticky left-0 px-3 py-2 text-left text-xs">Permission</th>{roles.data.roles.map((r) => <th key={r.key} className="px-1.5 py-2 font-medium [writing-mode:vertical-rl]">{r.name}</th>)}</tr></thead>
                  <tbody className="divide-border divide-y">{roles.data.permissions.map((p) => <tr key={p.key}><td className="bg-surface sticky left-0 px-3 py-1.5 text-xs"><span className="font-mono">{p.key}</span><div className="text-fg-subtle">{p.description}</div></td>{roles.data!.roles.map((r) => <td key={r.key} className="text-center">{r.permissions.includes(p.key) ? <span className="text-success">●</span> : <span className="text-fg-subtle/40">·</span>}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>
      {editing && <UserDialog user={editing === "new" ? null : editing} teams={teams.data ?? []} self={editing !== "new" && editing.id === me?.id} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!resetMfa} onOpenChange={(o) => !o && setResetMfa(null)} title={`Reset two-step verification for ${resetMfa?.name}?`} description="Their authenticator stops working and all their sessions end. They'll scan a new code at next sign-in. Only do this after confirming their identity." confirmLabel="Reset MFA" destructive onConfirm={() => resetMfa && mfa.mutate({ id: resetMfa.id })} />
    </ModulePage>
  );
}

function UserDialog({ user, teams, self, onClose }: { user: AdminUser | null; teams: { id: string; name: string }[]; self: boolean; onClose: () => void }) {
  const { user: me } = useAuth();
  const [v, setV] = useState({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", title: user?.title ?? "", teamId: user?.teamId ?? "", roles: user?.roles ?? (["employee"] as Role[]), status: user?.status ?? "active" });
  const save = useApiMutation<object, { inviteSent?: boolean }>(user ? "PATCH" : "POST", user ? `/admin/users/${user.id}` : "/admin/users", { invalidate: [["admin"], ["users"]], success: (r) => (user ? "User updated" : r.inviteSent ? "Invite sent" : "User created — no email provider is configured, so send them the reset link manually") });
  const superAdmin = me?.roles.includes("super_admin");
  const toggleRole = (r: Role) => setV((s) => ({ ...s, roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r] }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); const body = user ? { name: v.name, phone: v.phone, title: v.title, teamId: v.teamId || null, roles: v.roles, status: v.status } : { ...v, teamId: v.teamId || null }; save.mutate(body, { onSuccess: onClose }); }}>
          <DialogHeader><DialogTitle>{user ? `Edit ${user.name}` : "Invite a user"}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="un" required><Input id="un" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="ue" required><Input id="ue" type="email" disabled={!!user} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Mobile" htmlFor="up" hint="Used for OTP sign-in"><Input id="up" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
            <Field label="Title" htmlFor="ut"><Input id="ut" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field label="Team" htmlFor="utm" hint="Team-scoped managers see their team's leads"><NativeSelect id="utm" value={v.teamId} onChange={(e) => setV({ ...v, teamId: e.target.value })}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
            {user && <Field label="Status" htmlFor="us"><NativeSelect id="us" value={v.status} disabled={self} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>{user.status === "invited" && <option value="invited" disabled>Invited</option>}</NativeSelect></Field>}
            <fieldset className="sm:col-span-2"><legend className="mb-2 text-[13px] font-medium">Roles</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">{(Object.keys(ROLES) as Role[]).map((r) => {
                const locked = (r === "super_admin" || r === "founder") && !superAdmin;
                return <label key={r} className="flex items-center gap-2 text-[13px]"><input type="checkbox" disabled={locked} checked={v.roles.includes(r)} onChange={() => toggleRole(r)} /> {ROLES[r]}{MFA_REQUIRED_ROLES.includes(r) && <span className="text-fg-subtle text-xs">· MFA</span>}</label>;
              })}</div>
            </fieldset>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={save.isPending} disabled={!v.roles.length || v.name.length < 2}>{user ? "Save" : "Send invite"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
