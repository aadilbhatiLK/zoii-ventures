import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./index";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "..", "database", "migrations");

/**
 * Forward-only migration runner. Each file runs in its own transaction together with its
 * bookkeeping row; an already-applied file whose checksum changed is a hard error
 * (migrations are immutable once applied — write a new one instead).
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR, log: (m: string) => void = () => {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map(
    (await db.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations")).rows.map(
      (r) => [r.name, r.checksum],
    ),
  );
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prev = applied.get(f);
    if (prev) {
      if (prev !== checksum) throw new Error(`Migration ${f} was modified after it was applied.`);
      continue;
    }
    // Files carry their own BEGIN/COMMIT for psql use; strip them so the runner's
    // transaction covers both the DDL and the bookkeeping insert.
    const body = sql.replace(/^\s*BEGIN;\s*$/m, "").replace(/^\s*COMMIT;\s*$/m, "");
    await db.exec(`BEGIN;\n${body}\nINSERT INTO schema_migrations (name, checksum) VALUES ('${f}', '${checksum}');\nCOMMIT;`).catch(async (e) => {
      await db.exec("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    });
    ran.push(f);
    log(`applied ${f}`);
  }
  return ran;
}
