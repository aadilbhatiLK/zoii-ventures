import { mkdirSync } from "node:fs";
import type { Config } from "../config";
import { createPgDb, createPgliteDb, type Db } from "./index";

export async function openDb(config: Config): Promise<Db> {
  if (config.databaseUrl) return createPgDb(config.databaseUrl, { ssl: config.databaseSsl });
  if (config.env === "production") throw new Error("DATABASE_URL is required in production.");
  if (config.pgliteDir === "memory") return createPgliteDb();
  mkdirSync(config.pgliteDir, { recursive: true });
  return createPgliteDb(config.pgliteDir);
}
