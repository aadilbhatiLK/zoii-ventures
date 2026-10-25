import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, type Role } from "@/lib/permissions/registry";
import type { Db, Queryable } from "./index";
import { seedDefaultTaxRules } from "../modules/sales/catalogue";
import { seedChartOfAccounts } from "../modules/finance/ledger";
import { seedPeopleDefaults } from "../modules/people/hr";

/** Idempotent per-organisation defaults: GST rules, chart of accounts, leave types, SLAs. */
export async function seedOrgDefaults(q: Queryable, orgId: string) {
  await seedDefaultTaxRules(q, orgId);
  await seedChartOfAccounts(q, orgId);
  await seedPeopleDefaults(q, orgId);
}

/**
 * Keeps the database RBAC tables identical to the code registry (idempotent).
 * The registry is the source of truth; system roles are re-synced on every start.
 */
export async function syncRbac(q: Queryable) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await q.query(`INSERT INTO permissions (key, description) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`, [key, description]);
  }
  const orgs = (await q.query<{ id: string }>(`SELECT id FROM organizations`)).rows;
  for (const org of orgs) {
    for (const role of Object.keys(ROLES) as Role[]) {
      const r = await q.query<{ id: string }>(
        `INSERT INTO roles (organization_id, key, name, is_system) VALUES ($1,$2,$3,true)
         ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [org.id, role, ROLES[role]],
      );
      await q.query(`DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_key = ANY($2))`, [r.rows[0].id, [...ROLE_PERMISSIONS[role]]]);
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_key) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [r.rows[0].id, [...ROLE_PERMISSIONS[role]]],
      );
    }
  }
}

export async function createOrganization(db: Db, o: { name: string; legalName: string; gstin?: string | null; stateCode?: string | null }) {
  return db.tx(async (q) => {
    const r = await q.query<{ id: string }>(
      `INSERT INTO organizations (name, legal_name, gstin, state_code) VALUES ($1,$2,$3,$4) RETURNING id`,
      [o.name, o.legalName, o.gstin ?? null, o.stateCode ?? o.gstin?.slice(0, 2) ?? null],
    );
    await q.query(`INSERT INTO organization_settings (organization_id) VALUES ($1)`, [r.rows[0].id]);
    await syncRbac(q);
    await seedOrgDefaults(q, r.rows[0].id);
    return r.rows[0].id;
  });
}
