/**
 * Database access. One small interface over two drivers:
 *  - pg (node-postgres) for real PostgreSQL (DATABASE_URL) — production and staging.
 *  - PGlite (in-process PostgreSQL 17 compiled to WASM) for local development and tests.
 * Both run the same SQL, the same migrations and the same constraints.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

/** Queries issued anywhere inside db.tx(...) run on that transaction (both drivers). */
const txScope = new AsyncLocalStorage<Queryable>();

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  /** Runs fn in a transaction (READ COMMITTED). Rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Executes a multi-statement script without parameters. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly driver: "pg" | "pglite";
}

// NUMERIC → string (never float); BIGINT → string; DATE stays a 'YYYY-MM-DD' string.
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1082, (v) => v);

export function createPgDb(connectionString: string, opts: { max?: number; ssl?: boolean } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await c.query(sql, params as unknown[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });
  const base = wrap(pool);
  return {
    driver: "pg",
    query: (sql, params) => (txScope.getStore() ?? base).query(sql, params),
    async tx(fn) {
      const outer = txScope.getStore();
      if (outer) return fn(outer);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const q = wrap(client);
        const out = await txScope.run(q, () => fn(q));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const db = await PGlite.create(dataDir, {
    parsers: {
      [types.NUMERIC]: (v: string) => v,
      [types.INT8]: (v: string) => v,
      [types.DATE]: (v: string) => v,
    },
  });
  // PGlite is single-connection: serialise transactions so concurrent requests can't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const raw: Queryable = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await db.query<T>(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
  return {
    driver: "pglite",
    query: (sql, params) => {
      const inTx = txScope.getStore();
      return inTx ? inTx.query(sql, params) : serial(() => raw.query(sql, params));
    },
    tx: (fn) => {
      const outer = txScope.getStore();
      if (outer) return fn(outer);
      return serial(() => db.transaction(async (t) => {
        const q: Queryable = {
          async query<T>(sql: string, params: unknown[] = []) {
            const r = await t.query<T>(sql, params);
            return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
          },
        };
        return txScope.run(q, () => fn(q));
      }));
    },
    exec: (sql) => serial(async () => { await db.exec(sql); }),
    close: () => db.close(),
  };
}

export async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query<T>(sql, params);
  return r.rows[0] ?? null;
}
