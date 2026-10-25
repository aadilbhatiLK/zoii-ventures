import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { hashPassword, passwordProblem } from "../modules/auth/service";
import { createOrganization, syncRbac } from "./bootstrap";
import { seedDemo } from "./demo-seed";
import { migrate } from "./migrate";
import { openDb } from "./open";

const [cmd, ...rest] = process.argv.slice(2);
const config = loadConfig();
const db = await openDb(config);
try {
  if (cmd === "migrate") {
    const ran = await migrate(db, undefined, console.log);
    await syncRbac(db);
    console.log(ran.length ? `Applied ${ran.length} migration(s).` : "Database is up to date.");
  } else if (cmd === "seed-demo") {
    await migrate(db);
    const r = await seedDemo(db, config);
    console.log(r.skipped ? "Database already has an organisation; demo seed skipped." : "Demo data loaded (fictional). Password: zoii-demo");
  } else if (cmd === "create-admin") {
    // First super admin for a fresh production database. MFA enrolment happens at first sign-in.
    const { values } = parseArgs({ args: rest, options: { org: { type: "string" }, legal: { type: "string" }, gstin: { type: "string" }, email: { type: "string" }, name: { type: "string" } } });
    const password = process.env.ADMIN_PASSWORD ?? "";
    if (!values.email || !values.name || !password) throw new Error("Usage: ADMIN_PASSWORD=... create-admin --email a@b.c --name 'Full Name' [--org 'Zoii Ventures' --legal '...' --gstin ...]");
    const problem = passwordProblem(password, values.email);
    if (problem) throw new Error(problem);
    await migrate(db);
    let org = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    if (!org) org = await createOrganization(db, { name: values.org ?? "Zoii Ventures", legalName: values.legal ?? values.org ?? "Zoii Ventures", gstin: values.gstin ?? null });
    await db.tx(async (q) => {
      const u = await q.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, full_name, title, password_hash, status, email_verified_at) VALUES ($1,$2,$3,'Administrator',$4,'active',now()) RETURNING id`,
        [org, values.email!.toLowerCase(), values.name, await hashPassword(password)],
      );
      await q.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id) SELECT $1,$2,id FROM roles WHERE organization_id = $1 AND key = 'super_admin'`, [org, u.rows[0].id]);
      await q.query(`INSERT INTO audit_events (organization_id, action, entity_type, entity_id, changes) VALUES ($1,'user.bootstrap_admin','user',$2,'{}')`, [org, u.rows[0].id]);
    });
    console.log(`Super admin ${values.email} created. Sign in to enrol an authenticator app.`);
  } else {
    console.log("Commands: migrate | seed-demo | create-admin");
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
