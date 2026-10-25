import { buildApp } from "./app";
import { loadConfig } from "./config";
import { syncRbac } from "./db/bootstrap";
import { seedDemo } from "./db/demo-seed";
import { migrate } from "./db/migrate";
import { openDb } from "./db/open";
import { startWorker } from "./worker";

const config = loadConfig();
const db = await openDb(config);
// Production applies migrations as a separate, reviewed release step (npm run migrate).
if (process.env.MIGRATE_ON_START === "true" || (config.env !== "production" && process.env.MIGRATE_ON_START !== "false")) {
  await migrate(db, undefined, (m) => console.log(`[migrate] ${m}`));
}
await syncRbac(db);
if (config.env !== "production" && process.env.SEED_DEMO === "true") {
  const r = await seedDemo(db, config);
  if (!r.skipped) console.log("[seed] demo data loaded (fictional)");
}
const app = await buildApp({ db, config });
const worker = startWorker(app.deps);
await app.listen({ port: config.port, host: config.host });
console.log(`Zoii API listening on http://${config.host}:${config.port} (${config.env}, ${db.driver})`);

const shutdown = async () => {
  worker.stop();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
