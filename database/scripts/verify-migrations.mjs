// Applies every migration in order to an in-process PostgreSQL (PGlite) and asserts
// the integrity constraints the application relies on. Exits non-zero on failure.
// This verifies the SQL itself; it is not a substitute for running against the
// managed Postgres version used in production.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const db = new PGlite();
let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

for (const f of readdirSync(dir)
  .filter((x) => x.endsWith(".sql"))
  .sort()) {
  try {
    await db.exec(readFileSync(join(dir, f), "utf8"));
    ok(`applied ${f}`);
  } catch (e) {
    bad(`applying ${f}: ${e.message}`);
    process.exit(1);
  }
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const org = await one(
  `INSERT INTO organizations (name, legal_name, gstin, state_code) VALUES ('Zoii Ventures', 'Zoii Ventures', '08DAFPB0613A1ZN', '08') RETURNING id`,
);
const team = await one(
  `INSERT INTO teams (organization_id, name) VALUES ($1, 'Growth') RETURNING id`,
  [org.id],
);
const u = await one(
  `INSERT INTO users (organization_id, team_id, email, full_name, status) VALUES ($1, $2, 'owner@zoii.in', 'Owner', 'active') RETURNING id`,
  [org.id, team.id],
);
const lead = await one(
  `INSERT INTO leads (organization_id, code, contact_name, phone, source, estimated_value, owner_id) VALUES ($1, 'LD-1', 'Asha Jain', '+91 98290 12345', 'website', 45000, $2) RETURNING id, phone_last10`,
  [org.id, u.id],
);
if (lead.phone_last10 === "9829012345") ok("generated phone_last10 normalises numbers");
else bad(`phone_last10 = ${lead.phone_last10}`);

async function rejects(label, sql, params = []) {
  try {
    await db.query("SAVEPOINT t");
    await db.query(sql, params);
    bad(`${label} (was accepted)`);
  } catch (e) {
    // Only integrity (23xxx), data (22xxx) or append-only trigger (42501) errors count;
    // a syntax or missing-object error would mean the check itself is broken.
    const code = String(e.code ?? "");
    if (code.startsWith("23") || code.startsWith("22") || code === "42501")
      ok(`${label} [${code}]`);
    else bad(`${label} failed for the wrong reason (${code}: ${e.message})`);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT t").catch(() => {});
  }
}
await db.query("BEGIN");
await rejects(
  "rejects negative estimated value",
  `INSERT INTO leads (organization_id, code, contact_name, phone, source, estimated_value, owner_id) VALUES ($1, 'LD-2', 'X Y', '9', 'website', -1, $2)`,
  [org.id, u.id],
);
await rejects(
  "rejects duplicate lead code within an organisation",
  `INSERT INTO leads (organization_id, code, contact_name, phone, source, estimated_value, owner_id) VALUES ($1, 'LD-1', 'X Y', '9', 'website', 1, $2)`,
  [org.id, u.id],
);
await rejects(
  "requires a lost reason for lost leads",
  `UPDATE leads SET stage = 'lost' WHERE id = $1`,
  [lead.id],
);
await rejects(
  "forbids follow-ups on closed leads",
  `UPDATE leads SET stage = 'won', next_follow_up_at = now() WHERE id = $1`,
  [lead.id],
);
await rejects("rejects unknown stages", `UPDATE leads SET stage = 'maybe' WHERE id = $1`, [
  lead.id,
]);
await rejects(
  "rejects unknown product lines",
  `INSERT INTO lead_product_interests VALUES ($1, 'spaceships')`,
  [lead.id],
);

const client = await one(
  `INSERT INTO clients (organization_id, code, display_name, legal_name, industry, category, account_manager_id, source_lead_id) VALUES ($1, 'CL-1', 'Asha Traders', 'Asha Traders', 'Retail', 'smb', $2, $3) RETURNING id`,
  [org.id, u.id, lead.id],
);
await rejects(
  "a lead linked to a client must be won",
  `UPDATE leads SET client_id = $2 WHERE id = $1`,
  [lead.id, client.id],
);
await db.query(`UPDATE leads SET stage = 'won', client_id = $2 WHERE id = $1`, [
  lead.id,
  client.id,
]);
ok("won lead links to its client");

await rejects(
  "GSTIN format is enforced",
  `INSERT INTO client_tax_profiles (client_id, organization_id, registration_type, gstin, pan, state_code) VALUES ($1, $2, 'regular', 'BADGSTIN', 'AAOCP3812A', '08')`,
  [client.id, org.id],
);
await rejects(
  "GSTIN must agree with PAN and state",
  `INSERT INTO client_tax_profiles (client_id, organization_id, registration_type, gstin, pan, state_code) VALUES ($1, $2, 'regular', '08AAOCP3812A1ZN', 'ZZZZZ9999Z', '08')`,
  [client.id, org.id],
);
await rejects(
  "registered clients need a GSTIN",
  `INSERT INTO client_tax_profiles (client_id, organization_id, registration_type) VALUES ($1, $2, 'regular')`,
  [client.id, org.id],
);
await db.query(
  `INSERT INTO client_tax_profiles (client_id, organization_id, registration_type, gstin, pan, state_code) VALUES ($1, $2, 'regular', '08AAOCP3812A1ZN', 'AAOCP3812A', '08')`,
  [client.id, org.id],
);
ok("valid tax profile accepted");
await rejects(
  "PIN code must be 6 digits",
  `INSERT INTO client_addresses (client_id, kind, line1, city, state, pincode) VALUES ($1, 'billing', 'x', 'Bikaner', 'Rajasthan', '01234')`,
  [client.id],
);
await db.query(
  `INSERT INTO client_contacts (client_id, name, phone, is_primary) VALUES ($1, 'Asha', '9829012345', true)`,
  [client.id],
);
await rejects(
  "only one primary contact per client",
  `INSERT INTO client_contacts (client_id, name, phone, is_primary) VALUES ($1, 'Second', '9829012346', true)`,
  [client.id],
);
await rejects(
  "activity must belong to exactly one parent",
  `INSERT INTO activities (organization_id, lead_id, client_id, type, summary) VALUES ($1, $2, $3, 'note', 'both parents')`,
  [org.id, lead.id, client.id],
);
await db.query(
  `INSERT INTO follow_ups (lead_id, assigned_to, due_at) VALUES ($1, $2, now() + interval '1 day')`,
  [lead.id, u.id],
);
await rejects(
  "only one open follow-up per lead",
  `INSERT INTO follow_ups (lead_id, assigned_to, due_at) VALUES ($1, $2, now())`,
  [lead.id, u.id],
);
await rejects(
  "completed follow-ups need an outcome",
  `UPDATE follow_ups SET completed_at = now() WHERE lead_id = $1`,
  [lead.id],
);

await db.query(
  `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'lead.create', 'lead', $3)`,
  [org.id, u.id, lead.id],
);
await rejects("audit events cannot be updated", `UPDATE audit_events SET action = 'lead.delete'`);
await rejects("audit events cannot be deleted", `DELETE FROM audit_events`);
await rejects(
  "session tokens are stored as 32-byte hashes only",
  `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'plain-token'::bytea, now() + interval '1 hour')`,
  [u.id],
);
await rejects(
  "OTP attempts are capped at 5",
  `INSERT INTO auth_challenges (user_id, kind, code_hash, attempts, expires_at) VALUES ($1, 'phone_otp', '\\x00', 6, now())`,
  [u.id],
);
await rejects(
  "emails must be stored lower-case",
  `INSERT INTO users (organization_id, email, full_name) VALUES ($1, 'Mixed@Zoii.in', 'M')`,
  [org.id],
);
await db.query("COMMIT");

// Seed: permissions and system roles generated from the code registry.
try {
  const seed = readFileSync(join(dir, "..", "seeds", "0001_permissions.sql"), "utf8").replaceAll(
    ":'org_id'",
    `'${org.id}'`,
  );
  await db.exec(seed);
  const n = await one(
    `SELECT count(*)::int AS roles, (SELECT count(*)::int FROM role_permissions) AS grants FROM roles`,
  );
  const founderSettings = await one(
    `SELECT count(*)::int AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'founder' AND rp.permission_key = 'settings.manage'`,
  );
  if (n.roles === 14 && founderSettings.n === 0)
    ok(`permission seed applied (${n.roles} roles, ${n.grants} grants)`);
  else bad("permission seed mismatch");
} catch (e) {
  bad(`permission seed: ${e.message}`);
}

const t = await one(
  `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
);
console.log(
  `\n${t.n} tables · ${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
