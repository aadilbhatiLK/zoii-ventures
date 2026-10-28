import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  can,
  canEditLead,
  canViewLead,
  leadScope,
  type Permission,
  type Principal,
} from "@/lib/permissions";

const p = (roles: Principal["roles"], id = "u1", teamId: string | null = "t1"): Principal => ({
  id,
  roles,
  teamId,
});
const teams: Record<string, string> = { u1: "t1", u2: "t1", u3: "t2" };
const teamOf = (id: string) => teams[id] ?? null;

describe("permission registry", () => {
  it("every role maps only to registered permissions", () => {
    for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
      for (const perm of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toHaveProperty(perm);
    }
  });
  it("auditor is read-only", () => {
    const writes = (Object.keys(PERMISSIONS) as Permission[]).filter(
      (x) => !/\.view|^dashboard\.|^reports\.view$|^audit\.view$|view_all/.test(x),
    );
    for (const w of writes) expect(can(p(["auditor"]), w), w).toBe(false);
  });
  it("client users have no internal access", () => {
    expect(ROLE_PERMISSIONS.client_user).toHaveLength(0);
    expect(leadScope(p(["client_user"]))).toBe("none");
  });
  it("only finance roles can post journals or close periods", () => {
    for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
      const allowed = can(p([role]), "finance.period.close");
      expect(allowed, role).toBe(["super_admin", "founder", "finance_manager"].includes(role));
    }
  });
  it("only super admin manages system settings", () => {
    expect(can(p(["founder"]), "settings.manage")).toBe(false);
    expect(can(p(["super_admin"]), "settings.manage")).toBe(true);
  });
  it("null principal can do nothing", () => {
    expect(can(null, "dashboard.view")).toBe(false);
  });
});

describe("record-level lead access", () => {
  it("sales executive sees only own leads", () => {
    const exec = p(["sales_executive"], "u1");
    expect(canViewLead(exec, { ownerId: "u1" }, teamOf)).toBe(true);
    expect(canViewLead(exec, { ownerId: "u2" }, teamOf)).toBe(false);
  });
  it("sales manager sees own team only", () => {
    const mgr = p(["sales_manager"], "u9", "t1");
    expect(canViewLead(mgr, { ownerId: "u2" }, teamOf)).toBe(true);
    expect(canViewLead(mgr, { ownerId: "u3" }, teamOf)).toBe(false);
  });
  it("founder sees everything; auditor sees but cannot edit", () => {
    expect(canViewLead(p(["founder"]), { ownerId: "u3" }, teamOf)).toBe(true);
    const aud = p(["auditor"]);
    expect(canViewLead(aud, { ownerId: "u3" }, teamOf)).toBe(true);
    expect(canEditLead(aud, { ownerId: "u3" }, teamOf)).toBe(false);
  });
  it("finance and HR have no lead access", () => {
    expect(leadScope(p(["finance_manager"]))).toBe("none");
    expect(leadScope(p(["hr_manager"]))).toBe("none");
  });
});
