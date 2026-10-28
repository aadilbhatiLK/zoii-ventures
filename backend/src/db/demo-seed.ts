/**
 * DEMO DATA ONLY — loads the same fictional dataset the in-browser demo uses into a real
 * database so every module can be exercised end-to-end. Refused in production.
 * Every demo account uses the password "zoii-demo"; with AUTH_DEV_STATIC_CODES=true the
 * OTP / authenticator code 000000 is accepted (development only).
 */
import { randomUUID } from "node:crypto";
import { buildDemoSeed, DEMO_PASSWORD } from "@/lib/mock/seed";
import type { Config } from "../config";
import { encrypt, newTotpSecret } from "../lib/crypto";
import { hashPassword } from "../modules/auth/service";
import { toE164 } from "../modules/users/repo";
import { stateCodeFor } from "../modules/crm/clients";
import { createOrganization } from "./bootstrap";
import type { Db } from "./index";

export const DEMO_ORG = { name: "Zoii Ventures (Demo)", legalName: "Zoii Ventures", gstin: "08DAFPB0613A1ZN" };

export async function seedDemo(db: Db, config: Config, now = new Date()) {
  if (config.env === "production") throw new Error("Refusing to load demo data in production.");
  const existing = await db.query(`SELECT 1 FROM organizations LIMIT 1`);
  if (existing.rows.length) return { skipped: true as const };
  const orgId = await createOrganization(db, DEMO_ORG);
  const seed = buildDemoSeed(now);
  const ids = new Map<string, string>();
  const id = (k: string) => { if (!ids.has(k)) ids.set(k, randomUUID()); return ids.get(k)!; };
  const pw = await hashPassword(DEMO_PASSWORD);

  await db.tx(async (q) => {
    const teams = new Map<string, string>();
    for (const t of new Set(seed.users.map((u) => u.teamId).filter(Boolean) as string[])) {
      const name = t.replace(/^t_/, "").replace(/^./, (c) => c.toUpperCase());
      const r = await q.query<{ id: string }>(`INSERT INTO teams (organization_id, name) VALUES ($1,$2) RETURNING id`, [orgId, name]);
      teams.set(t, r.rows[0].id);
    }
    for (const u of seed.users) {
      const secret = u.mfaEnrolled ? encrypt(newTotpSecret(), config.dataEncryptionKey) : null;
      await q.query(
        `INSERT INTO users (id, organization_id, team_id, email, phone_e164, full_name, title, password_hash, mfa_enrolled, mfa_secret_enc, status, avatar_hue, email_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11, now())`,
        [id(u.id), orgId, u.teamId ? teams.get(u.teamId) : null, u.email, u.phone ? toE164(u.phone) : null, u.name, u.title, pw, u.mfaEnrolled, secret, u.avatarHue],
      );
      await q.query(
        `INSERT INTO user_role_assignments (organization_id, user_id, role_id) SELECT $1, $2, id FROM roles WHERE organization_id = $1 AND key = ANY($3)`,
        [orgId, id(u.id), u.roles],
      );
    }
    for (const c of seed.clients) {
      await q.query(
        `INSERT INTO clients (id, organization_id, code, display_name, legal_name, industry, category, status, account_manager_id, website, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11,$11)`,
        [id(c.id), orgId, c.code, c.name, c.legalName, c.industry, c.category, c.status, id(c.accountManagerId), c.website, c.createdAt],
      );
      const sc = stateCodeFor(c.billingAddress.state);
      await q.query(`INSERT INTO client_tax_profiles (client_id, organization_id, registration_type, state_code) VALUES ($1,$2,'unregistered',$3)`, [id(c.id), orgId, sc]);
      await q.query(
        `INSERT INTO client_addresses (organization_id, client_id, kind, line1, city, state, state_code, pincode, is_default) VALUES ($1,$2,'billing',$3,$4,$5,$6,$7,true)`,
        [orgId, id(c.id), c.billingAddress.line1, c.billingAddress.city, c.billingAddress.state, sc, c.billingAddress.pincode],
      );
      for (const ct of c.contacts) {
        await q.query(
          `INSERT INTO client_contacts (organization_id, client_id, name, designation, email, phone, is_primary, is_decision_maker) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [orgId, id(c.id), ct.name, ct.designation, ct.email, ct.phone, ct.isPrimary, ct.isDecisionMaker],
        );
      }
      await q.query(`INSERT INTO client_product_lines (organization_id, client_id, product_line) SELECT $1,$2,unnest($3::text[])`, [orgId, id(c.id), c.productLines]);
    }
    for (const l of seed.leads) {
      await q.query(
        `INSERT INTO leads (id, organization_id, code, contact_name, company, email, phone, city, source, campaign, stage, priority, score, estimated_value,
                            owner_id, next_follow_up_at, closed_at, lost_reason, client_id, notes, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [id(l.id), orgId, l.code, l.name, l.company, l.email, l.phone, l.city, l.source, l.campaign, l.stage, l.priority, l.score, l.estimatedValue,
         id(l.ownerId), l.nextFollowUpAt, l.closedAt, l.lostReason, l.clientId ? id(l.clientId) : null, l.notes, id(l.createdById), l.createdAt, l.updatedAt],
      );
      await q.query(`INSERT INTO lead_product_interests (organization_id, lead_id, product_line) SELECT $1,$2,unnest($3::text[])`, [orgId, id(l.id), l.productInterest]);
      if (l.nextFollowUpAt)
        await q.query(`INSERT INTO follow_ups (organization_id, lead_id, assigned_to, due_at, created_by) VALUES ($1,$2,$3,$4,$3)`, [orgId, id(l.id), id(l.ownerId), l.nextFollowUpAt]);
    }
    for (const c of seed.clients) if (c.sourceLeadId) await q.query(`UPDATE clients SET source_lead_id = $2, updated_at = $3 WHERE id = $1`, [id(c.id), id(c.sourceLeadId), c.updatedAt]);
    // Restore seeded timestamps that the updated_at trigger overwrote.
    await q.query(`ALTER TABLE leads DISABLE TRIGGER leads_updated`);
    for (const l of seed.leads) await q.query(`UPDATE leads SET updated_at = $2 WHERE id = $1`, [id(l.id), l.updatedAt]);
    await q.query(`ALTER TABLE leads ENABLE TRIGGER leads_updated`);
    await q.query(`ALTER TABLE clients DISABLE TRIGGER clients_updated`);
    for (const c of seed.clients) await q.query(`UPDATE clients SET updated_at = $2 WHERE id = $1`, [id(c.id), c.updatedAt]);
    await q.query(`ALTER TABLE clients ENABLE TRIGGER clients_updated`);
    for (const a of seed.activities) {
      await q.query(
        `INSERT INTO activities (organization_id, lead_id, client_id, type, summary, body, actor_id, occurred_at, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orgId, a.entityType === "lead" ? id(a.entityId) : null, a.entityType === "client" ? id(a.entityId) : null, a.type, a.summary, a.body, id(a.actorId), a.occurredAt,
         JSON.stringify(Object.fromEntries(Object.entries(a.meta).map(([k, v]) => [k, ids.get(v) ?? v])))],
      );
    }
    await q.query(`INSERT INTO number_sequences (organization_id, key, next_value) VALUES ($1,'lead',$2), ($1,'client',$3)`, [orgId, seed.leads.length + 1, seed.clients.length + 1]);
  });
  return { skipped: false as const, orgId, ids };
}
